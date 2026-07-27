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
- [x] **`docker compose up --build -d`** — done 2026-07-27; served bundle is now
      `index-Ce7_mh5T.js` and carries D-074.
      **CORRECTION, and the method is the lesson.** This first read as "D-072 was never deployed",
      on the evidence that the served bundle had zero occurrences of `glance`. That test is
      worthless: the bundle is MINIFIED, so the `GlanceView` identifier is renamed away and
      `grep glance` returns 0 whether the code is there or not. Re-tested against string literals,
      which minification preserves — `No contacts in range`, `the feed is not answering` — and
      the OLD bundle contained both. **The glance view had been live since D-072.** Only D-074
      was actually missing. **Grep a minified bundle for user-visible STRINGS, never identifiers**
- [x] **D-074 filed ORIGIN leg + flashing fix** — dashed leg back to `route.origin`, mirrored
      sanity check (`checkFiledOrigin`), one `Filed route` toggle. Flashing root-caused by
      measurement: 34/35 cruising contacts changed a rebuild-key input per poll, so the
      clear-and-re-add ran every tick. Now mutates in place. 182 FE + 110 BE
- [x] **Tunnel survives reboot — DONE 2026-07-27.** `cloudflared-loran.service` is `enabled` +
      `active` (owner installed it); the hand-run foreground process is gone. The container was
      already covered by `restart: unless-stopped` + `docker.service` enabled, so no unit for it.
      Unit source kept OUT of the repo (it hardcodes an absolute home path, D-019) — it lives in
      the coordination dir. Do NOT use `cloudflared service install`: it targets the SHARED
      `~/.cloudflared/config.yml`, which belongs to the voygent-desktop tunnel
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

_Updated: 2026-07-27 — main @ `776b176`, pushed, upstream tracking set. D-074 shipped (filed-origin
leg + the flashing fix), container rebuilt and deployed, glance view verified live at 390x844,
tunnel now on systemd. Repo cleaned to a single branch: `master` and `phase2-dossier` deleted
local + remote, merged agent worktree and `singlefile-pre-rebase` tag pruned. 182 FE + 110 BE.
Retracted the "glance view was never deployed" finding — see the correction above.
NEXT: **CI** (still nothing runs the suites but a person; four incidents now), viewport-scoped
fetch, lazy-import Cesium so the phone never downloads it, owner sign-off on the glance view._
