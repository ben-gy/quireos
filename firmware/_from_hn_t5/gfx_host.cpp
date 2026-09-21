// Host display: the device's 4bpp framebuffer and the *actual* EPD47 glyph
// renderer (font.c), so text is pixel-identical to the panel. "Flushing" just
// bumps a version number the web page polls.
#include "emu.h"
#include "fonts/roboto8.h"
#include "fonts/roboto9.h"
#include "fonts/roboto11.h"
#include "fonts/roboto13.h"
#include "fonts/roboto13bold.h"
#include "fonts/roboto16.h"
#include "fonts/roboto18.h"
#include "fonts/roboto28.h"

volatile int emu_frameVersion = 0;
extern "C" int epd_fb_width = 960;
extern "C" int epd_fb_height = 540;

namespace fonts {
    const GFXfont *sm = &Roboto11;          // 30 px line: status, bar labels
    const GFXfont *md = &Roboto16;          // 44: messages, busy box
    const GFXfont *lg = &Roboto18;          // 49: message titles
    const GFXfont *xl = &Roboto28;          // 77: setup screen title
    const GFXfont *title = &Roboto13;       // metrics for title rows
    const GFXfont *titleBold = &Roboto13Bold;
    const GFXfont *meta = &Roboto9;         // 25: facts lines, bylines
    const GFXfont *bodyS = &Roboto8;        // 22
    const GFXfont *bodyM = &Roboto11;       // 30
    const GFXfont *bodyL = &Roboto13;       // 36
}

namespace gfx {

uint8_t *fb = nullptr;
static bool darkMode = false;
static size_t fbBytes() { return (size_t)EPD_WIDTH / 2 * EPD_HEIGHT; }

bool begin() {
    fb = (uint8_t *)calloc(fbBytes(), 1);
    if (!fb) return false;
    clearBuffer();
    return true;
}
int footerH = 44;
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
void flushFull() { emu_frameVersion++; }
void flushRegion(int, int, int, int, bool) { emu_frameVersion++; }
void powerDown() {}

// Same packing as epd_draw_pixel on the device: even x in the low nibble.
static inline void setPx(int x, int y, uint8_t color) {
    if (x < 0 || x >= EPD_WIDTH || y < 0 || y >= EPD_HEIGHT) return;
    uint8_t *p = &fb[(size_t)y * (EPD_WIDTH / 2) + x / 2];
    if (x & 1) *p = (*p & 0x0F) | (color & 0xF0);
    else       *p = (*p & 0xF0) | (color >> 4);
}

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

// Width the cursor will actually advance: the renderer steps by advance_x per
// glyph, whereas get_text_bounds() reports ink bounds and drops trailing
// bearings, which under-measures a line by a few pixels per word.
int textW(const GFXfont *f, const char *s) {
    if (!s || !*s) return 0;
    int w = 0;
    const uint8_t *p = (const uint8_t *)s;
    while (*p) {
        uint32_t cp = *p++;
        if (cp >= 0x80) {                              // decode UTF-8
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

void rect(int x, int y, int w, int h, uint8_t color) {
    for (int j = y; j < y + h; j++) for (int i = x; i < x + w; i++) setPx(i, j, color);
}
void hline(int x, int y, int w, uint8_t color) { for (int i = x; i < x + w; i++) setPx(i, y, color); }
void frame(int x, int y, int w, int h, uint8_t color) {
    hline(x, y, w, color); hline(x, y + h - 1, w, color);
    for (int j = y; j < y + h; j++) { setPx(x, j, color); setPx(x + w - 1, j, color); }
}

}  // namespace gfx

void gfx_host_setSize(int w, int h) {
    epd_fb_width = w;
    epd_fb_height = h;
    gfx::fb = (uint8_t *)realloc(gfx::fb, (size_t)w / 2 * h);
    gfx::clearBuffer();
}

uint32_t batteryMilliVolts() { return 3950; }   // pretend a healthy cell is fitted
