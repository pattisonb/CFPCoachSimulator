// Every roster keeps a center, and a SAM where its scheme has one (offseason.fill_roles): two
// offseasons into a career (finished seasons faked as in test_offseason) no team ends an
// offseason without a natural C, and every team without a SAM plays a defense with two
// linebackers in its base front (a 4-2-5: the nickel back plays where the SAM would). Your own
// team's move shows in Position Changes and Undo takes it back.
// `node tests/test_depth_roles.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted } from "../engine_js/pyrt.js";

const game = await start();
const { season, offseason } = game;
const league = game.modules.league;

/** Every game played (the better team usually wins), every school's class signed, season over (tests/test_offseason's). */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const h = teams[g["home"]]["team_ratings"]["overall"], a = teams[g["away"]]["team_ratings"]["overall"];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 7));
    const home_score = win ? hs : Math.max(0, hs - rng.randint(1, 20));
    const away_score = win ? hs - rng.randint(1, 20) : hs;
    Object.assign(g, { played: true, home_score, away_score });
    if (g["home_score"] === g["away_score"]) g["home_score"] += 3;
  }
  const rc = st["recruiting"];
  const schools = Object.keys(teams).filter((s) => !teams[s]["fictional"]);
  const pids = sorted(Object.keys(rc["prospects"]), (p) => rc["prospects"][p]["rank"]);
  pids.slice(0, schools.length * 21).forEach((pid, i) => { rc["status"][pid]["signed"] = schools[i % schools.length]; });
  Object.assign(st, { done: true, current_week: season.FINAL_WEEK, champion: "ohio-state" });
}

/** The teams with no natural C, and the ones with no SAM whose scheme has one. */
function missing(lgd) {
  const out = { C: [], SAM: [] };
  for (const [slug, t] of Object.entries(lgd["teams"])) {
    const held = new Set(t["roster"].map((c) => c["pos"]));
    if (!held.has("C")) out["C"].push(slug);
    if (!held.has("SAM") && offseason.has_sam(offseason.defense_scheme(t))) out["SAM"].push(slug);
  }
  return out;
}

const bump = (counter, key) => { counter[key] = (counter[key] || 0) + 1; };

test("depth roles", () => {
  let st = season.new_season("georgia", "full", 3, undefined, undefined, true);
  const me = st["team"];
  const filled = {}, no_sam_schemes = {};
  for (let year = 0; year < 2; year++) {
    finished(st);
    offseason.start(st);
    st["offseason"]["auto"] = true;
    while (st["offseason"]["stage"] !== "staff") offseason.advance(st);
    if (year === 0) {        // your centers all gone: your staff moves a lineman there, and you can take it back
      const roster = st["league"]["teams"][me]["roster"];
      roster.splice(0, roster.length, ...roster.filter((c) => c["pos"] !== "C"));
    }
    offseason.advance(st);
    const off = st["offseason"], lgd = st["league"];
    assert(off["stage"] === "conferences");
    const gaps = missing(lgd);
    assert(!gaps["C"].length && !gaps["SAM"].length, `offseason ${year + 1}: teams missing a role: ${JSON.stringify(gaps)}`);
    for (const [slug, t] of Object.entries(lgd["teams"])) {
      if (!t["roster"].some((c) => c["pos"] === "SAM")) {
        const scheme = offseason.defense_scheme(t);
        assert(!offseason.has_sam(scheme), () => JSON.stringify([slug, scheme]));
        bump(no_sam_schemes, scheme);
      }
    }
    for (const m of off["roles_filled"]) bump(filled, `${m["from"]}->${m["to"]}`);
    for (const m of off["roles_filled"]) {
      const t = lgd["teams"][m["team"]];
      const c = t["roster"].find((c) => c["id"] === m["id"]);
      assert(c["pos"] === m["to"] && c["moved_from"], () => JSON.stringify(m));
      assert(offseason.GROUP[m["from"]] === offseason.GROUP[m["to"]], () => JSON.stringify(m));          // a lineman to center, a linebacker to SAM
      const same = t["roster"].filter((x) => x["pos"] === m["from"]);
      assert(same.length, `${m["team"]}: the move emptied ${m["from"]}`);
    }
    if (year === 0) {
      const mine = off["position_changes"].filter((m) => m["to"] === "C");
      assert(mine.length === 1, () => JSON.stringify(off["position_changes"]));
      const undo = offseason.change_position(st, mine[0]["id"], mine[0]["from"]);
      assert(undo["pos"] === mine[0]["from"] && !off["position_changes"].some((m) => m["id"] === mine[0]["id"]));
      equal(offseason.empty_roles(lgd["teams"][me]), ["C"]);
      while (st["offseason"]["stage"] !== "ready") offseason.advance(st);      // Change Conferences, Edit Schedule
      st = offseason.next_season(st);
      assert(!st["league"]["teams"][me]["roster"].some((c) => c["pos"] === "C"), "Undo was overruled at the next season");
    } else {
      while (st["offseason"]["stage"] !== "ready") offseason.advance(st);      // Change Conferences, Edit Schedule
      st = offseason.next_season(st);
    }
  }
  assert(Object.keys(filled).length, "no staff filled a role in two offseasons (the check would prove nothing)");
  league.forget(st["id"]);
  season.close_pool();
  console.log("depth roles ok: after two offseasons 0 teams without a C, 0 without a SAM their scheme has; "
    + `moves ${JSON.stringify(filled)}; no SAM, by scheme (two-linebacker fronts): ${JSON.stringify(no_sam_schemes)}`);
});

await run();
