// Coach Career recruiting held to the real classes (tools/check_recruiting.mjs): class sizes,
// distance from home, where the blue chips go, which programs land the best classes, and when
// prospects commit, sign and decommit, on two seeds.
// `node tests/test_recruiting_realism.mjs`
import { start, test, run, assert } from "./harness.mjs";
import { f, pct } from "../tools/pytext.mjs";
import * as check_recruiting from "../tools/check_recruiting.mjs";

const game = await start();
const { prospects } = game.modules;
check_recruiting.use(game);

test("recruiting realism", () => {
  let bad = [];
  let gen_signed = [];                    // (prospect, his class's rank at the school he signed with)
  let m = null;
  for (const seed of [1, 2]) {
    const state = check_recruiting.play(seed);
    const crc = prospects.class_rc(state);
    gen_signed = gen_signed.concat((crc["generational"] ?? []).map((pid) =>
      [pid, crc["status"][pid]["signed"] !== "FCS" ? prospects.class_rank(state, crc["status"][pid]["signed"]) : 999]));
    m = check_recruiting.measure(state);
    const lines = check_recruiting.report(m);
    bad = bad.concat(lines.filter((line) => line.startsWith("!")).map((line) => `seed ${seed}: ${line.trim()}`));
  }
  assert(!bad.length, "\n" + bad.join("\n"));
  if (gen_signed.length) {                     // a generational prospect signs with a top-25 class
    const top = gen_signed.filter(([, r]) => r <= 25).length;
    assert(top >= 0.8 * gen_signed.length, `generational prospects signing with a top-25 class: ${top}/${gen_signed.length}: [${gen_signed.map(([pid, r]) => `('${pid}', ${r})`).join(", ")}]`);
  }
  console.log(`recruiting realism ok on 2 seeds: in-state ${f(m["in_state"], 2)}, median ${f(m["median_miles"], 0)} mi, `
    + `rank r ${f(m["strength_rank_r"], 2)}, FCS ${pct(m["fcs_share"])}`);
});

await run();
