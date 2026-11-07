# ESP serial protocol

115200 baud, newline-terminated ASCII. Data frames carry 1-64 bytes as hex plus
an eight-digit CRC32. Commands and responses fit in 180 bytes including newline.
CRC checks corruption, not authentication or missing whole frames. Commands are
never automatically retransmitted after an ambiguous acknowledgement.

## Direct mode

The existing payload wire format is unchanged. Existing direct debug clients
also retain their `READY 2 GDB1` handshake.

| Command | Reply / meaning |
| --- | --- |
| `P` | `READY 1` (legacy sender check) |
| `V` | `READY 2 GDB1`, or `ERR busy` |
| `C <ip>` | Connect to payload loader 9026; `OK` or `ERR ...` |
| `G <ip>` | Connect to debugger 22225; `OK` or `ERR ...` |
| `D <crc> <hex>` | Write a validated frame; `OK` or `ERR ...` |
| `F` | Half-close payload TCP writes, retain replies; `OK` |
| `R` | Poll direct GDB: `R <crc> <hex>`, `WAIT` or `DONE` |
| `X` | Close direct transport; `OK` |

Payload replies arrive automatically after `F`, then `DONE` after buffered data
drains and the peer ends. GDB replies are explicitly polled and never unsolicited.
`F` is rejected in GDB mode. The firmware accepts only AP clients
192.168.77.2-254 and the two fixed destination ports.

## Multiplex mode

`Q` returns `READY 3 MUX2` when all sessions are idle, or `ERR busy`.
`M <channel> <command>` applies the direct commands above to an independent
session. Channel **0** only opens `C`; channel **1** only opens `G`.
All responses are immediate, single-line and belong to the request just sent;
the host serial owner must serialize commands. Channel IDs are therefore not
repeated in replies. Both channels use explicit `R` polling; no automatic output.
Payload polling is allowed only after `F`.

Example, abbreviated:

```text
Q                         -> READY 3 MUX2
M 0 C 192.168.77.100       -> OK
M 1 G 192.168.77.100       -> OK
M 0 D <crc> <payload-hex>  -> OK
M 1 D <crc> <gdb-hex>      -> OK
M 1 R                     -> R <crc> <hex> / WAIT / DONE
M 0 F                     -> OK
M 0 R                     -> R <crc> <hex> / WAIT / DONE
M 1 X                     -> OK
```

Direct and multiplex sessions cannot be active together. Closing/ending one
multiplex channel does not close the other. Only the payload channel uses `F`.
There is no arbitrary port forwarding, NAT or internet uplink.

## PC service and recovery

The optional service owns serial and listens on IPv4 **127.0.0.1 only**, with
one client per channel. It alternates channels, sending at most one 64-byte
write and polling at most one 64-byte read per channel per round. Each local
output queue is capped at 16 KiB; polling pauses for a slow reader, leaving
TCP flow control to the ESP stack. Kernel/network buffers are additional.
TCP connection establishment and serial commands are synchronous, so a slow
connect/write or serial failure can temporarily delay both channels.

Explicit bridge errors close the affected channel; malformed/CRC-corrupt replies
or ambiguous serial timeouts stop the service rather than risk mixing data or
duplicating writes. Relay failures reset the local socket so they do not look
like successful payload EOF. On exit it attempts to close owned remote sessions.
Local busy clients are rejected. Other localhost processes are trusted; the
service does not implement client authentication.

If a host was killed, `Z` closes **all** relay sessions and returns `OK`.
`bridge_service.py --reset` issues it before checking `Q`. Use this deliberately:
it interrupts transport sessions. It does not issue GDB detach, resume a stopped
game, cancel already executing JavaScript, or reset Wi-Fi. No firmware flash or
console configuration is performed by the PC service.
