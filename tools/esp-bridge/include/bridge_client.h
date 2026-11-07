#pragma once
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
