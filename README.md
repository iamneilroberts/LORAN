# LORAN

A self-hosted 3D globe console for live air traffic, built to be read like an instrument rather
than browsed like a website. Aircraft sit at their **true altitude above the ellipsoid** over a
dark bathymetric basemap, and everything on screen is either measured or explicitly marked
unknown.

Named for [LORAN](https://en.wikipedia.org/wiki/LORAN), the long-range navigation system used by
both ships and aircraft — because vessels are on the roadmap.

Design intent: **mission-control terminal, not consumer flight tracker.**

![The globe with live traffic, airfields and city labels](docs/screenshots/01-globe.png)

---

## What it looks like

Selecting a contact opens a dossier and pins an **altitude slice** at that aircraft's flight
level, with a drop line to the surface. Registration, type, model, operator and route come from
adsbdb; the photo comes from planespotters with mandatory credit. Anything nobody knows renders
as an em-dash, never as a guess.

![Selected contact: dossier, altitude slice and drop line](docs/screenshots/02-dossier.png)

Airfields are clickable, and the panel states the limits of what it knows — military
classification is a heuristic on the field's *name*, so it says so rather than implying an
authority it does not have.

![Airfield detail panel for a naval air station](docs/screenshots/04-airfield.png)

NEXRAD weather radar is available as an optional translucent layer, **off by default** because
its green→yellow→red ramp competes with the altitude colour ramp.

![NEXRAD weather radar overlaid on the globe](docs/screenshots/03-radar.png)

All four are unretouched captures of live data, taken by `scripts/shoot_readme.py`.

### On a phone

The same link routes by viewport width, so a phone lands on the **glance list**: what is up, how
much of it is military, whether the feed is alive, and the twelve nearest contacts.

![Glance list on a phone: contact and military counts, feed state, nearest contacts](docs/screenshots/mobile-list.jpeg)

Tapping a row opens the map focused on that aircraft — the full 3D globe, not a cut-down map.
Here with **vertical exaggeration at 5x**, which stretches altitude so separation is readable at
a glance; the amber banner says the geometry is not true scale while it is on, and every number
stays true.

![Map on a phone with a selected contact, projection envelope and the NOT TRUE SCALE banner](docs/screenshots/mobile-map-vertical-5x.jpeg)

The dossier opens as a sheet: airframe, operator, filed route, and controls to FOLLOW the contact
with the camera or draw and export its recorded track.

![Contact detail sheet on a phone with FOLLOW, TRACK, CLEAR and EXPORT](docs/screenshots/mobile-detail.png)

Getting started as a viewer: [`docs/quickstart.md`](docs/quickstart.md).

---

## Ground rules

These are the rules the code is actually written to, and they are the reason to prefer this over
something prettier:

1. **Never mock, sample or synthesise data to make a screen look finished.** If a feed is down,
   rate-limited or empty, the UI says so. An honest blank panel beats a plausible fake one.
2. **Unknown values render as an em-dash (—)**, never as invented data.
3. **Stale is shown as stale.** Dead reckoning between polls is capped, and a contact that can no
   longer be honestly placed is dimmed rather than smoothed over.
4. **Claims name their own limits.** Observed peaks are labelled `MAX ALT OBS`, not "service
   ceiling". The track buffer reports the window it *actually* holds. A withheld photo is
   distinguishable from a nonexistent one.
5. **Every non-obvious decision is written down** in [`docs/decisions.md`](docs/decisions.md)
   (D-001 … D-043), including the ones that turned out to be wrong.

## Single-user and unauthenticated by design

This is a homelab console for one person. That is not laziness — it is what keeps the project
inside the non-commercial terms of the volunteer ADS-B feeds and planespotters' API terms. There
are no accounts, no roles, no multi-tenancy, and no per-user data.

There is one narrow exception: an optional **shared-secret door** (`LORAN_ACCESS_TOKENS`) so the
owner can share a link with one trusted person. It is off unless you configure tokens. See
[`docs/remote-access.md`](docs/remote-access.md).

---

## Stack

| Layer | Choice |
|---|---|
| Globe | **CesiumJS**, fully keyless — no ion token, `EllipsoidTerrainProvider` |
| UI | React 18 + TypeScript, Vite |
| State | Zustand |
| Styling | Tailwind for layout only; visual identity lives in a hand-written CSS token file |
| Backend | Python 3.12 + FastAPI + httpx |
| Storage | SQLite (WAL) — schema must port to Postgres/TimescaleDB without a rewrite |

Cesium specifically, and not globe.gl or deck.gl: true altitude-above-ellipsoid positioning,
bathymetric terrain, and translucent volumes at real altitudes.

## Quick start

Requires Node 22+, Python 3.12+.

```
cp .env.example .env
```

Set `LORAN_USER_AGENT` to something containing a **real** contact address. planespotters returns
HTTP 403 without one, and the ADS-B feeds are volunteer-funded and deserve to know who is
calling. Set `LORAN_HOME_LAT` / `LORAN_HOME_LON` to where you actually are — nothing is
hardcoded to one location.

Development, with hot reload:

```
bash scripts/dev.sh
```

That starts the API on `:8010` and Vite on `:5173`; open http://localhost:5173. Use
`bash scripts/dev.sh status` / `stop` to inspect or stop it. It resolves paths relative to
itself, so it works from any checkout or git worktree.

Production, bare metal — one process serving both the built app and the API on one origin:

```
bash scripts/serve.sh
```

Production, Docker — the same single-origin arrangement, 175 MB image:

```
docker compose up --build
```

Then open http://127.0.0.1:8010. Configuration reaches the container at **run** time via
`env_file`; `.dockerignore` excludes `.env` from the build context, so no secret can end up in an
image layer.

> **The frontend is BAKED INTO THE IMAGE — `--build` is not optional after a UI change.**
> There is no bind mount for the built app: `Dockerfile` copies `frontend/dist/` into
> `/app/static` at build time. So a container started with plain `docker compose up -d` keeps
> serving whatever bundle its image was built with, however many times you edit `frontend/src`.
> The Vite dev server on `:5173` and the container on `:8010` are **two different builds of the
> app**, and a tunnel or reverse proxy points at the container. This is easy to miss for hours:
> the dev server shows your change, the served site does not. After any frontend change, rebuild:
>
> ```
> docker compose up --build -d
> ```
>
> To confirm which bundle is actually being served — and that it matches what you just built —
> compare the hashed asset name at both ends:
>
> ```
> curl -s http://127.0.0.1:8010/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js'; ls -1 frontend/dist/assets/*.js
> ```

The container publishes to `127.0.0.1` only and runs unprivileged — put a tunnel or reverse
proxy in front rather than binding it to `0.0.0.0`.

By hand, if you prefer:

```
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd frontend && npm install && npm run build
```

`npm run dev` and `npm run build` both run `npm run cesium:assets` first, which copies Cesium's
`Workers/Assets/Widgets/ThirdParty` out of `node_modules`. Those are build artefacts, not in git,
and a fresh clone regenerates them.

Optional, regenerates the vendored airfield and city markers from upstream:

```
python3 scripts/build_places.py --refresh
```

## Data sources

Full terms review, raw response shapes and verdicts: [`docs/data-sources.md`](docs/data-sources.md).

| Feed | Role | Auth | Terms |
|---|---|---|---|
| airplanes.live | ADS-B primary | none | **non-commercial**, 1 req/sec |
| adsb.lol | ADS-B fallback | none | ODbL 1.0 (share-alike) |
| adsb.fi | ADS-B reserve | none | non-commercial |
| adsbdb | registration / type / operator / route | none | open |
| planespotters | dossier photo | none, **UA must carry a contact** | attribution mandatory; API must not be re-exposed |
| GEBCO WMS | bathymetry + depth readout | none | attribution required |
| OurAirports | airfield markers (build time) | none | public domain |
| Natural Earth | city labels (build time) | none | public domain |
| NEXRAD via Iowa State Mesonet | weather radar, off by default | none | US public domain, credit IEM |

The backend proxies and normalises feeds, enforces rate limits and caches — so the browser is not
hitting six APIs, and one upstream call serves every open tab.

**Photos are the one deliberate exception.** planespotters' terms forbid downloading, storing or
re-hosting image binaries, so the backend caches only their JSON and the browser loads images
straight from their CDN. Photographer credit is always displayed.

## Status

Works today:

- Keyless Cesium globe, tilted 3D perspective, dark GEBCO bathymetry remapped per-pixel in-browser
- Live aircraft at true altitude as type-mapped planform silhouettes, heading rotated in
  **screen space** so a tilted camera does not make level flight look like a climb
- Altitude encoded as an icon hue ramp with a legend generated from the same function the icons
  use, so the key cannot drift from the display. Military contacts in magenta
- Selection dossier: adsbdb enrichment, planespotters photo, observed peaks, track path, GeoJSON
  export that carries its own real coverage
- **ALTITUDE SLICE** pinned to the selected contact's flight level, suppressed automatically when
  the camera angle cannot convey it, plus co-altitude highlighting and a drop line
- 10,802 vendored place markers (large/medium airfields, military fields in magenta, cities),
  thinned by zoom, clickable
- Optional NEXRAD radar, self-refreshing while visible so a stale frame is never left on screen
- Optional token access for remote viewing, with preferences persisted per browser
- State and county boundaries, four dark themes, and a per-browser home you can set by typing
  coordinates, using browser geolocation, or **typing an address** — the last one via a proxied,
  submit-only geocoder whose ambiguous results you pick from rather than having one chosen for you
- **A single-file build.** `npm run build:single` emits one ~11 MB `loran.html` that runs from
  `file://` with no server at all, talking to the feeds browser-direct. Photos, address lookup and
  the small-airfield tier need a backend and say so rather than failing silently
- Measured **22–27 FPS** at 77–89 contacts on the developer's hardware (WebGL2)
- **275 tests** — 165 frontend (vitest) + 110 backend (pytest) — including a shared fixture that
  holds the browser-direct normalizer and the backend one to the same contract

Not built yet:

- **Phase 4, vessels (AIS)** — blocked on hardware, not code. aisstream.io measured *zero*
  coverage at Mobile; the plan is a self-hosted RTL-SDR AIS receiver, which needs a marine-VHF
  antenna
- **Phase 5, the recording archive** — SQLite recorder, retention, scrubber
- **Phase 6** — compass and FPS readout. The rest of the chrome shipped early, because remote
  access needed it
- **Viewport-scoped fetch** — Phase 1 debt. The fetch radius is a preset you choose, not a value
  derived from where the camera is actually looking
- **CI.** The suites exist and pass; nothing runs them but a person. Three separate incidents have
  now had the same shape — green checks against an artefact nobody was serving

## Verify it

```
bash scripts/test.sh
```

165 frontend tests (vitest) and 110 backend tests (pytest). Among them, `fixtures/adsb/` holds one
set of real captured feed records and their expected normalized output, asserted by **both**
suites — so the browser-direct normalizer used by the single-file build cannot drift from the
backend's without something going red.

```
cd frontend && npx tsc --noEmit
```

The only gate that catches JSX errors, and worth running on its own.

```
python3 scripts/verify_phase1.py
```

Drives a real browser via CDP and checks nine things end to end against **live** traffic —
including that clicking a contact puts the altitude slice at exactly its altitude. Needs Chrome
on `--remote-debugging-port=9333` and the app running.

## Non-goals

No satellites. No AI summarisation. No alerting engine. No accounts beyond the single
shared-secret door described above. Weather is limited to the one radar layer.

**Mobile is no longer a non-goal** (D-072, D-076). A phone gets a glance list at `#m` — no globe,
no WebGL — and the console itself at `#map`, reflowed to one surface at a time. With no hash the
view is chosen by viewport width, so one shared link is correct on any device. Measured at 30–37
FPS on an iPhone with ~150 contacts, which is why Cesium stayed. Start here:
[`docs/quickstart.md`](docs/quickstart.md).

## Licence

[MIT](LICENSE) — for the **software**.

It grants no rights to the **data** the software fetches. Several upstreams are non-commercial
(airplanes.live, adsb.fi), share-alike (adsb.lol, ODbL 1.0), or forbid re-exposing their API
(planespotters clause 8). Those terms are summarised in [`NOTICE`](NOTICE) and reviewed in full in
[`docs/data-sources.md`](docs/data-sources.md).

Being single-user and unauthenticated is part of what keeps this inside those terms, so a fork
adding multi-user hosting or commercial use is not automatically covered and should re-check each
provider.
