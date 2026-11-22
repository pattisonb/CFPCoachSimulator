// A team's ratings follow its depth chart and its injuries (season.team_ratings_now): untouched and healthy they are
// the ratings built with the team; sit the starting quarterback, by injury or on the chart, and the offense drops.
// `node tests/test_team_ratings_now.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { get, truthy } from "../engine_js/pyrt.js";

const game = await start();
const { season } = game;

test("team ratings now", () => {
  const state = season.new_season("ohio-state", "full", 3);
  const me = "ohio-state";
  const built = season.load_teams()[me]["team_ratings"];
  const now = season.team_ratings_now(state, me);
  // a career's teams are built by the same sum (exact); the 2026 teams file was rated before its depth charts were put in
  // real order, so its starters differ by a man or two
  assert(["overall", "offense", "defense"].every((k) => Math.abs(now[k] - built[k]) < 1.5), () => JSON.stringify([now, built]));
  const page = season._unit_overalls(state, me);
  equal(new Set(Object.keys(page)), new Set(["overall", "offense", "defense"]));
  assert(Object.values(page).every((v) => Number.isInteger(v)), () => JSON.stringify(page));

  const t = season.apply_depth(season.team_data(state, me), get(get(state, "depth") || {}, me));
  const qbs = season._players_by_role(t, [...t["offense"], ...t["defense"]])["QB"];
  assert(qbs.length >= 2 && season.shown_overall(qbs[0]) > season.shown_overall(qbs.at(-1)));
  const qb = qbs[0];

  // hurt: the next man starts, the offense is worse, the defense is the same
  state["injuries"] ??= {};
  state["injuries"][me] ??= {};
  state["injuries"][me][`${qb["name"]}|${qb["position"]}`] = {
    name: qb["name"], position: qb["position"], type: "ankle sprain", weeks: 2, weeks_left: 2, since_week: 0, event_id: "x" };
  const hurt = season.team_ratings_now(state, me);
  assert(hurt["offense"] < now["offense"] && hurt["defense"] === now["defense"] && hurt["overall"] < now["overall"], () => JSON.stringify([hurt, now]));
  for (const k of Object.keys(state["injuries"][me])) delete state["injuries"][me][k];
  equal(season.team_ratings_now(state, me), now, "healed, the ratings come back");

  // the chart: start the last quarterback
  const order = qbs.map((p) => p["slug"]);
  state["depth"] ??= {};
  state["depth"][me] ??= {};
  state["depth"][me]["QB"] = [order.at(-1), ...order.slice(0, -1)];
  const moved = season.team_ratings_now(state, me);
  assert(moved["offense"] < now["offense"], () => JSON.stringify([moved, now]));

  // the chart knows when it is back as it started (the Reset Chart button), whatever is stored
  delete state["depth"][me];
  assert(!season.depth_changed(state, me));
  season.move_depth(state, me, "QB", order[1], "up");
  assert(season.depth_changed(state, me));
  season.move_depth(state, me, "QB", order[0], "up");
  assert(truthy(state["depth"][me]) && !season.depth_changed(state, me), "moved back: no change to reset");

  // an FCS stand-in has none
  const fcs = Object.entries(season.load_teams()).find(([, x]) => x["fictional"])[0];
  assert(season.team_ratings_now(state, fcs) === null && season.team_overall(state, fcs) === null);
  console.log(`team ratings now ok: offense ${now["offense"]} healthy, ${hurt["offense"]} with the quarterback hurt, ${moved["offense"]} with the last one starting`);
});

await run();
