// The offseason, part 2: who leaves and why (the portal's odds, the
// departures, the draft board and the draft), your roster at the Departures step (redshirts, position changes, the
// roles a staff fills), a player's story (his recruitment and what has happened since), the signed classes arriving,
// and the transfer portal (spots, an entrant's choice, the AI schools' offers, the old rounds, the portal's close).
//
// Every name of the offseason is reached through the `offseason` namespace, whichever part defines it
// (engine_js/PORTING.md, "Big Files in Parts").
import { round, int, sum, cmp, sorted, maxBy, get, truthy, range, floordiv } from "../../engine_js/pyrt.js";
import { mean as st_mean, pstdev as st_pstdev } from "../../engine_js/pystat.js";
import { modules } from "../../engine_js/modules.js";
import { personnel } from "../../engine_js/personnel.js";
import { league as lg } from "../league.js";
import { position_fit } from "../position_fit.js";
import { programs } from "../programs.js";
import { carousel } from "../carousel.js";
import { promises } from "../promises.js";
import { word } from "../word.js";
import { prospects } from "../prospects.js";
import { ability_goals } from "../ability_goals.js";
import { offseason } from "../offseason_ns.js";

// ----- small helpers (local to this part) --------------------------------------------------------------------

/** `k in d` for a dict. */
const has = (d, k) => Object.prototype.hasOwnProperty.call(d, k);

/** `x in coll` for a tuple, list or set (whichever shape the part that defines the constant gave it). */
const _in = (x, coll) => (coll instanceof Set ? coll.has(x) : Array.from(coll).includes(x));

/** dict(zip(keys, values)): as long as the shorter of the two. */
function _zipped(keys, values) {
  const out = {};
  const n = Math.min(keys.length, values.length);
  for (let i = 0; i < n; i++) out[keys[i]] = values[i];
  return out;
}

/** `xs[:] = ys`: the same list, its items replaced. */
function _replace(xs, ys) {
  xs.splice(0, xs.length, ...ys);
}

// ----- why players leave ---------------------------------------------------------------------------------------

function program_shifts(state, lgd) {
  // Where this year's results take each program's tier (programs.update runs at the Staff step,
  // after the portal: a probe runs it on copies now): slug -> tiers lost (negative: gained).
  let res, ranks;
  try {
    res = carousel._results(state);
    ranks = programs.final_ranks(state);
  } catch (exc) {                                                 // no season behind this state: nothing moves
    // (a missing key read here is a TypeError, or a plain Error whose message starts "KeyError")
    if (exc instanceof TypeError || (exc instanceof Error && (exc.name === "KeyError" || exc.constructor.name === "KeyError"))) return {};
    throw exc;
  }
  programs.init(lgd);
  const probe_teams = {};
  for (const [s, t] of Object.entries(lgd["teams"])) {
    probe_teams[s] = { "program": { ...t["program"] }, "coaches": truthy(get(t, "coaches")) ? t["coaches"] : {} };
  }
  const probe = { "league": { "teams": probe_teams, "year": get(lgd, "year"), "conference_start": get(lgd, "conference_start") } };
  if (probe["league"]["conference_start"] === null) delete probe["league"]["conference_start"];
  programs.update(probe, res, ranks, get(lgd, "year"));
  const out = {};
  for (const [s, t] of Object.entries(lgd["teams"])) out[s] = probe["league"]["teams"][s]["program"]["tier"] - t["program"]["tier"];
  return out;
}

function _program_context(lgd, slug, losing, p4, shifts) {
  // What a school's players weigh this offseason: its NIL tier's pay, whether it is slipping
  // (and why) or rising.
  const t = lgd["teams"][slug];
  const tier = (truthy(get(t, "program")) ? t["program"] : programs.base(slug))["tier"];
  const hc = get(get(t, "coaches") || {}, "head_coach") || {};
  const shift = get(shifts, slug, 0);
  let slipping;
  if (shift > 0 || get(hc, "since") === lgd["year"] - 1) {
    slipping = "slipping";                                      // a tier lost this year, or a new head coach's first year
  } else if (losing && get(get(hc, "ratings") || {}, "player_development", 76) < offseason.WEAK_COACH) {
    slipping = "better_coach";
  } else {
    slipping = null;
  }
  return { "losing": losing, "p4": p4, "year": lgd["year"], "tier": tier, "slipping": slipping, "rising": shift < 0 };
}

function portal_odds(p, use, ctx) {
  // A player's portal chance this offseason as segments that add up to it, each with its driver:
  // "role" (his class, his role, a losing year, a Group of 5 standout moving up, a keep last year),
  // "promised" (a starting role promised, at Keep Them Home or as a recruit, that he did not get: the
  // rest of PROMISE_BROKEN times), "deal" (NIL under his market at his program's tier), "slipping" or
  // "better_coach" (PROGRAM_PULL). One draw against the sum; the segment it lands in is why.
  const recruiting = modules.recruiting;
  const year = ctx["year"];
  let base = get(offseason.PORTAL_BASE, p["cls"], 0.15) * offseason.PORTAL_USAGE[use] * (truthy(ctx["losing"]) ? offseason.PORTAL_LOSING : 1.0);
  const ovr = offseason.house(p["pos"], p["o"]);
  if (!truthy(ctx["p4"]) && ovr >= offseason.TRANSFER_UP_FROM) {
    base = Math.max(base, offseason.TRANSFER_UP);                // a Group of 5 standout moves up
  }
  const kept = get(p, "kept") === year - 1;
  const promised = get(p, "promised") === year - 1;              // promised a starting role (Keep Them Home, or as a recruit)
  const info = promised ? get(get(ctx, "promise") || {}, p["id"]) : null;
  const band = truthy(info) ? info["band"] : null;               // judged all season (promises.bands); None: a save from before
  const broken = promised && info === null && use !== "starter";   // the old all-or-nothing rule, for an untracked promise
  if (band === "kept" || (kept && !broken && !(band === "bent" || band === "broken"))) {
    base *= offseason.KEPT_STAY;
  }
  let parts = [["role", base]];
  if (broken) {
    parts.push(["promised", base * (offseason.PROMISE_BROKEN - 1)]);   // its own segment: when the draw lands here the promise is why he goes
  } else if (band === "bent") {
    parts.push(["promised", base * (promises.BENT_MULT - 1)]);
  }
  if ((use === "starter" || use === "rotation") && !kept) {     // a kept player was paid this year
    const market = recruiting.market_value(p["pos"], ovr);
    const shortfall = market - get(offseason.NIL_TIER_PAY, ctx["tier"], offseason.NIL_TIER_PAY[5]);
    if (market > 0 && shortfall > 0) {
      parts.push(["deal", Math.min(offseason.NIL_PULL_CAP, offseason.NIL_PULL * shortfall / market)]);
    }
  }
  if (truthy(get(ctx, "slipping")) && (use === "starter" || use === "rotation") && ovr >= offseason.PROGRAM_FLOOR) {
    parts.push([ctx["slipping"], offseason.PROGRAM_PULL]);
  }
  if (truthy(get(ctx, "rising")) && use === "starter") {
    parts = parts.map(([k, v]) => [k, v * offseason.RISING_STAY]);
  }
  if (band === "broken") {                                        // all but gone, the older the surer: the rest of his leave chance
    parts.push(["promised", Math.max(0.0, promises.leave_chance(p["cls"], p["pos"], info) - sum(parts.map(([, v]) => v)))]);
  }
  return parts;
}

function _departures(state, lgd, usage, shifts = null, draft = null) {
  // Who wants out, decided at the offseason's start: seniors leaving ("graduated"; the draft takes
  // its picks from them later), underclassmen who declare ("declared", with their projected pick),
  // portal entrants and quitters. Yours with eligibility left wait on Keep Them Home; an AI school
  // talks some early entrants into staying (its own stream, after the departures draws). The draft
  // itself runs after Keep Them Home (_run_draft) from the scores kept in `draft` (filled here).
  const rng = offseason._rng(state, "departures");
  const keep_rng = offseason._rng(state, "ai_retention");
  if (shifts === null || shifts === undefined) shifts = offseason.program_shifts(state, lgd);
  const attrs = offseason._attrs(lgd);
  const events = [], entrants = {};
  const records = {};
  for (const slug of Object.keys(lgd["teams"])) records[slug] = offseason._record(state, slug);
  const _season = modules.season;
  const my_promises = promises.bands(state, _season.season_year(state));   // the season just played: your promises, judged week by week
  word.apply_bands(state, _season.season_year(state), my_promises);   // ... and they move Keeps His Word, once a year
  if (truthy(my_promises)) {                                            // each goes into his story: kept, bent or broken
    const mine_rows = {};
    for (const c of lgd["teams"][state["team"]]["roster"]) mine_rows[c["id"]] = c;
    for (const [pslug, b] of Object.entries(my_promises)) {
      if (has(mine_rows, pslug)) {
        offseason.life(mine_rows[pslug], _season.season_year(state), "promise", { band: b["band"], benched_big: truthy(get(b, "benched_big")) ? true : null });
      }
    }
  }
  const games = offseason._games_played(state);
  // the draft board: seniors and the underclassmen who declare, ranked by draft score (the picks
  // are projections until the draft runs after Keep Them Home)
  const [pool, declared] = offseason.draft_scores(lgd, rng, games);
  const fbs_picks = round(offseason.DRAFT_PICKS * offseason.DRAFT_FROM_FBS);
  const board = pool.filter((x) => x[2]["cls"] === "SR" || x[2]["cls"] === "SRRS" || declared.has(x[2]["id"]));
  const drafted = {};
  board.slice(0, fbs_picks).forEach(([, , p], i) => { drafted[p["id"]] = i + 1; });
  if (draft !== null && draft !== undefined) {
    const scores = {};
    for (const [score, , p] of board) scores[p["id"]] = round(score, 4);
    draft["scores"] = scores;
    draft["done"] = false;
    draft["ai_kept"] = [];
  }
  const leaving = {};
  for (const slug of Object.keys(lgd["teams"])) leaving[slug] = new Set();
  const season = modules.season;
  const recruiting = modules.recruiting;
  const teams = season.load_teams();
  const p4 = {};
  for (const slug of Object.keys(lgd["teams"])) p4[slug] = season._is_p4(slug, teams[slug]);
  const me = get(state, "team");
  const pending = [];                      // your leavers with eligibility left: they wait on the retention step
  for (const [slug, t] of Object.entries(lgd["teams"])) {
    const u = get(usage, slug, {});
    const gp = get(games, slug, {});
    const [wins, losses] = records[slug];
    const losing = wins < losses;
    const would_start = offseason._would_start(t["roster"], recruiting.PORTAL_STARTERS);
    const ctx = offseason._program_context(lgd, slug, losing, p4[slug], shifts);
    ctx["promise"] = slug === me ? my_promises : {};              // your promises, judged all season (AI schools make none)
    const os_ = sorted(t["roster"].map((q) => q["o"]));
    const low = os_.length ? os_[Math.max(0, int(os_.length * 0.15) - 1)] : 0;
    const team_name = lg.team_meta(get(state, "league"), slug)["short_name"];
    for (const p of t["roster"]) {
      const ev = { "id": p["id"], "name": p["n"], "pos": p["pos"], "cls": p["cls"], "team": slug, "team_name": team_name,
        "overall": offseason.house(p["pos"], p["o"]), "stars": get(p, "s") };
      const use = get(u, p["id"], "bench");
      if (declared.has(p["id"])) {
        ev["kind"] = "declared"; ev["early"] = true; ev["proj"] = get(drafted, p["id"]);
        if (slug !== me && keep_rng.random() < offseason.ai_keep_chance(get(drafted, p["id"]), offseason.elite(p, has(games, slug) ? gp : null))) {
          p["cls"] = get(offseason.NEXT_CLASS, p["cls"], p["cls"]);              // his school kept him: back a class up
          if (draft !== null && draft !== undefined) draft["ai_kept"].push(p["id"]);
          continue;
        }
      } else if (has(drafted, p["id"])) {                           // a senior projected to be drafted: he goes
        ev["kind"] = "graduated";
      } else if (p["cls"] === "SRRS" || (p["cls"] === "SR" && !(use === "bench" && rng.random() < offseason.FIFTH_YEAR))) {
        ev["kind"] = "graduated";
      } else {
        const n_games = get(gp, p["id"], 0);
        let nxt = p["cls"] === "SR" ? "SRRS" : offseason._next_class(p, use, rng, n_games);
        if (nxt.endsWith("RS") && !p["cls"].endsWith("RS")) {
          p["rs_year"] = lgd["year"] - 1;
          p["rs_games"] = n_games;
        }
        if (slug === me && offseason._redshirt_candidate(p, n_games)) {
          nxt = p["cls"];                                          // your call, at the Departures step
        }
        if (rng.random() < offseason.QUIT * (p["o"] <= low ? offseason.QUIT_LOW : 1.0)) {
          ev["kind"] = "quit";
        } else {
          const parts = offseason.portal_odds(p, use, ctx);
          const chance = sum(parts.map(([, v]) => v));
          const draw = rng.random();
          if (draw < chance && (slug === me || !(would_start.has(p["id"]) && rng.random() < offseason.AI_KEEP))) {
            let driver = null, edge = 0.0;
            for (const [key, v] of parts) {                        // the segment the draw landed in is why he goes
              edge += v;
              if (draw < edge) {
                driver = key === "role" ? null : key;
                break;
              }
            }
            let shortfall = 0;
            if (driver === "deal") {
              const market = recruiting.market_value(p["pos"], offseason.house(p["pos"], p["o"]));
              shortfall = 5 * Math.ceil((market - get(offseason.NIL_TIER_PAY, ctx["tier"], offseason.NIL_TIER_PAY[5])) / 5);
            }
            ev["kind"] = "portal";
            const q = { ...p, "cls": nxt };
            entrants[p["id"]] = { "player": q, "from": slug, "from_name": team_name, "offers": [],
              "signed": null, "usage": use, "driver": driver, "shortfall": truthy(shortfall) ? shortfall : null };
          } else {
            p["cls"] = nxt;
            continue;
          }
        }
      }
      if (slug === me && (ev["kind"] === "portal" || ev["kind"] === "declared")) {
        // your leaver with eligibility left: he waits on the retention step, on the roster (a class
        // up, as if he stays), out of the portal and the draft until you advance
        let gone = {};
        if (has(entrants, p["id"])) {
          if (truthy(entrants[p["id"]])) gone = entrants[p["id"]];
          delete entrants[p["id"]];
        }
        const star = ev["kind"] === "declared" && offseason.elite(p, has(games, slug) ? gp : null);
        p["cls"] = p["cls"] === "SR" ? "SRRS" : get(offseason.NEXT_CLASS, p["cls"], p["cls"]);
        pending.push({ "ev": ev, "use": use, "losing": losing, "winning": wins > losses, "p4": p4[slug],
          "driver": get(gone, "driver"), "shortfall": get(gone, "shortfall"), "elite": star });
        continue;
      }
      events.push(ev);
      leaving[slug].add(p["id"]);
    }
  }
  for (const [slug, t] of Object.entries(lgd["teams"])) {
    t["roster"] = t["roster"].filter((p) => !leaving[slug].has(p["id"]));
  }
  return [events, entrants, pending];
}

function _would_start(roster, starters) {
  // The ids who would start by overall at their group on this roster (the group's number of starters).
  const by_group = {};
  for (const p of roster) {
    const g = get(offseason.GROUP, p["pos"], "S");
    if (!has(by_group, g)) by_group[g] = [];
    by_group[g].push(p);
  }
  const out = new Set();
  for (const [g, ps] of Object.entries(by_group)) {
    for (const p of sorted(ps, (q) => -q["o"]).slice(0, get(starters, g, 1))) out.add(p["id"]);
  }
  return out;
}

function draft_grades(players) {
  // Each draft group's (mean, spread) of overall over the top of this year's draft-eligible
  // `players` there (DRAFT_REF_SHARE of them, at least DRAFT_REF_MIN): the prospects the NFL looks at.
  // "*" is the same over every position.
  const by = {};
  for (const p of players) {
    const h = offseason.house(p["pos"], p["o"]);
    const g = get(offseason.DRAFT_GROUP, p["pos"], p["pos"]);
    if (!has(by, g)) by[g] = [];
    by[g].push(h);
    if (!has(by, "*")) by["*"] = [];
    by["*"].push(h);
  }
  const out = {};
  for (const [g, v] of Object.entries(by)) {
    const top = sorted(v, (x) => x, true).slice(0, Math.max(offseason.DRAFT_REF_MIN, round(offseason.DRAFT_REF_SHARE * v.length)));
    out[g] = [st_mean(top), Math.max(offseason.DRAFT_MIN_SD, top.length > 1 ? st_pstdev(top) : 0.0)];
  }
  return out;
}

function draft_score(pos, overall, rng, grades = null) {
  // Where he projects: his grade (his overall against this year's draft-eligible players at
  // his position, and DRAFT_ABS_SHARE of it against all of them: draft_grades) times his position's
  // draft value, plus its shift and noise.
  const g = get(offseason.DRAFT_GROUP, pos, pos);
  const h = offseason.house(pos, overall);
  const own = get(grades || {}, g);
  const [mean, sd] = truthy(own) ? own : [74.0, 5.0];
  const all = get(grades || {}, "*");
  const [mean_all, sd_all] = truthy(all) ? all : [mean, sd];
  const share = offseason.DRAFT_ABS_SHARE;
  const z = (1 - share) * (h - mean) / sd + share * (h - mean_all) / sd_all;
  return get(offseason.DRAFT_VALUE, g, 1.0) * z + get(offseason.DRAFT_SHIFT, g, 0.0) + rng.gauss(0, offseason.DRAFT_NOISE);
}

function elite(p, games = null) {
  // An eligible underclassman good enough that he always declares: rated ELITE_DECLARE or better
  // after a decent season (ELITE_MIN_GAMES played; a team with no season lines counts as played).
  if (!_in(p["cls"], offseason.UNDERCLASS_ELIGIBLE) || offseason.house(p["pos"], p["o"]) < offseason.ELITE_DECLARE) return false;
  return games === null || games === undefined || get(games, p["id"], 0) >= offseason.ELITE_MIN_GAMES;
}

function draft_scores(lgd, rng, games = null) {
  // Every senior and draft-eligible underclassman scored, best first, and the underclassmen who
  // declare by their projected pick (DECLARE; an elite one always does). games: team -> id -> games
  // played this season (_games_played), for the elite rule.
  if (games === undefined) games = null;
  const eligible = [];
  for (const [slug, t] of Object.entries(lgd["teams"])) {
    for (const p of t["roster"]) {
      if (p["cls"] === "SR" || p["cls"] === "SRRS" || _in(p["cls"], offseason.UNDERCLASS_ELIGIBLE)) eligible.push([slug, p]);
    }
  }
  const grades = offseason.draft_grades(eligible.map(([, p]) => p));
  let pool = eligible.map(([slug, p]) => [offseason.draft_score(p["pos"], p["o"], rng, grades), slug, p]);   // one draw each, in roster order as before
  pool.sort((a, b) => cmp(-a[0], -b[0]));
  // the board's needs: each player at a group after its first few on the board steps down a little
  // (thirty-two teams do not all want the same position), so no position empties or floods a round
  const seen = {};
  const runs = [];
  for (const [score, slug, p] of pool) {
    const g = get(offseason.DRAFT_GROUP, p["pos"], p["pos"]);
    runs.push([score - offseason.DRAFT_RUN * Math.min(get(seen, g, 0), offseason.DRAFT_RUN_CAP), slug, p]);
    seen[g] = get(seen, g, 0) + 1;
  }
  pool = sorted(runs, (x) => -x[0]);
  const declared = new Set();
  pool.forEach(([, slug, p], k) => {
    const i = k + 1;
    if (_in(p["cls"], offseason.UNDERCLASS_ELIGIBLE)) {
      const chance = offseason.DECLARE.find(([cut]) => i <= cut)[1];
      // the draw is made either way, so the elite rule moves nobody else's
      if (rng.random() < chance || offseason.elite(p, games === null || !has(games, slug) ? null : games[slug])) {
        declared.add(p["id"]);
      }
    }
  });
  return [pool, declared];
}

function draft_board(lgd, rng, games = null) {
  // The draft: every senior and draft-eligible underclassman scored, the underclassmen who
  // declare by their projected pick (DECLARE), the first DRAFT_PICKS * DRAFT_FROM_FBS picked.
  // Returns (the ids who declared early, {id: pick}).
  const [pool, declared] = offseason.draft_scores(lgd, rng, games);
  const fbs_picks = round(offseason.DRAFT_PICKS * offseason.DRAFT_FROM_FBS);
  const board = pool.filter(([, , p]) => p["cls"] === "SR" || p["cls"] === "SRRS" || declared.has(p["id"]));
  const picks = {};
  board.slice(0, fbs_picks).forEach(([, , p], i) => { picks[p["id"]] = i + 1; });
  return [declared, picks];
}

function ai_keep_chance(pick, elite_) {
  // An AI school's chance to talk its early entrant into staying: your odds when you offer nothing.
  if (truthy(elite_)) return offseason.ELITE_STAY;
  return offseason.AI_KEEP_DRAFT.find(([cut]) => (truthy(pick) ? pick : Math.pow(10, 6)) <= cut)[1];
}

function _run_draft(state) {
  // The draft, after Keep Them Home: the final pool (seniors leaving, early entrants nobody kept)
  // by the draft scores drawn at the start; the first DRAFT_PICKS * DRAFT_FROM_FBS are picked, an
  // early entrant left over is undrafted. No new draws.
  const off = state["offseason"];
  const d = get(off, "draft");
  if (!truthy(d) || truthy(get(d, "done"))) return;
  const scores = d["scores"];
  const pool = off["departures"].filter((ev) => has(scores, ev["id"]) && (ev["kind"] === "graduated" || ev["kind"] === "declared"));
  pool.sort((a, b) => cmp(-scores[a["id"]], -scores[b["id"]]));
  const fbs_picks = round(offseason.DRAFT_PICKS * offseason.DRAFT_FROM_FBS);
  pool.forEach((ev, k) => {
    const pick = k + 1;
    delete ev["proj"];
    if (pick <= fbs_picks) {
      ev["kind"] = "draft";
      ev["pick"] = pick;
      ev["round"] = Math.min(7, floordiv(pick - 1, 32) + 1);
      ev["early"] = truthy(get(ev, "early"));
    } else if (ev["kind"] === "declared") {
      ev["kind"] = "undrafted";
    }
  });
  d["done"] = true;
}

function _next_class(p, use, rng, games = 0) {
  // Next year's class: a player who did not play much (four games or fewer: the rule) may take
  // his redshirt (once).
  const cls = p["cls"];
  if (offseason._redshirt_candidate(p, games) && use !== "starter") {
    const chance = get(offseason.REDSHIRT, cls, 0.0) * (use === "rotation" ? 0.5 : 1.0);
    if (rng.random() < chance) return cls + "RS";
  }
  return get(offseason.NEXT_CLASS, cls, cls);
}

function _redshirt_candidate(p, games) {
  return _in(p["cls"], offseason.REDSHIRT_CLASSES) && games <= offseason.REDSHIRT_GAMES;
}

function _games_played(state) {
  // team -> league player id -> games played this season (the season's stats, by name and position).
  const season = modules.season;
  const out = {};
  const ss = get(state, "season_stats") || {};
  for (const [slug, t] of Object.entries(season.load_teams())) {
    const lines = get(get(ss, slug) || {}, "players") || {};
    if (!truthy(lines)) continue;
    const row = {};
    for (const p of t["offense"].concat(t["defense"])) {
      if (truthy(get(p, "slug"))) row[p["slug"]] = get(get(lines, `${p["name"]}|${p["position"]}`) || {}, "games", 0);
    }
    out[slug] = row;
  }
  return out;
}

// ----- your roster at the Departures step: redshirts and position changes ------------------------

class RosterError extends Error {
  constructor(code, message) {
    super(message);
    this.message = message;
    this.code = code;
  }
}
offseason.RosterError = RosterError;

function _redshirt_block(state, lgd, usage) {
  // Your players who can take a redshirt this year (four games or fewer, the year unused), with
  // a default: a freshman off the depth chart's top takes it, an older player only if he never played.
  const me = state["team"];
  const games = get(offseason._games_played(state), me, {});
  const u = get(usage, me, {});
  const team_games = get(get(get(state, "season_stats") || {}, me) || {}, "games", 0);
  const chosen = new Set(Object.keys(get(get(state, "redshirting") || {}, me) || {}));      // the ones you sat down during the season
  const players = [];
  for (const p of lgd["teams"][me]["roster"]) {
    const n = get(games, p["id"], 0);
    if (truthy(get(p, "signed")) || get(p, "walk_on_year") === lgd["year"]) continue;            // this year's class has not played a season
    if (offseason._redshirt_candidate(p, n)) {
      players.push({ "id": p["id"], "name": p["n"], "pos": p["pos"], "cls": p["cls"], "games": n, "team_games": team_games,
        "overall": offseason.house(p["pos"], p["o"]), "use": get(u, p["id"], "bench"),
        "redshirt": chosen.has(p["id"]) || (get(u, p["id"], "bench") === "bench" && (p["cls"] === "FR" || n === 0)) });
    }
  }
  players.sort((a, b) => cmp([get(offseason.GROUP, a["pos"], "Z"), -a["overall"]], [get(offseason.GROUP, b["pos"], "Z"), -b["overall"]]));
  return { "players": players, "decided": false };
}

function redshirt(state, pid, on) {
  // Your call on one player's redshirt, at the Departures step.
  const off = get(state, "offseason") || {};
  const rs = get(off, "redshirts");
  if (get(off, "stage") !== "departures" || !truthy(rs) || truthy(get(rs, "decided"))) {
    throw new offseason.RosterError(409, "redshirts are decided at the Departures step");
  }
  const p = rs["players"].find((x) => x["id"] === pid);
  if (p === undefined) throw new offseason.RosterError(404, "he cannot take a redshirt this year");
  p["redshirt"] = truthy(on);
  return rs;
}

function _apply_redshirts(state) {
  const off = state["offseason"];
  const rs = get(off, "redshirts");
  if (!truthy(rs) || truthy(get(rs, "decided"))) return;
  const roster = {};
  for (const c of state["league"]["teams"][state["team"]]["roster"]) roster[c["id"]] = c;
  for (const p of rs["players"]) {
    const c = get(roster, p["id"]);
    if (!truthy(c) || c["cls"] !== p["cls"]) continue;
    c["cls"] = truthy(p["redshirt"]) ? p["cls"] + "RS" : get(offseason.NEXT_CLASS, p["cls"], p["cls"]);
    if (truthy(p["redshirt"])) {
      c["rs_year"] = off["year"] - 1;
      c["rs_games"] = p["games"];
    }
  }
  rs["decided"] = true;
}

function position_options(state, pid) {
  // What he would be at every position (position_fit.project: his ratings on the new group's
  // scale, skills he has never used discounted, his size against the spot's), best first.
  const lgd = state["league"];
  const c = lgd["teams"][state["team"]]["roster"].find((x) => x["id"] === pid);
  if (c === undefined) throw new offseason.RosterError(404, "not on your roster");
  const [origin, r] = truthy(get(c, "moved_attrs")) ? [c["moved_from"], c["moved_attrs"]] : [c["pos"], c["r"]];
  const out = position_fit.options(_zipped(lgd["attrs"], r), get(c, "ht"), get(c, "wt"), origin, c["pos"], offseason.GROUP);
  return out;
}

function move_row(c, pos, attrs) {
  // A league roster row at another position (position_fit.move_row): his ratings and overall
  // become what he projects there, "moved_from" keeps where he came from (cleared, his ratings
  // restored, when he goes back the same season).
  position_fit.move_row(c, pos, attrs);
}

function _season_moves(state, lgd) {
  // Position changes made during the season (season.change_position) go onto the league's
  // rows (a career's first season plays the real league, so its rows are made only now).
  for (const [slug, moves] of Object.entries(get(state, "position_changes") || {})) {
    const rows = get(get(lgd["teams"], slug) || {}, "roster") || [];
    for (const [pid, m] of Object.entries(moves)) {
      const c = rows.find((x) => x["id"] === pid);
      if (c !== undefined && c["pos"] !== m["to"]) offseason.move_row(c, m["to"], lgd["attrs"]);
    }
  }
}

function change_position(state, pid, pos) {
  // Move one of your players to another position, at any offseason stage (his overall follows).
  const off = get(state, "offseason") || {};
  if (typeof pos !== "string" || !has(offseason.GROUP, pos)) throw new offseason.RosterError(400, "no such position");
  const lgd = state["league"];
  const c = lgd["teams"][state["team"]]["roster"].find((x) => x["id"] === pid);
  if (c === undefined) throw new offseason.RosterError(404, "not on your roster");
  if (c["pos"] === pos) throw new offseason.RosterError(409, "he plays there already");
  offseason.move_row(c, pos, lgd["attrs"]);
  if (!has(off, "position_changes")) off["position_changes"] = [];
  const moves = off["position_changes"];
  _replace(moves, moves.filter((m) => m["id"] !== pid));
  if (truthy(get(c, "moved_from"))) {
    moves.push({ "id": pid, "name": c["n"], "from": c["moved_from"], "to": pos, "overall": offseason.house(pos, c["o"]) });
  }
  return { "id": pid, "pos": pos, "overall": offseason.house(pos, c["o"]) };
}

function defense_scheme(team) {
  // A league team's defensive scheme, read the way the engine reads it (engine_js/game.js).
  const co = get(team, "coaches") || {};
  const dc = get(get(get(co, "defensive_coordinator") || {}, "scheme") || {}, "defensive_scheme");
  if (truthy(dc)) return dc;
  const hc = get(get(get(co, "head_coach") || {}, "scheme") || {}, "defensive_philosophy");
  return truthy(hc) ? hc : "4-2-5";
}

function has_sam(scheme) {
  // Whether a defense lines up a SAM: a base front with SAM_FRONT_LBS linebackers (a 4-2-5's
  // nickel back plays where the SAM would, so its two linebackers are a MIKE and a WILL).
  return personnel.FRONTS[get(personnel.SCHEME_FRONT, scheme, "4-2-5")]["LB"] >= offseason.SAM_FRONT_LBS;
}

function empty_roles(team) {
  // The roles in ROLE_FILL no one on a league team's roster plays: a center always, a SAM
  // where the scheme has one (has_sam).
  const held = new Set(team["roster"].map((c) => c["pos"]));
  return Object.keys(offseason.ROLE_FILL).filter((r) => !held.has(r) && (r !== "SAM" || offseason.has_sam(offseason.defense_scheme(team))));
}

function fill_roles(state, teams = null) {
  // Each team's staff moves a player into a role no one on its roster plays (empty_roles): a
  // backup guard to center, a backup MIKE or WILL to SAM. Recruiting and the walk-ons fill a
  // position group, not a spot inside it, so a class of tackles and guards can leave a roster
  // without a center (and the real rosters list no SAM at many programs). The pick is the one
  // who projects best there (position_fit.project) among the players at ROLE_FILL's positions who
  // are not the best at their own (the starters stay put), from a position someone else still
  // plays. Your moves go on the offseason's position changes (Undo there takes them back).
  // `teams`: the schools to look at (every league team when None). Returns the moves.
  const lgd = state["league"];
  const attrs = offseason._attrs(lgd);
  const off = get(state, "offseason") || {};
  const out = [];
  for (const slug of (teams !== null && teams !== undefined ? teams : sorted(Object.keys(lgd["teams"])))) {
    const t = lgd["teams"][slug];
    for (const role of offseason.empty_roles(t)) {
      const by_pos = {};
      for (const c of t["roster"]) {
        if (!has(by_pos, c["pos"])) by_pos[c["pos"]] = [];
        by_pos[c["pos"]].push(c);
      }
      const tops = {};
      for (const [pos, ps] of Object.entries(by_pos)) tops[pos] = maxBy(ps, (c) => [c["o"], c["id"]])["id"];
      const pool = [];
      for (const pos of offseason.ROLE_FILL[role]) {
        if (get(by_pos, pos, []).length > 1) {
          for (const c of by_pos[pos]) if (c["id"] !== tops[pos]) pool.push(c);
        }
      }
      if (!pool.length) continue;

      const there = (c) => {
        const [origin, r] = truthy(get(c, "moved_attrs")) ? [c["moved_from"], c["moved_attrs"]] : [c["pos"], c["r"]];
        return position_fit.project(_zipped(attrs, r), get(c, "ht"), get(c, "wt"), origin, role);
      };
      const pick = maxBy(pool, (c) => [there(c), c["id"]]);
      const was = pick["pos"];
      offseason.move_row(pick, role, attrs);
      const move = { "team": slug, "id": pick["id"], "name": pick["n"], "from": was, "to": role, "overall": offseason.house(role, pick["o"]) };
      out.push(move);
      if (slug === get(state, "team") && truthy(off)) {
        if (!has(off, "position_changes")) off["position_changes"] = [];
        const moves = off["position_changes"];
        _replace(moves, moves.filter((m) => m["id"] !== pick["id"]));
        if (truthy(get(pick, "moved_from"))) {
          const row = {};
          for (const [k, v] of Object.entries(move)) if (k !== "team") row[k] = v;
          row["from"] = pick["moved_from"];
          moves.push(row);
        }
      }
    }
  }
  return out;
}

// The numbers a position wears (the player's report: a receiver in 69, linemen in the 90s, a starter with none).
// *tune* A new player draws from his group's own first; the rule itself is college football's: an offensive lineman
// wears 50 to 79, and a quarterback, back, receiver or tight end never does. A defender may wear anything.
offseason.JERSEYS = { "QB": [[0, 19]], "RB": [[0, 49]], "WR": [[0, 19], [80, 89]], "TE": [[80, 89], [40, 49]], "OL": [[50, 79]],
  "DL": [[90, 99], [50, 59]], "LB": [[30, 59]], "CB": [[0, 49]], "S": [[0, 49]], "K": [[0, 49], [90, 99]], "P": [[0, 49], [90, 99]] };
const _LINE = [50, 79];
const _ELIGIBLE = new Set(["QB", "RB", "WR", "TE"]);

function jersey_legal(pos, n) {
  // Whether a player at `pos` may wear `n` (a whole number from 0 to 99, as text or a number).
  const k = Number(n);
  if (n === null || n === undefined || n === "" || !Number.isInteger(k) || k < 0 || k > 99) return false;
  const group = get(offseason.GROUP, pos, pos);
  const line = k >= _LINE[0] && k <= _LINE[1];
  if (group === "OL") return line;
  if (_ELIGIBLE.has(group)) return !line;
  return true;
}

function _jersey(roster, pos, rng) {
  // A free number for a player at `pos`: one of his group's own (JERSEYS), else any he may wear, else any free one.
  // (str(None) is "None" there and "null" here: neither is a number, and only numbers are looked for)
  const used = new Set(roster.map((p) => String(get(p, "j"))));
  const group = get(offseason.GROUP, pos, pos);
  const own = [];
  for (const [lo, hi] of get(offseason.JERSEYS, group, [[0, 99]])) for (const n of range(lo, hi + 1)) own.push(String(n));
  let free = own.filter((n) => !used.has(n));
  if (!free.length) free = range(100).map((n) => String(n)).filter((n) => !used.has(n) && offseason.jersey_legal(pos, n));
  if (!free.length) free = range(100).map((n) => String(n)).filter((n) => !used.has(n));
  return free.length ? rng.choice(free) : null;
}

function renumber(state) {
  // Every roster's numbers put right once the rosters are settled for the year: a player with no number, one his
  // position may not wear (a lineman moved to the line keeps his old 94 otherwise), or one a teammate listed before
  // him already has, draws a new one. Everyone else keeps his. Returns how many changed. Its own seeded stream.
  const rng = offseason._rng(state, "renumber");
  let n = 0;
  for (const slug of sorted(Object.keys(state["league"]["teams"]))) {
    const roster = state["league"]["teams"][slug]["roster"];
    const seen = new Set();
    const redo = [];
    for (const c of roster) {
      const j = get(c, "j");
      if (!offseason.jersey_legal(c["pos"], j) || seen.has(String(j))) redo.push(c);
      else seen.add(String(j));
    }
    for (const c of redo) c["j"] = null;
    for (const c of redo) {
      c["j"] = offseason._jersey(roster, c["pos"], rng);
      n += 1;
    }
  }
  return n;
}

// ----- his story: how he was recruited and what has happened since (the player card's History) -----
offseason.STORY_OTHERS = 4;       // *tune* the other schools on his list that his card names
offseason.LIFE_KEEP = 30;         // *tune* the events kept on a player (a career is at most six seasons)

function life(p, season_year, kind, extra = {}) {
  // A line in a player's story, kept on his league row (`life`) so it follows him through the rollover and a
  // transfer: {"year": the season it came after, "kind": promise | stayed | transfer | progress, ...}. Never read
  // back by the game: his card's History shows it.
  // (`extra` is one object; its keys are written in the order given)
  if (!has(p, "life")) p["life"] = [];
  const rows = p["life"];
  const row = { "year": season_year, "kind": kind };
  for (const [k, v] of Object.entries(extra)) if (v !== null && v !== undefined) row[k] = v;
  rows.push(row);
  // del rows[:-LIFE_KEEP]
  const end = offseason.LIFE_KEEP === 0 ? 0 : Math.max(0, rows.length - offseason.LIFE_KEEP);
  rows.splice(0, Math.min(end, rows.length));
}

function _recruit_stories(state) {
  // Each signed prospect's recruitment, for his league row's `rec`: his class, stars, where he ranked (the nation,
  // his position, his state), his hometown, the schools that offered and the others on his list at the end, when he
  // signed (and whether early), how many times he flipped, the NIL his school put on its offer. One pass over the
  // log. Yours also carry their History as the recruiting page showed it (`log`, prospects.history_index) and what
  // he cared about.
  const recruiting = modules.recruiting;
  const rc = state["recruiting"];
  const ps = rc["prospects"], status = rc["status"];
  const order = sorted(Object.keys(ps), (q) => (truthy(get(ps[q], "rank")) ? ps[q]["rank"] : Math.pow(10, 6)));
  // (a position or a home state that is None is a key of its own in both: Maps, as a dict keyed by None is)
  const at_pos = new Map();
  const in_state = new Map();
  const place = {};
  for (const q of order) {
    const pos = get(ps[q], "position"), home = get(get(ps[q], "hometown") || {}, "state");
    at_pos.set(pos, (at_pos.has(pos) ? at_pos.get(pos) : 0) + 1);
    in_state.set(home, (in_state.has(home) ? in_state.get(home) : 0) + 1);
    place[q] = [at_pos.get(pos), in_state.get(home)];
  }
  const offered = {};
  const week = {};
  const flips = {};
  const nil = {};
  for (const e of (truthy(get(rc, "log")) ? rc["log"] : [])) {
    const q = e["pid"], kind = e["kind"];
    if (kind === "offer" && truthy(get(e, "school"))) {
      if (!has(offered, q)) offered[q] = new Set();
      offered[q].add(e["school"]);
    } else if (kind === "flip") {
      flips[q] = get(flips, q, 0) + 1;
    } else if (kind === "signed") {
      week[q] = e["week"];
    }
    if ((kind === "offer" || kind === "raise_nil") && get(e, "school") === get(get(status, q) || {}, "signed") && get(e, "nil") !== null) {
      nil[q] = e["nil"];
    }
  }
  const me = get(state, "team");
  const mine = truthy(me) ? prospects.history_index(state, me) : {};
  const early = recruiting.early_signing_week();
  const out = {};
  for (const [q, st_] of Object.entries(status)) {
    const slug = get(st_, "signed");
    if (!truthy(slug) || slug === "FCS" || !has(ps, q)) continue;
    const pr = ps[q];
    const home = get(pr, "hometown") || {};
    const others = sorted(Object.entries(get(rc["lists"], q) || {}), (kv) => -kv[1]).map(([s_]) => s_).filter((s_) => s_ !== slug)
      .slice(0, offseason.STORY_OTHERS);
    const rec = { "year": get(pr, "class_of"), "stars": get(pr, "stars"), "rank": get(pr, "rank"), "pos": get(pr, "position"),
      "pos_rank": place[q][0], "state_rank": place[q][1], "city": get(home, "city"), "state": get(home, "state"),
      "school": slug, "offers": has(offered, q) ? offered[q].size : 0, "others": others, "week": get(week, q),
      "early": get(week, q) !== null && week[q] <= early, "flips": get(flips, q, 0), "nil": get(nil, q) };
    if (slug === me) {
      rec["priorities"] = Array.from(get(pr, "priorities") || []);
      rec["log"] = truthy(get(mine, q)) ? mine[q] : [];
    }
    const row = {};
    for (const [k, v] of Object.entries(rec)) if (v !== null && v !== undefined) row[k] = v;
    out[q] = row;
  }
  return out;
}

function _sign_classes(state, lgd) {
  // Every school's signed high school class joins its roster as freshmen, each with his recruitment (`rec`).
  const rc = get(state, "recruiting");
  if (!truthy(rc)) return {};
  const rng = offseason._rng(state, "jerseys");
  const attrs = offseason._attrs(lgd);
  const out = {};
  const stories = offseason._recruit_stories(state);
  for (const [pid, s] of Object.entries(rc["status"])) {
    const slug = get(s, "signed");
    if (!truthy(slug) || slug === "FCS" || !has(lgd["teams"], slug)) continue;
    const team = lgd["teams"][slug];
    const c = offseason._compact_prospect(state, rc["prospects"][pid], attrs);
    c["j"] = offseason._jersey(team["roster"], c["pos"], rng);
    c["signed"] = true;
    // listed as an athlete: he arrives at the position he was drawn at, and you place him yourself at the Place Your
    // Athletes stage (the player's design; his build is an athlete's, so the drawn spot can be a poor fit)
    if (get(rc["prospects"][pid], "position") === "ATH") {
      c["ath"] = true;
      // another school's staff places him itself, where he projects best (the player's rule: the CPU assigns its
      // athletes too); from then on that is simply his position
      if (slug !== get(state, "team")) {
        const opts = position_fit.options(_zipped(attrs, c["r"]), get(c, "ht"), get(c, "wt"), c["pos"], c["pos"], offseason.GROUP);
        const best = opts.reduce((a, b) => (b["overall"] > a["overall"] ? b : a), opts[0]);
        if (best !== undefined && best["pos"] !== c["pos"]) {
          offseason.move_row(c, best["pos"], attrs);
          delete c["moved_from"];
          delete c["moved_attrs"];
        }
      }
    }
    if (has(stories, pid)) {
      c["rec"] = { ...stories[pid], "overall": offseason.house(c["pos"], c["o"]) };     // how he was recruited, and what he was when he arrived
    }
    const contact = get(get(get(rc, "contacts") || {}, pid, {}), slug) || {};
    if ((get(contact, "promises") || []).some((pr) => pr["kind"] === "roster")) {
      // told the job was his: the retention step's promise, graded on the personality you met
      promises.mark_promised(c, lgd["year"], modules.persona.of(state, pid)["personality"]);
      if (has(c, "rec")) c["rec"]["promised"] = true;
    }
    team["roster"].push(c);
    out[slug] = get(out, slug, 0) + 1;
  }
  return out;
}

function _compact_prospect(state, p, attrs) {
  // A high school prospect as a league player (a freshman).
  const recruiting = modules.recruiting;
  const src = { "slug": p["id"], "name": p["name"], "position": p["ea_position"], "class": "FR", "height": p["height"],
    "weight_lbs": p["weight"], "archetype": p["archetype"], "dev_trait": "Normal",
    "card": recruiting.attributes(state, p, "ratings"), "potential_card": recruiting.attributes(state, p),
    "coachability": p["coachability"], "stars": p["stars"], "hometown": p["hometown"] };
  const out = lg.compact(src, attrs);
  const ab = ability_goals.recruit_ab_field(p);       // some recruits arrive with an ability or two
  if (truthy(ab)) out["ab"] = ab;
  return out;
}

// ----- the transfer portal ----------------------------------------------------------------------

function p4_school(slug) {
  const season = modules.season;
  return season._is_p4(slug, season.load_teams()[slug]);
}

function open_spots(lgd, slug, portal) {
  const taken = sum(Object.values(portal["players"]).filter((e) => e["signed"] === slug).map(() => 1));
  return Math.max(0, offseason.ROSTER_LIMIT - lgd["teams"][slug]["roster"].length - taken);
}

function churn_left(portal, slug) {
  // Spots a school can still make by releasing the end of its roster this portal (CHURN in all).
  return Math.max(0, offseason.CHURN - sum(Object.values(portal["players"]).filter((e) => e["signed"] === slug && truthy(get(e, "churn"))).map(() => 1)));
}

function my_spots(lgd, me, portal) {
  // Your portal spots: open roster spots plus the ones releasing the end of your roster makes.
  return offseason.open_spots(lgd, me, portal) + offseason.churn_left(portal, me);
}

function _group_counts(roster) {
  const out = {};
  for (const g of Object.keys(offseason.TARGET)) out[g] = 0;
  for (const p of roster) out[offseason.GROUP[p["pos"]]] += 1;
  return out;
}

function _depth_values(roster) {
  const out = {};
  for (const g of Object.keys(offseason.TARGET)) out[g] = [];
  for (const p of roster) out[offseason.GROUP[p["pos"]]].push(p["o"]);
  for (const v of Object.values(out)) v.sort((a, b) => cmp(b, a));
  return out;
}

offseason.STARTERS = { "QB": 1, "RB": 1, "WR": 3, "TE": 1, "OL": 5, "DL": 4, "LB": 2, "CB": 2, "S": 2, "K": 1, "P": 1 };

function playing_time(lgd, slug, p) {
  // Where he would play at `slug`: 1 a starter, 0.5 next in line, 0.15 behind that.
  const g = offseason.GROUP[p["pos"]];
  const ahead = sum(offseason._depth_values(lgd["teams"][slug]["roster"])[g].filter((o) => o > p["o"]).map(() => 1));
  return ahead < offseason.STARTERS[g] ? 1.0 : ahead < offseason.STARTERS[g] + 2 ? 0.5 : 0.15;
}

function _prestige(state, slug) {
  // The program's pull on a transfer: its living rating (NIL, brand; about -2 to +2) and its team now.
  const season = modules.season;
  const t = get(season.load_teams(), slug) || {};
  return offseason.PRESTIGE_WEIGHT * programs.z(state, slug) + offseason.RATING_WEIGHT * (get(get(t, "team_ratings") || {}, "overall", 76) - 76) / 6;
}

function entrant_interest(state, lgd, slug, e, rng = null) {
  const p = e["player"];
  const [wins, losses] = offseason._record(state, slug);
  const home = get(lg.team_meta(get(state, "league"), slug), "state") === get(p, "home") ? 1.0 : 0.0;
  const noise = rng !== null && rng !== undefined ? rng.gauss(0, offseason.PICK_NOISE) : 0.0;
  return (offseason.PT_WEIGHT * offseason.playing_time(lgd, slug, p) + offseason._prestige(state, slug)
          + offseason.WIN_WEIGHT * wins / Math.max(1, wins + losses) + offseason.HOME_WEIGHT * home + noise);
}

function ai_offers(state, slug, left = null) {
  // A school's portal offers this round: by need (groups short of a healthy depth first), the
  // best entrants who would play there, up to PORTAL_OFFER_FACTOR times its open spots (`left`:
  // the spots it still has later in the round).
  const off = state["offseason"];
  const lgd = state["league"], portal = off["portal"];
  let spots;
  if (left !== null && left !== undefined) {
    spots = left;
  } else {
    spots = Math.min(offseason.open_spots(lgd, slug, portal), offseason.PORTAL_TAKE);
    if (truthy(offseason.p4_school(slug))) {
      spots += Math.max(0, offseason.CHURN - sum(Object.values(portal["players"]).filter((e) => e["signed"] === slug && truthy(get(e, "churn"))).map(() => 1)));
    }
  }
  if (spots <= 0) return [];
  const roster = lgd["teams"][slug]["roster"];
  const counts = offseason._group_counts(roster.concat(Object.values(portal["players"]).filter((e) => e["signed"] === slug).map((e) => e["player"])));
  const depth = offseason._depth_values(roster);
  const need = {};
  for (const g of Object.keys(offseason.TARGET)) need[g] = offseason.TARGET[g] - counts[g];
  const free = Object.entries(portal["players"]).filter(([, e]) => !truthy(e["signed"]) && e["from"] !== slug);
  const scored = [];
  for (const [pid, e] of free) {
    const p = e["player"];
    const g = offseason.GROUP[p["pos"]];
    const vals = depth[g];
    const starter_bar = vals.length ? vals[Math.min(vals.length - 1, offseason.STARTERS[g] - 1)] : 0;
    if (p["o"] > starter_bar) {                                      // he would start here: worth a spot, need or not
      scored.push([10 + (p["o"] - starter_bar) / 1.1, pid]);
      continue;
    }
    if (need[g] <= 0 && spots < offseason.OPEN_TAKE_ANY) continue;
    const bar = vals.length ? vals[Math.min(vals.length - 1, offseason.STARTERS[g] + 3)] : 0;      // about as good as his depth there
    if (p["o"] < bar - 2) continue;
    scored.push([need[g] * 2 + (p["o"] - bar) / 1.65, pid]);
  }
  scored.sort((a, b) => cmp(b, a));
  return scored.slice(0, Math.ceil(offseason.PORTAL_OFFER_FACTOR * spots)).map(([, pid]) => pid);
}

function resolve_round(state) {
  // The round's decisions: every entrant with offers picks the school he likes best that still
  // has a spot, best players first. Returns the moves.
  const off = state["offseason"];
  const lgd = state["league"], portal = off["portal"];
  const rng = offseason._rng(state, `portal-${portal["round"]}`);
  const me = state["team"];
  // (a Set, walked below in the order you made the offers)
  let mine = new Set(get(portal["offers"], me, []));
  const auto_recruit = get(get(get(state, "career") || {}, "settings", {}), "auto_recruit");
  // off is null, false, 0 or "off"
  if (!(auto_recruit === null || auto_recruit === false || auto_recruit === 0 || auto_recruit === "off") && !mine.size) {
    mine = new Set(offseason.ai_offers(state, me));
  }
  const moves = [];
  const spots = {};
  for (const slug of Object.keys(lgd["teams"])) {
    spots[slug] = slug === me ? offseason.open_spots(lgd, slug, portal) : Math.min(offseason.open_spots(lgd, slug, portal), offseason.PORTAL_TAKE);
  }
  const churn = {};
  for (const slug of Object.keys(lgd["teams"])) {
    churn[slug] = truthy(offseason.p4_school(slug)) || slug === me ? offseason.churn_left(portal, slug) : 0;
  }
  for (let rolling = 0; rolling < offseason.PORTAL_PASSES; rolling++) {    // schools with spots left keep offering to who is still out there
    const offers = {};
    for (const pid of (rolling === 0 ? mine : [])) {
      if (!has(offers, pid)) offers[pid] = [];
      offers[pid].push(me);
    }
    for (const slug of Object.keys(lgd["teams"])) {
      if (slug === me || (rolling && get(spots, slug, 0) <= 0 && get(churn, slug, 0) <= 0)) continue;
      for (const pid of offseason.ai_offers(state, slug, rolling ? spots[slug] + churn[slug] : null)) {
        if (!has(offers, pid)) offers[pid] = [];
        offers[pid].push(slug);
      }
    }
    for (const pid of sorted(Object.keys(offers), (q) => -portal["players"][q]["player"]["o"])) {
      const e = portal["players"][pid];
      if (truthy(e["signed"])) continue;
      e["offers"] = sorted(new Set([...e["offers"], ...offers[pid]]));
      const choices = offers[pid].filter((s) => get(spots, s, 0) > 0 || get(churn, s, 0) > 0);
      if (!choices.length) continue;
      const pick = maxBy(choices, (s) => offseason.entrant_interest(state, lgd, s, e, rng));
      e["signed"] = pick;
      if (get(spots, pick, 0) > 0) {
        spots[pick] -= 1;
      } else {                          // a spot made by releasing the end of the roster (over the limit after the portal)
        churn[pick] -= 1;
        e["churn"] = true;
      }
      moves.push({ "id": pid, "name": e["player"]["n"], "pos": e["player"]["pos"], "from": e["from"], "to": pick,
        "overall": offseason.house(e["player"]["pos"], e["player"]["o"]), "round": portal["round"] });
    }
  }
  portal["moves"].push(...moves);
  portal["offers"] = {};
  return moves;
}

function _close_portal_rounds(state) {
  // The two-round portal of older saves: signed transfers join their new rosters; the rest leave FBS.
  const lgd = state["league"], portal = state["offseason"]["portal"];
  const rng = offseason._rng(state, "portal-jerseys");
  for (const e of Object.values(portal["players"])) {
    if (truthy(e["signed"])) {
      const p = { ...e["player"] };
      const team = lgd["teams"][e["signed"]];
      p["j"] = offseason._jersey(team["roster"], p["pos"], rng);
      p["transfer"] = e["from"];
      p["transfer_year"] = get(state["offseason"], "year");      // this offseason's transfer (the picker's Transfers group)
      team["roster"].push(p);
    }
  }
}

function _close_portal(state) {
  // After the last portal week: signed transfers join their new rosters, an unsigned entrant may
  // walk on at a school from his top group (PORTAL_WALK_ON) or leaves FBS, and the recruiting
  // block goes back to the signed class.
  const recruiting = modules.recruiting;
  const lgd = state["league"], off = state["offseason"];
  const portal = off["portal"], rc = state["recruiting"];
  const rng = offseason._rng(state, "portal-jerseys");
  const me = get(state, "team"), auto = truthy(get(off, "auto")) || recruiting.auto_mode(state) !== "off";
  const yours = new Set([...(get(rc, "board") || []), ...get(rc["offers"], me, [])]);      // the entrants you recruited: where each went is logged
  const told = truthy(me) ? prospects.history_index(state, me) : {};                // your signees' portal History, for their story
  for (const [pid, e] of Object.entries(portal["players"])) {
    const st_ = get(rc["status"], pid) || {};
    let school = get(st_, "signed");
    if (!truthy(school)) {                      // a preferred walk-on: a school he was considering that had spoken to him
      if (rng.random() < recruiting.PORTAL_WALK_ON) {
        const p = rc["prospects"][pid];
        for (const s_ of recruiting.top_group(state, pid)) {
          const c = get(get(rc["contacts"], pid) || {}, s_) || {};
          if (!(truthy(get(c, "n")) || get(rc["offers"], s_, []).includes(pid)) || (s_ === me && !auto)) continue;
          if (recruiting.portal_spots(state, s_) <= 0) continue;
          const need = recruiting.needs(state, s_)[p["group"]];
          let worst = null;                                        // min(..., default=0)
          for (const q of lgd["teams"][s_]["roster"]) {
            if (offseason.GROUP[q["pos"]] === p["group"] && (worst === null || q["o"] < worst)) worst = q["o"];
          }
          if (worst === null) worst = 0;
          if (need > 0 || p["ovr"] > worst) {
            school = s_;
            break;
          }
        }
      }
      if (!truthy(school)) {
        if (yours.has(pid) && has(rc["status"], pid)) recruiting._event(state, "unsigned", pid, null, { lost: "unsigned" });
        continue;
      }
    }
    const p = { ...e["player"] };
    const team = lgd["teams"][school];
    p["j"] = offseason._jersey(team["roster"], p["pos"], rng);
    p["transfer"] = e["from"];
    p["transfer_year"] = get(off, "year");                         // this offseason's transfer (the picker's Transfers group)
    const contact = get(get(get(rc, "contacts") || {}, pid, {}), school) || {};
    if ((get(contact, "promises") || []).some((pr) => pr["kind"] === "roster")) {
      // told the job was his in the portal: the same promise a signed recruit carries
      promises.mark_promised(p, lgd["year"], modules.persona.of(state, pid)["personality"]);
    }
    if (truthy(get(p, "life"))) p["life"] = Array.from(p["life"]);                                 // his own list: the portal's copy of him shares the old row's
    offseason.life(p, (truthy(get(off, "year")) ? off["year"] : lgd["year"]) - 1, "transfer", {
      to: school, overall: offseason.house(p["pos"], p["o"]), from: e["from"],
      walk_on: !truthy(get(st_, "signed")) ? true : null, promised: get(p, "promised") === lgd["year"] ? true : null,
      log: school === me ? (truthy(get(told, pid)) ? told[pid] : null) : null });
    if (!truthy(get(st_, "signed"))) {
      p["walk_on"] = true;                                         // (walk_on, then preferred: the keys' order in a save)
      p["preferred"] = true;
      st_["signed"] = school;
      recruiting._event(state, "signed", pid, school, { walk_on: true, ...(yours.has(pid) && school !== me ? { lost: "unsigned" } : {}) });
    }
    team["roster"].push(p);
    e["signed"] = school;
    portal["moves"].push({ "id": pid, "name": p["n"], "pos": p["pos"], "from": e["from"], "to": school,
      "overall": offseason.house(p["pos"], p["o"]), "round": get(rc, "week", offseason.PORTAL_WEEKS_DONE), "walk_on": truthy(get(p, "walk_on")) });
  }
  off["portal_recruiting"] = { "reports": truthy(get(rc, "reports")) ? rc["reports"] : [], "log": truthy(get(rc, "log")) ? rc["log"] : [],
    "board": Array.from(get(rc, "board") || []) };
  offseason._carry_over(state);
  if (truthy(get(state, "recruiting_last"))) {
    const last = state["recruiting_last"];
    delete state["recruiting_last"];
    state["recruiting"] = last;
    recruiting.reset_caches();
  }
}

offseason.PORTAL_WEEKS_DONE = 4;

Object.assign(offseason, {
  program_shifts, _program_context, portal_odds, _departures, _would_start, draft_grades, draft_score, elite, draft_scores,
  draft_board, ai_keep_chance, _run_draft, _next_class, _redshirt_candidate, _games_played, _redshirt_block, redshirt,
  _apply_redshirts, position_options, move_row, _season_moves, change_position, defense_scheme, has_sam, empty_roles,
  fill_roles, _jersey, jersey_legal, renumber, life, _recruit_stories, _sign_classes, _compact_prospect, p4_school, open_spots, churn_left, my_spots,
  _group_counts, _depth_values, playing_time, _prestige, entrant_interest, ai_offers, resolve_round, _close_portal_rounds,
  _close_portal,
});
