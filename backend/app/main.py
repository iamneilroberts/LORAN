"""
loran backend.

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

from .auth import COOKIE_NAME, FailureThrottle, TokenAuth
from .config import (
    ACCESS_TOKENS, CORS_ORIGINS, HOME_LABEL, HOME_LAT, HOME_LON, OWNER_PRINCIPAL,
    PHOTO_GUEST_ACCESS, SESSION_FAIL_LIMIT, SESSION_FAIL_WINDOW_S, SESSION_SECRET,
    SESSION_TTL_S, STATIC_DIR, USER_AGENT,
)
from .feeds.adsb import client as adsb
from .feeds.adsbdb import client as adsbdb
from .feeds.geocode import client as geocoder
from .feeds.planespotters import client as photos
from .feeds.track import store as tracks

START = time.time()

auth = TokenAuth(ACCESS_TOKENS, OWNER_PRINCIPAL, SESSION_SECRET, SESSION_TTL_S)
# The price of /api/session being open by necessity. See FailureThrottle's docstring for why
# this is in-process and what that costs.
session_throttle = FailureThrottle(SESSION_FAIL_LIMIT, SESSION_FAIL_WINDOW_S)

# Paths reachable without a session. Everything else under /api needs one once auth is on.
# Matched on the PATH only, so a path listed here is open for every method - which is what
# lets D-057's POST /api/session through the door alongside the original GET.
OPEN_PATHS = {"/api/session", "/api/health"}


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    # Wired here rather than inside the feed client so the coupling is visible at one place:
    # every fresh upstream payload feeds the ring buffer, cache hits do not.
    adsb.on_fresh = tracks.record
    await adsb.start()
    await adsbdb.start()
    await photos.start()
    await geocoder.start()
    yield
    await geocoder.close()
    await photos.close()
    await adsbdb.close()
    await adsb.close()


app = FastAPI(title="loran", version="0.1.0", lifespan=lifespan)
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


def _client_key(request: Request) -> str:
    """
    Which bucket to throttle this caller in.

    Behind the Cloudflare tunnel every request arrives from the tunnel's own address, so the peer
    address is a single bucket for the entire internet - the first hop in X-Forwarded-For is the
    only thing that tells two visitors apart. That header is trivially forgeable in general, and
    is trusted HERE only because the tunnel is the sole ingress: cloudflared sets it, and the
    port is not otherwise published. If this service is ever exposed directly, or put behind a
    second proxy that does not rewrite the header, this line stops being safe and must be
    revisited. The failure mode is mild either way - forging it buys a fresh throttle bucket and
    nothing else; it cannot mint a session.
    """
    first = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if first:
        return first
    return request.client.host if request.client else "unknown"


def _rejected() -> JSONResponse:
    """
    One answer for every kind of token failure.

    "No such token", "a token that was removed from the config" and "an empty string" are the
    same sentence deliberately: telling them apart would confirm to a caller which half-
    remembered string was once real. The submitted value is never logged and never echoed back
    into the response, so it cannot reach a log file or the DOM.
    """
    return JSONResponse({"auth": True, "principal": None, "owner": False,
                         "detail": "token not recognised"}, status_code=401)


def _throttled() -> JSONResponse:
    return JSONResponse({"auth": True, "principal": None, "owner": False,
                         "detail": "too many attempts"}, status_code=429)


def _issue_session(request: Request, who: str) -> JSONResponse:
    """
    The ONE place a session cookie is minted. Both the `?t=` link path and the pasted-token
    POST path go through here.

    Factored out rather than written twice because drift is the actual risk: two copies of a
    `set_cookie` call will eventually disagree about `httponly`, `samesite`, `max_age` or the
    `secure` derivation, and the copy that quietly loses a flag is a security regression that
    reviews clean - it looks the way the code has always looked. One function means the two
    doors cannot differ, and one test on the flags covers both of them.
    """
    resp = JSONResponse({"auth": True, "principal": who, "owner": who == auth.owner})
    resp.set_cookie(
        COOKIE_NAME, auth.issue(who),
        max_age=int(SESSION_TTL_S), httponly=True, samesite="lax",
        # Cloudflare terminates TLS and forwards the original scheme; trust it for this one
        # decision only. Falling back to insecure on plain http keeps local dev working.
        secure=request.headers.get("x-forwarded-proto", request.url.scheme) == "https",
    )
    return resp


def _exchange(request: Request, token: str) -> JSONResponse:
    """
    Token in, cookie out - the half that both /api/session handlers share.

    The throttle is checked BEFORE the token is looked at, so a caller already over the limit
    costs nothing, and is recorded only on a failure, so re-authenticating successfully from a
    new browser or a second hostname can never lock anybody out.

    Pasted and pasted-into-a-link tokens routinely carry surrounding whitespace - a trailing
    newline out of a terminal or a chat client is the common one - so it is trimmed here rather
    than in each caller.
    """
    client = _client_key(request)
    if not session_throttle.allowed(client):
        return _throttled()
    who = auth.principal_for_token(token.strip())
    if not who:
        session_throttle.record_failure(client)
        return _rejected()
    return _issue_session(request, who)


@app.get("/api/session")
async def session(request: Request, t: str | None = Query(None, max_length=256)):
    """
    Exchange a token for a signed session cookie, or report the current session.

    `?t=` is how a link logs someone in: the frontend calls this once on load, then strips the
    token out of the address bar so it does not sit in history or get pasted onward by accident.
    Unchanged by D-057 apart from sharing its cookie and rejection code with the POST below -
    this is the path shared links depend on (D-041) and it keeps working exactly as before.
    """
    if not auth.enabled:
        return {"auth": False, "principal": auth.owner, "owner": True}

    if t is None:
        # Asking "am I logged in?" is not a token attempt and is never throttled - the frontend
        # may do it on every load, and no secret was offered to be wrong about.
        who = auth.verify(request.cookies.get(COOKIE_NAME))
        if not who:
            return JSONResponse({"auth": True, "principal": None, "owner": False},
                                status_code=401)
        return {"auth": True, "principal": who, "owner": who == auth.owner}

    return _exchange(request, t)


@app.post("/api/session")
async def session_post(request: Request):
    """
    Exchange a PASTED token for a signed session cookie (D-057).

    A POST with the token in the body, deliberately, rather than a second trip through `?t=`.
    A token somebody typed into the console has no reason to ever appear in a URL, and the URL
    is the part of a request that gets written down: uvicorn's access log records the query
    string, and once the Cloudflare tunnel is live so does Cloudflare. The link path has no
    choice about that - a link IS a URL - which is exactly why the paste path should not inherit
    its exposure.

    Reachable without a session because "/api/session" is in OPEN_PATHS, which the middleware
    matches on path alone and therefore for every method.
    """
    if not auth.enabled:
        return {"auth": False, "principal": auth.owner, "owner": True}

    # The body is parsed by hand rather than declared as a pydantic model, and that is NOT a
    # style preference. FastAPI answers a model-validation failure with a 422 whose body echoes
    # the offending input straight back - measured here, not assumed - so an over-length or
    # wrong-typed submission would return the pasted token to the browser, putting it in the DOM
    # and in anything that logs responses. A 422 would also skip the throttle and tell a caller
    # which flavour of wrong they were. Ten boring lines buy one uniform 401 instead.
    try:
        body = await request.json()
    except Exception:                                    # noqa: BLE001 - malformed is just invalid
        return _rejected()
    token = body.get("t") if isinstance(body, dict) else None
    # 256 mirrors the length cap the `?t=` query parameter has always had. Nothing that long can
    # match a configured token anyway; the cap is there so an enormous body is cheap to refuse.
    if not isinstance(token, str) or len(token) > 256:
        return _rejected()
    return _exchange(request, token)


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


@app.get("/api/geocode")
async def get_geocode(q: str = Query(..., min_length=1, max_length=200)):
    """
    Candidate positions for a typed address or place name (D-069).

    Always 200. `results: []` means the geocoder knows of no such place - a real answer - while
    `error` non-null means we could not ask or were refused, which is a different claim and is
    presented differently. More than one result is AMBIGUOUS and the operator picks; this
    endpoint deliberately does not rank, filter or choose on their behalf.

    Rate limiting and caching live in the client, and must: the upstream ceiling is counted per
    application across every browser, so it can only be held in one shared place. The matching
    rule this endpoint cannot enforce is that callers must not fire it on keystrokes -
    auto-complete against Nominatim is forbidden and ban-worthy (docs/data-sources.md 6a).
    """
    return await geocoder.search(q)


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
            "geocode": geocoder.status(),
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
# construction. Unset LORAN_STATIC_DIR for the dev path, where Vite serves on 5173 and
# proxies /api here.
# ---------------------------------------------------------------------------
if STATIC_DIR:
    _static = Path(STATIC_DIR)
    if not _static.is_dir():
        raise RuntimeError(f"LORAN_STATIC_DIR is set but not a directory: {_static}")

    @app.get("/")
    async def index():
        return FileResponse(_static / "index.html")

    app.mount("/", StaticFiles(directory=_static, html=True), name="static")
