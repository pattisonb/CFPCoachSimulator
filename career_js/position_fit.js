// What a player would be at another position (position_options / change_position, during the
// season and in the offseason).
//
// Why a plain `game_scale.overall(his ratings, new position)` was wrong: our ratings are kept on
// each position group's own scale (50 is the middle Power 4 starter OF HIS GROUP, game_scale.to_ours),
// so a safety whose run block is 21 on the source scale carries it as 48, the safeties' middle, and
// the guards' formula, fit on guard-relative values (50 there is a source 61), read him as an
// average blocker: a 197-pound free safety projected 67 at guard. `project` puts his ratings on the
// new group's scale first (through the source scale), then discounts the position skills he has
// never used and charges the size the new spot asks for.
import { round, int, get, isNumber, truthy, cmp } from "../engine_js/pyrt.js";
import { mean, pstdev } from "../engine_js/pystat.js";
import { read_json } from "../engine_js/files.js";
import { game_scale } from "../teamdata_js/game_scale.js";

const ENGINE_FILE = "data/engine_teams.json";

const SIZE_PENALTY = 5.0;        // *tune* overall points lost per standard deviation light or short beyond the first
const HEAVY_PENALTY = 3.0;       // *tune* per standard deviation heavy beyond the first (speed positions pay SIZE_PENALTY)
const SIZE_CAP = 30.0;           // *tune* the most size can cost
const NEAR_DISCOUNT = 0.85;      // *tune* position skills kept on a move within the unit (S -> CB, WR -> TE, DT -> EDGE)
const FAR_DISCOUNT = 0.6;        // *tune* position skills kept on a move across units (S -> OL), above the position's floor
const FLOOR = 20;                // *tune* the lowest projection
const SPEED_POSITIONS = ["WR", "CB", "HB", "FS", "SS"];   // where extra weight costs as much as missing weight

// attributes every position uses the same way: they move with him untouched
const ATHLETIC = new Set(["speed", "acceleration", "agility", "strength", "jumping", "stamina", "injury", "toughness",
  "change_of_direction", "awareness"]);
// a raw athlete's position skills at a spot he has never played, on that group's scale  *tune*
const POSITION_FLOOR = { QB: 31, HB: 38, FB: 38, WR: 36, TE: 36, LT: 34, LG: 34, C: 34, RG: 34, RT: 34,
  LEDG: 36, REDG: 36, DT: 36, SAM: 38, MIKE: 38, WILL: 38, CB: 36, FS: 38, SS: 38,
  K: 30, P: 30 };
// technique groups: a move inside one keeps every skill
const SKILL_GROUP = { QB: "QB", HB: "RB", FB: "RB", WR: "WR", TE: "TE", LT: "OL", LG: "OL", C: "OL", RG: "OL",
  RT: "OL", LEDG: "EDGE", REDG: "EDGE", DT: "DT", SAM: "LB", MIKE: "LB", WILL: "LB",
  CB: "CB", FS: "S", SS: "S", K: "K", P: "P" };
const UNIT = { QB: "offense", HB: "offense", FB: "offense", WR: "offense", TE: "offense", LT: "offense", LG: "offense",
  C: "offense", RG: "offense", RT: "offense",
  LEDG: "defense", REDG: "defense", DT: "defense", SAM: "defense", MIKE: "defense", WILL: "defense", CB: "defense",
  FS: "defense", SS: "defense", K: "special", P: "special" };
const ENGINE_TO_EA = { RB: "HB", OL: "LG", DL: "DT", MLB: "MIKE", ROLB: "WILL", LOLB: "SAM", S: "FS" };   // an engine position without a role (build_teams: WILL is ROLB, SAM is LOLB)
// height (inches) and weight (pounds) by position, mean and standard deviation, when the engine file is missing
const HAND_SIZES = { QB: [[74.1, 1.8], [207.6, 14.6]], HB: [[70.5, 1.7], [203.7, 15.4]], FB: [[72.1, 1.5], [228.3, 14.0]],
  WR: [[72.5, 2.4], [190.3, 14.5]], TE: [[75.8, 1.9], [238.2, 16.9]], LT: [[77.7, 1.4], [305.6, 18.5]],
  LG: [[76.0, 1.4], [310.1, 19.6]], C: [[75.2, 1.4], [299.9, 21.9]], RG: [[76.0, 1.4], [310.4, 17.7]],
  RT: [[77.6, 1.4], [305.4, 17.8]], LEDG: [[75.7, 1.4], [254.4, 19.5]], REDG: [[75.5, 1.4], [250.0, 18.0]],
  DT: [[74.7, 1.5], [295.5, 21.5]], SAM: [[73.9, 1.5], [227.7, 16.4]], MIKE: [[73.5, 1.4], [226.9, 11.4]],
  WILL: [[73.6, 1.4], [224.9, 11.5]], CB: [[72.1, 1.6], [185.2, 10.4]], FS: [[72.2, 1.6], [194.0, 10.9]],
  SS: [[72.7, 1.6], [197.1, 11.4]], K: [[71.6, 2.2], [191.0, 16.5]], P: [[74.0, 2.0], [205.7, 17.0]] };

const has = (d, k) => Object.prototype.hasOwnProperty.call(d, k);

/** d[k], throwing a KeyError for a missing key. */
function at(d, k, name) {
  if (!has(d, k)) throw new Error(`KeyError: ${name}[${JSON.stringify(k)}]`);
  return d[k];
}

/** dict(zip(keys, values)): as many pairs as the shorter has. */
function zipped(ks, vs) {
  const out = {};
  for (let i = 0; i < ks.length && i < vs.length; i++) out[ks[i]] = vs[i];
  return out;
}

let _sizes = null;       // worked out once

export function sizes() {
  // Position -> [[height mean, sd], [weight mean, sd]] from the real rosters (data/engine_teams.json),
  // the hand table where the file is missing or a position has too few players.
  if (_sizes === null) _sizes = _sizes_now();
  return _sizes;
}
sizes.cache_clear = () => { _sizes = null; };

function _sizes_now() {
  const out = { ...position_fit.HAND_SIZES };
  let teams;
  try {
    // a host without the file (or with one that does not parse) throws
    teams = read_json(position_fit.ENGINE_FILE)["teams"];
  } catch (e) {
    return out;
  }
  if (teams === undefined) return out;       // (KeyError)
  const by_pos = {};
  for (const t of Object.values(teams)) {
    for (const p of [...get(t, "offense", []), ...get(t, "defense", [])]) {
      const role = get(p, "role"), h = get(p, "height_in"), w = get(p, "weight");
      if (role !== null && has(out, role) && isNumber(h) && isNumber(w) && h > 0 && w > 0) {
        if (!has(by_pos, role)) by_pos[role] = [];
        by_pos[role].push([h, w]);
      }
    }
  }
  for (const [pos, v] of Object.entries(by_pos)) {
    if (v.length >= 30) {
      const hs = v.map((x) => x[0]), ws = v.map((x) => x[1]);
      out[pos] = [[mean(hs), Math.max(1.0, pstdev(hs))], [mean(ws), Math.max(5.0, pstdev(ws))]];
    }
  }
  return out;
}

export function size_penalty(height_in, weight_lbs, pos) {
  // What his build costs at `pos`: SIZE_PENALTY per standard deviation light or short beyond the
  // first, HEAVY_PENALTY per sd heavy beyond the first (as much as light at the speed positions),
  // SIZE_CAP at most. An unknown height or weight costs nothing.
  const all = position_fit.sizes();
  const [[hm, hsd], [wm, wsd]] = has(all, pos) ? all[pos] : position_fit.HAND_SIZES["WR"];
  let cost = 0.0;
  if (isNumber(height_in) && height_in > 0) {
    const z = (hm - height_in) / hsd;
    if (z > 1) cost += position_fit.SIZE_PENALTY * (z - 1);
  }
  if (isNumber(weight_lbs) && weight_lbs > 0) {
    const z = (wm - weight_lbs) / wsd;
    if (z > 1) cost += position_fit.SIZE_PENALTY * (z - 1);
    else if (z < -1) cost += (position_fit.SPEED_POSITIONS.includes(pos) ? position_fit.SIZE_PENALTY : position_fit.HEAVY_PENALTY) * (-z - 1);
  }
  return Math.min(position_fit.SIZE_CAP, cost);
}

export function transfer(attrs, from_pos, to_pos) {
  // His ratings as a player at `to_pos`: every rating put on the new group's scale (the same
  // source value, read against the new group's middle starter), the position skills kept whole
  // inside his technique group, within his unit the position's floor plus NEAR_DISCOUNT of what he
  // has above it, and across units replaced by max(the position's floor, FAR_DISCOUNT x his value).
  from_pos = get(position_fit.ENGINE_TO_EA, from_pos, from_pos);
  to_pos = get(position_fit.ENGINE_TO_EA, to_pos, to_pos);
  const out = {};
  if (from_pos === to_pos) {
    for (const [k, v] of Object.entries(attrs)) out[k] = int(v);
    return out;
  }
  const gf = game_scale.group(from_pos), gt = game_scale.group(to_pos);
  for (const [k, v] of Object.entries(attrs)) {
    let x = gf === gt ? v : game_scale.to_ours(game_scale.to_base(v, gf, k), gt, k);
    const fl = get(position_fit.POSITION_FLOOR, to_pos, 35);
    if (!position_fit.ATHLETIC.has(k)) {
      if (at(position_fit.SKILL_GROUP, from_pos, "SKILL_GROUP") !== at(position_fit.SKILL_GROUP, to_pos, "SKILL_GROUP")) {
        if (at(position_fit.UNIT, from_pos, "UNIT") === at(position_fit.UNIT, to_pos, "UNIT")) {    // a raw athlete's level there, plus most of what he knows beyond it
          x = fl + Math.max(0.0, x - fl) * position_fit.NEAR_DISCOUNT;
        } else {
          x = Math.max(fl, position_fit.FAR_DISCOUNT * x);
        }
      }
    }
    out[k] = int(round(Math.max(1, Math.min(99, x))));
  }
  return out;
}

export function project(attrs, height_in, weight_lbs, from_pos, to_pos) {
  // His overall at `to_pos`: our formula there on his transferred ratings, less what his size
  // costs, FLOOR at least. At his own position it is exactly his overall.
  from_pos = get(position_fit.ENGINE_TO_EA, from_pos, from_pos);
  to_pos = get(position_fit.ENGINE_TO_EA, to_pos, to_pos);
  if (from_pos === to_pos) return game_scale.overall(attrs, to_pos);
  const raw = game_scale.overall(position_fit.transfer(attrs, from_pos, to_pos), to_pos);
  return int(round(Math.max(position_fit.FLOOR, raw - position_fit.size_penalty(height_in, weight_lbs, to_pos))));
}

export function options(attrs, height_in, weight_lbs, origin, cur, groups) {
  // The position_options rows: every position on his side of the kicking line, projected from
  // his ratings at `origin` (where the league file has him, before this season's change; `cur` is
  // where he plays now), where he is now first, then best first.
  const special = cur === "K" || cur === "P";
  const out = [];
  for (const pos of Object.keys(groups)) {
    if ((pos === "K" || pos === "P") !== special) continue;
    out.push({ pos, group: groups[pos], overall: position_fit.project(attrs, height_in, weight_lbs, origin, pos), current: pos === cur });
  }
  out.sort((a, b) => cmp([-(a["current"] ? 1 : 0), -a["overall"]], [-(b["current"] ? 1 : 0), -b["overall"]]));
  return out;
}

export function move_row(c, pos, attrs) {
  // A league roster row moved to `pos`: his ratings become the transferred ones and his overall
  // the projection; "moved_from" keeps where he came from and "moved_attrs" his ratings there, so
  // moving him back the same season restores both. Once the offseason ends the change is his.
  const cur = c["pos"];
  if (cur === pos) return;
  if (pos === get(c, "moved_from") && truthy(get(c, "moved_attrs"))) {
    c["r"] = Array.from(c["moved_attrs"]);
    delete c["moved_attrs"];
    delete c["moved_from"];
    c["pos"] = pos;
    c["o"] = game_scale.overall(zipped(attrs, c["r"]), pos);
    return;
  }
  if (!truthy(get(c, "moved_from"))) {
    c["moved_from"] = cur;
    c["moved_attrs"] = Array.from(c["r"]);
  }
  // a second move the same season starts again from where he began, not from the first move's ratings
  const origin = c["moved_from"];
  const ours = zipped(attrs, truthy(at(c, "moved_attrs", "c")) ? c["moved_attrs"] : c["r"]);
  const fresh = position_fit.transfer(ours, origin, pos);
  c["r"] = attrs.map((k) => get(fresh, k, 50));
  c["pos"] = pos;
  c["o"] = position_fit.project(ours, get(c, "ht"), get(c, "wt"), origin, pos);
}

export function season_move(p, origin, pos) {
  // An engine player (data/engine_teams.json form) moved to `pos` during the season: his
  // overall there and his skills as they transfer (what the card and comps read). Returns [overall, skills].
  const attrs = zipped(game_scale.keys(), get(p, "skills") || []);
  const fresh = position_fit.transfer(attrs, origin, pos);
  return [position_fit.project(attrs, get(p, "height_in"), get(p, "weight"), origin, pos), game_scale.keys().map((k) => get(fresh, k, 50))];
}

export function settle(roster) {
  // At a season's end the changes are his: the snapshots go.
  for (const c of roster) delete c["moved_attrs"];
}

export const position_fit = {
  ENGINE_FILE, SIZE_PENALTY, HEAVY_PENALTY, SIZE_CAP, NEAR_DISCOUNT, FAR_DISCOUNT, FLOOR, SPEED_POSITIONS,
  ATHLETIC, POSITION_FLOOR, SKILL_GROUP, UNIT, ENGINE_TO_EA, HAND_SIZES,
  sizes, size_penalty, transfer, project, options, move_row, season_move, settle,
};
