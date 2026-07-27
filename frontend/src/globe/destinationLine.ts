/**
 * Dashed lines from the selected contact to the FILED ends of its route - back to the origin and
 * on to the destination.
 *
 * This is a different KIND of claim from the projection envelope, and it has to look like one.
 * The envelope is a kinematic what-if we compute: "where it reaches if it holds this speed and
 * track" (D-047). This is not computed at all - it is a fact adsbdb reports about the flight
 * plan, and the aircraft is under no obligation to honour it. Drawing them in the same visual
 * language would blur "what we worked out" into "what was filed", which is its own kind of lie.
 *
 * So: DASHED (the envelope is solid), and cyan rather than amber - cyan is the colour this
 * project already uses for reported civil data, amber for the instruments we derive.
 *
 * Two segments, and the split is the honest part:
 *
 *   1. A great-circle run held at the CONTACT'S CURRENT ALTITUDE, ending above the airfield.
 *   2. A vertical plumb line from there down to the airfield on the ground.
 *
 * It is tempting to draw one straight line from the aircraft down to the runway. That would
 * render a descent profile we have not computed and have no source for - a plausible-looking
 * invention. A level run plus a plumb drop claims only what we actually know: this bearing,
 * this distance, and the destination is on the ground beneath that point. The plumb line also
 * reuses the idiom DROP LINE already established, so it reads as "the ground is below here"
 * rather than as a flight path.
 *
 * Nothing is drawn when adsbdb has no coordinates for that end of the route.
 *
 * The BACKWARD leg to the filed origin (D-074) is the same geometry pointing the other way, and
 * deliberately the same visual language: both ends come from one adsbdb schedule lookup and are
 * exactly as trustworthy as each other, so drawing one more confidently than the other would
 * assert a distinction that does not exist. The label says which end it is; the line does not.
 *
 * The origin leg is NOT the track path. The track is where we watched the contact go; this is
 * where a schedule says it started, and we did not see any of it.
 *
 * ENTITIES ARE MUTATED, NEVER CLEARED AND RE-ADDED (D-074). Measured against live data, 34 of 35
 * cruising contacts changed at least one input to Globe.tsx's rebuild key across a single 2 s
 * poll - position at `toFixed(2)` alone accounted for 32 of them, since 0.01 degrees is ~1.1 km
 * and a jet crosses that in about four seconds. So the old clear()-then-add() ran essentially
 * every poll, tearing down the polyline primitives and blinking the line off. Coarsening the key
 * is not the fix: the arc starts AT the aircraft, so its position has to stay fine-grained or the
 * line detaches from the contact it belongs to. `upsertPlane` already reached this conclusion for
 * the datum slice; this module now follows it.
 */
import {
  ArcType,
  Cartesian3,
  Color,
  Entity,
  PolylineDashMaterialProperty,
  Viewer,
} from "cesium";

import { palette } from "../styles/palette";

export const DEST_PREFIX = "dest::";
export const ORIGIN_PREFIX = "orig::";

const FT_TO_M = 0.3048;

export interface DestinationSpec {
  /** Contact's present position. */
  lat: number;
  lon: number;
  /** Contact's present altitude in feet. The level run is held here. */
  altFt: number;
  /** Filed destination, from adsbdb. */
  destLat: number;
  destLon: number;
  /** Airport code for the label - ICAO or IATA, whichever we have. */
  code: string;
}

export interface OriginSpec {
  /** Contact's present position. */
  lat: number;
  lon: number;
  /** Contact's present altitude in feet. The level run is held here. */
  altFt: number;
  /** Filed origin, from adsbdb. */
  origLat: number;
  origLon: number;
  /** Airport code for the label - ICAO or IATA, whichever we have. */
  code: string;
}

/**
 * Great-circle points from origin to destination at a constant height.
 *
 * Cesium would interpolate a two-point geodesic for us, but only across the surface: we need
 * the intermediate points to carry the aircraft's altitude, so the run stays level instead of
 * sagging through the terrain on a long leg.
 */
export function levelArc(
  lat1: number, lon1: number, lat2: number, lon2: number, heightM: number, steps = 64,
): Cartesian3[] {
  const rad = Math.PI / 180;
  const φ1 = lat1 * rad, λ1 = lon1 * rad, φ2 = lat2 * rad, λ2 = lon2 * rad;

  const dλ = λ2 - λ1;
  const sinφ1 = Math.sin(φ1), cosφ1 = Math.cos(φ1);
  const sinφ2 = Math.sin(φ2), cosφ2 = Math.cos(φ2);

  // Angular distance between the two points.
  const δ = Math.acos(
    Math.min(1, Math.max(-1, sinφ1 * sinφ2 + cosφ1 * cosφ2 * Math.cos(dλ))),
  );
  const out: Cartesian3[] = [];
  // Tolerance, not equality, and the tolerance is a DISTANCE. For two identical points the dot
  // product lands a hair under 1.0 in floating point, so acos returns a small non-zero angle and
  // an `=== 0` guard never fires - leaving a division by a near-zero sin(δ) that degenerates to
  // NaN once it underflows. Measured: 1.49e-8 rad (~9.5 cm) at lat 30.69, but exactly 0 at lat
  // 0/45/60.5/-33.9, so the fault is LATITUDE-DEPENDENT and would have surfaced intermittently.
  // 1e-6 rad is ~6.4 m on the ellipsoid: below that, two airports are the same airport.
  // Written `!(δ > TOL)` so a NaN δ takes this branch too rather than falling through.
  if (!(δ > 1e-6)) return [Cartesian3.fromDegrees(lon1, lat1, heightM)];

  const sinδ = Math.sin(δ);
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const a = Math.sin((1 - f) * δ) / sinδ;
    const b = Math.sin(f * δ) / sinδ;
    const x = a * cosφ1 * Math.cos(λ1) + b * cosφ2 * Math.cos(λ2);
    const y = a * cosφ1 * Math.sin(λ1) + b * cosφ2 * Math.sin(λ2);
    const z = a * sinφ1 + b * sinφ2;
    out.push(Cartesian3.fromDegrees(
      Math.atan2(y, x) / rad,
      Math.atan2(z, Math.sqrt(x * x + y * y)) / rad,
      heightM,
    ));
  }
  return out;
}

/** Remove every entity owned by one leg. */
function clear(viewer: Viewer, prefix: string): void {
  viewer.entities.values
    .filter((e) => String(e.id).startsWith(prefix))
    .forEach((e) => viewer.entities.remove(e));
}

/**
 * Draw or update one filed leg, between the contact and an airfield. Returns its entities.
 *
 * Mutates in place when the leg is already on screen - see the note at the top of the file. The
 * three entities are created together and mutated together, so a partially-present set (only
 * possible if something outside this module removed one) falls back to a clean rebuild rather
 * than trying to patch around the gap.
 */
function upsertLeg(
  viewer: Viewer,
  prefix: string,
  labelText: string,
  contact: { lat: number; lon: number; altFt: number },
  field: { lat: number; lon: number },
): Entity[] {
  const { cyan } = palette();
  // Dimmer than the track. The track is where the contact HAS been - observed fact. This is
  // where a schedule says it came from or is going, which is a weaker claim and should not
  // shout as loudly.
  const colour = Color.fromCssColorString(cyan).withAlpha(0.55);
  const material = new PolylineDashMaterialProperty({
    color: colour,
    dashLength: 12,
  });

  const heightM = contact.altFt * FT_TO_M;
  const arc = levelArc(contact.lat, contact.lon, field.lat, field.lon, heightM);
  const plumb = [
    Cartesian3.fromDegrees(field.lon, field.lat, heightM),
    Cartesian3.fromDegrees(field.lon, field.lat, 0),
  ];
  const labelPos = Cartesian3.fromDegrees(field.lon, field.lat, heightM);

  const legId = `${prefix}leg`;
  const plumbId = `${prefix}plumb`;
  const labelId = `${prefix}label`;

  const existingLeg = viewer.entities.getById(legId);
  const existingPlumb = viewer.entities.getById(plumbId);
  const existingLabel = viewer.entities.getById(labelId);

  if (existingLeg && existingPlumb && existingLabel) {
    if (existingLeg.polyline) {
      existingLeg.polyline.positions = arc as never;
      // Re-applied on every update for the same reason upsertPlane re-applies its material: an
      // entity would otherwise keep the colour it was CREATED with, and a theme change would
      // leave the filed lines painted in the old palette until the selection changed.
      existingLeg.polyline.material = material as never;
    }
    if (existingPlumb.polyline) {
      existingPlumb.polyline.positions = plumb as never;
      existingPlumb.polyline.material = material as never;
    }
    existingLabel.position = labelPos as never;
    if (existingLabel.label) {
      // Assigned only when it actually differs. Label text churn is what corrupts Cesium's glyph
      // atlas, and this string changes when the route does - not when the aircraft moves.
      const current = existingLabel.label.text?.getValue?.(undefined as never);
      if (current !== labelText) existingLabel.label.text = labelText as never;
      existingLabel.label.fillColor = colour as never;
    }
    return [existingLeg, existingPlumb, existingLabel];
  }

  clear(viewer, prefix);
  const added: Entity[] = [];

  added.push(viewer.entities.add({
    id: legId,
    polyline: {
      positions: arc,
      width: 1.6,
      material,
      // The positions already trace the great circle at a fixed height; asking Cesium to
      // re-arc them would drag the line back down toward the surface between samples.
      arcType: ArcType.NONE,
    },
  }));

  added.push(viewer.entities.add({
    id: plumbId,
    polyline: {
      positions: plumb,
      width: 1.6,
      material,
      arcType: ArcType.NONE,
    },
  }));

  added.push(viewer.entities.add({
    id: labelId,
    position: labelPos,
    label: {
      // "FILED" is not decoration. It is the whole distinction between these lines and the
      // projection envelope, and the operator should not have to remember which is which.
      text: labelText,
      font: "500 11px 'JetBrains Mono', ui-monospace, monospace",
      fillColor: colour,
      showBackground: false,
      pixelOffset: undefined,
    },
  }));

  return added;
}

/** Draw or update the line on to the filed destination. Returns its entities, for tests. */
export function upsertDestination(viewer: Viewer, s: DestinationSpec): Entity[] {
  return upsertLeg(
    viewer,
    DEST_PREFIX,
    `FILED ${s.code}`,
    { lat: s.lat, lon: s.lon, altFt: s.altFt },
    { lat: s.destLat, lon: s.destLon },
  );
}

/**
 * Draw or update the line back to the filed origin. Returns its entities, for tests.
 *
 * "FILED FROM" rather than a bare code: at a glance the two labels sit at opposite ends of the
 * same dashed line in the same colour, and without the word the operator has to work out which
 * airfield is which from the geometry.
 */
export function upsertOrigin(viewer: Viewer, s: OriginSpec): Entity[] {
  return upsertLeg(
    viewer,
    ORIGIN_PREFIX,
    `FILED FROM ${s.code}`,
    { lat: s.lat, lon: s.lon, altFt: s.altFt },
    { lat: s.origLat, lon: s.origLon },
  );
}

/** Remove the destination line. Exported so the caller can clear without a spec. */
export function clearDestination(viewer: Viewer): void {
  clear(viewer, DEST_PREFIX);
}

/** Remove the origin line. Exported so the caller can clear without a spec. */
export function clearOrigin(viewer: Viewer): void {
  clear(viewer, ORIGIN_PREFIX);
}
