#pragma once
enum { WIFI_OFF = 0, WIFI_STA = 1, WIFI_AP = 2, WIFI_AP_STA = 3 };
enum { WL_CONNECTED = 3, WL_DISCONNECTED = 6 };
struct WiFiClass {
    int  status() { return WL_CONNECTED; }
    bool isConnected() { return true; }
    int  RSSI() { return -55; }
    void disconnect(bool = false) {}
    void mode(int) {}
};
extern WiFiClass WiFi;
