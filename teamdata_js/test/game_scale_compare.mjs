// The JavaScript's answers against Python's (game_scale_reference.py wrote them): every one the same, number for
// number and key for key in the same order.
//   python3 teamdata_js/test/game_scale_reference.py out.json && node teamdata_js/test/game_scale_compare.mjs out.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { set_reader } from "../../engine_js/files.js";
import { game_scale } from "../game_scale.js";
import { build_teams } from "../build_teams.js";
import { prospects } from "../../career_js/prospects.js";
import { recruits } from "../../career_js/recruits.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
set_reader((p) => fs.readFileSync(path.join(ROOT, p), "utf8"));

const ref = JSON.parse(fs.readFileSync(process.argv[2] || "game_scale_reference.json", "utf8"));
const modules = { game_scale, prospects, recruits, build_teams };
const text = (v) => JSON.stringify(v === undefined ? "(undefined)" : v);

const counts = new Map();
const wrong = [];
for (const [fn, args, want] of ref.cases) {
  const [mod, name] = fn.split(".");
  let got;
  try {
    got = modules[mod][name](...structuredClone(args));
    if (got instanceof Set) got = [...got].sort();
  } catch (e) {
    got = `threw: ${e.message}`;
  }
  const c = counts.get(fn) || [0, 0];
  c[0] += 1;
  if (text(got) === text(want)) c[1] += 1;
  else if (wrong.length < 20) wrong.push(`${fn}(${text(args).slice(0, 300)})\n   python ${text(want).slice(0, 300)}\n   js     ${text(got).slice(0, 300)}`);
  counts.set(fn, c);
}

// the two upgrades of old saves: league.forget is recorded, recruiting._truths (not ported) hands back Python's truths
for (const [i, u] of ref.upgrades.entries()) {
  const fn = `game_scale.${u.fn} (old save ${i + 1})`;
  const forgot = [];
  game_scale.modules.league = { forget: (id) => forgot.push(id) };
  game_scale.modules.recruiting = { _truths: (ps) => { for (const [pid, p] of Object.entries(ps)) p.truth = structuredClone(u.after.recruiting.prospects[pid].truth); } };
  const state = structuredClone(u.before);
  let answer;
  try { answer = game_scale[u.fn](state); } catch (e) { answer = `threw: ${e.message}`; }
  const ok = text(answer) === text(u.answer) && text(state) === text(u.after) && text(forgot) === text(u.forgot);
  counts.set(fn, [1, ok ? 1 : 0]);
  if (!ok) wrong.push(`${fn}: answer ${text(answer)} (python ${text(u.answer)}), forgot ${text(forgot)} (python ${text(u.forgot)}), state ${text(state) === text(u.after) ? "the same" : "differs"}`);
}
game_scale.modules.league = game_scale.modules.recruiting = null;

let all = 0, same = 0;
for (const [fn, [n, ok]] of counts) {
  console.log(`${ok === n ? "ok  " : "FAIL"} ${fn}: ${ok} of ${n} identical`);
  all += n; same += ok;
}
for (const w of wrong) console.log(w);
console.log(`${same} of ${all} identical`);
process.exit(same === all ? 0 : 1);
