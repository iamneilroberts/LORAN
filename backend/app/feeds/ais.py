"""
AIS feed client: vessels from a self-hosted position-api instance (D-078).

There is deliberately no direct-to-MarineTraffic code in this repo. position-api
(github.com/transparency-everywhere/position-api, GPL-3.0) is a separate service the owner runs
on their own homelab; it answers vessel queries by driving a headless browser at MarineTraffic.
This module only talks to that instance over plain HTTP, which keeps the ground rule intact:
the backend proxies upstream feeds so the browser is not hitting them directly.

Two upstream shapes, both position-api's:

  GET /legacy/getVesselsNearMe/{lat}/{lng}/{distance}
    -> JSON array of mapped rows (see mapResult in position-api's src/legacy/area.ts):
       { name, id, lat, lon, timestamp, mmsi, imo, callsign, speed, area, type,
         country, destination, port_current, port_current_id, port_next, port_next_id }
    -> or JSON null when the scrape found nothing.

  GET /ais/mt/{mmsi}/location/latest
    -> {"error": null, "data": {timestamp, latitude, longitude, course, speed, ...}}

UNITS, stated honestly: `speed` is taken to be knots (AIS speed-over-ground is broadcast in
knots and MarineTraffic's own tables display knots). This has NOT been verified against a live
instance yet - docs/data-sources.md 5.1c records the assumption so a wrong-looking value is
checked against the source instead of trusted. `course` is degrees true. The near-me snapshot
carries NO course at all, so vessels render with a direction-neutral marker until a per-vessel
detail lookup supplies one - a heading is never invented from thin air.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any, Callable

import httpx

from ..config import (
    AIS_BASE_URL, AIS_DETAIL_MISS_TTL_S, AIS_DETAIL_TTL_S, AIS_POLL_SECONDS, AIS_RADIUS,
    USER_AGENT,
)

# Feed name shown in the UI. Names the real origin of the data - presenting it as anything
# else would hide where the positions come from.
SOURCE_NAME = "position-api·MT"

UNCONFIGURED_REASON = "no AIS source configured (LORAN_AIS_BASE_URL unset)"


def _num(v: Any) -> float | None:
    """Number -> float, tolerating the string forms position-api lets through. NaN -> None:
    JavaScript's Number('') and Number(undefined) produce NaN, which arrives here as null or
    survives a stringify as literal 'NaN' depending on the path."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return None if v != v else float(v)   # NaN is the only value unequal to itself
    if isinstance(v, str):
        try:
            f = float(v.strip())
        except ValueError:
            return None
        return None if f != f else f
    return None


def _str(v: Any) -> str | None:
    """Same contract as adsb._str: trimmed text or None, numbers stringified, bools rejected."""
    if isinstance(v, str):
        return v.strip() or None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return str(v)
    return None


def _epoch(v: Any) -> int | None:
    """
    Position timestamp -> UTC epoch seconds, or None when it cannot be read honestly.

    position-api passes MarineTraffic's LAST_POS through untouched on the near-me path and
    formats an ISO string on the per-vessel path, so both arrive here. A numeric value is taken
    as epoch seconds; an ISO 8601 string is parsed. Anything else is None - the UI renders an
    em-dash rather than a guessed fix time.
    """
    n = _num(v)
    if n is not None:
        # Reject obviously-not-epoch numbers (a year, a small counter) rather than presenting
        # 1970 as a fix time. 10^9 seconds is 2001; AIS data older than that does not exist here.
        return int(n) if n > 1_000_000_000 else None
    if isinstance(v, str):
        try:
            dt = datetime.fromisoformat(v.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    return None


# TYPE_SUMMARY -> icon category. Substring rules, first match wins, checked in order so the
# more specific phrases land before the generic ones. The RAW type string is preserved on the
# record and shown in the dossier verbatim; this mapping only picks a silhouette.
_CATEGORY_RULES: list[tuple[str, str]] = [
    ("high speed", "highspeed"),
    ("highspeed", "highspeed"),
    ("cargo", "cargo"),
    ("tanker", "tanker"),
    ("passenger", "passenger"),
    ("fishing", "fishing"),
    ("tug", "tug"),
    ("pleasure", "pleasure"),
    ("yacht", "pleasure"),
    ("sail", "sailing"),
    ("military", "military"),
    ("navy", "military"),
]


def vessel_category(type_summary: str | None) -> str:
    """"unknown" when the source said nothing; "other" when it said something we do not map."""
    if not type_summary:
        return "unknown"
    t = type_summary.lower()
    for needle, cat in _CATEGORY_RULES:
        if needle in t:
            return cat
    return "other"


def normalize_vessel(raw: dict[str, Any]) -> dict[str, Any] | None:
    """
    One position-api near-me row -> our shape. Returns None if it carries no usable position.

    `key` is what everything downstream keys on: the MMSI when there is one, otherwise
    MarineTraffic's own ship id prefixed "s" so the two namespaces cannot collide. A row with
    neither cannot be selected, tracked or de-duplicated, so it is dropped rather than shown
    as an anonymous unrepeatable blip.
    """
    lat, lon = _num(raw.get("lat")), _num(raw.get("lon"))
    if lat is None or lon is None:
        return None

    mmsi = _str(raw.get("mmsi"))
    # MarineTraffic uses 0 for "no MMSI on file"; that is an absence, not an identity.
    if mmsi in ("0", "0.0"):
        mmsi = None
    ship_id = _str(raw.get("id"))
    key = mmsi or (f"s{ship_id}" if ship_id else None)
    if key is None:
        return None

    imo = _str(raw.get("imo"))
    if imo in ("0", "0.0"):
        imo = None

    type_summary = _str(raw.get("type"))

    return {
        "key": key.lower(),
        "mmsi": mmsi,
        "ship_id": ship_id,
        "name": _str(raw.get("name")),
        "callsign": _str(raw.get("callsign")),
        "imo": imo,
        "lat": lat,
        "lon": lon,
        # Assumed knots - see the module docstring and docs/data-sources.md 5.1c.
        "speed_kt": _num(raw.get("speed")),
        # The near-me snapshot has no course column. None means unknown, and the globe draws a
        # direction-neutral marker for it. The client can later fill it from the vessel's own
        # recorded fixes (course_hint below), in which case course_source says "derived".
        "course_deg": None,
        "course_source": None,
        "type": type_summary,
        "category": vessel_category(type_summary),
        "country": _str(raw.get("country")),
        "destination": _str(raw.get("destination")),
        "port_current": _str(raw.get("port_current")),
        "port_next": _str(raw.get("port_next")),
        "area": _str(raw.get("area")),
        "pos_ts": _epoch(raw.get("timestamp")),
        "military": vessel_category(type_summary) == "military",
    }


class AisClient:
    """
    Shared upstream poller, same shape as AdsbClient: every browser hits our /api/vessels and
    those collapse into at most one position-api call per AIS_POLL_SECONDS per centre point.

    The cache TTL *is* the poll interval. Each upstream call makes position-api drive a full
    headless-Chrome page load, which takes tens of seconds and leans on a site that did not
    agree to serve it - so the gate below also serialises calls: one scrape at a time, ever.
    """

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None
        self._cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._detail_cache: dict[str, tuple[float, float, dict[str, Any]]] = {}  # (t, ttl, data)
        self._detail_locks: dict[str, asyncio.Lock] = {}
        self._gate = asyncio.Lock()
        self.ok = True
        self.last_error: str | None = None
        self.last_ok_ts: float | None = None
        self.consecutive_failures = 0
        self.upstream_calls = 0
        self.cache_hits = 0
        # Set by main.py to the vessel track ring buffer. Called ONLY with a fresh upstream
        # payload, never on a cache hit - replaying a cached response must not inflate a track.
        self.on_fresh: Callable[[list[dict[str, Any]]], None] | None = None
        # Set by main.py to the track buffer's bearing_of. The snapshot feed has no course
        # column; a bearing computed from the vessel's own recorded fixes is a measurement,
        # and the record carrying one is labelled course_source="derived" - never "reported".
        self.course_hint: Callable[[str], float | None] | None = None

    @property
    def configured(self) -> bool:
        return bool(AIS_BASE_URL)

    async def start(self) -> None:
        # A position-api scrape routinely takes 20-35 s (it waits for MarineTraffic's own XHR
        # inside a real browser), so the timeout is far beyond this project's usual 12 s.
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(45.0),
            headers={"User-Agent": USER_AGENT},
            follow_redirects=True,
        )

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()

    def status(self) -> dict[str, Any]:
        """For /api/health, which is an OPEN endpoint: no base URL here - it is an internal
        address on the owner's network and an unauthenticated probe has no business seeing it."""
        if not self.configured:
            return {"configured": False, "reason": UNCONFIGURED_REASON}
        return {
            "configured": True,
            "source": SOURCE_NAME,
            "ok": self.ok,
            "last_error": self.last_error,
            "last_ok_ts": self.last_ok_ts,
            "consecutive_failures": self.consecutive_failures,
            "upstream_calls": self.upstream_calls,
            "cache_hits": self.cache_hits,
            "poll_seconds": AIS_POLL_SECONDS,
        }

    def _unconfigured_payload(self) -> dict[str, Any]:
        return {
            "configured": False,
            "source": None,
            "server_time": time.time(),
            "count": 0,
            "vessels": [],
            "errors": [UNCONFIGURED_REASON],
        }

    async def _fetch_near_me(self, lat: float, lon: float) -> list[dict[str, Any]]:
        assert self._client is not None
        url = f"{AIS_BASE_URL}/legacy/getVesselsNearMe/{lat:.4f}/{lon:.4f}/{AIS_RADIUS:g}"
        r = await self._client.get(url)
        r.raise_for_status()
        data = r.json()
        # position-api answers null when the scrape surfaced no rows. That is "no vessels
        # found", a real answer - not a malformed reply and not an error.
        if data is None:
            return []
        if isinstance(data, list):
            return [row for row in data if isinstance(row, dict)]
        raise ValueError("position-api: expected an array or null from getVesselsNearMe")

    async def vessels(self, lat: float, lon: float) -> dict[str, Any]:
        if not self.configured:
            return self._unconfigured_payload()

        key = f"{lat:.2f},{lon:.2f}"
        now = time.monotonic()
        cached = self._cache.get(key)
        if cached and now - cached[0] < AIS_POLL_SECONDS:
            self.cache_hits += 1
            return cached[1]

        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            cached = self._cache.get(key)
            if cached and time.monotonic() - cached[0] < AIS_POLL_SECONDS:
                self.cache_hits += 1
                return cached[1]

            try:
                async with self._gate:
                    self.upstream_calls += 1
                    rows = await self._fetch_near_me(lat, lon)
                vessels = [v for v in (normalize_vessel(r) for r in rows) if v]
                if self.on_fresh:
                    self.on_fresh(vessels)
                # AFTER recording, so the hint can see the fix that just landed.
                if self.course_hint:
                    for v in vessels:
                        if v["course_deg"] is None:
                            hint = self.course_hint(v["key"])
                            if hint is not None:
                                v["course_deg"] = round(hint, 1)
                                v["course_source"] = "derived"
                self.ok, self.last_error = True, None
                self.last_ok_ts, self.consecutive_failures = time.time(), 0
                payload = {
                    "configured": True,
                    "source": SOURCE_NAME,
                    "server_time": time.time(),
                    "center": {"lat": lat, "lon": lon},
                    "radius": AIS_RADIUS,
                    "count": len(vessels),
                    "vessels": vessels,
                    "errors": [],
                }
            except Exception as e:                     # noqa: BLE001 - report honestly, serve nothing stale
                self.ok = False
                self.last_error = f"{type(e).__name__}: {e}"
                self.consecutive_failures += 1
                # Say so - do NOT serve old positions as if live. An empty sea with an error
                # chip beats a plausible stale one.
                payload = {
                    "configured": True,
                    "source": None,
                    "server_time": time.time(),
                    "center": {"lat": lat, "lon": lon},
                    "radius": AIS_RADIUS,
                    "count": 0,
                    "vessels": [],
                    "errors": [f"{SOURCE_NAME}: {self.last_error}"],
                }
            self._cache[key] = (time.monotonic(), payload)
            return payload

    async def detail(self, mmsi: str) -> dict[str, Any]:
        """
        Fresh position + course for ONE vessel, from position-api's per-MMSI route.

        This is the expensive lookup - a full browser navigation per call - so answers are held
        for AIS_DETAIL_TTL_S and failures for AIS_DETAIL_MISS_TTL_S. `course_deg: null` with no
        errors means the source itself had no course, which the dossier renders as an em-dash.
        """
        mmsi = (mmsi or "").strip()
        if not self.configured:
            return {"mmsi": mmsi, "lat": None, "lon": None, "course_deg": None,
                    "course_source": None, "speed_kt": None, "pos_ts": None,
                    "errors": [UNCONFIGURED_REASON]}

        now = time.monotonic()
        hit = self._detail_cache.get(mmsi)
        if hit and now - hit[0] < hit[1]:
            self.cache_hits += 1
            return hit[2]

        lock = self._detail_locks.setdefault(mmsi, asyncio.Lock())
        async with lock:
            hit = self._detail_cache.get(mmsi)
            if hit and time.monotonic() - hit[0] < hit[1]:
                self.cache_hits += 1
                return hit[2]

            assert self._client is not None
            try:
                async with self._gate:
                    self.upstream_calls += 1
                    r = await self._client.get(f"{AIS_BASE_URL}/ais/mt/{mmsi}/location/latest")
                    r.raise_for_status()
                    body = r.json()
                if not isinstance(body, dict) or body.get("error"):
                    raise ValueError(str(body.get("error") if isinstance(body, dict) else body))
                data = body.get("data") or {}
                course = _num(data.get("course"))
                result = {
                    "mmsi": mmsi,
                    "lat": _num(data.get("latitude")),
                    "lon": _num(data.get("longitude")),
                    "course_deg": course,
                    "course_source": "reported" if course is not None else None,
                    "speed_kt": _num(data.get("speed")),
                    "pos_ts": _epoch(data.get("timestamp")),
                    "errors": [],
                }
                ttl = AIS_DETAIL_TTL_S
            except Exception as e:                     # noqa: BLE001
                result = {"mmsi": mmsi, "lat": None, "lon": None, "course_deg": None,
                          "course_source": None, "speed_kt": None, "pos_ts": None,
                          "errors": [f"{SOURCE_NAME}: {type(e).__name__}: {e}"]}
                ttl = AIS_DETAIL_MISS_TTL_S
            self._detail_cache[mmsi] = (time.monotonic(), ttl, result)
            return result


client = AisClient()
