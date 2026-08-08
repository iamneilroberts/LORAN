/**
 * The TAKE CONTROL gate + deep-link, as plain functions so they are under test — no test imports
 * Panels.tsx, so any gating left inside the component is untested by construction.
 *
 * Ported from adsb-game's own eligibility gate (its `takeover/eligibility.ts::checkEligibility`)
 * so both ends refuse the same contacts for the same reasons. The SAME predicate produces the
 * disabled state AND the reason string, so the button can never be disabled for a reason the UI
 * cannot name. Only the PHYSICAL gates live here: a contact the sim cannot honestly spawn is
 * refused. Type and military status are NOT refusals — that is adsb-game's call to make on spawn.
 */
import type { Aircraft } from "../state/store";
import { SIM_BASE } from "../config";

/**
 * readsb `seen_pos` runs to ~50 s; spawning the sim on a 50-second-old position is a lie. Matches
 * adsb-game's own `MAX_SEEN_POS_S` so a contact fresh enough for one end is fresh enough for both.
 */
export const MAX_SEEN_POS_S = 15;

const DASH = "—";

export type TakeControlResult =
  | { eligible: true }
  | { eligible: false; reason: string };

/**
 * Whether the selected contact can be flown in the sim. Field names are LORAN's `Aircraft`: ground
 * state is `on_ground` (not the readsb `alt_baro:"ground"` string), staleness is `seen_pos_s`,
 * altitude is `alt_geom_ft ?? alt_baro_ft` (geom preferred, baro fallback), plus `gs_kt`/`track_deg`.
 */
export function canTakeControl(a: Aircraft | null | undefined): TakeControlResult {
  if (!a) return { eligible: false, reason: "NO CONTACT SELECTED" };
  if (!a.hex) return { eligible: false, reason: "NO ICAO HEX" };
  if (a.on_ground) return { eligible: false, reason: "ON GROUND" };
  if (a.seen_pos_s === null || a.seen_pos_s > MAX_SEEN_POS_S) {
    const age = a.seen_pos_s === null ? DASH : String(a.seen_pos_s);
    return { eligible: false, reason: `POSITION STALE (${age}S)` };
  }
  if (a.alt_geom_ft === null && a.alt_baro_ft === null) {
    return { eligible: false, reason: "NO ALTITUDE" };
  }
  if (a.gs_kt === null) return { eligible: false, reason: "NO GROUND SPEED" };
  if (a.track_deg === null) return { eligible: false, reason: "NO TRACK" };
  return { eligible: true };
}

/**
 * The deep-link adsb-game reads on load: `${base}/?takeover=<lowercase-hex>`. Hex is trimmed and
 * lower-cased (the form adsb-game matches); a trailing slash on the base is dropped so the path
 * never doubles up. `base` defaults to the configurable `SIM_BASE`.
 */
export function simTakeoverUrl(hex: string, base: string = SIM_BASE): string {
  const b = base.replace(/\/+$/, "");
  return `${b}/?takeover=${encodeURIComponent(hex.trim().toLowerCase())}`;
}
