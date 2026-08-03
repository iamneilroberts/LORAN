"""
In-memory ring buffer of recent position fixes (docs/decisions.md D-016).

This is NOT the Phase 5 archive. It holds roughly the last half hour, in RAM, and it dies with
the process. It exists so a track can be drawn and exported before the recorder is built,
without pre-committing to an archive schema the owner has not reviewed yet.

The honesty constraint from D-016 is the whole point of this module: **the buffer must never
imply more history than it holds.** Every read therefore reports the window it actually covers
(`first_ts` / `last_ts` / `span_s`) and whether it has already dropped older points
(`truncated`), so the UI and the GeoJSON export can state the real coverage rather than a
configured ideal.

Timestamps are UTC epoch **integers**, matching the storage rule in CLAUDE.md, so the same
points can be handed to the Phase 5 writer unchanged.

Since D-078 there are TWO instances: the original aircraft buffer (keyed on ICAO hex) and a
vessel buffer (keyed on the vessel key, at a much slower sample rate over a longer window -
ships move at tens of knots, not hundreds). Same store, same honesty rules; only the key
field and the window/sample/capacity numbers differ, so they are constructor parameters that
default to the aircraft configuration the module always had.
"""
from __future__ import annotations

import math
import time
from collections import deque
from typing import Any

from ..config import TRACK_MAX_CONTACTS, TRACK_SAMPLE_S, TRACK_WINDOW_S

# One extra slot so a full buffer still spans the configured window after the oldest point ages
# out mid-sample rather than falling just short of it.
MAX_POINTS = max(2, math.ceil(TRACK_WINDOW_S / max(1.0, TRACK_SAMPLE_S)) + 1)

# (ts, lat, lon, alt_ft) - alt may be None; a contact can report a position without an altitude.
Point = tuple[int, float, float, float | None]


def _distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres (haversine)."""
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial great-circle bearing from point 1 to point 2, degrees true [0, 360)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return math.degrees(math.atan2(y, x)) % 360.0


def _same_place(a: Point, b: Point) -> bool:
    """Exact equality is the right test: both fixes come from the same feed, so an updated
    position produces different floats and a repeated one produces identical bytes."""
    return a[1] == b[1] and a[2] == b[2] and a[3] == b[3]


class TrackStore:
    def __init__(
        self,
        id_field: str = "hex",
        window_s: float | None = None,
        sample_s: float | None = None,
        max_contacts: int | None = None,
    ) -> None:
        # None means "the aircraft defaults from config", read at CALL time rather than frozen
        # here - test_track_store.py monkeypatches the module globals and that must keep working.
        self._id_field = id_field
        self._window_cfg = window_s
        self._sample_cfg = sample_s
        self._max_contacts_cfg = max_contacts
        self._tracks: dict[str, deque[Point]] = {}
        self._last_sample: dict[str, float] = {}
        self._last_prune = 0.0
        self.dropped_contacts = 0

    def _window_s(self) -> float:
        return TRACK_WINDOW_S if self._window_cfg is None else self._window_cfg

    def _sample_s(self) -> float:
        return TRACK_SAMPLE_S if self._sample_cfg is None else self._sample_cfg

    def _max_contacts(self) -> int:
        return TRACK_MAX_CONTACTS if self._max_contacts_cfg is None else self._max_contacts_cfg

    def _max_points(self) -> int:
        return max(2, math.ceil(self._window_s() / max(1.0, self._sample_s())) + 1)

    def record(self, aircraft: list[dict[str, Any]]) -> None:
        """
        Append a sample for every contact carrying a position.

        Called only on a FRESH upstream payload, never on a cache hit, so replaying a cached
        response cannot inflate a track. The per-contact sample floor is a second guard: it
        keeps a fast poll from filling the buffer with near-duplicate points and shortening
        the window the buffer can cover.
        """
        now = time.time()
        for a in aircraft:
            raw_key = a.get(self._id_field)
            # Normalised the same way get() normalises its argument, so the two cannot disagree
            # about case. Aircraft hexes arrive lowercase already; vessel keys go through here too.
            key = str(raw_key).strip().lower() if raw_key is not None else ""
            lat, lon = a.get("lat"), a.get("lon")
            if not key or lat is None or lon is None:
                continue

            last = self._last_sample.get(key)
            if last is not None and now - last < self._sample_s():
                continue

            buf = self._tracks.get(key)
            if buf is None:
                if len(self._tracks) >= self._max_contacts():
                    self._evict_oldest()
                buf = self._tracks[key] = deque(maxlen=self._max_points())

            new: Point = (int(now), float(lat), float(lon), a.get("alt_ft"))
            # A contact whose upstream fix has not moved would otherwise fill all 361 slots
            # with the same coordinate and evict its own real history. Collapse a run of
            # identical positions to its two endpoints - "here from t0" and "still here at
            # t1" - which keeps the observed span honest while costing two points, not 361.
            if len(buf) >= 2 and _same_place(buf[-1], new) and _same_place(buf[-2], new):
                buf[-1] = new
            else:
                buf.append(new)
            self._last_sample[key] = now

        if now - self._last_prune > 60:
            self._prune(now)
            self._last_prune = now

    def _evict_oldest(self) -> None:
        """Drop the least recently updated contact. Bounds memory on a busy viewport."""
        if not self._last_sample:
            return
        oldest = min(self._last_sample, key=lambda k: self._last_sample[k])
        self._tracks.pop(oldest, None)
        self._last_sample.pop(oldest, None)
        self.dropped_contacts += 1

    def _prune(self, now: float) -> None:
        """Forget contacts whose newest fix has aged out of the window entirely."""
        for key in [h for h, t in self._last_sample.items() if now - t > self._window_s()]:
            self._tracks.pop(key, None)
            self._last_sample.pop(key, None)

    def get(self, ident: str) -> dict[str, Any]:
        """
        The track we actually hold for one contact.

        `span_s` is the range these points really cover - NOT the configured window. A contact
        first seen ninety seconds ago has a 90 s track, and the UI must say so rather than
        implying half an hour.
        """
        ident = (ident or "").strip().lower()
        now = time.time()
        cutoff = now - self._window_s()
        raw = self._tracks.get(ident)
        points = [p for p in raw if p[0] >= cutoff] if raw else []

        first_ts = points[0][0] if points else None
        last_ts = points[-1][0] if points else None
        return {
            self._id_field: ident,
            "count": len(points),
            "first_ts": first_ts,
            "last_ts": last_ts,
            "span_s": (last_ts - first_ts) if (first_ts is not None and last_ts is not None) else 0,
            # What the buffer is configured to keep, so the UI can distinguish "short track
            # because the contact is new" from "short track because we only keep 30 minutes".
            "buffer_window_s": int(self._window_s()),
            "sample_s": int(self._sample_s()),
            # True when the buffer is full, i.e. points older than first_ts existed and were
            # discarded. The export says so rather than presenting first_ts as the beginning.
            "truncated": bool(raw is not None and len(raw) >= self._max_points()),
            "points": [
                {"ts": ts, "lat": lat, "lon": lon, "alt_ft": alt}
                for ts, lat, lon, alt in points
            ],
        }

    def bearing_of(
        self, ident: str, min_move_m: float = 50.0, max_gap_s: float = 1800.0,
    ) -> float | None:
        """
        Direction of travel derived from this contact's own recorded fixes, or None.

        Exists for vessels (D-078): the AIS snapshot feed carries no course, and drawing every
        ship pointing north would be invented data. A bearing computed from two of the
        contact's real positions is a measurement - the same standard as dead reckoning - and
        the record that carries it is labelled "derived", never passed off as reported.

        Honesty guards: the two fixes must be at least `min_move_m` apart (below that the
        vector is GPS noise, and a moored ship would appear to steam in a random direction)
        and no more than `max_gap_s` apart (a heading from an hour ago is not a heading).
        """
        ident = (ident or "").strip().lower()
        buf = self._tracks.get(ident)
        if not buf or len(buf) < 2:
            return None
        newest = buf[-1]
        for p in reversed(list(buf)[:-1]):
            if newest[0] - p[0] > max_gap_s:
                return None
            if _distance_m(p[1], p[2], newest[1], newest[2]) >= min_move_m:
                return _bearing_deg(p[1], p[2], newest[1], newest[2])
        return None

    def status(self) -> dict[str, Any]:
        return {
            "contacts": len(self._tracks),
            "points": sum(len(b) for b in self._tracks.values()),
            "window_s": int(self._window_s()),
            "sample_s": int(self._sample_s()),
            "max_points_per_contact": self._max_points(),
            "dropped_contacts": self.dropped_contacts,
            "in_memory_only": True,      # dies with the process. Phase 5 makes it durable.
        }


store = TrackStore()
