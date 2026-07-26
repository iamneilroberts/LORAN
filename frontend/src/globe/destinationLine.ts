/**
 * Dashed line from the selected contact to its FILED destination.
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
 * Nothing is drawn when adsbdb has no coordinates for the destination.
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
  if (δ === 0) return [Cartesian3.fromDegrees(lon1, lat1, heightM)];

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

/** Remove every entity this module owns. */
function clear(viewer: Viewer): void {
  viewer.entities.values
    .filter((e) => String(e.id).startsWith(DEST_PREFIX))
    .forEach((e) => viewer.entities.remove(e));
}

/**
 * Draw (or redraw) the destination line. Returns the entities added, for tests.
 *
 * Rebuilt rather than mutated: it changes only when the selection, the route or the contact's
 * altitude changes, which is nothing like per-frame.
 */
export function upsertDestination(viewer: Viewer, s: DestinationSpec): Entity[] {
  clear(viewer);

  const { cyan } = palette();
  // Dimmer than the track. The track is where the contact HAS been - observed fact. This is
  // where it says it is going, which is a weaker claim and should not shout as loudly.
  const colour = Color.fromCssColorString(cyan).withAlpha(0.55);
  const material = new PolylineDashMaterialProperty({
    color: colour,
    dashLength: 12,
  });

  const heightM = s.altFt * FT_TO_M;
  const added: Entity[] = [];

  added.push(viewer.entities.add({
    id: `${DEST_PREFIX}leg`,
    polyline: {
      positions: levelArc(s.lat, s.lon, s.destLat, s.destLon, heightM),
      width: 1.6,
      material,
      // The positions already trace the great circle at a fixed height; asking Cesium to
      // re-arc them would drag the line back down toward the surface between samples.
      arcType: ArcType.NONE,
    },
  }));

  added.push(viewer.entities.add({
    id: `${DEST_PREFIX}plumb`,
    polyline: {
      positions: [
        Cartesian3.fromDegrees(s.destLon, s.destLat, heightM),
        Cartesian3.fromDegrees(s.destLon, s.destLat, 0),
      ],
      width: 1.6,
      material,
      arcType: ArcType.NONE,
    },
  }));

  added.push(viewer.entities.add({
    id: `${DEST_PREFIX}label`,
    position: Cartesian3.fromDegrees(s.destLon, s.destLat, heightM),
    label: {
      // "FILED" is not decoration. It is the whole distinction between this line and the
      // projection envelope, and the operator should not have to remember which is which.
      text: `FILED ${s.code}`,
      font: "500 11px 'JetBrains Mono', ui-monospace, monospace",
      fillColor: colour,
      showBackground: false,
      pixelOffset: undefined,
    },
  }));

  return added;
}

/** Remove the destination line. Exported so the caller can clear without a spec. */
export function clearDestination(viewer: Viewer): void {
  clear(viewer);
}
