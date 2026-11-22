// sim_js/news.js held to the Python's news (news_reference.py's): for the simmed season and each changed copy of it,
// every finished week's items from each maker (text, importance, teams, link, key order) and the week's shown list,
// and league_news from several weeks. The season is the JavaScript one (its records, names, week labels); the teams
// and box scores are the Python's, and persona's answers are replayed. node sim_js/test/news_compare.mjs OUTDIR
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { set_reader, set_store, env } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";
import { odict } from "../../engine_js/pyrt.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = process.argv[2];
const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
set_reader((p) => fs.readFileSync(abs(p), "utf8"));
set_store({
  write: (p, text) => { fs.mkdirSync(path.dirname(abs(p)), { recursive: true }); fs.writeFileSync(abs(p), text); },
  exists: (p) => fs.existsSync(abs(p)),
  remove: (p) => fs.rmSync(abs(p), { force: true }),
  remove_dir: (p) => fs.rmSync(abs(p), { recursive: true, force: true }),
  list: (p) => (fs.existsSync(abs(p)) ? fs.readdirSync(abs(p)).sort() : []),
  mtime: (p) => fs.statSync(abs(p)).mtimeMs,
});
env.CFP_SEASONS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "seasons-"));

const read = (f) => JSON.parse(fs.readFileSync(path.join(out, f), "utf8"));
const base = read("base.json");
const index = read("index.json");
modules.league = { OFFENSE_ROLES: new Set(base.OFFENSE_ROLES), TEAM_FIT: base.TEAM_FIT, GROUP_OF: base.GROUP_OF };
modules.clear = { on: () => base.clear };
const { season } = await import("../season.js");
const { news } = await import("../news.js");
if (modules.news !== news) throw new Error("news is not registered on modules");

// the career's teams and the boxes its games left, as the Python read them; persona's answers, replayed
let boxes = {}, asked = { story: {}, hero_state: {} }, unasked = 0;
season.load_teams = () => base.teams;
season.load_box = (state, event_id) => (event_id in boxes ? JSON.parse(JSON.stringify(boxes[event_id])) : null);
modules.persona = {
  story: (state, pid) => { if (!(pid in asked.story)) { unasked++; return [null, {}]; } return asked.story[pid]; },
  hero_state: (state, pid) => { if (!(pid in asked.hero_state)) { unasked++; return null; } return asked.hero_state[pid]; },
};

let bad = 0, same = 0;
function check(name, py, js) {
  const a = JSON.stringify(py), b = JSON.stringify(js);
  if (a === b) { same++; return; }
  bad++;
  if (bad > 12) return;
  console.log(`DIFFERENT ${name}`);
  if (Array.isArray(py) && Array.isArray(js)) {
    if (py.length !== js.length) console.log(`  length py ${py.length} | js ${js.length}`);
    for (let i = 0; i < Math.max(py.length, js.length); i++) {
      if (JSON.stringify(py[i]) !== JSON.stringify(js[i])) { console.log(`  [${i}] py ${JSON.stringify(py[i])}\n  [${i}] js ${JSON.stringify(js[i])}`); break; }
    }
  } else console.log(`  py ${a?.slice(0, 300)}\n  js ${b?.slice(0, 300)}`);
}

// the constants and the small functions
for (const [k, v] of Object.entries(base.constants)) check(`constant ${k}`, v, news[k]);
for (const [t, want] of base.small.with) check(`_with ${t}`, want, news._with(t));
for (const [d, want] of base.small.when) check(`_when ${d}`, want, news._when(d));
for (const [n, r, want] of base.small.ranked) check(`_ranked ${n} ${r}`, want, news._ranked(n, r));
for (const [g, h, want] of base.small.score) check(`_score ${JSON.stringify(g)}`, want, news._score(g, h));
for (const [t, g, sd, want] of base.small.chance) check(`_pregame_chance ${JSON.stringify(t)} ${JSON.stringify(g)} ${sd}`, want, news._pregame_chance(t, g, sd));

const MAKERS = ["upsets", "rankings", "big_games", "streaks", "recruiting", "injuries"];
let items = 0, shown = 0, weeks = 0;
const t0 = Date.now();
for (const sc of index.scenarios) {
  const rec = read(sc.file);
  const set = rec.set;
  const state = { id: base.state.id, team: base.state.team, year: base.state.year, current_week: base.state.current_week,
    polls: set.polls ?? base.state.polls, games: odict(set.games ?? base.state.games),
    recruiting: set.recruiting_none ? null : { log: set.log ?? base.state.recruiting.log, prospects: set.prospects ?? base.state.recruiting.prospects } };
  for (const k of ["team", "year", "id", "current_week"]) if (k in set) state[k] = set[k];
  boxes = { ...base.boxes, ...rec.boxes };
  asked = { story: rec.answers.story, hero_state: rec.answers.hero_state };
  news._cache.clear();
  const before = JSON.stringify(state);
  const teams = season.load_teams();
  const fbs = season.fbs_only(teams);
  const n = bad;
  for (const [wk, py] of Object.entries(rec.answers.weeks)) {
    const w = Number(wk);
    const games = Object.values(state.games).filter((g) => g.week === w && g.played);
    const bx = {};
    for (const g of games) if (fbs.has(g.home) && fbs.has(g.away) && g.event_id in boxes) bx[g.event_id] = boxes[g.event_id];
    const js = {
      upsets: news._upsets(state, teams, fbs, w, games), rankings: news._rankings(state, teams, w),
      big_games: news._big_games(state, teams, fbs, games, bx), streaks: news._streaks(state, teams, fbs, w, games),
      recruiting: news._recruiting(state, teams, w), injuries: news._injuries(state, teams, fbs, w, games, bx),
      week_news: news.week_news(state, w) };
    for (const k of MAKERS) { check(`${sc.name}, week ${w}, ${k}`, py[k], js[k]); items += py[k].length; }
    check(`${sc.name}, week ${w}, week_news`, py.week_news, js.week_news);
    if (news.week_news(state, w) !== js.week_news) { bad++; console.log(`${sc.name}, week ${w}: the week's news was made twice`); }
    shown += py.week_news.length;
    weeks++;
  }
  for (const [since, py] of Object.entries(rec.answers.league_news)) check(`${sc.name}, league_news since ${since}`, py, news.league_news(state, Number(since)));
  if (JSON.stringify(state) !== before) { bad++; console.log(`${sc.name}: reading the news changed the season`); }
  console.log(`  ${sc.name}: ${bad === n ? "the same" : "DIFFERENT"}`);
}
if (unasked) { bad++; console.log(`persona was asked ${unasked} times here for what the Python never asked`); }
console.log(`${index.scenarios.length} scenarios of a ${index.current_week}-week season (${index.team}, seed ${index.seed}): ${weeks} weeks, ${items} items made, ${shown} shown, ${Date.now() - t0} ms`);
console.log(bad ? `DIFFERENT: ${bad} checks failed, ${same} the same` : `the same: all ${same} checks`);
process.exit(bad ? 1 : 0);
