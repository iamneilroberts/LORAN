# Interface & basemap mockups

Not application code. A decision aid for choosing the basemap treatment, the chrome layout, and
for sanity-checking the datum-plane concept before Phase 1 starts.

## Rebuild

```
python3 scripts/build_mockup_assets.py
python3 -c "t=open('docs/mockups/template.html').read(); a=open('docs/mockups/assets.json').read(); open('docs/mockups/index.html','w').write(t.replace('/*__ASSETS__*/', a))"
```

Then open `docs/mockups/index.html`.

`assets.json` and `index.html` are gitignored: they embed a ~2 MB snapshot of live traffic and go
stale within minutes. The generator and the template are the durable artifacts.

## Ground rule #1 applies here too

Every basemap tile is fetched from the real provider. Every aircraft is a real contact over Mobile
at build time, with its real callsign, registration, type, altitude and heading. The depth readout
is a real GEBCO `GetFeatureInfo` value. Nothing is synthesized to make the screens look populated —
the "NO PHOTO RETURNED" and "NO AIS SOURCE" states are showing genuine absence.

Aircraft are static because this is a snapshot, not a live feed.

## What each view is for

- **Basemaps** — eight treatments of the same view at the same zoom. Option G is the GEBCO depth
  grid remapped to a dark ramp by `scripts/make_dark_bathy.py`; H adds CARTO's vector coastline.
- **Layouts** — three chrome arrangements over identical live data.
- **Datum plane** — side elevation with real altitudes, because the datum only makes sense in
  elevation. Click any aircraft to move the datum. The x-axis is true horizontal distance, so the
  ±50 nm plane bound is honest rather than a stretched longitude spread.
