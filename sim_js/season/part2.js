// sim/season.py, part 2 (the Python's lines 1027 to 1811): the simulation. The league a week's games are played in,
// the injured and the redshirting, position changes during the season, one game job and a week of them, the
// postseason's matchups (title games, playoff rounds, bowls), and the week itself (game day, advance).
// engine_js/PORTING.md has the rules ("A big file ported in parts").
import { Random, cmp, get, truthy } from "../../engine_js/pyrt.js";
import { read_json } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";
import { season } from "../season_ns.js";
import * as game_job from "../game_job.js";
import { polls } from "../polls.js";
import { bowls } from "../bowls.js";
import { game_scale } from "../../teamdata_js/game_scale.js";
import { shown as _shown } from "../../teamdata_js/shown.js";     // the scale ratings are shown on (a view's last step)
import { position_fit } from "../../career_js/position_fit.js";

// ---- Python's `in`, for the containers of this file (a dict's own keys, a set, a list) ----
function has(c, k) {
  if (c instanceof Set || c instanceof Map) return c.has(k);
  if (Array.isArray(c)) return c.includes(k);
  if (k === null || k === undefined) return false;
  return Object.prototype.hasOwnProperty.call(c, k);
}

// d[k] of a dict whose keys are whole numbers in Python (a plain object here, or a Map)
function at(d, k) {
  const v = d instanceof Map ? d.get(k) : d[k];
  return v === undefined ? null : v;
}

// min(d) of such a dict: its smallest key
function min_key(d) {
  return Math.min(...(d instanceof Map ? [...d.keys()] : Object.keys(d)).map(Number));
}

// the league's teams file as the games read it (Python: `_TEAMS_PATH or str(_league_path)`)
function teams_path() {
  return season._TEAMS_PATH || String(season._league_path);
}

// ----- simulation ----------------------------------------------------------

season._TEAMS = {};


season._TEAMS_PATH = null;      // the teams file this process's games are played in (_init, _use)


function _use(path) {
  // The league this process's games are played in. The games read the file themselves (_sim_one).
  if (path !== season._TEAMS_PATH) {
    season._TEAMS = {};
    season._TEAMS_PATH = path;
  }
}


function _init(path) {
  // (Python's pool workers also set their Ctrl-C handling here: there are no processes)
  season._TEAMS_PATH = path;
  season._TEAMS = read_json(path)["teams"];
}


// _with_injuries: sim_js/game_job.js has it (attached at the end)


function _injured(state, slug) {
  // [name, position] of every player on slug's injury list, and of every player redshirting
  // this season (he is kept out of games the same way).
  const out = Object.values(get(get(state, "injuries") || {}, slug, {})).map((i) => [i["name"], i["position"]]);
  const rs = get(get(state, "redshirting") || {}, slug) || {};
  for (const v of Object.values(rs)) out.push([v["name"], v["position"]]);
  return out;
}


// ----- redshirts during the season --------------------------------------------------------------

season.REDSHIRT_GAMES = 4;                                  // the four-game rule
season.REDSHIRT_CLASSES = ["FR", "SO", "JR"];


class RedshirtError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RedshirtError";
    this.code = code;
  }
}


function redshirt_status(state, slug, p) {
  // Where one player stands with a redshirt this season: on it now, whether he still can, his games.
  const rs = get(get(state, "redshirting") || {}, slug) || {};
  const line = get(get(get(get(state, "season_stats") || {}, slug, {}), "players") || {}, `${p["name"]}|${p["position"]}`);
  const games = truthy(line) ? line["games"] : 0;
  const cls = get(p, "class") || "";
  const can = truthy(get(state, "career")) && slug === get(state, "team") && !truthy(get(state, "done"))
    && season.REDSHIRT_CLASSES.includes(cls) && games <= season.REDSHIRT_GAMES;
  return { on: has(rs, get(p, "slug")), can, games, limit: season.REDSHIRT_GAMES,
    why: can ? null : (!truthy(get(state, "career")) || slug !== get(state, "team") ? "he is not your player"
      : truthy(get(state, "done")) ? "the season is over"
      : cls === "SR" ? "seniors cannot redshirt"
      : cls.endsWith("RS") ? "his redshirt year is used"
      : games > season.REDSHIRT_GAMES ? `he has played ${games} games, more than the ${season.REDSHIRT_GAMES} the rule allows`
      : "he is not a player who can redshirt") };
}


function redshirt_toggle(state, slug, player_slug, on) {
  // Redshirt one of your players for the rest of the season (he sits out every game, keeps his
  // year), or take him off it while he has played four games or fewer.
  const t = has(season.load_teams(), slug) ? season.team_data(state, slug) : null;
  let p = null;
  if (truthy(t)) {
    for (const x of [...t["offense"], ...t["defense"]]) {
      if (get(x, "slug") === player_slug) { p = x; break; }
    }
  }
  if (p === null) throw new season.RedshirtError(404, "player not found");
  const st = season.redshirt_status(state, slug, p);
  if (truthy(on) && !st["can"]) throw new season.RedshirtError(409, st["why"] || "he cannot redshirt");
  if (state["redshirting"] === undefined) state["redshirting"] = {};
  if (state["redshirting"][slug] === undefined) state["redshirting"][slug] = {};
  const rs = state["redshirting"][slug];
  if (truthy(on)) rs[player_slug] = { name: p["name"], position: p["position"], week: get(state, "current_week", 0) };
  else delete rs[player_slug];
  return season.redshirt_status(state, slug, p);
}


// ----- position changes during the season --------------------------------------------------------

class PositionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PositionError";
    this.code = code;
  }
}


function position_changes(state, slug) {
  // This season's position changes on a team: player slug -> {"from": his position in the
  // league file, "to": where he plays now, "week"} (positions as depth-chart roles, WR, LT, FS).
  return get(get(state, "position_changes") || {}, slug) || {};
}


function _skills(p) {
  // His skills on our scale (game_scale.py), as the league stores them.
  const keys = game_scale.keys(), values = get(p, "skills") || [];
  const out = {};
  for (let i = 0; i < Math.min(keys.length, values.length); i++) out[keys[i]] = values[i];
  return out;
}


// with_positions: sim_js/game_job.js has it (attached at the end)


function _roster_player(state, slug, player_slug) {
  season.check_fbs(slug);
  const t = season.team_data(state, slug);
  for (const x of [...t["offense"], ...t["defense"]]) {
    if (get(x, "slug") === player_slug) return x;
  }
  throw new season.PositionError(404, "not on your roster");
}


function position_options(state, slug, player_slug) {
  // What one of a team's players would be at every position (kickers and punters among
  // themselves): position_fit.project from the league file's player (his skills on the new
  // group's scale, the ones he has never used discounted, his size against the spot's), where he
  // is now first, then best first.
  const lg = modules.league;
  const p = season._roster_player(state, slug, player_slug);
  const t = season.load_teams()[slug];
  const base = [...t["offense"], ...t["defense"]].find((x) => get(x, "slug") === player_slug);
  if (base === undefined) throw new Error("StopIteration");
  const out = position_fit.options(season._skills(base), get(base, "height_in"), get(base, "weight"), get(base, "role") || base["position"],
    get(p, "role") || p["position"], lg.GROUP_OF);
  return out.map((o) => ({ ...o, overall: _shown.overall(o["overall"]) }));      // as the page shows an overall
}


function _rekey_player(state, slug, name, old_pos, new_pos) {
  // A player's season records are keyed name|position: they follow him to his new position.
  const old = `${name}|${old_pos}`, new_ = `${name}|${new_pos}`;
  const inj = get(get(state, "injuries") || {}, slug) || {};
  if (has(inj, old)) {
    const was = inj[old];
    delete inj[old];
    inj[new_] = { ...was, position: new_pos };
  }
  const forms = get(get(get(state, "morale") || {}, "players") || {}, slug) || {};
  if (has(forms, old)) {
    const was = forms[old];
    delete forms[old];
    forms[new_] = was;
  }
  const lines = get(get(get(state, "season_stats") || {}, slug) || {}, "players") || {};
  if (has(lines, old)) {
    const line = lines[old];
    delete lines[old];
    line["position"] = new_pos;
    line["unit"] = has(season.OFFENSE_POSITIONS, new_pos) ? "offense" : "defense";
    if (has(lines, new_)) {
      lines[new_]["games"] += line["games"];
      season._add_into(lines[new_]["stats"], line["stats"]);
    } else {
      lines[new_] = line;
    }
  }
}


function change_position(state, slug, player_slug, pos) {
  // Move one of your players to another position now: he plays and shows there from the next
  // game (with_positions, through team_data and every game's edits), last in the new role's
  // depth order and out of every slot of his old one, his overall recomputed by our formula
  // there (position_fit); the career's league roster follows (the row at once in a later season, at the
  // offseason in the first). Moving him back to the position the league file has clears the change.
  if (typeof pos !== "string" || !has(season.ROLE_POSITION, pos)) throw new season.PositionError(400, "no such position");
  const p = season._roster_player(state, slug, player_slug);
  const cur = get(p, "role") || p["position"];
  if (cur === pos) throw new season.PositionError(409, "he plays there already");
  if ((cur === "K" || cur === "P") !== (pos === "K" || pos === "P")) throw new season.PositionError(400, "kickers and punters change only among themselves");
  const base = [...season.load_teams()[slug]["offense"], ...season.load_teams()[slug]["defense"]].find((x) => get(x, "slug") === player_slug);
  if (base === undefined) throw new Error("StopIteration");
  const origin = get(base, "role") || base["position"];
  if (state["position_changes"] === undefined) state["position_changes"] = {};
  if (state["position_changes"][slug] === undefined) state["position_changes"][slug] = {};
  const moves = state["position_changes"][slug];
  if (pos === origin) delete moves[player_slug];
  else moves[player_slug] = { from: origin, to: pos, week: get(state, "current_week", 0) };
  if (!truthy(moves)) delete state["position_changes"][slug];
  const old_pos = p["position"], new_pos = season.ROLE_POSITION[pos];
  if (old_pos !== new_pos) season._rekey_player(state, slug, p["name"], old_pos, new_pos);
  const rs = get(get(get(state, "redshirting") || {}, slug) || {}, player_slug);
  if (truthy(rs)) rs["position"] = new_pos;
  const overrides = get(get(state, "depth") || {}, slug) || {};
  for (const role of Object.entries(overrides).filter(([r, lst]) => r !== pos && lst.includes(player_slug)).map(([r]) => r)) {
    overrides[role].splice(overrides[role].indexOf(player_slug), 1);
    if (!overrides[role].length) delete overrides[role];
  }
  const lgd = get(state, "league");
  let row = null;
  for (const c of get(get(get(lgd || {}, "teams") || {}, slug, {}), "roster", [])) {
    if (c["id"] === player_slug) { row = c; break; }
  }
  if (row !== null) modules.offseason.move_row(row, pos, lgd["attrs"]);
  const q = season._roster_player(state, slug, player_slug);
  return { slug: player_slug, position: get(q, "role") || q["position"], overall: season.page_overall(q),
    moved_from: get(get(season.position_changes(state, slug), player_slug) || {}, "from") };
}


function _game_team(slug, shift, edits, morale, depth, injured) {
  // One side of a game as the engine plays it: the real FCS school's strength for a stand-in (`shift`), then
  // god-mode edits and your coach, morale, the depth chart and the injury list. (sim_js/game_job.js has it, with
  // the league's teams as its first argument: here they are this process's, read when they are not yet.)
  if (!truthy(season._TEAMS)) season._TEAMS = read_json(teams_path())["teams"];
  return game_job._game_team(season._TEAMS, slug, shift, edits, morale, depth, injured);
}


// _with_earned, _moments: sim_js/game_job.js has them (attached at the end)


season.EXTERNAL_POOL = null;   // Python's browser pool (app/browser_pool.py): a host replaces season.play_jobs instead


function _sim_one(args) {
  // One game job, played whole by sim_js/game_job.js (both teams as this week has them, the game, the result
  // boiled down) against the league's teams.
  const teams = read_json(teams_path())["teams"];
  return game_job._sim_one(teams, args);
}


function play_jobs(jobs, on_result) {
  // A week's game jobs, each played in order here, `on_result(result)` called as each finishes. A host may replace
  // it (season.play_jobs = ...) to share the games out; the results may then come in any order.
  for (const job of jobs) on_result(season._sim_one(job));
}


function sim_workers() {
  // How many processes simulate games: one, this one.
  return 1;
}


function _make_pool() {
  // A worker pool, or null to simulate in this process: always null here.
  season._use(String(season._league_path));
  return null;
}


season.Reporter = null;   // (Python's type of a progress callback: (stage text, games done, games total))


function _week_seeds(state, week) {
  // The random seed of every unplayed game of the week, drawn once in schedule order, so
  // playing your game first (game day) and the rest later gives the same results as the
  // whole week at once.
  if (state["seeds"] === undefined) state["seeds"] = {};
  const seeds = state["seeds"];
  if (!has(seeds, String(week))) {
    const rng = new Random(state["rng_state"]);
    const drawn = {};
    for (const [eid, g] of Object.entries(state["games"])) {
      if (g["week"] === week && !truthy(g["played"])) drawn[eid] = rng.randrange(1 << 30);
    }
    seeds[String(week)] = drawn;
    state["rng_state"] = rng.randrange(1 << 30);
  }
  return seeds[String(week)];
}


function state_fictional(slug) {
  // Is `slug` one of the fictional FCS stand-ins?
  return truthy(get(get(season.load_teams(), slug, {}), "fictional"));
}


class StandInError extends Error {
  // A team-scoped view asked for an FCS stand-in. The stand-ins exist only so FBS teams
  // can play their FCS games: they show in the box scores (and schedule lines) of those
  // games and nowhere else, so they have no pages of their own. (Python's is a LookupError.)
  constructor(message) {
    super(message);
    this.name = "StandInError";
  }
}


function fbs_only(teams) {
  // The slugs every league-wide view covers: every team but the FCS stand-ins. (A Set, in the teams' order.)
  const out = new Set();
  for (const [slug, t] of Object.entries(teams)) if (!truthy(get(t, "fictional"))) out.add(slug);
  return out;
}


function check_fbs(slug) {
  // Refuse a team-scoped view of an FCS stand-in (StandInError).
  const t = get(season.load_teams(), slug);
  if (truthy(t) && truthy(get(t, "fictional"))) {
    throw new season.StandInError(`${t["name"]} is an FCS stand-in: it shows only in the box scores of its games`);
  }
}


function _earned_for(state, slug) {
  // Clear Mode: a team's earned abilities for its game ({"Name|POS": {trait: tier}}; {} when none).
  return { ...(get(get(state, "abilities_earned") || {}, slug) || {}) };
}


function _base_traits(slug) {
  // A team's players' own abilities ({"Name|POS": {trait: tier}}) from the league in play.
  const t = get(season.load_teams(), slug) || {};
  const out = {};
  for (const p of [...(get(t, "offense") || []), ...(get(t, "defense") || [])]) {
    const own = {};
    for (const x of get(p, "traits") || []) {
      if (x !== null && typeof x === "object" && !Array.isArray(x)) own[x["key"]] = x["tier"];
    }
    out[`${get(p, "name")}|${get(p, "position")}`] = own;
  }
  return out;
}


function _run_games(state, game_ids, pool = null, report = null, stage = "Simulating") {
  // (`pool` is Python's worker pool: there is none here, the games go through season.play_jobs)
  function form_shift(g, slug) {
    // the real FCS school's strength, for a stand-in
    return season.state_fictional(slug) ? get(g, "fcs_shift", 0.0) : 0.0;
  }

  const jobs = [];
  let seeds, spare;
  if (game_ids.length) {
    seeds = season._week_seeds(state, state["games"][game_ids[0]]["week"]);
    spare = new Random(state["rng_state"]);
  }
  const keep = true;   // every game's box score is kept (on disk; yours also in the state)
  const depth = get(state, "depth") || {};
  for (const eid of game_ids) {
    const g = state["games"][eid];
    const home = g["home"], away = g["away"];
    const seed = has(seeds, eid) ? seeds[eid] : spare.randrange(1 << 30);
    // the job is plain arrays and dicts only (a host may hand it to a worker)
    const job = [eid, home, away, g["neutral"], seed, keep, [get(depth, home), get(depth, away)],
      season._injured(state, home), season._injured(state, away),
      [season.team_edits(state, home), season.team_edits(state, away)],
      [season.morale_payload(state, home), season.morale_payload(state, away), season.morale_on(state)],
      [form_shift(g, home), form_shift(g, away)]];
    if (season._clear_on()) job.push([season._earned_for(state, home), season._earned_for(state, away)]);
    jobs.push(job);
  }
  const before = season.morale_on(state) ? season.rank_map(state, state["current_week"]) : {};
  if (!jobs.length) return;
  if (report) report(stage, 0, jobs.length);

  function take(r) {
    const g = state["games"][r["event_id"]];
    Object.assign(g, { played: true, home_score: r["home_score"], away_score: r["away_score"], overtime: r["overtime"] });
    if (has(r, "stats")) {
      season._accumulate_stats(state, g, r["stats"]);
      season._update_morale(state, g, r["stats"], before);
      if (season._clear_on()) {                              // Clear Mode: ability goals move after every game
        const ability_goals = modules.ability_goals;
        ability_goals.after_game(state, { ...g, event_id: r["event_id"] }, r["stats"], get(r, "moments") || {},
          { [g["home"]]: season._base_traits(g["home"]), [g["away"]]: season._base_traits(g["away"]) });
      }
    }
    if (has(r, "game")) {
      if (state["team"] === g["home"] || state["team"] === g["away"]) state["my_boxes"][r["event_id"]] = r["game"];
      season.save_box(state, r["event_id"], r["game"]);
    }
    for (const side of ["home", "away"]) {
      for (const inj of get(get(r, "injuries", {}), side, [])) {
        if (inj["weeks"] > 0) {
          const key = `${inj["name"]}|${inj["position"]}`;
          if (state["injuries"] === undefined) state["injuries"] = {};
          if (state["injuries"][g[side]] === undefined) state["injuries"][g[side]] = {};
          state["injuries"][g[side]][key] = {
            name: inj["name"], position: inj["position"], type: inj["type"], weeks: inj["weeks"],
            weeks_left: inj["weeks"], since_week: g["week"], event_id: r["event_id"] };
        }
      }
    }
  }

  function collect() {
    // Games may finish in any order (a host that shares them out); progress is reported as they do, but
    // the results are applied in schedule order, so a seeded season plays out the same
    // every time (the morale baseline and the injury list depend on the order).
    const done = new Map();
    let n = 0;
    season.play_jobs(jobs, (r) => {
      n += 1;
      done.set(r["event_id"], r);
      if (report) report(stage, n, jobs.length);
    });
    for (const eid of game_ids) take(done.get(eid));
  }

  season._use(String(season._league_path));
  collect();
}


function _ccg_matchups(state, teams) {
  const table = season.standings(state);
  const divs = season.divisions(state);
  const out = [];
  for (const [conf, rows] of Object.entries(table)) {
    if (has(polls.INDEPENDENT, conf) || rows.length < 4) continue;
    let a, b;
    if (has(divs, conf)) {
      // division winners; the better record (conference, then overall, then margin) is the higher seed
      const div_names = Array.isArray(divs[conf]) ? divs[conf] : Object.keys(divs[conf]);
      const winners = div_names.map((div) => {
        const w = rows.find((r) => r["division"] === div && r["conf_rank"] === 1);
        if (w === undefined) throw new Error("StopIteration");
        return w;
      });
      const key = (r) => [-(r["conf_wins"] / Math.max(1, r["conf_wins"] + r["conf_losses"])),
        -(r["wins"] / Math.max(1, r["wins"] + r["losses"])), -(r["points_for"] - r["points_against"])];
      winners.sort((x, y) => cmp(key(x), key(y)));
      a = winners[0];
      b = winners[1];
    } else {
      a = rows[0];
      b = rows[1];
    }
    const hosted = has(season.HOSTED_CCG, conf);
    const site = hosted ? `${teams[a["slug"]]["stadium"]["name"]}, ${a["name"]}` : null;
    out.push({ event_id: season._ccg_event_id(conf), week: season.CCG_WEEK, date: null, neutral: !hosted,
      home: a["slug"], away: b["slug"], home_display: a["name"], away_display: b["name"],
      conference_game: false, played: false, home_score: null, away_score: null, overtime: 0,
      real: false, kind: "ccg", conference: conf, title: `${conf} Championship`, site,
      divisions: has(divs, conf) ? [get(a, "division"), get(b, "division")] : null });
  }
  return out;
}


function _playoff_round(state, week, teams) {
  // Create the games of a playoff round from the bracket and earlier rounds.
  const br = state["bracket"];
  const seeds = {};
  for (const s of br["seeds"]) seeds[s["seed"]] = s["team"];
  const games = [];
  const conf_of = {};
  for (const [slug, t] of Object.entries(teams)) conf_of[slug] = t["conference"];
  let sites = get(state, "playoff_sites");
  if (sites === null) {
    sites = bowls.playoff_sites(seeds, conf_of);
    state["playoff_sites"] = sites;
  }

  function mk(eid, home, away, neutral, title, home_seed, away_seed, site_key = null) {
    const site = truthy(site_key) ? get(sites, site_key) : null;
    const bowl_name = truthy(site) ? site["bowl"] : null;
    let shown_title;
    if (!truthy(bowl_name)) shown_title = title;
    else if (bowl_name.includes("Championship")) shown_title = bowl_name;
    else shown_title = `${bowl_name} (${title.split(":")[0]})`;   // e.g. "Rose Bowl (Quarterfinal)"
    return { event_id: eid, week, date: get(truthy(site) ? site : {}, "date"), neutral, home, away,
      home_display: `(${home_seed}) ${teams[home]["name"]}`, away_display: `(${away_seed}) ${teams[away]["name"]}`,
      conference_game: false, played: false, home_score: null, away_score: null, overtime: 0,
      real: false, kind: "playoff", title: shown_title,
      bowl: bowl_name, site: get(truthy(site) ? site : {}, "site") || (!neutral ? `${teams[home]["stadium"]["name"]}, ${teams[home]["name"]}` : null),
      home_seed, away_seed };
  }

  function winner(eid) {
    // [winner, his seed] of an earlier playoff game.
    const g = state["games"][eid];
    return g["home_score"] > g["away_score"] ? [g["home"], g["home_seed"]] : [g["away"], g["away_seed"]];
  }

  const first = min_key(season.PLAYOFF_WEEKS);
  if (week === first) {
    for (const [hs, as_] of [[5, 12], [6, 11], [7, 10], [8, 9]]) {
      games.push(mk(`cfp-r1-${hs}`, seeds[hs], seeds[as_], false, `First Round: ${hs} vs ${as_}`, hs, as_));
    }
  } else if (week === first + 1) {
    for (const [top, eid, label] of [[1, "cfp-r1-8", "1 vs 8/9"], [2, "cfp-r1-7", "2 vs 7/10"], [3, "cfp-r1-6", "3 vs 6/11"], [4, "cfp-r1-5", "4 vs 5/12"]]) {
      const [w, ws] = winner(eid);
      games.push(mk(`cfp-qf-${top}`, seeds[top], w, true, `Quarterfinal: ${label}`, top, ws, `qf-${top}`));
    }
  } else if (week === first + 2) {
    const [a, a_s] = winner("cfp-qf-1"), [b, b_s] = winner("cfp-qf-4");
    games.push(mk("cfp-sf-1", a, b, true, "Semifinal", a_s, b_s, "sf-1"));
    const [c, c_s] = winner("cfp-qf-2"), [d, d_s] = winner("cfp-qf-3");
    games.push(mk("cfp-sf-2", c, d, true, "Semifinal", c_s, d_s, "sf-2"));
  } else if (week === season.FINAL_WEEK) {
    const [a, a_s] = winner("cfp-sf-1"), [b, b_s] = winner("cfp-sf-2");
    games.push(mk("cfp-final", a, b, true, "National Championship", a_s, b_s, "final"));
  }
  return games;
}


function _bowl_games(state, teams) {
  // Bowl matchups for the whole bowl season, placed in weeks 16-18 by date.
  const rec = season._records(state);
  const field = new Set(get(get(state, "bracket") || {}, "seeds", []).map((x) => x["team"]));
  const final = get(get(state["polls"], String(season.CCG_WEEK), {}), "cfp_full") || [];
  const ratings = {};
  for (const [slug, t] of Object.entries(teams)) ratings[slug] = t["team_ratings"]["overall"];
  const out = [];
  state["bowls"] = [];
  const picked = bowls.select_bowls(rec, teams, field, truthy(final) ? final : [], ratings);
  for (let i = 0; i < picked.length; i++) {
    const b = picked[i];
    const eid = `bowl-${i}-${b["bowl"].toLowerCase().replaceAll(" ", "-").replaceAll("'", "")}`;
    const entry = { ...b, event_id: eid };
    state["bowls"].push(entry);
    if (truthy(b["unfilled"])) continue;
    out.push({ event_id: eid, week: b["week"], date: b["date"], neutral: true, home: b["home"], away: b["away"],
      home_display: teams[b["home"]]["name"], away_display: teams[b["away"]]["name"], conference_game: false,
      played: false, home_score: null, away_score: null, overtime: 0, real: false, kind: "bowl",
      title: b["name"], bowl: b["bowl"], site: b["site"] });
  }
  return out;
}


function week_name(week) {
  // A regular-season week as the real calendar names it (the player's ask): the opening week, a handful of games the
  // Saturday before Labor Day weekend, is Week 0, so engine week N reads Week N-1 (rivalry weekend, engine 14, is Week
  // 13). Internal week numbers never change; 0 stays the preseason.
  return `Week ${week - 1}`;
}


season.NO_ARTICLE_TROPHIES = ["Illibuck"];          // a trophy that is a name: "takes Illibuck", not "the Illibuck"
// the sim's progress line by week: the postseason's week labels are tab titles and do not take "games" after them
season.STAGE_WORDS = { 17: "Playing the first round and the bowls", 18: "Playing the quarterfinals and the bowls",
  19: "Playing the semifinals and the bowls", 20: "Playing the national championship" };


function week_label(week) {
  if (week === season.CCG_WEEK) return "Championship Week";
  if (week === season.SELECTION_WEEK) return "Selection Week";
  return at(season.BOWL_WEEK_LABELS, week) || season.week_name(week);
}


function _setup_week(state, week, teams, say) {
  // What happens before a week's games, once: injuries heal a week, and the title games,
  // the playoff round and the bowls are set. Game day and the full advance both call it.
  if (get(state, "week_setup") === week) return;
  season._set_matchups(state, week, teams, say);
  state["week_setup"] = week;
  season._heal(state);
  season._decay_morale(state);
}


function _set_matchups(state, week, teams, say) {
  // Create a postseason week's games once: the title games, a playoff round, the bowls.
  // Nothing here is random, so setting them early changes no result.
  if (state["matchups_set"] === undefined) state["matchups_set"] = [];
  const done = state["matchups_set"];
  if (done.includes(week) || (get(state, "week_setup") || 0) >= week) {
    return;                        // already set (a season saved before matchups_set existed set them in _setup_week)
  }
  done.push(week);
  const add = (g) => { if (state["games"][g["event_id"]] === undefined) state["games"][g["event_id"]] = g; };
  if (week === season.CCG_WEEK) {
    say("Setting the conference title games");
    for (const g of season._ccg_matchups(state, teams)) add(g);
  }
  if (has(season.PLAYOFF_WEEKS, week)) {
    say(`Setting the ${at(season.PLAYOFF_WEEKS, week).toLowerCase()} matchups`);
    for (const g of season._playoff_round(state, week, teams)) add(g);
  }
  if (week === min_key(season.PLAYOFF_WEEKS)) {
    say("Selecting the bowls");
    for (const g of season._bowl_games(state, teams)) add(g);
  }
}


function schedule_ahead(state, say = (stage) => null) {
  // Set the next postseason games as soon as the real calendar announces them, so the
  // schedule and This week show them before they are played: the title games once the
  // regular season ends, the first playoff round and the bowls on selection day (right
  // after championship week), each later round once the one before it is played.
  if (truthy(state["done"])) return;
  const nxt = state["current_week"] + 1;
  if (nxt === season.CCG_WEEK && Object.values(state["games"]).some((g) => g["week"] <= season.LAST_REGULAR_WEEK && !truthy(g["played"]))) {
    return;                        // the regular season is not finished (a game day in progress)
  }
  const weeks = nxt === season.SELECTION_WEEK ? [nxt, min_key(season.PLAYOFF_WEEKS)] : [nxt];
  const teams = season.load_teams();
  for (const week of weeks) {
    if (week === season.CCG_WEEK || (has(season.PLAYOFF_WEEKS, week) && truthy(get(state, "bracket")))) {
      season._set_matchups(state, week, teams, say);
    }
  }
}


function my_game_id(state, week = null) {
  // Your unplayed game in `week` (default: the week up next), or null on a bye.
  week = week === null || week === undefined ? state["current_week"] + 1 : week;
  const me = state["team"];
  for (const [eid, g] of Object.entries(state["games"])) {
    if (g["week"] === week && !truthy(g["played"]) && (me === g["home"] || me === g["away"])) return eid;
  }
  return null;
}


function _stage_reporter(report) {
  // `say(stage)`: report a stage of the week without a game count.
  function say(stage) {
    if (report) report(stage, null, null);
  }
  return say;
}


function play_my_game(state, pool = null, report = null) {
  // Game day: set the week up if it is not yet, then simulate only your game. The rest
  // of the week waits for `advance`. Returns the game's event id, or null on a bye.
  if (truthy(state["done"])) return null;
  const week = state["current_week"] + 1;
  season._setup_week(state, week, season.load_teams(), season._stage_reporter(report));
  if (truthy(get(state, "career")) && truthy(get(state, "league"))) {          // promises: who starts your game, recorded before it is played
    modules.promises.snapshot_week(state, week);
  }
  const eid = season.my_game_id(state, week);
  if (eid === null) return null;
  season._run_games(state, [eid], pool, report, "Playing your game");
  return eid;
}


function advance(state, pool = null, report = null, auto_recruit = false) {
  // Play the next week (the rest of it, after a game day). Returns the state.
  // `report(stage, games_done, games_total)` is called as the week goes, for a live
  // progress display. In a Coach Career the recruiting week follows the games
  // (`auto_recruit`: Auto-recruit runs your school's week too).
  if (truthy(state["done"])) return state;
  const say = season._stage_reporter(report);
  const teams = season.load_teams();
  const week = state["current_week"] + 1;
  season._setup_week(state, week, teams, say);
  if (truthy(get(state, "career")) && truthy(get(state, "league"))) {          // promises judged all season: who starts this week (coach_career/promises.py)
    modules.promises.snapshot_week(state, week);
  }
  const ids = Object.entries(state["games"]).filter(([, g]) => g["week"] === week && !truthy(g["played"])).map(([eid]) => eid);
  season._run_games(state, ids, pool, report, at(season.STAGE_WORDS, week) || (week === season.CCG_WEEK ? "Playing the conference title games"
    : week === season.SELECTION_WEEK ? "Playing this week's games"
    : `Playing ${season.week_label(week)} games`));

  if (week === season.CCG_WEEK) {
    for (const g of Object.values(state["games"])) {
      if (g["kind"] === "ccg") {
        const won_home = g["home_score"] > g["away_score"];
        state["champions"][g["conference"]] = won_home ? g["home"] : g["away"];
        if (state["runners_up"] === undefined) state["runners_up"] = {};
        state["runners_up"][g["conference"]] = won_home ? g["away"] : g["home"];
      }
    }
  }
  if (week <= season.CCG_WEEK) {
    say(has(season.CFP_WEEKS, week) ? "Updating the AP poll and CFP rankings" : "Updating the AP poll");
    season._update_polls_after_week(state, teams, week);
  }
  if (week === season.CCG_WEEK) {
    say("Building the playoff bracket");
    const full = get(state["polls"][String(week)], "cfp_full");
    const final = truthy(full) ? full : state["polls"][String(week)]["cfp"].map((e) => e["team"]);
    const conf_of = {}, names = {};
    for (const [slug, t] of Object.entries(teams)) conf_of[slug] = t["conference"];
    for (const [slug, t] of Object.entries(teams)) names[slug] = t["name"];
    state["bracket"] = polls.build_bracket(final, state["champions"], conf_of, names);
    state["phase"] = "playoff";
  }
  if (has(season.PLAYOFF_WEEKS, week)) {
    state["playoff"][at(season.PLAYOFF_WEEKS, week)] = Object.entries(state["games"]).filter(([, g]) => g["week"] === week && g["kind"] === "playoff").map(([eid]) => eid);
    if (week === season.FINAL_WEEK) {
      state["champion"] = season._winner(state["games"]["cfp-final"]);
      say("Final AP poll");
      season._final_ap_poll(state, teams);
      state["done"] = true;
      state["phase"] = "done";
    }
  }
  state["current_week"] = week;
  if (has(season._AWARD_STAGES, week)) {
    say(at(season._AWARD_STAGES, week));
    season._award_step(state, teams, week);
  }
  if (truthy(get(state, "recruiting"))) {
    say(season.RECRUITING_STAGE);
    modules.recruiting.weekly_step(state, week, auto_recruit);
  }
  season.schedule_ahead(state, say);
  return state;
}


Object.assign(season, {
  _use, _init, _injured,
  RedshirtError, redshirt_status, redshirt_toggle,
  PositionError, position_changes, _skills, _roster_player, position_options, _rekey_player, change_position,
  _game_team, _sim_one, _sim_one_here: _sim_one, play_jobs, sim_workers, _make_pool,
  _week_seeds, state_fictional, StandInError, fbs_only, check_fbs, _earned_for, _base_traits, _run_games,
  _ccg_matchups, _playoff_round, _bowl_games, week_name, week_label, _setup_week, _set_matchups, schedule_ahead,
  my_game_id, _stage_reporter, play_my_game, advance,
});
// what sim_js/game_job.js already has
season._with_injuries = game_job._with_injuries;
season.with_positions = game_job.with_positions;
season._with_earned = game_job._with_earned;
season._moments = game_job._moments;
