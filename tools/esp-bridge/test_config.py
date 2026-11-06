import unittest
from configure import render_config

class ConfigTests(unittest.TestCase):
    def test_boundaries(self):
        for ssid, password in [("a", ""), ("s"*32, "p"*8), ("é"*16, "p"*63)]:
            self.assertIn("#define BRIDGE_PASSWORD", render_config(ssid, password))
        for ssid, password in [("", ""), ("s"*33, ""), ("é"*17, ""), ("a", "p"*7), ("a", "p"*64), ("a", "é"*8), ("a", "abc\ndefgh")]:
            with self.assertRaises(ValueError): render_config(ssid, password)

    def test_cpp_escaping(self):
        text = render_config('a"\\b', '"\\abc123')
        self.assertIn(r'\141\042\134\142', text)
        self.assertNotIn('"\\abc123', text)

if __name__ == "__main__": unittest.main()
