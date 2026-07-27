"""
/api/health, and specifically the build stamp it carries.

The stamp exists to answer "is the deployed thing the code I think it is?" in one command. That
question has been answered WRONGLY twice in this project: once by trusting a tunnel that was
serving a stale image, and once by grepping a minified bundle for an identifier that
minification had renamed away. So the properties worth pinning are not "health returns 200":

  - an UNSTAMPED build reports null, not "" and not a missing key - a consumer must be able to
    tell "this build does not know its commit" from "this build is at commit ''";
  - a STAMPED build reports exactly what was baked in;
  - and both are readable WITHOUT a token, because a provenance check that needs a credential
    is useless from outside and useless to CI.

That last one is the whole reason /api/health is in main.OPEN_PATHS. A test that only exercised
the unauthenticated default would still pass if someone put health behind the door, which is the
failure this guards.

Same conventions as test_session.py: TestClient without a `with` block, so the lifespan never
starts the upstream feed clients. No network.
"""
import pytest
from fastapi.testclient import TestClient

from app import main
from app.auth import TokenAuth

STAMP = "0123456789abcdef0123456789abcdef01234567"
TOKEN = "test-token-not-a-real-one"


@pytest.fixture
def client():
    return TestClient(main.app)


def test_unstamped_build_reports_null(client, monkeypatch):
    """A bare `docker build`, or the bare-metal path, stamps nothing - and says so honestly."""
    monkeypatch.setattr(main, "BUILD_SHA", "")
    body = client.get("/api/health").json()
    assert "build_sha" in body, "the key must always be present, even unstamped"
    assert body["build_sha"] is None


def test_stamped_build_reports_the_commit(client, monkeypatch):
    monkeypatch.setattr(main, "BUILD_SHA", STAMP)
    body = client.get("/api/health").json()
    assert body["build_sha"] == STAMP


def test_stamp_is_readable_without_a_token(monkeypatch):
    """
    With the door ON, /api/health still answers - no cookie, no ?t=, no header.

    This is what makes `curl -s https://<host>/api/health` a one-command answer to "what is
    live?" from anywhere, and what lets the CI smoke check read the SHA out of a container it
    just booted.
    """
    monkeypatch.setattr(main, "auth", TokenAuth(f"owner:{TOKEN}", "owner", "test-secret", 3600.0))
    monkeypatch.setattr(main, "BUILD_SHA", STAMP)
    client = TestClient(main.app)

    resp = client.get("/api/health")

    assert resp.status_code == 200
    assert resp.json()["build_sha"] == STAMP
    # Guard the premise: if auth were not actually on, the assertion above proves nothing.
    assert main.auth.enabled
    assert client.get("/api/aircraft").status_code == 401
