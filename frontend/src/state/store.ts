import { create } from "zustand";
import { persist } from "zustand/middleware";

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

  home: { lat: number; lon: number; label: string };
  cursor: { lat: number; lon: number } | null;
  depthM: number | null;
  depthPending: boolean;

  selectedHex: string | null;
  selectedPlace: PlaceInfo | null;
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
  /** Dashed line to the FILED destination, when adsbdb gives us coordinates (D-050). */
  showDestination: boolean;
  /**
   * How far out place markers stay drawn, as a multiplier on each row's built-in range.
   * 1 = the tuned default; higher pulls more of the shipped set into view (D-049).
   */
  placeDensity: number;
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
  setHome: (h: { lat: number; lon: number; label: string }) => void;
  setCursor: (c: { lat: number; lon: number } | null) => void;
  setDepth: (m: number | null, pending: boolean) => void;
  select: (hex: string | null) => void;
  selectPlace: (p: PlaceInfo | null) => void;
  setEnrichment: (e: Enrichment | null, pending: boolean) => void;
  setPhoto: (p: PhotoResult | null, pending: boolean) => void;
  setTrack: (t: TrackResult | null, pending: boolean) => void;
  toggle: (k: "showDatum" | "showDropLines" | "showPlaces" | "showRadar"
    | "showProjection" | "showDestination") => void;
  setProjection: (p: { minutes?: number; spreadDeg?: number }) => void;
  setPlaceDensity: (mult: number) => void;
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
export const useStore = create<State>()(persist((set) => ({
  aircraft: [],
  source: null,
  degraded: false,
  errors: [],
  lastFetchWall: null,
  lastFetchOk: true,
  feeds: [],
  peaks: {},

  home: { lat: 30.6944, lon: -88.0399, label: "MOBILE, AL" },
  cursor: null,
  depthM: null,
  depthPending: false,

  selectedHex: null,
  selectedPlace: null,
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
  showDestination: true,
  placeDensity: 1,
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
  setHome: (home) => set({ home }),
  setCursor: (cursor) => set({ cursor }),
  setDepth: (depthM, depthPending) => set({ depthM, depthPending }),
  // Changing selection drops the old dossier immediately. Showing one contact's
  // registration under another's callsign would be worse than showing nothing.
  select: (selectedHex) => set({
    selectedHex,
    // An aircraft and an airfield are never both selected: the right column is height-bounded
    // and two stacked dossiers would push one off screen.
    selectedPlace: null,
    enrichment: null, enrichPending: false,
    photo: null, photoPending: false,
    track: null, trackPending: false,
  }),
  selectPlace: (selectedPlace) => set({ selectedPlace, selectedHex: null }),
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
}), {
  name: "loran.prefs",
  // Bumped for D-047. Without the migration, a browser that already stored showDatum:true
  // would keep drawing the amber slice the owner asked to be rid of - a changed DEFAULT does
  // not reach anyone who has already persisted the old value.
  version: 2,
  migrate: (persisted, from) => {
    const p = (persisted ?? {}) as Record<string, unknown>;
    if (from < 2) {
      return { ...p, showDatum: false, showProjection: true, projMinutes: 5, projSpreadDeg: 10 };
    }
    return p;
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
    showDestination: s.showDestination,
    placeDensity: s.placeDensity,
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
