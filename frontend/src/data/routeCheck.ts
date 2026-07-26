/**
 * Does the contact appear to be flying towards the route adsbdb filed for it?
 *
 * The problem this exists for, with the observed case that prompted it: DAL9975 was filed
 * AMS -> MSP while actually flying ATL -> MSY, 127.7 degrees off the direct bearing at 31,975 ft
 * cruise. adsbdb's route is a SCHEDULE LOOKUP keyed on the callsign, not an observation - so a
 * recycled or stale callsign yields a route belonging to a different flight entirely, and the
 * dossier presented it with exactly the same confidence as the live telemetry beside it.
 *
 * Two responses, and the owner asked for both (D-062): the rows say plainly that the route is
 * filed rather than observed, AND a gross disagreement with the observed track is called out and
 * the dashed line to that destination is withdrawn.
 *
 * The bar for calling a disagreement is deliberately high. A cruising aircraft legitimately
 * tracks well off the direct bearing - airway doglegs, weather deviations, oceanic tracks, ATC
 * vectors - and crying wolf on a correctly filed route would be worse than staying quiet, since
 * the whole point is that the operator can trust the flag when it does appear. So this reports
 * "disagrees" only when the contact is at cruise, well away from the field, and pointing more
 * than a right angle away from it. Everything else is `unchecked`, which is a distinct state
 * from `ok` and must never be rendered as a clean bill of health.
 */
import { distanceNm } from "../state/store";

export type RouteState =
  /** Checked, and the observed track is consistent with the filed destination. */
  | "ok"
  /** Checked, and the track points grossly away from it. The line is withdrawn. */
  | "disagrees"
  /** Not checkable. NOT the same as "ok" - say why, never imply agreement. */
  | "unchecked";

export interface RouteVerdict {
  state: RouteState;
  /** Direct great-circle bearing to the filed destination, degrees true. Null if uncheckable. */
  bearingDeg: number | null;
  /** Absolute angular difference between that bearing and the observed track, 0-180. */
  offByDeg: number | null;
  /** Distance to the filed destination in NM. Null if uncheckable. */
  distanceNm: number | null;
  /** Why it could not be checked, for honest display. Null when it was checked. */
  reason: string | null;
}

/**
 * Class A airspace starts at FL180 in the US. Above it an aircraft is en route on an assigned
 * routing rather than manoeuvring in a terminal area, so its track means something. Below it,
 * a departure turning onto course or an arrival being vectored can legitimately point anywhere
 * at all, and checking would produce constant false alarms on correctly filed routes.
 */
export const CRUISE_FLOOR_FT = 18_000;

/**
 * Inside this radius the contact is in the arrival phase - descending, being vectored onto a
 * downwind or base leg, possibly flying directly away from the field on purpose. The direct
 * bearing stops being a meaningful expectation, so the check is withheld rather than failed.
 */
export const NEAR_DEST_NM = 60;

/**
 * More than a right angle off the direct bearing at cruise, sixty-plus miles out. This is not a
 * "slightly off course" threshold and is not meant to be one: at 90 degrees the contact has no
 * component of motion towards the filed field at all, which no routing, wind correction or
 * weather deviation explains. The case that prompted this was 127.7 degrees.
 */
export const DISAGREE_DEG = 90;

/** Initial great-circle bearing from a to b, degrees true, normalised to [0, 360). */
export function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dl = ((bLon - aLon) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Smallest angle between two compass bearings, 0-180. */
export function angularDiffDeg(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

export function checkFiledRoute(args: {
  lat: number;
  lon: number;
  /** Observed ground track, degrees true. Null when the feed has not reported one. */
  trackDeg: number | null;
  altFt: number | null;
  /** Filed destination coordinates from adsbdb. Either may be null - adsbdb often lacks them. */
  destLat: number | null;
  destLon: number | null;
}): RouteVerdict {
  const nothing = { bearingDeg: null, offByDeg: null, distanceNm: null };

  // No coordinates means no check and, per D-050, no line either. Never a guessed airport.
  if (args.destLat == null || args.destLon == null) {
    return { state: "unchecked", ...nothing, reason: "no destination coordinates" };
  }
  if (args.trackDeg == null) {
    return { state: "unchecked", ...nothing, reason: "no observed track" };
  }
  // A contact on the ground has a track that means nothing for route agreement.
  if (args.altFt == null) {
    return { state: "unchecked", ...nothing, reason: "no altitude" };
  }

  const brg = bearingDeg(args.lat, args.lon, args.destLat, args.destLon);
  const dist = distanceNm(args.lat, args.lon, args.destLat, args.destLon);
  const off = angularDiffDeg(brg, args.trackDeg);
  const measured = { bearingDeg: brg, offByDeg: off, distanceNm: dist };

  if (args.altFt < CRUISE_FLOOR_FT) {
    return { state: "unchecked", ...measured, reason: "below cruise" };
  }
  if (dist < NEAR_DEST_NM) {
    return { state: "unchecked", ...measured, reason: "near destination" };
  }

  return {
    state: off > DISAGREE_DEG ? "disagrees" : "ok",
    ...measured,
    reason: null,
  };
}
