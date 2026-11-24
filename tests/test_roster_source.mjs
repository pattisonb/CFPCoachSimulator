// The roster file is where a real player's ratings live (the player's rule), and the only place: each player has one
// labeled set (data/engine_teams.json `ratings`), on the scale the game shows (the average player about a 70), and
// everything else about how good he is, is worked out from it when the file is read (teamdata_js/rosters.js): the
// numbers the play engine reads, his card, his overall, what he would be at every position. So a rating changed in the
// file by hand is his rating everywhere, and the number in the file is the number on his card: in the first season
// (this test changes one and reads the game's teams and its pages) and, through a career's league, in every later one.
// `node tests/test_roster_source.mjs`
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { start, test, run, assert, equal } from "./harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const game = await start();
const { season } = game;
const { league, rosters, build_teams } = game.modules;
const game_scale = game.modules.game_scale ?? (await import("../teamdata_js/game_scale.js")).game_scale;
const shown = (await import("../teamdata_js/shown.js")).shown;
const rv2 = (await import("../teamdata_js/ratings.js")).ratings;
const file = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "engine_teams.json"), "utf8"));
const attrs = game_scale.keys();
const copy = (v) => JSON.parse(JSON.stringify(v));
const find = (data, slug, player) => [...data["teams"][slug]["offense"], ...data["teams"][slug]["defense"]].find((x) => x["slug"] === player);
const qb_of = (data, slug) => data["teams"][slug]["offense"].find((x) => x["position"] === "QB");
const skill_rows = (p) => Object.fromEntries(season.all_skills(p).flatMap((g) => g["rows"]).map((r) => [r["key"], r["value"]]));

test("the game reads every player worked out from his ratings: the engine's numbers, his card, his overall, every position", () => {
  const data = rosters.read();
  let n = 0;
  for (const slug of ["texas", "ohio-state", "akron", "army"]) {
    const t = data["teams"][slug], f = file["teams"][slug];
    for (const unit of ["offense", "defense"]) {
      t[unit].forEach((p, i) => {
        const src = f[unit][i];
        const who = `${slug} ${p["name"]}`;
        equal([p["slug"], p["role"], p["depth"], p["in_game"]], [src["slug"], src["role"], src["depth"], src["in_game"]], who);
        equal(p["skills"], rosters.stored(src["ratings"], src["source_position"]), who);
        const ours = Object.fromEntries(attrs.map((k, j) => [k, p["skills"][j]]));
        equal(p["ovr"], game_scale.overall(ours, src["source_position"]), who);       // the overall the game has always used, on his stored skills
        assert(Number.isInteger(p["speed"]) && p["speed"] >= 1 && p["speed"] <= 99, who);
        assert(Object.keys(p["attributes"]).length >= 4 && Object.values(p["attributes"]).every((v) => v >= 1 && v <= 99), who);
        equal(Object.keys(p["ratings_at"]), [...build_teams.ENGINE_POSITIONS, "KR"], who);
        assert(p["fatigue"] === 0 && Object.values(p["stats"]).every((v) => v === 0) && !("ratings" in p), who);
        n += 1;
      });
    }
  }
  assert(n > 300, String(n));
  assert(Number.isInteger(qb_of(data, "texas")["passing"]) && qb_of(data, "texas")["attributes"]["arm_strength"] > 0);
});

test("the number in the file is the number on his card and in the list of his ratings, for every player", () => {
  const data = rosters.read();
  let cards = 0, rows = 0;
  for (const slug of ["ohio-state", "georgia", "navy", "ul-monroe", "kent-state"]) {
    const f = file["teams"][slug];
    [...data["teams"][slug]["offense"], ...data["teams"][slug]["defense"]].forEach((p, i) => {
      const src = [...f["offense"], ...f["defense"]][i];
      for (const [key, v] of Object.entries(p["attributes"])) {
        const from = rv2.ATTRIBUTES[key][3].sources;
        if (from.length !== 1) continue;                       // (a blend of two ratings is not one number of the file)
        equal(season.page_attribute(p, key, v), src["ratings"][from[0]], `${slug} ${p["name"]} ${key}`);
        cards += 1;
      }
      const listed = skill_rows(p);
      for (const k of attrs) {
        if (!(k in listed)) continue;
        equal(listed[k], src["ratings"][k], `${slug} ${p["name"]} ${k}`);
        rows += 1;
      }
    });
  }
  assert(cards > 5000 && rows > 5000, `${cards} ${rows}`);
});

test("Jeremiah Smith's speed set to 50 in the file: his card's Top Speed reads 50, the engine has him slow, his overall drops, and only his", () => {
  const before = rosters.derive(copy(file));
  const edited = copy(file);
  const mine = find(edited, "ohio-state", "jeremiah-smith");
  assert(mine && mine["ratings"]["speed"] > 85, "the file's Jeremiah Smith is not the fast one");
  mine["ratings"]["speed"] = 50;
  const after = rosters.derive(edited);
  const a = find(before, "ohio-state", "jeremiah-smith"), b = find(after, "ohio-state", "jeremiah-smith");
  equal(season.page_attribute(b, "top_speed", b["attributes"]["top_speed"]), 50);
  equal(skill_rows(b)["speed"], 50);
  equal(season.page_attribute(b, "burst", b["attributes"]["burst"]), mine["ratings"]["acceleration"]);     // what he did not touch reads as it did
  assert(b["speed"] < a["speed"] - 15, `engine speed ${a["speed"]} -> ${b["speed"]}`);
  assert(b["ovr"] < a["ovr"] && b["ratings_at"]["WR"] < a["ratings_at"]["WR"], `overall ${a["ovr"]} -> ${b["ovr"]}`);
  equal([b["hands"], b["route_running"], b["attributes"]["hands"]], [a["hands"], a["route_running"], a["attributes"]["hands"]]);
  // everyone else on the team, and every other team, is as he was
  const rest = (d) => JSON.stringify([d["teams"]["ohio-state"]["offense"].filter((p) => p["slug"] !== a["slug"]), d["teams"]["ohio-state"]["defense"], d["teams"]["michigan"]]);
  assert(rest(before) === rest(after), "another player moved");
  // a value changed since (a god-mode edit of the card) shows as that value, not as the file's
  assert(season.page_attribute(b, "top_speed", 80) !== 50);
});

test("a quarterback's arm changed in the file moves his passing, his card and his overall", () => {
  const before = rosters.derive(copy(file));
  const edited = copy(file);
  const mine = qb_of(edited, "texas");
  for (const k of ["throw_power", "throw_accuracy_short", "throw_accuracy_mid", "throw_accuracy_deep"]) mine["ratings"][k] = Math.max(1, mine["ratings"][k] - 20);
  const a = qb_of(before, "texas"), b = qb_of(rosters.derive(edited), "texas");
  assert(b["passing"] < a["passing"] - 8, `passing ${a["passing"]} -> ${b["passing"]}`);
  assert(b["attributes"]["arm_strength"] < a["attributes"]["arm_strength"] && b["ovr"] < a["ovr"] && b["ratings_at"]["QB"] < a["ratings_at"]["QB"]);
  equal(season.page_attribute(b, "arm_strength", b["attributes"]["arm_strength"]), mine["ratings"]["throw_power"]);
  equal([b["speed"], b["strength"]], [a["speed"], a["strength"]]);
});

test("a rating typed loosely is put right, and one left out is an ordinary one", () => {
  const edited = copy(file);
  const mine = qb_of(edited, "texas");
  mine["ratings"]["speed"] = 140;
  mine["ratings"]["strength"] = 61.4;
  delete mine["ratings"]["stamina"];
  const p = qb_of(rosters.derive(edited), "texas");
  equal([p["filed"]["speed"], p["filed"]["strength"], p["filed"]["stamina"]], [99, 61, rosters.MISSING]);
});

test("every reader gets a copy of its own, and a career's later season (its numbers already worked out) is read as it is", () => {
  const one = rosters.read(), two = rosters.read();
  one["teams"]["texas"]["offense"][0]["speed"] = -5;
  assert(two["teams"]["texas"]["offense"][0]["speed"] !== -5 && rosters.read()["teams"]["texas"]["offense"][0]["speed"] !== -5);
  assert(rosters.shared() === rosters.shared(), "the games read one kept copy");
  const built = { teams: { x: { offense: [{ slug: "a", speed: 44, skills: [1, 2] }], defense: [] } } };
  equal(rosters.derive(copy(built)), built);
});

test("a career's league takes every real player's ratings from the roster file, by team and player", () => {
  const rated = league._roster_ratings();
  const p = qb_of(file, "texas");
  equal(rated["texas"][p["slug"]], rosters.stored(p["ratings"], p["source_position"]));
  equal(rated["texas"][p["slug"]], qb_of(rosters.read(), "texas")["skills"]);          // the same skills season one shows and plays
  const n = Object.values(rated).reduce((k, t) => k + Object.keys(t).length, 0);
  assert(n > 10000, `${n} players`);
  const as_file = rated["texas"][p["slug"]];
  equal(league.compact(league._as_source(p), attrs, "TX", as_file)["r"], as_file);
  // ... and they are on the page what the file has (a career shows a stored skill through shown.skill)
  const grp = game_scale.group(p["source_position"]);
  let same = 0;
  attrs.forEach((k, i) => { if (shown.skill(as_file[i], grp, k) === p["ratings"][k]) same += 1; });
  assert(same >= attrs.length - 12, `${same} of ${attrs.length} read as the file has them`);
});

test("a career's first league is read straight from the roster file: every player, his team's coaches and its lineup shape", () => {
  const first = league.from_base(2028), again = league.from_base(2027);
  equal([first["year"], again["year"]], [2028, 2027]);
  equal(new Set(Object.values(first["teams"]).map((t) => t["program"]["year"])), new Set([2027]));     // as programs.init sets it
  first["teams"]["texas"]["roster"][0]["n"] = "Changed";
  assert(again["teams"]["texas"]["roster"][0]["n"] !== "Changed" && league.from_base()["teams"]["texas"]["roster"][0]["n"] !== "Changed", "a copy of its own each time");
  equal(Object.keys(again["teams"]).sort(), league.base_slugs().filter((s) => !league.base_meta(s)["fictional"]));
  for (const slug of ["texas", "akron", "army"]) {
    const f = file["teams"][slug], t = again["teams"][slug];
    equal(t["roster"].map((c) => c["id"]), [...f["offense"], ...f["defense"]].map((x) => x["slug"]), slug);       // every player of the file, the added ones too
    equal([t["formation"], t["coaches"]["head_coach"]["name"]], [f["formation"], f["coaches"]["head_coach"]["name"]], slug);
    // each as the general path makes a league player (compact), to the letter
    [...f["offense"], ...f["defense"]].forEach((x, i) => {
      if (i % 9) return;
      const general = league.compact(league._as_source(x), attrs, f["state"], rosters.stored(x["ratings"], x["source_position"]));
      equal(t["roster"][i], general, `${slug} ${x["name"]}`);
    });
  }
  assert(!("roster" in league.base_meta("smu")) && league.base_meta("smu")["conference"]);
  // an FCS stand-in is no league team: it plays the roster file's roster in every later season
  const fict = league.base_slugs().find((s) => league.base_meta(s)["fictional"]);
  const src = league.source_teams(again).find((t) => t["slug"] === fict);
  assert(src["roster"].length >= 60 && Object.keys(src["starters"]).length === 3, fict);
});

test("the first league's ratings are the roster file's", () => {
  const lgd = league._compute_base(league.FIRST_YEAR + 1);
  const rated = league._roster_ratings();
  let checked = 0;
  for (const slug of ["texas", "ohio-state", "akron"]) {
    for (const c of lgd["teams"][slug]["roster"]) {
      const r = rated[slug][c["id"]];
      if (!r) continue;
      equal(c["r"], r, `${slug} ${c["n"]}`);
      checked += 1;
    }
  }
  assert(checked > 150, String(checked));
});

await run();
