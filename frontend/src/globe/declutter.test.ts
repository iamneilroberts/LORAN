/**
 * The property that matters: in any cluster, the HIGHEST-priority label survives. The easy fake
 * pass would be "some labels were dropped" - true of any broken implementation, including one
 * that drops everything. So the tests below pin which one survives, that non-overlapping labels
 * are never touched, and that the result is stable across identical calls (a declutter that
 * reshuffled between two identical frames would flicker as you pan).
 */
import { describe, expect, it } from "vitest";

import { PRIORITY, cityPriority, declutter, type LabelBox } from "./declutter";

const box = (x: number, y: number, priority: number, w = 40, h = 12): LabelBox =>
  ({ x, y, w, h, priority });

describe("declutter", () => {
  it("keeps everything when nothing overlaps", () => {
    const boxes = [box(0, 0, 10), box(200, 0, 10), box(0, 200, 10)];
    expect(declutter(boxes)).toEqual([true, true, true]);
  });

  it("keeps the higher priority label and drops the one under it", () => {
    // Order deliberately puts the LOW priority box first, so a naive first-wins implementation
    // fails this. That is the whole point: KMEM must beat MEMPHIS regardless of build order.
    const boxes = [box(0, 0, 50), box(5, 2, 100)];
    expect(declutter(boxes)).toEqual([false, true]);
  });

  it("keeps the airport code over the city label sitting on top of it", () => {
    // The actual reported case, in the actual priorities.
    const kmem = box(100, 100, PRIORITY.largeAirport);
    const memphis = box(104, 103, cityPriority(2));
    expect(declutter([memphis, kmem])).toEqual([false, true]);
  });

  it("drops the airfield NAME before any city", () => {
    // The name duplicates an identifier already on screen, so it is the cheapest thing to lose.
    const name = box(100, 100, PRIORITY.airfieldName);
    const town = box(102, 101, cityPriority(9));
    expect(declutter([name, town])).toEqual([false, true]);
  });

  it("resolves a pile-up down to exactly one survivor, the strongest", () => {
    const boxes = [
      box(10, 10, cityPriority(6)),
      box(12, 11, PRIORITY.mediumAirport),
      box(11, 12, cityPriority(2)),
      box(13, 10, PRIORITY.airfieldName),
    ];
    const keep = declutter(boxes);
    expect(keep.filter(Boolean)).toHaveLength(1);
    expect(keep[1]).toBe(true); // the medium airport, at 80, beats a rank-2 city at 75
  });

  it("lets a dropped label's neighbour through if it does not touch the survivor", () => {
    // Proves dropping is per-collision, not "clear the whole neighbourhood".
    const strong = box(0, 0, 100, 40, 12);
    const overlapping = box(10, 0, 50, 40, 12);
    const clear = box(100, 0, 50, 40, 12);
    expect(declutter([strong, overlapping, clear])).toEqual([true, false, true]);
  });

  it("is deterministic for equal priorities, so identical frames do not flicker", () => {
    const boxes = [box(0, 0, 60), box(5, 0, 60), box(10, 0, 60)];
    const a = declutter(boxes);
    const b = declutter(boxes);
    expect(a).toEqual(b);
    // Input order breaks the tie, so the first one placed is the first one given.
    expect(a[0]).toBe(true);
  });

  it("handles boxes spanning several grid cells", () => {
    // A long name label is wider than the 64px broad-phase cell; the grid must not let a
    // collision slip through just because the two boxes anchor in different cells.
    const wide = box(0, 0, 100, 300, 12);
    const far = box(250, 4, 50, 40, 12);
    expect(declutter([wide, far])).toEqual([true, false]);
  });

  it("treats edge-touching boxes as not overlapping", () => {
    // Exactly adjacent is fine - labels may sit shoulder to shoulder.
    expect(declutter([box(0, 0, 100, 40, 12), box(40, 0, 50, 40, 12)])).toEqual([true, true]);
  });
});

describe("priorities", () => {
  it("ranks an aviation identifier above the town it sits next to", () => {
    expect(PRIORITY.largeAirport).toBeGreaterThan(cityPriority(0));
    expect(PRIORITY.militaryAirport).toBeGreaterThan(cityPriority(0));
    expect(PRIORITY.mediumAirport).toBeGreaterThan(cityPriority(0));
  });

  it("ranks every city above a small strip and below a medium field", () => {
    for (const rank of [0, 2, 4, 6, 7, 8, 10]) {
      expect(cityPriority(rank)).toBeGreaterThan(PRIORITY.smallAirport);
      expect(cityPriority(rank)).toBeLessThan(PRIORITY.mediumAirport);
    }
  });

  it("ranks cities monotonically by scalerank", () => {
    // A world city must never lose to a minor town.
    const ranks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const values = ranks.map(cityPriority);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
    }
  });

  it("puts the airfield name below everything else", () => {
    expect(PRIORITY.airfieldName).toBeLessThan(PRIORITY.smallAirport);
    expect(PRIORITY.airfieldName).toBeLessThan(cityPriority(10));
  });
});
