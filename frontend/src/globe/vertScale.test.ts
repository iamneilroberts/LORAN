/**
 * Vertical exaggeration must move EVERY altitude-positioned thing by the same ratio (D-075).
 *
 * The easy fake pass is a test that scales one module and checks it moved. That passes while the
 * scene silently desyncs — an aircraft floating off its own drop line, or the datum slice sitting
 * at the wrong height under the contact it is pinned to. It is also exactly the D-071 failure:
 * one value computed in several places, drifting.
 *
 * So this asserts the ratio across the consumers TOGETHER, and separately that the readouts do
 * NOT move. A test that only checked geometry would be happy with an instrument reporting an
 * altitude the aircraft is not at, which is the worse of the two failures.
 */
import { Cartesian3, Cartographic } from "cesium";
import { describe, expect, it } from "vitest";

import { altToMetres, FT_TO_M } from "../state/store";
import { coneGeometry, type ConeSpec } from "./projectionCone";
import { levelArc } from "./destinationLine";

const SCALE = 10;
const ALT_FT = 37_000;

function heightOf(c: Cartesian3): number {
  return Cartographic.fromCartesian(c).height;
}

const CONE: ConeSpec = {
  id: "cone::test",
  lat: 30.6944,
  lon: -88.0399,
  altFt: ALT_FT,
  gsKt: 450,
  trackDeg: 90,
  vsFpm: 0,
  minutes: 5,
  spreadDeg: 10,
};

describe("altToMetres", () => {
  it("is true scale by default, so nothing is exaggerated unless asked", () => {
    expect(altToMetres(ALT_FT)).toBeCloseTo(ALT_FT * FT_TO_M, 6);
    expect(altToMetres(ALT_FT, 1)).toBeCloseTo(ALT_FT * FT_TO_M, 6);
  });

  it("scales linearly", () => {
    expect(altToMetres(ALT_FT, SCALE)).toBeCloseTo(ALT_FT * FT_TO_M * SCALE, 6);
  });

  it("leaves ground level on the ground at any scale", () => {
    // Multiplying zero is zero, but stating it pins the property: exaggeration must not lift the
    // surface, or every contact on the ground would float.
    expect(altToMetres(0, SCALE)).toBe(0);
  });
});

describe("every altitude consumer moves by the same ratio", () => {
  it("the filed-route leg does", () => {
    const trueArc = levelArc(30, -88, 32, -90, altToMetres(ALT_FT, 1));
    const bigArc = levelArc(30, -88, 32, -90, altToMetres(ALT_FT, SCALE));
    expect(heightOf(bigArc[0]) / heightOf(trueArc[0])).toBeCloseTo(SCALE, 3);
    // Held for the whole length, not just the ends - a sagging exaggerated line would be a
    // descent profile we never computed (D-050).
    const mid = Math.floor(trueArc.length / 2);
    expect(heightOf(bigArc[mid]) / heightOf(trueArc[mid])).toBeCloseTo(SCALE, 3);
  });

  it("the projection cone does", () => {
    const trueGeom = coneGeometry(CONE);
    const bigGeom = coneGeometry({ ...CONE, vertScale: SCALE });
    expect(heightOf(bigGeom.outline[0]) / heightOf(trueGeom.outline[0])).toBeCloseTo(SCALE, 3);
    expect(heightOf(bigGeom.tip) / heightOf(trueGeom.tip)).toBeCloseTo(SCALE, 3);
  });

  it("agrees with the cone: one contact's altitude, one drawn height", () => {
    // The cross-module check. If the cone applied the scale and the shared helper did not - or
    // either drifted - these two would disagree, and on screen the contact would sit off the
    // apex of its own envelope.
    const big = coneGeometry({ ...CONE, vertScale: SCALE });
    expect(heightOf(big.outline[0])).toBeCloseTo(altToMetres(ALT_FT, SCALE), 2);
  });
});

describe("the numbers never lie", () => {
  it("keeps the cone's END ALT readout TRUE while the geometry is exaggerated", () => {
    // The specific trap D-075 names. `endAltFt` divides metres back by FT_TO_M, so folding the
    // scale into heightAt would inflate a reported altitude - a real instrument lying, which is
    // worse than no instrument. Level flight, so the answer must be the input altitude.
    const trueGeom = coneGeometry(CONE);
    const bigGeom = coneGeometry({ ...CONE, vertScale: SCALE });
    expect(trueGeom.endAltFt).toBe(ALT_FT);
    expect(bigGeom.endAltFt).toBe(ALT_FT);
    expect(bigGeom.endAltFt).toBe(trueGeom.endAltFt);
  });

  it("keeps the readout true for a CLIMBING contact too", () => {
    // Level flight would pass even if endAltFt ignored the vertical rate entirely, so climb.
    const climbing: ConeSpec = { ...CONE, vsFpm: 1800 };
    const trueGeom = coneGeometry(climbing);
    const bigGeom = coneGeometry({ ...climbing, vertScale: SCALE });
    expect(bigGeom.endAltFt).toBe(trueGeom.endAltFt);
    expect(trueGeom.endAltFt).toBeGreaterThan(ALT_FT);
  });
});
