"""
The pytest half of the shared normalizer fixture. Its twin is
`frontend/src/data/normalizerParity.test.ts`, and both read the SAME file.

`adsb.py` and `upstream.ts` are two implementations of one contract (see
`fixtures/adsb/README.md`). Nothing enforced their agreement until this existed; they agreed only
because they were written from the same notes, which stops being true the moment either is edited
alone.

The easy fake pass here would be a test that regenerates `expected` from `adsb.py` and compares it
to itself. That would pass forever and prove nothing. `expected` is committed data, reviewed by
hand against docs/data-sources.md §3.1 - so this arm genuinely fails if `adsb.py` changes
behaviour, and the vitest arm genuinely fails if `upstream.ts` does.
"""
import json
from pathlib import Path

import pytest

from app.feeds.adsb import normalize

FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "adsb" / "cases.json"
CASES = json.loads(FIXTURE.read_text())["cases"]


def test_the_fixture_is_actually_there():
    """If the path drifts, every parametrised test below silently collapses to zero cases."""
    assert FIXTURE.is_file(), f"missing fixture: {FIXTURE}"
    assert len(CASES) >= 15, f"expected the full case set, got {len(CASES)}"


def test_the_fixture_still_contains_real_records():
    """
    The value of this fixture is that most of it is real traffic. A refresh that quietly replaced
    the observed records with constructed ones would keep every test green while removing the
    reason to trust them.
    """
    real = [c for c in CASES if not c["synthetic"]]
    assert len(real) >= 8, f"only {len(real)} real records left in the fixture"


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_python_normalizer_matches_the_fixture(case):
    assert normalize(case["raw"]) == case["expected"]


def test_the_documented_traps_are_covered():
    """
    Guards the fixture's coverage rather than the normalizer's behaviour. These are the cases
    docs/data-sources.md calls out as the ones that bite; losing one from the fixture would be a
    silent reduction in what parity actually means.
    """
    names = " | ".join(c["name"] for c in CASES)
    for trap in ("on_ground", "military", "ladd", "pia", "no alt_geom", "negative", "dropped"):
        assert trap in names, f"fixture no longer covers: {trap}"
