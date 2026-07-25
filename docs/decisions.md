# Decisions

Append-only. Newest at the bottom. One entry per non-obvious call.

---

## 2026-07-25 — Phase 0

### D-001 · airplanes.live as ADS-B primary, adsb.lol as fallback

**Context:** Four candidate feeds, all reachable anonymously as of today.

**Decision:** airplanes.live primary; adsb.lol fallback; adsb.fi second reserve.

**Why:** airplanes.live returns `desc`, `ownOp` and `year` inline, which removes an adsbdb
round-trip for most aircraft, and it exposes a dedicated `/v2/mil` endpoint plus a `dbFlags`
military bit. adsb.lol is the only feed with a genuine open licence (ODbL 1.0) so it is the
right fallback on principle as well as availability, but it omits the enrichment fields.

**Consequence:** because all three share the readsb/tar1090 schema, failover is nearly free —
one normalizer, one envelope-key difference to paper over. This is why we can afford three
sources instead of agonising over one.

---

### D-002 · OpenSky rejected for live use

**Decision:** Not used. Parser notes retained in `docs/data-sources.md` §3.4 only.

**Why:** 400 credits/day anonymous is one poll per ~3.6 minutes; even an authenticated
4,000/day is one poll per ~21 seconds, and bbox cost scales with area. It also uses a
positional-array schema and metric units, so it would need its own parser and unit conversion
for strictly worse data. Anonymous access does still work (contrary to common claims) — it's
the economics that disqualify it, not the auth.

---

### D-003 · Run Cesium fully keyless

**Decision:** `Ion.defaultAccessToken = null`, `EllipsoidTerrainProvider`, Esri + GEBCO imagery.

**Why:** Every stated requirement — depth shading, cursor depth readout, true-altitude
positioning, translucent volumes — is achievable without ion. ion is needed only for 3D land
relief and true 3D seafloor geometry, neither of which was asked for. Keyless also protects the
8 GB VRAM budget on the RTX 2000 Ada, which was raised as a concern.

**Reversible:** a free ion token plus a one-line provider swap adds 3D terrain later. Deferred
until the keyless version has been seen.

---

### D-004 · Depth readout from GEBCO GetFeatureInfo, NOAA as cross-check

**Decision:** GEBCO WMS `GetFeatureInfo` is the primary depth source; NOAA NCEI DEM `identify`
is the fallback.

**Why:** Both are keyless and both return real numeric values. Cross-validated at one Gulf point:
GEBCO −2103 m vs NOAA −2095.64 m, agreeing to ~0.35%. GEBCO is preferred because it's a single
request against the same dataset we're already drawing as imagery, so the number matches the
picture. Values are metres, negative below sea level; land returns positive elevation, so one
readout serves both (DEPTH over water, ELEV over land).

---

### D-005 · AIS gated behind an empirical measurement

**Decision:** Phase 4 does not start until a free aisstream.io key exists and a throwaway
10-minute measurement over a Mobile-area bounding box reports real distinct MMSIs.

**Why:** aisstream is a volunteer receiver network covering "roughly 200km off the majority of
the world's coastlines" by their own statement. Mobile is coastal and a major port, so coverage
is *plausible* — but plausible is not verified, and the project's first ground rule forbids
building a screen that might only ever render synthesized-looking emptiness. Measuring costs ten
minutes; discovering the gap after building a vessel UI costs a phase.

**Alternatives rejected:** Finnish Digitraffic and Norwegian BarentsWatch are open and excellent
but ~8,000 km from the AOI. NOAA/MarineCadastre covers the Gulf comprehensively but is
historical-only, published quarterly — no live endpoint.

---

### D-006 · Default altitude bands need a third stratum

**Context:** Spec proposed 0–18,000 ft and 18,000–29,000 ft.

**Decision:** Propose adding 29,000–43,000 ft (FL290–FL410, RVSM) as a default band. Flagged to
the owner; bands remain configurable so this is a default-value choice, not architecture.

**Why:** A live 100 nm sample around Mobile (95 aircraft) distributed as 59 / 7 / 27 / 2
(low / mid / above-29k / ground). The specified bands leave 28% of local traffic — essentially
all airline overflight, the most visually prominent traffic — floating above the top shell with
no reference plane. Observed ceiling 43,000 ft.

---

### D-007 · Altitude shells are a measuring instrument, not decoration

**Context:** Owner clarified the goal is to "see where two or more observed craft are in relation
to each other," with altitude shown as coloured geometric planes.

**Decision:** Phase 3 must include vertical drop-lines from each aircraft to a reference plane,
not just the translucent shells.

**Why:** Judging altitude from position alone in a perspective 3D projection is unreliable —
depth and height are visually confounded, so two aircraft at very different altitudes can appear
adjacent. Translucent planes alone don't fix this; a vertical leader-line from the aircraft to a
known plane is the standard technique that makes 3D position readable. Without it the signature
feature looks good and measures nothing.

---

### D-008 · Reference image treated as vocabulary, not spec

**Decision:** Adopt the reference image's layout, colour and typographic language. Do not
reproduce two artifacts in it.

**Why:** The image is an AI render. Its geographic labels are mutually impossible (Bering Sea,
Pacific Ocean and Kermadec Trench cannot be co-visible), and its aircraft icons are scaled far
larger than real traffic at that camera distance. Reproducing either would violate the project's
honesty rule — the first invents geography, the second misrepresents scale.
