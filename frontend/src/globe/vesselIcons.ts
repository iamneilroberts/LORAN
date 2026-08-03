/*
 * Vessel silhouettes (D-078).
 *
 * Same honesty stance as the aircraft icons: these are CATEGORY shapes, not scale models,
 * mapped from the AIS ship-type summary the source actually sent. Two families:
 *
 *   ORIENTED  - a top-down hull, bow at the top of the 64x64 box, so Cesium's billboard
 *               rotation maps a real course straight onto the icon. Used ONLY when a course
 *               is known ("reported" by the feed, or "derived" from the vessel's own fixes).
 *   NEUTRAL   - a ring with the category glyph inside. Direction-free by construction, used
 *               when the course is unknown: a moored ship drawn with a pointed bow would be
 *               claiming a heading nobody measured (ground rule 1).
 *
 * The category glyph is the SAME mark in both families, so a vessel keeps its identity when
 * it starts moving and flips from ring to hull.
 */

export type VesselCategory =
  | "cargo"
  | "tanker"
  | "passenger"
  | "highspeed"
  | "fishing"
  | "tug"
  | "pleasure"
  | "sailing"
  | "military"
  | "other"
  | "unknown";

/** Anything the backend sends that this build does not know falls back to "other". */
export function asVesselCategory(v: string | null | undefined): VesselCategory {
  switch (v) {
    case "cargo": case "tanker": case "passenger": case "highspeed": case "fishing":
    case "tug": case "pleasure": case "sailing": case "military": case "unknown":
      return v;
    default:
      return v ? "other" : "unknown";
  }
}

/* Top-down hulls, bow at y-min. Chosen for legibility at ~20 px, not for realism. */
const HULLS: Record<VesselCategory, string> = {
  // Full beam, long parallel midbody - the classic box ship.
  cargo: "M32 4 L44 20 L44 56 L20 56 L20 20 Z",
  tanker: "M32 4 L44 20 L44 56 L20 56 L20 20 Z",
  // Longer, slightly rounded shoulders.
  passenger: "M32 3 L43 16 L43 57 L21 57 L21 16 Z",
  // Narrow wedge.
  highspeed: "M32 3 L42 44 L40 58 L24 58 L22 44 Z",
  // Short working hull.
  fishing: "M32 10 L42 24 L42 54 L22 54 L22 24 Z",
  tug: "M32 12 L43 26 L43 52 L21 52 L21 26 Z",
  // Small and slim.
  pleasure: "M32 8 L40 26 L40 54 L24 54 L24 26 Z",
  sailing: "M32 6 L40 26 L38 54 L26 54 L24 26 Z",
  // Faceted bow.
  military: "M32 2 L40 14 L44 30 L44 54 L20 54 L20 30 L24 14 Z",
  other: "M32 6 L42 22 L42 55 L22 55 L22 22 Z",
  unknown: "M32 6 L42 22 L42 55 L22 55 L22 22 Z",
};

/**
 * Category glyphs, centred on (32,34), drawn in the STROKE colour so they read as a cut-out
 * against the hull fill and as a mark inside the neutral ring. Same mark in both families.
 */
const GLYPHS: Record<VesselCategory, string> = {
  cargo: `<rect x="27" y="29" width="10" height="10" fill="none" stroke="{S}" stroke-width="2"/>`,
  tanker: `<circle cx="32" cy="34" r="5" fill="{S}"/>`,
  passenger: `<rect x="25" y="31" width="14" height="2.5" fill="{S}"/>` +
    `<rect x="25" y="36" width="14" height="2.5" fill="{S}"/>`,
  highspeed: `<path d="M26 30 L32 25 L38 30 M26 40 L32 35 L38 40" fill="none" stroke="{S}" stroke-width="2"/>`,
  fishing: `<path d="M32 27 L32 41 M25 34 L39 34" stroke="{S}" stroke-width="2"/>`,
  tug: `<rect x="28" y="30" width="8" height="8" fill="{S}"/>`,
  pleasure: `<circle cx="32" cy="34" r="2.5" fill="{S}"/>`,
  sailing: `<path d="M32 25 L32 43" stroke="{S}" stroke-width="2"/>`,
  military: `<path d="M32 28 L38 34 L32 40 L26 34 Z" fill="{S}"/>`,
  other: "",
  unknown: "",
};

const cache = new Map<string, string>();

/**
 * SVG data URI for a vessel marker.
 * `oriented` true -> hull (rotate the billboard by course); false -> direction-neutral ring.
 */
export function vesselIconDataUri(
  category: VesselCategory,
  oriented: boolean,
  fill: string,
  stroke: string,
): string {
  const key = `${category}|${oriented ? "o" : "n"}|${fill}|${stroke}`;
  const hit = cache.get(key);
  if (hit) return hit;

  // On the hull the glyph is a dark cut-out against the bright fill; inside the mostly-empty
  // ring the glyph carries the bright colour itself, or it would vanish against the basemap.
  const glyph = GLYPHS[category].replace(/\{S\}/g, oriented ? stroke : fill);
  const body = oriented
    ? `<path d="${HULLS[category]}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" ` +
      `stroke-linejoin="round"/>` + glyph
    : // The ring is nearly unfilled so the basemap shows through - a vessel with no known
      // course is a position marker, not a shape asserting a direction. Unknown category gets
      // a dashed ring so "we know nothing about this one" reads differently from "other".
      `<circle cx="32" cy="34" r="16" fill="${fill}" fill-opacity="0.18" stroke="${fill}" ` +
      `stroke-width="2.5"${category === "unknown" ? ` stroke-dasharray="4 3"` : ""}/>` + glyph;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    body +
    `</svg>`;
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(key, uri);
  return uri;
}
