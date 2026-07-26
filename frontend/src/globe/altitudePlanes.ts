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
  ColorMaterialProperty,
  Entity,
  GridMaterialProperty,
  HorizontalOrigin,
  LabelStyle,
  Rectangle,
  VerticalOrigin,
  type Viewer,
} from "cesium";

import { FT_TO_M, NM_TO_M } from "../state/store";
import { palette } from "../styles/palette";

/*
 * Getters rather than constants (D-042): these read tokens.css through palette(), and a
 * module-scope const would freeze the value before the stylesheet applies. Cesium Color
 * objects are cheap to make and these are called on user actions, not per frame.
 */
export const amber = (): Color => Color.fromCssColorString(palette().amber);
export const cyan = (): Color => Color.fromCssColorString(palette().cyan);

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
  /** Datum planes are brighter; band planes recede. */
  emphasis?: boolean;
  /**
   * "solid" - translucent fill with a bright rim. Reads cleanly as a surface at any angle.
   * "grid"  - wireframe. Good for the static bands, where it says "structure".
   *
   * The datum defaults to solid: a dense grid viewed at a shallow angle moires badly and
   * stops reading as a plane at all, which is the one thing it has to do.
   */
  fill?: "solid" | "grid";
}

/**
 * Create one plane and its floating bracketed label, or MUTATE them if the id already exists.
 *
 * Mutating matters for the datum, whose altitude changes with every poll of the selected
 * contact. Destroying and re-adding a label thirty times a minute churns Cesium's signed-
 * distance-field glyph atlas, which was observed dropping characters outright - a label
 * rendering "[ DATUM 34, 50 FT ]" for 34,650 ft. A missing digit on an altitude readout is
 * worse than a missing label. Same reasoning as D-015 for the aircraft billboards: reuse the
 * primitive, change its properties.
 */
export function upsertPlane(viewer: Viewer, s: PlaneSpec): Entity[] {
  const rect = rectAround(s.lat, s.lon, s.radiusNm);
  const heightM = s.altFt * FT_TO_M;
  const style = s.fill ?? (s.emphasis ? "solid" : "grid");
  const labelText = `[ ${s.label} ]`;
  const centreOf = (r: Rectangle) => {
    const c = Rectangle.center(r);
    return Cartesian3.fromDegrees(
      c.longitude * (180 / Math.PI), c.latitude * (180 / Math.PI), heightM,
    );
  };

  /*
   * Built before the reuse check so the mutate branch can reapply it too. Everything derived
   * from s.colour has to be re-set on mutate: the branch used to update geometry and label text
   * only, so an entity kept the colour it was CREATED with for as long as it lived. That is
   * invisible while the palette is fixed, and turns a palette change into a half-repainted
   * display. Rebuilding rather than recolouring in place also handles s.fill/s.emphasis
   * changing, which swaps the material class outright.
   */
  const material =
    style === "solid"
      ? new ColorMaterialProperty(s.colour.withAlpha(s.emphasis ? 0.18 : 0.09))
      : new GridMaterialProperty({
          color: s.colour.withAlpha(s.emphasis ? 0.5 : 0.3),
          cellAlpha: s.emphasis ? 0.1 : 0.04,
          lineCount: new Cartesian2(10, 10),
          lineThickness: new Cartesian2(1.0, 1.0),
        });
  const outlineColour = s.colour.withAlpha(s.emphasis ? 0.95 : 0.55);

  const existing = viewer.entities.getById(s.id);
  const existingLabel = viewer.entities.getById(`${s.id}::label`);
  if (existing && existingLabel) {
    if (existing.rectangle) {
      existing.rectangle.coordinates = rect as never;
      existing.rectangle.height = heightM as never;
      existing.rectangle.material = material as never;
      existing.rectangle.outlineColor = outlineColour as never;
    }
    existingLabel.position = centreOf(rect) as never;
    if (existingLabel.label) {
      existingLabel.label.text = labelText as never;
      existingLabel.label.fillColor = s.colour as never;
    }
    return [existing, existingLabel];
  }

  const plane = viewer.entities.add({
    id: s.id,
    rectangle: {
      coordinates: rect,
      height: heightM,
      material,
      outline: true,
      outlineColor: outlineColour,
      outlineWidth: 2,
    },
  });

  // Anchor the label at the plane's CENTRE, at plane height.
  //
  // Two earlier attempts were worse: the far (north) edge compresses under perspective, so
  // both labels landed on nearly the same screen point and collided; the west edge fell
  // outside the viewport entirely. At the centre the labels separate vertically by exactly
  // the altitude difference they are naming, and they stay in frame whenever the plane is.
  const label = viewer.entities.add({
    id: `${s.id}::label`,
    position: centreOf(rect),
    label: {
      text: labelText,
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
