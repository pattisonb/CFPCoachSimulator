// pyrt.js against Python's own answers (tests/test_engine_js.py writes them): every random draw the engine's
// methods make from ten seeds, and Python's rounding on some thirty thousand numbers.
//   node engine_js/test/pyrt_check.mjs expected.json
import fs from "fs";
import { Random, round } from "../pyrt.js";
const exp = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
let bad = 0, n = 0, ulp = 0;
const same = (a, b) => Array.isArray(a) ? a.length === b.length && a.every((x, i) => same(x, b[i])) : Object.is(a, b) || a === b;
for (const { seed, seq } of exp.rng) {
  const r = new Random(seed); const got = [];
  for (let i = 0; i < 400; i++) {
    const k = i % 9;
    if (k === 0) got.push(r.random());
    else if (k === 1) got.push(r.randint(1, 6 + i));
    else if (k === 2) got.push(r.gauss(3.5, 2.25));
    else if (k === 3) got.push(r.choices([0, 1, 2, 3, 4, 5, 6], { weights: [0.1, 2, 3.3, 0.7, 5, 1e-3, 2.2] })[0]);
    else if (k === 4) got.push(r.choice([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    else if (k === 5) got.push(r.uniform(-3, 9.5));
    else if (k === 6) got.push(r.gammavariate(2.2 + (i % 5) * 0.4, 1.7));
    else if (k === 7) got.push(r.choices([0, 1, 2, 3, 4], { k: 3 }));
    else got.push(r.randint(-40, 1000000));
  }
  r.seed(seed + 3); got.push(r.gauss(0, 1)); got.push(r.gammavariate(0.6, 2.0)); got.push(r.gammavariate(1.0, 2.0));
  seq.forEach((e, i) => { n++; if (!same(e, got[i])) { if (typeof e === "number" && Math.abs(e - got[i]) < 1e-12 * Math.max(1, Math.abs(e))) ulp++; else { bad++; if (bad < 6) console.log("rng", seed, i, i % 9, e, got[i]); } } });
}
let rb = 0;
for (const [x, r0, r1, r2, r3, r6] of exp.round) {
  const got = [round(x), round(x, 1), round(x, 2), round(x, 3), round(x, 6)];
  [r0, r1, r2, r3, r6].forEach((e, i) => { if (!Object.is(e + 0, got[i] + 0)) { rb++; if (rb < 8) console.log("round", x, [0, 1, 2, 3, 6][i], e, got[i]); } });
}
console.log(`rng: ${n} draws, ${bad} wrong, ${ulp} off in the last place; round: ${exp.round.length * 5} cases, ${rb} wrong`);
process.exit(bad || rb ? 1 : 0);
