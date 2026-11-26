// The player page in the offseason: a player is found by his slug on any team, and "next season" says where he is
// now in the career's league (returning, with his class and overall; transferred in; graduated; or, at Keep Them
// Home, that he wants to leave), so a link to a player never lands on last season's page with nothing about him.
// `node tests/test_player_next_season.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted } from "../engine_js/pyrt.js";

const game = await start({ env: { SIM_WORKERS: "1", CFP_SEASONS_DIR: "data/seasons-next-test" } });
const { api, season, offseason } = game;
const show = (v) => JSON.stringify(v);
const ME = "iowa";

/** Every game played (the better team usually wins), every school's class signed, the season over. */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const [h, a] = [teams[g["home"]]["team_ratings"]["overall"], teams[g["away"]]["team_ratings"]["overall"]];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 7));
    g["played"] = true;
    g["home_score"] = win ? hs : Math.max(0, hs - rng.randint(1, 20));
    g["away_score"] = win ? hs - rng.randint(1, 20) : hs;
    if (g["home_score"] === g["away_score"]) g["home_score"] += 3;
  }
  const rc = st["recruiting"];
  const schools = Object.entries(teams).filter(([, t]) => !t["fictional"]).map(([s]) => s);
  const pids = sorted(Object.keys(rc["prospects"]), (p) => rc["prospects"][p]["rank"]);
  pids.slice(0, schools.length * 21).forEach((pid, i) => { rc["status"][pid]["signed"] = schools[i % schools.length]; });
  Object.assign(st, { done: true, current_week: season.FINAL_WEEK, champion: "ohio-state" });
}

const st = season.new_season(ME, "full", 5, undefined, undefined, true);
finished(st);
offseason.start(st);
const leaving = new Set((st["offseason"]["retention"]["players"] || []).map((e) => e["id"]));

/** A player of last season's team who is still on next year's roster and not a Keep Them Home leaver. */
function a_returning_player() {
  const ids = new Set(st["league"]["teams"][ME]["roster"].map((c) => c["id"]).filter((id) => !leaving.has(id)));
  const t = season.load_teams()[ME];
  return [...t["offense"], ...t["defense"]].find((p) => ids.has(p["slug"]));
}

test("at Keep Them Home a player who wants out reads that he wants to leave, and for where", () => {
  const ret = st["offseason"]["retention"]["players"];
  assert(st["offseason"]["stage"] === "retention" && ret.length);
  for (const e of ret.slice(0, 4)) {
    const n = offseason.player_next(st, e["id"]);
    const draft = e["intent"] === "draft";
    assert(n["status"] === "leaving" && n["team"] === null, show(n));
    equal(n["status_name"], draft ? "Wants to Leave: NFL Draft" : "Wants to Leave: Transfer Portal");
    equal(n["sentence"], draft ? "Wants to leave for the NFL Draft." : "Wants to leave for the transfer portal.");
  }
});

test("a player's profile is found by his slug alone, on whatever team he is", () => {
  const p = a_returning_player();
  const prof = season.player_profile(st, null, null, null, p["slug"]);
  assert(prof && prof["team"]["slug"] === ME && prof["slug"] === p["slug"]);
});

test("a returning player reads his team, class and overall for next season", () => {
  const p = a_returning_player();
  const c = st["league"]["teams"][ME]["roster"].find((x) => x["id"] === p["slug"]);
  const n = offseason.player_next(st, p["slug"]);
  assert(n["status"] === "returning" && n["team"] === ME && n["team_name"], show(n));
  assert(n["position"] === c["pos"] && n["class"] === c["cls"] && n["class_name"], show(n));
  equal(n["season"], st["offseason"]["year"] - 1);
  // his overall is on the scale the page shows, and the number in his sentence is the same one
  equal(n["overall"], c["o"]);
  equal(n["sentence"], `Returning to ${n["team_name"]} as a ${n["class_name"].toLowerCase()}, ${n["overall"]} overall.`);
});

test("a graduated player reads Graduated, with no team", () => {
  const ev = st["offseason"]["departures"].find((e) => e["kind"] === "graduated");
  const n = offseason.player_next(st, ev["id"]);
  assert(n["status"] === "graduated" && n["team"] === null && n["team_name"] === null, show(n));
  equal(n["sentence"], "Graduated.");
});

test("a player who has joined your roster from another team reads as a transfer, from where to where", () => {
  const teams = st["league"]["teams"];
  const other = sorted(Object.keys(teams)).find((s) => s !== ME && teams[s]["roster"].length);
  const c = teams[other]["roster"].shift();
  teams[ME]["roster"].push(c);
  try {
    const n = offseason.player_next(st, c["id"]);
    assert(n["status"] === "transfer_in" && n["team"] === ME, show(n));
    assert(n["sentence"].startsWith("Transferred from ") && n["sentence"].includes(`to ${n["team_name"]}`), n["sentence"]);
  } finally {
    teams[ME]["roster"].pop();
    teams[other]["roster"].unshift(c);
  }
});

// Redshirt calls land when you leave Departures. Until then a candidate reads the class he will have; one who wants
// out at Keep Them Home reads that first, in the class he has (his redshirt only counts if he stays).
test("before the redshirt calls land, a candidate reads the class he will have next season", () => {
  const rs = st["offseason"]["redshirts"];
  assert(!rs["decided"] && rs["players"].length);
  const staying = rs["players"].filter((r) => !leaving.has(r["id"]));
  assert(staying.some((r) => r["redshirt"]) && staying.some((r) => !r["redshirt"]), "the seed gives both a redshirt and a played year");
  for (const r of [...staying.filter((x) => x["redshirt"]).slice(0, 3), ...staying.filter((x) => !x["redshirt"]).slice(0, 3)]) {
    const want = r["redshirt"] ? `${r["cls"]}RS` : (offseason.NEXT_CLASS[r["cls"]] ?? r["cls"]);
    const n = offseason.player_next(st, r["id"]);
    assert(n["status"] === "returning" && n["class"] === want, show([r["name"], r["cls"], r["redshirt"], n["status"], n["class"]]));
  }
  for (const r of rs["players"].filter((x) => leaving.has(x["id"])).slice(0, 6)) {
    const n = offseason.player_next(st, r["id"]);
    assert(n["status"] === "leaving" && n["class"] === r["cls"], show([r["name"], n["status"], n["class"]]));
  }
});

test("during a season there is no next season to read", () => {
  const fresh = season.new_season(ME, "full", 5, undefined, undefined, true);
  const p = season.load_teams()[ME]["offense"][0];
  assert(offseason.player_next(fresh, p["slug"]) == null);
});

test("the player route needs no team, and carries his next season in the offseason", () => {
  const p = a_returning_player();
  season.save_season(st);
  const out = api.call("GET", `/api/season/${st["id"]}/player?slug=${p["slug"]}`);
  assert(out["team"]["slug"] === ME && out["next"]["status"] === "returning", show([out["team"], out["next"]]));
});

await run();
