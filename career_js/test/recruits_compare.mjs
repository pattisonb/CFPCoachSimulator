// Holds career_js/recruits.js to Python's answers (recruits_reference.py writes them):
//   node career_js/test/recruits_compare.mjs out.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { set_reader } from "../../engine_js/files.js";
import { Random } from "../../engine_js/pyrt.js";
import { modules } from "../../engine_js/modules.js";
import { recruits, pypow, pysum } from "../recruits.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const node_reader = (p) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), "utf8");
set_reader(node_reader);

const ref = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

// exactly the same: every number the same double, every key, and the keys in the same order
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && same(a[k], b[k]));
}
const copy = (x) => JSON.parse(JSON.stringify(x));

const counts = {};
const wrong = [];
function check(what, got, want, where = "") {
  const c = (counts[what] ??= { n: 0, bad: 0 });
  c.n++;
  if (!same(got, want)) {
    c.bad++;
    if (wrong.length < 20) wrong.push(`${what} ${where}: got ${JSON.stringify(got)?.slice(0, 300)} want ${JSON.stringify(want)?.slice(0, 300)}`);
  }
}

check("registered", modules.recruits === recruits, true);
const m = recruits.model();
const gen = m["generation"], pl = m["players"];

// the model's dicts: where JavaScript's key order is not the file's (keys that are whole numbers come first, in order)
const at = (p) => p.reduce((o, k) => o[k], m);
const differs = ref.key_orders.filter(([p, keys]) => !same(Object.keys(at(p)), keys));
const kinds = new Map();
for (const [p] of differs) {
  const kind = p.map((k, i) => (i >= 2 && p[1] === "state_share" && i === 2 ? "<state>" : k)).join("/");
  kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
}
console.log(`model dicts: ${ref.key_orders.length}, key order differs from the file's in ${differs.length}:`);
for (const [kind, n] of kinds) console.log(`  ${kind}${n > 1 ? ` (${n})` : ""}`);
// the dicts a draw's population or a result's order is taken from must not be among them
const iterated = (p) => (p[0] === "generation" && p[1] === "position_share" && p.length === 3)
  || (p[0] === "generation" && p[1] === "state_share" && p.length === 2)
  || (p[0] === "players" && p[1] === "names" && p[2] === "suffix")
  || (p[0] === "players" && p[1] === "position_map" && p.length <= 3)
  || (p[0] === "players" && p[1] === "shapes" && (p.length === 2 || p[3] === "fixed"))
  || (p[0] === "players" && p[1] === "overall_fit" && p[3] === "weights")
  || (p[0] === "players" && p[1] === "targets" && p[2] === "overall_by_stars_and_years");
check("iterated model dicts in the file's order", differs.filter(([p]) => iterated(p)).map(([p]) => p.join("/")), []);

// constants
const K = ref.constants;
check("REALIZED", recruits.REALIZED, K.REALIZED);
check("RATE", recruits.RATE, K.RATE);
check("COACHABILITY", recruits.COACHABILITY, K.COACHABILITY);
check("-POTENTIAL_SD ** 2 / 2", -Math.pow(recruits.POTENTIAL_SD, 2) / 2, K.potential_mean);
check("sqrt(1 - HEIGHT_WEIGHT_R ** 2)", Math.sqrt(1 - Math.pow(recruits.HEIGHT_WEIGHT_R, 2)), K.size_root);
for (const [rate, left, want] of K.powers) check("(1 - rate) ** left", pypow(1 - rate, left), want, `${rate} ${left}`);
// The two helpers recruits.js has for what JavaScript does differently. pysum must be Python's sum exactly. pypow is
// the true power rounded once; the C library's pow that Python asks is that nearly always, not always, so on
// arbitrary numbers the count is only printed: every power the file itself takes is held exactly, just above.
let pow_off = 0, math_pow_off = 0, sum_off = 0, exp_off = 0;
for (const [x, n, want] of ref.pow) {
  if (pypow(x, n) !== want) pow_off++;
  if (Math.pow(x, n) !== want) math_pow_off++;
}
for (const [xs, want, again] of ref.sum) {
  check("pysum (Python's sum of floats)", [pysum(xs), pysum(xs)], [want, again], `${xs.length} numbers`);
  if (xs.reduce((a, x) => a + x, 0) !== want) sum_off++;
}
for (const [x, want] of ref.exp) if (Math.exp(x) !== want) exp_off++;
console.log(`for the record, on arbitrary numbers: pypow is not Python's ** in ${pow_off} of ${ref.pow.length} (Math.pow in ${math_pow_off}); `
  + `Math.exp is not math.exp in ${exp_off} of ${ref.exp.length}; a plain left-to-right sum is not Python's sum in ${sum_off} of ${ref.sum.length}`);

for (const [x, want] of ref.curve) check("curve", recruits.curve(x), want, `${x}`);
for (const [band, u, want] of ref.from_quantiles) check("from_quantiles", recruits.from_quantiles(gen["rating_quantiles"][band], u), want, `${band} ${u}`);

// weighted
const state_pairs = (b) => Object.entries(gen["state_share"]).map(([s, v]) => [s, v[b] ?? 0]);
for (const [what, n, want, next] of ref.weighted) {
  const [kind, arg] = what.split("|");
  const pairs = () => (kind === "first" || kind === "last" ? pl["names"][kind]
    : kind === "suffix" ? Object.entries(pl["names"]["suffix"])
      : kind === "position_share" ? Object.entries(gen["position_share"][arg])
        : kind === "position_map" ? Object.entries(pl["position_map"][arg])
          : kind === "state_share" ? state_pairs(arg)
            : recruits.COACHABILITY.map(([nm, _, s]) => [nm, s]));
  const rng = new Random(`weighted-${n}`);
  const got = [];
  for (let i = 0; i < 400; i++) got.push(recruits.weighted(rng, pairs()));
  check("weighted (400 draws of one population, and the generator after)", [got, rng.random()], [want, next], what);
}

// the classes: the whole list at once, and prospect by prospect so a difference is counted and found
for (const c of ref.classes) {
  const taken = c.taken === "none" ? null : new Set(c.taken === "rosters" ? ref.roster_names : []);
  const got = taken === null ? recruits.generate_class(c.year, c.seed) : recruits.generate_class(c.year, c.seed, taken, c.scored);
  const where = `${c.year} seed ${c.seed} taken ${c.taken} scored ${c.scored}`;
  check("generate_class (the whole class)", got, c.class, where);
  check("generate_class (as JSON text)", JSON.stringify(got) === JSON.stringify(c.class), true, where);
  check("generate_class (how many)", got.length, c.class.length, where);
  c.class.forEach((p, i) => {
    check("generate_class (prospects)", got[i], p, `${where} #${i + 1}`);
    if (got[i]) for (const k of Object.keys(p)) check("generate_class (fields)", got[i][k], p[k], `${where} #${i + 1} ${k}`);
  });
  if (taken !== null) check("generate_class (the names taken after)", [...taken].sort(), c.taken_after, where);
}

for (const [pos, arch, ratings, want] of ref.overall_ea) check("overall_ea", recruits.overall_ea(pos, arch, ratings), want, `${pos} ${arch}`);
for (const [before, want] of ref.rescore) {
  const q = copy(before);
  check("rescore (returns nothing)", recruits.rescore(q), undefined);
  check("rescore", q, want, before.id);
}

for (const [i, full, want, next] of ref.name) {
  const rng = new Random(`name-${i}`);
  const taken = new Set(full ? ref.roster_names : []);
  const got = [];
  for (let j = 0; j < 5; j++) got.push(recruits._name(rng, taken));
  check("_name (5 names, and the generator after)", [got, rng.random()], [want, next], `${i}`);
}
{
  const full = { has: () => true, add: () => { throw new Error("a taken name was added"); } };     // every name is in it
  const rng = new Random("name-full");
  const got = [];
  for (let j = 0; j < 3; j++) got.push(recruits._name(rng, full));
  check("_name (every name taken: fifty tries, then the last)", [got, rng.random()], ref.name_full);
}

ref.attributes.forEach(([pos, band, composite, ratings, arch, next], i) => {
  const rng = new Random(`attributes-${i}`);
  const got = recruits._attributes(rng, pos, band, composite);
  check("_attributes", [got[0], got[1], rng.random()], [ratings, arch, next], `${i} ${pos} ${band}`);
});
ref.potential.forEach(([pos, stars, ratings, want, next], i) => {
  const rng = new Random(`potential-${i}`);
  check("_potential", [recruits._potential(rng, pos, stars, ratings), rng.random()], [want, next], `${i} ${pos} ${stars}`);
});
ref.recruit.forEach(([band, scored, want, taken_after, next], i) => {
  const rng = new Random(`recruit-${i}`);
  const taken = new Set();
  const got = scored ? recruits.recruit(rng, 2030, band, taken) : recruits.recruit(rng, 2030, band, taken, false);
  check("recruit", [got, [...taken].sort(), rng.random()], [want, taken_after, next], `${i} ${band}`);
});

ref.develop.forEach(([p, plain, factor, years, next], i) => {
  const q = copy(p);
  const rng = new Random(`develop-${i}`);
  const got = [];
  for (let y = 0; y < 4; y++) {
    if (plain) recruits.develop(q, rng); else recruits.develop(q, rng, factor);
    got.push(copy(q));
  }
  check("develop (four offseasons, and the generator after)", [got, rng.random()], [years, next], p.id);
});
for (const [p, team, slug, jersey, want] of ref.as_roster_player) {
  const before = JSON.stringify(p);
  const got = jersey === null ? recruits.as_roster_player(p, team, slug) : recruits.as_roster_player(p, team, slug, jersey);
  check("as_roster_player", got, want, slug);
  got.ratings.speed = -1; got.hometown.city = "x";            // copies, as Python's dict(...) are
  check("as_roster_player (the prospect untouched)", JSON.stringify(p), before, slug);
}

// the real players
check("_norms", recruits._norms(), ref.norms);
const names = fs.readdirSync(path.join(ROOT, "cfb_sim_data/teams")).filter((n) => n.endsWith(".json")).sort();
check("the teams' files, in order", names, ref.team_files);
let players = [];
for (const n of ref.team_files) players = players.concat(JSON.parse(node_reader(`cfb_sim_data/teams/${n}`))["roster"]);
const seeded = recruits.seed_real_players(players);
check("seed_real_players (everyone)", seeded, ref.seed_real_players);
check("seed_real_players (the order)", Object.keys(seeded), ref.seed_real_players_order);
for (const [slug, want] of Object.entries(ref.seed_real_players)) check("seed_real_players (players)", seeded[slug], want, slug);
{
  const [odd, want, order] = ref.seed_odd;
  const got = recruits.seed_real_players(odd);
  check("seed_real_players (odd rows)", [got, Object.keys(got)], [want, order]);
}
{
  let written = null;
  const n = recruits.write_player_potential((dir) => fs.readdirSync(path.join(ROOT, dir)), (p, text) => { written = [p, text]; });
  check("write_player_potential (how many)", n, ref.seed_real_players_order.length);
  check("write_player_potential (the file's path)", written?.[0], "data/player_potential.json");
  check("write_player_potential (the file's text)", written?.[1] === ref.potential_text, true);
}

let bad = 0;
for (const [what, c] of Object.entries(counts)) {
  bad += c.bad;
  console.log(`${c.bad ? "DIFFERENT" : "same     "} ${what}: ${c.n - c.bad}/${c.n}`);
}
for (const w of wrong) console.log(w);
console.log(bad ? `${bad} differences` : "every answer the same as Python's");
process.exit(bad ? 1 : 0);
