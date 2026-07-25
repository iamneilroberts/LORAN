# Design note — reading altitude and relative position (Phase 3)

**Status:** proposed, awaiting sign-off. Written 2026-07-25.

The stated goal, in the owner's words: *"see where two or more observed craft are in relation to
each other"*, viewed *"from a perspective from altitude"*, with altitude shown as coloured
geometric planes.

Nothing here is infeasible. The owner offered to drop the idea; it does not need dropping. The
owner's own suggestion — a plane at the *selected* aircraft's altitude — is better than the
fixed-band approach in the original spec, and this note builds on it.

---

## The actual problem

In a 3D perspective projection, **height and distance-from-camera are visually confounded.** An
aircraft that is far away and high occupies nearly the same screen position as one that is near
and low. This is not a rendering-quality issue; it is inherent to perspective, and no amount of
prettier icons fixes it.

So the naive version of this feature — draw aircraft at true altitude, add some translucent
planes — *looks* like an instrument while measuring almost nothing. That is the failure mode
worth designing against.

Human vision is, however, extremely good at one specific judgement: **is this object above or
below that surface?** The design leans entirely on that.

---

## Proposal

### 1. The datum plane — the owner's idea, as the primary mechanism

On selecting an aircraft, a translucent grid plane appears **at exactly that aircraft's altitude**,
tangent to the ellipsoid, extending a configurable radius (default 50 nm) around it.

This converts an absolute judgement ("how high is that one?") into a binary one
("is it above or below the plane?"). Every other contact becomes instantly readable:

| Position | Meaning |
|---|---|
| Above the plane | higher than the selected aircraft |
| Below the plane | lower |
| On / intersecting | co-altitude |

The plane **follows the selection.** Select a different aircraft, the datum moves. It is a
movable measuring surface, not scenery.

### 2. Relative colouring — the part that makes it an instrument

While a datum is active, recolour every *other* contact by its altitude **relative to the
selected one**, not by absolute band:

| Relative altitude | Treatment |
|---|---|
| Above datum | cyan `#5fd7e0` |
| Below datum | same hue, reduced luminance |
| **Within separation minimum** | **amber `#ffb000`** |

Separation minimum defaults to **±1000 ft** (RVSM vertical separation at FL290 and above;
±500 ft applies below FL290 — configurable, and the default should switch on the datum's own
altitude).

This is the feature. *Co-altitude and horizontally close* is the only combination that actually
means anything operationally, and amber makes it pop out of a field of cyan without the user
comparing anything by eye.

### 3. Drop-lines — to the datum, not the ground

A vertical line from each aircraft to the datum plane. Two things fall out of this:

- **Line length encodes |Δaltitude| directly** as a visible quantity.
- **The foot of the line shows true horizontal position**, which perspective otherwise hides —
  this is what lets you see that two aircraft which *look* adjacent are actually 15 nm apart.

Dropping to the **datum** rather than the ellipsoid surface is deliberate: it makes the line a
*comparison* rather than an absolute, and keeps lines short and legible instead of every aircraft
trailing a 35,000 ft streak to the ground.

When no aircraft is selected, drop-lines fall back to the nearest fixed band below (see §4), so
the display degrades sensibly rather than switching off.

### 4. Fixed airspace bands — kept, but demoted to context

The original spec's shells (0–18,000 ft, 18,000–29,000 ft) stay, as a **separately toggleable
layer** answering a different question:

- **Airspace bands** — static. *"Where does this sit in the airspace structure?"* Class A floor,
  RVSM stratum. Context.
- **Datum plane** — dynamic. *"Who is near **this** aircraft?"* Measurement.

Default: bands off, datum on when something is selected.

### 5. Numeric pair readout — the ground truth

3D gives gestalt; numbers give certainty. The view should never be the only evidence.

Shift-click a second aircraft → a readout showing **Δaltitude (ft)**, **horizontal separation
(nm)**, **slant range (nm)**, and **closing / opening**. Both aircraft get a connecting line.

If the geometry and the numbers ever disagree, the numbers are right and the render has a bug.

---

## This resolves the third-band question

`docs/data-sources.md` §9 flagged that 28% of live traffic over Mobile sits above 29,000 ft, with
nothing to reference it against, and proposed adding an FL290–FL410 band.

**With the datum plane, that fix is no longer needed.** The datum works at *any* altitude,
including 43,000 ft, because it is derived from the selected aircraft rather than from a fixed
table. The two spec'd bands can stay exactly as written — they are context, and their coverage
gap stops mattering once measurement is handled by a mechanism that has no gap.

Bands remain configurable, so a third band is still available to anyone who wants it. It is just
no longer load-bearing.

---

## Feasibility

Every element is standard CesiumJS. No new dependencies, no custom shaders required.

| Element | Implementation |
|---|---|
| Datum / band planes | polygon or rectangle entity at constant `height`, grid material, translucent |
| Drop-lines | `PolylineCollection`, `Cartesian3.fromDegrees(lon, lat, alt)` → `(lon, lat, datumAlt)` |
| Relative colouring | per-billboard colour update on selection change |
| Band labels | bracketed billboard/label at the plane edge, tinted to the plane |
| Pair readout | arithmetic; no rendering involved |

The one real cost is **drop-lines at scale** — 95 aircraft near Mobile is nothing, but a wide
viewport at 250 nm returned 211 KB of aircraft. Drop-lines should be limited to contacts within
the datum's radius rather than drawn for every aircraft on screen. Flagged now; will confirm with
a frame-time measurement during Phase 3 rather than guessing.

---

## Resolved — the datum plane is finite

**Decided by the owner, 2026-07-25: finite.** A bounded plane around the selected aircraft,
radius configurable, default 50 nm.

Rationale: it reads as an instrument attached to a specific aircraft and stays legible when
several contacts are in play. An infinite sheet would look more like the reference image and be
more dramatic, but it gets visually noisy and implies comparisons across distances where
"co-altitude" has stopped meaning anything — two aircraft level with each other but 300 nm apart
have no relationship worth drawing.

Consequences for implementation:
- The plane's edge is a visible boundary, so it needs an edge treatment — a brighter 1px rim, per
  the panel language in the visual direction.
- Drop-lines are drawn only for contacts **inside** the radius. This is also the performance
  answer from the section above: the cap falls out of the design rather than being imposed on it.
- The radius wants to be adjustable live (not just config), because the useful radius differs
  between "who is in the pattern with this trainer" and "who is on this airliner's level".
