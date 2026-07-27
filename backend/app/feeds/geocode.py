"""
Geocoding: one typed address or place name -> candidate positions (D-069).

The upstream default is Nominatim, whose usage policy is stricter than its HTTP behaviour and
is the reason most of this file looks the way it does. See docs/data-sources.md 6a for the
probe log; the clauses that shaped the code:

  - 1 request per second, ABSOLUTE, and counted per application rather than per user. One
    shared gate here is the only place that can hold that line across every browser, which is
    also the argument that settled proxy-vs-direct: a browser can only rate-limit itself.
  - "Provide a valid User-Agent identifying the application; stock User-Agents as set by http
    libraries will not do." We reuse LORAN_USER_AGENT - the same contact-carrying UA
    planespotters requires (D-009) - and REFUSE TO CALL AT ALL while it is still the shipped
    placeholder. See _contactless() for why that gate exists rather than a separate on/off flag.
  - "Apps must make sure that they can switch the service at our request at any time - switching
    should be possible without requiring a software update." Hence LORAN_GEOCODE_URL, an env var
    rather than a constant.
  - "Results must be cached on your side. Clients sending repeatedly the same query may be
    classified as faulty and blocked." Hence the cache, which is a requirement here and not an
    optimisation.
  - Auto-complete is forbidden outright and ban-worthy. Nothing here can enforce that - it is a
    property of the caller - so the frontend field is submit-triggered only. If you are about to
    wire this to a keystroke handler, read the policy first.

A miss is a miss. No result means no result; this never falls back to a nearby guess, and never
returns a position it did not receive from upstream (CLAUDE.md ground rule 1).
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from ..config import (
    GEOCODE_LIMIT,
    GEOCODE_MIN_INTERVAL_S,
    GEOCODE_MISS_TTL_S,
    GEOCODE_TTL_S,
    GEOCODE_URL,
    PLACEHOLDER_USER_AGENT,
    USER_AGENT,
)


def _contactless() -> bool:
    """
    True while LORAN_USER_AGENT is still the shipped placeholder.

    This is the whole of the feature's on/off switch, and it is deliberately not a separate
    LORAN_GEOCODE_ENABLED flag. The policy permits the public API only where the operator has
    made a deliberate, informed decision and is reachable if their traffic causes a problem;
    an unconfigured clone is neither. Tying the feature to the contact address makes the
    default install compliant without asking anyone to remember a second setting, and the one
    thing the operator must do to enable it is exactly the thing the policy requires of them.
    """
    return USER_AGENT.strip() == PLACEHOLDER_USER_AGENT


def normalize(raw: dict[str, Any]) -> dict[str, Any] | None:
    """
    One Nominatim `search` result -> the fields the panel needs.

    `name` is passed through VERBATIM and may be empty. That emptiness is meaningful, not a
    gap to paper over: Nominatim fills `name` for a place that HAS a name ("Springfield",
    "Mobile Regional Airport") and leaves it "" for a street address, which is not a named
    place. The frontend turns an empty name into a coordinate label, which is D-068's rule
    for a position with no name of its own. Nothing here shortens, title-cases or otherwise
    prettifies either string.
    """
    try:
        lat = float(raw["lat"])
        lon = float(raw["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return {
        "lat": lat,
        "lon": lon,
        "name": (raw.get("name") or "").strip(),
        # The long one - "150, Government Street, Downtown, …, Alabama, 36602, United States".
        # Shown as the candidate's detail line so an ambiguous pick is made on full information.
        "detail": (raw.get("display_name") or "").strip(),
        # Two Springfield, Virginia results come back with CHARACTER-IDENTICAL display_name and
        # differ only here and by ~0.5 km. A candidate list keyed on the name alone renders two
        # indistinguishable rows, so this is shown too.
        "kind": (raw.get("addresstype") or raw.get("type") or "").strip(),
    }


class GeocodeClient:
    """Cached, rate-limited front end to the configured geocoder."""

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None
        self._cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}
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
            "enabled": not _contactless(),
            "upstream_calls": self.upstream_calls,
            "cache_hits": self.cache_hits,
            "cached_keys": len(self._cache),
            "last_error": self.last_error,
        }

    async def _fetch(self, query: str) -> list[dict[str, Any]]:
        assert self._client is not None
        async with self._gate:
            # The absolute 1 req/s ceiling, held across every caller. Serialising inside the
            # gate rather than sleeping outside it is what makes that true under concurrency.
            wait = GEOCODE_MIN_INTERVAL_S - (time.monotonic() - self._last_upstream)
            if wait > 0:
                await asyncio.sleep(wait)
            r = await self._client.get(
                GEOCODE_URL,
                params={"q": query, "format": "jsonv2", "limit": GEOCODE_LIMIT},
            )
            self._last_upstream = time.monotonic()
            self.upstream_calls += 1
        r.raise_for_status()
        data = r.json()
        if not isinstance(data, list):
            return []
        out = [n for n in (normalize(x) for x in data if isinstance(x, dict)) if n]
        return out

    async def search(self, query: str) -> dict[str, Any]:
        """
        Candidates for one query. Never raises.

        Four outcomes, kept distinct because they are four different things to tell the
        operator, and because collapsing them is how a failed lookup ends up looking like a
        successful one:

          disabled     - no contact address configured; we did not ask.
          error set    - we could not ask, or upstream refused. NOT "no such place".
          results []   - we asked, upstream knows of no such place. A real answer.
          results [..] - one or more candidates. One is not automatically correct; the caller
                         decides, and with more than one it must not pick for the operator.

        Note the shape of a miss upstream: HTTP 200 with an empty JSON array, not a 404. Any
        "if the request succeeded then we have a position" logic would sail straight past it,
        which is the same trap planespotters sets (docs/data-sources.md 4.2).
        """
        q = " ".join(query.split())
        out: dict[str, Any] = {"query": q, "results": [], "error": None}
        if not q:
            out["error"] = "empty query"
            return out
        if _contactless():
            out["error"] = "geocoding disabled: set LORAN_USER_AGENT to a real contact address"
            return out

        key = q.casefold()
        cached = self._cache.get(key)
        if cached and time.monotonic() < cached[0]:
            self.cache_hits += 1
            out["results"] = cached[1]
            return out

        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            cached = self._cache.get(key)
            if cached and time.monotonic() < cached[0]:
                self.cache_hits += 1
                out["results"] = cached[1]
                return out
            try:
                results = await self._fetch(q)
            except httpx.HTTPStatusError as e:
                code = e.response.status_code
                self.last_error = f"HTTP {code}"
                # 403 and 429 are NOT the same problem, and saying "rate limited" for both would
                # send the operator off to wait for a block that waiting cannot clear. MEASURED
                # 2026-07-26: Nominatim answers 403 "Access denied" to a UA whose contact address
                # is a placeholder domain - our own shipped default is refused this way - while a
                # stock curl UA is currently let through. So the likeliest 403 is "your contact
                # address was rejected", which is fixed by configuring one, not by waiting.
                out["error"] = (
                    "rate limited by the geocoder - wait before trying again" if code == 429
                    else "geocoder refused this client - check LORAN_USER_AGENT carries a real "
                         "contact address" if code == 403
                    else f"geocoder returned HTTP {code}"
                )
                return out
            except Exception as e:                    # noqa: BLE001 - report, do not fail
                self.last_error = f"{type(e).__name__}: {e}"
                out["error"] = f"geocoder unavailable: {type(e).__name__}"
                return out

            # Only real answers are cached; a failure returned above never reaches here. An
            # empty result is cached too, on a shorter clock - "no such place" is a fact worth
            # remembering for a while, and re-asking it is exactly the repeated identical query
            # the policy warns gets clients classified as faulty.
            ttl = GEOCODE_TTL_S if results else GEOCODE_MISS_TTL_S
            self._cache[key] = (time.monotonic() + ttl, results)
            out["results"] = results
            return out


client = GeocodeClient()
