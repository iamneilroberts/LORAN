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
