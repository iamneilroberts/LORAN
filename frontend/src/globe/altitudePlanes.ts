/*
 * Altitude planes: the measuring instrument, not decoration.
 *
 * Perspective projection confounds height with distance-from-camera, so aircraft drawn at true
 * altitude with no reference surface are close to unreadable. A plane converts an absolute
 * judgement ("how high is that one?") into an above/below one, which human vision does reliably.
 *
 * Two kinds, answering different questions (docs/design-altitude.md):
 *   band  - static, at airspace boundaries. "Where does this sit in the structure?"  Context.
 *   datum - dynamic, at the SELECTED aircraft's altitude. "Who is near this one?"    Measurement.
 *
 * Both are FINITE by decision. A bounded plane reads as an instrument attached to a place and
 * stops implying comparisons across distances where co-altitude has stopped meaning anything.
 */
import {
  Cartesian2,
  Cartesian3,
  Color,
  Entity,
  GridMaterialProperty,
  HorizontalOrigin,
  LabelStyle,
  Rectangle,
  VerticalOrigin,
  type Viewer,
} from "cesium";

import { FT_TO_M, NM_TO_M } from "../state/store";

export const AMBER = Color.fromCssColorString("#ffb000");
export const CYAN = Color.fromCssColorString("#5fd7e0");

function rectAround(lat: number, lon: number, radiusNm: number): Rectangle {
  const dLat = (radiusNm * NM_TO_M) / 111320;
  const dLon = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  return Rectangle.fromDegrees(lon - dLon, lat - dLat, lon + dLon, lat + dLat);
}

export interface PlaneSpec {
  id: string;
  lat: number;
  lon: number;
  radiusNm: number;
  altFt: number;
  colour: Color;
  label: string;
  /** Datum planes are brighter and denser; band planes recede. */
  emphasis?: boolean;
}

/** Add (or replace) one plane and its floating bracketed label. */
export function addPlane(viewer: Viewer, s: PlaneSpec): Entity[] {
  const rect = rectAround(s.lat, s.lon, s.radiusNm);
  const heightM = s.altFt * FT_TO_M;
  const a = s.emphasis ? 0.5 : 0.28;

  const plane = viewer.entities.add({
    id: s.id,
    rectangle: {
      coordinates: rect,
      height: heightM,
      material: new GridMaterialProperty({
        color: s.colour.withAlpha(a),
        cellAlpha: s.emphasis ? 0.1 : 0.05,
        lineCount: new Cartesian2(12, 12),
        lineThickness: new Cartesian2(s.emphasis ? 1.4 : 1.0, s.emphasis ? 1.4 : 1.0),
      }),
      outline: true,
      outlineColor: s.colour.withAlpha(s.emphasis ? 0.95 : 0.6),
      outlineWidth: 2,
    },
  });

  // Anchor the label at the plane's CENTRE, at plane height.
  //
  // Two earlier attempts were worse: the far (north) edge compresses under perspective, so
  // both labels landed on nearly the same screen point and collided; the west edge fell
  // outside the viewport entirely. At the centre the labels separate vertically by exactly
  // the altitude difference they are naming, and they stay in frame whenever the plane is.
  const centre = Rectangle.center(rect);
  const label = viewer.entities.add({
    id: `${s.id}::label`,
    position: Cartesian3.fromDegrees(
      centre.longitude * (180 / Math.PI),
      centre.latitude * (180 / Math.PI),
      heightM,
    ),
    label: {
      text: `[ ${s.label} ]`,
      font: "500 13px 'JetBrains Mono', ui-monospace, monospace",
      fillColor: s.colour,
      style: LabelStyle.FILL,
      horizontalOrigin: HorizontalOrigin.LEFT,
      verticalOrigin: VerticalOrigin.BOTTOM,
      // A datum plane is centred ON the selected aircraft, so its label lands exactly where
      // that aircraft's own label is. Push it clear.
      pixelOffset: new Cartesian2(6, s.emphasis ? -26 : -5),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  return [plane, label];
}

/** Remove every entity whose id starts with the given prefix. */
export function clearByPrefix(viewer: Viewer, prefix: string): void {
  const doomed = viewer.entities.values.filter((e) => e.id?.startsWith(prefix));
  doomed.forEach((e) => viewer.entities.remove(e));
}
