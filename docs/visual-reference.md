# Visual Reference

The owner supplied a reference image (2026-07-25) as the inspiration for this project. The image
itself is an AI render and is not in the repo. This document is the durable reading of it, so the
visual language survives into later phases without needing the original.

---

## Layout, as read off the reference

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [ARCHIVE ▾]                          ┌────────┐                  ┌─────────┐ │
│                                      │ 180°   │                  │ camera  │ │
│   ╱────────────────────╱             └────────┘                  │ cluster │ │
│  ╱  [18,000–29,000 FT] ╱  ← amber                                └─────────┘ │
│ ╱────────────────────╱                                                       │
│   ╱────────────────────╱                          ┌────────────────────────┐ │
│  ╱  [0–18,000 FT]     ╱  ← cyan                   │ CALLSIGN               │ │
│ ╱────────────────────╱                            │ ICAO24        a1b2c3   │ │
│                                                   │ CLASS       MILITARY   │ │
│ ┌──────────────────┐                              │ SPEED         441 KT   │ │
│ │ ▸ AIR TRAFFIC    │        [globe]               │ ALTITUDE     24,000 F  │ │
│ │ 580 AIRCRAFT     │                              │ HEADING          280°  │ │
│ │  ALASKA AIR   33 │                              │ LAT          31.1027   │ │
│ │  ███████         │                              │ LON        −88.0399    │ │
│ │  UPS          26 │                              │ ───────────────────    │ │
│ │  ████            │                              │ REGISTRATION       —   │ │
│ │ ▸ SEA TRAFFIC    │                              │ TYPE               —   │ │
│ │ 580 VESSELS      │                              │ OPERATOR           —   │ │
│ │  CARGO       141 │                              │ ORIGIN             —   │ │
│ │  ██████          │                              │ DESTINATION        —   │ │
│ └──────────────────┘                              │ ┌──────────────────┐   │ │
│ ┌──────────────────┐                              │ │  [photo]         │   │ │
│ │ LAT   30.6944    │                              │ └──────────────────┘   │ │
│ │ LON  −88.0399    │                              │ © photographer / ...   │ │
│ │ DEPTH  2,103 M   │                              │ [ ▸ TRACK PATH      ]  │ │
│ └──────────────────┘                              │ [   CLEAR TRACK     ]  │ │
│                                                   │ [   EXPORT TRACK    ]  │ │
│ ● ADS-B LIVE  ● AIS LIVE  ● 580 AIR  ● 580 SEA   60 FPS  WEBGL2            │ │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Elements to carry forward

| Element | Position | Phase |
|---|---|---|
| Archive / live-mode selector | top-left | 5 |
| Altitude shells with bracketed band labels | in-scene | 3 |
| Heading indicator | top-centre | 6 |
| Camera control cluster | top-right | 6 |
| Air + sea traffic panel, proportional bars | left | 4 |
| Cursor lat / lon / depth readout | bottom-left | 1 |
| Contact dossier | right | 2 |
| Feed chips, counts, FPS, renderer | bottom bar | 6 |

## Detail worth preserving

- **Band labels sit in bracketed boxes floating at the plane's edge**, tinted to match the plane
  they label — cyan for the lower band, amber for the upper. They are labels *in the scene*, not
  chrome overlaid on it.
- **The dossier's field list is two columns**: left-aligned uppercase labels, right-aligned values.
  Military class renders in amber; everything nominal in cyan. Unknown values are em-dashes.
- **The photo sits inside the dossier with its attribution line directly beneath**, small and
  low-contrast, never omitted.
- **Action buttons are full-width, stacked, 1px-bordered**, with the primary action marked by a
  leading glyph.
- **Traffic panel bars are proportional and unlabelled** — the count is the number at the right,
  the bar is just the shape of the distribution.
- **Panels are translucent over the globe.** You can see terrain through them. They never become
  opaque cards.
- Aircraft render as small heading-rotated chevrons with short motion trails.

## What we deliberately do NOT reproduce

The reference is an AI render and contains two artifacts that would violate this project's
honesty rule (see `docs/decisions.md` D-008):

1. **Impossible geography.** It labels "BERING SEA", "PACIFIC OCEAN" and "KERMADEC TRENCH" in one
   view. Those are thousands of km apart and cannot be co-visible. Any geographic labelling we do
   must come from real coordinates.
2. **Wrong icon scale.** Its aircraft are drawn far larger than real traffic would appear at that
   camera distance, and the counts ("580 AIRCRAFT" / "580 VESSELS" — suspiciously identical)
   don't correspond to a real query. Our icons scale honestly with camera distance, and every
   count is the actual length of an actual array.

The reference is vocabulary — colour, type, panel treatment, information density. It is not a
specification of what the data looks like.
