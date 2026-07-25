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

### D-016 · Track path comes from a backend ring buffer, not client-side accumulation

**Context:** The spec says TRACK PATH draws "the aircraft's recorded history", but no recorder
exists until Phase 5. Owner chose option (c).

**Decision:** Backend keeps an in-memory ring buffer of recent position fixes (~30 min, bounded by
contact count), exposed as `GET /api/track?hex=...`. No schema, no disk, no Phase 5 commitment.

**Why:** client-side accumulation dies on refresh and only ever holds what one tab happened to
see. The ring buffer survives a reload, is shared across tabs, and gives a track worth exporting
without pre-committing to the archive DDL - which the owner must review before it is written.

**Honesty constraint:** the UI must state the window it actually has (e.g. `TRACK · 22 MIN`), and
the GeoJSON export must carry the covered time window in `properties`. It must never imply the
track reaches back further than the buffer does. When Phase 5 lands, this endpoint gets a
disk-backed implementation and the UI stops being bounded by memory.

---

### D-017 · Amber is exclusively military; altitude is a luminance ramp within cyan

**Decision:** Confirmed by the owner. `colourFor()` in
`frontend/src/globe/aircraftLayer.ts` is the only place this lives.

**Why:** the brief asks for both "colour by altitude band" and "amber for military", which
conflict. A third hue for high altitude reads as an alert and erodes what amber means. Altitude
is therefore luminance/saturation within the cyan family, which keeps the two-colour palette and
leaves amber meaning exactly one thing.

---

### D-018 · Phase 4 unblocks via a self-hosted AIS receiver

**Context:** aisstream.io measured zero coverage at Mobile (D-012). Owner has an unused SDR
receiver and is willing to feed their own.

**Decision:** Phase 4's AIS source becomes a local receiver: RTL-SDR -> AIS-catcher -> NMEA over
UDP -> backend ingest. aisstream.io stays rejected.

**Why:** it covers the actual AOI instead of someone else's, removes the upstream dependency
entirely, and is architecturally *simpler* than aisstream - no WebSocket, no API key, no rate
limit, no terms of service, no BETA disclaimer.

**Hardware caveat the owner needs before this works:** AIS is marine VHF at **161.975 / 162.025
MHz**. ADS-B is **1090 MHz**. The RTL-SDR dongle covers both, but an ADS-B antenna does **not** -
1090 MHz antennas are physically far too short for 162 MHz and will receive almost nothing. A
marine-band vertical (or a quarter-wave cut for ~162 MHz, roughly 46 cm) is required. Antenna
height matters more than antenna cost, because AIS is line-of-sight.

**Verify before building any UI:** run AIS-catcher and confirm real MMSIs appear for Mobile Bay.
The same gate as D-005 applies - measure, then build.

---

### D-019 · Open-source release must run with OR without Docker

**Context:** Owner intends to publish this, and wants Docker to be a user option rather than a
requirement.

**Decision:** Ship both paths as first-class: `docker compose up` and a documented bare-metal
path. Neither is the "real" one.

**Consequences to hold to from here on:**
- No absolute paths in application code; everything configurable via `.env`.
- The backend must not assume it can write outside its configured data dir.
- README documents both paths with equal weight.

**Licensing note that matters more than the code licence:** the upstream feed terms travel with
anyone who runs this. airplanes.live is **non-commercial, no SLA**; adsb.fi is non-commercial;
planespotters forbids re-exposing their API through another API and forbids using their photos
or metadata to train ML models. This project is single-user and unauthenticated **by design** -
that is what keeps it inside those terms. The README must say so plainly, so nobody deploys it
publicly and breaches clause 8 on the maintainer's behalf.

---

### D-013 · Datum plane is a translucent solid; bands stay wireframe

**Context:** Owner reported the datum's gridlines "aren't displaying very well" and asked whether
a translucent solid would work.

**Decision:** Yes. The datum plane now renders as a translucent fill with a bright 2px rim.
Static band planes keep the wireframe grid.

**Why:** a dense grid viewed at a shallow angle moires into noise and stops reading as a surface,
which is the one job the datum has. A solid fill reads as a surface from any angle, and the rim
keeps the finite bound legible. Keeping the bands as wireframe is also a useful distinction:
wireframe says "static structure", solid says "the thing I am measuring against right now".
`PlaneSpec.fill` takes `"solid" | "grid"` so either can be used for either.

---

### D-014 · Camera cluster pulled forward from Phase 6

**Context:** Owner could zoom and pan but had no way to rotate or change altitude.

**Decision:** Built the camera cluster now rather than at Phase 6.

**Why:** Cesium's mouse bindings already do all of it - middle-drag or ctrl+left-drag rotates and
tilts - but they are undiscoverable, and the owner reasonably concluded the capability was
missing. Explicit controls, plus two presets that matter for this project specifically:
HORIZON VIEW (near edge-on, the clearest read on who is stacked above whom) and PLAN VIEW
(straight down - deliberately labelled as showing horizontal separation only, since it is exactly
the view that cannot show altitude, which is why it is not the default).

---

### D-015 · Aircraft primitives are reused across frames, not rebuilt

**Context:** Owner reported 25-30 FPS. That was my bug, not their GPU.

**Decision:** `aircraftLayer` now keys billboards, labels and drop-lines by ICAO hex and mutates
them in place, adding or removing only when the set of contacts changes.

**Why:** the first version called `removeAll()` and re-added every primitive on every postRender -
roughly 120 allocations per frame at 30 fps, about 3,600 primitive constructions a second, plus a
texture re-upload each time `.image` was set. Verified fixed by checking that the billboard at
index 0 is the *same object instance* across frames
(`billboardIdentityReusedAcrossFrames: true`), rather than by trusting the diff.

**Honest limit:** the resulting frame rate on the owner's RTX 2000 Ada cannot be measured from
this environment - headless SwiftShader is software-rendered and reports 1-2 FPS regardless.
The allocation churn is provably gone; the FPS number has to come from the owner.

---

### D-012 · aisstream.io rejected for Mobile — measured, not assumed. Phase 4 deferred.

**Context:** D-005 gated Phase 4 on an empirical coverage measurement. The owner supplied a key;
the measurement ran.

**Result:** Mobile Bay returned **0 messages / 0 vessels in 182 s**, reproduced twice. A
same-session Gulf of Finland control returned **106 vessels in 121 s**, proving the script, key
and subscription format all work. In a wide 4° box, no vessel was ever observed west of −87.54;
Mobile is −88.04. Coverage is a single blob roughly 50 nm east, off Pensacola.

**Decision:** aisstream.io is rejected as the AIS source for this AOI. Phase 4 is deferred, not
cancelled — it is blocked on a data source, not on code. Phases 1, 2, 3, 5 and 6 have no AIS
dependency and proceed unaffected.

**Preferred remedy:** the owner feeds their own AIS receiver — RTL-SDR on 161.975/162.025 MHz with
a marine vertical, decoded by AIS-catcher, delivered to the backend as local NMEA over UDP. This
fits the owner's existing ESP32/SDR hardware experience, gives genuinely good coverage of the
actual AOI instead of adequate coverage of someone else's, and is architecturally *simpler* than
aisstream — no WebSocket, no key, no rate limit, no terms of service. Feeding AISHub in return
would grant an aggregated global feed for the wide view.

**Why this was worth the 20 minutes:** the alternative was building a vessel UI, a normalizer, a
dossier and a traffic panel, then discovering at integration that the panel is permanently empty
over the owner's house. The brief explicitly asked to learn this before building five phases on
top of it.

**Caveat recorded:** ~20 minutes of observation on one afternoon. Reproducible and controlled, but
a statement about today's volunteer network, not a permanent law.

---

### D-009 · Planespotters: backend fetches JSON, browser loads images. Never proxy binaries.

**Context:** Owner supplied the full Photo API Terms of Use, which I had previously guessed at and
got wrong. Clause 5 forbids downloading, storing, or re-hosting image binaries under any
circumstance; clause 6 forbids rewriting any returned URL.

**Decision:** Backend fetches the JSON with a contact-carrying User-Agent and caches it ≤24 h
(explicitly permitted). The frontend puts the returned CDN URL straight into an `<img>` so the
binary loads in the user's browser. Photographer credit renders as visible text beside the image;
the thumbnail is wrapped in a plain anchor to the returned `link`, with no `rel="nofollow"`.

**Why this rather than browser-direct:** their terms document a browser path requiring an `Origin`
or `Referer` header, but I tested it and it returns **403**. Their gate is enforced on
User-Agent, and a request with a valid `Origin` but an ordinary browser UA is rejected. Browsers
forbid scripts from setting `User-Agent`, so the browser-direct path is unusable regardless of
what the docs say. The server-side path is therefore forced — and it is also the compliant one.

**Consequence:** this is the one deliberate exception to "the backend proxies upstream feeds."
For photos the backend proxies *metadata only*, never bytes. Also: our photo endpoint must stay
private to this single-user app — clause 8 prohibits re-exposing their data through our own API.
And clause 7 prohibits using photos or metadata for ML/AI training, which reinforces the existing
no-AI-summarization non-goal.

---

### D-010 · Datum plane supersedes fixed bands as the primary altitude instrument

**Context:** Owner proposed "a toggle for the selected aircraft's altitude plane from a 3d
perspective," and offered to drop the altitude-shell idea if it wasn't feasible.

**Decision:** Nothing is dropped. The owner's datum-plane idea becomes the *primary* mechanism;
the spec'd fixed bands are kept as a secondary, separately toggleable context layer. Full design
in `docs/design-altitude.md`.

**Why:** perspective projection confounds height with distance-from-camera, so drawing aircraft
at true altitude with static shells looks like an instrument while measuring almost nothing. A
plane pinned to the *selected* aircraft's altitude converts an absolute judgement into an
above/below one, which human vision does reliably. Adding relative colouring (amber within the
±1000 ft separation minimum) and drop-lines to the datum turns it into something that genuinely
answers "who is near this aircraft."

**Consequence:** this **retires D-006.** The third altitude band is no longer needed, because the
datum works at any altitude including the observed 43,000 ft ceiling. The two originally spec'd
bands stand as written.

---

### D-011 · CARTO dark tiles evaluated as a landmass option

**Context:** The owner's prior ESP32 projects (`~/dev/adsb`, `~/dev/adsb-cyd`) reference
`basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`.

**Decision:** Offer CARTO `dark_all` as a Phase 1 basemap option alongside Esri World Imagery.

**Why:** the brief asks for a dark technical console, and satellite imagery of land is visually
busy — it competes with the traffic overlay for attention. A dark vector-style basemap may serve
the aesthetic better while keeping Esri Ocean Base + GEBCO for the bathymetry the owner
specifically wants. Not a decision to make on paper; both get rendered in Phase 1 and compared.

**Side note:** those prior projects independently converged on adsb.lol + adsbdb + planespotters,
which is the same stack this recon recommends. Useful corroboration, arrived at separately.

---

### D-008 · Reference image treated as vocabulary, not spec

**Decision:** Adopt the reference image's layout, colour and typographic language. Do not
reproduce two artifacts in it.

**Why:** The image is an AI render. Its geographic labels are mutually impossible (Bering Sea,
Pacific Ocean and Kermadec Trench cannot be co-visible), and its aircraft icons are scaled far
larger than real traffic at that camera distance. Reproducing either would violate the project's
honesty rule — the first invents geography, the second misrepresents scale.
