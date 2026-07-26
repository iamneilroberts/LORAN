/**
 * Guards the BAKED OUTPUT of scripts/build_boundaries.py, which is the thing that actually
 * ships. Nothing here can render Cesium (no DOM, no WebGL, D-051), so the layer's drawing is
 * out of reach - but a rebuild that silently produced malformed rings would black-hole the
 * boundaries with no other alarm, and that is exactly what these assertions catch.
 *
 * The easy fake pass would be "the file parses and has some rings in it". So the checks below
 * are the ones that would actually fail on a broken bake: odd-length coordinate arrays,
 * degenerate rings, out-of-range coordinates, and - the one with real teeth - segments that
 * jump the antimeridian, which Cesium would draw as a line straight across the globe.
 */
import { describe, expect, it } from "vitest";

import boundaries from "./boundaries.json";

const LAYERS = ["states", "counties"] as const;
type Ring = number[];

const ringsOf = (k: (typeof LAYERS)[number]): Ring[] => boundaries[k] as Ring[];

describe("boundaries.json", () => {
  it("ships both layers at the counts the build reported", () => {
    // If a rebuild silently halves these, something upstream changed and needs looking at
    // rather than shipping. Exact, not "greater than zero" - a lower bound would pass on a
    // bake that dropped 90% of the rings.
    expect(ringsOf("states")).toHaveLength(858);
    expect(ringsOf("counties")).toHaveLength(3619);
  });

  it("stores every ring as flat lon/lat pairs", () => {
    for (const layer of LAYERS) {
      for (const ring of ringsOf(layer)) {
        // Odd length means a coordinate lost its partner - Cartesian3.fromDegreesArray would
        // then silently shift every subsequent point by one.
        expect(ring.length % 2).toBe(0);
        // Two points minimum, or it is not a line. The build drops shorter ones; this proves it.
        expect(ring.length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  // Both sweeps below collect offenders and assert once, rather than calling expect() 110,000
  // times - the per-point form cost ~3.6 s, which is a tax on every future run of the suite.
  // The reported value still names the layer, ring and coordinate, so a failure is no harder
  // to chase down than it would have been.
  it("keeps every coordinate on the planet", () => {
    const bad: string[] = [];
    for (const layer of LAYERS) {
      ringsOf(layer).forEach((ring, r) => {
        for (let i = 0; i < ring.length; i += 2) {
          const lon = ring[i];
          const lat = ring[i + 1];
          if (!Number.isFinite(lon) || !Number.isFinite(lat)
              || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
            bad.push(`${layer}[${r}][${i}] = ${lon},${lat}`);
          }
        }
      });
    }
    expect(bad).toEqual([]);
  });

  it("never jumps the antimeridian inside a ring", () => {
    // The one with teeth. The Aleutians put county vertices at both -179.1 and +179.8, so the
    // data DOES span the dateline - it just does it in separate rings, because Natural Earth
    // splits there. A ring containing a >180 degree step would be drawn by Cesium as a line
    // across the entire globe, which is unmistakable on screen and impossible to miss in a
    // screenshot - but only if someone is looking. This looks instead.
    const jumps: string[] = [];
    for (const layer of LAYERS) {
      ringsOf(layer).forEach((ring, r) => {
        for (let i = 2; i < ring.length; i += 2) {
          if (Math.abs(ring[i] - ring[i - 2]) > 180) {
            jumps.push(`${layer}[${r}]: ${ring[i - 2]} -> ${ring[i]}`);
          }
        }
      });
    }
    expect(jumps).toEqual([]);
  });

  it("holds the counties layer to its US-only claim", () => {
    // The layer toggle tells the owner counties are US-only, so that had better be true -
    // a note claiming a limitation the data does not have is as misleading as the reverse.
    // Central Europe is the discriminator: dense with admin_2 units in any worldwide dataset,
    // and nowhere near US territory.
    const inEurope = ringsOf("counties").some((ring) => {
      for (let i = 0; i < ring.length; i += 2) {
        if (ring[i] >= 0 && ring[i] <= 20 && ring[i + 1] >= 45 && ring[i + 1] <= 55) return true;
      }
      return false;
    });
    expect(inEurope).toBe(false);
  });

  it("carries its attribution, which is a licence condition and not a comment", () => {
    const sources = (boundaries as { _sources?: Record<string, string> })._sources ?? {};
    expect(sources.states).toMatch(/Natural Earth/);
    expect(sources.counties).toMatch(/Natural Earth/);
  });
});
