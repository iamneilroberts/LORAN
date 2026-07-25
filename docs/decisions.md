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
four values are `.env`-tunable (`ADSBVIZ_ADSBDB_*`).

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

**Sample floor (`ADSBVIZ_TRACK_SAMPLE_SECONDS`, default 5 s).** The poll runs every 2 s. Storing
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
