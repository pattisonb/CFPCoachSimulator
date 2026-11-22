// Needs on the Prospects and Recruiting screens (recruiting.needs_detail): per roster group the
// healthy make-up, who comes back, your commits (firm and soft), your board and offers, and what
// is left; and a recommended list (recruiting.recommended): the prospects the Auto-recruit rules
// would put on your board, ranked, with why, to build a board from.
// `node tests/test_needs_recs.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { get, truthy } from "../engine_js/pyrt.js";

const game = await start();
const { season, recruiting, offseason } = game;
const prospects = game.modules.prospects;

test("needs and recommendations", () => {
  const st = season.new_season("ohio-state", "full", 9, undefined, undefined, true);
  const me = st["team"];
  const rc = st["recruiting"];
  const d = recruiting.needs_detail(st, me);
  equal(new Set(Object.keys(d)), new Set(Object.keys(offseason.TARGET)));
  for (const [g, row] of Object.entries(d)) {
    assert(["target", "back", "commits", "firm", "soft", "board", "offers", "need"].every((k) => k in row), () => JSON.stringify(row));
    assert(row["target"] === offseason.TARGET[g] && row["need"] === recruiting.needs(st, me)[g] && row["commits"] === row["firm"] + row["soft"]);
  }
  // a commit and a board entry show up where they should
  const pid = Object.keys(rc["prospects"]).find((p) => recruiting._group_of(rc["prospects"][p]) === "WR" && !truthy(rc["status"][p]["committed"]));
  rc["board"].push(pid);
  Object.assign(rc["status"][pid], { committed: me, firmness: recruiting.FIRM_START });
  recruiting._GROUP_COUNTS = [null, {}];
  const d2 = recruiting.needs_detail(st, me);
  assert(d2["WR"]["board"] === d["WR"]["board"] + 1 && d2["WR"]["soft"] === d["WR"]["soft"] + 1 && d2["WR"]["need"] === d["WR"]["need"] - 1);
  Object.assign(rc["status"][pid], { firmness: recruiting.HARD_AT, hard: true });      // a hard commit counts as firm
  const d3 = recruiting.needs_detail(st, me);
  assert(d3["WR"]["firm"] === d["WR"]["firm"] + 1 && d3["WR"]["soft"] === d["WR"]["soft"]);
  // recommended: the AI's board for you, not already on your board, each with why
  const recs = recruiting.recommended(st, me);
  assert(20 <= recs.length && recs.length <= 120, () => String(recs.length));
  assert(!recs.map((r) => r["pid"]).includes(pid));
  assert(recs.slice(0, 10).every((r) => truthy(r["why"]) && r["fit"] > 0), () => JSON.stringify(recs[0]));
  const groups = new Set(recs.map((r) => recruiting._group_of(rc["prospects"][r["pid"]])));
  assert(groups.size >= 6, () => JSON.stringify([...groups]));
  const needed = Object.entries(d3).filter(([, row]) => row["need"] >= 2).map(([g]) => g);
  if (needed.length) assert(recs.slice(0, 15).some((r) => needed.includes(recruiting._group_of(rc["prospects"][r["pid"]]))));
  // the same list twice in a week; the Prospects search can show it and filter by group
  equal(recs.map((r) => r["pid"]), recruiting.recommended(st, me).map((r) => r["pid"]));
  const found = prospects.search(st, me, undefined, undefined, undefined, "recommended", undefined, undefined, 200);
  assert(found["total"] === recs.length && found["rows"].slice(0, 5).every((r) => truthy(get(r, "why"))) && "needs" in found);
  const wr = prospects.search(st, me, undefined, undefined, undefined, undefined, undefined, undefined, 20, undefined, "WR");
  assert(wr["rows"].length && wr["rows"].every((r) => recruiting._group_of(rc["prospects"][r["id"]]) === "WR"));
  season.close_pool();
  console.log(`needs and recommendations ok: ${recs.length} recommended, needs ${JSON.stringify(Object.entries(d3).filter(([, r]) => r["need"] > 0).map(([g, r]) => [g, r["need"]]))}`);
});

await run();
