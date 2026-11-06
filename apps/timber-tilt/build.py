"""Build the Timber Tilt payload offline. Does not send anything to a console."""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
VERSION = "0.2.2"
SOURCES = ["levels.js", "physics.js", "tilt.js", "font.js", "render.js", "haptics.js", "game.js"]


def build_payload(config=None):
    config = {"maxSeconds": 1800, "preview": False, **(config or {})}
    manifest = json.loads((HERE / "vendor/manifest.json").read_text())
    for name, expected in manifest["files"].items():
        if hashlib.sha256((HERE / "vendor" / name).read_bytes()).hexdigest() != expected:
            raise ValueError("Vendored library hash mismatch: " + name)
    profiles = {"reader": json.loads((HERE / "vendor/motion-reader-profile.json").read_text()),
                "activation": json.loads((HERE / "vendor/motion-activation-profile.json").read_text())}
    v = HERE / "vendor"
    parts = [(v / "transport.js").read_bytes(),
             ("window.__timberTiltConfig=" + json.dumps(config, separators=(",", ":")) + ";").encode("ascii"),
             (v / "civswitch-input.js").read_bytes(),
             ("window.__switchTouchProfile=" + json.dumps(json.loads((v / "touch-profile.json").read_text()), separators=(",", ":")) + ";").encode("ascii"),
             (v / "touch-native.js").read_bytes(),
             ("window.__switchMotionProfiles=" + json.dumps(profiles, separators=(",", ":")) + ";").encode("ascii"),
             (v / "motion-reader.js").read_bytes(), (v / "motion-activate.js").read_bytes(),
             (v / "switch-motion-native.js").read_bytes(), (v / "switch-motion.js").read_bytes(),
             ("window.__switchRumbleProfile=" + json.dumps(json.loads((v / "rumble-profile.json").read_text()), separators=(",", ":")) + ";").encode("ascii"),
             (v / "rumble-pulse.js").read_bytes(), (v / "switch-rumble-native.js").read_bytes()]
    parts += [(HERE / name).read_bytes() for name in SOURCES]
    payload = b"\n".join(parts)
    if any(b > 126 or (b < 32 and b not in (9, 10, 13)) for b in payload):
        raise ValueError("Payload must stay ASCII")
    if len(payload) >= 500 * 1024:
        raise ValueError("Payload exceeds the 500 KiB loader bound")
    return payload


def main():
    out = HERE / "dist"
    out.mkdir(exist_ok=True)
    payload = build_payload()
    (out / "timber-tilt.js").write_bytes(payload)
    manifest = {"version": VERSION, "artifact": "timber-tilt.js", "bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "status": "Switch 2 handheld tested (motion tilt, touch, rumble); see README for scope", "files": {}}
    for name in SOURCES + ["build.py", "run.py", "report_transport.py", "usb_connection.py", "usb_send.py", "vendor/manifest.json"]:
        manifest["files"][name] = hashlib.sha256((HERE / name).read_bytes()).hexdigest()
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(out / "timber-tilt.js", len(payload), "bytes", manifest["sha256"])


if __name__ == "__main__":
    main()
