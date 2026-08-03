/*
 * The camera's hard floor (D-079).
 *
 * The surface - sea or land - is the bottom of the world for this console. Cesium's default
 * controller lets a zoom, tilt or scripted move carry the camera below the ellipsoid, and the
 * view from underneath is a void with the globe overhead: it reads as the display crashing,
 * and nothing down there is data. So the camera is clamped, not the user warned.
 *
 * Split from Globe.tsx so the clamp rule itself is a pure function under test; the wiring
 * (minimumZoomDistance + a preRender listener) stays in Globe.tsx with the other camera code.
 */

/**
 * Lowest camera height above the ellipsoid, in metres. High enough that the near plane never
 * intersects the surface mid-clamp, low enough that "down on the deck" framing still works -
 * 120 m is roughly mast height over a harbour, and every readout stays true at it.
 */
export const CAMERA_FLOOR_M = 120;

/**
 * The corrected height, or null when the camera is already legal (the common case - callers
 * run this every frame and null means "touch nothing"). NaN is treated as a violation and
 * pinned to the floor rather than propagated into the camera.
 */
export function flooredHeight(heightM: number): number | null {
  if (Number.isNaN(heightM)) return CAMERA_FLOOR_M;
  return heightM < CAMERA_FLOOR_M ? CAMERA_FLOOR_M : null;
}
