#!/usr/bin/env bash
# Run every unit test in the project - frontend and backend.
#
# These cover the parts that can be checked without a network, a GPU or a viewer. They are NOT
# a substitute for scripts/verify_phase1.py, which exercises the real app against live traffic.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== frontend (vitest) =="
cd "$ROOT/frontend" && npm run --silent test

echo
echo "== backend (pytest) =="
cd "$ROOT/backend" && python3 -m pytest
