"""
AIS normalizer and client honesty (D-078).

The normalizer cases live in fixtures/ais/cases.json - OUTSIDE backend/ - for the same reason
the ADS-B cases do: if a second implementation ever normalizes position-api rows (the way
upstream.ts shadows adsb.py for the single-file build), it must assert the same file. Every
case there is synthetic and says so; see fixtures/ais/README.md.

The client tests below run WITHOUT a network: they exercise exactly the states that must be
honest when there is no position-api to talk to - which is the state every fresh install is in.
"""
import asyncio
import json
from pathlib import Path

import pytest

from app.feeds import ais as ais_mod
from app.feeds.ais import AisClient, normalize_vessel, vessel_category

FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "ais" / "cases.json"


def _cases():
    data = json.loads(FIXTURE.read_text())
    return data["cases"]


CASES = _cases()


def test_fixture_exists_and_is_populated():
    assert FIXTURE.exists(), "shared fixture missing: fixtures/ais/cases.json"
    assert len(CASES) >= 10


def test_every_case_declares_its_provenance():
    # All-synthetic is the honest current state (no live instance was reachable when the
    # fixture was written) - but each case must SAY so, per ground rule 1.
    for case in CASES:
        assert "synthetic" in case and "provenance" in case, case["name"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_normalizer_matches_fixture(case):
    assert normalize_vessel(case["raw"]) == case["expected"]


class TestCategoryMapping:
    def test_unknown_when_source_said_nothing(self):
        assert vessel_category(None) == "unknown"
        assert vessel_category("") == "unknown"

    def test_other_when_source_said_something_unmapped(self):
        # "Wing In Grnd" is a real MT TYPE_SUMMARY this table does not map; it must land in
        # "other" (the source said something) rather than "unknown" (the source said nothing).
        assert vessel_category("Wing In Grnd") == "other"

    def test_specific_phrases_win_over_substrings(self):
        # "High Speed Craft" must not fall through to some other bucket.
        assert vessel_category("High Speed Craft") == "highspeed"
        assert vessel_category("Pleasure Craft") == "pleasure"


class TestUnconfiguredHonesty:
    """With no LORAN_AIS_BASE_URL the client must say 'no source', never invent an empty sea."""

    def test_not_configured_by_default(self, monkeypatch):
        monkeypatch.setattr(ais_mod, "AIS_BASE_URL", "")
        c = AisClient()
        assert c.configured is False
        st = c.status()
        assert st["configured"] is False
        assert "reason" in st

    def test_vessels_payload_is_explicit_about_the_missing_source(self, monkeypatch):
        monkeypatch.setattr(ais_mod, "AIS_BASE_URL", "")
        c = AisClient()
        payload = asyncio.run(c.vessels(30.69, -88.04))
        assert payload["configured"] is False
        assert payload["vessels"] == [] and payload["count"] == 0
        assert payload["errors"], "the missing source must be stated, not silent"

    def test_detail_is_explicit_too(self, monkeypatch):
        monkeypatch.setattr(ais_mod, "AIS_BASE_URL", "")
        c = AisClient()
        d = asyncio.run(c.detail("255806173"))
        assert d["course_deg"] is None and d["errors"]

    def test_status_never_leaks_the_base_url(self, monkeypatch):
        # /api/health is an open endpoint; the owner's internal address must not appear in it.
        monkeypatch.setattr(ais_mod, "AIS_BASE_URL", "http://192.168.1.50:5000")
        c = AisClient()
        assert "192.168.1.50" not in json.dumps(c.status())


class TestVesselTrackStore:
    """The generalized TrackStore keyed on the vessel key (see test_track_store.py for the
    full honesty suite - this only covers what the generalization added)."""

    def test_keys_on_the_configured_field_and_reports_it(self):
        from app.feeds.track import TrackStore
        s = TrackStore(id_field="key", window_s=3600.0, sample_s=60.0, max_contacts=10)
        s.record([{"key": "255806173", "lat": 30.5, "lon": -88.1}])
        got = s.get("255806173")
        assert got["key"] == "255806173"
        assert got["count"] == 1
        assert got["buffer_window_s"] == 3600

    def test_ship_id_fallback_keys_survive_a_round_trip(self):
        from app.feeds.track import TrackStore
        s = TrackStore(id_field="key", window_s=3600.0, sample_s=60.0, max_contacts=10)
        s.record([{"key": "s9214001", "lat": 30.3, "lon": -88.1}])
        assert s.get("S9214001")["count"] == 1   # case-insensitive, like the aircraft store


class TestDerivedCourse:
    """bearing_of: a heading measured from the contact's own fixes, with honesty guards."""

    def _store(self, monkeypatch, clock):
        from app.feeds import track as track_mod
        from app.feeds.track import TrackStore
        monkeypatch.setattr(track_mod.time, "time", lambda: clock["now"])
        return TrackStore(id_field="key", window_s=7200.0, sample_s=1.0, max_contacts=10)

    def test_northbound_movement_derives_roughly_zero_degrees(self, monkeypatch):
        clock = {"now": 1_785_000_000.0}
        s = self._store(monkeypatch, clock)
        s.record([{"key": "255806173", "lat": 30.00, "lon": -88.10}])
        clock["now"] += 60
        s.record([{"key": "255806173", "lat": 30.01, "lon": -88.10}])   # ~1.1 km due north
        b = s.bearing_of("255806173")
        assert b is not None and (b < 1 or b > 359)

    def test_eastbound_movement_derives_roughly_ninety(self, monkeypatch):
        clock = {"now": 1_785_000_000.0}
        s = self._store(monkeypatch, clock)
        s.record([{"key": "255806173", "lat": 30.00, "lon": -88.10}])
        clock["now"] += 60
        s.record([{"key": "255806173", "lat": 30.00, "lon": -88.09}])
        b = s.bearing_of("255806173")
        assert b == pytest.approx(90, abs=2)

    def test_a_moored_vessel_gets_no_invented_heading(self, monkeypatch):
        # GPS jitter of a few metres must not become a confident direction of travel.
        clock = {"now": 1_785_000_000.0}
        s = self._store(monkeypatch, clock)
        s.record([{"key": "moored", "lat": 30.000000, "lon": -88.100000}])
        clock["now"] += 60
        s.record([{"key": "moored", "lat": 30.000020, "lon": -88.100020}])  # ~3 m
        assert s.bearing_of("moored") is None

    def test_single_fix_gives_nothing(self, monkeypatch):
        clock = {"now": 1_785_000_000.0}
        s = self._store(monkeypatch, clock)
        s.record([{"key": "new", "lat": 30.0, "lon": -88.1}])
        assert s.bearing_of("new") is None

    def test_a_stale_pair_gives_nothing(self, monkeypatch):
        # A heading from an hour ago is not a heading.
        clock = {"now": 1_785_000_000.0}
        s = self._store(monkeypatch, clock)
        s.record([{"key": "old", "lat": 30.00, "lon": -88.10}])
        clock["now"] += 3600
        s.record([{"key": "old", "lat": 30.05, "lon": -88.10}])
        assert s.bearing_of("old", max_gap_s=1800.0) is None
