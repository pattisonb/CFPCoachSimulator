// The game on Node, for the build and the dev server (tools/build_site.mjs, ui/vite.config.ts): the whole game
// (app_js/game.js) of a project folder, reading and writing that folder's files.
//
//   import { host } from "./game_host.mjs";
//   const game = await host(root);                    // files under `root`
//   const game = await host(root, { overlay });       // ... but everything written lands under `overlay`, which is
//                                                     //     read first (the dev server: nothing is written to the repo)
//
//   node tools/game_host.mjs ROOT teams [OVERLAY]     // data/engine_teams.json and data/player_potential.json
//   node tools/game_host.mjs ROOT base [OVERLAY]      // the base league's three files (career_js/league.js)
//   node tools/game_host.mjs ROOT boot DEST [OVERLAY] // the team picker's answers, as files under DEST
//
// Each command is a process of its own, as each was in the Python build: nothing one step read is still in memory
// for the next.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";

/** The file reader and store of a project folder (engine_js/files.js says what each does). */
export function fileStore(root, overlay = null) {
  const at = (base, p) => (path.isAbsolute(p) ? p : path.join(base, p));
  const find = (p) => (overlay && fs.existsSync(at(overlay, p)) ? at(overlay, p) : at(root, p));
  const out = (p) => at(overlay || root, p);
  const names = (dir) => {
    try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name); } catch { return []; }
  };
  return {
    read: (p) => fs.readFileSync(find(p), "utf8"),
    write: (p, text) => { fs.mkdirSync(path.dirname(out(p)), { recursive: true }); fs.writeFileSync(out(p), text); },
    exists: (p) => fs.existsSync(find(p)),
    remove: (p) => fs.rmSync(out(p), { force: true }),
    remove_dir: (p) => fs.rmSync(out(p), { recursive: true, force: true }),
    list: (p) => [...new Set([...names(at(root, p)), ...(overlay ? names(at(overlay, p)) : [])])].sort(),
    mtime: (p) => { try { return fs.statSync(find(p)).mtimeMs; } catch { return null; } },
  };
}

/** The game of the project at `root`, ready to be called. */
export async function host(root, { overlay = null, env = {} } = {}) {
  const url = (rel) => pathToFileURL(path.join(root, rel)).href;
  const files = await import(url("engine_js/files.js"));
  Object.assign(files.env, env);                      // before the game's modules load: they read it as they do
  const store = fileStore(root, overlay);
  files.set_reader(store.read);
  files.set_store(store);
  const game = await import(url("app_js/game.js"));
  game.career.zip = {
    gzip: (bytes) => new Uint8Array(zlib.gzipSync(bytes)),
    gunzip: (bytes, most) => new Uint8Array(zlib.gunzipSync(bytes, { maxOutputLength: most })),
  };
  return game;
}

const compact = (v) => JSON.stringify(v);

async function main([root, step, ...rest]) {
  if (!root || !step) throw new Error("usage: node tools/game_host.mjs ROOT teams|base|boot [DEST] [OVERLAY]");
  root = path.resolve(root);
  if (step === "teams" || step === "base") {
    const game = await host(root, { overlay: rest[0] || null });
    if (step === "teams") game.modules.build_teams.main([]);
    else game.modules.league.write_base_files();
  } else if (step === "boot") {
    // The team picker's answers, asked of the game once (a game just started gives the same ones). A season it might
    // write goes to a folder of its own.
    const dest = path.resolve(rest[0]);
    const game = await host(root, { overlay: rest[1] || null, env: { CFP_SEASONS_DIR: path.join(dest, ".seasons"), SIM_WORKERS: "1" } });
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.join(dest, "teams"), { recursive: true });
    const teams = game.api.call("GET", "/api/teams");
    fs.writeFileSync(path.join(dest, "teams.json"), compact(teams));
    for (const t of teams.teams) fs.writeFileSync(path.join(dest, "teams", `${t.slug}.json`), compact(game.api.call("GET", `/api/teams/${t.slug}`)));
    fs.rmSync(path.join(dest, ".seasons"), { recursive: true, force: true });
    console.log(`boot: ${teams.teams.length} teams`);
  } else throw new Error(`unknown step: ${step}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => { console.error(err); process.exit(1); });
}
