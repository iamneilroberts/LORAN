#!/usr/bin/env python3
"""
Bake political boundary lines into a compact JSON the frontend can draw as batched polylines.

Build time only, like build_places.py - nothing here runs in production, and the output is
committed so a clone does not need network access to build.

    python3 scripts/build_boundaries.py            # cached sources
    python3 scripts/build_boundaries.py --refresh  # re-download

Sources, both Natural Earth and both public domain:

  ne_50m_admin_1_states_provinces   states/provinces, WORLDWIDE, 858 rings
  ne_10m_admin_2_counties           counties, UNITED STATES ONLY, 3,619 rings

The 50m cut is deliberate for states: the 10m version is 39.8 MiB of print-scale detail, and at
the zoom a globe console actually sits at, none of that detail is distinguishable from the 50m
line. Counties are only published at 10m, so there is no choice to make there.

MEASURED before committing to this (D-063). Baked, at the shipped 0.01 degree tolerance:
states 734 KiB (248 KiB gzipped), counties 874 KiB (242 KiB gzipped) - each comparable to the
already-bundled places.json (671 KiB / 278 KiB gzipped). That measurement is the reason both are
BUNDLED rather than lazily fetched: D-052's lazy path exists for a 3.4 MiB file, roughly five
times this, and adding a second fetch path plus its loading state to save ~240 KiB would be
machinery bought for nothing. Counties still default OFF, for density and because they are US-only.
"""
import argparse
import json
import math
import urllib.request
from pathlib import Path

# Derived from this file's location - never absolute (D-019, open source).
ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
OUT_FILE = ROOT / "frontend" / "src" / "data" / "boundaries.json"

NE_BASE = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
)
STATES_NAME = "ne_50m_admin_1_states_provinces"
COUNTIES_NAME = "ne_10m_admin_2_counties"

# Douglas-Peucker tolerance in degrees. 0.01 deg is ~1.1 km, which is roughly a pixel at the
# zoom this console is normally flown at, and keeps river borders - the Mississippi, the Ohio -
# recognisably wiggly rather than polygonised. Owner-chosen from a measured table of four
# tolerances; 0.02 saved ~30% and visibly cornered the river borders, 0.005 cost ~40% more for
# detail that is not distinguishable on screen.
TOLERANCE_DEG = 0.01

# Coordinate rounding. 3 decimal places is ~110 m, an order of magnitude finer than the
# simplification tolerance above, so it discards nothing the simplifier kept.
COORD_PLACES = 3


def fetch(url: str, dest: Path, refresh: bool) -> Path:
    """Download to dest unless already cached, so a rebuild is offline and fast."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and not refresh:
        print(f"  cached  {dest.relative_to(ROOT)} ({dest.stat().st_size:,} bytes)")
        return dest
    print(f"  fetch   {url}")
    # A contact-carrying UA is the courtesy this project uses everywhere it hits a third party.
    req = urllib.request.Request(url, headers={"User-Agent": "loran build_boundaries.py"})
    with urllib.request.urlopen(req, timeout=180) as r, dest.open("wb") as f:
        f.write(r.read())
    print(f"  wrote   {dest.relative_to(ROOT)} ({dest.stat().st_size:,} bytes)")
    return dest


def rings(geom: dict) -> list[list]:
    """Every closed ring in a Polygon or MultiPolygon, holes included - a hole is a border too."""
    if not geom:
        return []
    kind, coords = geom.get("type"), geom.get("coordinates") or []
    if kind == "Polygon":
        return list(coords)
    if kind == "MultiPolygon":
        return [ring for poly in coords for ring in poly]
    return []


def _perp(p, a, b) -> float:
    """
    Perpendicular distance from p to segment a-b, in degrees, with longitude scaled by cos(lat).

    Without that scaling a degree of longitude would count as much as a degree of latitude, and
    at 60 degrees north it is half as long on the ground - which would over-simplify Alaska and
    the Canadian provinces while under-simplifying the tropics.
    """
    k = math.cos(math.radians(p[1])) or 1e-6
    px, py = p[0] * k, p[1]
    ax, ay = a[0] * k, a[1]
    bx, by = b[0] * k, b[1]
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify(pts: list, tol: float) -> list:
    """
    Douglas-Peucker. Iterative rather than recursive: some coastline rings run to thousands of
    points and the recursive form overflows Python's stack on them.
    """
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        worst, worst_i = -1.0, -1
        for k in range(i + 1, j):
            d = _perp(pts[k], pts[i], pts[j])
            if d > worst:
                worst, worst_i = d, k
        if worst > tol:
            keep[worst_i] = True
            stack.append((i, worst_i))
            stack.append((worst_i, j))
    return [p for p, k in zip(pts, keep) if k]


def bake(path: Path) -> tuple[list[list[float]], int, int]:
    """
    Every ring, simplified and flattened to [lon, lat, lon, lat, ...].

    Flat rather than nested pairs because Cesium wants a flat degree array anyway
    (Cartesian3.fromDegreesArray), and it drops roughly a third of the JSON's punctuation.
    """
    gj = json.loads(path.read_text())
    out: list[list[float]] = []
    pts_in = pts_out = 0
    for feature in gj.get("features", []):
        for ring in rings(feature.get("geometry") or {}):
            pts_in += len(ring)
            kept = simplify(ring, TOLERANCE_DEG)
            # A ring that simplifies below two points is a speck at this tolerance - an islet
            # smaller than the line width. Dropped rather than drawn as a degenerate segment.
            if len(kept) < 2:
                continue
            pts_out += len(kept)
            flat: list[float] = []
            for lon, lat in kept:
                flat.append(round(lon, COORD_PLACES))
                flat.append(round(lat, COORD_PLACES))
            out.append(flat)
    return out, pts_in, pts_out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--refresh", action="store_true", help="re-download the Natural Earth sources")
    args = ap.parse_args()

    print("boundaries:")
    states_src = fetch(NE_BASE + STATES_NAME + ".geojson",
                       RAW_DIR / f"{STATES_NAME}.geojson", args.refresh)
    counties_src = fetch(NE_BASE + COUNTIES_NAME + ".geojson",
                         RAW_DIR / f"{COUNTIES_NAME}.geojson", args.refresh)

    states, s_in, s_out = bake(states_src)
    print(f"  states    {len(states):>5} rings  {s_in:>7} -> {s_out:>7} points")
    counties, c_in, c_out = bake(counties_src)
    print(f"  counties  {len(counties):>5} rings  {c_in:>7} -> {c_out:>7} points")

    payload = {
        "_sources": {
            "states": f"Natural Earth (public domain) {NE_BASE + STATES_NAME}.geojson",
            "counties": f"Natural Earth (public domain) {NE_BASE + COUNTIES_NAME}.geojson",
        },
        "_note": (
            "Built by scripts/build_boundaries.py. Rings are flat [lon,lat,...] degree arrays, "
            f"Douglas-Peucker simplified at {TOLERANCE_DEG} deg (~1.1 km) and rounded to "
            f"{COORD_PLACES} dp. COUNTIES ARE UNITED STATES ONLY - Natural Earth publishes no "
            "admin_2 layer for the rest of the world."
        ),
        "states": states,
        "counties": counties,
    }
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"  wrote   {OUT_FILE.relative_to(ROOT)} "
          f"({OUT_FILE.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
