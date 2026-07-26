# Checklist

- [x] Phase 0 — recon, `docs/data-sources.md`, stop for sign-off
- [x] Phase 0 addendum — measure AIS with owner's key; verdict: zero coverage at Mobile
- [x] Correct planespotters terms from owner-supplied text; fix architecture (D-009)
- [x] Mockups — basemap G and Layout 1 chosen
- [x] Phase 1 — 3D globe, live aircraft at true altitude, bands + datum, cursor depth
- [x] Phase 1 feedback — primitive-churn fix, solid datum, camera cluster
- [x] Untrack generated Cesium assets, fix .gitignore symlink blindness (fc7fc9a)
- [x] **Phase 2** — adsbdb enrichment (reg / type / model / operator / origin / dest) + observed max alt/spd (D-020, D-021)
- [x] **Phase 2** — planespotters photo + mandatory attribution, per D-009 (+ D-024 poisoned-hex guard)
- [x] **Phase 2** — track path via backend ring buffer (D-016), draw, clear (+ D-025)
- [x] **Phase 2** — export track as GeoJSON, carrying real coverage in properties
- [x] **Phase 2** — click-empty-to-clear (already worked; verified) + React error boundary (D-026)
- [x] Aircraft icons read as diving/climbing — screen-projected track (D-027)
- [x] Text fuzzy/garbled — 3 defects: Cesium DPI, panel blur, datum label rebuild churn (D-028)
- [x] Fixed altitude bands replaced by icon hue ramp + legend; MIL now magenta (D-029, supersedes D-017)
- [x] Drop lines to the surface, selection-only (D-030)
- [x] Traffic panel operator rows click-to-filter; MIL selector (D-031)
- [x] Rename "Datum Plane" → ALTITUDE SLICE (D-022)
- [x] Layer toggles state "needs a selected contact"; camera cluster collapsible
- [x] **Map markers** — airfields + city labels, vendored and processed at build time (D-023, D-032)
- [x] Military airfields in `--mil` magenta via a name heuristic; false negatives documented (D-033)
- [x] `PLACES` layer toggle; zoom thinning via DistanceDisplayCondition; label anchors separated
- [x] **One palette** (D-042) — tokens.css is the source, `styles/palette.ts` reads it back for
      Cesium. Removed 19 hex literals across 6 files (incl. 4 tokens duplicated in placesLayer).
      Four globe-only colours became real tokens. `npm run check:palette` fails the BUILD on
      drift; proved live by making `--mil` green and seeing the globe follow.
- [x] **Remote access** — token-per-person → HMAC-signed HttpOnly cookie, `?t=` link login with
      the token scrubbed from the URL, single-origin static serving via `scripts/serve.sh`,
      Cloudflare-tunnel runbook, honest ACCESS-TOKEN-REQUIRED state, prefs sticky per browser in
      localStorage (allow-listed — no live data ever persisted). OFF unless tokens configured.
      Reverses "no accounts / no multi-user" narrowly (D-041). Verified end to end in a browser.
- [x] **Weather radar** — NEXRAD via Iowa State Mesonet, one translucent layer, OFF by default,
      `WEATHER RADAR` toggle, self-refreshing every 5 min while visible (D-040). REVERSES the
      "no weather" non-goal narrowly, on owner instruction. CLAUDE.md updated to say so.
- [x] Airfield markers CLICKABLE with an honest detail panel; military entries state the class is
      inferred from the name, not authoritative (D-038) — owner request
- [x] Airfield codes cyan/magenta, only cities dim — medium airfields had been sharing the cities'
      `--dim` token, so KMOB/KBFM read as town names (D-039) — owner request
- [x] Owner: err on the side of legibility (D-037) — large/medium airfields ONLY (heliports, small
      fields, seaplane bases excluded even when military-named), cities capped at scalerank 7.
      10,802 markers, down from 13,198.
- [x] ALTITUDE SLICE suppressed when the camera has no perspective on it (D-034) — owner request
- [x] Dossier widened to 344px with its own larger type scale (D-036) — owner request
- [x] **verify_phase1.py click check ROOT CAUSED and fixed** (D-035) — was the harness clicking a
      contact drawn behind the AIR TRAFFIC panel, NOT the slice stealing the pick. 9/9 × 3 runs.
- [x] Clicks `drillPick` so a contact behind a place label or the slice stays selectable (D-035)

## Open

- [ ] Pick a repo name to replace the placeholder "adsb-viz" before open-sourcing
- [ ] Low end of the altitude ramp: deep blue over dark blue ocean is the lowest-contrast pairing — owner to judge on a real display
- [ ] Judge the place markers on the real display now that D-037 has thinned them
- [ ] Residual label overlap where two airfields + a city sit within a few km (Maxwell / Montgomery
      Regional / Montgomery). Needs a real declutter pass; Cesium LabelCollection has none.
- [x] FPS MEASURED on the owner's real display: **27 FPS / WebGL2 / 89 contacts** before places,
      **22 FPS / WebGL2 / 77 contacts** with places on. Places cost ~5 FPS. Headless is software
      GL at 0–3 FPS and tells us nothing. If 22 gets uncomfortable, profile placesLayer first.
- [ ] Add OurAirports + Natural Earth to `docs/data-sources.md` in full (CLAUDE.md table done)
- [ ] Docker Compose AND bare-metal, both first-class (D-019) — going open source
- [ ] Cold-clone path (`git clone` + `npm install` + build) still never tested
- [ ] Viewport-scoped fetch (currently fixed 120 nm around home, ignores camera)
- [ ] Unit tests for the pure normalizers — still ZERO tests anywhere: `normalize_aircraft`,
      `normalize_route`, `normalize_photo`, `altitudeColour`, `trackToGeoJSON`, track ring buffer
- [ ] Dossier disappears mid-read when the selected contact leaves the feed payload
      (`SelectionPanel` returns null). Pre-existing; is that the behaviour we want?
- [ ] Phase 3 — configurable ALTITUDE SLICE presets / ramp thresholds UI (fixed bands are gone)
- [ ] Phase 5 — SQLite recorder; **DDL reviewed by owner before the writer is written**
- [ ] Phase 6 — status bar polish, compass, FPS (cluster + chips partly done)
- [ ] Phase 4 — vessels via self-hosted RTL-SDR + AIS-catcher (D-018). NEEDS MARINE-VHF ANTENNA (162 MHz)
- [ ] Open-source prep: licence + README stating single-user-by-design
- [ ] Remote access is BUILT (D-041) but not yet live: owner still has to mint tokens into `.env`,
      run `scripts/serve.sh`, and start `cloudflared`. See `docs/remote-access.md`.
      Owner ruled: serve photos to both people, so set `ADSBVIZ_PHOTO_GUEST_ACCESS=true` in the
      LOCAL `.env` only — the repo default stays compliant.
- [ ] FUTURE (parked, owner's call): colour scheme chooser incl. light mode. Groundwork is DONE
      (D-042 — one palette, `refreshPalette()` hook exists and is unused). Remaining real cost:
      a second ramp in `DarkBathymetryProvider` (its GEBCO remap is held in parity with
      `scripts/make_dark_bathy.py`) and re-derived lightness in the altitude hue ramp, which
      assumes a near-black ground. A dark-VARIANT chooser is much cheaper than light mode.

_Updated: 2026-07-25 — phase2-dossier_
