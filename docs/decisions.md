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

---

### D-020 · adsbdb enrichment: cache budget is ours to set, and a miss is cached too

**Date:** 2026-07-25

**Context:** adsbdb needs no key and publishes no rate limit. Absence of a stated limit is not
permission to hammer it.

**Decision:** `backend/app/feeds/adsbdb.py` caches airframe lookups for 24 h, route lookups for
1 h, and **negative results for 1 h**. Upstream calls are serialised behind a 0.2 s floor. All
four values are `.env`-tunable (`LORAN_ADSBDB_*`).

**Why:** airframe data is static per hull, so a hex should cost one upstream call a day no matter
how often it is clicked. Routes change per flight, so an hour is the honest ceiling. Caching the
*miss* matters most: without it, every click on an aircraft adsbdb has never heard of is a fresh
upstream call, and the aircraft most likely to be clicked repeatedly — an unidentified contact —
is exactly the one most likely to miss.

**Also decided:** `GET /api/enrich` always returns 200. `aircraft`/`route` are `null` when adsbdb
does not know the contact; a lookup that could not be *made* appears in `errors` instead. The
panel renders these differently ("—" vs "adsbdb unavailable") because **"we do not know" and "we
could not ask" are different claims**, and collapsing them would let an outage masquerade as an
absence of data.

**Not used:** the adsbdb aircraft response carries `url_photo` / `url_photo_thumbnail`. Photos
come from planespotters under D-009 instead, so those fields are ignored.

---

### D-021 · Max altitude / max speed are OBSERVED peaks, never airframe limits

**Date:** 2026-07-25

**Context:** The owner asked for max altitude and max speed in the dossier.

**Decision:** Show the highest altitude and ground speed **this session has actually observed**
for a contact, labelled `MAX ALT OBS` / `MAX SPD OBS`, with a hover note naming the window and
stating it is not the airframe's limit. Peaks live in the frontend store keyed by hex and are
**dropped when the contact leaves the feed**.

**Why:** we have no source for service ceiling or Vne — not in the readsb feeds, not in adsbdb.
Presenting an observed peak as a capability would be inventing data (ground rule 1), and an
airframe that has been in range for ninety seconds has a "max altitude" that means almost
nothing unless the reader knows that. Dropping peaks with the contact keeps the window from
outliving the evidence behind it.

**Revisit at Phase 5:** the SQLite recorder gives a real, durable observation window, at which
point these become genuinely useful rather than merely honest.

---

### D-022 · "Datum plane" renamed to ALTITUDE SLICE

**Date:** 2026-07-25

**Decision:** Owner chose **ALTITUDE SLICE**. The layer toggle, the floating plane label
(`[ SLICE 14,325 FT · ±50 NM ]`), and `docs/design-altitude.md` all adopt it. D-010, D-013 and
D-015 keep their original wording as a historical record; this entry is the pointer.

**Why:** "datum" is surveying vocabulary. The instrument is a horizontal cut through the airspace
at the selected contact's height, and "slice" says that without a glossary. The owner reported
the old term as confusing on first contact with the running app, which is the only test that
matters for a label.

---

### D-023 · Place markers from OurAirports + Natural Earth, vendored as static data

**Date:** 2026-07-25

**Decision:** Approved under ground rule 2. Airports and **military airfields** from
**OurAirports** (public domain); city names from **Natural Earth populated places** (public
domain). Both are vendored as static files processed at build time — no runtime API, no key, no
rate limit, nothing new in the request path.

**Why:** the alternatives are live geocoding APIs, which would add a sixth upstream dependency,
a key to manage and a rate limit to respect, for data that changes on a timescale of years.
Natural Earth ranks places by importance, so city labels can thin out with zoom instead of
piling into an unreadable mat at wide view. OurAirports carries an explicit military flag, so
military airfields can take the amber that D-017 reserves for military contacts.

**Constraint:** these files describe real places and are used as-is. No interpolation, no
"nearest major city" invention. A place we do not have stays unlabelled.

---

### D-024 · Photos are looked up by REGISTRATION first; two hex values are blocklisted

**Date:** 2026-07-25

**Context:** Measured while building the Phase 2 photo panel. The planespotters hex endpoint
returns a real photo of the **wrong aircraft** for at least two hex values:

```
/pub/photos/hex/FFFFFE  ->  05-0419, a USAF U-28A
/pub/photos/hex/000001  ->  FAC1285, Fuerza Aerea Colombiana
```

Both are deterministic and repeatable. `FFFFFF`, `000000`, `FFFFFD` and `000002` all correctly
return no photos, so this is a handful of bad records in their database rather than a fallback
feature. `FFFFFE` and `000001` are exactly the values a misconfigured transponder emits.

**Decision:** `GET /api/photo` tries the **registration** endpoint first and only falls back to
hex, and it refuses to query hex at all for `POISONED_HEX = {000000, 000001, FFFFFD, FFFFFE,
FFFFFF}`.

**Why:** an aircraft squawking a garbage hex is precisely the contact an operator would look at
twice, and showing it a stranger's photograph would be the worst available failure of ground
rule 1 — not a blank where data is missing, but confident wrong data. Registration was correct
on every case tested (`N922AE`, `00-0184`, `N98XS`), and adsbdb now supplies a registration even
when the feed omits one, so the strong key is almost always available.

**Residual risk:** a *plausible but wrong* registration from either source would defeat this. The
photo panel is therefore never the sole evidence of identity — the dossier shows REG, TYPE and
MODEL beside it so a mismatch is visible to the operator rather than hidden.

**Terms compliance unchanged:** JSON only, contact-carrying UA, 24 h cache cap, credit as visible
text, plain `<a>` to the photo page with no `rel="nofollow"`, no image bytes touched server-side.

---

### D-025 · Track buffer: sample floor, run collapsing, and coverage in the export

**Date:** 2026-07-25

Implementation calls behind D-016, all three about not letting the buffer lie.

**Sample floor (`LORAN_TRACK_SAMPLE_SECONDS`, default 5 s).** The poll runs every 2 s. Storing
every poll would put ~900 near-identical points per contact in a 30-minute buffer without
covering any more time. One sample per contact per 5 s gives 361 slots, which is the whole window.

**Run collapsing.** A contact whose upstream fix has not moved would otherwise fill all 361 slots
with the same coordinate and evict its own real history. A run of identical positions is
collapsed to its two endpoints — "here at t0", "still here at t1" — which preserves the observed
span exactly while costing two slots instead of the entire buffer. Verified: a stationary contact
holds 2 points where a moving one holds 12 over the same period.

**Recording hooks the FRESH payload only.** `AdsbClient.on_fresh` fires where an upstream response
is normalised, not where a cached one is returned. Serving a cached payload to a second browser
tab must not append a duplicate fix.

**The GeoJSON carries its own coverage.** `properties` includes `first_fix`, `last_fix`,
`span_seconds`, `buffer_window_seconds`, `older_points_discarded` and a plain-language
`coverage_note`. A bare LineString invites the reader to assume it is the whole flight; these
fields make the real extent explicit in the file, which is where it matters once the export has
left the app. Altitudes are metres in the third coordinate position per RFC 7946, converted from
the feed's feet.

---

### D-026 · Error boundary shows the real error, not a friendly one

**Date:** 2026-07-25

**Decision:** A React error boundary wraps the app and renders the actual error name, message and
component stack, plus an explicit statement that live data is no longer updating.

**Why:** without a boundary a render throw unmounts React and leaves a black rectangle that looks
exactly like "the globe is still loading" and "the feed is down" — three different situations that
must never be indistinguishable on an instrument. And the person reading this console is the
person who can fix it, so "something went wrong" would only cost them a devtools round-trip.

**Verified** by injecting a render-time throw through the real code path and confirming the
boundary caught it and displayed the message, rather than reasoning from React's documented
semantics. An earlier attempt threw inside a zustand subscriber instead, which boundaries
correctly do **not** catch — worth knowing: state-subscriber errors in `Globe.tsx` are outside
the boundary's reach and would still blank the display.

---

### D-027 · Icon heading is computed in screen space, not compass space

**Date:** 2026-07-25

**Context:** Owner reported that aircraft "appear to be diving or climbing vertically".

**Diagnosis:** the icons are camera-facing billboards rotated by raw ADS-B `track`. That draws a
northbound aircraft pointing straight up the screen, and under this project's tilted camera
(pitch −32°) "up the screen" reads as CLIMBING rather than "flying away from you".

**Decision:** project the contact's position and a point 4 km ahead along its ground track, then
rotate the icon along the resulting screen-space vector.

**Verified differentially** rather than by eye: in plan view (pitch −90°) the new rotation
reduces to the old compass behaviour — median difference **0.6°** — while under the tilted
camera it diverges by a median of **10.6°** and up to **54.5°**. The largest corrections land on
tracks near due north/south, which are exactly the contacts that looked like vertical climbs.

**Known limit, stated rather than hidden:** this fixes heading only. A billboard always faces the
camera, so the silhouette is not laid flat into the ground plane — that would need ground-aligned
geometry per contact, which is not worth the cost here. Vertical rate is not encoded in the icon
at all; V/S remains a numeric readout in the dossier.

---

### D-028 · Text sharpness: native pixel density, no backdrop blur, and stop rebuilding labels

**Date:** 2026-07-25

Owner reported text "fuzzy and easily garbled, almost like it's multiple overlays". That turned
out to be **three** separate defects, not one.

**1. Cesium rendered at CSS resolution.** `useBrowserRecommendedResolution` defaults to true,
which pins the drawing buffer to one pixel per CSS pixel, so on a HiDPI display every label and
icon was upscaled. Now set to false.

> Do **not** also raise `resolutionScale`. Cesium computes
> `pixelRatio = (useBrowserRecommendedResolution ? 1 : devicePixelRatio) * resolutionScale`,
> so setting `resolutionScale = devicePixelRatio` squares it. Measured: 6400 px of drawing buffer
> for a 1600 px canvas — 4× linear, 16× the fragments — before this was corrected to a clean 2×.

**2. `backdrop-filter: blur(2px)` on panels.** It blurs only what is *behind* the panel, but it
also promotes the element to its own compositing layer, which drops subpixel antialiasing and
visibly softens 10 px letterspaced text. Removed; `--bg-panel` went from 0.82 to 0.90 opacity to
recover the legibility the blur was providing. Panels stay translucent, as the spec requires.

**3. Glyph dropout — the real "garbled".** A screenshot showed the datum label rendering
`[ DATUM 34, 50 FT ]` for 34,650 ft: a digit gone entirely. The datum entity and its label were
being destroyed and re-added on **every poll**, because the rebuild key includes the selected
contact's altitude. That churns Cesium's signed-distance-field glyph atlas. `addPlane` became
`upsertPlane`, which mutates an existing plane's height, position and label text in place — the
same reuse-don't-rebuild reasoning as D-015 for the billboards.

Verified: the datum label entity keeps object identity across polls while its text updates
1,425 → 1,400 → 1,350 FT, and the digit pattern matched on every sample.

---

### D-029 · Altitude owns the icon hue ramp; military moves to magenta. Supersedes D-017.

**Date:** 2026-07-25

**Context:** The owner reported, in the same breath, that the altitude bands were still confusing
and that amber for military was "problematic". Those are the same problem. D-017 spent the only
strong accent on military and confined altitude to a *luminance* ramp inside cyan — a difference
too subtle to read at 22 px, so altitude was effectively not encoded on the contact at all. The
grids were then carrying the entire altitude story, and doing it badly.

**Owner asked directly whether there is a good reason most ADS-B viewers colour-code icons.
There is,** and it is worth writing down: colour rides on the contact itself. It never occludes
anything, it survives any camera angle, and it answers "how high?" rather than only "above or
below this one plane?". A grid in 3D answers the narrower question and only when the perspective
cooperates — while hiding traffic behind it.

**Decisions:**
1. **Fixed band grids removed entirely.** D-010 had already demoted them to secondary context;
   they were not earning their clutter. The **ALTITUDE SLICE** (D-022) remains as the on-demand
   measuring instrument, which is the thing that actually answers separation questions.
2. **Altitude is a hue ramp on the icon:** deep blue → cyan → green → pale yellow, interpolated
   in HSL across 0 / 10k / 20k / 30k / 45k ft. Monotonically descending hue, so no wraparound.
3. **Military is magenta `#ff4fd8`.** It reads instantly against cyan and near-black and collides
   with nothing else. Amber is freed for what it should have been all along: alerts, emergency,
   co-altitude highlighting, and the slice geometry.
4. **A legend is mandatory, not optional.** Colour without a key is decoration. The legend
   swatches are generated by the *same* `altitudeColour()` the icons use, so it cannot drift out
   of sync with the display.

**Consequence for the test suite:** `verify_phase1.py`'s "band planes at 18k/29k" check guarded
something that no longer exists. It was replaced — not deleted — by a check that a low contact
and a high contact actually receive different hues, which is precisely the failure mode the old
luminance ramp had. Rewriting a test to match new behaviour is only legitimate when the
replacement guards the new behaviour at least as tightly; this one guards it more tightly.

**Note for the future theme work (task: colour scheme chooser):** a light mode needs a different
ramp. These lightness values assume a near-black ground.

---

### D-030 · Drop lines: selection only, and all the way to the surface

**Date:** 2026-07-25

**Context:** Owner asked why some drop lines "pin to the sky instead of the ground", and whether
it was to avoid clutter. **It was** — and the honest answer is that the clutter was self-inflicted.

The old rule dropped every contact to the ALTITUDE SLICE if it was inside the slice radius, and
otherwise to the nearest band floor below it, on the reasoning that "a 35,000 ft streak to sea
level is noise". With a line drawn for all ~90 contacts, that was true. The cost was lines
terminating in mid-air on an invisible band floor, which reads as a rendering fault rather than
a measurement.

**Decision:** drop lines are drawn for the **selected contact only**, and run to the surface.
Owner's call, and it dissolves the original objection — one line to the ground is unambiguous,
and ninety are not drawn at all. The `DROP LINE` toggle now says it needs a selection, so it no
longer looks broken when nothing is selected.

---

### D-031 · Filters narrow what is drawn, never what is reported

**Date:** 2026-07-25

**Decision:** The traffic panel's operator rows are clickable filters, and a `MIL` selector filters
to military contacts. Both narrow what the globe **draws**.

**Constraint that makes this safe:** the panel header keeps showing the true total, a `Filtered ·
N of M shown` line appears in amber whenever a filter is active, and the status bar counts stay
unfiltered. A filter that quietly hides contacts is the same class of failure as inventing
them — the operator would be reading a partial picture believing it complete.

The **selected** contact is always drawn even when the filter excludes it; hiding the aircraft
the dossier is currently describing would be incoherent. Operator and MIL filters are mutually
exclusive rather than combining, because military spans many operators and an AND of the two
produces counts that are hard to reason about at a glance.

---

### D-032 · Place markers are vendored and processed at BUILD time, not fetched

**Date:** 2026-07-25

Aircraft positions only mean something against known ground. Implements D-023.

**Decision:** `scripts/build_places.py` turns two public-domain datasets — OurAirports
`airports.csv` and Natural Earth `ne_10m_populated_places_simple` — into one compact
`frontend/src/data/places.json` (385 KB, 5,856 airfields + 7,342 cities) that the frontend
imports. No runtime API, no key, no rate limit, nothing new in the request path, and no
dependency on a third party staying up. Raw downloads are cached in `data/raw/` (already
gitignored); only the processed output is committed. Re-run with `--refresh` to update.

**What is deliberately left out:** small civil airports (42,698), heliports (23,135), seaplane
bases and balloonports. Including them is ~66,000 extra markers worldwide and 321 inside 2°
of Mobile alone — the unreadable mat this project exists to avoid. Large and medium airports
are where the traffic ADS-B actually shows us operates. This is a reversible taste call, not a
technical limit.

**Built once, never rebuilt.** The data is static, so every primitive is created on the first
call and after that only `.show` flips — the D-015/D-028 discipline. Zoom thinning is handed
to Cesium as a per-primitive `DistanceDisplayCondition` (airfields by class, cities by Natural
Earth `scalerank`) rather than recomputed in JS, so it costs nothing per frame.

**Label anchoring:** city names sit centred BELOW their dot, airfield codes to the RIGHT of
their square. A city and its airport are a few km apart, so a shared anchor overprinted pairs
like `KMGM`/MONTGOMERY and `KBIX`/BILOXI into mush. Verified against live traffic.

Both sources are public domain, so attribution is courtesy rather than obligation — unlike
Esri, GEBCO and planespotters. Provenance is recorded in the generated file's `_sources`.

---

### D-033 · Military airfield detection is a NAME heuristic, and says so

**Date:** 2026-07-25

The plan in the previous handoff assumed OurAirports has a military `type` value. **It does
not**, and it has no `military` keyword either — verified: 0 of 25,104 US non-closed airports
carry one, and the only `type` values are large/medium/small_airport, heliport, seaplane_base,
balloonport, closed.

**Decision:** classify military airfields by matching the airport **name** (`AFB`, `Air Force
Base`, `Air Base`, `Naval Air Station`, `NAS`, `Army Airfield`, `AAF`, `MCAS`, …). This is
derived from real data in the file rather than an invented attribute, so it stays inside
ground rule 1. It generalises internationally — "Air Base" carries most of the 529 non-US
large/medium hits — and near Mobile it correctly catches Keesler, Maxwell, Tyndall, Hurlburt,
NAS Pensacola, both Whiting Fields, NAS Meridian, NAS JRB New Orleans and Cairns AAF.

**Known false negatives, stated rather than hidden:** `KVPS` is Eglin AFB but is named
"Destin-Fort Walton Beach Airport", so it renders civil. `KEGI` (Duke Field) likewise. This is
NOT an authoritative order of battle and must never be presented as one.

Military airfields take `--mil` magenta, the same accent military *contacts* use (D-029). The
two cannot be confused: a contact is an aircraft silhouette in the air, an airfield is a
filled square on the ground.

---

### D-034 · The ALTITUDE SLICE is suppressed when the camera has no perspective on it

**Date:** 2026-07-25

Owner feedback from the live display. Seen from directly overhead the slice projects to a flat
sheet covering the display: it conveys no height whatsoever and occludes the traffic and
terrain underneath it. Seen edge-on from the horizon it degenerates into a bright band smeared
across the scene. Either way it costs visibility and returns nothing.

**Decision:** draw the slice only while camera pitch is between **-70° and -12°**. Bounds are
set against the presets in `CameraCluster`: `PLAN VIEW` (-89.9°) and `HORIZON VIEW` (-9°) are
both suppressed, the default perspective view (-32°) is kept.

**Co-altitude amber on the icons is NOT suppressed.** That is the readout which still works at
those angles, and it is the reason losing the slice geometry costs nothing.

Camera pitch is published to the store only when it moves a whole degree, and enters the
slice's rebuild key as a boolean — keying on the raw angle would rebuild the slice on every
degree of camera movement, which is exactly the churn D-028 removed.

The toggle states **"needs a tilted view"** when it is on but withheld, for the same reason
D-022 added "needs a selected contact": on-and-invisible is indistinguishable from broken.

---

### D-035 · Clicks DRILL for a contact, and the flaky click check was the harness

**Date:** 2026-07-25

`scene.pick` returns only the frontmost primitive. Because a pick miss returns `null` and
`null` means *deselect*, anything drawn over a contact could swallow the click and clear the
dossier instead of switching to it. The ALTITUDE SLICE rectangle could already do this; D-032
added ~26,000 ground primitives and would have made it routine.

**Decision:** `aircraftLayer.pick()` uses `scene.drillPick(pos, 8)` and returns the first
ADS-B contact in the stack. Click-empty-to-clear still works — a click that genuinely hits no
contact still returns `null` — but a contact behind a place label or the slice is now
selectable. Runs on click only, never per frame.

**Root cause of the intermittent `verify_phase1.py` click check, which was a different thing
entirely.** The previous handoff's leading hypothesis (the slice rectangle stealing the pick)
was **wrong**: measured over 30 contacts, 0 were blocked by an overlapping primitive. The real
cause was in the harness — it chose the first contact projecting inside a 60 px border without
checking what was actually at that point, so it would happily click a contact drawn *behind*
the AIR TRAFFIC panel. The panels are `pointer-events-auto`, so the panel ate the event and
the canvas never saw it. The failing run clicked (134,259), squarely inside that panel.

**Fix:** the harness now requires `document.elementFromPoint()` at the target to be the globe
`CANVAS`. 9/9 on three consecutive runs, where the previous rate was roughly 1 failure in 3.
The drill-pick change above is still correct and worth keeping, but it was not the bug.

---

### D-036 · The dossier gets its own, larger type scale

**Date:** 2026-07-25

Owner feedback: the dossier was still too small to read at their preferred 100% browser zoom.

**Decision:** the dossier widens to **344 px** and takes a `.panel--dossier` type scale —
11 px labels, 15 px values, 14 px header. Scoped to this one panel deliberately: the traffic
list, legend and cursor readout are *glanceable* chrome and stay small, whereas the dossier is
the one panel that is actually **read**. Model and operator truncate at 32 characters instead
of 26 now that there is room, with the full value still in the hover title.

---

### D-037 · Err on the side of legibility: large/medium airfields only, cities to scalerank 7

**Date:** 2026-07-25

Owner instruction after seeing D-032's first pass on the real display: *"drop smaller places,
heliports, etc. Err on the side of legibility"* and *"exclude heliports"*.

**Decision, superseding the inclusion rule in D-032:**

- Airfields are **large_airport and medium_airport only**. Heliports, small airports, seaplane
  bases and balloonports are excluded outright.
- **The exclusion applies to military fields too.** Military is a *colour* distinction inside
  the large/medium set, never a reason to add a marker back. This is the substantive change:
  D-032's name heuristic had been pulling in military heliports and outlying fields regardless
  of type, which is where markers like `1MS8` and `3MS4` came from. Military count drops from
  1,208 to 627 — 581 of the originals were heliports, small fields or a balloonport.
- Cities above **Natural Earth scalerank 7** are dropped at build time (1,815 of 7,342). Around
  Mobile this keeps Montgomery, Mobile, Pensacola, Biloxi, Selma, Gulfport and Hattiesburg, and
  drops the Slidell / Crestview / Meridian / Laurel tier that was filling in the gaps.
- Display ranges tightened with it: large 2,500 km, military 900 km, medium 450 km; cities
  9,000 / 3,000 / 1,000 / 400 km by scalerank band.

Totals: **10,802 markers, down from 13,198**; the generated JSON drops 385 KB → 313 KB.

**Known residual, not fixed:** where an airfield pair and a city sit within a few km — Maxwell
AFB, Montgomery Regional and Montgomery itself — three labels still overlap at wide zoom, and
they separate as you zoom in. Cesium's `LabelCollection` has no declutter, so fixing this needs
a real collision-avoidance pass. Deliberately not attempted; the cheap fix would be dropping
one of the three, which loses information the operator asked for.

---

### D-038 · Airfield markers are clickable, and the panel states the limits of what it knows

**Date:** 2026-07-25

Owner: *"If we are going to include these military airfields (I assume because they are magenta)
we have to provide some kind of detail when the user clicks on them."* Correct — a magenta
marker asserts significance, and before this a click on one returned `null`, which *deselected*
whatever was in the dossier.

**Decision:** airfields (civil and military alike — a class of marker either is or is not
interrogable) resolve to a `PlacePanel` showing name, class, field size, IATA, city, region,
country, elevation and coordinates. Marker **and** label are both hit targets; a 10 px square
alone is a mean thing to ask anyone to hit. Aircraft still win the pick — the traffic is the
subject — and a click hitting neither still clears, so click-empty-to-clear survives.

The build now carries the detail fields it had been discarding, so the generated JSON grows
313 KB → 631 KB. No new network call: this is all build-time data, which is why the panel has
no pending state. A blank field means the SOURCE is blank and renders as an em-dash.

**The panel names its own limits**, because a detail panel is exactly where a heuristic starts
looking like an authority: military entries carry *"class inferred from field name · not an
authoritative source"* (D-033), and every entry is credited to OurAirports. Cities are
deliberately NOT clickable — a city dot is context, not a contact, and there is nothing to say
about it that the label does not already say.

Selecting an airfield clears the aircraft selection and vice versa: the right column is
height-bounded and two stacked dossiers would push one off screen.

---

### D-039 · Airfield codes are cyan or magenta; only cities are dim

**Date:** 2026-07-25

Owner: *"I want to make the airport names more legible and a different color than City names."*
This was a defect in D-032's own colour choices, not a preference — **medium airfield labels
were `--dim`, the same token cities use**, so `KMOB` and `KBFM` rendered as though they were
town names, dim and indistinguishable.

**Decision:** colour encodes CLASS and size encodes importance. All airfield codes are cyan
(civil) or magenta (military); cities alone keep `--dim`. Large versus medium is carried by
marker size (13 px vs 10 px) and type size (12 px vs 11 px) rather than by dimming the label,
which is what destroyed the distinction in the first place.

---

### D-040 · Weather radar: NEXRAD, one translucent layer, OFF by default

**Date:** 2026-07-25

**This reverses CLAUDE.md's "no weather" non-goal**, on the owner's explicit instruction:
*"weather radar: add it, default off, toggle"*. The reversal is narrow — one imagery layer.
No forecasts, no alerting, no lightning, no soundings.

**Source:** Iowa State Mesonet's WMS render of NOAA/NWS NEXRAD base reflectivity
(`nexrad-n0q-900913`). Free, keyless, US public domain data; IEM credited for the hosting.
Verified live before building: a CONUS `GetMap` returned real convective cells, and the
`-900913` layer serves EPSG:3857 so it matches Cesium's tiling scheme without server-side
reprojection. US coverage only — elsewhere the layer is simply transparent.

**Why OFF by default, and why that is not timidity:** reflectivity ramps green → yellow →
orange → red, and the altitude hue ramp (D-029) already spends green at 20,000 ft, yellow-green
at 30,000 and pale yellow at 45,000. With both on, colour stops being a single unambiguous
encoding — the exact defect D-029 was adopted to fix. Radar is therefore something you switch
on to answer a question, not part of the resting display. Alpha 0.55 so it reads as an overlay
rather than a basemap.

**Staleness is handled, not ignored.** Frames publish about every five minutes, so the layer
rebuilds itself on that interval *while visible* (the request carries a frame-bucket
cache-buster; otherwise the browser and Cesium both happily serve an hour-old frame). Nothing
refreshes while hidden, and the toggle reads `NEXRAD · US · ~5 min old` so an empty layer says
"no echo, or outside coverage" rather than looking broken. Radar credit appears in the
attribution line **only while the layer is on** — crediting a source we are not drawing would
mislead as much as failing to credit one we are.

**Stated limit:** base reflectivity is a GROUND-PLANE product draped on the ellipsoid. It is
not the weather at the selected contact's altitude. The honest reading is "there is a cell under
that deviation", never "that aircraft is in this".

All knobs are `VITE_`-prefixed build-time env vars (D-019), documented in `.env.example`.
`maximumLevel` is capped at 10 because radar is ~1 km data and further zoom is pure upscaling,
which would imply precision the source does not have.

---

### D-041 · Remote access: one token per person, a signed cookie, prefs in localStorage

**Date:** 2026-07-25

**This reverses "No accounts. No multi-user."** — narrowly, and on the owner's explicit
instruction: they want their brother to open a URL and have it work, with a real token and
settings that stick. Runbook: `docs/remote-access.md`.

**What it is:** a shared-secret door in front of a single-user console. `LORAN_ACCESS_TOKENS`
maps `name:token` pairs to principals; `GET /api/session?t=…` trades a token for an
HMAC-signed `HttpOnly` cookie. No registration, no password reset, no roles beyond
owner-or-not. Calling it auth rather than an account system is the honest description.

**Decisions inside the decision:**

- **Disabled unless configured.** With no tokens set, every request is the owner and behaviour
  is byte-for-byte what it was. An open-source user is never silently running an auth system,
  and CLAUDE.md's single-user default stays true. Verified: with auth off, `/api/track` answers
  200 with no cookie.
- **A link is the whole login**, because "no hoops" was the requirement. The cost is a bearer
  credential in a URL, so the frontend spends it once and **strips `?t=` via `replaceState`** —
  otherwise a live credential sits in history and in the address bar for the next person to
  copy. Verified in a browser: the URL is back to `/` after load.
- **HMAC cookie, stdlib only.** `hmac`/`hashlib`, no new dependency (rule 2).
- **The cookie key derives from the tokens** unless overridden, so sessions survive restarts
  with no extra secret to manage, and removing a token revokes its sessions. Verified: a cookie
  minted for `brother` is rejected once `brother` leaves the config.
- **`/api/health` stays open** so the service can be checked from outside without a token. It
  reports uptime and feed status only — no positions, no airframe data.
- **The static shell is NOT gated.** An unauthorised visitor gets the app plus the compiled-in
  airfield and city labels — public reference data — and an explicit **ACCESS TOKEN REQUIRED**
  panel stating that nothing on screen is current. A blank globe would be indistinguishable
  from a dead feed and would send them to the owner asking the wrong question. A 401 is
  therefore reported as "not authorised", never through `setFetchFailed` as a feed outage.
- **One origin.** `LORAN_STATIC_DIR` serves the built app from the API process
  (`scripts/serve.sh`), so there is no CORS, one port to tunnel, and a same-site cookie by
  construction. The static mount is registered last so it can never shadow an `/api` route.

**Preferences are per browser, in `localStorage`**, via zustand's `persist` with an explicit
allow-list. Only inert UI state is written: toggles, filter, slice radius, separation. Live data
is excluded deliberately — restoring a cached aircraft list or stale selection would put
positions on screen that nothing has confirmed since, which is ground rule 1 in the easiest
place to break it by accident. The allow-list *is* the safety property: future state cannot
start persisting positions without someone adding it by name. Server-side prefs were rejected
as the wrong trade — they need a schema (triggering the Phase 5 DDL review gate) to buy
cross-device sync nobody asked for.

**The exposure mechanism is a Cloudflare tunnel** (owner's choice): outbound-only, no forwarded
ports, TLS handled. Recorded trade-off — Cloudflare terminates TLS and can see traffic in
principle.

**Deliberate terms departure, recorded plainly.** planespotters clause 8 forbids re-exposing
their API and `docs/data-sources.md` records our mitigation as *"never expose it publicly"*. The
owner was shown this and chose to serve photos to both people. Therefore
`LORAN_PHOTO_GUEST_ACCESS` exists, **defaults to `false`**, and this repository ships the
compliant default — the owner sets it `true` in their own gitignored `.env`. That keeps a public
open-source repo from shipping a terms violation as its out-of-the-box behaviour while giving
the owner exactly the deployment they asked for. When photos are withheld, the response carries
an explicit reason in `errors`: "we will not tell you" and "there is no photo" must not look
identical.

**Not done, and stated rather than implied:** no per-user rate limiting (unnecessary — the
global 1 req/sec gate in `feeds/adsb.py` makes extra viewers queue rather than breach the
upstream budget, so freshness degrades and compliance does not), no audit log by design, no
protection against whoever holds the link.

---

### D-042 · One palette: tokens.css is the source, TypeScript derives from it

**Date:** 2026-07-25

Groundwork for the parked colour-scheme chooser, and a fix for real duplication that had
started spreading.

**The problem, measured:** Cesium draws with concrete colour strings and cannot read CSS custom
properties, so every globe colour was a hex literal inside the layer that drew it — **19
literals across 6 files**, including four tokens copied verbatim into `placesLayer.ts` when it
was written earlier the same day. A palette in two places is a palette that drifts, and it made
theming a hunt rather than a config change.

**Decision:** `tokens.css` remains the hand-written source of visual identity, exactly as
CLAUDE.md requires, and `frontend/src/styles/palette.ts` reads the custom properties back out at
runtime. The direction of truth matters: defining colours in TS and injecting them into CSS
would have inverted it and demoted the token file to generated output.

- **DOM code does not use this.** React inline styles say `var(--cyan)` directly, which is why
  `ErrorBoundary` just uses the token. `palette()` exists only for Cesium.
- Four globe-only colours that previously existed *only* as TS literals are now real tokens:
  `--icon-stroke`, `--icon-stroke-mil`, `--icon-stroke-alert`, `--icon-selected`.
- **Reads are lazy, and that is load-bearing.** `palette()` memoises, and calling it at module
  scope could run before the stylesheet applies, cache the fallbacks, and leave the globe
  permanently on fallback values. Since the fallbacks equal the tokens, nothing would *look*
  wrong — it would only break the future theme chooser, silently. So `placesLayer` builds its
  styles inside `createPlacesLayer`, and `altitudePlanes` exports `amber()`/`cyan()` getters
  rather than constants.
- `refreshPalette()` exists and nothing calls it. It is the hook a chooser needs, and it is here
  because the memo is precisely what would make such a chooser appear not to work. A chooser
  would also have to rebuild any Cesium primitive holding a baked colour.

**Drift is now a build failure.** `npm run check:palette` (wired into `npm run build`) parses
both files and fails if `palette.ts`'s documented fallbacks disagree with `tokens.css`. A
fallback that silently disagrees with the real token is worse than no fallback: the globe would
draw one colour and the chrome another, intermittently, depending on load timing. Verified in
both directions — it passes on 11 colours, and deliberately breaking one produced
`--mil: tokens.css says #ff4fd8, palette.ts fallback says #ff0000` with a non-zero exit.

**Verified live, not by inspection:** temporarily setting `--mil` to `#00ff00` in `tokens.css`
made the military airfield markers render `#00ff00` on the globe. That is the proof the values
come from CSS rather than from the fallbacks, which colour comparison alone cannot establish
because the two are identical by design.

**Still not themeable, stated rather than implied:** `DarkBathymetryProvider` remaps GEBCO
pixels through hardcoded `SHOAL`/`MID`/`ABYSS`/`LAND_LO`/`LAND_HI` ramps. Those are left alone
deliberately — they are algorithm constants held in parity with `scripts/make_dark_bathy.py`,
and moving them would break that documented pairing. A light theme needs a second remap there,
plus re-derived lightness in the altitude ramp (which assumes a near-black ground). Those two
remain the real cost of light mode; this decision only removes the scattered-literal problem.

**The chooser itself stays parked as FUTURE**, per the owner.

---

### D-043 · The project is named LORAN

**Date:** 2026-07-25

`adsb-viz` was always a placeholder, and it fails the project's own roadmap: Phase 4 adds
**vessels**, so an aircraft-only name would be wrong within one phase.

**Decision:** the project is **LORAN** — display `LORAN`, slug and identifiers `loran`, env
prefix `LORAN_`.

**Why it fits.** LORAN (LOng RAnge Navigation) was used by *both ships and aircraft*, which is
exactly the air-and-sea scope this console is heading for. It is terse and belongs to the
instrument era the visual direction already borrows from. It was decommissioned in 2010, so
there is no live product or trademark to collide with. It implies neither a service nor a
consumer tracker.

**Owner chose it from a shortlist checked against GitHub for real** rather than by assumption —
an earlier check had silently reported every candidate as free because it queried a misspelled
field, which is why a control query for known-crowded names (`readsb` 641★, `tar1090` 1846★) was
run before trusting the results. `perch` (google-research, 375★) and `racon` (isovic, 299★) were
eliminated that way; `vantage` (3419★) and `plotter` (188★) in a second round. `loran`'s busiest
exact-name match is 11★.

**Recorded caveat:** LORAN was a *navigation* system — it told you where **you** are. This is a
*surveillance* display — it shows where **others** are. The owner accepted that mismatch; it is
noted here so nobody later "discovers" it as a problem.

**Scope of the rename:** ~181 occurrences across ~20 files. `LORAN_*` for all 32 environment
variables, `loran` for the package name, FastAPI title, log directory, User-Agent product token,
the session cookie (`loran_session`) and the prefs key (`loran.prefs`). The last two reset
existing sessions and stored preferences once — a link re-open, and acceptable pre-release.
Earlier entries in this log keep their original wording; only environment-variable names were
updated inside them, so the log stays actionable without rewriting past decisions.

**Not renamed, deliberately:** the working directories (`~/dev/adsb-viz`, the worktree) and the
shared coordination directory. Those are shared with another checkout and a worktree journal, so
moving them is an infrastructure change that needs to happen deliberately rather than as a side
effect of a text substitution.

**Bug found while renaming, and fixed:** `.env` never set a User-Agent, so every upstream request
had been going out as `…(+mailto:unset@example.com)`. planespotters *requires* a contact address
and the volunteer ADS-B feeds deserve a real one, so this was quietly impolite at best and
dishonest at worst. Now set to a real address; verified planespotters still returns 200 with it.
It also confirms the handoff's suspicion that their UA gate is looser than documented — a
placeholder contact was being accepted all along.

---

### D-044 · Open-source prep: MIT, a real contact address, and a README with real screenshots

**Date:** 2026-07-25

The repository is public, so these were no longer optional.

**Licence: MIT** (owner's choice), with an appended **note on data** that the licence does not
cover. That note matters more than the licence text here: MIT on the software could easily be
read as permission to do anything with what the software *fetches*, and several upstreams are
non-commercial (airplanes.live, adsb.fi), share-alike (adsb.lol, ODbL 1.0), or forbid
re-exposing their API entirely (planespotters clause 8). The note also records that being
single-user by design is part of what keeps this inside those terms — so a fork that adds
multi-tenancy is not automatically in the clear.

**Contact address is now `adsb@voygent.ai`**, replacing a personal address that would have been
published in two tracked files. Verified planespotters still returns 200 with the new UA.

**README screenshots are real captures of live traffic**, produced by `scripts/shoot_readme.py`
against the running app — ground rule 1 applies to documentation too, and a mocked screenshot is
exactly the "plausible fake" that rule exists to forbid. The script refuses to write anything if
the feed returns no contacts, and refuses to write the airfield shot if no airfield panel is
actually open, because a screenshot of a missing panel misrepresents the feature.

Two things learned writing that script, both fixed in it:

* The first capture clipped the dossier at 950 px, hiding the photo block. A screenshot of a
  clipped panel makes a dense display look broken, so the viewport is now 1150 px tall.
* The first attempt selected the *first* contact in the list, which was off-frame — so the
  altitude slice and drop line it was meant to illustrate were not in the picture. It now picks
  the contact nearest the centre of the screen. Likewise the airfield click retries several
  fields and both marker and label, because **aircraft win the pick by design** and an icon
  sitting over a marker will silently take the click.

The README states plainly what is *not* built (vessels blocked on an antenna, no recorder, no
Docker, **zero unit tests**) alongside what is. A status section that lists only strengths is the
documentation equivalent of a fake screen.

---

### D-045 · Docker: one image, one origin, no secret in any layer

**Date:** 2026-07-25

Completes D-019's requirement that Docker and bare metal both stay first-class. The container
reproduces exactly what `scripts/serve.sh` does — the built frontend and the API served from one
process on one port — because single origin is what makes the session cookie same-site by
construction and leaves one port to tunnel.

**Multi-stage build.** `node:22-slim` builds the frontend, `python:3.12-slim` runs it; no Node,
npm or build tools in the runtime. 175 MB. The build context is the repo root rather than
`frontend/`, because the frontend build needs `scripts/check_palette.mjs` — the D-042 guard —
which means **a palette drift or a type error fails the image build** instead of shipping
quietly. Confirmed in the build log: `check:palette ok - 11 colours match`.

**Nothing is configured at build time.** `.dockerignore` excludes `.env` from the build context
entirely, so a secret cannot reach a layer even by mistake; configuration arrives at run time via
`env_file`. Verified rather than asserted: no `.env` exists anywhere in the image, and grepping
every layer of `docker save` output for the live access token returns zero hits. The container
also runs as uid 10001 with `no-new-privileges`, a read-only root filesystem and a tmpfs for
`/tmp`.

**`0.0.0.0` inside, `127.0.0.1` outside.** The CMD binds all interfaces because container
loopback is unreachable from the host, but compose publishes to `127.0.0.1:8010` only. Binding
the published port to `0.0.0.0` would expose the console to the whole LAN — and with
`LORAN_ACCESS_TOKENS` empty there is no access control at all. The comments say so at both ends.

**Healthcheck uses `/api/health` via stdlib `urllib`**, not curl. `curl` is absent from slim and
adding a package purely for a probe is weight for nothing; `/api/health` is deliberately open and
reports uptime and feed status only, so it works as a probe even with tokens configured.

**A volume is declared for `/app/data` before anything needs it.** Nothing writes to disk today,
but the Phase 5 recorder will, and a container that silently loses the archive on restart is a
worse outcome than discovering the volume requirement late.

**Trap found and fixed while testing:** `.env.example` shipped `LORAN_STATIC_DIR=` **empty**.
Copied to `.env` and passed through `env_file`, that empty value overrides the image's own
`/app/static`, so the container serves the API with no app behind it and `/` returns 404 — a
first-run failure for every Docker user, with a confusing symptom. The line is now commented out
with an explanation of exactly that failure mode.

Verified running: healthcheck reports healthy, `/` 200, `/api/aircraft` 401 without a token, 200
with the owner token and 41 live contacts, photos returning, and the Vite dev server on 5173
proxying to the container so the normal development URL keeps working against one API process.

---

### D-046 · Measured: four of five upstreams allow browser-direct calls. A single-file build is viable if photos go.

**Date:** 2026-07-25

Owner asked whether the whole thing could run as one self-contained HTML page, given it needs no
API keys. Measured rather than guessed, with `Origin: https://example.com`:

| Upstream | Status | `Access-Control-Allow-Origin` |
|---|---|---|
| airplanes.live | 200 | `*` |
| adsbdb | 200 | `*` |
| GEBCO WMS | 200 | `*` |
| NEXRAD (Iowa State Mesonet) | 200 | `*` |
| **planespotters** | **403** | `*` |

GEBCO having `*` is the load-bearing surprise: `DarkBathymetryProvider` reads tile pixels on a
canvas to remap depth, which taints without CORS. It has CORS, so the dark basemap works
client-only.

**planespotters cannot be fixed from a browser.** Their gate is on `User-Agent`, and `User-Agent`
is a *forbidden header* in the fetch spec — script cannot set it, so the request goes out with the
browser's own UA and returns 403. No proxy-free workaround exists. This also settles the open
question from the previous handoff about their gate behaving inconsistently: it is the UA, and a
browser simply cannot present a compliant one.

**Owner's ruling:** losing photos is an acceptable price for a true "download one file and open
it" build, even at a large total download.

**Logged as FUTURE, not started.** What remains is a packaging problem rather than an API one:
Cesium fetches `Workers/`, `Assets/` and `ThirdParty/` at runtime from `CESIUM_BASE_URL` —
hundreds of files — so a genuine single file needs them inlined as data or blob URLs, landing
somewhere around 15–20 MB of HTML. Also lost: the shared upstream cache (each open page polls for
itself), the server-side track ring buffer, the Phase 5 recorder, and the token door.

Note it is never *offline* either way: the app code would be self-contained, the data and map
tiles still come from the network. "Self-contained" here means no server to run, not no network.

A middle option worth remembering: keep a minimal backend for photos only and let the browser call
everything else directly. That removes most of the server's reason to exist while retaining the
one thing it is genuinely required for.

---

### D-047 · The ALTITUDE SLICE is demoted; a forward projection envelope replaces it

**Date:** 2026-07-25

Owner, looking at the live display: *"the altitude slice is not cutting it for me… the big amber
square is just useless to me for now."* Fair. The slice answered "who else is at this flight
level", and that was not a question the owner had; the cost was a large amber quad occluding the
ground. D-010, D-022 and D-034 were all attempts to make it work.

**Decision:** the primary instrument is now a **forward projection envelope** — asked for as a
hurricane-style cone. The slice stays in the codebase but **defaults off**; it is still the right
tool for "who else is at this level" if that question ever arises.

**What the shape means, stated precisely, because this is where a display like this starts to
lie:** *where the contact will be within the next N minutes IF it holds its present groundspeed
and stays within ±SPREAD degrees of its present track.* It is a **stated assumption, not a
forecast.** No probability is attached and the width is not an error bar — it is a parameter the
operator sets (2/5/10 min, ±5/10/25°).

The hurricane analogy is where the honesty problem lives, so it was worked through rather than
copied:

* A hurricane cone's width **is** a measured probability envelope, derived from decades of
  forecast error. We have no equivalent error model for aircraft, and inventing a width that
  implied one would be precisely the plausible-fake ground rule 1 forbids.
* A true **reachable set** would be honest geometry, and was rejected as *useless* rather than
  dishonest: at 425 kt an airliner at 25° of bank turns about 1.2°/s, so within five minutes it
  can come all the way around. The reachable set is very nearly a disc, which tells the operator
  nothing.
* So the envelope is an explicit **what-if**, parameterised by the operator, and the on-screen
  label carries the assumption — `[ +10 MIN · ±10° · 397 KT · 8,850 FT ]` — rather than just a
  time, which would read as a prediction.

**It slopes with vertical rate.** A contact descending at 1,280 fpm is 12,800 ft lower after ten
minutes; drawing its envelope flat at the current altitude would put it in the wrong place
vertically almost immediately, and altitude being real is the whole premise of this project. The
label states the projected altitude whenever |V/S| ≥ 100 fpm. Verified against UAL497: 21,650 ft
descending 1,280 fpm produced an envelope ending at 8,850 ft.

**Nothing is drawn without a track and a speed.** A contact with no ground track has no direction
to project along, so no envelope appears rather than a guessed one.

Minute rungs across the envelope give it a range scale, and are geometry rather than text —
labelling every minute would churn the glyph atlas that D-028 was about.

**`coneGeometry()` is exported as a pure function** so it can be tested without a browser or a
Cesium viewer. The project still has zero unit tests; this is deliberately written to be one of
the first.

**Persist migration matters here.** Preferences are stored in `localStorage` (D-041), so any
browser that had already saved `showDatum: true` would have kept drawing the very square the owner
asked to be rid of — a changed *default* does not reach anyone who has already persisted the old
value. The store version is bumped to 2 with a migration that forces the slice off. Verified in a
real browser: `showDatum` came back false after the migration.

`verify_phase1.py` now switches the slice on explicitly before asserting it appears. The check is
worth keeping, and a default change must not be allowed to masquerade as a broken feature.

---

### D-048 · Controls move left, the dossier gets the right column, map labels get their own colour

**Date:** 2026-07-25

Three owner observations from the live display, all correct.

**"Aircraft detail panel is still too small, doesn't show photo without scrolling."** The cause was
layout, not size: `CameraCluster` and `LayerCluster` sat *above* the dossier in the same
height-capped right column, so the dossier got whatever they left and the photo fell below the
fold. Both controls move to the **left** column under `AIR TRAFFIC` (owner's choice between the
options), and the right column is the dossier's alone. Verified: the dossier now renders through
CO-ALT and DATUM RADIUS with the photo block in frame.

**"Default text the same color as water is not good design."** Correct, and it was accidental
rather than chosen: city labels used `--dim` (`#5a6b7a`), which is close to the shelf-water tone of
the dark GEBCO ramp they are drawn over. Map labels now have their own token, `--map-label`
(`#9db2c4`), lifted clear of both the water and the land ramp. `--dim` stays what it always was —
panel chrome — and `npm run check:palette` covers the new token (12 colours).

**"Translate origin and dest to names."** We were already holding the answer and hiding it: adsbdb
returns `municipality` and `name` for both ends, and the dossier showed only the code with the name
buried in a hover title. Origin and destination now read `San Jose SJC` / `Denver DEN`. Falls back
to the bare code when adsbdb has no place name, and to an em-dash when it knows nothing — never an
invented city. `airportCode()` became dead when `airportPlace()` replaced it and was removed, since
this change is what orphaned it.

---

## D-049 — Tracks were never broken; they were one-shot and hard to find. Denser place labels.

**Date:** 2026-07-25

**"Aircraft tracks do not display" was not a bug.** The previous session logged it as one and left
a half-diagnosis behind. It is worth recording what it actually was, because the investigation
cost real time and the wrong conclusion was already written down twice.

Instrumenting the live app showed the whole path was healthy: the `track::` subscriber fired, the
entity was created with 166 real positions, `isShowing: true`, cyan at the right width and alpha,
and every point projected inside the viewport. The owner then confirmed on their own display that
the track draws fine. The fault was **discoverability** — `TRACK` sits near the bottom of a long
dossier, below the photo, and was simply not found.

Two cautions this leaves behind. First, the previous session's "candidate causes worth ruling out"
list did not include "it works" — the bug report was taken as given. Second, the headless capture
harness on this box runs at **~1 FPS on software GL and renders entity polylines
non-deterministically**: across identical runs, a width-6 line painted once and vanished the next.
It is sound for reading STATE and worthless for judging PIXELS. Do not conclude "invisible" from a
headless screenshot; that nearly produced a third wrong theory here.

**The track now loads on selection** and `TRACK` becomes an explicit re-read (and the way to undo
`CLEAR`). Selecting a contact is already the gesture that means "tell me about this one".

**The track also has to keep up.** As shipped it was read once, so the line stopped where the
contact was when it was read and the aircraft flew away from its own history — which reads as if
it stopped there, exactly the plausible-looking wrong picture ground rule 1 exists to prevent. It
now re-reads every 5 s while selected. The **backend ring buffer stays the single source**: we
re-read it rather than appending live fixes client-side, so the drawn path and what `EXPORT`
writes can never disagree. 5 s is the buffer's own `sample_s`, so asking faster could return
nothing new. A failed refresh keeps the last good track — a feed hiccup is not evidence that the
history already read was wrong. `CLEAR` is re-checked when a refresh lands, not only when it is
sent, because a reply in flight would otherwise undo it.

**Map labels get a dark halo, not another colour.** D-048 lifted city labels to `--map-label` and
the owner reported the problem persisted. Recolouring could not fix it, because what a map label
sits on is not one colour: the same name crosses dark land, lit shelf water, terrain relief and
radar echo. Every label in the app was `LabelStyle.FILL`. Place labels are now
`FILL_AND_OUTLINE` with a 2px `--bg` halo at 0.85 alpha — the standard cartographic answer, and
instrumentation rather than decoration: no glow, no filled box, no new token, so the palette guard
stays at 12 colours. Aircraft labels still use `FILL` and were left alone.

**D-037's city cap was the wrong instrument, and is reversed.** It dropped everything above Natural
Earth scalerank 7 at BUILD time to control clutter. But clutter is a ZOOM problem, and zoom
thinning already solves it — every city carries a `DistanceDisplayCondition` keyed on its rank.
Capping the build instead threw away the minor towns that tell an operator *where* a contact is,
leaving wide stretches of map with nothing named. `MAX_CITY_SCALERANK` goes 7 → 10: cities
**5,527 → 7,342**, `places.json` 631 KB → 687 KB. Ranks 8–10 are given short ranges (250 km, then
150 km) so they name the map only when the camera is close enough for a minor town to be the most
useful thing to name.

**DENSITY (STD / MORE / MAX) scales range, not membership.** It multiplies every place's visible
range by 1, 2 or 4, rescaling the existing primitives rather than rebuilding ~25,000 of them. It
**cannot invent places**: a row not built into `places.json` can never appear, which is why the
build had to widen first. Persisted per browser via the allow-list.

**Small airports remain excluded, deliberately.** Adding them is the next available lever and it is
a big one: **+42,698 rows worldwide** (2,154 within 6° of Mobile), roughly 8× the airport rows and
~3 MB of JSON. D-037's reasoning for excluding them — large and medium airports are where the
traffic ADS-B actually shows us operates — still stands, and overturning it is the owner's call,
not a side effect of a density change.

---

## D-050 — Dashed line to the FILED destination. Map labels leave the water's hue family.

**Date:** 2026-07-25

**Map labels are near-white now, and the reason the last two attempts failed is the point.**
D-032 used `--dim` (`#5a6b7a`). D-048 called that a mistake and moved to `--map-label`
(`#9db2c4`). D-049 added a dark halo. The owner reported the same fault after every one of them:
*"text the same color as the ocean."* All three fixes changed **lightness while staying inside the
water's own hue family** — blue-grey text on blue-grey sea. Lightness was never the variable that
mattered. `--map-label` is now `#e9edf0`, effectively white: it cannot be mistaken for sea, land
or radar echo, it is what aeronautical charts use for place names, and it stays clear of the
cyan/magenta D-039 reserved for airfield codes, so a city still cannot read as an airfield. The
halo stays — it is what keeps the label readable over a bright radar cell.

Worth recording for whoever fixes the next legibility complaint: **changing a colour's lightness
three times is not three attempts, it is the same attempt three times.**

Note for testing this class of change: `placesLayer` builds its ~12,600 labels **once**, when the
globe mounts. Vite HMR reloads the module without rebuilding them, so a label change does not
appear until a full page reload — which can look exactly like "the fix did not work".

**The destination line is dashed, level, and says FILED.** adsbdb already carried `lat`/`lon` for
both ends of the route; we were drawing neither.

It must not look like the projection envelope, and the difference is not cosmetic. The envelope is
a **kinematic what-if we compute** — where the contact reaches if it holds this speed and track
(D-047). The destination is a **fact reported about the flight plan**, which the aircraft is under
no obligation to honour. So the envelope stays solid amber (amber is the colour of instruments we
derive) and the destination is dashed cyan at 0.55 alpha (cyan is reported civil data), dimmer
than the solid cyan track because "where it has been" is a stronger claim than "where it says it
is going". The label reads `FILED KLAS`, not `KLAS`, so the operator never has to remember which
line is which.

**It is drawn as a level run plus a plumb drop, and that shape is the honest part.** The obvious
implementation — one straight line from the aircraft down to the runway — would render a **descent
profile we have not computed and have no source for**, exactly the plausible-looking invention
ground rule 1 forbids. Instead: a great-circle run held at the contact's current altitude, ending
above the airfield, then a vertical plumb line down to the ground. That claims only what we know —
this bearing, this distance, and the destination is on the ground beneath that point. The plumb
line reuses the idiom DROP LINE already established, so it reads as "the ground is below here"
rather than as a flight path.

`levelArc()` interpolates the great circle itself rather than handing Cesium two points and
`ArcType.GEODESIC`, because Cesium arcs across the *surface*: the intermediate points have to carry
the aircraft's altitude or a long leg sags through the terrain. It is pure and exported, so it is
another candidate for the first unit test alongside `coneGeometry()`.

**No coordinates means no line.** adsbdb knows the route for some flights, and coordinates for
fewer; when it does not, nothing is drawn and the dossier's em-dash stands. Never a guessed
airport. Verified live on FFT1257 → KLAS: the level run held 12,367 m end to end against a
40,575 ft contact, the plumb dropped 12,367 m → 0, and the toggle removed all three entities.

The destination inputs had to enter the render subscriber's key. The enrichment reply lands well
after the selection does, so without it the line would never appear for a contact whose route
arrives a moment later — which is all of them.

---

## D-051 — vitest + pytest. 69 unit tests, and the first one found a real bug.

**Date:** 2026-07-26

Owner approved both frameworks, satisfying ground rule 2. This was the project's largest
engineering gap: every check was end to end against live traffic, which is honest but goes red at
3 a.m., on a feed hiccup, or when no military contact happens to be in range — all for reasons
unrelated to the code.

**33 frontend (vitest) + 36 backend (pytest).** `bash scripts/test.sh` runs both. pytest lives in
`requirements-dev.txt`, deliberately not `requirements.txt`, so the Docker image does not carry a
test runner into production.

**Every test was mutation-checked.** A passing test proves nothing until it has been seen to fail,
so each suite was run against deliberately broken source and confirmed to catch it by the right
test. Frontend: dropping the never-below-ground clamp, ignoring vertical rate, letting a negative
ground speed reverse the cone, doubling the envelope half-width. Backend: treating `alt_baro`
`"ground"` as an ordinary value, reading `dbFlags` as equality instead of a bitfield, preferring
barometric over geometric altitude, and — the two that matter most — reporting the configured
window as the span, and never reporting truncation. Those last two are the **D-016 lie** stated as
code, and they are exactly the failure this suite exists to catch: a track that quietly claims
coverage it never had looks identical to a correct one.

**`levelArc()` had a real bug, one hour old, and the test found it.** The degenerate-case guard
for "origin and destination are the same airport" was `δ === 0`. For two identical points the dot
product lands a hair under 1.0 in floating point, so `acos` returns a small non-zero angle and the
guard never fires — leaving a division by a near-zero `sin(δ)` that becomes `NaN` once it
underflows. Measured: **1.49e-8 rad (~9.5 cm) at lat 30.69, but exactly 0 at lat 0, 45, 60.5 and
−33.9.** The fault was **latitude-dependent**, so in production it would have fired intermittently,
on some airports and not others, and been miserable to diagnose. Now guarded by a distance-shaped
tolerance (`1e-6` rad ≈ 6.4 m — below that, two airports are the same airport), written
`!(δ > TOL)` so a `NaN` takes the branch too.

**One test was wrong and the code was right**, which is worth recording because the temptation is
always to "fix" the code. `test_a_parked_contact_does_not_evict_its_own_history` parked a contact
for `MAX_POINTS * 2` samples and expected the earlier fixes to survive. They did not — because
3,610 s exceeds the 1,800 s window, so they had aged out correctly. `MAX_POINTS` is sized to cover
exactly `TRACK_WINDOW_S`, so a parked run long enough to overflow the deque has necessarily also
left the window. The test now asserts the property that actually matters: 200 stationary samples
cost **one** point, not two hundred.

Tests are NOT wired into `npm run build`. The palette guard is (D-042) because colour drift is
silent and instant; a test suite is neither, and the Docker build has no dev dependencies. Run
`scripts/test.sh`, or `npm test` / `pytest` per side.

Not covered, and deliberately: anything needing a network, a GPU or a Cesium viewer. Those stay
with `scripts/verify_phase1.py` against live traffic. Note also that the headless capture harness
renders entity polylines non-deterministically at ~1 FPS on software GL (D-049) — it is not an
oracle, and unit tests are the answer to that, not more screenshots.

---

## D-052 — Small airports behind an off-by-default toggle, in their own lazily-fetched file.

**Date:** 2026-07-26

Owner asked for small airports "as an option toggle, default off". The toggle is the easy half;
where the data lives is the part worth recording.

**They are NOT in `places.json`.** Adding 42,698 rows would take the bundled file from 687 KB to
~4.2 MB, and every visitor would download it whether or not they ever switched the layer on — over
a home tunnel, for a feature that is off by default. So `build_places.py` now writes a **second**
file, `frontend/public/places-small.json` (3,515,829 bytes), which Vite copies through untouched
and the frontend `fetch`es **the first time the toggle goes true**. Verified: on a default load the
file is never requested; enabling it fetches once; toggling off again re-fetches nothing.

This is the general principle for any future optional layer: **an off-by-default feature must not
cost anything to the people who leave it off.**

**D-037's reasoning is not overturned.** Large and medium airports remain the default because they
are where the traffic ADS-B actually shows us operates. What changed is only that the display no
longer decides for the operator.

**What is still excluded, deliberately:** heliports (23,135), seaplane bases, balloonports, and
`closed` fields. Nobody asked for them, and `closed` in particular would put markers on airfields
that **no longer exist** — inventing a place rather than revealing one.

**The military NAME heuristic (D-033) is deliberately NOT applied to the small tier.** It was
calibrated against large/medium fields; running it across 42,700 small strips would assert military
significance far beyond what it was ever measured on.

Small fields are drawn dimmer, smaller, at a much shorter range (`FAR_SMALL = 120_000` m, vs
450,000 for medium), and with **no name label** — the tier's job is "there is a strip here", not
"read me from across the state".

**Cost, measured, and it is not small:** with the layer on, the scene holds **~116,000 primitives**
(12,617 place markers + 17,892 place labels + 85,396 small-airport markers and labels). The first
enable also builds all of those synchronously. `smallAirportState()` exposes
`off | loading | ready | failed` so the UI can be honest about a slow first load rather than
looking like a dead toggle, and a failed fetch reports failure instead of rendering an empty layer
that is indistinguishable from "no small airfields near you". **FPS with this on has not been
measured on real hardware** and is the owner's call to judge.

**Airport names under airfield codes** (same session, `072dc2f`) landed for the large/medium tier:
the name sits below the code at a quarter of the code's range, because the code is the identifier
you scan for at a distance and the name is what you want once you have found it. The trailing
"Airport" is trimmed for width (4,292 of 5,275 carry it); the full name is still shown verbatim in
the click-through panel (D-038).

---

## D-053 — 2026-07-26 — The palette guard is scoped to `:root`, and the upsert reuse paths repaint

Groundwork for the theme chooser (dark variants, owner's call). No theme exists yet; this is the
three things that had to be true before one could.

**`scripts/check_palette.mjs` scraped tokens with a whole-file regex.** Its comment claimed
"custom properties defined on `:root`", but it was not scoped to `:root` at all, and `Map.set`
overwrites — so the LAST definition of each name in the file won. Adding any
`:root[data-theme="…"]` block therefore made the guard compare `palette.ts` against *that theme's*
colours, and D-042 wired the guard into `npm run build`, so the build went red pointing at the
palette rather than at the theme block that caused it. The scrape is now brace-matched to the one
default `:root` block, and it fails if there is not exactly one.

**The guard also now validates every theme block**, because a theme is only useful if it is a
complete palette: a property CSS ignores (`--cyanx`) and a colour the theme forgets both render a
theme half-applied, which is very hard to tell from a rendering bug. Every
`:root[data-theme=…]` block must define every colour `palette.ts` reads, and may not introduce a
name `:root` does not declare. Non-colour tokens (`--mono`, `--pad`) are free to inherit. Still
zero dependencies — still a regex plus a brace scan.

**Two upsert reuse paths never reapplied colour.** `upsertPlane` and `upsertCone` mutate entities
in place rather than destroying and re-adding them, because recreating a labelled entity thirty
times a minute churns Cesium's SDF glyph atlas badly enough to drop characters out of an altitude
readout (D-015/D-028). The hazard that discipline introduces is the mirror image: a property the
mutate branch forgets keeps the value it was CREATED with for the entity's whole life.

- `altitudePlanes.ts` updated coordinates, height and label text, but not the rectangle material,
  the outline colour, or the label fill. The material is now rebuilt on mutate rather than
  recoloured in place, which also handles `fill`/`emphasis` changing — those swap the material
  class outright, so recolouring could not have worked.
- `projectionCone.ts` already reapplied the palette colour to the fill and every stroke; only the
  label was missed, so a palette change repainted the envelope but not its readout.

Both are latent today — every call passes the same colour — and would have made any theme switch
look half-broken. Fixed regardless of whether the chooser ships.

**Covered by 9 new tests** (frontend 33 → 42), mutation-checked per D-051: with the fixes reverted,
4 of the plane tests and 1 cone test fail and the tests covering the pre-existing behaviour still
pass. The guard was likewise proved both ways with a throwaway `data-theme="probe"` block —
complete themes pass, a typo'd or incomplete one fails — and the probe reverted.

---

## D-054 — 2026-07-26 — The left column gets one height budget instead of two opposing stacks

Owner report: "some placement problems with the control panels left side", with the ALTITUDE
legend showing LAYERS' text ghosting through it.

Not a rendering fault. `App.tsx` positioned the left chrome as **two independent absolute stacks**:
one anchored `top-3` growing downward (Traffic, Camera, Layers) and one anchored `bottom: 34`
growing upward (Altitude legend, cursor readout). Neither knew the other existed, so nothing
stopped them meeting in the middle. Because the spec forbids opaque cards, the overlap did not
occlude — it showed through, so LAYERS' toggle text appeared inside the altitude swatches and read
as a corrupted legend rather than as a layout problem.

It surfaced now because `LayerCluster` has been growing: the projection preset row (D-047), the
small-fields toggle (D-052) and the DENSITY row (D-049) are all conditional, so the panel is
tallest exactly when the most is switched on.

The left column is now **one flex column from `top-3` to `bottom: 34`**, with a `flex-1` spacer
holding the legend and readout at the bottom. `LayerCluster` carries `minHeight: 0` +
`overflowY: auto` so it is the panel that scrolls when the column runs short — it is the one whose
height is variable, and the controls around it have fixed content. `minHeight: 0` is load-bearing:
a flex item defaults to `min-height: auto` and will overflow its container rather than shrink. Same
fix, and same reason, as the dossier when it grew a photo.

`items-start` because each panel sets its own width (210 / 148 / 176 px); the default `stretch`
would have squared them off to the widest and misaligned the column.

This makes the collision impossible rather than unlikely. The previous arrangement was only ever
correct for viewports tall enough, and nothing declared what "tall enough" was.

---

## D-055 — 2026-07-26 — Fetch radius is a preset row, capped at the upstream ceiling, in the preferences store

Owner asked to be able to widen or narrow how far out traffic is polled, instead of it being
pinned at the Phase 1 constant (`RADIUS_NM = 120` in `App.tsx`).

**Presets (60/120/180/250 nm), not a slider.** The question this control actually answers is "can
my machine and my link afford to ask for more?", and that is answered by trying a handful of
discrete values while watching the FPS readout and feed status, not by fine-tuning to an arbitrary
number in between. A slider also invites values nobody has reasoned about - 143 nm is not a
meaningfully different question from 140 - where four named steps are each a real choice with a
real cost. Same reasoning as D-049's DENSITY row, which this control sits next to.

**250 nm is not our ceiling, it is airplanes.live's.** The backend already clamps to
`LORAN_ADSB_MAX_RADIUS_NM` (`backend/app/config.py`, default 250.0) before calling out
(`backend/app/feeds/adsb.py:156`), because that is airplanes.live's own `/point` endpoint limit -
asking for more does not return more. `MAX_RADIUS_NM` in `store.ts` mirrors that default so the
UI does not offer a step that silently does nothing; `setRadiusNm` clamps to it independently so a
hand-edited or corrupted `localStorage` value cannot put the UI in a state none of the four buttons
can represent. The backend's own clamp is still the one that actually protects the upstream feed
if the two ever disagree.

**This is a FETCH radius, not a display one**, same distinction `placeDensity` already draws for
places. Raising it changes what is asked of airplanes.live on every poll tick - more bandwidth, and
more load on a free, non-commercial, no-SLA feed we do not operate - not just more to draw once the
answer comes back. The control's `title` attribute and the panel copy say so, because "just a
frame-rate knob" is the wrong mental model and would make widening it look free.

**Persisted, so it needed a version bump.** `radiusNm` joins the `partialize` allow-list and the
persist version moves from 2 to 3. A browser that already saved prefs under version 2 has no
`radiusNm` key at all - without a migration step it would load as `undefined`, not quietly inherit
the new default, and an undefined radius reaching the fetch URL is worse than a wrong one. The
`migrate` function was pulled out to a named, exported `migratePrefs` so it stays unit-testable
without spinning up a fake `window.localStorage`: zustand's persist middleware builds its storage
adapter eagerly, and this project's vitest config runs under the `node` environment on purpose (see
`vitest.config.ts`), which has no `window` at all.

**The poll loop reads the preference imperatively, not reactively.** `App.tsx`'s poller is a
self-rescheduling `setTimeout` inside a `useEffect` with an empty dependency array - deliberately,
so there is exactly one poll chain for the life of the component. Adding `radiusNm` to the
dependency array would tear the effect down and rebuild it on every preset change, and for the
instant between the old timeout firing once more and the new effect's first tick, two chains would
be running concurrently. Reading `useStore.getState().radiusNm` fresh at the top of each `poll()`
tick - the same pattern the loop already used for `home` - means a new preset takes effect on the
very next tick with no loop restart at all.

---

## D-056 — 2026-07-26 — LAYERS moves into a preferences overlay; air traffic auto-collapses on a timer, never on data

Two owner-approved UI changes landed together: `LayerCluster` came out of the docked left column
into a new `PreferencesPanel` overlay, and `TrafficPanel` now auto-collapses after a period of no
hover.

**Overlay, not a docked panel, and not a resize of the existing one.** The left column only just
got a single shared height budget (D-054), and LAYERS is the tallest, most variable-height thing
in it - the projection presets, small-fields toggle and density row are all conditional, so it is
tallest exactly when the most is switched on. Shrinking it further wasn't on the table; the ask
was to stop it costing column height at all. A **docked** panel, however it is sized, always
reclaims some fixed slice of that budget whether anyone is looking at it or not - that is what
"docked" means. Only an overlay can cost zero column height while closed, so it was the only shape
that actually satisfies the request. `LayerCluster` itself is untouched and still exported from
Panels.tsx; `PreferencesPanel.tsx` renders it rather than reimplementing its toggles, so there is
exactly one copy of that logic to keep in sync with the store. Its wrapper dropped the fixed
148px width and the `minHeight: 0` / `overflowY: auto` pair it needed to scroll inside the old
column - the overlay now owns both the max height and the scrolling.

**`prefsOpen` is deliberately NOT in the `partialize` allow-list.** That list is the store's one
safety property (its own comment says so): only knobs a person deliberately *sets* belong there.
Whether the overlay happened to be open at the moment the tab was closed is not a preference, it
is transient UI state, and persisting it would mean the panel could pop open unprompted on the
next visit - reading as a bug, not a memory. Same reasoning `authRequired` already uses. Because
it never joins `partialize`, no persist version bump was needed either.

**The traffic-panel collapse is TIME-based, never DATA-based, and that boundary is enforced by a
pure function, not by convention.** `trafficCollapse.ts` exports `trafficPanelSections`, which
takes `{ collapsed, filtering, hasContacts }` and returns which of the panel's sections should
render. `hasContacts` feeds only the honest empty-state text; nothing in the function - and
nothing in the `useEffect` timer that drives `collapsed` in `TrafficPanel` - reads `aircraft.length`
or the operator-row count. A panel that tidied itself away because the contact list emptied out
would make a dead feed look exactly like a clean, quiet UI, which is the same failure class ground
rule 1 already forbids for invented data: a plausible-looking screen standing in for the truth.
Collapsing on a plain 8-second no-hover timer, re-armed on every hover change, means the collapse
state can never be explained by what the feed is doing, only by how long the mouse has been away -
and that's exactly the property the "never collapses because of contact count" test in
`trafficCollapse.test.ts` holds it to (it asserts `hasContacts: false` does not force a collapse).

**The filter warning and the empty state both survive collapse - non-negotiable, per the owner.**
`Filtered · N of M shown` already existed to stop a filter from hiding traffic silently (its
comment predates this change); letting the collapse hide *that warning* would recreate the exact
failure it exists to prevent, just one layer up - the globe under-reporting traffic with nothing
on screen saying so. The empty state (`No contacts in range` / `Awaiting feed`) gets the same
treatment for the mirror-image reason: a collapsed panel must never make "no data" read as "tidied
away". Both are wired independently of `sections.controls`/`sections.seaTraffic` in the JSX, and
the "filter warning visible whether collapsed or expanded" test is the one explicitly called out
as most likely to regress - it was mutation-checked against a version that gated the warning on
`!collapsed`, and failed exactly as expected.

**250ms hover-to-expand delay.** Without it, the panel pops open every time the cursor sweeps
toward an aircraft rendered on the left side of the globe - a routine mouse path, not an edge
case, given the panel sits in the same left column the globe is under.

**Judgment call left as literally specified rather than second-guessed:** `LayerCluster`'s wrapper
kept its own `panel` class inside the overlay's `panel`, producing a (harmless) nested bracket-
corner border rather than a single seamless one. The task scoped the wrapper's adjustment to
exactly two things - drop the fixed width, drop the scroll pair - and stripping the `panel` class
as well would have been restructuring beyond that scope on a guess about the visual result. Worth
a look next time the owner has eyes on it; trivial to remove if it reads as clutter in practice.

---

## D-057 — 2026-07-26 — The locked panel takes a pasted token, over a POST, through one shared cookie helper

The 401 panel said "open the full link you were given". That copy was written for a guest, and it
told the one person who can actually fix the problem to do the one thing they cannot: the OWNER,
sitting at their own console on `localhost`, was never *given* a link. They hit this state
routinely, too — session cookies are scoped per hostname, so `localhost`, `127.0.0.1` and the
future tunnel hostname are three separate cookie jars, and clearing cookies or opening a second
browser empties whichever one was in use. The panel now offers a paste field first and mentions
the link second, and the honest "live traffic is not being shown, nothing on screen is current"
line stays exactly where it was — that is a ground-rule-1 statement, not decoration.

**A paste field rather than only a better-minted link.** A link is a fine *delivery* mechanism and
`scripts/mint-link.sh` now prints one per principal, but it is a bad *recovery* mechanism: it
requires the person who is locked out to already have somewhere to get the link from. The owner
locked out at their own keyboard has a token in `.env` and no link anywhere, and telling them to
go generate one is a longer path than a text box. The two paths are complementary and both ship —
the link is how you hand access to somebody else, the box is how you get yourself back in.

**POST with the token in the body, not a second trip through `?t=`.** Reusing the existing GET
would have been one line of frontend and no backend change at all, and it would have written a
live credential into every access log between the browser and the app. The URL is the part of a
request that gets *written down*: uvicorn logs the query string by default, and once the
Cloudflare tunnel is live so does Cloudflare. Demonstrated rather than assumed — the same server,
the same two requests:

```
INFO:  "POST /api/session HTTP/1.1" 200 OK
INFO:  "GET /api/session?t=SCRATCH-GUEST-TOKEN HTTP/1.1" 200 OK
```

The link path has no choice about this, because a link *is* a URL — which is exactly the argument
for not letting the paste path inherit its exposure. `GET /api/session?t=` is untouched and is
still how shared links log in (D-041); this is an addition, not a replacement, and
`TestGetSessionRegression` exists to keep it that way. `OPEN_PATHS` needed no change either: the
middleware matches on path alone, so the exemption already covered every method — that is now
stated in a comment and asserted in a test, because it is load-bearing by accident rather than by
design.

**One `_issue_session` helper, not two `set_cookie` calls.** The real risk in adding a second door
is not that the new one is wrong today; it is that the two drift. Two copies of a `set_cookie`
call will eventually disagree about `httponly`, `samesite`, `max_age` or the `secure` derivation,
and the copy that quietly loses a flag is a security regression that reviews clean, because it
looks the way the code has always looked. One function makes the divergence impossible instead of
unlikely, and one test (`test_post_and_get_mint_identical_cookie_flags`) covers both doors. The
`secure` flag is derived from `x-forwarded-proto` exactly as before, and is the one thing here
that cannot be exercised locally — there is no real HTTPS in front of a dev box — so it is pinned
by tests in both directions rather than left to the first production request to discover.

**The throttle, and what it is not.** `/api/session` must stay reachable without a session — it is
how you *get* a session — and a visible paste box makes it a more obvious thing to poke. The
tokens are 256 bits, so this is emphatically not what stops a brute force; arithmetic already does
that. It exists so that a door which cannot be closed does not serve unlimited attempts, and so a
script hammering it shows up as 429s rather than as work. Five failures per client per minute,
counted on FAILURES only: a person with a new browser, a cleared cookie or a second hostname
re-authenticates *successfully* over and over, and locking them out for succeeding would recreate
the exact lockout this whole change exists to fix. The check runs before the token is looked at,
so a correct guess cannot walk past a spent limit.

It is **in-process and in-memory**, which is correct for a single-user console served by one
uvicorn process — a shared store would be a dependency (rule 2) bought for nothing. Two
consequences, named because they are choices: the counters **reset on restart**, and under more
than one worker each worker would keep its own, multiplying the effective limit by the worker
count. The per-client key comes from the first hop of `X-Forwarded-For` when present, because
behind the tunnel every visitor shares the tunnel's own address and the peer address would be one
bucket for the entire internet. That header is forgeable in general and is trusted **only** because
the tunnel is the sole ingress; if this is ever exposed directly the line must be revisited. The
failure mode is mild either way — forging it buys a fresh throttle bucket and nothing else, never
a session.

**The request body is parsed by hand, and that is a security decision, not a style one.** The
obvious FastAPI shape here is a pydantic model with `t: str = Field(max_length=256)`, and it was
written that way first. Then it was measured:

```
POST /api/session  {"t": "OVERLONG-TOKEN-AAAA…"}   ->  422
{"detail":[{"type":"string_too_long", … ,"input":"OVERLONG-TOKEN-AAAA…"}]}
```

Pydantic v2 puts the offending value in `input`, so a submission that trips any field constraint
hands the pasted token straight back to the browser — into the DOM, and into anything that logs
response bodies. That is precisely the leak this change was supposed to close. A 422 would also
bypass the throttle entirely and tell a caller which *kind* of wrong they were. Ten lines of
`await request.json()` plus an explicit type-and-length check buy one uniform 401 for every
malformed, over-long or wrong-typed body, and the two tests that cover it were mutation-checked
against the pydantic version, which they fail. This is worth remembering the next time a body
model looks like the tidier option on an endpoint that handles a secret.

**Failures are deliberately indistinguishable.** "No such token", "a token that was removed from
the config" and "an empty string" all return the same 401 and the same sentence, because telling
them apart would confirm to a caller which half-remembered string was once real. The submitted
value is never logged and never echoed into the response, so it cannot reach a log file or the
DOM; `test_rejection_is_the_same_answer_whatever_was_wrong` holds three different kinds of wrong
to one identical body. The one failure the UI *does* distinguish is the 429, and that leaks
nothing: the limit is decided before the token is examined, so "too many attempts" says nothing
about whether the token was right — and telling a rate-limited person "token not recognised"
would simply be a lie.

**`backend/app/auth.py` had zero tests before this.** It is the only security-relevant code in the
project, which made it the wrong file to keep adding to on faith. `backend/tests/test_session.py`
is 22 tests over the cookie flags, both doors, the rejection surface and the throttle window;
every one was mutation-checked, and the mutations they caught include a dropped `httponly`, a
`samesite=none`, a `secure` pinned in each direction, a hand-rolled second `set_cookie` in the GET
path (the drift this design exists to prevent), a rejection that echoed the token back, a throttle
that counted successes, a throttle checked after validation instead of before, and an `OPEN_PATHS`
check narrowed to GET.

**`scripts/mint-link.sh` mints nothing.** There is no token store to mint from — the tokens *are*
the config — so it reads `LORAN_ACCESS_TOKENS` (environment first, then `.env`, matching
`config.py`'s own precedence) and formats the link the `?t=` path already expects. Generating a
new token stays a deliberate manual step, which is what keeps this from becoming a thing that
quietly creates credentials. It prints to stdout only, never to a file, and leads with a warning
that each URL is a live credential — a file full of these is a secret on disk that nobody
remembers to delete, in a directory that happens to be a git repo.

---

## D-058 — 2026-07-26 — Preferences comes back out of the overlay, docked as a collapsing pane like air traffic

D-056 pulled `LayerCluster` out of the left column into a `PreferencesPanel` modal overlay,
reached through a `PREFS` chip on the status bar. The owner has now seen it running and asked for
it back: "Preferences is hard to find on the bottom bar and difficult to read... I think we can fit
prefs as a first class member of the left-hand control area, and it would be fine as a collapsing
pane like air traffic." This reverses that part of D-056. The record of the wrong turn stays there
unedited — this entry explains why it was wrong and what replaces it, not that D-056 never happened.

**Why the overlay was the wrong call, specifically.** D-056's stated goal was real and still is:
a docked panel, however it is sized, reclaims some fixed slice of the column's height budget
(D-054) whether anyone is looking at it or not, and LAYERS is the tallest, most variable thing that
would go there. But an overlay solves that at the cost of two things that turned out to matter more
in practice than on paper. First, findability: the `PREFS` chip sat in the status bar's row of
9px, `--dim`-coloured chips, one of a dozen small labels along the bottom edge, with no visual
weight to say "this opens something." Second, mode: a modal with a backdrop is built for a task you
step into and then step back out of — reading a dossier, confirming a dialog — not for a control
you nudge once and want to keep an eye on the globe while you do it. Blocking the whole screen to
flip one toggle was a heavier interaction than the toggle deserved.

**Why a collapsing pane keeps the thing D-056 was actually chasing.** The zero-cost-while-shut
property was never inherent to being an overlay — it was inherent to being SHUT. `TrafficPanel`
already proved a docked panel can do that: it renders full width and height while in use, then
auto-collapses to a single header row after `COLLAPSE_AFTER_MS` (8 s) of no hover, which is
functionally the same "cost nothing when nobody is looking" property the overlay was built to get,
minus the backdrop and minus the missing trigger. `PreferencesPanel` now docks in the left column,
between `CameraCluster` and the height-budget spacer, and collapses/expands the identical way:
same `hovering` boolean, same re-arming `useEffect`, and the same two timing constants
(`COLLAPSE_AFTER_MS`, `HOVER_EXPAND_DELAY_MS`) imported from `trafficCollapse.ts` rather than
redefined, so the two panels can never drift to different collapse timings by accident. The
mechanism was duplicated rather than pulled into a shared hook: it is eight lines, TrafficPanel's
copy is untouched and still independently correct, and a hook wrapping two `useState` calls and one
`useEffect` would have been an abstraction over a pattern used exactly twice — not worth it per the
project's own simplicity rule.

**No new pure decision function, and that is a deliberate difference from `trafficPanelSections`.**
TrafficPanel's collapse needed a dedicated function because collapsing there is genuinely subtle:
the filter warning and the empty state both have to survive collapse or the panel would make a
live feed look tidied away, which is exactly the failure ground rule 1 forbids for invented data.
Nothing in `LayerCluster` carries that risk — every row is inert configuration the operator set,
never live data whose absence could be misread — so collapsing it is just "hide the body, keep the
header": `{!collapsed && <LayerCluster />}`. Wrapping a single negation in an exported function to
satisfy the letter of "extract decision logic into something testable" would be indirection with
no decision behind it, so none was added. No tests were added for this reason: there is no new
logic to mutation-test, only a straight re-use of already-tested constants and an already-proven
JSX pattern. The 4 `trafficCollapse.test.ts` tests were re-run and still pass unchanged.

**Buttons inside a collapsing pane are a real hazard, checked rather than assumed.** Air traffic is
read, not touched; preferences is a panel of buttons the owner clicks while it is open, and a panel
that could collapse mid-click would be worse than the overlay it replaced. Traced through the event
model rather than guessed: the collapse timer only ever re-arms from the `onMouseLeave` handler on
the panel's outer `<div>`, and `onMouseLeave` fires only on an actual pointer-movement event that
carries the cursor outside that element's current box — never as a side effect of a click, and never
synthesized just because a re-render (e.g. toggling "Places" off, which removes the "Small fields"
row beneath it) shrinks the box out from under a stationary cursor. No mousemove, no mouseleave, no
re-arm. This is not a new risk being newly tolerated: `TrafficPanel` has shipped with exactly this
mechanism guarding a panel full of clickable operator rows and a MIL toggle since D-056, with no
report of it collapsing under a click. Chrome's devtools MCP would not launch in this sandbox (no
reachable `DevToolsActivePort`) to click through it live, so this is a source-level trace rather
than a captured recording — worth a real click-through next time a browser is available, but the
event-model argument does not depend on one.

**`prefsOpen` and `setPrefsOpen` are removed from the store, not just unused.** The docked pane's
collapsed/expanded state is local `useState` in `PreferencesPanel`, the same as `TrafficPanel`'s —
there is nothing left for a store field to hold. `prefsOpen` was already excluded from `partialize`
(D-056), so removing it involves no persisted-shape change and no version bump.

**LayerCluster gets exactly one set of bracket corners, still.** It has not carried the `.panel`
class since D-056, for the reason still recorded in the comment above its root `<div>`: the parent
already supplies one `.panel` frame, and a second nested one would just be a harmless, pointless
extra border. That parent used to be the overlay; it is now `PreferencesPanel`'s own `.panel`
wrapper. The comment is updated to say so rather than describing a frame that no longer exists.

---

## D-059 — 2026-07-26 — Airfield NAME labels stop scaling with DENSITY; they are pinned, not proportional

**Date:** 2026-07-26

The owner reported airport names colliding at MAX, around Hattiesburg: `HATTIESBURG LAUREL
REGIONAL` and `HATTIESBURG BOBBY L CHAIN MUNICIPAL` stacked on each other and on the city label
`HATTIESBURG`. The suspected cause, confirmed by reading `placesLayer.ts` rather than assumed: it
was right. `setDensity()` kept a single `ranged` list of every marker, code label and name label,
each carrying its own `far`, and rescaled every entry the same way — `r.prim.distanceDisplayCondition
= new DistanceDisplayCondition(0, r.far * mult)`. A NAME label's `far` was `far / 4` (the tier's
code range, quartered — a guess shipped in 072dc2f, never re-measured). At MAX (`mult = 4`) that
guess multiplied straight back up to the tier's own density-1 code range: a medium field's name
went from ~61 nm to ~450,000 m ≈ 243 nm. City labels ride the same `ranged` list and got the same
treatment, so the city name was also pulled further out by the identical multiplier — true, but
not what this fix touches (see below).

**Range tuning, not decluttering.** Cesium's entity labels do not declutter themselves, and
building a collision system for ~21,000 static primitives is a different, much bigger project
than "the name label collides at one density setting." The honest lever here is the same one
D-049 already established for this file: how far out a thing stays drawn.

**The fix: airfield NAME range is pinned to its density-1 value, not scaled by density.** A new
exported pure function, `airfieldRanges(far, densityMult)`, returns `{ codeFar, nameFar }`:
`codeFar = far * densityMult` (unchanged — the whole point of DENSITY is pulling more of the
shipped set into view at a given camera height, and that stays true for codes and markers).
`nameFar = Math.min(far / 4, codeFar)` — the same `/4` ratio D-072dc2f shipped, but now held
constant across density instead of multiplied by it, and clamped to `codeFar` so the ordering
(name ≤ code) cannot invert even if some future density preset ever ships below the current
floor of 1x. The `/4` ratio itself is not re-derived here; it was a guess when it shipped and is
still a guess, now applied consistently instead of inconsistently.

**Why pin instead of "scale less."** The code is the thing you scan for at a distance; the name
is what you want once you've found it, at close range — the DENSITY control's own stated job
(D-049) is "scales range, not membership," and pulling more *names* into simultaneous view is
precisely what breaks legibility, since a name label is many times wider than a 4-character
code. Pinning is the strongest form of "scale less" that still satisfies that job description:
DENSITY keeps doing exactly what it says for codes and markers, and simply stops doing it for
names.

**City labels are left alone.** They are also pulled further out by DENSITY today, and that is
true and worth recording, but there is no code/name pair for a city the way there is for an
airfield — a city has one label, ranged by Natural Earth scalerank (D-037/D-049) — so there is no
equivalent "pin the name, scale the code" split to make. Touching `cityFar()` scaling was not
needed to address the reported bug and was left out on the surgical-change rule; if the owner
finds city labels crowding a cluster of airfields at MAX after this ships, that is a second, and
separate, decision.

**DENSITY changes take effect live, not on reload — confirmed by reading `Globe.tsx`, not
assumed.** `createPlacesLayer()` builds every primitive once at mount, per the discipline at the
top of this file, but `Globe.tsx` (outside this fix's scope, read-only) subscribes to
`useStore` and calls `places.setDensity(st.placeDensity)` whenever `placeDensity` changes,
mutating the existing primitives' `DistanceDisplayCondition`s in place rather than rebuilding
anything. Because that call already goes through `setDensity()`, this fix's changed formula
takes effect on the next density click with no reload required — nothing in `Globe.tsx` needed
to change.

**Tests: `airfieldRanges()` is exported specifically so this could be checked without a Cesium
Viewer** — `node` environment, no DOM, no WebGL (D-051). Four tests in the new
`placesLayer.test.ts`, all mutation-checked (broke the source, confirmed the intended test failed,
restored, reran green):
- *scales the code range linearly with density* — caught `codeFar = far` (density ignored).
- *does not blow the name range up at MAX the way the code range blows up* — caught both the
  original bug reintroduced (`nameFar` scaled by `densityMult`) and the clamp removed outright.
- *clamps the name range to the code range* (at a hypothetical `densityMult = 0.1`, below today's
  floor of 1x) — caught the clamp removed and the pinned value left unclamped.
- *ordering invariant (name ≤ code) across every tier and every shipped density preset* — caught
  a `codeFar`/`nameFar` swap directly; note it did **not** independently catch the clamp's
  removal at today's density floor (1, 2, 4), because `far / 4 ≤ far ≤ far × mult` already holds
  for any `mult ≥ 1` without the clamp — the clamp only matters below that floor, which is what
  the dedicated `0.1` test exists to cover. Recorded here rather than overstated: this test is
  real regression insurance across tiers, not four independently-triggerable failure modes.

**What the owner still has to judge on a real display.** This box's headless capture runs at
~1 FPS on software GL and is explicitly not a pixel oracle (D-049) — it can confirm the range
numbers are what the code now computes, not whether HATTIESBURG and its two airfields read
cleanly apart at MAX on an actual GPU. The `/4` ratio (61 nm at density 1) was a guess in
072dc2f and is still exactly that guess; if two real airfields closer together than Hattiesburg's
pair still stack at that close range, the next move is tightening the ratio itself, not
resurrecting density scaling.

---

## D-060 — 2026-07-26 — ALL CALLSIGNS: labels for every contact, dimmed so amber and near-white keep meaning something

**Date:** 2026-07-26

The owner asked whether military craft always transmit a call sign, and from there asked for a
toggle to show an identifier next to each craft, rather than only the ones the display already
labels on its own.

**What was already labelled, and why this is an addition, not a change.** `aircraftLayer.ts`
already put a text label on three kinds of contact unconditionally: the SELECTED contact, any
contact within `separationFt` of the datum altitude (CO-ALTITUDE, D-047), and every MILITARY
contact — `military` because a magenta icon (D-029) asking "is this significant?" deserves an
answer, the other two because they are exactly what the operator is looking at or comparing
against right now. None of that changes here. The new `showAllLabels` preference (OFF by
default) only adds a fourth trigger: everyone else, when the operator explicitly asks for it.

**The identifier is callsign-or-hex, and that fallback is not touched.** `(a.flight ||
a.hex).trim().toUpperCase()` was already the label text before this ships, and it stays exactly
that. `a.flight` is empty for plenty of real contacts — general aviation squawking a bare
transponder code, mostly — and readsb never invents one. Falling back to the raw ICAO24 hex is
the honest answer to "what do we call this contact", not a bug to paper over: ground rule 1 says
unknown values render as an em-dash or, here, as the one piece of real data the transponder is
actually sending. Turning the toggle on makes this fallback visible on a lot more contacts at
once — a mix of `DAL9975` and `AE1234` at wide zoom — and the panel's note says so up front
rather than letting the owner discover it and wonder if it's broken.

**The design point that actually mattered: colour, not just count.** With the toggle on, roughly
a hundred-plus contacts can be labelled simultaneously on a loaded display. D-029 spent the only
two attention-grabbing label colours on purpose — amber for co-altitude/alerts, near-white for
the selected contact — specifically so those two things pop out of a field of civil traffic
coloured by the altitude hue ramp. If every one of those hundred-plus new labels read at the same
near-white prominence, that signal drowns: the operator would have to actually read every label
to find the one that matters, which is a worse display than not labelling most of them at all.
So a label that exists ONLY because of the toggle is drawn in `pal.dim` (`--dim`, `#5a6b7a`) —
the same token `Panels.tsx` already uses for an inactive toggle's label text, i.e. the codebase's
existing "this is present but not the thing to look at" colour. `pal.txt` (`#c8d6e0`, the
near-white default text colour) was the other candidate the task raised, and it was rejected:
it sits close enough to `pal.iconSelected` (`#ffffff`) that a dimmed label and the selected
contact's label would still read as roughly the same weight from a normal viewing distance,
which defeats the point. `pal.dim` is dark enough against the near-black background to stay
legible while unmistakably subordinate to amber and white.

**The colour decision is pulled into a pure function, `labelDecision()`, in `aircraftLayer.ts`** —
the same move D-056/D-059 made for `trafficPanelSections()` and `airfieldRanges()`, for the same
reason: vitest's `node` environment (D-051) has no DOM or WebGL and cannot construct a Cesium
`Label`, but `{selected, coAltitude, military, showAllLabels} -> {show, colourRole}` is data in,
data out and needs neither. `colourRole` is `"alert" | "selected" | "dim"`, resolved to an actual
`pal.*` token only in the render loop — the pure function never sees or invents a colour string.
Priority inside it is alert-first (`coAltitude || military`), then selected, then dim, so a
contact that happens to be both military and only visible because of the toggle still reads as
military, not as generic clutter.

**Five new tests in `aircraftLayer.test.ts`, all mutation-checked** (broke the source, confirmed
the intended test failed and only that one, restored, reran green):
- *a plain civil contact gets no label off, a dim one on* — caught the default colour role
  changed from `"dim"` to `"selected"`.
- *military keeps the alert colour role regardless of the toggle* — caught `|| military` dropped
  from the `show` expression (this is the regression that would have quietly turned "always
  labelled" into "labelled only if toggled on or otherwise triggered").
- *co-altitude keeps the alert colour role regardless of the toggle* — caught `coAltitude`
  dropped from the alert check.
- *the selected contact keeps the selected colour role regardless of the toggle* — caught the
  `selected ? "selected"` branch removed, falling through to `"dim"`.
- *military wins over selected when a contact is somehow both* — caught the priority order
  swapped so `selected` was checked ahead of the alert triggers.

**Persist version bumped 3 → 4** (`frontend/src/state/store.ts`), with a chained `if (from < 4)`
step that adds `showAllLabels: false` on top of what the `from < 2` (D-047) and `from < 3`
(D-055) steps already produce — verified by extending `store.test.ts` rather than replacing its
existing migration tests: a new test for the `from < 4` step in isolation, and the existing
"chains v1 through every later version" test extended to also assert the v4 field, so a future
version bump that forgets to preserve this one would fail the same way D-047's would. Both were
mutation-checked: flipping the new step's default to `true` failed both assertions (they share
the field), and deleting the `if (from < 4)` block entirely turned the field `undefined` rather
than `false` — a real "this browser's payload predates the toggle" case, not a hypothetical.
`showAllLabels` was also added to the `partialize` allow-list, which is the one place a persisted
field is allowed to appear at all (D-041) — anything not named there never reaches
`localStorage`, toggle included.

**No churn to the label pool, confirmed by reading the surrounding code rather than assumed.**
`aircraftLayer.ts`'s per-slot `Label` objects are created once, lazily, the first time a contact
wants one (`if (!slot.label) { slot.label = labels.add(...) }`), then only ever mutated in place
(`position`, `fillColor`, `text`, `show`) on every later frame — this file's whole reason for
existing (see its header comment) is that the original version recreated ~120 primitives 30
times a second and that was the whole reason the frame rate sat at 25-30. This change touches
only the boolean feeding `label.show` and the branch feeding `label.fillColor`; it does not touch
slot creation, retirement, or the `labels.remove()` call, which still only fires when a contact
actually drops out of the feed. Flipping the toggle ON does cause a one-time `labels.add()` for
every contact that has never been labelled before — unavoidable, since those `Label` objects
never existed — but each one is created once and reused from then on, including across further
toggle flips (toggling back off sets `.show = false`, it does not call `labels.remove()`). No
per-frame create/destroy cycle is introduced, so the glyph-atlas-corruption hazard this codebase
has already hit elsewhere from repeated label destruction does not apply here.

**UI:** `LayerCluster` in `Panels.tsx` gets one new `Item`, labelled "Identifiers", between
"Drop line" and "Places" — grouped with the other aircraft-annotation toggles rather than the
places-related ones below it. Its note reports the live aircraft count either way (`"N contacts ·
clutters at wide zoom"` off, `"N labelled · callsign or hex"` on) rather than a static or vague
warning, following the same "say the real cost" pattern as the "Small fields" note (D-052) —
and the "on" phrasing states the callsign-or-hex mix up front rather than leaving the owner to
notice the `AE1234`-style labels and wonder if something is broken.

**What the owner still has to judge on a real display.** This box cannot render Cesium (no DOM,
no WebGL, D-051) and its headless capture path is ~1 FPS software GL and explicitly not a pixel
oracle (D-049) even where it can run at all — nothing here can confirm that ~100+ dimmed labels
at once are actually legible rather than merely present, or whether `pal.dim` reads as clearly
subordinate to amber/white at the owner's actual monitor and viewing distance, or what the real
FPS cost of ~112 simultaneous labels is on the loaded machine this owner is running at 9-16 FPS
already. If `pal.dim` proves too faint to read at all rather than merely subordinate, `pal.txt`
was the documented fallback candidate to try next — not a third, undocumented option.

## D-061 — 2026-07-26 — OUTBOUND LINKS: only links built from identifiers we actually hold, and the one that survives the single-file build

**Date:** 2026-07-26

The dossier tells the operator what a contact is; it had no way to hand them off to a source that
knows more. The owner asked for outbound links, with one hard requirement attached: **they must
also work in the single-file build**, where there is no backend, therefore no planespotters proxy,
therefore no photo — and a link is the honest substitute for a picture that can never load.

**Every URL shape here was verified against a real contact before shipping** — `ad2862` /
`N947NN` / `AAL1005`, an American Airlines 737-823 pulled live from the local feed rather than
invented. `globe.airplanes.live/?icao=ad2862` and `globe.adsbexchange.com/?icao=ad2862` return
200. `registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=947NN` returns 200 with
`N947NN` and `BOEING` in the body — the 403 the previous session recorded was plain User-Agent
filtering and goes away with a browser UA.

**The finding that changed the approach: a 403 from the command line proves nothing about
planespotters.** The previous handoff listed four URLs as "403 to curl only — almost certainly
UA/bot filtering, needs browser confirmation", which invited treating a 403 as weak evidence of
breakage. It is not evidence either way. planespotters.net returns 403 to every non-browser
client regardless of URL validity — including, when tested, the **known-good photo page URL their
own API returned**, the one the shipped thumbnail has been linking to successfully all along.
Their `robots.txt` is Cloudflare-managed and their `sitemap.xml` 403s too. flightradar24 and
jetphotos behave the same way. So the command line cannot validate any route on those hosts, and
no amount of header-spoofing effort should be spent trying; the only oracle is a real browser.

**So the planespotters route was verified the only way it could be: the owner opened it.**
`https://www.planespotters.net/hex/AD2862` resolves to a real Mode S page — hex, decimal, octal,
country, "converts to registration N947NN", the current registration record (MSN 31190, Boeing
737-800, American Airlines) and the full photo grid. `search?q=N947NN` also works and returns the
same photos. **`/hex/` was chosen** because it is keyed on the ICAO24, which every contact has,
where a registration-keyed link would vanish for exactly the general-aviation contacts whose
registration the feed most often omits. No `/search` fallback was added: there is no case where
hex is absent but the contact exists, and a fallback for an impossible state is dead code.

**A link is rendered only when the identifier it is built from exists.** This is ground rule 1
applied to hyperlinks: a link that 404s, or that resolves to a registry's "no records found"
page, claims we looked something up when we did not. That is invented data wearing a different
hat. So the three hex-keyed links appear only with a hex, and the FAA link only for a US
registration, matched by a deliberately strict `/^N[0-9][0-9A-Z]{0,4}$/` — `N` is exclusively a
US prefix, and the FAA registry holds US airframes only, so a British `G-EUUU` or German
`D-AIMA` must produce no FAA link rather than one that lands on an empty result. The registry's
own parameter drops the `N`: `N947NN` is looked up as `947NN`.

**`rel="noreferrer"` is deliberately absent for planespotters and present on the other three.**
This asymmetry is not an oversight and has a test guarding it against future tidying. D-009 makes
planespotters attribution a licence condition, and passing the referrer is part of sending them
the credit their terms ask for — the shipped photo thumbnail already omits `noreferrer` for
exactly this reason, with a comment saying so. The other three are ordinary third parties with no
such claim on us, and once the tunnel is live the console's hostname is not theirs to collect.
The previous handoff's note to "add `rel=noreferrer`" was therefore applied to the new links
only; **the photo link was left alone**, because changing it would have quietly undone D-009.

**The gating is a pure function in its own module, `frontend/src/panels/externalLinks.ts`** —
the same move as `trafficPanelSections()` (D-056), `airfieldRanges()` (D-059) and
`labelDecision()` (D-060), for the same reason and one extra: **no test imports `Panels.tsx`**,
so any logic left inside that component is untested by construction. `(hex, registration) ->
ExternalLink[]` is data in, data out and needs no DOM. `Panels.tsx` keeps only the rendering.

**Eight new tests in `externalLinks.test.ts`, mutation-checked** (each mutation applied, the
intended failure confirmed, source restored, reran green):
- *loosening `US_TAIL` to `/^.+$/`* — caught by "omits the FAA link for non-US registrations",
  which walks six real foreign tails (`G-EUUU`, `D-AIMA`, `F-GKXA`, `JA8089`, `VH-OQA`, `C-FGDT`).
- *giving planespotters `noreferrer` like the others* — caught by the rel-asymmetry test, which
  exists precisely so a future cleanup pass cannot silently undo D-009.
- *removing the `if (h)` hex guard* — caught by "renders NO links at all when the hex is missing
  or blank", which covers `null`, `""` and whitespace.

The URL-shape tests pin the exact verified forms (lower-case hex for both globes, upper-case for
planespotters, `N` stripped for the FAA) so a well-meaning normalisation cannot drift them away
from what was actually confirmed to work.

**UI:** chips, not inline text — they match the TRACK / CLEAR / EXPORT vocabulary established two
blocks up in the same panel, and a 9px inline link is a poor pointer target. The block sits below
the photo and above the co-altitude readout, under a dim `External` caption, and wraps to a second
line in the 344px panel. It renders nothing at all rather than an empty bordered box when there
are no links to show.

**Why this satisfies the single-file requirement without a second implementation.** The
single-file branch (`71e3edf`) modifies this same `Panels.tsx` rather than vendoring a copy, so
it inherits `ExternalBlock` on rebase; the only textual conflict is the adjacent import line. In
that build the hex is always present and the backend never is, so all three hex-keyed chips
render — including planespotters — directly beneath its "No photos in the single-file build —
needs a server" note. The FAA chip additionally survives there, because registration arrives from
adsbdb, which sends `access-control-allow-origin: *` and is one of the two feeds that build can
still read.

**What the owner still has to judge on a real display.** The logic is under test and the URLs are
confirmed, but nothing here was seen rendered: this box cannot drive Cesium (no DOM, no WebGL,
D-051), selection is canvas-picking with no DOM affordance to trigger headlessly, and Chrome would
not connect for a screenshot. Unjudged: whether four chips wrap acceptably at 344px, whether
`--line-bright` chip borders read as clickable next to the filled TRACK buttons, and whether
`External` is the right caption or noise.

## D-062 — 2026-07-26 — FILED ROUTE: say it is a schedule lookup, cross-check it against the observed track, and measure how often it is wrong

**Date:** 2026-07-26

The owner observed DAL9975 presented as flying AMS → MSP while it was actually flying ATL → MSY,
127.7 degrees off the direct bearing at 31,975 ft, and asked for both remedies rather than either:
**relabel AND flag.** This entry does both, and — because the cross-check made it cheap to ask —
measures how often adsbdb's route is actually wrong. The answer turned out to be the most
important thing in this entry.

**Why the route is a different KIND of claim from everything above it in the dossier.** Speed,
altitude, heading and position are observations: the transponder said so a few seconds ago.
adsbdb's route is a **schedule lookup keyed on the callsign** — a database answer to "where does
a flight with this callsign usually go", not an observation of this airframe today. A recycled
callsign, a return leg sharing a flight number, or a stale record yields another flight's route.
Before this change that sat under a bare `Origin` / `Dest` label, in the same type, in the same
column, with exactly the same authority as the live telemetry two rows above. The label now
carries the caveat — `Filed orig` / `Filed dest`, with `Filed schedule · adsbdb · not live`
beneath — because a caveat that only exists in a tooltip is a caveat the operator will not see.

**The cross-check, and why the bar for it is deliberately high.** `checkFiledRoute()` compares the
initial great-circle bearing to the filed destination against the observed ground track. A
cruising aircraft legitimately tracks well off the direct bearing — airway doglegs, weather
deviations, oceanic tracks, ATC vectors — so crying wolf on a correctly filed route would be
worse than staying silent: the only thing that makes the flag worth having is that it can be
trusted when it appears. Three guards, all of which earn their place:

- **`CRUISE_FLOOR_FT` (18,000).** Class A airspace begins at FL180 in the US; above it a contact
  is en route on an assigned routing rather than manoeuvring in a terminal area. Below it, a
  departure turning onto course points anywhere at all, entirely correctly.
- **`NEAR_DEST_NM` (60).** Inside this radius the contact is being vectored onto a downwind or
  base leg and may be flying directly away from the field on purpose. The direct bearing stops
  being a meaningful expectation, so the check is *withheld*, not failed.
- **`DISAGREE_DEG` (90).** Not a "slightly off course" threshold and not meant to be one. At a
  right angle there is no component of motion towards the filed field at all, which no routing,
  wind correction or weather deviation explains.

**`unchecked` is a third state, and it is never rendered as reassurance.** Missing coordinates, no
observed track, below cruise or inside the terminal area all produce `unchecked` with a stated
reason, distinct from `ok`. The panel shows a note **only** for a measured `disagrees` — a line
saying nothing is wrong when nothing was actually tested is precisely the false confidence this
whole change exists to remove.

**The measurement, and it is worse than expected.** The real `checkFiledRoute` was run over live
traffic within 250 nm of Mobile: **50 contacts, 24 with a filed destination, 21 checkable — and
9 of those 21 disagreed. Roughly four in ten.** That rate was high enough to suspect the check
rather than the data, so every flagged flight was re-tested with **completely independent
geometry**: signed cross-track distance from the filed origin→destination great circle, which
shares no code path with the bearing comparison. All nine were **193 to 634 nm off their filed
route**:

| Flight | Filed | Leg | Off route |
|---|---|---|---|
| DAL2823 | SLC → SEA | 598 nm | **634 nm** |
| SWA440 | DAL → MCI | 401 nm | **522 nm** |
| AAL2097 | ORD → PHX | 1249 nm | 604 nm |
| AAL1288 | PVR → DFW | 855 nm | 429 nm |
| AAY342 | MYR → SYR | 582 nm | 415 nm |
| SWA1401 | PIT → MCO | 726 nm | 282 nm |
| AAL1796 | EWR → DFW | 1190 nm | 265 nm |
| DAL2730 | ATL → STL | 421 nm | 243 nm |
| SWA165 | SAN → AUS | 1010 nm | 193 nm |

DAL2823 and SWA440 are the clearest: each is further from its filed route than that route is
long. **Zero false positives in the sample**, confirmed by maths independent of the check itself.
Four contacts sharing a track of 104 degrees at FL350 were also checked directly against the feed
before trusting any of this — they are four genuinely distinct aircraft in a conga line on the
same eastbound airway across southern Mississippi, not a data-pairing bug in the probe.

**What that measurement means for the display.** The amber note will appear often, because the
underlying data really is wrong that often near this receiver. That is information, not noise,
and it is the strongest possible argument for the relabel: a source that is wrong for ~40% of
checkable contacts must not be presented in the same voice as the transponder. It also means
`DISAGREE_DEG` should **not** be tuned down on the strength of this one sample — 90 degrees
produced no false positives and there is no evidence inviting a more sensitive tripwire.

**The globe withdraws the line, using the same verdict object as the panel.** `Globe.tsx` calls
`checkFiledRoute` and adds `state !== "disagrees"` to the existing `destOk` condition, so the
dashed arc (D-050) cannot claim in geometry what the panel is simultaneously disputing in words.
No cache-key change was needed: the verdict is a pure function of position, track, altitude and
destination coordinates, all of which were already in that key.

**Eleven tests in `routeCheck.test.ts`, and one of them exists because mutation testing caught a
hole in an earlier version of itself.** The first threshold test asserted relative to
`DISAGREE_DEG` (`brg - (DISAGREE_DEG - 1)` etc.) — which slides with the constant and pins
nothing: **tightening the threshold from 90 to 30 passed the entire suite.** It is now asserted
absolutely: a 45- and 80-degree deviation must stay silent, 120 and 180 must flag, and
`DISAGREE_DEG` is pinned to 90 outright. Mutations confirmed caught: altitude guard removed
(departure test fails), terminal-area guard removed (arrival test fails), `angularDiffDeg`
wraparound dropped (359-vs-001 reads as 358 rather than 2, which would flag every northbound
contact), threshold moved in *either* direction, and `unchecked` reported as `ok`.

**What the owner still has to judge on a real display.** Nothing here was seen rendered — the
same constraint as D-061 (no DOM, no WebGL, selection is canvas-picking with no headless
affordance). Unjudged: whether the three-line amber note is too heavy in a 344px panel given it
will fire on roughly four contacts in ten, whether `Filed orig` / `Filed dest` read clearly
enough at that size, and whether withdrawing the line silently — the panel explains it, the globe
just stops drawing — is discoverable or merely confusing.

## D-063 — 2026-07-26 — BOUNDARIES: state lines worldwide, US county lines, both bundled because the measurement said the lazy path was machinery bought for nothing

**Date:** 2026-07-26

The owner asked for state and county lines, toggled in preferences. The prior handoff recommended
states bundled and counties **lazily fetched**, mirroring D-052, and instructed that the baked
size be measured before committing to counties. It was measured, and the measurement reversed the
recommendation.

**What was measured, before any of it was built.** Four Douglas-Peucker tolerances against both
Natural Earth sources, reporting baked and gzipped bytes:

| Layer | Rings | 0.005° (0.6 km) | **0.01° (1.1 km)** | 0.02° (2.2 km) | 0.05° (5.6 km) |
|---|---|---|---|---|---|
| States (50m, worldwide) | 858 | 862 / 292 gz | **734 / 248 gz** | 570 / 193 gz | 279 / 91 gz |
| Counties (10m, US only) | 3,619 | 1243 / 338 gz | **874 / 242 gz** | 606 / 170 gz | 335 / 85 gz |

(KiB.) For calibration, the already-bundled `places.json` is 671 KiB / **278 KiB gzipped**.

**So counties cost about what places.json costs, and the lazy-fetch recommendation was premised
on a size problem that does not exist.** D-052's lazy path exists for `places-small.json` — 3,433
KiB, **1,182 KiB gzipped**, roughly five times this. Adding a second fetch path, a loading state,
a failure state and a "what is the layer doing" accessor to save ~240 KiB gzipped would be
machinery bought for nothing, and every one of those states is a thing that can be wrong. **Both
layers are bundled**; counties simply default off. Owner confirmed after seeing the table.

**The 50m cut for states is deliberate.** `ne_10m_admin_1_states_provinces` is **39.8 MiB** of
print-scale detail; the 50m version is 2.3 MiB and at the zoom a globe console is actually flown
at, no detail distinguishes them. Counties are only published at 10m, so there was no choice
there — which is also why counties (3,619 rings) outnumber states (858) despite covering one
country.

**Tolerance 0.01° (~1.1 km), owner-chosen from the table.** It keeps river borders — the
Mississippi, the Ohio — recognisably wiggly rather than polygonised. 0.02° saved ~30% and
visibly cornered them; 0.005° cost ~40% more for detail not distinguishable on screen.
Coordinates are rounded to 3 dp (~110 m), an order of magnitude finer than the simplification,
so the rounding discards nothing the simplifier kept.

**Longitude is scaled by cos(latitude) inside the simplifier.** Without it a degree of longitude
would count as much as a degree of latitude, and a degree of longitude at 60°N is half the ground
distance it is at the equator — which would have over-simplified Alaska and the Canadian
provinces while under-simplifying the tropics. Douglas-Peucker is also **iterative rather than
recursive**: some coastline rings run to thousands of points and the recursive form overflows
Python's stack on them.

**Rendering: one `PolylineCollection` per layer, which Cesium batches.** The handoff warned that
one entity per feature would be brutal, and it is right — 4,477 entities is not a thing to do.
Counties are built **lazily inside the layer** on first show, so the default-off state costs no
construction at startup, where the thing that matters is first paint of live traffic.

**Zoom thinning does the work that "on" does not.** `FAR_STATES` is 8,000 km and `FAR_COUNTIES`
is 900 km, as `DistanceDisplayCondition`s handed to Cesium rather than recomputed per frame
(the placesLayer pattern). This matters more than the toggle: at full-globe zoom, 4,477 rings
would be a grey felt mat over the entire display, which is worse than no boundaries at all.
Counties only resolve into distinguishable shapes inside a few hundred kilometres, so that is
where they are allowed to draw.

**Colour: states `--dim`, counties `--off`** — the two most subordinate tokens, in that order,
so a county line never competes with the state line containing it. Both 1 px. These are context,
not instrumentation: the globe is the subject and the traffic is the point.

**Six tests against the BAKED OUTPUT, which is what actually ships**, all mutation-checked by
corrupting `boundaries.json` and confirming the intended failure: a ring made odd-length (caught
by the flat-pairs check — an odd length silently shifts every later point by one through
`Cartesian3.fromDegreesArray`), a county injected into central Europe (caught by the US-only
check), and **a ring made to jump the antimeridian** (caught by the dateline check). That last
one has real teeth: the Aleutians put county vertices at both −179.14 and +179.78, so the data
genuinely spans the dateline — it just does so in *separate* rings, because Natural Earth splits
there. A single ring containing a >180° step would be drawn by Cesium as a line straight across
the globe. Both coordinate sweeps collect offenders and assert once rather than calling `expect`
110,000 times, which cut the suite's cost from 4.9 s to 154 ms while still naming the offending
layer, ring and coordinate on failure.

**Persist bumped 4 → 5**, with a chained `if (from < 5)` step adding `showStates: true` and
`showCounties: false`. Both were added to the `partialize` allow-list, which is the only place a
persisted field may appear at all (D-041). **Note for the theme work:** the prior handoff
reserved v5 for themes — themes now take **v6**.

**The defaults, and why they differ.** States **ON**: 858 rings, coarse, cheap, and it is the
reference that makes "which state is that contact over" answerable at a glance — the same class
of thing as `showPlaces`, which is also on. Counties **OFF**: dense, and US-only. The toggle note
says `off · US only` rather than staying silent, so an empty layer over Europe reads as a
documented limit rather than a broken toggle.

**Measured bundle cost of shipping both:** `dist/assets/index-*.js` went from 4,911 KiB to 6,683
KiB raw, **gzip 1,967 KiB** — an increase of ~492 KiB gzipped, matching the prediction from the
table exactly. `data/raw/` is gitignored, so only the 1.6 MiB baked JSON is committed, the same
arrangement as `places.json`.

**What the owner still has to judge on a real display.** As with D-061 and D-062, nothing here
was seen rendered — no DOM, no WebGL. Unjudged: whether `--dim` state lines read as context
rather than competing with the altitude ramp over dark water; whether `--off` counties are
visible at all at close zoom or too dark to be worth the bytes; whether 8,000 km and 900 km are
the right thinning thresholds or want tuning; and the FPS cost of 858 state rings drawing by
default at continental zoom on a machine already sitting at 9–16 FPS.

## D-064 — 2026-07-26 — CRASH: one shared Cesium Material across 858 polylines took the whole display down on first load

**Date:** 2026-07-26

D-063 shipped with a crash that halted the console on **every page load in development**. The
owner hit it immediately: `DeveloperError: This object was destroyed, i.e., destroy() was called.`

**The mechanism.** `boundariesLayer.ts` built ONE `Material` per layer and handed the same object
to every polyline in the collection — an obvious-looking economy, 858 rings sharing one colour.
But Cesium's `Polyline.prototype._destroy` is:

```js
Polyline.prototype._destroy = function() {
  this._pickId = this._pickId && this._pickId.destroy();
  this._material = this._material && this._material.destroy();
  this._polylineCollection = void 0;
};
```

**Every polyline destroys the material it holds.** The first polyline destroyed the shared
Material; the second called `.destroy()` on an already-destroyed object and threw. Cesium's
`destroy()` contract is to throw on a second call, so this failed loudly rather than silently —
the only good thing about it.

**Why it fired on the first load rather than on some rare unmount.** `main.tsx` renders under
React 18 `<StrictMode>`, which deliberately runs **mount → cleanup → mount** in development to
surface exactly this class of bug. So `Globe.tsx`'s cleanup ran within milliseconds of the first
mount, called `boundaries.destroy()`, and tore the collections down while the page was still
loading. Reloading could not help: the sequence is deterministic. StrictMode did its job.

**Why nothing else in the codebase had hit this.** No other layer shares a `Material`.
`placesLayer` uses `BillboardCollection` and `LabelCollection`, which have no material at all;
`destinationLine` uses entities, which own their own. `boundariesLayer` is the first
`PolylineCollection` in the project, so it is the first code to meet this contract.

**The fix** is one line: `Material.fromType("Color", { color })` inside the loop rather than
above it. A material per polyline is the Cesium-idiomatic arrangement — the collection still
batches by shader, so the cost is objects, not draw calls.

**`DistanceDisplayCondition` is still shared, and that is deliberate, not an oversight left
behind.** It has no `destroy()`, Cesium's `Polyline` constructor stores the reference as given,
and nothing here ever mutates it. The distinction between the two is now stated in the code, so
the next reader neither "fixes" the safe one nor re-breaks the unsafe one.

**Five tests in `boundariesLayer.test.ts`, and the important one is a genuine broken-arm check:**
the shared-material version was reintroduced and confirmed to fail `gives every polyline its OWN
material instance`, then reverted and confirmed green. The assertion is on **identity**
(`new Set(materials).size === materials.length`), not equality — equality would pass on the
broken version, since every shared reference is trivially equal to itself.

Cesium cannot run in this box (no DOM, no WebGL, D-051), so the module is tested with `cesium`,
`../styles/palette` and `../data/boundaries.json` all mocked, and a fake `PolylineCollection`
that records what it was handed. That is enough to assert the invariant that actually caused the
crash — and note that **"the layer builds without throwing" would have passed on the broken
version too**, which is precisely why that was not the test written.

**The lesson worth keeping.** Every previous entry in this file closes with "not yet judged on a
real display", and three features shipped that way in a row. This one was not a judgement call
about colour or density — it was a hard crash that any single load of the page would have caught.
The gap is not that the tests were weak; `tsc`, 87 tests and a production build all passed. It is
that **nothing in the loop ever loaded the page**, and a layer that constructs Cesium primitives
cannot be signed off by a suite that cannot construct Cesium primitives. Until there is a smoke
check that actually boots the app, new globe-layer code should be loaded in a browser once before
it is called done.
