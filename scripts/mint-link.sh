#!/usr/bin/env bash
#
# Print a ready-to-open login link for every principal in LORAN_ACCESS_TOKENS (D-041, D-057).
#
# There is no token store to query: the tokens ARE the config, so this just reads the same
# "name:token,name:token" string the app reads and formats it into the URL the link path
# expects. It mints nothing and changes nothing - generate a NEW token with:
#
#   python3 -c "import secrets;print(secrets.token_urlsafe(32))"
#
# and add it to .env yourself. That deliberate manual step is what keeps this script from being
# a thing that quietly creates credentials.
#
#   bash scripts/mint-link.sh                          # links against http://127.0.0.1:8010
#   bash scripts/mint-link.sh https://loran.example    # links against a tunnel hostname
#
# STDOUT ONLY. It never writes a file, because a file holding these is a credential on disk that
# nobody remembers to delete - and the repo is a git repo, which is worse. Pipe it nowhere you
# would not paste a password.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${1:-${LORAN_BASE_URL:-http://127.0.0.1:8010}}"
BASE="${BASE%/}"

# The environment wins over .env, matching backend/app/config.py's own precedence, so a shell
# that already has tokens exported gets links for those rather than for a stale file.
SPEC="${LORAN_ACCESS_TOKENS:-}"
if [[ -z "$SPEC" && -f "$ROOT/.env" ]]; then
  SPEC="$(sed -n 's/^[[:space:]]*LORAN_ACCESS_TOKENS[[:space:]]*=[[:space:]]*//p' "$ROOT/.env" \
          | tail -1 | sed -e 's/^"//' -e "s/^'//" -e 's/"$//' -e "s/'$//")"
fi

if [[ -z "$SPEC" ]]; then
  echo "!! LORAN_ACCESS_TOKENS is not set in the environment or $ROOT/.env." >&2
  echo "   That means access control is OFF and no link is needed - anyone who can reach" >&2
  echo "   the port is the owner. See docs/remote-access.md." >&2
  exit 1
fi

OWNER="${LORAN_OWNER_PRINCIPAL:-owner}"

echo "!! Each URL below CONTAINS A LIVE CREDENTIAL. Anyone holding it is logged in."
echo

# Same parse as TokenAuth.__init__: comma-separated "name:token", and a bare token with no
# name belongs to the owner.
IFS=',' read -ra PARTS <<< "$SPEC"
for part in "${PARTS[@]}"; do
  part="$(printf '%s' "$part" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [[ -z "$part" ]] && continue
  if [[ "$part" == *:* ]]; then
    name="${part%%:*}"
    token="${part#*:}"
  else
    name="$OWNER"
    token="$part"
  fi
  name="$(printf '%s' "$name" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  token="$(printf '%s' "$token" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [[ -z "$token" ]] && continue
  printf '%-16s %s/?t=%s\n' "${name:-$OWNER}" "$BASE" "$token"
done

echo
echo "The token can also be pasted straight into the locked panel, which keeps it out of the"
echo "URL and out of every access log between here and the browser (D-057)."
