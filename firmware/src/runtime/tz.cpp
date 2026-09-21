#include "tz.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

namespace quire {
namespace tz {

namespace {

// Rule families. Hours are local standard time for the start, local daylight time for the end.
const Rule R_AU = {10, 1, 0, 2, 4, 1, 0, 3, 60};     // first Sun Oct 02:00 -> first Sun Apr 03:00
const Rule R_NZ = {9, 5, 0, 2, 4, 1, 0, 3, 60};      // last Sun Sep 02:00 -> first Sun Apr 03:00
const Rule R_US = {3, 2, 0, 2, 11, 1, 0, 2, 60};     // second Sun Mar 02:00 -> first Sun Nov 02:00
// EU switches at 01:00 UTC; the local hour depends on the zone's offset, so it is built per zone.
Rule eu_rule(int std_hours) { Rule r = {3, 5, 0, (uint8_t)(1 + std_hours), 10, 5, 0, (uint8_t)(2 + std_hours), 60}; return r; }

struct Entry { const char *name; int16_t std_min; char fam; };   // fam: '-', 'A', 'N', 'U', 'E'
const Entry TABLE[] = {
  {"UTC", 0, '-'}, {"Etc/UTC", 0, '-'}, {"GMT", 0, '-'}, {"Etc/GMT", 0, '-'},
  {"Australia/Sydney", 600, 'A'}, {"Australia/Melbourne", 600, 'A'}, {"Australia/Canberra", 600, 'A'},
  {"Australia/Hobart", 600, 'A'}, {"Australia/ACT", 600, 'A'}, {"Australia/NSW", 600, 'A'},
  {"Australia/Brisbane", 600, '-'}, {"Australia/Adelaide", 570, 'A'}, {"Australia/Darwin", 570, '-'},
  {"Australia/Perth", 480, '-'},
  {"Pacific/Auckland", 720, 'N'}, {"Pacific/Honolulu", -600, '-'}, {"Pacific/Fiji", 720, '-'},
  {"Europe/London", 0, 'E'}, {"Europe/Dublin", 0, 'E'}, {"Europe/Lisbon", 0, 'E'},
  {"Europe/Paris", 60, 'E'}, {"Europe/Berlin", 60, 'E'}, {"Europe/Madrid", 60, 'E'}, {"Europe/Rome", 60, 'E'},
  {"Europe/Amsterdam", 60, 'E'}, {"Europe/Brussels", 60, 'E'}, {"Europe/Vienna", 60, 'E'}, {"Europe/Zurich", 60, 'E'},
  {"Europe/Stockholm", 60, 'E'}, {"Europe/Oslo", 60, 'E'}, {"Europe/Copenhagen", 60, 'E'}, {"Europe/Prague", 60, 'E'},
  {"Europe/Warsaw", 60, 'E'}, {"Europe/Budapest", 60, 'E'},
  {"Europe/Athens", 120, 'E'}, {"Europe/Helsinki", 120, 'E'}, {"Europe/Kyiv", 120, 'E'}, {"Europe/Kiev", 120, 'E'},
  {"Europe/Bucharest", 120, 'E'}, {"Europe/Sofia", 120, 'E'}, {"Europe/Riga", 120, 'E'}, {"Europe/Tallinn", 120, 'E'},
  {"Europe/Vilnius", 120, 'E'}, {"Europe/Istanbul", 180, '-'}, {"Europe/Moscow", 180, '-'},
  {"America/New_York", -300, 'U'}, {"America/Toronto", -300, 'U'}, {"America/Detroit", -300, 'U'},
  {"America/Chicago", -360, 'U'}, {"America/Winnipeg", -360, 'U'}, {"America/Denver", -420, 'U'},
  {"America/Edmonton", -420, 'U'}, {"America/Phoenix", -420, '-'}, {"America/Los_Angeles", -480, 'U'},
  {"America/Vancouver", -480, 'U'}, {"America/Anchorage", -540, 'U'}, {"America/Halifax", -240, 'U'},
  {"America/Sao_Paulo", -180, '-'}, {"America/Mexico_City", -360, '-'}, {"America/Bogota", -300, '-'},
  {"Asia/Tokyo", 540, '-'}, {"Asia/Seoul", 540, '-'}, {"Asia/Shanghai", 480, '-'}, {"Asia/Hong_Kong", 480, '-'},
  {"Asia/Singapore", 480, '-'}, {"Asia/Taipei", 480, '-'}, {"Asia/Manila", 480, '-'}, {"Asia/Kuala_Lumpur", 480, '-'},
  {"Asia/Bangkok", 420, '-'}, {"Asia/Jakarta", 420, '-'}, {"Asia/Ho_Chi_Minh", 420, '-'},
  {"Asia/Kolkata", 330, '-'}, {"Asia/Calcutta", 330, '-'}, {"Asia/Dubai", 240, '-'}, {"Asia/Karachi", 300, '-'},
  {"Asia/Dhaka", 360, '-'}, {"Asia/Jerusalem", 120, '-'}, {"Asia/Riyadh", 180, '-'},
  {"Africa/Johannesburg", 120, '-'}, {"Africa/Cairo", 120, '-'}, {"Africa/Lagos", 60, '-'}, {"Africa/Nairobi", 180, '-'},
};

bool days_in_month_leap(int y) { return (y % 4 == 0 && y % 100 != 0) || y % 400 == 0; }
int days_in_month(int y, int m) {
  static const int d[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  return (m == 2 && days_in_month_leap(y)) ? 29 : d[m - 1];
}

// Howard Hinnant's days_from_civil.
int64_t days_from_civil(int y, int m, int d) {
  y -= m <= 2;
  const int64_t era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + (int64_t)doe - 719468;
}

int dow_of(int y, int m, int d) {   // 0 = Sunday
  int64_t days = days_from_civil(y, m, d);
  int r = (int)((days + 4) % 7);
  return r < 0 ? r + 7 : r;
}

// Day of month of the `week`-th `dow` (5 = last) of month m in year y.
int nth_dow(int y, int m, int week, int dow) {
  if (week >= 5) {
    int last = days_in_month(y, m);
    int ld = dow_of(y, m, last);
    return last - ((ld - dow + 7) % 7);
  }
  int fd = dow_of(y, m, 1);
  return 1 + ((dow - fd + 7) % 7) + 7 * (week - 1);
}

int64_t transition_utc(int year, int month, int week, int dow, int hour_local, int local_offset_min) {
  int day = nth_dow(year, month, week, dow);
  return epoch_from_civil(year, month, day, hour_local, 0, 0) - (int64_t)local_offset_min * 60;
}

bool parse_fixed_offset(const char *s, int16_t &out_min) {
  // "UTC", "UTC+10", "UTC-5:30", "UTC+10:00", "GMT+1", "+10:00", "-0530"
  const char *p = s;
  if (!strncmp(p, "UTC", 3) || !strncmp(p, "GMT", 3)) p += 3;
  if (!*p) { out_min = 0; return true; }
  int sign = 1;
  if (*p == '+') p++;
  else if (*p == '-') { sign = -1; p++; }
  else return false;
  if (*p < '0' || *p > '9') return false;
  int h = 0, m = 0;
  char *end = nullptr;
  h = (int)strtol(p, &end, 10);
  if (end == p) return false;
  // "+0530" form
  if (end - p == 4) { m = h % 100; h = h / 100; }
  p = end;
  if (*p == ':') { p++; m = (int)strtol(p, &end, 10); p = end; }
  if (*p) return false;
  if (h > 14 || m > 59) return false;
  out_min = (int16_t)(sign * (h * 60 + m));
  return true;
}

}  // namespace

bool parse(const char *name, Zone &out) {
  out = Zone();
  if (!name || !*name) return false;
  for (const Entry &e : TABLE) {
    if (strcmp(e.name, name) == 0) {
      snprintf(out.name, sizeof out.name, "%s", name);
      out.std_min = e.std_min;
      switch (e.fam) {
        case 'A': out.has_dst = true; out.rule = R_AU; break;
        case 'N': out.has_dst = true; out.rule = R_NZ; break;
        case 'U': out.has_dst = true; out.rule = R_US; break;
        case 'E': out.has_dst = true; out.rule = eu_rule(e.std_min / 60); break;
        default: break;
      }
      return true;
    }
  }
  int16_t fixed;
  if (parse_fixed_offset(name, fixed)) {
    snprintf(out.name, sizeof out.name, "%s", name);
    out.std_min = fixed;
    return true;
  }
  // "Etc/GMT-10" is UTC+10 (POSIX sign inversion).
  if (!strncmp(name, "Etc/GMT", 7) && parse_fixed_offset(name + 4, fixed)) {
    snprintf(out.name, sizeof out.name, "%s", name);
    out.std_min = (int16_t)-fixed;
    return true;
  }
  return false;
}

int offset_minutes(const Zone &z, int64_t t) {
  if (!z.has_dst) return z.std_min;
  Civil c;
  civil_from_epoch(t + (int64_t)z.std_min * 60, c);
  const Rule &r = z.rule;
  int64_t start = transition_utc(c.year, r.s_month, r.s_week, r.s_dow, r.s_hour, z.std_min);
  int64_t end = transition_utc(c.year, r.e_month, r.e_week, r.e_dow, r.e_hour, z.std_min + r.save_min);
  bool dst;
  if (start < end) dst = (t >= start && t < end);        // northern hemisphere
  else dst = (t >= start || t < end);                    // southern: DST spans the new year
  return z.std_min + (dst ? r.save_min : 0);
}

void civil_from_epoch(int64_t t, Civil &out) {
  int64_t days = t / 86400;
  int64_t rem = t % 86400;
  if (rem < 0) { rem += 86400; days--; }
  // Hinnant's civil_from_days
  const int64_t z = days + 719468;
  const int64_t era = (z >= 0 ? z : z - 146096) / 146097;
  const unsigned doe = (unsigned)(z - era * 146097);
  const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const int64_t y = (int64_t)yoe + era * 400;
  const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const unsigned mp = (5 * doy + 2) / 153;
  const unsigned d = doy - (153 * mp + 2) / 5 + 1;
  const unsigned m = mp + (mp < 10 ? 3 : -9);
  out.year = (int)(y + (m <= 2));
  out.month = (int)m;
  out.day = (int)d;
  out.hour = (int)(rem / 3600);
  out.minute = (int)((rem % 3600) / 60);
  out.second = (int)(rem % 60);
  int dw = (int)((days + 4) % 7);
  out.dow = dw < 0 ? dw + 7 : dw;
  out.yday = (int)(days - days_from_civil(out.year, 1, 1));
}

int64_t epoch_from_civil(int y, int m, int d, int hh, int mm, int ss) {
  return days_from_civil(y, m, d) * 86400 + (int64_t)hh * 3600 + (int64_t)mm * 60 + ss;
}

void local_time(const Zone &z, int64_t t, Civil &out) {
  civil_from_epoch(t + (int64_t)offset_minutes(z, t) * 60, out);
}

}  // namespace tz
}  // namespace quire
