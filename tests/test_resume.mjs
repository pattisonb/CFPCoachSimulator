// The committee resume adds up: records match the standings, ranked wins and losses
// match the games, strength of schedule ranks run 1..N, the best win is a win.
// `node tests/test_resume.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { get, truthy, fmt } from "../engine_js/pyrt.js";

const game = await start();
const { season } = game;

test("resume", () => {
  const st = season.new_season("ohio-state", "full", 7);
  season.advance_to(st, 12);
  for (const w of [10, 12]) {
    const data = season.resume(st, w);
    const rows = data["rows"];
    const rec = season._records(st, w);
    const now = season.rank_map(st, w);
    const n = rows.length;
    equal(rows.map((r) => r["sos_rank"]).sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i + 1), "SOS ranks must run 1..N");
    for (const r of rows) {
      assert(r["record"] === `${rec[r["team"]]["wins"]}-${rec[r["team"]]["losses"]}`, () => JSON.stringify([r["team"], r["record"]]));
      assert(r["rank"] === get(now, r["team"]));
      if (truthy(r["best_win"])) assert(r["best_win"]["won"]);
      if (truthy(r["worst_loss"])) assert(!r["worst_loss"]["won"]);
    }
    const me = season.resume(st, w, "ohio-state")["rows"][0];
    const games = me["games"];
    assert(games.length === rec["ohio-state"]["wins"] + rec["ohio-state"]["losses"]);
    const top_w = games.filter((g) => g["won"] && truthy(g["rank_now"])).length;
    const top_l = games.filter((g) => !g["won"] && truthy(g["rank_now"])).length;
    assert(me["top25"] === `${top_w}-${top_l}`, () => JSON.stringify([me["top25"], top_w, top_l]));
    // a hand count of the opponents' record
    const opps = games.filter((g) => !g["fcs"]).map((g) => g["opp"]);
    const ow = opps.reduce((a, o) => a + rec[o]["wins"], 0);
    const ol = opps.reduce((a, o) => a + rec[o]["losses"], 0);
    assert(Math.abs(me["opp_pct"] - ow / (ow + ol)) < 0.001);
    console.log(`week ${w}: ${data["kind"]} ranking · Ohio State ${me["record"]} · SOS #${me["sos_rank"]} (${fmt(me["opp_pct"], 3)}/${fmt(me["oo_pct"], 3)}) · vs top 25 ${me["top25"]} · ` +
      `best win ${truthy(me["best_win"]) ? me["best_win"]["opp_name"] : me["best_win"]} · worst loss ${truthy(me["worst_loss"]) ? me["worst_loss"]["opp_name"] : me["worst_loss"]}`);
    const top = rows.slice(0, 5);
    console.log("  top of the table:", JSON.stringify(top.map((r) => [r["rank"], r["name"], r["record"], `SOS ${r["sos_rank"]}`, r["top25"]])));
  }
  console.log("resume ok");
});

await run();
