/*
 * The single-file build: `npm run build:single` -> dist-single/loran.html, one file, no server.
 *
 * This config is entirely separate from vite.config.ts so the normal server-backed build is
 * unaffected by anything in here. See docs/decisions.md D-070 for the measurements behind it
 * and for what the resulting file honestly cannot do.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";
import { createRequire } from "node:module";

import { buildCesiumWorkers } from "./scripts/build-cesium-workers.mjs";
import { cesiumInline, inlineCesiumAssets } from "./scripts/vite-plugin-cesium-inline.mjs";

const require = createRequire(import.meta.url);
const cesiumBuild = path.join(path.dirname(require.resolve("cesium/package.json")), "Build", "Cesium");

/*
 * The only Cesium runtime assets this app actually asks for, established by loading the normal
 * build and watching the network log rather than by guessing:
 *   Assets/approximateTerrainHeights.json  - clamped geometry
 *   Assets/IAU2006_XYS/*.json              - ICRF <-> fixed frame tables, fetched lazily
 *   Assets/Images/ion-credit.png           - credit logo Cesium draws unconditionally
 * Assets/Textures/* is deliberately NOT embedded: it is the stock NaturalEarthII basemap and
 * ~2.6 MB, and this app draws GEBCO bathymetry instead, so nothing can request it.
 */
const XYS = Array.from({ length: 28 }, (_, i) => `Assets/IAU2006_XYS/IAU2006_XYS_${i}.json`);
const INLINE_ASSETS = inlineCesiumAssets(cesiumBuild, [
  "Assets/approximateTerrainHeights.json",
  "Assets/Images/ion-credit.png",
  ...XYS,
]);

const { code: cesiumWorkers } = await buildCesiumWorkers();

export default defineConfig({
  plugins: [cesiumInline(), react(), viteSingleFile({ removeViteModuleLoader: true })],
  define: {
    SINGLE_FILE: "true",
    // Nothing is ever fetched from a base URL in this build; both lookups below are
    // short-circuited before they get that far. Kept defined so Cesium never tries to infer
    // one from a script tag that does not exist in an inlined bundle.
    CESIUM_BASE_URL: JSON.stringify("./"),
    CESIUM_WORKERS: JSON.stringify(cesiumWorkers),
    CESIUM_INLINE_ASSETS: JSON.stringify(INLINE_ASSETS),
  },
  /*
   * Nothing may be copied alongside the HTML, or it is not a single file any more. public/
   * holds two things: the Cesium runtime tree (inlined above instead) and places-small.json,
   * the 3.5 MB small-airfield tier that the LAYERS panel fetches lazily when switched on
   * (D-052). That tier is therefore NOT in this build, and the panel says so rather than
   * offering a toggle that can only fail.
   */
  publicDir: false,
  build: {
    outDir: "dist-single",
    emptyOutDir: true,
    // One chunk, no code splitting, no separate asset files - all of which would defeat the
    // point. `assetsInlineLimit: Infinity` keeps fonts/images in the HTML too.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 40_000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
