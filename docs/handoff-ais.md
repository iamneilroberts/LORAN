# Handoff — AIS vessels via position-api: test locally, continue if it works

**Status at handoff (2026-08-05):** the vessel layer is fully built and shipped on branch
`claude/marine-traffic-loran-flight-horizon-yhnvzk` (commit `4e84ddf`, D-078). It is **blocked at
runtime, not in code**: the owner's position-api instance is being **Cloudflare-blocked by
MarineTraffic**, so it returns no vessel data. LORAN correctly shows the honest "AIS offline"
state and waits.

This document is for continuing on a machine where position-api *can* reach MarineTraffic (e.g. a
plain residential connection, not a datacenter/VPN IP that Cloudflare hard-blocks). **Everything
below the "If position-api works" line is gated on that one test succeeding.** If it does not,
stop and go to "If it stays blocked".

---

## What is already done (do not rebuild)

- **Backend** `backend/app/feeds/ais.py` — proxies position-api, normalizes rows, caches,
  rate-limits (one scrape in flight ever, poll floor 60 s), derives course from a vessel's own
  fixes when the feed gives none. Wired in `backend/app/main.py`:
  - `GET /api/vessels?lat&lon` → near-me snapshot
  - `GET /api/vessel?mmsi=` → per-vessel course/fresh-fix detail
  - `GET /api/vessel-track?key=` → in-memory track buffer (6 h @ 60 s)
  - `/api/health` `.ais` block reports configured/ok honestly, never the base URL.
- **Config** `backend/app/config.py` — all `LORAN_AIS_*` vars (see `.env.example`).
- **Track store** `backend/app/feeds/track.py` — generalized (key field + window/sample/capacity
  as constructor params) and given `bearing_of()` for derived course.
- **Frontend** — `globe/vesselLayer.ts`, `globe/vesselIcons.ts`, `data/useVesselDetail.ts`,
  store vessel state + `showVessels` toggle, `api.ts` vessel methods, `App.tsx` vessel poll
  (15 s, cache-served), `Panels.tsx` `VesselPanel` dossier + sea-traffic section + AIS/SEA chips.
- **Camera hard floor** `globe/cameraFloor.ts` (D-079) — unrelated to AIS, already done.
- **Tests** — 208 frontend + 141 backend, all green. Fixture `fixtures/ais/cases.json` is
  **all-synthetic** and says so; promoting it to real captures is a task below.

Do **not** regenerate the fixture's `expected` from the normalizer, flip the unconfigured
default, or add scraping code to this repo — see `docs/decisions.md` D-078 and ground rule 1.

---

## STEP 1 — get the branch and the toolchain on the local machine

```bash
git fetch origin claude/marine-traffic-loran-flight-horizon-yhnvzk
git checkout claude/marine-traffic-loran-flight-horizon-yhnvzk
# sanity: the suite must be green before touching anything
bash scripts/test.sh        # expect 208 frontend + 141 backend passing
```

---

## STEP 2 — the gating test: does position-api actually reach MarineTraffic here?

position-api listens on **5001** under its own docker-compose (`5001:5001`; the app inside must
also listen on 5001 — set `PORT=5001` in position-api's `.env` if it defaulted to 5000).

```bash
# in the position-api checkout
docker compose up -d
docker logs -f position-api            # leave this running in a second terminal

# in another terminal — a scrape takes 20-40 s, be patient
curl -m 60 "http://localhost:5001/legacy/getVesselsNearMe/30.6944/-88.0399/40"
```

Read the result against this table:

| What you see | Meaning | Next |
|---|---|---|
| A **JSON array** of vessel objects | **WORKS.** | Go to "If position-api works". |
| `null` | Reached MT fine, but the scrape found no vessels in that box | Retry with a known-busy area first, e.g. Houston Ship Channel `.../29.75/-94.9/40`, or a wider radius. If busy areas also return `null`, treat as works-but-verify and proceed cautiously. |
| `curl: (52) Empty reply` **and** logs show a request to `.../cdn-cgi/styles/cf.errors.css`, then the startup banner repeats | **STILL BLOCKED** (Cloudflare). This is the exact failure seen at handoff. | Go to "If it stays blocked". |
| Browser/Puppeteer launch error in logs | Container/Chromium problem, not Cloudflare | Fix the container (see position-api's Dockerfile; it uses the puppeteer base image + `cap_add: SYS_ADMIN`). |

`cf.errors.css` in the logs is the definitive "Cloudflare served a block page" tell. Its absence,
plus a real JSON array, is the definitive "it works" signal.

---

## If position-api works — continue implementing

Do these in order. Each is small; commit after each so the branch stays bisectable.

### 3a. Point LORAN at it and confirm end-to-end
- In LORAN's `.env`: `LORAN_AIS_BASE_URL=http://localhost:5001` (or the host LAN IP if LORAN
  runs in Docker — `127.0.0.1` inside a container is the container).
- Restart the backend (`scripts/serve.sh` bare-metal, or `docker compose up -d` — compose reads
  `.env` at container-create time, so recreate, don't just restart).
- Verify:
  ```bash
  curl -s http://localhost:8010/api/health | jq .ais      # configured:true, then ok:true after first poll
  curl -s "http://localhost:8010/api/vessels?lat=30.6944&lon=-88.0399" | jq '.count, .vessels[0]'
  ```
- Open the console: the chip flips **AIS no source → AIS live**, a **N SEA** count appears,
  vessels render on the water, the sea-traffic panel fills with per-category counts. Click one →
  the `VesselPanel` dossier opens and the per-vessel detail lookup fills course.

### 3b. Capture REAL rows into the fixture (ground rule 1 / D-078)
The fixture is currently all-synthetic. Now that real data exists:
- Save a verbatim near-me response to `fixtures/ais/raw-position-api.json` (mirrors what
  `fixtures/adsb/` does with its three raw captures).
- Promote 2-3 real rows into `fixtures/ais/cases.json` with `synthetic: false` and a real
  `provenance` line. Run `normalize_vessel` on each and hand-check the `expected` against the raw
  row before committing — do not trust generated output blindly (that would make the pytest arm
  tautological; see `fixtures/ais/README.md`).
- Update the "every case synthetic" note in `fixtures/ais/README.md` to reflect the mix.
- `python3 -m pytest backend/tests/test_ais.py` must stay green.

### 3c. VERIFY THE SPEED UNIT — currently an *assumption*
`ais.py` treats `speed` as **knots** but this was never verified (flagged in
`docs/data-sources.md` §5.1c and the fixture README). Pick a moving vessel, open its page on
marinetraffic.com, compare the displayed speed to LORAN's dossier `Speed` value. If it disagrees
(e.g. km/h or m/s), fix the conversion in `normalize_vessel` and note it in D-078 / §5.1c. **A
wrong-but-plausible speed is exactly the ground-rule-1 failure to catch here.**

### 3d. CALIBRATE THE RADIUS UNIT
`LORAN_AIS_RADIUS` (default 40) is passed to MT's `near_me` verbatim; the unit is undocumented
(km? nm? miles?). Compare the geographic spread of returned vessels against the value and set a
sensible default; record the finding in §5.1c so it stops being an open question.

### 3e. Confirm the course paths
- Select a vessel and confirm the per-vessel detail route (`/api/vessel?mmsi=`) returns a
  `course_deg` with `course_source: "reported"`.
- Let a vessel sit through 2+ snapshots without a reported course and confirm the **derived**
  course appears (`course_source: "derived"`, dossier shows "derived · not reported", hull
  rotates). If the derive never fires, check `bearing_of` thresholds against real fix spacing
  (50 m min move, 30 min max gap) — ships in port legitimately don't move 50 m.

### 3f. Robustness pass (optional but wanted)
position-api's `/legacy/*` routes have **no error handling** and crash the process on a failed
scrape (observed at handoff). LORAN already tolerates this (empty list + `errors`, chip flips
offline), but the reconnect is smoother if position-api restarts cleanly — its compose already
has `restart: unless-stopped`, so just confirm that's active. Nothing to change in LORAN unless
you observe it serving stale data (it should never — verify once).

### 3g. Ship it
- Update `docs/decisions.md` D-078 with the verified speed unit, radius unit, and "confirmed live
  against a real instance on <date>".
- `bash scripts/test.sh` green, `npm run build` clean, commit, push the branch.

---

## If it stays blocked

Do **not** try to defeat Cloudflare from inside position-api — it's an arms race and not this
repo's code. In priority order:

1. **Check position-api's GitHub issues/commits** for "cloudflare"/"blocked" and a newer version
   or fork. If there's a fix, update the position-api checkout only — LORAN needs no change.
2. **RTL-SDR receiver** — the recommended long-term path (`docs/data-sources.md` §5.1b option 1).
   An RTL-SDR + marine-VHF antenna fed by AIS-catcher receives Mobile Bay AIS off the air: no
   scraping, no Cloudflare, no terms exposure. **LORAN is already ready for it:** the normalized
   vessel shape is source-agnostic, so a small adapter that turns local NMEA/AIS-catcher JSON into
   the same `/api/vessels` payload drops in with zero frontend changes. The whole vessel UI
   (icons, dossier, tracks, chips) works unchanged the day a receiver is online.

### The contract an alternate source must satisfy
`/api/vessels` returns `{ configured, source, count, vessels[], errors[] }`; each vessel:

```
key            string   MMSI, or "s"+ship_id — what selection/track key on
mmsi           string?  null if none broadcast
ship_id        string?
name           string?
callsign       string?
imo            string?
lat, lon       number   required; a row without both is dropped
speed_kt       number?  (verify the unit — see 3c)
course_deg     number?  null ⇒ direction-neutral ring, never an invented heading
course_source  "reported" | "derived" | null
type           string?  source's own wording, shown verbatim in the dossier
category       string   one of the vesselIcons categories → picks the glyph
country, destination, port_current, port_next, area   string?
pos_ts         number?  UTC epoch seconds
military       boolean
```

Match that shape and the frontend needs no changes. `/api/vessel` (detail) and
`/api/vessel-track` shapes are in `backend/app/main.py` and `frontend/src/state/store.ts`.

---

## Key files, at a glance

| Concern | File |
|---|---|
| AIS proxy + normalizer + cache + course-derive | `backend/app/feeds/ais.py` |
| Routes, health `.ais`, vessel track store wiring | `backend/app/main.py` |
| AIS config vars | `backend/app/config.py`, `.env.example` |
| Generalized track store + `bearing_of` | `backend/app/feeds/track.py` |
| Fixture (synthetic → promote to real) | `fixtures/ais/cases.json`, `fixtures/ais/README.md` |
| Backend tests | `backend/tests/test_ais.py` |
| Vessel rendering + `effectiveFix` | `frontend/src/globe/vesselLayer.ts` |
| Category glyphs / hull silhouettes | `frontend/src/globe/vesselIcons.ts` |
| Vessel state, poll, dossier | `frontend/src/state/store.ts`, `App.tsx`, `panels/Panels.tsx` |
| Recon, terms, open unknowns | `docs/data-sources.md` §5.1c |
| Decisions | `docs/decisions.md` D-078 (vessels), D-079 (camera floor) |
