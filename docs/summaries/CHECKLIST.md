# Checklist — LORAN

- [x] Phase 0 — recon, `docs/data-sources.md`, sign-off
- [x] Phase 1 — globe, live aircraft at true altitude, cursor depth readout
- [x] **Phase 2** — adsbdb enrichment, planespotters photo, track ring buffer, GeoJSON export,
      error boundary (D-020 … D-026)
- [x] Owner visual feedback round 1 — icon attitude (D-027), text sharpness (D-028)
- [x] Owner visual feedback round 2 — altitude hue ramp + magenta MIL (D-029), selection-only
      drop lines (D-030), traffic filters (D-031), ALTITUDE SLICE rename (D-022)
- [x] **Place markers** — airfields + city labels, vendored and built at build time (D-023, D-032)
- [x] Military airfields via a NAME heuristic, false negatives documented (D-033)
- [x] Legibility pass — large/medium airfields only, cities capped at scalerank 7 (D-037)
- [x] Airfield markers clickable with an honest detail panel (D-038)
- [x] Airfield codes cyan/magenta so they can never read as city names (D-039)
- [x] ALTITUDE SLICE suppressed without camera perspective (D-034); dossier 344px (D-036)
- [x] **verify_phase1 click check ROOT CAUSED** — the harness was clicking behind a panel, not the
      slice stealing the pick (D-035). 9/9 across three runs.
- [x] **One palette** — tokens.css is the source, `styles/palette.ts` reads it back; drift fails
      the BUILD via `npm run check:palette` (D-042)
- [x] **Remote access BUILT** — token-per-person → HMAC HttpOnly cookie, `?t=` link login with the
      token scrubbed from the URL, single-origin `scripts/serve.sh`, prefs per browser (D-041)
- [x] **Weather radar** — NEXRAD, off by default, self-refreshing while visible (D-040)
- [x] **Renamed LORAN** (D-043); MIT licence + NOTICE + README with 4 real screenshots (D-044)
- [x] **Docker** — multi-stage, 175 MB, no secret in any layer, cold-clone install VERIFIED
      against the real GitHub remote (D-045)
- [x] **Projection envelope replaces the altitude slice** (D-047) — a stated-assumption what-if,
      sloped by vertical rate; the slice now defaults off, with a persist migration so browsers
      that already stored `showDatum:true` actually lose the square
- [x] FPS measured on real hardware: 27 FPS / 89 contacts before places, 22 / 77 with places
- [x] Pushed to github.com/iamneilroberts/LORAN — `main` is the project, MIT detected

## Open — next up

- [x] Dossier squeeze fixed — Camera + Layers moved LEFT, dossier owns the right column (D-048)
- [x] Map labels no longer the water's colour — new `--map-label` token (D-048)
- [x] Origin/dest read as places: "San Jose SJC", "Denver DEN" (D-048)
- [ ] **BUG: aircraft tracks do not display.** Backend RULED OUT (`/api/track` returns 254 points
      over 1789 s; hex case is irrelevant — tested, do NOT "fix" the `toUpperCase`). The fault is
      the `track::` polyline path in `Globe.tsx`.
- [ ] **Dotted line to the known destination** — adsbdb already supplies destination lat/lon. Must
      read as the FILED destination, distinct from the projection envelope, absent when unknown.
- [ ] **Place-label density toggle** — owner says the set is too thin. D-037 dropped the extra rows
      at BUILD time, so `build_places.py` has to emit them before a runtime toggle can show them.
- [ ] **Themes / colour chooser — PROMOTED out of FUTURE by the owner**, alongside remote access.
- [ ] **Enable and verify remote access.** Built and locally verified; the only blocker is a DNS
      decision. Quick tunnels DO NOT WORK here (measured twice, 404 at Cloudflare's edge without
      reaching the origin). Use a NAMED tunnel — `cloudflared` is already authenticated
      (`~/.cloudflared/cert.pem`). Proposed hostname `adsb.voygent.ai`. See `docs/remote-access.md`.
- [ ] Fix the HARNESS depth assertion. Owner confirmed the ELEV readout works in a real browser,
      so the app is fine and `verify_phase1.py` is wrong. Do NOT loosen it — D-035 was the same
      shape of bug and turned out to be real.
- [ ] Judge the low end of the altitude ramp on a real display — deep blue over dark ocean
- [ ] Judge the projection envelope now it is live; tune the default minutes / spread

## Open — engineering

- [ ] **Unit tests. Still ZERO.** `coneGeometry()` (D-047) was written pure specifically to be one
      of the first, alongside `normalize_aircraft`, `normalize_route`, `normalize_photo`,
      `altitudeColour`, `trackToGeoJSON` and the track ring buffer. Needs a framework decision:
      neither vitest nor pytest is in the CLAUDE.md stack, so rule 2 says ask first.
- [ ] Viewport-scoped fetch — still a fixed 120 nm around home, ignores the camera (Phase 1 debt)
- [ ] Add OurAirports / Natural Earth / NEXRAD to `docs/data-sources.md` in full
- [ ] Residual label overlap where two airfields and a city coincide (Maxwell / Montgomery)
- [ ] Dossier vanishes mid-read when the contact leaves the feed payload — keep, or hold last
      known values behind an explicit LOST banner?
- [ ] Rename the working dirs + shared coordination dir from `adsb-viz` to `loran`
- [ ] Decide what `master` and `phase2-dossier` are for now that `main` is the project

## Open — phases

- [ ] Phase 3 — configurable projection / ramp thresholds UI (fixed bands are long gone)
- [ ] Phase 5 — SQLite recorder; **DDL reviewed by owner before the writer is written**
- [ ] Phase 6 — status bar polish, compass, FPS readout
- [ ] Phase 4 — vessels via RTL-SDR + AIS-catcher (D-018). **NEEDS A MARINE-VHF ANTENNA (162 MHz)**

## Open — future

- [ ] FUTURE (owner wants): **single-file build**, no server. MEASURED viable for 4 of 5 upstreams;
      photos impossible because planespotters gates on User-Agent, a forbidden header (D-046).
      Owner accepts losing photos. Remaining work is inlining Cesium's runtime assets (~15–20 MB).
- [x] ~~FUTURE: colour scheme chooser~~ — PROMOTED to the next work plan, see above. Groundwork done
      (D-042); real cost is rebuilding Cesium layers on switch, a second `DarkBathymetryProvider`
      ramp, and re-derived altitude-ramp lightness.

_Updated: 2026-07-25 — main_
