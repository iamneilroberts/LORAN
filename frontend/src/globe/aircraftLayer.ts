/*
 * Aircraft rendering: silhouette billboards at TRUE altitude, plus drop-lines.
 *
 * Primitives are REUSED across frames, keyed by ICAO hex. The first version cleared and
 * rebuilt every billboard, label and polyline on every postRender - roughly 120 primitive
 * allocations 30 times a second - which was the whole reason the frame rate sat at 25-30.
 * Now we mutate position/rotation/colour in place and only add or remove when the set of
 * contacts actually changes.
 */
import {
  Billboard,
  BillboardCollection,
  Cartesian2,
  Cartesian3,
  Color,
  HorizontalOrigin,
  Label,
  LabelCollection,
  LabelStyle,
  Material,
  Polyline,
  PolylineCollection,
  SceneTransforms,
  VerticalOrigin,
  type Scene,
} from "cesium";

import { iconDataUri, silhouetteFor } from "./icons";
import { FT_TO_M, reckon, type Aircraft } from "../state/store";

const STROKE_DARK = "#03181c";
const AMBER = "#ffb000";

/**
 * Altitude -> colour.
 *
 * Amber is reserved EXCLUSIVELY for military. Altitude is therefore a luminance/saturation ramp
 * within cyan rather than a hue shift: a third hue reads as "alert" and would undermine what
 * amber means. To switch to literal per-band hues, change only this function.
 */
export function colourFor(a: Aircraft): { fill: string; stroke: string } {
  if (a.military) return { fill: AMBER, stroke: "#3a2600" };
  const t = Math.max(0, Math.min(1, (a.alt_ft ?? 0) / 45000));
  const l = 44 + t * 42;
  const s = 74 - t * 28;
  return { fill: `hsl(187 ${s}% ${l}%)`, stroke: STROKE_DARK };
}

/*
 * Icon heading, in SCREEN space rather than compass space.
 *
 * The icons are camera-facing billboards, so rotating one by raw ADS-B `track` draws a
 * northbound aircraft pointing straight up the screen. Under this project's tilted camera
 * (pitch -32 deg) "up the screen" reads as CLIMBING, not as "flying away from you" - which is
 * why the display looked full of aircraft diving and climbing vertically.
 *
 * The fix: project the aircraft's position and a point a little way ahead along its ground
 * track, then point the nose along the resulting screen-space vector. Under a top-down camera
 * this reduces exactly to the old behaviour; under a tilted one it foreshortens correctly, so
 * an aircraft flying away from the viewer reads as flying away.
 *
 * KNOWN LIMIT: this fixes heading only. A billboard always faces the camera, so the silhouette
 * itself is not laid flat into the ground plane - it cannot be, short of replacing billboards
 * with ground-aligned geometry per contact. Vertical rate is not conveyed by icon shape at all;
 * V/S is a numeric readout in the dossier.
 */
const AHEAD_M = 4000;

/** A point AHEAD_M along the contact's ground track, at the same altitude. */
function aheadOf(lat: number, lon: number, heightM: number, trackDeg: number): Cartesian3 {
  const brg = (trackDeg * Math.PI) / 180;
  const dLat = (AHEAD_M * Math.cos(brg)) / 111320;
  const cosLat = Math.cos((lat * Math.PI) / 180) || 1e-6;
  const dLon = (AHEAD_M * Math.sin(brg)) / (111320 * cosLat);
  return Cartesian3.fromDegrees(lon + dLon, lat + dLat, heightM);
}

export interface UpdateOpts {
  selectedHex: string | null;
  showDropLines: boolean;
  dropToAltFt: (a: Aircraft) => number | null;
  separationFt: number;
  datumAltFt: number | null;
}

export interface AircraftLayer {
  update: (list: Aircraft[], elapsedS: number, opts: UpdateOpts) => void;
  pick: (scene: Scene, pos: Cartesian2) => string | null;
  destroy: () => void;
}

interface Slot {
  bb: Billboard;
  label?: Label;
  line?: Polyline;
  lastImage: string;
  lastText: string;
}

// Reused across every contact every frame; allocating two Cartesian2 per aircraft per frame
// is exactly the churn D-015 removed from this file.
const scratchA = new Cartesian2();
const scratchB = new Cartesian2();

/**
 * Billboard rotation that points the nose along the contact's on-screen direction of travel.
 *
 * Cesium billboard rotation is counter-clockwise from screen up; window coordinates have y
 * pointing down. Hence `-atan2(dx, -dy)`. Falls back to the raw compass heading when the two
 * projected points land within a pixel of each other (contact near the horizon, or zoomed far
 * out) - at that separation the screen vector is noise and would make the icon spin.
 */
function screenRotation(
  scene: Scene,
  pos: Cartesian3,
  lat: number,
  lon: number,
  heightM: number,
  trackDeg: number | null,
): number {
  const compass = -((trackDeg ?? 0) * Math.PI) / 180;
  if (trackDeg === null) return compass;

  const w0 = SceneTransforms.worldToWindowCoordinates(scene, pos, scratchA);
  const w1 = SceneTransforms.worldToWindowCoordinates(
    scene, aheadOf(lat, lon, heightM, trackDeg), scratchB,
  );
  if (!w0 || !w1) return compass;

  const dx = w1.x - w0.x;
  const dy = w1.y - w0.y;
  if (dx * dx + dy * dy < 1) return compass;
  return -Math.atan2(dx, -dy);
}

export function createAircraftLayer(scene: Scene): AircraftLayer {
  const billboards = scene.primitives.add(new BillboardCollection({ scene })) as BillboardCollection;
  const labels = scene.primitives.add(new LabelCollection({ scene })) as LabelCollection;
  const lines = scene.primitives.add(new PolylineCollection()) as PolylineCollection;

  const slots = new Map<string, Slot>();
  const ownerOf = new Map<object, string>();
  const seen = new Set<string>();

  function update(list: Aircraft[], elapsedS: number, opts: UpdateOpts) {
    seen.clear();

    for (const a of list) {
      if (!a.hex || a.alt_ft === null) continue;
      seen.add(a.hex);

      const { lat, lon, stale } = reckon(a, elapsedS);
      const heightM = a.alt_ft * FT_TO_M;
      const pos = Cartesian3.fromDegrees(lon, lat, heightM);

      const isSel = a.hex === opts.selectedHex;
      const co =
        opts.datumAltFt !== null &&
        !isSel &&
        Math.abs(a.alt_ft - opts.datumAltFt) <= opts.separationFt;

      const base = co ? { fill: AMBER, stroke: "#3a2600" } : colourFor(a);
      const image = iconDataUri(
        silhouetteFor(a.type, a.category),
        isSel ? "#ffffff" : base.fill,
        base.stroke,
      );

      let slot = slots.get(a.hex);
      if (!slot) {
        const bb = billboards.add({
          position: pos,
          image,
          alignedAxis: Cartesian3.ZERO,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
        slot = { bb, lastImage: image, lastText: "" };
        slots.set(a.hex, slot);
        ownerOf.set(bb, a.hex);
      }

      const bb = slot.bb;
      bb.position = pos;
      bb.rotation = screenRotation(scene, pos, lat, lon, heightM, a.track_deg);
      bb.width = isSel ? 30 : 22;
      bb.height = isSel ? 30 : 22;
      // A contact we can no longer honestly place is dimmed, not hidden and not smoothed over.
      bb.color = stale ? Color.WHITE.withAlpha(0.35) : Color.WHITE;
      // Setting .image re-uploads a texture; only do it when it actually changed.
      if (image !== slot.lastImage) {
        bb.image = image;
        slot.lastImage = image;
      }

      /* ---- label: selected, co-altitude, or military ---- */
      const wantLabel = isSel || co || a.military;
      const text = (a.flight || a.hex).trim().toUpperCase();
      if (wantLabel) {
        if (!slot.label) {
          slot.label = labels.add({
            position: pos,
            text,
            font: "500 11px 'JetBrains Mono', ui-monospace, monospace",
            style: LabelStyle.FILL,
            horizontalOrigin: HorizontalOrigin.LEFT,
            verticalOrigin: VerticalOrigin.CENTER,
            pixelOffset: new Cartesian2(15, -9),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          });
          slot.lastText = text;
        }
        slot.label.position = pos;
        slot.label.fillColor = Color.fromCssColorString(
          co || a.military ? AMBER : "#ffffff",
        );
        if (text !== slot.lastText) {
          slot.label.text = text;
          slot.lastText = text;
        }
        slot.label.show = true;
      } else if (slot.label) {
        slot.label.show = false;
      }

      /* ---- drop-line to the reference plane, never to the ground ---- */
      const toFt = opts.showDropLines ? opts.dropToAltFt(a) : null;
      if (toFt !== null && Math.abs(toFt - a.alt_ft) > 1) {
        const foot = Cartesian3.fromDegrees(lon, lat, toFt * FT_TO_M);
        const colour = Color.fromCssColorString(
          co ? AMBER : isSel ? "#ffffff" : base.fill,
        ).withAlpha(co || isSel ? 0.65 : 0.28);
        if (!slot.line) {
          slot.line = lines.add({
            positions: [pos, foot],
            width: 1,
            material: Material.fromType("Color", { color: colour }),
          });
        }
        slot.line.positions = [pos, foot];
        slot.line.width = co || isSel ? 1.8 : 1;
        slot.line.material.uniforms.color = colour;
        slot.line.show = true;
      } else if (slot.line) {
        slot.line.show = false;
      }
    }

    /* ---- retire contacts that dropped out of the feed ---- */
    for (const [hex, slot] of slots) {
      if (seen.has(hex)) continue;
      ownerOf.delete(slot.bb);
      billboards.remove(slot.bb);
      if (slot.label) labels.remove(slot.label);
      if (slot.line) lines.remove(slot.line);
      slots.delete(hex);
    }
  }

  function pick(s: Scene, pos: Cartesian2): string | null {
    const picked = s.pick(pos);
    if (picked?.primitive && ownerOf.has(picked.primitive)) {
      return ownerOf.get(picked.primitive) ?? null;
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
      slots.clear();
      ownerOf.clear();
    },
  };
}
