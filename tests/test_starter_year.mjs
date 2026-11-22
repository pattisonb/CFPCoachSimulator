// A freshman or sophomore who played a starter's season develops at a full year's pace
// (offseason.STARTER_YEAR, year_pace): the same player, the same draws, gains more after starting
// than after a year on the bench; a junior's pace is already past it and does not move. His skills
// always gain more points; his overall (a rounded sum of his card's attributes, teamdata game_scale
// card_formula) never gains fewer, and gains more for all but the slowest developer or two, whose few
// extra skill points can round to the same overall.
// `node tests/test_starter_year.mjs`
import { start, test, run, assert } from "./harness.mjs";
import { Random, sum } from "../engine_js/pyrt.js";

const game = await start();
const { offseason } = game;
const lg = game.modules.league;

test("starter year", () => {
  const lgd = lg.from_base();
  const attrs = offseason._attrs(lgd);
  assert(offseason.year_pace({ yrs: 0 }) === offseason.YEAR_CURVE[0] && offseason.YEAR_CURVE[0] < offseason.year_pace({ yrs: 0 }, true)
    && offseason.year_pace({ yrs: 0 }, true) === offseason.STARTER_YEAR);
  assert(offseason.year_pace({ yrs: 1 }, true) === offseason.STARTER_YEAR);
  assert(offseason.year_pace({ yrs: 2 }, true) === offseason.year_pace({ yrs: 2 }) && offseason.year_pace({ yrs: 2 }) === offseason.YEAR_CURVE[2], "a junior's pace stays his");
  let picked = 0, level = 0, bench_total = 0, start_total = 0;
  outer:
  for (const t of Object.values(lgd["teams"])) {
    for (const p of t["roster"]) {
      if (p["cls"] === "FR" && (p["pos"] === "QB" || p["pos"] === "HB") && sum(p["g"]) >= 400 && p["o"] < 55) {
        const bench = structuredClone(p), starter = structuredClone(p);
        const g_bench = offseason.develop(bench, attrs, 1.0, new Random(7));
        const g_start = offseason.develop(starter, attrs, 1.0, new Random(7), true);
        const who = () => JSON.stringify([p["n"], p["pos"], p["c"] ?? null]);
        assert(g_start >= g_bench, () => `${who()} ${g_bench} ${g_start}`);
        assert(bench["r"].every((a, i) => a <= starter["r"][i]) && Math.max(...starter["r"]) <= 99);
        assert(sum(starter["r"]) > sum(bench["r"]), () => `${who()} ${sum(bench["r"])} ${sum(starter["r"])}`);
        level += g_start === g_bench ? 1 : 0;
        bench_total += g_bench; start_total += g_start;
        picked += 1;
        if (picked === 1) {
          console.log(`${p["n"]} (${p["pos"]}, ${p["c"] ?? null}, ${p["o"]} overall): +${g_bench} off the bench, +${g_start} after a starter's season`);
        }
        if (picked >= 25) break outer;
      }
    }
  }
  assert(picked >= 10, () => String(picked));
  assert(level <= 2, `${level} of ${picked} gained the same overall after starting as off the bench`);
  assert(start_total >= 1.5 * bench_total, () => `${bench_total} ${start_total}`);      // 2.2 times in the base league
  console.log(`starter year ok: ${picked} freshman quarterbacks and backs gain more after starting than after a year on the bench`);
});

await run();
