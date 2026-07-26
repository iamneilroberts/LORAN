/*
 * Screen-space label decluttering (D-065).
 *
 * Range tuning has now been tried three times - D-037 capped city scalerank, D-049 uncapped it
 * and added the DENSITY control, D-059 pinned the airfield NAME range so it stopped scaling -
 * and labels still collide, because range tuning cannot fix this. A range says "how far away is
 * this worth naming"; it says nothing about whether two things worth naming happen to be in the
 * same place. Memphis the city and KMEM the airport are ~2 nm apart and always will be, so at
 * every zoom where both are in range, both draw on top of each other. No threshold fixes that.
 *
 * What fixes it is what paper cartographers and every real map renderer do: lay the labels out
 * in PRIORITY ORDER and drop any that would overlap something already placed. Cesium has no
 * declutter API of its own for LabelCollection - verified against its type definitions, the word
 * does not appear - so this is ours.
 *
 * This module is deliberately pure: boxes in, keep/drop out. It cannot see Cesium, a camera or
 * the DOM, so it is fully testable in the node environment this project's suite runs in (D-051).
 * The projection and occlusion work lives in placesLayer, which is the part that cannot be
 * tested here.
 */

export interface LabelBox {
  /** Window coordinates of the label's top-left corner, in CSS pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Higher wins. Ties are broken by input order, so the result is deterministic. */
  priority: number;
}

/**
 * Grid cell size in pixels for the overlap broad-phase.
 *
 * Without it this is O(n^2) against everything already placed, and at MAX density with small
 * fields enabled the visible set is thousands of labels, not hundreds. 64 px is a little wider
 * than a typical 4-character code label, so most boxes touch one or two cells.
 */
const CELL = 64;

const overlaps = (a: LabelBox, b: LabelBox): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Decide which labels to draw. Returns a keep/drop flag per input box, in input order.
 *
 * Greedy, highest priority first. Greedy is not optimal - a perfect packing is NP-hard and
 * nobody needs one here - but it has the property that actually matters for a map you pan
 * around: the most important label in any cluster is ALWAYS the one that survives. An optimiser
 * that fitted more labels by dropping KMEM in favour of two minor towns would be worse.
 */
export function declutter(boxes: LabelBox[]): boolean[] {
  const keep = new Array<boolean>(boxes.length).fill(false);

  // Sort indices, not the boxes: the caller needs the answer back in its own order. The index
  // tiebreak keeps this a total order, so the same input always produces the same output -
  // without it, labels could swap places between two identical frames and flicker.
  const order = boxes.map((_, i) => i);
  order.sort((i, j) => boxes[j].priority - boxes[i].priority || i - j);

  const grid = new Map<string, LabelBox[]>();
  const cellsFor = (b: LabelBox): string[] => {
    const keys: string[] = [];
    const x0 = Math.floor(b.x / CELL);
    const x1 = Math.floor((b.x + b.w) / CELL);
    const y0 = Math.floor(b.y / CELL);
    const y1 = Math.floor((b.y + b.h) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) keys.push(`${cx},${cy}`);
    }
    return keys;
  };

  for (const i of order) {
    const box = boxes[i];
    const keys = cellsFor(box);
    let blocked = false;
    for (const k of keys) {
      const bucket = grid.get(k);
      if (!bucket) continue;
      if (bucket.some((other) => overlaps(box, other))) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    keep[i] = true;
    for (const k of keys) {
      const bucket = grid.get(k);
      if (bucket) bucket.push(box);
      else grid.set(k, [box]);
    }
  }

  return keep;
}

/**
 * Label priorities. Higher survives a collision.
 *
 * This is an AVIATION display, so an airfield identifier outranks the town it sits next to:
 * given KMEM over MEMPHIS, the code is the one an operator is scanning for. The airfield's own
 * NAME ranks below every city, because it is the only label here that is purely redundant - it
 * names the same object its code already named, so losing it costs nothing but repetition.
 */
export const PRIORITY = {
  largeAirport: 100,
  militaryAirport: 95,
  mediumAirport: 80,
  smallAirport: 30,
  /** Airfield name, under its code. Lowest: it duplicates an identifier already on screen. */
  airfieldName: 10,
} as const;

/** Cities rank by Natural Earth scalerank: 0 is a world city, 10 a minor town. */
export function cityPriority(scalerank: number): number {
  // Kept strictly between mediumAirport (80) and smallAirport (30) so that no city ever
  // displaces a medium-or-better airfield, and every city outranks a small strip.
  if (scalerank <= 2) return 75;
  if (scalerank <= 4) return 70;
  if (scalerank <= 6) return 60;
  if (scalerank <= 7) return 50;
  if (scalerank <= 8) return 45;
  return 40;
}
