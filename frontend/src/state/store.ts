import { create } from "zustand";
import { persist } from "zustand/middleware";
import { coordLabel, effectiveHome, isHomePos, type HomePos } from "./homeInput";

export interface Aircraft {
  hex: string | null;
  flight: string | null;
  registration: string | null;
  type: string | null;
  desc: string | null;
  operator: string | null;
  year: string | null;
  category: string | null;
  lat: number;
  lon: number;
  alt_ft: number | null;
  alt_geom_ft: number | null;
  alt_baro_ft: number | null;
  on_ground: boolean;
  gs_kt: number | null;
  track_deg: number | null;
  baro_rate_fpm: number | null;
  geom_rate_fpm: number | null;
  squawk: string | null;
  emergency: string | null;
  military: boolean;
  ladd: boolean;
  pia: boolean;
  seen_pos_s: number | null;
  rssi: number | null;
}

/* ---- adsbdb enrichment (GET /api/enrich) ----
 * Every field is nullable on purpose. null means adsbdb does not know, and the dossier
 * renders an em-dash. `errors` non-empty means we could not ask at all, which the panel
 * says out loud rather than passing off as "unknown".
 */
export interface EnrichAirport {
  iata: string | null;
  icao: string | null;
  name: string | null;
  municipality: string | null;
  lat: number | null;
  lon: number | null;
}

export interface Enrichment {
  hex: string | null;
  callsign: string | null;
  aircraft: {
    registration: string | null;
    type: string | null;
    icao_type: string | null;
    manufacturer: string | null;
    operator: string | null;
    operator_country: string | null;
  } | null;
  route: {
    callsign: string | null;
    airline: string | null;
    origin: EnrichAirport | null;
    destination: EnrichAirport | null;
  } | null;
  errors: string[];
}

/**
 * Highest altitude and ground speed we have actually OBSERVED for a contact.
 *
 * This is not the airframe's service ceiling or Vne - we have no source for those, and
 * presenting an observed peak as a capability would be inventing data. It is only "the
 * fastest/highest we have seen it since it came into range", and the panel says so.
 *
 * Peaks are dropped when a contact leaves the feed, so the window never outlives the
 * evidence behind it.
 */
export interface Peak {
  altFt: number | null;
  gsKt: number | null;
  sinceWall: number;
}

function maxOf(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  return Math.max(a, b);
}

function nextPeaks(prev: Record<string, Peak>, list: Aircraft[]): Record<string, Peak> {
  const now = Date.now();
  const next: Record<string, Peak> = {};
  for (const a of list) {
    if (!a.hex) continue;
    const p = prev[a.hex];
    next[a.hex] = {
      altFt: maxOf(p?.altFt, a.alt_ft),
      gsKt: maxOf(p?.gsKt, a.gs_kt),
      sinceWall: p?.sinceWall ?? now,
    };
  }
  return next;
}

/* ---- planespotters photo (GET /api/photo) ----
 * Metadata only. `src` is loaded by the browser straight from their CDN and is never
 * proxied, cached or rewritten by us (D-009). `photographer` and `link` are not optional
 * decoration - the credit is a condition of use.
 */
export interface Photo {
  src: string;
  width: number | null;
  height: number | null;
  link: string;
  photographer: string | null;
}

export interface PhotoResult {
  hex: string | null;
  registration: string | null;
  photo: Photo | null;
  /** "registration" or "hex" - which key actually matched. */
  matched_on: string | null;
  errors: string[];
}

/* ---- track ring buffer (GET /api/track, D-016) ----
 * `span_s` is what these points ACTUALLY cover, which is not the same as `buffer_window_s`.
 * `truncated` means older points existed and were discarded. Both must reach the UI: the
 * track may never imply more history than the buffer holds.
 */
export interface TrackPoint {
  ts: number;
  lat: number;
  lon: number;
  alt_ft: number | null;
}

export interface TrackResult {
  hex: string;
  count: number;
  first_ts: number | null;
  last_ts: number | null;
  span_s: number;
  buffer_window_s: number;
  sample_s: number;
  truncated: boolean;
  points: TrackPoint[];
}

export interface FeedStatus {
  name: string;
  ok: boolean;
  last_error: string | null;
  consecutive_failures: number;
}

/**
 * Display filter. Both are honest narrowing of what is DRAWN, never of what is counted -
 * the status bar keeps reporting the true totals so a filter can never hide traffic silently.
 */
export interface Filter {
  operator: string | null;   // matches the TrafficPanel grouping key
  militaryOnly: boolean;
}

interface State {
  aircraft: Aircraft[];
  source: string | null;
  degraded: boolean;
  errors: string[];
  lastFetchWall: number | null;   // Date.now() of the last successful fetch
  lastFetchOk: boolean;
  feeds: FeedStatus[];
  peaks: Record<string, Peak>;   // by hex, observed only

  /** The home actually in force: the override if there is one, else the server's (D-068). */
  home: HomePos;
  /** What `/api/config` said. Kept so "reset to configured" is possible. Not persisted. */
  serverHome: HomePos;
  /** Per-browser override. PERSISTED — this is the one thing a remote viewer can set. */
  homeOverride: HomePos | null;
  cursor: { lat: number; lon: number } | null;
  depthM: number | null;
  depthPending: boolean;

  selectedHex: string | null;
  selectedPlace: PlaceInfo | null;
  /**
   * A one-shot request for the globe to fly to a contact, consumed and cleared by Globe (D-076).
   * Not persisted: it is a transient instruction, not a preference.
   */
  flyToHex: string | null;
  /**
   * Vertical exaggeration for GEOMETRY ONLY (D-075). 1 is true scale.
   *
   * Deliberately NOT persisted, unlike the layer toggles. A distorted globe restored silently on
   * a later visit is exactly the plausible-looking untruth ground rule 1 guards against, so every
   * fresh load starts true and the operator opts in again. The on-screen banner covers the
   * within-session case.
   */
  vertScale: number;
  /**
   * The contact the camera is locked to, or null (D-076 Stage 3).
   *
   * Not persisted and not implied by selection: selecting a contact to read it is the common
   * case and moving the camera every time would fight the operator. Following is a deliberate,
   * announced mode with its own control.
   */
  followHex: string | null;
  filter: Filter;
  // Carries its own hex so a late reply for a deselected contact can be discarded rather
  // than shown against whatever is selected now.
  enrichment: Enrichment | null;
  enrichPending: boolean;
  photo: PhotoResult | null;
  photoPending: boolean;
  track: TrackResult | null;
  trackPending: boolean;
  showDatum: boolean;
  /** Forward projection envelope - the primary instrument since D-047. */
  showProjection: boolean;
  /** How far ahead the envelope reaches, in minutes. */
  projMinutes: number;
  /** Half-width of the envelope in degrees either side of present track. */
  projSpreadDeg: number;
  showDropLines: boolean;
  showPlaces: boolean;
  showRadar: boolean;
  /** Active theme (D-066). Applied as a data-theme attribute on <html>. */
  theme: ThemeName;
  /** State/province lines, worldwide (D-063). ON by default - coarse, cheap, and the reference
   *  that makes "where is that contact" answerable without hunting. */
  showStates: boolean;
  /**
   * US county lines (D-063). OFF by default: 3,619 rings is dense enough to read as texture
   * rather than information at anything but close zoom, and Natural Earth publishes no admin_2
   * layer outside the United States, so the layer is silent everywhere else by nature.
   */
  showCounties: boolean;
  /** Dashed line to the FILED destination, when adsbdb gives us coordinates (D-050). */
  showDestination: boolean;
  /**
   * Small-airport tier (D-052). OFF by default and deliberately so: it is ~42,700 extra
   * markers, and its data is a separate 3.5 MB file fetched only when this first turns true.
   */
  showSmallAirports: boolean;
  /**
   * Label every contact, not just selected/co-altitude/military (D-060). OFF by default: with
   * it on, ~100+ labels can be on screen at once, which is exactly the clutter the default
   * behaviour (label only what matters) was chosen to avoid. See aircraftLayer.ts's
   * `labelDecision()` for how this combines with the other three label triggers, and why a
   * label added ONLY because of this toggle gets a subordinate colour rather than the
   * amber/selected treatment those triggers earn.
   */
  showAllLabels: boolean;
  /**
   * How far out place markers stay drawn, as a multiplier on each row's built-in range.
   * 1 = the tuned default; higher pulls more of the shipped set into view (D-049).
   */
  placeDensity: number;
  /**
   * How far from home to ask for traffic, in nautical miles.
   *
   * This is a FETCH radius, not a display one: it changes what the upstream feed is asked for,
   * so raising it costs bandwidth and upstream courtesy, not just frame time. The backend clamps
   * it to LORAN_ADSB_MAX_RADIUS_NM (250 by default) because that is airplanes.live's own /point
   * ceiling - asking for more does not return more, so the UI does not offer more.
   */
  radiusNm: number;
  datumRadiusNm: number;
  separationFt: number;
  /** Camera pitch in degrees, -90 = straight down. Drives slice suppression (D-034). */
  cameraPitchDeg: number;

  fps: number;
  /** The API answered 401: a token is needed. Deliberately NOT persisted (D-041). */
  authRequired: boolean;

  setAircraft: (a: Aircraft[], source: string | null, degraded: boolean, errors: string[]) => void;
  setFetchFailed: (errors: string[]) => void;
  setFeeds: (f: FeedStatus[]) => void;
  setHome: (h: HomePos) => void;
  /** Set or clear the per-browser override. Pass null to fall back to the configured home. */
  setHomeOverride: (h: { lat: number; lon: number; label?: string } | null) => void;
  setTheme: (t: ThemeName) => void;
  setCursor: (c: { lat: number; lon: number } | null) => void;
  setDepth: (m: number | null, pending: boolean) => void;
  select: (hex: string | null) => void;
  selectPlace: (p: PlaceInfo | null) => void;
  /**
   * Ask the globe to fly to a contact ONCE, then forget. Set by the glance list when a row is
   * tapped (D-076); Globe consumes it and clears it.
   *
   * Deliberately NOT folded into `select`. On the desktop the operator clicks contacts to read
   * them and expects the camera to hold still - moving it on every click would fight them.
   * Arriving from the list is the opposite case: the map opens on a contact that is very likely
   * off-screen, and not flying to it would present an empty globe.
   */
  requestFlyTo: (hex: string | null) => void;
  /** Set the vertical exaggeration. Geometry only; every readout stays true (D-075). */
  setVertScale: (x: number) => void;
  /** Lock the camera to a contact, or pass null to release it. */
  setFollow: (hex: string | null) => void;
  setEnrichment: (e: Enrichment | null, pending: boolean) => void;
  setPhoto: (p: PhotoResult | null, pending: boolean) => void;
  setTrack: (t: TrackResult | null, pending: boolean) => void;
  toggle: (k: "showDatum" | "showDropLines" | "showPlaces" | "showRadar"
    | "showProjection" | "showDestination" | "showSmallAirports" | "showAllLabels"
    | "showStates" | "showCounties") => void;
  setProjection: (p: { minutes?: number; spreadDeg?: number }) => void;
  setPlaceDensity: (mult: number) => void;
  setRadiusNm: (nm: number) => void;
  setFilter: (f: Partial<Filter>) => void;
  setFps: (n: number) => void;
  setCameraPitch: (deg: number) => void;
  setAuthRequired: (b: boolean) => void;
}

/*
 * Preferences persist to localStorage, per browser (D-041).
 *
 * Only the knobs a person SETS are saved. Live data is deliberately excluded: restoring a
 * cached aircraft list, a stale selection or an old feed status on load would put positions on
 * screen that nothing has confirmed since — ground rule 1, in the one place it would be
 * easiest to break by accident. Everything persisted here is inert UI state.
 *
 * Per browser and not per account on purpose: it is sticky for whoever uses that browser,
 * needs no schema, and does not turn a single-user console into an account system.
 */
/*
 * Fetch-radius limits, in nautical miles.
 *
 * MAX mirrors the backend's LORAN_ADSB_MAX_RADIUS_NM default, which in turn mirrors
 * airplanes.live's own /point ceiling (backend/app/feeds/adsb.py clamps to it). Asking for more
 * does not return more, so the UI does not offer more - an option that silently does nothing is
 * worse than no option. If a deployment lowers the backend limit, the backend clamp still wins;
 * this constant only shapes what the buttons offer.
 *
 * Presets rather than a slider because the useful question is "which of these can my machine
 * draw?", and discrete steps make that answerable by trying four things while watching the FPS
 * readout in the status bar.
 */
export const MAX_RADIUS_NM = 250;
export const RANGE_PRESETS_NM = [60, 120, 180, 250] as const;

/**
 * Named (rather than inline in the `persist` options below) so it can be unit-tested directly.
 * zustand's persist middleware builds its localStorage adapter eagerly at store-creation time,
 * and this project's tests run under vitest's `node` environment - deliberately, see
 * vitest.config.ts - which has no `window`, so the adapter never attaches and there is no
 * `useStore.persist` to call through at test time. Calling this function directly is the exact
 * code persist runs, not a stand-in for it, so nothing is lost by testing it this way.
 *
 * Bumped for D-047, then D-055, then D-060. Without a migration step, a browser that already
 * persisted prefs simply has no `radiusNm` key at all - it would come back `undefined` rather
 * than the default, not silently inherit it. Steps chain (each `if` builds on what the one
 * before it produced), so a v1 payload still picks up the v2 fields on its way through, then
 * the v3 field, then the v4 field - it does not jump straight from 1 to 4 missing a step.
 */
/**
 * The shipped themes (D-066). `midnight` is the default `:root` block in tokens.css and is
 * applied by REMOVING the data-theme attribute, not by setting it - so a browser that has never
 * touched this control renders exactly what it always did.
 *
 * There is no light theme on purpose. D-029 encodes altitude as an HSL ramp at lightness 52-68,
 * which needs a background darker than the ramp; a genuinely light background would flatten the
 * most information-dense thing on the display. "Mid-tone" is as far as this goes, which is what
 * the owner asked for.
 */
export const THEMES = [
  { name: "midnight", label: "Midnight", kind: "dark" },
  { name: "carbon", label: "Carbon", kind: "dark" },
  { name: "slate", label: "Slate", kind: "mid" },
  { name: "ember", label: "Ember", kind: "mid" },
] as const;

export type ThemeName = (typeof THEMES)[number]["name"];

export const DEFAULT_THEME: ThemeName = "midnight";

/** True for a name this build actually ships, so a hand-edited localStorage cannot theme-404. */
export function isThemeName(v: unknown): v is ThemeName {
  return typeof v === "string" && THEMES.some((t) => t.name === v);
}

export function migratePrefs(persisted: unknown, from: number): Record<string, unknown> {
  let p = (persisted ?? {}) as Record<string, unknown>;
  if (from < 2) {
    p = { ...p, showDatum: false, showProjection: true, projMinutes: 5, projSpreadDeg: 10 };
  }
  if (from < 3) {
    p = { ...p, radiusNm: 120 };
  }
  if (from < 4) {
    p = { ...p, showAllLabels: false };
  }
  if (from < 7) {
    // No override for a browser that predates the control - which means it keeps using the
    // server's configured home, exactly as it did before (D-068).
    p = { ...p, homeOverride: null };
  }
  if (from < 6) {
    // Themes arrived AFTER the boundary toggles, so v6 not v5 - the earlier handoff had
    // reserved v5 for this and D-063 got there first.
    p = { ...p, theme: DEFAULT_THEME };
  }
  if (from < 5) {
    // States ON, counties OFF - the shipped defaults (D-063). A browser that persisted prefs
    // before boundaries existed has neither key, so both would come back `undefined` and the
    // state toggle would render as off while the layer had never been asked for either way.
    p = { ...p, showStates: true, showCounties: false };
  }
  return p;
}

export const useStore = create<State>()(persist((set) => ({
  aircraft: [],
  source: null,
  degraded: false,
  errors: [],
  lastFetchWall: null,
  lastFetchOk: true,
  feeds: [],
  peaks: {},

  // Placeholder only, for the moment before /api/config lands. Overwritten on every load.
  home: { lat: 30.6944, lon: -88.0399, label: "MOBILE, AL" },
  serverHome: { lat: 30.6944, lon: -88.0399, label: "MOBILE, AL" },
  homeOverride: null,
  cursor: null,
  depthM: null,
  depthPending: false,

  selectedHex: null,
  selectedPlace: null,
  flyToHex: null,
  vertScale: 1,
  followHex: null,
  filter: { operator: null, militaryOnly: false },
  enrichment: null,
  enrichPending: false,
  photo: null,
  photoPending: false,
  track: null,
  trackPending: false,
  // The ALTITUDE SLICE is off by default from D-047 onward. It stays in the codebase - it is
  // the right instrument for "who else is at this level" - but that was not a question the
  // owner had, and a large amber square occluding the ground is a real cost to pay for it.
  showDatum: false,
  showProjection: true,
  projMinutes: 5,
  // Deliberately narrow. A wide default would look like a confident forecast; this is an
  // assumption the operator widens on purpose.
  projSpreadDeg: 10,
  showDropLines: true,
  showPlaces: true,
  // Weather radar is OFF by default and stays that way (D-040): its colour ramp collides with
  // the altitude ramp, so it is a question you ask, not part of the resting display.
  showRadar: false,
  theme: DEFAULT_THEME,
  // Boundaries (D-063). States ON: 858 rings, coarse, and the reference that makes "which
  // state is that contact over" answerable at a glance. Counties OFF: 3,619 rings reads as
  // texture rather than information until the camera is close, and it is US-only.
  showStates: true,
  showCounties: false,
  showDestination: true,
  showSmallAirports: false,
  // OFF by default (D-060): selected/co-altitude/military are already labelled unconditionally,
  // and labelling every contact on top of that is a deliberate ask, not the resting display.
  showAllLabels: false,
  placeDensity: 1,
  // The Phase 1 value, kept as the default so nobody's resting view changes underneath them.
  radiusNm: 120,
  // Matches the opening camera in Globe.tsx, so the slice is not briefly suppressed on load.
  cameraPitchDeg: -32,
  datumRadiusNm: 50,
  separationFt: 1000,

  fps: 0,
  authRequired: false,

  setAircraft: (aircraft, source, degraded, errors) =>
    set((s) => ({
      aircraft, source, degraded, errors,
      lastFetchWall: Date.now(), lastFetchOk: true,
      peaks: nextPeaks(s.peaks, aircraft),
    })),
  // A failed poll does NOT clear the aircraft list, but it does flip lastFetchOk so the
  // status bar can say so. Positions keep ageing out on their own; we never present a
  // stale frame as if it were current.
  setFetchFailed: (errors) => set({ lastFetchOk: false, errors }),
  setFeeds: (feeds) => set({ feeds }),
  // The server's value never wins over an explicit override - otherwise a remote viewer's
  // chosen home would be silently reset by the next config fetch.
  setHome: (serverHome) => set((st) => ({
    serverHome, home: effectiveHome(serverHome, st.homeOverride),
  })),
  setHomeOverride: (pos) => set((st) => {
    // `label` is supplied ONLY by a geocoded pick, which is a position this app looked up
    // (D-069). Typed and geolocated positions omit it and get coordinates, which is D-068's
    // rule and still the default here - the fallback is what keeps an un-looked-up position
    // from ever acquiring a name.
    const override = pos
      ? { ...pos, label: pos.label?.trim() || coordLabel(pos.lat, pos.lon) }
      : null;
    // Guarded, because this value reaches the camera and the fetch radius.
    const safe = override && isHomePos(override) ? override : null;
    return { homeOverride: safe, home: effectiveHome(st.serverHome, safe) };
  }),
  // Guarded rather than trusted: a persisted payload from a build that shipped a theme this one
  // does not would otherwise style the display with a data-theme that has no matching block.
  setTheme: (theme) => set({ theme: isThemeName(theme) ? theme : DEFAULT_THEME }),
  setCursor: (cursor) => set({ cursor }),
  setDepth: (depthM, depthPending) => set({ depthM, depthPending }),
  // Changing selection drops the old dossier immediately. Showing one contact's
  // registration under another's callsign would be worse than showing nothing.
  select: (selectedHex) => set({
    selectedHex,
    // Releasing on selection change: a camera still chasing the PREVIOUS contact, while the
    // dossier describes a new one, reads as the globe having a mind of its own.
    followHex: null,
    // An aircraft and an airfield are never both selected: the right column is height-bounded
    // and two stacked dossiers would push one off screen.
    selectedPlace: null,
    enrichment: null, enrichPending: false,
    photo: null, photoPending: false,
    track: null, trackPending: false,
  }),
  selectPlace: (selectedPlace) => set({ selectedPlace, selectedHex: null }),
  requestFlyTo: (flyToHex) => set({ flyToHex }),
  setVertScale: (vertScale) => set({ vertScale: Math.max(1, vertScale) }),
  setFollow: (followHex) => set({ followHex }),
  setEnrichment: (enrichment, enrichPending) => set({ enrichment, enrichPending }),
  setPhoto: (photo, photoPending) => set({ photo, photoPending }),
  setTrack: (track, trackPending) => set({ track, trackPending }),
  toggle: (k) => set((s) => ({ [k]: !s[k] }) as Pick<State, typeof k>),
  setFilter: (f) => set((s) => ({ filter: { ...s.filter, ...f } })),
  setFps: (fps) => set({ fps }),
  setCameraPitch: (cameraPitchDeg) => set({ cameraPitchDeg }),
  setAuthRequired: (authRequired) => set({ authRequired }),
  setProjection: ({ minutes, spreadDeg }) => set((st) => ({
    projMinutes: minutes ?? st.projMinutes,
    projSpreadDeg: spreadDeg ?? st.projSpreadDeg,
  })),
  setPlaceDensity: (placeDensity) => set({ placeDensity }),
  // Clamped here as well as in the backend. The backend clamp is the one that protects the
  // upstream feed; this one keeps a corrupt or hand-edited localStorage value from putting the
  // UI into a state none of its buttons can represent.
  setRadiusNm: (nm) => set({ radiusNm: Math.max(10, Math.min(nm, MAX_RADIUS_NM)) }),
}), {
  name: "loran.prefs",
  version: 7,
  migrate: migratePrefs,
  /**
   * `home` is derived, not persisted, so it has to be recomputed once the override comes back
   * off disk (D-068). Without this the override would rehydrate into the store and change
   * nothing - the camera and the fetch both read `home`, and it would still hold the
   * placeholder until the next `/api/config` reply happened to recompute it.
   *
   * `isHomePos` guards the value on the way in: this is JSON from localStorage, which a user
   * can hand-edit and a downgrade can leave malformed, and it reaches the camera.
   */
  merge: (persisted, current) => {
    const merged = { ...current, ...(persisted as object) } as typeof current;
    const override = isHomePos(merged.homeOverride) ? merged.homeOverride : null;
    return { ...merged, homeOverride: override, home: effectiveHome(merged.serverHome, override) };
  },
  // The allow-list IS the safety property. Anything not named here is never written to disk,
  // so no amount of future state can accidentally start persisting live positions.
  partialize: (s) => ({
    showDatum: s.showDatum,
    showProjection: s.showProjection,
    projMinutes: s.projMinutes,
    projSpreadDeg: s.projSpreadDeg,
    showDropLines: s.showDropLines,
    showPlaces: s.showPlaces,
    showRadar: s.showRadar,
    theme: s.theme,
    // The ONE piece of location data this app persists, and only because the user typed or
    // granted it. `home` and `serverHome` are deliberately absent: they come from the server
    // every load, and persisting them would let a stale copy outlive a config change.
    homeOverride: s.homeOverride,
    showStates: s.showStates,
    showCounties: s.showCounties,
    showDestination: s.showDestination,
    showSmallAirports: s.showSmallAirports,
    showAllLabels: s.showAllLabels,
    placeDensity: s.placeDensity,
    radiusNm: s.radiusNm,
    datumRadiusNm: s.datumRadiusNm,
    separationFt: s.separationFt,
    filter: s.filter,
  }),
}));

/* ---- shared helpers ---- */

/** Grouping key. The traffic panel and the filter MUST agree, so both call this. */
export function operatorKey(a: Aircraft): string {
  return a.military ? "MILITARY" : (a.operator ?? "UNKNOWN");
}

export function matchesFilter(a: Aircraft, f: Filter): boolean {
  if (f.militaryOnly && !a.military) return false;
  if (f.operator && operatorKey(a) !== f.operator) return false;
  return true;
}

/**
 * A clickable airfield, straight out of the build-time place data (D-038).
 *
 * Every field is verbatim from OurAirports; empty means the source is empty and the panel
 * renders an em-dash. `military` is the D-033 NAME heuristic, not an authoritative flag, and
 * the panel says so — a magenta marker must not imply an order of battle we do not have.
 */
export interface PlaceInfo {
  ident: string;
  name: string;
  municipality: string;
  region: string;
  country: string;
  elevationFt: number | null;
  iata: string;
  military: boolean;
  large: boolean;
  lat: number;
  lon: number;
}

/*
 * The ALTITUDE SLICE only means something under a PERSPECTIVE camera angle.
 *
 * Seen from directly overhead it projects to a flat sheet covering the display: it conveys no
 * height at all and occludes the traffic and terrain underneath it. Seen edge-on from the
 * horizon it degenerates into a bright band smeared across the scene. Either way it costs
 * visibility and returns nothing, which is why it is suppressed rather than drawn (D-034).
 *
 * Bounds are set against the camera presets in CameraCluster: PLAN VIEW is -89.9 deg and
 * HORIZON VIEW is -9 deg, both suppressed; the default perspective view is -32 deg, kept.
 */
export const SLICE_PITCH_MIN = -70;
export const SLICE_PITCH_MAX = -12;

export function hasSlicePerspective(pitchDeg: number): boolean {
  return pitchDeg > SLICE_PITCH_MIN && pitchDeg < SLICE_PITCH_MAX;
}

export const FT_TO_M = 0.3048;
export const NM_TO_M = 1852;

/**
 * The exaggeration ladder (D-075). `1` is true scale and is the default.
 *
 * At the default view a 250 nm radius is ~463 km across while 40,000 ft is 12.2 km - about 1:38 -
 * so two contacts 2,000 ft apart occupy 0.13% of the frame and read as coplanar. Multiplying the
 * vertical makes the layering visible at the cost of the geometry being literally true, which is
 * why it is opt-in and announced on screen while it is on.
 */
export const VERT_SCALES = [1, 5, 10] as const;

/**
 * THE ONE PLACE feet become a drawable height. Every altitude-positioned thing on the globe goes
 * through here - aircraft, drop lines, the datum slice, the projection cone, the filed route legs
 * and the track path - so they cannot drift apart when the scale changes.
 *
 * That "cannot drift" is the whole point, and it is not hypothetical: D-071 cost five real
 * divergences because one value was computed in two places. If exaggeration were applied
 * per-module, the first missed site would leave an aircraft floating off its own drop line.
 *
 * DISPLAY VALUES MUST NOT USE THIS. Anything converting metres back to feet for a readout keeps
 * the true `FT_TO_M`, or the instrument reports an altitude the aircraft is not at - which is the
 * exact failure ground rule 1 exists to prevent. See the note on `endAltFt` in projectionCone.
 */
export function altToMetres(ft: number, scale = 1): number {
  return ft * FT_TO_M * scale;
}

export function altOf(a: Aircraft): number | null {
  return a.alt_ft;
}

/**
 * Dead reckoning between polls.
 *
 * Honest limits: we extrapolate from the reported fix using reported ground speed and track,
 * and we refuse to extrapolate more than MAX_DR_S beyond the fix. Past that the contact is
 * stale and the UI dims it rather than inventing a smooth path it has no evidence for.
 */
export const MAX_DR_S = 30;

export function reckon(a: Aircraft, elapsedS: number): { lat: number; lon: number; stale: boolean } {
  const age = (a.seen_pos_s ?? 0) + Math.max(0, elapsedS);
  const stale = age > MAX_DR_S;
  const t = Math.min(age, MAX_DR_S);
  if (!a.gs_kt || a.track_deg === null || a.on_ground) return { lat: a.lat, lon: a.lon, stale };

  const distNm = (a.gs_kt * t) / 3600;
  const brg = (a.track_deg * Math.PI) / 180;
  const dLat = (distNm * Math.cos(brg)) / 60;
  const cosLat = Math.cos((a.lat * Math.PI) / 180) || 1e-6;
  const dLon = (distNm * Math.sin(brg)) / (60 * cosLat);
  return { lat: a.lat + dLat, lon: a.lon + dLon, stale };
}

/** Great-circle distance in nautical miles. */
export function distanceNm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 3440.065;
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dp = ((bLat - aLat) * Math.PI) / 180;
  const dl = ((bLon - aLon) * Math.PI) / 180;
  const h =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
