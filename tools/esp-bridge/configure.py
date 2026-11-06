#!/usr/bin/env python3
"""Choose the ESP access point name and password before building."""
import getpass
from pathlib import Path


def render_config(ssid, password):
    if not 1 <= len(ssid.encode("utf-8")) <= 32 or any(ord(c) < 32 for c in ssid):
        raise ValueError("SSID must be 1-32 UTF-8 bytes, without control characters.")
    if password and (not 8 <= len(password) <= 63 or any(not 32 <= ord(c) <= 126 for c in password)):
        raise ValueError("Password must be 8-63 printable ASCII characters, or blank for open Wi-Fi.")
    def literal(value):
        return '"' + ''.join("\\%03o" % b for b in value.encode("utf-8")) + '"'
    return ("// Local Wi-Fi settings. Do not commit this file.\n#pragma once\n"
            + "#define BRIDGE_SSID " + literal(ssid) + "\n"
            + "#define BRIDGE_PASSWORD " + literal(password) + "\n")


def main():
    ssid = input("Wi-Fi name [Switch2-Offline-Open]: ") or "Switch2-Offline-Open"
    password = getpass.getpass("Password (blank for open Wi-Fi): ")
    if password and password != getpass.getpass("Confirm password: "):
        raise ValueError("Passwords do not match. Settings were not changed.")
    text = render_config(ssid, password)
    path = Path(__file__).resolve().parent / "include" / "config.local.h"
    path.write_text(text, encoding="utf-8")
    print("Wi-Fi settings saved. Build and flash the firmware to apply them.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, EOFError, KeyboardInterrupt) as exc:
        raise SystemExit(str(exc) or "Cancelled. Settings were not changed.")
