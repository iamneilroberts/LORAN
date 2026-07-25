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
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .auth import COOKIE_NAME, TokenAuth
from .config import (
    ACCESS_TOKENS, CORS_ORIGINS, HOME_LABEL, HOME_LAT, HOME_LON, OWNER_PRINCIPAL,
    PHOTO_GUEST_ACCESS, SESSION_SECRET, SESSION_TTL_S, STATIC_DIR, USER_AGENT,
)
from .feeds.adsb import client as adsb
from .feeds.adsbdb import client as adsbdb
from .feeds.planespotters import client as photos
from .feeds.track import store as tracks

START = time.time()

auth = TokenAuth(ACCESS_TOKENS, OWNER_PRINCIPAL, SESSION_SECRET, SESSION_TTL_S)

# Paths reachable without a session. Everything else under /api needs one once auth is on.
OPEN_PATHS = {"/api/session", "/api/health"}


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


def principal_of(request: Request) -> str:
    """Who is asking. With auth off, everyone is the owner - the single-user default."""
    if not auth.enabled:
        return auth.owner
    return auth.verify(request.cookies.get(COOKIE_NAME)) or ""


@app.middleware("http")
async def require_session(request: Request, call_next):
    """
    The door. Only guards /api - the static shell carries no data, and letting it load is what
    allows an unauthorised visitor to be TOLD they need a token instead of getting a blank page.

    /api/health stays open deliberately: it is how you check the service is alive from outside
    without holding a token, and it reports no traffic, positions or airframe data.
    """
    path = request.url.path
    if auth.enabled and path.startswith("/api/") and path not in OPEN_PATHS:
        if not auth.verify(request.cookies.get(COOKIE_NAME)):
            return JSONResponse(
                {"detail": "access token required", "auth": "token"}, status_code=401,
            )
    return await call_next(request)


@app.get("/api/session")
async def session(request: Request, t: str | None = Query(None, max_length=256)):
    """
    Exchange a token for a signed session cookie, or report the current session.

    `?t=` is how a link logs someone in: the frontend calls this once on load, then strips the
    token out of the address bar so it does not sit in history or get pasted onward by accident.
    """
    if not auth.enabled:
        return {"auth": False, "principal": auth.owner, "owner": True}

    if t is None:
        who = auth.verify(request.cookies.get(COOKIE_NAME))
        if not who:
            return JSONResponse({"auth": True, "principal": None, "owner": False},
                                status_code=401)
        return {"auth": True, "principal": who, "owner": who == auth.owner}

    who = auth.principal_for_token(t)
    if not who:
        # Deliberately vague, and deliberately not logged with the token value.
        return JSONResponse({"auth": True, "principal": None, "owner": False,
                             "detail": "invalid token"}, status_code=401)

    body = {"auth": True, "principal": who, "owner": who == auth.owner}
    resp = JSONResponse(body)
    resp.set_cookie(
        COOKIE_NAME, auth.issue(who),
        max_age=int(SESSION_TTL_S), httponly=True, samesite="lax",
        # Cloudflare terminates TLS and forwards the original scheme; trust it for this one
        # decision only. Falling back to insecure on plain http keeps local dev working.
        secure=request.headers.get("x-forwarded-proto", request.url.scheme) == "https",
    )
    return resp


@app.get("/api/config")
async def get_config(request: Request):
    who = principal_of(request)
    return {
        "home": {"lat": HOME_LAT, "lon": HOME_LON, "label": HOME_LABEL},
        # The UI states who it thinks you are, so a guest is never confused about why a
        # feature is missing.
        "principal": who or None,
        "owner": who == auth.owner,
        "auth": auth.enabled,
    }


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
    request: Request,
    icao: str | None = Query(None, alias="hex", min_length=6, max_length=6),
    reg: str | None = Query(None, max_length=12),
):
    """
    Photo METADATA for one contact. Never the image itself.

    Returns the URL planespotters published, their photo-page link and the photographer's
    name; the browser loads the bytes from their CDN directly. Their clause 8 forbids
    re-exposing their API (docs/decisions.md D-009, D-041).

    `photo: null` is a normal answer, not an error - plenty of airframes have no photo. A photo
    WITHHELD from a guest is a different thing and says so in `errors`, because "we won't tell
    you" and "there is no photo" must not look identical.
    """
    if not PHOTO_GUEST_ACCESS and principal_of(request) != auth.owner:
        return {
            "hex": (icao or "").strip().upper() or None,
            "registration": (reg or "").strip().upper() or None,
            "photo": None,
            "matched_on": None,
            "errors": ["photos are owner-only on this instance (planespotters clause 8)"],
        }
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
        # No token values, no principal names - just whether the door exists.
        "auth": {"enabled": auth.enabled, "principals": len(set(auth.principals.values()))},
    }


# ---------------------------------------------------------------------------
# Static frontend, LAST so it never shadows an /api route.
#
# Serving the built app from this process is what makes remote access one origin and one
# tunnel: no CORS, no second port to expose, and the session cookie is same-site by
# construction. Unset ADSBVIZ_STATIC_DIR for the dev path, where Vite serves on 5173 and
# proxies /api here.
# ---------------------------------------------------------------------------
if STATIC_DIR:
    _static = Path(STATIC_DIR)
    if not _static.is_dir():
        raise RuntimeError(f"ADSBVIZ_STATIC_DIR is set but not a directory: {_static}")

    @app.get("/")
    async def index():
        return FileResponse(_static / "index.html")

    app.mount("/", StaticFiles(directory=_static, html=True), name="static")
