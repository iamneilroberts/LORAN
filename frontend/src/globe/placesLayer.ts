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
  return 400_000;
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
  const { mapLabel: cityLabel, off: cityDot } = palette();
  const cityMarker = dotUri(cityDot);

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
      style: LabelStyle.FILL,
      fillColor: Color.fromCssColorString(style.label),
      horizontalOrigin: HorizontalOrigin.LEFT,
      verticalOrigin: VerticalOrigin.CENTER,
      pixelOffset: new Cartesian2(Math.round(style.size / 2) + 3, 0),
      distanceDisplayCondition: ddc,
    });
    // Both are hit targets: the code is a bigger, easier thing to hit than a 10px square.
    placeOf.set(marker, info);
    placeOf.set(label, info);
  }

  for (const [lat, lon, name, scalerank] of cities) {
    const position = Cartesian3.fromDegrees(lon, lat, 0);
    const ddc = new DistanceDisplayCondition(0, cityFar(scalerank));

    billboards.add({
      position,
      image: cityMarker,
      width: 8,
      height: 8,
      distanceDisplayCondition: ddc,
    });
    labels.add({
      position,
      // Uppercase at small sizes, per the project's visual direction.
      text: name.toUpperCase(),
      font: "400 10px 'JetBrains Mono', ui-monospace, monospace",
      style: LabelStyle.FILL,
      fillColor: Color.fromCssColorString(cityLabel),
      // City names go BELOW their dot, centred; airfield codes go to the RIGHT of their
      // square. A city and its airport sit within a few km of each other, so sharing an
      // anchor made pairs like KMGM/MONTGOMERY and KBIX/BILOXI overprint into mush.
      horizontalOrigin: HorizontalOrigin.CENTER,
      verticalOrigin: VerticalOrigin.TOP,
      pixelOffset: new Cartesian2(0, 6),
      distanceDisplayCondition: ddc,
    });
  }

  return {
    setShow: (on: boolean) => {
      billboards.show = on;
      labels.show = on;
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
