# Checklist — LORAN

_Mirrored from the shared handoff. Source of truth for a resumed session._

## Checklist
- [x] Fix `check_palette.mjs` scoping — **themes are now unblocked**
- [x] Fix `altitudePlanes.ts` + `projectionCone.ts` mutate-branch colour bugs
- [x] Range selector (D-055)
- [x] Prefs pane in the left column (D-058, reverses D-056)
- [x] Traffic panel auto-collapse, filter warning survives (D-056)
- [x] Token paste field + throttle + mint helper (D-057)
- [x] Chrome font-smoothing fix; dossier scrollbar-gutter fix
- [x] Airfield names stop colliding at MAX (D-059)
- [x] Identifiers toggle (D-060)
- [x] Single-file build built, verified from `file://`, and PRESERVED as `71e3edf`
- [x] **Outbound links in the dossier** (D-061, `9dfd973`) — airplanes.live, ADSBX,
      planespotters `/hex/`, FAA registry. All URLs verified against a real contact.
      Inherited by the single-file build on rebase (same `Panels.tsx`, not a vendored copy).
      **Still unjudged on a real display:** chip wrap at 344px, border contrast, caption
- [x] **Route relabel + flag** (D-062, `24661c6`) — `Filed orig`/`Filed dest` + schedule caption;
      bearing cross-check guarded by FL180 / 60 nm / 90°; line withdrawn on disagreement.
      **MEASURED: adsbdb's route is wrong for ~4 contacts in 10** (9/21, all 193–634 nm off
      their filed great circle by independent check). Recorded in `docs/data-sources.md`.
      **Still unjudged:** amber note weight at 344px given how often it fires
- [x] **State + county lines** (D-063, `45d034d`) — 858 state rings worldwide (ON), 3,619 US
      county rings (OFF). MEASURED first: both bundled at 0.01° (+492 KiB gz) because counties
      cost about what places.json costs, so D-052's lazy path was machinery for nothing.
      **Persist is now v5 — themes take v6.** **Still unjudged:** line colours, thinning
      thresholds, FPS cost of 858 rings drawing by default
- [x] **Themes — 2 dark + 2 mid-tone** (D-066, `12ce17b`) — MIDNIGHT/CARBON dark,
      SLATE/EMBER mid-tone. Persist v6. No light theme on purpose (D-029 ramp needs a dark
      base). **Still unjudged:** whether the mid-tone pair are usable, lifted `--dim`/`--off`,
      ramp over a mid-tone globe, bathymetry re-request flicker
- [x] Label overlap FIXED properly (D-065, `b32d13d`) — screen-space declutter, not a fourth
      range tweak. **Unjudged:** priority order (KBHM survives, BIRMINGHAM drops)
- [x] Crash from D-063 fixed (D-064, `e7c7a97`) — shared Cesium Material
- [ ] **Rebase + merge `worktree-agent-a359546ffb2f19480`** — LAST. Needs D-057 renumber + the
      duplicate-normalizer decision
- [ ] Regenerate `loran.html` after the merge so it carries every fix
- [ ] **Remote access** — create the named tunnel; read the `config.yml` hazard below first
- [ ] Judge FPS on a QUIET machine — every reading this session was at load ~20 on 4 cores
- [ ] Judge: identifiers toggle clutter; `pal.dim` vs `pal.txt`; airfield names at MAX; prefs pane
- [ ] Extend tests: `adsb.py` failover/envelope, `build_places.py`
- [ ] Fix the HARNESS depth assertion in `verify_phase1.py` (8/9) — do NOT loosen it
- [ ] Viewport-scoped fetch (Phase 1 debt — fixed radius, ignores the camera)
- [ ] Add OurAirports / Natural Earth / NEXRAD to `docs/data-sources.md`
- [ ] Vessels — BLOCKED until the Nooelec SMArt v5 arrives, then the D-018 measure-first gate
- [ ] Rename working dirs + coord dir from `adsb-viz` to `loran`
- [ ] Decide what `master` (`375c226`) and `phase2-dossier` (`bb0b589`) are for
- [ ] Phase 5 — SQLite recorder; **DDL reviewed by owner BEFORE the writer**
- [ ] Phase 6 — status bar, compass, FPS readout

_Updated: 2026-07-26 — main (D-061..D-066 shipped; 111 frontend + 60 backend tests. NEXT: rebase + merge the single-file branch `71e3edf`, then regenerate loran.html)_
