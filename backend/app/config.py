"""
Configuration, read from .env at the repo root.

Deliberately does not use python-dotenv: the stack in CLAUDE.md does not list it, and parsing
KEY=VALUE lines is ten lines of boring code. Rule 2 says ask before adding a dependency; this
did not need one.
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = ROOT / ".env"


def _load_env() -> None:
    if not ENV_PATH.exists():
        return
    for raw in ENV_PATH.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip().strip('"').strip("'")
        # real environment wins over .env
        os.environ.setdefault(key, val)


_load_env()


def _f(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


# planespotters returns 403 without a contact address in the UA, and it is polite to the
# volunteer-funded ADS-B feeds to identify ourselves too. See docs/data-sources.md 4.2.
USER_AGENT = os.environ.get(
    "ADSBVIZ_USER_AGENT", "adsb-viz/0.1 (+mailto:unset@example.com)"
)

HOME_LAT = _f("ADSBVIZ_HOME_LAT", 30.6944)
HOME_LON = _f("ADSBVIZ_HOME_LON", -88.0399)
HOME_LABEL = os.environ.get("ADSBVIZ_HOME_LABEL", "MOBILE, AL")

# airplanes.live documents 1 request/second. We poll slower than that and share one upstream
# call across every connected browser, so the limit holds no matter how many tabs are open.
POLL_SECONDS = _f("ADSBVIZ_ADSB_POLL_SECONDS", 2.0)
MAX_RADIUS_NM = _f("ADSBVIZ_ADSB_MAX_RADIUS_NM", 250.0)

# adsbdb enrichment. No key, no published limit, so we set our own budget: airframe data is
# static per hull and cached for a day; routes change per flight and are cached for an hour;
# a miss is cached briefly so an unknown hex is not re-asked on every selection.
ADSBDB_TTL_S = _f("ADSBVIZ_ADSBDB_TTL_SECONDS", 86400.0)
ADSBDB_ROUTE_TTL_S = _f("ADSBVIZ_ADSBDB_ROUTE_TTL_SECONDS", 3600.0)
ADSBDB_MISS_TTL_S = _f("ADSBVIZ_ADSBDB_MISS_TTL_SECONDS", 3600.0)
ADSBDB_MIN_INTERVAL_S = _f("ADSBVIZ_ADSBDB_MIN_INTERVAL_SECONDS", 0.2)

# planespotters photo JSON. D-009 caps the cache at 24 h. Image bytes are never cached
# anywhere - the browser loads those straight from their CDN.
PHOTO_TTL_S = min(_f("ADSBVIZ_PHOTO_TTL_SECONDS", 86400.0), 86400.0)
PHOTO_MISS_TTL_S = _f("ADSBVIZ_PHOTO_MISS_TTL_SECONDS", 21600.0)

# Track ring buffer (D-016). In memory, dies with the process; Phase 5 makes it durable.
# The sample floor matters: at a 2 s poll an unthrottled buffer is 900 near-identical points
# per contact, which costs memory without lengthening the window it can cover.
TRACK_WINDOW_S = _f("ADSBVIZ_TRACK_WINDOW_SECONDS", 1800.0)
TRACK_SAMPLE_S = _f("ADSBVIZ_TRACK_SAMPLE_SECONDS", 5.0)
TRACK_MAX_CONTACTS = int(_f("ADSBVIZ_TRACK_MAX_CONTACTS", 3000))

CORS_ORIGINS = os.environ.get(
    "ADSBVIZ_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")
