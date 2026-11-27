// Jersey numbers (career_js/offseason/part2.js JERSEYS, jersey_legal, _jersey, renumber): an offensive lineman wears 50
// to 79 and a quarterback, back, receiver or tight end never does; a new player draws from his group's own numbers;
// and once the rosters are settled each offseason every player has a number he may wear that no teammate on his side of the ball has.
// `node tests/test_jerseys.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random } from "../engine_js/pyrt.js";

const game = await start();
const { api, season } = game;
const { offseason } = game.modules;
const ME = "ohio-state";
const J = (v) => JSON.stringify(v);

test("who may wear what: the line is 50 to 79, and the eligible positions never are", () => {
  equal([offseason.jersey_legal("LT", 72), offseason.jersey_legal("C", "55"), offseason.jersey_legal("RG", 99), offseason.jersey_legal("LG", 12)], [true, true, false, false]);
  equal([offseason.jersey_legal("WR", 69), offseason.jersey_legal("QB", 29), offseason.jersey_legal("WR", 0), offseason.jersey_legal("TE", 85), offseason.jersey_legal("HB", 50)], [false, true, true, true, false]);
  equal([offseason.jersey_legal("DT", 94), offseason.jersey_legal("MIKE", 55), offseason.jersey_legal("CB", 7)], [true, true, true]);
  equal([offseason.jersey_legal("WR", null), offseason.jersey_legal("WR", ""), offseason.jersey_legal("WR", "x"), offseason.jersey_legal("WR", 100)], [false, false, false, false]);
});

test("a new player draws from his group's own numbers, and takes any he may wear when those are gone", () => {
  const rng = new Random(3);
  const inside = (pos, n) => offseason.JERSEYS[offseason.GROUP[pos]].some(([lo, hi]) => Number(n) >= lo && Number(n) <= hi);
  for (const pos of ["QB", "HB", "WR", "TE", "LT", "C", "DT", "LEDG", "MIKE", "CB", "FS", "K", "P"]) {
    for (let i = 0; i < 40; i++) {
      const n = offseason._jersey([], pos, rng);
      assert(inside(pos, n) && offseason.jersey_legal(pos, n), `${pos} drew ${n}`);
    }
  }
  const taken = [];
  for (let n = 0; n <= 19; n++) taken.push({ j: String(n) });
  const n = offseason._jersey(taken, "QB", rng);
  assert(offseason.jersey_legal("QB", n) && Number(n) > 19, `a quarterback past his own numbers drew ${n}`);
});

test("an offensive and a defensive player may share a number; a quarterback looks for his own before any other", () => {
  const rng = new Random(5);
  const defense = [];
  for (let n = 0; n <= 49; n++) defense.push({ pos: "CB", j: String(n) });
  for (let i = 0; i < 30; i++) {
    const n = offseason._jersey(defense, "QB", rng);
    assert(Number(n) <= 19, `a quarterback beside a full secondary drew ${n}`);
  }
  const offense = [];
  for (let n = 0; n <= 19; n++) offense.push({ pos: "WR", j: String(n) });
  const n = offseason._jersey(offense, "QB", rng);
  assert(Number(n) > 19 && offseason.jersey_legal("QB", n), `with every low number taken on offense he drew ${n}`);
  equal([offseason.jersey_natural("QB", 7), offseason.jersey_natural("QB", 90), offseason.jersey_natural("WR", 43), offseason.jersey_natural("TE", 9), offseason.jersey_natural("DT", 1)],
    [true, false, false, true, true]);
});

test("once the rosters are settled, every player has a number he may wear that no teammate on his side of the ball has, and one that looks right on him", () => {
  const sid = api.call("POST", "/api/season", { team: ME, mode: "full", seed: 17, career: true })["id"];
  const st = api.loaded_state();
  const rng = new Random(1);
  for (const g of Object.values(st["games"])) Object.assign(g, { played: true, home_score: rng.randint(10, 40) + 3, away_score: 10 });
  const teams = season.load_teams();
  const schools = Object.keys(teams).filter((s) => !teams[s]["fictional"]);
  Object.keys(st["recruiting"]["prospects"]).sort((a, b) => st["recruiting"]["prospects"][a]["rank"] - st["recruiting"]["prospects"][b]["rank"])
    .slice(0, schools.length * 21).forEach((pid, i) => { st["recruiting"]["status"][pid]["signed"] = schools[i % schools.length]; });
  Object.assign(st, { done: true, current_week: season.FINAL_WEEK, champion: ME });
  api._save_loaded();
  let v = api.call("GET", `/api/season/${sid}/offseason`);
  for (let i = 0; i < 20 && v["stage"] !== "cuts"; i++) {
    try { api.call("POST", `/api/season/${sid}/offseason/review`, { choice: "nothing" }); } catch { /* no meeting */ }
    v = api.call("POST", `/api/season/${sid}/offseason/advance`, {});
  }
  // the kinds of trouble a roster carries by then: a starter with no number, a receiver in 69, a lineman in 94, two in 7
  const roster = api.loaded_state()["league"]["teams"][ME]["roster"];
  const at = (pos, k = 0) => roster.filter((c) => c["pos"] === pos)[k];
  at("WR", 0)["j"] = null; at("WR", 1)["j"] = "69"; at(["C", "LG", "RG", "LT", "RT"].find((pos) => at(pos)), 0)["j"] = "94"; at("CB", 0)["j"] = "7"; at("CB", 1)["j"] = "7";
  const kept = at("QB", 0);
  const kept_j = String(kept["j"]);
  api._save_loaded();
  api.call("POST", `/api/season/${sid}/offseason/cut`, { auto: true });
  api.call("POST", `/api/season/${sid}/offseason/advance`, {});
  const league = api.loaded_state()["league"]["teams"];
  let bad = [];
  // a number once per side of the ball (an offensive and a defensive player may share one; a kicker with neither)
  const SIDE = { QB: "o", RB: "o", WR: "o", TE: "o", OL: "o", DL: "d", LB: "d", CB: "d", S: "d" };
  for (const [slug, t] of Object.entries(league)) {
    const seen = { o: new Set(), d: new Set(), k: new Set() };
    for (const c of t["roster"]) {
      const side = SIDE[offseason.GROUP[c["pos"]]] ?? "k", j = String(c["j"]);
      const clash = side === "k" ? Object.values(seen).some((x) => x.has(j)) : seen[side].has(j) || seen.k.has(j);
      if (!offseason.jersey_legal(c["pos"], c["j"]) || clash) bad.push(`${slug} ${c["n"]} ${c["pos"]} #${c["j"]}`);
      seen[side].add(j);
    }
  }
  // ... and no quarterback in 90 (the player's "weird numbers"): every skill player's number looks right on him
  const odd = league[ME]["roster"].filter((c) => !offseason.jersey_natural(c["pos"], c["j"]));
  assert(odd.length === 0, () => `out of place: ${J(odd.map((c) => `${c["pos"]} #${c["j"]}`))}`);
  assert(bad.length === 0, `${bad.length}: ${J(bad.slice(0, 8))}`);
  const mine = league[ME]["roster"];
  if (mine.some((c) => c["id"] === kept["id"]) && offseason.jersey_legal("QB", kept_j)) {
    equal(String(mine.find((c) => c["id"] === kept["id"])["j"]), kept_j, "a good number is kept");
  }
});

await run();
