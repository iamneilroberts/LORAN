#!/usr/bin/env bash
#
# Production / remote serving path: build the frontend, then serve BOTH the app and the API
# from one process on one port (D-041).
#
# This is the path a tunnel or reverse proxy points at. One origin means no CORS, no second
# port to expose, and a same-site session cookie by construction.
#
#   bash scripts/serve.sh            # build if needed, then serve
#   bash scripts/serve.sh --rebuild  # force a frontend rebuild first
#
# Everything is relative to this checkout - no absolute paths (D-019).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${LORAN_PORT:-8010}"
DIST="$ROOT/frontend/dist"

if [[ "${1:-}" == "--rebuild" || ! -f "$DIST/index.html" ]]; then
  echo "==> building frontend"
  ( cd frontend && npm run build )
fi

if [[ ! -f "$DIST/index.html" ]]; then
  echo "!! no build at $DIST - run: cd frontend && npm run build" >&2
  exit 1
fi

VENV="$ROOT/backend/.venv"
if [[ -f "$VENV/bin/activate" ]]; then
  # shellcheck disable=SC1091
  source "$VENV/bin/activate"
fi

# Serving static from the API process is what makes it one origin.
export LORAN_STATIC_DIR="$DIST"

# Tokens can come from the shell OR from .env, which the app parses itself - so checking only
# the shell environment reported "no access control" on a correctly protected instance, which
# is a worse failure than saying nothing. Check both.
if [[ -z "${LORAN_ACCESS_TOKENS:-}" ]] && ! grep -qE '^\s*LORAN_ACCESS_TOKENS=.+' "$ROOT/.env" 2>/dev/null; then
  cat >&2 <<'WARN'
!! LORAN_ACCESS_TOKENS is not set in the environment or .env, so there is NO
   access control. That is correct for a LAN-only or localhost instance. Do NOT
   expose this to the internet without tokens - see docs/remote-access.md.
WARN
else
  echo "==> access control: ON (tokens configured)"
fi

echo "==> serving app + api on http://127.0.0.1:$PORT"
exec python3 -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port "$PORT"
