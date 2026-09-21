#!/usr/bin/env python3
"""Generate the compiled-in font tables, spec/fonts.json and the board profile header.

Line-height targets come from design/tokens/tokens.json (`profiles.<name>.type.<size>.line`), one
entry per profile in design/profiles.json. Every profile's metrics and advances go into
spec/fonts.json; only the board profile (--profile, default t5pro) gets C tables under
src/runtime/fonts/ plus src/runtime/profile_gen.h (chrome sizes, icon sizes, tones).

Adapted from epdiy's scripts/fontconvert.py (MIT) to emit our own header format (see
firmware/src/runtime/fontlib.h): the bitmap packing is identical (4 bpp, two pixels per byte, low
nibble = left pixel, ceil(width/2) bytes per glyph row, 15 = fully inked), but the tables are plain
C++ constants that do not include epdiy.h, so the runtime stays independent of the panel driver.

Run:  uv venv firmware/.venv && uv pip install --python firmware/.venv/bin/python freetype-py
      firmware/.venv/bin/python firmware/tools/gen_fonts.py
"""
import argparse
import json
import math
import os
import sys

try:
    import freetype
except ImportError:
    sys.exit("pip install freetype-py (see docstring)")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # firmware/
REPO = os.path.dirname(ROOT)
FONT_DIR = os.path.join(ROOT, "fonts")
OUT_DIR = os.path.join(ROOT, "src", "runtime", "fonts")
PROFILE_H = os.path.join(ROOT, "src", "runtime", "profile_gen.h")
SPEC_JSON = os.path.join(REPO, "spec", "fonts.json")
TOKENS = os.path.join(REPO, "design", "tokens", "tokens.json")
PROFILES = os.path.join(REPO, "design", "profiles.json")

SIZE_TOKENS = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"]
WEIGHTS = {"regular": "Roboto-Regular.ttf", "bold": "Roboto-Bold.ttf"}

# Printable ASCII, Latin-1 Supplement, and the handful of typographic symbols the spec lists.
# Code points the TTF lacks (Roboto has no U+2190/U+2192 arrows) are dropped from the tables and
# fall back to '?' at draw time; see spec/NOTES-firmware.md.
INTERVALS_FULL = [(32, 126), (160, 255), (0x2013, 0x2014), (0x2022, 0x2022), (0x2026, 0x2026),
                  (0x20AC, 0x20AC), (0x2190, 0x2193)]
INTERVALS_DIGITS = [(32, 32), (37, 37), (45, 46), (48, 58), (176, 176)]


def face_metrics(face):
    """advance_y, ascender, descender exactly as fontconvert.py computes them."""
    m = face.size
    return (int(math.ceil(m.height / 64)), int(math.ceil(m.ascender / 64)), int(math.floor(m.descender / 64)))


def pick_char_size(face, target_lh):
    """Find the largest 26.6 char size (at 72 dpi, so units are pixels) whose line height equals
    target_lh. Falls back to the closest line height."""
    best = None
    lo = int(target_lh / 1.4 * 64)
    hi = int(target_lh / 1.0 * 64)
    for cs in range(lo, hi + 1):
        face.set_char_size(cs, cs, 72, 72)
        lh, _, _ = face_metrics(face)
        if lh == target_lh:
            best = cs                      # keep going: we want the largest matching size
        elif lh > target_lh:
            break
    if best is not None:
        return best, target_lh
    # closest
    closest = None
    for cs in range(lo, hi + 1):
        face.set_char_size(cs, cs, 72, 72)
        lh, _, _ = face_metrics(face)
        d = abs(lh - target_lh)
        if closest is None or d < closest[0]:
            closest = (d, cs, lh)
    return closest[1], closest[2]


def present_intervals(face, intervals):
    """Rebuild the interval list from the code points the face actually has."""
    cps = []
    for a, b in intervals:
        for cp in range(a, b + 1):
            if face.get_char_index(cp) != 0:
                cps.append(cp)
            else:
                print(f"  dropping U+{cp:04X}: not in this font", file=sys.stderr)
    out = []
    for cp in cps:
        if out and out[-1][1] == cp - 1:
            out[-1] = (out[-1][0], cp)
        else:
            out.append((cp, cp))
    return out


def render_font(ttf, char_size, intervals):
    face = freetype.Face(ttf)
    face.set_char_size(char_size, char_size, 72, 72)
    intervals = present_intervals(face, intervals)
    glyphs = []
    data = bytearray()
    advances = {}
    for a, b in intervals:
        for cp in range(a, b + 1):
            gi = face.get_char_index(cp)
            face.load_glyph(gi, freetype.FT_LOAD_RENDER)
            bm = face.glyph.bitmap
            w, h = bm.width, bm.rows
            rowbytes = (w + 1) // 2
            packed = bytearray(rowbytes * h)
            buf = bm.buffer
            pitch = bm.pitch
            for y in range(h):
                for x in range(w):
                    v = buf[y * pitch + x] >> 4
                    i = y * rowbytes + x // 2
                    if x & 1:
                        packed[i] |= v << 4
                    else:
                        packed[i] |= v
            adv = int(math.floor(face.glyph.advance.x / 64))
            glyphs.append(dict(width=w, height=h, advance_x=adv, left=face.glyph.bitmap_left,
                               top=face.glyph.bitmap_top, size=len(packed), data_offset=len(data), cp=cp))
            data += packed
            advances[chr(cp)] = adv
    lh, asc, desc = face_metrics(face)
    return dict(glyphs=glyphs, data=bytes(data), intervals=intervals, advance_y=lh, ascender=asc,
                descender=desc, advances=advances)


def write_header(path, cname, f, source, char_size):
    with open(path, "w") as o:
        o.write("// Generated by tools/gen_fonts.py from %s (Apache-2.0, Google) at %.2f px. Do not edit.\n"
                % (source, char_size / 64))
        o.write("#pragma once\n#include \"../fontlib.h\"\nnamespace quire { namespace fonts {\n")
        o.write("static const uint8_t %s_bitmap[%d] = {\n" % (cname, max(1, len(f["data"]))))
        d = f["data"] or b"\0"
        for i in range(0, len(d), 32):
            o.write(",".join(str(b) for b in d[i:i + 32]) + ",\n")
        o.write("};\nstatic const fontlib::Glyph %s_glyphs[] = {\n" % cname)
        for g in f["glyphs"]:
            o.write("{%d,%d,%d,%d,%d,%d,%d}, // U+%04X\n" % (g["width"], g["height"], g["advance_x"], g["left"],
                                                          g["top"], g["size"], g["data_offset"], g["cp"]))
        o.write("};\nstatic const fontlib::Interval %s_intervals[] = {\n" % cname)
        off = 0
        for a, b in f["intervals"]:
            o.write("{0x%X,0x%X,%d},\n" % (a, b, off))
            off += b - a + 1
        o.write("};\nconst fontlib::Font %s = { %s_bitmap, %s_glyphs, %s_intervals, %d, false, %d, %d, %d };\n"
                % (cname, cname, cname, cname, len(f["intervals"]), f["advance_y"], f["ascender"], f["descender"]))
        o.write("}}  // namespace quire::fonts\n")


def build_profile(name, tok, want_tables):
    """Returns (spec entry, list of (token, weight, cname, header)) for one profile."""
    spec_sizes = {}
    headers = []
    total_bytes = 0
    for token in SIZE_TOKENS + ["digits"]:
        target = tok["type"][token]["line"]
        entry = {}
        weights = ["bold"] if token == "digits" else ["regular", "bold"]
        for weight in weights:
            ttf = os.path.join(FONT_DIR, WEIGHTS[weight])
            face = freetype.Face(ttf)
            cs, lh = pick_char_size(face, target)
            intervals = INTERVALS_DIGITS if token == "digits" else INTERVALS_FULL
            f = render_font(ttf, cs, intervals)
            if want_tables:
                cname = "font_%s_%s" % (token.replace("2xl", "xxl").replace("3xl", "xxxl"), weight)
                hdr = "%s.h" % cname
                write_header(os.path.join(OUT_DIR, hdr), cname, f, os.path.basename(ttf), cs)
                headers.append((token, weight, cname, hdr))
                total_bytes += len(f["data"]) + 16 * len(f["glyphs"])
            fallback = f["advances"].get("?", f["advances"].get("0", 0))
            entry["line_height"] = f["advance_y"]
            entry["ascent"] = f["ascender"]
            entry["descent"] = -f["descender"]
            entry["px"] = round(cs / 64, 2)
            entry[weight] = {"default_advance": fallback, "advance": f["advances"]}
            flag = "" if f["advance_y"] == target else "  (target %d NOT met)" % target
            print("%-9s %-6s %-7s %6.2f px  line %3d  asc %3d  glyphs %3d%s" %
                  (name, token, weight, cs / 64, f["advance_y"], f["ascender"], len(f["glyphs"]), flag), file=sys.stderr)
        if token == "digits":
            entry["regular"] = entry["bold"]          # digits has one face; regular maps to it
        spec_sizes[token] = entry
    if want_tables:
        print("%s: %.1f kB of glyph tables" % (name, total_bytes / 1024), file=sys.stderr)
    return spec_sizes, headers


def write_profile_header(name, tok):
    ch = tok["chrome"]
    tone = tok["tone"]["light"]
    with open(PROFILE_H, "w") as o:
        o.write("// Generated by tools/gen_fonts.py from design/tokens/tokens.json for profile %s. Do not edit.\n" % name)
        o.write("#pragma once\nnamespace quire { namespace profile {\n")
        o.write('static const char NAME[] = "%s";\n' % name)
        o.write("static const int DPI = %d, GREYS = %d, UNIT = %d;\n" % (tok["dpi"], tok["greys"], tok["u"]))
        o.write("static const int MARGIN = %d, GUTTER = %d, INSET = %d, GAP = %d;\n" % (tok["space"]["page"], tok["space"]["gutter"], tok["space"]["inset"], tok["space"]["gap"]))
        o.write("static const int STATUS = %d, NAV = %d, TOOLBAR = %d, RAIL = %d, CORNER = %d, TOAST = %d;\n" % (ch["status"], ch["nav"], ch["toolbar"], ch["rail"], ch["corner"], ch["toast"]))
        o.write("static const int ICON_SM = %d, ICON_MD = %d, ICON_LG = %d;\n" % (tok["icon"]["sm"], tok["icon"]["md"], tok["icon"]["lg"]))
        o.write("static const int TOUCH_MIN = %d, TOUCH_ROW = %d;\n" % (tok["touch_target"]["min"], tok["touch_target"]["row"]))
        o.write("static const int RADIUS_SM = %d, RADIUS_MD = %d, RADIUS_LG = %d;\n" % (tok["radius"]["sm"], tok["radius"]["md"], tok["radius"]["lg"]))
        o.write("static const int STROKE_HAIRLINE = %d, STROKE_RULE = %d, STROKE_FRAME = %d;\n" % (tok["stroke"]["hairline"], tok["stroke"]["rule"], tok["stroke"]["frame"]))
        o.write("// Tones (light): ink levels 0..15\n")
        o.write("static const int TONE_PAPER = %d, TONE_INK = %d, TONE_SECONDARY = %d, TONE_TERTIARY = %d, TONE_HAIRLINE = %d, TONE_FILL_SUBTLE = %d, TONE_FILL_DISABLED = %d;\n" %
                (tone["paper"], tone["ink"], tone["secondary"], tone["tertiary"], tone["hairline"], tone["fill_subtle"], tone["fill_disabled"]))
        o.write("}}\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", default="t5pro", help="board profile that gets C tables")
    args = ap.parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)
    tokens = json.load(open(TOKENS))["profiles"]
    profiles = json.load(open(PROFILES))["profiles"]
    if args.profile not in tokens:
        sys.exit("unknown profile %s" % args.profile)
    spec = {"spec_version": 1, "profiles": {}}
    board_headers = []
    for name in profiles:
        tok = tokens[name]
        want = name == args.profile
        sizes, headers = build_profile(name, tok, want)
        if want:
            board_headers = headers
            write_profile_header(name, tok)
        spec["profiles"][name] = {
            "dpi": tok["dpi"], "native": tok["native"], "default_orientation": tok["default_orientation"],
            "greys": tok["greys"], "sizes": sizes, "icons": dict(tok["icon"]),
            "chrome": {"margin": tok["space"]["page"], "nav": tok["chrome"]["nav"], "toolbar": tok["chrome"]["toolbar"],
                       "status": tok["chrome"]["status"], "corner": tok["chrome"]["corner"]},
        }

    with open(os.path.join(OUT_DIR, "fonts_all.h"), "w") as o:
        o.write("// Generated by tools/gen_fonts.py for profile %s. Included from fontlib.cpp only.\n#pragma once\n" % args.profile)
        for _, _, _, hdr in board_headers:
            o.write('#include "%s"\n' % hdr)
        o.write("namespace quire { namespace fonts {\n")
        o.write("// [size][weight]; digits uses the bold face for both weights.\n")
        o.write("static const fontlib::Font *const TABLE[%d][2] = {\n" % (len(SIZE_TOKENS) + 1))
        for token in SIZE_TOKENS + ["digits"]:
            names = {w: c for t, w, c, _ in board_headers if t == token}
            reg = names.get("regular", names.get("bold"))
            o.write("  { &%s, &%s },\n" % (reg, names["bold"]))
        o.write("};\n}}\n")

    with open(SPEC_JSON, "w") as o:
        json.dump(spec, o, ensure_ascii=False, separators=(",", ":"))
        o.write("\n")
    print("-> %s (%d profiles), %s, %s" % (SPEC_JSON, len(spec["profiles"]), OUT_DIR, PROFILE_H), file=sys.stderr)


if __name__ == "__main__":
    main()
