// AP poll, CFP committee rankings and the 12-team bracket.
//
// The AP model keeps a "poll score" per team. Each week every team's score moves by its
// result: a win adds points scaled by the opponent's standing, the venue and the margin; a
// loss subtracts points, more for losing to an unranked team or at home and less for losing
// to a top team. The 25 highest scores are the poll. The parameters in AP_PARAMS were fit
// to every weekly AP poll from 2014 to 2025 (calibrate_polls.py replays those seasons with
// the real results and minimizes the rank error against the real polls).
//
// The committee model re-ranks the AP-style scores with the things the committee is known
// to weigh differently: strength of schedule, wins over ranked teams, a discount for Group
// of Five schedules, head-to-head among close teams, and conference titles at the end.
// CFP_PARAMS were fit the same way against the committee's weekly rankings (2014-2025).
//
// The bracket follows the 2026 rules (NCAA.com, Aug 27 2026; CFP management committee,
// May 22 2025): 12 teams; the ACC, Big Ten, Big 12 and SEC champions and the highest-ranked
// team from the American, CUSA, MAC, Mountain West, Pac-12 or Sun Belt get in automatically
// (Notre Dame too if ranked in the top 12); seven at-large by ranking; seeds 1-4 are the
// four highest-ranked teams regardless of titles and get byes; an automatic qualifier ranked
// outside the top 12 takes the lowest seed(s); first round 5v12, 6v11, 7v10, 8v9 at the
// higher seed's home; quarterfinals 1v8/9, 2v7/10, 3v6/11, 4v5/12; no reseeding.
//
// Ported from sim/polls.py by engine_js/PORTING.md's rules.
import { Random, sorted, get, truthy, range } from "../engine_js/pyrt.js";
import { read_json } from "../engine_js/files.js";
import { modules } from "../engine_js/modules.js";

// The module's constants and variables live on this object and are read through it (PORTING.md rule 2).
export const polls = {};

polls.PARAMS_FILE = "data/poll_params.json";

polls.P4 = new Set(["ACC", "Big Ten", "Big 12", "SEC"]);
polls.G6 = new Set(["American Athletic Conference", "Conference USA", "MAC", "Mountain West", "Pac-12", "Sun Belt"]);
polls.INDEPENDENT = new Set(["FBS Independents", "Independent", "Independents"]);

// Defaults; calibrate_polls.py overwrites them in data/poll_params.json.
polls.AP_PARAMS = {
  rank_points: 40.0,        // preseason: score gap per poll spot
  unranked_floor: -60.0,    // preseason score of the best unranked team relative to No. 25
  rating_weight: 6.0,       // preseason: points per rating point above the league (sim only)
  win_base: 14.0,
  win_ranked_bonus: 1.2,    // x (26 - opponent rank) / 25
  win_road_bonus: 0.15,
  win_margin: 0.25,         // per point of margin, capped
  win_margin_cap: 21,
  loss_base: 55.0,
  loss_unranked_extra: 0.7,  // fraction extra for losing to an unranked team
  loss_top_discount: 0.6,    // fraction removed when losing to a top-5 team
  loss_home_extra: 0.25,
  loss_margin: 0.6,          // per point of margin, capped
  loss_margin_cap: 21,
  decay: 0.0,                // weekly pull of scores toward the record line
  record_weight: 30.0,       // points per win minus loss in the running record (season-long)
  late_record_weight: 1.5,   // multiplier for record_weight in the last 4 weeks
  g5_discount: 10.0,         // points taken from Group of Five teams
};
polls.CFP_PARAMS = {
  sos_weight: 90.0,          // points per unit of opponents' win % above .500
  quality_win_weight: 12.0,  // per win over an AP top-25 team (scaled by opponent rank)
  bad_loss_weight: 20.0,     // per loss to a team with a losing record
  g5_discount: 25.0,
  loss_weight: 18.0,         // per loss beyond the AP score's own loss handling
  head_to_head: 1.0,         // swap close teams (within this many score units x 10) by head-to-head
  champ_bonus: 12.0,         // conference champion bonus in the final ranking
};

// `k in d` for a dict (a plain object of parsed JSON or one made here).
const has = (d, k) => Object.hasOwn(d, k);

// Python's sum() of floats (3.12 and later): the running total with Neumaier's compensation, the lost low bits
// added back at the end. Whole numbers come out the same either way.
function _sum(xs) {
  let f_result = 0, c = 0.0;
  for (const x of xs) {
    const t = f_result + x;
    if (Math.abs(f_result) >= Math.abs(x)) c += (f_result - t) + x;
    else c += (x - t) + f_result;
    f_result = t;
  }
  if (c && Number.isFinite(c)) f_result += c;
  return f_result;
}

export function _saved_params() {
  // data/poll_params.json ({} before the first calibration).
  try {
    return read_json(polls.PARAMS_FILE);
  } catch (err) {
    return {};
  }
}

export function load_params() {
  const saved = polls._saved_params();
  return [{ ...polls.AP_PARAMS, ...get(saved, "ap", {}) }, { ...polls.CFP_PARAMS, ...get(saved, "cfp", {}) }];
}

export function load_next_params() {
  // The week-to-week model's fitted parameters (tools/backtest_polls.py).
  return { ...polls.NEXT_PARAMS, ...get(polls._saved_params(), "next", {}) };
}

export function load_ballot_params() {
  // The ballot model's parameters: the week-to-week ones, with the ballot fit on top
  // (tools/backtest_ballots.py fit).
  return { ...polls.load_next_params(), ...get(polls._saved_params(), "ballots", {}) };
}

// ----- AP model ------------------------------------------------------------

export function preseason_scores(preseason_poll, ratings, params) {
  // Initial poll scores. `preseason_poll` is the ordered list of team keys (top 25);
  // `ratings` is a team -> overall rating (any scale; only differences matter) for everyone.
  const scores = {};
  const n = preseason_poll.length;
  preseason_poll.forEach((t, i) => {
    scores[t] = (n - i) * params["rank_points"];
  });
  if (truthy(ratings)) {
    const rated = sorted(Object.entries(ratings), (kv) => -kv[1]);
    const ranked_avg = n ? (_sum(preseason_poll.map((t) => get(ratings, t, 0))) / Math.max(1, n)) : 0;
    for (const [t, r] of rated) {
      if (has(scores, t)) {
        scores[t] += (r - ranked_avg) * params["rating_weight"] * 0.25;   // ratings nudge inside the poll too
      } else {
        scores[t] = params["unranked_floor"] + (r - ranked_avg) * params["rating_weight"];
      }
    }
  }
  return scores;
}

export function update_scores(scores, games, prev_rank, records, tiers, week, last_week, params) {
  // One week of results. games: {"home","away","home_score","away_score","neutral"}; prev_rank: team -> AP rank
  // before the games; records: team -> (wins, losses) after the games; tiers: team -> "P4"/"G5"/"FCS".
  const new_ = { ...scores };
  for (const g of games) {
    for (const [side, opp] of [["home", "away"], ["away", "home"]]) {
      const t = g[side], o = g[opp];
      if (!has(new_, t)) new_[t] = params["unranked_floor"] - 40;
      const ts = g[`${side}_score`], os_ = g[`${opp}_score`];
      const margin = Math.abs(ts - os_);
      let opp_rank = get(prev_rank, o);
      const at_home = side === "home" && !truthy(get(g, "neutral"));
      if (get(tiers, o) === "FCS") opp_rank = null;
      if (ts > os_) {
        let gain = params["win_base"];
        if (truthy(opp_rank)) gain *= 1 + params["win_ranked_bonus"] * (26 - opp_rank) / 25;
        if (!at_home && !truthy(get(g, "neutral"))) gain *= 1 + params["win_road_bonus"];
        gain += params["win_margin"] * Math.min(margin, params["win_margin_cap"]);
        if (get(tiers, o) === "FCS") gain *= 0.4;
        new_[t] += gain;
      } else {
        let loss = params["loss_base"];
        if (opp_rank === null) loss *= 1 + params["loss_unranked_extra"];
        else if (opp_rank <= 5) loss *= 1 - params["loss_top_discount"];
        else if (opp_rank <= 15) loss *= 1 - params["loss_top_discount"] * 0.5;
        if (at_home) loss *= 1 + params["loss_home_extra"];
        loss += params["loss_margin"] * Math.min(margin, params["loss_margin_cap"]);
        new_[t] -= loss;
      }
    }
  }
  // Record line: as the season goes on, voters sort more and more by record.
  const late = week >= last_week - 3 ? params["late_record_weight"] : 1.0;
  for (const t of Object.keys(new_)) {
    const [w, l] = get(records, t, [0, 0]);
    new_[t] = new_[t] * (1 - params["decay"]) + params["record_weight"] * late * (w - l) * params["decay"];
  }
  for (const t of Object.keys(new_)) {
    if (get(tiers, t) === "G5") new_[t] -= params["g5_discount"] * 0.05;   // a small weekly drag; the main discount sits in rank()
  }
  return new_;
}

export function rank(scores, records, tiers, params, n = 25) {
  const key = (t) => {
    let s = scores[t];
    if (get(tiers, t) === "G5") s -= params["g5_discount"];
    const [w, l] = get(records, t, [0, 0]);
    return [-(s + params["record_weight"] * (w - l) * 0.0), -w, l];
  };
  const eligible = Object.keys(scores).filter((t) => get(tiers, t) !== "FCS");
  return sorted(eligible, key).slice(0, n);
}

// ----- AP week-to-week model ---------------------------------------------------
// How voters actually move a poll: last week's vote points (Top 25 and the others receiving
// votes) are the starting line, each team moves by its result, unbeaten teams get the
// benefit of the doubt, and a head-to-head winner goes above a close loser. Fit one week
// ahead (real poll + real results -> next real poll) over 2014-2023 by
// tools/backtest_polls.py; data/poll_params.json carries the fitted values under "next".
polls.NEXT_PARAMS = {
  win_base: 0.010,       // share of the maximum points gained for any win
  win_opp: 0.10,         // extra x the opponent's share of the maximum (a win over No. 1 ~ +0.10)
  win_margin: 0.010,     // extra for a 21-point win (scaled by margin, capped)
  win_road: 0.005,
  loss_base: 0.10,       // share lost for any loss
  loss_bad: 0.15,        // extra x (1 - opponent's share): losing to an unranked team costs most
  loss_margin: 0.06,     // extra for a 21-point loss
  loss_home: 0.02,
  loss_own: 0.0,         // extra x the loser's own share (top teams lose more points)
  bye: 0.0,              // change for a team that did not play
  unbeaten: 0.03,        // ranking edge for a team with no losses
  loss_edge: 0.015,      // ranking drag per loss on the season
  new_entry: 0.006,      // share per win minus 2 x losses for a team nobody voted for (P4)
  g5_entry: 0.5,         // multiplier on new_entry for a Group of Five team
  fcs_win: 0.3,          // a win over an FCS team counts this much of a normal win
  h2h: 0.04,             // a head-to-head winner goes above the loser within this share
};

export function _new_entry_value(p, record, tier) {
  // What a team nobody voted for is worth: new_entry per win minus 2 x losses (scaled
  // down for a Group of Five team), less one new_entry.
  const [w, l] = record;
  const entry = p["new_entry"] * Math.max(0, w - 2 * l);
  return entry * (tier === "G5" ? p["g5_entry"] : 1.0) - p["new_entry"];
}

export function _win_gain(p, opp_value, margin, at_home, neutral, opp_tier) {
  // A winner's gain: the base, the opponent's value, the margin (as a share of 21 points)
  // and the road, cut to fcs_win against an FCS team.
  let gain = p["win_base"] + p["win_opp"] * opp_value + p["win_margin"] * margin + (at_home || neutral ? 0 : p["win_road"]);
  if (opp_tier === "FCS") gain *= p["fcs_win"];
  return gain;
}

export function _winners_over(games) {
  // (winner, loser) for every game of the week that was not a tie.
  return games.filter((g) => g["home_score"] !== g["away_score"])
    .map((g) => (g["home_score"] > g["away_score"] ? [g["home"], g["away"]] : [g["away"], g["home"]]));
}

export function _head_to_head(order, key, winners_over, window) {
  // Put each winner just above a loser it trails by less than `window` (in place).
  for (const [w_, l_] of winners_over) {
    if (has(key, w_) && has(key, l_) && key[l_] > key[w_] && key[l_] - key[w_] < window) {
      order.splice(order.indexOf(w_), 1);
      order.splice(order.indexOf(l_), 0, w_);
    }
  }
}

export function _share_table(prev) {
  // team -> share of the maximum points (0..1) from a published poll with its others.
  const voters = _sum(prev.filter((e) => (get(e, "rank") || 99) <= 25).map((e) => get(e, "first_place") || 0)) || polls.AP_VOTERS;
  const top = 25.0 * voters;
  const share = {};
  for (const e of prev) share[e["team"]] = (get(e, "points") || 0.0) / top;
  return [share, voters];
}

export function next_poll(prev, games, records, tiers, params = null, n = 25) {
  // The next AP poll from the last one. prev: [{team, rank, points, first_place}] for the
  // Top 25 and the others receiving votes; games: this week's results; records: (wins, losses)
  // after the games. Returns the order (n teams) and each listed team's share.
  const p = { ...polls.NEXT_PARAMS, ...(params || {}) };
  const [share] = polls._share_table(prev);
  const val = { ...share };
  const played = new Set();
  for (const g of games) {
    for (const [side, opp] of [["home", "away"], ["away", "home"]]) {
      const t = g[side], o = g[opp];
      played.add(t);
      if (get(tiers, t) === "FCS") continue;
      if (!has(val, t)) val[t] = polls._new_entry_value(p, get(records, t, [0, 0]), get(tiers, t));
      const ts = g[`${side}_score`], os_ = g[`${opp}_score`];
      const m = Math.min(Math.abs(ts - os_), 21) / 21.0;
      const ov = get(share, o, 0.0);
      const at_home = side === "home" && !truthy(get(g, "neutral"));
      if (ts > os_) {
        val[t] += polls._win_gain(p, ov, m, at_home, truthy(get(g, "neutral")), get(tiers, o));
      } else {
        const bad = get(tiers, o) === "FCS" ? 1.0 : (1.0 - Math.min(1.0, ov));
        val[t] -= (p["loss_base"] + p["loss_bad"] * bad + p["loss_margin"] * m + (at_home ? p["loss_home"] : 0.0)
          + p["loss_own"] * get(share, t, 0.0));
      }
    }
  }
  for (const t of Object.keys(val)) {
    if (!played.has(t)) val[t] += p["bye"];
  }
  const key = {};
  for (const [t, v] of Object.entries(val)) {
    if (get(tiers, t) === "FCS") continue;
    const [w, l] = get(records, t, [0, 0]);
    key[t] = v + (l === 0 && w > 0 ? p["unbeaten"] : 0.0) - p["loss_edge"] * l;
  }
  const order = sorted(Object.keys(key), (t) => -key[t]);
  // head to head: this week's winner goes just above a loser it trails by less than h2h
  polls._head_to_head(order, key, polls._winners_over(games), p["h2h"]);
  return [order.slice(0, n), key];
}

polls.AP_VOTERS = 62;          // ballots on the AP panel (62 in 2024, 66 in 2025)
polls.VOTER_NOISE = 28.0;      // fit to 2014-2025 AP polls: No.1 first-place share and 25th-place points

export function ballots(order, scores, tiers, params, n_voters = polls.AP_VOTERS, seed = 0, noise = null) {
  // First-place votes and points the way the AP publishes them. Each voter ranks the
  // listed teams by the model score plus their own noise and names 25; a first place is
  // 25 points down to 1 for 25th. The totals are then handed down the published order so
  // the numbers always agree with the ranking (a close race at the top splits the
  // first-place votes; a runaway number one takes nearly all of them).
  const rng = new Random(seed);
  const eff = {};
  for (const t of order) eff[t] = get(scores, t, 0.0) - (get(tiers, t) === "G5" ? params["g5_discount"] : 0.0);
  const first = {};
  const points = {};
  const sigma = noise === null ? polls.VOTER_NOISE : noise;
  for (const _ of range(n_voters)) {
    const ballot = sorted(order, (t) => -(eff[t] + rng.gauss(0.0, sigma)));
    first[ballot[0]] = get(first, ballot[0], 0) + 1;
    ballot.slice(0, 25).forEach((t, i) => {
      points[t] = get(points, t, 0) + 25 - i;
    });
  }
  const pts_sorted = sorted(Object.values(points), undefined, true);
  const first_sorted = sorted(Object.values(first), undefined, true);
  const out = {};
  order.forEach((t, i) => {
    out[t] = { first_place: i < first_sorted.length ? first_sorted[i] : 0,
      points: i < pts_sorted.length ? pts_sorted[i] : 0 };
  });
  return out;
}

polls.COACHES_VOTERS = 65;        // AFCA panel (53-67 ballots a week in 2014-2025)
polls.COACHES_NOISE = 22.0;       // coaches are more unanimous: No.1 takes a median 93% of first places (AP 87%)
polls.COACHES_RECORD = 0.2;       // spots per game of record margin, relative to the AP order
polls.COACHES_INERTIA = 0.2;      // weight on last week's coaches spot
polls.COACHES_OPINION = 0.9;      // spots: each team's standing opinion among the coaches for the season
polls.COACHES_JITTER = 0.5;       // spots: week-to-week disagreement

export function coaches_order(ap_order, records, prev_coaches, opinion = null) {
  // The Coaches Poll order from the AP order. Over 2014-2025 the two polls agree on
  // No.1 in 95% of weeks and share 24 of 25 teams, with the coaches leaning a little
  // more on the record and on their own previous poll; this nudge reproduces that
  // (0.80 spots off the real coaches poll versus 0.84 for the AP order alone).
  const cand = {};
  ap_order.forEach((t, i0) => {
    const i = i0 + 1;
    const [w, l] = get(records, t, [0, 0]);
    const prev = get(prev_coaches, t, 30);
    // opinions matter less at the top: the two polls agree on No.1 in 95% of weeks
    const damp = Math.min(1.0, (i - 1) / 4.0);
    cand[t] = (26 - i) + polls.COACHES_RECORD * (w - l) + polls.COACHES_INERTIA * (26 - prev) + damp * get(truthy(opinion) ? opinion : {}, t, 0.0);
  });
  return sorted(ap_order, (t) => [-cand[t], ap_order.indexOf(t)]);
}

export function coaches_opinion(teams, season_seed, week) {
  // A separate panel has its own view of each team: a standing offset for the season
  // plus a little week-to-week movement, in spots. Sized so the two polls differ by about
  // 0.8 spots per team and share 24 of 25, as they did in 2014-2025.
  const out = {};
  for (const t of teams) {
    const standing = new Random(`${season_seed}:${t}`).gauss(0.0, polls.COACHES_OPINION);
    const weekly = new Random(`${season_seed}:${t}:${week}`).gauss(0.0, polls.COACHES_JITTER);
    out[t] = standing + weekly;
  }
  return out;
}

// ----- CFP committee model -------------------------------------------------

export function committee_rank(scores, records, tiers, opponents, ap_rank, champions, params, n = 25) {
  // opponents: team -> [{"opp", "won", "opp_record": (w, l)}]. champions: conference -> team (final week only).
  const adj = {};
  for (const t of Object.keys(scores)) {
    if (get(tiers, t) === "FCS") continue;
    const opps = get(opponents, t, []);
    let s = scores[t];
    if (opps.length) {
      const sos = _sum(opps.map((o) => o["opp_record"]).map(([ow, ol]) => ow / Math.max(1, ow + ol))) / opps.length - 0.5;
      s += params["sos_weight"] * sos;
    }
    for (const o of opps) {
      const orank = get(ap_rank, o["opp"]);
      if (truthy(o["won"]) && truthy(orank)) s += params["quality_win_weight"] * (26 - orank) / 25 * 2;
      const [ow, ol] = o["opp_record"];
      if (!truthy(o["won"]) && ol > ow) s -= params["bad_loss_weight"];
    }
    const [, l] = get(records, t, [0, 0]);
    s -= params["loss_weight"] * l;
    if (get(tiers, t) === "G5") s -= params["g5_discount"];
    if (truthy(champions) && Object.values(champions).includes(t)) s += params["champ_bonus"];
    adj[t] = s;
  }
  const order = sorted(Object.keys(adj), (t) => [-adj[t], -get(records, t, [0, 0])[0]]);
  // head-to-head: a team ranked just below a team it beat moves above it when scores are close
  const window = params["head_to_head"] * 10;
  let changed = true;
  let passes = 0;
  while (changed && passes < 5) {
    changed = false;
    passes += 1;
    for (const i of range(1, Math.min(order.length, n + 5))) {
      const lower = order[i], upper = order[i - 1];
      const beat = get(opponents, lower, []).some((o) => o["opp"] === upper && truthy(o["won"]));
      const lost = get(opponents, upper, []).some((o) => o["opp"] === lower && truthy(o["won"]));
      const same_losses = get(records, lower, [0, 0])[1] <= get(records, upper, [0, 0])[1];
      if (beat && !lost && same_losses && adj[upper] - adj[lower] < window) {
        order[i - 1] = lower;
        order[i] = upper;
        changed = true;
      }
    }
  }
  return order.slice(0, n);
}

// ----- bracket -------------------------------------------------------------

export function build_bracket(ranking, champions, conference_of, names = null) {
  // 12-team field and seeds under the 2026 rules. `ranking` is the final committee
  // ranking (team keys, best first, at least 12 long); `champions` maps conference -> champion.
  names = truthy(names) ? names : {};
  const pos = {};
  ranking.forEach((t, i) => {
    pos[t] = i + 1;
  });
  const autos = [];
  for (const conf of ["ACC", "Big Ten", "Big 12", "SEC"]) {
    const champ = get(champions, conf);
    if (truthy(champ)) autos.push([champ, `${conf} champion`]);
  }
  const g6 = ranking.filter((t) => polls.G6.has(get(conference_of, t)));
  if (g6.length) {
    const best = g6[0];
    let label = "Group of Six auto bid (highest ranked)";
    for (const [conf, champ] of Object.entries(champions)) {
      if (champ === best) label = `${conf} champion, Group of Six auto bid`;
    }
    autos.push([best, label]);
  }
  const nd = "notre-dame";
  if (has(pos, nd) && pos[nd] <= 12 && !new Set(autos.map(([a]) => a)).has(nd)) {
    autos.push([nd, "Notre Dame (top 12)"]);
  }
  const auto_set = new Set(autos.map(([a]) => a));
  const field = autos.map(([a]) => a);
  for (const t of ranking) {
    if (field.length >= 12) break;
    if (!auto_set.has(t)) field.push(t);
  }
  // Seeding: straight by ranking; auto qualifiers ranked outside the top 12 take the lowest seeds.
  const inside = sorted(field.filter((t) => get(pos, t, 99) <= 12), (t) => pos[t]);
  const outside = sorted(field.filter((t) => get(pos, t, 99) > 12), (t) => get(pos, t, 99));
  const seeded = inside.concat(outside);
  const reason = {};
  for (const [a, b] of autos) reason[a] = b;
  const seeds = seeded.map((t, i0) => {
    const i = i0 + 1;
    return { seed: i, team: t, name: get(names, t, t), rank: get(pos, t),
      conference: get(conference_of, t), bid: get(reason, t, "at-large"), bye: i <= 4 };
  });
  const full = seeds.length === 12;
  const first_round = full ? [{ home: seeds[4], away: seeds[11] }, { home: seeds[5], away: seeds[10] },
    { home: seeds[6], away: seeds[9] }, { home: seeds[7], away: seeds[8] }] : [];
  const quarterfinals = full ? [{ bye: seeds[0], winner_of: "5 vs 12" }, { bye: seeds[3], winner_of: "8 vs 9" },
    { bye: seeds[1], winner_of: "7 vs 10" }, { bye: seeds[2], winner_of: "6 vs 11" }] : [];
  const first_four_out = ranking.filter((t) => !auto_set.has(t) && !field.includes(t)).slice(0, 4);
  return { seeds, first_round, quarterfinals,
    first_four_out: first_four_out.map((t) => ({ team: t, name: get(names, t, t), rank: get(pos, t) })),
    autos: autos.map(([t, b]) => ({ team: t, bid: b, name: get(names, t, t) })) };
}

// ----- the AP poll from the voters' ballots ----------------------------------------------
// Each voter's ballot moves with the week's results and the voter names a new 25; the poll
// is the ballots added up (25 points for first down to 1 for 25th). One week ahead this is
// about 2% closer to the real poll than moving the vote shares; across a whole season with
// no real poll to lean on (season mode) it is 9% closer, and 26% by the last weeks, because
// each voter keeps their own view instead of the consensus drifting
// (tools/backtest_ballots.py; the season replay is in docs/HOW_IT_WORKS.md).

polls.BALLOT_SEED_NOISE = 0.06;     // a voter's spread around the consensus when ballots are made from a poll's points

// Terms only the ballot model has (on top of NEXT_PARAMS); the values here leave them off,
// data/poll_params.json "ballots" carries the fitted ones.
polls.BALLOT_PARAMS = {
  off_ballot: 0.5,         // a team off the voter's ballot is worth its consensus share x this
  close_win: 0.0,          // taken from a narrow winner: x (1 - opponent's value) x how narrow
  close_margin: 8.0,       // points: a win by this much or more is not narrow
  close_own: 0.0,          // the narrow-win cost x the winner's own value ** this (0: the same for everyone)
  loss_bad_pow: 1.0,       // the bad-loss term is loss_bad x (1 - opponent's value) ** this
  loss_ranked_cap: 1.0,    // most a loss can cost when the winner is on the voter's ballot
  loss_edge_extra: 0.0,    // extra ranking drag per loss beyond the second
  voter_noise: 0.0,        // each voter's own week-to-week wobble (sd, share of the maximum)
  entry_losses: 0.5,       // a team nobody voted for: its win counts (1 - this x its losses beyond two), so a resume
  //                          with three losses does not jump in on one upset (3 of 456 real entries since 2014 did;
  //                          two-loss entries are a quarter of them)
  entry_all: 0.0,          // an off-ballot team with votes elsewhere is worth at least this x its record value
};

export function seed_ballots(prev, n_voters = null, seed = 0, noise = polls.BALLOT_SEED_NOISE) {
  // Ballots that add up to about the given poll (its Top 25 and others receiving votes,
  // with vote points): each voter ranks the teams by their share of the vote plus their own
  // noise. Used where no real ballots exist: the preseason of a simulated season, or the
  // first simulated week after a real poll.
  const [share, voters] = polls._share_table(prev);
  const n = n_voters || voters || polls.AP_VOTERS;
  const rng = new Random(seed);
  const teams = Object.keys(share);
  const out = [];
  for (const _ of range(n)) out.push(sorted(teams, (t) => -(share[t] + rng.gauss(0.0, noise))).slice(0, 25));
  return out;
}

export function next_ballots(ballots, prev, games, records, tiers, params = null, seed = 0) {
  // Every voter's next ballot from their last one and the week's results. prev is last
  // week's published poll with vote points (the consensus a voter falls back on for a team
  // not on their ballot). `seed` drives each voter's own wobble (voter_noise). Returns
  // (the new ballots, points, first-place votes).
  const p = { ...polls.NEXT_PARAMS, ...polls.BALLOT_PARAMS, ...(params || {}) };
  const [share] = polls._share_table(prev);
  const off = p["off_ballot"];
  const rng = new Random(seed);
  const facts = [];
  const played = new Set();
  for (const g of games) {
    if (g["home_score"] === g["away_score"]) continue;
    for (const [side, opp] of [["home", "away"], ["away", "home"]]) {
      const t = g[side], o = g[opp];
      played.add(t);
      if (get(tiers, t) === "FCS") continue;
      const ts = g[`${side}_score`], os_ = g[`${opp}_score`];
      facts.push([t, o, ts > os_, Math.min(Math.abs(ts - os_), 21) / 21.0, side === "home" && !truthy(get(g, "neutral")), truthy(get(g, "neutral"))]);
    }
  }
  const winners_over = polls._winners_over(games);
  const new_ = [];
  for (const ballot of ballots) {
    const mine = {};
    ballot.slice(0, 25).forEach((t, i) => {
      mine[t] = (25 - i) / 25.0;
    });
    // off the ballot: the consensus share, scaled down (the voter left them off for a reason)
    // (Python walks a set here, in its hash order; nothing below depends on the order of `val`: its teams are
    // read one by one and then in sorted order.)
    const val = {};
    for (const t of new Set([...Object.keys(share), ...Object.keys(mine)])) val[t] = get(mine, t, get(share, t, 0.0) * off);
    for (const [t, o, won, m, at_home, neutral] of facts) {
      if (!has(mine, t)) {
        // a team the voter does not rank is worth at least what its record says
        // (entry_all: also when others vote for it), so a 6-0 team can climb past a 3-3 one
        const entry = polls._new_entry_value(p, get(records, t, [0, 0]), get(tiers, t));
        if (!has(val, t)) val[t] = entry;
        else if (p["entry_all"]) val[t] = Math.max(val[t], p["entry_all"] * entry);
      }
      const ov = get(mine, o, get(share, o, 0.0) * off);
      const own = get(mine, t, get(share, t, 0.0) * off);
      const bad = get(tiers, o) === "FCS" ? 1.0 : (1.0 - Math.min(1.0, ov));
      if (won) {
        let gain = polls._win_gain(p, ov, m, at_home, neutral, get(tiers, o));
        // a narrow escape against a weak team costs the winner (m is the margin / 21)
        gain -= p["close_win"] * bad * Math.max(0.0, 1.0 - m * 21.0 / p["close_margin"]) * Math.pow(own, p["close_own"]);
        if (!has(mine, t) && !truthy(get(share, t))) {     // nobody's team: voters weigh the whole resume
          gain *= Math.max(0.0, 1.0 - p["entry_losses"] * Math.max(0, get(records, t, [0, 0])[1] - 2));
        }
        val[t] += gain;
      } else {
        let loss = p["loss_base"] + p["loss_bad"] * Math.pow(bad, p["loss_bad_pow"]) + p["loss_margin"] * m
          + (at_home ? p["loss_home"] : 0.0) + p["loss_own"] * own;
        if (has(mine, o)) loss = Math.min(loss, p["loss_ranked_cap"]);    // losing to a team the voter ranks costs less
        val[t] -= loss;
      }
    }
    const key = {};
    const noise = p["voter_noise"];
    for (const t of sorted(Object.keys(val))) {                  // sorted: the same team draws the same noise every run
      if (get(tiers, t) === "FCS") continue;
      const [w, l] = get(records, t, [0, 0]);
      key[t] = val[t] + (!played.has(t) ? p["bye"] : 0.0) + (l === 0 && w > 0 ? p["unbeaten"] : 0.0)
        - p["loss_edge"] * l - p["loss_edge_extra"] * Math.max(0, l - 2);
      if (noise) key[t] += rng.gauss(0.0, noise);
    }
    const order = sorted(Object.keys(key), (t) => -key[t]);
    polls._head_to_head(order, key, winners_over, p["h2h"]);    // a close call goes to the team that won the game
    new_.push(order.slice(0, 25));
  }
  const [points, first] = polls.tally(new_);
  return [new_, points, first];
}

export function tally(ballots) {
  // (points, first-place votes) of a set of ballots.
  const points = {};
  const first = {};
  for (const b of ballots) {
    if (b.length) first[b[0]] = get(first, b[0], 0) + 1;
    b.slice(0, 25).forEach((t, i) => {
      points[t] = get(points, t, 0) + 25 - i;
    });
  }
  return [points, first];
}

Object.assign(polls, {
  _saved_params, load_params, load_next_params, load_ballot_params,
  preseason_scores, update_scores, rank,
  _new_entry_value, _win_gain, _winners_over, _head_to_head, _share_table, next_poll,
  ballots, coaches_order, coaches_opinion, committee_rank, build_bracket,
  seed_ballots, next_ballots, tally,
});

modules.polls = polls;
