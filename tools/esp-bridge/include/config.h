#pragma once
// Run python3 configure.py to create a private config.local.h.
#if __has_include("config.local.h")
#include "config.local.h"
#endif
#ifndef BRIDGE_SSID
#define BRIDGE_SSID "Switch2-Offline-Open"
#endif
#ifndef BRIDGE_PASSWORD
#define BRIDGE_PASSWORD ""
#endif
constexpr char AP_SSID[] = BRIDGE_SSID;
constexpr char AP_PASSWORD[] = BRIDGE_PASSWORD;
constexpr bool AP_SECURED = sizeof(AP_PASSWORD) > 1;
static_assert(sizeof(AP_SSID) > 1 && sizeof(AP_SSID) <= 33, "SSID must contain 1-32 bytes");
static_assert(!AP_SECURED || (sizeof(AP_PASSWORD) >= 9 && sizeof(AP_PASSWORD) <= 64),
              "Password must be empty or 8-63 characters");
