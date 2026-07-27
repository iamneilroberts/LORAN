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
  /**
   * The track we EXPECT, degrees true. Null if uncheckable. For a destination that is the direct
   * great-circle bearing to it; for an origin it is the reciprocal - the bearing away from the
   * field. Same field, same units, so the panel can phrase either leg from it.
   */
  bearingDeg: number | null;
  /** Absolute angular difference between that expected track and the observed one, 0-180. */
  offByDeg: number | null;
  /** Distance to the filed airfield in NM. Null if uncheckable. */
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

/** Which end of the filed route a leg runs to. */
export type RouteEnd = "origin" | "destination";

export interface FiledLegArgs {
  lat: number;
  lon: number;
  /** Observed ground track, degrees true. Null when the feed has not reported one. */
  trackDeg: number | null;
  altFt: number | null;
  /** Filed airfield coordinates from adsbdb. Either may be null - adsbdb often lacks them. */
  fieldLat: number | null;
  fieldLon: number | null;
}

/**
 * One check, both ends, and the only thing that differs is what track we EXPECT.
 *
 * Towards a destination the expected track is the direct bearing to it. Away from an origin the
 * expected track is the reciprocal - the bearing the contact would be holding if it had departed
 * that field and kept going. Once `bearingDeg` means "the track we expect" rather than "the
 * bearing to the field", the disagreement rule is literally the same line of code for both ends,
 * and DISAGREE_DEG keeps one meaning instead of acquiring a mirrored twin that could drift.
 */
function checkLeg(args: FiledLegArgs, end: RouteEnd): RouteVerdict {
  const nothing = { bearingDeg: null, offByDeg: null, distanceNm: null };
  const noun = end === "origin" ? "origin" : "destination";

  // No coordinates means no check and, per D-050, no line either. Never a guessed airport.
  if (args.fieldLat == null || args.fieldLon == null) {
    return { state: "unchecked", ...nothing, reason: `no ${noun} coordinates` };
  }
  if (args.trackDeg == null) {
    return { state: "unchecked", ...nothing, reason: "no observed track" };
  }
  // A contact on the ground has a track that means nothing for route agreement.
  if (args.altFt == null) {
    return { state: "unchecked", ...nothing, reason: "no altitude" };
  }

  const toField = bearingDeg(args.lat, args.lon, args.fieldLat, args.fieldLon);
  // Towards the field for a destination; directly away from it for an origin.
  const expected = end === "origin" ? (toField + 180) % 360 : toField;
  const dist = distanceNm(args.lat, args.lon, args.fieldLat, args.fieldLon);
  const off = angularDiffDeg(expected, args.trackDeg);
  const measured = { bearingDeg: expected, offByDeg: off, distanceNm: dist };

  if (args.altFt < CRUISE_FLOOR_FT) {
    return { state: "unchecked", ...measured, reason: "below cruise" };
  }
  // Near the destination this withholds the check through the arrival; near the origin it does
  // the same through the departure, where a contact climbing out on a downwind or being turned
  // onto course legitimately points back at the field it just left.
  if (dist < NEAR_DEST_NM) {
    return { state: "unchecked", ...measured, reason: `near ${noun}` };
  }

  return {
    state: off > DISAGREE_DEG ? "disagrees" : "ok",
    ...measured,
    reason: null,
  };
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
  return checkLeg(
    { ...args, fieldLat: args.destLat, fieldLon: args.destLon },
    "destination",
  );
}

/**
 * The mirror of `checkFiledRoute` for the filed ORIGIN, and it withdraws the backward leg on the
 * same evidence the forward one uses.
 *
 * The failure it catches is the same one D-062 was written for. adsbdb's route is a schedule
 * lookup keyed on the callsign, so a recycled callsign hands back some other flight's pair of
 * airfields - and a wrong origin is exactly as wrong as a wrong destination. A contact at cruise,
 * sixty-plus miles out, whose track points back within a right angle of the field it supposedly
 * departed has no component of motion away from it, which no departure routing explains.
 */
export function checkFiledOrigin(args: {
  lat: number;
  lon: number;
  trackDeg: number | null;
  altFt: number | null;
  /** Filed origin coordinates from adsbdb. Either may be null. */
  origLat: number | null;
  origLon: number | null;
}): RouteVerdict {
  return checkLeg(
    { ...args, fieldLat: args.origLat, fieldLon: args.origLon },
    "origin",
  );
}
