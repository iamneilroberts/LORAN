/*
 * Fail the build if palette.ts's documented fallbacks have drifted from tokens.css (D-042).
 *
 * The point of the palette refactor is that the colours live in ONE place. palette.ts still
 * carries literal fallbacks for the case where styles have not applied, and a fallback that
 * silently disagrees with the real token is worse than no fallback at all: the globe would draw
 * one colour and the chrome another, intermittently, depending on load timing.
 *
 * Run by `npm run build`. No dependencies - plain node, invoked from the frontend directory.
 */
import { readFileSync } from "node:fs";

const tokensPath = "src/styles/tokens.css";
const palettePath = "src/styles/palette.ts";

const tokensSrc = readFileSync(tokensPath, "utf8");
const paletteSrc = readFileSync(palettePath, "utf8");

/** Custom properties defined on :root, as name -> value. Only hex colours are compared. */
const tokens = new Map();
for (const m of tokensSrc.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gim)) {
  tokens.set(m[1], m[2].trim());
}

/** The FALLBACK object literal in palette.ts. */
const block = paletteSrc.match(/const FALLBACK[^=]*=\s*\{([\s\S]*?)\n\};/);
if (!block) {
  console.error("check:palette FAIL - could not find the FALLBACK map in " + palettePath);
  process.exit(1);
}

const fallbacks = new Map();
for (const m of block[1].matchAll(/"(--[a-z0-9-]+)"\s*:\s*"([^"]+)"/g)) {
  fallbacks.set(m[1], m[2].trim());
}

const problems = [];
for (const [name, value] of fallbacks) {
  if (!tokens.has(name)) {
    problems.push(`${name}: in palette.ts but NOT defined in ${tokensPath}`);
    continue;
  }
  const want = tokens.get(name);
  if (want.toLowerCase() !== value.toLowerCase()) {
    problems.push(`${name}: tokens.css says ${want}, palette.ts fallback says ${value}`);
  }
}

if (problems.length) {
  console.error("check:palette FAIL - tokens.css is the source of truth:");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}

console.log(`check:palette ok - ${fallbacks.size} colours match ${tokensPath}`);
