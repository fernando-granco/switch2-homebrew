# Combined bridge validation

This update combines the configurable Wi-Fi AP, the legacy payload route,
the previously exercised direct GDB route and a new optional multiplex route.
The installed board was not flashed during development of this update.

## Existing hardware evidence

- ESP8266 payload/AP workflow: Switch 1 21.2.0 and Switch 2 20.1.5;
  open/password networks and both consoles associated.
- Earlier ESP8266 debug build: Switch 1 serial capability check, connections to
  both 9026 and 22225, and a read-only GDB process-list exchange.
- These observations concern earlier builds. They do not establish hardware
  acceptance of this combined source, simultaneous traffic, or ESP32 operation.

## Offline checks

```bash
python3 -m unittest test_config.py test_service.py
python3 test_sender.py
pio run -e esp8266 -e esp32 -e esp32c3 -e esp32s3
```

The tests compile the actual `include/bridge_protocol.h` with independent mock
TCP sockets. They check command guards, addresses, port/channel restrictions,
CRC rejection, session ownership, half-close, buffered EOF, write failure,
channel isolation, explicit reset and recovery after an oversized serial line.

Unix PTYs exercise real pyserial against that compiled parser, including the
unchanged payload sender and direct `BridgeStream`. Real localhost sockets
exercise the PC service, uploading binary data while a debugger channel echoes,
then uploading again on the same service without reconnecting GDB. These are
simulations, not performance measurements or physical console tests.

The configuration and service suite passed 11 tests, plus the original sender
simulation. All four board environments compiled, and a separate ESP8266
password-protected build passed. Windows CLI import/help checks and WSL script
syntax checks passed. ESP32-family radio/USB operation remains untested.

## Hardware acceptance still needed

When the operator chooses to flash, verify the configured SSID/password and
normal console association first. Then check direct payload sending and direct
GDB access separately. Finally use the optional service with GDB connected:
send a payload, confirm its complete output, query GDB during transfer and
send another payload without reconnecting GDB. Test normal detach/close,
disconnect/reconnect and deliberate transport reset. Record console model,
firmware, board and build identity for each result. Switch 2 debugger support
is not implied by Switch 1 testing.
