// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once

// Legacy senders own one session. The optional broker owns two explicitly
// polled sessions: channel 0 (payload), channel 1 (GDB). Never mix owners.
struct BridgeSession {
  BridgeClient client;
  bool active = false, sending = false, interactive = false;
  void close() {
    if (active) client.abort();
    active = sending = interactive = false;
  }
};
BridgeSession legacy, channels[2];
char serialLine[180];
size_t serialLength = 0;
bool serialOverflow = false;

uint32_t bridgeCrc(const uint8_t *p, size_t n) {
  uint32_t crc = 0xffffffff;
  while (n--) {
    crc ^= *p++;
    for (int i = 0; i < 8; ++i) crc = (crc >> 1) ^ (0xedb88320u & -(crc & 1u));
  }
  return ~crc;
}
int hexDigit(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}
bool multiplexBusy() { return channels[0].active || channels[1].active; }

// Returns at most one 64-byte frame. Buffered bytes drain before DONE.
void bridgeReceive(BridgeSession &s, bool polled) {
  uint8_t output[64];
  int count = s.client.available();
  if (count > 0) {
    if (count > 64) count = 64;
    count = s.client.read(output, count);
    if (count <= 0) { s.close(); Serial.println("ERR tcp_read"); return; }
    Serial.printf("R %08lx ", (unsigned long)bridgeCrc(output, count));
    for (int i = 0; i < count; ++i) {
      if (output[i] < 16) Serial.print('0');
      Serial.print(output[i], HEX);
    }
    Serial.print('\n');
  } else if (s.client.ended()) {
    s.close(); Serial.println("DONE");
  } else if (polled) Serial.println("WAIT");
}

void bridgeSessionCommand(BridgeSession &s, char *line, int channel) {
  if (!strcmp(line, "X")) { s.close(); Serial.println("OK"); return; }
  if ((line[0] == 'C' || line[0] == 'G') && line[1] == ' ') {
    IPAddress ip;
    const bool debug = line[0] == 'G';
    if (s.active || (channel >= 0 && debug != (channel == 1)) ||
        !ip.fromString(line + 2) || ip[0] != 192 || ip[1] != 168 ||
        ip[2] != 77 || ip[3] < 2 || ip[3] > 254) {
      Serial.println("ERR address_or_busy"); return;
    }
    s.client.setTimeout(5000);
    if (!s.client.connect(ip, debug ? 22225 : 9026)) {
      s.client.abort(); Serial.println("ERR connect"); return;
    }
    s.client.setNoDelay(true);
    s.active = s.sending = true; s.interactive = debug;
    Serial.println("OK"); return;
  }
  if (!strcmp(line, "R") && s.active && (s.interactive || !s.sending)) {
    bridgeReceive(s, true); return;
  }
  if (line[0] == 'D' && line[1] == ' ' && s.active && s.sending) {
    const char *checksum = line + 2;
    if (strlen(checksum) < 11 || checksum[8] != ' ') { Serial.println("ERR frame"); return; }
    uint32_t expected = 0;
    for (int i = 0; i < 8; ++i) {
      int v = hexDigit(checksum[i]);
      if (v < 0) { Serial.println("ERR frame"); return; }
      expected = (expected << 4) | v;
    }
    const char *hex = checksum + 9;
    size_t n = strlen(hex);
    if (!n || n > 128 || (n & 1)) { Serial.println("ERR frame"); return; }
    uint8_t data[64];
    for (size_t i = 0; i < n / 2; ++i) {
      int a = hexDigit(hex[2*i]), b = hexDigit(hex[2*i+1]);
      if (a < 0 || b < 0) { Serial.println("ERR frame"); return; }
      data[i] = (a << 4) | b;
    }
    n /= 2;
    if (bridgeCrc(data, n) != expected) { Serial.println("ERR crc"); return; }
    if (s.client.write(data, n) != n) { s.close(); Serial.println("ERR tcp_write"); return; }
    Serial.println("OK"); return;
  }
  if (!strcmp(line, "F") && s.active && s.sending && !s.interactive) {
    if (!s.client.halfClose()) { s.close(); Serial.println("ERR half_close"); return; }
    s.sending = false; Serial.println("OK"); return;
  }
  Serial.println("ERR command");
}
void bridgeCommand(char *line) {
  if (!strcmp(line, "P")) { Serial.println("READY 1"); return; }
  if (!strcmp(line, "Z")) {
    legacy.close(); channels[0].close(); channels[1].close();
    Serial.println("OK"); return;
  }
  if (!strcmp(line, "V")) {
    Serial.println(legacy.active || multiplexBusy() ? "ERR busy" : "READY 2 GDB1"); return;
  }
  if (!strcmp(line, "Q")) {
    Serial.println(legacy.active || multiplexBusy() ? "ERR busy" : "READY 3 MUX2"); return;
  }
  if (line[0] == 'M' && line[1] == ' ') {
    if (strlen(line) < 5 || (line[2] != '0' && line[2] != '1') || line[3] != ' ') {
      Serial.println("ERR channel"); return;
    }
    if (legacy.active) { Serial.println("ERR busy"); return; }
    int channel = line[2] - '0';
    bridgeSessionCommand(channels[channel], line + 4, channel); return;
  }
  if (multiplexBusy()) { Serial.println("ERR busy"); return; }
  bridgeSessionCommand(legacy, line, -1);
}
void bridgePoll() {
  // A bounded command per loop lets DNS/HTTP and Wi-Fi housekeeping run.
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      serialLine[serialLength] = 0;
      if (serialOverflow) Serial.println("ERR line_too_long");
      else bridgeCommand(serialLine);
      serialLength = 0; serialOverflow = false;
      break;
    } else if (c != '\r') {
      if (serialLength + 1 < sizeof(serialLine)) serialLine[serialLength++] = c;
      else serialOverflow = true;
    }
  }
  if (legacy.active && !legacy.sending && !legacy.interactive) bridgeReceive(legacy, false);
}
