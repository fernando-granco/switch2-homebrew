#!/usr/bin/env python3
"""Stream a payload using the public CivSwitch bridge's serial wire protocol."""
import argparse
import ipaddress
import math
from pathlib import Path
import sys
import time
import zlib


def transfer(device, host, payload, output, timeout):
    host = str(ipaddress.IPv4Address(host))
    if not 0 < len(payload) < 500 * 1024:
        raise ValueError("Payload must be smaller than 500 KiB")
    deadline = time.monotonic() + timeout
    connected = False

    def line():
        if time.monotonic() >= deadline:
            raise TimeoutError("USB bridge deadline reached")
        data = device.readline(4096)
        if len(data) >= 4096 or data and not data.endswith(b"\n"):
            raise ValueError("Truncated or oversized bridge frame")
        result = data.decode("ascii").strip()
        if result.startswith("ERR "):
            raise RuntimeError(result)
        return result

    def command(data, answer=b"OK"):
        device.write(data + b"\n")
        limit = min(deadline, time.monotonic() + 8)
        while time.monotonic() < limit:
            response = line()
            if response == answer.decode("ascii"):
                return
        raise TimeoutError("USB bridge command was not acknowledged")

    try:
        command(b"P", b"READY 1")
        command(b"C " + host.encode("ascii"))
        connected = True
        for offset in range(0, len(payload), 64):
            chunk = payload[offset:offset + 64]
            command(("D %08x %s" % (zlib.crc32(chunk), chunk.hex())).encode("ascii"))
        command(b"F")
        while True:
            response = line()
            if not response:
                continue
            if response == "DONE":
                connected = False
                return
            if not response.startswith("R "):
                raise ValueError("Unexpected bridge output frame")
            checksum, encoded = response[2:].split(" ", 1)
            decoded = bytes.fromhex(encoded)
            if len(checksum) != 8 or int(checksum, 16) != zlib.crc32(decoded):
                raise ValueError("USB bridge output checksum mismatch")
            output.write(decoded)
            output.flush()
    finally:
        if connected:
            try:
                device.write(b"X\n")
            except OSError:
                pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("host")
    parser.add_argument("payload", type=Path)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--timeout", type=float, default=720)
    args = parser.parse_args()
    if not math.isfinite(args.timeout) or args.timeout <= 0:
        parser.error("timeout must be finite and positive")
    import serial
    device = serial.Serial(port=None, baudrate=115200, timeout=.5, write_timeout=5)
    device.dtr = device.rts = False
    device.port = args.serial
    try:
        device.open()
        device.reset_input_buffer()
        transfer(device, args.host, args.payload.read_bytes(), sys.stdout.buffer, args.timeout)
    finally:
        device.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("USB transport:", error, file=sys.stderr)
        raise SystemExit(1)
