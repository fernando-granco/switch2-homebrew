"""Create a reproducible, explicitly selected public source/payload archive."""
import hashlib
import json
from pathlib import Path
import re
import zipfile

HERE = Path(__file__).resolve().parent
FILES = [
    "README.md", "VALIDATION.md", "LICENSE", "NOTICE.md", "CHANGELOG.md", "RELEASE-CHECKLIST.md",
    ".gitignore", "requirements.txt",
    "package.json", "package-lock.json", "build.py", "package_release.py",
    "run.py", "report_transport.py", "usb_connection.py", "usb_send.py",
    "solid-mono.js", "solid-text.js", "tools/generate_solid_mono.py", "app.js", "model.js", "view.js", "touch-native.js", "motion.js",
    "motion-native.js", "rumble.js", "rumble-native.js", "preview.html", "preview.js",
    "test_view.cjs", "test_model.cjs", "test_app.cjs", "test_motion.cjs", "test_rumble.cjs",
    "test_browser.cjs", "test_runner.py", "test_usb.py",
    "licenses/CivSwitch-MIT.txt", "licenses/Solid-Mono.txt", "vendor/manifest.json", "vendor/civswitch-input.js",
    "vendor/transport.js", "vendor/touch-profile.json", "vendor/motion-reader.js",
    "vendor/motion-activate.js", "vendor/motion-reader-profile.json",
    "vendor/motion-activation-profile.json", "vendor/rumble-pulse.js", "vendor/rumble-profile.json",
    "dist/switch-input-test.js", "dist/manifest.json", "screenshots/controls.png",
    "screenshots/ten-touch.png", "screenshots/motion.png", "screenshots/rumble.png",
]


def package():
    manifest = json.loads((HERE / "dist/manifest.json").read_text())
    version = manifest["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Unexpected version")
    payload = (HERE / "dist/switch-input-test.js").read_bytes()
    if len(payload) != manifest["bytes"] or hashlib.sha256(payload).hexdigest() != manifest["sha256"]:
        raise ValueError("Artifact differs from build manifest")
    for name, expected in manifest["files"].items():
        if hashlib.sha256((HERE / name).read_bytes()).hexdigest() != expected:
            raise ValueError("Source changed since build: " + name)
    vendor = json.loads((HERE / "vendor/manifest.json").read_text())
    for name, expected in vendor["files"].items():
        if hashlib.sha256((HERE / "vendor" / name).read_bytes()).hexdigest() != expected:
            raise ValueError("Vendor differs from manifest: " + name)
    entries = {}
    for name in sorted(FILES):
        path = HERE / name
        data = path.read_bytes()
        if path.suffix in {".js", ".json", ".cjs", ".py", ".md", ".html", ".yml"}:
            text = data.decode("utf-8")
            if re.search(r'["\'][0-9a-fA-F]{80,}["\']', text):
                raise ValueError("Long embedded hex reference requires review: " + name)
            if re.search(r"(?:[A-Za-z]:[\\/]|/mnt/[a-z]/)(?:GAMES|Users)[\\/]", text):
                raise ValueError("Private workspace path in public file: " + name)
        entries[name] = data
    sums = "".join(hashlib.sha256(data).hexdigest() + "  " + name + "\n" for name, data in entries.items())
    entries["SHA256SUMS"] = sums.encode("ascii")
    output = HERE / "release"
    output.mkdir(exist_ok=True)
    archive = output / ("switch-input-test-" + version + ".zip")
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for name, data in sorted(entries.items()):
            item = zipfile.ZipInfo("switch-input-test-" + version + "/" + name, date_time=(2026, 11, 5, 0, 0, 0))
            item.create_system = 3
            item.compress_type = zipfile.ZIP_DEFLATED
            item.external_attr = 0o100644 << 16
            bundle.writestr(item, data)
    with zipfile.ZipFile(archive) as bundle:
        if bundle.testzip() is not None or len(bundle.namelist()) != len(entries):
            raise ValueError("Archive verification failed")
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix(".zip.sha256").write_text(digest + "  " + archive.name + "\n", encoding="ascii")
    print(archive, len(entries), "files, SHA256", digest)
    return archive


if __name__ == "__main__":
    package()
