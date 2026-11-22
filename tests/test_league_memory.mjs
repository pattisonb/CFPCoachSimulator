// Building a career's league from the base teams must not keep the 136 source files in memory:
// the server on a 512 MB instance was pushed over the line by exactly that (the first offseason of a
// played career peaked at 530 MB). The league keeps its compact rosters; the raw files are read and
// dropped, and the identity fields every other caller needs come from a small cached projection.
// `node tests/test_league_memory.mjs`
//
// Python measured with tracemalloc (what is held, and the peak). Node has no peak for a stretch of code that does
// not give the loop back, so what is held is measured here (the heap in use after a full collection, plus the
// memory of buffers outside it) and the peak is not: its check is left out.
import v8 from "node:v8";
import vm from "node:vm";
import { start, test, run, assert } from "./harness.mjs";

v8.setFlagsFromString("--expose-gc");
const collect = vm.runInNewContext("gc");
const game = await start();
const league = game.modules.league;
const league_file = game.modules.league_file;
const api = game.api;

/** Bytes in use after a full collection. */
function traced() {
  collect(); collect();
  const m = process.memoryUsage();
  return m.heapUsed + m.external;
}

test("league_memory", () => {
  let before = traced();
  const lgd = league.from_base(2027);
  const held = (traced() - before) / 1e6;
  assert(Object.keys(lgd["teams"]).length > 100);
  assert(held < 90, `building the league holds ${held.toFixed(0)} MB; the base files must not stay cached`);
  // (the peak over the start, under 140 MB in Python, cannot be measured here)
  // the identity a team keeps for the engine and the offseason's names comes from a small projection
  const meta = league.base_meta("ohio-state");
  assert(meta["short_name"] === "Ohio State" && meta["slug"] === "ohio-state" && !("roster" in meta) && !("depth_chart" in meta));
  // a league team in the source format still carries the base identity and the league's roster
  const t = league.source_team(lgd, "ohio-state");
  assert(t["short_name"] === "Ohio State" && t["roster"].length >= 70 && Object.keys(t["coaches"]).length && Object.keys(t["starters"]).length);
  // the full base file is still there for a fictional stand-in (never in the league)
  const fict = league.base_slugs().find((s) => league.base_meta(s)["fictional"]);
  assert(fict !== undefined, "StopIteration");
  assert(league.base_team(fict)["roster"].length);
  // a league file checked for New Career: the pending league holds the league alone until Start (not its
  // engine teams file, Start builds that again), and the built-in copies the check read are let go
  before = traced();
  let r = api._pend(league_file.dumps({ format: "cfp-league/1", teams: [{ slug: "rice", prestige: 55 }] }), null);
  assert(r["ok"] && !r["builtin"] && api._pending_league !== null);
  r = null;
  const pending = (traced() - before) / 1e6;
  api._pending_league = null;
  const idle = (traced() - before) / 1e6;
  assert(pending < 60, `a checked league file holds ${pending.toFixed(0)} MB until Start; it was 157 MB with its engine and the caches`);
  assert(idle < 25, `a check leaves ${idle.toFixed(0)} MB behind once its league is gone; it was 88 MB of cached built-in copies`);
  console.log(`league memory ok: building from the base files holds ${held.toFixed(0)} MB; `
    + `a checked file holds ${pending.toFixed(0)} MB pending, ${idle.toFixed(0)} MB after`);
});

await run();
