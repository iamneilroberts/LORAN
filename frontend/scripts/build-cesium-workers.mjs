/*
 * Build one CLASSIC (non-module) script containing every Cesium web-worker handler, keyed by
 * module id in `self.CesiumWorkers`. Used only by the single-file build (`vite.config.single.ts`).
 *
 * WHY THIS EXISTS - measured, not assumed (docs/decisions.md D-070):
 *
 * A page opened from disk has an opaque origin, so its blob: URLs are `blob:null/...`.
 * Measured in Chrome 149 from a real file:// page:
 *
 *     classic worker from a blob: URL   -> WORKS
 *     classic worker from a data: URL   -> WORKS
 *     MODULE worker from a blob: URL    -> BLOCKED
 *         "Refused to cross-origin redirects of the top-level worker script"
 *     importScripts("blob:null/...")    -> BLOCKED
 *         "Not allowed to load local resource"
 *
 * Cesium 1.143 hard-codes `options.type = "module"` for same-origin worker paths, and its own
 * embedded-workers path (`CESIUM_WORKERS`) uses `importScripts(blobUrl)`. Both of those are in
 * the blocked column above. So the workers must be (a) classic, not module, and (b) inlined
 * into a single script body rather than pulled in with importScripts. That is exactly what this
 * produces; `vite-plugin-cesium-inline.mjs` patches TaskProcessor to consume it.
 *
 * Each Cesium worker module assigns `self.onmessage` as an import side effect, so all of them
 * cannot simply be bundled together - the last one imported would win. The wrapper modules below
 * exploit ES module evaluation order (depth-first, in import order): a wrapper's own body runs
 * immediately after its own import subtree, before the next wrapper is evaluated, so each one
 * captures the `self.onmessage` its worker just installed.
 */
import { build } from "esbuild";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

/*
 * Left out on purpose. These decode 3D Tiles / glTF / compressed-texture payloads, and they
 * embed Emscripten builds that `require("fs")` and cannot be bundled for a browser at all.
 * LORAN renders billboards, labels, polylines and simple geometry over an imagery globe - it
 * loads no tileset, no glTF model and no KTX2/Draco asset - so none of these can be reached.
 * If a future phase adds 3D models, this list is the first thing to revisit.
 */
const OMITTED = new Set([
  "decodeDraco",
  "decodeI3S",
  "transcodeKTX2",
  "gaussianSplatSorter",
  "gaussianSplatTextureGenerator",
]);

export async function buildCesiumWorkers() {
  const engine = path.dirname(require.resolve("@cesium/engine/package.json"));
  const workersDir = path.join(engine, "Source", "Workers");

  const ids = fs
    .readdirSync(workersDir)
    .filter((f) => f.endsWith(".js"))
    // Not a worker - it is the adapter the others wrap themselves in.
    .filter((f) => f !== "createTaskProcessorWorker.js")
    .map((f) => f.replace(/\.js$/, ""))
    .filter((id) => !OMITTED.has(id))
    .sort();

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loran-cesium-workers-"));
  const wrappers = ids.map((id) => {
    const file = path.join(tmp, `w_${id}.js`);
    fs.writeFileSync(
      file,
      `import ${JSON.stringify(path.join(workersDir, `${id}.js`))};\n` +
        `self.CesiumWorkers[${JSON.stringify(id)}] = self.onmessage;\n`,
    );
    return file;
  });

  // The registry has to be created in a module of its own, imported first: a module's own body
  // runs AFTER all of its imports, so initialising it in the entry body would be too late.
  const init = path.join(tmp, "init.js");
  fs.writeFileSync(init, `self.CesiumWorkers = self.CesiumWorkers || {};\n`);

  const entry = path.join(tmp, "entry.js");
  fs.writeFileSync(
    entry,
    [init, ...wrappers].map((w) => `import ${JSON.stringify(w)};`).join("\n") +
      // Leave no handler installed: the consumer picks one out of the registry by module id.
      `\nself.onmessage = null;\n`,
  );

  /*
   * Emscripten builds inside Cesium's dependency graph carry a Node branch that does
   * `require("fs")` / `require("path")`. That branch is dead in a browser (it is guarded by a
   * Node environment check), but esbuild still has to resolve it. Stub both to an empty module
   * so the browser branch is what ships.
   */
  const stubNodeBuiltins = {
    name: "stub-node-builtins",
    setup(b) {
      b.onResolve({ filter: /^(fs|path)$/ }, () => ({ path: "stub", namespace: "loran-stub" }));
      b.onLoad({ filter: /.*/, namespace: "loran-stub" }, () => ({ contents: "export default {};" }));
    },
  };

  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    legalComments: "none",
    write: false,
    logLevel: "error",
    plugins: [stubNodeBuiltins],
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  const code = result.outputFiles[0].text;
  return { code, ids };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { code, ids } = await buildCesiumWorkers();
  process.stderr.write(`${ids.length} workers, ${(code.length / 1048576).toFixed(2)} MB\n`);
  if (process.argv[2]) fs.writeFileSync(process.argv[2], code);
}
