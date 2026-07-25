import { create } from "zustand";

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

/** Default bands from the spec. Configurable - see docs/design-altitude.md. */
export interface Band {
  label: string;
  floorFt: number;
  ceilFt: number;
}

export const DEFAULT_BANDS: Band[] = [
  { label: "0–18,000 FT", floorFt: 0, ceilFt: 18000 },
  { label: "18,000–29,000 FT", floorFt: 18000, ceilFt: 29000 },
];

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
  // Carries its own hex so a late reply for a deselected contact can be discarded rather
  // than shown against whatever is selected now.
  enrichment: Enrichment | null;
  enrichPending: boolean;
  photo: PhotoResult | null;
  photoPending: boolean;
  track: TrackResult | null;
  trackPending: boolean;
  showBands: boolean;
  showDatum: boolean;
  showDropLines: boolean;
  datumRadiusNm: number;
  separationFt: number;
  bands: Band[];

  fps: number;

  setAircraft: (a: Aircraft[], source: string | null, degraded: boolean, errors: string[]) => void;
  setFetchFailed: (errors: string[]) => void;
  setFeeds: (f: FeedStatus[]) => void;
  setHome: (h: { lat: number; lon: number; label: string }) => void;
  setCursor: (c: { lat: number; lon: number } | null) => void;
  setDepth: (m: number | null, pending: boolean) => void;
  select: (hex: string | null) => void;
  setEnrichment: (e: Enrichment | null, pending: boolean) => void;
  setPhoto: (p: PhotoResult | null, pending: boolean) => void;
  setTrack: (t: TrackResult | null, pending: boolean) => void;
  toggle: (k: "showBands" | "showDatum" | "showDropLines") => void;
  setFps: (n: number) => void;
}

export const useStore = create<State>((set) => ({
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
  enrichment: null,
  enrichPending: false,
  photo: null,
  photoPending: false,
  track: null,
  trackPending: false,
  showBands: true,
  showDatum: true,
  showDropLines: true,
  datumRadiusNm: 50,
  separationFt: 1000,
  bands: DEFAULT_BANDS,

  fps: 0,

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
    enrichment: null, enrichPending: false,
    photo: null, photoPending: false,
    track: null, trackPending: false,
  }),
  setEnrichment: (enrichment, enrichPending) => set({ enrichment, enrichPending }),
  setPhoto: (photo, photoPending) => set({ photo, photoPending }),
  setTrack: (track, trackPending) => set({ track, trackPending }),
  toggle: (k) => set((s) => ({ [k]: !s[k] }) as Pick<State, typeof k>),
  setFps: (fps) => set({ fps }),
}));

/* ---- shared helpers ---- */

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
