# Remote access

How to reach this instance from someone else's browser, over the internet, without opening a
port on your home network. Design rationale and the terms question live in `docs/decisions.md`
**D-041**; this file is the runbook.

> **This is not a multi-user system.** It is a shared-secret door in front of a single-user
> console. There are no accounts, no roles beyond "owner or not", and no password reset. Anyone
> holding a link holds the access it grants until you rotate the token.

---

## 1. Mint tokens

One per person, so you can revoke one without disturbing the other:

```
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Put them in `.env` at the repo root (gitignored — **never commit tokens**):

```
LORAN_ACCESS_TOKENS=owner:PASTE_YOUR_TOKEN,brother:PASTE_THEIR_TOKEN
LORAN_OWNER_PRINCIPAL=owner
```

The names are yours to choose; `LORAN_OWNER_PRINCIPAL` must match whichever one is you.
Leave `LORAN_ACCESS_TOKENS` empty and **there is no access control at all** — which is the
right setting for a localhost-only instance, and the wrong one for anything reachable.

## 2. Serve app and API as one origin

```
bash scripts/serve.sh
```

This builds the frontend and serves it from the API process on `127.0.0.1:8010`. One origin
means no CORS and a same-site cookie. Note it binds to loopback: the tunnel reaches it, the
LAN does not.

## 3. Expose it with a Cloudflare tunnel

Outbound-only — nothing is forwarded into your network, and TLS is handled for you.

> **Use a NAMED tunnel. Account-less "quick" tunnels did not work here** (measured
> 2026-07-25): two separate `cloudflared tunnel --url` quick tunnels registered cleanly with
> the edge (`Registered tunnel connection … location=atl12`) and were handed
> `*.trycloudflare.com` hostnames, but every request to those hostnames returned **HTTP 404
> from Cloudflare with an empty body**, and uvicorn's access log showed the requests never
> reached the origin at all. So the failure is at the edge, not in this app. Cloudflare has
> been progressively restricting account-less tunnels; do not waste time retrying them.

```
cloudflared tunnel login            # once, opens a browser; skip if ~/.cloudflared/cert.pem exists
cloudflared tunnel create loran
cloudflared tunnel route dns loran adsb.example.com
cloudflared tunnel run --url http://127.0.0.1:8010 loran
```

> **Do not edit `~/.cloudflared/config.yml` if you run other tunnels.** That file is shared, and
> on this machine it belongs to an unrelated always-on tunnel (`cloudflared-voygent.service`).
> Pass `--url` on the command line, or use a project-local `--config` file, so this project
> cannot disturb another one.
>
> For the same reason, never `pkill -f "cloudflared tunnel"` — it matches every tunnel on the
> box. Kill by PID, or stop the specific service. (Learned the hard way: it took the voygent
> tunnel down for ~15 seconds until systemd restarted it.)

## 4. Send the link

```
https://adsb.example.com/?t=PASTE_THEIR_TOKEN
```

They open it once. The app trades the token for an `HttpOnly` cookie, **strips `?t=` out of the
address bar**, and that browser stays signed in for 30 days
(`LORAN_SESSION_TTL_SECONDS`). Their toggles, filters and slice settings persist in their own
browser via `localStorage` — per device, not per account.

Send the link over something private. It is a bearer credential in a URL, which is the price of
"no hoops": anyone who gets the whole link gets in.

---

## Adding someone later

Same three steps as §1, plus the part that is easy to miss:

1. Generate a token and append `,name:TOKEN` to `LORAN_ACCESS_TOKENS` in `.env`.
2. **Apply it.** Under Compose, `.env` is read when the container is *created*, not on every
   request — the running container keeps the old token list until you recreate it:

   ```
   docker compose up -d
   ```

   No `--build` needed; only the environment changed. On the bare-metal path, restart
   `scripts/serve.sh`.
3. **Verify before you send the link.** `GET /` answers 200 with or without a valid token, so
   opening the page proves nothing. Ask the session endpoint instead:

   ```
   curl -sS "https://adsb.example.com/api/session?t=PASTE_THEIR_TOKEN"
   ```

   A good token returns `{"auth":true,"principal":"<their name>","owner":false}` and a
   `Set-Cookie`; a bad one returns **401** `token not recognised`. `/api/health` also reports
   `auth.principals` as a count, which catches an `.env` that never took effect.

> **Adding a person signs everyone else out**, in the default configuration — see the warning
> under Revoking. Warn them, or do it when nobody is mid-flight-watch.

## Revoking

Remove that person's entry from `LORAN_ACCESS_TOKENS` and recreate the container (or restart
`serve.sh`). Their existing cookies stop working immediately — sessions name their principal, and
a principal that is no longer configured is rejected.

> **Any change to the token list signs out every principal, not just the one you touched.**
> When `LORAN_SESSION_SECRET` is unset — the default — `auth.py` derives the cookie-signing key
> from the sorted list of tokens, so adding, removing or rotating *any* entry changes the key and
> invalidates *every* outstanding cookie. Nobody loses access: each person re-opens their own link
> and gets a fresh 30-day cookie. Setting `LORAN_SESSION_SECRET` pins the key and avoids this, but
> then a rotated token stops revoking its old cookies until they expire (up to
> `LORAN_SESSION_TTL_SECONDS`), which is the worse failure. Leaving it unset is deliberate.

## What a visitor without a token sees

The app shell loads and says **ACCESS TOKEN REQUIRED**, with no traffic and an explicit "nothing
on screen is current". They do see the basemap and the built-in airfield/city labels, because
those are compiled into the bundle rather than fetched — public reference data, no live
information. Every `/api` route except `/api/health` returns 401.

`/api/health` is intentionally open so you can check the service from outside without a token.
It reports uptime and feed status only — no positions, no airframe data.

## Photos and planespotters clause 8

Their terms forbid re-exposing their API, and `docs/data-sources.md` records the mitigation as
*"never expose it publicly"*. So `LORAN_PHOTO_GUEST_ACCESS` **defaults to `false`**: guests
get the honest no-photo state and an explicit reason, while the owner still gets photos. Setting
it `true` serves photos to guests too and is a deliberate departure from those terms — the
owner of this deployment has made that call knowingly (D-041). The default in this repository
stays compliant.

## Cloudflare caches static files for four hours

Deploying is not the same as the change being visible through the tunnel.

| Path | `cf-cache-status` | Consequence |
|---|---|---|
| `/` and every `/api/*` | `DYNAMIC` | never cached, changes are live immediately |
| `/assets/index-*.js` and `.css` | cached, `max-age=14400` | safe: Vite puts a content hash in the filename, so a new build is a new URL |
| `/favicon.svg`, `/apple-touch-icon.png` | cached, `max-age=14400` | **stale for up to 4 hours** — these filenames have no content hash |

This has already caused one wasted debugging session: a fixed favicon was verified correct on
`127.0.0.1:8010` and simultaneously served broken through the tunnel, because the edge still
held the pre-fix copy. `curl -s https://<host>/api/health | jq .build_sha` reported the right
commit throughout — provenance says what the *origin* runs, not what the CDN hands out.

The fix is a version query on the reference in `frontend/index.html`, which is `DYNAMIC` and
never cached, so a new `?v=` fetches a fresh copy at once:

```
<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=2" />
```

**Bump `?v=` whenever an icon changes.** Note CI cannot catch this: the smoke check talks to
localhost, where there is no CDN. Running `python3 scripts/smoke.py --base https://<host>` against
the real tunnel is what surfaces it.

## Things this does not do

- **No rate limiting per user.** The upstream 1 req/sec budget is protected by a global gate in
  `backend/app/feeds/adsb.py`, so extra viewers cannot breach it — they queue. What degrades is
  freshness, not compliance.
- **No audit log.** Nothing records who looked at what, by design.
- **No protection from Cloudflare.** They terminate TLS and can see traffic in principle. Use
  the reverse-proxy path instead if that matters to you.
- **Never expose the Vite dev server (`:5173`).** It is a build tool, not a web server, and it
  has no access control in front of it.
