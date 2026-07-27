# Checklist — LORAN

_Mirrored from the shared handoff. Source of truth for a resumed session._

## Checklist
- [x] Geocoding recon → `docs/data-sources.md` §6a — Nominatim USE, Photon/Pelias/geocode.earth rejected, Cloudflare geocoding does not exist
- [x] Decide proxied-vs-direct, and what the single-file build does instead — **proxied** (policy asks for it; per-app limit; browsers can't set UA); single-file build omits address entry, keeps D-068 lat/lon + geolocation
- [x] **OWNER GATE:** Nominatim policy requires the *developer's* deliberate informed decision (LLM clause) — approved 2026-07-26
- [x] Build address entry into `HomeChooser`; ends at the existing `setHomeOverride` — submit-only (type-ahead is ban-worthy)
- [x] Handle ambiguity explicitly — candidate list with kind + coords, never silently first-hit
- [x] New decision entry — D-069, incl. why a geocoded name is allowed where D-068 forbids one
- [x] Attribution component updated — "geocoding © OpenStreetMap contributors (ODbL)", unconditional
- [x] Rebase the single-file branch onto `main` — 3 conflicts, not 4 (Globe.tsx auto-merged)
- [x] Renumber the branch's D-057 → **D-070** across all five files (App.tsx + remote-access-howto keep D-057 — different decision)
- [x] Duplicate-normalizer decided: **shared fixture** (owner, 2026-07-26) — NOT YET BUILT
- [x] Merged (ff to `98593f7`); 138 FE + 82 BE tests, tsc clean, both builds green
- [x] Regenerated `loran.html` (11 MB, was 8.88); verified from `file://` — 34 live contacts, glyphs/boundaries/places OK, console clean. **Bathymetry still unconfirmed**: GEBCO reachable from file:// but 11-20s per tile vs 0.7s via curl
- [ ] `docker compose up --build -d` and confirm the served asset hash changed
- [x] `docs/summaries/` decided: **scrub the files** (owner, 2026-07-26) — NOT YET DONE
- [ ] Sweep `adsb.voygent.ai` → `loran.voygent.app` in `docs/remote-access.md`
- [ ] Update `CLAUDE.md` and `README.md` to match reality
- [ ] **Push `main`** (32 commits)
- [ ] Delete 3 stale `voygent.ai` DNS records: `adsb`, `loran`, `loran.voygent.app` (malformed)
- [ ] Tunnel survives reboot — own systemd unit, **NOT** `cloudflared service install`
- [ ] Judgement pass on a real display: themes, declutter priorities, boundaries, route note, Centre block
- [ ] Judge FPS on a QUIET machine
- [ ] Decide `LORAN_SESSION_SECRET` (the fix is worse than the problem)
- [ ] Extend tests: `adsb.py` failover/envelope, `build_places.py`
- [ ] Fix the HARNESS depth assertion in `verify_phase1.py` (8/9) — do NOT loosen it
- [ ] Viewport-scoped fetch (Phase 1 debt — fixed radius, ignores the camera)
- [ ] Mobile: decide glance-vs-work, then Tailscale + measure on the actual phone
- [ ] Vessels — BLOCKED until the Nooelec SMArt v5 arrives, then the D-018 measure-first gate
- [ ] Rename working dirs + coord dir from `adsb-viz` to `loran`
- [ ] Prune the merged single-file worktree (`/branch done`, delete `worktree-agent-a359546ffb2f19480`)
- [ ] Build the shared normalizer fixture (`upstream.ts` vs `adsb.py`) — owner chose this
- [ ] Scrub `/home/neil` from the two tracked handoffs in `docs/summaries/`
- [ ] Decide what `master` (`375c226`) and `phase2-dossier` (`bb0b589`) are for
- [ ] Phase 5 — SQLite recorder; **DDL reviewed by owner BEFORE the writer**
- [ ] Phase 6 — status bar, compass, FPS readout

_Updated: 2026-07-26 — main @ 98593f7 (D-069 geocoding + D-070 single-file build MERGED; 138 FE + 82 BE tests. NEXT: shared normalizer fixture, scrub docs/summaries, make docs true, push 32 commits.)_
