"""
Geocoding (D-069). The easy fake pass here is asserting that a well-formed Nominatim result
parses — it does, and that proves almost nothing.

The weight is on the three ways this feature causes real harm: silently moving the console on a
bad or absent answer, quietly inventing a place name for a position that has none, and calling
upstream more often than the policy's absolute 1 req/s allows. Each has a test that FAILS if the
guard is removed, not merely one that passes while it is present.

No network is touched. The upstream call is stubbed where a call is needed at all; the disabled
and empty-query cases assert that no call was even attempted.
"""
import asyncio

import httpx
import pytest

from app import config
from app.feeds import geocode
from app.feeds.geocode import GeocodeClient, normalize


def result(**over):
    """A realistic Nominatim jsonv2 result; override just the field under test."""
    base = {
        "lat": "30.6901170",
        "lon": "-88.0411905",
        "name": "",
        "display_name": "150, Government Street, Downtown, Mobile, Alabama, 36602, United States",
        "addresstype": "place",
        "type": "house",
    }
    base.update(over)
    return base


# --------------------------------------------------------------------------- normalize

def test_parses_a_real_result():
    n = normalize(result(name="Mobile Regional Airport", addresstype="aeroway"))
    assert n is not None
    assert n["lat"] == pytest.approx(30.6901170)
    assert n["lon"] == pytest.approx(-88.0411905)
    assert n["name"] == "Mobile Regional Airport"
    assert n["kind"] == "aeroway"


def test_empty_name_is_preserved_not_filled_in():
    """
    A street address comes back with name "". That emptiness is the signal the frontend uses to
    fall back to a coordinate label, so anything that fills it here — even from real fragments of
    display_name — would manufacture a place name for a place that has none (D-068, D-069).
    """
    n = normalize(result())
    assert n is not None
    assert n["name"] == ""
    assert n["detail"].startswith("150, Government Street")


def test_name_is_verbatim_not_prettified():
    n = normalize(result(name="Saint-Étienne-du-Rouvray"))
    assert n is not None
    assert n["name"] == "Saint-Étienne-du-Rouvray"


@pytest.mark.parametrize("bad", [
    {"lat": None}, {"lat": "not-a-number"}, {"lon": ""},
    {"lat": "91.0"}, {"lat": "-90.5"}, {"lon": "180.5"}, {"lon": "-181"},
])
def test_unusable_positions_are_dropped(bad):
    """
    This value reaches the camera and the fetch centre. A result we cannot turn into a real
    position is discarded, never coerced — `float(None)` raising is not a substitute for the
    range check, and a silent 0 would put the console in the Gulf of Guinea.
    """
    assert normalize(result(**bad)) is None


def test_missing_coordinates_are_dropped():
    r = result()
    del r["lat"]
    assert normalize(r) is None


# --------------------------------------------------------------------------- search

def test_the_rate_limit_floor_cannot_be_configured_below_the_policy():
    """1 req/s is Nominatim's ABSOLUTE maximum, so the setting clamps up, not down."""
    assert config.GEOCODE_MIN_INTERVAL_S >= 1.0


def test_disabled_without_a_contact_address_and_does_not_call_upstream(monkeypatch):
    """
    The whole on/off switch. With the shipped placeholder UA the policy's "identify yourself"
    requirement is unmet, so a clone that nobody configured must not generate traffic at all.
    """
    monkeypatch.setattr(geocode, "USER_AGENT", config.PLACEHOLDER_USER_AGENT)
    c = GeocodeClient()
    out = asyncio.run(c.search("Mobile, Alabama"))
    assert out["results"] == []
    assert out["error"] and "LORAN_USER_AGENT" in out["error"]
    assert c.upstream_calls == 0
    assert c.status()["enabled"] is False


def test_empty_query_is_refused_without_calling_upstream(monkeypatch):
    monkeypatch.setattr(geocode, "USER_AGENT", "loran-test/1 (+mailto:test@example.com)")
    c = GeocodeClient()
    out = asyncio.run(c.search("   "))
    assert out["error"] == "empty query"
    assert c.upstream_calls == 0


def _stubbed(monkeypatch, payload):
    """A client whose upstream call is replaced by a counter, so caching is observable."""
    monkeypatch.setattr(geocode, "USER_AGENT", "loran-test/1 (+mailto:test@example.com)")
    c = GeocodeClient()
    calls = []

    async def fake_fetch(query):
        calls.append(query)
        return payload

    monkeypatch.setattr(c, "_fetch", fake_fetch)
    return c, calls


def test_every_candidate_is_returned_and_none_is_chosen(monkeypatch):
    """
    Ambiguity is the operator's to resolve. "Springfield" matches dozens of places and the
    backend must hand back all of them rather than ranking one into a silent first-hit answer.
    """
    springfields = [
        {"lat": 39.799, "lon": -89.644, "name": "Springfield", "detail": "…Illinois…", "kind": "city"},
        {"lat": 42.102, "lon": -72.589, "name": "Springfield", "detail": "…Massachusetts…", "kind": "city"},
        {"lat": 37.208, "lon": -93.292, "name": "Springfield", "detail": "…Missouri…", "kind": "city"},
    ]
    c, _ = _stubbed(monkeypatch, springfields)
    out = asyncio.run(c.search("Springfield"))
    assert len(out["results"]) == 3
    assert out["error"] is None


def test_a_miss_is_an_answer_not_an_error(monkeypatch):
    """
    Upstream signals "no such place" as HTTP 200 with an empty array. It must arrive as an empty
    result with error None — the caller distinguishes "no such place" from "could not ask", and
    collapsing them is how a failed lookup ends up reading like a successful one.
    """
    c, _ = _stubbed(monkeypatch, [])
    out = asyncio.run(c.search("zzzzqqqnotaplace12345"))
    assert out["results"] == []
    assert out["error"] is None


def test_repeat_queries_are_served_from_cache(monkeypatch):
    """
    Caching is a policy requirement, not an optimisation: "clients sending repeatedly the same
    query may be classified as faulty and blocked."
    """
    c, calls = _stubbed(monkeypatch, [{"lat": 1.0, "lon": 2.0, "name": "X", "detail": "x", "kind": "city"}])

    async def twice():
        await c.search("Mobile, Alabama")
        return await c.search("Mobile, Alabama")

    out = asyncio.run(twice())
    assert len(calls) == 1
    assert c.cache_hits == 1
    assert out["results"][0]["name"] == "X"


def test_cache_key_ignores_case_and_spacing(monkeypatch):
    """The same place typed twice by a human is the same query, and must not be asked twice."""
    c, calls = _stubbed(monkeypatch, [{"lat": 1.0, "lon": 2.0, "name": "X", "detail": "x", "kind": "city"}])

    async def variants():
        await c.search("Mobile, Alabama")
        await c.search("  mobile,   ALABAMA ")

    asyncio.run(variants())
    assert len(calls) == 1


@pytest.mark.parametrize("code,expected", [
    (429, "rate limited"),
    (403, "LORAN_USER_AGENT"),
    (500, "HTTP 500"),
])
def test_refusal_and_throttling_are_told_apart(monkeypatch, code, expected):
    """
    403 and 429 are different problems with different fixes, and conflating them sends the
    operator to wait out a block that waiting cannot clear. Measured 2026-07-26: Nominatim
    answers 403 to a UA carrying a placeholder contact domain, so the likely 403 is a rejected
    User-Agent, not throttling.
    """
    monkeypatch.setattr(geocode, "USER_AGENT", "loran-test/1 (+mailto:test@example.com)")
    c = GeocodeClient()
    request = httpx.Request("GET", "https://example.invalid/search")
    response = httpx.Response(code, request=request)

    async def refuse(query):
        raise httpx.HTTPStatusError("refused", request=request, response=response)

    monkeypatch.setattr(c, "_fetch", refuse)
    out = asyncio.run(c.search("Mobile, Alabama"))
    assert out["results"] == []
    assert expected in out["error"]
    # A refusal must not be remembered as an answer.
    assert c._cache == {}


def test_upstream_failure_is_reported_and_not_cached(monkeypatch):
    """
    A failure must never be remembered as "no such place" — that would turn one network blip
    into an hour of confidently wrong empty answers.
    """
    monkeypatch.setattr(geocode, "USER_AGENT", "loran-test/1 (+mailto:test@example.com)")
    c = GeocodeClient()
    state = {"fail": True}

    async def flaky(query):
        if state["fail"]:
            raise OSError("connection refused")
        return [{"lat": 1.0, "lon": 2.0, "name": "X", "detail": "x", "kind": "city"}]

    monkeypatch.setattr(c, "_fetch", flaky)

    first = asyncio.run(c.search("Mobile, Alabama"))
    assert first["error"] and "unavailable" in first["error"]
    assert first["results"] == []

    state["fail"] = False
    second = asyncio.run(c.search("Mobile, Alabama"))
    assert second["error"] is None
    assert second["results"][0]["name"] == "X"
