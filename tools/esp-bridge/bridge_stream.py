"""Socket-like, stop-and-wait GDB stream over the upgraded ESP8266 serial relay."""
import ipaddress
import socket
import time
import zlib

import serial


class BridgeStream:
    def __init__(self, host, serial_port, timeout=5, *, serial_factory=None):
        address = ipaddress.IPv4Address(host)
        if address not in ipaddress.IPv4Network("192.168.77.0/24") or address.packed[-1] not in range(2, 255):
            raise ValueError("Console must be an offline AP client in 192.168.77.2–254")
        if timeout <= 0:
            raise ValueError("Positive socket timeout required")
        self.host, self.serial_port, self.timeout = str(address), serial_port, timeout
        self.factory = serial_factory or serial.Serial
        self.port = None
        self.active = False
        self.pending = bytearray()

    def __enter__(self):
        self.port = self.factory(port=None, baudrate=115200, timeout=.05, write_timeout=5)
        self.port.dtr = False
        self.port.rts = False
        self.port.port = self.serial_port
        try:
            self.port.open()
            self.port.reset_input_buffer()
            if self.command("V") != "READY 2 GDB1":
                raise RuntimeError("Firmware lacks READY 2 GDB1; use firmware with direct GDB support")
            # Own the TCP connection after G is sent, including an ambiguous ACK.
            self.active = True
            if self.command("G " + self.host, limit=8) != "OK":
                raise RuntimeError("GDB connection not acknowledged")
            return self
        except BaseException:
            self.close()
            raise

    def __exit__(self, *_):
        self.close()

    def close(self):
        if self.port is not None and self.port.is_open:
            if self.active:
                try:
                    self.command("X", limit=1)
                except Exception:
                    pass
            self.active = False
            self.port.close()
        self.pending.clear()

    def settimeout(self, timeout):
        if timeout is None or timeout <= 0:
            raise ValueError("Finite positive timeout required")
        self.timeout = timeout

    def command(self, text, limit=2):
        data = (text + "\n").encode("ascii")
        if len(data) > 180 or self.port is None or not self.port.is_open:
            raise ValueError("Serial command outside bounds or closed")
        if self.port.write(data) != len(data):
            raise OSError("Short serial command write; not retried")
        end = time.monotonic() + limit
        line = bytearray()
        while time.monotonic() < end:
            byte = self.port.read(1)
            if not byte:
                continue
            if byte == b"\n":
                value = line.rstrip(b"\r").decode("ascii")
                if value.startswith("ERR "):
                    raise RuntimeError(value + " (bridge command " + text[:1] + ")")
                return value
            line.extend(byte)
            if len(line) >= 180:
                raise ValueError("Oversized serial response")
        raise TimeoutError("Serial command timed out; not retried: " + text[:1])

    def sendall(self, data):
        if not self.active or len(data) > 2 * 1024 * 1024:
            raise OSError("Inactive GDB stream or oversized send")
        for offset in range(0, len(data), 64):
            part = data[offset:offset + 64]
            reply = self.command(f"D {zlib.crc32(part):08x} {part.hex()}")
            if reply != "OK":
                raise RuntimeError("Unexpected GDB write acknowledgement")

    def recv(self, size):
        if not 0 < size <= 2 * 1024 * 1024:
            raise ValueError("Receive size outside bounds")
        end = time.monotonic() + self.timeout
        while not self.pending:
            if not self.active:
                return b""
            if time.monotonic() > end:
                raise socket.timeout("No GDB data within socket timeout")
            reply = self.command("R")
            if reply == "WAIT":
                time.sleep(.002)
                continue
            if reply == "DONE":
                self.active = False
                return b""
            fields = reply.split(" ")
            if len(fields) != 3 or fields[0] != "R" or len(fields[1]) != 8 or not 2 <= len(fields[2]) <= 128 or len(fields[2]) % 2:
                raise ValueError("Malformed GDB receive frame")
            part = bytes.fromhex(fields[2])
            if int(fields[1], 16) != zlib.crc32(part):
                raise ValueError("GDB serial frame CRC mismatch")
            self.pending.extend(part)
        result = bytes(self.pending[:size])
        del self.pending[:size]
        return result
