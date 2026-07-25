/*
 * Aircraft rendering: silhouette billboards at TRUE altitude, plus drop-lines.
 *
 * Uses BillboardCollection/PolylineCollection rather than entities: this redraws every frame for
 * dead reckoning, and the primitive collections let us mutate in place instead of churning the
 * entity graph 60 times a second.
 */
import {
  BillboardCollection,
  Cartesian2,
  Cartesian3,
  Color,
  HorizontalOrigin,
  LabelCollection,
  LabelStyle,
  Material,
  PolylineCollection,
  VerticalOrigin,
  type Scene,
} from "cesium";

import { iconDataUri, silhouetteFor } from "./icons";
import { FT_TO_M, reckon, type Aircraft } from "../state/store";

const STROKE_DARK = "#03181c";

/**
 * Altitude -> colour.
 *
 * Amber is reserved EXCLUSIVELY for military. Altitude is therefore a luminance/saturation ramp
 * within cyan rather than a hue shift: a third hue reads as "alert" and would undermine what
 * amber means. Flagged to the owner as a decision - to switch to literal per-band hues, change
 * only this function.
 */
export function colourFor(a: Aircraft): { fill: string; stroke: string } {
  if (a.military) return { fill: "#ffb000", stroke: "#3a2600" };
  const t = Math.max(0, Math.min(1, (a.alt_ft ?? 0) / 45000));
  const l = 44 + t * 42;   // low = deep cyan, high = near-white
  const s = 74 - t * 28;
  return { fill: `hsl(187 ${s}% ${l}%)`, stroke: STROKE_DARK };
}

export interface AircraftLayer {
  update: (
    list: Aircraft[],
    elapsedS: number,
    opts: {
      selectedHex: string | null;
      showDropLines: boolean;
      dropToAltFt: (a: Aircraft) => number | null;
      separationFt: number;
      datumAltFt: number | null;
    },
  ) => void;
  /** hex under the given screen position, or null */
  pick: (scene: Scene, pos: Cartesian2) => string | null;
  destroy: () => void;
}

export function createAircraftLayer(scene: Scene): AircraftLayer {
  const billboards = scene.primitives.add(new BillboardCollection({ scene })) as BillboardCollection;
  const labels = scene.primitives.add(new LabelCollection({ scene })) as LabelCollection;
  const lines = scene.primitives.add(new PolylineCollection()) as PolylineCollection;

  // hex -> index, so we can reuse billboards instead of rebuilding every frame
  const owner = new Map<object, string>();

  function update(
    list: Aircraft[],
    elapsedS: number,
    opts: Parameters<AircraftLayer["update"]>[2],
  ) {
    billboards.removeAll();
    labels.removeAll();
    lines.removeAll();
    owner.clear();

    for (const a of list) {
      if (a.alt_ft === null) continue;
      const { lat, lon, stale } = reckon(a, elapsedS);
      const heightM = a.alt_ft * FT_TO_M;
      const pos = Cartesian3.fromDegrees(lon, lat, heightM);

      const isSel = !!a.hex && a.hex === opts.selectedHex;
      const co =
        opts.datumAltFt !== null &&
        !isSel &&
        Math.abs((a.alt_ft ?? 0) - opts.datumAltFt) <= opts.separationFt;

      // Co-altitude traffic announces itself. This is the whole point of the datum.
      const { fill, stroke } = co
        ? { fill: "#ffb000", stroke: "#3a2600" }
        : colourFor(a);

      const shape = silhouetteFor(a.type, a.category);
      const bb = billboards.add({
        position: pos,
        image: iconDataUri(shape, isSel ? "#ffffff" : fill, stroke),
        // ADS-B `track` is degrees true, clockwise from north. Cesium billboard rotation is
        // counter-clockwise from screen up, so negate.
        rotation: -((a.track_deg ?? 0) * Math.PI) / 180,
        alignedAxis: Cartesian3.ZERO,   // rotate in screen space, stays legible from any camera
        width: isSel ? 30 : 22,
        height: isSel ? 30 : 22,
        // A contact we can no longer honestly place is dimmed, not hidden and not smoothed over.
        color: stale ? Color.WHITE.withAlpha(0.35) : Color.WHITE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
      if (a.hex) owner.set(bb, a.hex);

      if (isSel || co || a.military) {
        labels.add({
          position: pos,
          text: (a.flight || a.hex || "").trim().toUpperCase(),
          font: "500 11px 'JetBrains Mono', ui-monospace, monospace",
          fillColor: Color.fromCssColorString(co || a.military ? "#ffb000" : "#ffffff"),
          style: LabelStyle.FILL,
          horizontalOrigin: HorizontalOrigin.LEFT,
          verticalOrigin: VerticalOrigin.CENTER,
          pixelOffset: new Cartesian2(15, -9),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      }

      // Drop-line to the reference plane, NOT the ground: the line's length then reads
      // directly as altitude difference, and its foot shows true horizontal position -
      // which is exactly what perspective was hiding.
      if (opts.showDropLines) {
        const toFt = opts.dropToAltFt(a);
        if (toFt !== null && Math.abs(toFt - a.alt_ft) > 1) {
          lines.add({
            positions: [pos, Cartesian3.fromDegrees(lon, lat, toFt * FT_TO_M)],
            width: co || isSel ? 1.6 : 1,
            material: Material.fromType("Color", {
              color: Color.fromCssColorString(
                co ? "#ffb000" : isSel ? "#ffffff" : fill,
              ).withAlpha(co || isSel ? 0.6 : 0.25),
            }),
          });
        }
      }
    }
  }

  function pick(s: Scene, pos: Cartesian2): string | null {
    const picked = s.pick(pos);
    if (picked?.primitive && owner.has(picked.primitive)) {
      return owner.get(picked.primitive) ?? null;
    }
    return null;
  }

  return {
    update,
    pick,
    destroy: () => {
      scene.primitives.remove(billboards);
      scene.primitives.remove(labels);
      scene.primitives.remove(lines);
    },
  };
}
