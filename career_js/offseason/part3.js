// coach_career/offseason.py, part 3 (the Python file's lines 1668 to 2468): what the portal leaves unspent, player
// development (coachability's moves, a year's growth, a step back), coach development (every coach in the league
// grows toward a hidden level), walk-ons and roster top-ups, and your staff (who leaves, the candidates, the hires).
//
// Ported by engine_js/PORTING.md's rules ("A big file ported in parts"): every name of the offseason file is reached
// through the `offseason` namespace, whichever part defines it.
import { Random, round, int, sum, cmp, sorted, maxBy, range, get, truthy } from "../../engine_js/pyrt.js";
import { mean } from "../../engine_js/pystat.js";
import { modules } from "../../engine_js/modules.js";
import { cfg } from "../../engine_js/game_config.js";
import { ValueError } from "../../sim_js/coaches.js";
import { game_scale } from "../../teamdata_js/game_scale.js";
import { ratings as rv2 } from "../../teamdata_js/ratings.js";
import { clear } from "../clear.js";
import { league as lg } from "../league.js";
import { recruits, pypow } from "../recruits.js";
import { programs } from "../programs.js";
import { carousel } from "../carousel.js";
import { coach_names } from "../coach_names.js";
import { prospects } from "../prospects.js";
import { offseason } from "../offseason_ns.js";

// ----- what Python has built in and JavaScript does not (local to this part) ----------------------------------

const has = (d, k) => Object.prototype.hasOwnProperty.call(d, k);

/** `x in coll` for a tuple, list or set (PHYSICAL is a set in the Python, lg.OFFENSE_ROLES too). */
const _in = (x, coll) => (coll instanceof Set ? coll.has(x) : Array.from(coll).includes(x));

/** isinstance(v, dict). */
const is_dict = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Set) && !(v instanceof Map);

/** str.split(): on runs of whitespace, no empty pieces. */
const words = (s) => s.split(/\s+/).filter((w) => w.length);

/** COACH_PERF.get(mark, 0.0): the dict's keys are whole numbers (2, 0, -1, -2), names on a plain object here. */
const _perf_of = (mark) => {
  const table = offseason.COACH_PERF;
  if (table instanceof Map) return table.has(mark) ? table.get(mark) : 0.0;
  return get(table, mark, 0.0);
};

/** x ** 2 as Python gives it (the square of a double, rounded once). */
const sq = (x) => pypow(x, 2);

function _carry_over(state) {
  // The portal closed: what each school did not spend of its pool (keep them home and the
  // transfers it signed) carries into next year's budget, capped by its tier (recruiting.carry_over);
  // the portal's NIL spend and signings are kept for the record.
  const recruiting = modules.recruiting;
  const rc = state["recruiting"], off = state["offseason"];
  const me = get(state, "team");
  const carry = {};
  let spent = 0, ai_spent = 0;
  for (const slug of Object.keys(state["league"]["teams"])) {
    const p = recruiting.pool_record(state, slug);
    const budget = recruiting.portal_budget(state, slug);
    const unspent = has(rc["nil"], slug) ? recruiting.nil_left(state, slug) : budget;
    p["unspent"] = Math.max(0, unspent);
    p["carry"] = carry[slug] = recruiting.carry_over(state, slug, p["unspent"]);
    spent += budget - p["unspent"];
    if (slug !== me) ai_spent += budget - p["unspent"];
  }
  state["nil_carry"] = carry;
  off["portal_nil"] = { spent: spent, ai_spent: ai_spent, signed: sum(Object.values(rc["status"]).map((s_) => (truthy(s_["signed"]) ? 1 : 0))),
    carry: sum(Object.values(carry)) };
}

// ----- development ------------------------------------------------------------------------------

function program_factor(state, slug) {
  // A program's own pull on development (facilities, staff size, strength and conditioning): its
  // living rating on the baseline's scale, about -2 to +2, at PROGRAM_DEV a point.
  const b = programs.z(state, slug);
  return 1 + (b > 0 ? offseason.PROGRAM_DEV : offseason.PROGRAM_DEV_BELOW) * b;
}

function _dev_side(pos) {
  return _in(pos, lg.OFFENSE_ROLES) ? "offensive_coordinator" : !["K", "P"].includes(offseason.GROUP[pos]) ? "defensive_coordinator" : "head_coach";
}

function dev_rating(coaches, pos) {
  // His coaches' player development: the head coach's with the coordinator on his side of the ball.
  const hc = get(get(get(coaches, "head_coach") || {}, "ratings", {}), "player_development", 50);
  const co = get(get(get(coaches, offseason._dev_side(pos)) || {}, "ratings", {}), "player_development", hc);
  return (1 - offseason.COORD_SHARE) * hc + offseason.COORD_SHARE * co;
}

function coach_factor(coaches, pos) {
  // His coaches' factor on development (dev_rating); about 0.8 at 30, 1.0 at 50, 1.2 at 90.
  const r = offseason.dev_rating(coaches, pos);
  return r >= 50 ? 1 + (r - 50) / 200 : 1 + (r - 50) / 100;
}

function coachability_chances(level, cls, z, rated, redshirted, benched) {
  // The cases that can move his coachability this offseason, each its own chance of one level
  // up ({case: chance}), and his chance of slipping one level down. `cls` is the class he enters,
  // `z` last season's production against the average starter (None: he did not play enough),
  // `rated` his coaches' player development (dev_rating), `redshirted` a redshirt year just taken,
  // `benched` off the depth chart's top now.
  const levels = recruits.COACHABILITY.map(([name, _, __]) => name);
  if (!levels.includes(level)) return [{}, 0.0];
  const i = levels.indexOf(level);
  const up = {};
  if (i > 0) {
    if (z !== null && z !== undefined && z >= offseason.BREAKOUT_FROM) up["breakout"] = offseason.COACH_UP_BREAKOUT;
    let dev = 0.0;
    for (const [at, c] of offseason.COACH_UP_DEVELOPER) {
      if (rated >= at) { dev = c; break; }
    }
    if (dev) up["developer"] = dev;
    if (["JR", "SR"].includes((cls || "").slice(0, 2)) && z !== null && z !== undefined && i >= offseason.COACH_UP_MATURITY_GAP) {
      up["maturity"] = offseason.COACH_UP_MATURITY;
    }
    if (truthy(redshirted) && rated >= offseason.REDSHIRT_STAFF) up["redshirt"] = offseason.COACH_UP_REDSHIRT;
  }
  const down = truthy(benched) && z !== null && z !== undefined && z <= -0.75 && i < levels.length - 1 ? offseason.COACH_DOWN_BENCHED : 0.0;
  return [up, down];
}

function coachability_roll(level, chances, drop, rng) {
  // One offseason's roll: (his level now, the case that moved him or None). Every case is its own
  // chance; at most one level a year; a fixed five draws whatever applies, so the stream stays aligned.
  const levels = recruits.COACHABILITY.map(([name, _, __]) => name);
  const cases = Array.from(offseason.COACH_CASES);
  const rolls = cases.map(() => rng.random());
  const down = rng.random();
  if (!levels.includes(level)) return [level, null];
  const i = levels.indexOf(level);
  let hit = null;
  for (let j = 0; j < cases.length; j++) {
    if (rolls[j] < get(chances, cases[j], 0.0)) { hit = cases[j]; break; }
  }
  if (truthy(hit) && i > 0) return [levels[i - 1], hit];
  if (truthy(drop) && down < drop && i < levels.length - 1) return [levels[i + 1], "benched"];
  return [level, null];
}

offseason.COACH_NOTES = { award: "A National Honor", breakout: "A Breakout Year", developer: "{coach}'s Development",
  redshirt: "A Redshirt Year Well Spent", maturity: "Growing Up", benched: "Benched After a Rough Year" };

function coachability_note(level, case_, coach = "His Coaches") {
  // The Who Improved tag for a move: "Now a Film Junkie: A Breakout Year".
  // "a" only before a level that is a noun ("a Film Junkie"; never "a Slow to Click")
  return `Now ${_in(level, clear.SLOW_LEVELS) ? "" : "a "}${level}: ${offseason.COACH_NOTES[case_].split("{coach}").join(coach)}`;
}

function _coach_title(coaches, pos) {
  const c = get(coaches, offseason._dev_side(pos)) || get(coaches, "head_coach") || {};
  const last = words(get(c, "name") || "");
  return last.length ? `Coach ${last[last.length - 1]}` : "His Coaches";
}

function year_pace(p, starter = false) {
  // His pace by seasons in college (YEAR_CURVE), lifted to STARTER_YEAR after a season as a starter.
  const pace = offseason.YEAR_CURVE[Math.min(offseason.YEAR_CURVE.length - 1, int(get(p, "yrs") || 0))];
  return truthy(starter) ? Math.max(pace, offseason.STARTER_YEAR) : pace;
}

function rv2_tier(ab) {
  // An ability's tier (1 Bronze .. 4 Platinum) from a roster's "name|tier".
  const parts = ab.split("|");
  const name = parts[parts.length - 1];
  return has(rv2.TRAIT_TIERS, name) ? rv2.TRAIT_TIERS[name] : 0;
}

/** dict(zip(keys, values)): the shortest of the two decides. */
function _zip_dict(keys, values) {
  const out = {};
  const n = Math.min(keys.length, values.length);
  for (let i = 0; i < n; i++) out[keys[i]] = values[i];
  return out;
}

function _card_growth(was, now, attrs, pos) {
  // Each attribute on his card that moved over the offseason: where it was and is, its name, and its weight in his
  // position's overall (teamdata/game_scale.py card_formula: the weight times the change is what it added).
  const a = game_scale.card_attributes(_zip_dict(attrs, was), pos), b = game_scale.card_attributes(_zip_dict(attrs, now), pos);
  const weights = get(game_scale.card_formula(pos) || {}, "w") || {};
  const out = [];
  for (const [k, v] of Object.entries(b)) {
    if (has(a, k) && v !== a[k]) out.push({ key: k, label: rv2.ATTRIBUTES[k][0], from: a[k], to: v, w: round(get(weights, k, 0.0), 4) });
  }
  return out;
}

function develop(p, attrs, factor, rng, starter = false) {
  // One offseason's growth on our scale: each skill closes part of its gap to potential at his
  // coachability's rate times `factor` and his year's pace (`starter`: he played a starter's season,
  // year_pace); his overall follows (our formula). Returns the overall gained.
  let rate = get(recruits.RATE, get(p, "c"), 0.27) * factor * offseason.DEV_RATE * offseason.year_pace(p, starter);
  rate /= 1 + Math.max(0, p["o"] - offseason.DEV_TOP) / offseason.DEV_TOP_SPAN;       // the last points come slowest (DEV_TOP)
  rate *= get(offseason.DEV_PACE, get(offseason.DRAFT_GROUP, p["pos"], ""), 1.0);     // ... and by position (DEV_PACE)
  if (clear.on()) {                                         // Clear Mode: Natural Talent grows faster (engine TRAIT_FX)
    let tier = 0;
    for (const a of get(p, "ab") || []) {
      if (a.split("|")[0] === "The Natural") tier = Math.max(tier, offseason.rv2_tier(a));
    }
    rate *= 1 + tier * get(cfg.TRAIT_FX, "natural_talent", 0);
  }
  const base = rate;
  rate = Math.min(offseason.DEV_YEAR_CAP, rate);            // no offseason closes more than half his room (DEV_YEAR_CAP)
  // Clear Mode: physical ratings grow slower, technique and mental faster (clear.PHYS_RATE, clear.SKILL_RATE), each
  // still under DEV_YEAR_CAP; the same draws either way
  const paces = clear.on()
    ? attrs.map((k) => Math.min(offseason.DEV_YEAR_CAP, base * (_in(k, offseason.PHYSICAL) ? clear.PHYS_RATE : clear.SKILL_RATE))) : null;
  const new_r = [], new_g = [];
  const n = Math.min(p["r"].length, p["g"].length);
  for (let i = 0; i < n; i++) {
    const v = p["r"][i], g = p["g"][i];
    const r_k = paces && paces.length ? paces[i] : rate;
    const step = g > 0 ? int(round(Math.min(g, g * r_k * rng.uniform(0.8, 1.2)))) : 0;
    new_r.push(Math.min(99, v + step));
    new_g.push(g - step);
  }
  const before = p["o"];
  p["r"] = new_r; p["g"] = new_g;
  p["o"] = lg.overall(p, attrs);
  return p["o"] - before;
}

offseason.REGRESS_Z = -1.0;                // *tune* a starter this far under the average starter at his group had a hard year
offseason.REGRESS_STRUGGLE = 0.5;          // *tune* ... and he loses a step this often
offseason.REGRESS_RUST = 0.3;              // *tune* an upperclassman buried on the depth chart who is slow to learn goes backward this often
offseason.REGRESS_YEARS = 2;               // *tune* seasons in the program before rust can set in
offseason.REGRESS_RATINGS = 4;             // *tune* how many of his ratings slip (never the physical ones)
offseason.REGRESS_POINTS = [2, 4];         // *tune* the points each of them loses
offseason.CEILING_NOTE = "Lost some of his ceiling after a hard year as a starter";   // his potential fell (clear.CEIL_STRUGGLE)
offseason.REGRESS_NOTES = { struggle: "Lost a step after a hard year as a starter", rust: "Went backward buried on the depth chart" };

function regress(p, attrs, perf, benched, year) {
  // A player can go backward over an offseason (the player's ask): a starter who had a hard year (his production
  // REGRESS_Z under the average starter's) loses a step REGRESS_STRUGGLE of the time, and an upperclassman buried on
  // the depth chart who is slow to learn (clear.SLOW_LEVELS) goes backward REGRESS_RUST of the time. REGRESS_RATINGS of
  // the skill and football IQ ratings his position is graded on (never the physical ones) lose REGRESS_POINTS each, and
  // the points go back into his room, so he can earn them again. The year's own growth in skill and football IQ is
  // taken back by the caller (_develop_all): a step back is the whole year. Its own stream (`regress-{year}-{id}`): no other draw moves. Returns the
  // note for his report, or None when he held.
  const z = get(perf || {}, "z");
  let case_, odds;
  if (z !== null && z <= offseason.REGRESS_Z) {
    case_ = "struggle"; odds = offseason.REGRESS_STRUGGLE;
  } else if (truthy(benched) && int(get(p, "yrs") || 0) >= offseason.REGRESS_YEARS && _in(get(p, "c"), clear.SLOW_LEVELS)) {
    case_ = "rust"; odds = offseason.REGRESS_RUST;
  } else {
    return null;
  }
  const rng = new Random(`regress-${year}-${p["id"]}`);
  if (rng.random() >= odds) return null;
  let able = [];
  attrs.forEach((k, i) => { if (!_in(k, offseason.PHYSICAL) && p["r"][i] > 1) able.push(i); });
  const matter = game_scale.position_skills(p["pos"]);      // what slips is his own game (the skills his position is graded on): it shows
  const own = able.filter((i) => _in(attrs[i], matter));
  if (own.length) able = own;
  if (!able.length) return null;
  for (const i of rng.sample(able, Math.min(offseason.REGRESS_RATINGS, able.length))) {
    const n = Math.min(rng.randint(offseason.REGRESS_POINTS[0], offseason.REGRESS_POINTS[1]), p["r"][i] - 1);
    p["r"][i] -= n;
    p["g"][i] += n;
  }
  p["o"] = lg.overall(p, attrs);
  return offseason.REGRESS_NOTES[case_];
}

function age_factor(age) {
  // A coach's pace by age (COACH_AGE); 0 from 63: he no longer gains.
  for (const [upto, f] of offseason.COACH_AGE) {
    if (age < upto) return f;
  }
  return 0.0;
}

function pot_mean(age) {
  // Where his hidden level sits against his rating, on average, at his age (COACH_POT).
  for (const [upto, m] of offseason.COACH_POT) {
    if (upto === null || age < upto) return m;
  }
  return offseason.COACH_POT[offseason.COACH_POT.length - 1][1];
}

function _round(x, rng) {
  // x to a whole number, the fraction decided by a draw (1.3 is 1 seven times in ten, 2 the rest).
  const whole = int(x);
  const sign = x > 0 ? 1 : x < 0 ? -1 : 0;
  const up = rng.random() < Math.abs(x - whole) ? 1 : 0;       // drawn whatever the sign, as the Python's product does
  return whole + sign * up;
}

function grow_coach(ratings, pot, age, perf, rng, base = null, pace = 1.0) {
  // One offseason for a coach's ratings, in place: each closes COACH_RATE of its gap to his hidden
  // level (up, or down when he is rated over it) at his age's pace times `pace`, never past the level,
  // plus a point of noise, plus his year's verdict (`perf`: the points a top- or bottom-third year adds,
  // one number or one per rating); from 63 he gains nothing toward his level, each rating drops a
  // point (a second one COACH_DECLINE of the time) and his year counts COACH_PERF_OLD. A rating never
  // climbs more than COACH_CLIMB over `base` (where he was first seen; without it, over his level).
  // His overall follows. Floors COACH_FLOOR (a rating already under it is held, not lifted), caps
  // COACH_CAP. Returns {rating: change}.
  const f = offseason.age_factor(age);
  const out = {};
  for (const k of sorted(Object.keys(ratings))) {
    if (k === "overall") continue;
    const v = ratings[k];
    const level = get(pot, k, v);
    const pf = is_dict(perf) ? get(perf, k, 0.0) : perf;
    let d;
    if (f === 0) {
      d = -1 - (rng.random() < offseason.COACH_DECLINE ? 1 : 0) + offseason._round(pf * offseason.COACH_PERF_OLD * pace, rng);
    } else {
      const gap = level - v;
      d = offseason._round(offseason.COACH_RATE * gap * f * pace, rng);
      d = gap > 0 ? Math.min(d, gap) : Math.max(d, gap);                 // toward his level, never past it ...
      const year_ = offseason._round(pf * pace, rng);
      d += year_ + (v >= offseason.COACH_FLOOR ? rng.choice([-1, 0, 0, 1]) : 0);   // ... then his year and a point of noise
    }
    const top = Math.min(offseason.COACH_CAP, get(base || {}, k, Math.max(v, level) - offseason.COACH_CLIMB) + offseason.COACH_CLIMB);
    const new_ = int(Math.max(Math.min(offseason.COACH_FLOOR, v), Math.min(Math.max(top, v), v + d)));   // under the floor he is only held; the climb cap never cuts him
    if (new_ !== v) {
      out[k] = new_ - v;
      ratings[k] = new_;
    }
  }
  if (has(ratings, "overall") && Object.keys(out).length) {
    const rest = Object.entries(ratings).filter(([k, _]) => k !== "overall").map(([_, v]) => v);
    ratings["overall"] = int(round(sum(rest) / rest.length));
  }
  return out;
}

function _pot(c, ratings, rng, age) {
  // His hidden levels, drawn once per rating when first seen (COACH_POT at his age against the rating,
  // never under a rating already below the floor nor over COACH_CLIMB above it) and kept on him with
  // `base`, the ratings he was first seen at.
  if (!has(c, "pot")) c["pot"] = {};
  const pot = c["pot"];
  if (!has(c, "base")) c["base"] = {};
  const base = c["base"];
  for (const k of sorted(Object.keys(ratings))) {
    if (k !== "overall" && !has(pot, k)) {
      const d = rng.gauss(offseason.pot_mean(age), offseason.COACH_POT_SD);
      pot[k] = int(Math.max(Math.min(offseason.COACH_FLOOR, ratings[k]), Math.min(offseason.COACH_CAP, ratings[k] + offseason.COACH_CLIMB, ratings[k] + d)));
    }
    if (k !== "overall" && !has(base, k)) base[k] = ratings[k];
  }
  return pot;
}

function _league_marks(state) {
  // Each program's year on the _staff_marks scale: offense (O) and defense (D) by points a game against
  // the FBS (top third +2, bottom third -2), the win share third (W), the class rank (class: top 25 +2,
  // outside the top 70 -1).
  const season = modules.season;
  const ss = get(state, "season_stats") || {};
  const out = {};
  for (const slug of Object.keys(state["league"]["teams"])) out[slug] = {};

  const thirds = (ranked, key) => {
    const n = ranked.length;
    ranked.forEach((slug, i) => {
      if (has(out, slug)) out[slug][key] = i < n / 3 ? offseason.STAFF_MARK : i >= 2 * n / 3 ? -offseason.STAFF_MARK : 0;
    });
  };

  const pts = [], allowed = [];
  for (const [slug, t] of Object.entries(ss)) {
    if (slug === "__meta__" || !is_dict(t) || !truthy(get(t, "games"))) continue;
    pts.push([t["points"] / t["games"], slug]);
    allowed.push([t["opp_points"] / t["games"], slug]);
  }
  thirds(sorted(pts, (x) => x, true).map(([_, s]) => s), "O");
  thirds(sorted(allowed).map(([_, s]) => s), "D");
  const recs = season._records(state, null, true);
  const shares = [];
  for (const [s, r] of Object.entries(recs)) {
    if (has(out, s)) shares.push([r["wins"] / Math.max(1, r["wins"] + r["losses"]), s]);
  }
  thirds(sorted(shares, (x) => x, true).map(([_, s]) => s), "W");
  try {
    const table = prospects.class_table(state);          // the league's own verdict: every commitment counts
    const points = {};
    for (const [s, t] of Object.entries(table)) if (truthy(t["pids"])) points[s] = t["points"];
    if (Object.keys(points).length >= offseason.CLASS_MARK_MIN) {              // a season without recruiting (a tool's quick loop) is nobody's verdict
      for (const slug of Object.keys(out)) {
        const cr = has(table, slug) ? table[slug]["rank"] : 1 + Object.keys(points).length;
        out[slug]["class"] = cr <= 25 && truthy(get(points, slug)) ? offseason.STAFF_MARK : cr > 70 || !truthy(get(points, slug)) ? -1 : 0;
      }
    }
  } catch (e) {  // noqa: BLE001 (the Python's `except Exception`: whatever goes wrong, no class verdict)
    // pass
  }
  return out;
}

function _why(age, unit, m, gained) {
  const words_ = { O: "offense", D: "defense", W: "record" };
  const out = [];
  const ages = offseason.COACH_AGE;
  if (age >= ages[ages.length - 1][0] && !truthy(gained)) out.push("Slowing with age");
  else if (age < ages[0][0] && truthy(gained)) out.push("Young and improving");
  if (has(words_, unit) && get(m, unit) === offseason.STAFF_MARK) out.push(`Top-third ${words_[unit]}`);
  else if (has(words_, unit) && get(m, unit) === -offseason.STAFF_MARK) out.push(`Bottom-third ${words_[unit]}`);
  if (get(m, "class") === offseason.STAFF_MARK) out.push("Top-25 class");
  else if (get(m, "class", 0) < 0) out.push("Class outside the top 70");
  return out;
}

function _develop_coaches(state) {
  // Every coach in the league develops like a player, once a year at the Development stage: head
  // coaches, coordinators, your recruiters and the coaches for hire (grow_coach toward his hidden
  // level; its own stream, so nothing in the season moves). A coordinator's ratings follow his unit's year, a head coach's his
  // record, everyone's recruiting the class (your staff by _staff_marks); the market at COACH_IDLE.
  // Your OC and DC on career.staff mirror the team's coaches. Returns {"mine": rows for the Staff
  // step, "moved": ratings changed around the league}.
  const lgd = state["league"];
  const rng = offseason._rng(state, "coaches");
  const year = state["offseason"]["year"];
  const me = state["team"];
  const marks = offseason._league_marks(state);
  const mine = offseason._staff_marks(state);
  marks[me] = { ...get(marks, me, {}), O: get(mine, "OC", 0), D: get(mine, "DC", 0), class: get(mine, "class", 0) };
  const units = { head_coach: "W", offensive_coordinator: "O", defensive_coordinator: "D" };
  const short = { head_coach: "HC", offensive_coordinator: "OC", defensive_coordinator: "DC" };
  const rows = [];
  let moved = 0;

  const row = (id_, name, role, age, unit, m, changes, before) => ({
    id: id_, name: name, role: role, age: age, why: offseason._why(age, unit, m, Object.values(changes).some((d) => d > 0)),
    changes: Object.entries(changes).map(([k, d]) => ({ rating: get(offseason.RATING_WORDS, k, k), from: before[k], to: before[k] + d })),
  });

  for (const slug of sorted(Object.keys(lgd["teams"]))) {
    const t = lgd["teams"][slug];
    const m = get(marks, slug, {});
    for (const [role, unit] of Object.entries(units)) {
      const c = get(t["coaches"], role);
      if (!(truthy(c) && truthy(get(c, "name")) && truthy(get(c, "ratings")))) continue;
      const age = carousel._age(c, year);
      const before = { ...c["ratings"] };
      const perf = {};
      for (const k of Object.keys(c["ratings"])) perf[k] = _perf_of(get(m, k === "recruiting" ? "class" : unit, 0));
      const pot = offseason._pot(c, c["ratings"], rng, age);
      const changes = offseason.grow_coach(c["ratings"], pot, age, perf, rng, c["base"]);
      moved += Object.keys(changes).length;
      if (slug === me) {
        const you = get(get(state, "career") || {}, "coach");
        const name = role === "head_coach" && truthy(you) ? "You" : c["name"];
        rows.push(row(short[role].toLowerCase(), name, short[role], age, unit, m, changes, before));
      }
    }
  }
  const staff_rows = {};
  for (const r of rows) if (r["role"] === "OC" || r["role"] === "DC") staff_rows[r["role"]] = r;
  for (const s of get(get(state, "career") || {}, "staff") || []) {
    const key = get(offseason.STAFF_ROLES, s["role"]);
    const c = truthy(key) ? get(lgd["teams"][me]["coaches"], key) : null;
    if (truthy(c) && get(c, "name") === s["name"] && truthy(get(c, "ratings"))) {      // your coordinator: the team's coach, mirrored
      const ev = int(get(c["ratings"], "player_development", s["evaluation"])), rec = int(get(c["ratings"], "recruiting", s["recruiting"]));
      s["evaluation"] = ev; s["recruiting"] = rec;
      if (has(staff_rows, s["role"])) staff_rows[s["role"]]["id"] = s["id"];
      continue;
    }
    if (!truthy(get(s, "age_at"))) s["age_at"] = [year, rng.randint(offseason.COACH_AGE_UNKNOWN[0], offseason.COACH_AGE_UNKNOWN[1])];
    const age = carousel._age(s, year);
    const ratings = { evaluation: s["evaluation"], recruiting: s["recruiting"] };
    const before = { ...ratings };
    const perf = s["role"] === "Recruiter" ? _perf_of(get(marks[me], "class", 0))
      : { evaluation: _perf_of(get(marks[me], key === null ? "W" : get(units, key, "W"), 0)), recruiting: _perf_of(get(marks[me], "class", 0)) };
    const pot = offseason._pot(s, ratings, rng, age);
    const changes = offseason.grow_coach(ratings, pot, age, perf, rng, s["base"]);
    s["evaluation"] = ratings["evaluation"]; s["recruiting"] = ratings["recruiting"];
    moved += Object.keys(changes).length;
    rows.push(row(s["id"], s["name"], s["role"], age, key === null ? "class" : get(units, key, "class"), marks[me], changes, before));
  }
  for (const e of get(get(lgd, "market") || {}, "coaches", [])) {               // the coaches for hire, slowly
    if (!truthy(get(e, "ratings"))) continue;
    const age = e["age"] + (year - e["year"]);
    const pot = offseason._pot(e, e["ratings"], rng, age);
    const changes = offseason.grow_coach(e["ratings"], pot, age, 0.0, rng, e["base"], offseason.COACH_IDLE);
    moved += Object.keys(changes).length;
    for (const r of Object.values(get(e, "ratings_by_role") || {})) {
      for (const [k, d] of Object.entries(changes)) {
        if (has(r, k)) r[k] = int(Math.max(offseason.COACH_FLOOR, Math.min(offseason.COACH_CAP, r[k] + d)));
      }
    }
  }
  const order = { HC: 0, OC: 1, DC: 2 };
  rows.sort((a, b) => cmp([get(order, a["role"], 3), a["id"]], [get(order, b["role"], 3), b["id"]]));
  return { mine: rows, moved: moved };
}

function _develop_all(state) {
  // Everyone back from last season develops; transfers too; this year's signees arrive as they are.
  const lgd = state["league"];
  const rng = offseason._rng(state, "develop");
  const attrs = offseason._attrs(lgd);
  const perf = get(state["offseason"], "performance") || {};
  const levels = recruits.COACHABILITY.map(([name, _, __]) => name);
  const crng = offseason._rng(state, "coachability");
  const year = get(state["offseason"], "year") || get(lgd, "year") || 0;
  const moves = { up: 0, down: 0 };
  const gains = [], mine = [];
  let breakouts = 0;
  const PHYSICAL = offseason.PHYSICAL, GROUP = offseason.GROUP, STARTERS = offseason.STARTERS;
  for (const [slug, t] of Object.entries(lgd["teams"])) {
    const depth = truthy(get(t, "roster")) ? offseason._depth_values(t["roster"]) : null;
    const era_was = offseason.ERA_PERSIST * get(t, "era", 0.0);
    const era = t["era"] = era_was + rng.gauss(0, offseason.ERA_SD * Math.sqrt(1 - sq(offseason.ERA_PERSIST)));
    const team_base = Math.exp(era - sq(offseason.ERA_SD) / 2);
    const team_year = team_base * Math.exp(rng.gauss(-sq(offseason.TEAM_YEAR_SD) / 2, offseason.TEAM_YEAR_SD));
    for (const p of t["roster"]) {
      const signed = get(p, "signed", false);
      delete p["signed"];
      if (truthy(signed)) continue;
      let [mult, room, why, level_up] = offseason.growth_terms(get(perf, p["id"]));
      mult *= team_year * Math.exp(rng.gauss(-sq(offseason.PLAYER_YEAR_SD) / 2, offseason.PLAYER_YEAR_SD));
      if (truthy(room)) {                       // a big year raises his ceiling where it shows: skill and football IQ
        const n = Math.min(attrs.length, p["g"].length);
        const lifted = [];
        for (let i = 0; i < n; i++) lifted.push(!_in(attrs[i], PHYSICAL) ? p["g"][i] + room : p["g"][i]);
        const m = Math.min(lifted.length, p["r"].length);
        const capped = [];
        for (let i = 0; i < m; i++) capped.push(Math.min(lifted[i], 99 - p["r"][i]));
        p["g"] = capped;
        breakouts += 1;
      }
      if (clear.on()) {                 // Clear Mode: ceilings move both ways (a struggling year, a slow learner, a drift)
        const fell = clear.ceiling_drift(p, attrs, get(perf, p["id"]), year, PHYSICAL);
        if (fell < 0 && clear.struggled(get(perf, p["id"]))) why.push(offseason.CEILING_NOTE);
      }
      if (truthy(level_up) && rng.random() < offseason.LEVEL_UP && levels.slice(1).includes(get(p, "c"))) {
        p["c"] = levels[levels.indexOf(p["c"]) - 1];
        why.push(offseason.coachability_note(p["c"], "award"));
        moves["up"] += 1;
      } else {                          // the other cases, in their own stream (the award's draw above stays where it was)
        const z = get(get(perf, p["id"]) || {}, "z");
        const rated = offseason.dev_rating(t["coaches"], p["pos"]);
        const redshirted = (get(p, "cls") || "").endsWith("RS") && get(p, "rs_year") === year - 1;
        const g_ = GROUP[p["pos"]];
        const benched = depth !== null && sum(depth[g_].map((v) => (v > p["o"] ? 1 : 0))) >= STARTERS[g_] + 2;
        const [chances, drop] = offseason.coachability_chances(get(p, "c"), get(p, "cls"), z, rated, redshirted, benched);
        const [new_, case_] = offseason.coachability_roll(get(p, "c"), chances, drop, crng);
        if (truthy(case_)) {
          p["c"] = new_;
          why.push(offseason.coachability_note(new_, case_, offseason._coach_title(t["coaches"], p["pos"])));
          moves[case_ === "benched" ? "down" : "up"] += 1;
        }
      }
      const starter = get(get(perf, p["id"]) || {}, "z") !== null;
      if (starter && offseason.year_pace(p, true) > offseason.year_pace(p)) {
        // the class he played it in: p["cls"] is already next year's (a redshirt freshman is not a sophomore)
        why.push(`Started as a ${get(offseason.STARTED_AS, get(p, "cls"), int(get(p, "yrs") || 0) === 0 ? "freshman" : "sophomore")}`);
      }
      const was = slug === state["team"] ? Array.from(p["r"]) : null;          // your players' ratings before, for the report
      const r0 = Array.from(p["r"]), g0 = Array.from(p["g"]), o0 = p["o"];     // ... and everyone's, for a step back (below)
      const factor = offseason.coach_factor(t["coaches"], p["pos"]) * mult * offseason.program_factor(state, slug);
      let g = offseason.develop(p, attrs, factor, rng, starter);
      // ... and a step back for some (regress: its own stream, after every other draw). The report's gain is the net
      const g2_ = GROUP[p["pos"]];
      const buried = depth !== null && sum(depth[g2_].map((v) => (v > p["o"] ? 1 : 0))) >= STARTERS[g2_] + 2;
      const grown = Array.from(p["r"]);
      const slipped = offseason.regress(p, attrs, get(perf, p["id"]), buried, year);
      if (truthy(slipped)) {
        // a step back is the whole year (the player's ask): his skill and football IQ do not grow at all, and
        // what slipped comes off where he started, the points back in his room; his body still fills out
        attrs.forEach((k, i) => {
          if (!_in(k, PHYSICAL)) {
            p["r"][i] = Math.max(1, r0[i] + (p["r"][i] - grown[i]));
            p["g"][i] = g0[i] + (r0[i] - p["r"][i]);
          }
        });
        p["o"] = lg.overall(p, attrs);
        why.push(slipped);
        g = p["o"] - o0;
      }
      // a hard year is told once: the step back (or the lost ceiling) already says he struggled, and both together
      // are one line (the player's find: three notes saying one thing)
      if ((truthy(slipped) || why.includes(offseason.CEILING_NOTE)) && why.includes(offseason.STRUGGLED_NOTE)) {
        why.splice(why.indexOf(offseason.STRUGGLED_NOTE), 1);
      }
      if (slipped === offseason.REGRESS_NOTES["struggle"] && why.includes(offseason.CEILING_NOTE)) {
        why.splice(why.indexOf(offseason.CEILING_NOTE), 1);
        why[why.indexOf(slipped)] = offseason.HARD_YEAR_NOTE;
      }
      p["yrs"] = get(p, "yrs", 0) + 1;
      gains.push(g);
      if (slug === state["team"]) {
        // each card attribute that moved, with where it was and is (the Development card): a view, never read back
        const grew = offseason._card_growth(was !== null && was.length ? was : p["r"], p["r"], attrs, p["pos"]);
        offseason.life(p, year - 1, "progress", { gain: g, overall: offseason.house(p["pos"], p["o"]), why: why.length ? Array.from(why) : null });
        mine.push({ id: p["id"], name: p["n"], pos: p["pos"], cls: p["cls"], gain: g, overall: p["o"], why: why, grew: grew,
          transfer: offseason._new_transfer(state["offseason"], p, slug) ? get(p, "transfer") : null });
      }
    }
  }
  mine.sort((a, b) => cmp(-a["gain"], -b["gain"]));
  return { mean_gain_ea: gains.length ? round(mean(gains), 2) : 0.0, mine: mine, raised_ceilings: breakouts,
    coachability: moves, transfers: mine.filter((r) => truthy(r["transfer"])) };
}

function _newcomer(r, slug) {
  // A generated player (recruits.recruit, drawn by the model learned from real players) on our
  // scale, in the form league.compact takes.
  const ours = game_scale.from_ea(r["ratings_ea"], r["ea_position"]);
  const pot = game_scale.potential_from_ea(r["potential_ea"], ours, r["ea_position"]);
  const potential_ours = {};
  for (const [k, v] of Object.entries(pot)) potential_ours[k] = Math.max(v, get(ours, k, v));
  return { slug: slug, name: r["name"], position: r["ea_position"], class: "FR", height: r["height"],
    weight_lbs: r["weight"], archetype: r["archetype"], dev_trait: "Normal", ours: ours,
    potential_ours: potential_ours, coachability: r["coachability"],
    stars: r["stars"], hometown: r["hometown"] };
}

function _preferred_walk_on(state, slug, group, taken) {
  // An unsigned prospect from the class who had the school on his list, at this group: the one
  // it interested most (a named walk-on, not a generated one).
  const recruiting = modules.recruiting;
  const rc = get(state, "recruiting") || {};
  if (truthy(get(rc, "portal")) || !truthy(get(rc, "prospects"))) return null;
  let best = null, best_pts = -1.0;
  for (const [pid, st_] of Object.entries(rc["status"])) {
    if (st_["signed"] !== "FCS" || truthy(get(st_, "pro")) || taken.has(pid) || !has(get(rc["lists"], pid, {}), slug)) continue;     // one who went pro in baseball is gone
    const p = rc["prospects"][pid];
    if (recruiting._group_of(p) !== group) continue;
    const pts = rc["lists"][pid][slug];
    if (pts > best_pts) { best = p; best_pts = pts; }
  }
  if (best !== null) taken.add(best["id"]);
  return best;
}

function _fill_rosters(state) {
  // Walk-ons where a group has fallen below its floor and then up to FILL_TO (the
  // thinnest groups first, against a healthy roster's make-up); rosters over the limit release
  // their lowest-rated non-seniors (counted as quitting).
  const lgd = state["league"];
  const rng = offseason._rng(state, "walk-ons");
  const attrs = offseason._attrs(lgd);
  let added = 0, released = 0;
  const walk_ons = new Map();               // (band, group) -> the generated players waiting, keyed "band group"
  const waiting = (band, g) => {
    const key = `${band} ${g}`;
    if (!walk_ons.has(key)) walk_ons.set(key, []);
    return walk_ons.get(key);
  };
  const taken = new Set();
  const season = modules.season;
  const GROUP = offseason.GROUP, FLOOR = offseason.FLOOR, TARGET = offseason.TARGET;
  for (const [slug, t] of Object.entries(lgd["teams"])) {
    const p4 = season._is_p4(slug, season.load_teams()[slug]);
    let counts = offseason._group_counts(t["roster"]);
    const wanted = [];
    for (const [g, floor] of Object.entries(FLOOR)) {
      for (let _ = 0; _ < Math.max(0, floor - counts[g]); _++) wanted.push(g);
    }
    let size = t["roster"].length + wanted.length;
    const short = { ...counts };
    for (const g of wanted) short[g] += 1;
    while (size < offseason.FILL_TO) {
      const g = maxBy(Object.keys(TARGET), (k) => (TARGET[k] - short[k]) / TARGET[k]);
      wanted.push(g);
      short[g] += 1;
      size += 1;
    }
    for (const g of wanted) {
      const pref = offseason._preferred_walk_on(state, slug, g, taken);
      if (pref !== null) {
        const c = offseason._compact_prospect(state, pref, attrs);
        c["j"] = offseason._jersey(t["roster"], c["pos"], rng);
        c["walk_on"] = c["preferred"] = true;
        t["roster"].push(c);
        added += 1;
        continue;
      }
      const band = rng.random() < (truthy(p4) ? offseason.LOWER_LEVEL_P4 : offseason.LOWER_LEVEL) ? "3" : "2";
      const pool = waiting(band, g);
      while (!pool.length) {
        const r = recruits.recruit(rng, state["offseason"]["year"], band, taken);
        waiting(band, get(GROUP, r["ea_position"], "S")).push(r);
      }
      const r = pool.pop();
      const c = lg.compact(offseason._newcomer(r, `w${state["offseason"]["year"]}-${slug}-${added}`), attrs);
      c["j"] = offseason._jersey(t["roster"], c["pos"], rng);
      if (band === "3") {                           // from FCS or junior college: a year or two of college behind him
        const years = rng.choice([1, 2]);
        for (let _ = 0; _ < years; _++) offseason.develop(c, attrs, 0.8, rng);
        c["cls"] = rng.choice(years === 1 ? ["SO", "SORS"] : ["JR", "JRRS"]);
        c["yrs"] = years;
        c["transfer"] = "FCS";
        c["transfer_year"] = get(state["offseason"], "year");
      } else {
        c["walk_on"] = true;
      }
      t["roster"].push(c);
      added += 1;
    }
    if (t["roster"].length > offseason.ROSTER_LIMIT) {
      counts = offseason._group_counts(t["roster"]);
      const spare = sorted(t["roster"].filter((p) => counts[GROUP[p["pos"]]] > FLOOR[GROUP[p["pos"]]] && !["SR", "SRRS"].includes(p["cls"])),
        (p) => p["o"]);
      const cut = new Set();
      for (const p of spare) {
        if (t["roster"].length - cut.size <= offseason.ROSTER_LIMIT) break;
        if (counts[GROUP[p["pos"]]] > FLOOR[GROUP[p["pos"]]]) {
          cut.add(p["id"]);
          counts[GROUP[p["pos"]]] -= 1;
        }
      }
      t["roster"] = t["roster"].filter((p) => !cut.has(p["id"]));
      released += cut.size;
    }
  }
  return { walk_ons: added, released: released };
}

// ----- staff and coaches ------------------------------------------------------------------------

function _staff_taken(state) {
  // The names a candidate for your staff may not have (lowercase, as recruits._name checks):
  // every coach in the league and the market, your staff and you.
  const taken = truthy(get(state, "league")) ? carousel._taken_names(state["league"]) : new Set();
  for (const s of state["career"]["staff"]) taken.add(s["name"].toLowerCase());
  const mine = coach_names.player_name(state);
  const out = new Set(taken);
  if (truthy(mine)) out.add(mine.toLowerCase());
  return out;
}

offseason.STAFF_ROLES = { OC: "offensive_coordinator", DC: "defensive_coordinator" };
offseason.STAFF_CANDIDATES = 5;            // coaches offered for each opening on your staff

function term_of(role) {
  // The contract lengths a coach in `role` (OC, DC or Recruiter) signs or asks for.
  return has(offseason.STAFF_ROLES, role) ? offseason.TERM["coordinator"] : offseason.TERM["recruiter"];
}

function expiring(s, year) {
  // His contract is up before `year` (the coming season). A member without one (an old save)
  // is treated as expiring: he shops once and signs a term.
  const until = get(s, "contract_until");
  return until === null || until < year;
}

function _staff_changes(state, poached, why = null, declined = null) {
  // Your staff: a coordinator another program hired as its head coach or who left for a bigger
  // job (the carousel), a recruiter who moves on now and then; each opening gets candidates
  // (coordinators from the coaching market, recruiters from position coaches around the country).
  // Contracts: signed for the coming season a recruiter leaves at UNDER_CONTRACT of his odds (and
  // the carousel already let a coordinator turn a job down, `declined`: role -> the school, or
  // None for a bigger job in general); with his contract up he shops: a recruiter leaves at
  // SHOPPING times his odds, a coordinator the carousel wanted for sure, one it did not want at
  // COORD_SHOP. Whoever stays at expiry re-signs a term (`renewed`). `why` says, per coordinator
  // role, how he came to leave. The new draws come after today's, in the same stream (your staff's
  // ratings now move in `_develop_coaches` at the Development stage, not here).
  const rng = offseason._rng(state, "staff");
  const staff = state["career"]["staff"];
  const year = state["offseason"]["year"];
  const STAFF_ROLES = offseason.STAFF_ROLES;
  const leaving = [], candidates = {}, reasons = {}, renewed = [], turned_down = {};
  const taken = offseason._staff_taken(state);
  for (const s of staff) {
    let gone;
    if (has(STAFF_ROLES, s["role"])) {
      gone = Array.from(poached).includes(STAFF_ROLES[s["role"]]);
    } else {
      const odds = offseason.RECRUITER_LEAVE * (offseason.expiring(s, year) ? offseason.SHOPPING : offseason.UNDER_CONTRACT);
      gone = rng.random() < Math.min(offseason.SHOP_CAP, odds);
    }
    if (gone) {
      leaving.push(s["id"]);
      candidates[s["id"]] = offseason._candidates(state, s, rng, taken);
      if (has(STAFF_ROLES, s["role"]) && truthy(get(why || {}, STAFF_ROLES[s["role"]]))) reasons[s["id"]] = why[STAFF_ROLES[s["role"]]];
    } else if (has(STAFF_ROLES, s["role"]) && has(declined || {}, STAFF_ROLES[s["role"]])) {
      turned_down[s["id"]] = (declined || {})[STAFF_ROLES[s["role"]]];
    }
  }
  for (const s of staff) {                       // a coordinator whose contract is up and whom nobody wanted still shops
    if (!leaving.includes(s["id"]) && has(STAFF_ROLES, s["role"]) && offseason.expiring(s, year) && rng.random() < offseason.COORD_SHOP) {
      leaving.push(s["id"]);
      candidates[s["id"]] = offseason._candidates(state, s, rng, taken);
      reasons[s["id"]] = "took a coordinator job elsewhere";
    }
  }
  for (const s of staff) {                       // the stayers whose contracts are up re-sign
    if (!leaving.includes(s["id"]) && offseason.expiring(s, year)) {
      const term = offseason.term_of(s["role"]);
      s["contract_until"] = year + rng.randint(term[0], term[1]) - 1;
      s["ask"] = null;                           // asked raise on renewal: not yet (the money step)
      renewed.push({ id: s["id"], name: s["name"], role: s["role"], through: s["contract_until"] });
    }
  }
  return { leaving: leaving, candidates: candidates, hired: {}, reasons: reasons, renewed: renewed, turned_down: turned_down };
}

offseason.STAFF_MARK = 2;                  // a top-third offense or defense lifts its coordinator this much a year; a bottom third costs it

function _staff_marks(state) {
  // What the year says about your staff: the offense's scoring and the defense's against the FBS
  // (top third +STAFF_MARK, bottom third -STAFF_MARK), the class rank for every recruiter.
  const ss = get(state, "season_stats") || {};
  const me = state["team"];
  const pts = [], allowed = [];
  for (const [slug, t] of Object.entries(ss)) {
    if (slug === "__meta__" || !is_dict(t) || !truthy(get(t, "games"))) continue;
    pts.push([t["points"] / t["games"], slug]);
    allowed.push([t["opp_points"] / t["games"], slug]);
  }
  const out = {};
  if (pts.length) {
    pts.sort((a, b) => cmp(b, a));
    allowed.sort((a, b) => cmp(a, b));
    const n = pts.length;
    const at_o = pts.findIndex(([_, s]) => s === me), at_d = allowed.findIndex(([_, s]) => s === me);
    const rank_o = at_o === -1 ? null : at_o, rank_d = at_d === -1 ? null : at_d;
    for (const [role, rank] of [["OC", rank_o], ["DC", rank_d]]) {
      if (rank !== null) out[role] = rank < n / 3 ? offseason.STAFF_MARK : rank >= 2 * n / 3 ? -offseason.STAFF_MARK : 0;
    }
  }
  try {
    const cr = prospects.class_rank(state, me);
    out["class"] = truthy(cr) && cr <= 25 ? offseason.STAFF_MARK : truthy(cr) && cr > 70 ? -1 : 0;
  } catch (e) {  // noqa: BLE001 (the Python's `except Exception`)
    out["class"] = 0;
  }
  return out;
}

function _candidates(state, s, rng, taken) {
  // The coaches offered for an opening: the market's best for a coordinator's job (with why each
  // is available and where he has been), generated position coaches for a recruiter's.
  if (!has(offseason.STAFF_ROLES, s["role"])) {
    const made = [];
    for (let _ = 0; _ < offseason.STAFF_CANDIDATES; _++) made.push(offseason._candidate(rng, s, taken));
    return made;
  }
  const role = offseason.STAFF_ROLES[s["role"]];
  const year = state["offseason"]["year"];
  const out = [];
  for (const [score, e] of carousel.market_candidates(state, state["team"], role, offseason.STAFF_CANDIDATES, rng, year)) {
    const r = e["ratings_by_role"][role];
    out.push({ name: e["name"], role: s["role"], evaluation: int(get(r, "player_development", 60)),
      recruiting: int(get(r, "recruiting", 60)), play_calling: int(get(r, "play_calling", 60)),
      why: e["why"], previous_job: carousel._previous_job(e), from_market: true, market_id: e["id"],
      age: e["age"] + (year - e["year"]), history: e["history"].map((h) => ({ ...h, team_name: carousel._name(h["team"]) })) });
  }
  while (out.length < offseason.STAFF_CANDIDATES) out.push(offseason._candidate(rng, s, taken));
  for (const c of out) {                              // the term he wants (drawn after the rest, so the market picks stand)
    const term = offseason.term_of(s["role"]);
    const years = rng.randint(term[0], term[1]);      // drawn for every candidate, as setdefault's argument is
    if (!has(c, "years")) c["years"] = years;
  }
  return out;
}

function _candidate(rng, s, taken) {
  const name = recruits._name(rng, taken);
  taken.add(name);
  const prev = rng.choice(["Position coach at a Group of 5 program", "Recruiting coordinator at an FCS program",
    "High school head coach", "Position coach at a Power 4 program", "Graduate assistant turned recruiter"]);
  const evaluation = int(Math.max(40, Math.min(92, rng.gauss(64, 10))));
  const recruiting_ = int(Math.max(40, Math.min(92, rng.gauss(64, 10))));
  const term = offseason.term_of(s["role"]);
  return { name: name, role: s["role"], evaluation: evaluation,
    recruiting: recruiting_, why: "Looking for a step up", previous_job: prev,
    from_market: false, years: rng.randint(term[0], term[1]) };
}

function open_role(state, staff_id) {
  // You let a coordinator or recruiter go at the Staff step: he joins the coaching market and
  // his job gets candidates.
  const off = get(state, "offseason") || {};
  const staff_off = get(off, "staff");
  if (get(off, "stage") !== "staff" || !truthy(staff_off)) throw new ValueError("staff changes are made at the Staff step");
  const s = state["career"]["staff"].find((x) => x["id"] === staff_id) ?? null;
  if (s === null) throw new ValueError("no such staff member");
  if (staff_off["leaving"].includes(s["id"])) throw new ValueError("that job is already open");
  const me = state["team"], year = off["year"];
  const key = get(offseason.STAFF_ROLES, s["role"]);
  const coaches = state["league"]["teams"][me]["coaches"];
  if (truthy(key) && truthy(get(coaches, key)) && get(coaches[key], "name") === s["name"]) {
    carousel.market_add(state, coaches[key], key, me, `Let go by ${carousel._name(me)} after the season`, year);
  }
  if (!has(off, "coaching_changes")) off["coaching_changes"] = [];
  off["coaching_changes"].push({ team: me, role: key || "recruiter", old: s["name"], reason: "let go" });
  if (!has(off, "staff_open")) off["staff_open"] = {};
  off["staff_open"][s["id"]] = "was let go";
  staff_off["leaving"].push(s["id"]);
  const rng = offseason._rng(state, `open-${s["id"]}`);
  staff_off["candidates"][s["id"]] = offseason._candidates(state, s, rng, offseason._staff_taken(state));
  return staff_off;
}

function hire(state, staff_id, index) {
  const off = state["offseason"];
  const staff = off["staff"];
  if (!truthy(staff) || !has(staff["candidates"], staff_id)) throw new ValueError("no opening for that staff member");
  const cands = staff["candidates"][staff_id];
  if (!(0 <= index && index < cands.length)) throw new ValueError("no such candidate");
  staff["hired"][staff_id] = index;
  return staff;
}

function _apply_staff(state) {
  // Openings are filled: your pick, else the best candidate (Auto). A coordinator hired from
  // the market takes the job with his own ratings and leaves the pool.
  const staff = state["career"]["staff"], off = state["offseason"]["staff"];
  const out = [];
  const me = state["team"], year = state["offseason"]["year"];
  const coaches = state["league"]["teams"][me]["coaches"];
  for (const s of staff) {
    if (!off["leaving"].includes(s["id"])) continue;
    const cands = off["candidates"][s["id"]];
    let i = get(off["hired"], s["id"]);
    if (i === null) i = maxBy(range(cands.length), (j) => cands[j]["evaluation"] + cands[j]["recruiting"]);
    const c = cands[i];
    out.push({ role: s["role"], old: s["name"], new: c["name"], previous_job: get(c, "previous_job"),
      through: year + get(c, "years", 1) - 1 });
    s["name"] = c["name"]; s["evaluation"] = c["evaluation"]; s["recruiting"] = c["recruiting"];
    s["contract_until"] = year + get(c, "years", 1) - 1; s["ask"] = null;
    delete s["pot"];                             // his own ceiling is drawn when he is first seen (coach development)
    const key = get(offseason.STAFF_ROLES, s["role"]);
    if (truthy(key) && truthy(get(c, "market_id"))) {
      try {
        coaches[key] = carousel.market_take(state, c["market_id"], key, me, year);
        continue;
      } catch (e) {
        if (!(e instanceof ValueError)) throw e;
      }
    }
    if (truthy(key) && truthy(get(coaches, key))) {
      delete coaches[key]["vacant"];
      coaches[key]["name"] = c["name"];
      coaches[key]["ratings"]["player_development"] = c["evaluation"];
      coaches[key]["ratings"]["recruiting"] = c["recruiting"];
      coaches[key]["since"] = year;
      coaches[key]["previous_job"] = get(c, "previous_job", "");
    }
  }
  return out;
}

Object.assign(offseason, {
  _carry_over, program_factor, _dev_side, dev_rating, coach_factor, coachability_chances, coachability_roll, coachability_note,
  _coach_title, year_pace, rv2_tier, _card_growth, develop, regress, age_factor, pot_mean, _round, grow_coach, _pot, _league_marks,
  _why, _develop_coaches, _develop_all, _newcomer, _preferred_walk_on, _fill_rosters, _staff_taken, term_of, expiring,
  _staff_changes, _staff_marks, _candidates, _candidate, open_role, hire, _apply_staff,
});
