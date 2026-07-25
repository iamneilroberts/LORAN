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

CORS_ORIGINS = os.environ.get(
    "ADSBVIZ_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")
