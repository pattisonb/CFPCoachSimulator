// Fictional recruiting classes and player development (docs/PLAYER_DEVELOPMENT.md).
//
// Every recruit is generated from data/recruiting_model.json, a model
// learned from real classes and from the real 2026 roster players matched to their recruiting
// record. No real recruit is kept or reproduced: names are recombined first and last names,
// hometowns are real towns, and ratings are real players' shapes blended and perturbed.
//
// A recruit, in order (athleticism first):
//     star band and composite rating -> recruiting position -> EA position -> hometown and size
//     -> attributes: the position's expected attributes at his composite rating plus the blended
//        deviations of real young players there (athleticism comes with them: it rises with
//        stars and barely changes in college)
//     -> potential per attribute: his room to grow is the attribute's real career gain at his
//        position, scaled by a player-level potential and per-attribute spread
//     -> coachability: how fast he closes the gap each offseason, independent of stars
// Ratings are on EA's scale (ratings_ea, overall_ea) like the source rosters, plus the source
// curve's scale (`ratings`, `overall`) that build_teams.js reads.
import { Random, round, int, sum, get, truthy, floordiv, mod, fmt, cmp } from "../engine_js/pyrt.js";
import { read_json, read_text, forget } from "../engine_js/files.js";
import { modules } from "../engine_js/modules.js";

const ROOT = ".";                              // the project's root: files.js reads paths from it
const MODEL_FILE = "data/recruiting_model.json";

const STAR_BANDS = ["5", "4", "3", "2"];
const QUANTILE_AT = [0, .1, .25, .5, .75, .9, 1];
// (label, share of the gap to potential closed per offseason, share of players)
const COACHABILITY = [
  ["Coach's Dream", 0.55, 0.02],
  ["Film Junkie", 0.45, 0.08],
  ["Quick Study", 0.35, 0.20],
  ["Steady Grinder", 0.27, 0.40],
  ["Slow to Click", 0.18, 0.20],
  ["Set in His Ways", 0.10, 0.10],
];
const RATE = Object.fromEntries(COACHABILITY.map(([name, rate, _]) => [name, rate]));
const CAREER_YEARS = 4;                       // career_gain is a fifth-year player against a true freshman
const SURVIVOR_TRIM = 0.85;                   // the real gains compare survivors: players who stalled often left

// Python's sum() of floats (3.12 and later, which the game's numbers were made with): not a plain
// left-to-right sum but Neumaier's compensated one, the lost low bits carried and added at the end. The first float
// is added to the starting 0 plainly and the compensation runs from the second on. For a list of floats only (every
// sum of floats in this file is one): whole numbers are summed with pyrt.js's plain `sum`, as Python sums them.
export function pysum(xs) {
  if (!xs.length) return 0;
  let f_result = 0 + xs[0], c = 0.0;
  for (let i = 1; i < xs.length; i++) {
    const x = xs[i];
    const t = f_result + x;
    if (Math.abs(f_result) >= Math.abs(x)) c += (f_result - t) + x;
    else c += (x - t) + f_result;
    f_result = t;
  }
  if (c && Number.isFinite(c)) f_result += c;
  return f_result;
}

// Python's x ** n for a float and a small whole number n >= 0. Python asks the C library's pow, whose answer is the
// double nearest the true power nearly always (about 1 time in 2,000 it is the next one); JavaScript's Math.pow is
// a step off far more often (1 in 18, and at 0.45 ** 4 and 0.9 ** 4, which this file needs). So the power is worked
// out exactly in whole numbers (a double is a whole number times a power of two) and rounded once: the same as
// Python's for every power this file takes.
const _bits = new DataView(new ArrayBuffer(8));
export function pypow(x, n) {
  if (n === 0) return 1.0;
  if (n === 1 || x === 0 || !Number.isFinite(x)) return n === 1 ? x : Math.pow(x, n);
  _bits.setFloat64(0, Math.abs(x));
  const raw = _bits.getBigUint64(0);
  const biased = Number(raw >> 52n);
  let mant = raw & 0xfffffffffffffn, exp;
  if (biased === 0) exp = -1074; else { mant |= 1n << 52n; exp = biased - 1075; }
  const whole = Number(mant ** BigInt(n));                 // a BigInt becomes the nearest double, a half to even
  const out = whole * Math.pow(2, exp * n);                // times a power of two: exact (these powers stay in range)
  return x < 0 && n % 2 === 1 ? -out : out;
}

// the share of his room an average player realizes in four offseasons, over the coachability mix
const REALIZED = pysum(COACHABILITY.map(([_, rate, share]) => share * (1 - pypow(1 - rate, CAREER_YEARS))));
const POTENTIAL_SD = 0.45;                    // spread of the player-level potential multiplier (log scale) *tune*
const ATTRIBUTE_SPREAD = [0.6, 1.4];          // per-attribute spread of room around the player's level *tune*
const DONORS = 3;                             // real young players blended into a recruit's shape
const SAME_BAND_WEIGHT = 3.0;                 // a donor from the recruit's own star band is this much likelier
const NOISE = 1.5;                            // EA points of independent noise per attribute
const HEIGHT_WEIGHT_R = 0.5;                  // height and weight move together
const SIZE_SD_LIMIT = 2.0;                    // sizes stay within this many standard deviations of the position's
const MIN_WEIGHT = { K: 150, P: 150 };        // the high school listings' spread runs light at skill positions
const MIN_WEIGHT_OTHER = 160;
// The young players recruits are shaped from include few two-stars, so a two-star's expected
// attributes are not extrapolated at full slope below the three-star floor (the two-stars who
// reach FBS rosters are close to low three-stars).
const EXPECT_FLOOR = 0.80, BELOW_FLOOR_SLOPE = 0.15;
// Room to grow by stars, tuned so a class's overall by offseason follows the real roster players',
// a little under them for three- and two-stars, whose real numbers are
// the survivors: the ones who stalled left. *tune*
const STAR_ROOM = { 5: 1.0, 4: 0.75, 3: 1.6, 2: 1.8 };
const SKIP_POSITIONS = new Set(["LS"]);       // long snappers are not generated (the engine has none)

export function model() {
  return read_json(recruits.MODEL_FILE);      // parsed once (files.js keeps it)
}

export function curve(ea) {
  // EA's scale -> the source scale (cfb_sim_data/league.json's piecewise-linear curve).
  const pts = recruits.model()["players"]["curve"];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (ea <= x1) return y0 + (ea - x0) * (y1 - y0) / (x1 - x0);
  }
  return pts[pts.length - 1][1];
}

const _CUMULATIVE = new WeakMap();   // a model list -> [its keys, cumulative weights]: built once, not on every draw

// `pairs`: an array of [key, weight] (a model list, or a dict's Object.entries, or pairs built for the draw).
export function weighted(rng, pairs) {
  // One key drawn by weight (the same draw as rng.choices with these weights).
  let cached = recruits._CUMULATIVE.get(pairs);
  if (cached === undefined) {
    const keys = [], cum = [];
    let acc = 0;
    for (let i = 0; i < pairs.length; i++) {              // itertools.accumulate: the first weight, then left to right
      keys.push(pairs[i][0]);
      acc = i === 0 ? pairs[i][1] : acc + pairs[i][1];
      cum.push(acc);
    }
    cached = [keys, cum];
    recruits._CUMULATIVE.set(pairs, cached);
  }
  return rng.choices(cached[0], { cumWeights: cached[1] })[0];
}

export function from_quantiles(qs, u) {
  const at = recruits.QUANTILE_AT;
  let b = 0;                                              // bisect(QUANTILE_AT, u): the first place past every value <= u
  while (b < at.length && !(u < at[b])) b++;
  const i = Math.min(at.length - 2, b - 1);
  const lo = at[i], hi = at[i + 1];
  return qs[i] + (u - lo) / (hi - lo) * (qs[i + 1] - qs[i]);
}

export function overall_ea(position, archetype, ratings) {
  const fits = recruits.model()["players"]["overall_fit"];
  const f = get(fits, `${position}|${archetype}`) || fits[position];
  const terms = [];
  for (const [k, w] of Object.entries(f["weights"])) terms.push(w * get(ratings, k, 0));
  return f["const"] + pysum(terms);
}

export function rescore(p) {
  // Recompute the overall and the source-scale ratings after the EA ratings change.
  p["overall_ea"] = int(round(Math.max(1, Math.min(99, recruits.overall_ea(p["ea_position"], p["archetype"], p["ratings_ea"])))));
  p["overall"] = int(round(recruits.curve(p["overall_ea"])));
  const ratings = {};
  for (const [k, v] of Object.entries(p["ratings_ea"])) ratings[k] = int(round(recruits.curve(v)));
  p["ratings"] = ratings;
}

// `taken`: a Set of lower-case names, added to.
export function _name(rng, taken) {
  const names = recruits.model()["players"]["names"];
  let n;
  for (let _ = 0; _ < 50; _++) {
    const first = recruits.weighted(rng, names["first"]);
    const last = recruits.weighted(rng, names["last"]);
    n = `${first} ${last}`;
    const sfx = recruits.weighted(rng, Object.entries(names["suffix"]));
    n = sfx === "none" ? n : `${n} ${sfx}`;
    if (!taken.has(n.toLowerCase())) {
      taken.add(n.toLowerCase());
      return n;
    }
  }
  return n;
}

// -> [ratings, archetype]
export function _attributes(rng, pos, band, composite) {
  // The position's expected attributes at this composite rating, plus the blended deviations
  // of real young players there; the archetype comes from the main donor.
  const shape = recruits.model()["players"]["shapes"][pos];
  const donors = shape["donors"];
  const weights = donors.map((d) => (String(d[0]) === band ? recruits.SAME_BAND_WEIGHT : 1.0));
  const picks = rng.choices(donors, { weights, k: recruits.DONORS });
  const w = [];
  for (const _ of picks) w.push(rng.uniform(0.2, 1.0));
  w[0] += 1.0;                                             // the main donor sets the archetype
  const norm = Math.sqrt(pysum(w.map((x) => x * x)));      // keeps the blend's spread at a real player's
  const eff = composite >= recruits.EXPECT_FLOOR ? composite
    : recruits.EXPECT_FLOOR - recruits.BELOW_FLOOR_SLOPE * (recruits.EXPECT_FLOOR - composite);
  const out = { ...shape["fixed"] };
  const keys = shape["keys"];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const [per_point, _, konst] = shape["expected"][k];
    const dev = pysum(w.map((x, j) => x * picks[j][2 + i])) / norm;
    out[k] = int(round(Math.max(0, Math.min(99, per_point * eff + konst + dev + rng.gauss(0, recruits.NOISE)))));
  }
  return [out, picks[0][1]];
}

export function _potential(rng, pos, stars, ratings) {
  // Room to grow per attribute: the attribute's real career gain at his position, scaled by
  // one player-level potential and per-attribute spread. Physical gifts get little room.
  const gain = get(recruits.model()["players"]["career_gain"], pos, {});
  const level = Math.exp(rng.gauss(-pypow(recruits.POTENTIAL_SD, 2) / 2, recruits.POTENTIAL_SD)) * recruits.STAR_ROOM[stars];     // mean 1 before stars
  const out = {};
  for (const [k, v] of Object.entries(ratings)) {
    const room = Math.max(0.0, get(gain, k, 0.0)) * recruits.SURVIVOR_TRIM / recruits.REALIZED * level
      * rng.uniform(recruits.ATTRIBUTE_SPREAD[0], recruits.ATTRIBUTE_SPREAD[1]);
    out[k] = int(round(Math.min(99, v + room)));
  }
  return out;
}

export function recruit(rng, year, band, taken, scored = true) {
  // One prospect. `scored` False leaves out the overall and the source-scale ratings (rescore): a career converts
  // the draw to its own scale at once and never reads them.
  const gen = recruits.model()["generation"];
  const pl = recruits.model()["players"];
  const composite = round(recruits.from_quantiles(gen["rating_quantiles"][band], rng.random()), 4);
  let rpos;
  while (true) {
    rpos = recruits.weighted(rng, Object.entries(gen["position_share"][band]));
    if (!recruits.SKIP_POSITIONS.has(rpos) && pl["position_map"][rpos] !== undefined) break;
  }
  let pos = recruits.weighted(rng, Object.entries(pl["position_map"][rpos]));
  if (pl["shapes"][pos] === undefined) {                   // a thin EA position: its recruiting position's main one
    pos = Object.keys(pl["position_map"][rpos]).find((p) => pl["shapes"][p] !== undefined);
    if (pos === undefined) throw new Error("StopIteration");
  }
  const state = recruits.weighted(rng, Object.entries(gen["state_share"]).map(([s, v]) => [s, get(v, band, 0)]));
  const here = get(gen["towns"], state);
  const towns = truthy(here) ? here : [["", 1, null, null]];
  const town = rng.choices(towns, { weights: towns.map((t) => t[1]) })[0];
  const body = get(gen["body"], rpos) || get(gen["body"], "ATH");
  const lim = recruits.SIZE_SD_LIMIT;
  const zh = Math.max(-lim, Math.min(lim, rng.gauss(0, 1)));
  const zw = Math.max(-lim, Math.min(lim, recruits.HEIGHT_WEIGHT_R * zh + Math.sqrt(1 - pypow(recruits.HEIGHT_WEIGHT_R, 2)) * rng.gauss(0, 1)));
  const height = round(body["height_in"][0] + body["height_in"][1] * zh);
  const weight = Math.max(get(recruits.MIN_WEIGHT, rpos, recruits.MIN_WEIGHT_OTHER), round(body["weight_lb"][0] + body["weight_lb"][1] * zw));
  const [ratings_ea, archetype] = recruits._attributes(rng, pos, band, composite);
  const name = recruits._name(rng, taken);                 // the draws below follow the dict's order: do not reorder them
  const coachability = recruits.weighted(rng, recruits.COACHABILITY.map(([n, _, s]) => [n, s]));
  const p = {
    "name": name,
    "class_of": year,
    "stars": int(Number(band)),
    "composite": composite,
    "position": rpos,
    "ea_position": pos,
    "archetype": archetype,
    "height": height,
    "weight": weight,
    "hometown": { "city": town[0], "state": state, "lat": town[2], "lon": town[3] },
    "coachability": coachability,
    "ratings_ea": ratings_ea,
    "potential_ea": recruits._potential(rng, pos, int(Number(band)), ratings_ea),
  };
  if (scored) recruits.rescore(p);
  return p;
}

export function generate_class(year, seed = 0, taken = null, scored = true) {
  // A national class: every prospect from five stars to two, ranked by composite rating.
  // `taken`: names already in use (real rosters, earlier classes), lower case; never reused.
  const rng = new Random(`class-${year}-${seed}`);
  taken = taken !== null && taken !== undefined ? taken : new Set();
  const counts = recruits.model()["generation"]["prospects_per_class"];
  const out = [];
  for (const band of recruits.STAR_BANDS) {
    for (let _ = 0; _ < counts[band]; _++) out.push(recruits.recruit(rng, year, band, taken, scored));
  }
  out.sort((a, b) => cmp(-a["composite"], -b["composite"]));
  out.forEach((p, j) => {
    const i = j + 1;
    p["rank"] = i;
    p["id"] = `r${year}-${String(i).padStart(4, "0")}`;
  });
  return out;
}

export function develop(p, rng, coach_factor = 1.0) {
  // One offseason: every attribute closes part of its gap to potential, at the player's
  // coachability rate times his coaches' factor (docs/PLAYER_DEVELOPMENT.md, section 2).
  const rate = recruits.RATE[p["coachability"]] * coach_factor;
  for (const [k, v] of Object.entries(p["ratings_ea"])) {
    const gap = get(p["potential_ea"], k, v) - v;
    if (gap > 0) p["ratings_ea"][k] = int(round(Math.min(99, v + gap * rate * rng.uniform(0.8, 1.2))));
  }
  recruits.rescore(p);
}

export function as_roster_player(p, team, slug, jersey = null) {
  // A signed recruit in the source roster format (cfb_sim_data/teams/*.json), so he joins a
  // roster and build_teams.map_player reads him like a real player. Potential and
  // coachability ride along. The EA development trait is a placeholder ("Normal"): only the real
  // players' trait means anything (it seeds their potential once, TRAIT_ROOM), and the game shows
  // coachability instead (season.development_reads).
  return {
    "slug": slug, "name": p["name"], "position": p["ea_position"], "class": "FR", "class_year": "Freshman",
    "height": `${floordiv(p["height"], 12)}'${mod(p["height"], 12)}"`, "weight_lbs": p["weight"], "jersey": jersey,
    "dev_trait": "Normal", "archetype": p["archetype"], "overall": p["overall"], "overall_ea": p["overall_ea"],
    "ratings": { ...p["ratings"] }, "ratings_ea": { ...p["ratings_ea"] }, "potential_ea": { ...p["potential_ea"] },
    "coachability": p["coachability"], "stars": p["stars"], "composite": p["composite"], "hometown": { ...p["hometown"] },
    "team": get(team, "short_name") || get(team, "name"), "team_slug": get(team, "slug"),
  };
}


// ----- the real 2026 players: potential and coachability (docs/PLAYER_DEVELOPMENT.md, section 5) -----

const POTENTIAL_FILE = "data/player_potential.json";
const YEARS_IN = { "Freshman": 0, "Freshman (RS)": 1, "Sophomore": 1, "Sophomore (RS)": 2, "Junior": 2,
  "Junior (RS)": 3, "Senior": 3, "Senior (RS)": 4 };
const TRAIT_ORDER = { "Elite": 3, "Star": 2, "Impact": 1, "Normal": 0 };
const TRAIT_ROOM = { "Elite": 1.35, "Star": 1.2, "Impact": 1.05, "Normal": 0.9 };   // *tune*
const UNKNOWN_STAR_ROOM = 1.4;            // no recruiting record (walk-ons, older and fictional players): about a three-star's
const AHEAD_ROOM = 0.02;                  // each point of overall above the norm for his stars and years: 2% more room *tune*
const LEVEL_RANGE = [0.2, 3.0];

// -> [by_stars, by_years]
export function _norms() {
  // The real overall (source scale) by stars and years in college, and by years alone.
  const t = recruits.model()["players"]["targets"]["overall_by_stars_and_years"];
  const by_stars = {};
  for (const [s, ys] of Object.entries(t)) {
    by_stars[s] = {};
    for (const [y, v] of Object.entries(ys)) by_stars[s][y] = v[0];
  }
  const by_years = {};
  for (let y = 0; y < 5; y++) {
    const cells = [];
    for (const ys of Object.values(t)) if (ys[String(y)] !== undefined) cells.push(ys[String(y)]);
    by_years[y] = pysum(cells.map(([m, n]) => m * n)) / sum(cells.map(([_, n]) => n));
  }
  return [by_stars, by_years];
}

export function seed_real_players(players) {
  // slug -> {"coachability", "potential_ea", "stars"} for source roster players (cfb_sim_data).
  // Coachability: the league is ranked by EA development trait, then within a trait by how far
  // ahead of the norm for his stars and years a player already is, and cut into the six levels'
  // shares. Potential: each attribute's room is its real career gain at his position times the
  // share of his career still to come, divided by what an average player realizes in that time,
  // times a player level from his stars, trait and how far ahead he is. Same players, same answer.
  const stars_of = recruits.model()["players"]["real_stars"];
  const gains = recruits.model()["players"]["career_gain"];
  const [by_stars, by_years] = recruits._norms();
  const rows = [];
  for (const p of players) {
    if (!truthy(get(p, "ratings_ea")) || !Object.hasOwn(recruits.YEARS_IN, get(p, "class_year"))) continue;
    const y = recruits.YEARS_IN[p["class_year"]];
    const s = get(stars_of, p["slug"]);
    const norm = s ? get(get(by_stars, s, {}), y, by_years[y]) : by_years[y];
    rows.push([p, y, s, (get(p, "overall") || 0) - norm]);
  }
  // coachability: best trait first, then furthest ahead, cut into the levels' shares
  rows.sort((a, b) => cmp([-get(recruits.TRAIT_ORDER, get(a[0], "dev_trait"), 0), -a[3]],
    [-get(recruits.TRAIT_ORDER, get(b[0], "dev_trait"), 0), -b[3]]));
  const cuts = [];
  let acc = 0.0;
  for (const [name, _, share] of recruits.COACHABILITY) {
    acc += share;
    cuts.push([round(acc * rows.length), name]);
  }
  const last = recruits.COACHABILITY[recruits.COACHABILITY.length - 1];
  const out = {};
  for (let i = 0; i < rows.length; i++) {
    const [p, y, s, ahead] = rows[i];
    const level_name = i < cuts[cuts.length - 1][0] ? cuts.find(([cut, _]) => i < cut)[1] : last[0];
    const rng = new Random(`real-${p["slug"]}`);
    const left = Math.max(0, recruits.CAREER_YEARS - y);
    let realized = left ? pysum(recruits.COACHABILITY.map(([_, rate, share]) => share * (1 - pypow(1 - rate, left)))) : 1.0;
    // ... and a quick learner realizes his room faster than the mix: his room is what he realizes at
    // his own pace, so a Coach's Dream junior does not gain twice his position's real career gain
    realized = left ? Math.max(realized, 1 - pypow(1 - recruits.RATE[level_name], left)) : 1.0;
    let level = Math.exp(rng.gauss(-pypow(recruits.POTENTIAL_SD, 2) / 2, recruits.POTENTIAL_SD));
    level *= get(recruits.STAR_ROOM, s, recruits.UNKNOWN_STAR_ROOM) * get(recruits.TRAIT_ROOM, get(p, "dev_trait"), 1.0)
      * Math.exp(recruits.AHEAD_ROOM * ahead);
    level = Math.max(recruits.LEVEL_RANGE[0], Math.min(recruits.LEVEL_RANGE[1], level));
    const gain = get(gains, p["position"], {});
    const pot = {};
    for (const [k, v] of Object.entries(p["ratings_ea"])) {
      const room = Math.max(0.0, get(gain, k, 0.0)) * recruits.SURVIVOR_TRIM * (left / recruits.CAREER_YEARS) / realized * level
        * rng.uniform(recruits.ATTRIBUTE_SPREAD[0], recruits.ATTRIBUTE_SPREAD[1]);
      const top = int(round(Math.min(99, v + room)));
      if (top > v) pot[k] = top;               // attributes with no room are left out: potential = current
    }
    out[p["slug"]] = { "coachability": level_name, "potential_ea": pot, ...(s ? { "stars": s } : {}) };
  }
  return out;
}

// files.js only reads one file by its path, so whoever calls this says how a folder is listed and a file written:
// `list_files(dir)` -> the names of the files in a folder of the project, `write_text(path, text)` writes one.
export function write_player_potential(list_files, write_text) {
  // Seed every source roster player and write data/player_potential.json (build_teams.js runs this).
  let players = [];
  const names = list_files("cfb_sim_data/teams").filter((n) => n.endsWith(".json")).sort((a, b) => cmp(a, b));
  for (const name of names) {
    players = players.concat(JSON.parse(read_text(`cfb_sim_data/teams/${name}`))["roster"]);
  }
  const seeded = recruits.seed_real_players(players);
  write_text(recruits.POTENTIAL_FILE, JSON.stringify(seeded));
  forget(recruits.POTENTIAL_FILE);
  return Object.keys(seeded).length;
}

// `argv`: what follows the script's name ([year, seed]).
export function main(argv = []) {
  const year = argv.length > 0 ? int(Number(argv[0])) : 2027;
  const seed = argv.length > 1 ? int(Number(argv[1])) : 0;
  const cls = recruits.generate_class(year, seed);
  console.log(`class of ${year} (seed ${seed}): ${cls.length} prospects`);
  for (const p of cls.slice(0, 25)) {
    const h = p["hometown"];
    console.log(`${String(p["rank"]).padStart(4)} ${"*".repeat(p["stars"]).padEnd(5)} ${fmt(p["composite"], 4)} ${p["name"].padEnd(24)} ${p["position"].padEnd(4)} `
      + `${p["ea_position"].padEnd(4)} ${p["archetype"].padEnd(20)} ${floordiv(p["height"], 12)}'${mod(p["height"], 12)}" ${String(p["weight"]).padStart(3)}  `
      + `${h["city"]}, ${h["state"].padEnd(3)} ovr ${String(p["overall"]).padStart(2)}  ${p["coachability"]}`);
  }
}

export const recruits = {
  ROOT, MODEL_FILE, STAR_BANDS, QUANTILE_AT, COACHABILITY, RATE, CAREER_YEARS, SURVIVOR_TRIM, REALIZED, POTENTIAL_SD,
  ATTRIBUTE_SPREAD, DONORS, SAME_BAND_WEIGHT, NOISE, HEIGHT_WEIGHT_R, SIZE_SD_LIMIT, MIN_WEIGHT, MIN_WEIGHT_OTHER,
  EXPECT_FLOOR, BELOW_FLOOR_SLOPE, STAR_ROOM, SKIP_POSITIONS,
  model, curve, _CUMULATIVE, weighted, from_quantiles, overall_ea, rescore, _name, _attributes, _potential, recruit,
  generate_class, develop, as_roster_player,
  POTENTIAL_FILE, YEARS_IN, TRAIT_ORDER, TRAIT_ROOM, UNKNOWN_STAR_ROOM, AHEAD_ROOM, LEVEL_RANGE,
  _norms, seed_real_players, write_player_potential, main,
};

modules.recruits = recruits;
