"""
The access door: /api/session, the session cookie's flags, and the failure throttle (D-041,
D-057).

This is the only security-relevant code in the project, and until D-057 it had no tests at all.
What matters here is not that a happy path returns 200 - it is that the two ways in mint the
SAME cookie, that the flags on it are the ones that actually protect it, and that a failure
tells a caller nothing.

No network, and deliberately no dependence on the owner's real .env: every test builds its own
TokenAuth from tokens invented right here and swaps it into the app module. `TestClient(app)` is
used WITHOUT a `with` block on purpose, so the lifespan - which starts the upstream feed
clients - never runs.
"""
import pytest
from fastapi.testclient import TestClient

from app import main
from app.auth import COOKIE_NAME, FailureThrottle, TokenAuth
from app.config import SESSION_TTL_S

OWNER_TOKEN = "test-owner-token-not-a-real-one"
GUEST_TOKEN = "test-guest-token-not-a-real-one"
WRONG_TOKEN = "wrong-token-never-configured"


@pytest.fixture
def client(monkeypatch):
    """
    The app with a KNOWN set of tokens and an empty throttle.

    Both are monkeypatched onto the module rather than set through the environment because both
    are read once at import time. Patching the objects is what makes each test start from a
    clean throttle - otherwise failures would leak from one test into the next and the 429 test
    would pass or fail depending on ordering.
    """
    monkeypatch.setattr(
        main, "auth",
        TokenAuth(f"owner:{OWNER_TOKEN},guest:{GUEST_TOKEN}", "owner", "test-secret", 3600.0),
    )
    monkeypatch.setattr(main, "session_throttle", FailureThrottle(3, 60.0))
    return TestClient(main.app)


def set_cookie_header(response):
    """The raw Set-Cookie line, which is the only place the flags are actually visible."""
    return response.headers.get("set-cookie", "")


class TestPostSession:
    def test_valid_token_sets_an_httponly_session_cookie(self, client):
        r = client.post("/api/session", json={"t": OWNER_TOKEN})
        assert r.status_code == 200
        assert r.json() == {"auth": True, "principal": "owner", "owner": True}

        raw = set_cookie_header(r).lower()
        assert raw.startswith(COOKIE_NAME + "=")
        # HttpOnly is the flag that stops a cross-site script from reading the session out of
        # document.cookie, and SameSite=Lax is what stops another site from spending it.
        assert "httponly" in raw
        assert "samesite=lax" in raw
        assert f"max-age={int(SESSION_TTL_S)}" in raw
        # It must be a cookie the app will actually accept back, not just any string.
        assert main.auth.verify(client.cookies.get(COOKIE_NAME)) == "owner"

    def test_post_and_get_mint_identical_cookie_flags(self, client):
        """
        The whole point of the shared `_issue_session` helper: the link path and the paste path
        cannot drift apart. Compare everything except the cookie VALUE, which is a fresh HMAC
        each time and legitimately differs.
        """
        def flags(header):
            parts = [p.strip().lower() for p in header.split(";")]
            return sorted(p for p in parts[1:] if p)

        posted = client.post("/api/session", json={"t": OWNER_TOKEN})
        client.cookies.clear()
        got = client.get("/api/session", params={"t": OWNER_TOKEN})
        assert flags(set_cookie_header(posted)) == flags(set_cookie_header(got))

    def test_invalid_token_sets_no_cookie_and_does_not_echo_it(self, client):
        r = client.post("/api/session", json={"t": WRONG_TOKEN})
        assert r.status_code != 200
        assert r.status_code == 401
        assert "set-cookie" not in r.headers
        assert r.json()["principal"] is None
        # A rejection that repeats the submitted value back would put a credential-shaped string
        # into the DOM and into anything logging responses.
        assert WRONG_TOKEN not in r.text

    def test_rejection_is_the_same_answer_whatever_was_wrong(self, client):
        """No response distinguishes "never existed" from "empty" from "wrong shape"."""
        answers = {
            client.post("/api/session", json={"t": WRONG_TOKEN}).text,
            client.post("/api/session", json={"t": ""}).text,
            client.post("/api/session", json={"t": OWNER_TOKEN[:-1]}).text,
        }
        assert len(answers) == 1

    def test_an_overlong_token_is_refused_without_being_echoed_back(self, client):
        """
        The reason the body is hand-parsed instead of declared as a pydantic model: FastAPI's
        422 for a failed field constraint carries the offending `input` in the response body,
        which would hand the pasted token straight back to the browser.
        """
        overlong = "OVERLONG" + "A" * 300
        r = client.post("/api/session", json={"t": overlong})
        assert r.status_code == 401
        assert "OVERLONG" not in r.text
        assert "set-cookie" not in r.headers

    def test_a_malformed_body_is_just_another_rejection(self, client):
        """Not a 422, not a 500 - the same 401 as a wrong token, and nothing extra said."""
        for bad in (b"not json at all", b"[1, 2, 3]", b'{"nope": "x"}', b'{"t": 12345}'):
            r = client.post("/api/session", content=bad,
                            headers={"Content-Type": "application/json"})
            assert r.status_code == 401, bad
            assert "set-cookie" not in r.headers

    def test_surrounding_whitespace_is_trimmed(self, client):
        """A pasted token routinely arrives with the newline the copy took with it."""
        r = client.post("/api/session", json={"t": f"  {GUEST_TOKEN}\n"})
        assert r.status_code == 200
        assert r.json()["principal"] == "guest"
        assert r.json()["owner"] is False

    def test_post_is_reachable_without_a_session(self, client):
        """
        OPEN_PATHS exempts by path, so it covers the POST as well as the GET. If the middleware
        ever started matching on method, this endpoint would 401 before it could ever be right.
        """
        assert "/api/session" in main.OPEN_PATHS
        # A guarded path answers 401 with no cookie, so this proves the exemption is what let
        # the POST through rather than an accident of ordering.
        assert client.get("/api/aircraft", params={"lat": 30.0, "lon": -88.0}).status_code == 401
        assert client.post("/api/session", json={"t": OWNER_TOKEN}).status_code == 200


class TestGetSessionRegression:
    """
    The `?t=` link path is how shared links log in (D-041). D-057 added a sibling; it must not
    have moved this.
    """

    def test_link_token_still_sets_a_working_cookie(self, client):
        r = client.get("/api/session", params={"t": GUEST_TOKEN})
        assert r.status_code == 200
        assert r.json() == {"auth": True, "principal": "guest", "owner": False}
        assert "httponly" in set_cookie_header(r).lower()
        assert main.auth.verify(client.cookies.get(COOKIE_NAME)) == "guest"

    def test_the_cookie_it_mints_opens_a_guarded_endpoint(self, client):
        # A cookie the middleware will not accept is worth nothing, so check the door, not just
        # the Set-Cookie line.
        assert client.get("/api/config").status_code == 401
        client.get("/api/session", params={"t": GUEST_TOKEN})
        r = client.get("/api/config")
        assert r.status_code == 200
        assert r.json()["principal"] == "guest"

    def test_no_token_reports_the_current_session_without_minting_one(self, client):
        r = client.get("/api/session")
        assert r.status_code == 401
        assert "set-cookie" not in r.headers

    def test_bad_link_token_is_rejected_with_no_cookie(self, client):
        r = client.get("/api/session", params={"t": WRONG_TOKEN})
        assert r.status_code == 401
        assert "set-cookie" not in r.headers


class TestSecureFlag:
    """
    `secure` is derived from x-forwarded-proto, which is the one thing here that cannot be
    exercised locally - there is no real HTTPS in front of a dev box. So it is pinned here
    instead, in both directions.
    """

    def test_secure_is_set_behind_an_https_proxy(self, client):
        r = client.post("/api/session", json={"t": OWNER_TOKEN},
                        headers={"x-forwarded-proto": "https"})
        assert "secure" in set_cookie_header(r).lower()

    def test_secure_is_absent_on_plain_http(self, client):
        # Without this the cookie would never be sent over the plain-http local dev path, and
        # the console would be permanently locked out at home.
        r = client.post("/api/session", json={"t": OWNER_TOKEN})
        assert "secure" not in set_cookie_header(r).lower()

    def test_the_link_path_derives_secure_the_same_way(self, client):
        r = client.get("/api/session", params={"t": OWNER_TOKEN},
                       headers={"x-forwarded-proto": "https"})
        assert "secure" in set_cookie_header(r).lower()


class TestThrottle:
    """The fixture configures a limit of 3 failures per 60 s."""

    def test_returns_429_after_the_configured_number_of_failures(self, client):
        for _ in range(3):
            assert client.post("/api/session", json={"t": WRONG_TOKEN}).status_code == 401
        r = client.post("/api/session", json={"t": WRONG_TOKEN})
        assert r.status_code == 429
        assert "set-cookie" not in r.headers

    def test_a_throttled_client_cannot_get_in_with_a_good_token_either(self, client):
        """
        The check runs before the token is looked at, on purpose: a limit that a correct guess
        walks straight past is not a limit.
        """
        for _ in range(3):
            client.post("/api/session", json={"t": WRONG_TOKEN})
        assert client.post("/api/session", json={"t": OWNER_TOKEN}).status_code == 429

    def test_success_is_never_throttled(self, client):
        """
        Re-authenticating repeatedly is what a person with a new browser, a cleared cookie or a
        second hostname does. Locking them out for succeeding would be the bug this endpoint's
        whole existence is meant to avoid.
        """
        for _ in range(10):
            assert client.post("/api/session", json={"t": OWNER_TOKEN}).status_code == 200

    def test_the_link_path_is_throttled_too(self, client):
        """Same endpoint, same brute-force surface - a limit only the POST honours is no limit."""
        for _ in range(3):
            client.get("/api/session", params={"t": WRONG_TOKEN})
        assert client.get("/api/session", params={"t": WRONG_TOKEN}).status_code == 429

    def test_asking_whether_i_am_logged_in_is_not_an_attempt(self, client):
        """No token was offered, so there was nothing to be wrong about."""
        for _ in range(10):
            client.get("/api/session")
        assert client.post("/api/session", json={"t": OWNER_TOKEN}).status_code == 200

    def test_failures_are_counted_per_client(self, client):
        """
        Behind the tunnel every visitor shares a peer address, so X-Forwarded-For is what keeps
        one bad actor from locking out the household. If that ever stopped being read, all
        callers would land in a single bucket and this would fail.
        """
        for _ in range(3):
            client.post("/api/session", json={"t": WRONG_TOKEN},
                        headers={"x-forwarded-for": "203.0.113.9"})
        assert client.post("/api/session", json={"t": WRONG_TOKEN},
                           headers={"x-forwarded-for": "203.0.113.9"}).status_code == 429
        assert client.post("/api/session", json={"t": WRONG_TOKEN},
                           headers={"x-forwarded-for": "198.51.100.4"}).status_code == 401


class TestFailureThrottleUnit:
    """The window logic on its own, where time can be handed in instead of waited out."""

    def test_failures_expire_out_of_the_window(self):
        th = FailureThrottle(2, 60.0)
        th.record_failure("a", now=1000.0)
        th.record_failure("a", now=1001.0)
        assert th.allowed("a", now=1002.0) is False
        # 61 s later both are outside the window and the client is clean again.
        assert th.allowed("a", now=1062.0) is True

    def test_an_unknown_client_is_allowed(self):
        assert FailureThrottle(1, 60.0).allowed("never-seen") is True


class TestAuthDisabled:
    """
    The default install has no tokens at all, and must stay exactly as unauthenticated as
    CLAUDE.md says it is - the new endpoint must not have quietly introduced a door.
    """

    def test_post_reports_no_auth_and_mints_nothing(self, monkeypatch):
        monkeypatch.setattr(main, "auth", TokenAuth("", "owner", "", 3600.0))
        c = TestClient(main.app)
        r = c.post("/api/session", json={"t": "anything at all"})
        assert r.status_code == 200
        assert r.json() == {"auth": False, "principal": "owner", "owner": True}
        assert "set-cookie" not in r.headers
