/*
 * Vessel rendering (D-078): category markers on the sea surface.
 *
 * Same architecture as aircraftLayer - primitives reused across frames, keyed by the vessel
 * key, mutated in place - because that is what keeps the frame rate up (D-015). Simpler in
 * three deliberate ways:
 *
 *   - Height is 0. Ships are on the water; there is no altitude to draw, no drop line, no
 *     vertical exaggeration involvement.
 *   - No dead reckoning. The feed refreshes on the order of minutes and ships move at tens of
 *     knots; smoothing between fixes would be inventing a path with real-looking confidence.
 *     A fix past STALE_S is dimmed instead, exactly like a stale aircraft.
 *   - Orientation is conditional. A hull silhouette is drawn ONLY when a course is known
 *     (reported or derived); otherwise the marker is a direction-neutral ring, because a
 *     pointed bow with no measured course would be a claim nobody made.
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
  VerticalOrigin,
  type Scene,
} from "cesium";

import { labelDecision, screenRotation } from "./aircraftLayer";
import { asVesselCategory, vesselIconDataUri } from "./vesselIcons";
import type { Vessel, VesselDetail } from "../state/store";
import { palette } from "../styles/palette";

/**
 * A fix older than this is drawn dimmed. AIS positions are legitimately minutes old (the
 * upstream snapshot itself filters to recent reporters), so the threshold is far looser than
 * the aircraft one - but past half an hour the marker is a memory, and must look like one.
 */
export const VESSEL_STALE_S = 1800;

const DRILL_LIMIT = 8;

export interface VesselUpdateOpts {
  selectedKey: string | null;
  showAllLabels: boolean;
  /** The per-vessel lookup for the SELECTED vessel, when one has answered. */
  detail: VesselDetail | null;
  /** Wall clock, seconds. Injected so the staleness rule is testable. */
  nowS: number;
}

export interface VesselLayer {
  update: (list: Vessel[], opts: VesselUpdateOpts) => void;
  pick: (scene: Scene, pos: Cartesian2) => string | null;
  destroy: () => void;
}

interface Slot {
  bb: Billboard;
  label?: Label;
  lastImage: string;
  lastText: string;
}

/**
 * The position/course actually drawn for a vessel: the snapshot row, unless the selected
 * vessel's detail lookup answered with a NEWER fix - then the newer measurement wins. Pure
 * and exported for the unit test; never mixes two sources into one invented state.
 */
export function effectiveFix(
  v: Vessel,
  detail: VesselDetail | null,
  selected: boolean,
): { lat: number; lon: number; courseDeg: number | null; posTs: number | null } {
  const base = { lat: v.lat, lon: v.lon, courseDeg: v.course_deg, posTs: v.pos_ts };
  if (!selected || !detail || detail.mmsi !== v.mmsi || detail.errors.length) return base;
  const newer =
    detail.pos_ts !== null && (v.pos_ts === null || detail.pos_ts >= v.pos_ts);
  if (newer && detail.lat !== null && detail.lon !== null) {
    return {
      lat: detail.lat,
      lon: detail.lon,
      courseDeg: detail.course_deg ?? v.course_deg,
      posTs: detail.pos_ts,
    };
  }
  // Older or position-less reply: keep the snapshot position, but a reported course is
  // still the best course we hold when the snapshot has none.
  return { ...base, courseDeg: base.courseDeg ?? detail.course_deg };
}

export function createVesselLayer(scene: Scene): VesselLayer {
  const billboards = scene.primitives.add(new BillboardCollection({ scene })) as BillboardCollection;
  const labels = scene.primitives.add(new LabelCollection({ scene })) as LabelCollection;

  const slots = new Map<string, Slot>();
  const ownerOf = new Map<object, string>();
  const seen = new Set<string>();

  function update(list: Vessel[], opts: VesselUpdateOpts) {
    seen.clear();
    const pal = palette();

    for (const v of list) {
      if (!v.key) continue;
      seen.add(v.key);

      const isSel = v.key === opts.selectedKey;
      const fix = effectiveFix(v, opts.detail, isSel);
      const pos = Cartesian3.fromDegrees(fix.lon, fix.lat, 0);
      const stale = fix.posTs !== null && opts.nowS - fix.posTs > VESSEL_STALE_S;

      // Sea traffic is class-coloured, not altitude-coloured - there is no altitude. Cyan is
      // this project's "civil / nominal" colour; military keeps the same magenta as the air
      // picture so one colour means one thing across the whole display.
      const fill = isSel ? pal.iconSelected : v.military ? pal.mil : pal.cyan;
      const stroke = v.military ? pal.iconStrokeMil : pal.iconStroke;
      const oriented = fix.courseDeg !== null;
      const image = vesselIconDataUri(asVesselCategory(v.category), oriented, fill, stroke);

      let slot = slots.get(v.key);
      if (!slot) {
        const bb = billboards.add({
          position: pos,
          image,
          alignedAxis: Cartesian3.ZERO,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
        slot = { bb, lastImage: image, lastText: "" };
        slots.set(v.key, slot);
        ownerOf.set(bb, v.key);
      }

      const bb = slot.bb;
      bb.position = pos;
      bb.rotation = oriented
        ? screenRotation(scene, pos, fix.lat, fix.lon, 0, fix.courseDeg)
        : 0;
      bb.width = isSel ? 26 : 20;
      bb.height = isSel ? 26 : 20;
      bb.color = stale ? Color.WHITE.withAlpha(0.35) : Color.WHITE;
      if (image !== slot.lastImage) {
        bb.image = image;
        slot.lastImage = image;
      }

      /* ---- label: selected, military, or the ALL IDENTIFIERS toggle - same policy the
             aircraft use (labelDecision), with coAltitude structurally false at sea level ---- */
      const label = labelDecision({
        selected: isSel, coAltitude: false, military: v.military,
        showAllLabels: opts.showAllLabels,
      });
      // Name if the vessel broadcast one, else MMSI, else the raw key: all real identifiers,
      // never a placeholder.
      const text = (v.name || v.mmsi || v.key).trim().toUpperCase();
      if (label.show) {
        if (!slot.label) {
          slot.label = labels.add({
            position: pos,
            text,
            font: "500 11px 'JetBrains Mono', ui-monospace, monospace",
            style: LabelStyle.FILL,
            horizontalOrigin: HorizontalOrigin.LEFT,
            verticalOrigin: VerticalOrigin.CENTER,
            pixelOffset: new Cartesian2(14, -8),
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
    }

    /* ---- retire vessels that dropped out of the feed (or the layer was toggled off) ---- */
    for (const [key, slot] of slots) {
      if (seen.has(key)) continue;
      ownerOf.delete(slot.bb);
      billboards.remove(slot.bb);
      if (slot.label) labels.remove(slot.label);
      slots.delete(key);
    }
  }

  /** Same drill-pick reasoning as the aircraft layer: anything drawn over a vessel must not
   *  swallow the click, and a genuine miss still returns null so click-empty-to-clear works. */
  function pick(s: Scene, pos: Cartesian2): string | null {
    for (const entry of s.drillPick(pos, DRILL_LIMIT)) {
      const key = entry?.primitive ? ownerOf.get(entry.primitive) : undefined;
      if (key) return key;
    }
    return null;
  }

  return {
    update,
    pick,
    destroy: () => {
      scene.primitives.remove(billboards);
      scene.primitives.remove(labels);
      slots.clear();
      ownerOf.clear();
    },
  };
}
