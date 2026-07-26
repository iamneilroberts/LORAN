/**
 * The projection envelope is a STATED ASSUMPTION, not a forecast (D-047): "where it will be in
 * N minutes if it holds present speed and stays within ±X° of present track". These tests hold
 * it to exactly that claim - the geometry has to match the stated assumption, or the envelope is
 * asserting something we did not mean.
 *
 * Written against real numbers rather than array shapes on purpose. Asserting `outline.length`
 * would pass just as happily if every point were at the aircraft's own position.
 */
import { Cartographic, Cartesian3 } from "cesium";
import { describe, expect, it } from "vitest";

import { coneGeometry, type ConeSpec } from "./projectionCone";

const KT_TO_MS = 0.514444;
const FT_TO_M = 0.3048;
const R_EARTH = 6371000;

/** Great-circle distance between two Cartesian3, in metres. */
function haversine(a: Cartesian3, b: Cartesian3): number {
  const ca = Cartographic.fromCartesian(a);
  const cb = Cartographic.fromCartesian(b);
  const dφ = cb.latitude - ca.latitude;
  const dλ = cb.longitude - ca.longitude;
  const h = Math.sin(dφ / 2) ** 2
    + Math.cos(ca.latitude) * Math.cos(cb.latitude) * Math.sin(dλ / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, in degrees 0-360. */
function bearing(a: Cartesian3, b: Cartesian3): number {
  const ca = Cartographic.fromCartesian(a);
  const cb = Cartographic.fromCartesian(b);
  const dλ = cb.longitude - ca.longitude;
  const y = Math.sin(dλ) * Math.cos(cb.latitude);
  const x = Math.cos(ca.latitude) * Math.sin(cb.latitude)
    - Math.sin(ca.latitude) * Math.cos(cb.latitude) * Math.cos(dλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function heightFt(c: Cartesian3): number {
  return Cartographic.fromCartesian(c).height / FT_TO_M;
}

/** A contact over Mobile, level at 30,000 ft, due east at 450 kt. */
const BASE: ConeSpec = {
  id: "test",
  lat: 30.6944,
  lon: -88.0399,
  trackDeg: 90,
  gsKt: 450,
  altFt: 30000,
  vsFpm: null,
  minutes: 5,
  spreadDeg: 10,
};

describe("coneGeometry", () => {
  it("reaches exactly as far as present speed carries it in the stated time", () => {
    const g = coneGeometry(BASE);
    // 450 kt for 5 minutes. This is the whole claim the envelope makes.
    const expected = 450 * KT_TO_MS * 300;
    expect(haversine(g.outline[0], g.tip)).toBeCloseTo(expected, -2);
  });

  it("points along the reported ground track, not anywhere else", () => {
    const g = coneGeometry({ ...BASE, trackDeg: 217 });
    // centre = [apex, dead-ahead point]
    expect(bearing(g.centre[0], g.centre[1])).toBeCloseTo(217, 0);
  });

  it("opens to exactly ±spreadDeg either side of the track", () => {
    const g = coneGeometry(BASE);
    const far = g.outline.slice(1, -1);
    const left = bearing(g.outline[0], far[0]);
    const right = bearing(g.outline[0], far[far.length - 1]);
    expect(left).toBeCloseTo(BASE.trackDeg - BASE.spreadDeg, 0);
    expect(right).toBeCloseTo(BASE.trackDeg + BASE.spreadDeg, 0);
  });

  it("slopes with vertical rate instead of staying level", () => {
    // -2000 fpm for 5 minutes = 10,000 ft below the starting altitude.
    const g = coneGeometry({ ...BASE, vsFpm: -2000 });
    expect(g.endAltFt).toBeCloseTo(20000, -2);
    expect(heightFt(g.tip)).toBeCloseTo(20000, -2);
  });

  it("treats a null vertical rate as level, which is what it means", () => {
    const g = coneGeometry(BASE);
    expect(g.endAltFt).toBeCloseTo(30000, -2);
  });

  it("never projects an aircraft through the ground", () => {
    // 5,000 ft descending 3,000 fpm reaches the surface in 100 s, well inside the 5 min window.
    const g = coneGeometry({ ...BASE, altFt: 5000, vsFpm: -3000 });
    expect(g.endAltFt).toBe(0);
    expect(heightFt(g.tip)).toBeCloseTo(0, 0);
    for (const r of g.rungs) {
      for (const p of r) expect(heightFt(p)).toBeGreaterThanOrEqual(-1);
    }
  });

  it("draws one range rung per whole minute short of the far cap", () => {
    // A rung is a range scale, not decoration: 5 minutes means marks at 1,2,3,4.
    expect(coneGeometry(BASE).rungs).toHaveLength(4);
    expect(coneGeometry({ ...BASE, minutes: 2 }).rungs).toHaveLength(1);
    expect(coneGeometry({ ...BASE, minutes: 1 }).rungs).toHaveLength(0);
  });

  it("places each rung at the range that speed reaches by that minute", () => {
    const g = coneGeometry(BASE);
    g.rungs.forEach((r, i) => {
      const minute = i + 1;
      const mid = r[Math.floor(r.length / 2)];
      expect(haversine(g.outline[0], mid)).toBeCloseTo(450 * KT_TO_MS * 60 * minute, -2);
    });
  });

  it("collapses to a point when the contact is not moving", () => {
    // Negative or zero ground speed must not produce a cone pointing backwards.
    for (const gsKt of [0, -30]) {
      const g = coneGeometry({ ...BASE, gsKt });
      expect(haversine(g.outline[0], g.tip)).toBeCloseTo(0, 0);
    }
  });

  it("closes its outline so the envelope reads as one shape", () => {
    const g = coneGeometry(BASE);
    const first = g.outline[0];
    const last = g.outline[g.outline.length - 1];
    expect(haversine(first, last)).toBeCloseTo(0, 0);
  });
});
