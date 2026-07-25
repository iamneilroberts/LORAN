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
- [ ] **Phase 2** — track path via backend ring buffer (D-016), draw, clear
- [ ] **Phase 2** — export track as GeoJSON
- [ ] **Phase 2** — click empty space clears selection (only the `×` button clears today); React error boundary
- [ ] Docker Compose AND bare-metal, both first-class (D-019) — going open source
- [ ] Viewport-scoped fetch (currently fixed 120 nm around home, ignores camera)
- [ ] Phase 3 — configurable bands UI (planes themselves already exist)
- [ ] Phase 5 — SQLite recorder; **DDL reviewed by owner before the writer is written**
- [ ] Phase 6 — status bar polish, compass, FPS (cluster + chips partly done)
- [ ] Phase 4 — vessels via self-hosted RTL-SDR + AIS-catcher (D-018). NEEDS MARINE-VHF ANTENNA (162 MHz)
- [ ] Open-source prep: licence + README stating single-user-by-design

### Owner feedback 2026-07-25 (from live view)
- [ ] Aircraft icons read as diving/climbing — rotate by screen-projected track, not raw heading
- [ ] Text fuzzy/garbled — no devicePixelRatio handling for Cesium; panel `backdrop-filter: blur(2px)`
- [ ] Map markers for airports, military airfields, city names — **needs a data source decision**
- [ ] Altitude bands / datum toggles give no feedback (datum needs a selection to exist)
- [ ] Rename "Datum Plane" — **owner to choose the term**
- [ ] Drop lines to the surface — **reverses the current deliberate design**, needs a decision entry
- [ ] FUTURE: multi-user hosting for friends — **reverses CLAUDE.md non-goals**, see task notes

_Updated: 2026-07-25 15:38 — phase2-dossier_
