/*
 * Forward projection envelope for the selected contact (D-047).
 *
 * Replaces the ALTITUDE SLICE as the primary instrument. The slice answered "who else is at this
 * flight level", which turned out to be a question the owner did not have; a big amber square
 * occluding the ground was the whole of its cost.
 *
 * WHAT THE SHAPE MEANS, precisely, because this is where a display like this starts lying:
 *
 *   "Where this contact will be within the next N minutes IF it holds its present groundspeed
 *    and stays within ±SPREAD degrees of its present track."
 *
 * It is a STATED ASSUMPTION, not a forecast. There is no probability attached to it, and the
 * width is not an error bar — it is a parameter the operator sets. Compare a hurricane cone,
 * whose width IS a measured probability envelope derived from decades of forecast error: we have
 * no equivalent error model for aircraft, so inventing a width and implying it meant something
 * would be exactly the plausible-fake this project forbids.
 *
 * The physically honest alternative - a true reachable set - was considered and rejected as
 * useless rather than dishonest: at 425 kt an airliner at 25 deg of bank turns about 1.2 deg/s,
 * so inside five minutes it can come all the way around. The reachable set is very nearly a
 * disc, which tells the operator nothing.
 *
 * The cone SLOPES with vertical rate. A contact descending at 1,856 fpm loses 9,280 ft over a
 * five-minute projection; drawing that envelope flat at the current altitude would put it in the
 * wrong place vertically within one minute, and the whole point of this project is that altitude
 * is real.
 */
import {
  ArcType,
  CallbackProperty,
  Cartesian3,
  PolygonHierarchy,
  type Entity,
  type Viewer,
} from "cesium";

import { FT_TO_M } from "../state/store";
import { amber } from "./altitudePlanes";

const R_EARTH = 6371000;
const KT_TO_MS = 0.514444;
const FPM_TO_MS = 0.00508;

export interface ConeSpec {
  id: string;
  lat: number;
  lon: number;
  /** Ground track in degrees. Without it there is no direction and nothing to draw. */
  trackDeg: number;
  gsKt: number;
  altFt: number;
  /** Vertical rate, feet per minute. Null is treated as level, which is what it means. */
  vsFpm: number | null;
  minutes: number;
  spreadDeg: number;
}

/** Great-circle destination from a point, bearing and distance. */
function dest(lat: number, lon: number, brgDeg: number, dM: number): { lat: number; lon: number } {
  const d = dM / R_EARTH;
  const brg = (brgDeg * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180;
  const l1 = (lon * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(brg));
  const l2 = l1 + Math.atan2(
    Math.sin(brg) * Math.sin(d) * Math.cos(p1),
    Math.cos(d) - Math.sin(p1) * Math.sin(p2),
  );
  return { lat: (p2 * 180) / Math.PI, lon: (l2 * 180) / Math.PI };
}

/** Points across the envelope at a given range, left edge to right edge. */
function rung(s: ConeSpec, distM: number, heightM: number, steps = 8): Cartesian3[] {
  const out: Cartesian3[] = [];
  for (let i = 0; i <= steps; i++) {
    const brg = s.trackDeg - s.spreadDeg + (2 * s.spreadDeg * i) / steps;
    const p = dest(s.lat, s.lon, brg, distM);
    out.push(Cartesian3.fromDegrees(p.lon, p.lat, heightM));
  }
  return out;
}

/** Altitude at t seconds, in metres, never below the surface. */
function heightAt(s: ConeSpec, tS: number): number {
  const vs = (s.vsFpm ?? 0) * FPM_TO_MS;
  return Math.max(0, s.altFt * FT_TO_M + vs * tS);
}

export interface ConeGeometry {
  /** Closed outline: apex, left edge, far arc, right edge, back to apex. */
  outline: Cartesian3[];
  /** Filled surface, same footprint. */
  fill: Cartesian3[];
  /** Dead-ahead centreline. */
  centre: Cartesian3[];
  /** One rung per whole minute short of the far cap - a range scale, not decoration. */
  rungs: Cartesian3[][];
  /** Where the far end sits, for the label. */
  tip: Cartesian3;
  endAltFt: number;
}

/**
 * Pure geometry, exported so it can be tested without a Cesium viewer or a browser.
 * (The project has no unit tests yet; this is written to be one of the first.)
 */
export function coneGeometry(s: ConeSpec): ConeGeometry {
  const tTotal = s.minutes * 60;
  const vMs = Math.max(0, s.gsKt) * KT_TO_MS;
  const dTotal = vMs * tTotal;

  const apex = Cartesian3.fromDegrees(s.lon, s.lat, heightAt(s, 0));
  const far = rung(s, dTotal, heightAt(s, tTotal));

  const outline = [apex, ...far, apex];
  const centre = [apex, Cartesian3.fromDegrees(
    dest(s.lat, s.lon, s.trackDeg, dTotal).lon,
    dest(s.lat, s.lon, s.trackDeg, dTotal).lat,
    heightAt(s, tTotal),
  )];

  const rungs: Cartesian3[][] = [];
  for (let m = 1; m < s.minutes; m++) {
    const t = m * 60;
    rungs.push(rung(s, vMs * t, heightAt(s, t), 6));
  }

  return {
    outline,
    fill: [apex, ...far],
    centre,
    rungs,
    tip: far[Math.floor(far.length / 2)],
    endAltFt: Math.round(heightAt(s, tTotal) / FT_TO_M),
  };
}

/**
 * Create the cone, or MUTATE it in place if the id already exists.
 *
 * Same discipline as `upsertPlane` (D-015/D-028): this geometry changes on every poll as the
 * contact moves, and destroying/recreating a labelled entity that often churns Cesium's glyph
 * atlas badly enough to drop characters out of the readout.
 */
export function upsertCone(viewer: Viewer, s: ConeSpec): Entity[] {
  const g = coneGeometry(s);
  const col = amber();
  const touched: Entity[] = [];

  const vsNote = s.vsFpm && Math.abs(s.vsFpm) >= 100
    ? ` · ${g.endAltFt.toLocaleString()} FT`
    : "";
  // The label carries the ASSUMPTION, not just the numbers. "+5 MIN" alone would read as a
  // prediction; the spread and speed are what make it a conditional statement.
  const labelText = `[ +${s.minutes} MIN · ±${s.spreadDeg}° · ${Math.round(s.gsKt)} KT${vsNote} ]`;

  const fillId = `${s.id}fill`;
  let fillE = viewer.entities.getById(fillId);
  if (!fillE) {
    fillE = viewer.entities.add({
      id: fillId,
      polygon: {
        hierarchy: new CallbackProperty(() => new PolygonHierarchy(g.fill), false),
        perPositionHeight: true,
        material: col.withAlpha(0.1),
        outline: false,
      },
    });
  } else if (fillE.polygon) {
    fillE.polygon.hierarchy = new CallbackProperty(
      () => new PolygonHierarchy(g.fill), false,
    ) as never;
    fillE.polygon.material = col.withAlpha(0.1) as never;
  }
  touched.push(fillE);

  const strokes: { suffix: string; positions: Cartesian3[]; width: number; alpha: number }[] = [
    { suffix: "edge", positions: g.outline, width: 1.6, alpha: 0.75 },
    { suffix: "ctr", positions: g.centre, width: 1.1, alpha: 0.5 },
    ...g.rungs.map((r, i) => ({
      suffix: `rung${i}`, positions: r, width: 1, alpha: 0.32,
    })),
  ];

  for (const st of strokes) {
    const id = `${s.id}${st.suffix}`;
    let e = viewer.entities.getById(id);
    if (!e) {
      e = viewer.entities.add({
        id,
        polyline: {
          positions: st.positions,
          width: st.width,
          material: col.withAlpha(st.alpha),
          // The envelope is a measurement: it must stay visible where it crosses terrain
          // rather than being silently clipped into a shorter, wrong-looking shape.
          arcType: ArcType.GEODESIC,
        },
      });
    } else if (e.polyline) {
      e.polyline.positions = st.positions as never;
      e.polyline.material = col.withAlpha(st.alpha) as never;
    }
    touched.push(e);
  }

  const labelId = `${s.id}label`;
  let labelE = viewer.entities.getById(labelId);
  if (!labelE) {
    labelE = viewer.entities.add({
      id: labelId,
      position: g.tip,
      label: {
        text: labelText,
        font: "500 11px 'JetBrains Mono', ui-monospace, monospace",
        fillColor: col,
        showBackground: false,
      },
    });
  } else {
    labelE.position = g.tip as never;
    if (labelE.label) {
      // Only assign when it actually changed - see the glyph-atlas note above.
      const current = labelE.label.text?.getValue?.(viewer.clock.currentTime);
      if (current !== labelText) labelE.label.text = labelText as never;
      // Unconditional, like the fill and strokes above: the glyph-atlas caution applies to the
      // TEXT (it rebuilds glyphs), not to the colour. Without this the label kept the colour it
      // was created with, so a palette change repainted the envelope but not its readout.
      labelE.label.fillColor = col as never;
    }
  }
  touched.push(labelE);

  return touched;
}
