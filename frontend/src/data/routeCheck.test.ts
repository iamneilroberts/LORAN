/**
 * The easy fake pass here would be a test that only feeds in the one case that prompted the
 * feature and checks it comes back "disagrees" - it would stay green with every guard deleted,
 * and the guards are the whole reason this is shippable. So the weight sits on the cases that
 * must NOT flag: a departure turning onto course, and an arrival being vectored. Both are
 * grossly off the direct bearing and both are perfectly normal.
 *
 * Coordinates are real airports, and the disagreement case is the shape of the observed one -
 * a contact en route ATL -> MSY carrying a filed destination of MSP. The numbers below were
 * computed from those coordinates, not copied from the incident report.
 */
import { describe, expect, it } from "vitest";

import {
  CRUISE_FLOOR_FT,
  DISAGREE_DEG,
  NEAR_DEST_NM,
  angularDiffDeg,
  bearingDeg,
  checkFiledRoute,
} from "./routeCheck";

const MSP = { lat: 44.882, lon: -93.2218 };
const MSY = { lat: 29.9934, lon: -90.2581 };
/** En route between ATL and MSY: ~233 deg towards MSY, ~343 deg towards MSP, 830 nm from MSP. */
const ENROUTE = { lat: 31.8, lon: -87.5, trackDeg: 233.4 };

const check = (over: Partial<Parameters<typeof checkFiledRoute>[0]> = {}) =>
  checkFiledRoute({
    lat: ENROUTE.lat,
    lon: ENROUTE.lon,
    trackDeg: ENROUTE.trackDeg,
    altFt: 31_975,
    destLat: MSP.lat,
    destLon: MSP.lon,
    ...over,
  });

describe("bearingDeg / angularDiffDeg", () => {
  it("computes a great-circle bearing that matches the known geometry", () => {
    expect(bearingDeg(ENROUTE.lat, ENROUTE.lon, MSP.lat, MSP.lon)).toBeCloseTo(342.8, 0);
    expect(bearingDeg(ENROUTE.lat, ENROUTE.lon, MSY.lat, MSY.lon)).toBeCloseTo(233.4, 0);
  });

  it("wraps around north instead of reporting a reflex angle", () => {
    // 359 vs 001 is two degrees apart, not 358 - the bug that would make every northbound
    // contact look grossly off course.
    expect(angularDiffDeg(359, 1)).toBeCloseTo(2, 6);
    expect(angularDiffDeg(1, 359)).toBeCloseTo(2, 6);
    expect(angularDiffDeg(0, 180)).toBeCloseTo(180, 6);
    expect(angularDiffDeg(90, 90)).toBeCloseTo(0, 6);
  });
});

describe("checkFiledRoute", () => {
  it("flags a cruising contact tracking grossly away from its filed destination", () => {
    const v = check();
    expect(v.state).toBe("disagrees");
    expect(v.offByDeg).toBeCloseTo(109.4, 0);
    expect(v.distanceNm).toBeCloseTo(830, -1);
  });

  it("says ok when the same contact is tracking towards the destination it filed", () => {
    // Proves "disagrees" is not simply what this returns for every cruising aircraft.
    const v = check({ destLat: MSY.lat, destLon: MSY.lon });
    expect(v.state).toBe("ok");
    expect(v.offByDeg).toBeCloseTo(0, 0);
  });

  it("does NOT flag a departure below cruise, however far off the bearing it points", () => {
    // A jet turning onto course out of ATL is legitimately pointed anywhere at all. This is
    // the guard that keeps the flag trustworthy; without it the panel cries wolf constantly.
    const v = check({ altFt: CRUISE_FLOOR_FT - 1 });
    expect(v.state).toBe("unchecked");
    expect(v.reason).toBe("below cruise");
    // Still reports what it measured - withholding the verdict is not withholding the numbers.
    expect(v.offByDeg).toBeCloseTo(109.4, 0);
  });

  it("does NOT flag an arrival inside the terminal area, however far off the bearing", () => {
    // Downwind or base leg points away from the field on purpose.
    const nearMsp = { lat: 44.4, lon: -93.2218 };
    const v = checkFiledRoute({
      lat: nearMsp.lat, lon: nearMsp.lon,
      trackDeg: 180, // flying due south, directly away from MSP to the north
      altFt: 25_000,
      destLat: MSP.lat, destLon: MSP.lon,
    });
    expect(v.distanceNm).toBeLessThan(NEAR_DEST_NM);
    expect(v.state).toBe("unchecked");
    expect(v.reason).toBe("near destination");
  });

  it("never reports ok when it could not check", () => {
    // "unchecked" must stay distinct from a clean bill of health in every missing-data case.
    for (const over of [
      { destLat: null }, { destLon: null }, { trackDeg: null }, { altFt: null },
    ]) {
      const v = check(over as Parameters<typeof check>[0]);
      expect(v.state).toBe("unchecked");
      expect(v.reason).not.toBeNull();
    }
  });

  it("reports no numbers at all when the destination has no coordinates", () => {
    // adsbdb frequently knows the airport but not where it is. Nothing may be computed from
    // that, and no line may be drawn - D-050.
    const v = check({ destLat: null, destLon: null });
    expect(v).toMatchObject({
      state: "unchecked", bearingDeg: null, offByDeg: null, distanceNm: null,
    });
    expect(v.reason).toBe("no destination coordinates");
  });

  it("tolerates a large but legitimate routing deviation without flagging", () => {
    // ABSOLUTE, not expressed in terms of DISAGREE_DEG: an airway dogleg, an oceanic track or a
    // weather deviation of 45 degrees is normal and must stay silent. Asserting this relative to
    // the constant would slide with it and pin nothing - tightening the threshold to 30 passed a
    // relative version of this test, which is how this gap was found.
    const brg = bearingDeg(ENROUTE.lat, ENROUTE.lon, MSP.lat, MSP.lon);
    expect(check({ trackDeg: brg - 45 }).state).toBe("ok");
    expect(check({ trackDeg: brg + 45 }).state).toBe("ok");
    expect(check({ trackDeg: brg - 80 }).state).toBe("ok");
  });

  it("flags a track with no component of motion towards the field at all", () => {
    // Also absolute: at 120 degrees off there is no routing explanation left.
    const brg = bearingDeg(ENROUTE.lat, ENROUTE.lon, MSP.lat, MSP.lon);
    expect(check({ trackDeg: brg - 120 }).state).toBe("disagrees");
    expect(check({ trackDeg: brg + 120 }).state).toBe("disagrees");
    expect(check({ trackDeg: brg + 180 }).state).toBe("disagrees");
  });

  it("holds the threshold at a right angle, exclusive", () => {
    const brg = bearingDeg(ENROUTE.lat, ENROUTE.lon, MSP.lat, MSP.lon);
    expect(DISAGREE_DEG).toBe(90);
    expect(check({ trackDeg: brg - 89 }).state).toBe("ok");
    expect(check({ trackDeg: brg - 91 }).state).toBe("disagrees");
    // Exactly at the threshold is not a disagreement.
    expect(check({ trackDeg: brg - 90 }).state).toBe("ok");
  });
});
