// Your coach: a coach is validated, the team's coordinators stay when he takes over (his own
// scheme only on a side he calls), his discipline moves relative to the coach he replaces, and
// a season started with him or with the team's own coach says who is coaching.
// `node tests/test_coach.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";

const game = await start();
const { season, coaches } = game;

/** coaches.clean must reject this coach with a ValueError; `failure` says what went wrong if not. */
function assert_refused(coach, failure) {
  try {
    coaches.clean(coach);
  } catch (e) {
    if (e instanceof coaches.ValueError) return;
    throw e;
  }
  throw new Error(failure);
}

test("coach", () => {
  let c = coaches.blank();
  // validation: a name is required and the ratings budget holds
  assert_refused(c, "a coach without a name was accepted");
  Object.assign(c, { first_name: "Test", last_name: "Coach" });
  assert_refused({ ...c, ratings: Object.fromEntries(coaches.RATING_KEYS.map((k) => [k, 99])) }, "ratings over the budget were accepted");
  c = coaches.clean({ ...c, calls_offense: true, calls_defense: false, offense_scheme: "Air Raid" });
  assert(!("oc" in c) && !("dc" in c));   // no in-season hiring

  const team = season.load_teams()["ohio-state"];
  const t = coaches.apply_coach(team, c);
  const oc = team["coaches"]["offensive_coordinator"], dc = team["coaches"]["defensive_coordinator"];
  // the coordinators stay; his scheme is used on the side he calls
  assert(t["coaches"]["offensive_coordinator"]["name"] === oc["name"]);
  assert(t["coaches"]["offensive_coordinator"]["scheme"]["offensive_scheme"] === "Air Raid");
  equal(t["coaches"]["defensive_coordinator"], dc);
  assert(t["tendencies"]["pass_rate"] === c["style"]["pass_rate"]);
  assert(t["tendencies"]["blitz_rate"] === team["tendencies"]["blitz_rate"]);
  assert(team["coaches"]["offensive_coordinator"]["scheme"]["offensive_scheme"] !== "Air Raid");   // the team itself is untouched
  // discipline moves by the difference from the coach he replaces
  const old = team["coaches"]["head_coach"]["ratings"]["discipline"] ?? 50;
  const want = Math.max(0, Math.min(100, (team["tendencies"]["discipline"] ?? 50) + c["ratings"]["discipline"] - old));
  assert(t["tendencies"]["discipline"] === want, () => JSON.stringify([t["tendencies"]["discipline"], want]));
  const staff = coaches.staff(c, team);
  assert(staff["offense"] === "calls the Air Raid offense as head coach" && staff["defense"].startsWith(`DC ${dc["name"]}`), () => JSON.stringify(staff));

  // a season with him: he is in the summary, and the team the games use has his offense
  const st = season.new_season("ohio-state", "full", 3, undefined, c);
  const line = season.summary(st)["coach"];
  assert(line["existing"] === false, () => JSON.stringify(line));
  equal(line["staff"], staff);
  const played = season.with_edits(season.load_teams()["ohio-state"], season.team_edits(st, "ohio-state"));
  assert(played["coaches"]["offensive_coordinator"]["scheme"]["offensive_scheme"] === "Air Raid");
  // taking over the team's own coach: the summary names him and his staff
  const st2 = season.new_season("ohio-state", "full", 3);
  const line2 = season.summary(st2)["coach"];
  assert(line2["existing"] === true && line2["name"] === team["coaches"]["head_coach"]["name"], () => JSON.stringify(line2));
  assert(line2["staff"]["offense"].startsWith(`OC ${oc["name"]}`), () => JSON.stringify(line2));
  console.log("coach ok:", line2["name"], "|", JSON.stringify(staff));
});

await run();
