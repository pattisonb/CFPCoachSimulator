// Generated schedules (sim_js/schedule_gen.js): 2027 through 2032 from the 2026 history, each one
// following the conferences' rules, and a career that rolls from 2026 into a generated 2027.
// `node tests/test_schedule_gen.mjs`
import { start, test, run, assert } from "./harness.mjs";
import { Random, sorted, get, truthy } from "../engine_js/pyrt.js";

const game = await start();
const { season, offseason } = game;
const sg = game.modules.schedule_gen;
const J = (...xs) => () => JSON.stringify(xs);
const count = (xs, f) => xs.filter(f).length;
/** {g["home"], g["away"]} == {a, b} */
const pair = (g, a, b) => (g["home"] === a && g["away"] === b) || (g["home"] === b && g["away"] === a);

/** Every game played (the better team usually wins), every school's class signed, season over (tests/test_offseason's). */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const h = teams[g["home"]]["team_ratings"]["overall"], a = teams[g["away"]]["team_ratings"]["overall"];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 12));
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

test("schedule gen", () => {
  const teams = season.load_teams();
  const fbs = Object.keys(teams).filter((s) => !teams[s]["fictional"]);
  const is_fbs = new Set(fbs);
  const conf_of = Object.fromEntries(fbs.map((s) => [s, teams[s]["conference"]]));
  const R = sg.rules(), S = sg.series();
  const power = new Set(R["power"]);
  const is_power = (o) => power.has(get(conf_of, o)) || R["power_independents"].includes(o);
  let hist = sg.seed_history(teams);
  const met_site = {};            // pair -> (year, home) of the last meeting, to check sites alternate
  const met_year = {};
  const home_count = {};
  const rng = new Random(7);
  for (let year = 2027; year < 2033; year++) {
    let games;
    [games, hist] = sg.generate(year, teams, hist, rng);
    const all = Object.values(games);
    const by_team = {};
    for (const g of all) for (const s of [g["home"], g["away"]]) (by_team[s] ??= []).push(g);
    // twelve games, one a week, every FBS team
    for (const s of fbs) {
      const mine = by_team[s] || [];
      assert(mine.length === sg.GAMES, J(year, s, mine.length));
      const weeks = mine.map((g) => g["week"]);
      assert(new Set(weeks).size === weeks.length, J(year, s, weeks));
      assert(weeks.every((w) => (1 <= w && w <= sg.LAST_WEEK) || w === sg.ARMY_NAVY_WEEK), J(year, s, weeks));
      (home_count[s] ??= {})[year] = count(mine, (g) => g["home"] === s && !g["neutral"]);
    }
    // Week 0 (engine week 1): a handful of games, as the real calendar has; the next Saturday is the full opening slate
    const opening = count(all, (g) => g["week"] === sg.WEEK0);
    assert(1 <= opening && opening <= 3 * sg.WEEK0_GAMES, J(year, opening));
    assert(count(all, (g) => g["week"] === sg.WEEK0 + 1) > 3 * opening, J(year, opening));
    // league counts and protected pairs
    for (const [conf, rule] of Object.entries(R["conferences"])) {
      const members = fbs.filter((s) => conf_of[s] === conf);
      const k = sg._league_games(rule, year);
      const eight = get(get(rule, "eight_game_team") || {}, String(year));
      const odd_one = (members.length * k - (members.includes(eight) ? 1 : 0)) % 2 ? sorted(members)[year % members.length] : null;
      for (const s of members) {
        const n = count(by_team[s], (g) => g["conference_game"]);
        const want = s === eight || s === odd_one ? k - 1 : k;
        assert(n === want, J(year, conf, s, n, want));
      }
      for (const [a, b] of get(rule, "protected", [])) assert(all.some((g) => pair(g, a, b)), J(year, conf, a, b));
      for (const div of Object.values(get(rule, "divisions") || {})) {
        div.forEach((a, i) => {
          for (const b of div.slice(i + 1)) assert(all.some((g) => pair(g, a, b)), J(year, "division", a, b));
        });
      }
      // FCS and Power rules
      const nc = rule["non_conference"];
      for (const s of members) {
        const fcs = count(by_team[s], (g) => teams[g["home"]]["fictional"] || teams[g["away"]]["fictional"]);
        assert(fcs <= get(nc, "fcs_max", 1), J(year, s, fcs));
        const opps = by_team[s].filter((g) => !g["conference_game"]).map((g) => (g["home"] === s ? g["away"] : g["home"]));
        const powers = count(opps, is_power);
        if (power.has(conf)) {
          const need = s === eight ? get(nc, "power_min_eight_game", nc["power_min"]) : nc["power_min"];
          assert(powers >= need, J(year, s, powers, need, opps));
        } else {
          const road = count(by_team[s], (g) => g["away"] === s && is_power(g["home"]));
          assert(road >= nc["power_road"][0], J(year, s, road, opps));
        }
      }
    }
    // sites alternate and no pair meets twice; the pair's last site is remembered
    const seen = new Set();
    for (const g of all) {
      const key = sg.pair_key(g["home"], g["away"]);
      assert(!seen.has(key), J(year, key));
      seen.add(key);
      const last = get(met_site, key);
      if (last && !g["neutral"] && !last[2] && last[0] === year - 1 && get(conf_of, g["home"]) === get(conf_of, g["away"])) {
        assert(last[1] !== g["home"], J(year, key, "same site two years running"));
      }
      met_site[key] = [year, g["home"], g["neutral"]];
      (met_year[key] ??= []).push(year);
    }
    // announced series in their year at their site; annual series every year; finales in week 14; Army-Navy on selection weekend
    const due = S["announced"].filter((a) => a["year"] === year && is_fbs.has(a["home"]) && is_fbs.has(a["away"]));
    const on = (x) => !(truthy(get(x, "first")) && year < x["first"]) && !(truthy(get(x, "last")) && year > x["last"]);

    /** Annual series and announced games on a team's plate this year, against its non-conference allowance. */
    const fixed_load = (team) => count(S["annual"], (x) => x["teams"].includes(team) && on(x)) + count(due, (x) => team === x["home"] || team === x["away"]);
    const allowance = (team) => {
      const rule = get(R["conferences"], conf_of[team]);
      return sg.GAMES - (truthy(rule) ? sg._league_games(rule, year) : 0);
    };

    for (const a of due) {
      const g = all.find((x) => x["home"] === a["home"] && x["away"] === a["away"]) ?? null;
      if (g === null) {
        // dropped only when one side's annual and announced dates already exceed its allowance
        assert([a["home"], a["away"]].some((x) => fixed_load(x) > allowance(x)), J(year, a));
      } else {
        assert(g["neutral"] === truthy(get(a, "neutral")), J(year, a));
      }
    }
    for (const s of S["annual"]) {
      const [a, b] = s["teams"];
      if (is_fbs.has(a) && is_fbs.has(b) && on(s)) {
        const g = all.find((x) => pair(x, a, b)) ?? null;
        assert(g !== null, J(year, s["name"]));
        if (truthy(get(s, "finale"))) assert(g["week"] === sg.FINALE_WEEK, J(year, s["name"], g["week"]));
        if (get(s, "week") === 16) assert(g["week"] === sg.ARMY_NAVY_WEEK);
      }
    }
    for (const [conf, rule] of Object.entries(R["conferences"])) {
      for (const [a, b] of get(rule, "finales", [])) {
        const g = all.find((x) => pair(x, a, b)) ?? null;
        if (g !== null) assert(g["week"] === sg.FINALE_WEEK, J(year, conf, a, b, g["week"]));
      }
    }
    // Notre Dame's five ACC games and Navy
    const nd = by_team["notre-dame"].map((g) => (g["home"] === "notre-dame" ? g["away"] : g["home"]));
    assert(count(nd, (o) => get(conf_of, o) === "ACC") === 5 && nd.includes("navy") && nd.includes("clemson"), J(year, nd));
    // a stand-in is shown by its own name (a place and its mascot), never a real FCS school
    for (const g of all) {
      if (teams[g["away"]]["fictional"]) {
        assert(g["away_display"] === season.fcs_label(g["away"]) && g["away_display"].endsWith(" " + teams[g["away"]]["mascot"]), g["away_display"]);
        assert(g["home"] === g["home"] && !teams[g["home"]]["fictional"]);
      }
    }
  }
  // every conference pair met within the cycle (2027-2032 covers the SEC's and Big 12's four-year cycles twice over)
  for (const [conf, rule] of Object.entries(R["conferences"])) {
    const members = sorted(fbs.filter((s) => conf_of[s] === conf));
    const cycle = rule["cycle"];
    if (cycle > 6) continue;
    members.forEach((a, i) => {
      for (const b of members.slice(i + 1)) {
        const years = get(met_year, sg.pair_key(a, b), []);
        assert(years.length, J(conf, a, b, "never met 2027-2032"));
        const gaps = years.map((y2, j) => y2 - (j ? years[j - 1] : 2026));
        assert(Math.max(...gaps) <= cycle + 1, J(conf, a, b, years, cycle));
      }
    });
  }
  // home games year to year: never a swing of three, and mostly a swing of one or none (league home games alternate
  // 5/4 and a home-and-home flips with them half the time, so a two happens)
  const years = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  const swings = fbs.flatMap((s) => years(2028, 2033).map((y) => Math.abs(home_count[s][y] - home_count[s][y - 1])));
  assert(Math.max(...swings) <= 5, () => String(Math.max(...swings)));
  assert(count(swings, (x) => x >= 3) <= 0.035 * swings.length, () => String(count(swings, (x) => x >= 3) / swings.length));
  assert(count(swings, (x) => x <= 1) >= 0.75 * swings.length, () => String(count(swings, (x) => x <= 1) / swings.length));
  const counts = fbs.flatMap((s) => years(2027, 2033).map((y) => [s, y, home_count[s][y]]));
  assert(counts.every(([, , n]) => 4 <= n && n <= 9), () => JSON.stringify(counts.filter(([, , n]) => !(4 <= n && n <= 9)).slice(0, 5)));
  assert(count(counts, ([, , n]) => !(5 <= n && n <= 8)) <= 0.03 * counts.length, () => String(count(counts, ([, , n]) => !(5 <= n && n <= 8)) / counts.length));
  // a career rolls from 2026 into a generated 2027 and plays a week of it
  const st = season.new_season("smu", "full", 3, undefined, undefined, true);
  finished(st);
  offseason.start(st);
  offseason.run_all(st);
  const fresh = offseason.next_season(st);
  assert(fresh["year"] === 2027 && count(Object.values(fresh["games"]), (g) => (g["home"] === "smu" || g["away"] === "smu") && g["kind"] === "regular") === 12);
  assert(truthy(get(fresh["league"], "schedule_history")) && fresh["league"]["schedule_history"]["years"].includes(2027));
  assert(Object.keys(fresh["games"]).every((e) => fresh["games"][e]["kind"] !== "regular" || e.startsWith("2027-")), "2027's games are generated, not the 2026 file's");
  season.advance_to(fresh, 1);
  const played = Object.values(fresh["games"]).filter((g) => g["played"]);
  assert(played.length, "the generated week was simulated");
  console.log(`schedule gen ok: 2027-2032 generated, ${fbs.length} teams x 12 games each year, every rule held; a career rolled into 2027 and played week 1`);
});

await run();
