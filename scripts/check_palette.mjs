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

/*
 * Selectors we care about. The default palette lives on a bare `:root`; each alternate theme
 * lives on `:root[data-theme="name"]`. The lookahead keeps `:root` from also matching the
 * theme selectors, which start `:root[`.
 */
const DEFAULT_ROOT = /^\s*:root\s*(?=\{)/gm;
const THEME_ROOT = /^\s*:root\[data-theme=["']?([a-z0-9-]+)["']?\]\s*(?=\{)/gm;

/**
 * Every rule in `src` whose selector matches, as { name, body }. Brace-matched rather than
 * regex'd to the closing `}` so a declaration containing a brace cannot truncate the body.
 */
function rulesMatching(src, selectorRe) {
  const out = [];
  for (const m of src.matchAll(selectorRe)) {
    const open = src.indexOf("{", m.index);
    if (open === -1) continue;
    let depth = 1;
    let i = open + 1;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    out.push({ name: m[1], body: src.slice(open + 1, i - 1) });
  }
  return out;
}

/** Custom properties declared in a rule body, as name -> value. */
function declsIn(body) {
  const out = new Map();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

/*
 * Scope the scrape to the DEFAULT :root block.
 *
 * This used to be one whole-file regex, and `set()` overwrites, so the LAST definition of each
 * name in the file won. Adding any `:root[data-theme=...]` block therefore made this guard
 * compare palette.ts against the THEME's colours and fail the build - a red build that looks
 * nothing like the theme block that caused it.
 */
const defaultRoots = rulesMatching(tokensSrc, DEFAULT_ROOT);
if (defaultRoots.length !== 1) {
  console.error(
    `check:palette FAIL - expected exactly one \`:root {\` block in ${tokensPath}, found ${defaultRoots.length}`,
  );
  process.exit(1);
}
const tokens = declsIn(defaultRoots[0].body);

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

/*
 * Every alternate theme must be a COMPLETE palette, and must not invent names.
 *
 * A typo'd property (`--cyanx`) is silently ignored by CSS, and a colour the theme forgets
 * falls through to the default - either way the theme renders half-applied, which is hard to
 * tell from a rendering bug. Both are cheap to catch here.
 *
 * Only the palette.ts colours are REQUIRED: those are the ones the globe reads back at runtime,
 * so a gap there is what actually looks broken. Non-colour tokens (--mono, --pad) are free to
 * inherit from :root.
 */
for (const theme of rulesMatching(tokensSrc, THEME_ROOT)) {
  const decls = declsIn(theme.body);
  for (const name of decls.keys()) {
    if (!tokens.has(name)) {
      problems.push(`[data-theme="${theme.name}"] defines ${name}, which no :root token declares`);
    }
  }
  for (const name of fallbacks.keys()) {
    if (!decls.has(name)) {
      problems.push(`[data-theme="${theme.name}"] is missing ${name}`);
    }
  }
}

if (problems.length) {
  console.error("check:palette FAIL - tokens.css is the source of truth:");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}

console.log(`check:palette ok - ${fallbacks.size} colours match ${tokensPath}`);
