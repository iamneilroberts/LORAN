# Checklist

- [x] Phase 0 — recon, `docs/data-sources.md`, stop for sign-off
- [x] Phase 0 addendum — measure AIS with owner's key; verdict: zero coverage at Mobile
- [x] Correct planespotters terms from owner-supplied text; fix architecture (D-009)
- [x] Mockups — basemap G and Layout 1 chosen
- [x] Phase 1 — 3D globe, live aircraft at true altitude, bands + datum, cursor depth
- [x] Phase 1 feedback — primitive-churn fix, solid datum, camera cluster
- [ ] **Phase 2** — adsbdb enrichment (registration / type / operator / origin / destination)
- [ ] **Phase 2** — planespotters photo + mandatory attribution, per D-009 constraints
- [ ] **Phase 2** — track path via backend ring buffer (D-016), draw, clear
- [ ] **Phase 2** — export track as GeoJSON
- [ ] **Phase 2** — click empty space clears selection (only the `×` button clears today)
- [ ] Docker Compose AND bare-metal, both first-class (D-019) — going open source
- [ ] Viewport-scoped fetch (currently fixed 120 nm around home, ignores camera)
- [ ] Phase 3 — configurable bands UI (planes themselves already exist)
- [ ] Phase 5 — SQLite recorder; **DDL reviewed by owner before the writer is written**
- [ ] Phase 6 — status bar polish, compass, FPS (cluster + chips partly done)
- [ ] Phase 4 — vessels via self-hosted RTL-SDR + AIS-catcher (D-018). NEEDS MARINE-VHF ANTENNA (162 MHz)
- [ ] Open-source prep: licence + README stating single-user-by-design

_Updated: 2026-07-25 — phase2-dossier_
