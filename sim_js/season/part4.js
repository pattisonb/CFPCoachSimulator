// The season, part 4: the views the pages read. Rankings, the committee's
// resume, the season's stats (a game's lines summed into the season's, leaders, team numbers), trading and moving
// your non-conference games, and rivalries (trophies and the all-time series).
//
// Every name of the season is reached through the `season` namespace, whichever part defines it
// (engine_js/PORTING.md, "Big Files in Parts").
import { round, int, sum, cmp, sorted, maxBy, minBy, get, isNumber, truthy } from "../../engine_js/pyrt.js";
import { read_json } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";
import * as game_job from "../game_job.js";
import { ValueError } from "../coaches.js";
import { season } from "../season_ns.js";

// ----- small helpers (local to this part) --------------------------------------------------------------------

const has = (d, k) => Object.prototype.hasOwnProperty.call(d, k);

/** A frozenset of slugs as a key: its members, each once, sorted and joined (no slug holds the separator). */
const SEP = "\u0000";
const _fs = (xs) => [...new Set(xs)].sort().join(SEP);

/** `x in coll` for a tuple, list or set. */
const _in = (x, coll) => (coll instanceof Set ? coll.has(x) : Array.from(coll).includes(x));

const DAY_MS = 86400000;

/** The clock time y-m-d H:M:S as milliseconds (a plain count: no time zone), or null when it is not a real date or time. */
function _wall(y, mo, d, h = 0, mi = 0, s = 0) {
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const date = new Date(Date.UTC(2000, mo - 1, d, h, mi, s));
  date.setUTCFullYear(y);
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;       // the 31st of a 30-day month
  return date.getTime();
}

/**
 * datetime.fromisoformat(text) as the clock time it names, in milliseconds, or null where Python raises ValueError.
 * An offset on the end is checked and dropped: Python keeps the offset through the arithmetic done here (minus six
 * hours, strftime), so the date printed is the text's own clock time moved, whatever the offset.
 */
const _ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[\s\S](\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,]\d+)?)?)?)?(?:Z|[+-]\d{2}(?::?\d{2}(?::?\d{2}(?:\.\d+)?)?)?)?$/;
function _fromisoformat(text) {
  const m = _ISO.exec(text);
  if (!m) return null;
  return _wall(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
}

/** strftime("%Y-%m-%d") of such a time. */
const _ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

/** datetime.strptime(text, "%Y-%m-%dT%H:%MZ") as milliseconds, or null where Python raises ValueError. */
const _KICKOFF = /^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{1,2})Z$/;
function _strptime_kickoff(text) {
  const m = _KICKOFF.exec(text);
  if (!m) return null;
  return _wall(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
}

// ----- views for the page --------------------------------------------------

function rank_map(state, after_week) {
  // Team -> rank from the poll released after `after_week`: the CFP ranking once the
  // committee has released one, the AP poll before that (top 25 either way).
  const p = get(state["polls"], String(after_week), {});
  const out = {};
  if (truthy(get(p, "cfp_full"))) {
    p["cfp_full"].slice(0, 25).forEach((t, i) => { out[t] = i + 1; });
    return out;
  }
  if (truthy(get(p, "cfp"))) {
    for (const e of p["cfp"]) out[e["team"]] = e["rank"];
    return out;
  }
  for (const e of get(p, "ap", [])) out[e["team"]] = e["rank"];
  return out;
}

// ----- the committee's resume -------------------------------------------------------

function _wl_pct(w, l) {
  // Winning percentage from wins and losses.
  return (w + l) ? w / (w + l) : 0.0;
}

function resume(state, after_week = null, team = null) {
  // How the committee reads every FBS team through `after_week`: record, wins over
  // ranked teams (rank at the time and today), strength of schedule, record against
  // winning teams, best win and worst loss. With `team`, that team's full game list too.
  // "Ranked" means the current top 25: the CFP ranking once released, the AP poll before.
  if (truthy(team)) season.check_fbs(team);
  const teams = season.load_teams();
  const cur = state["current_week"];
  const w = after_week === null ? cur : Math.max(0, Math.min(int(after_week), cur));
  const rec = season._records(state, w);
  const now = season.rank_map(state, w);
  const p = get(state["polls"], String(w), {});
  const kind = (truthy(get(p, "cfp_full")) || truthy(get(p, "cfp"))) ? "cfp" : "ap";
  // (nothing below depends on its order: the rows are sorted by a key no two teams share)
  const real = new Set(Object.entries(teams).filter(([, t]) => !truthy(t["fictional"])).map(([s]) => s));
  const games = {};
  for (const s of Object.keys(teams)) games[s] = [];
  for (const [eid, g] of Object.entries(state["games"])) {
    if (!truthy(g["played"]) || g["week"] > w || g["kind"] === "playoff") continue;
    const before = season.rank_map(state, g["week"] - 1);
    for (const [side, opp] of [["home", "away"], ["away", "home"]]) {
      const me = g[side], o = g[opp];
      const pf = g[`${side}_score`], pa = g[`${opp}_score`];
      const r = get(rec, o, { wins: 0, losses: 0 });
      games[me].push({ opp: o, opp_name: g[`${opp}_display`], won: pf > pa, pf, pa, week: g["week"],
        venue: season._venue(g, side === "home"),
        rank_then: get(before, o), rank_now: get(now, o), opp_record: real.has(o) ? season._record_str(r) : "",   // an FCS stand-in's record means nothing: never shown
        opp_pct: season._wl_pct(r["wins"], r["losses"]), fcs: !real.has(o), event_id: eid,
        title: get(g, "title"), conference_game: g["conference_game"] });
    }
  }
  // strength of schedule: two thirds the opponents' record, one third their opponents'
  // (FBS opponents only; the FCS stand-ins play too many schedules to have a record)
  const fbs_opps = {};
  for (const s of real) fbs_opps[s] = games[s].filter((x) => !x["fcs"]).map((x) => x["opp"]);
  const opp_pct = {};
  for (const s of real) {
    const opps = fbs_opps[s];
    const ow = sum(opps.map((o) => rec[o]["wins"])), ol = sum(opps.map((o) => rec[o]["losses"]));
    opp_pct[s] = season._wl_pct(ow, ol);
  }
  const sos = {};
  const oo_pct = {};
  for (const s of real) {
    const opps = fbs_opps[s];
    oo_pct[s] = opps.length ? sum(opps.map((o) => opp_pct[o])) / opps.length : 0.0;
    sos[s] = (2 * opp_pct[s] + oo_pct[s]) / 3;
  }
  const order = sorted(real, (s) => [-sos[s], s]);
  const sos_rank = {};
  order.forEach((s, i) => { sos_rank[s] = i + 1; });

  // a ranked opponent first (the higher the better), then the opponent's record, then the margin
  const quality = (x) => [x["rank_now"] !== null, -(x["rank_now"] || 99), x["opp_pct"], x["pf"] - x["pa"]];

  // an unranked opponent first, then the worse its record, then the bigger the margin
  const badness = (x) => [x["rank_now"] !== null, x["opp_pct"], -(x["pa"] - x["pf"])];

  const wl = (lst) => `${lst.filter((x) => x["won"]).length}-${lst.filter((x) => !x["won"]).length}`;

  let rows = [];
  for (const s of real) {
    const gl = games[s];
    const wins = gl.filter((x) => x["won"]);
    const losses = gl.filter((x) => !x["won"]);
    const r = rec[s];
    const conf = gl.filter((x) => truthy(x["conference_game"]));
    const row = { team: s, name: teams[s]["name"], conference: teams[s]["conference"], rank: get(now, s),
      record: season._record_str(r), wins: r["wins"], losses: r["losses"], conf_record: wl(conf),
      sos_rank: sos_rank[s], sos: round(sos[s], 3), opp_pct: round(opp_pct[s], 3), oo_pct: round(oo_pct[s], 3),
      top25: wl(gl.filter((x) => truthy(x["rank_now"]))), top25_wins: wins.filter((x) => truthy(x["rank_now"])).length,
      vs_winning: wl(gl.filter((x) => !x["fcs"] && x["opp_pct"] > 0.5)),
      road_wins: wins.filter((x) => x["venue"] !== "home").length, fcs_wins: wins.filter((x) => x["fcs"]).length,
      margin: gl.length ? round((r["points_for"] - r["points_against"]) / gl.length, 1) : 0.0,
      best_win: wins.length ? maxBy(wins, quality) : null, worst_loss: losses.length ? minBy(losses, badness) : null };
    if (team === s) row["games"] = sorted(gl, (x) => x["week"]);
    rows.push(row);
  }
  rows.sort((a, b) => cmp(
    [a["rank"] === null, a["rank"] || 99, -season._wl_pct(a["wins"], a["losses"]), a["sos_rank"]],
    [b["rank"] === null, b["rank"] || 99, -season._wl_pct(b["wins"], b["losses"]), b["sos_rank"]]));
  if (team !== null) rows = rows.filter((x) => x["team"] === team);
  return { week: w, kind, rows };
}

function current_rank(state) {
  // Your team's rank in the latest ranking, with which poll it came from.
  for (let w = state["current_week"]; w > -1; w--) {
    const p = get(state["polls"], String(w));
    if (!truthy(p)) continue;
    const kind = (truthy(get(p, "cfp_full")) || truthy(get(p, "cfp"))) ? "cfp" : "ap";
    const r = get(season.rank_map(state, w), state["team"]);
    return { rank: r, kind, week: w };
  }
  return null;
}

function week_view(state, week) {
  const teams = season.load_teams();
  const ap = season.rank_map(state, week - 1);
  const rec = season._records(state, undefined, true);
  const out = [];
  for (const g of Object.values(state["games"])) {
    if (g["week"] !== week) continue;
    out.push({ ...g, home_rank: get(ap, g["home"]), away_rank: get(ap, g["away"]),
      mine: state["team"] === g["home"] || state["team"] === g["away"], has_box: season.has_box(state, g),
      home_name: season.team_display(g["home"], teams), away_name: season.team_display(g["away"], teams),
      // the stand-ins play many schedules: no record
      home_record: truthy(teams[g["home"]]["fictional"]) ? "" : season._record_str(rec[g["home"]]),
      away_record: truthy(teams[g["away"]]["fictional"]) ? "" : season._record_str(rec[g["away"]]) });
  }
  const kinds = { playoff: 0, bowl: 1 };
  const key = (g) => [!g["mine"], get(kinds, g["kind"], 2), g["date"] || "", g["event_id"]];
  out.sort((a, b) => cmp(key(a), key(b)));
  return out;
}

// ----- season stats --------------------------------------------------------
// Full box scores are kept only for your own games; for every game the workers send
// back a compact per-team line (team totals, situational counts, plays, possession and
// each player's stat line) which is summed into state["season_stats"] as the season goes.

season.PLAYER_CATEGORIES = {
  "passing": ["pass_attempts", ["completions", "pass_attempts", "pass_yards", "passing_touchdowns", "interceptions_thrown", "sacks_taken",
    "passing_first_downs", "passing_conversions", "long_pass"], "pass_yards"],
  "rushing": ["carries", ["carries", "rush_yards", "rushing_touchdowns", "fumbles", "explosive_runs", "rushing_first_downs", "rushing_conversions", "long_rush"], "rush_yards"],
  "receiving": ["receptions", ["targets", "receptions", "receiving_yards", "receiving_touchdowns", "explosive_catches", "receiving_first_downs", "long_reception"], "receiving_yards"],
  "defense": ["solo_tackles", ["solo_tackles", "assisted_tackles", "tackles_for_loss", "sacks", "hurries", "interceptions", "interception_return_yards",
    "passes_defended", "forced_fumbles", "fumble_recoveries", "defensive_touchdowns"], "solo_tackles"],
  "kicking": ["fg_attempted", ["fg_made", "fg_attempted", "fg_40_made", "fg_40_att", "fg_50_made", "fg_50_att", "long_fg", "pat_made", "pat_attempts"], "fg_made"],
  "punting": ["punts", ["punts", "punt_yards", "punt_net_yards", "punts_inside_20", "punt_touchbacks", "long_punt"], "punts"],
  "returns": ["kickoff_returns", ["kickoff_returns", "kickoff_return_yards", "kickoff_return_touchdowns", "long_kickoff_return", "punt_returns",
    "punt_return_yards", "punt_return_touchdowns", "long_punt_return"], "kickoff_return_yards"],
  // offensive linemen: snaps, starts and the line credits the engine keeps
  "blocking": ["snaps", ["snaps", "games_started", "sacks_allowed", "pressures_allowed", "stuffs_allowed", "key_blocks"], "snaps"],
};

// (sim_js/game_job.js already has it: the game's result is made compact there)
season._compact_side = game_job._compact_side;

function _add_into(total, add) {
  for (const [k, v] of Object.entries(add)) {
    if (isNumber(v)) {
      if (k.startsWith("long_")) {
        const have = get(total, k, 0);
        total[k] = v > have ? v : have;                 // max(have, v): the first of equals
      } else {
        total[k] = get(total, k, 0) + v;
      }
    }
  }
}

function _accumulate_stats(state, g, lines) {
  if (!has(state, "season_stats")) state["season_stats"] = {};
  const ss = state["season_stats"];
  for (const [side, opp] of [["home", "away"], ["away", "home"]]) {
    const mine = lines[side], theirs = lines[opp];
    if (!has(ss, g[side])) {
      ss[g[side]] = { games: 0, wins: 0, points: 0, opp_points: 0, plays: 0, top: 0, opp_plays: 0,
        team: {}, events: {}, opp: {}, opp_events: {}, players: {} };
    }
    const t = ss[g[side]];
    t["games"] += 1;
    t["wins"] += mine["score"] > theirs["score"] ? 1 : 0;
    t["points"] += mine["score"];
    t["opp_points"] += theirs["score"];
    t["plays"] += mine["plays"];
    t["top"] += mine["top"];
    t["opp_plays"] += theirs["plays"];
    if (!has(t, "personnel")) t["personnel"] = {};
    const pers = t["personnel"];
    for (const [k, v] of Object.entries(get(mine, "personnel") || {})) pers[k] = get(pers, k, 0) + v;
    if (truthy(get(mine, "schemes"))) t["schemes"] = mine["schemes"];
    season._add_into(t["team"], mine["team"]);
    season._add_into(t["events"], mine["events"]);
    season._add_into(t["opp"], theirs["team"]);
    season._add_into(t["opp_events"], theirs["events"]);
    for (const p of mine["players"]) {
      const key = `${p["name"]}|${p["position"]}`;
      if (!has(t["players"], key)) t["players"][key] = { name: p["name"], position: p["position"], unit: p["unit"], games: 0, stats: {} };
      const rec = t["players"][key];
      rec["games"] += 1;
      season._add_into(rec["stats"], p["stats"]);
    }
  }
}

function _season_stats(state) {
  // The accumulated stats; a season saved before this existed is rebuilt from the box
  // scores it kept (your own games only).
  if (has(state, "season_stats")) return state["season_stats"];
  const tmp = { season_stats: {} };
  for (const [eid, box] of Object.entries(state["my_boxes"])) {
    const g = get(state["games"], eid);
    if (!truthy(g)) continue;
    const lines = { home: season._compact_side(box["home"], box["drives"], "home"), away: season._compact_side(box["away"], box["drives"], "away") };
    season._accumulate_stats(tmp, g, lines);
  }
  state["season_stats"] = tmp["season_stats"];
  state["season_stats_partial"] = true;
  return state["season_stats"];
}

function team_stats_view(state) {
  // Per-game team numbers for every team that has played a simulated game.
  const teams = season.load_teams();
  const ss = season._season_stats(state);
  const rows = [];
  for (const [slug, t] of Object.entries(ss)) {
    const info = get(teams, slug);
    if (!truthy(info) || truthy(info["fictional"])) continue;
    const g = t["games"] || 1;
    const s = t["team"], o = t["opp"], e = t["events"], oe = t["opp_events"];
    const yards = get(s, "Pass Yards", 0) + get(s, "Rush Yards", 0);
    const opp_yards = get(o, "Pass Yards", 0) + get(o, "Rush Yards", 0);
    const lost = get(e, "fumbles_lost", get(s, "Fumbles", 0));
    const opp_lost = get(oe, "fumbles_lost", get(o, "Fumbles", 0));
    const extra = {};
    for (const k of ["tackles_for_loss", "passes_defended", "hurries", "explosive_runs", "explosive_catches", "pressures_allowed"]) extra[k] = 0;
    for (const pl of Object.values(get(t, "players", {}))) {
      for (const k of Object.keys(extra)) extra[k] += get(pl["stats"], k, 0);
    }
    rows.push({
      tfl: extra["tackles_for_loss"], pbu: extra["passes_defended"], hurries: extra["hurries"],
      explosives: extra["explosive_runs"] + extra["explosive_catches"], pressures_allowed: extra["pressures_allowed"],
      team: slug, name: info["name"], conference: info["conference"], fictional: info["fictional"],
      games: t["games"], wins: t["wins"], losses: t["games"] - t["wins"],
      ppg: t["points"] / g, opp_ppg: t["opp_points"] / g, margin: (t["points"] - t["opp_points"]) / g,
      ypg: yards / g, pass_ypg: get(s, "Pass Yards", 0) / g, rush_ypg: get(s, "Rush Yards", 0) / g,
      ypp: truthy(t["plays"]) ? yards / t["plays"] : 0, plays_pg: t["plays"] / g,
      ypc: truthy(get(s, "Carries")) ? get(s, "Rush Yards", 0) / s["Carries"] : 0,
      ypa: truthy(get(s, "Pass Attempts")) ? get(s, "Pass Yards", 0) / s["Pass Attempts"] : 0,
      comp_pct: truthy(get(s, "Pass Attempts")) ? 100 * get(s, "Completions", 0) / s["Pass Attempts"] : 0,
      third_pct: truthy(get(e, "third_downs")) ? 100 * get(e, "third_down_conversions", 0) / e["third_downs"] : 0,
      red_zone_pct: truthy(get(e, "red_zone_trips")) ? 100 * get(e, "red_zone_scores", 0) / e["red_zone_trips"] : 0,
      first_downs_pg: get(e, "first_downs", 0) / g, top: t["top"] / g,
      turnovers: get(s, "Interceptions Thrown", 0) + lost, takeaways: get(s, "Interceptions", 0) + get(s, "Fumble Recoveries", 0),
      sacks: get(s, "Sacks", 0), sacks_allowed: get(s, "Sacks Taken", 0), penalties_pg: get(e, "penalties", 0) / g,
      penalty_ypg: get(e, "penalty_yards", 0) / g,
      opp_ypg: opp_yards / g, opp_pass_ypg: get(o, "Pass Yards", 0) / g, opp_rush_ypg: get(o, "Rush Yards", 0) / g,
      opp_ypp: truthy(t["opp_plays"]) ? opp_yards / t["opp_plays"] : 0,
      opp_third_pct: truthy(get(oe, "third_downs")) ? 100 * get(oe, "third_down_conversions", 0) / oe["third_downs"] : 0,
      opp_turnovers: get(o, "Interceptions Thrown", 0) + opp_lost,
    });
  }
  rows.sort((a, b) => cmp([-a["margin"], a["name"]], [-b["margin"], b["name"]]));
  return { teams: rows, partial: truthy(get(state, "season_stats_partial")) };
}

function* _stat_teams(ss, teams, team, conference) {
  // [slug, season stats, team info] for the teams a stats table covers: one team, or the
  // league or one conference, never an FCS stand-in (asking for one is refused).
  // (A generator: the check runs when the first team is asked for.)
  if (truthy(team)) season.check_fbs(team);
  for (const [slug, t] of Object.entries(ss)) {
    if (truthy(team) && slug !== team) continue;
    const info = get(teams, slug);
    if (!truthy(info) || truthy(info["fictional"])) continue;
    if (truthy(conference) && !truthy(team) && info["conference"] !== conference) continue;
    yield [slug, t, info];
  }
}

function player_stats_view(state, team = null, category = "passing", limit = 100, conference = null) {
  const teams = season.load_teams();
  const ss = season._season_stats(state);
  if (!has(season.PLAYER_CATEGORIES, category)) throw new ValueError(`unknown category ${category}`);
  const [gate, keys, sort_key] = season.PLAYER_CATEGORIES[category];
  let out = [];
  for (const [slug, t, info] of season._stat_teams(ss, teams, team, conference)) {
    for (const p of Object.values(t["players"])) {
      const st = p["stats"];
      if (category === "blocking" && (!["OL", "TE", "RB"].includes(p["position"]) || !truthy(get(st, "snaps")))) continue;
      if (!truthy(get(st, gate)) && !(category === "defense" && keys.some((k) => truthy(get(st, k))))
          && !(category === "returns" && truthy(get(st, "punt_returns"))) && !(category === "kicking" && truthy(get(st, "pat_attempts")))) continue;
      const stats = {};
      for (const k of keys) stats[k] = get(st, k, 0);
      out.push({ name: p["name"], position: p["position"], team: slug, team_name: info["name"], games: p["games"],
        team_games: t["games"], stats });
    }
  }
  out.sort((a, b) => cmp([-get(a["stats"], sort_key, 0), a["name"]], [-get(b["stats"], sort_key, 0), b["name"]]));
  if (!truthy(team)) out = out.slice(0, limit);
  return { category, team, players: out, partial: truthy(get(state, "season_stats_partial")) };
}

season.LEADER_KEYS = {
  "passing": ["passing", (st) => get(st, "pass_yards", 0)],
  "rushing": ["rushing", (st) => get(st, "rush_yards", 0)],
  "receiving": ["receiving", (st) => get(st, "receiving_yards", 0)],
  "tackles": ["defense", (st) => get(st, "solo_tackles", 0) + get(st, "assisted_tackles", 0)],
  "sacks": ["defense", (st) => get(st, "sacks", 0)],
  "interceptions": ["defense", (st) => get(st, "interceptions", 0)],
  "touchdowns": ["rushing", (st) => get(st, "rushing_touchdowns", 0) + get(st, "receiving_touchdowns", 0)],
  "kicking": ["kicking", (st) => get(st, "fg_made", 0) * 3 + get(st, "pat_made", 0)],
  "tfl": ["defense", (st) => get(st, "tackles_for_loss", 0)],
  "pbu": ["defense", (st) => get(st, "passes_defended", 0)],
  "explosives": ["rushing", (st) => get(st, "explosive_runs", 0) + get(st, "explosive_catches", 0)],
  "punting": ["punting", (st) => (get(st, "punts", 0) >= 10 ? round(get(st, "punt_net_yards", 0) / st["punts"], 1) : 0)],
};

function player_leaders_view(state, team = null, n = 5, conference = null) {
  // Top n in each leader category, for one team, one conference or the league, with full stat lines.
  const teams = season.load_teams();
  const ss = season._season_stats(state);
  const rows = [];
  for (const [slug, t, info] of season._stat_teams(ss, teams, team, conference)) {
    for (const pl of Object.values(t["players"])) {
      rows.push({ name: pl["name"], position: pl["position"], unit: pl["unit"], team: slug, team_name: info["name"],
        games: pl["games"], stats: pl["stats"] });
    }
  }
  const out = {};
  for (const [cat, [table, value]] of Object.entries(season.LEADER_KEYS)) {
    let keys = season.PLAYER_CATEGORIES[table][1];
    if (cat === "touchdowns" || cat === "explosives") {
      keys = sorted(new Set([...season.PLAYER_CATEGORIES["rushing"][1], ...season.PLAYER_CATEGORIES["receiving"][1]]));
    }
    const ranked = sorted(rows.filter((r) => value(r["stats"]) > 0), (r) => [-value(r["stats"]), r["name"]]).slice(0, n);
    out[cat] = ranked.map((r) => {
      const stats = {};
      for (const k of keys) stats[k] = get(r["stats"], k, 0);
      return { ...r, stats, value: value(r["stats"]) };
    });
  }
  return { team, conference, leaders: out, partial: truthy(get(state, "season_stats_partial")) };
}

function week_dates(state) {
  // {week: {"start", "end", "main"}} as ISO dates in US time. Regular-season weeks span
  // their first and last game, with the Saturday (the busiest day) as the main date; the
  // postseason weeks follow the 2026-27 calendar. Week 0 is the preseason.
  const by_week = new Map();
  for (const g of Object.values(state["games"])) {
    const d = get(g, "date") || "";
    if (d.length >= 10 && d[4] === "-") {
      const at = _fromisoformat(d.replaceAll("Z", "+00:00"));
      if (at === null) continue;
      const local = at - 6 * 3600000;
      if (!by_week.has(g["week"])) by_week.set(g["week"], []);
      by_week.get(g["week"]).push(_ymd(local));
    }
  }
  const post = season.POSTSEASON_DATES instanceof Map ? Object.fromEntries(season.POSTSEASON_DATES) : season.POSTSEASON_DATES;
  const out = {};
  const weeks = sorted(new Set([...by_week.keys(), ...Object.keys(post).map(Number)]));
  for (const w of weeks) {
    if (has(post, w)) {
      const [start, end] = post[w];
      out[w] = { start, end, main: end };
    } else {
      const ds = sorted(by_week.get(w));
      const saturdays = ds.filter((d) => new Date(_fromisoformat(d)).getUTCDay() === 6);
      // no Saturday: the day with the most games (of equals, the earliest)
      const count = (d) => ds.filter((x) => x === d).length;
      out[w] = { start: ds[0], end: ds[ds.length - 1], main: saturdays.length ? saturdays[0] : maxBy(new Set(ds), count) };
    }
  }
  const first = get(get(out, 1, {}), "start");
  if (truthy(first)) {
    const eve = _ymd(_fromisoformat(first) - DAY_MS);
    out[0] = { start: null, end: eve, main: eve };
  }
  return out;
}

// ----- your schedule: trading non-conference games before the season ----------------------------

season.ScheduleError = class ScheduleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ScheduleError";
    this.code = code;
  }
};

season.SCHEDULE_DRAW = 8;                 // the other school says yes when it gets the home game, or you rate within this of it (attractiveness)

function schedule_editable(state) {
  // Your non-conference regular-season games you can still trade: before week 1 of a career.
  const me = get(state, "team");
  if (!truthy(get(state, "career")) || get(state, "current_week", 0) > 0 || !truthy(me)) return [];
  return sorted(Object.values(state["games"]).filter((g) => g["kind"] === "regular" && !truthy(g["conference_game"]) && !truthy(g["played"])
    && (me === g["home"] || me === g["away"])), (g) => g["week"]);
}

function _other_game(state, slug, week, skip) {
  for (const g of Object.values(state["games"])) {
    if (g["kind"] === "regular" && g["week"] === week && g["event_id"] !== skip && (slug === g["home"] || slug === g["away"])) return g;
  }
  return null;
}

function _fcs_picker_names(teams) {
  // slug -> how a stand-in is named in a picker: its region label, never its own name;
  // stand-ins that share a label get "· A", "· B" by slug order.
  const by_label = {};
  for (const slug of sorted(Object.entries(teams).filter(([, t]) => truthy(get(t, "fictional"))).map(([s]) => s))) {
    const label = season.fcs_label(slug);
    if (!has(by_label, label)) by_label[label] = [];
    by_label[label].push(slug);
  }
  const out = {};
  for (const [label, slugs] of Object.entries(by_label)) {
    slugs.forEach((slug, i) => {
      out[slug] = slugs.length === 1 ? label : `${label} · ${String.fromCharCode("A".charCodeAt(0) + i)}`;
    });
  }
  return out;
}

function schedule_options(state, event_id, teams = null) {
  // Who could take the other side of one of your non-conference games: FBS teams with a
  // non-conference game that week (the two displaced opponents would play each other), each
  // with whether the school agrees and why; for an FCS date, the FCS teams (they always come).
  const programs = modules.programs;
  const g = get(state["games"], event_id);
  const mine = new Set(season.schedule_editable(state).map((x) => x["event_id"]));
  if (!truthy(g) || !mine.has(event_id)) throw new season.ScheduleError(409, "that game cannot be traded now");
  const me = state["team"];
  teams = truthy(teams) ? teams : season.load_teams();           // the offseason's Edit Schedule passes next year's (conferences as moved)
  const opp = g["away"] === me ? g["home"] : g["away"];
  const venue = truthy(g["neutral"]) ? "neutral" : g["home"] === me ? "home" : "away";
  const fcs = truthy(get(teams[opp], "fictional"));
  const rivals = season.load_rivalries();
  const fcs_names = fcs ? season._fcs_picker_names(teams) : {};
  const out = [];
  for (const [slug, t] of Object.entries(teams)) {
    if (slug === me || slug === opp || truthy(get(t, "fictional")) !== fcs) continue;
    if (fcs) {
      out.push({ slug, name: fcs_names[slug], conference: "FCS", standing: "FCS", accepts: true,
        venue: "home", why: "An FCS team comes to you" });
      continue;
    }
    const other = season._other_game(state, slug, g["week"], event_id);
    if (!truthy(other) || truthy(other["conference_game"]) || truthy(other["played"])
        || truthy(get(teams[other["away"] === slug ? other["home"] : other["away"]], "fictional"))) {
      continue;                                   // busy with a conference game, a bye, or hosting an FCS team that week
    }
    if (has(rivals, _fs([slug, other["away"] === slug ? other["home"] : other["away"]])) || has(rivals, _fs([me, slug]))) continue;
    const theirs = venue === "away" ? "home" : venue === "home" ? "away" : "neutral";
    const gap = programs.attract(state, me) - programs.attract(state, slug);
    const accepts = theirs === "home" || gap >= -season.SCHEDULE_DRAW;
    const why = theirs === "home" ? "They Get the Home Game" : gap > season.SCHEDULE_DRAW ? "A Bigger Draw Than Them"
      : accepts ? "A Fair Trade" : "They Want the Home Game";
    out.push({ slug, name: t["name"], conference: t["conference"], standing: programs.TIER_NAMES[programs.get(state, slug)["tier"]],
      accepts, venue, why, displaced: other["away"] === slug ? other["home"] : other["away"] });
  }
  const key = (o) => [!o["accepts"], !fcs ? -programs.get(state, o["slug"])["rating"] : 0, o["name"]];
  // (the key is worked out once per row, in the rows' order)
  const keyed = out.map((o) => [key(o), o]);
  keyed.sort((a, b) => cmp(a[0], b[0]));
  return keyed.map((p) => p[1]);
}

function schedule_swap(state, event_id, slug, teams = null) {
  // Trade one of your non-conference games for `slug`'s that week: you play them at your old
  // venue, your old opponent plays theirs in their old game.
  const opts = {};
  for (const o of season.schedule_options(state, event_id, teams)) opts[o["slug"]] = o;
  const o = get(opts, slug);
  if (o === null) throw new season.ScheduleError(409, "that school is not available that week");
  if (!o["accepts"]) throw new season.ScheduleError(409, `${o["name"]} said no: ${o["why"][0].toLowerCase()}${o["why"].slice(1)}`);
  const g = state["games"][event_id];
  const me = state["team"];
  teams = truthy(teams) ? teams : season.load_teams();
  const old = g["away"] === me ? g["home"] : g["away"];
  if (o["venue"] === "home" || (truthy(g["neutral"]) && g["home"] === me)) {
    g["home"] = me; g["away"] = slug;
  } else {
    g["home"] = slug; g["away"] = me;
  }
  const home_display = season.team_display(g["home"], teams), away_display = season.team_display(g["away"], teams);
  g["home_display"] = home_display; g["away_display"] = away_display;
  if (!truthy(get(teams[slug], "fictional"))) {                 // their old game: your old opponent takes their place
    const other = season._other_game(state, slug, g["week"], event_id);
    if (other["home"] === slug) other["home"] = old;
    else other["away"] = old;
    const oh = season.team_display(other["home"], teams), oa = season.team_display(other["away"], teams);
    other["home_display"] = oh; other["away_display"] = oa;
    other["conference_game"] = teams[other["home"]]["conference"] === teams[other["away"]]["conference"] && !truthy(get(teams[other["home"]], "fictional"));
  }
  if (!has(state, "schedule_changes")) state["schedule_changes"] = [];
  state["schedule_changes"].push({ week: g["week"], from: old, to: slug, venue: o["venue"], event_id });
  return g;
}

function _movable(g) {
  // A game whose week can change: a regular-season game not yet played, outside the rivalry finale's weekend and
  // Army-Navy's (those dates are the game's own).
  const schedule_gen = modules.schedule_gen;
  return get(g, "kind") === "regular" && !truthy(g["played"]) && g["week"] < schedule_gen.FINALE_WEEK;
}

function schedule_moves(state, teams = null) {
  // Your games that can move to another week, and where: event id -> [{"week", "swap": the event id of your game
  // that week (it takes this game's week) or None when that week is your bye, "swap_name": that game's opponent}].
  // A move needs every team in it to be idle on its new Saturday: your opponent on the week you move to, and, when
  // you already play that week, that game's opponent on the week you leave. An FCS stand-in is always free.
  const schedule_gen = modules.schedule_gen;
  teams = truthy(teams) ? teams : season.load_teams();
  const me = state["team"];
  const at = (t, w) => `${t}${SEP}${w}`;                        // the (team, week) pair as a key
  const busy = new Map();
  for (const g of Object.values(state["games"])) {
    for (const t of [g["home"], g["away"]]) {
      if (!truthy(get(get(teams, t, {}), "fictional"))) busy.set(at(t, g["week"]), g);
    }
  }
  const free = (t, w) => truthy(get(get(teams, t, {}), "fictional")) || !busy.has(at(t, w));
  const other = (g) => (g["home"] === me ? g["away"] : g["home"]);
  const out = {};
  for (const g of sorted(Object.values(state["games"]).filter((g) => (me === g["home"] || me === g["away"]) && season._movable(g)), (g) => g["week"])) {
    const rows = [];
    for (let w = 1; w < schedule_gen.FINALE_WEEK; w++) {
      if (w === g["week"] || !free(other(g), w)) continue;
      const there = busy.has(at(me, w)) ? busy.get(at(me, w)) : null;
      if (there === null) {
        rows.push({ week: w, swap: null, swap_name: null });
      } else if (season._movable(there) && free(other(there), g["week"])) {
        rows.push({ week: w, swap: there["event_id"], swap_name: season.team_display(other(there), teams) });
      }
    }
    if (rows.length) out[g["event_id"]] = rows;
  }
  return out;
}

function schedule_move(state, event_id, week, teams = null) {
  // Move one of your games to `week`: into your bye, or trading weeks with the game you play then (schedule_moves
  // lists what is possible). Each game keeps its teams and its site; only its Saturday changes.
  const pick = get(season.schedule_moves(state, teams), event_id, []).find((r) => r["week"] === week) ?? null;
  if (pick === null) throw new season.ScheduleError(409, "That game cannot move to that week: someone in it already plays then.");
  const g = state["games"][event_id];
  const was = g["week"];

  const shift = (x, to) => {
    // (a game without a kickoff time, or with one in another shape, keeps what it has)
    const d = typeof x["date"] === "string" ? _strptime_kickoff(x["date"]) : null;
    if (d !== null) x["date"] = new Date(d + DAY_MS * 7 * (to - x["week"])).toISOString().slice(0, 16) + "Z";
    x["week"] = to;
  };

  if (truthy(pick["swap"])) shift(state["games"][pick["swap"]], was);
  shift(g, week);               // not logged in schedule_changes: that list is the trades (old opponent, new opponent)
  return g;
}

// ----- rivalries: trophies and the all-time series -----------------------------------

season.RIVALRIES_FILE = "data/rivalries.json";
// The key for a pair of slugs is the two sorted and joined (`_fs`), so a lookup by either order finds the rivalry.
// "__as_of__" sits beside them.
season._rivalry_cache = {};

function load_rivalries() {
  // Pair of slugs -> rivalry (name, trophy, base series), from data/rivalries.json.
  if (!Object.keys(season._rivalry_cache).length) {
    const data = read_json(season.RIVALRIES_FILE);
    for (const r of data["rivalries"]) season._rivalry_cache[_fs(r["teams"])] = r;
    season._rivalry_cache["__as_of__"] = get(data, "as_of", "");
  }
  return season._rivalry_cache;
}

function rivalry_for(a, b, state = null) {
  // The rivalry between two teams: a career's own named rivalries first (a league file's, from Custom Programs), then
  // the game's (data/rivalries.json).
  for (const r of get(get(state || {}, "league") || {}, "rivalries") || []) {
    if (_fs(get(r, "teams") || []) === _fs([a, b])) return r;
  }
  return get(season.load_rivalries(), _fs([a, b]));
}

function rivalry_series(state, riv, before_week = null, teams = null) {
  // The series entering `before_week` (or today): the base record plus this season's
  // games between the two. Says who leads, by how much, and who won the last meeting.
  teams = truthy(teams) ? teams : season.load_teams();
  const [a, b] = riv["teams"];
  const wins = { [a]: get(riv["series"], a, 0), [b]: get(riv["series"], b, 0) };
  let ties = get(riv["series"], "ties", 0);
  let last = null;
  const pair = _fs([a, b]);
  for (const g of sorted(Object.values(state["games"]).filter((g) => _fs([g["home"], g["away"]]) === pair && truthy(g["played"])), (g) => g["week"])) {
    if (before_week !== null && g["week"] >= before_week) break;
    if (g["home_score"] === g["away_score"]) {
      ties += 1;
      continue;
    }
    const winner = season._winner(g);
    wins[winner] += 1;
    last = { winner, week: g["week"], event_id: g["event_id"],
      score: `${Math.max(g["home_score"], g["away_score"])}–${Math.min(g["home_score"], g["away_score"])}` };
  }
  let lead;
  if (wins[a] > wins[b]) lead = a;
  else if (wins[b] > wins[a]) lead = b;
  else lead = null;
  let text;
  if (lead === null && !truthy(wins[a]) && !truthy(ties)) {
    text = "First Meeting";                   // a new rivalry (a custom program's) before its first game
  } else if (lead === null) {
    text = `Series Tied ${wins[a]}-${wins[b]}` + (truthy(ties) ? `-${ties}` : "");
  } else {
    const other = lead === a ? b : a;
    text = `${teams[lead]["name"]} Leads ${wins[lead]}-${wins[other]}` + (truthy(ties) ? `-${ties}` : "");
  }
  return { wins, ties, leader: lead, text, last };
}

function game_rivalry(state, g, after = false) {
  // The rivalry line for one game: the trophy and the series entering it (or, with
  // `after`, including it, with who takes or keeps the trophy).
  const riv = season.rivalry_for(g["home"], g["away"], state);
  if (riv === null) return null;
  const teams = season.load_teams();
  const series = season.rivalry_series(state, riv, truthy(after) ? null : g["week"], teams);
  const out = { name: riv["name"], trophy: get(riv, "trophy") || "", series: series["text"], leader: series["leader"] };
  if (truthy(after) && truthy(g["played"]) && g["home_score"] !== g["away_score"]) {
    const winner = season._winner(g);
    const loser = winner === g["home"] ? g["away"] : g["home"];
    const before = season.rivalry_series(state, riv, g["week"], teams);
    const kept = truthy(before["last"]) && before["last"]["winner"] === winner;
    // the trophy by name: no "the" before one that has its own or is a name ("The Belt", "Paul Bunyan's Axe",
    // "Floyd of Rosedale"); no trophy is "bragging rights"; who held it is known only from a meeting this season, so
    // the first one "wins" it, never "takes it from"
    const trophy = get(riv, "trophy") || "";
    const bare = trophy.startsWith("The ") ? trophy.slice(4) : trophy;
    const thing = trophy ? ((bare.includes("'s ") || bare.includes(" of ") || _in(bare, season.NO_ARTICLE_TROPHIES)) ? bare : `the ${bare}`) : "bragging rights";
    const verb = kept ? "keeps" : truthy(before["last"]) ? "takes" : "wins";
    out["headline"] = `${teams[winner]["name"]} ${verb} ${thing}` + (verb === "takes" && trophy ? ` from ${teams[loser]["name"]}` : "");
  }
  return out;
}

function _file_rivalries(state, slug, teams) {
  // The rivalries a league file lists for a team it adds (league.team_meta's "rivals"; the file may also list the
  // new team among a game team's rivals): no trophy and no series before this season. A pair of the game's own
  // teams is never one, even when the file edits either of them (league_fill gives an edited team a "meta" too):
  // their rivalries stay the game's. None for the built-in league.
  // Each is [pair (the slugs, each once), rivalry].
  const league = modules.league;
  const lgd = get(state, "league") || {};
  const own = new Set(Object.entries(get(lgd, "teams") || {}).filter(([, t]) => get(t, "meta") !== null).map(([s]) => s));
  if (!own.size) return [];
  const base = new Set(league.base_slugs());
  const opps = own.has(slug) ? new Set(get(league.team_meta(lgd, slug), "rivals") || []) : new Set();
  for (const s of own) {
    if ((get(league.team_meta(lgd, s), "rivals") || []).includes(slug)) opps.add(s);
  }
  const out = [];
  for (const opp of sorted(opps)) {
    const pair = [...new Set([slug, opp])];
    if (pair.every((x) => base.has(x))) continue;                     // two of the game's teams: the game's rivalries file decides
    if (opp === slug || !has(teams, opp) || truthy(get(teams[opp], "fictional")) || has(season.load_rivalries(), _fs(pair))) continue;
    const [a, b] = sorted(pair, (x) => teams[x]["name"]);
    out.push([pair, { name: `${teams[a]["name"]} vs. ${teams[b]["name"]}`, teams: [a, b], series: {} }]);
  }
  return out;
}

function rivalries_view(state, slug) {
  // Your rivals this season: the trophy, the series today and this season's meeting.
  season.check_fbs(slug);
  const teams = season.load_teams();
  const out = [];
  // (the cache's own entries first, each key back as its pair; "__as_of__" is the one key that is not a pair)
  const entries = Object.entries(season.load_rivalries()).map(([k, riv]) => [k === "__as_of__" ? null : k.split(SEP), riv]);
  for (const [pair, riv] of entries.concat(season._file_rivalries(state, slug, teams))) {
    if (pair === null || !pair.includes(slug)) continue;
    const opp = pair.find((t) => t !== slug);
    if (opp === undefined) throw new Error("StopIteration");          // a team listed as its own rival
    if (!has(teams, opp)) continue;
    const series = season.rivalry_series(state, riv, null, teams);
    const key = _fs(pair);
    const game = Object.values(state["games"]).find((g) => _fs([g["home"], g["away"]]) === key) ?? null;
    let this_ = null;
    if (game !== null) {
      const home = game["home"] === slug;
      const [pf, pa] = truthy(game["played"]) ? season._scores_for(game, home) : [null, null];
      this_ = { week: game["week"], played: game["played"], event_id: game["event_id"], venue: season._venue(game, home),
        won: truthy(game["played"]) ? ((game["home_score"] > game["away_score"]) === home) : null,
        points_for: pf, points_against: pa, has_box: season.has_box(state, game) };
    }
    out.push({ name: riv["name"], trophy: get(riv, "trophy") || "", opponent: opp, opponent_name: teams[opp]["name"],
      series: series["text"], leader: series["leader"], my_wins: series["wins"][slug], their_wins: series["wins"][opp], ties: series["ties"],
      holder: truthy(series["last"]) ? series["last"]["winner"] : null, game: this_ });
  }
  out.sort((a, b) => cmp([a["game"] === null, a["game"] ? a["game"]["week"] : 99], [b["game"] === null, b["game"] ? b["game"]["week"] : 99]));
  return { team: slug, as_of: get(season.load_rivalries(), "__as_of__", ""), rivalries: out };
}

function team_schedule(state, slug) {
  // One team's season, game by game, with byes: the Team Schedule tab.
  const my_games = sorted(Object.values(state["games"]).filter((g) => slug === g["home"] || slug === g["away"]),
    (g) => [g["week"], g["date"] || ""]);
  const schedule = [];
  const all_rec = season._records(state, undefined, true);
  const ap_cache = new Map();

  const ap_before = (week) => {
    if (!ap_cache.has(week)) ap_cache.set(week, season.rank_map(state, week - 1));
    return ap_cache.get(week);
  };

  for (const g of my_games) {
    const home = g["home"] === slug;
    const opp = home ? g["away"] : g["home"];
    const ap = ap_before(g["week"]);
    const [pf, pa] = truthy(g["played"]) ? season._scores_for(g, home) : [null, null];
    schedule.push({ event_id: g["event_id"], week: g["week"], kind: g["kind"], title: get(g, "title"), site: get(g, "site"),
      opponent: opp, opponent_name: home ? g["away_display"] : g["home_display"],
      opponent_rank: get(ap, opp), my_rank: get(ap, slug),
      conference_game: truthy(get(g, "conference_game")) && g["kind"] === "regular",
      my_ratings: season._unit_overalls(state, slug), opponent_ratings: season._unit_overalls(state, opp),
      opponent_conf_record: (has(all_rec, opp) && !truthy(get(get(season.load_teams(), opp, {}), "fictional"))
        ? `${get(all_rec[opp], "conf_wins", 0)}-${get(all_rec[opp], "conf_losses", 0)}` : null),
      venue: season._venue(g, home), played: g["played"],
      won: truthy(g["played"]) ? (g["home_score"] > g["away_score"]) === home : null,
      points_for: pf, points_against: pa,
      overtime: g["overtime"], real: g["real"], has_box: season.has_box(state, g),
      opponent_record: truthy(get(get(season.load_teams(), opp, {}), "fictional")) ? "" : season._record_str(all_rec[opp]), date: get(g, "date"),
      rivalry: season.game_rivalry(state, g, g["played"]) });   // a played game: the series with it
  }
  const played_weeks = new Set(schedule.map((g) => g["week"]));
  for (let w = 1; w < season.LAST_REGULAR_WEEK + 1; w++) {
    if (!played_weeks.has(w)) {
      schedule.push({ event_id: null, week: w, kind: "bye", title: null, site: null, opponent: null, opponent_name: "Bye",
        opponent_rank: null, my_rank: get(ap_before(w), slug), venue: null, played: w <= state["current_week"],
        won: null, points_for: null, points_against: null, overtime: 0, real: false, has_box: false,
        opponent_record: null, date: null });
    }
  }
  schedule.sort((a, b) => cmp([a["week"], a["date"] || ""], [b["week"], b["date"] || ""]));
  return schedule;
}

Object.assign(season, {
  rank_map, _wl_pct, resume, current_rank, week_view, _add_into, _accumulate_stats, _season_stats, team_stats_view,
  _stat_teams, player_stats_view, player_leaders_view, week_dates, schedule_editable, _other_game, _fcs_picker_names,
  schedule_options, schedule_swap, _movable, schedule_moves, schedule_move, load_rivalries, rivalry_for, rivalry_series,
  game_rivalry, _file_rivalries, rivalries_view, team_schedule,
});
