/*
 * Parsing, validating and labelling a manually-entered or geolocated home position (D-068).
 *
 * Pure by design: this is the part with rules in it, and vitest's node environment has no DOM
 * (D-051). The component keeps only the inputs and the buttons.
 *
 * The rule that shapes all of it: a coordinate this app did not look up must never be given a
 * PLACE NAME. A home the user typed or that the browser reported is labelled with its own
 * coordinates, formatted. Calling 31.16N 89.75W "HATTIESBURG" because it looks close to one
 * would be exactly the invented data ground rule 1 forbids, and the status bar prints this
 * label as fact.
 *
 * D-069 added a geocoder, which refines that rule without breaking it. A geocoded position HAS
 * been looked up, so it may carry the name the geocoder returned - see `geocodedLabel`, and note
 * that "looked up" is doing the work there, not "sounds like a place".
 */

export interface HomePos {
  lat: number;
  lon: number;
  label: string;
}

/**
 * Parse one coordinate field. Returns null for anything that is not a finite number, which the
 * caller renders as an error rather than coercing - `Number("")` is 0, and a silent 0 would put
 * the console in the Gulf of Guinea without saying so.
 */
export function parseCoord(text: string): number | null {
  const t = text.trim();
  // One gate, deliberately: this also rejects the empty string, which `Number("")` would
  // otherwise turn into 0. An explicit `if (!t)` ahead of it reads as defensive but is dead
  // code - the regex cannot match "" - and mutation testing confirmed removing it changes
  // nothing. Rejects "12abc" and "1,2" that Number() would partially accept or NaN out.
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export type HomeProblem =
  | "lat-missing" | "lon-missing"
  | "lat-range" | "lon-range"
  | null;

/** What is wrong with this pair, or null if nothing is. */
export function validateHome(lat: number | null, lon: number | null): HomeProblem {
  if (lat === null) return "lat-missing";
  if (lon === null) return "lon-missing";
  if (lat < -90 || lat > 90) return "lat-range";
  if (lon < -180 || lon > 180) return "lon-range";
  return null;
}

/** Human-readable reason, for the panel. Short: it renders at 9px in a 210px column. */
export function problemText(p: HomeProblem): string | null {
  switch (p) {
    case "lat-missing": return "Latitude required";
    case "lon-missing": return "Longitude required";
    case "lat-range": return "Latitude must be −90 to 90";
    case "lon-range": return "Longitude must be −180 to 180";
    default: return null;
  }
}

/**
 * "31.16N 89.75W" - the label for a position we have coordinates for and no name for.
 *
 * Two decimal places is ~1.1 km, which is the right precision for a label that names a
 * CONSOLE CENTRE rather than a point. The full precision is still what gets fetched with.
 */
export function coordLabel(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}${ns} ${Math.abs(lon).toFixed(2)}${ew}`;
}

/** One candidate from `/api/geocode`. Field-for-field what the backend normalized. */
export interface GeocodeCandidate {
  lat: number;
  lon: number;
  /** Verbatim from the geocoder, and EMPTY for anything that is not a named place. */
  name: string;
  /** The long form - "150, Government Street, …, Alabama, 36602, United States". */
  detail: string;
  /** "city", "aeroway", "place" … Shown because two candidates can share a `detail`. */
  kind: string;
}

/**
 * The label for a position we DID look up (D-069).
 *
 * The distinction from the coordinate-only rule above is "did this app look it up", not "does
 * this sound like a place", so a geocoded result may carry its name. Two properties keep that
 * honest:
 *
 *   1. The name is used VERBATIM. Not shortened, not title-cased, not recomposed from parts.
 *      The status bar prints it as fact, so it has to be the geocoder's claim and not ours.
 *   2. An empty name falls back to coordinates. Nominatim fills `name` for a place that has one
 *      ("Springfield", "Mobile Regional Airport") and leaves it "" for a street address, which
 *      is not a named place - so 150 Government Street is labelled "30.69N 88.04W", exactly as
 *      if it had been typed in. Reaching into `detail` to manufacture a name for it would be
 *      inventing one, and inventing it out of real fragments is still inventing it.
 */
export function geocodedLabel(name: string, lat: number, lon: number): string {
  const n = name.trim();
  return n || coordLabel(lat, lon);
}

/**
 * Which home is actually in force.
 *
 * The override wins when present, and the server's value is kept rather than overwritten so
 * "reset to configured" stays possible and the panel can say which one is in use. A browser with
 * no override behaves exactly as it did before this existed - which is the property that lets
 * this ship without changing anyone's default.
 */
export function effectiveHome(serverHome: HomePos, override: HomePos | null): HomePos {
  return override ?? serverHome;
}

/**
 * Accept a position only if it is usable, so a corrupt localStorage or a browser reporting
 * nonsense cannot put the console somewhere impossible.
 */
export function isHomePos(v: unknown): v is HomePos {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.lat === "number" && typeof o.lon === "number"
    && typeof o.label === "string"
    && Number.isFinite(o.lat) && Number.isFinite(o.lon)
    && validateHome(o.lat, o.lon) === null;
}
