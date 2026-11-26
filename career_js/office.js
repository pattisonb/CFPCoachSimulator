// The Office's own read (web/office.js, GET /api/season/{id}/office): your program's news over the last
// weeks and your conference's latest results with your place in it. Read only: nothing here draws a random
// number or writes to the season, so the sim and its golden digests never see it.
//
// `office_view(state)` -> {"news": [...], "conference": {"name", "week", "games": [...], "standing": {...} | null}}.
// A news item is a recruiting event about a prospect on your board, one you offered or one who picked you
// ({week, kind, pid, name, position, stars, rank, school, school_name, rival_name?}), or one of your games
// ({week, kind: "game", won, points_for, points_against, opponent, opponent_name, venue, overtime}); newest
// week first. A conference game is {event_id, week, home, away, home_name, away_name, home_score, away_score,
// overtime, mine, conference_game}, from the latest week your conference's teams played.
//
// Persona, recruiting and the season are reached at the call, through `modules`.
import { cmp, get, isNumber, truthy } from "../engine_js/pyrt.js";
import { modules } from "../engine_js/modules.js";
import { ability_goals } from "./ability_goals.js";
import { promises } from "./promises.js";
import { word } from "./word.js";

const NEWS_ITEMS = 6;        // *tune* the most items Program News shows
const CONF_GAMES = 4;        // *tune* the most results Around the Conference shows
const NEWS_WEEKS = 4;        // *tune* how many weeks back Program News reaches

// the recruiting events worth a line, the biggest first inside a week
const _NEWS_ORDER = ["promise", "signed", "unsigned", "pro", "commit", "hard", "flip", "decommit", "rival_push", "softened", "hat", "bloomed", "twist", "offer", "asked_more", "not_buying",
  "hung_up", "pester", "promise_broken"];

export function _school_name(slug, teams) {
  if (!truthy(slug)) return null;
  if (slug === "FCS") return "an FCS program";
  return slug in teams ? modules.season.team_display(slug, teams) : slug;
}

export function program_news(state) {
  // Your program's latest news: the recruiting log's events about your prospects and your game results,
  // newest week first, at most NEWS_ITEMS.
  const season = modules.season, recruiting = modules.recruiting, persona = modules.persona;
  const teams = season.load_teams();
  const me = state["team"], week = state["current_week"];
  const rc = get(state, "recruiting") || {};
  const mine = new Set([...(get(rc, "board") || []), ...get(get(rc, "offers") || {}, me, [])]);
  const skip = ["leaning_fcs", ...recruiting.HISTORY_ONLY];
  let items = [];
  for (const e of get(rc, "log") || []) {
    if (e["week"] <= week - office.NEWS_WEEKS || skip.includes(e["kind"]) || !office._NEWS_ORDER.includes(e["kind"])) continue;
    if (!(get(e, "school") === me || get(e, "from") === me || mine.has(e["pid"]))) continue;
    if (!truthy(persona.shown_to(e, me))) continue;    // a Quiet Commit elsewhere, a twist he told another school
    if (e["kind"] === "offer" && get(e, "school") === me) continue;                     // your own offers are your doing, not news
    const p = get(get(rc, "prospects") || {}, e["pid"]);
    if (!truthy(p)) continue;
    const item = { week: e["week"], kind: e["kind"], pid: e["pid"], name: p["name"], position: p["position"],
      stars: p["stars"], rank: get(p, "rank"), school: get(e, "school"), school_name: office._school_name(get(e, "school"), teams),
      yours: get(e, "school") === me };
    if (truthy(get(e, "rival"))) item["rival_name"] = office._school_name(e["rival"], teams);
    if (truthy(get(e, "action"))) item["action"] = e["action"];
    const why = truthy(get(e, "lost")) ? recruiting.lost_reason(e, (slug) => office._school_name(slug, teams)) : null;
    if (truthy(why)) item["reason"] = why;                  // a recruit of yours who went elsewhere: why not you
    if (truthy(get(e, "line"))) item["line"] = e["line"];   // a bloomer's jump, a two-sport star going pro, a twist, a hat ceremony: the log's own sentence
    items.push(item);
  }
  for (const g of Object.values(state["games"])) {
    if (!truthy(get(g, "played")) || !(me === g["home"] || me === g["away"]) || g["week"] <= week - office.NEWS_WEEKS) continue;
    const home = g["home"] === me;
    const [pf, pa] = home ? [g["home_score"], g["away_score"]] : [g["away_score"], g["home_score"]];
    const opp = home ? g["away"] : g["home"];
    items.push({ week: g["week"], kind: "game", event_id: g["event_id"], won: pf > pa, points_for: pf, points_against: pa,
      opponent: opp, opponent_name: season.team_display(opp, teams),
      venue: truthy(get(g, "neutral")) ? "neutral" : home ? "home" : "away", overtime: get(g, "overtime") || 0 });
  }
  items = items.concat(promises.news(state).filter((n) => n["week"] > week - office.NEWS_WEEKS));     // a promised start slipping: he says so
  items = items.concat(ability_goals.news(state).filter((n) => n["week"] > week - office.NEWS_WEEKS));   // an ability he earned
  // newest week first; inside a week your game, then commitments to you, then the rest by weight
  const rank = (kind) => { const i = office._NEWS_ORDER.indexOf(kind); return i === -1 ? 99 : i; };
  const key = (x) => [-x["week"], x["kind"] !== "game", !truthy(get(x, "yours")), rank(x["kind"])];
  items.sort((a, b) => cmp(key(a), key(b)));
  // one line a prospect a week: the biggest
  const seen = new Set(), out = [];
  for (const x of items) {
    const at = JSON.stringify([x["week"], get(x, "pid") || get(x, "event_id") || get(x, "slug"), get(x, "trait")]);
    if (seen.has(at)) continue;
    seen.add(at);
    out.push(x);
  }
  return out.slice(0, office.NEWS_ITEMS);
}

export function conference_view(state) {
  // Your conference's latest played week (conference games first, at most CONF_GAMES) and your standing row.
  const season = modules.season;
  const teams = season.load_teams();
  const me = state["team"];
  const conf = teams[me]["conference"];
  const members = new Set();
  for (const [s, t] of Object.entries(teams)) if (t["conference"] === conf && !truthy(t["fictional"])) members.add(s);
  const played = Object.values(state["games"]).filter((g) => truthy(get(g, "played")) && (members.has(g["home"]) || members.has(g["away"])));
  let latest = null;
  for (const g of played) if (latest === null || g["week"] > latest) latest = g["week"];
  const games = [];
  if (latest !== null) {
    const week_games = played.filter((g) => g["week"] === latest);
    const key = (g) => [!truthy(get(g, "conference_game")), !(me === g["home"] || me === g["away"]), g["event_id"]];
    week_games.sort((a, b) => cmp(key(a), key(b)));
    for (const g of week_games.slice(0, office.CONF_GAMES)) {
      games.push({ event_id: g["event_id"], week: g["week"], home: g["home"], away: g["away"],
        home_name: season.team_display(g["home"], teams), away_name: season.team_display(g["away"], teams),
        home_score: g["home_score"], away_score: g["away_score"], overtime: get(g, "overtime") || 0,
        mine: me === g["home"] || me === g["away"], conference_game: truthy(get(g, "conference_game")) });
    }
  }
  const rows = get(season.standings(state), conf) || [];
  const row = rows.find((r) => r["slug"] === me) ?? null;
  let standing = null;
  if (row !== null) {
    const group = rows.filter((r) => get(r, "division") === get(row, "division"));
    standing = { slug: me, conf_rank: row["conf_rank"], of: group.length, division: get(row, "division"),
      wins: row["wins"], losses: row["losses"], conf_wins: row["conf_wins"], conf_losses: row["conf_losses"] };
  }
  return { name: conf, week: latest, games, standing,
    independent: conf.toLowerCase().includes("independent") };
}

export function office_view(state) {
  const season = modules.season;
  const hc = get(get(season.team_data(state, state["team"]), "coaches") || {}, "head_coach") || {};
  // you, for your coach's card: your ratings as a head coach (the league's in a later season, the teams file's before)
  const out = { news: office.program_news(state), conference: office.conference_view(state), word: word.view(state) };
  const ratings = {};
  for (const [k, v] of Object.entries(get(hc, "ratings") || {})) if (isNumber(v)) ratings[k] = v;
  out["coach"] = { ratings };
  out["pressed"] = modules.recruiting.pressed_commits(state);     // your commits another school is still calling (recruiting part 7)
  return out;
}

export const office = { NEWS_ITEMS, CONF_GAMES, NEWS_WEEKS, _NEWS_ORDER, _school_name, program_news, conference_view, office_view };
modules.office = office;
