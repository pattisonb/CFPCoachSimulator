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

Object.assign(news, {
  _name, _ap_rank, _ranked, _pregame_chance, _when, _score, _upsets, _rankings, _player_side, _big_games, _streaks, _recruiting,
  _injuries, _with, week_news, league_news,
});

modules.news = news;
