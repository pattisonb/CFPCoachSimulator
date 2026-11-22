// Build the published site: the React app (`ui/`) with the game beside it, to `ui/dist/`.
//
//     node tools/build_site.mjs              # the real rosters, as `npm run dev` shows them
//     node tools/build_site.mjs --generic    # every real name swapped for a lookalike (tools/generic)
//     node tools/build_site.mjs --out DIR    # ... to another folder than ui/dist/
//
// Vercel runs this (vercel.json) and always builds generic: there VERCEL=1 turns `--generic` on by itself, so nothing
// published carries a real school, bowl, player or coach name. Nothing in the repository is changed: the game and the
// app are copied to a scratch folder, the names are swapped there, and the build reads the copy.
//
// What lands in `ui/dist/`: the app (`npm run build` in ui/), `worker.js` (the game's host in the browser) and
// `sim-worker.js` (its helpers), `game.js` (the whole game, app_js/game.js as one script: both workers load it),
// the data pack a career reads (`game-data.br`, brotli, for a server that says so, and the same pack as
// `game-data.gz` for one that does not: see write_pack), `boot/` (the team picker's answers worked out ahead, so the
// first screen shows before the game has loaded: `boot/teams.json` and one `boot/teams/<slug>.json` a team) and
// `version.json` (the commit).
//
// The first offseason's league comes precomputed (league.write_base_files writes data/base_league.json and
// data/base_meta.json, and data/base_development.json for the Depth Chart's first read), so the 146 source rosters
// stay out of the pack; only the fictional teams' files ship.
//
// The dev server (ui/vite.config.ts) uses the same pieces: `bundle_game` for game.js and `dev_pack` for the data pack,
// with the real rosters and nothing written to the repository.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = path.join(ROOT, "tools", "game_host.mjs");      // the game on Node: the generated data and the boot answers

export const JS_DIRS = ["engine_js", "sim_js", "teamdata_js", "career_js", "app_js"];     // the game
// the data a career reads through a season, its offseason and the next season's first week
export const DATA_FILES = [
  "data/engine_teams.json", "data/player_potential.json", "data/recruiting_model.json", "data/history/polls.json",
  "data/schedules.json", "data/schedule_rules.json", "data/series.json", "data/rivalries.json", "data/bowls.json",
  "data/fcs_map.json", "data/game_scale.json", "data/observed_tendencies.json", "data/manual_ratings.json",
  "data/scheme_overrides.json", "data/poll_params.json", "data/program_history.json", "data/program_market.json",
  "data/program_profile.json", "data/real_adjustments.json", "data/coach_birth_years.json", "data/draft_targets.json",
  "data/major_cities.json", "data/base_league.json", "data/base_meta.json", "data/base_development.json",
  "cfb_sim_data/coaches.json", "cfb_sim_data/league.json",
];
export const GENERATED = ["data/engine_teams.json", "data/player_potential.json", "data/base_league.json", "data/base_meta.json",
  "data/base_development.json"];
export const GAME_SCRIPT = "game.js";      // what ui/public/worker.js and sim-worker.js load
export const PACK = "game-data.br";        // what ui/public/worker.js downloads: the data pack, brotli (vercel.json says so to the browser)
export const PACK_GZIP = "game-data.gz";   // ... and the same pack as gzip, for a server that does not
// *tune* how hard brotli packs the data, 0 to 11: 11 is the smallest download (4.1 MB; 5 gives 5.7) and a minute and
// a half of the build. CFP_PACK_QUALITY sets it for one build (a quick one to look at: 5 packs in a second).
const PACK_QUALITY = Number(process.env.CFP_PACK_QUALITY || 11);
const PACK_WINDOW = 24;       // *tune* brotli's window, as a power of two (24: 16 MB, the most a browser reads)
const UI_SKIP = new Set(["node_modules", "dist"]);      // never copied with the app's source

function commit() {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", timeout: 30000 });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : "dev";
}

function run(cmd, args, cwd, env = {}) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...env }, shell: cmd.endsWith(".cmd") });      // (Windows starts a .cmd through its shell)
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})`);
}

const copy_tree = (from, to, skip = new Set()) => fs.cpSync(from, to, { recursive: true, filter: (src) => !skip.has(path.basename(src)) });

/** The generated data, by the game itself: the engine's teams and every player's potential, then the base league. */
export function generate(root, overlay = null) {
  const more = overlay ? [overlay] : [];
  run(process.execPath, [HOST, root, "teams", ...more], root);
  run(process.execPath, [HOST, root, "base", ...more], root);
}

/**
 * Copy the game (and the app's source) to `work`, swap the names there when `generic`, and build the data the game
 * reads (engine teams, the base league). Returns the staged project root.
 */
export async function stage(work, generic) {
  const root = path.join(work, "project");
  for (const d of JS_DIRS) copy_tree(path.join(ROOT, d), path.join(root, d));
  // the preset faces go with the rosters (the player's ask): a face file holds face parts only, keyed by player id
  // and coach name, and a generic build's scrub renames those keys and the file with everything else
  copy_tree(path.join(ROOT, "cfb_sim_data"), path.join(root, "cfb_sim_data"));
  fs.mkdirSync(path.join(root, "data", "history"), { recursive: true });
  for (const name of fs.readdirSync(path.join(ROOT, "data")).sort()) {
    if (name.endsWith(".json") && !GENERATED.includes(`data/${name}`)) fs.copyFileSync(path.join(ROOT, "data", name), path.join(root, "data", name));
  }
  fs.copyFileSync(path.join(ROOT, "data", "history", "polls.json"), path.join(root, "data", "history", "polls.json"));
  copy_tree(path.join(ROOT, "ui"), path.join(root, "ui"), UI_SKIP);
  copy_tree(path.join(ROOT, "pocket-faces"), path.join(root, "pocket-faces"), UI_SKIP);      // the app reads it as source
  if (generic) {
    const scrub = path.join(ROOT, "tools", "generic", "scrub.mjs");
    if (!fs.existsSync(scrub)) throw new Error("tools/generic/scrub.mjs is missing: a generic build cannot swap the names without it");
    await (await import(pathToFileURL(scrub).href)).run(root);
  }
  generate(root);
  return root;
}

/** Every path the data pack holds, relative to the project root; `read(path)` gives a file's text. */
export function game_files(read, list) {
  const meta = JSON.parse(read("data/base_meta.json"));
  return [
    ...DATA_FILES,
    ...Object.keys(meta).sort().filter((s) => meta[s].fictional).map((s) => `cfb_sim_data/teams/${s}.json`),
    ...list("cfb_sim_data/faces").filter((n) => n.endsWith(".json")).sort().map((n) => `cfb_sim_data/faces/${n}`),
  ];
}

/**
 * The game's data as one file, not yet packed: "CFPK", its whole length and its index's length (two 32-bit numbers,
 * low byte first), the index as JSON ([[path, bytes], ...]), then every file's text one after another
 * (ui/public/worker.js `unpack` reads it).
 */
export function pack_bytes(files, read) {
  const bodies = files.map((f) => Buffer.from(read(f), "utf8"));
  const index = Buffer.from(JSON.stringify(files.map((f, i) => [f, bodies[i].length])), "utf8");
  const head = Buffer.alloc(12);
  head.write("CFPK", 0, "latin1");
  head.writeUInt32LE(12 + index.length + bodies.reduce((n, b) => n + b.length, 0), 4);
  head.writeUInt32LE(index.length, 8);
  return Buffer.concat([head, index, ...bodies]);
}

/**
 * The data pack, to `out`: brotli (a little smaller than the xz archive the Python game shipped in, 4.2 MB against
 * 4.6), which the browser itself unpacks when the server sends it with `Content-Encoding: br` (vercel.json), and the
 * same pack as gzip (7.1 MB), which the worker falls back on and unpacks where a server does not.
 */
export function write_pack(root, out) {
  const read = (f) => {
    if (!fs.existsSync(path.join(root, f))) throw new Error(`missing data file for the pack: ${f}`);
    return fs.readFileSync(path.join(root, f), "utf8");
  };
  const files = game_files(read, (dir) => fs.readdirSync(path.join(root, dir)));
  const raw = pack_bytes(files, read);
  const br = zlib.brotliCompressSync(raw, { params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: PACK_QUALITY, [zlib.constants.BROTLI_PARAM_LGWIN]: PACK_WINDOW,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
  fs.writeFileSync(path.join(out, PACK), br);
  const gz = zlib.gzipSync(raw, { level: 9 });
  fs.writeFileSync(path.join(out, PACK_GZIP), gz);
  return { files, raw_bytes: raw.length, pack_bytes: br.length, gzip_bytes: gz.length };
}

/**
 * The whole game as one plain script that sets the global `Game` (ui/game.entry.js), for worker.js and sim-worker.js.
 * `ui`: the app's folder (its node_modules has esbuild and the gzip library). Minified, it has no comments: they are
 * the only place the code names a school.
 */
export function bundle_game(ui, outfile, minify = true) {
  const esbuild = createRequire(path.join(ui, "package.json"))("esbuild");
  esbuild.buildSync({ entryPoints: [path.join(ui, "game.entry.js")], bundle: true, format: "iife", globalName: "Game", minify,
    logLevel: "warning", outfile, absWorkingDir: ui });
}

/** The team picker's answers, asked of the staged game once and written as plain files. Returns how many teams. */
export function write_boot(root, dest) {
  run(process.execPath, [HOST, root, "boot", dest], root);
  return fs.readdirSync(path.join(dest, "teams")).filter((n) => n.endsWith(".json")).length;
}

/** Write the site to `out` (wiped first). */
export async function build({ out = path.join(ROOT, "ui", "dist"), generic = false } = {}) {
  const version = commit();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cfp-site-"));
  try {
    const modules = path.join(ROOT, "ui", "node_modules");
    if (!fs.existsSync(modules)) throw new Error("ui/node_modules is missing: run `npm ci` in ui/ first");
    const root = await stage(tmp, generic);
    const ui = path.join(root, "ui");
    fs.symlinkSync(modules, path.join(ui, "node_modules"), "junction");
    run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], ui, { VITE_GAME_VERSION: version });
    fs.rmSync(out, { recursive: true, force: true });
    copy_tree(path.join(ui, "dist"), out);
    bundle_game(ui, path.join(out, GAME_SCRIPT));
    const pack = write_pack(root, out);
    const teams = write_boot(root, path.join(out, "boot"));
    fs.writeFileSync(path.join(out, "version.json"), JSON.stringify({ commit: version, generic }));
    return { ...pack, teams, game_bytes: fs.statSync(path.join(out, GAME_SCRIPT)).size };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- the dev server's data ----------------------------------------------------------------------------------------

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.isDirectory()) { if (e.name !== "test" && e.name !== "node_modules") yield* walk(path.join(dir, e.name)); }
    else yield path.join(dir, e.name);
  }
}

/** What the generated data is made from, as one word: it changes when a source file or the game's own code does. */
function sources_key() {
  const h = crypto.createHash("sha1");
  const add = (f) => { const s = fs.statSync(f); h.update(`${path.relative(ROOT, f)}:${s.size}:${Math.round(s.mtimeMs)}\n`); };
  for (const d of [...JS_DIRS, "cfb_sim_data"]) for (const f of walk(path.join(ROOT, d))) add(f);
  for (const name of fs.readdirSync(path.join(ROOT, "data")).sort()) if (name.endsWith(".json") && !GENERATED.includes(`data/${name}`)) add(path.join(ROOT, "data", name));
  add(path.join(ROOT, "data", "history", "polls.json"));
  add(fileURLToPath(import.meta.url));
  return h.digest("hex");
}

/**
 * The data pack for `npm run dev`, with the real rosters: the path of the pack (not compressed: it never leaves this
 * computer). The generated data is written under `cache` (never into the repository) and made again only when a
 * source file or the game's code has changed since.
 */
export function dev_pack(cache) {
  const key = sources_key();
  const file = path.join(cache, "game-data.pack"), key_file = path.join(cache, "key.txt");
  if (fs.existsSync(file) && fs.existsSync(key_file) && fs.readFileSync(key_file, "utf8") === key) return file;
  console.log("  Game data: making it (a roster or the game's code has changed since the last time)");
  const overlay = path.join(cache, "generated");
  fs.rmSync(overlay, { recursive: true, force: true });
  fs.mkdirSync(overlay, { recursive: true });
  generate(ROOT, overlay);
  const read = (f) => fs.readFileSync(fs.existsSync(path.join(overlay, f)) ? path.join(overlay, f) : path.join(ROOT, f), "utf8");
  fs.writeFileSync(file, pack_bytes(game_files(read, (dir) => fs.readdirSync(path.join(ROOT, dir))), read));
  fs.writeFileSync(key_file, key);
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const generic = process.argv.includes("--generic") || !!process.env.VERCEL || !!process.env.GENERIC_NAMES;
  const mb = (n) => (n / 1e6).toFixed(1);
  const at = process.argv.indexOf("--out");
  const out = at === -1 ? path.join(ROOT, "ui", "dist") : path.resolve(process.argv[at + 1]);
  build({ out, generic }).then((info) => {
    console.log(`${path.relative(ROOT, out) || out}/: ${PACK} ${mb(info.pack_bytes)} MB (${PACK_GZIP} ${mb(info.gzip_bytes)} MB, ${mb(info.raw_bytes)} MB unpacked), `
      + `${info.files.length} files, ${GAME_SCRIPT} ${mb(info.game_bytes)} MB, ${info.teams} teams, ${generic ? "generic" : "real"} names`);
  }).catch((err) => { console.error(err); process.exit(1); });
}
