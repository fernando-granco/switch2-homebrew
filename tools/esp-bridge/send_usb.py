#!/usr/bin/env python3
"""Send one CivSwitch JavaScript payload through the ESP8266 USB bridge."""
import argparse
import ipaddress
import pathlib
import sys
import time
import zlib
import serial

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("console_ip")
    parser.add_argument("payload", type=pathlib.Path)
    parser.add_argument("--serial", required=True, help="USB serial port, e.g. COM7 or /dev/ttyUSB0")
    parser.add_argument("--timeout", type=float, default=330)
    args = parser.parse_args()
    addr = ipaddress.IPv4Address(args.console_ip)
    if addr not in ipaddress.IPv4Network("192.168.77.0/24") or int(str(addr).split('.')[-1]) in (0, 1, 255):
        parser.error("console address must be a client address on 192.168.77.0/24")
    payload = args.payload.read_bytes()
    if not 0 < len(payload) <= 500 * 1024:
        parser.error("payload must be between 1 and 512000 bytes")
    if args.timeout <= 0:
        parser.error("timeout must be positive")
    deadline = time.monotonic() + args.timeout
    port = serial.Serial(port=None, baudrate=115200, timeout=0.5, write_timeout=5)
    port.dtr = False
    port.rts = False
    port.port = args.serial
    opened = False
    try:
        port.open()
        port.reset_input_buffer()
        def command(value, expected="OK", limit=8):
            port.write((value + "\n").encode("ascii"))
            end = min(deadline, time.monotonic() + limit)
            while time.monotonic() < end:
                line = port.readline().decode("ascii", "replace").strip()
                if line == expected:
                    return
                if line.startswith("ERR "):
                    raise RuntimeError(line)
            raise TimeoutError(f"Bridge did not respond to {value[:1]}; check firmware and serial port")
        command("P", "READY 1")
        command("C " + str(addr))
        opened = True
        for offset in range(0, len(payload), 64):
            part = payload[offset:offset + 64]
            command(f"D {zlib.crc32(part):08x} {part.hex()}")
        command("F")
        while time.monotonic() < deadline:
            line = port.readline().decode("ascii", "replace").strip()
            if line == "DONE":
                opened = False
                return
            if line.startswith("R "):
                try:
                    checksum, encoded = line[2:].split(" ", 1)
                    if len(checksum) != 8:
                        raise ValueError("invalid checksum")
                    data = bytes.fromhex(encoded)
                    if int(checksum, 16) != zlib.crc32(data):
                        raise ValueError("checksum mismatch")
                except ValueError as exc:
                    raise RuntimeError("Malformed or corrupted data from USB bridge") from exc
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
            elif line.startswith("ERR "):
                raise RuntimeError(line)
            elif line:
                raise RuntimeError(f"Unexpected bridge response: {line!r}")
        raise TimeoutError("Overall timeout while waiting for loader output")
    finally:
        if port.is_open:
            if opened:
                try:
                    port.write(b"X\n")
                except serial.SerialException:
                    pass
            port.close()

if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, TimeoutError, serial.SerialException) as exc:
        print(f"USB bridge: {exc}", file=sys.stderr)
        sys.exit(1)
