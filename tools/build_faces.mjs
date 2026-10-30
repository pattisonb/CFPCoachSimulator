// Builds web/faces.js, the player portraits, from the face generator in the sprite-test project
// (lib/faces: face.ts, geometry.ts, hair.ts and the two hair JSON files they read). Its own
// TypeScript compiler turns the three modules into JavaScript; each goes in its own scope with
// its imports read off the one before, the JSON cut to the hair the generator uses, and the lot
// exposed as window.CFPFaces. The site has no build step, so the output is committed.
//
//   node tools/build_faces.mjs [path/to/sprite-test]     (default: ../sprite-test)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.resolve(process.argv[2] || path.join(ROOT, "..", "sprite-test"));
const LIB = path.join(SRC, "lib", "faces");
const OUT = path.join(ROOT, "web", "faces.js");
const MODULES = ["geometry", "hair", "face"];   // dependency order

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cfp-faces-"));
let parts;
try {
  execFileSync(path.join(SRC, "node_modules", ".bin", "tsc"), [
    ...MODULES.map((m) => path.join(LIB, `${m}.ts`)),
    "--outDir", tmp, "--rootDir", path.join(SRC, "lib"), "--target", "es2021", "--module", "esnext",
    "--moduleResolution", "bundler", "--resolveJsonModule", "--skipLibCheck", "--removeComments",
  ], { stdio: "inherit" });
  parts = MODULES.map((m) => bundle(m, fs.readFileSync(path.join(tmp, "faces", `${m}.js`), "utf8")));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function json(rel) {
  const data = JSON.parse(fs.readFileSync(path.resolve(LIB, rel), "utf8"));
  return JSON.stringify({ hair: data.hair });          // only the hair: hair.ts reads nothing else
}

// one compiled module in its own scope: imports read off the modules before it, exports returned
function bundle(m, code) {
  const exported = [];
  // re-exports ("export { SIZE } from './geometry'") are read off the module they name
  code = code.replace(/^export \{([^}]*)\} from "\.\/(\w+)";\n?/gm, (_, names, mod) => {
    for (const n of names.split(",").map((s) => s.trim()).filter(Boolean)) exported.push(`${n}: __${mod}.${n}`);
    return "";
  });
  code = code.replace(/^import (\w+) from "([^"]+\.json)";$/gm, (_, name, rel) => `const ${name} = ${json(rel)};`);
  code = code.replace(/^import \{([^}]*)\} from "\.\/(\w+)";$/gm, (_, names, mod) => `const {${names}} = __${mod};`);
  code = code.replace(/^export (const|let|function|class) (\w+)/gm, (_, kind, name) => { exported.push(name); return `${kind} ${name}`; });
  if (/^\s*(import|export)\b/m.test(code)) throw new Error(`${m}.js: an import or export the build does not handle`);
  return `const __${m} = (() => {\n${code.trim()}\nreturn { ${exported.join(", ")} };\n})();`;
}

const commit = (() => { try { return execFileSync("git", ["-C", SRC, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
fs.writeFileSync(OUT, `/* Player portraits: the face generator from sprite-test (lib/faces, commit ${commit}), built by
   tools/build_faces.mjs. Do not edit: rebuild it. window.CFPFaces = { randomFace, renderFace, paintFace, SIZE, ... } */
(function () {
"use strict";
${parts.join("\n")}
window.CFPFaces = __face;
})();
`);
console.log(`wrote ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB) from sprite-test ${commit}`);
