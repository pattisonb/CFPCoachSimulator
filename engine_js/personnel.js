/*
Personnel: who is on the field for a snap.

Offense picks a grouping (11, 12, 10, 21, 13, jumbo) from the coordinator's scheme and the
situation; defense answers with its base front (4-3, 3-4, 4-2-5, 3-3-5) or a nickel, dime
or heavy package. The lineup builder in roster.Team fills each grouping from the depth
chart, honouring the fatigue rotation (in_game flags) and injuries. All the probabilities
here are in game_config so they can be tuned with the rest of the engine.
*/

import { random, sorted, get } from "./pyrt.js";

import { cfg } from "./game_config.js";

// The module's namespace: its constants live here and are read through it.
export const personnel = {};

// Offensive groupings: RB, TE, WR, OL counts (the QB is always one).
personnel.GROUPINGS = {
    "10": {"RB": 1, "TE": 0, "WR": 4, "OL": 5},
    "11": {"RB": 1, "TE": 1, "WR": 3, "OL": 5},
    "12": {"RB": 1, "TE": 2, "WR": 2, "OL": 5},
    "21": {"RB": 2, "TE": 1, "WR": 2, "OL": 5},
    "13": {"RB": 1, "TE": 3, "WR": 1, "OL": 5},
    "22": {"RB": 2, "TE": 2, "WR": 1, "OL": 5},
    "jumbo": {"RB": 1, "TE": 2, "WR": 1, "OL": 6},
    "option": {"RB": 3, "TE": 1, "WR": 1, "OL": 5},   // flexbone: fullback and two slotbacks
};

// How often each scheme lines up in each grouping on a normal down (weights).
// JavaScript lists an object's number-like keys ("10", "11", "12") in numeric order, not in the order written, and
// the order of the weights decides which grouping a draw picks: each mix is written as Python's ordered pairs, and
// MIX_NAMES keeps each mix's names in that order.
const _SCHEME_MIX_PAIRS = {
    "Air Raid": [["10", 0.45], ["11", 0.50], ["12", 0.05]],
    "Spread RPO": [["11", 0.68], ["10", 0.22], ["12", 0.10]],
    "Spread Option": [["11", 0.55], ["10", 0.15], ["12", 0.20], ["21", 0.10]],
    "Power Spread": [["11", 0.55], ["12", 0.30], ["10", 0.05], ["21", 0.10]],
    "West Coast": [["11", 0.55], ["12", 0.25], ["21", 0.15], ["13", 0.05]],
    "Pro Style": [["11", 0.40], ["12", 0.35], ["21", 0.15], ["13", 0.10]],
    "Multiple": [["11", 0.50], ["12", 0.25], ["10", 0.10], ["21", 0.10], ["13", 0.05]],
    "Flexbone Triple Option": [["option", 0.80], ["21", 0.10], ["12", 0.10]],
};
personnel.SCHEME_MIX = {};
personnel.MIX_NAMES = new Map();      // a mix (the object in SCHEME_MIX) -> its names in Python's order
for (const [scheme, pairs] of Object.entries(_SCHEME_MIX_PAIRS)) {
    const mix = Object.fromEntries(pairs);
    personnel.SCHEME_MIX[scheme] = mix;
    personnel.MIX_NAMES.set(mix, pairs.map((pair) => pair[0]));
}
personnel.DEFAULT_MIX = personnel.SCHEME_MIX["Multiple"];

// Defensive fronts: EDGE, DT, LB, CB, S counts (11 players).
personnel.FRONTS = {
    "4-3": {"EDGE": 2, "DT": 2, "LB": 3, "CB": 2, "S": 2},
    "3-4": {"EDGE": 2, "DT": 1, "LB": 4, "CB": 2, "S": 2},
    "4-2-5": {"EDGE": 2, "DT": 2, "LB": 2, "CB": 3, "S": 2},
    "3-3-5": {"EDGE": 2, "DT": 1, "LB": 3, "CB": 2, "S": 3},   // three safeties (Wake Forest, Troy, Tulsa, UAB)
};
personnel.SCHEME_FRONT = {"4-3": "4-3", "3-4": "3-4", "Tite Front 3-4": "3-4", "4-2-5": "4-2-5", "Multiple 4-2-5": "4-2-5", "3-3-5": "3-3-5"};


/**
 * The grouping for this snap. Normal downs follow the scheme's mix; passing downs go
 * light, short yardage and the goal line go heavy, a leader milking the clock goes heavy.
 */
export function offense_grouping(scheme, down, distance, yardline, conservative, hurrying) {
    const goal_line = yardline >= 95;
    const short = distance <= 2 && down >= 3;
    const passing_down = (down >= 3 && distance >= 7) || hurrying;
    const flexbone = scheme === "Flexbone Triple Option";
    if (goal_line || short) {
        if (flexbone) {
            return "option";
        }
        const r = random.random();
        if (r < cfg.HEAVY_JUMBO_SHARE) {
            return "jumbo";
        }
        if (r < cfg.HEAVY_JUMBO_SHARE + cfg.HEAVY_13_SHARE) {
            return "13";
        }
        if (r < 0.8) {
            return "22";
        }
        return "12";
    }
    if (passing_down && !flexbone) {
        if (random.random() < cfg.PASSING_DOWN_10_SHARE * (scheme === "Air Raid" ? 1.6 : 1.0)) {
            return "10";
        }
        return "11";
    }
    if (conservative && !flexbone && random.random() < cfg.CONSERVATIVE_HEAVY_SHARE) {
        return random.random() < 0.6 ? "12" : "21";
    }
    const mix = get(personnel.SCHEME_MIX, scheme, personnel.DEFAULT_MIX);
    const names = personnel.MIX_NAMES.get(mix) || Object.keys(mix);
    return random.choices(names, { weights: names.map((n) => mix[n]), k: 1 })[0];
}
personnel.offense_grouping = offense_grouping;


/**
 * The defensive counts for this snap. The base front answers 12 and 21 personnel; three
 * receivers bring a fifth defensive back (always for a 4-2-5 or 3-3-5, often for a 4-3 or
 * 3-4); four receivers or third-and-long bring a sixth; extra tight ends take a back off
 * the field for a linebacker. Linebackers trade one-for-one with the backs. `rnd` stands in
 * for random.random (the depth chart's formations take the usual answer: rnd = () => 0.0).
 */
export function defense_package(scheme, grouping, down, distance, rnd = null) {
    rnd = rnd || (() => random.random());
    const base = { ...personnel.FRONTS[get(personnel.SCHEME_FRONT, scheme, "4-2-5")] };
    const receivers = personnel.GROUPINGS[grouping]["WR"];
    const passing_down = down >= 3 && distance >= 7;
    let dbs = base["CB"] + base["S"];
    let target = dbs;
    if (receivers >= 4) {
        target = 6;
    } else if (receivers === 3) {
        if (passing_down) {
            target = rnd() < cfg.DIME_ON_PASSING_DOWN ? 6 : 5;
        } else if (dbs >= 5 || rnd() < cfg.NICKEL_VS_11) {
            target = 5;
        }
    } else if (receivers <= 1) {
        target = Math.max(4, dbs - 1);
    }
    while (dbs < target && base["LB"] > 1) {
        base["LB"] -= 1;
        if (base["CB"] < 4) {
            base["CB"] += 1;
        } else {
            base["S"] += 1;
        }
        dbs += 1;
    }
    while (dbs > target && dbs > 4) {
        if (base["CB"] > 2) {
            base["CB"] -= 1;
        } else {
            base["S"] -= 1;
        }
        base["LB"] += 1;
        dbs -= 1;
    }
    return base;
}
personnel.defense_package = defense_package;


/**
 * Who rushes the passer: every lineman on the field, plus the best-rushing linebackers
 * up to four rushers (a 3-4 sends an outside linebacker).
 */
export function pass_rushers(defense) {
    const line = defense.filter((p) => p.position === "DL");
    if (line.length >= 4) {
        return line;
    }
    const backers = sorted(defense.filter((p) => p.position.includes("LB")), (p) => -(p.rushing || 0));
    return line.concat(backers.slice(0, 4 - line.length));
}
personnel.pass_rushers = pass_rushers;
