// Your players show their Coachability, not the source data's development trait (season.development_reads): every
// generated player carries a placeholder trait, so a career's fourth-year roster once read "Normal Development" from
// top to bottom. The player page and the depth chart show each of your own players' true coachability in the game's
// six words and his potential as a letter grade; nobody else's roster shows either (a future portal entrant's
// coachability stays a read). After two offseasons your roster still reads several words and the league's mix stays
// at the levels' shares.
// `node tests/test_coachability_label.mjs`
import { start, test, run, assert } from "./harness.mjs";
import { Random, get, sorted } from "../engine_js/pyrt.js";

const game = await start();
const { season, offseason } = game;
const { recruits, grades, league } = game.modules;


const TEAM = "ohio-state", OTHER = "michigan";
const LEVELS = recruits.COACHABILITY.map(([n]) => n);
const J = (v) => () => JSON.stringify(v);
const cards_of = (chart) => chart["units"].flatMap((u) => u["rows"].flatMap((r) => r["players"]));

/** Your roster: every player has a level from the scale and a potential grade; anyone else's: nothing. */
function check_reads(st, label) {
  const reads = season.development_reads(st, TEAM);
  const roster = season.load_teams()[TEAM];
  const slugs = [...roster["offense"], ...roster["defense"]].map((p) => p["slug"]);
  assert(Object.keys(reads).length >= 0.9 * slugs.length, J([label, Object.keys(reads).length, slugs.length]));
  for (const [slug, r] of Object.entries(reads)) {
    assert(LEVELS.includes(r["coachability"]) && r["coach_level"] === LEVELS.indexOf(r["coachability"]) + 1, J([label, slug, r]));
    assert(grades.ORDER.includes(r["potential_word"]), J([label, slug, r]));
  }
  assert(!Object.keys(season.development_reads(st, OTHER)).length, "another team's coachability leaked");
  const them = season.load_teams()[OTHER];
  const theirs = season.player_profile(st, OTHER, null, null, [...them["offense"], ...them["defense"]][0]["slug"]);
  assert(!("coachability" in theirs) && !("potential_word" in theirs), "another team's player page leaked his coachability");
  assert(!cards_of(season.depth_chart_view(st, OTHER)).some((p) => "coachability" in p));
  const cards = cards_of(season.depth_chart_view(st, TEAM));
  assert(cards.every((p) => !(p["slug"] in reads) || LEVELS.includes(p["coachability"])), label);
  assert(!cards.some((p) => "dev_trait" in p), "the depth chart still sends the development trait");
  const cand = season.position_candidates(st, TEAM, "QB")["players"];
  assert(cand.every((p) => !(p["slug"] in reads) || LEVELS.includes(p["coachability"])) && !cand.some((p) => "dev_trait" in p));
  const slug = Object.keys(reads)[0];
  const prof = season.player_profile(st, TEAM, null, null, slug);
  assert(prof["coachability"] === reads[slug]["coachability"] && prof["potential_word"] === reads[slug]["potential_word"]);
  assert(new Set(Object.values(reads).map((r) => r["coachability"])).size >= 3, `${label}: the roster reads fewer than three words`);
}

/** Every game played, every school's class signed, the season over (as tests/test_portal_recap.mjs ends one). */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const h = teams[g["home"]]["team_ratings"]["overall"], a = teams[g["away"]]["team_ratings"]["overall"];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 12));
    Object.assign(g, { played: true, home_score: win ? hs : Math.max(0, hs - rng.randint(1, 20)), away_score: win ? hs - rng.randint(1, 20) : hs });
    if (g["home_score"] === g["away_score"]) g["home_score"] += 3;
  }
  const rc = st["recruiting"];
  const schools = Object.keys(teams).filter((s) => !teams[s]["fictional"]);
  sorted(Object.keys(rc["prospects"]), (p) => rc["prospects"][p]["rank"]).slice(0, schools.length * 21)
    .forEach((pid, i) => { rc["status"][pid]["signed"] = schools[i % schools.length]; });
  Object.assign(st, { done: true, current_week: season.FINAL_WEEK, champion: TEAM });
}

test("in a first season your own players show their coachability and a potential grade, and nobody else's do", () => {
  check_reads(season.new_season(TEAM, "full", 31, undefined, undefined, true), "2026");
});

test("after two offseasons the roster still reads several words, and the league's mix stays at the levels' shares", () => {
  let st = season.new_season(TEAM, "full", 32, undefined, undefined, true);
  for (let i = 0; i < 2; i++) {                           // real players leave, generated ones arrive
    finished(st);
    offseason.run_all(st);
    st = offseason.next_season(st);
  }
  check_reads(st, "2028");
  const players = Object.values(st["league"]["teams"]).flatMap((t) => t["roster"]);
  const count = (list) => { const c = {}; for (const p of list) c[get(p, "c")] = (c[get(p, "c")] || 0) + 1; return c; };
  const c = count(players);
  assert(Object.keys(c).every((k) => LEVELS.includes(k)), J(c));
  for (const [name, , share] of recruits.COACHABILITY) {
    assert(Math.abs((c[name] || 0) / players.length - share) <= Math.max(0.04, share * 0.5), J([name, (c[name] || 0) / players.length, share]));
  }
  assert(Object.keys(count(players.filter((p) => get(p, "cls") === "FR"))).length === LEVELS.length, "the signed freshmen do not span the scale");
});

await run();
