// The progress bar of a sim. A whole season is advanced through the API in one run and every status collected. The
// run's `progress` never goes back, is under 100% until the run is over, ends at exactly 1, and follows the clock: at
// every report it is within MAX_DEVIATION of the share of the run's time gone by. (Rank correlation would not catch
// a bad bar: any bar that never goes back ranks perfectly against time, including one that sits at 85% through every
// recruiting week. The largest gap between the bar and the clock is what the player sees.) A week of one bowl game
// takes a small share of the bar, not one week's even split.
// `node tests/test_sim_progress.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";

const game = await start({ env: { SIM_WORKERS: "1", CFP_SEASONS_DIR: "data/seasons-progress-test" } });
const { api, season } = game;
const MAX_DEVIATION = 0.2;      // *tune* the bar may lead or trail the clock by at most a fifth of the run

let pts = [], span = 0;
test("a planned run gives a one-game week a small share of the bar", () => {
  const s = api.call("POST", "/api/season", { team: "smu", seed: 11 });
  const begun = api.call("POST", `/api/season/${s["id"]}/advance`, { to: season.FINAL_WEEK });
  span = begun["total"] - begun["done"];
  const plan = Object.fromEntries(Object.entries(api.job()["_plan"]).map(([w, p]) => [w, Object.values(p).reduce((a, b) => a + b, 0)]));
  const all = Object.values(plan).reduce((a, b) => a + b, 0);
  assert(plan[season.FINAL_WEEK] / all < 0.5 / span, JSON.stringify(plan));
  const t0 = performance.now();
  while (api.running()) api.step((x) => pts.push([performance.now() - t0, JSON.parse(x)]));
});

test("progress never goes back, stays under 100% while running, and ends at exactly 1", () => {
  const prog = pts.map(([, j]) => j["progress"]);
  assert(prog.every((p) => p !== null && p >= 0 && p <= 1), JSON.stringify(prog.filter((p) => !(p >= 0 && p <= 1))));
  assert(prog.every((p, i) => i === 0 || prog[i - 1] <= p), "progress went back");
  const last = pts[pts.length - 1][1];
  assert(last["progress"] === 1.0 && last["status"] === "idle");
  assert(pts.every(([, j]) => j["status"] !== "running" || j["progress"] < 1), "100% before the run was over");
});

test("the bar follows the clock, and the final's week moves it by a small share", () => {
  const wall = pts[pts.length - 1][0];
  const dev = Math.max(...pts.map(([t, j]) => Math.abs(t / wall - j["progress"])));
  assert(dev <= MAX_DEVIATION, `progress strays ${dev.toFixed(3)} from the clock over ${Math.round(wall / 1000)} s`);
  const final = pts.filter(([, j]) => j["week"] === season.FINAL_WEEK).map(([, j]) => j["progress"]);
  assert(final[final.length - 1] - final[0] < 0.5 / span, JSON.stringify([final[0], final[final.length - 1]]));
});

test("the stage line says what is happening in plain words", () => {
  const stages = new Set(pts.map(([, j]) => j["stage"]).filter((s) => s));
  for (const want of ["Playing Week 5 games", season.RECRUITING_STAGE, season.SAVING_STAGE]) assert(stages.has(want), `${want}: ${JSON.stringify([...stages])}`);
  assert(![...stages].some((s) => s.startsWith("Simming")));
  equal([...stages].filter((s) => !/^[A-Z]/.test(s)), []);
});

await run();
