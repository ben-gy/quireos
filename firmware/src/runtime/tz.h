// A small time-zone model: fixed UTC offset plus an optional DST rule, with a table of common IANA
// names (the device reports an IANA name in X-Timezone). See spec/NOTES-firmware.md for limits.
#pragma once
#include <stdint.h>

namespace quire {
namespace tz {

struct Rule {                 // month 1-12, week 1-4 or 5 = last, dow 0 = Sunday
  uint8_t s_month, s_week, s_dow, s_hour;   // DST starts at s_hour local standard time
  uint8_t e_month, e_week, e_dow, e_hour;   // DST ends at e_hour local daylight time
  int16_t save_min;
};
struct Zone {
  char name[40] = "UTC";
  int16_t std_min = 0;        // standard offset from UTC in minutes
  bool has_dst = false;
  Rule rule = {};
};

// Parses an IANA name from the built-in table, or "UTC", "UTC+10", "UTC-05:30", "+10:00", "GMT".
// Unknown names give UTC and return false.
bool parse(const char *name, Zone &out);
int offset_minutes(const Zone &z, int64_t utc_epoch);   // total offset in effect at that instant

struct Civil { int year, month, day, hour, minute, second, dow, yday; };
void civil_from_epoch(int64_t epoch, Civil &out);       // UTC
int64_t epoch_from_civil(int year, int month, int day, int hour, int minute, int second);
void local_time(const Zone &z, int64_t utc_epoch, Civil &out);

}  // namespace tz
}  // namespace quire
