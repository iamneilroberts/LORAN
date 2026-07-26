#!/usr/bin/env python3
"""
Build-time place markers: airfields and city labels (D-023, D-032, D-033).

Turns two public-domain datasets into ONE compact JSON file that the frontend imports at
build time. Deliberately not an API: no key, no rate limit, nothing new in the request path,
and no runtime dependency on a third party staying up.

    python3 scripts/build_places.py            # use cached raw files, or download if absent
    python3 scripts/build_places.py --refresh   # re-download the raw files first

Raw downloads land in data/raw/ (gitignored, ~18 MB). Only the processed output is committed.

Sources, both public domain:
  OurAirports    https://ourairports.com/data/          airports.csv
  Natural Earth  https://www.naturalearthdata.com/      ne_10m_populated_places_simple

WHAT IS LEFT OUT, and why (D-032, tightened by D-037 on owner instruction to err on the side
of legibility): ONLY large and medium airports are drawn. Small airports (42,698), heliports
(23,135), seaplane bases and balloonports are excluded outright - ~66,000 extra markers
worldwide, 321 inside 2 degrees of Mobile alone. Large and medium airports are where the
traffic ADS-B actually shows us operates. Cities below Natural Earth scalerank 8 are dropped
for the same reason. The exclusion applies to MILITARY fields too: military is a colour
distinction inside the large/medium set, never a reason to add a marker back.

MILITARY DETECTION IS A NAME HEURISTIC, NOT A FLAG (D-033). OurAirports has no military
type and no "military" keyword - verified: 0 of 25,104 US non-closed airports carry it. So
we match the name, which is real data from the file rather than an invented attribute. It
has honest false negatives: KVPS is Eglin AFB but is named "Destin-Fort Walton Beach
Airport", so it renders civil. Do not present this as an authoritative order of battle.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import urllib.request
from pathlib import Path

# Paths are derived from this file's location - never absolute (D-019, open source).
ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
OUT_FILE = ROOT / "frontend" / "src" / "data" / "places.json"
# Fetched at RUNTIME rather than bundled, so it must live under public/ where Vite copies it
# through untouched. Bundling it would defeat the entire point of the lazy load.
SMALL_OUT_FILE = ROOT / "frontend" / "public" / "places-small.json"

AIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
PLACES_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
    "ne_10m_populated_places_simple.geojson"
)

# Kind codes, kept numeric so the JSON stays small. The frontend maps these to colour+range.
KIND_LARGE = 0
KIND_MEDIUM = 1
KIND_MILITARY = 2
# Small airports (D-052). They live in their OWN file, not in places.json, because the layer is
# off by default and ~42,700 rows is several megabytes: making every visitor download that for a
# feature they have not switched on would be a poor trade in a project that is served over a
# home tunnel. The frontend fetches this file lazily, the first time the toggle is enabled.
KIND_SMALL = 3

# Word-boundary matched against the airport NAME. "Air Base" is what carries most of the
# non-US coverage (529 large/medium hits); the US ones are mostly AFB / NAS / AAF spellings.
MILITARY_NAME = re.compile(
    r"\b("
    r"AFB|Air Force Base|Air Force Station|Air Base|Airbase"
    r"|Naval Air Station|NAS|Naval Air Facility|Naval Station"
    r"|Army Airfield|Army Air Field|AAF"
    r"|MCAS|Marine Corps Air|Marine Corps Outlying"
    r"|Air National Guard|ANGB"
    r"|Coast Guard Air Station"
    r"|Military"
    r")\b",
    re.IGNORECASE,
)


def fetch(url: str, dest: Path, refresh: bool) -> Path:
    """Download to dest unless it is already there. Cached so a rebuild is offline and fast."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and not refresh:
        print(f"  cached  {dest.relative_to(ROOT)} ({dest.stat().st_size:,} bytes)")
        return dest
    print(f"  fetch   {url}")
    # A contact-carrying UA is the courtesy this project uses everywhere it hits a third party.
    req = urllib.request.Request(url, headers={"User-Agent": "loran build_places.py"})
    with urllib.request.urlopen(req, timeout=120) as r, dest.open("wb") as f:
        f.write(r.read())
    print(f"  wrote   {dest.relative_to(ROOT)} ({dest.stat().st_size:,} bytes)")
    return dest


KIND_BY_TYPE = {"large_airport": KIND_LARGE, "medium_airport": KIND_MEDIUM}

# Natural Earth scalerank: 0 = world city, 10 = minor.
#
# D-037 capped this at 7 to stop the Slidell / Crestview / Laurel tier filling in the gaps.
# That was the wrong instrument: those cities are the landmarks that tell you WHERE a contact
# is, and cutting them left large stretches of the map with nothing named on it (D-049). The
# clutter that cap was aiming at is a ZOOM problem, and zoom thinning already solves it - every
# city carries a DistanceDisplayCondition keyed on its rank, so a minor town appears only when
# the camera is close enough for it to be worth naming.
#
# So: ship the full range and let range decide. Costs ~1,800 rows worldwide (~60 KB).
MAX_CITY_SCALERANK = 10


def build_airports(csv_path: Path) -> list[list]:
    """
    [lat, lon, code, kind, name, municipality, region, country, elevation_ft, iata]

    Large + medium airports only. Military is a colour, not a reason to include a marker: a
    military heliport or outlying field stays excluded (D-037).

    The trailing detail fields exist because the markers are CLICKABLE (D-038) - a magenta
    marker asserts significance, so it has to be interrogable. Empty strings and None are
    carried through as-is and render as an em-dash; nothing is invented to fill a column.
    """
    out: list[list] = []
    counts = {KIND_LARGE: 0, KIND_MEDIUM: 0, KIND_MILITARY: 0}

    with csv_path.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            if row["type"] not in KIND_BY_TYPE:
                continue

            kind = (KIND_MILITARY if MILITARY_NAME.search(row["name"])
                    else KIND_BY_TYPE[row["type"]])

            lat, lon = row["latitude_deg"], row["longitude_deg"]
            if not lat or not lon:
                continue

            # iso_region is prefixed with the country ("US-AL"); the country is its own column,
            # so strip the redundant prefix rather than printing it twice in the panel.
            region = row["iso_region"] or ""
            if region.startswith(row["iso_country"] + "-"):
                region = region[len(row["iso_country"]) + 1:]

            elev = row["elevation_ft"]
            try:
                elev_ft = int(float(elev)) if elev else None
            except ValueError:
                elev_ft = None

            # `ident` is always populated and is the ICAO code where one exists; that is the
            # code a mission-control display should show. No fallback guessing needed.
            out.append([
                round(float(lat), 4), round(float(lon), 4), row["ident"], kind,
                row["name"], row["municipality"], region, row["iso_country"],
                elev_ft, row["iata_code"],
            ])
            counts[kind] += 1

    print(f"  airports: {len(out):,}  "
          f"(large {counts[KIND_LARGE]:,}, medium {counts[KIND_MEDIUM]:,}, "
          f"military {counts[KIND_MILITARY]:,})")
    return out


def build_small_airports(csv_path: Path) -> list[list]:
    """
    Same row shape as `build_airports`, for `type == "small_airport"` only.

    D-037 excluded these deliberately and that reasoning still holds for the DEFAULT view: large
    and medium airports are where the traffic ADS-B actually shows us operates, and 42,700 extra
    markers bury the map. They are shipped now only because the owner asked for them behind an
    off-by-default toggle (D-052), which does not overturn that reasoning - it just stops the
    display deciding for the operator.

    Heliports, seaplane bases, balloonports and closed fields stay out entirely. Nobody has asked
    for them, and `closed` in particular would put markers on airfields that no longer exist -
    which is inventing a place, not revealing one.
    """
    out: list[list] = []
    with csv_path.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            if row["type"] != "small_airport":
                continue
            lat, lon = row["latitude_deg"], row["longitude_deg"]
            if not lat or not lon:
                continue

            region = row["iso_region"] or ""
            if region.startswith(row["iso_country"] + "-"):
                region = region[len(row["iso_country"]) + 1:]

            elev = row["elevation_ft"]
            try:
                elev_ft = int(float(elev)) if elev else None
            except ValueError:
                elev_ft = None

            # The military NAME heuristic (D-033) is deliberately NOT applied here. It was
            # calibrated against large/medium fields; running it over 42,700 small strips would
            # assert military significance far beyond what it was measured on.
            out.append([
                round(float(lat), 4), round(float(lon), 4), row["ident"], KIND_SMALL,
                row["name"], row["municipality"], region, row["iso_country"],
                elev_ft, row["iata_code"],
            ])

    print(f"  small:    {len(out):,}  (separate file, lazily fetched, off by default)")
    return out


def build_cities(geojson_path: Path) -> list[list]:
    """[lat, lon, name, scalerank]. scalerank drives zoom thinning in the frontend."""
    data = json.loads(geojson_path.read_text(encoding="utf-8"))
    out: list[list] = []
    dropped = 0
    for feat in data["features"]:
        p = feat["properties"]
        lon, lat = feat["geometry"]["coordinates"][:2]
        name = (p.get("name") or "").strip()
        if not name:
            continue
        # scalerank 0 = world city, 10 = minor. Missing rank sorts to the least prominent.
        rank = int(p.get("scalerank", 10))
        if rank > MAX_CITY_SCALERANK:
            dropped += 1
            continue
        out.append([round(lat, 4), round(lon, 4), name, rank])
    print(f"  cities:   {len(out):,}  (dropped {dropped:,} above scalerank {MAX_CITY_SCALERANK})")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--refresh", action="store_true", help="re-download the raw sources")
    args = ap.parse_args()

    print("sources:")
    airports_csv = fetch(AIRPORTS_URL, RAW_DIR / "airports.csv", args.refresh)
    places_json = fetch(PLACES_URL, RAW_DIR / "ne_10m_populated_places_simple.geojson",
                        args.refresh)

    print("processing:")
    payload = {
        "_note": "GENERATED by scripts/build_places.py - do not edit. See D-023, D-032, D-033.",
        "_sources": {
            "airports": f"OurAirports (public domain) {AIRPORTS_URL}",
            "cities": f"Natural Earth (public domain) {PLACES_URL}",
        },
        "airports": build_airports(airports_csv),
        "cities": build_cities(places_json),
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    # separators: no gratuitous whitespace across ~13k rows.
    OUT_FILE.write_text(
        json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT_FILE.relative_to(ROOT)} ({OUT_FILE.stat().st_size:,} bytes)")

    small_payload = {
        "_note": "GENERATED by scripts/build_places.py - do not edit. Off by default, see D-052.",
        "_sources": {"airports": f"OurAirports (public domain) {AIRPORTS_URL}"},
        "airports": build_small_airports(airports_csv),
    }
    SMALL_OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    SMALL_OUT_FILE.write_text(
        json.dumps(small_payload, separators=(",", ":"), ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {SMALL_OUT_FILE.relative_to(ROOT)} "
          f"({SMALL_OUT_FILE.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
