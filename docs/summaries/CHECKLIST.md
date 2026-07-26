# Checklist — LORAN

_Mirrored from the shared handoff. Source of truth for a resumed session._

## Checklist
- [x] Outbound links in the dossier (D-061) — also inherited by the single-file build on rebase
- [x] Route relabel + flag (D-062) — and adsbdb's error rate measured at ~40%
- [x] State + county lines (D-063) — measured first, both bundled
- [x] Themes, 2 dark + 2 mid-tone (D-066) — persist v6
- [x] Fix the crash D-063 shipped (D-064)
- [x] Label overlap fixed properly (D-065) — declutter, not a fourth range tweak
- [x] Remote-access verification + runbook written (`docs/remote-access-howto.md`)
- [x] **REMOTE ACCESS LIVE** (D-067, `924088a`) — `https://loran.voygent.app`, verified from a
      second machine: door refuses unauth, cookie carries `Secure` over real HTTPS, 50 contacts,
      ~24 FPS. Hostname moved off `adsb.voygent.ai` (Workers route + cert-scope traps)
- [ ] Delete 3 stale `voygent.ai` records pointing at deleted tunnels: `adsb`, `loran`,
      `loran.voygent.app` (malformed, from the cert-scope trap)
- [ ] Make the tunnel survive a reboot — `cloudflared-loran.service`, own config, NOT
      `cloudflared service install` (writes the shared path). Untested
- [ ] **Rebase + merge `worktree-agent-a359546ffb2f19480`** — LAST. D-057 renumber + duplicate-normalizer
- [ ] Regenerate `loran.html` after the merge
- [ ] **Push `main`** — 22 commits unpushed
- [ ] Judge on a real display: theme pair usability, declutter priorities, boundary colours,
      filed-route amber note weight, chip wrap at 344px
- [ ] Judge FPS on a QUIET machine
- [ ] Decide `LORAN_SESSION_SECRET` (see Open Questions — the fix is worse than the problem)
- [ ] Decide whether `docs/summaries/` should ship at all (2 files still carry `/home/neil`)
- [ ] Extend tests: `adsb.py` failover/envelope, `build_places.py`
- [ ] Fix the HARNESS depth assertion in `verify_phase1.py` (8/9) — do NOT loosen it
- [ ] Viewport-scoped fetch (Phase 1 debt — fixed radius, ignores the camera)
- [ ] Add OurAirports / NEXRAD to `docs/data-sources.md` (Natural Earth now done)
- [ ] Mobile: decide glance-vs-work, then Tailscale + measure on the actual phone
- [ ] Vessels — BLOCKED until the Nooelec SMArt v5 arrives, then the D-018 measure-first gate
- [ ] Rename working dirs + coord dir from `adsb-viz` to `loran`
- [ ] Decide what `master` (`375c226`) and `phase2-dossier` (`bb0b589`) are for
- [ ] Phase 5 — SQLite recorder; **DDL reviewed by owner BEFORE the writer**
- [ ] Phase 6 — status bar, compass, FPS readout

_Updated: 2026-07-26 — main (D-061..D-067; remote access LIVE at loran.voygent.app; 111 FE + 60 BE tests. NEXT: single-file rebase, then push — 25+ commits unpushed.)_
