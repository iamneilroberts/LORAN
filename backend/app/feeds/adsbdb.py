"""
adsbdb enrichment client: airframe details by ICAO hex, flight route by callsign.

adsbdb needs no key and publishes no rate limit, which means the politeness budget is ours to
set rather than theirs to enforce. Three rules do it:

  - cache hard. Airframe data is static per hull, so a hex is asked about once a day at most.
  - cache misses too, on a shorter clock. An unknown hex must not be re-asked on every click.
  - serialise upstream calls with a small floor between them, the same shape as feeds/adsb.py.

A miss is a miss. Every field this cannot fill comes back None and the UI renders an em-dash
(CLAUDE.md ground rule 3). Nothing here invents a registration, an operator or a route.

Note what is deliberately NOT used: the aircraft response also carries url_photo /
url_photo_thumbnail. Photos come from planespotters under the D-009 rules instead, so those two
fields are ignored here.
"""
from __future__ import annotations

import asyncio
import re
import time
from typing import Any, Callable

import httpx

from ..config import (
    ADSBDB_MIN_INTERVAL_S,
    ADSBDB_MISS_TTL_S,
    ADSBDB_ROUTE_TTL_S,
    ADSBDB_TTL_S,
    USER_AGENT,
)

AIRCRAFT_URL = "https://api.adsbdb.com/v0/aircraft/{key}"
CALLSIGN_URL = "https://api.adsbdb.com/v0/callsign/{key}"

# Both go straight into a URL path, so they are whitelisted rather than escaped.
HEX_RE = re.compile(r"^[0-9A-F]{6}$")
CALLSIGN_RE = re.compile(r"^[0-9A-Z]{2,8}$")


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) else None


def _str(v: Any) -> str | None:
    return v.strip() or None if isinstance(v, str) else None


def normalize_aircraft(raw: dict[str, Any]) -> dict[str, Any]:
    """One adsbdb `response.aircraft` object -> the fields the dossier shows."""
    return {
        "registration": _str(raw.get("registration")),
        "type": _str(raw.get("type")),                 # e.g. "EMB-505"
        "icao_type": _str(raw.get("icao_type")),       # e.g. "E55P"
        "manufacturer": _str(raw.get("manufacturer")),
        "operator": _str(raw.get("registered_owner")),
        "operator_country": _str(raw.get("registered_owner_country_name")),
    }


def _airport(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    return {
        "iata": _str(raw.get("iata_code")),
        "icao": _str(raw.get("icao_code")),
        "name": _str(raw.get("name")),
        "municipality": _str(raw.get("municipality")),
        "lat": _num(raw.get("latitude")),
        "lon": _num(raw.get("longitude")),
    }


def normalize_route(raw: dict[str, Any]) -> dict[str, Any]:
    """One adsbdb `response.flightroute` object -> airline plus both airports."""
    airline = raw.get("airline")
    return {
        "callsign": _str(raw.get("callsign")),
        "airline": _str(airline.get("name")) if isinstance(airline, dict) else None,
        "origin": _airport(raw.get("origin")),
        "destination": _airport(raw.get("destination")),
    }


class AdsbdbClient:
    """Cached, serialised front end to api.adsbdb.com."""

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None
        # key -> (expires_at monotonic, value). A cached None is a recorded miss, not an
        # empty cache slot - that is the whole point of caching misses.
        self._cache: dict[str, tuple[float, dict[str, Any] | None]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._gate = asyncio.Lock()
        self._last_upstream = 0.0
        self.upstream_calls = 0
        self.cache_hits = 0
        self.last_error: str | None = None

    async def start(self) -> None:
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(12.0),
            headers={"User-Agent": USER_AGENT},
            follow_redirects=True,
        )

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()

    def status(self) -> dict[str, Any]:
        return {
            "upstream_calls": self.upstream_calls,
            "cache_hits": self.cache_hits,
            "cached_keys": len(self._cache),
            "last_error": self.last_error,
        }

    async def _get_json(self, url: str) -> dict[str, Any] | None:
        """Fetch one URL. Returns None when adsbdb says it does not know (404)."""
        assert self._client is not None
        async with self._gate:
            wait = ADSBDB_MIN_INTERVAL_S - (time.monotonic() - self._last_upstream)
            if wait > 0:
                await asyncio.sleep(wait)
            r = await self._client.get(url)
            self._last_upstream = time.monotonic()
            self.upstream_calls += 1
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()

    async def _lookup(
        self,
        key: str,
        url: str,
        envelope: str,
        parse: Callable[[dict[str, Any]], dict[str, Any]],
        ttl: float,
    ) -> dict[str, Any] | None:
        """Cached single lookup. Raises on upstream failure so the caller can say so."""
        cached = self._cache.get(key)
        if cached and time.monotonic() < cached[0]:
            self.cache_hits += 1
            return cached[1]

        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            # another request may have filled it while we waited on the lock
            cached = self._cache.get(key)
            if cached and time.monotonic() < cached[0]:
                self.cache_hits += 1
                return cached[1]

            data = await self._get_json(url)
            body = data.get("response") if isinstance(data, dict) else None
            inner = body.get(envelope) if isinstance(body, dict) else None
            value = parse(inner) if isinstance(inner, dict) else None

            # A failure never reaches here - it propagates - so only real answers are cached.
            expires = time.monotonic() + (ttl if value else ADSBDB_MISS_TTL_S)
            self._cache[key] = (expires, value)
            return value

    async def enrich(self, hex_code: str | None, callsign: str | None) -> dict[str, Any]:
        """
        Both lookups for one contact. Never raises.

        `aircraft` / `route` are null when adsbdb does not know the contact. `errors` is
        non-empty when a lookup could not be *made*, which the UI reports differently from a
        genuine miss - "we do not know" and "we could not ask" are not the same claim.
        """
        hex_code = (hex_code or "").strip().upper() or None
        callsign = (callsign or "").strip().upper() or None
        out: dict[str, Any] = {
            "hex": hex_code,
            "callsign": callsign,
            "aircraft": None,
            "route": None,
            "errors": [],
        }

        if hex_code and HEX_RE.match(hex_code):
            try:
                out["aircraft"] = await self._lookup(
                    f"ac:{hex_code}", AIRCRAFT_URL.format(key=hex_code),
                    "aircraft", normalize_aircraft, ADSBDB_TTL_S,
                )
            except Exception as e:                        # noqa: BLE001 - report, do not fail
                self.last_error = f"{type(e).__name__}: {e}"
                out["errors"].append(f"aircraft/{hex_code}: {self.last_error}")

        if callsign and CALLSIGN_RE.match(callsign):
            try:
                out["route"] = await self._lookup(
                    f"cs:{callsign}", CALLSIGN_URL.format(key=callsign),
                    "flightroute", normalize_route, ADSBDB_ROUTE_TTL_S,
                )
            except Exception as e:                        # noqa: BLE001
                self.last_error = f"{type(e).__name__}: {e}"
                out["errors"].append(f"callsign/{callsign}: {self.last_error}")

        return out


client = AdsbdbClient()
