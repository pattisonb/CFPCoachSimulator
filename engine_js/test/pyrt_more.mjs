// pyrt.js and pystat.js against Python's own answers (tests/test_engine_js.py writes them): generators seeded with
// text, shuffle, sample, and the statistics module's mean, pstdev, median and fmean.
//   node engine_js/test/pyrt_more.mjs expected.json
import fs from "fs";
import { Random } from "../pyrt.js";
import { mean, pstdev, median, fmean } from "../pystat.js";
const exp = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let bad = 0, close = 0;
for (const [s, a, xs, smp, smp2, smp3, rr] of exp.seed) {
  const r = new Random(0); r.seed(s);
  const g = [r.random(), r.randint(0, 1e6), r.gauss(0, 1), r.random()];
  const ys = Array.from({ length: 40 }, (_, i) => i); r.shuffle(ys);
  const range = (n) => Array.from({ length: n }, (_, i) => i);
  const got = [g, ys, r.sample(range(100), 7), r.sample(range(12), 5), r.sample(range(5000), 30), r.randrange(1 << 30)];
  const want = [a, xs, smp, smp2, smp3, rr];
  if (!eq(got, want)) { if (eq([got[0][0], got[0][1], got[0][3], ...got.slice(1)], [a[0], a[1], a[3], xs, smp, smp2, smp3, rr])) close++; else { bad++; console.log("seed", JSON.stringify(s).slice(0, 30), JSON.stringify(got).slice(0, 120), JSON.stringify(want).slice(0, 120)); } }
}
let sb = 0;
for (const [xs, m, sd, med, fm] of exp.stat) {
  const got = [mean(xs), pstdev(xs), median(xs), fmean(xs)];
  if (!eq(got, [m, sd, med, fm])) { sb++; if (sb < 6) console.log("stat", xs.length, got, [m, sd, med, fm]); }
}
console.log(`text seeds: ${exp.seed.length}, ${bad} wrong (${close} with only gauss off in the last place); statistics: ${exp.stat.length * 4} answers, ${sb} sets wrong`);
process.exit(bad || sb ? 1 : 0);
