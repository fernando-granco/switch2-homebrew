"""Offline protocol and portable reader tests; no serial hardware is opened."""
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zlib
from unittest.mock import patch
from usb_send import transfer
from usb_connection import UsbConnection


class Device:
    def __init__(self, corrupt=False):
        self.frames=[]
        self.responses=[]
        self.payload=bytearray()
        self.corrupt=corrupt

    def write(self, frame):
        self.frames.append(frame)
        if frame==b"P\n":self.responses.append(b"READY 1\n")
        elif frame.startswith(b"C "):self.responses.append(b"OK\n")
        elif frame.startswith(b"D "):
            _,crc,encoded=frame.split();data=bytes.fromhex(encoded.decode())
            assert int(crc,16)==zlib.crc32(data)
            self.payload.extend(data);self.responses.append(b"OK\n")
        elif frame==b"F\n":
            data=b"result\n"
            crc=0 if self.corrupt else zlib.crc32(data)
            self.responses.extend([b"OK\n",("R %08x %s\n"%(crc,data.hex())).encode(),b"DONE\n"])

    def readline(self, *_):
        return self.responses.pop(0) if self.responses else b""


class Tests(unittest.TestCase):
    def test_usb_crc_and_cleanup(self):
        d=Device();out=io.BytesIO();data=b"test"*200
        transfer(d,"192.0.2.10",data,out,10)
        self.assertEqual(d.payload,data);self.assertEqual(out.getvalue(),b"result\n");self.assertNotIn(b"X\n",d.frames)
        d=Device(corrupt=True)
        with self.assertRaisesRegex(ValueError,"checksum"):
            transfer(d,"192.0.2.10",data,io.BytesIO(),10)
        self.assertEqual(d.frames[-1],b"X\n")

    def test_subprocess_reader_binary_fragments_and_failure(self):
        real_popen=subprocess.Popen
        for status in [0,3]:
            with tempfile.TemporaryDirectory() as folder:
                helper=Path(folder)/"fake.py"
                helper.write_text("import sys\nsys.stdout.buffer.write(b'abc\\x00def')\nsys.stdout.buffer.flush()\nsys.stderr.write('simulated sender error')\nsys.exit("+str(status)+")\n")
                with patch("usb_connection.subprocess.Popen",side_effect=lambda *a,**k:real_popen([sys.executable,str(helper)],**k)):
                    with UsbConnection("192.0.2.10",10,"/dev/fake") as conn:
                        conn.sendall(b"payload");owned=conn.filepath;conn.shutdown(1);conn.settimeout(2)
                        data=b""
                        try:
                            while True:
                                part=conn.recv(2)
                                if not part:break
                                data+=part
                            self.assertEqual(status,0)
                        except OSError as error:
                            self.assertEqual(status,3);self.assertIn("simulated sender error",str(error))
                        self.assertEqual(data,b"abc\x00def")
                    self.assertFalse(owned.exists())


if __name__=="__main__":unittest.main()
