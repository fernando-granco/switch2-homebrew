#!/usr/bin/env python3
"""Send a payload through the optional bridge service on localhost."""
import argparse
from pathlib import Path
import socket
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("payload", type=Path)
    parser.add_argument("--port", type=int, default=9026)
    parser.add_argument("--timeout", type=float, default=330)
    args = parser.parse_args()
    data = args.payload.read_bytes()
    if not 0 < len(data) <= 500 * 1024 or not 1 <= args.port <= 65535 or not args.timeout > 0:
        parser.error("Use a 1-500 KiB payload, valid local port and positive timeout")
    deadline = time.monotonic() + args.timeout
    with socket.create_connection(("127.0.0.1", args.port), timeout=args.timeout) as sock:
        sock.sendall(data)
        sock.shutdown(socket.SHUT_WR)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Overall payload deadline reached")
            sock.settimeout(remaining)
            reply = sock.recv(4096)
            if not reply:
                break
            sys.stdout.buffer.write(reply)
            sys.stdout.buffer.flush()


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as exc:
        raise SystemExit("Local payload sender: " + str(exc))
