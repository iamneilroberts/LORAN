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


def _same_place(a: Point, b: Point) -> bool:
    """Exact equality is the right test: both fixes come from the same feed, so an updated
    position produces different floats and a repeated one produces identical bytes."""
    return a[1] == b[1] and a[2] == b[2] and a[3] == b[3]


class TrackStore:
    def __init__(self) -> None:
        self._tracks: dict[str, deque[Point]] = {}
        self._last_sample: dict[str, float] = {}
        self._last_prune = 0.0
        self.dropped_contacts = 0

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
            hex_code = a.get("hex")
            lat, lon = a.get("lat"), a.get("lon")
            if not hex_code or lat is None or lon is None:
                continue

            last = self._last_sample.get(hex_code)
            if last is not None and now - last < TRACK_SAMPLE_S:
                continue

            buf = self._tracks.get(hex_code)
            if buf is None:
                if len(self._tracks) >= TRACK_MAX_CONTACTS:
                    self._evict_oldest()
                buf = self._tracks[hex_code] = deque(maxlen=MAX_POINTS)

            new: Point = (int(now), float(lat), float(lon), a.get("alt_ft"))
            # A contact whose upstream fix has not moved would otherwise fill all 361 slots
            # with the same coordinate and evict its own real history. Collapse a run of
            # identical positions to its two endpoints - "here from t0" and "still here at
            # t1" - which keeps the observed span honest while costing two points, not 361.
            if len(buf) >= 2 and _same_place(buf[-1], new) and _same_place(buf[-2], new):
                buf[-1] = new
            else:
                buf.append(new)
            self._last_sample[hex_code] = now

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
        for hex_code in [h for h, t in self._last_sample.items() if now - t > TRACK_WINDOW_S]:
            self._tracks.pop(hex_code, None)
            self._last_sample.pop(hex_code, None)

    def get(self, hex_code: str) -> dict[str, Any]:
        """
        The track we actually hold for one contact.

        `span_s` is the range these points really cover - NOT the configured window. A contact
        first seen ninety seconds ago has a 90 s track, and the UI must say so rather than
        implying half an hour.
        """
        hex_code = (hex_code or "").strip().lower()
        now = time.time()
        cutoff = now - TRACK_WINDOW_S
        raw = self._tracks.get(hex_code)
        points = [p for p in raw if p[0] >= cutoff] if raw else []

        first_ts = points[0][0] if points else None
        last_ts = points[-1][0] if points else None
        return {
            "hex": hex_code,
            "count": len(points),
            "first_ts": first_ts,
            "last_ts": last_ts,
            "span_s": (last_ts - first_ts) if (first_ts is not None and last_ts is not None) else 0,
            # What the buffer is configured to keep, so the UI can distinguish "short track
            # because the contact is new" from "short track because we only keep 30 minutes".
            "buffer_window_s": int(TRACK_WINDOW_S),
            "sample_s": int(TRACK_SAMPLE_S),
            # True when the buffer is full, i.e. points older than first_ts existed and were
            # discarded. The export says so rather than presenting first_ts as the beginning.
            "truncated": bool(raw is not None and len(raw) >= MAX_POINTS),
            "points": [
                {"ts": ts, "lat": lat, "lon": lon, "alt_ft": alt}
                for ts, lat, lon, alt in points
            ],
        }

    def status(self) -> dict[str, Any]:
        return {
            "contacts": len(self._tracks),
            "points": sum(len(b) for b in self._tracks.values()),
            "window_s": int(TRACK_WINDOW_S),
            "sample_s": int(TRACK_SAMPLE_S),
            "max_points_per_contact": MAX_POINTS,
            "dropped_contacts": self.dropped_contacts,
            "in_memory_only": True,      # dies with the process. Phase 5 makes it durable.
        }


store = TrackStore()
