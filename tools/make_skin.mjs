// Make the skin that gives the published game the repository's own names and rosters.
//
//     node tools/make_skin.mjs                    # to skins/real-names.skin.json and .json.gz
//     node tools/make_skin.mjs --out FILE         # ... to FILE and FILE.gz
//     node tools/make_skin.mjs --name "Real Names 2026" --id real-names-2026
//
// The published site carries lookalike names (tools/generic). A skin is one file a player loads on the site's first
// screen (Load a Skin) to see other names and rosters in his own browser: ui/public/skin.js says how. This one holds
// what the swap took out: the source rosters, coaches, faces and data files, and for every lookalike the name it
// stands for. Either file loads: the .gz is the same skin, smaller.
//
// A SKIN IS NEVER PUBLISHED AND NEVER COMMITTED. It holds the names the published site must not carry: it goes to a
// git-ignored place (skins/, *.skin.json*) and from there straight to the player. tests/test_skin.mjs holds the
// build to that.
//
// How: the game is staged twice in a scratch folder, as tools/build_site.mjs stages it for a build, with the swap and
// without; the skin is what differs (tools/skin.mjs `make`). The repository is not changed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import * as build from "./build_site.mjs";
import { Maps } from "./generic/scrub.mjs";
import { make } from "./skin.mjs";

/** The skin of the repository as it stands: {skin, json: its text}. */
export async function make_skin({ id = "real-names", name = "Real Names" } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cfp-skin-"));
  try {
    const generic = await build.stage(path.join(tmp, "generic"), true);
    const real = await build.stage(path.join(tmp, "real"), false);
    const read = (f) => fs.readFileSync(path.join(generic, f), "utf8");
    const files = build.game_files(read, (dir) => fs.readdirSync(path.join(generic, dir)));
    const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: build.ROOT, encoding: "utf8" });
    const skin = make(build, { files, read }, real, new Maps(build.ROOT), { id, name, commit: r.status === 0 ? r.stdout.trim() : "" });
    return { skin, json: JSON.stringify(skin) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (flag, fallback) => { const at = process.argv.indexOf(flag); return at === -1 ? fallback : process.argv[at + 1]; };
  const id = arg("--id", "real-names");
  const out = path.resolve(arg("--out", path.join(build.ROOT, "skins", `${id}.skin.json`)));
  const mb = (n) => (n / 1e6).toFixed(1);
  make_skin({ id, name: arg("--name", "Real Names") }).then(({ skin, json }) => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, json);
    const gz = zlib.gzipSync(json, { level: 9 });
    fs.writeFileSync(`${out}.gz`, gz);
    console.log(`${out}: ${mb(Buffer.byteLength(json))} MB (${out}.gz ${mb(gz.length)} MB): "${skin.name}", `
      + `${Object.keys(skin.files).length} files, ${Object.keys(skin.sources).length} rosters and sources, ${Object.keys(skin.words).length} names. Never commit or publish it.`);
  }).catch((err) => { console.error(err); process.exit(1); });
}
