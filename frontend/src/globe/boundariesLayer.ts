/*
 * Political boundaries: state/province lines worldwide, US county lines (D-063).
 *
 * Same discipline as placesLayer: the data is static, baked at build time by
 * scripts/build_boundaries.py, so every polyline is created once and after that we only flip
 * `.show` on the collections. Rebuilding primitives per frame is what cost the frame rate in
 * D-015/D-028, and nothing here changes between frames.
 *
 * These are CONTEXT, not instrumentation. The globe is the subject and the aircraft are the
 * point; a boundary line exists so the operator can say "that contact is over Baldwin County"
 * without hunting. So they are drawn thin, in the two most subordinate palette tokens, and
 * thinned aggressively by camera distance - at full-globe zoom 4,477 rings would be a grey
 * felt mat over the entire display, which is worse than no boundaries at all.
 */
import {
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  Material,
  PolylineCollection,
  type Scene,
} from "cesium";

import boundariesData from "../data/boundaries.json";
import { palette } from "../styles/palette";

/** Flat [lon, lat, lon, lat, ...] degree arrays. See scripts/build_boundaries.py. */
type Ring = number[];

/**
 * Camera distance in metres beyond which each layer stops drawing.
 *
 * States outrank counties by a wide margin because there are four times fewer of them and they
 * are the coarser answer - "which state" is useful from much further out than "which county".
 * The county threshold is deliberately close in: 3,619 rings only resolve into distinguishable
 * shapes when the camera is inside a few hundred kilometres, and drawing them from orbit would
 * produce texture rather than information.
 */
export const FAR_STATES = 8_000_000;
export const FAR_COUNTIES = 900_000;

/** Width in pixels. One, for both, deliberately - see the visual direction in CLAUDE.md. */
const LINE_WIDTH = 1;

export interface BoundariesLayer {
  setShow: (states: boolean, counties: boolean) => void;
  /** Re-read the palette after a theme change, matching placesLayer.recolour(). */
  recolour: () => void;
  destroy: () => void;
  counts: { states: number; counties: number };
}

/**
 * Build one collection from a set of rings.
 *
 * Every ring goes into a single PolylineCollection, which Cesium batches - the alternative,
 * one Entity per feature, would be thousands of separate primitives and is exactly the mistake
 * the handoff for this work warned about.
 */
function addRings(
  scene: Scene, rings: Ring[], colour: Color, far: number,
): PolylineCollection {
  const collection = scene.primitives.add(new PolylineCollection()) as PolylineCollection;
  const distance = new DistanceDisplayCondition(0.0, far);
  const material = Material.fromType("Color", { color: colour });

  for (const ring of rings) {
    // A ring needs at least two points to be a line. The build script already drops shorter
    // ones; this is the belt to that braces, because a degenerate polyline throws in Cesium.
    if (ring.length < 4) continue;
    collection.add({
      positions: Cartesian3.fromDegreesArray(ring),
      width: LINE_WIDTH,
      material,
      distanceDisplayCondition: distance,
    });
  }
  return collection;
}

export function createBoundariesLayer(scene: Scene): BoundariesLayer {
  const states = boundariesData.states as Ring[];
  const counties = boundariesData.counties as Ring[];

  // palette() reads computed CSS custom properties, so it must be called after the stylesheet
  // is live rather than at module scope - the same reason placesLayer defers it (D-042).
  //
  // States take --dim and counties --off, the two "present but not the thing to look at"
  // tokens, in that order: a county line must never compete with the state line it sits inside.
  let statesColour = Color.fromCssColorString(palette().dim);
  let countiesColour = Color.fromCssColorString(palette().off);

  let stateLines: PolylineCollection | null = null;
  // Counties are built LAZILY, on the first request to show them. They default off and are
  // 3,619 rings; paying that construction cost at startup for a layer most sessions never turn
  // on would slow the thing that matters - first paint of live traffic.
  let countyLines: PolylineCollection | null = null;

  const ensureStates = () => {
    if (!stateLines) stateLines = addRings(scene, states, statesColour, FAR_STATES);
    return stateLines;
  };
  const ensureCounties = () => {
    if (!countyLines) countyLines = addRings(scene, counties, countiesColour, FAR_COUNTIES);
    return countyLines;
  };

  return {
    setShow(showStates, showCounties) {
      // Only build what is actually asked for; hiding an unbuilt layer is a no-op, not a build.
      if (showStates) ensureStates().show = true;
      else if (stateLines) stateLines.show = false;

      if (showCounties) ensureCounties().show = true;
      else if (countyLines) countyLines.show = false;
    },

    recolour() {
      statesColour = Color.fromCssColorString(palette().dim);
      countiesColour = Color.fromCssColorString(palette().off);
      // Materials are per-polyline references to one shared Material, so setting the colour on
      // each polyline's material updates the whole collection in one pass.
      for (const [collection, colour] of [
        [stateLines, statesColour] as const,
        [countyLines, countiesColour] as const,
      ]) {
        if (!collection) continue;
        for (let i = 0; i < collection.length; i++) {
          collection.get(i).material.uniforms.color = colour;
        }
      }
    },

    destroy() {
      if (stateLines) scene.primitives.remove(stateLines);
      if (countyLines) scene.primitives.remove(countyLines);
      stateLines = countyLines = null;
    },

    counts: { states: states.length, counties: counties.length },
  };
}
