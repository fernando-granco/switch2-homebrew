# CivSwitch USB-to-Wi-Fi Bridge

This program creates an offline access point to send [CivSwitch](https://github.com/Gezine/CivSwitch) payloads via your PC USB through the ESP Wifi AP.

```text
PC -- USB --> ESP -- Wi-Fi --> Switch
```

The ESP creates the offline access point. Your PC stays on its regular network, and the Switch gets no internet through the ESP. A working CivSwitch loader is required.

## Compatibility

- **ESP8266EX / CP2102, 4 MB:** tested and working with Switch 1 FW 21.2.0 and Switch 2 FW 20.1.5
- **ESP32 and ESP32-S3:** not tested yet.

Open and password-protected Wi-Fi have both been tested. Both consoles can stay connected at the same time. Send payloads to either one by changing the target IP, one transfer at a time.


The combined payload/GDB firmware is currently an offline-tested update. Its new simultaneous mode still needs a hardware test.

## Setup

Build the firmware for your board and flash it using the commands below.

Install Python 3 and [PlatformIO](https://docs.platformio.org/en/latest/core/installation/index.html), then:

```bash
git clone https://github.com/fernando-granco/switch2-homebrew.git
cd switch2-homebrew/tools/esp-bridge
python3 -m pip install -r requirements.txt
python3 configure.py
```

Choose the Wi-Fi name and password when prompted. Passwords must be 8-63 characters; leave it blank for an open network. Settings are saved in `include/config.local.h`. They are also embedded in the firmware you build, so don't share that binary with a private password.

Build and flash: (esp8266 sample:)

```bash
pio run -e esp8266
pio run -e esp8266 -t upload --upload-port /dev/ttyUSB0
```

Use your board's serial port (`COM7`, for example, on Windows). The other build targets are `esp32`, `esp32c3` and `esp32s3`. To change the Wi-Fi settings later, run `configure.py` again and reflash.

## Send a payload

Connect the Switch to your ESP's Wi-Fi and open the CivSwitch loader. Use the IP shown on the console:

```bash
python3 send_usb.py 192.168.77.100 hello.js --serial /dev/ttyUSB0
```

Windows:

```powershell
py -3 send_usb.py 192.168.77.100 hello.js --serial COM7
```

Ubuntu/WSL with a Windows COM port (install pyserial in Windows Python first):

```bash
bash send_usb_wsl.sh 192.168.77.100 hello.js COM7
```

Replace `hello.js` with your payload. Close any serial monitor first. For longer runs, add `--timeout 600`.

## Debug without the bridge service

Existing serial payload senders still work directly. The debug firmware also supports a direct serial GDB stream, so the optional service below is not required for either workflow individually. Only one program can own the USB port at a time.

For a regular GDB client, start the single-session proxy:

```bash
python3 gdb_proxy.py 192.168.77.100 --serial /dev/ttyUSB0
```

Then connect GDB with `target extended-remote 127.0.0.1:22225`. The console must already expose a debugger on TCP 22225 (tested previously with Atmosphere on Switch 1). The ESP does not enable it. Close the proxy before using the direct payload sender. Existing tools using `BridgeStream` can also use serial directly.

## Optional: payloads and debugging together

Run the service instead of the direct sender/proxy:

```bash
python3 bridge_service.py 192.168.77.100 --serial /dev/ttyUSB0
```

It opens two localhost ports. GDB connects to `127.0.0.1:22225`; send payloads through the other port:

```bash
python3 send_local.py hello.js
```

Both channels stay independent, so GDB can stay connected across payload runs. The service handles one payload connection and one debugger connection, targeting the same console. Existing TCP payload senders can use `127.0.0.1:9026` if they send EOF after upload. Do not run a direct serial sender/monitor while the service owns USB.

On Windows use `py -3` and your COM port. From WSL, run the service with Windows Python to access COM7:

```bash
py.exe -3 "$(wslpath -w "$PWD/bridge_service.py")" 192.168.77.100 --serial COM7
```

Run local clients in the same OS as the service. For example, in another Ubuntu terminal in this folder:

```bash
py.exe -3 "$(wslpath -w "$PWD/send_local.py")" "$(wslpath -w "$PWD/hello.js")"
```

Traffic shares the same 115200-baud USB link; alternating bounded frames prevents one active channel from taking every turn. Opening a console TCP connection can briefly hold up the other channel. This is a workflow improvement, not a measured speed increase. Pausing the game in GDB pauses its payload too.

Detach in GDB before stopping a debug session. Closing a connection does not guarantee debugger detach or cancel a running payload. If a service was killed and left transport sessions busy, restart with `--reset` to close them explicitly. [Protocol and recovery details](PROTOCOL.md).

## Notes

- Default Wi-Fi: `Switch2-Offline-Open`, no password. Network: `192.168.77.0/24`.
- Local DNS and HTTP responses let the console's connection check pass without internet. Other saved Wi-Fi networks can still provide internet access.
- Payloads are JavaScript, up to 500 KiB. One payload transfer at a time, optionally alongside GDB.
- Developer checks: `python3 -m unittest test_config.py test_service.py` and `python3 test_sender.py`. Serial/parser integration tests require Linux/macOS with `g++`. See [validation](VALIDATION.md).

## AI Disclaimer

This project was developed with assistance from AI.

## Credits

Connection-check responses adapted from [90DNS](https://gitlab.com/a/90dns). Licensed under [GPL-2.0-or-later](LICENSE).

`hello.js` comes from CivSwitch, copyright 2026 Gezine, under the [MIT license](licenses/CivSwitch-MIT.txt).
