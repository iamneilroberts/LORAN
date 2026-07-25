"""
adsb-viz backend.

Exists to (a) proxy/normalize upstream feeds so the browser is not hitting six APIs directly,
(b) enforce rate limits and cache, (c) run the recorder (Phase 5).

Note the deliberate exception: planespotters photo BINARIES are never proxied here. Their terms
forbid downloading, storing or re-hosting images, so the browser loads those straight from their
CDN. See docs/decisions.md D-009.
"""
from __future__ import annotations

import contextlib
import time

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .config import CORS_ORIGINS, HOME_LABEL, HOME_LAT, HOME_LON, USER_AGENT
from .feeds.adsb import client as adsb
from .feeds.adsbdb import client as adsbdb
from .feeds.planespotters import client as photos
from .feeds.track import store as tracks

START = time.time()


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    # Wired here rather than inside the feed client so the coupling is visible at one place:
    # every fresh upstream payload feeds the ring buffer, cache hits do not.
    adsb.on_fresh = tracks.record
    await adsb.start()
    await adsbdb.start()
    await photos.start()
    yield
    await photos.close()
    await adsbdb.close()
    await adsb.close()


app = FastAPI(title="adsb-viz", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS if o.strip()],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/config")
async def get_config():
    return {"home": {"lat": HOME_LAT, "lon": HOME_LON, "label": HOME_LABEL}}


@app.get("/api/aircraft")
async def get_aircraft(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius: float = Query(100.0, gt=0),
):
    return await adsb.aircraft(lat, lon, radius)


@app.get("/api/enrich")
async def get_enrich(
    icao: str | None = Query(None, alias="hex", min_length=6, max_length=6),
    callsign: str | None = Query(None, max_length=8),
):
    """
    Static airframe and route detail for one contact, from adsbdb.

    Always 200. A contact adsbdb does not know returns null aircraft/route - that is an
    answer, not an error - and a lookup we could not make shows up in `errors` instead, so
    the UI can tell "unknown" apart from "unavailable".
    """
    return await adsbdb.enrich(icao, callsign)


@app.get("/api/track")
async def get_track(hex: str = Query(..., min_length=6, max_length=6)):
    """
    Recent position fixes for one contact, from the in-memory ring buffer (D-016).

    The response reports the window it ACTUALLY covers (`first_ts`, `last_ts`, `span_s`) and
    whether older points have already been discarded (`truncated`). This buffer dies with the
    process and reaches back at most `buffer_window_s`; callers must present that honestly and
    never imply history it does not hold.
    """
    return tracks.get(hex)


@app.get("/api/photo")
async def get_photo(
    icao: str | None = Query(None, alias="hex", min_length=6, max_length=6),
    reg: str | None = Query(None, max_length=12),
):
    """
    Photo METADATA for one contact. Never the image itself.

    Returns the URL planespotters published, their photo-page link and the photographer's
    name; the browser loads the bytes from their CDN directly. This endpoint must stay
    private - their clause 8 forbids re-exposing their API (docs/decisions.md D-009).

    `photo: null` is a normal answer, not an error - plenty of airframes have no photo.
    """
    return await photos.photo(icao, reg)


@app.get("/api/depth")
async def get_depth(lat: float = Query(..., ge=-90, le=90),
                    lon: float = Query(..., ge=-180, le=180)):
    """
    Real elevation/depth at a point from GEBCO, via WMS GetFeatureInfo.

    Metres, negative below sea level. Land returns positive elevation, so one readout serves
    both. Cross-validated against NOAA NCEI to ~0.35% (docs/decisions.md D-004).
    Returns value: null on a miss - never a guessed number.
    """
    d = 0.01
    params = {
        "request": "GetFeatureInfo", "service": "WMS", "version": "1.1.1",
        "layers": "GEBCO_2024_Grid", "query_layers": "GEBCO_2024_Grid",
        "srs": "EPSG:4326", "bbox": f"{lon-d},{lat-d},{lon+d},{lat+d}",
        "width": 100, "height": 100, "x": 50, "y": 50, "info_format": "text/plain",
    }
    try:
        async with httpx.AsyncClient(timeout=12.0,
                                     headers={"User-Agent": USER_AGENT}) as c:
            r = await c.get("https://wms.gebco.net/2024/mapserv", params=params)
            r.raise_for_status()
        import re
        m = re.search(r"value_list\s*=\s*'(-?\d+)'", r.text)
        return {"lat": lat, "lon": lon,
                "elevation_m": int(m.group(1)) if m else None,
                "source": "GEBCO_2024"}
    except Exception as e:                                   # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"GEBCO unavailable: {e}") from e


@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "uptime_s": round(time.time() - START, 1),
        "feeds": {
            "adsb": adsb.status(),
            "adsbdb": adsbdb.status(),
            "planespotters": photos.status(),
        },
        "track_buffer": tracks.status(),
        # Recorded honestly: measured zero coverage at Mobile. docs/data-sources.md 5.1a
        "ais": {"configured": False, "reason": "no source - aisstream measured zero at Mobile"},
    }
