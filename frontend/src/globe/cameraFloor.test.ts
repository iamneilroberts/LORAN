/**
 * The camera's hard floor (D-079): below the surface is not a place the camera can be.
 * The clamp is a pure rule; the Cesium wiring in Globe.tsx just applies it every frame.
 */
import { describe, expect, it } from "vitest";

import { CAMERA_FLOOR_M, flooredHeight } from "./cameraFloor";

describe("flooredHeight", () => {
  it("leaves a legal camera alone - null means touch nothing", () => {
    expect(flooredHeight(CAMERA_FLOOR_M)).toBeNull();
    expect(flooredHeight(CAMERA_FLOOR_M + 0.001)).toBeNull();
    expect(flooredHeight(145_000)).toBeNull();
  });

  it("pushes a camera below the floor back up to it", () => {
    expect(flooredHeight(CAMERA_FLOOR_M - 1)).toBe(CAMERA_FLOOR_M);
    expect(flooredHeight(0)).toBe(CAMERA_FLOOR_M);
  });

  it("clamps a camera that has gone UNDER the surface - the case the feature exists for", () => {
    expect(flooredHeight(-5_000)).toBe(CAMERA_FLOOR_M);
  });

  it("treats NaN as a violation, not a pass-through into the camera", () => {
    expect(flooredHeight(Number.NaN)).toBe(CAMERA_FLOOR_M);
  });

  it("keeps the floor above the actual surface", () => {
    expect(CAMERA_FLOOR_M).toBeGreaterThan(0);
  });
});
