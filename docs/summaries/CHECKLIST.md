# Checklist — LORAN

_Mirrored from the shared handoff. Source of truth for a resumed session._

## Checklist
- [ ] **CI job `test`**: `bash scripts/test.sh` on Node 22 + Python 3.12 → **196 + 110**
- [ ] **CI job `build`**: `docker build .` — and do NOT re-run palette/tsc/vite separately
- [ ] **CI job `smoke`**: boot the image, poll `/api/health`, load `/`, **fail on any console
      error**, assert served asset hash == built hash. Must pass with zero contacts
- [ ] Decide whether CI runs on push, PR, or both (there are no PRs today — everything lands
      straight on `main`)
- [ ] Optional, from incident 5: fail a commit that adds files outside an expected set
- [ ] Viewport-scoped fetch (Phase 1 debt — radius is a preset, ignores the camera)
- [ ] Lazy-import Cesium so the phone never downloads the 6.7 MB bundle
- [ ] Mobile: FOLLOW smoothness on a fast contact — it follows poll CORRECTIONS, may nudge
- [ ] Mobile: is 10x the right top of the vertical-exaggeration ladder? (D-075 left it open)
- [ ] Bathymetry in `loran.html` from `file://` — tiles arrive but take 11-20 s each vs 0.7 s
- [ ] Delete 3 stale `voygent.ai` DNS records: `adsb`, `loran`, `loran.voygent.app` (malformed)
- [ ] Judge FPS on a QUIET machine · judgement pass on a real display
- [ ] Decide `LORAN_SESSION_SECRET` (the fix is worse than the problem)
- [ ] Extend tests: `adsb.py` failover/envelope, `build_places.py`
- [ ] Fix the HARNESS depth assertion in `verify_phase1.py` (8/9) — do NOT loosen it
- [ ] Vessels — BLOCKED until the Nooelec SMArt v5 arrives, then the D-018 measure-first gate
- [ ] Rename working dir + coord dir from `adsb-viz` to `loran`
- [ ] Phase 5 — SQLite recorder; **DDL reviewed by owner BEFORE the writer**
- [ ] Phase 6 — compass readout (FPS readout already ships, `Panels.tsx`)

---

_Updated: 2026-07-27 — main @ b7ca7d8. Scoped to CI: three jobs (test / build / smoke). KEY: `npm run build` already runs check:palette + tsc + vite build, so `docker build` subsumes them — do not duplicate. Handoff: pause-2026-07-27-ci.md._
