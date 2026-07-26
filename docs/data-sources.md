# Data Sources — Phase 0 Recon

**Date probed:** 2026-07-25
**Area of interest:** Mobile, AL (30.6944 N, −88.0399 W) — Gulf Coast / Caribbean
**Method:** live HTTP calls from this machine, not recalled from training data. Every HTTP status and payload below was actually observed. Where I could *not* verify something, it says so explicitly.

---

## 1. Verdict summary

| Feed | Endpoint | Auth | Rate limit | License / terms | Verdict |
|---|---|---|---|---|---|
| **airplanes.live** | `api.airplanes.live/v2/point/{lat}/{lon}/{r}` | none | 1 req/sec (documented) | Non-commercial, no SLA | **USE — primary ADS-B** |
| **adsb.lol** | `api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{d}` | none | dynamic, load-based | **ODbL 1.0** | **USE — fallback ADS-B** |
| **adsb.fi** | `opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{d}` | none | undocumented | Non-commercial (unverified) | **FALLBACK — 2nd reserve** |
| **OpenSky** | `opensky-network.org/api/states/all?lamin=…` | none (degraded) / OAuth2 | 400 credits/day anon | not stated in API docs | **REJECT for live use** |
| **adsbdb** | `api.adsbdb.com/v0/aircraft/{hex}`, `/v0/callsign/{cs}` | none | undocumented | open | **USE — enrichment** |
| **planespotters** | `api.planespotters.net/pub/photos/hex/{hex}` | none, **UA must carry contact** | undocumented | attribution mandatory | **USE — photos** |
| **aisstream.io** | `wss://stream.aisstream.io/v0/stream` | free key | 1 sub-update/sec | BETA, no SLA | **REJECT for Mobile — measured, zero coverage (§5.1a)** |
| **Own AIS receiver** | RTL-SDR @ 161.975 / 162.025 MHz → local NMEA | none | none | none | **RECOMMENDED path for Phase 4 (§5.1b)** |
| Finnish Digitraffic | `meri.digitraffic.fi/api/ais/v1/…` | none | generous | open | **REJECT — wrong hemisphere** |
| Norwegian BarentsWatch | `live.ais.barentswatch.no` | account | — | open-ish | **REJECT — wrong hemisphere** |
| MarineCadastre / NOAA | `marinecadastre.gov/accessais/` | none | — | US public domain | **REJECT — historical only, not live** |
| **Esri World Ocean Base** | `services.arcgisonline.com/…/Ocean/World_Ocean_Base` | none | undocumented | Esri ToS (see §6) | **USE — basemap** |
| **Esri World Imagery** | `services.arcgisonline.com/…/World_Imagery` | none | undocumented | Esri ToS | **USE — satellite** |
| **GEBCO WMS** | `wms.gebco.net/2024/mapserv` | none | undocumented | GEBCO, attribution | **USE — bathymetry + depth readout** |
| NOAA NCEI DEM | `gis.ngdc.noaa.gov/…/DEM_global_mosaic/ImageServer/identify` | none | undocumented | US public domain | **USE — depth cross-check** |
| Cesium ion | — | token | — | — | **NOT REQUIRED** (see §6) |

---

## 2. The single most important finding

**airplanes.live, adsb.lol and adsb.fi all serve the same `readsb`/`tar1090` JSON schema.** They are near-drop-in replacements for each other. The only differences I observed:

- **Envelope key:** airplanes.live and adsb.lol use `{"ac": [...], "total": N}`; adsb.fi uses `{"aircraft": [...], "resultCount": N}`.
- **Enrichment fields:** airplanes.live and adsb.fi include `desc`, `ownOp`, `year` inline. **adsb.lol omits them** — you must fill those from adsbdb.

Practical consequence: **one normalizer function handles all three**, and failover between them costs almost nothing. This is why I'm recommending a primary + two fallbacks rather than agonising over the choice — the abstraction is cheap and the risk of any single feed going down is real (all are volunteer-funded).

---

## 3. ADS-B feeds — detail

### 3.1 airplanes.live — PRIMARY

Observed live, `HTTP 200` in ~0.6 s. Five sequential calls at 1/sec all returned 200 with no throttling.

**Documented endpoints** (read from <https://airplanes.live/api-guide/>):

| Endpoint | Purpose |
|---|---|
| `/v2/hex/{hex}` | exact Mode-S hex match (max 1000) |
| `/v2/callsign/{cs}` | exact callsign match |
| `/v2/reg/{reg}` | exact registration match |
| `/v2/type/{type}` | ICAO type code (A321, B738…) |
| `/v2/squawk/{code}` | squawk match |
| `/v2/mil` | **all aircraft tagged military** |
| `/v2/ladd` | LADD-tagged aircraft |
| `/v2/pia` | PIA-tagged aircraft |
| `/v2/point/{lat}/{lon}/{radius}` | **radius query, max 250 nm** |

**Terms, quoted verbatim from the API guide header:** `No SLA` · `No Uptime Guarantee` · `Non-Commercial Use`. Also: *"Access does not currently require a feeder. That might change in the future. Contribute to Airplanes.live if use the API."*
**Rate limit, verbatim:** *"The Airplanes.live REST API is rate limited to 1 request per second."*

**Viewport scoping:** `/point` is a **radius** query, not a bounding box. There is no bbox endpoint. We must inscribe the viewport in a circle and over-fetch slightly, clamped to the 250 nm ceiling. At 250 nm the payload was **211 KB**; at 100 nm, **53 KB**.

**Military flagging:** the `dbFlags` field is a bitfield. Observed values in live data: `1` = military, `8` = LADD. `/v2/mil` returned **117 military aircraft globally**.

**Raw response shape (real capture, trimmed):**

```json
{
  "ac": [
    {
      "hex": "a939df", "type": "adsb_icao", "flight": "N694DB  ", "r": "N694DB",
      "t": "PA32", "desc": "PIPER PA-32", "ownOp": "HAMMOND FLYING CLUB INC", "year": "1975",
      "alt_baro": 7800, "alt_geom": 8300, "gs": 124.7, "track": 249.82,
      "baro_rate": 29, "geom_rate": -64, "squawk": "4652", "category": "A1",
      "lat": 29.668160, "lon": -93.990137,
      "seen_pos": 0.188, "seen": 0.2, "rssi": -28.3, "dst": 247.360, "dir": 302.7,
      "dbFlags": 8, "mlat": [], "tisb": [], "messages": 36436
    }
  ],
  "total": 95, "now": 1784995974001, "ctime": 1784995974001, "ptime": 18
}
```

**Field notes that matter for us:**
- `alt_baro` is **feet**, and can be the string `"ground"` instead of a number — must be handled. Observed `-50` as a legitimate value (below-datum baro reading).
- `alt_geom` is geometric (WGS84) altitude in feet — **this is the one to use for Cesium positioning**, since Cesium wants height above ellipsoid. Fall back to `alt_baro` when `alt_geom` is absent.
- `track` is degrees true — use for icon rotation. Can be `null` when stationary.
- `gs` is ground speed in knots.
- `seen_pos` is seconds since the position fix. Observed range **0.0 – 49.8 s**. Stale positions must be aged out or dead-reckoned honestly, not drawn as if current.

### 3.2 adsb.lol — FALLBACK

`HTTP 200` in ~1.0 s. Same `{"ac": […]}` envelope. **License is ODbL 1.0** — the only feed here with a real open-data license and no non-commercial clause. Their docs note that *in future* an API key obtainable by feeding data may be required, and that rate limits are dynamic based on load.

Live global scale, from `api.adsb.lol/0/me`: **13,211 aircraft, 5,610 beast feeders, 5,118 MLAT feeders.**

Missing vs airplanes.live: `desc`, `ownOp`, `year`. Everything else matched field-for-field on the same aircraft (`a939df`), including identical `lat`/`lon`/`alt_baro`/`gs`/`track`.

### 3.3 adsb.fi — SECOND FALLBACK

`HTTP 200` in ~0.6 s. Envelope differs: `{"aircraft": […], "resultCount": N}`. Includes `desc`/`ownOp`. Host is `opendata.adsb.fi`.

**Terms: NOT VERIFIED.** `adsb.fi` sits behind a Cloudflare JS interstitial that I could not read from the CLI. It is widely described as non-commercial/hobbyist. Treat as non-commercial until confirmed. Since it is third in line and we may never call it, I did not push harder.

### 3.4 OpenSky — REJECT for live use

It still works anonymously — this surprised me and contradicts the common claim that an account is now mandatory. Observed `HTTP 200` with header `x-rate-limit-remaining: 396`.

But the economics kill it as a live source:

| Tier | Credits/day |
|---|---|
| Anonymous | 400 |
| Standard (account) | 4,000 |
| Active feeder | 8,000 |
| Licensed | 14,400/hour |

400 credits/day is **one poll every ~3.6 minutes**. Even an authenticated 4,000/day is one poll every ~21 seconds — and bbox queries cost *more* credits as area grows. Anonymous users also get 10-second time resolution and no history.

It is also the odd one out structurally: `states` is an **array of positional arrays**, not objects, so it needs its own parser rather than sharing the readsb normalizer.

```json
{"time":1784995975,"states":[
  ["abacb6","SCX8101 ","United States",1784995973,1784995975,
   -87.2114,29.2993,9867.9,false,235.17,304.66,-4.88,null,10538.46,null,false,0]
]}
```
Indices: `0` icao24, `1` callsign, `2` origin_country, `3` time_position, `4` last_contact, `5` **lon**, `6` **lat**, `7` baro_alt (**metres**), `8` on_ground, `9` velocity (m/s), `10` true_track, `11` vertical_rate, `12` sensors, `13` geo_alt (metres), `14` squawk, `15` spi, `16` position_source, `17` category.

Note the unit trap: OpenSky is **metres and m/s**; the readsb feeds are **feet and knots**.

Auth, verbatim: *"OpenSky exclusively supports the OAuth2 client credentials flow. Basic authentication with username and password is no longer accepted."*

**Recommendation:** don't build on it. Keep the parser notes above in case you ever want it as a cross-check oracle, but it cannot drive a live display.

---

## 4. Enrichment

### 4.1 adsbdb — USE

No key, no observed rate limit, `api_version 0.6.5`, uptime 550,661 s at probe time.

**Aircraft by hex** — `GET /v0/aircraft/A536DD`:
```json
{"response":{"aircraft":{
  "type":"EMB-505","icao_type":"E55P","manufacturer":"Embraer","mode_s":"A536DD",
  "registration":"N435N","registered_owner":"NICHOLAS SERVICES LLC",
  "registered_owner_country_iso_name":"US","registered_owner_country_name":"United States",
  "registered_owner_operator_flag_code":null,
  "url_photo":null,"url_photo_thumbnail":null }}}
```

**Route by callsign** — `GET /v0/callsign/SWA1977`. This is the one that fills origin/destination, and it returns full airport records:
```json
{"response":{"flightroute":{
  "callsign":"SWA1977","callsign_iata":"WN1977",
  "airline":{"name":"Southwest Airlines","icao":"SWA","iata":"WN","country":"United States"},
  "origin":{"iata_code":"CUN","icao_code":"MMUN","name":"Cancún International Airport",
            "municipality":"Cancún","country_iso_name":"MX","latitude":21.0365,"longitude":-86.877},
  "destination":{"iata_code":"IND","icao_code":"KIND","name":"Indianapolis International Airport",
            "municipality":"Indianapolis","country_iso_name":"US","latitude":39.7173,"longitude":-86.294}}}}
```

This covers the dossier's registration / type / operator / origin / destination fields completely. It also gives us lat/lon for origin and destination airports, which we could draw later if you want great-circle route lines — not in scope, just noting it's free if you ask.

**MEASURED 2026-07-26 — the route lookup is wrong for roughly four contacts in ten, and must not be presented as observation (D-062).** `/v0/callsign/` is a *schedule* lookup: it answers "where does a flight with this callsign usually go", not "where is this airframe going today". Recycled callsigns, return legs sharing a flight number and stale records all yield another flight's route. Measured over live traffic within 250 nm of Mobile: **50 contacts, 24 carrying a filed destination, 21 checkable, 9 disagreeing with the observed ground track.** Each of the nine was then re-checked with independent geometry — signed cross-track distance from the filed origin→destination great circle — and all nine sat **193 to 634 nm off their filed route**; DAL2823 (filed SLC→SEA) and SWA440 (filed DAL→MCI) were each *further from their filed route than that route is long*. Zero false positives in the sample.

Consequences, both already shipped: the dossier labels these rows `Filed orig` / `Filed dest` with a `Filed schedule · adsbdb · not live` caption rather than a bare `Origin` / `Dest`, and a gross disagreement is called out in amber while the dashed destination line is withdrawn. **The aircraft-by-hex endpoint is unaffected** — registration, type and operator are properties of the airframe and stay trustworthy. This caveat is specific to the callsign→route endpoint.

### 4.2 planespotters — USE, with a hard UA requirement

**This one has a gotcha that will bite silently.** With a default User-Agent it returns **HTTP 403**:

> `{"error":"Server User-Agent strings must include a contact URL or email so we can reach you, e.g. MyFlightTracker/1.2 (+https://example.com/contact)."}`

With a compliant UA (`loran/0.1 (+mailto:adsb@voygent.ai)`) it returns 200. Both `/pub/photos/hex/{hex}` and `/pub/photos/reg/{reg}` work.

```json
{"photos":[{
  "id":"1843440",
  "thumbnail":{"src":"https://t.plnspttrs.net/22271/1843440_3412d7200c_t.jpg",
               "size":{"width":200,"height":112}},
  "thumbnail_large":{"src":"https://t.plnspttrs.net/22271/1843440_3412d7200c_280.jpg",
                     "size":{"width":497,"height":280}},
  "link":"https://www.planespotters.net/photo/1843440/00-0184-united-states-air-force-boeing-c-17a-globemaster-iii?utm_source=api",
  "photographer":"Xiangyu Huang"}]}
```

A miss returns `{"photos":[]}` — an empty array, **not** a 404. The dossier must render an honest "no photo" state for this, not a placeholder image.

**Terms — NOW VERIFIED.** Owner supplied the full Photo API Terms of Use on 2026-07-25 (the page is Cloudflare-JS-gated and unreadable from the CLI). My earlier guess at the attribution format was **wrong**, and one clause changes our architecture. Binding requirements:

| # | Requirement | Consequence for us |
|---|---|---|
| 1 | Photos may not be a paid/premium/member-only feature; must be freely available to all users; thumbnail sizes identical across access levels | N/A — single user, no auth. Satisfied trivially. |
| 2 | **Each photo must credit the photographer in text visible next to the image**, and the thumbnail **must link to the photo's page using the `link` URL from the response**. Plain anchor — **no `rel="nofollow"`** or equivalent. | Dossier renders photographer text + wraps thumbnail in a plain `<a href={link}>`. |
| 3 | Browser clients must send a valid `Origin` or `Referer` | See empirical finding below — this path does not work for us. |
| 4 | Server-side clients must send a unique descriptive User-Agent including a contact URL or email | `LORAN_USER_AGENT` in `.env`. Generic defaults (`curl/8.0`, `python-requests`) discouraged. |
| 5 | JSON may be cached server-side **up to 24 h**. **Image binaries must never be downloaded, stored, or re-hosted** — they must load in the end user's browser from the returned URLs. | **Backend must not proxy images.** Backend caches JSON only; `<img src>` points at their CDN. |
| 6 | All returned URLs used **unchanged**. No proxying, rewriting, or hot-link-protection bypassing. | Never rewrite `thumbnail.src` / `link`. |
| 7 | **Photos and metadata must not be used to train, fine-tune, evaluate, or build datasets for ML/AI models** | Never feed photo data to an LLM. Reinforces the existing no-AI-summarization non-goal. |
| 8 | Re-exposing the API or its data through your own API, feed, bulk export, or dataset is prohibited | Our backend endpoint stays private to this single-user app. **Never expose it publicly.** |
| 9 | Use must stay within reasonable limits; bursty traffic may be throttled | Cache hard, fetch only on selection, never bulk-prefetch. |
| 10 | Access revocable at any time, with or without notice | Photo absence must be a normal state, never an error screen. |

Also documented: the API is free, needs no key, queries by registration or hex only, **returns at most one photo**, and takes no custom parameters. Thumbnail sizes: regular is 200 px wide (landscape) or 180 px tall (portrait); large is 280 px tall with width typically 360–500 px.

**Empirical finding that forces the architecture.** I tested all four access paths:

| Test | Origin | User-Agent | Result |
|---|---|---|---|
| A | `http://localhost:5173` | browser (`Mozilla/5.0 … Chrome/126`) | **403** |
| B | `https://adsb.example.com` | browser | **403** |
| C | *none* | `curl/8.0` | 200 |
| D | *none* | `loran/0.1 (+mailto:…)` | **200** |
| E | image CDN hotlink w/ `Referer` | browser | **200**, `image/jpeg`, 8,349 B |

Their gate is enforced on **User-Agent**, not Origin — a request carrying a valid `Origin` but an ordinary browser UA is rejected. Since **browsers forbid scripts from setting `User-Agent`** (it's a forbidden header name), the documented browser-direct path is **not usable by us**. Test C also shows the "generic library defaults may be blocked" rule is not currently enforced — but we will not rely on that.

**Resulting design, which is both forced and compliant:**

1. **Backend** fetches the JSON with the contact-carrying UA (path D) and caches it ≤ 24 h — explicitly permitted by clause 5.
2. **Frontend** receives the URLs and puts `thumbnail_large.src` straight into an `<img>`. The browser loads the binary from their CDN (path E, verified). We never download, store, proxy, or rewrite it — clauses 5 and 6.
3. **Frontend** renders the photographer credit as visible text beside the image, and wraps the thumbnail in a plain anchor to `link` — clause 2.

Note the CDN host on live responses is `t.plnspttrs.net`, not the `cdn.planespotters.net` shown in their docs example. Using returned URLs unchanged handles this automatically — another reason clause 6 matters.

A miss returns `{"photos":[]}` — an empty array, **not** a 404. The dossier must render an honest "no photo" state for this, not a placeholder image.

---

## 5. AIS — the risk, stated bluntly

**You should not assume the vessel layer will work before we measure it.**

### 5.1 aisstream.io — the only realistic option for Mobile

- **Endpoint:** `wss://stream.aisstream.io/v0/stream` (wss only)
- **Auth:** free API key, GitHub sign-in. You said you're happy to register — you'll need to.
- **Handshake:** must be sent **within 3 seconds** of opening the socket or the connection is closed.

```json
{"APIKey":"…","BoundingBoxes":[[[lat1,lon1],[lat2,lon2]]],
 "FilterMessageTypes":["PositionReport","ShipStaticData"]}
```

- **Limits:** max 1 subscription update/sec; max 50 MMSI filters; they advise capacity to handle **~300 msg/sec** average on an unfiltered feed.
- **Response shape:**

```json
{"MessageType":"PositionReport",
 "MetaData":{"MMSI":259000420,"ShipName":"VESSEL_NAME",
             "latitude":-54.0,"longitude":-87.0,"time_utc":"2022-12-29 18:22:32 +0000 UTC"},
 "Message":{"PositionReport":{"UserID":259000420,"MessageID":1,
             "Latitude":66.02695,"Longitude":12.253822,"Sog":0,"Cog":308}}}
```

`PositionReport` carries position/speed/course. Vessel **name, type, destination and ETA arrive separately** in `ShipStaticData`, broadcast far less often (every few minutes, vs seconds for position). The backend must join the two streams and keep a static-data cache, or the dossier will be mostly em-dashes for the first several minutes after a vessel appears.

**Coverage — the honest part.** Their own coverage page states, verbatim: they offer *"a live AIS message feed of roughly 200km off the majority of the world's coastlines"* and *"we do not offer 100% coverage for the entire globe and do not receive AIS messages for vessels multiple hundreds of kilometers off shore."*

It's a volunteer receiver network, exactly like the ADS-B feeds. AIS is VHF and line-of-sight, so a shore station reaches ~40–80 km for Class-A vessels in practice, with the 200 km figure being a best case.

### 5.1a MEASURED — and the answer is no

**Status: measured 2026-07-25 with the owner's key. aisstream.io does not cover Mobile.**

Probe: `scripts/ais_coverage_probe.py`. Raw reports in `docs/measurements/`. Reproduce with the
commands in that script's docstring.

| Probe | Box | Duration | Messages | Distinct vessels | Rate | Westernmost fix |
|---|---|---|---|---|---|---|
| **Mobile Bay** (run 1) | 30.1–31.0 N, 88.4–87.8 W | 182 s | **0** | **0** | **0.00/s** | — |
| **Mobile Bay** (run 2) | 30.1–31.0 N, 88.4–87.8 W | 182 s | **0** | **0** | **0.00/s** | — |
| Mobile region (run 1) | 28.0–31.5 N, 90.0–86.0 W | 606 s | 50 | 23 | 0.08/s | −87.5413 |
| Mobile region (run 2) | 28.0–31.5 N, 90.0–86.0 W | 427 s | 25 | 13 | 0.06/s | −87.5413 |
| Gulf of Finland (control 1) | 59.0–60.5 N, 20.0–26.0 E | 122 s | 137 | 102 | 1.12/s | — |
| **Gulf of Finland (control 2)** | 59.0–60.5 N, 20.0–26.0 E | 121 s | 132 | **106** | **1.09/s** | — |

**Mobile Bay returned literally nothing** — zero messages in three minutes, run twice, hours
apart. Not sparse. Zero.

The two wide-box runs independently produced a westernmost observed fix of **−87.5413**, agreeing
to four decimal places. That is not sampling noise; it is the hard edge of one receiver's range.

The control rules out the obvious alternative explanations. Same script, same key, same machine,
minutes apart: the Gulf of Finland returned **106 distinct vessels in two minutes**. The tooling
works, the key is valid, the subscription format is correct. The Gulf Coast is simply not covered.

**Where the coverage actually is.** In the wide 4° box, every observed position fell within
lat 29.23–30.51, lon **−87.54 to −86.33**. Mobile is at −88.04. Not one vessel was seen at or
west of −87.54, which puts the nearest observed traffic roughly **50 nm east of Mobile**, off
Pensacola. The whole western half of the box — Mobile Bay, Mississippi Sound, the Louisiana
coast, the Mississippi delta — produced nothing at all.

That footprint is consistent with **a single volunteer receiver near Pensacola** and no station
anywhere else on the northern Gulf coast. It is not a bad-luck sampling artifact; it is a hole in
the network.

Static data is also thin where coverage does exist: only 5 of 23 vessels (22%) ever sent
`ShipStaticData` during the 10-minute window, and the control showed 9–18% over two minutes. So
even in covered water, most vessels would render with an em-dash for name, type and destination
for the first several minutes.

**Verdict: the vessel layer as specified — vessels near your house — cannot be built on
aisstream.io.** Phase 4 is blocked on a data source, not on code.

### 5.1b Options, ranked

**1. Feed your own AIS receiver.** *Recommended.* AIS is unencrypted VHF on 161.975 and
162.025 MHz with ~40–75 km line-of-sight range. An RTL-SDR plus a marine-band vertical, fed by
[AIS-catcher](https://github.com/jvde-github/AIS-catcher) or `rtl_ais`, receives Mobile Bay
directly. You already build ESP32 ADS-B receivers, so this is squarely in your wheelhouse, and you
may already own the SDR. Roughly $30 for the dongle and $40 for an antenna, and antenna height
matters more than either.

This is the only option that gives *good* coverage of your actual AOI rather than adequate
coverage of someone else's, and it removes the upstream dependency entirely — your own receiver
feeding your own backend over UDP/NMEA. Feeding [AISHub](https://www.aishub.net/join-us) in return
grants access to their aggregated global feed, the same reciprocal model as ADS-B feeding, which
would cover the wider globe view as a bonus.

Architecturally this is *easier* than aisstream, not harder: local NMEA on a UDP port, no
WebSocket, no key, no rate limit, no terms.

**2. Paid AIS API.** MarineTraffic, VesselFinder, Spire and similar sell satellite+terrestrial
feeds with real Gulf coverage. Costs real money per month and reintroduces a rate-limited upstream.
Worth it only if you want global vessel coverage without hardware.

**3. Build Phase 4 anyway, honestly scoped.** aisstream works fine ~50 nm east. The layer would
function, correctly show nothing over Mobile, and populate when you pan toward Pensacola. Per the
project's first ground rule that is an *honest* empty state, not a broken one — but it does not
deliver what you asked for.

**4. Drop the vessel layer.** Phases 1, 2, 3, 5 and 6 do not depend on AIS. Nothing else in the
project is blocked by this.

**My recommendation: don't decide now.** Phase 4 is the fourth of six phases. Build Phases 1–3 on
ADS-B, which is verified excellent over Mobile, and decide about AIS when you get there — by
which time you will know whether you want to put an antenna on the roof. Nothing about Phases 1–3
forecloses any of these options.

### 5.2 Regional open feeds — REJECT for your AOI

Both are excellent and genuinely open. Both are useless for Mobile.

- **Finnish Digitraffic** (`meri.digitraffic.fi/api/ais/v1/locations`): returned `HTTP 406` to my probe (needs a specific `Accept` header), but this is moot — it covers the Baltic. ~8,000 km from your AOI.
- **Norwegian BarentsWatch** (`live.ais.barentswatch.no`): `HTTP 200`, alive. Norwegian coastal waters. `ais.kystverket.no` returned `HTTP 503` at probe time.

I'm recording them because your AOI could change, and because if you ever want to *demo* the vessel layer with guaranteed-dense data, pointing it at the Gulf of Finland is the honest way to do it — clearly labelled as a different region, not as fake local data.

### 5.3 MarineCadastre / NOAA — REJECT for live

US Coast Guard AIS via NOAA/BOEM covers US waters comprehensively, including the Gulf, and is public domain. But it is **historical only** — monthly GeoParquet files added quarterly, roughly 25 billion positions over a decade. There is no live endpoint.

Not useful for the live layer. Possibly interesting much later for the archive (a "compare today against the 2024 baseline" feature), but that's not in scope and I'm not proposing it.

---

## 6. Basemap, bathymetry, and the Cesium ion question

### 6.1 Is a Cesium ion token required? **No — not for anything you asked for.**

This matters given your 8 GB RTX 2000 Ada. Breaking it down:

| Capability you asked for | Needs ion? | Keyless path |
|---|---|---|
| Dark satellite basemap | No | Esri World Imagery tiles |
| Ocean depth **shading** | No | Esri World Ocean Base + GEBCO WMS |
| Depth **readout** under cursor | No | GEBCO `GetFeatureInfo` or NOAA `identify` |
| Aircraft at true altitude above ellipsoid | No | this is pure Cesium math, no terrain needed |
| Translucent volumes at real altitudes | No | pure Cesium geometry |
| 3D **land** terrain relief | Yes | ion World Terrain — *optional, we skip it* |
| True 3D **seafloor** geometry | Yes | ion World Bathymetry — *optional, we skip it* |

Set `Ion.defaultAccessToken = null` and use `EllipsoidTerrainProvider`. You lose 3D relief; you keep everything on your actual requirements list, and you save the VRAM you were worried about. Bathymetry becomes a *shaded image draped on a smooth ellipsoid* plus a *numeric depth readout* — which is exactly what your reference image shows, and what your stated requirement ("ocean depth shading and a depth readout under the cursor") asks for.

If you later want the seafloor to have real 3D shape, that's a free ion token and a one-line provider swap. I'd wait until you've seen the keyless version.

### 6.2 Esri tiles — verified working, keyless

Both tile fetches returned real JPEGs with no key:

| Service | Tile test | Attribution string (from service metadata) |
|---|---|---|
| `Ocean/World_Ocean_Base` | `HTTP 200`, `image/jpeg`, 25,475 B | `Esri, Garmin, GEBCO, NOAA NGDC, and other contributors` |
| `World_Imagery` | `HTTP 200`, `image/jpeg`, 11,514 B | `Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community` |

**Caveat I want on the record:** these endpoints are keyless *in practice*, but Esri's terms generally contemplate an ArcGIS account for application use, and they'd be within their rights to gate them. For single-user homelab use this is low-risk. We must display the attribution strings above — that's not optional, and it's cheap: one line in the status bar.

### 6.3 GEBCO — bathymetry AND the depth readout

`GetCapabilities` returned `HTTP 200`, 21,613 bytes. Layers available include `GEBCO_2024_Grid`, `GEBCO_2024_SUB_ICE_TOPO`, and TID (source-type) layers.

**Cesium compatibility: confirmed.** Supported CRS are `EPSG:4326`, `EPSG:3857`, `EPSG:3395` — so `WebMapServiceImageryProvider` consumes it directly with no proxy or reprojection. A `GetMap` test returned a valid 9,147-byte PNG.

**The depth readout works, and I cross-validated it.** GEBCO supports `GetFeatureInfo`, returning a numeric value:

```
Layer 'GEBCO_2024_2'
  Feature 0:
    x = '-88.49375'   y = '27.99375'   value_list = '-2103'
```

Independently, NOAA NCEI's global DEM `identify` endpoint at the same point returned `"value":"-2095.64"`.

**−2103 m vs −2095.6 m — agreement to ~7 m (0.35%) between two independent DEMs.** That's well within expected inter-source variance, and it means the depth readout will show real numbers, not plausible-looking ones. GEBCO is the primary (single request, matches the imagery we're already drawing); NOAA is a good fallback and a useful sanity check.

Values are **metres, negative below sea level**. Land returns positive elevation, so the same readout serves both — "DEPTH 2,103 M" over water, "ELEV 63 M" over land.

---

## 7. Things I could not verify

Listed plainly, because these are where I could be wrong:

1. ~~**aisstream.io coverage at Mobile.**~~ **RESOLVED 2026-07-25 — measured, and the answer was no. See §5.1a.** Caveat on the finding: it is a snapshot of ~20 minutes total observation on one afternoon. A volunteer station could come online tomorrow, and one could have been briefly offline during my window. The zero is reproducible across two separate runs and the control rules out tooling error, so I am confident in the conclusion — but it is a statement about today's network, not a permanent law.
2. ~~**planespotters exact attribution wording.**~~ **RESOLVED 2026-07-25** — owner supplied the full terms; my guess was wrong and the corrected requirements are in §4.2.
3. **adsb.fi terms.** Cloudflare-gated. Assumed non-commercial.
4. **OpenSky licensing/attribution.** Their API docs simply don't state it. Moot given the reject verdict.
5. **Esri tile-service terms for application use.** Keyless in practice; I did not find a definitive statement blessing unauthenticated app use.
6. **Rate limits under sustained load.** I tested 5 calls at 1/sec against airplanes.live, all 200. I did not run a long soak, so I haven't seen the throttle behaviour, and I don't know what a 429 from them looks like. The client must handle it gracefully regardless.

---

## 8. Recommendation

**ADS-B:** airplanes.live primary, adsb.lol fallback, adsb.fi second reserve, behind one normalizer. Poll `/point` at 1 req/sec max, radius derived from viewport and clamped to 250 nm. Use `alt_geom` for Cesium height, falling back to `alt_baro`. Age out fixes by `seen_pos`. OpenSky rejected.

**Enrichment:** adsbdb for registration/type/operator/route, cached hard — this data is static per airframe and there's no reason to ask twice. planespotters for photos, with a compliant contact-carrying UA, cached, empty-state honest.

**Basemap:** fully keyless. Esri World Imagery + Esri Ocean Base + GEBCO WMS overlay, `EllipsoidTerrainProvider`, `Ion.defaultAccessToken = null`. Depth readout from GEBCO `GetFeatureInfo`.

**AIS:** blocked pending measurement. Register an aisstream.io key when convenient; we measure before we build.

---

## 9. One thing your spec should change

Your altitude bands are 0–18,000 ft and 18,000–29,000 ft. Live sample around Mobile, 100 nm radius, 95 aircraft:

| Band | Count |
|---|---|
| 0–18,000 ft | 59 |
| 18,000–29,000 ft | 7 |
| **above 29,000 ft** | **27** |
| on ground | 2 |

Observed ceiling: **43,000 ft**.

The two bands you specified capture 66 of 95 aircraft and leave **28% of your local traffic floating above the top shell with nothing to reference it against** — including essentially all the airline overflight traffic, which is the most visually obvious thing in the sky. The 18,000–29,000 band, meanwhile, contains 7 aircraft.

I'd suggest a third band at 29,000–43,000 ft (FL290–FL410, the RVSM stratum). Bands are configurable per your spec, so this is a default-value question, not an architecture one — but the default should reflect the sky you actually have over Mobile.

Also worth knowing: **9 of 95 aircraft were military** — T-6B Texan IIs and TH-73A Thrashers from the Whiting Field / Pensacola training complex. Your airspace is unusually military-dense, so the amber military treatment is going to be doing real work, not sitting unused.

---

## Sources

- [Airplanes.live REST API Guide](https://airplanes.live/api-guide/)
- [adsb.lol Open Data / API](https://www.adsb.lol/docs/open-data/api/)
- [OpenSky Network REST API docs](https://openskynetwork.github.io/opensky-api/rest.html)
- [aisstream.io documentation](https://aisstream.io/documentation)
- [aisstream.io coverage](https://aisstream.io/coverage)
- [Planespotters.net Terms of Use](https://www.planespotters.net/legal/termsofuse)
- [Natural Earth](https://www.naturalearthdata.com/) — public domain. Used at BUILD TIME only, by `scripts/build_places.py` (populated places) and `scripts/build_boundaries.py` (admin_1 states/provinces worldwide from the **50m** cut; admin_2 counties, **United States only**, 10m — Natural Earth publishes no admin_2 layer for the rest of the world). Baked to `frontend/src/data/boundaries.json` at 0.01° simplification; sizes and the reasoning are in D-063.
- [MarineCadastre AccessAIS](https://marinecadastre.gov/accessais/)
- [Cesium Ion reference](https://cesium.com/learn/cesiumjs/ref-doc/Ion.html)
- [Cesium without Ion — community thread](https://community.cesium.com/t/cesium-without-ion/8980)
