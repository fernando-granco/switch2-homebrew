// SPDX-License-Identifier: GPL-2.0-or-later
// Isolated Wi-Fi for a console and, optionally, a local PC.
// Local check responses adapted from 90DNS by Ave (Copyright 2018 Ave):
// https://gitlab.com/a/90dns/-/tree/4d477d7181188690203aae5f4e56e287edd21734
// ESP32 implementation prepared/modified 2026-11-03. See ../LICENSE.
// Targets: ESP8266 or ESP32 family, using the matching Arduino core.
// No extra libraries needed.
#if defined(ESP8266)
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <LwipDhcpServer-NonOS.h>
extern "C" {
#include <user_interface.h>
}
#elif defined(ESP32)
#include <WiFi.h>
#include <WebServer.h>
#include <esp_wifi.h>
#else
#error "Select the matching ESP8266 or ESP32 board."
#endif
#include <DNSServer.h>
#if defined(ESP8266)
#include <lwip/tcp.h>
#include <include/ClientContext.h>
#else
#include <lwip/sockets.h>
#include <lwip/inet.h>
#include <errno.h>
#endif
struct QuietPrint : Print { size_t write(uint8_t) override { return 1; } };
QuietPrint quiet;

#include "config.h"
constexpr int AP_CHANNEL = 6;
constexpr int MAX_CLIENTS = 4;
// false restores the original empty AP (no DNS/HTTP, internet test fails).
constexpr bool EMULATE_CONNECTION_CHECKS = true;

const IPAddress AP_IP(192, 168, 77, 1);
const IPAddress AP_MASK(255, 255, 255, 0);
const IPAddress DHCP_START(192, 168, 77, 2);
DNSServer dns;
#if defined(ESP8266)
ESP8266WebServer http(80);
WiFiEventHandler apConnectedHandler;
WiFiEventHandler apDisconnectedHandler;
#else
WebServer http(80);
#endif
uint32_t checkRequests = 0;
uint32_t rejectedRequests = 0;

// The event callback runs on the network task. Only read its event-local
// data and use thread-safe quiet.printf; do not modify application state.
#if defined(ESP32)
void onWifiEvent(arduino_event_id_t event, arduino_event_info_t info) {
  if (!Serial) return;
  if (event == ARDUINO_EVENT_WIFI_AP_STACONNECTED) {
    const auto &client = info.wifi_ap_staconnected;
    quiet.printf("WIFI %lu connected %02x:%02x:%02x:%02x:%02x:%02x aid=%u\n",
      (unsigned long)millis(), client.mac[0], client.mac[1], client.mac[2],
      client.mac[3], client.mac[4], client.mac[5], client.aid);
  } else if (event == ARDUINO_EVENT_WIFI_AP_STADISCONNECTED) {
    const auto &client = info.wifi_ap_stadisconnected;
    quiet.printf("WIFI %lu disconnected %02x:%02x:%02x:%02x:%02x:%02x reason=%u\n",
      (unsigned long)millis(), client.mac[0], client.mac[1], client.mac[2],
      client.mac[3], client.mac[4], client.mac[5], client.reason);
  } else if (event == ARDUINO_EVENT_WIFI_AP_STAIPASSIGNED) {
    const auto &lease = info.wifi_ap_staipassigned;
    quiet.printf("DHCP %lu assigned %s to %02x:%02x:%02x:%02x:%02x:%02x\n",
      (unsigned long)millis(), IPAddress(lease.ip.addr).toString().c_str(),
      lease.mac[0], lease.mac[1], lease.mac[2], lease.mac[3], lease.mac[4], lease.mac[5]);
  }
}
#endif

// These are HTTP test hosts, not an allowlist for internet forwarding.
const char *const PLAIN_CHECK_HOSTS[] = {
  "ctest.cdn.nintendo.net",
  "ctest.p01.ctest.srv.nintendo.net",
  "ctest-dl-lp1.cdn.nintendo.net",
  "ctest-ul-lp1.cdn.nintendo.net",
  "api.p01.lp1.ctest.srv.nintendo.net",
  "api-ipv6.p01.lp1.ctest.srv.nintendo.net"
};

void handleLocalHttp() {
  String host = http.hostHeader();
  host.trim();
  host.toLowerCase();
  const int port = host.indexOf(':');
  if (port >= 0) host.remove(port);
  if (host.endsWith(".")) host.remove(host.length() - 1);

  const bool legacyCheck = host == "conntest.nintendowifi.net";
  bool plainCheck = false;
  for (const char *candidate : PLAIN_CHECK_HOSTS) {
    if (host == candidate) plainCheck = true;
  }
  if (Serial) {
    quiet.print("HTTP ");
    quiet.print(host.substring(0, 100));
    quiet.print(' ');
    quiet.print(http.uri().substring(0, 100));
    quiet.println((legacyCheck || plainCheck) ? " -> local check" : " -> rejected");
  }
  http.sendHeader("Cache-Control", "no-store");
  if (legacyCheck || plainCheck) {
    ++checkRequests;
    http.sendHeader("X-Organization", "Nintendo");
    if (legacyCheck) {
      http.send(200, "text/html",
        "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Transitional//EN\" "
        "\"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\">"
        "<html><head><title>HTML Page</title></head><body bgcolor=\"#FFFFFF\">"
        "This is test.html page</body></html>");
    } else {
      http.send(200, "text/plain", "ok");
    }
    return;
  }
  ++rejectedRequests;
  http.send(404, "text/plain", "Offline access point: no internet forwarding.\n");
}

void stopWithError(const char *message) {
  dns.stop();
  http.stop();
  WiFi.mode(WIFI_OFF);
  for (;;) {
    if (Serial) {
      quiet.print("AP stopped: ");
      quiet.println(message);
    }
    delay(2000);
  }
}

void printStatus() {
  if (!Serial) return;
  quiet.print("SSID: ");
  quiet.print(WiFi.softAPSSID());
  quiet.print(" | BSSID: ");
  quiet.print(WiFi.softAPmacAddress());
  quiet.print(" | AP IP: ");
  quiet.print(WiFi.softAPIP());
  quiet.print(" | clients: ");
  quiet.print(WiFi.softAPgetStationNum());
  quiet.print(" | local checks: ");
  quiet.print(checkRequests);
  quiet.print(" | rejected HTTP: ");
  quiet.print(rejectedRequests);
  quiet.println(AP_SECURED ? " | auth: WPA2 | no internet uplink" : " | auth: OPEN | no internet uplink");
}

void setup() {
  Serial.setRxBufferSize(1024);
  Serial.begin(115200);
  // Never wait for a USB serial monitor: a USB power supply is sufficient.
  WiFi.persistent(false);
  WiFi.setAutoReconnect(false);
#if defined(ESP32)
  WiFi.onEvent(onWifiEvent);
#else
  apConnectedHandler = WiFi.onSoftAPModeStationConnected(
    [](const WiFiEventSoftAPModeStationConnected &client) {
      quiet.printf("WIFI %lu connected %02x:%02x:%02x:%02x:%02x:%02x aid=%u\n",
        (unsigned long)millis(), client.mac[0], client.mac[1], client.mac[2],
        client.mac[3], client.mac[4], client.mac[5], client.aid);
    });
  apDisconnectedHandler = WiFi.onSoftAPModeStationDisconnected(
    [](const WiFiEventSoftAPModeStationDisconnected &client) {
      quiet.printf("WIFI %lu disconnected %02x:%02x:%02x:%02x:%02x:%02x aid=%u\n",
        (unsigned long)millis(), client.mac[0], client.mac[1], client.mac[2],
        client.mac[3], client.mac[4], client.mac[5], client.aid);
    });
#endif

  // AP only. Never enable WIFI_AP_STA or call WiFi.begin().
  if (!WiFi.mode(WIFI_OFF)) stopWithError("Cannot reset Wi-Fi mode");
  delay(100);
  if (!WiFi.mode(WIFI_AP)) stopWithError("Cannot enable AP mode");
#if defined(ESP8266)
  if (!WiFi.softAPConfig(AP_IP, AP_IP, AP_MASK)) {
    stopWithError("Cannot configure local IPv4 network");
  }
  ip4_addr_t apDns;
  apDns.addr = AP_IP.v4();
  WiFi.softAPDhcpServer().setDns(apDns);
  if (!WiFi.softAP(AP_SSID, AP_SECURED ? AP_PASSWORD : nullptr, AP_CHANNEL, 0, MAX_CLIENTS)) {
    stopWithError("Cannot start access point");
  }
  softap_config actual = {};
  if (!wifi_softap_get_config(&actual) || actual.authmode != (AP_SECURED ? AUTH_WPA2_PSK : AUTH_OPEN) ||
      memcmp(actual.password, AP_PASSWORD, sizeof(AP_PASSWORD)) != 0 || actual.ssid_hidden != 0 ||
      actual.ssid_len != sizeof(AP_SSID) - 1 ||
      memcmp(actual.ssid, AP_SSID, sizeof(AP_SSID) - 1) != 0) {
    stopWithError("AP configuration did not match readback");
  }
#else
  // Explicit DHCP DNS advertisement requires Arduino-ESP32 3.x.
  if (!WiFi.softAPConfig(AP_IP, AP_IP, AP_MASK, DHCP_START, AP_IP)) {
    stopWithError("Cannot configure local IPv4 network");
  }
  if (!WiFi.softAP(AP_SSID, AP_SECURED ? AP_PASSWORD : nullptr, AP_CHANNEL, 0, MAX_CLIENTS,
                   false, AP_SECURED ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN,
                   AP_SECURED ? WIFI_CIPHER_TYPE_CCMP : WIFI_CIPHER_TYPE_NONE)) {
    stopWithError("Cannot start access point");
  }
  wifi_config_t actual = {};
  if (esp_wifi_get_config(WIFI_IF_AP, &actual) != ESP_OK ||
      actual.ap.authmode != (AP_SECURED ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN) ||
      memcmp(actual.ap.password, AP_PASSWORD, sizeof(AP_PASSWORD)) != 0 ||
      actual.ap.ssid_len != sizeof(AP_SSID) - 1 ||
      memcmp(actual.ap.ssid, AP_SSID, sizeof(AP_SSID) - 1) != 0) {
    stopWithError("AP configuration did not match readback");
  }
#endif
  if (EMULATE_CONNECTION_CHECKS) {
    dns.setTTL(30);
    // All IPv4 names resolve locally; no query is sent upstream.
    if (!dns.start(53, "*", AP_IP)) stopWithError("Cannot start local DNS");
    http.onNotFound(handleLocalHttp);
    http.begin();
  }
  // No upstream connection, NAT, forwarding, HTTPS, or USB networking.
  printStatus();
}

// Serial protocol is private to send_usb.py. Stop-and-wait, CRC32 per
// 64-byte host frame; output is ASCII hex. Never print diagnostics on UART.
#if defined(ESP8266)
class BridgeClient : public WiFiClient {
public:
  bool halfClose() {
    if (!_client || !_client->getPCB() || !flush(3000)) return false;
    tcp_pcb *pcb = _client->getPCB();
    if (!pcb || tcp_shutdown(pcb, 0, 1) != ERR_OK) return false;
    return tcp_output(pcb) == ERR_OK;
  }
  bool ended() {
    if (!_client || !_client->getPCB()) return true;
    const auto state = _client->state();
    return state == CLOSED || state == CLOSE_WAIT || state == LAST_ACK || state == TIME_WAIT;
  }
};
#else
// ESP32 uses a socket directly: the loader requires TCP write-half shutdown
// while keeping the receive side open. WiFiClient internals differ by core.
class BridgeClient {
  int sock = -1;
public:
  void setTimeout(unsigned long) {}
  bool connect(IPAddress ip, uint16_t port) {
    sock = lwip_socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock < 0) return false;
    timeval timeout = {5, 0};
    lwip_setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
    sockaddr_in peer = {};
    peer.sin_family = AF_INET; peer.sin_port = htons(port);
    peer.sin_addr.s_addr = (uint32_t)ip;
    if (lwip_connect(sock, (sockaddr *)&peer, sizeof(peer)) != 0) { stop(); return false; }
    return true;
  }
  void setNoDelay(bool on) { int v = on; lwip_setsockopt(sock, IPPROTO_TCP, TCP_NODELAY, &v, sizeof(v)); }
  size_t write(const uint8_t *data, size_t len) {
    size_t sent = 0;
    while (sent < len) { int n = lwip_send(sock, data + sent, len - sent, 0); if (n <= 0) break; sent += n; }
    return sent;
  }
  bool halfClose() { return sock >= 0 && lwip_shutdown(sock, SHUT_WR) == 0; }
  int available() { int n = 0; return sock >= 0 && lwip_ioctl(sock, FIONREAD, &n) == 0 ? n : 0; }
  int read(uint8_t *data, size_t n) { return lwip_recv(sock, data, n, MSG_DONTWAIT); }
  bool ended() {
    if (sock < 0) return true;
    char b; int n = lwip_recv(sock, &b, 1, MSG_PEEK | MSG_DONTWAIT);
    return n == 0 || (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK);
  }
  void stop() { if (sock >= 0) lwip_close(sock); sock = -1; }
  void abort() { stop(); }
};
#endif
BridgeClient bridge;
bool bridgeActive = false;
bool bridgeSending = false;
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
void bridgeCommand(char *line) {
  if (!strcmp(line, "P")) { Serial.println("READY 1"); return; }
  if (!strcmp(line, "X")) {
    if (bridgeActive) bridge.abort();
    bridgeActive = false; bridgeSending = false;
    Serial.println("OK"); return;
  }
  if (line[0] == 'C' && line[1] == ' ') {
    IPAddress address;
    if (bridgeActive || !address.fromString(line + 2) || address[0] != 192 ||
        address[1] != 168 || address[2] != 77 || address[3] < 2 || address[3] > 254) {
      Serial.println("ERR address_or_busy"); return;
    }
    bridge.setTimeout(5000);
    if (!bridge.connect(address, 9026)) { Serial.println("ERR connect"); return; }
    bridge.setNoDelay(true);
    bridgeActive = true; bridgeSending = true;
    Serial.println("OK"); return;
  }
  if (line[0] == 'D' && line[1] == ' ' && bridgeActive && bridgeSending) {
    const char *checksum = line + 2;
    if (strlen(checksum) < 11 || checksum[8] != ' ') { Serial.println("ERR frame"); return; }
    uint32_t expected = 0;
    for (int i = 0; i < 8; ++i) { int v = hexDigit(checksum[i]); if (v < 0) { Serial.println("ERR frame"); return; } expected = (expected << 4) | v; }
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
    if (bridge.write(data, n) != n) { bridge.abort(); bridgeActive = false; Serial.println("ERR tcp_write"); return; }
    Serial.println("OK"); return;
  }
  if (!strcmp(line, "F") && bridgeActive && bridgeSending) {
    if (!bridge.halfClose()) { bridge.abort(); bridgeActive = false; Serial.println("ERR half_close"); return; }
    bridgeSending = false; Serial.println("OK"); return;
  }
  Serial.println("ERR command");
}
void bridgePoll() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      serialLine[serialLength] = 0;
      if (serialOverflow) Serial.println("ERR line_too_long"); else bridgeCommand(serialLine);
      serialLength = 0; serialOverflow = false;
    } else if (c != '\r') {
      if (serialLength + 1 < sizeof(serialLine)) serialLine[serialLength++] = c;
      else serialOverflow = true;
    }
  }
  if (bridgeActive && !bridgeSending) {
    uint8_t output[64];
    int count = bridge.available();
    if (count > 0) {
      if (count > 64) count = 64;
      count = bridge.read(output, count);
      if (count > 0) {
        Serial.printf("R %08lx ", (unsigned long)bridgeCrc(output, count));
        for (int i = 0; i < count; ++i) { if (output[i] < 16) Serial.print('0'); Serial.print(output[i], HEX); }
        Serial.print('\n');
      }
    } else if (bridge.ended()) {
      bridge.stop(); bridgeActive = false;
      Serial.println("DONE");
    }
  }
}
void loop() {
  bridgePoll();
  if (EMULATE_CONNECTION_CHECKS) {
    dns.processNextRequest();
    http.handleClient();
  }
  static uint32_t lastStatus = 0;
  const uint32_t now = millis();
  if (now - lastStatus >= 5000) {
    lastStatus = now;
    if (WiFi.getMode() != WIFI_AP) stopWithError("Unexpected Wi-Fi mode");
    printStatus();
  }
  delay(2);
}
