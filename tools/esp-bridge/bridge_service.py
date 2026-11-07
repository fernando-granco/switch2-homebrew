#!/usr/bin/env python3
"""Optional localhost payload/GDB relay over one ESP serial connection."""
import argparse
import contextlib
import select
import socket
import struct
import sys
import zlib

from bridge_stream import BridgeStream

BUFFER_LIMIT = 16 * 1024
PAYLOAD_LIMIT = 500 * 1024


def reset_socket(sock):
    # Signal failure to raw TCP clients; a graceful FIN would look like success.
    with contextlib.suppress(OSError):
        layout = "HH" if sys.platform == "win32" else "ii"
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack(layout, 1, 0))
    sock.close()


class MuxSerial:
    def __init__(self, host, port, reset=False):
        self.wire = BridgeStream(host, port)
        self.reset = reset

    def __enter__(self):
        wire = self.wire
        wire.port = wire.factory(port=None, baudrate=115200, timeout=.05, write_timeout=5)
        wire.port.dtr = wire.port.rts = False
        wire.port.port = wire.serial_port
        try:
            wire.port.open()
            wire.port.reset_input_buffer()
            if self.reset and wire.command("Z") != "OK":
                raise ValueError("Transport reset not acknowledged")
            if wire.command("Q") != "READY 3 MUX2":
                raise ValueError("This firmware does not support multiplexing")
            return self
        except BaseException:
            wire.close()
            raise

    def __exit__(self, *_):
        self.wire.close()

    def command(self, channel, text):
        return self.wire.command(f"M {channel} {text}", limit=8 if text[:1] in "CG" else 2)

    def expect_ok(self, channel, text):
        if self.command(channel, text) != "OK":
            raise ValueError("Unexpected serial acknowledgement")

    def read(self, channel):
        reply = self.command(channel, "R")
        if reply == "WAIT":
            return None
        if reply == "DONE":
            return b""
        parts = reply.split(" ")
        if len(parts) != 3 or parts[0] != "R" or len(parts[1]) != 8 or not 2 <= len(parts[2]) <= 128 or len(parts[2]) % 2:
            raise ValueError("Malformed multiplexed receive frame")
        data = bytes.fromhex(parts[2])
        if zlib.crc32(data) != int(parts[1], 16):
            raise ValueError("Multiplexed receive CRC mismatch")
        return data


class Client:
    def __init__(self, sock):
        self.sock = sock
        self.eof = self.remote_eof = False
        self.output = bytearray()
        self.sent = 0


def serve(link, host, payload_port=9026, gdb_port=22225, *, stop=None, ready=None):
    """One bounded frame per channel/round; never retry ambiguous commands."""
    clients = [None, None]

    def drop(channel, notify=True, failed=False):
        client = clients[channel]
        clients[channel] = None
        if client:
            if failed:
                reset_socket(client.sock)
            else:
                client.sock.close()
            if notify and not client.remote_eof:
                link.expect_ok(channel, "X")

    with contextlib.ExitStack() as stack:
        servers = []
        for port in (payload_port, gdb_port):
            server = stack.enter_context(socket.socket())
            if sys.platform == "win32":
                server.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            else:
                server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            server.bind(("127.0.0.1", port))
            server.listen(1)
            servers.append(server)
        if ready:
            ready([s.getsockname()[1] for s in servers])
        print(f"Payload: 127.0.0.1:{servers[0].getsockname()[1]} | GDB: 127.0.0.1:{servers[1].getsockname()[1]}", flush=True)
        first = 0
        try:
            while stop is None or not stop.is_set():
                readers = servers + [c.sock for c in clients if c and not c.eof and not c.remote_eof]
                writers = [c.sock for c in clients if c and c.output]
                readable, writable, _ = select.select(readers, writers, [], .003)
                for channel in (first, 1-first):
                    if servers[channel] in readable:
                        sock, _ = servers[channel].accept()
                        if clients[channel]:
                            reset_socket(sock)
                        else:
                            sock.setblocking(False)
                            clients[channel] = Client(sock)
                            try:
                                link.expect_ok(channel, ("C " if channel == 0 else "G ") + host)
                            except RuntimeError as exc:
                                print(f"Channel {channel}: {exc}", file=sys.stderr)
                                drop(channel, failed=True)
                    client = clients[channel]
                    if not client:
                        continue
                    try:
                        if client.sock in readable:
                            data = client.sock.recv(64)
                            if data:
                                client.sent += len(data)
                                if channel == 0 and client.sent > PAYLOAD_LIMIT:
                                    print("Payload exceeds 500 KiB; closing channel", file=sys.stderr)
                                    drop(channel, failed=True)
                                    continue
                                link.expect_ok(channel, f"D {zlib.crc32(data):08x} {data.hex()}")
                            elif channel == 0:
                                link.expect_ok(channel, "F")
                                client.eof = True
                            else:
                                drop(channel)
                                continue
                        if client.sock in writable and client.output:
                            n = client.sock.send(client.output)
                            del client.output[:n]
                        if not client.remote_eof and (channel == 1 or client.eof) and len(client.output) <= BUFFER_LIMIT - 64:
                            data = link.read(channel)
                            if data == b"":
                                client.remote_eof = True
                            elif data:
                                client.output.extend(data)
                        if client.remote_eof and not client.output:
                            drop(channel, notify=False)
                    except BlockingIOError:
                        pass
                    except (ConnectionError, RuntimeError) as exc:
                        print(f"Channel {channel}: {exc}", file=sys.stderr)
                        drop(channel, failed=True)
                first = 1-first
        finally:
            for channel in (0, 1):
                with contextlib.suppress(Exception):
                    drop(channel, failed=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("host", help="Console IP on the ESP network")
    parser.add_argument("--serial", required=True)
    parser.add_argument("--payload-port", type=int, default=9026)
    parser.add_argument("--gdb-port", type=int, default=22225)
    parser.add_argument("--reset", action="store_true", help="Close stale ESP transport sessions before starting")
    args = parser.parse_args()
    if any(not 1 <= p <= 65535 for p in (args.payload_port, args.gdb_port)) or args.payload_port == args.gdb_port:
        parser.error("Choose two distinct local ports between 1 and 65535")
    with MuxSerial(args.host, args.serial, reset=args.reset) as link:
        serve(link, link.wire.host, args.payload_port, args.gdb_port)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Stopped. Debugger detach and payload cancellation are not implied.")
    except Exception as exc:
        raise SystemExit("Bridge service: " + str(exc))
