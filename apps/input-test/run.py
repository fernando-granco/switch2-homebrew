#!/usr/bin/env python3
"""Run Switch Input Test over TCP or the CivSwitch USB bridge."""
import argparse
import datetime
import json
import math
from pathlib import Path
import socket
import sys
import time
from build import build_payload

HERE=Path(__file__).resolve().parent
import report_transport as transport
from usb_connection import UsbConnection
ReportReader=transport.ReportReader


def capture(host,seconds,output,fetch=False,platform=None,usb=False,serial=None,port=9026):
    if usb and not serial:raise ValueError("USB transport requires an explicit serial port")
    code=(HERE/"vendor/transport.js").read_bytes()+b"\n(async function(){if(window.__switchInputTestLastReport)await sendCivInputProReport(window.__switchInputTestLastReport);else await log('No completed input test retained.');})();" if fetch else build_payload({"maxSeconds":seconds,"targetHost":host,"platform":platform})
    output.mkdir(parents=True,exist_ok=True)
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ");base=output/("switch-input-test-"+stamp)
    reader=ReportReader(expected_schema="switch-input-test/1");pending=b"";total=0;timeout=seconds+120;deadline=time.monotonic()+timeout
    print("Fetching retained report..." if fetch else "Sending Switch Input Test. Keep the terminal open; use touch EXIT or hold Plus+Minus for the menu.",flush=True)
    connection=UsbConnection(host,timeout,serial) if usb else socket.create_connection((host,port),timeout=8)
    with base.with_suffix(".raw.log").open("xb") as raw,connection:
        connection.sendall(code);connection.shutdown(socket.SHUT_WR);connection.settimeout(1)
        def feed(line):
            kind=reader.feed(line)
            if kind=="end":print("Report integrity verified.",flush=True)
            elif line.startswith("SWITCH_INPUT_TEST alive"):print(line,flush=True)
            elif line.startswith("INPUT_MOTION "):print(line,flush=True)
        while True:
            if time.monotonic()>=deadline:raise TimeoutError("Capture deadline; partial raw log retained")
            try:data=connection.recv(16384)
            except socket.timeout:continue
            if not data:break
            raw.write(data);raw.flush();total+=len(data)
            if total>8*1024*1024:raise ValueError("Capture exceeded 8 MiB")
            pending+=data
            while b"\n" in pending:
                line,pending=pending.split(b"\n",1);feed(line.decode("utf-8","replace").rstrip("\r"))
            if len(pending)>65536:raise ValueError("Unexpectedly long log line")
        if pending:feed(pending.decode("utf-8","replace").rstrip("\r"))
    if reader.report is None:raise ValueError("Incomplete report; raw log retained")
    text=json.dumps(reader.report,indent=2,ensure_ascii=True)+"\n";base.with_suffix(".json").write_text(text,encoding="utf-8");(output/"latest-report.json").write_text(text,encoding="utf-8")
    print("Session:",reader.report.get("reason"),"| Report:",base.with_suffix(".json"),flush=True)
    return reader.report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("host",help="Console IP displayed by the loader")
    parser.add_argument("--minutes",type=float,default=10,help="1 to 60 minutes; default 10")
    parser.add_argument("--out",type=Path)
    parser.add_argument("--platform",choices=["switch1","switch2"],help="Operator console attribution; also selects a separate report folder")
    parser.add_argument("--usb",action="store_true",help="Use USB bridge instead of direct TCP; pyserial required")
    parser.add_argument("--serial",help="USB serial port; required with --usb")
    parser.add_argument("--port",type=int,default=9026,help="Direct TCP loader port")
    parser.add_argument("--fetch",action="store_true")
    args=parser.parse_args()
    if not math.isfinite(args.minutes) or not 1<=args.minutes<=60:parser.error("minutes must be 1 to 60")
    if not 1<=args.port<=65535:parser.error("port must be 1 to 65535")
    if args.usb and not args.serial:parser.error("--usb requires --serial")
    if args.usb and args.port!=9026:parser.error("USB bridge uses loader port 9026")
    try:capture(args.host,args.minutes*60,args.out or (HERE/"reports"/args.platform if args.platform else HERE/"reports"),args.fetch,args.platform,args.usb,args.serial,args.port)
    except Exception as e:print("Error:",e,"Existing reports/raw logs are retained.",file=sys.stderr);return 1
    return 0


if __name__=="__main__":raise SystemExit(main())
