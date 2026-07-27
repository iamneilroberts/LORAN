/**
 * The vitest half of the shared normalizer fixture. Its twin is
 * `backend/tests/test_normalizer_parity.py`, and both read the SAME file.
 *
 * `upstream.ts` reimplements `backend/app/feeds/adsb.py` in TypeScript so the single-file build
 * can reach the feeds with no server behind it (D-070). Two implementations of one contract drift
 * unless something holds them together; this is that something. See `fixtures/adsb/README.md`.
 *
 * `expected` is committed data reviewed by hand against docs/data-sources.md §3.1 — NOT output
 * regenerated from either normalizer. That is what stops this from being a test that passes
 * forever while proving nothing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { normalizeAircraft } from "./upstream";

interface Case {
  name: string;
  provenance: string;
  synthetic: boolean;
  raw: Record<string, unknown>;
  expected: Record<string, unknown> | null;
}

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, "../../../fixtures/adsb/cases.json");
const cases: Case[] = JSON.parse(readFileSync(FIXTURE, "utf8")).cases;

describe("normalizer parity with the Python backend", () => {
  it("finds the shared fixture", () => {
    // Without this, a moved fixture turns every case below into zero cases, which reads as green.
    expect(cases.length).toBeGreaterThanOrEqual(15);
  });

  it("still rests mostly on real captured traffic", () => {
    expect(cases.filter((c) => !c.synthetic).length).toBeGreaterThanOrEqual(8);
  });

  for (const c of cases) {
    it(`${c.synthetic ? "[constructed]" : "[real]"} ${c.name}`, () => {
      expect(normalizeAircraft(c.raw)).toEqual(c.expected);
    });
  }
});
