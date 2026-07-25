/*
 * Frontend knobs, all overridable at build time via Vite env vars (D-019).
 *
 * The project is going open source, so nothing here may be a hardcoded local path or an
 * assumption about one deployment. Defaults are the values this homelab runs; anyone else
 * overrides them in `.env` with a `VITE_` prefix, which is the only way Vite exposes a
 * variable to browser code.
 */

function str(v: string | undefined, fallback: string): string {
  return v && v.trim() ? v.trim() : fallback;
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/* ---- weather radar (D-040) ---- */

/**
 * Iowa State Mesonet's WMS render of NOAA/NWS NEXRAD. Free, keyless, US public domain data.
 * US coverage ONLY - outside it the layer is transparent, which is the honest empty state.
 */
export const RADAR_WMS = str(
  import.meta.env.VITE_RADAR_WMS,
  "https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi",
);
export const RADAR_LAYER = str(import.meta.env.VITE_RADAR_LAYER, "nexrad-n0q-900913");
/** Frames are published about every 5 minutes; see the staleness note in radarLayer.ts. */
export const RADAR_REFRESH_MS = num(import.meta.env.VITE_RADAR_REFRESH_MS, 5 * 60 * 1000);
/** Translucent so it reads as an overlay on the globe, never as the basemap. */
export const RADAR_ALPHA = num(import.meta.env.VITE_RADAR_ALPHA, 0.55);
/** Radar is ~1 km data. Beyond this, tiles are upscaling and imply false precision. */
export const RADAR_MAX_LEVEL = num(import.meta.env.VITE_RADAR_MAX_LEVEL, 10);
