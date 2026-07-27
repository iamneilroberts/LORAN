#!/usr/bin/env python3
"""
Boot check: does the thing we just built actually work when a browser loads it?

Every static check in this project can pass while the shipped artefact is broken. It has
happened repeatedly - `tsc` clean, 87 tests green and a successful production build, and the
page still crashed on every load (D-064); a tunnel serving a stale image while six features
were reviewed against it; a "never deployed" conclusion drawn from grepping a MINIFIED bundle
for an identifier minification had renamed away. Each of those was found by a person noticing.
This script is the mechanical version.

It asserts five things, in order of how badly each has bitten:

  1. The container reports the commit it was built from  (--expect-sha).
  2. The bundle the server SERVES is byte-identical to the one inside the image
     (--container). Not a name comparison, a sha256 of the actual bytes - that is what a
     stale-image incident actually looks like.
  3. Every declared icon is served, and any SVG among them PARSES. A malformed SVG
     returns 200 with the right content type and logs nothing - it just fails to draw.
  4. The page mounts. React put children under #root.
  5. The console is clean. No uncaught exceptions, no console.error, no error-level log
     entries.

It must pass with ZERO aircraft. GitHub runners hitting airplanes.live would be both
non-deterministic and discourteous - the feed is 1 req/s and non-commercial, and it has already
429'd this project. The app renders an honest offline state when the feed is dead (ground rule
1), so an empty sky is a PASS. Nothing here asserts on live traffic.

Dependencies: `websockets`, already present via uvicorn[standard], and already used by the
other CDP scripts here. Nothing new (ground rule 2).

    python3 scripts/smoke.py --base http://127.0.0.1:8011 \
        --container loran-smoketest --expect-sha "$(git rev-parse HEAD)"

POINTING THIS AT A LIVE, TOKEN-PROTECTED DEPLOYMENT

Checks 1-4 work and are worth running - they are the fastest honest answer to "is the tunnel
serving what I think it is?". Check 5 will FAIL, and correctly so: with LORAN_ACCESS_TOKENS
configured, a browser holding no token gets 401 from /api/config and /api/aircraft, and those
are error-level console entries. That is the access door working.

Those 401s are deliberately NOT allowlisted. In CI the door is off, so a 401 there would be a
real defect, and excusing it here would blind the check to it. Read a production run as
"1-4 passed, 5 reported the door" rather than trying to make it green.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import xml.dom.minidom

import websockets

# Vite emits assets/index-<hash>.(js|css). If a Vite config change ever renames this, the regex
# stops matching - and a comparison over zero assets would PASS while checking nothing. That is
# why "did we find any?" is asserted separately below rather than assumed.
ASSET_RE = re.compile(r'(?:src|href)="(/assets/[A-Za-z0-9_.-]+\.(?:js|css))"')

CHROME_CANDIDATES = (
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome",
)

# Console errors that are NOT evidence of a broken build. EMPTY, and worth keeping that way.
#
# An allowlist is how a smoke check quietly stops checking anything, so this one is built to
# resist that: every entry must carry a REASON and a condition for deleting it, and every
# suppression is PRINTED on a pass. If this list is growing, that is the signal - not the fix.
#
# The only entry it has ever held was a /favicon.ico 404, which came out the moment
# frontend/public/favicon.svg shipped. A 404 there is now a real regression - a dropped
# <link rel="icon">, or the asset missing from the image - and must fail.
ALLOWED_ERRORS = ()


def triage(errors: list[str]) -> tuple[list[str], list[tuple[str, str]]]:
    """Split console errors into ones that fail the build and ones with a written excuse."""
    real: list[str] = []
    excused: list[tuple[str, str]] = []
    for err in errors:
        for pattern, reason in ALLOWED_ERRORS:
            if pattern.search(err):
                excused.append((err, reason))
                break
        else:
            real.append(err)
    return real, excused


# urllib's default "Python-urllib/3.x" gets a blanket 403 from Cloudflare, so pointing this
# script at the live tunnel would fail with a message that looks like the app is down when it is
# not. Identifying properly costs one header and makes the script usable against production -
# which matters, because "check the artefact you actually shipped" is the whole point.
UA = "loran-smoke/1.0 (+https://github.com/iamneilroberts/LORAN)"


def _get(url: str, timeout: float):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}),
                                  timeout=timeout)


class SmokeFailure(Exception):
    """A check failed. The message is the report."""


def log(msg: str) -> None:
    print(msg, flush=True)


# ---------------------------------------------------------------------------
# 1 + 2: the HTTP-only checks. No browser needed, so they fail fast and cheap.
# ---------------------------------------------------------------------------

def wait_for_health(base: str, timeout_s: float) -> dict:
    """
    Poll until /api/health answers. docker-compose.yml declares no healthcheck, and a fixed
    sleep is the thing that turns into a flaky job six months from now.
    """
    deadline = time.time() + timeout_s
    last = "never answered"
    while time.time() < deadline:
        try:
            with _get(f"{base}/api/health", timeout=4) as r:
                if r.status == 200:
                    body = json.load(r)
                    log(f"  health ok after {timeout_s - (deadline - time.time()):.1f}s")
                    return body
                last = f"HTTP {r.status}"
        except (urllib.error.URLError, OSError, json.JSONDecodeError) as e:
            last = str(e)
        time.sleep(0.5)
    raise SmokeFailure(f"/api/health never became ready within {timeout_s:.0f}s ({last})")


def check_build_sha(health: dict, expected: str | None) -> None:
    got = health.get("build_sha")
    if expected is None:
        log(f"  build_sha reported: {got!r} (nothing to compare against)")
        return
    if got != expected:
        raise SmokeFailure(
            f"the container reports build_sha {got!r}, but we built {expected!r}. "
            "Either the wrong image is running or the stamp did not make it in."
        )
    log(f"  build_sha matches the commit we built: {got}")


def fetch(url: str) -> bytes:
    with _get(url, timeout=15) as r:
        if r.status != 200:
            raise SmokeFailure(f"GET {url} returned HTTP {r.status}")
        return r.read()


def check_served_matches_built(base: str, container: str | None) -> None:
    """
    Compare the bytes the server hands out to the bytes inside the image.

    A filename comparison would be weaker: Vite's content hash is in the name, so two different
    builds usually differ there anyway - but "usually" is not a check. Hashing the transferred
    body is what catches a proxy, a stale layer, or a volume mount shadowing static/.
    """
    html = fetch(f"{base}/").decode("utf-8", "replace")
    assets = ASSET_RE.findall(html)

    # THE guard. Without it, a Vite rename makes `assets` empty and every loop below is a no-op
    # that passes silently - a check that cannot fail is worse than no check.
    if not assets:
        raise SmokeFailure(
            "found no /assets/*.js or *.css references in the served index.html. "
            "The bundle naming probably changed, which means this comparison has been "
            "silently checking nothing. Fix ASSET_RE - do not delete this assertion."
        )
    log(f"  {len(assets)} asset(s) referenced by index.html: {', '.join(assets)}")

    if container is None:
        log("  (no --container given; skipping the served-vs-built byte comparison)")
        return

    for path in assets:
        served = hashlib.sha256(fetch(f"{base}{path}")).hexdigest()
        in_image = subprocess.run(
            ["docker", "exec", container, "sha256sum", f"/app/static{path}"],
            capture_output=True, text=True,
        )
        if in_image.returncode != 0:
            raise SmokeFailure(
                f"{path} is served over HTTP but absent from the image at /app/static{path}: "
                f"{in_image.stderr.strip()}"
            )
        built = in_image.stdout.split()[0]
        if served != built:
            raise SmokeFailure(
                f"SERVED != BUILT for {path}.\n"
                f"  served over HTTP : {served}\n"
                f"  inside the image : {built}\n"
                "This is the stale-artefact incident, caught."
            )
        log(f"  {path} served == built ({served[:16]}…)")


ICON_RE = re.compile(r'<link\s+[^>]*rel="(icon|apple-touch-icon)"[^>]*>', re.I)
HREF_RE = re.compile(r'href="([^"]+)"', re.I)


def check_icons(base: str) -> None:
    """
    Fetch every declared icon and, for SVG, PARSE it.

    Written because the first favicon shipped broken and every check passed. It returned HTTP
    200 with content-type image/svg+xml and logged no console error - but a double hyphen inside
    an XML comment made it unparseable, so browsers rendered nothing. An SVG served as
    image/svg+xml is strict XML; "200 and the right content type" says nothing about whether it
    draws. Only parsing does.
    """
    html = fetch(f"{base}/").decode("utf-8", "replace")
    links = ICON_RE.findall(html)
    tags = [m.group(0) for m in ICON_RE.finditer(html)]

    if not links:
        raise SmokeFailure(
            "index.html declares no <link rel=\"icon\">. Without one, browsers request "
            "/favicon.ico unprompted and 404 on every page load."
        )

    for tag in tags:
        href = HREF_RE.search(tag)
        if not href:
            raise SmokeFailure(f"icon link has no href: {tag}")
        path = href.group(1)
        body = fetch(f"{base}{path}" if path.startswith("/") else f"{base}/{path}")
        if not body:
            raise SmokeFailure(f"{path} served an empty body")
        if path.lower().endswith(".svg"):
            try:
                xml.dom.minidom.parseString(body)
            except Exception as e:                           # noqa: BLE001 - any parse error is fatal
                raise SmokeFailure(
                    f"{path} is served but is NOT well-formed XML: {e}. Browsers will render "
                    "nothing. A double hyphen inside an XML comment is the usual cause."
                ) from e
            log(f"  {path} ({len(body)} B) parses as XML")
        else:
            log(f"  {path} ({len(body)} B) served")


# ---------------------------------------------------------------------------
# 4 + 5: load it in a real browser.
# ---------------------------------------------------------------------------

def find_chrome(explicit: str | None) -> str:
    if explicit:
        if not shutil.which(explicit):
            raise SmokeFailure(f"--chrome {explicit!r} is not on PATH")
        return explicit
    for name in CHROME_CANDIDATES:
        found = shutil.which(name)
        if found:
            return found
    raise SmokeFailure(f"no Chrome found; tried {', '.join(CHROME_CANDIDATES)}")


async def _cdp_session(ws, url: str, settle_s: float) -> tuple[list[str], object]:
    """Navigate, record everything the console says, then ask the DOM if React mounted."""
    counter = [0]
    errors: list[str] = []

    async def cmd(method: str, params: dict | None = None):
        counter[0] += 1
        mine = counter[0]
        await ws.send(json.dumps({"id": mine, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("id") == mine:
                if "error" in msg:
                    raise SmokeFailure(f"CDP {method} failed: {msg['error']}")
                return msg.get("result", {})
            _record(msg, errors)

    await cmd("Page.enable")
    await cmd("Runtime.enable")
    await cmd("Log.enable")
    await cmd("Page.navigate", {"url": url})

    # Cesium mounts a WebGL globe and pulls terrain; errors can surface well after onload, so
    # give it a real settle window rather than racing it.
    deadline = time.time() + settle_s
    while time.time() < deadline:
        try:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=deadline - time.time()))
            _record(msg, errors)
        except asyncio.TimeoutError:
            break

    mounted = await cmd("Runtime.evaluate", {
        "expression": "document.querySelector('#root')?.childElementCount ?? 0",
        "returnByValue": True,
    })
    return errors, mounted.get("result", {}).get("value")


def _record(msg: dict, errors: list[str]) -> None:
    """Collect the three distinct ways the page can tell us something went wrong."""
    method = msg.get("method")
    params = msg.get("params", {})

    if method == "Runtime.exceptionThrown":
        d = params.get("exceptionDetails", {})
        text = d.get("exception", {}).get("description") or d.get("text") or "unknown exception"
        errors.append(f"uncaught exception: {text}")

    elif method == "Runtime.consoleAPICalled" and params.get("type") == "error":
        parts = [a.get("value", a.get("description", "?")) for a in params.get("args", [])]
        errors.append("console.error: " + " ".join(str(p) for p in parts))

    elif method == "Log.entryAdded" and params.get("entry", {}).get("level") == "error":
        entry = params["entry"]
        # The URL is the whole diagnostic for a network error - "Failed to load resource: 404"
        # without it sends the reader hunting through the bundle for which resource.
        where = f" <{entry['url']}>" if entry.get("url") else ""
        errors.append(f"log[{entry.get('source', '?')}]: {entry.get('text', '?')}{where}")


async def check_page_in_browser(base: str, chrome: str, settle_s: float) -> None:
    # ignore_cleanup_errors because Chrome's helper processes keep writing to the profile for a
    # moment after the parent exits, and rmtree then dies with "Directory not empty". The
    # profile is disposable; failing the smoke check over tempdir cleanup would be a pure flake.
    with tempfile.TemporaryDirectory(prefix="loran-smoke-", ignore_cleanup_errors=True) as profile:
        proc = subprocess.Popen(
            [chrome, "--headless=new", "--remote-debugging-port=0",
             f"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check",
             # SOFTWARE WEBGL, and not optional. This app is a Cesium globe; on a machine with
             # no GPU, Cesium throws "The browser supports WebGL, but initialization failed",
             # the error boundary catches it, and the run fails for a reason that has nothing
             # to do with the commit under test. SwiftShader gives a real WebGL context in
             # software, so the check exercises the actual page. Do NOT add --disable-gpu here:
             # it defeats these and reintroduces that false failure.
             "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
             # Runners have a small /dev/shm and run as root; without these Chrome dies on
             # start and the failure looks like a page problem rather than an environment one.
             "--disable-dev-shm-usage", "--no-sandbox",
             "--window-size=1600,900", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
        )
        try:
            ws_url = _new_page_ws(_await_devtools(proc))
            async with websockets.connect(ws_url, max_size=100 * 1024 * 1024) as ws:
                errors, mounted = await _cdp_session(ws, f"{base}/", settle_s)
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()

    # Order matters: an unmounted page is usually quiet, so reporting "console clean" first
    # would be actively misleading.
    if not mounted:
        raise SmokeFailure(
            f"#root has {mounted!r} child elements - React never mounted. "
            "This is D-064's incident: every static check green, page dead on arrival."
        )
    log(f"  page mounted: #root has {mounted} child element(s)")

    real, excused = triage(errors)

    # Printed even on a pass, so a growing allowlist is visible in every log rather than
    # discovered later by someone wondering why the check never catches anything.
    for err, reason in excused:
        log(f"  ALLOWED: {err}\n           reason: {reason}")

    if real:
        listed = "\n".join(f"    - {e}" for e in real)
        raise SmokeFailure(f"{len(real)} console error(s) on load:\n{listed}")
    log("  console clean: no exceptions, no console.error, no error-level log entries")


def _await_devtools(proc: subprocess.Popen, timeout_s: float = 30.0) -> str:
    """
    Wait for Chrome's DevTools endpoint and return its HTTP base (e.g. http://127.0.0.1:41234).

    `--remote-debugging-port=0` makes Chrome pick a free port - which matters because a fixed
    port would collide with the owner's own Chrome on :9333, and killing that mid-session is a
    documented hazard here.
    """
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if proc.poll() is not None:
            raise SmokeFailure(f"Chrome exited immediately: {proc.stderr.read()[:400]}")
        line = proc.stderr.readline()
        if not line:
            continue
        m = re.search(r"ws://(127\.0\.0\.1|localhost):(\d+)/", line)
        if m:
            return f"http://{m.group(1)}:{m.group(2)}"
    raise SmokeFailure(f"Chrome never announced a DevTools endpoint within {timeout_s:.0f}s")


def _new_page_ws(http_base: str) -> str:
    """
    Open a fresh tab and return ITS socket.

    The endpoint Chrome prints is the browser-level one, which has no Page or Log domain -
    connecting there and calling Page.enable fails with "wasn't found". A page target is what
    we actually need. Same PUT /json/new dance as scripts/evaljs.py.
    """
    req = urllib.request.Request(f"{http_base}/json/new?about:blank", method="PUT")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            target = json.load(r)
    except urllib.error.HTTPError as e:                      # noqa: PERF203 - one call, one error
        raise SmokeFailure(f"could not open a tab via {http_base}/json/new: {e}") from e
    ws_url = target.get("webSocketDebuggerUrl")
    if not ws_url:
        raise SmokeFailure(f"new tab has no webSocketDebuggerUrl: {target}")
    return ws_url


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base", default="http://127.0.0.1:8010",
                   help="origin serving the app (default: %(default)s)")
    p.add_argument("--container",
                   help="docker container name, to compare served bytes against the image")
    p.add_argument("--expect-sha", help="commit the image should report at /api/health")
    p.add_argument("--chrome", help="Chrome/Chromium binary (default: autodetect)")
    p.add_argument("--health-timeout", type=float, default=90.0)
    p.add_argument("--settle", type=float, default=10.0,
                   help="seconds to keep listening after navigate (default: %(default)s)")
    args = p.parse_args()

    try:
        log(f"1/5 waiting for {args.base}/api/health")
        health = wait_for_health(args.base, args.health_timeout)

        log("2/5 build provenance")
        check_build_sha(health, args.expect_sha)

        log("3/5 served bundle == built bundle")
        check_served_matches_built(args.base, args.container)

        log("4/5 icons are declared, served and parseable")
        check_icons(args.base)

        log("5/5 loading the page in headless Chrome")
        chrome = find_chrome(args.chrome)
        log(f"  using {chrome}")
        asyncio.run(check_page_in_browser(args.base, chrome, args.settle))
    except SmokeFailure as e:
        print(f"\nSMOKE FAILED: {e}", file=sys.stderr)
        return 1

    log("\nSMOKE PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
