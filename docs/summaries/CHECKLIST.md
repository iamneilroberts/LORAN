# Checklist

- [x] Phase 0 — recon, `docs/data-sources.md`, stop for sign-off
- [x] Phase 0 addendum — measure AIS with owner's key; verdict: zero coverage at Mobile
- [x] Correct planespotters terms from owner-supplied text; fix architecture (D-009)
- [x] Mockups — basemap G and Layout 1 chosen
- [x] Phase 1 — 3D globe, live aircraft at true altitude, bands + datum, cursor depth
- [x] Phase 1 feedback — primitive-churn fix, solid datum, camera cluster
- [x] Untrack generated Cesium assets, fix .gitignore symlink blindness (fc7fc9a)
- [x] **Phase 2** — adsbdb enrichment (reg / type / model / operator / origin / dest) + observed max alt/spd (D-020, D-021)
- [x] **Phase 2** — planespotters photo + mandatory attribution, per D-009 (+ D-024 poisoned-hex guard)
- [x] **Phase 2** — track path via backend ring buffer (D-016), draw, clear (+ D-025)
- [x] **Phase 2** — export track as GeoJSON, carrying real coverage in properties
- [x] **Phase 2** — click-empty-to-clear (already worked; verified) + React error boundary (D-026)
- [ ] Docker Compose AND bare-metal, both first-class (D-019) — going open source
- [ ] Viewport-scoped fetch (currently fixed 120 nm around home, ignores camera)
- [ ] Phase 3 — configurable bands UI (planes themselves already exist)
- [ ] Phase 5 — SQLite recorder; **DDL reviewed by owner before the writer is written**
- [ ] Phase 6 — status bar polish, compass, FPS (cluster + chips partly done)
- [ ] Phase 4 — vessels via self-hosted RTL-SDR + AIS-catcher (D-018). NEEDS MARINE-VHF ANTENNA (162 MHz)
- [ ] Open-source prep: licence + README stating single-user-by-design

### Owner feedback 2026-07-25 (from live view)
- [x] Aircraft icons read as diving/climbing — screen-projected track (D-027)
- [x] Text fuzzy/garbled — 3 defects: Cesium DPI, panel blur, datum label rebuild churn (D-028)
- [ ] Map markers for airports, military airfields, city names — OurAirports + Natural Earth approved (D-023)
- [x] Altitude bands / datum toggles give no feedback — toggles now state "needs a selected contact"
- [x] Rename "Datum Plane" → ALTITUDE SLICE (D-022)
- [x] Drop lines to the surface, selection-only (D-030)
- [x] Fixed altitude bands replaced by icon hue ramp + legend; MIL now magenta (D-029, supersedes D-017)
- [x] Traffic panel operator rows are click-to-filter; MIL selector added (D-031)
- [x] Dossier widened to 268px for the photo; camera cluster collapsible and narrowed to 148px
- [ ] FUTURE: multi-user hosting for friends — **reverses CLAUDE.md non-goals**, see task notes

- [ ] verify_phase1.py click check is intermittent (1 fail / 2 runs, not a regression)

_Updated: 2026-07-25 16:40 — phase2-dossier_
