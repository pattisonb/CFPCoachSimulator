// Promises judged all season (docs/superpowers/specs/2026-11-10-promises-expansion-design.md, sections 2-4).
//
// A starting role you promised a player (at Keep Them Home, to a recruit or to a portal signee: his league roster row's
// `promised` is the season it is for) is judged week by week. Before each week's games the career records whether he
// starts (`snapshot_week`, sim/season.advance); his `score` weighs late weeks and big games more, a benching in a big game
// (more for a quarterback) costs extra, and a week he is injured does not count. His personality sets the bar (`BANDS`):
// the score lands Kept, Bent or Broken, read by the offseason (offseason.portal_odds, Keep Them Home) and shown during the
// season as a chip (`chip`: On Track, Slipping, Broken).
import { round, int, sum, get, truthy } from "../engine_js/pyrt.js";
import { modules } from "../engine_js/modules.js";

/** d.get(k, default) for one of this file's own tables asked with a key from outside: only a key the table holds. */
const own = (o, k, d = null) => (typeof k === "string" && Object.hasOwn(o, k) ? o[k] : d);
/** d.setdefault(k, default) */
const setdefault = (o, k, d) => (o[k] === undefined ? (o[k] = d) : o[k]);

const LATE_WEIGHT = 2.0;          // *tune* week i of n weighs 1 + LATE_WEIGHT * i / (n - 1): how it ends counts most
const BIG_WEIGHT = 2.0;           // *tune* a big game (rivalry, ranked opponent, title game, bowl, playoff) weighs this much more
const BENCH_HIT = 0.15;           // *tune* score lost when he started earlier and sat a later big game while healthy
const POSITION_HIT = { QB: 1.5, OL: 0.6, K: 0.5, P: 0.5 };    // *tune* scales BENCH_HIT by his position group (others 1.0)
const BANDS = { default: [0.60, 0.35], cocky: [0.75, 0.50], shy: [0.50, 0.25] };   // *tune* [kept at, broken under] by personality
const ATTENTION_BIG = 2.0;        // *tune* a Loves the Attention player's big games weigh this much more again
const COCKY_HIT = 1.5;            // *tune* a Cocky player's big-game benching costs this much more
const CHIPS = { kept: "On Track", bent: "Slipping", broken: "Broken" };

export function record(state) {
  // The season-by-season record: str(year) -> slug -> [{"week", "started", "injured", "big"}]. Creates it: only the
  // weekly snapshot writes (the reads use `_seen`).
  return setdefault(state, "promises", {});
}

export function _seen(state) {
  // The record, read only (a view must not write an empty one into the save).
  return get(state, "promises") || {};
}

export function _group(position) {
  const offseason = modules.offseason;
  return own(offseason.GROUP, position, position);
}

export function benched_big(weeks) {
  // He started some week and then sat a later big game while healthy.
  let started = false;
  for (const w of weeks) {
    if (truthy(w["injured"])) continue;
    if (truthy(w["started"])) started = true;
    else if (truthy(w["big"]) && started) return true;
  }
  return false;
}

export function strain(state, year, slug) {
  // How many times you promised his job to someone else this year (Promise Him the Job): read only.
  return int(get(get(get(state, "promise_strain") || {}, String(year)) || {}, slug, 0));
}

export function add_strain(state, year, slug) {
  const by = setdefault(setdefault(state, "promise_strain", {}), String(year), {});
  by[slug] = get(by, slug, 0) + 1;
}

export function score(weeks, position, personality, strain = 0) {
  // 0-1: the weighted share of the weeks that count (not injured) in which he started, less the big-game benching
  // hit and recruiting.JOB_STRAIN_SCORE for each time you promised his job to someone else; null when no week counts.
  const counted = weeks.filter((w) => !truthy(w["injured"]));
  const n = counted.length;
  if (!n) return null;
  const big = promises.BIG_WEIGHT * (personality === "attention" ? promises.ATTENTION_BIG : 1.0);
  const weights = counted.map((w, i) => (n > 1 ? 1 + promises.LATE_WEIGHT * i / (n - 1) : 1.0) * (truthy(w["big"]) ? big : 1.0));
  let s = sum(weights.filter((x, i) => truthy(counted[i]["started"]))) / sum(weights);
  if (promises.benched_big(weeks)) {
    s -= promises.BENCH_HIT * own(promises.POSITION_HIT, promises._group(position), 1.0) * (personality === "cocky" ? promises.COCKY_HIT : 1.0);
  }
  if (truthy(strain)) {
    const recruiting = modules.recruiting;
    s -= recruiting.JOB_STRAIN_SCORE * strain;
  }
  return round(Math.max(0.0, s), 3);
}

export function band(s, personality) {
  // "kept", "bent" or "broken" by his personality's bar; "none" when no week counted.
  if (s === null || s === undefined) return "none";
  const [kept_at, broken_under] = own(promises.BANDS, personality, promises.BANDS["default"]);
  return s >= kept_at ? "kept" : s < broken_under ? "broken" : "bent";
}

export function chip(b) {
  // The chip's word for a band: On Track, Slipping, Broken; null for "none".
  return own(promises.CHIPS, b);
}

export function mark_promised(row, year, personality) {
  // A starting role promised for `year`: the row carries it, and the personality the recruiting page showed (so he
  // is graded as you came to know him).
  row["promised"] = year;
  if (truthy(personality)) row["persona"] = { ...(get(row, "persona") || {}), personality };
}

export function personality_of(state, slug) {
  // His personality: the persona his league roster row carries, else a stable draw for him.
  const persona = modules.persona;
  const teams = get(get(state, "league") || {}, "teams") || {};
  const mine = get(teams, get(state, "team"));
  const walk = truthy(mine) ? [mine] : [];
  for (const [s_, x] of Object.entries(teams)) if (s_ !== get(state, "team")) walk.push(x);
  for (const t of walk) {
    for (const c of get(t, "roster") || []) {
      if (c["id"] === slug && truthy(get(get(c, "persona") || {}, "personality"))) return c["persona"]["personality"];
    }
  }
  return persona.draw(slug, "roster")["personality"];
}

// ----- the weekly snapshot (sim/season.advance, before the week's games) -----------------------------------------------

export function promised_now(state) {
  // Your league roster rows promised a starting role for this season, by slug ({} in a first season: no league).
  const season = modules.season;
  const lgd = get(state, "league");
  if (!truthy(lgd) || !truthy(get(state, "team"))) return {};
  const year = season.season_year(state);
  const out = {};
  for (const c of get(get(lgd["teams"], state["team"]) || {}, "roster") || []) if (get(c, "promised") === year) out[c["id"]] = c;
  return out;
}

export function _game(state, slug, week) {
  for (const g of Object.values(state["games"])) if (g["week"] === week && (slug === g["home"] || slug === g["away"])) return g;
  return null;
}

export function is_big(state, slug, week) {
  // Your game that week is a title game, a bowl or the playoff, a rivalry, or against a ranked opponent.
  const season = modules.season;
  const g = promises._game(state, slug, week);
  if (g === null) return false;
  if (["ccg", "bowl", "playoff"].includes(get(g, "kind"))) return true;
  const other = g["home"] === slug ? g["away"] : g["home"];
  const rivalry = season.rivalry_for(g["home"], g["away"], state);
  return (rivalry !== null && rivalry !== undefined) || other in season.rank_map(state, week - 1);
}

export function snapshot_week(state, week) {
  // Record each promised player's week: started (in the lineup the week's games will use), injured (on the injury
  // list, not redshirting), big. A bye records nothing; a week already recorded is not recorded twice.
  const season = modules.season;
  const promised = promises.promised_now(state);
  const me = get(state, "team");
  if (!Object.keys(promised).length || promises._game(state, me, week) === null) return;
  const team = season._preview_team(state, me);
  const rows = new Map();
  for (const p of [...team["offense"], ...team["defense"]]) rows.set(get(p, "slug"), p);
  const hurt = new Set(Object.values(get(get(state, "injuries") || {}, me) || {}).map((i) => get(i, "name")));
  const big = promises.is_big(state, me, week);
  const year = setdefault(promises.record(state), String(season.season_year(state)), {});
  for (const slug of Object.keys(promised)) {
    const weeks = setdefault(year, slug, []);
    if (weeks.some((w) => w["week"] === week)) continue;
    const p = rows.get(slug) || {};
    const injured = hurt.has(get(p, "name"));
    weeks.push({ week, started: truthy(get(p, "in_game")) && !injured, injured, big });
  }
}

// ----- the offseason: what the band does (offseason.portal_odds, Keep Them Home) -----------------------------------------

const LEAVE = { FR: 0.60, FRRS: 0.65, SO: 0.75, SORS: 0.80, JR: 0.92, JRRS: 0.94, SR: 0.95, SRRS: 0.95 };   // *tune* a broken promise's leave chance by the class he just played
const LEAVE_BIG = 0.03;           // *tune* ... more when he was benched in a big game, or is a quarterback
const LEAVE_SHY = -0.10;          // *tune* ... less for a Shy player
const LEAVE_CAP = 0.97;           // *tune* never certain
const BENT_MULT = 1.5;            // *tune* a bent promise's portal multiple (the old all-or-nothing PROMISE_BROKEN was 3.0)
const PROMISE_NIL_MULT = 2.5;     // *tune* a broken-promise leaver's NIL ask at Keep Them Home, times the usual
const NIL_MULT_BY = { business: 0.8, cocky: 1.3 };   // *tune* ... the money talks easiest to All Business, hardest to Cocky
const PROMISE_AGAIN_STAY = 0.55;  // *tune* his chance to stay when you promise him again (a role he would really get)

export function leave_chance(cls, position, info) {
  // A broken promise's chance he goes: by the class he played, more after a big-game benching or at quarterback,
  // less for a Shy player, never above LEAVE_CAP.
  let c = own(promises.LEAVE, cls, 0.9);
  if (truthy(get(info, "benched_big")) || promises._group(position) === "QB") c += promises.LEAVE_BIG;
  if (get(info, "personality") === "shy") c += promises.LEAVE_SHY;
  return Math.min(promises.LEAVE_CAP, c);
}

export function nil_mult(personality) {
  return promises.PROMISE_NIL_MULT * own(promises.NIL_MULT_BY, personality, 1.0);
}

export function bands(state, year) {
  // Your players promised for `year` who have a weekly record: slug -> {band, score, benched_big, personality}. A
  // promised player with no record (a save from before) is left out: the old all-or-nothing rule reads him.
  const rec = get(promises._seen(state), String(year)) || {};
  const me = get(state, "team");
  const rows = new Map();
  for (const c of get(get(get(get(state, "league") || {}, "teams") || {}, me) || {}, "roster") || []) rows.set(c["id"], c);
  const out = {};
  for (const [slug, weeks] of Object.entries(rec)) {
    const c = rows.get(slug);
    if (c === undefined || c === null || get(c, "promised") !== year) continue;
    const kind = promises.personality_of(state, slug);
    const s = promises.score(weeks, c["pos"], kind, promises.strain(state, year, slug));
    out[slug] = { band: promises.band(s, kind), score: s, benched_big: promises.benched_big(weeks), personality: kind };
  }
  return out;
}

// ----- during the season: the chip, and the first time he says it is slipping --------------------------------------------

const SLIPPING_LINE = "Coach, you told me this was my job.";
const NEWS_AFTER = 2;             // *tune* weeks that count before a slipping promise is news (one bad week is not a trend)

export function chips_now(state) {
  // This season's promised players by slug: the chip for the record so far (On Track, Slipping, Broken).
  const season = modules.season;
  const rec = get(promises._seen(state), String(season.season_year(state))) || {};
  const out = {};
  for (const [slug, c] of Object.entries(promises.promised_now(state))) {
    const kind = promises.personality_of(state, slug);
    const word = promises.chip(promises.band(promises.score(get(rec, slug) || [], c["pos"], kind, promises.strain(state, season.season_year(state), slug)), kind));
    if (truthy(word)) out[slug] = word;
  }
  return out;
}

export function tags_now(state) {
  // Every player of yours with a start promised, by slug, and where it stands (his card's and the depth chart's
  // tag): this season's chip, Not Judged Yet before a week counts, Next Season for one made at Keep Them Home.
  const season = modules.season;
  const year = season.season_year(state);
  const chips = promises.chips_now(state);
  const roster = get(get(get(get(state, "league") || {}, "teams") || {}, get(state, "team")) || {}, "roster") || [];
  const out = {};
  for (const c of roster) {
    if (get(c, "promised") !== null && c["promised"] >= year) out[c["id"]] = c["promised"] > year ? "Next Season" : get(chips, c["id"]) || "Not Judged Yet";
  }
  return out;
}

export function news(state) {
  // One Program News item per promised player: the first week (NEWS_AFTER weeks counted or more) his promise read
  // Slipping or Broken, in his words.
  const season = modules.season;
  const rec = get(promises._seen(state), String(season.season_year(state))) || {};
  const items = [];
  for (const [slug, c] of Object.entries(promises.promised_now(state))) {
    const kind = promises.personality_of(state, slug);
    const weeks = get(rec, slug) || [];
    for (let i = 0; i < weeks.length; i++) {
      const seen = weeks.slice(0, i + 1);
      if (sum(seen.map((w) => (truthy(w["injured"]) ? 0 : 1))) < promises.NEWS_AFTER) continue;
      if (["bent", "broken"].includes(promises.band(promises.score(seen, c["pos"], kind), kind))) {
        items.push({ week: seen[seen.length - 1]["week"], kind: "promise", slug, name: c["n"], position: c["pos"],
          line: promises.SLIPPING_LINE });
        break;
      }
    }
  }
  return items;
}

export const promises = {
  LATE_WEIGHT, BIG_WEIGHT, BENCH_HIT, POSITION_HIT, BANDS, ATTENTION_BIG, COCKY_HIT, CHIPS, record, _seen, _group, benched_big,
  strain, add_strain, score, band, chip, mark_promised, personality_of, promised_now, _game, is_big, snapshot_week,
  LEAVE, LEAVE_BIG, LEAVE_SHY, LEAVE_CAP, BENT_MULT, PROMISE_NIL_MULT, NIL_MULT_BY, PROMISE_AGAIN_STAY, leave_chance, nil_mult,
  bands, SLIPPING_LINE, NEWS_AFTER, chips_now, tags_now, news,
};
modules.promises = promises;
