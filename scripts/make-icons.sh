#!/usr/bin/env bash
#
# Rasterise frontend/icons/apple-touch-icon.src.svg to frontend/public/apple-touch-icon.png.
#
# iOS has never supported SVG for apple-touch-icon, so a PNG has to ship. Doing this in the
# Docker build would mean an SVG library in the image for a file that changes approximately
# never, and ground rule 2 says ask before adding a dependency - so the PNG is committed and
# this regenerates it on the rare occasion the mark changes.
#
# This lives in a script rather than a comment inside the SVG for a specific reason: the command
# is full of double-hyphen flags, and a double hyphen is illegal inside an XML comment. Putting
# it in the SVG is what silently broke favicon.svg the first time round.
#
#   bash scripts/make-icons.sh
#
# Everything is relative to this checkout - no absolute paths (D-019).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SRC="frontend/icons/apple-touch-icon.src.svg"
OUT="frontend/public/apple-touch-icon.png"

CHROME=""
for c in google-chrome google-chrome-stable chromium chromium-browser; do
  if command -v "$c" >/dev/null 2>&1; then CHROME="$c"; break; fi
done
if [[ -z "$CHROME" ]]; then
  echo "!! No Chrome or Chromium on PATH; cannot rasterise." >&2
  exit 1
fi

# Parse it first. A malformed SVG still "renders" under Chrome - as an error page, which would
# get written straight over the icon and committed. Catching it here is the cheap version.
python3 -c "import xml.dom.minidom,sys; xml.dom.minidom.parse('$SRC')" || {
  echo "!! $SRC is not well-formed XML. A double hyphen inside a comment is the usual cause." >&2
  exit 1
}

"$CHROME" --headless=new --disable-gpu --window-size=180,180 \
  --screenshot="$OUT" "$SRC" >/dev/null 2>&1

echo "wrote $OUT ($(wc -c < "$OUT") bytes)"
