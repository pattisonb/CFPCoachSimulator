// Rivalries (data/rivalries.json; sim_js/season rivalry_for, rivalry_series, rivalries_view): every rivalry names two
// teams of the game and their series; the series moves when the game is played, and the schedule and the rivalries
// page show it; a rivalry with no history reads "First meeting"; the service academies' game in selection week counts.
// `node tests/test_rivalries.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";

const game = await start({ env: { SIM_WORKERS: "1" } });
const { season } = game;
const show = (v) => JSON.stringify(v);
const [A, B] = ["michigan", "ohio-state"];
const between = (g, a, b) => (g["home"] === a && g["away"] === b) || (g["home"] === b && g["away"] === a);

test("every rivalry in the data names two FBS teams and a series record for each", () => {
  const teams = season.load_teams();
  const rivs = Object.entries(season.load_rivalries()).filter(([k]) => k !== "__as_of__").map(([, r]) => r);
  assert(rivs.length >= 50, String(rivs.length));
  for (const r of rivs) {
    const [a, b] = r["teams"];
    assert(a in teams && b in teams && !teams[a]["fictional"] && !teams[b]["fictional"], r["name"]);
    assert(a in r["series"] && b in r["series"], r["name"]);
  }
});

const st = season.new_season(A, "full", 11);
const riv = season.rivalry_for(A, B);
const g = Object.values(st["games"]).find((x) => between(x, A, B));

test("a rivalry game played adds a win to the series, and the schedule shows the series with the game", () => {
  const before = season.rivalry_series(st, riv);
  equal(g["week"], 14);                                    // the regular season's last week
  season.advance_to(st, 14);
  const after = season.rivalry_series(st, riv);
  const winner = g["home_score"] > g["away_score"] ? g["home"] : g["away"];
  assert(after["wins"][winner] === before["wins"][winner] + 1, show([before, after]));
  equal(after["last"]["winner"], winner);
  assert(season.game_rivalry(st, g, true)["headline"]);
  const row = season.team_schedule(st, A).find((x) => x["opponent"] === B);
  assert(row["rivalry"] && row["rivalry"]["series"] === after["text"], show(row["rivalry"]));
});

// a custom program's new rivalry has no series behind it
test("a rivalry with no history reads First meeting until it is played, then the winner leads 1-0", () => {
  const fresh = { teams: [A, B], name: "M vs. O", trophy: "", series: {} };
  equal(season.rivalry_series(st, fresh, 1)["text"], "First meeting");
  assert(season.rivalry_series(st, fresh)["text"].endsWith("leads 1-0"), season.rivalry_series(st, fresh)["text"]);
});

test("a team's rivalries page lists its rivalries with their names, trophies and this season's game", () => {
  const view = season.rivalries_view(st, A)["rivalries"];
  const mine = Object.entries(season.load_rivalries()).filter(([k, r]) => k !== "__as_of__" && r["teams"].includes(A)).map(([, r]) => r);
  assert(mine.length >= 2 && mine.some((r) => r["trophy"]), "the data gives this team a trophy game");
  for (const r of mine) assert(view.some((v) => v["name"] === r["name"] && (v["trophy"] || "") === (r["trophy"] || "")), r["name"]);
  const row = view.find((v) => v["name"] === riv["name"]);
  assert(row["game"] && row["game"]["week"] === 14 && typeof row["game"]["won"] === "boolean", show(row["game"]));
});

test("the service academies' game in selection week counts in their series", () => {
  season.advance_to(st, 16);
  const an = season.rivalry_series(st, season.rivalry_for("army", "navy"));
  assert(an["last"] && an["last"]["week"] === 16, show(an));
});

await run();
