"""Build Switch Input Test offline. Does not create a repository or send a payload."""
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent


def build_payload(config=None):
    config={"maxSeconds":600,"preview":False,**(config or {})}
    manifest=json.loads((HERE/"vendor/manifest.json").read_text())
    for name,expected in manifest["files"].items():
        if hashlib.sha256((HERE/"vendor"/name).read_bytes()).hexdigest()!=expected:
            raise ValueError("Vendored input/transport hash mismatch: "+name)
    profiles={"reader":json.loads((HERE/"vendor/motion-reader-profile.json").read_text()),"activation":json.loads((HERE/"vendor/motion-activation-profile.json").read_text())}
    touch_profile=json.loads((HERE/"vendor/touch-profile.json").read_text())
    rumble_profile=json.loads((HERE/"vendor/rumble-profile.json").read_text())
    parts=[(HERE/"vendor/transport.js").read_bytes(),("window.__switchInputTestConfig="+json.dumps(config,separators=(",",":"))+";").encode("ascii"),
           (HERE/"vendor/civswitch-input.js").read_bytes(),("window.__switchTouchProfile="+json.dumps(touch_profile,separators=(",",":"))+";").encode("ascii"),(HERE/"touch-native.js").read_bytes(),("window.__switchMotionProfiles="+json.dumps(profiles,separators=(",",":"))+";").encode("ascii"),
           (HERE/"vendor/motion-reader.js").read_bytes(),(HERE/"vendor/motion-activate.js").read_bytes(),(HERE/"motion-native.js").read_bytes(),(HERE/"motion.js").read_bytes(),("window.__switchRumbleProfile="+json.dumps(rumble_profile,separators=(",",":"))+";").encode("ascii"),(HERE/"vendor/rumble-pulse.js").read_bytes(),(HERE/"rumble-native.js").read_bytes(),(HERE/"rumble.js").read_bytes(),(HERE/"model.js").read_bytes(),(HERE/"solid-mono.js").read_bytes(),(HERE/"solid-text.js").read_bytes(),(HERE/"view.js").read_bytes(),(HERE/"app.js").read_bytes()]
    payload=b"\n".join(parts)
    if len(payload)>=500*1024:raise ValueError("Payload exceeds loader bound")
    return payload


def main():
    output=HERE/"dist";output.mkdir(exist_ok=True)
    payload=build_payload();(output/"switch-input-test.js").write_bytes(payload)
    manifest={"version":"1.1.0","artifact":"switch-input-test.js","bytes":len(payload),"sha256":hashlib.sha256(payload).hexdigest(),"status":"v1.1.0 Switch 2 appearance, labels, Motion rumble and responsiveness accepted; runtime unchanged after acceptance","files":{}}
    for name in ["solid-mono.js","solid-text.js","touch-native.js","model.js","view.js","app.js","motion.js","motion-native.js","rumble-native.js","rumble.js","build.py","run.py","report_transport.py","usb_connection.py","usb_send.py","vendor/manifest.json"]:
        manifest["files"][name]=hashlib.sha256((HERE/name).read_bytes()).hexdigest()
    (output/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
    print(output/"switch-input-test.js",len(payload),"bytes")


if __name__=="__main__":main()
