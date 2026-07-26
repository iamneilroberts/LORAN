# LORAN

Self-hosted 3D globe console fusing live aircraft (ADS-B) traffic over Mobile, AL, with a
recording archive. Single user, homelab, no auth.

See `CLAUDE.md` for the stack, ground rules and data-source table; `docs/data-sources.md` for
the Phase 0 recon; `docs/decisions.md` for every non-obvious call.

## Run it

One command, from whichever checkout you want to run (worktrees included — it resolves paths
relative to itself, which is the easy thing to get wrong when several checkouts exist):

```
bash scripts/dev.sh            # start/restart both servers
bash scripts/dev.sh status     # what is listening, and from which checkout
bash scripts/dev.sh stop       # stop both
```

Or by hand. Backend first:

```
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8010
```

Then the frontend:

```
cd frontend && npm install && npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to the backend on 8010.

`npm run dev` and `npm run build` both run `npm run cesium:assets` first, which copies
CesiumJS's `Workers/Assets/Widgets/ThirdParty` out of `node_modules` into `frontend/public/cesium/`.
Those are build artefacts and are **not** in git — a fresh clone regenerates them automatically.

Copy `.env.example` to `.env` first. The only value you must set is `LORAN_USER_AGENT` — it
has to contain a real contact URL or email, because planespotters returns HTTP 403 without one
and the ADS-B feeds are volunteer-funded and deserve to know who is calling.

## What Phase 1 does

- Cesium globe, **fully keyless** (no Cesium ion token), tilted into 3D perspective
- Dark bathymetric basemap: the real GEBCO_2024 depth grid remapped to a dark ramp in-browser
- Live aircraft at **true altitude above the ellipsoid**, heading-rotated, as type-mapped
  planform silhouettes
- Altitude band planes at 18,000 and 29,000 ft, plus a **datum plane** at the selected
  aircraft's altitude (finite, ±50 NM), with drop-lines and co-altitude highlighting
- Cursor lat/lon and real GEBCO depth/elevation readout
- Client-side dead reckoning between polls, capped at 30 s — stale contacts dim rather than
  drifting on invented data
- Backend collapses all clients into one upstream call per 2 s and fails over
  airplanes.live → adsb.lol → adsb.fi

## Verify it

```
python3 scripts/verify_phase1.py
```

Drives a real browser through dispatched mouse events and checks nine things end to end,
including that clicking an aircraft puts the datum plane at exactly its altitude. Needs Chrome
on `--remote-debugging-port=9333` and both servers running.

## Not built yet

Phase 2 (dossier enrichment + track export), Phase 3 (band configuration UI), Phase 5 (archive),
Phase 6 (camera cluster, compass). **Phase 4 (vessels) is blocked** — aisstream.io measured
zero AIS coverage at Mobile; see `docs/data-sources.md` §5.1a.
