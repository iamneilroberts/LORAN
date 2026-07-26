"""
Token access control for remote use (D-041).

The project is single-user by design. This exists for exactly one narrow case the owner asked
for: reaching the instance from another person's browser, over the internet, without making
them install anything. It is a shared-secret door, not an account system — there is no
registration, no password reset, no roles beyond "owner or not".

Design, and why:

* **Disabled unless configured.** With no `LORAN_ACCESS_TOKENS` set, every request is the
  owner and nothing changes. That keeps the default install exactly as single-user as CLAUDE.md
  says it is, so an open-source user is never silently running an auth system.
* **A link is the whole login.** `?t=<token>` on the URL is exchanged once for a signed cookie.
  The owner asked for no hoops, and a bookmarked link that keeps working is the least hoop
  available that is still a real secret.
* **HMAC-signed cookie, no dependency.** `hmac` and `hashlib` are stdlib. Rule 2 says ask
  before adding a dependency, and a signed cookie does not need one.
* **The cookie key derives from the tokens** unless overridden, so sessions survive a restart
  without another secret to manage — and revoking a token invalidates its sessions, which is
  the behaviour you want from a revocation.

What this is NOT: protection against someone the owner hands the link to, or against Cloudflare
seeing plaintext, or a substitute for TLS. It stops the open internet, not a determined guest.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time

COOKIE_NAME = "loran_session"


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


class TokenAuth:
    """Maps opaque tokens to principal names and mints/validates signed session cookies."""

    def __init__(self, spec: str, owner: str, secret: str, ttl_s: float) -> None:
        # spec is "name:token,name:token". A bare token with no name becomes the owner.
        self.principals: dict[str, str] = {}
        for part in spec.split(","):
            part = part.strip()
            if not part:
                continue
            name, sep, token = part.partition(":")
            if not sep:
                name, token = owner, name
            name, token = name.strip(), token.strip()
            if token:
                self.principals[token] = name or owner

        self.owner = owner
        self.ttl_s = ttl_s
        # Deriving from the tokens keeps cookies valid across restarts with no extra config,
        # and makes a token change revoke that token's sessions.
        material = secret or "|".join(sorted(self.principals)) or secrets.token_hex(32)
        self.key = hashlib.sha256(("loran-session:" + material).encode()).digest()

    @property
    def enabled(self) -> bool:
        """No tokens configured means no auth at all - the single-user default."""
        return bool(self.principals)

    def principal_for_token(self, token: str | None) -> str | None:
        if not token:
            return None
        # Compare against every configured token in constant time, so a wrong token cannot be
        # narrowed down by timing. Not a realistic threat over the internet; it is two lines.
        found: str | None = None
        for known, name in self.principals.items():
            if hmac.compare_digest(token, known):
                found = name
        return found

    def issue(self, principal: str) -> str:
        payload = f"{principal}|{int(time.time() + self.ttl_s)}"
        sig = hmac.new(self.key, payload.encode(), hashlib.sha256).digest()
        return f"{_b64(payload.encode())}.{_b64(sig)}"

    def verify(self, cookie: str | None) -> str | None:
        """Principal name for a valid unexpired cookie, else None."""
        if not cookie or "." not in cookie:
            return None
        body, _, sig = cookie.partition(".")
        try:
            payload = _unb64(body)
            given = _unb64(sig)
        except Exception:                                    # noqa: BLE001 - malformed is just invalid
            return None
        expect = hmac.new(self.key, payload, hashlib.sha256).digest()
        if not hmac.compare_digest(given, expect):
            return None
        principal, _, exp = payload.decode(errors="replace").partition("|")
        try:
            if time.time() > float(exp):
                return None
        except ValueError:
            return None
        # A principal that has since been removed from the config must stop working.
        if principal not in set(self.principals.values()):
            return None
        return principal


class FailureThrottle:
    """
    A per-client cap on FAILED token submissions (D-057).

    `/api/session` is the one door on the API that must stay reachable without a session - it is
    how you GET a session - and D-057 put a visible paste box in front of it, which makes it a
    more obvious thing to poke at. This is not what stops a brute force: the tokens are 256 bits
    and arithmetic already stops that. It exists so that an endpoint which cannot be closed does
    not serve unlimited attempts, and so a script hammering it shows up as 429s instead of work.

    In-process and in-memory on purpose. This is a single-user console served by one uvicorn
    process, so a dict IS the correct implementation here, and a shared store would be a
    dependency (rule 2) bought for nothing. Two limitations, named out loud because they are
    choices and not oversights: the counters RESET ON RESTART, and if this were ever run with
    more than one worker each worker would keep its own counters, so the effective limit would
    multiply by the worker count.

    Only FAILURES are recorded. A legitimate user re-authenticating - a new browser, a cleared
    cookie, a second hostname - must never be locked out for succeeding repeatedly.
    """

    # Above this many tracked clients, sweep the whole table. Only failures create an entry and
    # every entry expires within the window, but nothing sweeps a client that simply stops
    # coming back, so a source rotating addresses could otherwise grow this dict without bound.
    _SWEEP_AT = 1024

    def __init__(self, limit: int, window_s: float) -> None:
        self.limit = limit
        self.window_s = window_s
        self._fails: dict[str, list[float]] = {}

    def _recent(self, client: str, now: float) -> list[float]:
        """Failures for `client` still inside the window, pruning the expired ones as we go."""
        kept = [t for t in self._fails.get(client, ()) if t > now - self.window_s]
        if kept:
            self._fails[client] = kept
        else:
            self._fails.pop(client, None)
        return kept

    def allowed(self, client: str, now: float | None = None) -> bool:
        now = time.time() if now is None else now
        return len(self._recent(client, now)) < self.limit

    def record_failure(self, client: str, now: float | None = None) -> None:
        now = time.time() if now is None else now
        kept = self._recent(client, now)
        kept.append(now)
        self._fails[client] = kept
        if len(self._fails) > self._SWEEP_AT:
            for key in list(self._fails):
                self._recent(key, now)
