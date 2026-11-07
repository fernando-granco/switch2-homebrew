"""Expose one USB-bridged GDB session on localhost; PC internet remains unchanged."""
import argparse
import select
import socket

from bridge_stream import BridgeStream


def relay(client, stream):
    client.settimeout(5)
    stream.settimeout(.01)
    while True:
        readable, _, _ = select.select([client], [], [], .002)
        if readable:
            data = client.recv(64)
            if not data:
                return
            stream.sendall(data)
        try:
            data = stream.recv(64)
        except socket.timeout:
            continue
        if not data:
            return
        client.sendall(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("host")
    parser.add_argument("--serial", required=True)
    parser.add_argument("--listen-port", type=int, default=22225)
    args = parser.parse_args()
    if not 1 <= args.listen_port <= 65535:
        parser.error("Invalid local port")
    # One local client, one serial owner; never listen on a LAN interface.
    with socket.socket() as server:
        server.bind(("127.0.0.1", args.listen_port))
        server.listen(1)
        print(f"Waiting on 127.0.0.1:{args.listen_port}; USB {args.serial} -> {args.host}:22225", flush=True)
        client, _ = server.accept()
        with client, BridgeStream(args.host, args.serial) as stream:
            print("Connected. Detach in GDB before closing. This proxy does not inject debugger commands.", flush=True)
            relay(client, stream)
    print("Session closed; serial relay released.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Stopped; target debugger detach was not verified.")
    except Exception as error:
        raise SystemExit("GDB relay: " + str(error))
