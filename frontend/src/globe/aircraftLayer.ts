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
import { altToMetres, reckon, type Aircraft } from "../state/store";

import { palette } from "../styles/palette";

/**
 * Altitude -> icon colour (D-029, supersedes D-017).
 *
 * Altitude now owns a real HUE ramp rather than a luminance ramp inside cyan. The old scheme
 * spent the only strong accent (amber) on military, which left altitude with a brightness
 * difference too subtle to read at icon size - so altitude was effectively not encoded at all.
 * Moving military to magenta freed the spectrum.
 *
 * This is why every other ADS-B viewer colours the icon: colour rides on the contact itself,
 * never occludes anything, and reads at any camera angle - unlike a grid plane in 3D, which
 * only answers "above or below?" when the perspective happens to cooperate.
 *
 * Stops are interpolated in HSL. Hue descends monotonically 224 -> 52, so there is no wrap.
 */
const RAMP: { ft: number; h: number; s: number; l: number }[] = [
  { ft: 0, h: 224, s: 80, l: 56 },       // deep blue    - on the deck
  { ft: 10000, h: 190, s: 78, l: 55 },   // cyan         - low
  { ft: 20000, h: 150, s: 68, l: 52 },   // green        - mid
  { ft: 30000, h: 84, s: 72, l: 58 },    // yellow-green - high
  { ft: 45000, h: 52, s: 92, l: 68 },    // pale yellow  - top of the observed range
];

/** The ramp, exposed so the legend renders the same colours the icons use. */
export function altitudeColour(altFt: number | null): string {
  const ft = Math.max(0, Math.min(RAMP[RAMP.length - 1].ft, altFt ?? 0));
  let lo = RAMP[0];
  let hi = RAMP[RAMP.length - 1];
  for (let i = 0; i < RAMP.length - 1; i++) {
    if (ft >= RAMP[i].ft && ft <= RAMP[i + 1].ft) {
      lo = RAMP[i];
      hi = RAMP[i + 1];
      break;
    }
  }
  const span = hi.ft - lo.ft;
  const t = span === 0 ? 0 : (ft - lo.ft) / span;
  const h = lo.h + (hi.h - lo.h) * t;
  const s = lo.s + (hi.s - lo.s) * t;
  const l = lo.l + (hi.l - lo.l) * t;
  return `hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${l.toFixed(0)}%)`;
}

export function colourFor(a: Aircraft): { fill: string; stroke: string } {
  const p = palette();
  // Military overrides the ramp: class matters more than altitude for these contacts, and
  // magenta collides with nothing else on the display.
  if (a.military) return { fill: p.mil, stroke: p.iconStrokeMil };
  return { fill: altitudeColour(a.alt_ft), stroke: p.iconStroke };
}

/** Which colour role a label is drawn in. Resolved to an actual palette token by the caller. */
export type LabelColourRole = "alert" | "selected" | "dim";

export interface LabelDecisionInput {
  selected: boolean;
  coAltitude: boolean;
  military: boolean;
  showAllLabels: boolean;
}

export interface LabelDecision {
  show: boolean;
  colourRole: LabelColourRole;
}

/**
 * Whether a contact gets an identifier label, and in what colour role (D-060).
 *
 * Selected, co-altitude and military contacts were ALREADY labelled unconditionally before the
 * ALL CALLSIGNS toggle existed - `showAllLabels` only adds a fourth trigger on top of the other
 * three, it does not change what they do. That is why those three keep the same "alert"
 * (amber) / "selected" (near-white) colour roles regardless of the toggle: `coAltitude` and
 * `military` are checked first, so a contact that happens to be both, say, military AND only
 * visible because of the toggle still reads as military, not as generic clutter.
 *
 * A label added for NO reason other than the toggle gets "dim" - deliberately the least
 * prominent of the three roles. With the toggle on, ~100+ contacts can be labelled
 * simultaneously (D-029 spent amber and near-white on purpose, to make co-altitude and military
 * pop against everything else); painting all of them at the same prominence as those signals
 * would drown the signal in the noise the toggle just added, making the display LESS readable
 * than before the toggle existed.
 */
export function labelDecision(input: LabelDecisionInput): LabelDecision {
  const { selected, coAltitude, military, showAllLabels } = input;
  return {
    show: selected || coAltitude || military || showAllLabels,
    colourRole: coAltitude || military ? "alert" : selected ? "selected" : "dim",
  };
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
  /** D-060: label every contact, not just selected/co-altitude/military. */
  showAllLabels: boolean;
  /** Vertical exaggeration, 1 = true (D-075). Geometry only; every readout stays true. */
  vertScale: number;
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
 * How deep a click drills looking for a contact. Bounded because each level is another
 * render pass; 8 is well past the worst realistic stack of place marker, label and slice.
 */
const DRILL_LIMIT = 8;

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
    const pal = palette();

    for (const a of list) {
      if (!a.hex || a.alt_ft === null) continue;
      seen.add(a.hex);

      const { lat, lon, stale } = reckon(a, elapsedS);
      const heightM = altToMetres(a.alt_ft, opts.vertScale);
      const pos = Cartesian3.fromDegrees(lon, lat, heightM);

      const isSel = a.hex === opts.selectedHex;
      const co =
        opts.datumAltFt !== null &&
        !isSel &&
        Math.abs(a.alt_ft - opts.datumAltFt) <= opts.separationFt;

      const base = co
        ? { fill: pal.amber, stroke: pal.iconStrokeAlert }
        : colourFor(a);
      const image = iconDataUri(
        silhouetteFor(a.type, a.category),
        isSel ? pal.iconSelected : base.fill,
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

      /* ---- label: selected, co-altitude, military, or (D-060) the ALL CALLSIGNS toggle ---- */
      const label = labelDecision({
        selected: isSel, coAltitude: co, military: a.military, showAllLabels: opts.showAllLabels,
      });
      // Callsign if the transponder is sending one, otherwise the raw ICAO24 hex. The hex is
      // real data the contact is actually broadcasting, not a placeholder - falling back to it
      // is what ground rule 1 (never invent data) demands here, so it stays even though it means
      // a mix of "DAL9975" and "AE1234" once every contact is labelled.
      const text = (a.flight || a.hex).trim().toUpperCase();
      if (label.show) {
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
          label.colourRole === "alert" ? pal.amber
            : label.colourRole === "selected" ? pal.iconSelected
              : pal.dim,
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
        const foot = Cartesian3.fromDegrees(lon, lat, altToMetres(toFt, opts.vertScale));
        const colour = Color.fromCssColorString(
          co ? pal.amber : isSel ? pal.iconSelected : base.fill,
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

  /*
   * Which contact is under the cursor, or null for "nothing selectable here".
   *
   * DRILL pick, not a single pick. `scene.pick` returns only the frontmost primitive, so
   * anything drawn over a contact swallowed the click and, because a miss means null and
   * null means DESELECT, clicking a contact could clear the dossier instead of switching to
   * it. The ALTITUDE SLICE rectangle could already do this; the PLACES layer (D-032) added
   * ~26,000 ground primitives and would have made it common.
   *
   * Drilling and taking the first ADS-B contact in the list keeps click-empty-to-clear
   * working - a click that genuinely hits no contact still returns null - while making a
   * contact behind a place label or the slice selectable. Runs on click only, never per frame.
   */
  function pick(s: Scene, pos: Cartesian2): string | null {
    for (const entry of s.drillPick(pos, DRILL_LIMIT)) {
      const hex = entry?.primitive ? ownerOf.get(entry.primitive) : undefined;
      if (hex) return hex;
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
