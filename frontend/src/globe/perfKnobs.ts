/**
 * The three settings that decide whether Cesium is usable on a phone, in one place so the probe
 * route can A/B them on a real handset (D-073's measurement gate).
 *
 * WHY THIS EXISTS. The console's Cesium setup is tuned for a desktop with a real GPU, and three
 * of those choices are actively hostile to a phone:
 *
 *   1. `Globe.tsx` sets `useBrowserRecommendedResolution = false`, so the drawing buffer is
 *      devicePixelRatio pixels per CSS pixel. That was a deliberate call to stop labels looking
 *      soft on a HiDPI desktop. On a DPR-3 phone it is NINE TIMES the fragment work of DPR 1.
 *   2. Nothing sets `requestRenderMode`, so Cesium renders continuously, and dead reckoning runs
 *      inside `scene.postRender` on EVERY frame. At 500 kt a contact moves 4.3 m per frame at
 *      60 fps - sub-pixel at any sane zoom. Sixty updates a second buys nothing visible.
 *   3. County boundaries are 3619 rings against the states' 858.
 *
 * DEFAULTS ARE TODAY'S BEHAVIOUR, EXACTLY. `drHz = 0` means "every frame", which is what shipped.
 * Nothing here changes the desktop console unless the probe route sets it, because the desktop
 * console is the actual product and this is a measuring instrument, not a redesign.
 *
 * Resolution scale is deliberately NOT here: the probe sets `viewer.resolutionScale` straight
 * through `window.__viewer`, which is already an intentional debug surface (`Globe.tsx:80`), and
 * routing it through a knob would only add a second way to say the same thing.
 */

export interface PerfKnobs {
  /**
   * How often dead reckoning re-projects every contact, in Hz. `0` means every rendered frame,
   * which is what the console has always done. Anything above 0 throttles it.
   */
  drHz: number;
}

export const perfKnobs: PerfKnobs = { drHz: 0 };

/**
 * Live cost counters, written by the render loop and drained by the probe.
 *
 * `drMs` is wall time inside the dead-reckoning update, which is the per-frame CPU cost the
 * throttle is meant to remove. FPS alone cannot show this: skipping the update while Cesium keeps
 * rendering at 60 fps leaves the frame rate untouched and the CPU saving invisible. Measuring the
 * work directly is the only honest way to see it.
 */
export const perfStats = {
  /** Accumulated milliseconds spent in the dead-reckoning update since the last drain. */
  drMs: 0,
  /** Number of dead-reckoning updates since the last drain. */
  drCalls: 0,
  /** Frames rendered since the last drain. */
  frames: 0,
};

/** Read the counters and zero them. Returns per-second rates for the window just ended. */
export function drainPerfStats(windowMs: number): {
  fps: number;
  drCallsPerS: number;
  drMsPerS: number;
  msPerDrCall: number;
} {
  const s = Math.max(1, windowMs) / 1000;
  const out = {
    fps: perfStats.frames / s,
    drCallsPerS: perfStats.drCalls / s,
    drMsPerS: perfStats.drMs / s,
    msPerDrCall: perfStats.drCalls > 0 ? perfStats.drMs / perfStats.drCalls : 0,
  };
  perfStats.drMs = 0;
  perfStats.drCalls = 0;
  perfStats.frames = 0;
  return out;
}
