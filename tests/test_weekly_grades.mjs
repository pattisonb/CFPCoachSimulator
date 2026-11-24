// This season's school grades move every week, and recruits move with them (the player's rule). Winning is this
// season's record and ranking; Contender is whether the program is in the playoff picture; Recruiting is its last three
// classes and the one it is building. Each is a standing every school has every week (recruiting.weekly), shown on the
// Programs page as a letter with what it did over the week (programs.rows), and weighed by every recruit who holds it
// as a priority: his interest follows it, and a program that falls far enough under what he wants is one he will no
// longer hear from, until it comes back (recruiting.locked_out, the "door_closed" and "door_open" news). Prestige
// takes the multi-year view: history and the last five seasons.
// `node tests/test_weekly_grades.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";

const game = await start({ env: { SIM_WORKERS: "1" } });
const { season, recruiting } = game;
const { programs, grades } = game.modules;
const ME = "ohio-state";
const show = (v) => JSON.stringify(v).slice(0, 500);

/** A career before its first game. */
const fresh = (seed = 9) => season.new_season(ME, "full", seed, undefined, undefined, true);
/** Play my next `n` games by hand: `won` says how each went. The week moves on with them. */
function play(st, n, won) {
  const mine = Object.values(st["games"]).filter((g) => (g["home"] === ME || g["away"] === ME) && !g["played"]).sort((a, b) => a["week"] - b["week"]).slice(0, n);
  for (const g of mine) {
    const home = g["home"] === ME;
    Object.assign(g, { played: true, home_score: home === won ? 31 : 10, away_score: home === won ? 10 : 31 });
    st["current_week"] = Math.max(st["current_week"], g["week"]);
  }
  recruiting.reset_caches();
}
const row = (st, slug = ME) => programs.rows(st).find((r) => r["team"] === slug);

test("every school has this season's three grades from week 0, as numbers and letters, beside the yearly ones", () => {
  const st = fresh();
  const rows = programs.rows(st);
  equal(rows.length, 138);
  for (const r of rows) {
    for (const k of programs.SEASON) {
      assert(typeof r[k] === "number" && r[k] >= 0 && r[k] <= 100 && /^[A-DF][+-]?$/.test(r["letters"][k]), show([r["team"], k, r[k], r["letters"][k]]));
      equal(r["letters"][k], grades.school(r[k]), `${r["team"]} ${k}`);
    }
    assert(typeof r["grades"]["development"] === "number" && typeof r["grades"]["culture"] === "number" && r["letters"]["development"] && r["letters"]["culture"], r["team"]);
    assert(typeof r["winning_years"] === "number", "the three-year measure the collective and the crowd follow is kept");
    equal(r["week_moved"], {});                                  // nothing has been played
  }
  // a title program and a rebuilding one are far apart before a game is played
  const top = row(st, "ohio-state"), low = row(st, "akron");
  assert(top["contender"] > low["contender"] + 30 && top["recruiting"] > low["recruiting"] + 30 && top["winning"] > low["winning"], show([top["contender"], low["contender"]]));
});

test("Winning and Contender fall with losses and rise with wins, week by week, and the page says what the week did", () => {
  const st = fresh();
  programs.snapshot_week(st);
  const before = row(st);
  play(st, 2, false);
  programs.snapshot_week(st);
  const lost = row(st);
  assert(lost["winning"] < before["winning"] - 10 && lost["contender"] < before["contender"] - 5, show([before["winning"], lost["winning"], before["contender"], lost["contender"]]));
  assert(grades.place(lost["letters"]["winning"]) < grades.place(before["letters"]["winning"]), show([before["letters"]["winning"], lost["letters"]["winning"]]));
  assert(lost["week_moved"]["winning"] < 0 && lost["week_moved"]["contender"] < 0, show(lost["week_moved"]));
  assert(Math.abs(lost["week_moved"]["winning"] - (lost["winning"] - before["winning"])) < 0.2, show([lost["week_moved"], lost["winning"], before["winning"]]));
  // the yearly grades did not move with a game
  equal([lost["prestige"], lost["grades"]["development"], lost["grades"]["culture"], lost["grades"]["facilities"]],
    [before["prestige"], before["grades"]["development"], before["grades"]["culture"], before["grades"]["facilities"]]);
  play(st, 3, true);
  programs.snapshot_week(st);
  const back = row(st);
  assert(back["winning"] > lost["winning"] && back["week_moved"]["winning"] > 0, show([lost["winning"], back["winning"], back["week_moved"]]));
});

test("Contender reads the ranking, then the record, and never more than the losses allow", () => {
  const c = programs.contender_of;
  assert(c(1, 8, 0) === 1.0 && c(4, 8, 0) === 1.0 && c(5, 8, 0) < 1.0 && c(12, 8, 1) > c(13, 8, 1) && c(25, 7, 2) > c(null, 7, 2), "the ranking");
  assert(c(null, 8, 0) > c(null, 4, 4) && c(null, 8, 0) <= 0.5 + 1e-9, "an unranked team by its record, never a favorite");
  assert(c(3, 9, 3) <= 0.62 + 1e-9 && c(3, 8, 4) <= 0.44 + 1e-9 && c(null, 2, 6) <= 0.22 + 1e-9, "three losses is the bubble, four is out");
  assert(c(3, 9, 3, false) === 1.0, "a finished season is read by where it ended");
  for (const letter of ["A+", "A-", "B", "C-", "F"]) assert(grades.school_floor(letter) >= 0);
});

test("Recruiting is the last three classes by rank, newest counting most, with the class being built counting more as the cycle goes", () => {
  const s = programs.class_standing;
  assert(s(1) === 1.0 && s(5) > s(25) && s(25) > s(65) && s(65) > s(130) && s(400) === s(140), "a class's standing by its national rank");
  const st = fresh();
  const base = recruiting.weekly(st)["recruiting"][ME];
  // three signed classes ranked first lift it; three ranked last sink it
  st["league"] = { year: 2027, attrs: [], teams: { [ME]: { roster: [], program: { ...programs.base(ME), classes: [[2025, 1], [2026, 1], [2027, 1]] } } } };
  recruiting.reset_caches();
  const best = recruiting.weekly(st)["recruiting"][ME];
  st["league"]["teams"][ME]["program"]["classes"] = [[2025, 130], [2026, 130], [2027, 130]];
  recruiting.reset_caches();
  const worst = recruiting.weekly(st)["recruiting"][ME];
  assert(best >= base && best > worst + 0.4, show([base, best, worst]));
  // the newest class counts most
  st["league"]["teams"][ME]["program"]["classes"] = [[2025, 130], [2026, 130], [2027, 1]];
  recruiting.reset_caches();
  const new_good = recruiting.weekly(st)["recruiting"][ME];
  st["league"]["teams"][ME]["program"]["classes"] = [[2025, 1], [2026, 130], [2027, 130]];
  recruiting.reset_caches();
  assert(new_good > recruiting.weekly(st)["recruiting"][ME], "an old class counted as much as a new one");
});

test("a recruit who wants a winner cools on a program that starts losing, shuts the door when it falls far enough, and opens it again when it wins", () => {
  const st = fresh(), rc = st["recruiting"];
  // a four-star who is yours to lose: Winning and Contender his first two priorities, and he knows what he wants
  const pid = Object.keys(rc["prospects"]).find((q) => rc["prospects"][q]["stars"] === 4 && !rc["status"][q]["committed"]);
  rc["prospects"][pid]["priorities"] = ["winning", "contender", "prestige"];
  recruiting.reset_caches();
  const wants = new recruiting.forced_standards(st, pid, { winning: "A", contender: "A", prestige: "C" });
  wants.__enter__();
  try {
    rc["board"] = [pid];
    recruiting._grade_news(st, 0);                                  // week 0: where he stands with you before a game
    const before = { interest: recruiting.interest(st, ME, pid), fit: recruiting.fit(st, ME, pid), shut: recruiting.locked_out(st, ME, pid) };
    assert(!before.shut && before.fit > -1, show(before));
    const seen = () => rc["log"].filter((e) => e["pid"] === pid && ["cooled", "door_closed", "door_open"].includes(e["kind"])).map((e) => e["kind"]);
    equal(seen(), []);
    // two losses: his interest and his fit fall with your Winning and Contender grades
    play(st, 2, false);
    recruiting._grade_news(st, st["current_week"]);
    const two = { interest: recruiting.interest(st, ME, pid), fit: recruiting.fit(st, ME, pid) };
    assert(two.interest < before.interest - 0.3 && two.fit < before.fit - 1, show([before, two]));
    // a lost season: he will no longer hear from you, and the week's news says so once
    play(st, 6, false);
    recruiting._grade_news(st, st["current_week"]);
    assert(recruiting.locked_out(st, ME, pid), `after eight losses he still takes your calls: fit ${recruiting.fit(st, ME, pid)}`);
    assert(seen().includes("door_closed"), show(seen()));
    const said = rc["log"].find((e) => e["pid"] === pid && e["kind"] === "door_closed");
    assert(said["line"].endsWith(".") && said["school"] === ME, show(said));
    recruiting._grade_news(st, st["current_week"]);
    equal(seen().filter((k) => k === "door_closed").length, 1, "said again the next week");
    equal(recruiting.blocked(st, ME, pid)["why"], "locked");
    // the door is not nailed shut: what he wants is still what he wants, and a program that meets it again is heard
    const eased = new recruiting.forced_standards(st, pid, { winning: "F", contender: "F", prestige: "F" });
    eased.__enter__();
    try {
      recruiting._grade_news(st, st["current_week"]);
      assert(!recruiting.locked_out(st, ME, pid) && seen().includes("door_open"), show(seen()));
    } finally {
      eased.__exit__();
    }
  } finally {
    wants.__exit__();
  }
});

test("a grade that slips under what a recruit wants is news for him only when you know he cares about it", () => {
  const st = fresh(), rc = st["recruiting"];
  const pids = Object.keys(rc["prospects"]).filter((q) => rc["prospects"][q]["stars"] === 3 && !rc["status"][q]["committed"]).slice(0, 2);
  for (const pid of pids) rc["prospects"][pid]["priorities"] = ["winning", "proximity", "nil"];
  recruiting.reset_caches();
  const levers = pids.map((pid) => new recruiting.forced_standards(st, pid, { winning: "A-", proximity: "F", nil: "F" }));
  levers.forEach((l) => l.__enter__());
  try {
    rc["board"] = [...pids];
    rc["revealed"][ME] = { [pids[0]]: ["winning"] };                 // you know the first one's priority, not the second's
    recruiting._grade_news(st, 0);
    play(st, 2, false);
    recruiting._grade_news(st, st["current_week"]);
    const lines = pids.map((pid) => rc["log"].find((e) => e["pid"] === pid && e["kind"] === "cooled"));
    assert(lines[0] && lines[1], show(rc["log"].slice(-4)));
    assert(/Winning grade fell to [A-DF][+-]?,/.test(lines[0]["line"]) && lines[0]["topic"] === "winning", show(lines[0]));
    assert(!/Winning/.test(lines[1]["line"]) && lines[1]["topic"] === undefined, `his priority was told: ${show(lines[1])}`);
    for (const l of lines) assert(/^[A-Z]/.test(l["line"]) && l["line"].endsWith("."), l["line"]);
  } finally {
    levers.forEach((l) => l.__exit__());
  }
});

test("Prestige looks back five seasons, not ten", () => {
  equal(programs.PRESTIGE_SEASONS, 5);
  const st = fresh();
  const lgd = { year: 2032, attrs: [], teams: {} };
  const p = (seasons) => ({ ...programs.base(ME), market_base: 50, nil_base: 50, winning_base: 50, conference_base: 50, live: 0, year: 2031, seasons });
  // the same five recent seasons, with a great five years before them or a terrible five: Prestige ends the same
  const recent = [[2026, 50], [2027, 50], [2028, 50], [2029, 50], [2030, 50]];
  lgd["teams"]["a"] = { roster: [], coaches: {}, program: p([[2021, 100], [2022, 100], [2023, 100], [2024, 100], [2025, 100], ...recent].slice(-9)) };
  lgd["teams"]["b"] = { roster: [], coaches: {}, program: p([[2021, 0], [2022, 0], [2023, 0], [2024, 0], [2025, 0], ...recent].slice(-9)) };
  const state = { ...st, league: lgd, offseason: { year: 2032, departures: [] } };
  programs.update(state, { a: { wins: 6, losses: 6 }, b: { wins: 6, losses: 6 } }, {}, 2032);
  equal(lgd["teams"]["a"]["program"]["prestige"], lgd["teams"]["b"]["program"]["prestige"]);
});

test("a played week keeps this week's standings beside last week's, once", () => {
  const st = fresh();
  season.advance_to(st, 2);
  const snap = st["grades_week"];
  assert(snap && snap["now"][ME].length === 3 && snap["prev"] && snap["prev"][ME].length === 3, show(Object.keys(snap || {})));
  const moved = programs.season_moved(st, ME);
  equal(Object.keys(moved), programs.SEASON);
  // every school's Winning is what recruits weigh this week
  const w = recruiting.weekly(st);
  for (const slug of ["texas", "akron", ME]) assert(Math.abs(row(st, slug)["winning"] - 100 * Math.min(1, w["winning"][slug])) < 0.06, slug);
});

await run();
