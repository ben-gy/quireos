// Small URL helpers shared by the session and the OS (no library dependencies).
#pragma once
#include <string>

namespace quire {
namespace url {

struct Parts { std::string scheme, host, path; int port = 0; bool ok = false; };
Parts parse(const std::string &u);
std::string origin(const std::string &u);                 // "https://host[:port]" or "" when invalid
bool is_absolute(const std::string &u);                   // starts with http:// or https://
std::string resolve(const std::string &base_origin, const std::string &u);   // "/x" against an origin
bool is_private_host(const std::string &host);            // RFC 1918, link-local, loopback, .local
std::string encode(const std::string &s);                 // percent-encoding (RFC 3986 unreserved kept)
std::string last_segment(const std::string &u);

}  // namespace url
}  // namespace quire
