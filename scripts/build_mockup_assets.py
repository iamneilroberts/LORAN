#!/usr/bin/env python3
"""
Fetch REAL basemap tiles and REAL live aircraft for the interface mockups.

Project ground rule #1: never use mock, sample or synthesized data to make a screen
look finished. That applies to mockups too. Every tile here is fetched from the actual
provider, and every aircraft is a real contact over Mobile at build time.

Output: docs/mockups/assets.json  (base64 tiles + live aircraft snapshot)
"""
import base64, json, math, os, sys, time, urllib.parse
from concurrent.futures import ThreadPoolExecutor

import urllib.request

UA = "adsb-viz/0.1 (+mailto:dneilroberts@gmail.com)"
HOME_LAT, HOME_LON = 30.6944, -88.0399
ZOOM = 8
GRID = 3  # GRID x GRID tiles centred on home
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "mockups", "assets.json")


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), r.headers.get("Content-Type", "")


def deg2tile(lat, lon, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    y = (1.0 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2.0 * n
    return x, y


def tile2deg(x, y, z):
    n = 2 ** z
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lat, lon


cx, cy = deg2tile(HOME_LAT, HOME_LON, ZOOM)
x0, y0 = int(cx) - GRID // 2, int(cy) - GRID // 2
# geographic bounds of the assembled grid, for the WMS request
lat_top, lon_left = tile2deg(x0, y0, ZOOM)
lat_bot, lon_right = tile2deg(x0 + GRID, y0 + GRID, ZOOM)

PROVIDERS = {
    "esri_imagery": lambda z, x, y:
        f"https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    "esri_ocean": lambda z, x, y:
        f"https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}",
    "esri_ocean_ref": lambda z, x, y:
        f"https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}",
    "carto_dark": lambda z, x, y:
        f"https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    "carto_darknolabels": lambda z, x, y:
        f"https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png",
}


def fetch_grid(name, urlfn):
    tiles = {}
    jobs = [(dx, dy) for dy in range(GRID) for dx in range(GRID)]

    def one(job):
        dx, dy = job
        url = urlfn(ZOOM, x0 + dx, y0 + dy)
        try:
            body, ctype = get(url)
            if not ctype.startswith("image"):
                return job, None, f"non-image {ctype}"
            return job, (base64.b64encode(body).decode(), ctype), None
        except Exception as e:
            return job, None, str(e)

    errs = []
    with ThreadPoolExecutor(max_workers=6) as ex:
        for job, data, err in ex.map(one, jobs):
            if err:
                errs.append(f"{job}:{err}")
            else:
                tiles[f"{job[0]}_{job[1]}"] = {"b64": data[0], "type": data[1]}
    print(f"  {name}: {len(tiles)}/{len(jobs)} tiles" + (f"  ERRORS {errs[:2]}" if errs else ""))
    return tiles


def fetch_gebco():
    """
    GEBCO is WMS, not XYZ - one GetMap covering the same bounds.

    Layer choice matters: GEBCO_2024_Grid is a GROUP layer whose default render composites the
    TID (Type IDentifier) sublayer on top, which draws survey-track provenance, not depth.
    GEBCO_2024 is the shaded-relief grid and is the one that shows the shelf break and canyons.
    Returns both the raw render and a dark-console remap of it.
    """
    px = 256 * GRID
    qs = urllib.parse.urlencode({
        "request": "GetMap", "service": "WMS", "version": "1.3.0",
        "layers": "GEBCO_2024", "crs": "EPSG:4326",
        # WMS 1.3.0 EPSG:4326 is lat,lon order
        "bbox": f"{lat_bot},{lon_left},{lat_top},{lon_right}",
        "width": px, "height": px, "format": "image/png", "transparent": "false",
    })
    body, ctype = get(f"https://wms.gebco.net/2024/mapserv?{qs}", timeout=90)
    print(f"  gebco raw: {len(body)} bytes {ctype}")
    raw = {"b64": base64.b64encode(body).decode(), "type": ctype}

    dark = None
    try:
        import subprocess, tempfile
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(body); src = f.name
        dst = src.replace(".png", "_dark.png")
        subprocess.run([sys.executable,
                        os.path.join(ROOT, "scripts", "make_dark_bathy.py"), src, dst],
                       check=True)
        db = open(dst, "rb").read()
        dark = {"b64": base64.b64encode(db).decode(), "type": "image/png"}
        print(f"  gebco dark: {len(db)} bytes")
        os.unlink(src); os.unlink(dst)
    except Exception as e:
        print("  gebco dark FAILED:", e)
    return raw, dark


def fetch_aircraft():
    body, _ = get(f"https://api.airplanes.live/v2/point/{HOME_LAT}/{HOME_LON}/150")
    d = json.loads(body)
    ac = []
    for a in d.get("ac", []):
        if a.get("lat") is None or a.get("lon") is None:
            continue
        ac.append({
            "hex": a.get("hex"), "flight": (a.get("flight") or "").strip() or None,
            "r": a.get("r"), "t": a.get("t"), "desc": a.get("desc"), "ownOp": a.get("ownOp"),
            "alt_baro": a.get("alt_baro"), "alt_geom": a.get("alt_geom"),
            "gs": a.get("gs"), "track": a.get("track"), "baro_rate": a.get("baro_rate"),
            "lat": a.get("lat"), "lon": a.get("lon"), "squawk": a.get("squawk"),
            "dbFlags": a.get("dbFlags", 0), "seen_pos": a.get("seen_pos"),
            "category": a.get("category"),
        })
    print(f"  aircraft: {len(ac)} live contacts")
    return ac


def fetch_depth(lat, lon):
    """Real GEBCO depth at a point, for the cursor readout in the mockup."""
    d = 0.01
    qs = urllib.parse.urlencode({
        "request": "GetFeatureInfo", "service": "WMS", "version": "1.1.1",
        "layers": "GEBCO_2024_Grid", "query_layers": "GEBCO_2024_Grid",
        "srs": "EPSG:4326", "bbox": f"{lon-d},{lat-d},{lon+d},{lat+d}",
        "width": 100, "height": 100, "x": 50, "y": 50, "info_format": "text/plain",
    })
    try:
        body, _ = get(f"https://wms.gebco.net/2024/mapserv?{qs}")
        import re
        m = re.search(rb"value_list\s*=\s*'(-?\d+)'", body)
        return int(m.group(1)) if m else None
    except Exception as e:
        print("  depth fetch failed:", e)
        return None


if __name__ == "__main__":
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    print(f"grid z{ZOOM} x{x0}..{x0+GRID-1} y{y0}..{y0+GRID-1}")
    print(f"bounds lat {lat_bot:.4f}..{lat_top:.4f}  lon {lon_left:.4f}..{lon_right:.4f}")

    basemaps = {}
    for name, fn in PROVIDERS.items():
        basemaps[name] = fetch_grid(name, fn)
    try:
        gebco, gebco_dark = fetch_gebco()
    except Exception as e:
        print("  gebco FAILED:", e); gebco = gebco_dark = None

    assets = {
        "generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "zoom": ZOOM, "grid": GRID, "x0": x0, "y0": y0,
        "bounds": {"lat_top": lat_top, "lat_bot": lat_bot,
                   "lon_left": lon_left, "lon_right": lon_right},
        "home": {"lat": HOME_LAT, "lon": HOME_LON, "label": "MOBILE, AL"},
        "basemaps": basemaps,
        "gebco": gebco,
        "gebco_dark": gebco_dark,
        "aircraft": fetch_aircraft(),
        "sample_depth_m": fetch_depth(29.0, -88.0),
    }
    with open(OUT, "w") as f:
        json.dump(assets, f)
    print(f"wrote {OUT}  ({os.path.getsize(OUT)/1e6:.2f} MB)")
