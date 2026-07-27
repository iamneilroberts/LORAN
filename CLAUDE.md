# LORAN — 3D ADS-B + AIS Globe Console

Self-hosted, single-user, browser-based 3D globe fusing live aircraft (ADS-B) and vessel (AIS)
traffic, with a scrubbable recording archive. Runs on a homelab. No auth, no multi-user.

Design intent: **mission control terminal**, not consumer flight tracker.

Home location: **Mobile, AL (30.6944 N, −88.0399 W)** — default view, but must be configurable
and location-aware, not hardcoded to one place.

---

## Ground rules — these override convenience

1. **Never use mock, sample, or synthesized data to make a screen look finished.**
   If a feed is down, rate-limited, or returns nothing: render an explicit empty/offline state
   and say so. An honest blank panel beats a plausible fake one. This applies to placeholder
   images, invented registrations, filler vessel names — all of it.
2. **Ask before adding any dependency** not in the stack below.
3. **Unknown field values render as an em-dash (—), never as invented data.**
4. Append a dated entry to `docs/decisions.md` for every non-obvious call.
5. Commit at the end of each phase with a real message. No secrets in git; use `.env` +
   `.env.example`.
6. **Prefer boring, legible code over cleverness.** The owner is a DBA, not a frontend dev,
   and needs to read this in six months.
7. Complete a phase, show it running, commit, **then stop and wait** before starting the next.

---

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Build | Vite | |
| UI | React 18 + TypeScript | |
| Globe | **CesiumJS** | Not negotiable — see below |
| State | Zustand | |
| Styling | Tailwind **for layout only** | Visual identity lives in a hand-written CSS token file, not utility soup |
| Backend | Python 3.12 + FastAPI + httpx | |
| Storage | SQLite (WAL) | Schema must port to Postgres/TimescaleDB without a rewrite |
| Packaging | Docker Compose + bare-metal dev path | |

**Why Cesium specifically:** true altitude-above-ellipsoid positioning, bathymetric terrain,
and translucent volumes at real altitudes. Do **not** substitute globe.gl or deck.gl.

**Backend exists to:** (a) proxy/normalize upstream feeds so the browser isn't hitting six APIs
directly, (b) enforce rate limits and cache, (c) run the recorder.

**Storage constraints:** no SQLite-specific types, explicit indexes, timestamps as UTC epoch
integers. DDL gets reviewed before the writer is written.

Local toolchain verified 2026-07-25: Node v22.12.0, Python 3.12.3, curl, jq.

---

## Data sources

Full detail, raw response shapes, and verdicts: **`docs/data-sources.md`**.

| Feed | Role | Auth | Limit | Terms |
|---|---|---|---|---|
| airplanes.live | ADS-B primary | none | 1 req/sec | Non-commercial, no SLA |
| adsb.lol | ADS-B fallback | none | dynamic | ODbL 1.0 |
| adsb.fi | ADS-B 2nd reserve | none | undocumented | non-commercial (unverified) |
| adsbdb | reg/type/operator/route | none | undocumented | open |
| planespotters | dossier photo | none, **UA must carry contact** | undocumented | attribution mandatory |
| aisstream.io | AIS — **REJECTED, zero coverage at Mobile** | free key | 1 sub/sec | BETA, no SLA |
| own RTL-SDR receiver | AIS — **recommended path** | none | none | none |
| Esri World Imagery | satellite basemap | none | — | attribution required |
| Esri World Ocean Base | ocean basemap | none | — | attribution required |
| GEBCO WMS | bathymetry + depth readout | none | — | attribution required |
| NOAA NCEI DEM | depth cross-check | none | — | US public domain |
| OurAirports | airfield markers, **build time only** | none | — | public domain |
| Natural Earth | city labels, **build time only** | none | — | public domain |
| NEXRAD via Iowa State Mesonet | weather radar, **off by default** | none | — | US public domain, credit IEM |
| Nominatim (OSM) | address → home position, **proxied** | none, **UA must identify the app** | **1 req/s absolute, per app** | ODbL, attribution mandatory |
| OpenSky | **REJECTED** | — | 400 credits/day anon | — |
| Cesium ion | **NOT REQUIRED** | — | — | — |

### Non-negotiable integration details

- **All three ADS-B feeds share the readsb/tar1090 schema** → one normalizer, cheap failover.
  Envelope differs: airplanes.live and adsb.lol use `{"ac":[…]}`, adsb.fi uses `{"aircraft":[…]}`.
  adsb.lol omits `desc`/`ownOp`/`year` — fill from adsbdb.
- **Units:** readsb feeds are **feet and knots**. OpenSky is metres and m/s. Don't mix.
- Use `alt_geom` (WGS84) for Cesium height; fall back to `alt_baro`. `alt_baro` can be the
  **string `"ground"`** — handle it. Negative values are legitimate.
- `dbFlags` is a bitfield: `1` = military, `8` = LADD.
- `seen_pos` (seconds since fix) observed up to ~50 s. Age out or dead-reckon honestly.
- **planespotters returns HTTP 403 unless the User-Agent contains a contact URL or email.**
  A photo miss returns `{"photos":[]}`, not a 404 — render an honest no-photo state.
- **Attribution must be displayed** for Esri, GEBCO, planespotters photos, and OpenStreetMap.
- **Nominatim forbids auto-complete outright and bans for it.** Address entry is submit-triggered
  only — never `onChange`, never debounced. Its endpoint is an env var because the policy requires
  switching providers without a software update. Address lookup is live only when
  `LORAN_USER_AGENT` carries a real contact: they answer **403 to placeholder domains**. See D-069.
- **`adsb.py` and `upstream.ts` normalize the same records and must not drift.** A shared fixture
  (`fixtures/adsb/`) is asserted by both pytest and vitest. If one goes red, the question is which
  implementation is wrong — not how to refresh the fixture. See D-071.
- Cesium runs keyless: `Ion.defaultAccessToken = null` + `EllipsoidTerrainProvider`.

---

## Phases

Sequential. Stop and wait for sign-off after each.

- **Phase 0 — Recon.** ✅ Complete. `docs/data-sources.md`. No app code.
- **Phase 1 — Globe + live aircraft.** ✅ Complete, with one debt: **viewport-scoped fetch was
  never built** — the radius is a preset (D-055), not derived from the camera. Dark bathymetric
  basemap, aircraft at true altitude, heading-rotated, coloured by altitude band, client-side dead
  reckoning, cursor lat/lon/depth readout.
- **Phase 2 — Selection + dossier.** ✅ Complete. Right-hand panel, adsbdb + photo enrichment,
  track path / clear track / export GeoJSON.
- **Phase 3 — Altitude shells.** ✅ Complete. **Datum plane pinned to the selected aircraft's
  altitude** is the primary instrument; fixed airspace bands are secondary context. Relative
  colouring (amber within ±1000 ft) + drop-lines to the datum + numeric pair readout. Design:
  `docs/design-altitude.md`.
- **Phase 4 — Vessels.** ⛔ **DEFERRED — blocked on a data source, not on code.** aisstream.io
  measured **zero coverage** at Mobile (`docs/data-sources.md` §5.1a). Recommended remedy is a
  self-hosted RTL-SDR AIS receiver feeding local NMEA. Nothing else in the project depends on this.
- **Phase 5 — Archive.** SQLite recorder, retention policy, scrubber, unmistakable live/replay
  distinction. Query plan reviewed before build.
- **Phase 6 — Chrome.** 🔶 Partly built ahead of order, because remote access needed it: status
  bar, feed chips, camera cluster and layer toggles all ship. **Compass and FPS readout do not.**

~~Default altitude bands need a third stratum.~~ Retired by D-010 — the datum plane works at any
altitude, so the two spec'd bands stand. See `docs/design-altitude.md`.

**Photo handling is the one exception to "the backend proxies upstream feeds":** planespotters
terms forbid downloading, storing, re-hosting or rewriting image binaries. Backend caches the JSON
(≤24 h) with a contact-carrying UA; the browser loads images directly from their CDN. See D-009.

---

## Visual direction

See `docs/visual-reference.md` for the annotated reference image.

- Near-black background (`#05070a`-ish)
- Warm amber `#ffb000` — alerts, warnings, **military contacts**
- Cool cyan `#5fd7e0` — civil / nominal data
- Monospace throughout (JetBrains Mono or IBM Plex Mono)
- Uppercase, letterspaced labels at small sizes
- Panels: 1px borders, bracket corners, translucent over the globe, **never opaque cards**
- Numeric values right-aligned against left-aligned labels
- No rounded corners beyond 2px. No drop shadows. No gradients except in the globe itself.

**Restraint over decoration. The globe is the subject; the chrome is instrumentation around it.**

---

## Explicit non-goals

No accounts. No multi-user. ~~No mobile layout.~~ No satellites. ~~No weather.~~ No AI summarization.
No alerting engine. If you find yourself building one of these — **stop and ask.**

**Weather is no longer a non-goal, narrowly.** The owner asked for NEXRAD radar on 2026-07-25;
it ships as a single translucent imagery layer, **off by default**, behind the `WEATHER RADAR`
toggle (D-040). That is the whole of the reversal — no forecasts, no alerting, no
lightning, no soundings. Do not read it as a licence to build a weather feature.

**"No accounts / no multi-user" is narrowly reversed too** (D-041, 2026-07-25). There is now a
shared-secret door — `LORAN_ACCESS_TOKENS`, one token per person, traded for a signed
`HttpOnly` cookie — so the owner can share a link with one trusted family member. It is **off
unless tokens are configured**, so the default install is still exactly the single-user,
unauthenticated console described above. Still no accounts, no roles beyond owner-or-not, no
audit log, no per-user data. Preferences persist per browser in `localStorage`, not server-side.
Runbook: `docs/remote-access.md`. Do not grow this into a user system without asking.

**"No mobile layout" is reversed, and less narrowly than the other two** (D-072, D-076). The
phone gets TWO surfaces: a `#m` glance list — no globe, no WebGL — and the console itself,
reflowed. `#map` is the console; no hash routes by viewport width, because the token links are
shared and a URL has to be right on a device nobody here has seen.

This one was gated on a measurement and the measurement came back green: **30–37 FPS on a real
iPhone** with ~150 contacts, where cutting GPU fragment work 9.2x bought only 7 FPS. The phone is
not fill-rate bound, so **keep the desktop defaults on mobile** — no resolution downscale, no
dead-reckoning throttle. `#probe` is the instrument that measured it and is still there.

Do NOT read this as "make everything responsive". The desktop console remains the product; the
phone gets a deliberately different composition, not a shrunken copy. See `docs/quickstart.md`.

Note the recorded terms departure: `LORAN_PHOTO_GUEST_ACCESS` defaults to **false** because
planespotters clause 8 forbids re-exposing their API. **Keep that default** — this owner
overrides it in their own `.env`, which is their call for their deployment, not this repo's.
