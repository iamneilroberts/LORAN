#!/usr/bin/env bash
#
# Deploy the Compose path with the commit stamped in, then PROVE the running container is the
# code you just deployed (D-077).
#
# `docker compose up --build -d` on its own is still correct and still works - it just passes no
# BUILD_SHA, so /api/health reports null and the deployment cannot say which commit it is. That
# gap is what made a stale image survive a six-feature review once, and produced a false "never
# deployed" finding another time. This script closes it.
#
#   bash scripts/deploy.sh
#
# Everything is relative to this checkout - no absolute paths (D-019).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE="${LORAN_BASE_URL:-http://127.0.0.1:8010}"

SHA="$(git rev-parse HEAD)"
# A dirty tree means the running image is NOT that commit. Say so in the stamp rather than
# reporting a SHA that does not describe what is deployed - a confident wrong answer here is
# worse than an obviously qualified one.
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  SHA="${SHA}-dirty"
  echo "!! Working tree has uncommitted changes. Stamping as ${SHA}."
  echo "   The deployed image will NOT match any commit on the remote."
fi

echo "== building and starting, BUILD_SHA=${SHA}"
BUILD_SHA="$SHA" docker compose up --build -d

echo "== waiting for ${BASE}/api/health"
for _ in $(seq 1 60); do
  if REPORTED="$(curl -fsS "$BASE/api/health" 2>/dev/null \
                 | python3 -c 'import json,sys; print(json.load(sys.stdin).get("build_sha") or "")')"
  then
    break
  fi
  sleep 1
done

if [[ -z "${REPORTED:-}" ]]; then
  echo "!! The container is up but reports no build_sha. Either it never became healthy, or it" >&2
  echo "   is an older image without the stamp. Check: docker compose logs --tail 50" >&2
  exit 1
fi

if [[ "$REPORTED" != "$SHA" ]]; then
  echo "!! MISMATCH. Deployed ${SHA} but the container reports ${REPORTED}." >&2
  echo "   Compose probably reused an existing image. Try: docker compose build --no-cache" >&2
  exit 1
fi

echo "== deployed and verified: ${REPORTED}"
echo "   Confirm from outside any time with:"
echo "     curl -s ${BASE}/api/health | jq .build_sha"
