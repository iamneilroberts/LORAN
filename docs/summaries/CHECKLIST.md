# Checklist — LORAN

_Mirrored from the shared handoff. Source of truth for a resumed session._

## Checklist
- [ ] Geocoding recon → `docs/data-sources.md` entry with a real verdict (endpoint, limit, terms, UA)
- [ ] Decide proxied-vs-direct, and what the single-file build does instead
- [ ] Build address entry into `HomeChooser`; ends at the existing `setHomeOverride`
- [ ] Handle ambiguity explicitly — candidate list or refuse, never silently first-hit
- [ ] New decision entry, including **why a geocoded name is allowed where D-068 forbids one**
- [ ] Attribution component updated if the terms require it
- [ ] Rebase the single-file branch onto `main` (4 conflicting files)
- [ ] Renumber the branch's D-057 across **all five** files
- [ ] Decide the duplicate-normalizer question (owner input)
- [ ] Merge; `bash scripts/test.sh` + `cd frontend && npx tsc --noEmit`
- [ ] Regenerate `loran.html`; verify from `file://` on real hardware
- [ ] `docker compose up --build -d` and confirm the served asset hash changed
- [ ] Decide `docs/summaries/` — gitignore or scrub
- [ ] Sweep `adsb.voygent.ai` → `loran.voygent.app` in `docs/remote-access.md`
- [ ] Update `CLAUDE.md` and `README.md` to match reality
- [ ] **Push `main`** (27 commits)
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
- [ ] Decide what `master` (`375c226`) and `phase2-dossier` (`bb0b589`) are for
- [ ] Phase 5 — SQLite recorder; **DDL reviewed by owner BEFORE the writer**
- [ ] Phase 6 — status bar, compass, FPS readout

_Updated: 2026-07-26 — main (handoff pause-2026-07-26-geocoding-merge-push.md; D-061..D-068 shipped, remote access LIVE at loran.voygent.app, 132 FE + 60 BE tests, persist v7. NEXT: geocoding feed (recon first), then the single-file merge, cleanup and push — 27 unpushed.)_
