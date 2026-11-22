// career_js/league.js held to coach_career/league.py's answers: node career_js/test/league_compare.mjs OUT
// (after python3 career_js/test/league_reference.py OUT)
import fs from "fs";
import path from "path";
import { use_repo_files, read, copy, tally } from "./compare_tools.mjs";
import { modules, has } from "../../engine_js/modules.js";

const out = path.resolve(process.argv[2]);
use_repo_files();
const { league } = await import("../league.js");
await import("../programs.js");                       // _compute_base asks programs.init
const { game_scale } = await import("../../teamdata_js/game_scale.js");

// build_teams is not part of this port: measured_recruiting replays what Python's did to each team's coaches, and
// build is the digest the reference used
const measured = read(out, "measured.json");
modules.build_teams = {
  ...(has("build_teams") ? modules.build_teams : {}),
  measured_recruiting(teams) {
    for (const t of teams) {
      for (const k of Object.keys(t.coaches)) delete t.coaches[k];
      Object.assign(t.coaches, copy(measured[t.slug]));
    }
    return 0;
  },
  build(sources, real = true, observed = null, quiet = false, styles = null) {
    const teams = {};
    for (const s of sources) teams[s.slug] = { n: (s.roster || []).length, qb: s.starters?.offense?.QB ?? null, ratings: s.team_ratings ?? null };
    return { teams, real, observed, quiet, styles };
  },
};

const t = tally();
// a receiver's target share comes through Math.exp and a gauss draw (PORTING.md: a last digit may differ before the
// rounding to three places); nothing else here is given any room
const CLOSE = { close: 1e-9 };

t.same("game_scale.modules.league", true, game_scale.modules.league === league && modules.league === league);

// ----- identities -----
const meta = read(out, "meta.json");
t.same("_source_slugs", meta.source_slugs, league._source_slugs());
t.same("base_slugs", meta.base_slugs, league.base_slugs());
for (const s of meta.base_slugs) t.same(`base_meta ${s}`, meta.base_meta[s], league.base_meta(s));
t.same("path", meta.path, [league.path("abc123", 2031)]);

// ----- the base league from the source files -----
const base = read(out, "base.json");
const mine = league.from_base(2027);
t.same("from_base: its keys", Object.keys(base), Object.keys(mine));
for (const k of Object.keys(base)) if (k !== "teams") t.same(`from_base ${k}`, base[k], mine[k]);
t.same("from_base: the teams", Object.keys(base.teams), Object.keys(mine.teams));
for (const s of Object.keys(base.teams)) t.same(`from_base team ${s}`, base.teams[s], mine.teams[s]);
const year = read(out, "base_year.json");
const other = league.from_base(2030);
t.same("from_base(2030)", year, { year: other.year, overall_v: other.overall_v, n: Object.keys(other.teams).length,
  program_years: [...new Set(Object.values(other.teams).map((x) => x.program.year))].sort() });
const development = read(out, "development.json");
t.same("_development_of", development.of, league._development_of(base));
t.same("base_development (no base files)", development.base, league.base_development());

// ----- small functions -----
const small = read(out, "small.json");
const attrs = base.attrs;
for (const [h, py] of small.height_in) {
  // 6.0 is a float to Python (no feet and inches: None) and the number 6 here: the one place the two part
  if (typeof h === "number" && Number.isInteger(h) && py === null) { t.same(`height_in ${h} (a float in Python)`, h, league.height_in(h)); continue; }
  t.same(`height_in ${JSON.stringify(h)}`, py, league.height_in(h));
}
for (const [c, r, p, o] of small.ratings) t.same(`ratings ${c.id}`, [r, p, o], [league.ratings(c, attrs), league.potential(c, attrs), league.overall(c, attrs)]);
for (const [c, slug, py] of small.expand) t.same(`expand ${c.id}`, py, league.expand(c, attrs, league.base_meta(slug)));
for (const [p, home, py] of small.compact) t.same(`compact ${p.slug}`, py, league.compact(copy(p), attrs, home));
for (const [s, py] of small.formation) t.same(`formation ${s}`, py, league.formation(league.base_team(s)));
for (const [v, py] of read(out, "is_imported.json")) t.same(`is_imported ${JSON.stringify(v)}`, py, league.is_imported(v));

// ----- three leagues, every team in the source format -----
const leagues = {};
for (const name of ["base", "aged", "imported"]) {
  const lg = leagues[name] = read(out, `league_${name}.json`);
  const ans = read(out, `answers_${name}.json`);
  t.same(`${name}: is_imported`, ans.is_imported, league.is_imported(lg));
  t.same(`${name}: league_slugs`, ans.league_slugs, league.league_slugs(lg));
  for (const s of ans.league_slugs) t.same(`${name}: team_meta ${s}`, ans.team_meta[s], league.team_meta(lg, s));
  for (const s of Object.keys(lg.teams)) t.same(`${name}: source_team ${s}`, ans.source_team[s], league.source_team(lg, s), CLOSE);
  for (const s of Object.keys(ans.by_overall)) t.same(`${name}: source_team ${s} by overall`, ans.by_overall[s], league.source_team(lg, s, true), CLOSE);
  t.same(`${name}: source_teams`, ans.source_teams, league.source_teams(lg, ans.me).map((x) => [x.slug, x.roster_size ?? null, x.roster.length, x.starters]));
  t.same(`${name}: build`, ans.build, league.build(lg, Object.keys(ans.by_overall)[1]), CLOSE);
  t.same(`${name}: the league is left as it was`, read(out, `league_${name}.json`), lg);
}

// ----- a career's cached teams files -----
const cache = read(out, "cache.json");
league.CACHE_DIR = path.join(out, "cache_js");
fs.rmSync(league.CACHE_DIR, { recursive: true, force: true });
fs.mkdirSync(league.CACHE_DIR, { recursive: true });
for (const n of ["aaa-2026.json", "aaa-2027.json", "aaa-b-2026.json", "aaa-2029.json", "aaab-2026.json", "aaa-2026.txt", "bbb-2027.json"]) fs.writeFileSync(path.join(league.CACHE_DIR, n), "{}");
const listing = () => fs.readdirSync(league.CACHE_DIR).sort();
cache.steps.forEach((step, i) => {
  const state = { ...step.state, ...("league" in step.state ? { league: step.state.league === null ? null : leagues[step.state.league] } : {}) };
  const got = league.ensure_built(state);
  t.same(`ensure_built ${i}`, { path: step.path, files: step.files, text: step.text },
    { path: got === null ? null : path.basename(got), files: listing(), text: got === null ? null : JSON.parse(fs.readFileSync(got, "utf8")) }, CLOSE);
});
league.forget("aaa");
const after = [listing()];
league.forget("nobody");
after.push(listing());
t.same("forget", cache.after_forget, after);

// ----- the base files: written from the source files, then read back -----
const base_dir = path.join(out, "base_js");
fs.rmSync(base_dir, { recursive: true, force: true });
league.BASE_LEAGUE_FILE = path.join(base_dir, "base_league.json");
league.BASE_META_FILE = path.join(base_dir, "base_meta.json");
league.write_base_files();
for (const name of ["base_league.json", "base_meta.json", "base_development.json"]) {
  // (the reference removes its base_development.json for its last check, and keeps a copy)
  const py = name === "base_development.json" ? read(out, "base_development_written.json") : read(path.join(out, "base_py"), name);
  t.same(`write_base_files ${name}`, py, read(base_dir, name));
}
for (const f of [league.base_meta, league.base_slugs, league._meta_file, league.base_development]) f.cache_clear();
const files = read(out, "base_files.json");
const again = league.from_base(2029);
t.same("base files: base_slugs", files.base_slugs, league.base_slugs());
for (const s of Object.keys(files.base_meta)) t.same(`base files: base_meta ${s}`, files.base_meta[s], league.base_meta(s));
t.same("base files: from_base", files.from_base, again);
t.same("base files: base_development", files.development, league.base_development());
t.same("base files: league_slugs", files.league_slugs, league.league_slugs(again));
fs.rmSync(path.join(base_dir, "base_development.json"));
league.base_development.cache_clear();
t.same("base files: base_development from the league file", read(out, "base_files_2.json").development, league.base_development());

t.done("league.js against league.py");
