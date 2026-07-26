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
- [ ] **Route relabel + flag** — owner chose "Relabel AND flag" (see Open Questions)
- [ ] **State + county lines**, toggled in preferences
- [ ] **Themes — 2 dark + 2 mid-tone** ("light mode doesn't have to be super light")
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

_Updated: 2026-07-26 — main (D-061 outbound links shipped at 9dfd973; next: route relabel + flag. Single-file still preserved unmerged at 71e3edf)_
