#!/usr/bin/env bash
set -euo pipefail
if (( $# < 3 )); then
  echo "Usage: bash send_usb_wsl.sh SWITCH_IP PAYLOAD.js COM_PORT [sender options]" >&2
  exit 2
fi
switch_ip=$1
payload=$2
port=$3
shift 3
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if [[ ! -f "$payload" ]]; then echo "Payload does not exist: $payload" >&2; exit 2; fi
windows_script=$(wslpath -w "${project_dir}/send_usb.py")
windows_payload=$(wslpath -w "$(realpath -- "$payload")")
exec py.exe -3 "$windows_script" "$switch_ip" "$windows_payload" --serial "$port" "$@"
