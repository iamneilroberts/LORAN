# Session Handoff: LORAN — D-053..D-060 shipped; links, boundaries, themes, then the single-file merge

**Date:** 2026-07-26 at 14:05
**Repo:** ~/dev/adsb-viz-phase2-dossier
**Branch:** `main`
**Worktree:** `~/dev/adsb-viz-phase2-dossier` — **RESUME HERE, do not create a new branch**
**Uncommitted changes:** no (working tree clean at `b3d7bc6`)
**Supersedes:** `pause-2026-07-26-themes-remote-access.md` — its theme plan and remote-access runbook
are still the reference; everything it listed as "do this first" is now DONE.
**Transcript:** (current session)

**Stale if:**
- `main` moves past **`b3d7bc6`**
- `bash scripts/test.sh` does not report **61 frontend + 60 backend** passing
- Branch `worktree-agent-a359546ffb2f19480` is no longer at **`71e3edf`**, or has been merged
- A `loran` tunnel appears in `cloudflared tunnel list` — then remote access was started
- `docker ps --filter name=loran` is not healthy on `127.0.0.1:8010`

---

## What Was Accomplished

**Ten commits, all on `main`, working tree clean.** Tests went **69 → 121** (61 frontend + 60 backend).

| SHA | What |
|---|---|
| `8bbc38c` | D-053 — palette guard scoped to `:root` + validates theme blocks; two upsert reuse paths now repaint |
| `cf08b75` | D-054 — left column gets one height budget instead of two opposing stacks |
| `dbd3514` | D-055 — range selector (60/120/180/250 nm), persist v3 |
| `d80195b` | D-056 — LAYERS into a prefs overlay; traffic panel auto-collapse |
| `6c2c652` | D-057 — token paste field, POST endpoint, throttle, mint helper; **`auth.py` 0 → 24 tests** |
| `db4d1ce` | Chrome font-smoothing fix (no D-number) |
| `4bfe017` | D-058 — prefs becomes a docked collapsing pane (**reverses D-056**); D-059 — airfield names stop scaling with DENSITY |
| `b01c73c` | `scrollbar-gutter: stable` — dossier stopped shifting on redraw (no D-number) |
| `b3d7bc6` | D-060 — toggle to label every contact, subordinate colouring |

**Separately, on its own branch (NOT merged):** `71e3edf` on `worktree-agent-a359546ffb2f19480`
— the single-file self-contained build. It was sitting UNCOMMITTED in a temporary agent worktree
and was committed purely to preserve it. 1,008 lines.

---

## Decisions Made

- **The palette guard trap was real and is fixed.** `check_palette.mjs` scraped tokens with a
  whole-file regex despite claiming `:root`; `Map.set` overwrites, so the last block won. Now
  brace-matched to the single default `:root`, and it validates that every `:root[data-theme=…]`
  block defines every colour `palette.ts` reads and invents no names. **Themes are now unblocked.**
- **D-058 reverses D-056.** The prefs overlay was wrong — hard-to-find, low-contrast trigger, and a
  modal is the wrong mode for a nudge-and-glance control. D-056 stays in the record.
- **D-046 was WRONG and is corrected in `71e3edf`.** Measured with `Origin: null`: airplanes.live
  and adsbdb send `access-control-allow-origin: *`; **adsb.lol and adsb.fi send NO CORS header at
  all**. The single-file build has **no feed failover** — lost, not degraded.
- **Chrome text**: `-webkit-font-smoothing: antialiased` was Chrome-only and thinned all small text.
  Removed. It also silently defeated D-028, which removed `backdrop-filter` to *preserve* subpixel AA.
- **Labels stay `flight || hex`** — never an invented callsign, and hex-only contacts are not hidden.
- **Toggle-only labels are dim**; military/selected/co-altitude keep their prominence, or the D-029
  colour coding drowns in ~112 near-white labels.

---

## Files Created or Modified

| File | Action | Why |
|------|--------|-----|
| `scripts/check_palette.mjs` | modified | `:root`-scoped scrape + theme-block validation (D-053) |
| `frontend/src/globe/altitudePlanes.ts` | modified | mutate branch now reapplies material/outline/label colour |
| `frontend/src/globe/projectionCone.ts` | modified | mutate branch now reapplies label `fillColor` |
| `frontend/src/globe/placesLayer.ts` | modified | `airfieldRanges()`; names pinned, not density-scaled (D-059) |
| `frontend/src/globe/aircraftLayer.ts` | modified | `labelDecision()` pure fn + subordinate colour role (D-060) |
| `frontend/src/globe/Globe.tsx` | modified | threads `showAllLabels` into the per-frame update |
| `frontend/src/panels/PreferencesPanel.tsx` | created | docked collapsing prefs pane (D-058) |
| `frontend/src/panels/trafficCollapse.ts` | created | pure collapse decision + timing constants |
| `frontend/src/panels/Panels.tsx` | modified | range presets, identifiers toggle, traffic collapse, PREFS button removed |
| `frontend/src/App.tsx` | modified | left column single budget; `LockedPanel` with token paste field |
| `frontend/src/state/store.ts` | modified | `radiusNm`, `showAllLabels`, `migratePrefs`, **persist v4** |
| `frontend/src/styles/tokens.css` | modified | font-smoothing removed; `scrollbar-gutter: stable` |
| `backend/app/main.py` | modified | `POST /api/session`, `_issue_session()` shared cookie helper, throttle |
| `backend/app/auth.py` | modified | `FailureThrottle` |
| `backend/app/config.py` | modified | `SESSION_FAIL_LIMIT`, `SESSION_FAIL_WINDOW_S` |
| `scripts/mint-link.sh` | created | prints ready-to-use `?t=` links, stdout only |
| `backend/tests/test_session.py` | created | 24 tests — `auth.py` had ZERO before |
| `frontend/src/{state/store,globe/placesLayer,globe/aircraftLayer,panels/trafficCollapse}.test.ts` | created/modified | 61 frontend tests total |
| `docs/decisions.md` | modified | D-053 … D-060 appended |

---

## Git State

```
(working tree clean)
main == b3d7bc6
worktree-agent-a359546ffb2f19480 == 71e3edf  (UNMERGED, based at 2408885)
```

---

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
- [ ] **Outbound links in the dossier** — planespotters page, airplanes.live/ADSBX globe, FAA registry.
      **OWNER REQUIREMENT: these MUST also land in the single-file build**, where photos are
      impossible — the link is the honest substitute for the missing photo
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

---

## Self-Critique

- **Least confident:**
  1. **The `scrollbar-gutter` fix (`b01c73c`) was never reproduced.** The mechanism is certain from
     the code and matches the symptom exactly, but nobody watched it flicker or stop flickering.
  2. **The prefs pane's click-cannot-collapse property was reasoned, not tested.** Chrome DevTools
     would not connect in the agent's sandbox. The reasoning is sound and TrafficPanel has shipped
     the same mechanism since D-056, but it is an argument, not an observation.
  3. **Nothing shipped this session was judged on the owner's display except** the Chrome text fix
     and the single-file build. Identifiers, airfield names at MAX, the prefs pane — all unjudged.
  4. **The single-file build's GEBCO basemap has never been seen painting by anyone.** The agent's
     browser ran SwiftShader at ~13 frames in two minutes, so the globe never requested imagery.
     The owner opened the file and said it "seems to work fine", but did not confirm bathymetry.
- **Biggest thing being missed:** **there is still no CI.** Ten commits, 121 tests, all run by hand.
  The palette guard is in `npm run build`; the suites are not. Worse — **`vitest` passing proves
  nothing about `Panels.tsx` or `aircraftLayer.ts`**, because no test imports them. A JSX syntax
  error in either passes the suite and is caught only by `tsc --noEmit`. That happened twice today.
- **If it breaks in 3 months:** the **single-file build**, via a Cesium upgrade. It patches Cesium
  internals by exact string match. Those patches throw on mismatch (deliberately), so it fails loudly
  — but it *will* fail. Second most likely: **`upstream.ts` drifting from `adsb.py`**, since the same
  normalization now exists in two languages with nothing keeping them honest.
- **Did NOT do:** outbound links; route relabel/flag; boundaries; themes; the single-file merge;
  the tunnel; any FPS measurement on a quiet machine; a frontend test for the token paste field
  (needs jsdom + testing-library — new deps, rule 2 says ask first).
- **How to check:**
  - Scrollbar fix: select a contact, watch the right-aligned values while CO-ALT ticks. No horizontal jump.
  - Prefs collapse: open the pane, click toggles slowly for >8 s. It must not collapse.
  - GEBCO in the single file: open `file://$HOME/loran-single.html` on real hardware, look for bathymetry, not a black sphere.
  - Normalizer drift: diff `frontend/src/data/upstream.ts` against `backend/app/feeds/adsb.py` for `dbFlags` bits and the `alt_baro: "ground"` case.
  - Suites: `bash scripts/test.sh` → 61 + 60. **And always `cd frontend && npx tsc --noEmit`.**
  - Cookie over HTTPS: `curl -sS -D - -o /dev/null 'https://adsb.voygent.ai/api/session?t=<token>' | grep -i set-cookie` → needs **both** `Secure` and `HttpOnly`.

---

## Remaining Work

**1. Dossier outbound links.** Add links for a selected aircraft. Verified reachable to a bot:
`globe.airplanes.live/?icao=<hex>` and `globe.adsbexchange.com/?icao=<hex>` (both 200).
Returned 403 **to curl only** — almost certainly UA/bot filtering, NOT broken; needs browser
confirmation: FlightRadar24, JetPhotos, FAA registry, planespotters search.
Rules: only render a link when its identifier exists (em-dash otherwise); add `rel="noreferrer"`
(the existing photo link has only `noopener`, so the console's hostname leaks once the tunnel is
live). **The planespotters page link already exists** at `Panels.tsx` in the photo credit.
**OWNER REQUIREMENT: these must also work in the single-file build**, where photos cannot load —
a link to the planespotters page is the honest substitute for the absent photo.

**2. Route relabel + flag.** Owner picked "Relabel AND flag". Rename dossier rows to say the data is
a schedule lookup (`FILED ORIG/DEST · adsbdb · not live`), AND cross-check the filed destination's
bearing against observed track; on gross disagreement mark it and suppress the dashed line. Guard
with altitude + range so departure vectors and approaches do not false-positive. Worked example:
DAL9975 filed AMS→MSP while flying ATL→MSY — 127.7° off track at 31,975 ft cruise.

**3. State + county lines.** `scripts/build_places.py` already fetches Natural Earth at build time —
same pattern, no new dependency. `ne_10m_admin_1_states_provinces` (worldwide, ~4,600) and
`ne_10m_admin_2_counties` (**US only**, ~3,143, much denser). Recommend: states bundled + toggle;
counties **lazily fetched, default off**, mirroring D-052. Bake into batched polyline primitives at
build time — one entity per feature would be brutal. Measure and report the baked size before
committing to counties.

**4. Themes — 2 dark + 2 mid-tone.** The guard now validates theme blocks, so this is unblocked.
Follow the prior handoff's increment order (tokens block → store+persist → `placesLayer.recolour()`
→ `retheme()` in `Globe.tsx` → UI). **Persist is now at version 4 — bump to 5.** The two mutate-branch
colour bugs are already fixed. Owner: "light mode doesn't have to be super light" — a mid-slate
background keeps the D-029 altitude ramp (HSL lightness 52–68) readable and the `--bg` label halo
working; only the GEBCO bathymetry ramp needs a second look.

**5. Rebase and merge the single-file branch — LAST.** `worktree-agent-a359546ffb2f19480` is at
`71e3edf`, based at `2408885`, so it has none of this session's ten commits. Regenerate
`loran.html` afterwards.

**6. Remote access.** Everything app-side verified. See the `config.yml` hazard in Open Questions.

---

## Open Questions

1. **Duplicate normalizer.** `frontend/src/data/upstream.ts` (352 lines) reimplements
   `backend/app/feeds/adsb.py` in TypeScript. Nothing keeps them in sync. Accept the drift risk,
   generate one from the other, or add a shared fixture both are tested against?
2. **D-057 collides.** `main`'s D-057 is the token paste field; `71e3edf`'s D-057 is the single-file
   build. The branch's entry must be renumbered on rebase (D-061+).
3. **`~/.cloudflared/config.yml` hazard — READ BEFORE STARTING THE TUNNEL.** It is SHARED with the
   **active production** `cloudflared-voygent.service`. It names tunnel `71bc66de-…` and its ingress
   ends in `http_status:404`. `cloudflared tunnel run` reads it by default, so a hostname not listed
   gets **404 from Cloudflare's edge without reaching the origin** — which may be the real
   explanation for the quick-tunnel failures previously blamed on Cloudflare. **Give the loran tunnel
   its own config file** (`~/.cloudflared/loran.yml`); never edit the shared one; kill by PID, never
   `pkill`.
4. **`LORAN_SESSION_SECRET` is unset**, so `auth.py:66` derives the signing key from the sorted token
   list — adding a third person logs everyone out. Set a fixed secret to decouple them?
5. **`LORAN_PHOTO_GUEST_ACCESS=true`** in the local `.env` (repo default stays `false`). It becomes a
   live planespotters clause-8 departure the moment a guest uses the link.
6. **Counties**: US-only is all Natural Earth offers. Acceptable?
7. **Should `scripts/test.sh` go into `npm run build`, or wait for CI?** Still neither.

---

## Coordinate Closet

- `b3d7bc6` (HEAD == main, D-060) · `b01c73c` (scrollbar-gutter) · `4bfe017` (D-058+D-059)
- `db4d1ce` (font-smoothing) · `6c2c652` (D-057) · `d80195b` (D-056) · `dbd3514` (D-055)
- `cf08b75` (D-054) · `8bbc38c` (D-053) · `2408885` (previous main)
- `71e3edf` (single-file build, **UNMERGED**, branch `worktree-agent-a359546ffb2f19480`)
- `~/dev/adsb-viz/.claude/worktrees/agent-a359546ffb2f19480` (that branch's worktree — TEMPORARY)
- `~/loran-single.html` (8.5 MiB artifact, copied out; **built before `b01c73c` and `b3d7bc6`**)
- `375c226` (`master`, stale) · `bb0b589` (`phase2-dossier`, stale)
- `https://github.com/iamneilroberts/LORAN` (PUBLIC, default `main`, MIT)
- `~/dev/adsb-viz-phase2-dossier` (worktree, `main` — **resume here**)
- `~/.claude/coordination/adsb-viz/handoffs` (shared handoff dir)
- `adsb.voygent.ai` (APPROVED hostname — **still not created**)
- `<voygent-desktop-tunnel-uuid>` (voygent-desktop tunnel — **DO NOT DISTURB**)
- `<voygent-desktop-cloud-tunnel-uuid>` (voygent-desktop-cloud tunnel)
- `~/.cloudflared/config.yml` (**SHARED — do not edit**) · `~/.cloudflared/cert.pem` (login done)
- `cloudflared` 2025.9.1 · `cloudflared-voygent.service` (active)
- `bash scripts/test.sh` → **61 frontend + 60 backend** · `npm run check:palette` → "12 colours match"
- `cd frontend && npx tsc --noEmit` (**the only gate that catches JSX errors in Panels.tsx**)
- `bash scripts/mint-link.sh` (prints `?t=` links, stdout only)
- persist **version 4** (`radiusNm` v3, `showAllLabels` v4) → **bump to 5 for themes**
- `SESSION_FAIL_LIMIT=5` · `SESSION_FAIL_WINDOW_S=60` · `MAX_RADIUS_NM=250` · `RANGE_PRESETS_NM=[60,120,180,250]`
- `COLLAPSE_AFTER_MS=8000` · `HOVER_EXPAND_DELAY_MS=250`
- `FAR_LARGE 2_500_000` · `FAR_MEDIUM 450_000` · `FAR_SMALL 120_000` · `nameFar = far/4` (pinned)
- `--bg: #05070a` · `--amber: #ffb000` · `--mil: #ff4fd8` · `--cyan: #5fd7e0` · `--txt: #c8d6e0`
- `--dim: #5a6b7a` · `--off: #3a4652` · `--map-label: #e9edf0` · `--icon-selected: #ffffff`
- `--icon-stroke: #03181c` · `--icon-stroke-mil: #3d0033` · `--icon-stroke-alert: #3a2600`
- `RAMP` lightness 52–68 (D-029 — survives a MID-TONE theme; would not survive white)
- `30.6944, -88.0399` (home: Mobile, AL) · `127.0.0.1:8010` (container) · `127.0.0.1:5173` (host Vite)
- `api.airplanes.live` ACAO `*` · `api.adsbdb.com` ACAO `*` · `api.adsb.lol` **NO ACAO** · `opendata.adsb.fi` **NO ACAO**
- `globe.airplanes.live/?icao=<hex>` (200) · `globe.adsbexchange.com/?icao=<hex>` (200)
- `loran:local` 191MB · Nooelec NESDR SMArt v5 Bundle (ORDERED, for AIS)
- AIS `161.975` / `162.025` MHz · quarter-wave `46.3 cm` @ 162 MHz

---

## Instructions

Resume this work. **First, re-create the TodoWrite list** from the `## Checklist` above (one entry
per `- [ ]`; mark `- [x]` done or omit) — if `docs/summaries/CHECKLIST.md` is newer, prefer it.
**This handoff documents an EXISTING worktree** — `cd ~/dev/adsb-viz-phase2-dossier` and
resume on branch `main`; do NOT create a new branch. Run `git status` /
`git branch --show-current` and warn on any mismatch.

**Evaluate each "Stale if" condition in the header.** If any holds, say which, treat the claims it
covers as stale, and re-verify against the live artifact before acting.

**Order:**
1. **Dossier outbound links** — and they must work in the single-file build too, where photos are
   impossible and the link is the substitute. Browser-verify the four 403-to-curl URLs first.
2. **Route relabel + flag** — owner already chose "Relabel AND flag"; do not re-ask.
3. **State + county lines** — measure the baked size before committing to counties.
4. **Themes, 2 dark + 2 mid-tone** — the palette guard now validates theme blocks; persist v4 → v5.
5. **Rebase + merge the single-file branch LAST**, then regenerate `loran.html`.

**Always run `cd frontend && npx tsc --noEmit`** as well as the suites — no test imports
`Panels.tsx` or `aircraftLayer.ts`, so vitest goes green on a JSX syntax error in either. That
happened twice this session.

Present the rebuilt checklist + Remaining Work and ask whether to continue or do something else.
