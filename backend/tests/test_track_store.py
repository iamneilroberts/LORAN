"""
D-016's honesty constraint is the whole reason this module exists: **the buffer must never imply
more history than it holds.** These tests are aimed squarely at that, because it is the property
that fails silently - a track that quietly claims half an hour of coverage it never had looks
exactly like a correct one.

Time is injected via monkeypatched `time.time` rather than by sleeping, so the sample floor and
the window can be exercised in milliseconds instead of minutes.
"""
import pytest

from app.config import TRACK_SAMPLE_S, TRACK_WINDOW_S
from app.feeds import track as track_mod
from app.feeds.track import MAX_POINTS, TrackStore


@pytest.fixture
def clock(monkeypatch):
    """A controllable clock. `clock.set(t)` moves wall time for the module under test."""
    class Clock:
        now = 1_785_000_000.0

        def set(self, t):
            self.now = float(t)

        def advance(self, dt):
            self.now += float(dt)

    c = Clock()
    monkeypatch.setattr(track_mod.time, "time", lambda: c.now)
    return c


def fix(hex_code="a39dca", lat=30.0, lon=-88.0, alt=30000.0):
    return {"hex": hex_code, "lat": lat, "lon": lon, "alt_ft": alt}


class TestRecording:
    def test_records_a_position(self, clock):
        s = TrackStore()
        s.record([fix()])
        got = s.get("a39dca")
        assert got["count"] == 1
        assert got["points"][0]["lat"] == 30.0
        assert got["points"][0]["alt_ft"] == 30000.0

    def test_skips_contacts_with_no_position(self, clock):
        s = TrackStore()
        s.record([{"hex": "abc", "lat": None, "lon": None}, {"lat": 1.0, "lon": 2.0}])
        assert s.get("abc")["count"] == 0

    def test_enforces_the_per_contact_sample_floor(self, clock):
        # A fast poll must not fill the buffer with near-duplicates and shorten the window
        # the buffer is able to cover.
        s = TrackStore()
        s.record([fix(lat=30.0)])
        clock.advance(TRACK_SAMPLE_S / 2)
        s.record([fix(lat=30.1)])
        assert s.get("a39dca")["count"] == 1

        clock.advance(TRACK_SAMPLE_S)
        s.record([fix(lat=30.2)])
        assert s.get("a39dca")["count"] == 2

    def test_timestamps_are_utc_epoch_integers(self, clock):
        # CLAUDE.md's storage rule: these points go to the Phase 5 writer unchanged.
        s = TrackStore()
        s.record([fix()])
        ts = s.get("a39dca")["points"][0]["ts"]
        assert isinstance(ts, int)

    def test_keeps_a_position_without_an_altitude(self, clock):
        # A contact can report a position with no altitude; the fix is still real.
        s = TrackStore()
        s.record([fix(alt=None)])
        assert s.get("a39dca")["points"][0]["alt_ft"] is None


class TestStationaryCollapse:
    def test_a_parked_contact_does_not_evict_its_own_history(self, clock):
        # The failure this guards: an aircraft sitting on a stand fills every slot with one
        # coordinate and pushes out the real track that preceded it.
        #
        # Note MAX_POINTS is sized to cover exactly TRACK_WINDOW_S, so a parked run long enough
        # to overflow the deque would also have aged the early fixes out of the window on its
        # own. The property under test is therefore that the run does not GROW the buffer:
        # 200 stationary samples must cost one point, not two hundred.
        s = TrackStore()
        for i in range(5):
            s.record([fix(lat=30.0 + i * 0.1)])
            clock.advance(TRACK_SAMPLE_S)
        moved = s.get("a39dca")["count"]
        assert moved == 5

        parked_samples = 200
        assert parked_samples * TRACK_SAMPLE_S < TRACK_WINDOW_S     # stay inside the window
        for _ in range(parked_samples):
            s.record([fix(lat=30.4)])          # parked at the last position
            clock.advance(TRACK_SAMPLE_S)

        got = s.get("a39dca")
        # Every moving fix survives, and the whole stationary run collapsed to one extra point.
        assert got["count"] == moved + 1
        assert got["points"][0]["lat"] == 30.0
        assert got["points"][-1]["lat"] == 30.4

    def test_collapse_keeps_the_span_honest(self, clock):
        # "Here from t0, still here at t1" - the span must reflect the real dwell, not the
        # two samples it was collapsed into.
        s = TrackStore()
        s.record([fix(lat=30.0)])
        clock.advance(TRACK_SAMPLE_S)
        s.record([fix(lat=30.0)])
        start_span = s.get("a39dca")["span_s"]

        for _ in range(10):
            clock.advance(TRACK_SAMPLE_S)
            s.record([fix(lat=30.0)])

        got = s.get("a39dca")
        assert got["count"] == 2
        assert got["span_s"] > start_span


class TestCoverageHonesty:
    def test_span_is_what_the_points_cover_not_the_configured_window(self, clock):
        # A contact first seen 90 s ago has a 90 s track. Reporting the 1800 s buffer size
        # here would be inventing history - the exact thing D-016 forbids.
        s = TrackStore()
        s.record([fix()])
        for _ in range(18):
            clock.advance(TRACK_SAMPLE_S)
            s.record([fix(lat=30.0 + clock.now % 1)])

        got = s.get("a39dca")
        assert got["span_s"] == pytest.approx(90, abs=TRACK_SAMPLE_S)
        assert got["span_s"] < got["buffer_window_s"]
        assert got["buffer_window_s"] == int(TRACK_WINDOW_S)

    def test_not_truncated_until_the_buffer_is_actually_full(self, clock):
        s = TrackStore()
        s.record([fix()])
        assert s.get("a39dca")["truncated"] is False

    def test_reports_truncated_once_older_points_were_discarded(self, clock):
        # This flag is what stops the GeoJSON reader taking first_fix for the start of a flight.
        s = TrackStore()
        for i in range(MAX_POINTS + 20):
            s.record([fix(lat=30.0 + i * 0.001)])
            clock.advance(TRACK_SAMPLE_S)
        got = s.get("a39dca")
        assert got["truncated"] is True
        assert got["count"] <= MAX_POINTS

    def test_empty_track_reports_zero_span_not_a_fake_window(self, clock):
        s = TrackStore()
        got = s.get("never-seen")
        assert got["count"] == 0
        assert got["span_s"] == 0
        assert got["first_ts"] is None and got["last_ts"] is None
        assert got["points"] == []

    def test_excludes_points_older_than_the_window(self, clock):
        s = TrackStore()
        s.record([fix(lat=30.0)])
        clock.advance(TRACK_WINDOW_S + 60)
        s.record([fix(lat=31.0)])
        got = s.get("a39dca")
        assert got["count"] == 1
        assert got["points"][0]["lat"] == 31.0

    def test_lookup_is_case_insensitive_and_trimmed(self, clock):
        # The UI sends an uppercased hex; the store keys on the feed's lowercase form.
        s = TrackStore()
        s.record([fix(hex_code="a39dca")])
        assert s.get("A39DCA")["count"] == 1
        assert s.get("  A39dcA  ")["count"] == 1


class TestBounding:
    def test_evicts_the_least_recently_updated_contact_at_capacity(self, clock, monkeypatch):
        monkeypatch.setattr(track_mod, "TRACK_MAX_CONTACTS", 3)
        s = TrackStore()
        for i, h in enumerate(["aaa", "bbb", "ccc"]):
            s.record([fix(hex_code=h)])
            clock.advance(TRACK_SAMPLE_S)

        # Refresh the oldest so it is no longer the eviction candidate.
        s.record([fix(hex_code="aaa", lat=31.0)])
        clock.advance(TRACK_SAMPLE_S)

        s.record([fix(hex_code="ddd")])
        assert s.get("bbb")["count"] == 0      # evicted
        assert s.get("aaa")["count"] > 0       # kept, recently updated
        assert s.dropped_contacts == 1

    def test_prunes_contacts_whose_newest_fix_aged_out(self, clock):
        s = TrackStore()
        s.record([fix(hex_code="stale")])
        clock.advance(TRACK_WINDOW_S + 120)
        s.record([fix(hex_code="fresh")])       # triggers the periodic prune
        assert s.get("stale")["count"] == 0
        assert s.get("fresh")["count"] == 1

    def test_status_counts_what_is_held(self, clock):
        s = TrackStore()
        s.record([fix(hex_code="aaa"), fix(hex_code="bbb")])
        assert s.status()["contacts"] == 2
