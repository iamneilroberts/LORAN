/*
 * The one place that decides WHERE the app's data comes from.
 *
 *   normal build  (npm run build)         -> this app's own backend on /api/*
 *   single file   (npm run build:single)  -> the upstream feeds, browser-direct (D-070)
 *
 * `SINGLE_FILE` is a compile-time constant, so the branch not taken is dropped by the bundler:
 * the normal build never ships src/data/upstream.ts, and the single-file build never ships the
 * /api/* fetches. Every call site in the app goes through here rather than calling fetch itself,
 * which is what keeps this from becoming a second copy of the app.
 */
import type {
  Enrichment, FeedStatus, PhotoResult, TrackResult, VesselDetail, VesselsPayload,
  VesselTrackResult,
} from "./state/store";
import type { AircraftPayload } from "./data/upstream";

/** Injected by vite.config.ts (false) and vite.config.single.ts (true). */
declare const SINGLE_FILE: boolean;

export const isSingleFile = SINGLE_FILE;

export interface HomeConfig {
  lat: number;
  lon: number;
  label: string;
}

/**
 * Photos are GONE from the single-file build, and the dossier says so rather than showing
 * an empty frame.
 *
 * planespotters gate their API on a User-Agent carrying a contact address (they return 403
 * without one). `User-Agent` is a forbidden header in the fetch spec, so browser script cannot
 * set it - there is no workaround that does not involve a server. And their clause 8 forbids
 * downloading, storing, re-hosting or rewriting the image binaries, so embedding photos in the
 * file was never an option either (D-009). The owner accepted losing photos for this build.
 */
const PHOTO_UNAVAILABLE =
  "Photos need a server: planespotters gate on a User-Agent that a browser cannot set";

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

/** Aircraft poll result. `authRequired` only ever happens against a token-gated backend. */
export interface AircraftResult {
  authRequired: boolean;
  payload: AircraftPayload | null;
}

export interface VesselsResult {
  authRequired: boolean;
  payload: VesselsPayload | null;
}

/**
 * Vessels are GONE from the single-file build, stated rather than silently empty (D-078).
 * The AIS source is a position-api instance on the owner's own network; the browser cannot
 * reach it cross-origin, and there is nothing honest to substitute.
 */
const VESSELS_UNAVAILABLE =
  "Sea traffic needs the server - the single-file build has no position-api proxy";

export const api = {
  /** Trade a `?t=` link token for a session cookie. No door to open without a backend. */
  async claimSession(token: string): Promise<void> {
    if (SINGLE_FILE) return;
    await fetch(`/api/session?t=${encodeURIComponent(token)}`);
  },

  /**
   * Where the console is centred. The backend owns this normally; with no backend the file
   * reads `?lat=&lon=&label=` off its own URL so it is still location-aware rather than
   * hardcoded to one city (CLAUDE.md, D-019). Absent that, the store default stands.
   */
  async config(): Promise<{ home?: HomeConfig }> {
    if (SINGLE_FILE) {
      const q = new URLSearchParams(window.location.search);
      const lat = Number(q.get("lat"));
      const lon = Number(q.get("lon"));
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !q.get("lat") || !q.get("lon")) return {};
      return { home: { lat, lon, label: (q.get("label") ?? "CUSTOM").toUpperCase() } };
    }
    return getJson<{ home?: HomeConfig }>("/api/config");
  },

  async aircraft(lat: number, lon: number, radiusNm: number): Promise<AircraftResult> {
    if (SINGLE_FILE) {
      const { fetchAircraft } = await import("./data/upstream");
      return { authRequired: false, payload: await fetchAircraft(lat, lon, radiusNm) };
    }
    const r = await fetch(`/api/aircraft?lat=${lat}&lon=${lon}&radius=${radiusNm}`);
    // 401 is not a feed failure and must not be reported as one.
    if (r.status === 401) return { authRequired: true, payload: null };
    if (!r.ok) throw new Error(String(r.status));
    return { authRequired: false, payload: (await r.json()) as AircraftPayload };
  },

  async vessels(lat: number, lon: number): Promise<VesselsResult> {
    if (SINGLE_FILE) {
      return {
        authRequired: false,
        payload: { configured: false, source: null, count: 0, vessels: [],
                   errors: [VESSELS_UNAVAILABLE] },
      };
    }
    const r = await fetch(`/api/vessels?lat=${lat}&lon=${lon}`);
    if (r.status === 401) return { authRequired: true, payload: null };
    if (!r.ok) throw new Error(String(r.status));
    return { authRequired: false, payload: (await r.json()) as VesselsPayload };
  },

  async vesselDetail(mmsi: string): Promise<VesselDetail> {
    if (SINGLE_FILE) {
      return { mmsi, lat: null, lon: null, course_deg: null, course_source: null,
               speed_kt: null, pos_ts: null, errors: [VESSELS_UNAVAILABLE] };
    }
    return getJson<VesselDetail>(`/api/vessel?mmsi=${encodeURIComponent(mmsi)}`);
  },

  async vesselTrack(key: string): Promise<VesselTrackResult> {
    if (SINGLE_FILE) {
      return { key, count: 0, first_ts: null, last_ts: null, span_s: 0,
               buffer_window_s: 0, sample_s: 0, truncated: false, points: [] };
    }
    return getJson<VesselTrackResult>(`/api/vessel-track?key=${encodeURIComponent(key)}`);
  },

  async feeds(): Promise<FeedStatus[]> {
    if (SINGLE_FILE) {
      const { feedStatus } = await import("./data/upstream");
      return feedStatus();
    }
    const d = await getJson<{ feeds?: { adsb?: FeedStatus[] } }>("/api/health");
    return d?.feeds?.adsb ?? [];
  },

  async enrich(hex: string, callsign: string | null): Promise<Enrichment> {
    if (SINGLE_FILE) {
      const { enrich } = await import("./data/upstream");
      return enrich(hex, callsign);
    }
    const q = new URLSearchParams({ hex: hex.toUpperCase() });
    if (callsign) q.set("callsign", callsign.toUpperCase());
    return getJson<Enrichment>(`/api/enrich?${q.toString()}`);
  },

  async track(hex: string): Promise<TrackResult> {
    if (SINGLE_FILE) {
      const { getTrack } = await import("./data/upstream");
      return getTrack(hex);
    }
    return getJson<TrackResult>(`/api/track?hex=${hex.toUpperCase()}`);
  },

  async photo(hex: string, registration: string | null): Promise<PhotoResult> {
    if (SINGLE_FILE) {
      // Stated, not silently empty. `errors` is what makes the panel say we could not ask,
      // as opposed to "planespotters has no photo of this airframe".
      return {
        hex: hex.toUpperCase(),
        registration: registration ? registration.toUpperCase() : null,
        photo: null,
        matched_on: null,
        errors: [PHOTO_UNAVAILABLE],
      };
    }
    const q = new URLSearchParams({ hex: hex.toUpperCase() });
    if (registration) q.set("reg", registration.toUpperCase());
    return getJson<PhotoResult>(`/api/photo?${q.toString()}`);
  },

  async depth(lat: number, lon: number): Promise<number | null> {
    if (SINGLE_FILE) {
      const { depth } = await import("./data/upstream");
      return depth(lat, lon);
    }
    const d = await getJson<{ elevation_m?: number | null }>(
      `/api/depth?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`,
    );
    return d.elevation_m ?? null;
  },
};
