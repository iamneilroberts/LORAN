/**
 * The altitude hue ramp (D-029) is how altitude is read off the display now that the fixed
 * airspace bands are gone. Its lightness range assumes a near-black ground and is load-bearing -
 * which is exactly why it is worth pinning: a future theme change that flattens it would quietly
 * make altitude unreadable rather than break anything visibly.
 */
import { describe, expect, it } from "vitest";

import { altitudeColour } from "./aircraftLayer";

function hsl(s: string): { h: number; s: number; l: number } {
  const m = s.match(/^hsl\((-?[\d.]+) ([\d.]+)% ([\d.]+)%\)$/);
  if (!m) throw new Error(`not an hsl() string: ${s}`);
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

describe("altitudeColour", () => {
  it("returns a parseable hsl() string", () => {
    expect(altitudeColour(15000)).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
  });

  it("hits the ramp's anchor colours exactly at their altitudes", () => {
    expect(hsl(altitudeColour(0)).h).toBe(224);
    expect(hsl(altitudeColour(10000)).h).toBe(190);
    expect(hsl(altitudeColour(20000)).h).toBe(150);
    expect(hsl(altitudeColour(30000)).h).toBe(84);
    expect(hsl(altitudeColour(45000)).h).toBe(52);
  });

  it("interpolates between anchors instead of stepping", () => {
    // Halfway between 0 (h 224) and 10,000 (h 190) is h 207.
    expect(hsl(altitudeColour(5000)).h).toBe(207);
    const mid = hsl(altitudeColour(25000)).h;
    expect(mid).toBeLessThan(150);
    expect(mid).toBeGreaterThan(84);
  });

  it("moves monotonically down the hue ramp as altitude rises", () => {
    // Not merely "different colours": higher must always mean further along the ramp, or the
    // display cannot be read as an altitude scale at all.
    let prev = Infinity;
    for (let ft = 0; ft <= 45000; ft += 500) {
      const h = hsl(altitudeColour(ft)).h;
      expect(h).toBeLessThanOrEqual(prev);
      prev = h;
    }
  });

  it("clamps below the deck and above the top of the observed range", () => {
    // Negative altitudes are legitimate in this feed (below-sea-level fields), and contacts
    // above 45,000 ft exist. Neither may fall off the end of the ramp.
    expect(altitudeColour(-500)).toBe(altitudeColour(0));
    expect(altitudeColour(60000)).toBe(altitudeColour(45000));
  });

  it("treats an unknown altitude as the deck rather than throwing", () => {
    expect(altitudeColour(null)).toBe(altitudeColour(0));
  });

  it("keeps lightness in the band that assumes a near-black ground (D-029)", () => {
    for (let ft = 0; ft <= 45000; ft += 1000) {
      const l = hsl(altitudeColour(ft)).l;
      expect(l).toBeGreaterThanOrEqual(50);
      expect(l).toBeLessThanOrEqual(70);
    }
  });
});
