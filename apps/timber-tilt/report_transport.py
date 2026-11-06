"""Local ASCII report decoder; derived from this workspace's MIT Pro transport."""
import json
BEGIN = "CIV_INPUT_PRO_REPORT_BEGIN:"
CHUNK = "CIV_INPUT_PRO_CHUNK:"
END = "CIV_INPUT_PRO_REPORT_END:"
MAX_REPORT = 4 * 1024 * 1024

def fnv1a(data):
    value = 2166136261
    for byte in data:
        value = ((value ^ byte) * 16777619) & 0xFFFFFFFF
    return f"{value:08x}"


class ReportReader:
    def __init__(self, expected_schema="civswitch-input-pro/1"):
        self.expected_schema = expected_schema
        self.header = None
        self.chunks = []
        self.report = None
        self.received_chars = 0

    def feed(self, line):
        if line.startswith(BEGIN):
            if self.header is not None:
                raise ValueError("Duplicate report header")
            self.header = json.loads(line[len(BEGIN):])
            if not isinstance(self.header, dict):
                raise ValueError("Invalid report header")
            if type(self.header.get("chars")) is not int or not 0 < self.header["chars"] <= MAX_REPORT:
                raise ValueError("Invalid report size")
            if type(self.header.get("chunks")) is not int or self.header["chunks"] != (self.header["chars"] + 1399) // 1400:
                raise ValueError("Invalid report chunk count")
            return "header"
        if line.startswith(CHUNK):
            if self.header is None or self.report is not None:
                raise ValueError("Unexpected report chunk")
            index, body = line[len(CHUNK):].split(":", 1)
            if int(index) != len(self.chunks) or len(self.chunks) >= self.header["chunks"]:
                raise ValueError("Missing, duplicated, or out-of-order report chunk")
            body.encode("ascii")
            if len(body) > 1400:
                raise ValueError("Oversized report chunk")
            self.received_chars += len(body)
            if self.received_chars > self.header["chars"]:
                raise ValueError("Report data exceeds advertised size")
            self.chunks.append(body)
            return "chunk"
        if line.startswith(END):
            if self.report is not None or self.header is None or int(line[len(END):]) != self.header["chunks"] or len(self.chunks) != self.header["chunks"]:
                raise ValueError("Incomplete report")
            encoded = "".join(self.chunks).encode("ascii")
            if len(encoded) != self.header["chars"] or fnv1a(encoded) != self.header.get("fnv1a"):
                raise ValueError("Report length or integrity check failed")
            self.report = json.loads(encoded)
            if not isinstance(self.report, dict) or self.report.get("schema") != self.expected_schema:
                raise ValueError("Unexpected report schema")
            return "end"
        return "log"


