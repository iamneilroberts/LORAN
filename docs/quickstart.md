# LORAN — quick start

A 3D globe showing live aircraft at their real altitudes. Self-hosted, single operator, with a
handful of invited viewers.

Source: **https://github.com/iamneilroberts/LORAN** (MIT)

---

## Getting in

You were sent a link ending in `?t=…`. Open it once.

- **The link is your password.** Anyone holding it is logged in. Don't forward it.
- **Click it, don't retype it.** Repeated failures trip a rate limiter.
- One click lasts **30 days**, then open the same link again.
- If you ever see the locked panel, paste just the token part into it — that keeps it out of
  browser history and server logs.

The same link works on every device. It shows the **list** on a phone and the **console** on a
desktop, so there is nothing to remember.

---

## On a phone

**The list** is what you land on: how many contacts are up, how many are military, whether the
feed is alive, and the twelve nearest aircraft with type, distance, bearing and altitude.

**Tap any row** to open the map focused on that aircraft.

On the map:

| Control | What it does |
|---|---|
| `‹ LIST` | back to the list (the phone's back gesture works too) |
| the bar at the bottom | altitude and speed of the selected contact — tap `DETAIL ›` for everything |
| `SET` | layers, range, camera, altitude key |

Drag to turn the globe, pinch to zoom, two fingers to tilt.

In `DETAIL` you get the airframe, operator, filed route, a photo where one exists, and:

- **FOLLOW** — locks the camera to that aircraft. It keeps your angle and zoom, and you can still
  drag while it follows. Tap again to release.
- **TRACK** — draws where the contact has actually been. **EXPORT** saves that as GeoJSON.

---

## On a desktop

Same link, full console: traffic panel and controls on the left, dossier on the right, status
along the bottom. Click any aircraft on the globe to select it.

---

## Reading the display

- **Aircraft colour is altitude** — blue low through yellow at 40,000 ft+. The key is under `SET`
  on a phone, bottom-left on a desktop.
- **Magenta is military.**
- **An em-dash (—) means nobody knows**, not zero. Nothing on this display is invented to fill a
  gap.
- **"Feed unavailable" and "no contacts in range" are different things** and are always said
  separately. An empty sky is an empty sky; a dead feed says so.

### Two things that are deliberately honest rather than tidy

**Filed routes are a schedule lookup, not an observation.** They are matched on the callsign, so a
recycled or stale callsign can return a different flight's airports. When the observed track
grossly disagrees with a filed airport, the dashed line to it is **withdrawn** and the dossier
says why, rather than drawing a confident line to somewhere the aircraft is clearly not going.

**Vertical exaggeration is a lie you switch on deliberately.** Under `SET → Layers → Vertical`,
`5x` or `10x` multiplies the vertical so separation between altitudes is readable at a glance —
at real scale, 40,000 ft against a 250 nm view is about 1:38, so everything looks flat. While it
is on, an amber **NOT TRUE SCALE** banner sits over the globe. **Every number stays true** — only
the geometry is stretched. `TRUE` puts it back.

---

## Attribution

Aircraft data © airplanes.live (non-commercial) · airframe and route via adsbdb · bathymetry
GEBCO Compilation Group · places via OurAirports and Natural Earth (public domain) · geocoding ©
OpenStreetMap contributors (ODbL) · photos via planespotters.net, credited per image · weather
radar NOAA/NWS via Iowa State Mesonet when enabled.
