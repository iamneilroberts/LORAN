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
import { describe, expect, it } from "vitest";

import { normalizeAircraft } from "./upstream";
// Imported rather than read with node:fs, and that is deliberate. `npm run build` typechecks
// everything under src/, the Dockerfile runs that build, and this project's tsconfig declares
// `types: ["vite/client"]` with no @types/node - so a node: import compiles on a developer
// machine whose node_modules happens to resolve those types and FAILS in the container that
// actually ships. Adding @types/node would need a dependency decision (CLAUDE.md rule 2);
// resolveJsonModule is already on, so nothing new is needed.
import fixture from "../../../fixtures/adsb/cases.json";

interface Case {
  name: string;
  provenance: string;
  synthetic: boolean;
  raw: Record<string, unknown>;
  expected: Record<string, unknown> | null;
}

const cases = fixture.cases as unknown as Case[];

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
