/*
 * Ground reference: airfields and city labels (D-023, D-032, D-033).
 *
 * Aircraft positions only mean something against known ground. Without this the display
 * answers "where is that contact relative to nothing?".
 *
 * BUILT ONCE, never rebuilt. The data is static - it comes from a build-time JSON, not a
 * feed - so every primitive is created on the first call and after that we only flip `.show`
 * on the two collections. That is the discipline D-015/D-028 arrived at the hard way:
 * rebuilding primitives per frame cost the frame rate, and destroying labels repeatedly
 * corrupts Cesium's glyph atlas.
 *
 * Zoom thinning is handed to Cesium as a DistanceDisplayCondition per primitive rather than
 * being recomputed in JS. It costs nothing per frame and it is what keeps 13,000 markers from
 * piling into an unreadable mat when the camera pulls back.
 */
import {
  BillboardCollection,
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  HorizontalOrigin,
  LabelCollection,
  LabelStyle,
  VerticalOrigin,
  type Scene,
} from "cesium";

import placesData from "../data/places.json";
import { palette } from "../styles/palette";
import type { PlaceInfo } from "../state/store";

/**
 * [lat, lon, code, kind, name, municipality, region, country, elevation_ft, iata]
 * kind 0 large, 1 medium, 2 military. Generated, see build_places.py.
 */
type AirportRow = [
  number, number, string, number,
  string, string, string, string, number | null, string,
];
/** [lat, lon, name, scalerank] - scalerank 0 world city .. 10 minor. */
type CityRow = [number, number, string, number];

const KIND_LARGE = 0;
const KIND_MEDIUM = 1;
const KIND_MILITARY = 2;

/* Colours come from tokens.css via palette() (D-042) - see airportStyles() below for why
   they are read lazily rather than at module scope. */

/*
 * How far out each class of place stays on screen, in metres of camera distance.
 *
 * These are the thinning thresholds. Airfields outrank cities because this is an aviation
 * display: a military field is worth seeing before the town it sits next to.
 */
const FAR_LARGE = 2_500_000;
const FAR_MILITARY = 900_000;
const FAR_MEDIUM = 450_000;

/**
 * Cities thin by Natural Earth's scalerank, which is what the rank exists for.
 *
 * The build drops everything above scalerank 7 outright (D-037), so 7 is the floor here.
 */
function cityFar(scalerank: number): number {
  if (scalerank <= 2) return 9_000_000;
  if (scalerank <= 4) return 3_000_000;
  if (scalerank <= 6) return 1_000_000;
  if (scalerank <= 7) return 400_000;
  // Ranks 8-10 arrived with D-049. They are minor towns, so they name the map only when the
  // camera is close enough that a minor town is the most useful thing to name.
  if (scalerank <= 8) return 250_000;
  return 150_000;
}

/* ---- marker glyphs: 3 airfield shapes and a city dot, so 4 data URIs in total ---- */

function squareUri(colour: string, filled: boolean): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
    `<rect x="3.5" y="3.5" width="9" height="9" fill="${filled ? colour : "none"}" ` +
    `stroke="${colour}" stroke-width="1.5"/>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function dotUri(colour: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8">` +
    `<circle cx="4" cy="4" r="1.6" fill="${colour}"/>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

type AirportStyle = { marker: string; label: string; size: number; font: number };

/**
 * Marker and label styling per airfield class.
 *
 * Military airfields take `--mil` magenta, the same accent military CONTACTS use (D-029). The
 * two cannot be confused: a contact is an aircraft silhouette in the air, an airfield is a
 * filled square on the ground.
 *
 * Colour encodes CLASS, size encodes importance. Airfield codes are cyan or magenta and cities
 * are dim, so the two can never be mistaken for one another — which they were when medium
 * airfields shared the cities' `--dim`, making KMOB and KBFM read as town names (D-039). Large
 * versus medium is carried by marker and type size, never by dimming the label.
 *
 * Built lazily, and this matters: `palette()` reads computed CSS custom properties, so calling
 * it at module scope could run before the stylesheet applies, memoise the fallbacks, and leave
 * the globe permanently on fallback colours. Fallbacks equal the tokens today, so nothing would
 * look wrong - it would only break the future theme chooser, silently. Building at layer
 * construction keeps the read after first paint.
 */
function airportStyles(): Record<number, AirportStyle> {
  const { mil, cyan } = palette();
  return {
    [KIND_LARGE]: { marker: squareUri(cyan, false), label: cyan, size: 13, font: 12 },
    [KIND_MEDIUM]: { marker: squareUri(cyan, false), label: cyan, size: 10, font: 11 },
    [KIND_MILITARY]: { marker: squareUri(mil, true), label: mil, size: 12, font: 12 },
  };
}

export interface PlacesLayer {
  setShow: (on: boolean) => void;
  /** Scale every place's visible range. 1 is the built-in tuning (D-049). */
  setDensity: (mult: number) => void;
  /** The airfield under the cursor, or null. Marker AND label are both hit targets. */
  pick: (scene: Scene, pos: Cartesian2) => PlaceInfo | null;
  destroy: () => void;
  counts: { airports: number; cities: number };
}

export function createPlacesLayer(scene: Scene): PlacesLayer {
  const billboards = scene.primitives.add(
    new BillboardCollection({ scene }),
  ) as BillboardCollection;
  const labels = scene.primitives.add(new LabelCollection({ scene })) as LabelCollection;

  const airports = placesData.airports as AirportRow[];
  const cities = placesData.cities as CityRow[];

  // Primitive -> airfield, so a click can be resolved back to something to display (D-038).
  // Cities are deliberately absent: a city dot is context, not a contact, and there is
  // nothing to say about it that the label does not already say.
  const placeOf = new Map<object, PlaceInfo>();

  const styles = airportStyles();
  // Map labels use --map-label, not --dim: dim is panel-chrome grey and vanished into water.
  const { mapLabel: cityLabel, off: cityDot, bg } = palette();
  const cityMarker = dotUri(cityDot);

  // Recolouring alone could not fix legibility, because the thing a map label sits on is not
  // one colour: the same name crosses dark land, lit water, terrain relief and radar echo.
  // A dark halo makes the text readable against all of them instead of tuning for one, and it
  // is the standard cartographic answer rather than a decoration - no glow, no filled box.
  const halo = Color.fromCssColorString(bg).withAlpha(0.85);

  /**
   * Every marker and label, with the range it is visible to at density 1.
   *
   * DENSITY rescales these rather than adding or removing primitives: the set that ships is
   * fixed at build time, so the only honest thing a runtime control can do is decide how far
   * out each row is worth drawing. Rebuilding the collections on every change would also cost
   * a visible stall at ~21,000 primitives.
   */
  const ranged: { prim: { distanceDisplayCondition?: DistanceDisplayCondition }; far: number }[] = [];

  for (const row of airports) {
    const [lat, lon, code, kind, name, municipality, region, country, elevationFt, iata] = row;
    const style = styles[kind];
    if (!style) continue;
    const position = Cartesian3.fromDegrees(lon, lat, 0);
    const far = kind === KIND_LARGE ? FAR_LARGE
      : kind === KIND_MILITARY ? FAR_MILITARY
      : FAR_MEDIUM;
    // No disableDepthTestDistance here, unlike the aircraft: these sit ON the ellipsoid, so
    // the globe must be allowed to occlude the ones on the far side of the planet.
    const ddc = new DistanceDisplayCondition(0, far);

    const info: PlaceInfo = {
      ident: code,
      name,
      municipality,
      region,
      country,
      elevationFt,
      iata,
      military: kind === KIND_MILITARY,
      large: kind === KIND_LARGE,
      lat,
      lon,
    };

    const marker = billboards.add({
      position,
      image: style.marker,
      width: style.size,
      height: style.size,
      distanceDisplayCondition: ddc,
    });
    const label = labels.add({
      position,
      text: code,
      font: `500 ${style.font}px 'JetBrains Mono', ui-monospace, monospace`,
      style: LabelStyle.FILL_AND_OUTLINE,
      fillColor: Color.fromCssColorString(style.label),
      outlineColor: halo,
      outlineWidth: 2,
      horizontalOrigin: HorizontalOrigin.LEFT,
      verticalOrigin: VerticalOrigin.CENTER,
      pixelOffset: new Cartesian2(Math.round(style.size / 2) + 3, 0),
      distanceDisplayCondition: ddc,
    });
    // The airfield's NAME, under its code. Kept to a SHORTER range than the code deliberately:
    // the code is the identifier you scan for at a distance, the name is what you want once you
    // have found it, and drawing 5,275 names at full range would bury the map. far/4 means a
    // name appears only when its airfield is already the local subject.
    //
    // The trailing "Airport" is dropped (4,292 of 5,275 carry it) purely to control label width -
    // that is trimming a redundant suffix for display, not altering what we were told. The full
    // name is still shown verbatim in the click-through panel (D-038).
    const shortName = name.replace(/\s+(Airport|Airfield|Aerodrome)$/i, "").trim();
    if (shortName) {
      const nameFar = far / 4;
      const nameLabel = labels.add({
        position,
        text: shortName.toUpperCase(),
        font: `400 ${Math.max(9, style.font - 2)}px 'JetBrains Mono', ui-monospace, monospace`,
        style: LabelStyle.FILL_AND_OUTLINE,
        // Same hue as the code, dimmed: it is the same object's label, not a second place.
        fillColor: Color.fromCssColorString(style.label).withAlpha(0.72),
        outlineColor: halo,
        outlineWidth: 2,
        horizontalOrigin: HorizontalOrigin.LEFT,
        verticalOrigin: VerticalOrigin.TOP,
        pixelOffset: new Cartesian2(Math.round(style.size / 2) + 3, 4),
        distanceDisplayCondition: new DistanceDisplayCondition(0, nameFar),
      });
      // Clicking the name selects the same airfield the code does.
      placeOf.set(nameLabel, info);
      ranged.push({ prim: nameLabel, far: nameFar });
    }

    ranged.push({ prim: marker, far }, { prim: label, far });
    // Both are hit targets: the code is a bigger, easier thing to hit than a 10px square.
    placeOf.set(marker, info);
    placeOf.set(label, info);
  }

  for (const [lat, lon, name, scalerank] of cities) {
    const position = Cartesian3.fromDegrees(lon, lat, 0);
    const far = cityFar(scalerank);
    const ddc = new DistanceDisplayCondition(0, far);

    const cityDotPrim = billboards.add({
      position,
      image: cityMarker,
      width: 8,
      height: 8,
      distanceDisplayCondition: ddc,
    });
    const cityLabelPrim = labels.add({
      position,
      // Uppercase at small sizes, per the project's visual direction.
      text: name.toUpperCase(),
      font: "400 10px 'JetBrains Mono', ui-monospace, monospace",
      style: LabelStyle.FILL_AND_OUTLINE,
      fillColor: Color.fromCssColorString(cityLabel),
      outlineColor: halo,
      outlineWidth: 2,
      // City names go BELOW their dot, centred; airfield codes go to the RIGHT of their
      // square. A city and its airport sit within a few km of each other, so sharing an
      // anchor made pairs like KMGM/MONTGOMERY and KBIX/BILOXI overprint into mush.
      horizontalOrigin: HorizontalOrigin.CENTER,
      verticalOrigin: VerticalOrigin.TOP,
      pixelOffset: new Cartesian2(0, 6),
      distanceDisplayCondition: ddc,
    });
    ranged.push({ prim: cityDotPrim, far }, { prim: cityLabelPrim, far });
  }

  let density = 1;

  return {
    setShow: (on: boolean) => {
      billboards.show = on;
      labels.show = on;
    },
    /**
     * Scale how far out every place stays drawn. 1 is the built-in tuning; higher values pull
     * more of the shipped set into view at any given camera height.
     *
     * This cannot invent places. If a row was never built into `places.json` no density will
     * show it - which is why D-049 had to widen the BUILD before this control was worth having.
     */
    setDensity: (mult: number) => {
      if (mult === density) return;
      density = mult;
      for (const r of ranged) {
        r.prim.distanceDisplayCondition = new DistanceDisplayCondition(0, r.far * mult);
      }
    },
    // Drilled for the same reason aircraft picks are (D-035): the frontmost primitive over an
    // airfield is often its own label, or another marker crowding it.
    pick: (s: Scene, pos: Cartesian2) => {
      if (!billboards.show) return null;
      for (const entry of s.drillPick(pos, 8)) {
        const info = entry?.primitive ? placeOf.get(entry.primitive) : undefined;
        if (info) return info;
      }
      return null;
    },
    destroy: () => {
      scene.primitives.remove(billboards);
      scene.primitives.remove(labels);
      placeOf.clear();
    },
    counts: { airports: airports.length, cities: cities.length },
  };
}
