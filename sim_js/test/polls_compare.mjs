// Holds sim_js/polls.js to Python's answers (polls_reference.py writes them): node sim_js/test/polls_compare.mjs out.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { set_reader } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";
import { polls } from "../polls.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
set_reader((p) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), "utf8"));

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
// where two values first differ, for the report
function differ(a, b, at = "") {
  if (same(a, b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      if (ka[i] !== kb[i]) return `${at}: key ${i} is ${ka[i]}, want ${kb[i]}`;
      const d = differ(a[ka[i]], b[kb[i]], `${at}.${ka[i]}`);
      if (d) return d;
    }
  }
  return `${at}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`;
}

const counts = {};
const known = { n: 0, same: 0 };     // coaches_opinion's values, one by one
const wrong = [];
function check(what, got, want, where) {
  const c = (counts[what] ??= { n: 0, bad: 0 });
  c.n++;
  if (!same(got, want)) {
    c.bad++;
    if (wrong.length < 12) wrong.push(`${what} (${where}) ${String(differ(got, want)).slice(0, 400)}`);
  }
}

check("registered as modules.polls", modules.polls === polls, true, "");
for (const [name, want] of Object.entries(ref.constants)) {
  const got = polls[name] instanceof Set ? [...polls[name]].sort() : polls[name];
  check("constants", got, want, name);
}
for (const name of Object.keys(ref.signatures)) check("every function is on the namespace", typeof polls[name], "function", name);

for (const [part, calls] of [["season", ref.season], ["direct", ref.direct]]) {
  for (const c of calls) {
    // the arguments in the Python signature's order; one the caller did not give is undefined, so the default applies
    const args = ref.signatures[c.fn].map((name) => (name in c.args ? structuredClone(c.args[name]) : undefined));
    const given = JSON.stringify(args);
    let got = polls[c.fn](...args);
    if (c.fn === "_head_to_head") got = args[0];           // it moves the order in place
    else check(`${part}: ${c.fn} (its arguments untouched)`, JSON.stringify(args), given, c.where);
    if (c.fn === "coaches_opinion") {
      // The one function that hands back the value of a gauss() draw itself (the others only sort by one).
      // pyrt.js's gauss is Python's formula on Node's Math.log, Math.cos and Math.sin, which are not the C library's
      // to the last bit (about 7% of logs and 3% of cosines and sines differ by one unit in the last place), so these
      // values are held to the same teams in the same order and 1e-12, and the exactly equal ones are counted apart.
      const keys = Object.keys(c.result);
      check(`${part}: coaches_opinion (same teams in order, every value within 1e-12)`,
        same(Object.keys(got), keys) && keys.every((t) => Math.abs(got[t] - c.result[t]) <= 1e-12), true, c.where);
      for (const t of keys) { known.n++; if (got[t] === c.result[t]) known.same++; }
      continue;
    }
    check(`${part}: ${c.fn}`, got, c.result, c.where);
  }
}

let bad = 0, n = 0;
for (const [what, c] of Object.entries(counts)) {
  bad += c.bad;
  n += c.n;
  console.log(`${c.bad ? "MISMATCH" : "ok      "} ${what}: ${c.n} compared, ${c.n - c.bad} identical${c.bad ? `, ${c.bad} different` : ""}`);
}
console.log(`${n} compared, ${n - bad} identical`);
console.log(`known   coaches_opinion values: ${known.n} compared, ${known.same} identical to the last bit, ${known.n - known.same} one or two units in the last place off (Math.log/cos/sin under gauss)`);
for (const w of wrong) console.log(w);
process.exit(bad ? 1 : 0);
