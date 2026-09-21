// Device display for the LilyGo T5 E-Paper S3 Pro: the app draws into its own
// portrait 4-bit framebuffer with the shared glyph renderer (exactly as the
// emulator does), and this layer hands that buffer to epdiy — the same driver
// and board definition LilyGo's factory firmware uses on this hardware.
#include "app.h"
#include <Wire.h>
#include <esp_heap_caps.h>
extern "C" {
#include "epdiy.h"
#include "epd_highlevel.h"
}
#include "fonts/roboto8.h"
#include "fonts/roboto9.h"
#include "fonts/roboto11.h"
#include "fonts/roboto13.h"
#include "fonts/roboto13bold.h"
#include "fonts/roboto16.h"
#include "fonts/roboto18.h"
#include "fonts/roboto28.h"

extern "C" int epd_fb_width = 540;
extern "C" int epd_fb_height = 960;

namespace fonts {
    const GFXfont *sm = &Roboto11;
    const GFXfont *md = &Roboto16;
    const GFXfont *lg = &Roboto18;
    const GFXfont *xl = &Roboto28;
    const GFXfont *title = &Roboto13;
    const GFXfont *titleBold = &Roboto13Bold;
    const GFXfont *meta = &Roboto9;
    const GFXfont *bodyS = &Roboto8;
    const GFXfont *bodyM = &Roboto11;
    const GFXfont *bodyL = &Roboto13;
}

namespace gfx {

uint8_t *fb = nullptr;
int footerH = 44;
static bool darkMode = false;
static EpdiyHighlevelState hl;
static bool panelUp = false;

static size_t fbBytes() { return (size_t)EPD_WIDTH / 2 * EPD_HEIGHT; }

bool begin() {
    // Wire is already up on the shared bus; epdiy's own driver install then
    // fails harmlessly and it talks to the PMIC and expander through the
    // port Wire installed — the factory firmware relies on the same thing.
    epd_init(&epd_board_v7, &ED047TC1, EPD_LUT_64K);
    hl = epd_hl_init(EPD_BUILTIN_WAVEFORM);
    epd_set_rotation(EPD_ROT_INVERTED_PORTRAIT);     // the phone's "up", as the factory UI has it
    epd_fb_width = epd_rotated_display_width();
    epd_fb_height = epd_rotated_display_height();
    log_i("panel %dx%d rotated, temperature %.0f C", epd_fb_width, epd_fb_height, epd_ambient_temperature());

    fb = (uint8_t *)heap_caps_malloc(fbBytes(), MALLOC_CAP_SPIRAM);
    if (!fb) return false;
    clearBuffer();
    epd_hl_set_all_white(&hl);
    epd_poweron();
    epd_clear();
    epd_poweroff();
    panelUp = true;
    return true;
}

int W() { return EPD_WIDTH; }
int H() { return EPD_HEIGHT; }
void setDark(bool on) { darkMode = on; }
bool isDark() { return darkMode; }
uint8_t paper()  { return darkMode ? 0x00 : 0xFF; }
uint8_t inkC()   { return darkMode ? 0xFF : 0x00; }
uint8_t ruleC()  { return darkMode ? 0x90 : 0x80; }
uint8_t faintC() { return darkMode ? 0x38 : 0xE0; }
uint8_t dimC()   { return darkMode ? 0x66 : 0x99; }
void clearBuffer() { memset(fb, paper(), fbBytes()); }

// Our buffer is in rotated (portrait) coordinates; epdiy applies the rotation
// while copying into its native landscape framebuffer, then drives only the
// pixels that changed since the last update.
static void present(enum EpdDrawMode mode) {
    if (!panelUp) return;
    EpdRect area = {0, 0, EPD_WIDTH, EPD_HEIGHT};
    epd_draw_rotated_image(area, fb, epd_hl_get_framebuffer(&hl));
    epd_poweron();
    enum EpdDrawError e = epd_hl_update_screen(&hl, mode, (int)epd_ambient_temperature());
    epd_poweroff();
    if (e != EPD_DRAW_SUCCESS) log_e("update failed: %d", (int)e);
}
void flushFull() { present(MODE_GC16); }
void flushRegion(int, int, int, int, bool clean) { present(clean ? MODE_GC16 : MODE_GL16); }
void powerDown() { if (panelUp) epd_poweroff(); }

// ---- text (identical to the emulator's) -----------------------------------
static FontProperties propsFor(Tone t) {
    uint8_t fg, bg;
    if (!darkMode) {
        bg = 15;
        switch (t) {
            case TONE_DIM:   fg = 7;  break;
            case TONE_FAINT: fg = 12; break;
            case TONE_READ:  fg = 9;  break;
            case TONE_INV:   fg = 15; bg = 0; break;
            default:         fg = 0;  break;
        }
    } else {
        bg = 0;
        switch (t) {
            case TONE_DIM:   fg = 8;  break;
            case TONE_FAINT: fg = 4;  break;
            case TONE_READ:  fg = 6;  break;
            case TONE_INV:   fg = 0;  bg = 15; break;
            default:         fg = 15; break;
        }
    }
    FontProperties p;
    p.fg_color = fg; p.bg_color = bg; p.fallback_glyph = '?'; p.flags = 0;
    return p;
}

int textW(const GFXfont *f, const char *s) {
    if (!s || !*s) return 0;
    int w = 0;
    const uint8_t *p = (const uint8_t *)s;
    while (*p) {
        uint32_t cp = *p++;
        if (cp >= 0x80) {
            int extra = (cp & 0xE0) == 0xC0 ? 1 : (cp & 0xF0) == 0xE0 ? 2 : (cp & 0xF8) == 0xF0 ? 3 : 0;
            cp &= (0x3F >> extra);
            while (extra-- && *p) cp = (cp << 6) | (*p++ & 0x3F);
        }
        GFXglyph *g = nullptr;
        get_glyph(f, cp, &g);
        if (!g) get_glyph(f, '?', &g);
        if (g) w += g->advance_x;
    }
    return w;
}
int drawText(const GFXfont *f, const char *s, int x, int baselineY, Tone t) {
    if (!s || !*s) return x;
    int32_t cx = x, cy = baselineY;
    FontProperties p = propsFor(t);
    write_mode(f, s, &cx, &cy, fb, BLACK_ON_WHITE, &p);
    return (int)cx;
}
int drawRight(const GFXfont *f, const String &s, int rightX, int baselineY, Tone t) {
    return drawText(f, s.c_str(), rightX - textW(f, s.c_str()), baselineY, t);
}
int drawTextTrunc(const GFXfont *f, const String &s, int x, int baselineY, int maxW, Tone t) {
    if (s.length() == 0) return x;
    if (textW(f, s.c_str()) <= maxW) return drawText(f, s.c_str(), x, baselineY, t);
    int lo = 0, hi = s.length();
    while (lo < hi) {
        int mid = (lo + hi + 1) / 2;
        String cand = s.substring(0, mid) + "...";
        if (textW(f, cand.c_str()) <= maxW) lo = mid; else hi = mid - 1;
    }
    String out = s.substring(0, lo);
    out.trim();
    out += "...";
    return drawText(f, out.c_str(), x, baselineY, t);
}
int drawWrapped(const GFXfont *f, const String &s, int x, int topY, int maxW,
                int lineH, int maxLines, bool draw, Tone tone) {
    const int n = (int)s.length();
    int line = 0, i = 0;
    while (i <= n && line < maxLines) {
        int nl = s.indexOf('\n', i);
        int segEnd = (nl < 0) ? n : nl;
        if (segEnd <= i) { line++; if (nl < 0) break; i = segEnd + 1; continue; }
        int cur = i;
        while (cur < segEnd && line < maxLines) {
            int best = cur, probe = cur;
            while (probe < segEnd) {
                int sp = s.indexOf(' ', probe + 1);
                if (sp < 0 || sp > segEnd) sp = segEnd;
                if (textW(f, s.substring(cur, sp).c_str()) <= maxW) { best = sp; probe = sp; } else break;
            }
            if (best == cur) {
                int k = cur + 1;
                while (k < segEnd && textW(f, s.substring(cur, k + 1).c_str()) <= maxW) k++;
                best = (k > cur) ? k : cur + 1;
            }
            if (draw) { String ln = s.substring(cur, best); ln.trim();
                        if (ln.length()) drawText(f, ln.c_str(), x, topY + line * lineH + lineH - 6, tone); }
            line++; cur = best;
            while (cur < segEnd && s[cur] == ' ') cur++;
        }
        if (nl < 0) break;
        i = segEnd + 1;
    }
    return line;
}

static inline void setPx(int x, int y, uint8_t color) {
    if (x < 0 || x >= EPD_WIDTH || y < 0 || y >= EPD_HEIGHT) return;
    uint8_t *p = &fb[(size_t)y * (EPD_WIDTH / 2) + x / 2];
    if (x & 1) *p = (*p & 0x0F) | (color & 0xF0);
    else       *p = (*p & 0xF0) | (color >> 4);
}
void rect(int x, int y, int w, int h, uint8_t color) {
    for (int j = y; j < y + h; j++) for (int i = x; i < x + w; i++) setPx(i, j, color);
}
void hline(int x, int y, int w, uint8_t color) { for (int i = x; i < x + w; i++) setPx(i, y, color); }
void frame(int x, int y, int w, int h, uint8_t color) {
    hline(x, y, w, color); hline(x, y + h - 1, w, color);
    for (int j = y; j < y + h; j++) { setPx(x, j, color); setPx(x + w - 1, j, color); }
}

}  // namespace gfx

// ---- battery: BQ27220 fuel gauge on the shared bus -------------------------
static bool gaugeRead(uint8_t reg, uint16_t &v) {
    Wire.beginTransmission(0x55);
    Wire.write(reg);
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom((uint8_t)0x55, (uint8_t)2) != 2) return false;
    v = Wire.read();
    v |= (uint16_t)Wire.read() << 8;
    return true;
}
uint32_t batteryMilliVolts() { uint16_t v; return gaugeRead(0x08, v) ? v : 0; }
int batteryPercent()         { uint16_t s; return gaugeRead(0x2C, s) ? (int)s : -1; }
