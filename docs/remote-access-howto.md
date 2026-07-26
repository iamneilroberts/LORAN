# Remote access — how to actually use it

Companion to `docs/remote-access.md` (the design runbook) and `docs/decisions.md` **D-041** /
**D-057** (why it is built this way). This file is the *operational* one: what has been tested
on this machine, what has not, and what you have to do yourself.

Everything under **VERIFIED** was run against the live stack on **2026-07-26** and the output
below is the real output, with token and cookie values replaced by `<TOKEN>` / `<COOKIE>`.
Everything under **NOT YET VERIFIED** is exactly that — say "untested" out loud rather than
assume it works.

**Short version:** the token door works. The tunnel does not exist yet. You are one
`cloudflared tunnel create` away from a working link, and that step needs your hands because it
creates cloud resources.

---

## What was running when this was tested

| Thing | State |
|---|---|
| Docker container `loran` | up, healthy, published on `127.0.0.1:8010` only |
| `LORAN_STATIC_DIR` in the container | `/app/static` — app + API on one origin, one port |
| Vite dev server | `127.0.0.1:5173`, proxying `/api` → `127.0.0.1:8010` |
| `LORAN_ACCESS_TOKENS` | set, 2 principals (`owner`, `brother`) |
| `LORAN_SESSION_SECRET` | **not set** — see caveat 1 |
| `LORAN_PHOTO_GUEST_ACCESS` | `true` locally; repo default is `false` — see caveat 2 |
| Cloudflare tunnel for LORAN | **does not exist** |

```
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' | grep loran
```

```
loran	Up About an hour (healthy)	127.0.0.1:8010->8010/tcp
```

---

# VERIFIED

## 1. The door is shut

An unauthenticated API call is refused before it ever reaches a handler.

```
curl -s -i "http://127.0.0.1:8010/api/aircraft?lat=30.69&lon=-88.04&radius=50"
```

```
HTTP/1.1 401 Unauthorized
content-type: application/json

{"detail":"access token required","auth":"token"}
```

`/api/config` behaves the same. Two things stay open on purpose:

```
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:8010/api/health
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:8010/
```

Both return `HTTP 200`. `/api/health` reports uptime, feed status and
`"auth":{"enabled":true,"principals":2}` — no positions, no airframe data, no token or principal
names. `/` serves the app shell (388 bytes of `index.html`, then a 5.0 MB JS bundle) so a
visitor without a token sees the **ACCESS TOKEN REQUIRED** panel instead of a blank page.

Asking "am I logged in?" with no cookie:

```
curl -s -w '\nHTTP %{http_code}\n' http://127.0.0.1:8010/api/session
```

```
{"auth":true,"principal":null,"owner":false}
HTTP 401
```

## 2. `scripts/mint-link.sh` works

```
bash scripts/mint-link.sh
bash scripts/mint-link.sh https://adsb.voygent.ai
```

```
!! Each URL below CONTAINS A LIVE CREDENTIAL. Anyone holding it is logged in.

owner            https://adsb.voygent.ai/?t=<TOKEN>
brother          https://adsb.voygent.ai/?t=<TOKEN>

The token can also be pasted straight into the locked panel, which keeps it out of the
URL and out of every access log between here and the browser (D-057).
```

It reads `.env`, mints nothing, writes nothing. Pass the base URL as the first argument to get
links for the tunnel hostname instead of localhost.

## 3. The `?t=` link mints a cookie

```
curl -s -i "http://127.0.0.1:8010/api/session?t=<TOKEN>"
```

```
HTTP/1.1 200 OK
set-cookie: loran_session=<COOKIE>; HttpOnly; Max-Age=2592000; Path=/; SameSite=lax

{"auth":true,"principal":"owner","owner":true}
```

Cookie attributes **actually observed over plain HTTP on localhost**:

| Attribute | Present? | Value |
|---|---|---|
| `HttpOnly` | yes | — |
| `Max-Age` | yes | `2592000` (30 days, = `LORAN_SESSION_TTL_SECONDS`) |
| `Path` | yes | `/` |
| `SameSite` | yes | `lax` |
| `Secure` | **no** | absent over `http://` |

`Secure` is derived from `X-Forwarded-Proto`, falling back to the request scheme
(`backend/app/main.py`, `_issue_session`). That derivation was tested directly by faking the
header the tunnel will send:

```
curl -s -D - -o /dev/null -H "X-Forwarded-Proto: https" "http://127.0.0.1:8010/api/session?t=<TOKEN>"
```

```
set-cookie: loran_session=<COOKIE>; HttpOnly; Max-Age=2592000; Path=/; SameSite=lax; Secure
```

So: `Secure` **is** added when the request looks like it arrived over HTTPS. That is
*measured against a hand-set header*, not against a real Cloudflare tunnel — the inference that
cloudflared sets `X-Forwarded-Proto: https` is standard behaviour but is **untested here**.

## 4. The cookie opens the door

```
curl -s -b cookies.txt "http://127.0.0.1:8010/api/aircraft?lat=30.6944&lon=-88.0399&radius=50"
```

```
{"source":"airplanes.live","server_time":1785095594.9,"count":27,"aircraft":[{"hex":"a788a2", ...
```

`/api/config` with the same cookie returns
`{"home":{...},"principal":"owner","owner":true,"auth":true}`.

## 5. The paste box (`POST /api/session`) works

Real endpoint, real behaviour, using the *second* principal's token:

```
curl -s -i -X POST http://127.0.0.1:8010/api/session -H 'Content-Type: application/json' -d '{"t":"<TOKEN>"}'
```

```
HTTP/1.1 200 OK
set-cookie: loran_session=<COOKIE>; HttpOnly; Max-Age=2592000; Path=/; SameSite=lax

{"auth":true,"principal":"brother","owner":false}
```

Identical cookie flags to the link path — both go through one `_issue_session`. That cookie then
returned `HTTP 200` on `/api/aircraft` and `"principal":"brother","owner":false` on
`/api/config`, so a guest is a real, distinguishable principal.

Malformed and wrong-typed bodies get one uniform answer, and never echo the submitted value:

```
curl -s -w '\nHTTP %{http_code}\n' -X POST http://127.0.0.1:8010/api/session -H 'Content-Type: application/json' -d 'not json'
curl -s -w '\nHTTP %{http_code}\n' -X POST http://127.0.0.1:8010/api/session -H 'Content-Type: application/json' -d '{"t":12345}'
```

Both: `{"auth":true,"principal":null,"owner":false,"detail":"token not recognised"}` / `HTTP 401`.

The browser-side panel (password-type field, "Token not recognised", 429 handling) was **read in
`frontend/src/App.tsx`, not exercised in a browser in this pass** — driving it would have meant
clearing your own session cookie. The endpoint it posts to is verified above.

## 6. The failure throttle works

Tested in an isolated bucket (`X-Forwarded-For: 203.0.113.99`) so your own localhost bucket was
never burned. Seven wrong tokens in a row:

```
for i in $(seq 1 7); do curl -s -w ' HTTP %{http_code}\n' -H 'X-Forwarded-For: 203.0.113.99' "http://127.0.0.1:8010/api/session?t=wrongtoken$i"; done
```

```
{"...","detail":"token not recognised"} HTTP 401   (x5)
{"...","detail":"too many attempts"}    HTTP 429   (attempts 6 and 7)
```

Follow-up probes, all measured:

| Probe | Result |
|---|---|
| **Correct** token from the throttled bucket | `HTTP 429` — the throttle is checked *before* the token |
| Correct token from a different bucket (`203.0.113.200`) | `HTTP 200` — per-client, not global |
| `GET /api/session` with no `?t=` from the throttled bucket | `HTTP 401`, not throttled |
| `/api/health` from the throttled bucket | `HTTP 200` |
| An **already-valid cookie** used from the throttled bucket | `HTTP 200` on `/api/aircraft` |
| Same bucket ~3 minutes later, correct token | `HTTP 200` — the window expired |

So: 5 failures per client per 60 s (`LORAN_SESSION_FAIL_LIMIT`, `LORAN_SESSION_FAIL_WINDOW_SECONDS`),
it expires on its own, and it can only ever block *getting a new session* — it never logs out
someone who already has a cookie. Nobody can be locked out permanently.

Bucketing is the first entry of `X-Forwarded-For` if present, else the peer address
(`_client_key`). Behind the tunnel every request arrives from cloudflared, so that header is the
only thing separating two visitors — which is why it is trusted, and why it stops being safe if
the port is ever published directly.

## 7. `LORAN_SESSION_SECRET` — the concern is real

Reproduced offline against `backend/app/auth.py` with fake tokens (nothing live touched):

| Scenario | `SESSION_SECRET` unset | `SESSION_SECRET` set |
|---|---|---|
| Cookie survives **adding** a second person | **NO — everyone logged out** | yes |
| Cookie survives a restart | yes | yes |
| **Removing** a principal kills their cookie | yes | yes |
| **Rotating** a token, same principal name, kills the old cookie | yes (kills *everyone's*) | **NO — old cookie still valid** |

`LORAN_SESSION_SECRET` is **not set** in this deployment's `.env`, so today: adding a third
person logs you and your brother out (you both just re-open your links), and rotating a token
revokes everything. See caveat 1 for which side of that trade to take.

## 8. Photos, guest access, clause 8

Repo default (`.env.example` line 132, and `backend/app/config.py`) is
`LORAN_PHOTO_GUEST_ACCESS=false`. **This deployment overrides it to `true`.** Measured — same
aircraft, two principals:

```
curl -s -b owner.jar   "http://127.0.0.1:8010/api/photo?hex=a2845b"
curl -s -b brother.jar "http://127.0.0.1:8010/api/photo?hex=a2845b"
```

Both returned the identical payload with a real photo URL, `"matched_on":"hex"`, `"errors":[]`.
So the guest is getting photos here, which is the deliberate terms departure recorded in D-041.

The withheld path (`"errors":["photos are owner-only on this instance (planespotters clause 8)"]`)
is in `main.py` but was **not exercised** — doing so would have meant editing `.env` and
restarting your container.

## 9. Origins and CORS

`LORAN_CORS_ORIGINS` is unset, so it is the default
`http://localhost:5173,http://127.0.0.1:5173`. **It does not need to change for the tunnel.**

- Served path: the API process serves the built app (`LORAN_STATIC_DIR=/app/static`, confirmed in
  the container's env, and `GET /` returns the real `index.html`). App and API are the same
  origin, so no CORS is involved at all.
- Dev path: Vite proxies `/api` → `127.0.0.1:8010` (`frontend/vite.config.ts` line 13), so the
  browser also sees one origin. Verified through the proxy: `/api/config` unauthenticated on
  `:5173` returned `HTTP 401`, and with a cookie returned the owner payload.

A request carrying `Origin: https://adsb.voygent.ai` was served normally with **no
`access-control-*` headers** in the response — correct, because a browser on that hostname
talking to that hostname never makes a cross-origin request. Adding the tunnel hostname to
`LORAN_CORS_ORIGINS` would be cargo cult. Also note `CORSMiddleware` is configured without
`allow_credentials`, so a genuinely cross-origin cookie-bearing call would **not** work anyway —
one origin is not a nicety here, it is the design.

## 10. Tunnel prerequisites (read-only checks — nothing created)

```
cloudflared --version
```

```
cloudflared version 2025.9.1 (built 2025-09-22-13:28 UTC)
```
(It warns that 2026.7.3 is current. Upgrading is optional and unrelated.)

```
ls -la ~/.cloudflared/
cloudflared tunnel list
```

```
cert.pem   present    -> you are already logged in; SKIP `cloudflared tunnel login`
71bc66de-4433-44f6-b6bf-5304f28d2578.json   (voygent-desktop credentials)
config.yml (SHARED - see hazard below)

ID                                    NAME                   CONNECTIONS
71bc66de-4433-44f6-b6bf-5304f28d2578  voygent-desktop        1xatl01, 1xatl08, 1xatl12, 1xatl13
d253e0d3-d573-496a-91e1-bfeb5c567cef  voygent-desktop-cloud  (none)
```

**There is no `loran` tunnel.** That is the missing last mile.

### The `config.yml` hazard — confirmed, not theoretical

`~/.cloudflared/config.yml` belongs to `cloudflared-voygent.service` (active 18 h, PID 2157396,
running `cloudflared tunnel run voygent-desktop`). Its full contents:

```
tunnel: 71bc66de-4433-44f6-b6bf-5304f28d2578
credentials-file: /home/neil/.cloudflared/71bc66de-4433-44f6-b6bf-5304f28d2578.json

ingress:
  - hostname: mcp.voygent.ai
    service: http://localhost:8788
  - hostname: desktop.voygent.ai
    service: http://localhost:8788
  - service: http_status:404
```

That file is `cloudflared`'s **default** config path. Any `cloudflared` command you run without
`--config` reads it — which means a LORAN tunnel started carelessly inherits voygent's tunnel ID,
voygent's credentials file and voygent's ingress rules. What its catch-all does to an unlisted
hostname, checked read-only:

```
cloudflared --config ~/.cloudflared/config.yml tunnel ingress rule https://adsb.voygent.ai
```

```
Using rules from /home/neil/.cloudflared/config.yml
Matched rule #2
	service: http_status:404
```

Versus a hostname it does own:

```
cloudflared --config ~/.cloudflared/config.yml tunnel ingress rule https://desktop.voygent.ai
```

```
Matched rule #1
	hostname: desktop.voygent.ai
	service: http://localhost:8788
```

So `adsb.voygent.ai` falls into the 404 catch-all. **Never edit that file, never
`systemctl restart cloudflared-voygent`, and never `pkill cloudflared`** — the last one matches
every tunnel on the box and has already taken voygent down once (`docs/remote-access.md` §3).
Give LORAN its own config file and kill it by PID.

### DNS: `voygent.ai` has a wildcard, and `adsb.voygent.ai` already answers

```
dig +short adsb.voygent.ai
dig +short zzz-nonexistent-test-98765.voygent.ai
curl -s -o /dev/null -w 'HTTP %{http_code}\n' https://adsb.voygent.ai/
```

```
104.21.28.47
172.67.144.61
104.21.28.47          <- a made-up subdomain resolves too, so there is a WILDCARD record
172.67.144.61
HTTP 404
```

Right now `https://adsb.voygent.ai/` returns a **404 from Cloudflare's edge** (`server:
cloudflare`, `cf-ray` present) — the hostname resolves via the wildcard but no tunnel route
serves it. Two consequences for step 3 below:

- Do not read a 404 as "the app is broken". Until you route the hostname, 404 is the correct
  and expected answer.
- Because a wildcard already covers it, `cloudflared tunnel route dns` may report that a record
  exists. `--overwrite-dns` is the flag for that. **Untested.**

---

# NOT YET VERIFIED — the remaining steps

Everything below creates cloud resources or needs real HTTPS. None of it has been run. Do it in
order. Every command is one line; copy them one at a time.

**1. Confirm the origin is serving.** Either the container (already up) or the bare-metal path.

```
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:8010/api/health
```

Expect `HTTP 200`. If you are not using Docker: `bash scripts/serve.sh`.

**2. Create the tunnel.** `cert.pem` exists, so skip `cloudflared tunnel login`.

```
cloudflared tunnel create loran
```

Note the UUID it prints and the credentials JSON path it writes into `~/.cloudflared/`.

**3. Route the hostname.**

```
cloudflared tunnel route dns loran adsb.voygent.ai
```

If it refuses because a record already exists (the wildcard, see above), then:

```
cloudflared tunnel route dns --overwrite-dns loran adsb.voygent.ai
```

**4. Write LORAN its own config file** — this is the step that keeps you away from voygent's
`config.yml`. Create `~/.cloudflared/loran.yml` containing exactly this, with `<LORAN-UUID>`
replaced by the UUID from step 2:

```
tunnel: <LORAN-UUID>
credentials-file: /home/neil/.cloudflared/<LORAN-UUID>.json

ingress:
  - hostname: adsb.voygent.ai
    service: http://127.0.0.1:8010
  - service: http_status:404
```

Check it parses and routes the way you expect before running anything:

```
cloudflared --config ~/.cloudflared/loran.yml tunnel ingress validate
cloudflared --config ~/.cloudflared/loran.yml tunnel ingress rule https://adsb.voygent.ai
```

The second should print `service: http://127.0.0.1:8010`, not `http_status:404`.

**5. Run it in the foreground first**, so you can watch it and stop it with Ctrl-C:

```
cloudflared --config ~/.cloudflared/loran.yml tunnel run loran
```

Do **not** add `--url` when you use a config file with ingress rules — cloudflared rejects the
combination.

**6. From another machine (phone on cellular is the honest test), check the open endpoint:**

```
curl -s -o /dev/null -w 'HTTP %{http_code}\n' https://adsb.voygent.ai/api/health
```

Expect `HTTP 200`. If you get 404, the edge is not routing — recheck steps 3 and 4. If you get
502/530, the tunnel is up but cannot reach `127.0.0.1:8010`.

**7. Check the door survived the trip**, and that the cookie now carries `Secure`:

```
curl -s https://adsb.voygent.ai/api/config
curl -s -D - -o /dev/null "https://adsb.voygent.ai/api/session?t=<TOKEN>"
```

Expect `{"detail":"access token required","auth":"token"}` from the first, and a `set-cookie`
line **ending in `Secure`** from the second. If `Secure` is missing, cloudflared is not sending
`X-Forwarded-Proto: https` and that needs looking at before you share the link.

**8. Make it survive a reboot — optional, and only once you trust it.** Do NOT use
`cloudflared service install`; that writes to the shared config path. Write your own unit,
modelled on `/etc/systemd/system/cloudflared-voygent.service`, named `cloudflared-loran.service`,
whose `ExecStart` is `/usr/local/bin/cloudflared --config /home/neil/.cloudflared/loran.yml tunnel run loran`.
Untested.

**Also untested, and worth knowing:** whether Cloudflare's default proxy settings interfere with
anything LORAN does; whether the 5 MB JS bundle is comfortable over the tunnel; and the
`--overwrite-dns` behaviour against the existing wildcard.

---

# CAVEATS

### 1. `LORAN_SESSION_SECRET` is unset — adding a person logs everyone out

Measured in section 7. With no secret set, the cookie signing key is derived from the sorted
token list, so **any change to the token list changes the key and invalidates every existing
cookie**. Adding a third person signs you and your brother out.

It is not a catastrophe — everyone re-opens their link and is back in — but it is surprising if
you do not expect it. The two options, and what each costs:

| | Leave it unset (today) | Set `LORAN_SESSION_SECRET` |
|---|---|---|
| Adding a person | logs everyone out | nobody is disturbed |
| Rotating a token to lock someone out | works, and logs everyone out | **does not work** — their old cookie stays valid for up to 30 days |
| Removing a person entirely | works | works |

If you set a secret, **revocation must be done by removing or renaming the principal, not by
changing their token string**. Given that revocation is the thing you actually care about,
leaving it unset is the safer default; just expect the logout when you add someone.

To set one anyway: `python3 -c "import secrets; print(secrets.token_urlsafe(32))"` into
`LORAN_SESSION_SECRET` in `.env`, then restart. Doing that invalidates all current sessions once,
at the moment you set it.

### 2. Photos are being served to guests, against planespotters clause 8

Measured in section 8: `LORAN_PHOTO_GUEST_ACCESS=true` in this `.env`, and the guest principal
gets identical photo metadata to the owner. That is your recorded, eyes-open call for your own
deployment (D-041) and the repo default stays `false`. It is listed here only so it is not a
surprise later. Set it to `false` and restart if you change your mind; guests then get an
explicit "photos are owner-only on this instance (planespotters clause 8)" reason rather than a
silent blank.

### 3. The throttle can briefly block *you*

Five wrong tokens from one address in 60 seconds and the *sixth attempt is refused even if it is
correct* (measured). It expires by itself inside the window, it is per-client, and it never
touches an existing session. Behind the tunnel, clients are separated by `X-Forwarded-For` — so
if that header ever went missing, every visitor would share one bucket. Counters are in memory
and reset when the container restarts.

### 4. The link is a bearer credential in a URL

Anyone who gets the whole link is logged in for 30 days. It will sit in your chat client's
history, in Cloudflare's logs, and in uvicorn's access log, because a link is a URL. The paste
box exists to avoid exactly that: send the token on its own and have them paste it into the
locked panel. Prefer that route for anything you would rather not have written down.

### 5. What a visitor without a token actually gets

The app shell, the basemap, and the compiled-in airfield and city labels — all public reference
data — plus the ACCESS TOKEN REQUIRED panel saying nothing on screen is current. Every `/api`
route except `/api/session` and `/api/health` returns 401. `/api/health` is deliberately open and
reports uptime, feed status and `auth.enabled` only; no positions, no airframe data, no principal
names.

### 6. Small print

- Preferences live in each browser's `localStorage`, per device, not per person. A guest's
  toggles do not follow them to their phone.
- No audit log. Nothing records who looked at what.
- No per-user rate limiting — extra viewers queue behind the global 1 req/sec upstream gate, so
  freshness degrades rather than compliance.
- Cloudflare terminates TLS and can see traffic in principle.
- **Never tunnel to `:5173`.** The Vite dev server is a build tool with nothing in front of it.
  Tunnel to `:8010`, which is the one-origin served path.
- `127.0.0.1:8010` is loopback-only. Your LAN cannot reach it; only the tunnel can.

---

# HOW TO SHARE A LINK WITH SOMEONE

**1. Give them a token of their own** — never share yours, or you cannot revoke one without the
other.

```
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

**2. Add it to `.env`** as `name:token`, comma-separated, alongside the existing entries:

```
LORAN_ACCESS_TOKENS=owner:<YOUR-TOKEN>,brother:<THEIR-TOKEN>,sister:<NEW-TOKEN>
```

**3. Restart so it is picked up.** With `SESSION_SECRET` unset this is the moment everyone gets
logged out (caveat 1) — expected, harmless, everyone re-opens their link.

```
docker compose restart loran
```

**4. Print the links.**

```
bash scripts/mint-link.sh https://adsb.voygent.ai
```

**5. Send it privately.** Either the whole `https://adsb.voygent.ai/?t=<TOKEN>` link, or — better
— send `https://adsb.voygent.ai/` and the bare token separately and have them paste it into the
panel.

**What they experience:** they open the link, the page loads, the app trades the token for a
30-day `HttpOnly` cookie and strips `?t=` out of the address bar with `replaceState`, and the
globe fills in on the next poll tick (up to 5 seconds of blank — nothing is drawn until real data
arrives). If they pasted the token instead, the panel closes and the same thing happens. They can
bookmark the bare URL and it keeps working for 30 days. Their toggles and filters persist in that
browser only.

**If it does not work for them:** have them hit `https://adsb.voygent.ai/api/health` — 200 means
the service is up and the problem is their token; anything else means the tunnel is down.

---

# HOW TO REVOKE / TURN IT ALL OFF

**Revoke one person.** Delete their `name:token` entry from `LORAN_ACCESS_TOKENS` in `.env` and
restart. Their cookie dies immediately — sessions name their principal and an unconfigured
principal is rejected (verified in section 7). This is the reliable revocation and it works
whether or not `SESSION_SECRET` is set.

```
docker compose restart loran
```

**Revoke everyone / go back to single-user.** Empty the variable and restart:

```
LORAN_ACCESS_TOKENS=
```

With it empty there is **no access control at all** — every request is the owner. That is correct
for a loopback-only instance and catastrophic for a tunnelled one. **Empty the tokens only after
the tunnel is down, never before.**

**Take the door off the internet — the fast one.** Stop the LORAN tunnel process. If you started
it in the foreground, Ctrl-C. Otherwise find it by its config file and kill it by PID:

```
pgrep -af "cloudflared --config /home/neil/.cloudflared/loran.yml"
```

```
kill <PID-FROM-ABOVE>
```

**Never `pkill cloudflared`** — it kills the voygent tunnel too. If you installed the systemd unit
from step 8:

```
sudo systemctl stop cloudflared-loran.service && sudo systemctl disable cloudflared-loran.service
```

**Remove it permanently.** Delete the DNS route in the Cloudflare dashboard, then:

```
cloudflared tunnel delete loran
```

Then delete `~/.cloudflared/loran.yml` and the LORAN credentials JSON. Leave
`~/.cloudflared/config.yml`, `cert.pem`, and the `71bc66de-…json` file alone — those are
voygent's.

**Verify it is really off** from a phone on cellular:

```
curl -s -o /dev/null -w 'HTTP %{http_code}\n' https://adsb.voygent.ai/api/health
```

A 404 from Cloudflare (or a DNS failure) means nothing is being served. A 200 means it is still
up.
