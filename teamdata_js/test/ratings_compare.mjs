// Holds teamdata_js/ratings.js and teamdata_js/shown.js to the Python they were ported from: every case in the file
// teamdata_js/test/ratings_reference.py wrote is asked of the JavaScript and must come back the same, number for
// number (and key for key, in the same order).
//
//   python3 teamdata_js/test/ratings_reference.py out.json && node teamdata_js/test/ratings_compare.mjs out.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { set_reader } from "../../engine_js/files.js";
import { ratings } from "../ratings.js";
import { shown } from "../shown.js";
import { game_scale } from "../game_scale.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
set_reader((p) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), "utf8"));

const ref = JSON.parse(fs.readFileSync(process.argv[2] || "out.json", "utf8"));
const players = ref.players;

/** A dict as its items in order, as the reference wrote it. */
const pairs = (d) => Object.entries(d).map(([k, v]) =>
  [k, v !== null && typeof v === "object" && !Array.isArray(v) ? pairs(v) : v]);
const unpairs = (ps) => Object.fromEntries(ps);
const formulas = (src) => Object.values(ratings.ATTRIBUTES).map((a) => a[3](src));
const KNOTS = { OVERALL_KNOTS: shown.OVERALL_KNOTS, COACH_KNOTS: shown.COACH_KNOTS, unit: shown.TEAM_KNOTS.unit };
// an argument the Python call left out (a default) is left out here too
const call = (f, args) => f(...args);

const run = {
  "ratings.formulas": ([i]) => formulas(players[i].ratings),
  "ratings.formulas_of": ([src]) => formulas(src),
  "ratings.raw_attributes": ([i, ...rest]) => pairs(ratings.raw_attributes(players[i].ratings, ...rest)),
  "ratings.raw_attributes_of": (args) => pairs(call(ratings.raw_attributes, args)),
  "ratings.card_group": (args) => call(ratings.card_group, args),
  "ratings.composite_weights": (args) => pairs(call(ratings.composite_weights, args)),
  "ratings.height_inches": (args) => call(ratings.height_inches, args),
  "ratings.traits_of": (args) => call(ratings.traits_of, args),
  "shown._line": ([name, x]) => shown._line(KNOTS[name], x),
  "shown._card": (args) => call(shown._card, args),
  "shown.team_ratings": (args) => pairs(call(shown.team_ratings, args)),
  "shown.skills": ([sk, g]) => sk.map((v, j) => shown.skill(v, g, game_scale.keys()[j])),
  "shown.attributes": ([at, cg]) => at.map(([k, v]) => shown.attribute(v, cg, k)),
  "shown.skill_grid": ([g, k, values]) => values.map((v) => shown.skill(v, g, k)),
  "shown.skill_back_grid": ([g, k, values]) => values.map((v) => shown.skill_back(v, g, k)),
  "shown.attribute_grid": ([g, k, values]) => values.map((v) => shown.attribute(v, g, k)),
  "shown.attribute_back_grid": ([g, k, values]) => values.map((v) => shown.attribute_back(v, g, k)),
};
for (const f of ["overall_exact", "overall", "overall_back", "team", "coach", "gain", "from_base", "to_base", "skill", "attribute"]) {
  run[`shown.${f}`] = (args) => call(shown[f], args);
}

const tables = {
  "ratings.ATTRIBUTES": () => Object.entries(ratings.ATTRIBUTES).map(([k, v]) => [k, v.slice(0, 3)]),
  "ratings.PHYSICAL": () => ratings.PHYSICAL,
  "ratings.POSITION_ATTRIBUTES": () => pairs(ratings.POSITION_ATTRIBUTES),
  "ratings._CARD_GROUP": () => pairs(ratings._CARD_GROUP),
  "ratings.ARCHETYPES": () => pairs(ratings.ARCHETYPES),
  "ratings.TRAITS": () => [...ratings.TRAITS.entries()],
  "ratings.TRAIT_TIERS": () => pairs(ratings.TRAIT_TIERS),
  "ratings.TIER_NAMES": () => pairs(ratings.TIER_NAMES),
  "ratings.TRAIT_INFO": () => pairs(ratings.TRAIT_INFO),
  "ratings.TRAIT_KEYS": () => pairs(ratings.TRAIT_KEYS),
  "ratings.COMPOSITES": () => pairs(ratings.COMPOSITES),
  "shown.OVERALL_KNOTS": () => shown.OVERALL_KNOTS,
  "shown.LOW": () => shown.LOW,
  "shown.HIGH": () => shown.HIGH,
  "shown.TEAM_KNOTS": () => pairs(shown.TEAM_KNOTS),
  "shown.COACH_KNOTS": () => shown.COACH_KNOTS,
  "shown._curve": () => shown._curve(),
};

// the same value: JSON text of both (a number's shortest text is the number itself, so equal text is equal numbers;
// a missing answer, undefined, is not null)
const same = (a, b) => a !== undefined && JSON.stringify(a) === JSON.stringify(b);

const counts = {}, bad = {};
let shownBad = 0;
function check(name, args, got, want) {
  counts[name] = (counts[name] || 0) + 1;
  if (same(got, want)) return;
  bad[name] = (bad[name] || 0) + 1;
  if (shownBad++ < 25) {
    console.log(`MISMATCH ${name}(${JSON.stringify(args).slice(0, 300)})\n  python: ${JSON.stringify(want).slice(0, 400)}\n  js:     ${JSON.stringify(got)?.slice(0, 400)}`);
  }
}

for (const [name, want] of Object.entries(ref.tables)) {
  let got;
  try { got = tables[name](); } catch (e) { got = `threw ${e.message}`; }
  check(`table ${name}`, [], got, want);
}
// the aliases Python makes are the same objects here too
check("table ratings.COMPOSITES aliases", [], [ratings.COMPOSITES.TE === ratings.COMPOSITES.WR,
  ratings.COMPOSITES.S === ratings.COMPOSITES.CB, ratings.COMPOSITES.FB === ratings.COMPOSITES.RB], [true, true, true]);
for (const [name, args, want] of ref.cases) {
  let got;
  try { got = run[name](args); } catch (e) { got = `threw ${e.message}`; }
  check(name, args, got, want);
}

let total = 0, wrong = 0;
for (const name of Object.keys(counts).sort()) {
  total += counts[name];
  wrong += bad[name] || 0;
  console.log(`  ${name}: ${counts[name] - (bad[name] || 0)}/${counts[name]} identical`);
}
console.log(`${total - wrong}/${total} identical${wrong ? `, ${wrong} MISMATCHED` : ""}`);
process.exit(wrong ? 1 : 0);
