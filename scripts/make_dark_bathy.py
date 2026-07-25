#!/usr/bin/env python3
"""
Derive a dark-console bathymetric basemap from the real GEBCO_2024 shaded-relief render.

GEBCO ships light cartography: pale green-cyan continental shelf, saturated blue in deep water,
green land. That is wrong for a near-black console. This remaps the REAL depth signal onto a dark
ramp rather than inventing one. Every output pixel derives from the GEBCO pixel underneath it.

Discriminators, measured from the actual raster (not assumed):
  land  : green-dominant, g - b > ~28   e.g. inland (97,192,125), coast (152,213,164)
  water : g - b <= 28                   e.g. shelf  (179,231,217), deep  (75,183,208)
  depth : b - r is monotonic with depth  shelf 38 .. deep 133   (luminance is NOT - the pale
          shelf and the mid-tone deep water both sit mid-luminance, which is what broke v1)
"""
import sys
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "/tmp/gebco_src.png"
DST = sys.argv[2] if len(sys.argv) > 2 else "/tmp/gebco_dark.png"

# dark ramp, shoal -> abyss
SHOAL = (26, 76, 90)
MID = (9, 36, 56)
ABYSS = (4, 9, 18)
LAND_LO = (8, 10, 13)
LAND_HI = (30, 36, 42)

DEPTH_SPAN = 150.0   # b-r range from shoal to abyss
LAND_GB = 28         # g-b above this is land


def lerp(a, b, t):
    return (int(a[0] + (b[0] - a[0]) * t),
            int(a[1] + (b[1] - a[1]) * t),
            int(a[2] + (b[2] - a[2]) * t))


def main():
    im = Image.open(SRC).convert("RGB")
    w, h = im.size
    src = im.load()
    out = Image.new("RGB", (w, h))
    dst = out.load()
    land_n = 0

    # precompute the two ramps at 256 steps so the inner loop is a lookup, not arithmetic
    water_lut = [lerp(SHOAL, MID, i / 127.5) if i < 128
                 else lerp(MID, ABYSS, (i - 128) / 127.5) for i in range(256)]
    land_lut = [lerp(LAND_LO, LAND_HI, i / 255.0) for i in range(256)]

    for y in range(h):
        for x in range(w):
            r, g, b = src[x, y]
            if (g - b) > LAND_GB:                      # land
                land_n += 1
                lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
                i = int(max(0.0, min(1.0, (lum - 0.55) / 0.40)) * 255)
                dst[x, y] = land_lut[i]
            else:                                       # water
                t = max(0.0, min(1.0, (b - r) / DEPTH_SPAN))
                dst[x, y] = water_lut[int(t * 255)]

    out.save(DST)
    tot = w * h
    print(f"wrote {DST} {im.size}  land={land_n/tot*100:.1f}% water={(tot-land_n)/tot*100:.1f}%")


if __name__ == "__main__":
    main()
