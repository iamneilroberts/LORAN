/*
 * Aircraft planform silhouettes.
 *
 * These are CATEGORY shapes, not scale models. A B738 and an A320 share the "narrowbody"
 * silhouette because that is an honest statement of what we know: a swept-wing twin jet.
 * We never imply the icon is the exact airframe, and an unknown type gets the generic shape
 * rather than a guess (ground rule 3 - unknown renders as unknown, not invented).
 *
 * Drawn nose-up in a 64x64 box so Cesium's billboard rotation maps directly to ADS-B `track`.
 */

export type Silhouette =
  | "heavy"       // 4-engine widebody / large military transport
  | "widebody"    // twin-aisle twin jet
  | "narrowbody"  // single-aisle swept twin jet
  | "regional"    // regional jet / bizjet
  | "turboprop"   // straight-wing prop, incl. military transports & trainers
  | "helicopter"
  | "fighter"
  | "light"       // GA piston single
  | "generic";

/* Top-down planforms. Nose at top (y=0), tail at bottom. */
const PATHS: Record<Silhouette, string> = {
  narrowbody:
    "M32 2 L34.5 11 L35 26 L61 43 L61 48 L35 39 L34 51 L42 58 L42 61 L32 57.5 L22 61 L22 58 L30 51 L29 39 L3 48 L3 43 L29 26 L29.5 11 Z",
  widebody:
    "M32 2 L35 12 L36 26 L62 44 L62 50 L36 40 L35 52 L44 59 L44 62 L32 58 L20 62 L20 59 L29 52 L28 40 L2 50 L2 44 L28 26 L29 12 Z",
  heavy:
    "M32 1 L35.5 11 L36.5 25 L63 43 L63 49 L36.5 39.5 L35.5 52 L46 59 L46 62 L32 58 L18 62 L18 59 L28.5 52 L27.5 39.5 L1 49 L1 43 L27.5 25 L28.5 11 Z" +
    "M46 36 L50 35 L50 41 L46 41 Z M14 36 L18 36 L18 41 L14 41 Z" +
    "M53 39 L57 38 L57 44 L53 44 Z M7 38 L11 39 L11 44 L7 44 Z",
  regional:
    "M32 4 L34 12 L34.5 28 L57 44 L57 48 L34.5 40 L34 50 L41 57 L41 60 L32 56.5 L23 60 L23 57 L30 50 L29.5 40 L7 48 L7 44 L29.5 28 L30 12 Z",
  turboprop:
    "M32 3 L34.5 12 L35 28 L35 33 L60 33 L60 38 L35 38 L34.5 52 L43 59 L43 62 L32 58 L21 62 L21 59 L29.5 52 L29 38 L4 38 L4 33 L29 33 L29.5 12 Z" +
    "M44 28 L47 28 L47 43 L44 43 Z M17 28 L20 28 L20 43 L17 43 Z",
  fighter:
    "M32 1 L34 14 L35 30 L52 48 L52 54 L35 46 L34.5 54 L40 60 L40 62 L32 58 L24 62 L24 60 L29.5 54 L29 46 L12 54 L12 48 L29 30 L30 14 Z",
  light:
    "M32 6 L34 14 L34 27 L56 27 L56 32 L34 32 L34 48 L42 55 L42 58 L32 55 L22 58 L22 55 L30 48 L30 32 L8 32 L8 27 L30 27 L30 14 Z",
  helicopter:
    "M32 16 L35 22 L35 44 L33 52 L33 60 L38 60 L38 62 L26 62 L26 60 L31 60 L31 52 L29 44 L29 22 Z" +
    "M20 46 L44 46 L44 49 L20 49 Z",
  generic:
    "M32 3 L34 12 L34.5 30 L56 45 L56 49 L34.5 41 L34 52 L41 58 L41 61 L32 57 L23 61 L23 58 L30 52 L29.5 41 L8 49 L8 45 L29.5 30 L30 12 Z",
};

/* Helicopter gets a rotor disc drawn behind the fuselage. */
const ROTOR: Partial<Record<Silhouette, number>> = { helicopter: 26 };

/* Explicit ICAO type codes we see often around Mobile, or that the heuristics get wrong. */
const BY_TYPE: Record<string, Silhouette> = {
  TEX2: "turboprop",   // T-6B Texan II - Whiting Field trainers
  T6: "turboprop",
  A119: "helicopter",  // TH-73A Thrasher
  B06: "helicopter", B407: "helicopter", B429: "helicopter",
  EC30: "helicopter", EC35: "helicopter", AS50: "helicopter", R44: "helicopter",
  H60: "helicopter", UH60: "helicopter", S76: "helicopter", A139: "helicopter",
  C17: "heavy", C5M: "heavy", B52: "heavy", KC35: "heavy", K35R: "heavy",
  C30J: "turboprop", C130: "turboprop", LC30: "turboprop", P8: "narrowbody",
  F16: "fighter", F18: "fighter", F15: "fighter", F22: "fighter", F35: "fighter",
  A10: "fighter", T38: "fighter", HAWK: "fighter",
  E55P: "regional", C25A: "regional", C25B: "regional", C25C: "regional",
  C56X: "regional", C68A: "regional", LJ35: "regional", GLF5: "regional", GLF6: "regional",
  PA32: "light", C172: "light", C182: "light", C152: "light", SR22: "light", SR20: "light",
  BE9L: "turboprop", B350: "turboprop", PC12: "turboprop", TBM9: "turboprop",
  DH8D: "turboprop", AT76: "turboprop", C208: "turboprop",
};

/**
 * Pick a silhouette from what the feed actually told us.
 *
 * Order matters: an explicit type code beats a pattern, which beats the broadcast ADS-B
 * emitter category, which beats the generic shape. `category` is broadcast by the aircraft
 * itself (A7 = rotorcraft, A5 = heavy, ...) so it is real data, not an assumption.
 */
export function silhouetteFor(type?: string | null, category?: string | null): Silhouette {
  const t = (type ?? "").toUpperCase().trim();

  if (t && BY_TYPE[t]) return BY_TYPE[t];

  if (t) {
    if (/^(B74|B77|B78|A33|A34|A35|A38|B76|MD11)/.test(t)) return "widebody";
    if (/^(B73|A31|A32|B75|MD8|MD9|B71|E19|A22)/.test(t)) return "narrowbody";
    if (/^(CRJ|E13|E14|E17|E45|E75|RJ|CL[36]|GLF|LJ|C5[06]|C6[08]|F2T|H25)/.test(t))
      return "regional";
    if (/^(AT[47]|DH8|SF34|SW4|BE[0-9]|B19|B35|C20|PC1|TBM|PA4|D22)/.test(t)) return "turboprop";
    if (/^(EC|AS3|AS5|R22|R44|R66|S6[45]|S76|S92|B0[0-9]|H1[0-9]|A10[0-9]|A13|A16|MD5)/.test(t))
      return "helicopter";
    if (/^(C1[0-9][0-9]|P18|PA2|PA3|SR2|DA[24]|M20|BE3[36]|AA5|GA8)/.test(t)) return "light";
  }

  // ADS-B emitter category - broadcast by the aircraft, so this is measured, not guessed.
  switch ((category ?? "").toUpperCase()) {
    case "A7": return "helicopter";
    case "A5": return "heavy";
    case "A4": return "widebody";
    case "A3": return "narrowbody";
    case "A2": return "regional";
    case "A1": return "light";
    case "A6": return "fighter";     // "high performance"
    default: return "generic";
  }
}

/* ---- rendering ---- */

const cache = new Map<string, string>();

/**
 * SVG data URI for a silhouette in a given colour.
 * Cached: there are only a handful of shape/colour combinations in play at once.
 */
export function iconDataUri(shape: Silhouette, fill: string, stroke: string): string {
  const key = `${shape}|${fill}|${stroke}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const rotor = ROTOR[shape];
  const rotorSvg = rotor
    ? `<circle cx="32" cy="34" r="${rotor}" fill="none" stroke="${stroke}" ` +
      `stroke-width="1" opacity="0.35"/>`
    : "";

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    rotorSvg +
    `<path d="${PATHS[shape]}" fill="${fill}" stroke="${stroke}" stroke-width="0.75" ` +
    `stroke-linejoin="round" fill-rule="evenodd"/>` +
    `</svg>`;

  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(key, uri);
  return uri;
}
