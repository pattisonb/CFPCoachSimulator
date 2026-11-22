// coach_career/prospects.py, as far as it is ported: the player card's attributes from a player's skills, which the
// overall is built on (teamdata_js/game_scale.js). The rest of that file comes later and is added to this namespace.
import { round, int, get } from "../engine_js/pyrt.js";
import { build_teams } from "../teamdata_js/build_teams.js";
import { game_scale } from "../teamdata_js/game_scale.js";
import { ratings as rv2 } from "../teamdata_js/ratings.js";

export function engine_position(p) {
  return get(build_teams.POSITION_MAP, p["ea_position"], p["position"]);
}

export function card_attributes(ours, p) {
  // A prospect's player card attributes from his skills (our scale), exactly as a player's card
  // gets them (build_teams): the skills back through the frozen scale, the card's composites, then
  // the card scale (50 at the middle Power 4 starter at his position).
  const pos = engine_position(p);
  return { ..._card(pos, get(p, "ea_position") || pos, Object.entries(ours)) };
}

const _CARD_MAX = 60000;
const _card_cache = new Map();

// one player's card is asked for more than once (his overall, then his grades)
// `skills`: [skill, value] pairs in his dict's order (Python's tuple(ours.items())).
export function _card(pos, ea_position, skills) {
  const at = `${pos}|${ea_position}|${skills.map((kv) => `${kv[0]}:${kv[1]}`).join(",")}`;
  const kept = _card_cache.get(at);
  if (kept !== undefined) return kept;
  const raw = rv2.raw_attributes(game_scale.base_from_ours(Object.fromEntries(skills), ea_position), pos, pos);
  let group = rv2.card_group(pos, pos);
  group = group === "FB" ? "RB" : group;
  const scale = game_scale.card_scale();
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const [m, hi, lo] = get(scale, `${group}|${k}`, [v, 1.5, 0.9]);
    out[k] = int(round(Math.max(1, Math.min(99, 50 + (v - m) * (v >= m ? hi : lo)))));
  }
  if (_card_cache.size >= _CARD_MAX) _card_cache.clear();
  _card_cache.set(at, out);
  return out;
}
_card.cache_clear = () => _card_cache.clear();

export const prospects = { engine_position, card_attributes, _card };
