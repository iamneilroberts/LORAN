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
| **aisstream.io** | `wss://stream.aisstream.io/v0/stream` | **free key required** | 1 sub-update/sec | BETA, no SLA | **CONDITIONAL — must measure first** |
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

### 4.2 planespotters — USE, with a hard UA requirement

**This one has a gotcha that will bite silently.** With a default User-Agent it returns **HTTP 403**:

> `{"error":"Server User-Agent strings must include a contact URL or email so we can reach you, e.g. MyFlightTracker/1.2 (+https://example.com/contact)."}`

With a compliant UA (`adsb-viz/0.1 (+mailto:dneilroberts@gmail.com)`) it returns 200. Both `/pub/photos/hex/{hex}` and `/pub/photos/reg/{reg}` work.

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

**Attribution — PARTIALLY VERIFIED, please sanity-check me here.** Their `/photo/api` page is behind a Cloudflare JS interstitial that I could not read from the CLI, and WebFetch got 403. What I have is a search-engine extract of their Terms of Use stating that when linking thumbnails, attribution must not be removed and must take the form:

> `Copyright © display name/author's name` or `© display name/author's name`

The terms further state that using their thumbnails elsewhere without sufficient attribution in that format is prohibited, and that rights beyond the ToU come only from the photographer.

I am **not** confident I have the current, exact string, because I could not read the page myself. My plan for Phase 2 is to render `© {photographer} / planespotters.net` beneath the thumbnail, hyperlinked to the returned `link` (which already carries their `utm_source=api` tag), and to hotlink their CDN thumbnail rather than re-host it. **Before Phase 2 ships, please open <https://www.planespotters.net/photo/api> in a browser and confirm that wording.** This is the item on this page I'm least confident about.

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

**Why Mobile is better than your original "Gulf" framing:** Mobile Bay is a major port with a dense shipping channel, and it is *on the coast*. Coastal traffic within ~100 km of shore is the best-case scenario for this network. Had your AOI been mid-Gulf — the deepwater rig fields 300+ km out — I'd be telling you it was hopeless. As it is, I think it will probably work near Mobile and degrade fast as you pan south.

**But "probably" is not verified, and I refuse to build a vessel layer on it sight-unseen.** I have no key, so I could not measure it. Concretely, what I could not verify:

1. Whether any aisstream contributor station actually covers the Alabama/Mississippi/Florida panhandle coast.
2. The message rate for a Mobile-area bounding box.
3. How many distinct MMSIs appear per hour, and how many ever send `ShipStaticData`.

**Proposed gate before Phase 4:** you register a free key, and I write a ~30-line throwaway script that subscribes to a Mobile-area bbox for 10 minutes and reports distinct MMSIs, message rate, and static-data coverage. If that comes back with real vessels, we build Phase 4. If it comes back near-empty, we know before writing a UI for it — and your options are a paid key or dropping the vessel layer. That script is a measurement tool, not app code, so it doesn't violate the Phase-0 boundary; I'll only write it when you ask.

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

1. **aisstream.io coverage at Mobile.** No key, no measurement. The whole of Phase 4 rests on this. Gate it behind the 10-minute measurement described in §5.1.
2. **planespotters exact attribution wording.** Cloudflare-gated; my string came from a search extract of their ToU, not from reading the page. Please eyeball it (§4.2).
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
- [MarineCadastre AccessAIS](https://marinecadastre.gov/accessais/)
- [Cesium Ion reference](https://cesium.com/learn/cesiumjs/ref-doc/Ion.html)
- [Cesium without Ion — community thread](https://community.cesium.com/t/cesium-without-ion/8980)
