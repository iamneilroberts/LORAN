import { defineConfig } from "vitest/config";

/**
 * Unit tests only, and deliberately so.
 *
 * Everything else in this project is verified end to end against live traffic, which is honest
 * but goes red at 3 a.m., on a feed hiccup, or when no military contact happens to be in range -
 * all for reasons unrelated to the code. These tests exist to cover the parts that can be
 * checked without a network, a GPU or a viewer: pure geometry, pure normalisation, pure ramps.
 *
 * `node` environment: nothing here touches the DOM. The Cesium imports resolve fine in node -
 * the maths types (Cartesian3, Cartographic) do not need WebGL.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
