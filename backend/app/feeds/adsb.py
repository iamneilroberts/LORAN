"""
ADS-B feed client: one normalizer, three interchangeable sources, shared rate limit.

All three feeds serve the same readsb/tar1090 schema (docs/data-sources.md 2), so failover costs
almost nothing. The only differences we have to paper over:

  - envelope key: airplanes.live and adsb.lol use {"ac": [...]}, adsb.fi uses {"aircraft": [...]}
  - adsb.lol omits desc/ownOp/year; the other two include them inline

Units are FEET and KNOTS on all three. Do not mix with OpenSky, which is metres and m/s - that is
exactly why OpenSky was rejected (docs/decisions.md D-002).
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Callable

import httpx

from ..config import MAX_RADIUS_NM, POLL_SECONDS, USER_AGENT


@dataclass
class Source:
    name: str
    url: str          # format string with {lat} {lon} {radius}
    envelope: str     # top-level key holding the aircraft array
    ok: bool = True
    last_error: str | None = None
    last_ok_ts: float | None = None
    consecutive_failures: int = 0


SOURCES: list[Source] = [
    Source("airplanes.live",
           "https://api.airplanes.live/v2/point/{lat}/{lon}/{radius}", "ac"),
    Source("adsb.lol",
           "https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{radius}", "ac"),
    Source("adsb.fi",
           "https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{radius}", "aircraft"),
]


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) else None


def _str(v: Any) -> str | None:
    """
    Text field -> trimmed string, or None.

    Deliberately identical to `str()` in frontend/src/data/upstream.ts, because that file
    normalizes the same records for the single-file build and the two must not disagree
    (fixtures/adsb/). Three behaviours matter and all three were divergences before the shared
    fixture caught them:

      - readsb PADS text fields (`flight` arrives as "FFT1257 "), so everything is trimmed, not
        just the callsign that happened to be trimmed by hand.
      - whitespace-only is nothing, and becomes None so the UI renders an em-dash. `"   " or None`
        keeps the spaces, because a string of spaces is truthy.
      - a number is accepted and stringified. `year` is a string on every feed observed, but the
        payload's declared type is string, and silently dropping a numeric one loses real data.
    """
    if isinstance(v, str):
        return v.strip() or None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return str(v)
    return None


def _flags(v: Any) -> int:
    """
    dbFlags -> int, never raising.

    Was `int(raw.get("dbFlags") or 0)`, which raises ValueError on a non-numeric value. That
    exception escapes `normalize`, so ONE malformed record would fail the whole poll and drop
    every other contact with it. It also disagreed with upstream.ts, which accepted only a real
    number: a feed sending dbFlags as the STRING "1" produced a MILITARY contact on the backend
    and a civil one in the single-file build - magenta on one screen, cyan on the other.
    """
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _emergency(v: Any) -> str | None:
    """readsb's "no emergency" sentinel is the string "none". Everything else is real."""
    s = _str(v)
    return None if s is None or s.lower() == "none" else s


def normalize(raw: dict[str, Any]) -> dict[str, Any] | None:
    """
    One readsb record -> our shape. Returns None if it carries no usable position.

    Altitude rules (docs/data-sources.md 3.1):
      - alt_geom is WGS84 geometric altitude and is what Cesium wants for height above ellipsoid
      - alt_baro is the fallback, and can be the STRING "ground" instead of a number
      - negative values are legitimate
    """
    lat, lon = _num(raw.get("lat")), _num(raw.get("lon"))
    if lat is None or lon is None:
        return None

    alt_baro_raw = raw.get("alt_baro")
    on_ground = alt_baro_raw == "ground"
    alt_baro = None if on_ground else _num(alt_baro_raw)
    alt_geom = _num(raw.get("alt_geom"))
    # prefer geometric for positioning; fall back to barometric; ground is 0
    alt_ft = alt_geom if alt_geom is not None else alt_baro
    if on_ground and alt_ft is None:
        alt_ft = 0.0

    db_flags = _flags(raw.get("dbFlags"))
    hex_code = _str(raw.get("hex"))

    return {
        "hex": hex_code.lower() if hex_code else None,
        "flight": _str(raw.get("flight")),
        "registration": _str(raw.get("r")),
        "type": _str(raw.get("t")),
        "desc": _str(raw.get("desc")),            # absent on adsb.lol
        "operator": _str(raw.get("ownOp")),       # absent on adsb.lol
        "year": _str(raw.get("year")),            # absent on adsb.lol
        "category": _str(raw.get("category")),
        "lat": lat,
        "lon": lon,
        "alt_ft": alt_ft,
        "alt_geom_ft": alt_geom,
        "alt_baro_ft": alt_baro,
        "on_ground": on_ground,
        "gs_kt": _num(raw.get("gs")),
        "track_deg": _num(raw.get("track")),
        "baro_rate_fpm": _num(raw.get("baro_rate")),
        "geom_rate_fpm": _num(raw.get("geom_rate")),
        "squawk": _str(raw.get("squawk")),
        # Case-insensitive, and after trimming: readsb sends the literal "none" for "no
        # emergency", and " None " must not become a reported emergency. upstream.ts already
        # lower-cased before comparing; this side did not.
        "emergency": _emergency(raw.get("emergency")),
        # dbFlags is a bitfield: 1 = military, 2 = interesting, 4 = PIA, 8 = LADD
        "military": bool(db_flags & 1),
        "ladd": bool(db_flags & 8),
        "pia": bool(db_flags & 4),
        # seconds since the position fix; observed up to ~50s. The client ages these out
        # rather than pretending a stale contact is current.
        "seen_pos_s": _num(raw.get("seen_pos")),
        "rssi": _num(raw.get("rssi")),
    }


class AdsbClient:
    """
    Shared upstream poller.

    Every browser tab hits our /api/aircraft; we collapse those into at most one upstream call
    per POLL_SECONDS per viewport key. This is what keeps us inside airplanes.live's documented
    1 req/sec no matter how many clients connect.
    """

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None
        self._cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._gate = asyncio.Lock()          # serialises upstream calls
        self._last_upstream = 0.0
        # Set by main.py to the track ring buffer. Called ONLY with a fresh upstream payload,
        # never on a cache hit - replaying a cached response must not inflate a track.
        self.on_fresh: Callable[[list[dict[str, Any]]], None] | None = None

    async def start(self) -> None:
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(12.0),
            headers={"User-Agent": USER_AGENT},
            follow_redirects=True,
        )

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()

    def status(self) -> list[dict[str, Any]]:
        return [
            {"name": s.name, "ok": s.ok, "last_error": s.last_error,
             "last_ok_ts": s.last_ok_ts, "consecutive_failures": s.consecutive_failures}
            for s in SOURCES
        ]

    async def _fetch_one(self, src: Source, lat: float, lon: float, radius: float):
        assert self._client is not None
        url = src.url.format(lat=f"{lat:.4f}", lon=f"{lon:.4f}", radius=int(radius))
        r = await self._client.get(url)
        r.raise_for_status()
        data = r.json()
        rows = data.get(src.envelope)
        if not isinstance(rows, list):
            raise ValueError(f"{src.name}: missing '{src.envelope}' array")
        return rows

    async def aircraft(self, lat: float, lon: float, radius: float) -> dict[str, Any]:
        radius = max(1.0, min(radius, MAX_RADIUS_NM))
        key = f"{lat:.2f},{lon:.2f},{int(radius)}"
        now = time.monotonic()

        cached = self._cache.get(key)
        if cached and now - cached[0] < POLL_SECONDS:
            return cached[1]

        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            # another coroutine may have refreshed it while we waited
            cached = self._cache.get(key)
            if cached and time.monotonic() - cached[0] < POLL_SECONDS:
                return cached[1]

            errors: list[str] = []
            for src in SOURCES:
                try:
                    async with self._gate:
                        # honour the documented 1 req/sec across ALL sources and viewports
                        wait = 1.0 - (time.monotonic() - self._last_upstream)
                        if wait > 0:
                            await asyncio.sleep(wait)
                        rows = await self._fetch_one(src, lat, lon, radius)
                        self._last_upstream = time.monotonic()

                    aircraft = [a for a in (normalize(r) for r in rows) if a]
                    if self.on_fresh:
                        self.on_fresh(aircraft)
                    src.ok, src.last_error = True, None
                    src.last_ok_ts, src.consecutive_failures = time.time(), 0
                    payload = {
                        "source": src.name,
                        "server_time": time.time(),
                        "center": {"lat": lat, "lon": lon},
                        "radius_nm": radius,
                        "count": len(aircraft),
                        "aircraft": aircraft,
                        "degraded": src is not SOURCES[0],
                        "errors": errors,
                    }
                    self._cache[key] = (time.monotonic(), payload)
                    return payload
                except Exception as e:                       # noqa: BLE001 - report, then fail over
                    src.ok = False
                    src.last_error = f"{type(e).__name__}: {e}"
                    src.consecutive_failures += 1
                    errors.append(f"{src.name}: {src.last_error}")

            # Every source failed. Say so honestly - do NOT serve stale positions as if live.
            payload = {
                "source": None, "server_time": time.time(),
                "center": {"lat": lat, "lon": lon}, "radius_nm": radius,
                "count": 0, "aircraft": [], "degraded": True, "errors": errors,
            }
            self._cache[key] = (time.monotonic(), payload)
            return payload


client = AdsbClient()
