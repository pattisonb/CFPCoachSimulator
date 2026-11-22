// Path to the League: a school's pull on a recruit is its Pro Pipeline grade at his position group,
// one recruit in ten has it first, and the deciders who care about it carry it.
// `node tests/test_pro_pitch.mjs`
import { start, test, run, assert } from "./harness.mjs";
import { fmt, get, sum } from "../engine_js/pyrt.js";

const game = await start();
const { season, recruiting } = game;
const { persona, programs } = game.modules;
const J = (v) => () => JSON.stringify(v);
const has = (xs, v) => (xs instanceof Set ? xs.has(v) : xs.includes(v));

test("pro pitch", () => {
  assert(recruiting.PITCHES.includes("pro") && recruiting.PITCHES.indexOf("pro") === 6);   // after the first seven-topic set; the School Grades topics follow academics
  for (const table of [recruiting.PRIORITY_ODDS, recruiting.PORTAL_PRIORITY_ODDS, recruiting.PORTAL_TOP_PRIORITY_ODDS]) {
    assert(Math.abs(sum(Object.values(table)) - 1.0) < 1e-9 && table["pro"] > 0, J(table));
  }
  const p = { pro: 40, pro_groups: { OT: 80, IOL: 40, WR: 95, EDGE: 70 } };
  assert(programs.pro_group_grade(p, "OL") === 60 && programs.pro_group_grade(p, "WR") === 95);
  assert(programs.pro_group_grade(p, "DL") === 35 && programs.pro_group_grade(p, "QB") === 0 && programs.pro_group_grade(p, "ATH") === 40);
  assert(programs.pro_group_grade({}, "WR") === 0);
  assert(has(persona.DECIDER_TOPICS["dad"], "pro") && has(persona.DECIDER_TOPICS["trainer"], "pro") && has(persona.DECIDER_TOPICS["hs_coach"], "pro"));
  const st = season.new_season("ohio-state", "full", 11, undefined, undefined, true);
  const rc = st["recruiting"];
  const wr = Object.keys(rc["prospects"]).find((pid) => rc["prospects"][pid]["ea_position"] === "WR");
  const k = Object.keys(rc["prospects"]).find((pid) => ["K", "P"].includes(rc["prospects"][pid]["ea_position"]));
  assert(wr !== undefined && k !== undefined);
  const osu = recruiting.strengths(st, "ohio-state", wr), sjsu = recruiting.strengths(st, "san-jose-state", wr);
  assert(osu["pro"] > 0.85 && sjsu["pro"] < 0.2, J([osu["pro"], sjsu["pro"]]));
  const army = recruiting.strengths(st, "army", wr)["pro"];
  assert(0.0 <= army && army <= 0.1, "no picks in ten years: the floor");
  assert(Math.abs(recruiting.strengths(st, "ohio-state", k)["pro"] - recruiting._logistic(recruiting.PRO_PULL_K * (programs.get(st, "ohio-state")["pro"] - 50) / 25)) < 0.01);
  const all = Object.values(rc["prospects"]);
  const share = all.filter((pr) => pr["priorities"].includes("pro")).length / all.length;
  assert(0.15 <= share && share <= 0.30, J(share));          // pro is 8% of a first pick across thirteen topics (School Grades Phase 2), tilted up for five-stars and All Business
  const first = all.filter((pr) => pr["priorities"][0] === "pro").length / all.length;
  assert(0.05 <= first && first <= 0.11, J(first));          // 8% base odds, diluted a little by the other leans
  console.log(`pro pitch ok: Ohio State WR ${fmt(osu["pro"], 2)} vs San José State ${fmt(sjsu["pro"], 2)}; ${fmt(share * 100, 0)}% of the class carry it, ${fmt(first * 100, 0)}% first`);
});

await run();
