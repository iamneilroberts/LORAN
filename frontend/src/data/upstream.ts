/*
 * Browser-direct upstream clients. Used ONLY by the single-file build (D-070); the normal
 * server-backed build never imports any of this - see src/api.ts for the switch.
 *
 * This is the browser-side equivalent of backend/app/feeds/*.py. It exists because a page
 * opened from disk has no backend to proxy for it. The backend remains the reference
 * implementation: if the normalisation rules below and adsb.py ever disagree, adsb.py is right.
 *
 * WHAT THE BACKEND DID THAT THIS CANNOT
 *   - failover to adsb.lol / adsb.fi. Both were MEASURED to send no Access-Control-Allow-Origin
 *     header at all, so a browser cannot read them from any origin. airplanes.live is the only
 *     ADS-B feed reachable browser-direct, which means this build has no feed redundancy.
 *   - one shared upstream fetch across every open browser. Each page now polls for itself, so
 *     the 1 req/sec courtesy limit is enforced per page here (see `gate`).
 *   - the server-side track ring buffer. Rebuilt client-side from what this page has actually
 *     observed; it therefore starts empty when the page opens and says so.
 *   - planespotters photos. Impossible from a browser at all - see src/api.ts.
 */
import type { Aircraft, Enrichment, EnrichAirport, FeedStatus, TrackPoint, TrackResult } from "../state/store";

/* Same three sources the backend lists, but only the first is reachable from a browser. */
const AIRPLANES_LIVE = "https://api.airplanes.live/v2/point";
const ADSBDB = "https://api.adsbdb.com/v0";
const GEBCO_WMS = "https://wms.gebco.net/2024/mapserv";

/** airplanes.live documents 1 request per second. Kept a little under it. */
const ADSB_MIN_INTERVAL_MS = 1100;
/** adsbdb publishes no limit, so the politeness budget is ours - matches ADSBDB_MIN_INTERVAL_S. */
const ADSBDB_MIN_INTERVAL_MS = 200;
/** Mirrors ADSBDB_TTL_S / ADSBDB_ROUTE_TTL_S / ADSBDB_MISS_TTL_S in backend/app/config.py. */
const ADSBDB_TTL_MS = 86_400_000;
const ADSBDB_ROUTE_TTL_MS = 3_600_000;
const ADSBDB_MISS_TTL_MS = 3_600_000;
/** Mirrors TRACK_WINDOW_S / TRACK_SAMPLE_S. */
const TRACK_WINDOW_S = 1800;
const TRACK_SAMPLE_S = 5;
const MAX_RADIUS_NM = 250;

const HEX_RE = /^[0-9A-F]{6}$/;
const CALLSIGN_RE = /^[0-9A-Z]{2,8}$/;

/* ------------------------------------------------------------------ helpers */

/** Numbers only, exactly like adsb.py's `_num`: a numeric STRING is not a number. */
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Serialise calls to one host with a minimum gap between them. One page is one client, so
 * this is the whole of the rate limiting - there is no server left to coordinate anything.
 */
function gate(minIntervalMs: number) {
  let chain: Promise<unknown> = Promise.resolve();
  let last = 0;
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.then(async () => {
      const wait = minIntervalMs - (Date.now() - last);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        return await fn();
      } finally {
        last = Date.now();
      }
    });
    // Keep the chain alive after a rejection, otherwise one failure stalls every later call.
    chain = next.catch(() => undefined);
    return next as Promise<T>;
  };
}

const adsbGate = gate(ADSB_MIN_INTERVAL_MS);
const adsbdbGate = gate(ADSBDB_MIN_INTERVAL_MS);

/* --------------------------------------------------------------- ADS-B feed */

/**
 * One raw readsb/tar1090 record -> the Aircraft the app already renders.
 * Port of `normalize()` in backend/app/feeds/adsb.py. Units are FEET and KNOTS.
 */
export function normalizeAircraft(raw: Record<string, unknown>): Aircraft | null {
  const lat = num(raw.lat);
  const lon = num(raw.lon);
  // No usable position is no contact. Dropped rather than drawn somewhere invented.
  if (lat === null || lon === null) return null;

  // alt_baro is the literal string "ground" for a contact on the surface, not a number.
  const onGround = raw.alt_baro === "ground";
  const altBaro = onGround ? null : num(raw.alt_baro);
  const altGeom = num(raw.alt_geom);
  // alt_geom is WGS84 and is what Cesium wants; alt_baro is the fallback. Negative is legitimate.
  let alt = altGeom ?? altBaro;
  if (alt === null && onGround) alt = 0;

  const flags = typeof raw.dbFlags === "number" ? raw.dbFlags : 0;
  const emergency = str(raw.emergency);

  return {
    hex: str(raw.hex)?.toLowerCase() ?? null,
    flight: str(raw.flight),
    registration: str(raw.r),
    type: str(raw.t),
    desc: str(raw.desc),
    operator: str(raw.ownOp),
    year: str(raw.year),
    category: str(raw.category),
    lat,
    lon,
    alt_ft: alt,
    alt_geom_ft: altGeom,
    alt_baro_ft: altBaro,
    on_ground: onGround,
    gs_kt: num(raw.gs),
    track_deg: num(raw.track),
    baro_rate_fpm: num(raw.baro_rate),
    geom_rate_fpm: num(raw.geom_rate),
    squawk: str(raw.squawk),
    emergency: emergency && emergency.toLowerCase() !== "none" ? emergency : null,
    military: (flags & 1) !== 0,
    ladd: (flags & 8) !== 0,
    pia: (flags & 4) !== 0,
    seen_pos_s: num(raw.seen_pos),
    rssi: num(raw.rssi),
  };
}

export interface AircraftPayload {
  source: string | null;
  aircraft: Aircraft[];
  degraded: boolean;
  errors: string[];
}

/** Live status of the one reachable feed, reported honestly to the status bar. */
const feedState = { ok: false, last_error: null as string | null, consecutive_failures: 0 };

export function feedStatus(): FeedStatus[] {
  return [{ name: "airplanes.live", ...feedState }];
}

export async function fetchAircraft(lat: number, lon: number, radiusNm: number): Promise<AircraftPayload> {
  const r = Math.max(1, Math.min(MAX_RADIUS_NM, Math.round(radiusNm)));
  const url = `${AIRPLANES_LIVE}/${lat.toFixed(4)}/${lon.toFixed(4)}/${r}`;

  try {
    const body = await adsbGate(async () => {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
    // airplanes.live wraps its array in "ac". A missing envelope is a failed read, not an
    // empty sky - saying "0 contacts" for a malformed reply would be a plausible-looking lie.
    const list = (body as { ac?: unknown }).ac;
    if (!Array.isArray(list)) throw new Error("airplanes.live: no `ac` array in response");

    const aircraft = list
      .map((x) => (x && typeof x === "object" ? normalizeAircraft(x as Record<string, unknown>) : null))
      .filter((a): a is Aircraft => a !== null);

    feedState.ok = true;
    feedState.last_error = null;
    feedState.consecutive_failures = 0;
    recordTrackSamples(aircraft);
    return { source: "airplanes.live", aircraft, degraded: false, errors: [] };
  } catch (e) {
    feedState.ok = false;
    feedState.last_error = String(e);
    feedState.consecutive_failures += 1;
    // No stale frame, no invented contacts: an empty list plus a stated error.
    throw e;
  }
}

/* ------------------------------------------------------------ track buffer */

/**
 * Client-side replacement for the server ring buffer (D-016).
 *
 * Honest limitation, and the UI states it: this page can only know where a contact has been
 * since the page was opened. There is no server retaining history any more, so a track here
 * is "what this browser has watched", not "the last 30 minutes".
 */
const trackBuffer = new Map<string, TrackPoint[]>();
/** When this page started observing. A track can never claim to predate it. */
const observingSince = Date.now() / 1000;

function recordTrackSamples(aircraft: Aircraft[]): void {
  const now = Date.now() / 1000;
  const cutoff = now - TRACK_WINDOW_S;
  const seen = new Set<string>();

  for (const a of aircraft) {
    if (!a.hex) continue;
    const hex = a.hex.toLowerCase();
    seen.add(hex);
    const pts = trackBuffer.get(hex) ?? [];
    // Match the buffer's own sample interval - the display re-reads at the same cadence.
    if (pts.length && now - pts[pts.length - 1].ts < TRACK_SAMPLE_S) continue;
    pts.push({ ts: now, lat: a.lat, lon: a.lon, alt_ft: a.alt_ft });
    while (pts.length && pts[0].ts < cutoff) pts.shift();
    trackBuffer.set(hex, pts);
  }

  // Drop contacts that have left the feed, so memory does not grow without bound.
  if (trackBuffer.size > 3000) {
    for (const hex of trackBuffer.keys()) if (!seen.has(hex)) trackBuffer.delete(hex);
  }
}

export function getTrack(hex: string): TrackResult {
  const key = hex.toLowerCase();
  const pts = trackBuffer.get(key) ?? [];
  const first = pts.length ? pts[0].ts : null;
  const last = pts.length ? pts[pts.length - 1].ts : null;
  return {
    hex: key,
    count: pts.length,
    first_ts: first,
    last_ts: last,
    span_s: first !== null && last !== null ? last - first : 0,
    // The window this page can actually cover is bounded by how long it has been open,
    // never by the nominal buffer size.
    buffer_window_s: Math.min(TRACK_WINDOW_S, Date.now() / 1000 - observingSince),
    sample_s: TRACK_SAMPLE_S,
    // Nothing older than the page exists to be truncated, so this is only ever true once
    // the page has been open longer than the window.
    truncated: first !== null && first > observingSince + 1 && pts.length > 0
      && Date.now() / 1000 - observingSince > TRACK_WINDOW_S,
    points: pts.slice(),
  };
}

/* ---------------------------------------------------------------- adsbdb */

type CacheEntry = { expires: number; value: unknown };
const adsbdbCache = new Map<string, CacheEntry>();

async function adsbdbLookup<T>(
  key: string,
  url: string,
  envelope: string,
  parse: (raw: Record<string, unknown>) => T,
  ttlMs: number,
): Promise<T | null> {
  const hit = adsbdbCache.get(key);
  // A cached null is a recorded miss, not an empty slot - that is the point of caching misses.
  if (hit && Date.now() < hit.expires) return hit.value as T | null;

  const value = await adsbdbGate(async () => {
    const res = await fetch(url, { mode: "cors" });
    if (res.status === 404) return null;            // adsbdb saying "I do not know"
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { response?: Record<string, unknown> };
    const inner = body?.response?.[envelope];
    return inner && typeof inner === "object" ? parse(inner as Record<string, unknown>) : null;
  });

  // Only real answers are cached; a failure propagates so the panel can say "could not ask".
  adsbdbCache.set(key, { expires: Date.now() + (value ? ttlMs : ADSBDB_MISS_TTL_MS), value });
  return value;
}

function airport(raw: unknown): EnrichAirport | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  return {
    iata: str(a.iata_code),
    icao: str(a.icao_code),
    name: str(a.name),
    municipality: str(a.municipality),
    lat: num(a.latitude),
    lon: num(a.longitude),
  };
}

/** Never raises. `null` means adsbdb does not know; `errors` means we could not ask. */
export async function enrich(hexIn: string | null, callsignIn: string | null): Promise<Enrichment> {
  const hex = (hexIn ?? "").trim().toUpperCase() || null;
  const callsign = (callsignIn ?? "").trim().toUpperCase() || null;
  const out: Enrichment = { hex, callsign, aircraft: null, route: null, errors: [] };

  if (hex && HEX_RE.test(hex)) {
    try {
      out.aircraft = await adsbdbLookup(
        `ac:${hex}`,
        `${ADSBDB}/aircraft/${hex}`,
        "aircraft",
        (raw) => ({
          registration: str(raw.registration),
          type: str(raw.type),
          icao_type: str(raw.icao_type),
          manufacturer: str(raw.manufacturer),
          operator: str(raw.registered_owner),
          operator_country: str(raw.registered_owner_country_name),
        }),
        ADSBDB_TTL_MS,
      );
    } catch (e) {
      out.errors.push(`aircraft/${hex}: ${String(e)}`);
    }
  }

  if (callsign && CALLSIGN_RE.test(callsign)) {
    try {
      out.route = await adsbdbLookup(
        `cs:${callsign}`,
        `${ADSBDB}/callsign/${callsign}`,
        "flightroute",
        (raw) => {
          const airline = raw.airline;
          return {
            callsign: str(raw.callsign),
            airline: airline && typeof airline === "object"
              ? str((airline as Record<string, unknown>).name)
              : null,
            origin: airport(raw.origin),
            destination: airport(raw.destination),
          };
        },
        ADSBDB_ROUTE_TTL_MS,
      );
    } catch (e) {
      out.errors.push(`callsign/${callsign}: ${String(e)}`);
    }
  }

  return out;
}

/* ------------------------------------------------------------------ depth */

/**
 * Real elevation/depth at a point, straight from GEBCO's WMS GetFeatureInfo.
 * Metres, negative below sea level. Returns null on a miss - never a guessed number.
 */
export async function depth(lat: number, lon: number): Promise<number | null> {
  const d = 0.01;
  const q = new URLSearchParams({
    request: "GetFeatureInfo", service: "WMS", version: "1.1.1",
    layers: "GEBCO_2024_Grid", query_layers: "GEBCO_2024_Grid",
    srs: "EPSG:4326", bbox: `${lon - d},${lat - d},${lon + d},${lat + d}`,
    width: "100", height: "100", x: "50", y: "50", info_format: "text/plain",
  });
  const res = await fetch(`${GEBCO_WMS}?${q.toString()}`, { mode: "cors" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const m = /value_list\s*=\s*'(-?\d+)'/.exec(await res.text());
  return m ? parseInt(m[1], 10) : null;
}
