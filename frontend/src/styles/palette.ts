/*
 * The palette, read back out of tokens.css at runtime (D-042).
 *
 * WHY THIS EXISTS: Cesium draws with concrete colour strings and cannot read CSS custom
 * properties, so every globe colour used to be a hex literal inside the layer that drew it —
 * nineteen of them across six files, with four tokens duplicated verbatim in placesLayer.ts.
 * A palette in two places is a palette that drifts, and it made a theme chooser a hunt rather
 * than a config change.
 *
 * Direction of truth matters here. `tokens.css` stays the hand-written source of visual
 * identity, exactly as CLAUDE.md requires, and TypeScript DERIVES from it. The alternative -
 * defining colours in TS and injecting them into CSS - would have inverted that and left the
 * token file as generated output.
 *
 * DOM code does NOT need this: React inline styles can say `var(--cyan)` directly. Use this
 * only where a real colour string is required, which in practice means Cesium.
 */

/**
 * Documented fallbacks, used only if a variable is missing or styles have not applied yet.
 * They are the tokens.css values; if these ever diverge, tokens.css is right and this is a bug
 * (`npm run check:palette` fails the build on exactly that).
 */
const FALLBACK: Record<string, string> = {
  "--bg": "#05070a",
  "--amber": "#ffb000",
  "--mil": "#ff4fd8",
  "--cyan": "#5fd7e0",
  "--txt": "#c8d6e0",
  "--dim": "#5a6b7a",
  "--off": "#3a4652",
  "--icon-stroke": "#03181c",
  "--icon-stroke-mil": "#3d0033",
  "--icon-stroke-alert": "#3a2600",
  "--icon-selected": "#ffffff",
  "--map-label": "#e9edf0",
};

export interface Palette {
  bg: string;
  amber: string;
  mil: string;
  cyan: string;
  txt: string;
  dim: string;
  off: string;
  iconStroke: string;
  iconStrokeMil: string;
  iconStrokeAlert: string;
  iconSelected: string;
  mapLabel: string;
}

function read(name: string): string {
  // getComputedStyle is only meaningful in a browser with the stylesheet applied; the fallback
  // keeps this usable from a test or before first paint.
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (v) return v;
  }
  return FALLBACK[name];
}

let cache: Palette | null = null;

/**
 * The current palette. Memoised, because reading a dozen custom properties per frame would be
 * a pointless layout query - the values only change when a theme changes.
 */
export function palette(): Palette {
  if (cache) return cache;
  cache = {
    bg: read("--bg"),
    amber: read("--amber"),
    mil: read("--mil"),
    cyan: read("--cyan"),
    txt: read("--txt"),
    dim: read("--dim"),
    off: read("--off"),
    iconStroke: read("--icon-stroke"),
    iconStrokeMil: read("--icon-stroke-mil"),
    iconStrokeAlert: read("--icon-stroke-alert"),
    iconSelected: read("--icon-selected"),
    mapLabel: read("--map-label"),
  };
  return cache;
}

/**
 * Drop the memo so the next read picks up changed custom properties.
 *
 * Nothing calls this yet. It is the hook a theme chooser needs (parked as FUTURE), and it is
 * here because the memo above is exactly what would make such a chooser appear not to work.
 * Callers would also have to rebuild Cesium primitives holding baked colours.
 */
export function refreshPalette(): void {
  cache = null;
}
