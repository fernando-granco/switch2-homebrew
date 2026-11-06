"""Portable subprocess transport, including Windows COM ports from WSL."""
import os
from pathlib import Path
import queue
import socket
import subprocess
import sys
import tempfile
import threading

HERE = Path(__file__).resolve().parent


class UsbConnection:
    def __init__(self, host, timeout, serial):
        self.host, self.timeout, self.serial = host, timeout, serial
        self.wait = 1
        self.filepath = self.proc = self.errors = self.thread = None
        self.messages = queue.Queue(maxsize=16)
        self.buffer = b""
        self.closed = threading.Event()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.closed.set()
        if self.proc:
            if self.proc.poll() is None:
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
                    self.proc.wait()
            if self.proc.stdout:
                self.proc.stdout.close()
        if self.thread:
            self.thread.join(timeout=1)
        if self.errors:
            self.errors.close()
        if self.filepath:
            self.filepath.unlink(missing_ok=True)

    def sendall(self, code):
        with tempfile.NamedTemporaryFile(dir=HERE, prefix=".usb-input-", suffix=".js", delete=False) as file:
            file.write(code)
            self.filepath = Path(file.name)

    def shutdown(self, how):
        if how != socket.SHUT_WR or not self.filepath:
            raise ValueError("Unexpected sender state")
        script, payload = str(HERE / "usb_send.py"), str(self.filepath)
        interpreter = [sys.executable]
        if sys.platform == "linux" and self.serial.upper().startswith("COM") and "microsoft" in os.uname().release.lower():
            script = subprocess.check_output(["wslpath", "-w", script], text=True).strip()
            payload = subprocess.check_output(["wslpath", "-w", payload], text=True).strip()
            interpreter = ["py.exe", "-3"]
        self.errors = tempfile.TemporaryFile()
        self.proc = subprocess.Popen(interpreter + [script, self.host, payload, "--serial", self.serial, "--timeout", str(self.timeout)], stdout=subprocess.PIPE, stderr=self.errors, bufsize=0)

        def read():
            try:
                while not self.closed.is_set():
                    chunk = os.read(self.proc.stdout.fileno(), 16384)
                    while not self.closed.is_set():
                        try:
                            self.messages.put(chunk, timeout=.25)
                            break
                        except queue.Full:
                            continue
                    if not chunk:
                        return
            except (OSError, ValueError):
                if not self.closed.is_set():
                    self.messages.put(b"")
        self.thread = threading.Thread(target=read, daemon=True)
        self.thread.start()

    def settimeout(self, seconds):
        self.wait = seconds

    def recv(self, size):
        if not self.buffer:
            try:
                self.buffer = self.messages.get(timeout=self.wait)
            except queue.Empty:
                raise socket.timeout() from None
            if not self.buffer:
                status = self.proc.wait(timeout=3)
                if status:
                    self.errors.seek(0)
                    raise OSError(self.errors.read().decode("utf-8", "replace").strip())
                return b""
        result, self.buffer = self.buffer[:size], self.buffer[size:]
        return result
