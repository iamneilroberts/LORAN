/**
 * Regression guard for a crash that took the whole display down (D-064).
 *
 * Cesium's `Polyline.prototype._destroy` does:
 *     this._material = this._material && this._material.destroy();
 * so EVERY polyline destroys the material it holds. The first version of boundariesLayer built
 * one Material and handed the same object to all 858 state rings - the first polyline destroyed
 * it, the second threw "This object was destroyed, i.e., destroy() was called", and the console
 * halted. Under React 18 StrictMode that fires on the FIRST page load, not on some rare unmount,
 * because StrictMode runs mount -> cleanup -> mount and the cleanup tears the collections down.
 *
 * Nothing in this box can run Cesium (no DOM, no WebGL, D-051), so Cesium is mocked and the
 * property is asserted directly: no two polylines may share a Material instance. That is the
 * exact invariant whose violation caused the crash, and it is invisible to any test that only
 * checks the layer "builds without throwing" - the original broken version did that too.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Small stand-in for the baked file: three rings, so sharing is detectable but the test is fast. */
vi.mock("../data/boundaries.json", () => ({
  default: {
    states: [[0, 0, 1, 1, 2, 2], [10, 10, 11, 11], [20, 20, 21, 21]],
    counties: [[-90, 30, -89, 31], [-88, 32, -87, 33]],
  },
}));

vi.mock("../styles/palette", () => ({
  palette: () => ({ dim: "#5a6b7a", off: "#3a4652" }),
}));

/** Records every polyline added, so the test can inspect what the layer actually handed Cesium. */
class FakePolylineCollection {
  polylines: Record<string, unknown>[] = [];
  show = true;
  add(options: Record<string, unknown>) {
    this.polylines.push(options);
    return options;
  }
  get length() { return this.polylines.length; }
  get(i: number) { return this.polylines[i]; }
}

vi.mock("cesium", () => ({
  Cartesian3: { fromDegreesArray: (a: number[]) => a },
  Color: { fromCssColorString: (s: string) => ({ css: s }) },
  DistanceDisplayCondition: class { constructor(public near: number, public far: number) {} },
  // A FRESH object per call, exactly as the real Material.fromType behaves.
  Material: { fromType: (type: string, uniforms: Record<string, unknown>) => ({ type, uniforms }) },
  PolylineCollection: FakePolylineCollection,
}));

const makeScene = () => {
  const added: FakePolylineCollection[] = [];
  return {
    added,
    scene: {
      primitives: {
        add: (p: FakePolylineCollection) => { added.push(p); return p; },
        remove: vi.fn(),
      },
    },
  };
};

let createBoundariesLayer: typeof import("./boundariesLayer").createBoundariesLayer;

beforeEach(async () => {
  vi.resetModules();
  ({ createBoundariesLayer } = await import("./boundariesLayer"));
});

describe("createBoundariesLayer", () => {
  it("gives every polyline its OWN material instance", async () => {
    const { scene, added } = makeScene();
    const layer = createBoundariesLayer(scene as never);
    layer.setShow(true, true);

    expect(added.length).toBe(2); // states + counties
    for (const collection of added) {
      const materials = collection.polylines.map((p) => p.material);
      expect(materials.length).toBeGreaterThan(1);
      // The assertion the crash was hiding behind: identity, not equality. Sharing one Material
      // makes this Set collapse to size 1 and every polyline after the first fatal on teardown.
      expect(new Set(materials).size).toBe(materials.length);
    }
  });

  it("builds counties only when they are first asked for", async () => {
    // Counties default off and are 3,619 rings in the real file. Paying that at startup for a
    // layer most sessions never enable would delay the thing that matters - first paint.
    const { scene, added } = makeScene();
    const layer = createBoundariesLayer(scene as never);

    layer.setShow(true, false);
    expect(added.length).toBe(1);

    layer.setShow(true, true);
    expect(added.length).toBe(2);
  });

  it("hides an unbuilt layer without building it", async () => {
    const { scene, added } = makeScene();
    const layer = createBoundariesLayer(scene as never);
    layer.setShow(false, false);
    expect(added.length).toBe(0);
  });

  it("reports the ring counts it actually loaded", async () => {
    const { scene } = makeScene();
    const layer = createBoundariesLayer(scene as never);
    expect(layer.counts).toEqual({ states: 3, counties: 2 });
  });

  it("recolours every polyline, not just the first", async () => {
    // With per-polyline materials, recolour must walk the whole collection. When the material
    // was shared, setting it once appeared to work - which is how the original bug survived
    // a reading of this function.
    const { scene, added } = makeScene();
    const layer = createBoundariesLayer(scene as never);
    layer.setShow(true, true);
    layer.recolour();

    for (const collection of added) {
      for (const p of collection.polylines) {
        expect((p.material as { uniforms: { color: unknown } }).uniforms.color).toBeDefined();
      }
    }
  });
});
