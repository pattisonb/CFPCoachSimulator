// Ability goals (the player's ask): every player always works toward one ability that fits his position, a
// plain goal per tier ("Breakaway Speed (Bronze): 3 runs of 20+ yards"). Progress lands after every game; reaching the goal
// unlocks the ability (or its next tier) mid-season, and the engine uses it from the next game on. One goal at a time (a
// seeded draw of the abilities that fit, next_goal); beside it, every ability he already holds moves toward its own next
// tier (UPGRADES_ALONGSIDE, state["ability_upgrades"][team][key] = {trait: {"tier", "have"}}).
//
// Three kinds of goal:
// - "season": a running total of one of his stats since the goal began (it carries across seasons),
// - "game": games with at least `per` of a stat (a big game),
// - "moment": big moments, counted by the game itself (sim.season._moments): a go-ahead or tying score in the fourth
//   quarter or overtime (`clutch_score`), a made kick then (`clutch_kick`), a sack, interception or forced fumble then
//   while protecting a one-score lead (`clutch_stop`), a game started at home (`home_start`) or on the road (`road_start`).
//
// State: state["ability_goals"][team][player key "Name|POS"] = {"trait", "tier", "have", "since": [year, week]};
// state["abilities_earned"][team][key] = {trait: tier} (merged into the game's team, and into the league's rosters at the
// offseason); state["ability_events"]: [{week, year, team, player, position, trait, name, tier, how}] (the news reads them).
//
// It was coach_career/ability_goals.py; engine_js/PORTING.md has the rules it was ported by.
import { Random, int, sum, get, truthy } from "../engine_js/pyrt.js";
import { modules } from "../engine_js/modules.js";
import { ratings as rv2 } from "../teamdata_js/ratings.js";

/** d.get(k, default) for one of this file's own tables asked with a key from outside (a position, a trait): only a key
 * the table itself holds, never one of Object's. */
const own = (o, k, d = null) => (typeof k === "string" && Object.hasOwn(o, k) ? o[k] : d);
/** d.setdefault(k, default) */
const setdefault = (o, k, d) => (o[k] === undefined ? (o[k] = d) : o[k]);
/** words.format(n=need, s="" if need == 1 else "s") */
const words_of = (words, need) => words.replaceAll("{n}", String(need)).replaceAll("{s}", need === 1 ? "" : "s");

const TIER_NAMES = { 1: "Bronze", 2: "Silver", 3: "Gold", 4: "Platinum" };
const UPGRADES_ALONGSIDE = true;       // *tune* an ability he already holds also moves toward its next tier while he works on his goal

// trait -> [kind, metric, needs by tier [Bronze, Silver, Gold, Platinum], per-game threshold or null, the goal in words
// with {n} its count]. Positions are the engine's groups a trait suits (season.SCALE_GROUP).
const GOALS = {
  // quarterbacks
  pinpoint: ["game", "completions", [2, 3, 4, 5], 25, "{n} game{s} with 25+ completions"],
  timing_passer: ["season", "completions", [80, 160, 240, 320], null, "{n} completions"],
  unflappable: ["season", "passing_touchdowns", [6, 12, 18, 24], null, "{n} touchdown passes"],
  accurate_on_the_run: ["season", "pass_yards", [800, 1600, 2400, 3200], null, "{n} passing yards"],
  poised_on_the_run: ["season", "pass_yards", [800, 1600, 2400, 3200], null, "{n} passing yards"],
  off_platform: ["season", "pass_yards", [800, 1600, 2400, 3200], null, "{n} passing yards"],
  steps_up: ["season", "passing_first_downs", [40, 80, 120, 160], null, "{n} passing first downs"],
  escape_artist: ["season", "passing_first_downs", [40, 80, 120, 160], null, "{n} passing first downs"],
  play_extender: ["season", "passing_first_downs", [40, 80, 120, 160], null, "{n} passing first downs"],
  ball_handler: ["season", "passing_first_downs", [40, 80, 120, 160], null, "{n} passing first downs"],
  option_maestro: ["season", "rush_yards", [100, 250, 400, 600], null, "{n} rushing yards"],
  tuck_and_run: ["season", "rush_yards", [100, 250, 400, 600], null, "{n} rushing yards"],
  coach_on_the_field: ["moment", "clutch_score", [1, 2, 4, 6], null, "{n} go-ahead or tying score{s} late"],
  // backs
  breakaway_speed: ["season", "explosive_runs", [4, 8, 12, 16], null, "{n} runs of 20+ yards"],
  quick_feet: ["season", "rush_yards", [250, 500, 800, 1100], null, "{n} rushing yards"],
  spin_artist: ["season", "rush_yards", [250, 500, 800, 1100], null, "{n} rushing yards"],
  slippery: ["season", "rush_yards", [250, 500, 800, 1100], null, "{n} rushing yards"],
  stiff_arm_specialist: ["season", "rush_yards", [250, 500, 800, 1100], null, "{n} rushing yards"],
  balance: ["season", "rush_yards", [250, 500, 800, 1100], null, "{n} rushing yards"],
  tough_runner: ["season", "rushing_first_downs", [15, 30, 45, 60], null, "{n} rushing first downs"],
  downhill_runner: ["season", "rushing_touchdowns", [3, 6, 9, 13], null, "{n} rushing touchdowns"],
  bulldozer: ["season", "rushing_touchdowns", [3, 6, 9, 13], null, "{n} rushing touchdowns"],
  extra_effort: ["season", "rushing_first_downs", [15, 30, 45, 60], null, "{n} rushing first downs"],
  ball_protector: ["season", "carries", [60, 120, 180, 240], null, "{n} carries"],
  lead_back: ["season", "key_blocks", [5, 10, 15, 20], null, "{n} key blocks"],
  // receivers
  glue_hands: ["season", "receptions", [20, 40, 60, 80], null, "{n} catches"],
  checkdown_target: ["season", "receptions", [20, 40, 60, 80], null, "{n} catches"],
  qbs_favorite: ["season", "receptions", [20, 40, 60, 80], null, "{n} catches"],
  jump_ball_winner: ["season", "receiving_touchdowns", [2, 4, 6, 9], null, "{n} touchdown catches"],
  double_move: ["season", "explosive_catches", [4, 8, 12, 16], null, "{n} catches of 20+ yards"],
  sharp_cutter: ["season", "receiving_first_downs", [10, 20, 30, 40], null, "{n} receiving first downs"],
  press_beater: ["game", "receiving_yards", [1, 2, 3, 4], 100, "{n} game{s} with 100+ receiving yards"],
  // the line
  road_grader: ["season", "key_blocks", [10, 20, 30, 45], null, "{n} key blocks"],
  edge_sealer: ["season", "key_blocks", [10, 20, 30, 45], null, "{n} key blocks"],
  second_level_blocker: ["season", "key_blocks", [10, 20, 30, 45], null, "{n} key blocks"],
  vise_grip: ["season", "key_blocks", [10, 20, 30, 45], null, "{n} key blocks"],
  option_blocker: ["season", "key_blocks", [10, 20, 30, 45], null, "{n} key blocks"],
  screen_blocker: ["season", "key_blocks", [10, 20, 30, 45], null, "{n} key blocks"],
  grinder: ["season", "snaps", [500, 800, 1100, 1400], null, "{n} snaps"],
  line_leader: ["season", "snaps", [500, 800, 1100, 1400], null, "{n} snaps"],
  pocket_protector: ["season", "clean_start", [4, 7, 10, 13], null, "{n} clean starts (no sacks, a pressure at most)"],
  quick_set: ["season", "clean_start", [4, 7, 10, 13], null, "{n} clean starts (no sacks, a pressure at most)"],
  quick_pass_set: ["season", "clean_start", [4, 7, 10, 13], null, "{n} clean starts (no sacks, a pressure at most)"],
  interior_wall: ["season", "clean_start", [4, 7, 10, 13], null, "{n} clean starts (no sacks, a pressure at most)"],
  play_action_protector: ["season", "clean_start", [4, 7, 10, 13], null, "{n} clean starts (no sacks, a pressure at most)"],
  // the front and the back seven
  pocket_collapser: ["season", "sacks", [3, 5, 8, 11], null, "{n} sacks"],
  edge_bender: ["season", "sacks", [3, 5, 8, 11], null, "{n} sacks"],
  gap_penetrator: ["season", "tackles_for_loss", [4, 7, 10, 14], null, "{n} tackles for loss"],
  pressure_player: ["season", "hurries", [5, 10, 16, 22], null, "{n} hurries"],
  finisher: ["game", "sacks", [1, 2, 3, 4], 2, "{n} game{s} with 2+ sacks"],
  jump_the_snap: ["season", "tackles_for_loss", [4, 7, 10, 14], null, "{n} tackles for loss"],
  option_killer: ["season", "tackles_for_loss", [4, 7, 10, 14], null, "{n} tackles for loss"],
  sure_tackler: ["season", "solo_tackles", [25, 45, 65, 85], null, "{n} solo tackles"],
  pack_tackler: ["season", "solo_tackles", [25, 45, 65, 85], null, "{n} solo tackles"],
  edge_setter: ["season", "solo_tackles", [25, 45, 65, 85], null, "{n} solo tackles"],
  hand_fighter: ["season", "solo_tackles", [25, 45, 65, 85], null, "{n} solo tackles"],
  block_buster: ["season", "solo_tackles", [25, 45, 65, 85], null, "{n} solo tackles"],
  heavy_hitter: ["season", "forced_fumbles", [2, 3, 4, 5], null, "{n} forced fumbles"],
  jarring_hits: ["season", "forced_fumbles", [2, 3, 4, 5], null, "{n} forced fumbles"],
  ball_jarrer: ["season", "forced_fumbles", [2, 3, 4, 5], null, "{n} forced fumbles"],
  defensive_leader: ["moment", "clutch_stop", [1, 2, 4, 6], null, "{n} big stop{s} late in a close game"],
  turnover_magnet: ["season", "interceptions", [2, 4, 6, 8], null, "{n} interceptions"],
  pick_six: ["season", "interceptions", [2, 4, 6, 8], null, "{n} interceptions"],
  route_jumper: ["season", "interceptions", [2, 4, 6, 8], null, "{n} interceptions"],
  shadow: ["season", "passes_defended", [5, 10, 15, 20], null, "{n} passes defended"],
  jam_artist: ["season", "passes_defended", [5, 10, 15, 20], null, "{n} passes defended"],
  diving_breakup: ["season", "passes_defended", [5, 10, 15, 20], null, "{n} passes defended"],
  // kickers and punters
  automatic: ["season", "fg_short_made", [5, 10, 15, 20], null, "{n} field goals under 40 yards"],
  long_range: ["season", "fg_50_made", [1, 2, 3, 5], null, "{n} field goal{s} of 50+ yards"],
  cannon_leg: ["season", "punt_yards", [1200, 2400, 3600, 4800], null, "{n} punting yards"],
  pin_artist: ["season", "punts_inside_20", [5, 10, 15, 22], null, "{n} punts inside the 20"],
  ice_water: ["moment", "clutch_kick", [1, 2, 3, 5], null, "{n} clutch kick{s} made"],
  clutch_leg: ["moment", "clutch_kick", [1, 2, 3, 5], null, "{n} clutch kick{s} made"],
  // anyone
  closer: ["moment", "clutch_score", [1, 2, 4, 6], null, "{n} go-ahead or tying score{s} late"],
  iron_horse: ["season", "snaps", [500, 800, 1100, 1400], null, "{n} snaps"],
  quick_recovery: ["season", "snaps", [500, 800, 1100, 1400], null, "{n} snaps"],
  crowd_favorite: ["moment", "home_start", [2, 4, 6, 8], null, "{n} starts at home"],
  road_warrior: ["moment", "road_start", [2, 4, 6, 8], null, "{n} starts on the road"],
  natural_talent: ["season", "games_started", [4, 8, 12, 16], null, "{n} starts"],};

// which goals suit each engine position group, most fitting first (the first he does not hold at Platinum is his goal)
const FITS = {
  QB: ["pinpoint", "timing_passer", "unflappable", "steps_up", "accurate_on_the_run", "coach_on_the_field", "escape_artist",
    "play_extender", "ball_handler", "off_platform", "poised_on_the_run", "tuck_and_run", "option_maestro", "closer", "iron_horse"],
  RB: ["breakaway_speed", "quick_feet", "spin_artist", "tough_runner", "bulldozer", "downhill_runner", "slippery", "balance",
    "stiff_arm_specialist", "extra_effort", "ball_protector", "checkdown_target", "closer", "iron_horse"],
  FB: ["lead_back", "bulldozer", "tough_runner", "extra_effort", "iron_horse"],
  WR: ["double_move", "glue_hands", "sharp_cutter", "jump_ball_winner", "press_beater", "qbs_favorite", "breakaway_speed", "closer", "iron_horse"],
  TE: ["glue_hands", "checkdown_target", "jump_ball_winner", "screen_blocker", "qbs_favorite", "closer", "iron_horse"],
  OL: ["road_grader", "pocket_protector", "edge_sealer", "quick_set", "second_level_blocker", "interior_wall", "vise_grip",
    "quick_pass_set", "play_action_protector", "grinder", "line_leader", "option_blocker", "screen_blocker", "iron_horse"],
  DL: ["pocket_collapser", "edge_bender", "gap_penetrator", "pressure_player", "finisher", "hand_fighter", "edge_setter",
    "jump_the_snap", "block_buster", "defensive_leader", "iron_horse"],
  LB: ["sure_tackler", "pack_tackler", "pressure_player", "option_killer", "heavy_hitter", "route_jumper", "block_buster",
    "defensive_leader", "edge_setter", "iron_horse"],
  CB: ["shadow", "jam_artist", "turnover_magnet", "diving_breakup", "pick_six", "route_jumper", "defensive_leader", "iron_horse"],
  S: ["route_jumper", "turnover_magnet", "sure_tackler", "heavy_hitter", "diving_breakup", "pick_six", "defensive_leader", "iron_horse"],
  K: ["automatic", "long_range", "ice_water", "clutch_leg"],
  P: ["pin_artist", "cannon_leg"],
};

// the engine's positions to their groups (the card's groups)
const POS_GROUP = { QB: "QB", RB: "RB", HB: "RB", FB: "FB", WR: "WR", TE: "TE", LT: "OL", LG: "OL", C: "OL", RG: "OL",
  RT: "OL", OL: "OL", OT: "OL", IOL: "OL", DE: "DL", DT: "DL", LEDG: "DL", REDG: "DL", DL: "DL", EDGE: "DL",
  MLB: "LB", LOLB: "LB", ROLB: "LB", LB: "LB", SAM: "LB", MIKE: "LB", WILL: "LB", CB: "CB", FS: "S",
  SS: "S", S: "S", K: "K", P: "P" };

export function _held(state, team, key, base) {
  // {trait: tier} he holds: the roster's own (base) and what he has earned since.
  const earned = get(get(get(state, "abilities_earned") || {}, team) || {}, key) || {};
  const out = { ...base };
  for (const [k, t] of Object.entries(earned)) out[k] = Math.max(get(out, k, 0), t);
  return out;
}

export function next_goal(position, held, key = "") {
  // [trait, tier] he works toward, at the tier after his own: of the goals that suit his position and that he does not
  // hold at Platinum, a seeded draw for him (`key`, and how many he holds, so each next goal is its own) that favors the
  // list's first (weights 1/(1+i)) and an ability he already holds (x2), so goals spread over every ability, the mental
  // ones too. null for a position with none.
  const fits = own(ability_goals.FITS, own(ability_goals.POS_GROUP, position, position), [])
    .filter((t) => Object.hasOwn(ability_goals.GOALS, t) && get(held, t, 0) < 4);
  if (!fits.length) return null;
  const weights = fits.map((t, i) => (truthy(get(held, t, 0)) ? 2.0 : 1.0) / (1 + i));
  const trait = new Random(`goal-${key}-${sum(Object.values(held))}`).choices(fits, { weights, k: 1 })[0];
  return [trait, get(held, trait, 0) + 1];
}

export function goal_view(state, team, key, position, base) {
  // His goal as the page shows it: {trait, name, tier, tier_name, have, need, text}; null without one.
  let g = get(get(get(state, "ability_goals") || {}, team) || {}, key);
  if (!truthy(g)) {
    const held = ability_goals._held(state, team, key, base);
    const nxt = ability_goals.next_goal(position, held, key);
    if (!nxt) return null;
    g = { trait: nxt[0], tier: nxt[1], have: 0 };
  }
  const [kind, metric, needs, per, words] = ability_goals.GOALS[g["trait"]];
  const need = needs[g["tier"] - 1];
  const name = own(rv2.TRAIT_INFO, g["trait"], [g["trait"], ""])[0];
  return { trait: g["trait"], name, tier: g["tier"], tier_name: ability_goals.TIER_NAMES[g["tier"]], have: Math.min(g["have"], need),
    need, text: words_of(words, need) };
}

export function _counts(kind, metric, per, stats, moments) {
  if (kind === "season") return int(get(stats, metric, 0) || 0);
  if (kind === "game") return (get(stats, metric, 0) || 0) >= per ? 1 : 0;
  return int(get(moments, metric, 0) || 0);
}

export function after_game(state, g, lines, moments, base_traits) {
  // Every player in the game moves toward his goal; one who reaches it earns the ability (or its next tier), logged in
  // state["ability_events"], and starts on his next goal. `lines`: the game's compact sides ({"home": {"players": [...]}});
  // `moments`: {"home": {key: {metric: n}}, ...} from the game; `base_traits`: {team: {key: {trait: tier}}} the rosters'
  // own. Returns the events this game made.
  const goals = setdefault(state, "ability_goals", {});
  const earned = setdefault(state, "abilities_earned", {});
  const events = setdefault(state, "ability_events", []);
  const year = get(state, "year") || 2026;
  const made = [];
  for (const side of ["home", "away"]) {
    const team = g[side];
    const side_moments = get(truthy(moments) ? moments : {}, side) || {};
    for (const pl of get(get(lines, side) || {}, "players") || []) {
      const key = `${pl["name"]}|${pl["position"]}`;
      const stats = { ...(get(pl, "stats") || {}) };
      const mo = { ...(get(side_moments, key) || {}) };
      if (truthy(get(stats, "games_started")) && !truthy(get(stats, "sacks_allowed")) && (get(stats, "pressures_allowed") || 0) <= 1
          && own(ability_goals.POS_GROUP, pl["position"], pl["position"]) === "OL") {
        stats["clean_start"] = 1;             // a lineman's start with no sack and a pressure at most
      }
      if (truthy(get(stats, "games_started"))) {
        mo[side === "home" && !truthy(get(g, "neutral")) ? "home_start" : side === "away" && !truthy(get(g, "neutral")) ? "road_start" : "_"] = 1;
      }
      const base = get(get(base_traits, team) || {}, key) || {};
      const mine = setdefault(goals, team, {});
      const held = ability_goals._held(state, team, key, base);     // before this game: an ability earned today starts its next tier next game
      let cur = get(mine, key);
      if (!truthy(cur)) {
        const nxt = ability_goals.next_goal(pl["position"], held, key);
        if (nxt) cur = mine[key] = { trait: nxt[0], tier: nxt[1], have: 0, since: [year, g["week"]] };
      }

      const reach = (trait, tier, need, words) => {
        const got = setdefault(setdefault(earned, team, {}), key, {});
        got[trait] = Math.max(get(got, trait, 0), tier);
        const name = own(rv2.TRAIT_INFO, trait, [trait, ""])[0];
        const ev = { week: g["week"], year, team, player: pl["name"], position: pl["position"], trait,
          name, tier, tier_name: ability_goals.TIER_NAMES[tier], how: words_of(words, need), event_id: get(g, "event_id") };
        events.push(ev);
        made.push(ev);
      };

      if (truthy(cur)) {
        const [kind, metric, needs, per, words] = ability_goals.GOALS[cur["trait"]];
        cur["have"] += ability_goals._counts(kind, metric, per, stats, mo);
        const need = needs[cur["tier"] - 1];
        if (cur["have"] >= need) {
          reach(cur["trait"], cur["tier"], need, words);
          delete mine[key];                    // the next goal starts with his next game (next_goal)
        }
      }
      if (!ability_goals.UPGRADES_ALONGSIDE) continue;
      // every ability he already holds moves toward its next tier too, beside the one goal above
      const ups = setdefault(setdefault(setdefault(state, "ability_upgrades", {}), team, {}), key, {});
      for (const [trait, tier] of Object.entries(held)) {
        if (!Object.hasOwn(ability_goals.GOALS, trait) || tier >= 4 || (truthy(cur) && trait === cur["trait"])) continue;
        const [kind, metric, needs, per, words] = ability_goals.GOALS[trait];
        let up = get(ups, trait);
        if (!truthy(up) || up["tier"] !== tier + 1) up = ups[trait] = { tier: tier + 1, have: 0 };
        up["have"] += ability_goals._counts(kind, metric, per, stats, mo);
        const need = needs[tier];
        if (up["have"] >= need) {
          reach(trait, tier + 1, need, words);
          delete ups[trait];
        }
      }
      if (!Object.keys(ups).length) delete state["ability_upgrades"][team][key];
    }
  }
  return made;
}

export function upgrades_view(state, team, key, base) {
  // {trait: {tier, tier_name, have, need, text}} for each ability he holds below Platinum: what its next tier takes and
  // how far along he is (the one he is working toward as his goal is in goal_view, not here).
  if (!ability_goals.UPGRADES_ALONGSIDE) return {};
  const goal = get(get(get(state, "ability_goals") || {}, team) || {}, key) || {};
  const ups = get(get(get(state, "ability_upgrades") || {}, team) || {}, key) || {};
  const out = {};
  for (const [trait, tier] of Object.entries(ability_goals._held(state, team, key, base))) {
    if (!Object.hasOwn(ability_goals.GOALS, trait) || tier >= 4 || trait === get(goal, "trait")) continue;
    const [kind, metric, needs, per, words] = ability_goals.GOALS[trait];
    const need = needs[tier];
    const up = get(ups, trait) || {};
    const have = get(up, "tier") === tier + 1 ? get(up, "have", 0) : 0;
    out[trait] = { tier: tier + 1, tier_name: ability_goals.TIER_NAMES[tier + 1], have: Math.min(have, need), need,
      text: words_of(words, need) };
  }
  return out;
}

export function news(state) {
  // Program News items for your players' abilities earned: {week, kind "ability", slug, name, position,
  // trait, ability, tier_name, line}, his player page on the name.
  if (!truthy(get(state, "career"))) return [];
  const season = modules.season;
  const me = get(state, "team");
  const year = get(state, "year") || 2026;
  const roster = new Map();
  for (const x of [...get(get(season.load_teams(), me) || {}, "offense", []), ...get(get(season.load_teams(), me) || {}, "defense", [])]) {
    roster.set(`${x["name"]}|${x["position"]}`, get(x, "slug"));
  }
  const out = [];
  for (const e of get(state, "ability_events") || []) {
    if (e["team"] !== me || get(e, "year", year) !== year) continue;
    const verb = e["tier"] === 1 ? "earned" : "moved up to";
    out.push({ week: e["week"], kind: "ability", slug: roster.get(`${e["player"]}|${e["position"]}`) ?? null, name: e["player"],
      position: e["position"], trait: e["trait"], ability: e["name"], tier_name: e["tier_name"],
      line: `${verb[0].toUpperCase()}${verb.slice(1)} ${e["name"]} (${e["tier_name"]}): ${e["how"]}.` });
  }
  return out;
}

export function merged_traits(state, team, key, base) {
  // His traits for the page: the roster's own (`base`, [{key, tier}]) with what he earned this career over them,
  // each earned one marked "earned".
  const earned = get(get(get(state, "abilities_earned") || {}, team) || {}, key) || {};
  const out = {};
  for (const t of base) if (t !== null && typeof t === "object" && !Array.isArray(t)) out[t["key"]] = { ...t };
  for (const [k, tier] of Object.entries(earned)) {
    if (tier > get(get(out, k) || {}, "tier", 0)) out[k] = { key: k, tier, earned: true };
  }
  return Object.values(out);
}

export function carry_over(state, lgd) {
  // At the offseason's start: write every ability earned this season into the league's rosters ("ab",
  // the source's "name|tier"), so he keeps it next year wherever he plays, then clear the season's goals. Returns how
  // many abilities were written.
  const popped = get(state, "abilities_earned");
  delete state["abilities_earned"];
  const earned = truthy(popped) ? popped : {};
  delete state["ability_goals"];
  delete state["ability_upgrades"];
  if (!Object.keys(earned).length) return 0;
  const season = modules.season;
  const source = {};                                                // trait key -> the source's ability name
  for (const [k, v] of rv2.TRAITS.entries()) source[v[0]] = k;
  const tier_word = {};
  for (const [k, v] of Object.entries(rv2.TRAIT_TIERS)) tier_word[v] = k;
  const teams = season.load_teams();
  let n = 0;
  for (const [team, players] of Object.entries(earned)) {
    const t = get(teams, team) || {};
    const slugs = new Map();
    for (const x of [...get(t, "offense", []), ...get(t, "defense", [])]) slugs.set(`${x["name"]}|${x["position"]}`, get(x, "slug"));
    const roster = new Map();
    for (const c of get(get(get(lgd, "teams") || {}, team) || {}, "roster") || []) roster.set(get(c, "id"), c);
    for (const [key, got] of Object.entries(players)) {
      const c = roster.get(slugs.has(key) ? slugs.get(key) : null);
      if (!truthy(c)) continue;
      let ab = [...(get(c, "ab") || [])];
      for (const [trait, tier] of Object.entries(got)) {
        const name = own(source, trait);
        if (!truthy(name)) continue;
        let have = 0;
        for (const a of ab) {
          const parts = a.split("|");
          if (parts[0] === name) have = Math.max(have, own(rv2.TRAIT_TIERS, parts[parts.length - 1], 0));
        }
        if (tier > have) {
          ab = [...ab.filter((a) => a.split("|")[0] !== name), `${name}|${tier_word[tier]}`];
          n += 1;
        }
      }
      c["ab"] = ab;
    }
  }
  return n;
}

// recruits who arrive with abilities (the player's ask): a share by stars, mostly Bronze
const RECRUIT_AB_CHANCE = { 5: 0.75, 4: 0.45, 3: 0.25, 2: 0.10, 1: 0.05 };   // *tune* chance a recruit of these stars has one
const RECRUIT_AB_SECOND = { 5: 0.35, 4: 0.12 };                              // *tune* ... and a second one
const RECRUIT_AB_TIERS = { 5: [0.45, 0.40, 0.15], 4: [0.65, 0.30, 0.05] };   // *tune* Bronze/Silver/Gold odds by stars (else 85/15/0)

export function recruit_abilities(p) {
  // The abilities a high school prospect arrives with: [{key, name, tier, tier_name}], drawn from the
  // goals that suit his position (front-weighted, as a goal is) on his own stream (`recruit-ab-{id}`), so nothing else
  // moves.
  const rng = new Random(`recruit-ab-${p["id"]}`);
  const stars = int(Number(get(p, "stars") || 3));
  const fits = own(ability_goals.FITS, own(ability_goals.POS_GROUP, get(p, "ea_position") || get(p, "position"), ""), [])
    .filter((t) => Object.hasOwn(ability_goals.GOALS, t));
  if (!fits.length || rng.random() >= get(ability_goals.RECRUIT_AB_CHANCE, stars, 0.1)) return [];
  const n = rng.random() < get(ability_goals.RECRUIT_AB_SECOND, stars, 0.0) ? 2 : 1;
  const odds = get(ability_goals.RECRUIT_AB_TIERS, stars, [0.85, 0.15, 0.0]);
  const out = [], pool = [...fits];
  for (let j = 0, m = Math.min(n, pool.length); j < m; j++) {
    const k = rng.choices(pool, { weights: pool.map((_, i) => 1 / (1 + i)), k: 1 })[0];
    pool.splice(pool.indexOf(k), 1);
    const tier = rng.choices([1, 2, 3], { weights: odds, k: 1 })[0];
    out.push({ key: k, name: own(rv2.TRAIT_INFO, k, [k, ""])[0], about: own(rv2.TRAIT_INFO, k, ["", ""])[1],
      tier, tier_name: ability_goals.TIER_NAMES[tier] });
  }
  return out;
}

export function recruit_ab_field(p) {
  // recruit_abilities as the league roster's "ab" ("source name|Tier").
  const source = {};
  for (const [k, v] of rv2.TRAITS.entries()) source[v[0]] = k;
  return ability_goals.recruit_abilities(p).filter((a) => Object.hasOwn(source, a["key"])).map((a) => `${source[a["key"]]}|${a["tier_name"]}`);
}

export const ability_goals = {
  TIER_NAMES, UPGRADES_ALONGSIDE, GOALS, FITS, POS_GROUP, _held, next_goal, goal_view, _counts, after_game, upgrades_view,
  news, merged_traits, carry_over, RECRUIT_AB_CHANCE, RECRUIT_AB_SECOND, RECRUIT_AB_TIERS, recruit_abilities, recruit_ab_field,
};
modules.ability_goals = ability_goals;
