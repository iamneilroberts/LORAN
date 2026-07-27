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
- [x] **`docker compose up --build -d`** — was overdue: the served bundle `index-CTD7vabJ.js` had
      **zero** occurrences of `glance`, so D-072 had never been deployed. Rebuilt and deployed
      2026-07-27; served bundle is now `index-Ce7_mh5T.js` and carries the glance view plus D-074
- [x] **D-074 filed ORIGIN leg + flashing fix** — dashed leg back to `route.origin`, mirrored
      sanity check (`checkFiledOrigin`), one `Filed route` toggle. Flashing root-caused by
      measurement: 34/35 cruising contacts changed a rebuild-key input per poll, so the
      clear-and-re-add ran every tick. Now mutates in place. 182 FE + 110 BE
- [ ] **Tunnel systemd unit — WRITTEN, NOT INSTALLED** (needs sudo). Container already survives
      reboot (`restart: unless-stopped` + docker enabled); cloudflared does NOT — it is a bare
      foreground process. Unit drafted in the session scratchpad; **not** committed because it
      hardcodes an absolute home path (D-019). Do NOT use `cloudflared service install` — it targets the
      SHARED `~/.cloudflared/config.yml`
- [x] `docs/summaries/` decided: **scrub the files** (owner, 2026-07-26) — NOT YET DONE
- [x] Sweep `adsb.voygent.ai` → `loran.voygent.app` in `docs/remote-access.md` — clean; remaining
      hits are historical (old handoffs + `decisions.md` D-067 narrative), correct to leave
- [x] Update `CLAUDE.md` and `README.md` to match reality (`03960b2`)
- [x] **Push `main`** — `git rev-list --count origin/main..main` = **0**
- [ ] Delete 3 stale `voygent.ai` DNS records: `adsb`, `loran`, `loran.voygent.app` (malformed)
- [ ] Tunnel survives reboot — see the systemd item above (unit drafted, install pending sudo)
- [ ] Judgement pass on a real display: themes, declutter priorities, boundaries, route note, Centre block
- [ ] Judge FPS on a QUIET machine
- [ ] Decide `LORAN_SESSION_SECRET` (the fix is worse than the problem)
- [ ] Extend tests: `adsb.py` failover/envelope, `build_places.py`
- [ ] Fix the HARNESS depth assertion in `verify_phase1.py` (8/9) — do NOT loosen it
- [ ] Viewport-scoped fetch (Phase 1 debt — fixed radius, ignores the camera)
- [x] Mobile: decided — **glance** (D-072). Tailscale is REDUNDANT (D-067/D-041 already solved access)
- [x] Mobile: glance view built (`GlanceView.tsx`, reached via `#m`) — verified 390x844, zero Cesium canvases
- [ ] Mobile: owner sign-off, and measure on an ACTUAL phone (all evidence so far is emulated)
- [ ] Mobile: make Cesium a lazy import so the phone never downloads it
- [ ] Mobile OPTION A (responsive console) — **FUTURE, D-073.** Gated on: owner wants to WORK on
      a phone (not glance), AND a real-handset FPS/battery measurement. Fix the Cesium
      canvas-forces-viewport-width bug FIRST or every breakpoint is written against a lie
- [ ] Vessels — BLOCKED until the Nooelec SMArt v5 arrives, then the D-018 measure-first gate
- [ ] Rename working dirs + coord dir from `adsb-viz` to `loran`
- [ ] Prune the merged single-file worktree (`/branch done`, delete `worktree-agent-a359546ffb2f19480`)
- [x] Shared normalizer fixture built (D-071) — found and fixed **five** real divergences plus a poll-killing crash
- [x] Scrub absolute home paths from the two tracked handoffs in `docs/summaries/` (owner chose scrub over gitignore)
- [ ] **CI**: `scripts/test.sh` + `tsc --noEmit` + **`docker compose build`** on every push —
      three incidents now share the shape "verified the wrong artefact" (D-064, the stale-bundle
      day, the parity test breaking the image twice)
- [ ] **CI**: page-boot smoke check against the SERVED url, failing on any console error
- [ ] Decide what `master` (`375c226`) and `phase2-dossier` (`bb0b589`) are for — **both verified
      fully merged into `main`** (0 commits ahead each); the handoff's "phase2-dossier is not
      merged" is stale. Note `master` is checked out in `~/dev/adsb-viz`, so it cannot be deleted
      while that worktree exists
- [ ] Phase 5 — SQLite recorder; **DDL reviewed by owner BEFORE the writer**
- [ ] Phase 6 — status bar, compass, FPS readout

_Updated: 2026-07-26 — main @ `b209483` (resumed via /pickup; boxes re-verified against git, the
live site and the served bundle. 165 FE + 110 BE green, health 200, 0 unpushed. NEW FINDING: the
container was never rebuilt after D-072, so the glance view is not live. NEXT: rebuild+deploy,
prune the merged worktree, CI, viewport-scoped fetch, owner sign-off on the glance view.)_
