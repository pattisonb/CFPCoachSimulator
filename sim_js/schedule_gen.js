// Schedules for the seasons after 2026 (docs/superpowers/specs/2026-10-26... see
// docs/superpowers/specs/2026-10-27-future-schedules-design.md).
//
// `generate(year, teams, history, rng)` builds a season's games the way the conferences do:
// protected rivals every year, the other league opponents rotated so every pair meets home
// and away within the conference's cycle and never at the same site two years running, league
// home games alternating 5/4, non-conference slots filled by tier (a Power team's Power
// opponent and its one FCS game, a Group of Five team's Power pay game, FCS game and
// home-and-homes), the series schools have announced for the year, annual rivalries with their
// finales on Thanksgiving weekend, and Army-Navy on selection weekend. The history (who met whom,
// who hosted, which home-and-homes owe a return) lives on the career's league and is seeded from
// the 2026 schedule, so 2027 returns the 2026 games' sites.
//
// The rules are data: data/schedule_rules.json (each conference) and data/series.json (annual
// series and announced games).
//
// Ported from sim/schedule_gen.py by engine_js/PORTING.md's rules. What is written differently, the same way all
// through the file:
// - a pair of teams (a Python tuple) is a two-item array, and "is this pair in that list" (`p in required`,
//   `edges.remove((c, d))`) is asked by `has_pair` / `remove_pair`, which compare the two names;
// - a set of pairs (`neutral_pairs`, `fixed`) is a Set of the pair's text "a|b" (pair_text), and a dict or set keyed
//   by (team, week) is keyed by the text "team|week" (slot_key);
// - `id(g)` (which game is this) is the game object itself in a Set or a Map;
// - a team's games by week (`by_week[s]`, whole-number keys, walked) is a Map, which keeps the order weeks were
//   added in as a Python dict does;
// - a sort whose key draws a random number is `sorted(...)` from pyrt.js (one key, so one draw, per item, in the
//   list's order, as Python's sort does), never Array.sort with a comparison (which would draw again and again).
import { Random, sum, sorted, cmp, maxBy, minBy, get, truthy, mod, floordiv, range, odict } from "../engine_js/pyrt.js";
import { read_json } from "../engine_js/files.js";
import { modules } from "../engine_js/modules.js";

// sim/schedule_gen.py's namespace: its constants live here and are read from here (a caller may tune one).
export const schedule_gen = {};

schedule_gen.ROOT = ".";
schedule_gen.RULES_FILE = "data/schedule_rules.json";
schedule_gen.SERIES_FILE = "data/series.json";

schedule_gen.GAMES = 12;                    // every FBS team's regular season
schedule_gen.LAST_WEEK = 14;                // the regular season's Saturdays (season.LAST_REGULAR_WEEK)
schedule_gen.FINALE_WEEK = 14;              // Thanksgiving weekend: the rivalry finales
schedule_gen.ARMY_NAVY_WEEK = 16;           // selection weekend (season.SELECTION_WEEK)
schedule_gen.NONCONF_WEEKS = [1, 2, 3, 4];  // where non-conference games go first
schedule_gen.WEEK0 = 1;                     // engine week 1 is the calendar's Week 0: a handful of games the Saturday before Labor Day
schedule_gen.WEEK0_GAMES = 8;               // *tune*: about how many games stay in Week 0 (set-week openers first; the rest move to a shared bye)
schedule_gen.LATE_FCS_WEEKS = [11, 12, 13]; // a Power team's late FCS tune-up
schedule_gen.HISTORY_KEEP = 10;             // meetings kept per pair
schedule_gen.SECOND_POWER_ROAD = 0.35;      // a Group of Five team's chance of a second Power pay game
schedule_gen.POWER_FCS_CHANCE = 0.85;       // a Power team's chance of using its FCS game
schedule_gen.RESTARTS = 60;                 // attempts at a league slate or a week grid before giving up on a seed

// the eight fictional FCS stand-ins' states, and which states they serve (teams/fcs_map.json keeps the real schools' map)
schedule_gen.REGION_OF_STATE = {
  ME: "ME", NH: "ME", VT: "ME", MA: "ME", RI: "ME", CT: "ME", NY: "ME", NJ: "ME",
  PA: "PA", MD: "PA", DE: "PA", DC: "PA", VA: "PA", WV: "PA", OH: "PA",
  SC: "SC", NC: "SC", GA: "SC", FL: "SC", AL: "SC", TN: "SC", KY: "SC", MS: "SC",
  MI: "MI", IN: "MI", IL: "MI", WI: "MI", MN: "MI", IA: "MI", MO: "MI",
  NE: "NE", KS: "NE", ND: "NE", SD: "NE", OK: "NE", AR: "NE", LA: "NE",
  TX: "TX", NM: "TX",
  CO: "CO", UT: "CO", WY: "CO", ID: "CO", MT: "CO", AZ: "CO", NV: "CO",
  WA: "WA", OR: "WA", CA: "WA", HI: "WA", AK: "WA",
};

export class ScheduleError extends Error {}

// ---- what Python has built in ----------------------------------------------------------------------------------
/** `k in d` for a dict. */
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/** sorted((a, b)) for two names. */
const sorted_pair = (a, b) => (cmp(b, a) < 0 ? [b, a] : [a, b]);
/** The text a set of pairs holds for the pair (a, b), in the order given. */
const pair_text = (p) => `${p[0]}|${p[1]}`;
/** `(a, b) in pairs` for a list of pairs. */
const has_pair = (pairs, a, b) => pairs.some((p) => p[0] === a && p[1] === b);
/** `pairs.remove((a, b))`: the first one. */
function remove_pair(pairs, a, b) {
  const i = pairs.findIndex((p) => p[0] === a && p[1] === b);
  if (i === -1) throw new Error("list.remove(x): x not in list");
  pairs.splice(i, 1);
}
/** The key of a (team, week) pair. */
const slot_key = (s, w) => `${s}|${w}`;
/** `{a, b} == {x, y}` for sets of two. */
const same_two = (a, b, x, y) => (a === x && b === y) || (a === y && b === x);
/** repr of a list of names, as an f-string shows it: ['a', 'b']. */
const list_repr = (xs) => `[${xs.map((s) => `'${s}'`).join(", ")}]`;
const NO_WEEKS = new Set();

export function rules() {
  return read_json(schedule_gen.RULES_FILE);
}

export function series() {
  return read_json(schedule_gen.SERIES_FILE);
}

export function pair_key(a, b) {
  return sorted_pair(a, b).join("|");
}

// ----- history -----------------------------------------------------------------------------------

export function seed_history(teams, schedules = null) {
  // A career's scheduling history from the 2026 schedule: every meeting and its host, and
  // league home-game counts. `schedules` is data/schedules.json (loaded when not given).
  let counterparts;
  if (schedules === null || schedules === undefined) {
    const season = modules.season;
    schedules = read_json(season.SCHEDULES_FILE);
    counterparts = season.fcs_map(schedules, teams);
  } else {
    counterparts = {};
  }
  const hist = { pairs: {}, home_conf: {}, pending: [], years: [2026] };
  for (const g of schedules["games"]) {
    const home = get(g, "home_slug") || get(counterparts, get(g, "home_espn"));
    const away = get(g, "away_slug") || get(counterparts, get(g, "away_espn"));
    if (!truthy(home) || !truthy(away) || !own(teams, home) || !own(teams, away)) continue;
    schedule_gen._record(hist, 2026, home, away, truthy(get(g, "neutral")));
    if (teams[home]["conference"] === teams[away]["conference"] && !truthy(teams[home]["fictional"]) && !truthy(get(g, "neutral"))) {
      const n = get(get(hist["home_conf"], home, {}), "2026", 0) + 1;
      if (!own(hist["home_conf"], home)) hist["home_conf"][home] = {};
      hist["home_conf"][home]["2026"] = n;
    }
  }
  return hist;
}

export function _record(hist, year, home, away, neutral) {
  const key = schedule_gen.pair_key(home, away);
  if (!own(hist["pairs"], key)) hist["pairs"][key] = [];
  const met = hist["pairs"][key];
  met.push({ year, home, neutral });
  if (met.length > schedule_gen.HISTORY_KEEP) met.splice(0, met.length - schedule_gen.HISTORY_KEEP);
}

export function last_meeting(hist, a, b) {
  const met = get(hist["pairs"], schedule_gen.pair_key(a, b));
  return truthy(met) ? met[met.length - 1] : null;
}

export function _last_year(hist, a, b) {
  const m = schedule_gen.last_meeting(hist, a, b);
  return truthy(m) ? m["year"] : 0;
}

export function _site_from_history(hist, a, b, rng, deficit = null, year = null) {
  // (home, away): the team that traveled last time hosts; a first meeting, or (with `year`) a
  // non-conference pair that last met before last year, goes to the team further below its
  // home-game target this year (`deficit(team)`), else a coin flip.
  const m = schedule_gen.last_meeting(hist, a, b);
  if (truthy(m) && !truthy(get(m, "neutral")) && !(deficit != null && year != null && m["year"] < year - 1 && deficit(a) !== deficit(b))) {
    return m["home"] === a ? [b, a] : [a, b];
  }
  if (deficit != null) {
    const da = deficit(a), db = deficit(b);
    if (da !== db) return da > db ? [a, b] : [b, a];
  }
  return rng.random() < 0.5 ? [a, b] : [b, a];
}

export function empty_history() {
  // A history with no meetings: a season one built from a league file's conferences (nothing to return).
  return { pairs: {}, home_conf: {}, pending: [], years: [] };
}

// ----- the season ----------------------------------------------------------------------------------

export function generate(year, teams, history, rng, rules_override = null) {
  // The season's games (season.new_season's records, keyed by event id) and the history
  // carried forward. Raises ScheduleError when no slate satisfies the rules for this seed.
  // `rules_override` (a league file's, league_file.schedule_rules): "conferences" by name over the
  // built-in ones, and "annual" series played after the built-in ones. Power status never changes.
  const override = truthy(rules_override) ? rules_override : {};
  const hist = truthy(history) ? JSON.parse(JSON.stringify(history)) : schedule_gen.seed_history(teams);
  const fbs = {};
  for (const [s, t] of Object.entries(teams)) if (!truthy(get(t, "fictional"))) fbs[s] = t;
  const fcs = Object.keys(teams).filter((s) => truthy(get(teams[s], "fictional")));
  const conf_of = {};
  for (const [s, t] of Object.entries(fbs)) conf_of[s] = t["conference"];
  const R = schedule_gen.rules();
  const override_confs = get(override, "conferences");
  const confs = { ...R["conferences"], ...(truthy(override_confs) ? override_confs : {}) };
  const power_confs = new Set(R["power"]);
  const is_power = (s) => power_confs.has(get(conf_of, s)) || R["power_independents"].includes(s);
  const games = [];       // {home, away, neutral, week (or None), title, kind: fixed|conf|nonconf|fcs}
  const played_pairs = new Set();
  const count = {}, nonconf_power = {}, fcs_games = {}, home_total = {};
  for (const s of Object.keys(fbs)) { count[s] = 0; nonconf_power[s] = 0; fcs_games[s] = 0; home_total[s] = 0; }   // nonconf_power: Power opponents on the slate (Notre Dame counts)
  const pending_next = [];

  function add(home, away, neutral = false, week = null, title = "", kind = "nonconf", site = "") {
    const key = schedule_gen.pair_key(home, away);
    if (played_pairs.has(key)) throw new ScheduleError(`${home} and ${away} twice in ${year}`);
    played_pairs.add(key);
    const g = { home, away, neutral, week, title, kind, site };
    games.push(g);
    for (const s of [home, away]) if (own(count, s)) count[s] += 1;
    if (!neutral && own(home_total, home)) home_total[home] += 1;
    if (own(fbs, away) && own(fbs, home) && conf_of[home] !== conf_of[away]) {
      if (is_power(away)) nonconf_power[home] += 1;
      if (is_power(home)) nonconf_power[away] += 1;
    }
    if (fcs.includes(home) || fcs.includes(away)) fcs_games[fcs.includes(home) ? away : home] += 1;
    return g;
  }

  function remove(g) {
    // Undo `add` for a game not yet given a week (a stranded team takes over an FCS date).
    const i = games.indexOf(g);          // (Python's list.remove takes the first equal game: no two games share their teams)
    if (i === -1) throw new Error("list.remove(x): x not in list");
    games.splice(i, 1);
    played_pairs.delete(schedule_gen.pair_key(g["home"], g["away"]));
    for (const s of [g["home"], g["away"]]) if (own(count, s)) count[s] -= 1;
    if (!g["neutral"] && own(home_total, g["home"])) home_total[g["home"]] -= 1;
    if (own(fbs, g["home"]) && own(fbs, g["away"]) && conf_of[g["home"]] !== conf_of[g["away"]]) {
      if (is_power(g["away"])) nonconf_power[g["home"]] -= 1;
      if (is_power(g["home"])) nonconf_power[g["away"]] -= 1;
    }
    if (fcs.includes(g["home"]) || fcs.includes(g["away"])) fcs_games[fcs.includes(g["home"]) ? g["away"] : g["home"]] -= 1;
  }

  // 1. the games already on the books: announced series, returns owed, annual series, Notre Dame's slate
  const booked = played_pairs;
  const league_k = {};
  for (const [conf, members] of Object.entries(schedule_gen._by_conference(fbs))) {
    const rule = get(confs, conf);
    for (const s of members) league_k[s] = truthy(rule) ? schedule_gen._league_games(rule, year) : 0;
  }
  const room = (s) => count[s] < schedule_gen.GAMES - get(league_k, s, 0);       // non-conference room left before the league slate
  const extra_annual = get(override, "annual");
  schedule_gen._fixed_games(year, fbs, hist, rng, add, is_power, booked, room, () => games, truthy(extra_annual) ? extra_annual : []);
  // 2. every conference's league slate
  for (const [conf, members] of Object.entries(schedule_gen._by_conference(fbs))) {
    const rule = get(confs, conf);
    if (rule === null) continue;
    schedule_gen._conference_slate(year, conf, rule, members, hist, rng, add, home_total, booked);
  }
  // 3. non-conference fill by tier
  schedule_gen._nonconference(year, fbs, fcs, hist, rng, add, is_power, count, nonconf_power, fcs_games, home_total, pending_next, teams, booked, games,
    remove, confs);
  const short = Object.keys(count).filter((s) => count[s] !== schedule_gen.GAMES);
  if (short.length) throw new ScheduleError(`${short.length} teams without ${schedule_gen.GAMES} games in ${year}: ${list_repr(short.slice(0, 6))}`);
  // 4. weeks
  schedule_gen._assign_weeks(games, fbs, rng, year);
  // 5. records and history
  // (an event id is "2027-03-home-away", never a whole number, but the season walks this dict: an odict keeps the
  // order whatever the ids look like)
  const out = odict();
  for (const g of games) {
    const rec = schedule_gen._record_for(g, year, teams, rng);
    out[rec["event_id"]] = rec;
    schedule_gen._record(hist, year, g["home"], g["away"], g["neutral"]);
  }
  const home_conf = {};
  for (const [s, n] of Object.entries(schedule_gen._home_conf_counts(games, conf_of))) home_conf[s] = { ...get(hist["home_conf"], s, {}), [String(year)]: n };
  hist["home_conf"] = home_conf;
  hist["pending"] = (get(hist, "pending") || []).filter((g) => g["year"] > year).concat(pending_next);
  const old_total = get(hist, "home_total") || {};
  const new_total = {};
  for (const [s, n] of Object.entries(home_total)) new_total[s] = { ...get(old_total, s, {}), [String(year)]: n };
  hist["home_total"] = new_total;
  hist["years"] = (get(hist, "years") || []).concat([year]);
  return [out, hist];
}

export function _by_conference(fbs) {
  const out = {};
  for (const [s, t] of Object.entries(fbs)) {
    if (!own(out, t["conference"])) out[t["conference"]] = [];
    out[t["conference"]].push(s);
  }
  const done = {};
  for (const [c, m] of Object.entries(out)) done[c] = sorted(m);
  return done;
}

// ----- fixed games ---------------------------------------------------------------------------------

export function _fixed_games(year, fbs, hist, rng, add, is_power, booked, room, games_so_far, extra_annual = []) {
  const S = schedule_gen.series();
  for (const s of [...S["annual"], ...extra_annual]) {   // annual series first (they outrank a new series), a league file's listed rivals last
    const [a, b] = s["teams"];
    if (!own(fbs, a) || !own(fbs, b)) continue;
    if ((truthy(get(s, "first")) && year < s["first"]) || (truthy(get(s, "last")) && year > s["last"])) continue;
    if (booked.has(schedule_gen.pair_key(a, b)) || !(room(a) && room(b))) continue;
    const neutral = truthy(get(s, "neutral"));
    const [home, away] = !neutral ? schedule_gen._site_from_history(hist, a, b, rng) : (mod(year, 2) ? [a, b] : [b, a]);
    const week = get(s, "week") === 16 ? schedule_gen.ARMY_NAVY_WEEK : (truthy(get(s, "finale")) ? schedule_gen.FINALE_WEEK : get(s, "week"));
    add(home, away, neutral, week, get(s, "name", ""), "fixed");
  }
  for (const g of get(hist, "pending") || []) {                  // the return leg of last year's home-and-home
    if (g["year"] === year && own(fbs, g["home"]) && own(fbs, g["away"]) && !booked.has(schedule_gen.pair_key(g["home"], g["away"]))
        && room(g["home"]) && room(g["away"])) {
      add(g["home"], g["away"], false, null, get(g, "title", ""), "fixed");
    }
  }
  for (const g of S["announced"]) {                              // announced series, while the teams have room for them
    if (g["year"] !== year || !own(fbs, g["home"]) || !own(fbs, g["away"]) || !(room(g["home"]) && room(g["away"]))) continue;
    if (booked.has(schedule_gen.pair_key(g["home"], g["away"]))) continue;
    add(g["home"], g["away"], truthy(get(g, "neutral")), get(g, "week"), get(g, "name", ""), "fixed", get(g, "site", ""));
  }
  // Notre Dame: five ACC opponents a year (the annual one plus the four met least recently), Navy and Stanford are annual
  const nd = "notre-dame";
  if (own(fbs, nd)) {
    const acc = Object.keys(fbs).filter((s) => fbs[s]["conference"] === "ACC");
    const want = get(get(schedule_gen.rules()["independents"], nd, {}), "acc_games", 5);
    let have = new Set(acc.filter((s) => booked.has(schedule_gen.pair_key(s, nd))));
    const annual_acc = () => get(schedule_gen.series(), "notre_dame_annual_acc", []);
    const pool = sorted(acc.filter((s) => !have.has(s) && !annual_acc().includes(s)), (s) => [schedule_gen._last_year(hist, nd, s), rng.random()]);
    for (const s of annual_acc()) {
      if (own(fbs, s) && !have.has(s) && room(s) && room(nd)) {
        const [home, away] = schedule_gen._site_from_history(hist, nd, s, rng);
        add(home, away, false, null, "", "fixed"); have.add(s);
      }
    }
    const acc_home = () => sum(games_so_far().filter((g) => g["home"] === nd && !g["neutral"] && acc.includes(g["away"])).map(() => 1));
    have = new Set(acc.filter((s) => booked.has(schedule_gen.pair_key(s, nd))));        // Stanford's annual game and Clemson's count among the five
    const host_target = 3 - mod(year, 2);                                   // two or three of the five at home, alternating
    for (const s of pool.filter((q) => room(q)).slice(0, Math.max(0, want - have.size))) {
      if (!room(nd)) break;
      const m = schedule_gen.last_meeting(hist, nd, s);
      let home, away;
      if (truthy(m) && !truthy(get(m, "neutral")) && m["year"] === year - 1) {
        [home, away] = m["home"] === nd ? [s, nd] : [nd, s];
      } else {
        [home, away] = acc_home() < host_target ? [nd, s] : [s, nd];
      }
      add(home, away, false, null, "", "fixed");
    }
  }
}

// ----- conference slates ---------------------------------------------------------------------------

export function _league_games(rule, year) {
  let n = rule["games"];
  for (const [y, k] of Object.entries(get(rule, "games_from") || {})) {
    if (year >= parseInt(y, 10)) n = k;
  }
  return n;
}

export function _conference_slate(year, conf, rule, members, hist, rng, add, home_total, booked) {
  const k = schedule_gen._league_games(rule, year);
  const need = {};
  for (const s of members) need[s] = k;
  const eight = get(get(rule, "eight_game_team") || {}, String(year));
  if (eight !== null && own(need, eight)) need[eight] = k - 1;
  if (mod(sum(Object.values(need)), 2)) {                             // thirteen teams at nine games: someone plays eight, rotating
    const odd_one = members[mod(year, members.length)];
    need[odd_one] -= 1;
  }
  const divisions = get(rule, "divisions");
  if (truthy(divisions) && Object.keys(divisions).length === 2) {
    schedule_gen._balance_divisions(need, divisions, get(rule, "cross_division"), get(rule, "protected", []), year);
  }
  let required = get(rule, "protected", []).filter((p) => own(need, p[0]) && own(need, p[1])).map((p) => [p[0], p[1]]);
  if (truthy(get(rule, "round_robin"))) {
    required = [];
    members.forEach((a, i) => { for (const b of members.slice(i + 1)) required.push([a, b]); });
  }
  if (truthy(divisions)) {
    for (const div of Object.values(divisions)) {
      const ms = div.filter((s) => own(need, s));
      ms.forEach((a, i) => { for (const b of ms.slice(i + 1)) required.push([a, b]); });
    }
  }
  // a pair already on the books (Army-Navy, an announced neutral game between members) is outside the league slate
  {
    const seen = new Set(), unique = [];                    // dict.fromkeys: each sorted pair once, in its first place
    for (const p of required) {
      const q = sorted_pair(p[0], p[1]);
      if (!seen.has(pair_text(q))) { seen.add(pair_text(q)); unique.push(q); }
    }
    required = unique.filter((p) => !booked.has(schedule_gen.pair_key(p[0], p[1])));
  }
  // pairs at the end of their cycle must meet this year (as many of them as each team's games allow)
  const cycle = get(rule, "cycle", 4);
  const urgent_pairs = [];
  members.forEach((a, i) => {
    for (const b of members.slice(i + 1)) {
      if (!has_pair(required, a, b) && !has_pair(required, b, a) && !booked.has(schedule_gen.pair_key(a, b))
          && !(truthy(divisions) && schedule_gen._same_division(divisions, a, b))
          && 0 < schedule_gen._last_year(hist, a, b) && schedule_gen._last_year(hist, a, b) <= year - cycle) {
        urgent_pairs.push(sorted_pair(a, b));
      }
    }
  });
  const urgent = sorted(urgent_pairs, (p) => [schedule_gen._last_year(hist, p[0], p[1]), rng.random()]);
  const left = {};
  for (const s of members) left[s] = need[s] - sum(required.filter((p) => p.includes(s)).map(() => 1));
  const musts = [];
  for (const [a, b] of urgent) {
    if (left[a] > 0 && left[b] > 0) {
      musts.push([a, b]); left[a] -= 1; left[b] -= 1;
    }
  }
  let edges = schedule_gen._fill_edges(members, need, required.concat(musts), hist, rng, divisions, get(rule, "cross_division"), booked);
  if (edges === null) edges = schedule_gen._fill_edges(members, need, required, hist, rng, divisions, get(rule, "cross_division"), booked);
  if (edges === null) throw new ScheduleError(`no ${conf} slate for ${year}`);
  // sites: the traveler of the last meeting hosts; then even out league home games toward the target
  const target = schedule_gen._home_targets(members, k, year, hist, get(rule, "home_split"));
  const neutral_pairs = new Set(get(rule, "neutral", []).map((p) => pair_text(sorted_pair(p[0], p[1]))));
  const hosted = edges.filter((e) => !neutral_pairs.has(pair_text(sorted_pair(e[0], e[1])))).length;      // home games to share out
  schedule_gen._normalise_targets(target, hosted, members, year, hist, rng);
  const home_conf = {};
  for (const s of members) home_conf[s] = 0;
  const sited = [];
  for (const [a, b] of edges) {
    const [home, away] = schedule_gen._site_from_history(hist, a, b, rng);
    sited.push([home, away, truthy(schedule_gen.last_meeting(hist, a, b))]);
    if (!neutral_pairs.has(pair_text(sorted_pair(a, b)))) home_conf[home] += 1;
  }
  const flippable = (g) => !neutral_pairs.has(pair_text(sorted_pair(g[0], g[1]))) && (!g[2] || schedule_gen._last_year(hist, g[0], g[1]) < year - 1);
  for (let _ = 0; _ < 8; _++) {                             // a first meeting, or one two years back, can go either way: balance with those
    let under = members.filter((s) => home_conf[s] < target[s]);
    if (!under.length) break;
    let moved = false;
    for (const g of sited) {
      if (under.includes(g[1]) && home_conf[g[0]] >= target[g[0]] && flippable(g)) {
        [g[0], g[1]] = [g[1], g[0]];
        home_conf[g[0]] += 1; home_conf[g[1]] -= 1;
        under = members.filter((s) => home_conf[s] < target[s]);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const finale_pairs = new Set(get(rule, "finales", []).map((p) => pair_text(sorted_pair(p[0], p[1]))));
  for (const [home, away] of sited) {
    const key = pair_text(sorted_pair(home, away));
    add(home, away, neutral_pairs.has(key), finale_pairs.has(key) ? schedule_gen.FINALE_WEEK : null, "", "conf");
  }
}

export function _balance_divisions(need, divisions, cross, protected_, year) {
  // Two divisions of different sizes (a league file's added team) cannot give every team the same
  // number of cross-division games: the side with more cross games to play gives some up, a game
  // each for its members in turn from `year`, so both sides play the same number. Equal divisions
  // (every built-in one) are left alone.
  const sides = Object.values(divisions).map((d) => d.filter((s) => own(need, s)));
  if (sides.some((d) => !d.length)) return;
  if (cross !== null && cross !== undefined) {
    for (const d of sides) for (const s of d) need[s] = Math.min(need[s], d.length - 1 + cross);
  }
  const side_of = {};
  sides.forEach((d, i) => { for (const s of d) side_of[s] = i; });
  const fixed = {};                           // protected games across the divisions: these stay
  for (const s of Object.keys(need)) fixed[s] = 0;
  for (const [a, b] of protected_) {
    if (own(side_of, a) && own(side_of, b) && side_of[a] !== side_of[b]) {
      fixed[a] += 1; fixed[b] += 1;
    }
  }
  const spare = (s, d) => need[s] - (d.length - 1) - fixed[s];
  const totals = sides.map((d) => sum(d.map((s) => Math.max(0, need[s] - (d.length - 1)))));
  while (totals[0] !== totals[1]) {
    const i = totals[0] > totals[1] ? 0 : 1;
    const d = sides[i];
    const free = d.filter((s) => spare(s, d) > 0);
    if (!free.length) return;
    const s = maxBy(free, (t) => [spare(t, d), -mod(d.indexOf(t) - year, d.length)]);
    need[s] -= 1;
    totals[i] -= 1;
  }
}

export function _normalise_targets(target, hosted, members, year, hist, rng) {
  // The targets must add up to the home games there are: trim the teams that hosted most two years
  // back (or raise those that hosted least) until they do.
  const two_back = (s) => get(get(get(hist, "home_conf") || {}, s, {}), String(year - 2), 0);
  let diff = sum(Object.values(target)) - hosted;
  while (diff > 0) {
    const s = maxBy(members.filter((m) => target[m] > 0), (m) => [target[m], two_back(m), rng.random()]);
    target[s] -= 1; diff -= 1;
  }
  while (diff < 0) {
    const s = minBy(members, (m) => [target[m], two_back(m), rng.random()]);
    target[s] += 1; diff += 1;
  }
}

export function _same_division(divisions, a, b) {
  return Object.values(divisions).some((ms) => ms.includes(a) && ms.includes(b));
}

export function _home_targets(members, k, year, hist, split) {
  // League home games per team this year: the alternate of last year's count (5 after 4) in a
  // nine-game league, half in an eight-game one.
  const out = {};
  for (const s of members) {
    const last = get(get(get(hist, "home_conf") || {}, s, {}), String(year - 1));
    if (mod(k, 2) === 0) out[s] = floordiv(k, 2);
    else if (last !== null) out[s] = last > floordiv(k, 2) ? floordiv(k, 2) : floordiv(k, 2) + 1;
    else out[s] = floordiv(k, 2) + mod(members.indexOf(s) + year, 2);
  }
  return out;
}

export function _fill_edges(members, need, required, hist, rng, divisions, cross, booked) {
  // A set of pairs giving every member its number of league games: the required pairs, then the
  // least recently met pairs, with a repair pass; several randomized attempts.
  const div_of = {};
  if (truthy(divisions)) {
    for (const [name, ms] of Object.entries(divisions)) for (const s of ms) div_of[s] = name;
  }
  const cands = [];
  members.forEach((a, i) => {
    for (const b of members.slice(i + 1)) {
      const p = [a, b];
      if (has_pair(required, a, b) || booked.has(schedule_gen.pair_key(a, b))) continue;
      if (truthy(divisions) && get(div_of, a) === get(div_of, b)) continue;      // division games are all required
      cands.push(p);
    }
  });
  const cand_set = new Set(cands.map(pair_text));           // `(a, b) in cands`, asked many times below
  const in_cands = (a, b) => cand_set.has(`${a}|${b}`);
  for (let attempt = 0; attempt < schedule_gen.RESTARTS; attempt++) {
    let left = { ...need };
    const edges = [];
    for (const [a, b] of required) {
      left[a] -= 1; left[b] -= 1;
      edges.push([a, b]);
    }
    if (Object.values(left).some((v) => v < 0)) return null;
    if (truthy(divisions) && truthy(cross)) {
      const capped = {};
      for (const [s, v] of Object.entries(left)) capped[s] = Math.min(v, cross);
      left = capped;
    }
    let order = sorted(cands, (p) => [schedule_gen._last_year(hist, p[0], p[1]), rng.random()]);
    // a little randomness after the first attempt: shuffle among pairs that met the same year
    if (attempt) {
      rng.shuffle(order);
      order = sorted(order, (p) => schedule_gen._last_year(hist, p[0], p[1]) + rng.random() * (1 + floordiv(attempt, 10)));
    }
    for (const [a, b] of order) {
      if (left[a] > 0 && left[b] > 0) {
        edges.push([a, b]); left[a] -= 1; left[b] -= 1;
      }
    }
    let short = Object.keys(left).filter((s) => left[s] > 0);
    if (short.length) {
      // repair: for two short teams a and b that already play, find an edge (c, d) to swap so that (a, c) and (b, d) are new legal pairs
      const fixed = new Set(required.map(pair_text));
      for (let _ = 0; _ < 200; _++) {
        short = Object.keys(left).filter((s) => left[s] > 0);
        if (!short.length) break;
        const a = rng.choice(short);
        const bs = short.filter((s) => (s !== a && in_cands(a, s)) || in_cands(s, a));
        if (bs.length) {
          const b = rng.choice(bs);
          if (!has_pair(edges, a, b) && !has_pair(edges, b, a)) {
            edges.push([a, b]); left[a] -= 1; left[b] -= 1;
            continue;
          }
        }
        let done = false;
        for (const [c, d] of rng.sample(edges, edges.length)) {
          if (fixed.has(`${c}|${d}`) || a === c || a === d) continue;
          for (const [x, y] of [[c, d], [d, c]]) {
            if (schedule_gen._legal(a, x, cands, edges) && get(left, y, 0) >= 0) {
              // replace (c, d) by (a, x); y goes short by one, a's need drops
              remove_pair(edges, c, d); edges.push(sorted_pair(a, x));
              left[a] -= 1; left[y] += 1;
              done = true;
              break;
            }
          }
          if (done) break;
        }
        if (!done) break;
      }
      short = Object.keys(left).filter((s) => left[s] > 0);
    }
    if (!short.length && Object.values(left).every((v) => v === 0)) return edges.map((p) => [p[0], p[1]]);
  }
  return null;
}

export function _legal(a, x, cands, edges) {
  const p = sorted_pair(a, x);
  return a !== x && (has_pair(cands, p[0], p[1]) || has_pair(cands, p[1], p[0])) && !has_pair(edges, p[0], p[1]) && !has_pair(edges, p[1], p[0]);
}

// ----- non-conference ----------------------------------------------------------------------------

export function _nonconference(year, fbs, fcs, hist, rng, add, is_power, count, nonconf_power, fcs_games, home_total, pending_next, teams, booked,
  games, remove, confs = null) {
  const R = schedule_gen.rules();
  confs = confs === null || confs === undefined ? R["conferences"] : confs;
  const names = Object.keys(fbs);
  const conf_of = {};
  for (const s of names) conf_of[s] = fbs[s]["conference"];
  const rule_of = (s) => get(confs, conf_of[s]) || {};
  const nc = (s) => {
    const mine = get(rule_of(s), "non_conference");
    if (truthy(mine)) return mine;
    const alone = get(R["independents"], s);
    return truthy(alone) ? alone : {};
  };
  const slots = (s) => schedule_gen.GAMES - count[s];
  const recent = (a, b) => schedule_gen._last_year(hist, a, b) >= year - 1;
  // two teams the fill may pair: not league-mates, and not Notre Dame with an ACC team (its five ACC games are set above)
  const may_pair = (a, b) => conf_of[a] !== conf_of[b] && !(same_two(a, conf_of[b], "notre-dame", "ACC") || same_two(b, conf_of[a], "notre-dame", "ACC"));
  // every year a Power team wants seven home games and a Group of Five team six: the non-conference sites
  // lean against the league's 5/4 alternation rather than with it
  const last_home = get(hist, "home_total") || {};
  const target = {};
  for (const s of names) target[s] = is_power(s) ? 7 : 6;
  const deficit = (s) => target[s] - home_total[s];
  // a home-and-home's return flips next year, so the side that already owes more road returns next year hosts now
  function balance(s) {
    const owed_away = sum(pending_next.filter((g) => g["away"] === s).map(() => 1)) - sum(pending_next.filter((g) => g["home"] === s).map(() => 1));
    return deficit(s) - owed_away;
  }

  function return_year(a, b) {
    // When a home-and-home comes back: next year, or the year after for an independent's games
    // (half of them), so its slate does not flip home to road as one block.
    if (conf_of[a] === "FBS Independent" || conf_of[b] === "FBS Independent") return year + 1 + mod(pending_next.length, 2);
    return year + 1;
  }

  function power_need(s) {
    const r = nc(s);
    let want = get(r, "power_min", 0);
    if (get(get(rule_of(s), "eight_game_team") || {}, String(year)) === s) want = get(r, "power_min_eight_game", want);
    return Math.max(0, want - nonconf_power[s]);
  }

  const powers = names.filter((s) => is_power(s));
  const g5 = names.filter((s) => !is_power(s));
  // a. Power teams owed a Power opponent pair up across conferences (a home-and-home: the return goes on the books)
  const needing = sorted(powers.filter((s) => power_need(s) > 0 && slots(s) > 0), () => rng.random());
  while (needing.length >= 2) {
    const a = needing.pop();
    let partners = needing.filter((b) => may_pair(a, b) && !booked.has(schedule_gen.pair_key(a, b)) && !recent(a, b));
    if (!partners.length) partners = needing.filter((b) => may_pair(a, b));
    if (!partners.length) continue;
    const b = minBy(partners, (s) => [schedule_gen._last_year(hist, a, s), rng.random()]);
    needing.splice(needing.indexOf(b), 1);
    const [home, away] = schedule_gen._site_from_history(hist, a, b, rng, balance, year);
    add(home, away, false, null, "", "nonconf")["flex"] = schedule_gen._last_year(hist, a, b) < year - 1;
    pending_next.push({ year: return_year(home, away), home: away, away: home });
  }
  // whoever is still owed a Power opponent books a home-and-home with any Power team that has room
  for (const a of powers.filter((s) => power_need(s) > 0 && slots(s) > 0)) {
    const partners = powers.filter((b) => b !== a && slots(b) > 0 && may_pair(a, b) && !booked.has(schedule_gen.pair_key(a, b)));
    if (!partners.length) continue;
    const b = minBy(partners, (s) => [recent(a, s), -slots(s), schedule_gen._last_year(hist, a, s), rng.random()]);
    const [home, away] = schedule_gen._site_from_history(hist, a, b, rng, balance, year);
    add(home, away, false, null, "", "nonconf")["flex"] = schedule_gen._last_year(hist, a, b) < year - 1;
    pending_next.push({ year: return_year(home, away), home: away, away: home });
  }
  // b. Group of Five teams' Power pay games (one, sometimes two), at the Power team's place; a Power team hosts at most two
  const pay_hosted = {};
  for (const p of powers) pay_hosted[p] = 0;
  for (const s of sorted(g5, (t) => [-slots(t), rng.random()])) {
    const [lo, hi] = get(nc(s), "power_road", [1, 2]);
    // a second pay game only after a year with six home dates or more (two trips plus a road league year is thin)
    const want = lo + (hi > lo && rng.random() < schedule_gen.SECOND_POWER_ROAD && get(get(last_home, s) || {}, String(year - 1), 6) >= 6 ? 1 : 0);
    for (let i = 0; i < want; i++) {
      if (slots(s) <= 0 || (i && slots(s) <= 2 - (fcs_games[s] ? 1 : 0))) break;   // a second only with room for the FCS game and a home-and-home
      const hosts = powers.filter((p) => slots(p) > 0 && pay_hosted[p] < 2 && may_pair(s, p) && !recent(s, p) && !booked.has(schedule_gen.pair_key(s, p)));
      if (!hosts.length) break;
      // the Power team most short of home dates first, then the one with the most room, least recently met
      const p = minBy(hosts, (h) => [-deficit(h), -slots(h), schedule_gen._last_year(hist, s, h), rng.random()]);
      add(p, s, false, null, "", "nonconf");
      pay_hosted[p] += 1;
    }
  }
  // c. FCS games: a home game against the region's stand-in. Every other game fills two slots, so the
  // number of FCS games must have the parity of the slots still open, or one team ends up alone.
  const planned = [];
  for (const s of sorted(names, () => rng.random())) {
    const cap = get(nc(s), "fcs_max", 1);
    if (fcs_games[s] >= cap || slots(s) <= 0) continue;
    if (is_power(s) && (deficit(s) <= 0 || rng.random() > schedule_gen.POWER_FCS_CHANCE)) continue;
    planned.push(s);
  }
  const open_slots = sum(names.map((s) => slots(s)));
  if (mod(open_slots - planned.length, 2)) {
    const passed = names.filter((s) => is_power(s) && !planned.includes(s) && slots(s) > 0 && fcs_games[s] < get(nc(s), "fcs_max", 1));
    if (passed.length) {
      planned.push(rng.choice(passed));             // one more Power team takes its FCS game
    } else {
      if (!planned.length) throw new Error("pop from empty list");
      planned.pop();                                // or one fewer
    }
  }
  for (const s of planned) add(s, schedule_gen._stand_in(s, teams, fcs, rng), false, null, "", "fcs");
  // d. the rest: home-and-homes between teams with room (Power hosts a Group of Five team for a pay game when it has one slot left)
  for (let _ = 0; _ < schedule_gen.GAMES; _++) {
    const open_ = sorted(names.filter((s) => slots(s) > 0), (s) => [-slots(s), rng.random()]);
    if (open_.length < 2) break;
    const before = sum(Object.values(count));
    for (const a of open_) {
      while (slots(a) > 0) {
        const partners = open_.filter((b) => b !== a && slots(b) > 0 && may_pair(a, b) && !booked.has(schedule_gen.pair_key(a, b)));
        if (!partners.length) break;
        // spread the games: the partner with the most room, least recently met
        const b = minBy(partners, (s) => [-slots(s), recent(a, s), -(is_power(s) !== is_power(a) ? deficit(s) : 0), schedule_gen._last_year(hist, a, s), rng.random()]);
        if (is_power(a) !== is_power(b)) {
          const [host, guest] = is_power(a) ? [a, b] : [b, a];
          add(host, guest, false, null, "", "nonconf");             // a pay game, not returned
        } else {
          const [home, away] = schedule_gen._site_from_history(hist, a, b, rng, balance, year);
          add(home, away, false, null, "", "nonconf")["flex"] = schedule_gen._last_year(hist, a, b) < year - 1;
          pending_next.push({ year: return_year(home, away), home: away, away: home });
        }
      }
    }
    if (sum(Object.values(count)) === before) break;
  }
  // e. a team still short (the pool ran dry on it) takes over another team's FCS date: that team plays it
  // instead of the stand-in (a pay game at the Power side, else a home-and-home); failing that, an FCS game of its own
  for (const s of sorted(names, (t) => -slots(t))) {
    while (slots(s) > 0) {
      const donors = games.filter((g) => g["kind"] === "fcs" && g["home"] !== s && may_pair(s, g["home"])
        && !booked.has(schedule_gen.pair_key(s, g["home"])));
      if (donors.length) {
        const g = minBy(donors, (d) => [-fcs_games[d["home"]], schedule_gen._last_year(hist, s, d["home"]), rng.random()]);
        const y = g["home"];
        remove(g);
        if (is_power(s) !== is_power(y)) {
          const [host, guest] = is_power(s) ? [s, y] : [y, s];
          add(host, guest, false, null, "", "nonconf");
        } else {
          const [home, away] = schedule_gen._site_from_history(hist, s, y, rng, balance, year);
          add(home, away, false, null, "", "nonconf");
          pending_next.push({ year: return_year(home, away), home: away, away: home });
        }
        continue;
      }
      if (fcs_games[s] < Math.max(1, get(nc(s), "fcs_max", 1))) {
        add(s, schedule_gen._stand_in(s, teams, fcs, rng, new Set(games.filter((g) => g["home"] === s).map((g) => g["away"]))), false, null, "", "fcs");
        continue;
      }
      throw new ScheduleError(`${s} cannot fill its ${year} schedule`);
    }
  }
  // f. home dates: a team over eight or under five flips a home-and-home it is free to flip (the pair has not met
  // in two years), taking the game from a team that can spare it; the owed return flips with it
  function flip(g) {
    [g["home"], g["away"]] = [g["away"], g["home"]];
    home_total[g["home"]] += 1; home_total[g["away"]] -= 1;
    for (const r of pending_next) {
      if (same_two(r["home"], r["away"], g["home"], g["away"])) {
        [r["home"], r["away"]] = [g["away"], g["home"]];
      }
    }
  }
  for (let _ = 0; _ < 40; _++) {
    const over = names.filter((s) => home_total[s] > 8 || (home_total[s] > target[s] && is_power(s)));
    const under = names.filter((s) => home_total[s] < 5 || (home_total[s] < target[s] - 1));
    let moved = false;
    for (const g of games) {
      if (!truthy(get(g, "flex"))) continue;
      if (over.includes(g["home"]) && home_total[g["away"]] < target[g["away"]]) {
        flip(g); moved = true;
      } else if (under.includes(g["away"]) && home_total[g["home"]] > target[g["home"]] - 1) {
        flip(g); moved = true;
      }
    }
    if (!moved) break;
  }
}

export function _stand_in(s, teams, fcs, rng, exclude = null) {
  const region = get(schedule_gen.REGION_OF_STATE, get(teams[s], "state") || "", null);
  const pool = fcs.filter((f) => !(exclude !== null && exclude.has(f)));
  const local = pool.filter((f) => get(teams[f], "state") === region);
  return rng.choice(local.length ? local : pool);
}

export function _home_conf_counts(games, conf_of) {
  const out = {};
  for (const g of games) {
    if (g["kind"] === "conf" && !g["neutral"]) out[g["home"]] = get(out, g["home"], 0) + 1;
  }
  return out;
}

// ----- weeks ---------------------------------------------------------------------------------------

export function _assign_weeks(games, fbs, rng, year = 0) {
  // A week for every game: fixed weeks first, non-conference games early, conference games from
  // week 3, finales in week 14, nobody twice in a week; randomized attempts until it fits.
  for (let attempt = 0; attempt < schedule_gen.RESTARTS; attempt++) {
    const busy = {};
    for (const s of Object.keys(fbs)) busy[s] = new Set();
    const busy_of = (s) => (own(busy, s) ? busy[s] : NO_WEEKS);
    for (const g of games) g["_w"] = g["week"];
    let ok = true;
    const fixed = games.filter((g) => g["_w"] !== null);
    for (const g of fixed) {
      const w = g["_w"];
      if ([g["home"], g["away"]].some((s) => own(busy, s) && busy[s].has(w))) {
        ok = false;
        break;
      }
      for (const s of [g["home"], g["away"]]) if (own(busy, s)) busy[s].add(w);
    }
    if (!ok) {
      // two games with set weeks clash: the later-listed one (a league finale before a series, a series before an announced game) loses its week
      const seen = new Set();
      const order = sorted(fixed, (g) => (g["kind"] === "fixed" && truthy(get(g, "site")) ? 0 : g["kind"] === "fixed" ? 1 : 2));
      for (const g of order) {
        const w = g["week"];
        if ([g["home"], g["away"]].some((s) => seen.has(slot_key(s, w)))) g["week"] = null;
        for (const s of [g["home"], g["away"]]) seen.add(slot_key(s, w));
      }
      continue;
    }
    const slot = new Map();                                   // (team, week) -> the game there
    for (const g of fixed) for (const s of [g["home"], g["away"]]) slot.set(slot_key(s, g["_w"]), g);
    let rest = games.filter((g) => g["_w"] === null);
    rng.shuffle(rest);
    rest = sorted(rest, (g) => (g["kind"] === "nonconf" || g["kind"] === "fixed" ? 0 : g["kind"] === "fcs" ? 1 : 2));

    const place = (g, w) => {
      g["_w"] = w;
      for (const s of [g["home"], g["away"]]) {
        if (own(busy, s)) { busy[s].add(w); slot.set(slot_key(s, w), g); }
      }
    };

    const unplace = (g) => {
      for (const s of [g["home"], g["away"]]) {
        if (own(busy, s)) { busy[s].delete(g["_w"]); slot.delete(slot_key(s, g["_w"])); }
      }
      g["_w"] = null;
    };

    const free_weeks = (g) => schedule_gen._prefs(g).filter((w) => !busy_of(g["home"]).has(w) && !busy_of(g["away"]).has(w));

    for (const g of rest) {
      const prefs = schedule_gen._prefs(g);
      const home = g["home"], away = g["away"];
      let free = free_weeks(g);
      if (!free.length) {
        // repair: a week one side has free and the other spends on a movable game that can go elsewhere
        let moved = false;
        for (const w of prefs) {
          for (const [mine, theirs] of [[home, away], [away, home]]) {
            if (busy_of(mine).has(w) || !busy_of(theirs).has(w)) continue;
            const other = slot.get(slot_key(theirs, w));
            if (other === undefined || other["week"] !== null) continue;      // a game with a set week stays
            unplace(other);
            const alt = free_weeks(other).filter((w2) => w2 !== w);
            if (alt.length) {
              place(other, alt[0]); moved = true;
              break;
            }
            place(other, w);
          }
          if (moved) break;
        }
        free = moved ? free_weeks(g) : [];
        if (!free.length) {
          ok = false;
          break;
        }
      }
      // spread: prefer the week where the two teams' schedules are emptiest around it (fewer byes in a row)
      const w = g["kind"] !== "conf" ? free[0]
        : minBy(free.slice(0, 6), (x) => [schedule_gen._gap_cost(busy[home], x) + schedule_gen._gap_cost(busy[away], x), rng.random()]);
      place(g, w);
    }
    if (ok) {
      const fixed_weeks = new Set(fixed);                     // (the games themselves, where Python keeps their ids)
      for (const g of games) {
        g["week"] = g["_w"];
        delete g["_w"];
      }
      schedule_gen._tidy_byes(games, fbs, fixed_weeks, rng);
      schedule_gen._week_zero(games, fbs, fixed_weeks, new Random(`week0-${year}-${games.length}`));   // its own stream: the grid's draws never move
      return;
    }
  }
  throw new ScheduleError("no week grid fits this schedule");
}

export function _tidy_byes(games, fbs, fixed_weeks, rng) {
  // Nobody sits out the opening week or rivalry week when a game of theirs can move there: a
  // team with week 14 free pulls a league game whose opponent is also free into it, a team with
  // week 1 free pulls a non-conference game. Byes end up between.
  const by_week = {};                                         // team -> Map(week -> its game), in the order weeks were added
  for (const g of games) {
    for (const s of [g["home"], g["away"]]) {
      if (own(fbs, s)) {
        if (!own(by_week, s)) by_week[s] = new Map();
        by_week[s].set(g["week"], g);
      }
    }
  }
  const NONE = new Map();
  const weeks_of = (s) => (own(by_week, s) ? by_week[s] : NONE);
  function pull(s, week, kinds, keep) {
    // Move one of s's games into `week` (its opponent free there), from a week not in `keep`.
    const movable = [...weeks_of(s).values()].filter((g) => !fixed_weeks.has(g) && !keep.includes(g["week"])
      && kinds.includes(g["kind"]) && !weeks_of(g["home"] === s ? g["away"] : g["home"]).has(week));
    if (!movable.length) return false;
    // take the game from a week where leaving a bye costs least: one whose neighbors are both games
    const g = minBy(movable, (m) => {
      const others = new Set(by_week[s].keys());
      others.delete(m["week"]);
      return [kinds.indexOf(m["kind"]), -schedule_gen._gap_cost(others, m["week"]), rng.random()];
    });
    const old = g["week"];
    for (const t of [g["home"], g["away"]]) {
      if (own(fbs, t)) { by_week[t].delete(old); by_week[t].set(week, g); }
    }
    g["week"] = week;
    return true;
  }

  const ends = [1, schedule_gen.FINALE_WEEK, schedule_gen.ARMY_NAVY_WEEK];
  for (const [week, kinds] of [[schedule_gen.FINALE_WEEK, ["conf", "nonconf", "fcs"]], [1, ["nonconf", "fcs", "conf"]]]) {
    for (const s of sorted(Object.keys(fbs), () => rng.random())) {
      if (!weeks_of(s).has(week)) pull(s, week, kinds, ends);
    }
  }
  // two byes in a row: fill one of them from a week whose neighbors are games
  for (let _ = 0; _ < 2; _++) {
    for (const s of sorted(Object.keys(fbs), () => rng.random())) {
      let weeks = new Set(weeks_of(s).keys());
      for (const w of range(2, schedule_gen.LAST_WEEK)) {
        if (!weeks.has(w) && !weeks.has(w + 1)) {
          if (pull(s, w, ["conf", "nonconf", "fcs"], ends.concat([w - 1, w + 2]))) weeks = new Set(weeks_of(s).keys());
        }
      }
    }
  }
}

export function _week_zero(games, fbs, fixed_weeks, rng) {
  // Week 0 (engine week 1), as the real calendar has it: a handful of games the Saturday before Labor Day. The full
  // grid opens everyone in week 1; here all but about WEEK0_GAMES of those games move to a later week both teams have
  // free (a bye they share, nearest the start first), or, when games block such a week (one, or one for each side), those
  // games first move to byes their own teams share. Kept, in order: the set-week openers (data/series.json), other neutral-site games, then
  // a random few. A game that cannot move stays. Only real teams' weeks count (the FCS stand-ins play many a week).
  const real = (t) => own(fbs, t);                    // fbs: the real teams (no FCS stand-in)
  const slot = new Map();                             // (team, week) -> its game there
  for (const g of games) {
    for (const t of [g["home"], g["away"]]) if (real(t)) slot.set(slot_key(t, g["week"]), g);
  }
  const sides = (g) => [g["home"], g["away"]].filter((t) => real(t));
  const free = (g, w) => sides(g).every((t) => !slot.has(slot_key(t, w)));
  const move = (g, w) => {
    for (const t of sides(g)) {
      slot.delete(slot_key(t, g["week"]));
      slot.set(slot_key(t, w), g);
    }
    g["week"] = w;
  };
  const later = range(schedule_gen.WEEK0 + 1, schedule_gen.LAST_WEEK + 1).filter((w) => w !== schedule_gen.FINALE_WEEK);
  const opening = sorted(games.filter((g) => g["week"] === schedule_gen.WEEK0), (g) => [fixed_weeks.has(g) ? 0 : truthy(get(g, "neutral")) ? 1 : 2, rng.random()]);
  // from the least wanted up, move games out until about WEEK0_GAMES are left: one that cannot move stays and counts
  // toward them (it used to stay on top of the WEEK0_GAMES kept, which left a dozen or more)
  let left = opening.length;
  for (const g of opening.slice().reverse()) {
    if (left <= schedule_gen.WEEK0_GAMES) break;
    if (fixed_weeks.has(g)) continue;
    let w = later.find((x) => free(g, x));
    if (w === undefined) w = null;
    if (w === null) {
      // no week both have open: clear one. The games in the way that week (one, or one for each side) each move
      // to a week their own two teams have open; a game that cannot move leaves the week as it is
      for (const w2 of later) {
        const block = new Set();                      // the games in the way, each once, in the order found
        for (const t of sides(g)) if (slot.has(slot_key(t, w2))) block.add(slot.get(slot_key(t, w2)));
        if (!block.size || [...block].some((b) => fixed_weeks.has(b) || (b["kind"] === "conf" && w2 === schedule_gen.FINALE_WEEK))) continue;
        const plan = [], taken = new Set();           // (game, its new week); a team's week is promised once
        for (const b of block) {
          const to = later.find((w3) => w3 !== w2 && free(b, w3) && !sides(b).some((t) => taken.has(slot_key(t, w3))));
          if (to === undefined) break;
          plan.push([b, to]);
          for (const t of sides(b)) taken.add(slot_key(t, to));
        }
        if (plan.length !== block.size) continue;
        for (const [b, to] of plan) move(b, to);
        w = w2;
        break;
      }
    }
    if (w !== null) {
      move(g, w);
      left -= 1;
    }
  }
}

export function _prefs(g) {
  // The weeks a game may take, best first: league games from week 3, FCS tune-ups early or late, the rest early.
  if (g["kind"] === "conf") return range(3, schedule_gen.LAST_WEEK + 1).concat([2, 1]);
  if (g["kind"] === "fcs") return [...schedule_gen.NONCONF_WEEKS, ...schedule_gen.LATE_FCS_WEEKS, ...range(5, 11)];
  return [...schedule_gen.NONCONF_WEEKS, ...range(5, schedule_gen.LAST_WEEK + 1)];
}

export function _gap_cost(weeks, w) {
  // Playing in week w costs little when the weeks beside it are already games (keeps byes apart).
  return (weeks.has(w - 1) ? 0 : 1) + (weeks.has(w + 1) ? 0 : 1);
}

// ----- records -------------------------------------------------------------------------------------

export function _record_for(g, year, teams, rng) {
  const season = modules.season;
  const home = g["home"], away = g["away"];
  const fict_home = get(teams[home], "fictional"), fict_away = get(teams[away], "fictional");
  let shift = 0.0;
  if (truthy(fict_home) || truthy(fict_away)) {
    const tiers = Object.entries(season.FCS_TIER_SHIFT);
    shift = rng.choice(tiers.map(([, v]) => v).concat([0.0, 0.0]));
  }
  const week = g["week"];
  let date;
  if (week <= schedule_gen.LAST_WEEK) {
    date = season._saturday(week);
  } else {
    const days = get(season.POSTSEASON_DATES, week, ["2026-12-12"]);
    date = days[days.length - 1] + "T20:00Z";
  }
  const rec = { event_id: `${year}-${String(week).padStart(2, "0")}-${home}-${away}`, week, date, neutral: truthy(g["neutral"]),
    home, away, fcs_shift: shift,
    home_display: truthy(fict_home) ? season.fcs_label(home) : teams[home]["name"],
    away_display: truthy(fict_away) ? season.fcs_label(away) : teams[away]["name"],
    conference_game: g["kind"] === "conf",
    played: false, home_score: null, away_score: null, overtime: 0, real: false, kind: "regular" };
  if (truthy(get(g, "title"))) rec["title"] = g["title"];
  if (truthy(get(g, "site"))) rec["site"] = g["site"];
  return rec;
}

Object.assign(schedule_gen, {
  ScheduleError,
  rules, series, pair_key, seed_history, _record, last_meeting, _last_year, _site_from_history, empty_history, generate, _by_conference,
  _fixed_games, _league_games, _conference_slate, _balance_divisions, _normalise_targets, _same_division, _home_targets, _fill_edges, _legal,
  _nonconference, _stand_in, _home_conf_counts, _assign_weeks, _tidy_byes, _week_zero, _prefs, _gap_cost, _record_for,
});

modules.schedule_gen = schedule_gen;
