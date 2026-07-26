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

- [ ] **PUSH: 3 commits unpushed** (b4a887e, e307ae2, c23afb6) — origin/main still at 9441961
- [ ] **Airport NAMES under airfield codes** — implemented, UNCOMMITTED, unjudged on a real
      display. Range far/4, trailing "Airport" trimmed. Adds up to 5,275 labels: watch FPS/overlap
- [ ] **"Origin airport display is not working"** (owner 2026-07-26) — undiagnosed. Dossier ORIGIN
      renders fine, so likely the MAP; the LAYERS note says "filed route" but only the DESTINATION
      leg is drawn. A straight origin line would be misread as the flown path (that is the TRACK)

- [x] Dossier squeeze fixed — Camera + Layers moved LEFT, dossier owns the right column (D-048)
- [x] Map labels no longer the water's colour — new `--map-label` token (D-048)
- [x] Origin/dest read as places: "San Jose SJC", "Denver DEN" (D-048)
- [x] ~~BUG: aircraft tracks do not display~~ — **NOT A BUG** (D-049). The whole path was healthy;
      `TRACK` was just buried below the photo in a long dossier. Owner confirmed it draws fine.
      Caution recorded: the headless harness is ~1 FPS software GL and renders entity polylines
      non-deterministically — sound for STATE, worthless for PIXELS.
- [x] **Track loads on selection**, and re-reads every 5 s so it follows the contact instead of
      stopping where it was read (D-049). `TRACK` is now a re-read / the way to undo `CLEAR`.
- [x] **Map labels get a dark halo** — `FILL_AND_OUTLINE`, 2px `--bg` at 0.85. Recolouring alone
      could not work: a label crosses land, water, relief and radar echo (D-049). Owner: "much
      better".
- [x] **Place-label density** — `MAX_CITY_SCALERANK` 7 → 10 (cities 5,527 → 7,342; places.json
      631 → 687 KB) plus a DENSITY control (STD/MORE/MAX) that scales range, not membership.
- [x] **Dashed line to the FILED destination** (D-050) — dashed cyan @0.55 vs the solid amber
      envelope; labelled `FILED <code>`; a LEVEL run + plumb drop, never a straight line to the
      runway (that would draw a descent profile we have not computed). Nothing drawn when adsbdb
      has no coordinates. Verified live: FFT1257 -> KLAS.
- [x] **Map labels near-white** (`--map-label` #9db2c4 -> #e9edf0, D-050). The three previous
      attempts all changed LIGHTNESS while staying in the water's blue-grey hue family — same
      attempt three times. NOTE: labels are built once at globe mount, so a full page reload is
      needed to see any label change.
- [ ] **Small airports: include them?** The next density lever and a big one — **+42,698 rows**
      worldwide (2,154 within 6° of Mobile), ~8× the airport rows, ~3 MB JSON. D-037's rationale
      for excluding them still stands; reversing it is an owner call (D-049).
- [ ] **Re-measure FPS with the denser place set** on real hardware — 12,617 primitives now
      (was 10,802). Places already cost ~5 FPS before this change.
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

- [x] **Unit tests — vitest + pytest, 69 of them** (D-051). 33 frontend + 36 backend, all
      mutation-checked (broken the source, confirmed the right test catches it). `bash
      scripts/test.sh`. Found a real latitude-dependent NaN bug in `levelArc()` an hour after it
      shipped. Covers coneGeometry, levelArc, altitudeColour, trackToGeoJSON, normalize (adsb),
      normalize_route, normalize_photo, TrackStore.
- [ ] Extend coverage: `auth.py` HMAC cookie, `adsb.py` failover/envelope handling
      (`{"ac":[]}` vs `{"aircraft":[]}`), `build_places.py` filters. None are pure, so they need
      fixtures or a fake clock first.
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

_Updated: 2026-07-26 — main (handoff pause-2026-07-26-finish-board-vessels.md written; airport names uncommitted)_
