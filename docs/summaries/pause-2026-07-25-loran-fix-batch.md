# Session Handoff: LORAN — four fixes, then remote access and themes
**Date:** 2026-07-25 at 21:52
**Repo:** /home/neil/dev/adsb-viz-phase2-dossier
**Branch:** `main` ← this worktree was switched off `phase2-dossier` during the last session
**Worktree:** `/home/neil/dev/adsb-viz-phase2-dossier` — **RESUME HERE, do not create a new branch**
**Uncommitted changes:** no
**Supersedes:** `pause-2026-07-25-remote-access.md` (same day, narrower scope). This file is
authoritative; the older one only covers remote access and predates D-048.
**Stale if:**
- `main` moves past `7419964` (== `origin/main`)
- The container stops: `docker ps --filter name=loran` should show *healthy*, publishing `127.0.0.1:8010`
- Vite is not on `:5173` — it is a **host** process (`npm run dev` in `frontend/`), not Docker, and it proxies `/api` → the container
- `.env` loses `LORAN_ACCESS_TOKENS` — without it there is **no access control**
- `/api/track` stops returning data: `curl -sS -b <jar> 'http://localhost:5173/api/track?hex=<live hex>'` returned **254 points / 1789 s**. If it now returns 0, the track bug below is a *different* bug and the "backend is fine" finding is void
- Quick Cloudflare tunnels start working: they 404'd at the edge twice. If `cloudflared tunnel --url http://127.0.0.1:8010` now serves 200, the named-tunnel requirement is obsolete
**Transcript:** (previous session)

**NOTE ON THIS COPY:** this is the **redacted** copy, committed because the repository is
PUBLIC. Access tokens and an unrelated project's tunnel id have been replaced with placeholders.
The unredacted original lives at
`~/.claude/coordination/adsb-viz/handoffs/pause-2026-07-25-loran-fix-batch.md`, which is outside
the repo and is what `auto-resume` / `/pickup` actually read. Real token values are in `.env`
(gitignored) — never commit them.


## What Was Accomplished

A long session. 17 commits, all on `main` and pushed to `github.com/iamneilroberts/LORAN` (public).
Decision log is at **D-048**.

Shipped: place markers (clickable, legibility-tuned), weather radar, remote-access token door,
a single-source palette with a build-time drift guard, the LORAN rename, MIT licence + NOTICE +
README with four real screenshots, Docker (cold-clone install verified), the projection envelope
that replaced the altitude slice, and a layout/colour fix batch.

**Most recent (D-048, `1322dca`)** — three owner observations, all correct:
- The dossier was squeezed because `CameraCluster` + `LayerCluster` sat *above* it in the same
  height-capped right column. Both moved to the **left**; the right column is the dossier's alone.
- City labels used `--dim` (`#5a6b7a`), nearly the colour of the water beneath them. New
  `--map-label` (`#9db2c4`) token; `--dim` stays panel chrome.
- Origin/dest now read `San Jose SJC` / `Denver DEN` — adsbdb already gave us `municipality`/`name`
  and we were hiding them in a hover title.

## Decisions Made

`docs/decisions.md` D-001 … D-048. The ones a fresh session must not undo:

- **D-047** — the projection envelope is a **stated assumption, not a forecast**: "where it will be
  in N minutes *if* it holds present speed and stays within ±X° of present track". No probability is
  attached; the width is an operator parameter. A true reachable set was rejected as *useless* (at
  425 kt an airliner can turn 360° in 5 min, so the set is nearly a disc). It slopes with V/S.
- **D-042** — `tokens.css` is the single source of colour; `styles/palette.ts` reads it back for
  Cesium. `npm run check:palette` fails the **build** on drift (12 colours).
- **D-041** — remote access is a shared-secret door, **off unless tokens are set**. `?t=` is spent
  once then stripped with `replaceState`. `/api/health` is deliberately open. The static shell is
  deliberately *not* gated so a visitor is told they need a token instead of seeing a dead-looking globe.
- **D-045** — Docker mirrors `serve.sh`: one origin, one port, no secret in any layer.
- **D-046** — measured CORS: airplanes.live / adsbdb / GEBCO / NEXRAD all `ACAO: *`; planespotters
  **403** and unfixable from a browser (`User-Agent` is a forbidden header).
- **D-033** — military airfield classification is a **name heuristic**, and the UI says so. KVPS
  (Eglin) renders civil. Do not present it as authoritative.
- **D-009 / clause 8** — planespotters image binaries are never fetched or proxied server-side.
  `LORAN_PHOTO_GUEST_ACCESS` defaults **false** in the repo; the owner sets it true locally. **Keep
  the repo default compliant.**

## Files Created or Modified

| File | Action | Why |
|------|--------|-----|
| `frontend/src/globe/projectionCone.ts` | created | the primary instrument; `coneGeometry()` is pure and exported to be unit-testable |
| `frontend/src/globe/placesLayer.ts` | created | airfields + cities, clickable, zoom-thinned |
| `frontend/src/globe/radarLayer.ts` | created | NEXRAD, off by default, self-refreshing |
| `frontend/src/styles/palette.ts` | created | reads tokens.css so Cesium and CSS cannot drift |
| `frontend/src/App.tsx` | modified | `claimSession()`; 401 → "not authorised", never a feed outage; **D-048 layout** |
| `frontend/src/state/store.ts` | modified | persist **allow-list**, version 2 migration, projection state |
| `frontend/src/panels/Panels.tsx` | modified | `PlacePanel`, projection controls, `airportPlace()` |
| `frontend/src/globe/Globe.tsx` | modified | cone + places + radar wiring, drill-pick click order |
| `backend/app/auth.py` | created | HMAC session cookie, stdlib only |
| `backend/app/main.py` | modified | auth middleware, `/api/session`, static mount **registered last** |
| `Dockerfile`, `docker-compose.yml`, `.dockerignore` | created | Docker path |
| `scripts/serve.sh`, `scripts/build_places.py`, `scripts/check_palette.mjs`, `scripts/shoot_readme.py` | created | prod serving, build-time data, palette guard, README shots |
| `LICENSE`, `NOTICE`, `README.md` | created/rewritten | MIT + data terms + real screenshots |
| `docs/remote-access.md` | created | **the remote runbook** |

## Git State

```
(clean — main at 7419964, identical to origin/main)
```

## Checklist
<!-- snapshot of the TodoWrite list — resume rebuilds TodoWrite from these boxes -->
- [x] Place markers, legibility pass, clickable airfields (D-032/033/037/038/039)
- [x] Weather radar off by default (D-040)
- [x] Remote access built and locally verified (D-041)
- [x] One palette + build-time drift guard (D-042)
- [x] Renamed LORAN (D-043); MIT + NOTICE + README with real screenshots (D-044)
- [x] Docker; cold-clone install verified against the real remote (D-045)
- [x] Single-file build logged as FUTURE with CORS measurements (D-046)
- [x] Projection envelope replaces the altitude slice (D-047)
- [x] Controls moved left, dossier owns the right column, map-label colour, origin/dest names (D-048)
- [x] Pushed to github.com/iamneilroberts/LORAN; `main` is the project; MIT detected
- [ ] **BUG: aircraft tracks do not display** — start here, see Remaining Work
- [ ] **Dotted line to the known destination**
- [ ] **Place-label density toggle** — the current set is too thin
- [ ] **Themes / colour chooser** — promoted out of FUTURE by the owner
- [ ] **Enable and verify remote access** — blocked on ONE owner decision (DNS hostname)
- [ ] Fix the HARNESS depth assertion (owner confirmed the app itself is fine)
- [ ] Judge the low end of the altitude ramp on a real display
- [ ] Judge the projection envelope; tune default minutes/spread
- [ ] Unit tests — still ZERO. Needs a framework decision (rule 2: ask before adding a dependency)
- [ ] Viewport-scoped fetch (Phase 1 debt — fixed 120 nm, ignores the camera)
- [ ] Add OurAirports / Natural Earth / NEXRAD to `docs/data-sources.md` in full
- [ ] Residual label overlap (Maxwell / Montgomery Regional / Montgomery)
- [ ] Dossier vanishes mid-read when the contact leaves the feed — keep, or a LOST banner?
- [ ] Rename working dirs + shared coordination dir from `adsb-viz` to `loran`
- [ ] Decide what `master` (`375c226`) and `phase2-dossier` (`bb0b589`) are for now
- [ ] Phase 3 — configurable projection/ramp thresholds UI
- [ ] Phase 5 — SQLite recorder; **DDL reviewed by owner before the writer**
- [ ] Phase 6 — status bar, compass, FPS readout
- [ ] Phase 4 — vessels; **blocked on a marine-VHF antenna (162 MHz)**
- [ ] FUTURE: single-file build (owner wants it; photos impossible — D-046)

## Self-Critique

- **Least confident:**
  1. **The last hour of that session moved faster than it verified.** D-048 was checked in one
     headless screenshot, not on the owner's display. The track bug is the cautionary example: I had
     a plausible cause (hex case), tested it, and **it was wrong**. Re-verify D-048 on the real
     display before building on it.
  2. **Cookie `Secure` behaviour over real HTTPS is untested.** The code trusts `x-forwarded-proto`;
     that path has only ever run over plain HTTP locally.
  3. **Nobody has watched a second person use the guest link.** All guest verification was curl and
     headless Chrome.
  4. **The projection envelope's defaults** (5 min, ±10°) are guesses; it shipped hours ago.
  5. **Left column height.** With Camera + Layers now on the left plus the legend and cursor
     readout, a short window may crowd or overlap. Only checked at 1000 px tall.
- **Biggest thing being missed:** **zero unit tests**, and every check in this project is end-to-end
  against live traffic. That is honest but fragile — it goes red at 3 a.m., on a feed hiccup, or
  when no military contact is in range, for reasons unrelated to code. Four network dependencies
  and a ring buffer have no isolated coverage. `coneGeometry()` was deliberately written pure to be
  the first test.
- **If it breaks in 3 months:** the **tunnel** (newest, least exercised, and a quick tunnel already
  failed in a way that looked like an app bug), or **planespotters** — their terms permit revoking
  access without notice, and this deployment deliberately serves photos to a guest, which clause 8
  forbids.
- **Did NOT do:** find the track bug; the destination line; the density toggle; any theme work; the
  tunnel or any DNS record; any test; the harness depth fix; the directory rename.
- **How to check:**
  - Track bug: click TRACK in a real browser, then in devtools
    `__viewer.entities.values.map(e=>String(e.id)).filter(i=>i.startsWith('track::'))` — non-empty
    means it is drawn but invisible; empty means the subscriber early-returned
  - Backend still innocent: `curl -sS -b <jar> 'http://localhost:5173/api/track?hex=<live hex>'` → expect ~250 points
  - Cookie over HTTPS: `curl -sS -D - -o /dev/null 'https://<host>/api/session?t=<guest>' | grep -i set-cookie` → needs `Secure` **and** `HttpOnly`
  - Named tunnel works: `curl -sS -o /dev/null -w '%{http_code}' https://<host>/api/health` → 200, not 404
  - Left column crowding: resize the browser to ~700 px tall and look
  - Palette integrity: `cd frontend && npm run check:palette` → "12 colours match"

## Remaining Work

**1. The track bug — start here.** Owner-visible and already half-diagnosed.
   - Backend is **ruled out**: `/api/track` returns 254 points over 1,789 s; the buffer holds 71
     contacts / 9,825 points.
   - Hex case is **ruled out**: the endpoint returns identical results for `a1f9e4` and `A1F9E4`.
     **Do not "fix" the `hex.toUpperCase()` in `TrackBlock`** — that was my first theory and it was wrong.
   - So the fault is in `frontend/src/globe/Globe.tsx`, in the `track::` subscriber. It keys on
     `${t.hex}|${t.count}|${t.last_ts}`, calls `clearByPrefix(viewer, 'track::')`, then adds one
     polyline. Check whether the entity exists after clicking TRACK (command above).
   - Candidate causes worth ruling out in order: the subscriber not firing; `points.length < 2`
     early-return; the polyline existing but invisible (alpha/width/`arcType`/depth against terrain).

**2. Dotted line to the known destination.** Data is already there — `EnrichAirport` carries
   `lat`/`lon` for origin and destination, normalised in `backend/app/feeds/adsbdb.py::_airport`.
   Draw only when coordinates exist; nothing when they do not. **It must look different from the
   projection envelope**: the destination is *filed intent*, the envelope is a *kinematic what-if*,
   and conflating them would be its own kind of lie. Dashed and dimmer, labelled with the code.

**3. Place-label density toggle.** Owner: "it's pretty thin." Constraint that will bite: **D-037
   dropped small airports, heliports and cities above scalerank 7 at BUILD time**, so they are not
   in `frontend/src/data/places.json` at all — a runtime toggle cannot reveal what was never
   shipped. So: (a) `scripts/build_places.py` emits the denser set with a density rank per row;
   (b) a DENSITY control widens the `DistanceDisplayCondition` ranges and admits higher ranks.
   Watch the JSON size (313 KB → 631 KB just for detail fields) and FPS (places already cost ~5 FPS).

**4. Themes / colour chooser** — promoted out of FUTURE. Groundwork is done (D-042) and
   `refreshPalette()` exists unused. Real remaining cost: Cesium primitives hold **baked** colours,
   so a switch must rebuild the aircraft/places/cone layers rather than just clear the memo;
   `DarkBathymetryProvider` remaps GEBCO pixels through hardcoded ramps held in parity with
   `scripts/make_dark_bathy.py`, so a light theme needs a second remap; and the altitude hue ramp's
   lightness (l: 52–68) assumes a near-black ground and is load-bearing (D-029). **A dark-variant
   chooser is far cheaper than true light mode** and is probably the right first step.

**5. Enable and verify remote access.** Everything is built and locally verified; blocked on one
   owner decision — the hostname. Proposed `adsb.voygent.ai`. **Do not create a DNS record on
   `voygent.ai` without an explicit answer.** Runbook: `docs/remote-access.md`. Short form:
   - `cloudflared tunnel create loran` · `cloudflared tunnel route dns loran <host>` ·
     `cloudflared tunnel run --url http://127.0.0.1:8010 loran`
   - **Named** tunnel only — quick tunnels 404 at Cloudflare's edge here, measured twice, without
     ever reaching the origin.
   - **Never** edit `~/.cloudflared/config.yml` (shared with `cloudflared-voygent.service`) and
     **never** `pkill -f "cloudflared tunnel"` — it matches every tunnel on the box and took the
     voygent tunnel down for ~15 s. Kill by PID.
   - Verify from **outside**: `/` 200 · `/api/health` 200 · `/api/aircraft` no cookie **401** ·
     `/api/session?t=<guest>` sets `Secure`+`HttpOnly` · then traffic 200 · guest link in a browser
     shows the locked panel, then traffic, with `?t=` gone from the URL.

## Open Questions

- **Tunnel hostname?** `adsb.voygent.ai` is the obvious candidate but it is a public record on a
  production domain. Owner's call, and the only thing blocking remote access.
- **Unit test framework?** Neither vitest nor pytest is in the CLAUDE.md stack; ground rule 2 says
  ask before adding a dependency. This is the largest engineering gap in the project.
- **Themes: dark variants first, or go straight at light mode?** Light mode costs a second
  bathymetry ramp and a re-derived altitude ramp; dark variants cost almost nothing now.
- **Projection defaults** — are 5 min / ±10° right?
- **What are `master` and `phase2-dossier` for** now that `main` is the project?
- **Rename the working directories to `loran`?** In-repo rename is done; the filesystem and the
  shared coordination dir still say `adsb-viz`, and moving them breaks worktree paths for other
  sessions, so it needs doing deliberately.

## Coordinate Closet
<!-- Exact ids/paths/values, newest-first, deduped. -->
- `7419964` (HEAD of `main` == `origin/main`) · `1322dca` (D-048) · `f701387` (D-047 cone)
- `5d83233` · `8c369d4` (Docker) · `4e6a0f1` · `cb0017d` · `bb0b589` · `92bec1a` (rename) · `2f55862` · `93e9b9f` · `9b62734` (remote access) · `0dc5c66` (radar) · `9ec391e` · `7942fe9` · `5f79a01`
- `375c226` (`master`, stale) · `bb0b589` (`phase2-dossier`) · `afb9b25` (GitHub stub commit)
- `https://github.com/iamneilroberts/LORAN` (PUBLIC, default `main`, MIT detected)
- `/home/neil/dev/adsb-viz-phase2-dossier` (worktree, on `main` — **resume here**)
- `/home/neil/dev/adsb-viz` (main clone, on `master`, coordination/docs only)
- `/home/neil/.claude/coordination/adsb-viz` (shared coord dir: journal + handoffs)
- `LORAN_ACCESS_TOKENS=owner:<OWNER_TOKEN — REDACTED, see .env>,brother:<GUEST_TOKEN — REDACTED, see .env>`
- owner link: `http://localhost:5173/?t=<OWNER_TOKEN — REDACTED, see .env>`
- `LORAN_OWNER_PRINCIPAL=owner` · `LORAN_PHOTO_GUEST_ACCESS=true` (local only; repo default `false`)
- `LORAN_USER_AGENT=loran/0.1 (+mailto:adsb@voygent.ai)` · contact `adsb@voygent.ai`
- `adsb.voygent.ai` (PROPOSED tunnel hostname — **not created**)
- `loran_session` (cookie) · `loran.prefs` (localStorage, persist **version 2**)
- `127.0.0.1:8010` (container: app + API, one origin) · `127.0.0.1:5173` (**host** Vite, proxies `/api` → 8010)
- `docker compose up -d` · image `loran:local` 175 MB · uid `10001`
- `cloudflared` 2025.9.1 · `~/.cloudflared/cert.pem` (authenticated) · `~/.cloudflared/config.yml` (**SHARED — do not edit**)
- `cloudflared-voygent.service` · `<voygent tunnel id — REDACTED, unrelated project>` (voygent-desktop tunnel id)
- `localhost:9333` (Chrome CDP for `shoot.py`, `evaljs.py`, `verify_phase1.py`, `shoot_readme.py`)
- `bash scripts/serve.sh` (bare-metal one origin) · `bash scripts/dev.sh` (**starts a SECOND API — do not run alongside the container**)
- `python3 scripts/verify_phase1.py "http://localhost:5173/?t=<owner token>"` → **8/9** (depth assertion is the harness's fault)
- `npm run check:palette` → "12 colours match src/styles/tokens.css"
- `--map-label: #9db2c4` (map labels) · `--dim: #5a6b7a` (panel chrome ONLY) · `--mil: #ff4fd8` · `--amber: #ffb000` · `--cyan: #5fd7e0`
- `/api/track?hex=a1f9e4` → **254 points / 1789 s**; buffer 71 contacts / 9825 points (backend FINE)
- projection defaults `projMinutes=5`, `projSpreadDeg=10`; presets `2/5/10 min`, `±5/10/25°`
- `10,802` place markers (5,275 airfields incl. 627 military; 5,527 cities); `places.json` 631 KB
- FPS on real hardware: **27** @ 89 contacts (pre-places) → **22** @ 77 (with places), WebGL2
- CORS: airplanes.live / adsbdb / GEBCO / NEXRAD `ACAO: *`; planespotters **403** (UA is a forbidden header)
- `POISONED_HEX = {000000, 000001, FFFFFD, FFFFFE, FFFFFF}` (`backend/app/feeds/planespotters.py`)
- Docker traps: `.env` excluded by `.dockerignore`; `LORAN_STATIC_DIR` must stay **commented out** in `.env.example` or `/` 404s
- `30.6944, -88.0399` (home: Mobile, AL) · `dbFlags`: `1`=military, `4`=PIA, `8`=LADD

## Instructions
Resume this work. **First, re-create the TodoWrite list** from the `## Checklist`
section above (one TodoWrite entry per `- [ ]` unchecked item; mark `- [x]` items
done or omit them) — if `docs/summaries/CHECKLIST.md` exists and is newer, prefer
it. **This handoff documents an EXISTING worktree** — `cd
/home/neil/dev/adsb-viz-phase2-dossier` and resume on branch `main`; do NOT create
a new branch. Then run `git status` / `git branch --show-current` to confirm state
matches this handoff (warn on any mismatch). **Evaluate each "Stale if" condition
in the header**: if any holds, say which, treat the claims it covers as stale, and
re-verify against the live artifact before acting.

Present the rebuilt checklist + Remaining Work and ask whether to continue or do
something else. **Suggested order: the track bug first** (owner-visible, already
half-diagnosed, and the backend is ruled out), then the destination line, then
remote access once the owner names a hostname. Note the previous session's own
warning: it moved faster than it verified near the end, so **re-check D-048's
layout on the owner's real display** before building on it.
