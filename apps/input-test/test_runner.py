"""Offline only: fragmented framing and last-report preservation."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import shutil
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
spec=importlib.util.spec_from_file_location("switch_input_runner",HERE/"run.py");m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def wire(report):
    body=json.dumps(report,separators=(",",":"),ensure_ascii=True)
    chunks=[body[i:i+1400] for i in range(0,len(body),1400)]
    h=json.dumps({"chars":len(body),"chunks":len(chunks),"fnv1a":m.transport.fnv1a(body.encode())})
    return (m.transport.BEGIN+h+"\n"+"".join(m.transport.CHUNK+str(i)+":"+s+"\n" for i,s in enumerate(chunks))+m.transport.END+str(len(chunks))+"\n").encode()


class Fake:
    def __init__(self,data):self.data=data
    def __enter__(self):return self
    def __exit__(self,*_):pass
    def sendall(self,code):assert len(code)<500*1024
    def shutdown(self,*_):pass
    def settimeout(self,*_):pass
    def recv(self,*_):chunk,self.data=self.data[:19],self.data[19:];return chunk


class Tests(unittest.TestCase):
    def test_capture_and_preserve_previous(self):
        report={"schema":"switch-input-test/1","reason":"user exit","errors":[],"label":"é","observations":{"buttonCycles":16}}
        with tempfile.TemporaryDirectory() as folder:
            folder=Path(folder)
            with patch.object(m.socket,"create_connection",return_value=Fake(wire(report))):self.assertEqual(m.capture("192.0.2.10",60,folder),report)
            before=(folder/"latest-report.json").read_bytes()
            with patch.object(m.socket,"create_connection",return_value=Fake(wire(report)[:-8])):
                with self.assertRaises(ValueError):m.capture("192.0.2.10",60,folder)
            self.assertEqual((folder/"latest-report.json").read_bytes(),before)

    def test_explicit_usb_configuration(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError,"explicit serial"):
                m.capture("192.0.2.10",60,Path(folder),usb=True)
        report={"schema":"switch-input-test/1","reason":"user exit"}
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(m,"UsbConnection",return_value=Fake(wire(report))) as connection:
                self.assertEqual(m.capture("192.0.2.10",60,Path(folder),usb=True,serial="/dev/test-port"),report)
                connection.assert_called_once_with("192.0.2.10",180,"/dev/test-port")

    def test_self_contained_artifact_and_vendor_guard(self):
        payload=m.build_payload()
        self.assertLess(len(payload),500*1024)
        self.assertNotIn(b"GameBoyCore",payload)
        self.assertNotIn(b"createElementNS",payload)
        self.assertIn(b"createCivVerifiedNativeTouch",payload)
        self.assertIn(b"switch-input-test/1",payload)
        self.assertIn(b"createSwitchMotionNative",payload);self.assertIn(b"createCivMotionActivation",payload)
        self.assertNotIn(b"__civMotionDiscoveryLastReport",payload)
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);shutil.copytree(HERE/"vendor",root/"vendor");f=root/"vendor/motion-reader.js";f.write_bytes(f.read_bytes()+b"\nchanged")
            with patch.dict(m.build_payload.__globals__,{"HERE":root}):
                with self.assertRaisesRegex(ValueError,"hash mismatch"):m.build_payload()

    def test_operator_platform_in_config(self):
        payload=m.build_payload({"platform":"switch2","targetHost":"192.0.2.11"})
        self.assertIn(b'"platform":"switch2"',payload);self.assertIn(b'"targetHost":"192.0.2.11"',payload)


if __name__=="__main__":unittest.main()
