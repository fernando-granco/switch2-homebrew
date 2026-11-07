// Run the real firmware command parser against independent mock TCP sockets.
#include <cassert>
#include <cstdint>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include <algorithm>
#include <iostream>
using std::size_t;
constexpr int HEX = 16;
struct SerialMock {
  std::string input, output;
  int available() { return input.size(); }
  int read() { int c = input.front(); input.erase(0, 1); return c; }
  void println(const char *s) { output += s; output += '\n'; }
  void print(char c) { output += c; }
  void print(unsigned int v, int) { char b[4]; snprintf(b, sizeof(b), "%x", v); output += b; }
  void printf(const char *fmt, ...) { char b[512]; va_list a; va_start(a,fmt); vsnprintf(b,sizeof(b),fmt,a); va_end(a); output += b; }
} Serial;
struct IPAddress {
  unsigned a[4] = {};
  bool fromString(const char *s) {
    int end=0;
    return sscanf(s,"%u.%u.%u.%u%n",a,a+1,a+2,a+3,&end)==4 && s[end]==0 &&
      std::all_of(a,a+4,[](unsigned n){return n<256;});
  }
  unsigned operator[](int i) const { return a[i]; }
};
struct BridgeClient {
  bool live=false, half=false, fail=false;
  int port=0;
  std::vector<uint8_t> input, sent;
  void setTimeout(int) {}
  void setNoDelay(bool) {}
  bool connect(IPAddress, int p) { live=true; half=false; fail=false; input.clear(); sent.clear(); port=p; return true; }
  void abort() { live=false; input.clear(); }
  bool halfClose() { half=true; live=false; return true; }
  bool ended() { return !live; }
  size_t write(const uint8_t *p,size_t n) {
    if(fail) return 0;
    sent.insert(sent.end(),p,p+n); input.insert(input.end(),p,p+n); return n;
  }
  int available() { return input.size(); }
  int read(uint8_t *p,int n) { n=std::min(n,available()); std::copy_n(input.begin(),n,p); input.erase(input.begin(),input.begin()+n); return n; }
};
#include "include/bridge_protocol.h"
std::string command(std::string s) {
  Serial.output.clear(); std::vector<char> b(s.begin(),s.end()); b.push_back(0); bridgeCommand(b.data()); return Serial.output;
}
int main(int argc,char **) {
  if(argc>1) {
    std::string line;
    while(std::getline(std::cin,line)) {
      std::cout<<command(line)<<std::flush;
      if(line=="F") {
        while(legacy.active) { Serial.output.clear(); bridgePoll(); std::cout<<Serial.output<<std::flush; }
      }
    }
    return 0;
  }
  assert(command("P")=="READY 1\n");
  assert(command("V")=="READY 2 GDB1\n");
  assert(command("Q")=="READY 3 MUX2\n");
  for(auto bad:{"M", "M ", "M 2 C 192.168.77.2", "M -1 X", "M 0"})
    assert(command(bad).find("ERR ")==0);
  for(auto bad:{"10.0.0.1","192.168.77.1","192.168.77.255","192.168.77.2 80"})
    assert(command(std::string("C ")+bad)=="ERR address_or_busy\n");
  assert(command("G 192.168.77.2")=="OK\n");
  assert(legacy.client.port==22225);
  assert(command("M 0 X")=="ERR busy\n");
  assert(command("F")=="ERR command\n");
  assert(command("R")=="WAIT\n");
  assert(command("X")=="OK\n");
  assert(command("M 0 G 192.168.77.2")=="ERR address_or_busy\n");
  assert(command("M 0 C 192.168.77.2")=="OK\n");
  assert(command("M 1 G 192.168.77.3")=="OK\n");
  assert(channels[0].client.port==9026 && channels[1].client.port==22225);
  assert(command("C 192.168.77.2")=="ERR busy\n");
  assert(command("Q")=="ERR busy\n");
  assert(command("M 1 F")=="ERR command\n");
  assert(command("M 0 R")=="ERR command\n");
  assert(command("M 1 D 00000000 61")=="ERR crc\n");
  assert(channels[1].client.sent.empty());
  assert(command("M 1 D e8b7be43 61")=="OK\n");
  assert(command("M 1 R")=="R e8b7be43 61\n");
  assert(command("M 0 D 71beeff9 616263")=="ERR crc\n");
  assert(command("M 0 D 352441c2 616263")=="OK\n");
  assert(command("M 0 F")=="OK\n");
  assert(command("M 0 R")=="R 352441c2 616263\n");
  assert(command("M 0 R")=="DONE\n");
  assert(channels[1].active);
  channels[1].client.fail=true;
  assert(command("M 1 D e8b7be43 61")=="ERR tcp_write\n");
  assert(!channels[1].active);
  assert(command("M 0 C 192.168.77.2")=="OK\n");
  assert(command("M 1 G 192.168.77.2")=="OK\n");
  assert(command("Z")=="OK\n");
  assert(!legacy.active && !multiplexBusy());
  Serial.input=std::string(200,'a')+"\nP\n";
  Serial.output.clear(); bridgePoll(); assert(Serial.output=="ERR line_too_long\n");
  Serial.output.clear(); bridgePoll(); assert(Serial.output=="READY 1\n");
  std::cout<<"PASS: legacy/GDB/multiplex routing, guards, CRC, EOF, isolation, parser recovery\n";
}
