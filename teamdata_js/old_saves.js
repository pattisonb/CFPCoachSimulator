// A save from before the game kept every number as the card's: turned into card numbers once, as it loads. This is the
// one place a save's earlier numbers are read; nothing else in the game knows them.
//
// A save is stamped `"scale": "card"` on its league and its recruiting class once it is on card numbers. Two kinds come
// before that:
// - no stamp: the league and the class were kept in the numbers the recruiting model draws, which are card numbers
//   already; only the overalls are worked out again.
// - `"ours"`: every rating, potential and overall was kept on the earlier numbers (by position group). Each is turned
//   into the card number it showed as, and every overall is worked out again from the ratings.
// The records a career keeps (its offseason, each player's story and how he was recruited) hold overalls written on the
// earlier numbers: each is turned into the overall it showed as.
import { round, int, get, isNumber, truthy } from "../engine_js/pyrt.js";
import { read_json } from "../engine_js/files.js";
import { game_scale } from "./game_scale.js";

const FILE = "data/old_saves.json";      // the tables a save from before is read with: nothing else reads them

function _line(knots, x) {
  // `x` carried along the straight lines through `knots` ([[x, y], ...], x rising), held at the ends.
  if (x <= knots[0][0]) return knots[0][1];
  if (x >= knots[knots.length - 1][0]) return knots[knots.length - 1][1];
  let i = 1;
  while (x > knots[i][0]) i++;
  const [x0, y0] = knots[i - 1], [x1, y1] = knots[i];
  return y0 + (x - x0) * (y1 - y0) / (x1 - x0);
}

const shown = {
  // what a save from before showed for its numbers
  skill(v, grp, key) {
    const t = read_json(FILE);
    const [m, sd] = get(get(t["skills"], grp) || {}, key, [50, 10]);
    const base = m + (v - 50) * sd / (v >= 50 ? t["above"] : t["below"]);
    return Math.max(1, Math.min(99, _line(t["curve"].map(([x, y]) => [y, x]), base)));
  },
  overall(v) {
    return int(round(Math.max(1, Math.min(99, _line(read_json(FILE)["overall"], Number(v))))));
  },
  coach(v) {
    return _line(read_json(FILE)["coach"], Number(v));
  },
};

/** dict(zip(attrs, values)): the pairs until the shorter one runs out. */
function zipped(attrs, values) {
  const out = {};
  for (let i = 0; i < attrs.length && i < values.length; i++) out[attrs[i]] = values[i];
  return out;
}

function card_ratings(values, attrs, pos) {
  // One player's earlier ratings (a list in `attrs` order) as the card numbers they showed as.
  const grp = game_scale.group(pos);
  return attrs.map((k, i) => (i < values.length ? game_scale.whole(shown.skill(values[i], grp, k)) : game_scale.MISSING));
}

function card_overall(o) {
  return isNumber(o) ? shown.overall(o) : o;
}

function league_player(c, attrs, earlier) {
  // A league row on card numbers: its ratings and room (`earlier`: they were on the earlier numbers), its overall
  // worked out again.
  if (earlier) {
    const now = card_ratings(c["r"], attrs, c["pos"]);
    const top = card_ratings(c["r"].map((v, i) => v + get(c["g"], i, 0)), attrs, c["pos"]);
    c["r"] = now;
    c["g"] = now.map((v, i) => Math.max(0, top[i] - v));
    for (const row of get(c, "life") || []) {
      if (isNumber(get(row, "overall"))) {
        const was = row["overall"];
        row["overall"] = card_overall(was);
        if (isNumber(get(row, "gain"))) row["gain"] = card_overall(was) - card_overall(was - row["gain"]);
      }
    }
    if (truthy(get(c, "rec")) && isNumber(get(c["rec"], "overall"))) c["rec"]["overall"] = card_overall(c["rec"]["overall"]);
    if (Array.isArray(get(c, "moved_attrs"))) c["moved_attrs"] = card_ratings(c["moved_attrs"], attrs, get(c, "moved_from") || c["pos"]);
  } else {
    c["r"] = c["r"].map((v) => game_scale.whole(v));
  }
  c["o"] = game_scale.overall(zipped(attrs, c["r"]), c["pos"], get(c, "dmv"));
}

function coach_numbers(r) {
  // A coach's ratings (or his hidden ceilings, `pot`) as the card numbers they showed as.
  if (r === null || typeof r !== "object") return;
  for (const [k, v] of Object.entries(r)) if (isNumber(v)) r[k] = int(round(shown.coach(v)));
}

function coach(c) {
  if (c === null || typeof c !== "object") return;
  coach_numbers(get(c, "ratings"));
  for (const r of Object.values(get(c, "ratings_by_role") || {})) coach_numbers(r);
  coach_numbers(get(c, "pot"));
  coach_numbers(get(c, "base"));
}

function coaches(state, lg) {
  // Every coach the career keeps (the league's staffs, the coaching market, your staff and its candidates) on card numbers.
  for (const t of Object.values(lg["teams"])) for (const c of Object.values(get(t, "coaches") || {})) coach(c);
  for (const c of get(get(lg, "market") || {}, "coaches") || []) coach(c);
  const staff_numbers = (m) => {
    if (m === null || typeof m !== "object") return;
    for (const k of ["evaluation", "recruiting", "play_calling"]) if (isNumber(get(m, k))) m[k] = int(round(shown.coach(m[k])));
    coach_numbers(get(m, "pot"));
    coach_numbers(get(m, "base"));
  };
  for (const m of get(get(state, "career") || {}, "staff") || []) staff_numbers(m);
  for (const list of Object.values(get(get(state, "offseason") || {}, "candidates") || {})) for (const m of list || []) staff_numbers(m);
}

function records(obj) {
  // Every player row in a career's records (a dict with an overall and a position): its overall, and a gain with it.
  if (Array.isArray(obj)) { for (const x of obj) records(x); return; }
  if (obj === null || typeof obj !== "object") return;
  const pos = get(obj, "pos") || get(obj, "position");
  if (truthy(pos) && typeof pos === "string" && isNumber(get(obj, "overall"))) {
    const was = obj["overall"];
    obj["overall"] = card_overall(was);
    if (isNumber(get(obj, "gain"))) obj["gain"] = card_overall(was) - card_overall(was - obj["gain"]);
  }
  for (const v of Object.values(obj)) if (v !== null && typeof v === "object") records(v);
}

// what a god-mode edit from before changed that was on the earlier numbers (the engine's ratings and the card's
// attributes): dropped, the edit's other changes (jersey, class, size, trait) kept
const EDITED_EARLIER = ["speed", "strength", "intelligence", "endurance", "passing", "decision_making", "elusiveness", "vision",
  "hands", "route_running", "run_blocking", "pass_blocking", "rushing", "tackling", "coverage", "kick_power", "kick_accuracy",
  "punt_power", "punt_accuracy", "return_rating", "attributes"];

function edits(state) {
  for (const team of Object.values(get(state, "player_edits") || {})) {
    for (const [slug, e] of Object.entries(team || {})) {
      if (e === null || typeof e !== "object" || truthy(get(e, "skills"))) continue;   // (an edit already on card numbers)
      for (const k of EDITED_EARLIER) delete e[k];
      if (!Object.keys(e).length) delete team[slug];
    }
  }
}

export function upgrade(state) {
  // A save from before card numbers, on card numbers (in place). Returns whether anything changed.
  let changed = false;
  edits(state);                                           // (any season's: an edit on card numbers is left as it is)
  const lg = get(state, "league");
  const league_earlier = truthy(lg) && get(lg, "scale") !== "card";
  if (league_earlier) {
    const earlier = get(lg, "scale") === "ours";
    const attrs = lg["attrs"];
    for (const t of Object.values(lg["teams"])) for (const c of t["roster"]) league_player(c, attrs, earlier);
    for (const e of Object.values(get(get(get(state, "offseason") || {}, "portal") || {}, "players", {}))) {
      if (truthy(get(e, "player"))) league_player(e["player"], attrs, earlier);
    }
    coaches(state, lg);                                   // (coaches were on the earlier numbers in every save before)
    if (earlier) {
      records(get(state, "offseason"));
      records(get(get(state, "career") || {}, "history"));
    }
    lg["scale"] = "card";
    lg["overall_v"] = game_scale.overall_version();
    game_scale.modules.league?.forget(state["id"]);     // its built teams files were on the earlier numbers
    changed = true;
  }
  const rc = get(state, "recruiting");
  if (truthy(rc) && truthy(get(rc, "prospects")) && get(rc, "scale") !== "card") {
    const earlier = get(rc, "scale") === "ours";
    const attrs = rc["attrs"];
    const old = {};
    for (const [pid, p] of Object.entries(rc["prospects"])) old[pid] = { ...(get(p, "truth") || {}) };
    for (const p of Object.values(rc["prospects"])) {
      const pos = p["ea_position"];
      if (Array.isArray(get(p, "ratings_ea"))) {                // kept in the model's own numbers: card numbers already
        p["ratings"] = p["ratings_ea"].map((v) => game_scale.whole(v));
        p["potential"] = (get(p, "potential_ea") || p["ratings_ea"]).map((v) => game_scale.whole(v));
        delete p["ratings_ea"];
        delete p["potential_ea"];
      } else if (earlier) {
        p["ratings"] = card_ratings(p["ratings"], attrs, pos);
        p["potential"] = card_ratings(p["potential"], attrs, pos);
      }
      for (const k of ["overall_ea", "overall"]) delete p[k];
      p["ovr"] = game_scale.overall(zipped(attrs, p["ratings"]), pos);
      p["pot_ovr"] = game_scale.overall(zipped(attrs, p["potential"]), pos);
    }
    game_scale.modules.recruiting._truths(rc["prospects"], attrs);
    for (const [pid, read] of Object.entries(get(rc, "reads") || {})) {   // each read keeps how far off it was
      const p = get(rc["prospects"], pid);
      if (p === null || !truthy(get(read, "g"))) continue;
      for (const [g, [mean, prec]] of Object.entries(read["g"])) {
        if (isNumber(get(old[pid], g))) read["g"][g] = [round(p["truth"][g] + (mean - old[pid][g]), 3), prec];
      }
    }
    rc["grades"] = "game";
    rc["scale"] = "card";
    rc["overall_v"] = game_scale.overall_version();
    changed = true;
  }
  return changed;
}

export const old_saves = { FILE, upgrade, shown };
