// Holds career_js/position_fit.js and sim_js/game_job.js's with_positions to Python's answers
// (position_fit_reference.py writes them): node career_js/test/position_fit_compare.mjs out.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { set_reader, read_json } from "../../engine_js/files.js";
import { game_scale } from "../../teamdata_js/game_scale.js";
import { position_fit } from "../position_fit.js";
import { with_positions, with_edits, NotHere } from "../../sim_js/game_job.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const node_reader = (p) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), "utf8");
set_reader(node_reader);

const ref = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const GROUP = { QB: "QB", HB: "RB", FB: "RB", WR: "WR", TE: "TE", LT: "OL", LG: "OL", C: "OL", RG: "OL", RT: "OL",
  LEDG: "DL", REDG: "DL", DT: "DL", SAM: "LB", MIKE: "LB", WILL: "LB", CB: "CB", FS: "S", SS: "S", K: "K", P: "P" };    // offseason.GROUP

// exactly the same: every number the same double, every key, and the keys in the same order
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && same(a[k], b[k]));
}
const pairs = (o) => Object.entries(o);

const counts = {};
const wrong = [];
function check(what, got, want, where) {
  const c = (counts[what] ??= { n: 0, bad: 0 });
  c.n++;
  if (!same(got, want)) {
    c.bad++;
    if (wrong.length < 12) wrong.push(`${what} ${where}: got ${JSON.stringify(got).slice(0, 300)} want ${JSON.stringify(want).slice(0, 300)}`);
  }
}

check("sizes", position_fit.sizes(), ref.sizes, "");
for (const pos of Object.keys(ref.sizes)) check("sizes (per position)", position_fit.sizes()[pos], ref.sizes[pos], pos);
for (const [h, w, pos, want] of ref.size_penalty) check("size_penalty", position_fit.size_penalty(h, w, pos), want, `${h} ${w} ${pos}`);

const teams = read_json("data/engine_teams.json")["teams"];
const keys = game_scale.keys();
const ROLES = ref.roles;
for (const row of ref.players) {
  const [slug, unit, i] = row.at;
  const p = teams[slug][unit][i];
  const attrs = Object.fromEntries(keys.map((k, j) => [k, p.skills[j]]).filter((kv) => kv[1] !== undefined));
  const h = p.height_in ?? null, w = p.weight ?? null, role = p.role;
  ROLES.forEach((to, j) => {
    const where = `${slug} ${p.slug} ${role}->${to}`;
    check("season_move", position_fit.season_move(p, role, to), row.season_move[j], where);
    check("project", position_fit.project(attrs, h, w, role, to), row.project[j], where);
    if (row.transfer) check("transfer", pairs(position_fit.transfer(attrs, role, to)), row.transfer[j], where);
  });
  if (row.engine) ref.engine_positions.forEach((to, j) => {
    check("project/transfer (engine positions)", [position_fit.project(attrs, h, w, p.position, to), Object.values(position_fit.transfer(attrs, p.position, to))],
      row.engine[j], `${slug} ${p.slug} ${p.position}->${to}`);
  });
  if (row.options) for (const [cur, want] of row.options) check("options", position_fit.options(attrs, h, w, role, cur, GROUP), want, `${slug} ${p.slug} ${role} now ${cur}`);
}

for (const [n, c] of ref.move_row.entries()) {
  const row = structuredClone(c.row);
  c.steps.forEach((to, j) => {
    position_fit.move_row(row, to, ref.attrs);
    check("move_row", pairs(row), c.after[j], `row ${n} ${c.row.id} ${c.row.pos} step ${j} -> ${to}`);
  });
  position_fit.settle([row]);
  check("settle", pairs(row), c.settled, `row ${n}`);
}

for (const c of ref.with_positions) {
  const team = teams[c.slug];
  const before = JSON.stringify(team);
  const got = with_positions(team, c.moves);
  check("with_positions (the same team back when nobody moves)", got === team, c.same, c.slug);
  check("with_positions", { keys: Object.keys(got), offense: got.offense, defense: got.defense }, { keys: c.keys, offense: c.offense, defense: c.defense }, c.slug);
  check("with_positions (the rest of the team untouched)", Object.keys(got).every((k) => k === "offense" || k === "defense" || got[k] === team[k]), true, c.slug);
  if (c.edits) {
    const e = with_edits(team, c.edits);
    check("with_edits (__positions__)", { offense: e.offense, defense: e.defense }, c.edited, c.slug);
  }
  check("with_positions (the team given is not changed)", JSON.stringify(team) === before, true, c.slug);
}

// a host with the league's teams and nothing else (a browser helper): the job is not played here
{
  const c = ref.with_positions.find((x) => !x.same);
  const team = structuredClone(teams[c.slug]);
  set_reader((p) => { throw new Error(`${p} is not here`); });
  game_scale._card_overall.cache_clear?.();
  position_fit.sizes.cache_clear();
  let threw = null;
  try { with_edits(team, { __positions__: c.moves }); } catch (err) { threw = err; }
  check("with_edits (no data files: NotHere)", threw instanceof NotHere, true, c.slug);
  // ... and position_fit.sizes falls back to the hand table, as Python does without the file
  check("sizes (no file: the hand table)", position_fit.sizes(), position_fit.HAND_SIZES, "");
  position_fit.sizes.cache_clear();
  set_reader(node_reader);
}

let bad = 0;
for (const [what, c] of Object.entries(counts)) {
  bad += c.bad;
  console.log(`${c.bad ? "MISMATCH" : "ok      "} ${what}: ${c.n} compared, ${c.n - c.bad} identical${c.bad ? `, ${c.bad} different` : ""}`);
}
for (const w of wrong) console.log(w);
process.exit(bad ? 1 : 0);
