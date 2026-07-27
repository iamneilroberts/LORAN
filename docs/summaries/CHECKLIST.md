# Checklist — LORAN

_Mirrored from the shared handoff. Source of truth for a resumed session._

## Checklist
- [x] **CI job `test`**: `bash scripts/test.sh` on Node 22 + Python 3.12 → **196 + 113**
- [x] **CI job `build`**: `docker build .` — and do NOT re-run palette/tsc/vite separately
- [x] **CI job `smoke`**: boot the image, poll `/api/health`, load `/`, **fail on any console
      error**, assert served asset hash == built hash. Must pass with zero contacts
- [x] **Stamp the image with the commit SHA** and expose it at `/api/health` — closes the
      "what is actually live?" gap that incidents 2 and 4 both circled. Do this even if the
      GHCR push is dropped
- [~] **CI job `publish`** — DROPPED by owner (D-077); the SHA stamp carried the real value and
      stands alone. Was: push the SAME image to `ghcr.io/iamneilroberts/loran`, tagged
      `sha-<short>` AND `main`, on `main` only. Needs `packages: write`; **flip the package to
      public by hand after the first push** — GHCR defaults new packages to private
- [x] Smoke job asserts the booted container reports the SHA that was just built
- [x] `loran.html` as a RELEASE ASSET — shipped in **v1.0** (2026-07-27), attached to the release
      rather than committed. Note states no photos, no address entry, no small-airfield tier,
      browser-direct with no shared cache, slow bathymetry from file://, fragile on Cesium bumps
- [x] Decide whether CI runs on push, PR, or both (there are no PRs today — everything lands
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

_Updated: 2026-07-27 — main @ 3666a8e, v1.0 tagged and released. **Air traffic is DONE for now** (owner's call). CI shipped (D-077): jobs `test` (196+113) and `build + smoke`, green on every push to main; BUILD_SHA at /api/health; scripts/deploy.sh verifies the deploy; favicon + apple-touch-icon shipped. NEXT WORK IS VESSELS/AIS, blocked on the Nooelec SMArt v5 SDR arriving, then the D-018 measure-first gate._
