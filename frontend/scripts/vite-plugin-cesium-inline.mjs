/*
 * Make CesiumJS run with no server and no sibling files, for the single-file build only.
 * The normal `npm run build` never loads this plugin.
 *
 * Cesium normally fetches two kinds of thing at runtime from CESIUM_BASE_URL:
 *
 *   1. Workers/*.js   - web-worker modules
 *   2. Assets/*       - approximateTerrainHeights.json, the IAU2006_XYS tables, credit images
 *
 * From a file:// page neither can be fetched: a same-directory file:// URL is an opaque-origin
 * resource that fetch/XHR refuses, and Cesium's own worker paths are blocked as well (see the
 * measured table in scripts/build-cesium-workers.mjs). So both are rewritten to point at data
 * already inside the HTML:
 *
 *   - TaskProcessor  -> build each worker as a CLASSIC blob worker whose whole source is inlined
 *   - buildModuleUrl -> return a data: URL for assets we embedded
 *
 * Both patches are exact string replacements against @cesium/engine's source. If a Cesium
 * upgrade changes those lines the build FAILS LOUDLY rather than silently producing a page that
 * opens to a black screen - which is the failure mode this whole exercise has to avoid.
 */
import fs from "node:fs";
import path from "node:path";

const WORKER_NEEDLE = `  /* global CESIUM_WORKERS */
  if (!isUri && typeof CESIUM_WORKERS !== "undefined") {
    // If the workers are embedded, create a shim worker from the embedded script data
    const script = \`
      importScripts("\${urlFromScript(CESIUM_WORKERS)}");
      CesiumWorkers["\${moduleID}"]();
    \`;
    workerPath = urlFromScript(script);
    return new Worker(workerPath, options);
  }`;

/*
 * The replacement differs from Cesium's own embedded path in two ways that are both required
 * from file://:
 *   - the worker bundle is concatenated into the script body instead of being pulled in with
 *     importScripts(), because importScripts() of a blob: URL is blocked at an opaque origin;
 *   - the worker is CLASSIC (no `type: "module"`), because a module worker from a blob: URL is
 *     blocked at an opaque origin.
 * One blob URL is cached per module id so repeat workers do not re-serialise ~1 MB each time.
 */
const WORKER_PATCH = `  /* global CESIUM_WORKERS */
  if (!isUri && typeof CESIUM_WORKERS !== "undefined") {
    TaskProcessor._loranWorkerUrls = TaskProcessor._loranWorkerUrls ?? {};
    let loranUrl = TaskProcessor._loranWorkerUrls[moduleID];
    if (!loranUrl) {
      loranUrl = urlFromScript(
        CESIUM_WORKERS +
          "\\nself.onmessage = self.CesiumWorkers[" + JSON.stringify(moduleID) + "];\\n",
      );
      TaskProcessor._loranWorkerUrls[moduleID] = loranUrl;
    }
    return new Worker(loranUrl);
  }`;

const ASSET_NEEDLE = `  const url = implementation(relativeUrl);
  return url;`;

const ASSET_PATCH = `  /* global CESIUM_INLINE_ASSETS */
  if (
    typeof CESIUM_INLINE_ASSETS !== "undefined" &&
    Object.prototype.hasOwnProperty.call(CESIUM_INLINE_ASSETS, relativeUrl)
  ) {
    return CESIUM_INLINE_ASSETS[relativeUrl];
  }
  const url = implementation(relativeUrl);
  return url;`;

const MIME = { ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg" };

/**
 * Read the listed files out of the installed Cesium build and turn them into data: URLs,
 * keyed by the relative path Cesium asks buildModuleUrl for.
 */
export function inlineCesiumAssets(cesiumBuildDir, relativePaths) {
  const out = {};
  for (const rel of relativePaths) {
    const abs = path.join(cesiumBuildDir, rel);
    if (!fs.existsSync(abs)) throw new Error(`cesium-inline: missing asset ${rel} in ${cesiumBuildDir}`);
    const mime = MIME[path.extname(abs)] ?? "application/octet-stream";
    out[rel] = `data:${mime};base64,${fs.readFileSync(abs).toString("base64")}`;
  }
  return out;
}

export function cesiumInline() {
  let patchedTaskProcessor = false;
  let patchedBuildModuleUrl = false;

  return {
    name: "loran-cesium-inline",
    enforce: "pre",

    transform(code, id) {
      if (id.includes("@cesium/engine") && id.endsWith("Core/TaskProcessor.js")) {
        if (!code.includes(WORKER_NEEDLE)) {
          throw new Error(
            "cesium-inline: could not find the CESIUM_WORKERS block in TaskProcessor.js. " +
              "Cesium's worker bootstrap has changed - re-check scripts/vite-plugin-cesium-inline.mjs " +
              "against the installed version before trusting the single-file build.",
          );
        }
        patchedTaskProcessor = true;
        return { code: code.replace(WORKER_NEEDLE, WORKER_PATCH), map: null };
      }

      if (id.includes("@cesium/engine") && id.endsWith("Core/buildModuleUrl.js")) {
        if (!code.includes(ASSET_NEEDLE)) {
          throw new Error(
            "cesium-inline: could not find the resolve block in buildModuleUrl.js. " +
              "Re-check scripts/vite-plugin-cesium-inline.mjs against the installed Cesium.",
          );
        }
        patchedBuildModuleUrl = true;
        return { code: code.replace(ASSET_NEEDLE, ASSET_PATCH), map: null };
      }

      return null;
    },

    // A build that quietly skipped a patch would produce a plausible-looking but broken file.
    buildEnd() {
      const missed = [
        !patchedTaskProcessor && "TaskProcessor.js",
        !patchedBuildModuleUrl && "buildModuleUrl.js",
      ].filter(Boolean);
      if (missed.length) {
        throw new Error(`cesium-inline: never saw ${missed.join(" and ")} - patch not applied.`);
      }
    },
  };
}
