#include "url.h"
#include <stdio.h>
#include <stdlib.h>

namespace quire {
namespace url {

Parts parse(const std::string &u) {
  Parts p;
  size_t s = u.find("://");
  if (s == std::string::npos) return p;
  p.scheme = u.substr(0, s);
  for (char &c : p.scheme) if (c >= 'A' && c <= 'Z') c = (char)(c + 32);
  if (p.scheme != "http" && p.scheme != "https") return p;
  size_t hs = s + 3;
  size_t he = u.find_first_of("/?#", hs);
  std::string hostport = u.substr(hs, he == std::string::npos ? std::string::npos : he - hs);
  if (hostport.empty()) return p;
  size_t colon = hostport.rfind(':');
  if (colon != std::string::npos && hostport.find(']') == std::string::npos) {
    p.host = hostport.substr(0, colon);
    p.port = atoi(hostport.c_str() + colon + 1);
  } else {
    p.host = hostport;
    p.port = p.scheme == "https" ? 443 : 80;
  }
  for (char &c : p.host) if (c >= 'A' && c <= 'Z') c = (char)(c + 32);
  p.path = he == std::string::npos ? "/" : u.substr(he);
  if (p.path.empty() || p.path[0] == '?' || p.path[0] == '#') p.path = "/" + p.path;
  p.ok = !p.host.empty() && p.port > 0 && p.port < 65536;
  return p;
}

std::string origin(const std::string &u) {
  Parts p = parse(u);
  if (!p.ok) return "";
  bool default_port = (p.scheme == "https" && p.port == 443) || (p.scheme == "http" && p.port == 80);
  if (default_port) return p.scheme + "://" + p.host;
  char b[16];
  snprintf(b, sizeof b, ":%d", p.port);
  return p.scheme + "://" + p.host + b;
}

bool is_absolute(const std::string &u) {
  return u.compare(0, 7, "http://") == 0 || u.compare(0, 8, "https://") == 0 ||
         u.compare(0, 7, "HTTP://") == 0 || u.compare(0, 8, "HTTPS://") == 0;
}

std::string resolve(const std::string &base_origin, const std::string &u) {
  if (is_absolute(u)) return u;
  if (!u.empty() && u[0] == '/') return base_origin + u;
  return "";   // ./ and ../ are not supported
}

bool is_private_host(const std::string &host) {
  if (host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]") return true;
  size_t n = host.size();
  if (n > 6 && host.compare(n - 6, 6, ".local") == 0) return true;
  int a, b, c, d;
  if (sscanf(host.c_str(), "%d.%d.%d.%d", &a, &b, &c, &d) == 4) {
    if (a == 10) return true;
    if (a == 127) return true;
    if (a == 172 && b >= 16 && b <= 31) return true;
    if (a == 192 && b == 168) return true;
    if (a == 169 && b == 254) return true;
    return false;
  }
  return false;
}

std::string encode(const std::string &s) {
  static const char *hex = "0123456789ABCDEF";
  std::string o;
  o.reserve(s.size() * 3);
  for (unsigned char c : s) {
    bool keep = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~';
    if (keep) o.push_back((char)c);
    else { o.push_back('%'); o.push_back(hex[c >> 4]); o.push_back(hex[c & 15]); }
  }
  return o;
}

std::string last_segment(const std::string &u) {
  size_t q = u.find_first_of("?#");
  std::string p = q == std::string::npos ? u : u.substr(0, q);
  size_t sl = p.rfind('/');
  return sl == std::string::npos ? p : p.substr(sl + 1);
}

}  // namespace url
}  // namespace quire
