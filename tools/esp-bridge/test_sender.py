#!/usr/bin/env python3
"""Exercise the host sender over a simulated serial bridge, not a console."""
import os
import pathlib
import pty
import select
import subprocess
import sys
import tempfile
import threading
import time
import zlib

here = pathlib.Path(__file__).resolve().parent
payload = bytes(range(256)) * 10
master, slave = pty.openpty()
device = os.ttyname(slave)
received = bytearray()
commands = []
problems = []

def emulate():
    pending = b""
    try:
        end = time.monotonic() + 20
        while time.monotonic() < end:
            if not select.select([master], [], [], 0.2)[0]:
                continue
            pending += os.read(master, 4096)
            while b"\n" in pending:
                raw, pending = pending.split(b"\n", 1)
                line = raw.decode("ascii").strip()
                commands.append(line.split(" ", 1)[0])
                if line == "P":
                    answer = b"READY 1\n"
                elif line == "C 192.168.77.101":
                    answer = b"OK\n"
                elif line.startswith("D "):
                    _, checksum, datahex = line.split(" ")
                    data = bytes.fromhex(datahex)
                    assert int(checksum, 16) == zlib.crc32(data)
                    received.extend(data)
                    answer = b"OK\n"
                elif line == "F":
                    assert bytes(received) == payload
                    output = b"Hello from remote JS!\n"
                    answer = b"OK\n" + f"R {zlib.crc32(output):08x} {output.hex()}\nDONE\n".encode()
                    os.write(master, answer)
                    return
                else:
                    raise AssertionError(f"unexpected {line!r}")
                os.write(master, answer)
        raise TimeoutError("sender did not finish")
    except Exception as exc:
        problems.append(exc)

with tempfile.TemporaryDirectory() as tmp:
    file = pathlib.Path(tmp) / "payload.js"
    file.write_bytes(payload)
    thread = threading.Thread(target=emulate, daemon=True)
    thread.start()
    result = subprocess.run([sys.executable, str(here / "send_usb.py"), "192.168.77.101", str(file), "--serial", device, "--timeout", "20"], capture_output=True, timeout=25)
    thread.join(timeout=2)
    assert not problems, problems
    assert result.returncode == 0, result.stderr
    assert result.stdout == b"Hello from remote JS!\n", result.stdout
    assert commands[0:2] == ["P", "C"] and commands[-1] == "F"
    assert len(received) == len(payload)
print("PASS: framed serial upload, CRC, EOF command, and output (simulated bridge)")
