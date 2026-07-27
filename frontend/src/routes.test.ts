/**
 * The easy fake pass here is a test that only checks `#m` maps to "list" and `#map` to "map".
 * That stays green with the width fallback deleted, and the width fallback is the entire reason
 * this module exists: the token links are SHARED, so a hashless URL has to do the right thing on
 * a device nobody here has seen.
 *
 * So the weight sits on two properties:
 *   1. With no hash, WIDTH decides - both ways, either side of the threshold.
 *   2. An explicit hash BEATS the width, in both directions. That is what stops auto-routing from
 *      locking a tablet out of the console, or the owner out of the list on a laptop.
 */
import { describe, expect, it } from "vitest";

import { CONSOLE_MIN_W, viewFor } from "./routes";

const PHONE = 390;
const DESKTOP = 1600;

describe("viewFor", () => {
  it("uses width when no hash is given", () => {
    expect(viewFor("", PHONE)).toBe("list");
    expect(viewFor("", DESKTOP)).toBe("map");
  });

  it("lets an explicit hash beat the width, in BOTH directions", () => {
    // The console on a phone: cramped until Stage 2, but never locked out.
    expect(viewFor("map", PHONE)).toBe("map");
    // The list on a desktop: the owner may simply want the quick read.
    expect(viewFor("m", DESKTOP)).toBe("list");
  });

  it("puts the threshold at CONSOLE_MIN_W, exclusive", () => {
    // Pinned absolutely, not relative to the constant - a relative assertion would slide with it
    // and pin nothing, which is how a threshold quietly drifts.
    expect(CONSOLE_MIN_W).toBe(700);
    expect(viewFor("", 699)).toBe("list");
    expect(viewFor("", 700)).toBe("map");
  });

  it("keeps the probe reachable at any width", () => {
    // It is the instrument for measuring phones; routing it by width would defeat the point.
    expect(viewFor("probe", PHONE)).toBe("probe");
    expect(viewFor("probe", DESKTOP)).toBe("probe");
  });

  it("tolerates a leading # and any case", () => {
    // Hashes get hand-typed and pasted from notes.
    expect(viewFor("#m", DESKTOP)).toBe("list");
    expect(viewFor("MAP", PHONE)).toBe("map");
    expect(viewFor("#Probe", DESKTOP)).toBe("probe");
  });

  it("falls back to width for an unknown hash rather than rendering nothing", () => {
    // A stale bookmark or a typo must not produce a blank app.
    expect(viewFor("nonsense", PHONE)).toBe("list");
    expect(viewFor("nonsense", DESKTOP)).toBe("map");
  });
});
