#!/usr/bin/env bash
# Start (or restart) both dev servers for THIS checkout.
#
# Resolves paths relative to itself, so running it from a worktree starts that worktree's
# code - which is the thing that is easy to get wrong when several checkouts exist.
#
#   bash scripts/dev.sh          start both, tail the logs
#   bash scripts/dev.sh stop     stop whatever is on the two ports
#   bash scripts/dev.sh status   show what is listening and which checkout it came from
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${ADSBVIZ_API_PORT:-8010}"   # NOT 8000 - occupied by an unrelated service here
WEB_PORT="${ADSBVIZ_WEB_PORT:-5173}"
LOG_DIR="${TMPDIR:-/tmp}/adsb-viz"
mkdir -p "$LOG_DIR"

port_pid() { ss -ltnp 2>/dev/null | awk -v p=":$1\$" '$4 ~ p {print $NF}' \
             | grep -oP 'pid=\K[0-9]+' | head -1; }

stop() {
  for p in "$API_PORT" "$WEB_PORT"; do
    pid="$(port_pid "$p")"
    if [ -n "${pid:-}" ]; then
      # kill the process group: vite spawns children that outlive a bare kill
      kill -- "-$(ps -o pgid= "$pid" | tr -d ' ')" 2>/dev/null || kill "$pid" 2>/dev/null
      echo "  stopped :$p (pid $pid)"
    else
      echo "  :$p already free"
    fi
  done
  sleep 1
}

status() {
  for p in "$API_PORT" "$WEB_PORT"; do
    pid="$(port_pid "$p")"
    if [ -n "${pid:-}" ]; then
      echo "  :$p  pid $pid  cwd $(readlink -f "/proc/$pid/cwd" 2>/dev/null || echo '?')"
    else
      echo "  :$p  (not listening)"
    fi
  done
}

case "${1:-start}" in
  stop)   echo "Stopping:";  stop; exit 0 ;;
  status) echo "Listening:"; status; exit 0 ;;
esac

echo "Restarting adsb-viz from: $ROOT"
stop

if [ ! -x "$ROOT/backend/.venv/bin/uvicorn" ]; then
  echo "ERROR: no backend venv. Run:" >&2
  echo "  cd $ROOT/backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "ERROR: no frontend deps. Run:  cd $ROOT/frontend && npm install" >&2
  exit 1
fi

( cd "$ROOT/backend" && setsid ./.venv/bin/uvicorn app.main:app \
    --host 127.0.0.1 --port "$API_PORT" >"$LOG_DIR/api.log" 2>&1 < /dev/null & )
( cd "$ROOT/frontend" && setsid npm run dev -- --port "$WEB_PORT" \
    >"$LOG_DIR/web.log" 2>&1 < /dev/null & )

for i in $(seq 1 30); do
  sleep 1
  code="$(curl -sS -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$API_PORT/api/health" 2>/dev/null)"
  [ "$code" = "200" ] && break
done

echo "Now listening:"; status
echo
echo "  app:  http://localhost:$WEB_PORT"
echo "  logs: $LOG_DIR/api.log  $LOG_DIR/web.log"
echo "  stop: bash scripts/dev.sh stop"
