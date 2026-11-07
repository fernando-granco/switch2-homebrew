"""Offline tests: actual C++ firmware parser, localhost sockets; no hardware."""
import contextlib
import pathlib
import os
import pty
import select
import socket
import subprocess
import tempfile
import threading
import time
import unittest
import zlib

from bridge_service import MuxSerial, serve
from bridge_stream import BridgeStream

HERE = pathlib.Path(__file__).resolve().parent


@contextlib.contextmanager
def serial_model(executable):
    """Real pyserial over a Unix PTY to the compiled firmware parser."""
    master, slave = pty.openpty()
    proc = subprocess.Popen([executable, "--model"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    stop = threading.Event()
    errors = []
    def pump():
        try:
            while not stop.is_set():
                readable, _, _ = select.select([master, proc.stdout], [], [], .02)
                if master in readable:
                    data = os.read(master, 4096)
                    proc.stdin.write(data)
                    proc.stdin.flush()
                if proc.stdout in readable:
                    data = os.read(proc.stdout.fileno(), 4096)
                    if not data:
                        break
                    os.write(master, data)
        except Exception as exc:
            if not stop.is_set():
                errors.append(exc)
    thread = threading.Thread(target=pump, daemon=True)
    thread.start()
    try:
        yield os.ttyname(slave)
    finally:
        stop.set()
        thread.join(2)
        proc.terminate()
        proc.wait(timeout=2)
        proc.stdin.close()
        proc.stdout.close()
        os.close(master)
        os.close(slave)
    if errors:
        raise errors[0]


class ModelLink(MuxSerial):
    def __init__(self, executable):
        self.proc = subprocess.Popen([executable, "--model"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        self.commands = []

    def command(self, channel, text):
        self.commands.append((channel, text[:1]))
        self.proc.stdin.write(f"M {channel} {text}\n".encode())
        self.proc.stdin.flush()
        if not select.select([self.proc.stdout], [], [], 2)[0]:
            raise TimeoutError("Mock firmware stalled")
        reply = self.proc.stdout.readline().decode().strip()
        if reply.startswith("ERR "):
            raise RuntimeError(reply)
        return reply

    def close(self):
        self.proc.terminate()
        self.proc.wait(timeout=2)
        self.proc.stdin.close()
        self.proc.stdout.close()


class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.exe = str(pathlib.Path(cls.temp.name) / "protocol")
        subprocess.run(["g++", "-std=c++11", "-Wall", "-Wextra", "-Werror", str(HERE / "test_protocol.cpp"), "-o", cls.exe], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_firmware_guards(self):
        subprocess.run([self.exe], check=True, timeout=3)

    def test_simultaneous_channels(self):
        link = ModelLink(self.exe)
        try:
            self.exercise_channels(link)
        finally:
            link.close()

    def test_simultaneous_through_serial(self):
        with serial_model(self.exe) as device:
            with MuxSerial("192.168.77.2", device) as link:
                link.commands = []
                original = link.command
                def logged(channel, text):
                    link.commands.append((channel,text[:1]))
                    return original(channel,text)
                link.command = logged
                self.exercise_channels(link)

    def test_connect_failure_isolated_and_not_success_eof(self):
        link = ModelLink(self.exe)
        original = link.command
        failed = []
        def injected(channel, text):
            if channel == 0 and text.startswith("C ") and not failed:
                failed.append(True)
                raise RuntimeError("ERR connect")
            return original(channel,text)
        link.command = injected
        try:
            self.exercise_channels(link, reject_first=True)
        finally:
            link.close()

    def exercise_channels(self, link, reject_first=False):
        stop, ready = threading.Event(), threading.Event()
        ports, errors = [], []
        def run():
            try:
                serve(link, "192.168.77.2", 0, 0, stop=stop, ready=lambda p: (ports.extend(p), ready.set()))
            except Exception as exc:
                errors.append(exc)
                ready.set()
        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        self.assertTrue(ready.wait(3))
        def receive(sock, length):
            out = bytearray()
            while len(out) < length:
                data = sock.recv(length-len(out))
                self.assertTrue(data)
                out.extend(data)
            return bytes(out)
        try:
            with socket.create_connection(("127.0.0.1", ports[1]), timeout=5) as debug:
                debug.sendall(b"first")
                self.assertEqual(receive(debug,5), b"first")
                if reject_first:
                    with socket.create_connection(("127.0.0.1", ports[0]), timeout=5) as bad:
                        with self.assertRaises(ConnectionError):
                            bad.sendall(b"failed")
                            bad.recv(1)
                    debug.sendall(b"unaffected")
                    self.assertEqual(receive(debug,10),b"unaffected")
                payload = bytes(range(256))*32
                with socket.create_connection(("127.0.0.1", ports[0]), timeout=5) as upload:
                    upload.sendall(payload[:64])
                    deadline = time.monotonic()+2
                    while (0,"D") not in link.commands and time.monotonic()<deadline:
                        time.sleep(.001)
                    self.assertIn((0,"D"),link.commands)
                    debug.sendall(b"during-upload")
                    self.assertEqual(receive(debug,13), b"during-upload")
                    upload.sendall(payload[64:])
                    upload.shutdown(socket.SHUT_WR)
                    self.assertEqual(receive(upload,len(payload)),payload)
                    self.assertEqual(upload.recv(1),b"")
                debug.sendall(b"still-connected")
                self.assertEqual(receive(debug,15),b"still-connected")
                # A second payload gets a fresh channel without dropping GDB.
                with socket.create_connection(("127.0.0.1", ports[0]), timeout=5) as upload:
                    upload.sendall(b"again")
                    upload.shutdown(socket.SHUT_WR)
                    self.assertEqual(receive(upload,5),b"again")
                    self.assertEqual(upload.recv(1),b"")
                with socket.create_connection(("127.0.0.1", ports[1]), timeout=5) as busy:
                    with self.assertRaises(ConnectionError):
                        busy.recv(1)
                debug.sendall(b"after-busy")
                self.assertEqual(receive(debug,10),b"after-busy")
            self.assertIn((0,"F"),link.commands)
            opened = link.commands.index((0,"C"))
            finished = link.commands.index((0,"F"))
            self.assertIn((1,"D"),link.commands[opened:finished])
        finally:
            stop.set()
            thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors,[])

    def test_corrupt_reply(self):
        link = object.__new__(MuxSerial)
        link.command = lambda *_: "R 00000000 61"
        with self.assertRaisesRegex(ValueError,"CRC"):
            link.read(0)

    def test_legacy_sender_actual_parser(self):
        with serial_model(self.exe) as device:
            payload = pathlib.Path(self.temp.name) / "payload.js"
            data = bytes(range(256))*4
            payload.write_bytes(data)
            result = subprocess.run(["python3", str(HERE / "send_usb.py"), "192.168.77.2", str(payload), "--serial", device, "--timeout", "8"], capture_output=True, timeout=10)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(result.stdout,data)

    def test_direct_debug_actual_parser(self):
        with serial_model(self.exe) as device:
            with BridgeStream("192.168.77.2", device, timeout=2) as stream:
                data = bytes(range(256))*4
                stream.sendall(data)
                received = bytearray()
                while len(received)<len(data):
                    received.extend(stream.recv(63))
                self.assertEqual(received,data)

    def test_multiplex_serial_actual_parser(self):
        with serial_model(self.exe) as device:
            with MuxSerial("192.168.77.2", device) as link:
                link.expect_ok(0,"C 192.168.77.2")
                link.expect_ok(1,"G 192.168.77.2")
                for channel,data in [(0,b"payload"),(1,b"debug")]:
                    link.expect_ok(channel,f"D {zlib.crc32(data):08x} {data.hex()}")
                link.expect_ok(0,"F")
                self.assertEqual(link.read(0),b"payload")
                self.assertEqual(link.read(1),b"debug")
                self.assertEqual(link.read(0),b"")
                self.assertIsNone(link.read(1))
                link.expect_ok(1,"X")

    def test_old_busy_and_reset_handshakes(self):
        class ScriptedSerial:
            def __init__(self, reply):
                self.reply = reply
                self.is_open = False
                self.output = bytearray()
                self.writes = []
            def open(self): self.is_open = True
            def close(self): self.is_open = False
            def reset_input_buffer(self): pass
            def write(self, data):
                self.writes.append(data)
                self.output.extend(b"OK\n" if data == b"Z\n" else self.reply)
                return len(data)
            def read(self, size):
                data = bytes(self.output[:size])
                del self.output[:size]
                return data
        for reply, error in [(b"READY 1\n",ValueError),(b"ERR busy\n",RuntimeError)]:
            port = ScriptedSerial(reply)
            link = MuxSerial("192.168.77.2","mock")
            link.wire.factory = lambda **_: port
            with self.assertRaises(error):
                with link: pass
            self.assertEqual(port.writes,[b"Q\n"])
            self.assertFalse(port.is_open)
        port = ScriptedSerial(b"READY 3 MUX2\n")
        link = MuxSerial("192.168.77.2","mock",reset=True)
        link.wire.factory = lambda **_: port
        with link: pass
        self.assertEqual(port.writes,[b"Z\n",b"Q\n"])


if __name__ == "__main__":
    unittest.main()
