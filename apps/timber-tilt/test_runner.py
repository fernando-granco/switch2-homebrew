"""Offline only: fragmented report framing, last-report preservation and payload guards."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location("timber_runner", HERE / "run.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def wire(report):
    body = json.dumps(report, separators=(",", ":"), ensure_ascii=True)
    chunks = [body[i:i + 1400] for i in range(0, len(body), 1400)]
    h = json.dumps({"chars": len(body), "chunks": len(chunks), "fnv1a": m.transport.fnv1a(body.encode())})
    return (m.transport.BEGIN + h + "\n" + "".join(m.transport.CHUNK + str(i) + ":" + s + "\n" for i, s in enumerate(chunks)) + m.transport.END + str(len(chunks)) + "\n").encode()


class Fake:
    def __init__(self, data): self.data = data
    def __enter__(self): return self
    def __exit__(self, *_): pass
    def sendall(self, code): assert len(code) < 500 * 1024
    def shutdown(self, *_): pass
    def settimeout(self, *_): pass
    def recv(self, *_):
        chunk, self.data = self.data[:23], self.data[23:]
        return chunk


class Tests(unittest.TestCase):
    def test_capture_and_preserve_previous(self):
        report = {"schema": "timber-tilt/1", "reason": "menu exit", "errors": [], "boardsCleared": 2, "pad": "x" * 5000}
        log = b"TIMBER_TILT alive view=play\n" + wire(report)
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            with patch.object(m.socket, "create_connection", return_value=Fake(log)):
                self.assertEqual(m.capture("192.0.2.10", 60, folder), report)
            before = (folder / "latest-report.json").read_bytes()
            with patch.object(m.socket, "create_connection", return_value=Fake(wire(report)[:-9])):
                with self.assertRaises(ValueError):
                    m.capture("192.0.2.10", 60, folder)
            self.assertEqual((folder / "latest-report.json").read_bytes(), before)

    def test_wrong_schema_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(m.socket, "create_connection", return_value=Fake(wire({"schema": "switch-input-test/1"}))):
                with self.assertRaises(ValueError):
                    m.capture("192.0.2.10", 60, Path(folder))

    def test_usb_requires_serial(self):
        with self.assertRaises(ValueError):
            m.capture("192.0.2.10", 60, Path(tempfile.gettempdir()), usb=True)

    def test_payload_contents_and_vendor_guard(self):
        payload = m.build_payload({"platform": "switch2"})
        self.assertLess(len(payload), 500 * 1024)
        for needle in [b"createCivVerifiedNativeTouch", b"__switchTouchProfile", b"createSwitchMotionNative", b"createCivMotionActivation", b"timber-tilt/1", b"TIMBER_LEVELS", b'"platform":"switch2"',
                       b"createCivRumblePulse", b"createSwitchRumbleNative", b"__switchRumbleProfile", b"createTimberHaptics", b"createTimberFont"]:
            self.assertIn(needle, payload)
        for banned in [b"drawImage", b"getImageData", b"putImageData", b"createElementNS", b"Gradient", b"__timberPreview", b"fillText", b"strokeText", b"192.168."]:
            self.assertNotIn(banned, payload)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            shutil.copytree(HERE / "vendor", root / "vendor")
            f = root / "vendor/switch-motion.js"
            f.write_bytes(f.read_bytes() + b"\n//changed")
            with patch.dict(m.build_payload.__globals__, {"HERE": root}):
                with self.assertRaisesRegex(ValueError, "hash mismatch"):
                    m.build_payload()


if __name__ == "__main__":
    unittest.main()
