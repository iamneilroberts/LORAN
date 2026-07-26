# Checklist — LORAN

_Mirrored from the shared handoff. Source of truth for a resumed session._

## Checklist
- [ ] Rebase `worktree-agent-a359546ffb2f19480` onto `main` (4 conflicting files)
- [ ] Renumber the branch's D-057 → **D-068**
- [ ] Decide the duplicate-normalizer question (owner input)
- [ ] Merge to `main`, run `bash scripts/test.sh` + `cd frontend && npx tsc --noEmit`
- [ ] Regenerate `loran.html`, verify from `file://` on real hardware
- [ ] `docker compose up --build -d` if anything frontend changed, and check the served asset hash
- [ ] Decide `docs/summaries/` — gitignore or scrub `/home/neil`
- [ ] Sweep `adsb.voygent.ai` → `loran.voygent.app` in `docs/remote-access.md`
- [ ] Update `README.md` / `CLAUDE.md` to match reality
- [ ] **Push `main`** (25 commits)
- [ ] Delete 3 stale `voygent.ai` DNS records: `adsb`, `loran`, `loran.voygent.app` (malformed)
- [ ] Make the tunnel survive a reboot — own systemd unit, **NOT** `cloudflared service install`
- [ ] Judgement pass on a real display: themes, declutter priorities, boundary colours, route note
- [ ] Judge FPS on a QUIET machine (24 FPS was a laptop; 4 FPS was the old bundle on a busy box)
- [ ] Decide `LORAN_SESSION_SECRET` (Open Question 2 — the fix is worse than the problem)
- [ ] Extend tests: `adsb.py` failover/envelope, `build_places.py`
- [ ] Fix the HARNESS depth assertion in `verify_phase1.py` (8/9) — do NOT loosen it
- [ ] Viewport-scoped fetch (Phase 1 debt — fixed radius, ignores the camera)
- [ ] Mobile: decide glance-vs-work, then Tailscale + measure on the actual phone
- [ ] Vessels — BLOCKED until the Nooelec SMArt v5 arrives, then the D-018 measure-first gate
- [ ] Rename working dirs + coord dir from `adsb-viz` to `loran`
- [ ] Decide what `master` (`375c226`) and `phase2-dossier` (`bb0b589`) are for
- [ ] Phase 5 — SQLite recorder; **DDL reviewed by owner BEFORE the writer**
- [ ] Phase 6 — status bar, compass, FPS readout

_Updated: 2026-07-26 — main (handoff pause-2026-07-26-single-file-merge-and-push.md; D-061..D-067 shipped, remote access LIVE at loran.voygent.app, 111 FE + 60 BE tests. NEXT: merge the single-file branch, clean up, push — 25 commits unpushed.)_
