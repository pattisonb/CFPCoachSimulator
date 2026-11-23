// Around-the-league news while the weeks sim: the few results, poll moves, big games, streaks,
// five-star commitments and starting-QB injuries worth a bubble on the page. Read only: the news
// is built from the played games, the AP polls, the box scores, the public recruiting log and the
// injury lines in the box scores; nothing here draws a random number or writes to the season.
//
// `league_news(state, since_week)` returns the items for the finished weeks after `since_week`,
// oldest week first and the most important first inside a week, at most NEWS_PER_WEEK a week.
// Each item is {week, kind, text, team?, link?}; `link` is {"type": "game", "event_id"},
// {"type": "team", "slug"} or {"type": "recruit", "pid"}. Your own team's items are left out,
// except an upset either way.
//
// The season is reached as `modules.season` at each call
// (the modules import each other in circles), and career_js/persona.js as `modules.persona`.
import { round, int, floordiv, sum, sorted, cmp, get, truthy, range } from "../engine_js/pyrt.js";
import { modules } from "../engine_js/modules.js";

/** `k in d` for a dict. */
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// The module's namespace: its constants and its cache live here and are read from here (a caller may tune one).
export const news = {};

news.NEWS_PER_WEEK = 6;           // *tune* the most items one week shows
news.UPSET_CHANCE = 0.19;         // *tune* a winner given this chance or less before the game won an upset (about a 14-point underdog)
news.UPSET_TOP = 10;              // *tune* an unranked team beating a team ranked this high or higher is an upset
news.TOP_N = 5;                   // *tune* entering or leaving this top of the AP poll is news
news.BIG_PASS = 400;              // *tune* passing yards in one game that make news
news.BIG_RUSH = 200;              // *tune* rushing yards in one game that make news
news.BIG_TDS = 5;                 // *tune* total touchdowns (pass, rush, catch) by one player in one game
news.BIG_SACKS = 3;               // *tune* sacks by one player in one game
news.STREAK = 8;                  // *tune* a team reaching STREAK-0, or losing its first game after STREAK or more wins
news.KIND_MAX = { big_game: 3, recruiting: 3 };   // *tune* the most items of one kind a week (room for the rest)

news.KINDS = ["upset", "rankings", "big_game", "streak", "recruiting", "injury"];

// importance: the score each kind starts from (the item's own details add a little)
news._BASE = { rankings_no1: 95, upset: 80, recruiting_flip: 72, recruiting: 68, injury: 64, streak: 60,
  rankings: 55, big_game: 45 };

// (season id, year, week) -> that week's items, once the week is over. (A Map, keyed by
// `_cache_key`'s text of the three: `news._cache.clear()` empties it.)
news._cache = new Map();
const _cache_key = (id, year, week) => JSON.stringify([id, year, week]);

export function _name(teams, slug) {
  return modules.season.team_display(slug, teams);
}

export function _ap_rank(state, after_week) {
  // Team -> AP rank in the poll released after `after_week` (the preseason poll for 0).
  const p = get(state["polls"], String(after_week)) || {};
  const out = {};
  for (const e of get(p, "ap", [])) out[e["team"]] = e["rank"];
  return out;
}

export function _ranked(name, rank) {
  return truthy(rank) ? `No. ${rank} ${name}` : name;
}

export function _pregame_chance(teams, g, side) {
  // The side's chance before the game, from the two teams' overall ratings (the same
  // estimate the morale and the bracket projection use).
  // (0.5 when a team, its ratings or the game's `neutral` is missing, or a rating is not a number)
  const home = get(get(get(teams, g["home"]) || {}, "team_ratings") || {}, "overall");
  const away = get(get(get(teams, g["away"]) || {}, "team_ratings") || {}, "overall");
  if (typeof home !== "number" || typeof away !== "number" || g["neutral"] === undefined) return 0.5;
  const edge = (home - away) / 60
    + (truthy(g["neutral"]) ? 0.0 : 0.04);
  const p_home = Math.max(0.05, Math.min(0.95, 0.5 + edge));
  return side === "home" ? p_home : 1.0 - p_home;
}

news.LATE_FROM_WEEK = 12;        // *tune* from this week a new blue-blood offer is "late" in the news (recruiting's late market)

export function _when(day) {
  // A week inside a sentence ("at a hat ceremony in Week 9", "during the semifinals"): the postseason's week labels
  // are tab titles ("Semifinals & New Year Bowls") and do not follow "in".
  const season = modules.season;
  if (day === season.CCG_WEEK) return "during Championship Week";
  if (day === season.SELECTION_WEEK) return "during Selection Week";
  return get({ 17: "during the first round of the playoff", 18: "during the quarterfinals", 19: "during the semifinals",
    20: "the week of the national championship" }, day) || `in ${season.week_label(day)}`;
}

export function _score(g, winner_home) {
  const [hi, lo] = winner_home ? [g["home_score"], g["away_score"]] : [g["away_score"], g["home_score"]];
  return `${hi}-${lo}` + (truthy(get(g, "overtime")) ? " in overtime" : "");
}

export function _upsets(state, teams, fbs, week, games) {
  const rank = news._ap_rank(state, week - 1);
  const out = [];
  for (const g of games) {
    if (!fbs.has(g["home"]) || !fbs.has(g["away"])) continue;
    const home_won = g["home_score"] > g["away_score"];
    const [w_side, l_side] = home_won ? ["home", "away"] : ["away", "home"];
    const w = g[w_side], l = g[l_side];
    const wr = get(rank, w), lr = get(rank, l);
    const chance = news._pregame_chance(teams, g, w_side);
    const unranked_over_top = wr === null && lr !== null && lr <= news.UPSET_TOP;
    const long_shot = chance <= news.UPSET_CHANCE && !(wr !== null && lr !== null && wr < lr);
    if (!(unranked_over_top || long_shot)) continue;
    const wn = news._name(teams, w), ln = news._name(teams, l);
    const lead = wr === null && lr !== null ? `Unranked ${wn}` : news._ranked(wn, wr);
    // "stuns" only a real long shot: an unranked team the game itself made a slight favorite "knocks off" a ranked one
    const text = `${lead} ${chance <= news.UPSET_CHANCE ? "stuns" : "knocks off"} ${news._ranked(ln, lr)} ${news._score(g, home_won)}.`;
    const imp = news._BASE["upset"] + (truthy(lr) && lr <= news.UPSET_TOP ? news.UPSET_TOP + 1 - lr : 0)
      + round(10 * (news.UPSET_CHANCE - Math.min(chance, news.UPSET_CHANCE)) / news.UPSET_CHANCE);
    out.push({ kind: "upset", text, team: w, teams: [w, l], link: { type: "game", event_id: g["event_id"] }, _imp: imp });
  }
  return out;
}

export function _rankings(state, teams, week) {
  if (!own(state["polls"], String(week)) || !truthy(get(state["polls"][String(week)], "ap"))) return [];
  // the poll before this one, however far back (the final poll follows three weeks without one: read against an
  // empty poll, every team "moved into the top 5")
  let prev = null;
  for (let w = week - 1; w > -1; w--) {
    if (truthy(get(get(state["polls"], String(w)) || {}, "ap"))) { prev = w; break; }
  }
  if (prev === null) return [];
  const before = news._ap_rank(state, prev), after = news._ap_rank(state, week);
  const out = [];
  const first_at_one = (ranks) => { for (const [t, r] of Object.entries(ranks)) if (r === 1) return t; return null; };
  const new_one = first_at_one(after);
  const old_one = first_at_one(before);
  if (truthy(new_one) && truthy(old_one) && new_one !== old_one) {
    out.push({ kind: "rankings", text: `${news._name(teams, new_one)} takes over at No. 1 in the AP poll.`, team: new_one,
      teams: [new_one], link: { type: "team", slug: new_one }, _imp: news._BASE["rankings_no1"] });
  }
  for (const [t, r] of sorted(Object.entries(after), (x) => x[1])) {
    if (r <= news.TOP_N && t !== new_one && (get(before, t) === null || before[t] > news.TOP_N)) {
      out.push({ kind: "rankings", text: `${news._name(teams, t)} moves into the top ${news.TOP_N} at No. ${r}.`, team: t,
        teams: [t], link: { type: "team", slug: t }, _imp: news._BASE["rankings"] + news.TOP_N - r });
    }
  }
  for (const [t, r] of sorted(Object.entries(before), (x) => x[1])) {
    const now = get(after, t);
    if (r <= news.TOP_N && (now === null || now > news.TOP_N)) {
      const where = truthy(now) ? `to No. ${now}` : "out of the poll";
      out.push({ kind: "rankings", text: `${news._name(teams, t)} drops out of the top ${news.TOP_N}, ${where}.`, team: t,
        teams: [t], link: { type: "team", slug: t }, _imp: news._BASE["rankings"] - 2 });
    }
  }
  return out;
}

export function _player_side(box, side) {
  return get(get(box, side) || {}, "players") || [];
}

export function _big_games(state, teams, fbs, games, boxes) {
  const out = [];
  for (const g of games) {
    const box = get(boxes, g["event_id"]);
    if (box === null || !fbs.has(g["home"]) || !fbs.has(g["away"])) continue;   // FCS stand-ins never make the news, nor stats padded against them
    let best = null;                   // one line a game: its biggest
    for (const [side, opp] of [["home", "away"], ["away", "home"]]) {
      const slug = g[side], other = g[opp];
      for (const p of news._player_side(box, side)) {
        const st = get(p, "stats") || {};
        const tds = int(get(st, "passing_touchdowns", 0) + get(st, "rushing_touchdowns", 0) + get(st, "receiving_touchdowns", 0));
        const sacks = get(st, "sacks", 0) || 0;
        const who = `${news._name(teams, slug)} ${p["position"]} ${p["name"]}`;
        const vs = `against ${news._name(teams, other)}`;
        let line = null, extra;
        if (get(st, "pass_yards", 0) >= news.BIG_PASS) {
          [line, extra] = [`${who} throws for ${st["pass_yards"]} yards ${vs}.`, st["pass_yards"] - news.BIG_PASS];
        } else if (get(st, "rush_yards", 0) >= news.BIG_RUSH) {
          [line, extra] = [`${who} runs for ${st["rush_yards"]} yards ${vs}.`, st["rush_yards"] - news.BIG_RUSH];
        } else if (tds >= news.BIG_TDS) {
          [line, extra] = [`${who} accounts for ${tds} touchdowns ${vs}.`, 20 * (tds - news.BIG_TDS)];
        } else if (sacks >= news.BIG_SACKS) {
          const n = sacks;             // (a whole count is shown without a ".0")
          [line, extra] = [`${who} records ${n} sacks ${vs}.`, 20 * (sacks - news.BIG_SACKS)];
        }
        if (truthy(line)) {
          const item = { kind: "big_game", text: line, team: slug, teams: [slug],
            link: { type: "game", event_id: g["event_id"] }, _imp: news._BASE["big_game"] + Math.min(15, round(extra / 10)) };
          if (slug !== state["team"] && (best === null || item["_imp"] > best["_imp"])) best = item;
        }
      }
    }
    if (best !== null) out.push(best);
  }
  return out;
}

export function _streaks(state, teams, fbs, week, games) {
  const season = modules.season;
  const after = season._records(state, week);
  const before = season._records(state, week - 1);
  const out = [];
  for (const g of games) {
    if (g["kind"] === "playoff") continue;
    for (const [side, opp] of [["home", "away"], ["away", "home"]]) {
      const slug = g[side];
      if (!fbs.has(slug)) continue;
      const b = get(before, slug), a = get(after, slug);
      if (!truthy(a) || !truthy(b)) continue;
      const won = (g["home_score"] > g["away_score"]) === (side === "home");
      if (won && a["losses"] === 0 && a["wins"] === news.STREAK) {
        out.push({ kind: "streak", text: `${news._name(teams, slug)} moves to ${news.STREAK}-0.`, team: slug, teams: [slug],
          link: { type: "team", slug }, _imp: news._BASE["streak"] });
      } else if (!won && b["losses"] === 0 && b["wins"] >= news.STREAK) {
        const hs = `${Math.max(g["home_score"], g["away_score"])}-${Math.min(g["home_score"], g["away_score"])}` + (truthy(get(g, "overtime")) ? " overtime" : "");
        out.push({ kind: "streak", text: `Unbeaten ${news._name(teams, slug)} falls to ${a["wins"]}-1 with a ${hs} loss to ${modules.season.team_in_line(g[opp], teams)}.`,
          team: slug, teams: [slug], link: { type: "game", event_id: g["event_id"] }, _imp: news._BASE["streak"] + 4 });
      }
    }
  }
  return out;
}

news.STAR_WORDS = { 2: "Two-star", 3: "Three-star", 4: "Four-star", 5: "Five-star" };

export function _recruiting(state, teams, week) {
  const rc = get(state, "recruiting");
  if (!truthy(rc)) return [];
  const persona = modules.persona;
  const out = [];
  for (const e of get(rc, "log") || []) {
    if (get(e, "week") !== week || !["commit", "flip", "bloomed", "pro", "twist", "hat"].includes(get(e, "kind"))) continue;
    if (truthy(get(e, "quiet")) || truthy(get(e, "private"))) continue;     // a Quiet Commit stays out of the news; a twist he told one school is that school's
    const pid = get(e, "pid");
    const p = pid === null ? null : get(get(rc, "prospects") || {}, pid);
    const school = get(e, "school");
    if (!truthy(p)) continue;
    const stars = get(p, "stars") === null ? "" : get(news.STAR_WORDS, p["stars"], "");
    const link = { type: "recruit", pid: e["pid"] };
    const blue = (get(p, "stars") || 0) >= 4;
    const in_teams = (s) => typeof s === "string" && own(teams, s);
    if (e["kind"] === "hat") {                 // a blue chip names his finalists and his day
      const fin = (get(e, "finalists") || []).filter((s) => in_teams(s)).map((s) => news._name(teams, s));
      if (blue && fin.length > 1) {
        const said = fin.length === 2 ? fin.join(" and ") : `${fin.slice(0, -1).join(", ")} and ${fin[fin.length - 1]}`;
        out.push({ kind: "recruiting", text: `${stars} ${p["position"]} ${p["name"]} will choose from ${said} at a hat ceremony ${news._when(e["day"])}.`,
          team: null, teams: [...(get(e, "finalists") || [])], link, _imp: news._BASE["recruiting"] - 4 + p["stars"] });
      }
      continue;
    }
    if (e["kind"] === "twist") {               // a blue blood's late offer or a surprise visit to a blue chip
      if (blue && in_teams(school) && !truthy(get(teams[school], "fictional")) && ["late_offer", "surprise"].includes(get(e, "twist"))) {
        // "late" only once it is: the same offer in September is a school jumping in (the player's catch)
        const jumps = week >= news.LATE_FROM_WEEK ? "jumps in late for" : "jumps in for";
        const verb = e["twist"] === "late_offer" ? jumps : "makes a surprise visit to";
        if (truthy(get(e, "end"))) continue;   // your call knocked the surprise school back out: not news
        out.push({ kind: "recruiting", text: `${news._name(teams, school)} ${verb} ${stars.toLowerCase()} ${p["position"]} ${p["name"]}.`,
          team: school, teams: [], link, _imp: news._BASE["recruiting"] - 5 + p["stars"] });
      }
      continue;
    }
    if (e["kind"] === "bloomed") {             // his story: a late bloomer's jump to a blue chip
      if ((get(p, "stars") || 0) >= 4) {
        out.push({ kind: "recruiting", text: `Late bloomer ${p["position"]} ${p["name"]} jumps to ${stars.toLowerCase().replaceAll("-star", "")} stars.`,
          team: null, teams: [], link, _imp: news._BASE["recruiting"] - 4 + p["stars"] });
      }
      continue;
    }
    if (!truthy(school) || !in_teams(school) || truthy(get(teams[school], "fictional"))) continue;
    if (e["kind"] === "pro") {                 // a blue-chip two-sport star takes the baseball money
      if ((get(p, "stars") || 0) >= 4) {
        out.push({ kind: "recruiting", text: `${stars} ${p["position"]} ${p["name"]} picks pro baseball over ${news._name(teams, school)}.`,
          team: school, teams: [], link, _imp: news._BASE["recruiting"] - 2 + p["stars"] });
      }
      continue;
    }
    const [k, d] = persona.story(state, e["pid"]);
    if (k === "hero" && e["kind"] === "commit") {          // a hometown hero's commitment makes the news, whatever his stars
      const home = get(teams[school], "state") === persona.hero_state(state, e["pid"], d);
      const text = (home ? `Hometown hero ${p["position"]} ${p["name"]} stays home with ${news._name(teams, school)}.`
        : `Hometown hero ${p["position"]} ${p["name"]} leaves home for ${news._name(teams, school)}.`);
      out.push({ kind: "recruiting", text, team: school, teams: [], link,
        _imp: news._BASE["recruiting"] - 10 + 2 * (get(p, "stars") || 2) });
      continue;
    }
    if (get(p, "stars") !== 5) continue;
    const who = `Five-star ${p["position"]} ${p["name"]}`;
    const old = get(e, "from");
    let text, imp;
    if (e["kind"] === "flip" && in_teams(old) && !truthy(get(teams[old], "fictional"))) {
      [text, imp] = [`${who} flips from ${news._name(teams, old)} to ${news._name(teams, school)}.`, news._BASE["recruiting_flip"]];
    } else if (truthy(get(e, "hat"))) {
      [text, imp] = [`${who} picks ${news._name(teams, school)} at his hat ceremony.`, news._BASE["recruiting"]];
    } else {
      [text, imp] = [`${who} commits to ${news._name(teams, school)}.`, news._BASE["recruiting"]];
    }
    out.push({ kind: "recruiting", text, team: school, teams: [], link: { type: "recruit", pid: e["pid"] }, _imp: imp });
  }
  return out;
}

export function _injuries(state, teams, fbs, week, games, boxes) {
  const rank = news._ap_rank(state, week - 1);
  const out = [];
  for (const g of games) {
    const box = get(boxes, g["event_id"]);
    if (box === null) continue;
    for (const side of ["home", "away"]) {
      const slug = g[side];
      if (!fbs.has(slug) || !own(rank, slug)) continue;
      const starters = new Set(news._player_side(box, side).filter((p) => get(p, "position") === "QB" && truthy(get(p, "starter"))).map((p) => p["name"]));
      for (const inj of get(get(box, side) || {}, "injuries") || []) {
        if (get(inj, "position") !== "QB" || !starters.has(get(inj, "name")) || (get(inj, "weeks") || 0) <= 0) continue;
        const wk = inj["weeks"];
        const span = wk >= 10 ? "for the season" : `for ${wk} week${wk !== 1 ? "s" : ""}`;
        const kind = truthy(get(inj, "type")) && wk < 10 ? ` with ${news._with(inj["type"])}` : "";    // out for the season: not "with back spasms"
        const text = `No. ${rank[slug]} ${news._name(teams, slug)} loses starting QB ${inj["name"]} ${span}${kind}.`;
        out.push({ kind: "injury", text, team: slug, teams: [slug], link: { type: "game", event_id: g["event_id"] },
          _imp: news._BASE["injury"] + floordiv(26 - rank[slug], 5) });
      }
    }
  }
  return out;
}

export function _with(injury) {
  // An injury after "with": "an ankle sprain", "a concussion", "back spasms" (a plural takes no article).
  if (injury.endsWith("s") && !injury.endsWith("ss")) return injury;
  return `${"aeiou".includes(injury[0]) ? "an" : "a"} ${injury}`;
}

export function week_news(state, week) {
  // The items for one finished week, the most important first, at most NEWS_PER_WEEK.
  const season = modules.season;
  const key = _cache_key(state["id"], season.season_year(state), week);
  if (news._cache.has(key)) return news._cache.get(key);
  const teams = season.load_teams();
  const fbs = season.fbs_only(teams);
  const games = Object.values(state["games"]).filter((g) => g["week"] === week && truthy(get(g, "played")));
  const boxes = {};
  for (const g of games) {
    if (fbs.has(g["home"]) && fbs.has(g["away"])) {
      const b = season.load_box(state, g["event_id"], true);      // read only, below
      if (b !== null) boxes[g["event_id"]] = b;
    }
  }
  let items = [...news._upsets(state, teams, fbs, week, games), ...news._rankings(state, teams, week), ...news._big_games(state, teams, fbs, games, boxes),
    ...news._streaks(state, teams, fbs, week, games), ...news._recruiting(state, teams, week), ...news._injuries(state, teams, fbs, week, games, boxes)];
  const me = state["team"];
  items = items.filter((i) => i["kind"] === "upset" || !i["teams"].includes(me));
  items.sort((a, b) => cmp(-a["_imp"], -b["_imp"]));                 // stable: the same order every time
  const seen = new Set(), out = [];
  for (const i of items) {
    if (seen.has(i["text"]) || sum(out.map((o) => o["kind"] === i["kind"])) >= get(news.KIND_MAX, i["kind"], news.NEWS_PER_WEEK)) continue;
    seen.add(i["text"]);
    const item = { week, kind: i["kind"], text: i["text"] };
    if (truthy(get(i, "team"))) item["team"] = i["team"];
    if (truthy(get(i, "link"))) item["link"] = i["link"];
    out.push(item);
    if (out.length >= news.NEWS_PER_WEEK) break;
  }
  news._cache.set(key, out);
  return out;
}

export function league_news(state, since_week) {
  // Every finished week's items after `since_week`, oldest week first.
  const out = [];
  for (const w of range(Math.max(0, since_week) + 1, state["current_week"] + 1)) out.push(...news.week_news(state, w));
  return out;
}

// ---- the Weekly Recap (GET /api/season/{id}/week_recap) -------------------------------------------------------
// One finished week told for the Recap page: your game and its standouts, the game of the week, the upsets, the
// biggest performances in the country, the poll's risers and fallers, and how the top 25 did. Read only, as the news is.

news.RECAP_BOOMS = 8;             // *tune* the most Boom Performances a week shows
news.RECAP_UPSETS = 6;            // *tune* the most upsets a week shows
news.RECAP_MOVERS = 5;            // *tune* the most risers, and the most fallers, a week shows
news.RECAP_STANDOUTS = 3;         // *tune* your own best lines in your game
news.RECAP_BOOM_FLOOR = 28;       // *tune* a line scoring under this is a good game, not a Boom
// what one of each is worth when a game's lines are ranked (a 300-yard, 3-touchdown passer is about 24)
news._BOOM = { pass_yards: 0.04, passing_touchdowns: 4, interceptions_thrown: -2, rush_yards: 0.1, rushing_touchdowns: 6,
  receptions: 0.5, receiving_yards: 0.1, receiving_touchdowns: 6, sacks: 5, tackles_for_loss: 2, solo_tackles: 1,
  assisted_tackles: 0.5, interceptions: 7, forced_fumbles: 4, passes_defended: 2, defensive_touchdowns: 6,
  kickoff_return_touchdowns: 6, punt_return_touchdowns: 6 };

export function _boom_score(st) {
  let s = 0.0;
  for (const [k, w] of Object.entries(news._BOOM)) s += w * (get(st, k, 0) || 0);
  return round(s, 1);
}

/** One player's game in a line: the numbers of his position, nothing he did not do. */
export function _game_stat_line(position, st) {
  const n = (k) => get(st, k, 0) || 0;
  const whole = (v) => (Number.isInteger(v) ? String(v) : String(round(v, 1)));
  const some = (v, one, many = null) => (v ? `${whole(v)} ${v === 1 ? one : many ?? one + "s"}` : null);
  const parts = [];
  if (n("pass_attempts") >= 5) {
    parts.push(`${n("completions")}/${n("pass_attempts")}`, `${n("pass_yards")} Yds`, `${n("passing_touchdowns")} TD`, `${n("interceptions_thrown")} INT`);
    if (n("rush_yards") >= 30 || n("rushing_touchdowns")) parts.push(`${n("rush_yards")} Rush Yds`, some(n("rushing_touchdowns"), "Rush TD"));
    return parts.filter(Boolean).join(", ");
  }
  if (n("carries") >= 5 && n("rush_yards") >= n("receiving_yards")) {
    parts.push(`${n("carries")} Car`, `${n("rush_yards")} Yds`, `${n("rushing_touchdowns")} TD`);
    if (n("receiving_yards") >= 30 || n("receiving_touchdowns")) parts.push(`${n("receptions")} Rec`, `${n("receiving_yards")} Rec Yds`, some(n("receiving_touchdowns"), "Rec TD"));
    return parts.filter(Boolean).join(", ");
  }
  if (n("receptions")) {
    parts.push(`${n("receptions")} Rec`, `${n("receiving_yards")} Yds`, `${n("receiving_touchdowns")} TD`);
    if (n("rush_yards") >= 30 || n("rushing_touchdowns")) parts.push(`${n("rush_yards")} Rush Yds`, some(n("rushing_touchdowns"), "Rush TD"));
    return parts.filter(Boolean).join(", ");
  }
  const tk = n("solo_tackles") + n("assisted_tackles");
  parts.push(some(tk, "Tackle"), some(n("sacks"), "Sack"), n("tackles_for_loss") ? `${whole(n("tackles_for_loss"))} TFL` : null,
    n("interceptions") ? `${n("interceptions")} INT` : null, n("passes_defended") ? `${n("passes_defended")} PBU` : null,
    n("forced_fumbles") ? `${n("forced_fumbles")} FF` : null, some(n("defensive_touchdowns"), "TD"));
  return parts.filter(Boolean).join(", ");
}

export function recap_weeks(state) {
  // The weeks with a finished game, oldest first.
  const out = new Set();
  for (const g of Object.values(state["games"])) if (truthy(get(g, "played"))) out.add(g["week"]);
  return sorted(Array.from(out));
}

export function week_recap(state, week = null) {
  const season = modules.season;
  const weeks = news.recap_weeks(state);
  if (!weeks.length) return { week: null, weeks: [], latest: null };
  const latest = weeks[weeks.length - 1];
  if (week === null || week === undefined || !weeks.includes(week)) week = latest;
  const teams = season.load_teams();
  const fbs = season.fbs_only(teams);
  const me = state["team"];
  const games = sorted(Object.values(state["games"]).filter((g) => g["week"] === week && truthy(get(g, "played"))), (g) => String(g["event_id"]));
  // the poll the week was played under, and the one it made (the nearest one either way: some weeks have no poll)
  const poll_at = (w, step) => {
    for (; w >= 0 && w <= latest + 1; w += step) if (truthy(get(get(state["polls"], String(w)) || {}, "ap"))) return w;
    return null;
  };
  const before_w = poll_at(week - 1, -1);
  const after_w = own(state["polls"], String(week)) && truthy(get(state["polls"][String(week)], "ap")) ? week : null;
  const before = before_w === null ? {} : news._ap_rank(state, before_w);
  const after = after_w === null ? null : news._ap_rank(state, after_w);
  const rank_of = (slug) => (own(before, slug) ? before[slug] : null);
  const abbr = (slug) => get(get(teams, slug) || {}, "abbreviation") || null;

  const line = (g) => {
    const home_won = g["home_score"] > g["away_score"];
    const [w, l] = home_won ? [g["home"], g["away"]] : [g["away"], g["home"]];
    return { event_id: g["event_id"], has_box: season.has_box(state, g), title: get(g, "title"), kind: get(g, "kind"),
      winner: w, loser: l, winner_name: season.team_display(w, teams), loser_name: season.team_display(l, teams),
      winner_rank: rank_of(w), loser_rank: rank_of(l), winner_score: Math.max(g["home_score"], g["away_score"]),
      loser_score: Math.min(g["home_score"], g["away_score"]), overtime: get(g, "overtime", 0) || 0,
      winner_home: home_won, neutral: truthy(get(g, "neutral")) };
  };

  // ---- the upsets: an unranked team over a ranked one, a ranked team over one well above it, or a real long shot
  const upsets = [];
  for (const g of games) {
    if (!fbs.has(g["home"]) || !fbs.has(g["away"])) continue;
    const l_ = line(g);
    const chance = news._pregame_chance(teams, g, l_["winner_home"] ? "home" : "away");
    const wr = l_["winner_rank"], lr = l_["loser_rank"];
    const over_ranked = wr === null && lr !== null;
    const long_shot = chance <= news.UPSET_CHANCE && !(wr !== null && lr !== null && wr < lr);
    if (!(over_ranked || long_shot)) continue;
    const size = (lr !== null ? 30 - lr : 0) + round(40 * Math.max(0, 0.5 - chance)) + (long_shot ? 10 : 0);
    upsets.push({ ...l_, chance: round(100 * chance), stunner: long_shot, _size: size });
  }
  upsets.sort((a, b) => cmp(-a["_size"], -b["_size"]));

  // ---- the game of the week: ranked teams, a close score, overtime, an upset (never your own: it has its banner)
  let gotw = null, gotw_score = -1;
  for (const g of games) {
    if (!fbs.has(g["home"]) || !fbs.has(g["away"]) || g["home"] === me || g["away"] === me) continue;
    const l_ = line(g);
    const margin = l_["winner_score"] - l_["loser_score"];
    const ranks = [l_["winner_rank"], l_["loser_rank"]].filter((r) => r !== null);
    const s = sum(ranks.map((r) => 30 - r)) + (ranks.length === 2 ? 25 : 0) + Math.max(0, 17 - margin) + 6 * l_["overtime"]
      + (upsets.some((u) => u["event_id"] === g["event_id"]) ? 20 : 0);
    if (s > gotw_score) {
      gotw_score = s;
      gotw = { ...l_, tag: upsets.some((u) => u["event_id"] === g["event_id"]) ? "upset" : l_["overtime"] ? "overtime"
        : ranks.length === 2 ? "ranked" : margin <= 7 ? "close" : null };
    }
  }

  // ---- the lines: every player's game from the box scores, scored; the best in the country, and your own best
  const booms = [], mine_lines = [];
  for (const g of games) {
    const involves_me = g["home"] === me || g["away"] === me;
    if (!(fbs.has(g["home"]) && fbs.has(g["away"])) && !involves_me) continue;
    const box = season.load_box(state, g["event_id"], true);
    if (box === null) continue;
    for (const [side, opp] of [["home", "away"], ["away", "home"]]) {
      const slug = g[side];
      if (!fbs.has(slug)) continue;
      const won = (g["home_score"] > g["away_score"]) === (side === "home");
      for (const p of news._player_side(box, side)) {
        const st = get(p, "stats") || {};
        const score = news._boom_score(st);
        if (score <= 0) continue;
        const text = news._game_stat_line(p["position"], st);
        if (!text) continue;
        const row = { team: slug, team_name: news._name(teams, slug), name: p["name"], position: p["position"], line: text,
          opponent: g[opp], opponent_abbr: abbr(g[opp]), opponent_name: season.team_display(g[opp], teams), won,
          event_id: g["event_id"], mine: slug === me, _score: score };
        if (slug === me) mine_lines.push(row);
        if (fbs.has(g[opp]) && score >= news.RECAP_BOOM_FLOOR) booms.push(row);      // never stats padded against a stand-in
      }
    }
  }
  const by_score = (a, b) => cmp(-a["_score"], -b["_score"]) || cmp(a["name"], b["name"]);
  booms.sort(by_score);
  mine_lines.sort(by_score);
  const bare = (rows) => rows.map((r) => { const o = { ...r }; delete o["_score"]; delete o["_size"]; return o; });

  // ---- the poll: who rose and fell, who came in and who dropped out
  const risers = [], fallers = [], entered = [], dropped = [];
  let poll = [];
  if (after !== null) {
    poll = state["polls"][String(after_w)]["ap"];
    for (const e of poll) {
      const was = own(before, e["team"]) ? before[e["team"]] : null;
      const row = { team: e["team"], name: e["name"], rank: e["rank"], previous: was, record: get(e, "record"), move: was === null ? null : was - e["rank"] };
      if (was === null) entered.push(row);
      else if (row["move"] > 0) risers.push(row);
      else if (row["move"] < 0) fallers.push(row);
    }
    for (const [t, r] of sorted(Object.entries(before), (x) => x[1])) {
      if (!own(after, t)) dropped.push({ team: t, name: news._name(teams, t), rank: null, previous: r, record: null, move: null });
    }
    risers.sort((a, b) => cmp(-a["move"], -b["move"]) || cmp(a["rank"], b["rank"]));
    fallers.sort((a, b) => cmp(a["move"], b["move"]) || cmp(a["rank"], b["rank"]));
  }

  // ---- how the top 25 did
  const scores = [];
  for (const g of games) {
    for (const [side, opp] of [["home", "away"], ["away", "home"]]) {
      const r = rank_of(g[side]);
      if (r === null) continue;
      const [pf, pa] = season._scores_for(g, side === "home");
      scores.push({ rank: r, team: g[side], name: news._name(teams, g[side]), won: pf > pa, points_for: pf, points_against: pa,
        opponent: g[opp], opponent_name: season.team_display(g[opp], teams), opponent_rank: rank_of(g[opp]),
        venue: season._venue(g, side === "home"), overtime: get(g, "overtime", 0) || 0, event_id: g["event_id"], has_box: season.has_box(state, g) });
    }
  }
  scores.sort((a, b) => cmp(a["rank"], b["rank"]));

  // ---- your week
  const mg = games.find((g) => g["home"] === me || g["away"] === me);
  let my_game = null;
  if (mg !== undefined) {
    const home = mg["home"] === me, opp = home ? mg["away"] : mg["home"];
    const [pf, pa] = season._scores_for(mg, home);
    my_game = { event_id: mg["event_id"], has_box: season.has_box(state, mg), title: get(mg, "title"), opponent: opp,
      opponent_abbr: abbr(opp), opponent_name: season.team_display(opp, teams), opponent_rank: rank_of(opp), venue: season._venue(mg, home),
      won: pf > pa, points_for: pf, points_against: pa, overtime: get(mg, "overtime", 0) || 0 };
  }
  const rec = get(season._records(state, week, true), me);
  const mine = { game: my_game, record: truthy(rec) ? season._record_str(rec) : null, rank_before: rank_of(me),
    rank: after !== null ? (own(after, me) ? after[me] : null) : rank_of(me), standouts: bare(mine_lines.slice(0, news.RECAP_STANDOUTS)) };

  return { week, weeks, latest, year: season.season_year(state), mine, game_of_week: gotw,
    upsets: bare(upsets.slice(0, news.RECAP_UPSETS)), booms: bare(booms.slice(0, news.RECAP_BOOMS)),
    risers: risers.slice(0, news.RECAP_MOVERS), fallers: fallers.slice(0, news.RECAP_MOVERS), entered, dropped,
    has_poll: after !== null, top_five: poll.slice(0, 5).map((e) => ({ team: e["team"], name: e["name"], rank: e["rank"],
      previous: own(before, e["team"]) ? before[e["team"]] : null, record: get(e, "record") })), scores,
    news: news.week_news(state, week).filter((i) => ["recruiting", "injury", "streak"].includes(i["kind"])) };
}

// ---- the Players of the Week (GET /api/season/{id}/week_awards) -----------------------------------------------
// One finished week's honors for the Awards page (the player's design): the national Offensive, Defensive and
// Special Teams Player of the Week, and the same three in each conference. Read only: each is the best line of its
// kind in the week's box scores, a winner's line worth a little more, a tie going to the name first in the alphabet.

news.POTW_WIN = 1.12;             // *tune* a line in a win is worth this much more
news.POTW_ALSO = 2;               // *tune* how many more are named under a national winner
news._POTW = {
  offense: { pass_yards: 0.04, passing_touchdowns: 4, interceptions_thrown: -2, rush_yards: 0.1, rushing_touchdowns: 6,
    receptions: 0.5, receiving_yards: 0.1, receiving_touchdowns: 6 },
  defense: { sacks: 5, tackles_for_loss: 2, solo_tackles: 1, assisted_tackles: 0.5, interceptions: 7, forced_fumbles: 4,
    passes_defended: 2, defensive_touchdowns: 6 },
  special: { fg_made: 3, fg_50_made: 2, pat_made: 0.5, punts_inside_20: 1.5, kickoff_return_yards: 0.08, punt_return_yards: 0.12,
    kickoff_return_touchdowns: 7, punt_return_touchdowns: 7 },
};
news.POTW_KINDS = ["offense", "defense", "special"];

export function _potw_score(kind, st) {
  let s = 0.0;
  for (const [k, w] of Object.entries(news._POTW[kind])) s += w * (get(st, k, 0) || 0);
  if (kind === "special") {
    s -= 2 * Math.max(0, (get(st, "fg_attempted", 0) || 0) - (get(st, "fg_made", 0) || 0));       // a miss costs
    const punts = get(st, "punts", 0) || 0;
    if (punts >= 3) s += 0.4 * Math.max(0, (get(st, "punt_yards", 0) || 0) / punts - 40);              // a punter's average over 40
  }
  return round(s, 2);
}

/** A kicker's, a punter's or a returner's game in a line. */
export function _special_line(st) {
  const n = (k) => get(st, k, 0) || 0;
  const parts = [];
  if (n("fg_attempted") || n("pat_attempts")) {
    parts.push(`${n("fg_made")}/${n("fg_attempted")} FG`);
    if (n("long_fg")) parts.push(`Long ${n("long_fg")}`);
    if (n("pat_attempts")) parts.push(`${n("pat_made")}/${n("pat_attempts")} PAT`);
  }
  if (n("punts")) {
    parts.push(`${n("punts")} ${n("punts") === 1 ? "Punt" : "Punts"}`, `${(n("punt_yards") / n("punts")).toFixed(1)} Avg`);
    if (n("punts_inside_20")) parts.push(`${n("punts_inside_20")} Inside 20`);
  }
  const ret = n("kickoff_returns") + n("punt_returns");
  if (ret) {
    const td = n("kickoff_return_touchdowns") + n("punt_return_touchdowns");
    parts.push(`${ret} ${ret === 1 ? "Return" : "Returns"}`, `${n("kickoff_return_yards") + n("punt_return_yards")} Yds`);
    if (td) parts.push(`${td} TD`);
  }
  return parts.join(", ");
}

export function week_awards(state, week = null) {
  const season = modules.season;
  const weeks = news.recap_weeks(state);
  if (!weeks.length) return { week: null, weeks: [], latest: null, national: null, conferences: [] };
  const latest = weeks[weeks.length - 1];
  if (week === null || week === undefined || !weeks.includes(week)) week = latest;
  const teams = season.load_teams();
  const fbs = season.fbs_only(teams);
  const me = state["team"];
  const rank = news._ap_rank(state, week - 1);
  const games = sorted(Object.values(state["games"]).filter((g) => g["week"] === week && truthy(get(g, "played"))), (g) => String(g["event_id"]));
  const rows = { offense: [], defense: [], special: [] };
  for (const g of games) {
    if (!fbs.has(g["home"]) || !fbs.has(g["away"])) continue;          // never a line padded against a stand-in
    const box = season.load_box(state, g["event_id"], true);
    if (box === null) continue;
    for (const [side, opp] of [["home", "away"], ["away", "home"]]) {
      const slug = g[side];
      const won = (g["home_score"] > g["away_score"]) === (side === "home");
      const [pf, pa] = season._scores_for(g, side === "home");
      for (const p of news._player_side(box, side)) {
        const st = get(p, "stats") || {};
        for (const kind of news.POTW_KINDS) {
          if (kind !== "special" && get(p, "unit") !== kind) continue;
          const score = news._potw_score(kind, st) * (won ? news.POTW_WIN : 1.0);
          if (score <= 0) continue;
          const text = kind === "special" ? news._special_line(st) : news._game_stat_line(p["position"], st);
          if (!text) continue;
          rows[kind].push({ team: slug, team_name: news._name(teams, slug), team_rank: own(rank, slug) ? rank[slug] : null,
            conference: get(teams[slug], "conference") || null, name: p["name"], position: p["position"], line: text,
            opponent: g[opp], opponent_abbr: get(get(teams, g[opp]) || {}, "abbreviation") || null,
            opponent_name: season.team_display(g[opp], teams), won, points_for: pf, points_against: pa,
            event_id: g["event_id"], mine: slug === me, _score: score });
        }
      }
    }
  }
  const bare = (r) => { if (r === null || r === undefined) return null; const o = { ...r }; delete o["_score"]; return o; };
  const national = {}, by_conf = {};
  for (const kind of news.POTW_KINDS) {
    rows[kind].sort((a, b) => cmp(-a["_score"], -b["_score"]) || cmp(a["name"], b["name"]) || cmp(a["team"], b["team"]));
    national[kind] = { winner: bare(rows[kind][0]), also: rows[kind].slice(1, 1 + news.POTW_ALSO).map(bare) };
    for (const r of rows[kind]) {
      if (r["conference"] === null) continue;
      if (!own(by_conf, r["conference"])) by_conf[r["conference"]] = {};
      if (!own(by_conf[r["conference"]], kind)) by_conf[r["conference"]][kind] = bare(r);       // the first is the best
    }
  }
  const mine_conf = get(state, "conference") || get(get(teams, me) || {}, "conference") || null;
  const conferences = sorted(Object.keys(by_conf), (c) => [c === mine_conf ? 0 : 1, c]).map((c) => ({ conference: c, mine: c === mine_conf,
    offense: get(by_conf[c], "offense"), defense: get(by_conf[c], "defense"), special: get(by_conf[c], "special") }));
  return { week, weeks, latest, year: season.season_year(state), national, conferences };
}

Object.assign(news, {
  _boom_score, _game_stat_line, recap_weeks, week_recap, _potw_score, _special_line, week_awards,
  _name, _ap_rank, _ranked, _pregame_chance, _when, _score, _upsets, _rankings, _player_side, _big_games, _streaks, _recruiting,
  _injuries, _with, week_news, league_news,
});

modules.news = news;
