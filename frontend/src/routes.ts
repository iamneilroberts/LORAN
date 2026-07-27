/**
 * Which of the three views a load lands on (D-076).
 *
 * There are two surfaces and one instrument:
 *
 *   LIST (`#m`)   - the glance view. What is overhead, no globe, no WebGL (D-072).
 *   MAP  (`#map`) - the console. The real job.
 *   PROBE (`#probe`) - the mobile viability instrument (D-073's gate).
 *
 * WITH NO HASH the view is chosen by viewport width, because the token links are SHARED. One URL
 * goes to the owner on a desktop and to two other people on devices nobody here has seen, so the
 * link has to do the right thing on arrival rather than expecting the reader to know a hash.
 *
 * The width test is deliberately paired with a visible switch on both views. Auto-routing that
 * cannot be overridden is a trap: it would lock a tablet out of the console, or lock the owner
 * out of the list on a laptop, on the strength of a number this file guessed. The hash always
 * wins over the width.
 *
 * `#m` and `#probe` keep working exactly as before, so every link already handed out survives.
 */

/**
 * Below this the console's fixed-width panels (210 / 176 / 344 / 148 px) cannot coexist with a
 * usable globe, which is the measured collapse in D-072. Above it a tablet in portrait still has
 * room, so 700 rather than a phone-sized 480: the point of the threshold is "can the console
 * work here", not "is this a phone".
 */
export const CONSOLE_MIN_W = 700;

export type View = "list" | "map" | "probe";

/** The hash, normalised. Empty string means "no opinion, decide by width". */
function hash(): string {
  if (typeof window === "undefined") return "";
  return window.location.hash.replace(/^#/, "").toLowerCase();
}

/**
 * The whole routing rule, as a pure function of the two inputs that decide it.
 *
 * Split out from `currentView` so it can be tested without a DOM: the suite runs in vitest's
 * `node` environment on purpose, and reaching for jsdom to test six lines of branching would add
 * a dependency to answer a question that plain arguments answer better.
 */
export function viewFor(rawHash: string, width: number): View {
  switch (rawHash.replace(/^#/, "").toLowerCase()) {
    case "m": return "list";
    case "map": return "map";
    case "probe": return "probe";
    // Anything else - including a stale or mistyped hash - falls back to the width rather than
    // rendering nothing.
    default: return width < CONSOLE_MIN_W ? "list" : "map";
  }
}

export function currentView(): View {
  if (typeof window === "undefined") return "map";
  return viewFor(hash(), window.innerWidth);
}

/** True when no hash is present, so the view is following the viewport and may change on resize. */
export function isAutoRouted(): boolean {
  return hash() === "";
}

/**
 * Navigate. `pushState`-backed via the hash, so the phone's BACK gesture returns to the list -
 * which is the behaviour anyone expects from a list that opens a detail view, and comes free
 * rather than needing a history stack of our own.
 */
export function goTo(view: View): void {
  const h = view === "list" ? "#m" : view === "map" ? "#map" : "#probe";
  if (window.location.hash !== h) window.location.hash = h;
}

/** Whether the narrow-screen affordances (the back-to-list control) should be shown. */
export function isNarrow(): boolean {
  return typeof window !== "undefined" && window.innerWidth < CONSOLE_MIN_W;
}
