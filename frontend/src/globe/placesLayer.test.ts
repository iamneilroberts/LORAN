/**
 * `airfieldRanges()` - the range calculation behind D-059.
 *
 * The bug: DENSITY (D-049, 1x/2x/4x) rescaled the airfield NAME label's visible range the same
 * way it rescaled the CODE/marker range, since both were pushed into the same `ranged` list and
 * multiplied by the same `mult`. At MAX (4x) a medium field's name range grew from ~61 nm back up
 * to ~243 nm - the code's own density-1 range - which is far enough to pull a whole regional
 * cluster of airfield names into view at once, and names that wide collide.
 *
 * This is pure data in, data out: no Cesium Viewer needed, which matters because this harness
 * cannot construct one (D-051 - `node` environment, no DOM, no WebGL).
 */
import { describe, expect, it } from "vitest";

import { airfieldRanges } from "./placesLayer";

// The three airfield tiers' base (density-1) code ranges, in metres - mirrors FAR_LARGE,
// FAR_MILITARY, FAR_MEDIUM in placesLayer.ts. Not imported: those constants are not exported,
// and re-deriving them here means a change to the shipped values shows up as a failing
// assertion instead of a silently-stale test fixture.
const TIERS = [2_500_000, 900_000, 450_000];
const DENSITIES = [1, 2, 4]; // STD / MORE / MAX, per the DENSITY row (D-049)

describe("airfieldRanges", () => {
  it("scales the code range linearly with density", () => {
    expect(airfieldRanges(450_000, 1).codeFar).toBe(450_000);
    expect(airfieldRanges(450_000, 2).codeFar).toBe(900_000);
    expect(airfieldRanges(450_000, 4).codeFar).toBe(1_800_000);
  });

  it("does not blow the name range up at MAX the way the code range blows up", () => {
    // At density 1 both were (and still are) far/4. The bug was specifically that MAX
    // multiplied the name range by 4 as well - this pins it to the density-1 value instead.
    const atStd = airfieldRanges(450_000, 1);
    const atMax = airfieldRanges(450_000, 4);

    expect(atStd.nameFar).toBe(112_500);
    expect(atMax.nameFar).toBe(112_500); // unchanged - this is the fix
    expect(atMax.codeFar).toBe(1_800_000); // the code, by contrast, does blow up
  });

  it("holds the ordering invariant (name <= code) for every tier at every density preset", () => {
    for (const far of TIERS) {
      for (const mult of DENSITIES) {
        const { codeFar, nameFar } = airfieldRanges(far, mult);
        expect(nameFar).toBeLessThanOrEqual(codeFar);
      }
    }
  });

  it("clamps the name range to the code range if density ever drops the code below the name's pinned value", () => {
    // Not a shipped preset today (DENSITIES floor is 1), but the clamp is what keeps the
    // invariant from silently depending on that floor never moving.
    const { codeFar, nameFar } = airfieldRanges(450_000, 0.1);
    expect(codeFar).toBe(45_000);
    expect(nameFar).toBe(45_000); // clamped down to codeFar, not the pinned 112,500
  });
});
