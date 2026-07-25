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

START = time.time()


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    await adsb.start()
    yield
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
        "feeds": {"adsb": adsb.status()},
        # Recorded honestly: measured zero coverage at Mobile. docs/data-sources.md 5.1a
        "ais": {"configured": False, "reason": "no source - aisstream measured zero at Mobile"},
    }
