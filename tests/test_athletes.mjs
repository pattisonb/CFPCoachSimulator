// Place Your Athletes (career_js/offseason/part2.js _sign_classes, part4.js athletes_mine and athletes_view, the
// "athletes" stage): a signee listed as an athlete is marked when he joins; in a year you signed one the offseason
// stops between Progress and Roster Cuts with each of them and what he would be at his best positions; you move him
// with the offseason's own position change; and in a year you signed none the stage is never shown or stopped at.
// `node tests/test_athletes.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random } from "../engine_js/pyrt.js";
import { position_fit } from "../career_js/position_fit.js";

const game = await start();
const { api, season } = game;
const { offseason } = game.modules;
const ME = "ohio-state";
const J = (v) => JSON.stringify(v);

/** A finished season with every school's class signed, and `mine_athletes` athletes signed with you. */
function career(seed, mine_athletes) {
  const sid = api.call("POST", "/api/season", { team: ME, mode: "full", seed, career: true })["id"];
  const st = api.loaded_state(), rc = st["recruiting"];
  const rng = new Random(1);
  for (const g of Object.values(st["games"])) {
    const hs = rng.randint(10, 45);
    Object.assign(g, { played: true, home_score: hs + 3, away_score: hs });
  }
  const teams = season.load_teams();
  const schools = Object.keys(teams).filter((s) => !teams[s]["fictional"] && s !== ME);
  const ids = Object.keys(rc["prospects"]).sort((a, b) => rc["prospects"][a]["rank"] - rc["prospects"][b]["rank"]);
  const aths = ids.filter((p) => rc["prospects"][p]["position"] === "ATH");
  const rest = ids.filter((p) => rc["prospects"][p]["position"] !== "ATH");
  rest.slice(0, schools.length * 20).forEach((pid, i) => { rc["status"][pid]["signed"] = schools[i % schools.length]; });
  rest.slice(schools.length * 20, schools.length * 20 + 18).forEach((pid) => { rc["status"][pid]["signed"] = ME; });
  const signed = aths.slice(0, mine_athletes);
  for (const pid of signed) rc["status"][pid]["signed"] = ME;
  aths.slice(mine_athletes, mine_athletes + 12).forEach((pid, i) => { rc["status"][pid]["signed"] = schools[i]; });      // and a dozen elsewhere
  Object.assign(st, { done: true, current_week: season.FINAL_WEEK, champion: ME });
  api._save_loaded();
  return { sid, signed, names: signed.map((p) => rc["prospects"][p]["name"]) };
}
const to_stage = (sid, stop) => {
  const seen = [];
  for (let i = 0; i < 20; i++) {
    const v = api.call("GET", `/api/season/${sid}/offseason`);
    seen.push(v["stage"]);
    if (stop.includes(v["stage"])) return [v, seen];
    try { api.call("POST", `/api/season/${sid}/offseason/review`, { choice: "nothing" }); } catch { /* no meeting to answer */ }
    api.call("POST", `/api/season/${sid}/offseason/advance`, {});
  }
  throw new Error(`never reached ${stop}: ${seen}`);
};

let sid, names;

test("in a year you signed athletes, the offseason stops at Place Your Athletes between Progress and Roster Cuts", () => {
  ({ sid, names } = career(31, 2));
  assert(names.length === 2, "the class has no two athletes to sign");
  equal(offseason.STAGE_NAMES["athletes"], "Place Your Athletes");
  const order = offseason.STAGES;
  assert(order.indexOf("development") < order.indexOf("athletes") && order.indexOf("athletes") < order.indexOf("cuts"), J(order));
  const [early] = to_stage(sid, ["development"]);
  assert(early["athletes"] === null, "nothing to place before you are there");
  // ... but the step is on the bar already, right after Progress: what comes next is named as it is
  const keys = early["stages"].map((s) => s["key"]);
  equal(keys[keys.indexOf("development") + 1], "athletes");
  const [v, seen] = to_stage(sid, ["athletes", "cuts"]);
  equal(v["stage"], "athletes", J(seen));
  assert(v["stages"].some((s) => s["key"] === "athletes" && s["current"]), "it is a step on the bar now");
  equal(v["athletes"]["players"].map((p) => p["name"]).sort(), [...names].sort());
  for (const p of v["athletes"]["players"]) {
    assert(p["options"].length >= 2 && p["options"].length <= offseason.ATHLETE_OPTIONS, J(p["options"].length));
    assert(p["options"][0]["current"] === true && p["options"][0]["pos"] === p["pos"], "where he is now leads");
    assert(p["options"].every((o) => o["overall"] >= 1 && o["overall"] <= 99 && o["pos"]), J(p["options"]));
    assert(p["options"].slice(1).every((o, i, a) => i === 0 || a[i - 1]["overall"] >= o["overall"]), "then best first");
    assert(p["ht"] > 60 && p["wt"] > 120 && p["moved_from"] === null && p["best"]);
  }
});

test("you place him with the offseason's position change, and moving on leads to Roster Cuts", () => {
  let v = api.call("GET", `/api/season/${sid}/offseason`);
  const p = v["athletes"]["players"][0];
  const to = p["options"][1];
  v = api.call("POST", `/api/season/${sid}/offseason/position`, { pid: p["id"], pos: to["pos"] });
  const now = v["athletes"]["players"].find((x) => x["id"] === p["id"]);
  equal([now["pos"], now["moved_from"], now["options"].find((o) => o["current"])["pos"]], [to["pos"], p["pos"], to["pos"]]);
  // the tiles hold still as you place him (the player's ask): the same spots in the same order, the new one marked
  equal(now["options"].map((o) => o["pos"]), p["options"].map((o) => o["pos"]));
  const row = api.loaded_state()["league"]["teams"][ME]["roster"].find((c) => c["id"] === p["id"]);
  assert(row["pos"] === to["pos"] && row["ath"] === true, "his roster row moved");
  v = api.call("POST", `/api/season/${sid}/offseason/advance`, {});
  equal(v["stage"], "cuts");
  assert(v["stages"].some((s) => s["key"] === "athletes" && s["done"]), "the step stays on the bar, done");
  assert(v["athletes"]["players"].length === 2, "and reads back");
});

test("in a year you signed none, the stage is never stopped at and never on the bar", () => {
  const c = career(32, 0);
  const [v, seen] = to_stage(c.sid, ["cuts"]);
  assert(!seen.includes("athletes"), J(seen));
  assert(!v["stages"].some((s) => s["key"] === "athletes"), "no step for it");
  equal(v["athletes"]["players"], []);
});

test("another school places its own athletes where they project best, and an old athlete who transfers in is not yours to place", () => {
  const st = api.loaded_state(), lgd = st["league"];
  const year = st["offseason"]["year"];
  const theirs = Object.entries(lgd["teams"]).filter(([slug]) => slug !== ME).flatMap(([, t]) => t["roster"].filter((c) => c["ath"]));
  assert(theirs.length > 0, "no other school signed an athlete");
  const zip = (r) => Object.fromEntries(lgd["attrs"].map((k, i) => [k, r[i]]));
  for (const c of theirs) {
    assert(!("moved_from" in c) && !("moved_attrs" in c), "where the staff put him is simply his position");
    const opts = position_fit.options(zip(c["r"]), c["ht"], c["wt"], c["pos"], c["pos"], offseason.GROUP);
    assert(opts.every((o) => o["overall"] <= opts.find((x) => x["current"])["overall"]), `${c["n"]} at ${c["pos"]}: ${J(opts.slice(0, 3))}`);
  }
  // an athlete from a year ago, now a sophomore, who has just transferred to you
  lgd["teams"][ME]["roster"].push({ ...JSON.parse(JSON.stringify(theirs[0])), id: "old-athlete", n: "Old Athlete", cls: "SO", joined: year });
  assert(!offseason.athletes_mine(st).some((c) => c["id"] === "old-athlete"));
});

await run();
