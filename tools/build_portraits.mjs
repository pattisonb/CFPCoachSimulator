// Builds web/depth/portraits.js, the depth chart's player portraits: tools/portraits/entry.ts and
// everything it reads in the sprite-test project (the locker room's portrait, looks, palettes and
// their JSON). sprite-test's own TypeScript compiler turns the module graph into CommonJS; each
// module goes in the bundle as a function under its path, with a small require() to join them, and
// the entry's exports become window.CFPPortraits. The site has no build step, so the output is
// committed.
//
//   node tools/build_portraits.mjs [path/to/sprite-test]     (default: ../sprite-test)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.resolve(process.argv[2] || path.join(ROOT, "..", "sprite-test"));
const ENTRY = path.join(ROOT, "tools", "portraits", "entry.ts");
const OUT = path.join(ROOT, "web", "depth", "portraits.js");
// one folder holds both projects, so the compiled tree keeps both under it
const BASE = path.dirname(ROOT) === path.dirname(SRC) ? path.dirname(ROOT) : path.parse(ROOT).root;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cfp-portraits-"));
const modules = new Map();     // module id (path under BASE, no extension) -> source
try {
  fs.writeFileSync(path.join(tmp, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "es2021", module: "commonjs", moduleResolution: "node", resolveJsonModule: true, esModuleInterop: true,
      skipLibCheck: true, noCheck: true, removeComments: true, outDir: path.join(tmp, "out"), rootDir: BASE,
      baseUrl: SRC, paths: { "@/*": ["./*"] }, lib: ["es2021", "dom"], types: [],
    },
    files: [ENTRY],
  }));
  execFileSync(path.join(SRC, "node_modules", ".bin", "tsc"), ["-p", path.join(tmp, "tsconfig.json")], { stdio: "inherit" });
  const out = path.join(tmp, "out");
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const file of walk(out)) {
    const rel = path.relative(out, file).split(path.sep).join("/");
    if (rel.endsWith(".js")) modules.set(rel.slice(0, -3), fs.readFileSync(file, "utf8"));
    else if (rel.endsWith(".json")) modules.set(rel, `module.exports = ${JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8")))};`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const id = (abs) => path.relative(BASE, abs).split(path.sep).join("/").replace(/\.ts$/, "");
const entry = id(ENTRY);
const srcRoot = id(SRC);
if (!modules.has(entry)) throw new Error(`the compiler wrote no ${entry}.js`);
// every require must land on a module in the bundle: checked here, not in a player's browser
const resolve = (from, spec) => {
  const base = spec.startsWith("@/") ? `${srcRoot}/${spec.slice(2)}` : path.posix.join(path.posix.dirname(from), spec);
  for (const cand of [base, `${base}/index`]) if (modules.has(cand)) return cand;
  return null;
};
for (const [mid, code] of modules) {
  for (const [, spec] of code.matchAll(/require\("([^"]+)"\)/g)) {
    if (!resolve(mid, spec)) throw new Error(`${mid}: require("${spec}") is not in the bundle (a package import?)`);
  }
}

const commit = (() => { try { return execFileSync("git", ["-C", SRC, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
const body = [...modules].map(([mid, code]) => `${JSON.stringify(mid)}: function (module, exports, require) {\n${code.trim()}\n}`).join(",\n");
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `/* Player portraits for the depth chart: sprite-test's locker room portrait (commit ${commit}) through
   tools/portraits/entry.ts, built by tools/build_portraits.mjs. Do not edit: rebuild it.
   window.CFPPortraits = { portrait, portraitCanvas, CROPS } */
(function () {
"use strict";
const SRC_ROOT = ${JSON.stringify(srcRoot)};
const defs = {
${body}
};
const cache = {};
function dirname(p) { return p.slice(0, p.lastIndexOf("/")); }
function join(dir, spec) {
  const parts = dir ? dir.split("/") : [];
  for (const s of spec.split("/")) { if (s === "..") parts.pop(); else if (s !== ".") parts.push(s); }
  return parts.join("/");
}
function load(id) {
  if (cache[id]) return cache[id].exports;
  const module = cache[id] = { exports: {} };
  defs[id](module, module.exports, (spec) => {
    const base = spec.startsWith("@/") ? SRC_ROOT + "/" + spec.slice(2) : join(dirname(id), spec);
    return load(defs[base] ? base : base + "/index");
  });
  return module.exports;
}
window.CFPPortraits = load(${JSON.stringify(entry)});
})();
`);
console.log(`wrote ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB, ${modules.size} modules) from sprite-test ${commit}`);
