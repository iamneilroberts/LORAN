"""
planespotters photo lookup - JSON ONLY. Image bytes are never touched here.

This module is the one deliberate exception to "the backend proxies upstream feeds"
(docs/decisions.md D-009). Their terms forbid downloading, storing, re-hosting or rewriting
image binaries, so:

  - the backend fetches the JSON with a contact-carrying User-Agent and caches it,
  - the browser loads the image straight from their CDN at the URL they gave us, unmodified,
  - the photographer credit travels with the photo and is rendered as visible text,
  - the endpoint stays private. Their clause 8 forbids re-exposing their API.

Nothing here writes an image to disk or proxies one through a response.

WRONG-AIRCRAFT HAZARD (measured 2026-07-25)
-------------------------------------------
Their hex endpoint returns a real photo of the WRONG aircraft for two hex values:

    /pub/photos/hex/FFFFFE -> 05-0419, a USAF U-28A
    /pub/photos/hex/000001 -> FAC1285, a Colombian Air Force aircraft

Both are classic misconfigured-transponder values that end up recorded literally in aircraft
databases, and planespotters has records carrying them. FFFFFF, 000000, FFFFFD and 000002 all
correctly return no photos, so this is bad data on a few records rather than a fallback feature.

A contact broadcasting one of those hexes is exactly the kind of contact an operator would look
at twice, and showing it someone else's aircraft would be the worst possible failure of ground
rule 1. Two defences, in order:

  1. prefer the REGISTRATION endpoint whenever we have a registration. It is a far stronger key
     and was correct on every case tested.
  2. refuse to query the hex endpoint at all for known-bad hexes.
"""
from __future__ import annotations

import asyncio
import re
import time
from typing import Any

import httpx

from ..config import PHOTO_MISS_TTL_S, PHOTO_TTL_S, USER_AGENT

HEX_URL = "https://api.planespotters.net/pub/photos/hex/{key}"
REG_URL = "https://api.planespotters.net/pub/photos/reg/{key}"

HEX_RE = re.compile(r"^[0-9A-F]{6}$")
REG_RE = re.compile(r"^[0-9A-Z][0-9A-Z\-]{1,11}$")

# Hex values measured to return a real photo of an unrelated aircraft, plus the reserved
# all-zero / all-one addresses. Never queried by hex.
POISONED_HEX = {"000000", "000001", "FFFFFD", "FFFFFE", "FFFFFF"}


def normalize_photo(raw: dict[str, Any]) -> dict[str, Any] | None:
    """
    One entry from their `photos` array -> what the dossier needs.

    URLs are passed through EXACTLY as given. Rewriting them - even swapping a size suffix -
    is forbidden by their terms, so both sizes come from the fields they published.
    """
    thumb = raw.get("thumbnail_large") or raw.get("thumbnail")
    if not isinstance(thumb, dict):
        return None
    src = thumb.get("src")
    link = raw.get("link")
    if not isinstance(src, str) or not isinstance(link, str):
        return None
    size = thumb.get("size") if isinstance(thumb.get("size"), dict) else {}
    return {
        "src": src,
        "width": size.get("width"),
        "height": size.get("height"),
        "link": link,                                    # photo page, for the required credit link
        "photographer": raw.get("photographer") or None,
    }


class PlanespottersClient:
    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None
        self._cache: dict[str, tuple[float, dict[str, Any] | None]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._gate = asyncio.Lock()
        self._last_upstream = 0.0
        self.upstream_calls = 0
        self.cache_hits = 0
        self.last_error: str | None = None

    async def start(self) -> None:
        # The contact-carrying UA is not optional: docs/data-sources.md 4.2. It is also the
        # only thing that makes this a legitimate API consumer rather than an anonymous scraper.
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

    async def _fetch(self, url: str) -> dict[str, Any] | None:
        assert self._client is not None
        async with self._gate:
            wait = 1.0 - (time.monotonic() - self._last_upstream)
            if wait > 0:
                await asyncio.sleep(wait)
            r = await self._client.get(url)
            self._last_upstream = time.monotonic()
            self.upstream_calls += 1
        # A miss is {"photos": []} with a 200, not a 404. A 403 means the UA gate rejected us.
        r.raise_for_status()
        data = r.json()
        photos = data.get("photos") if isinstance(data, dict) else None
        if not isinstance(photos, list) or not photos:
            return None
        return normalize_photo(photos[0]) if isinstance(photos[0], dict) else None

    async def _lookup(self, key: str, url: str) -> dict[str, Any] | None:
        cached = self._cache.get(key)
        if cached and time.monotonic() < cached[0]:
            self.cache_hits += 1
            return cached[1]

        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            cached = self._cache.get(key)
            if cached and time.monotonic() < cached[0]:
                self.cache_hits += 1
                return cached[1]
            value = await self._fetch(url)
            ttl = PHOTO_TTL_S if value else PHOTO_MISS_TTL_S
            self._cache[key] = (time.monotonic() + ttl, value)
            return value

    async def photo(self, hex_code: str | None, registration: str | None) -> dict[str, Any]:
        """
        One photo for a contact. Never raises.

        Registration first - it is the stronger key and avoids the poisoned-hex problem
        entirely. Hex is only a fallback, and only for hexes we trust.
        """
        hex_code = (hex_code or "").strip().upper() or None
        registration = (registration or "").strip().upper() or None
        out: dict[str, Any] = {
            "hex": hex_code,
            "registration": registration,
            "photo": None,
            "matched_on": None,
            "errors": [],
        }

        attempts: list[tuple[str, str, str]] = []
        if registration and REG_RE.match(registration):
            attempts.append(("registration", f"reg:{registration}", REG_URL.format(key=registration)))
        if hex_code and HEX_RE.match(hex_code) and hex_code not in POISONED_HEX:
            attempts.append(("hex", f"hex:{hex_code}", HEX_URL.format(key=hex_code)))

        for matched_on, key, url in attempts:
            try:
                found = await self._lookup(key, url)
            except Exception as e:                        # noqa: BLE001 - report, do not fail
                self.last_error = f"{type(e).__name__}: {e}"
                out["errors"].append(f"{matched_on}: {self.last_error}")
                continue
            if found:
                out["photo"] = found
                out["matched_on"] = matched_on
                break

        return out


client = PlanespottersClient()
