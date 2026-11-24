// Play It on the Field's roster link (sim_js/season/part3.js playlink_team and playlink_game; the page packs them:
// ui/src/franchise.ts): each team as the sim would take it into a game, and the game itself. The roster the link has
// always carried (depth chart, players, their 54 skills), and beside it the team's mood and each player's form and
// factor, the injured and the redshirting, fatigue, the coaches, the tendencies, the schemes and formations, the home
// field, and the game: its week, where it is, who is at home, records and ranks. The field's reader keeps the fields
// it knows and drops the rest, and refuses a link past 200,000 characters or 2 MB unpacked: the link stays inside both.
// `node tests/test_playlink.mjs`
import zlib from "node:zlib";
import { start, test, run, assert, equal } from "./harness.mjs";

const game = await start({ env: { SIM_WORKERS: "1" } });
const { season, api } = game;
const ME = "ohio-state";
const show = (v) => JSON.stringify(v).slice(0, 400);

const sid = api.call("POST", "/api/season", { team: ME, mode: "full", seed: 9, career: true })["id"];
api.call("POST", `/api/season/${sid}/advance`, { to: 4 });
while (api.running()) api.step(null);
const st = api.loaded_state();
const next = Object.values(st["games"]).filter((g) => (g["home"] === ME || g["away"] === ME) && !g["played"]).sort((a, b) => a["week"] - b["week"])[0];
const OPP = next["home"] === ME ? next["away"] : next["home"];
const link = (slug) => api.call("GET", `/api/season/${sid}/playlink/${slug}`);

test("the roster is what the link has always carried: the depth chart, and every player with his 54 skills", async () => {
  const t = link(ME);
  equal([t["slug"], typeof t["name"], typeof t["abbr"]], [ME, "string", "string"]);
  assert(t["players"].length >= 70 && t["depth"]["QB"].length >= 1 && t["colors"]["primary"], show(Object.keys(t)));
  for (const p of t["players"]) {
    assert(p["slug"] && p["name"] && p["pos"] && p["skills"].length === 54 && p["ovr"] >= 1 && p["ovr"] <= 99, show(p));
  }
  // the skills are the numbers the roster file holds and the card shows (the one scale), in game_scale.keys() order
  const fs = await import("node:fs");
  const filed = JSON.parse(fs.readFileSync(new URL("../data/engine_teams.json", import.meta.url), "utf8"))["teams"][ME];
  const keys = game.modules.game_scale ? game.modules.game_scale.keys() : (await import("../teamdata_js/game_scale.js")).game_scale.keys();
  let same = 0, all = 0;
  for (const src of [...filed["offense"], ...filed["defense"]]) {
    const p = t["players"].find((x) => x["slug"] === src["slug"]);
    if (!p) continue;
    const by_skill = game.modules.rosters.skills_of(src);
    keys.forEach((k, i) => { all += 1; if (p["skills"][i] === by_skill[k]) same += 1; });
  }
  assert(all > 3000 && same === all, `${same} of ${all} skills in the link are the file's numbers`);
  // ... and his card as the card prints it: every name and number of the file's that his card shows, and Decision
  // Making, which the card works out
  for (const src of [...filed["offense"], ...filed["defense"]]) {
    const p = t["players"].find((x) => x["slug"] === src["slug"]);
    if (!p) continue;
    assert(Object.keys(p["card"]).length >= 4, show(p["card"]));
    for (const [name, v] of Object.entries(p["card"])) {
      assert(Number.isInteger(v) && v >= 1 && v <= 99, `${p["name"]} ${name} ${v}`);
      if (name !== "Decision Making") equal(v, src["ratings"][name], `${p["name"]} ${name}`);
    }
  }
  const qb = t["players"].find((x) => x["pos"] === "QB");
  assert(Object.keys(qb["card"]).length === 23 && qb["card"]["Decision Making"] >= 1 && "Juke Move" in qb["card"] && "Spin Move" in qb["card"] && "Toughness" in qb["card"] && "Pocket Poise" in qb["card"] && "Football IQ" in qb["card"], show(qb["card"]));
  const smith = t["players"].find((x) => x["slug"] === "jeremiah-smith");
  equal(smith["skills"][keys.indexOf("speed")], [...filed["offense"]].find((x) => x["slug"] === "jeremiah-smith")["ratings"]["Top Speed"]);
  const slugs = new Set(t["players"].map((p) => p["slug"]));
  assert(Object.values(t["depth"]).every((group) => group.every((s) => slugs.has(s))), "the depth chart names a player the link does not have");
});

test("form and morale: the team's mood, and each player's streak and the factor the sim plays him at", () => {
  const t = link(ME);
  const mood = season.morale_payload(st, ME);
  assert(mood !== null && typeof t["morale"] === "number" && Math.abs(t["morale"] - mood["team"]) < 0.001, show([t["morale"], mood["team"]]));
  const forms = t["players"].map((p) => p["form"]);
  assert(forms.every((f) => f >= -1 && f <= 1) && forms.some((f) => f > 0.05) && forms.some((f) => f < -0.05), "nobody is hot or nobody is cold after four weeks");
  for (const p of t["players"]) {
    assert(p["factor"] >= 0.9 && p["factor"] <= 1.1 && p["fatigue"] === 0, show([p["name"], p["factor"], p["fatigue"]]));
  }
  // the factor is the sim's own: his form and his team's mood together
  const full = [...season.team_data(st, ME)["offense"], ...season.team_data(st, ME)["defense"]];
  const hot = [...t["players"]].sort((a, b) => b["form"] - a["form"])[0], cold = [...t["players"]].sort((a, b) => a["form"] - b["form"])[0];
  for (const p of [hot, cold]) {
    const src = full.find((x) => x["slug"] === p["slug"]);
    assert(Math.abs(p["factor"] - season.morale_factor(st, ME, src["name"], src["position"])) < 0.001, show(p["name"]));
  }
  assert(hot["factor"] > cold["factor"], show([hot["factor"], cold["factor"]]));
  // with the setting off: no mood, no streaks, everyone at 1
  season.update_settings(st, { morale: false });
  const off = season.playlink_team(st, ME);
  assert(off["morale"] === null && off["players"].every((p) => p["form"] === 0 && p["factor"] === 1), "morale off still moves a rating");
  season.update_settings(st, { morale: true });
});

test("the injured and the redshirting: on the player and in the team's list of who is out", () => {
  const hurt = Object.entries(st["injuries"] || {}).find(([slug, by]) => Object.keys(by).length && !season.load_teams()[slug]["fictional"]);
  assert(hurt, "nobody in the league is hurt after four weeks");
  const [slug, by] = hurt;
  const t = link(slug);
  const inj = Object.values(by)[0];
  const row = t["out"].find((o) => o["name"] === inj["name"] && o["why"] === "injury");
  assert(row && row["type"] === inj["type"] && row["weeks_left"] === inj["weeks_left"] && row["slug"], show(t["out"]));
  const p = t["players"].find((x) => x["slug"] === row["slug"]);
  equal(p["injury"], { type: inj["type"], weeks_left: inj["weeks_left"] });
  assert(link(ME)["players"].filter((x) => x["injury"]).length === link(ME)["out"].filter((o) => o["why"] === "injury" && o["slug"]).length);
  // a redshirt is out the same way
  const mine = link(ME);
  const fr = mine["players"].find((x) => x["cls"] === "FR" && !x["injury"]);
  const src = [...season.team_data(st, ME)["offense"], ...season.team_data(st, ME)["defense"]].find((x) => x["slug"] === fr["slug"]);
  st["redshirting"] = { [ME]: { [fr["slug"]]: { name: src["name"], position: src["position"] } } };
  const again = season.playlink_team(st, ME);
  assert(again["players"].find((x) => x["slug"] === fr["slug"])["redshirting"] === true && again["out"].some((o) => o["slug"] === fr["slug"] && o["why"] === "redshirt"));
  delete st["redshirting"];
});

test("the coaches, how the team calls a game, its schemes and formations, and its home field", () => {
  const t = link(ME), src = season.team_data(st, ME);
  equal(Object.keys(t["coaches"]), ["head_coach", "offensive_coordinator", "defensive_coordinator"]);
  for (const c of Object.values(t["coaches"])) assert(c["name"] && Object.keys(c["ratings"]).length && Object.keys(c["scheme"]).length, show(c));
  equal(t["coaches"]["head_coach"]["name"], src["coaches"]["head_coach"]["name"]);
  equal(t["tendencies"], src["tendencies"]);
  for (const k of ["pass_rate", "tempo", "fourth_down_go_rate", "blitz_rate", "deep_shot_rate", "man_coverage_rate"]) assert(typeof t["tendencies"][k] === "number", k);
  equal([t["home_field"], t["stadium"]], [src["home_field_advantage"], src["stadium"]]);
  const book = t["playbook"];
  assert(book["offense"]["scheme"] && book["defense"]["scheme"], show([book["offense"]["scheme"], book["defense"]["scheme"]]));
  assert(book["offense"]["formations"].length >= 2 && book["defense"]["formations"].length >= 2 && book["special"]["formations"].length === 3);
  const slugs = new Set(t["players"].map((p) => p["slug"]));
  for (const unit of ["offense", "defense", "special"]) {
    for (const f of book[unit]["formations"]) {
      assert(f["id"] && f["name"] && f["slots"].length, show(f));
      assert(f["slots"].every((s) => s["slot"] && s["label"] && (s["slug"] === null || slugs.has(s["slug"]))), `${unit} ${f["name"]}: a slot names nobody on the roster`);
    }
  }
  assert(book["offense"]["formations"].every((f) => f["slots"].length === 11) && book["offense"]["formations"][0]["usage"] > 0, "an offense's formation is eleven men, the most used first");
});

test("the game itself: this week's game between the two, where it is and who is at home, each side's record and rank", () => {
  const g = api.call("GET", `/api/season/${sid}/playlink_game?offense=${ME}&defense=${OPP}`);
  equal([g["scheduled"], g["event_id"], g["game_week"], g["home"], g["away"], g["kind"]], [true, next["event_id"], next["week"], next["home"], next["away"], next["kind"]]);
  equal([g["year"], g["week"], g["done"], g["date"], g["neutral"], g["conference_game"]], [season.season_year(st), st["current_week"] + 1, false, next["date"], !!next["neutral"], !!next["conference_game"]]);
  const teams = season.load_teams();
  equal([g["home_field"], g["stadium"]], next["neutral"] ? [0, null] : [teams[next["home"]]["home_field_advantage"], teams[next["home"]]["stadium"]]);
  equal([g["offense"]["slug"], g["defense"]["slug"]], [ME, OPP]);
  assert(/^\d+-\d+$/.test(g["offense"]["record"]) && /^\d+-\d+$/.test(g["defense"]["record"]) && g["offense"]["ratings"]["overall"] > 0, show(g["offense"]));
  // the same game whichever side has the ball
  const flipped = api.call("GET", `/api/season/${sid}/playlink_game?offense=${OPP}&defense=${ME}`);
  equal([flipped["event_id"], flipped["home"], flipped["offense"]["slug"]], [g["event_id"], g["home"], OPP]);
  // two teams with no game between them can still be taken to the field: there is no game to send
  const stranger = Object.keys(teams).find((s) => !teams[s]["fictional"] && s !== ME && !Object.values(st["games"]).some((x) => [x["home"], x["away"]].includes(ME) && [x["home"], x["away"]].includes(s)));
  const none = api.call("GET", `/api/season/${sid}/playlink_game?offense=${ME}&defense=${stranger}`);
  assert(none["scheduled"] === false && !("home" in none) && none["defense"]["slug"] === stranger && none["week"] === st["current_week"] + 1, show(none));
  // one team alone (no defense picked)
  const alone = api.call("GET", `/api/season/${sid}/playlink_game?offense=${ME}`);
  assert(alone["scheduled"] === false && alone["defense"] === null && alone["offense"]["slug"] === ME);
});

test("the whole link, packed as the page packs it, is inside what the field reads", () => {
  // (the page also puts a face on each player: about 300 characters of JSON a man, counted here at their largest)
  const face = { faceShape: "face_shape_04", skinTone: "light", hairColor: "darkbrown", eyeColor: "brown", ears: "ears_00", chin: null, nose: "nose_00",
    beard: "beard_02", mouth: "mouth_03", brows: "brows_00", hair: "hair_03", hairFade: false, flip: ["hair", "brows"] };
  const dress = (t) => ({ ...t, players: t["players"].map(({ _position, _look, ...p }) => ({ ...p, face, skin: ["#f1c7a5", "#d9a57f"] })) });
  const payload = { v: 1, offense: dress(link(ME)), defense: dress(link(OPP)),
    game: api.call("GET", `/api/season/${sid}/playlink_game?offense=${ME}&defense=${OPP}`) };
  const json = JSON.stringify(payload);
  const packed = zlib.deflateRawSync(Buffer.from(json, "utf8")).toString("base64url");
  console.log(`the link: ${json.length} characters of JSON, ${packed.length} packed`);
  assert(json.length < 2_000_000, `the link unpacks to ${json.length} characters`);
  assert(packed.length < 200_000, `the packed link is ${packed.length} characters`);
  assert(!/null,"name"|undefined|NaN/.test(json), "the link holds a hole");
});

await run();
