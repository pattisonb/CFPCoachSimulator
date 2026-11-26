// A rating shift for a whole team: every player's ratings moved by the same number of points. The sim uses it for an
// FCS stand-in, which plays as the real FCS school it stands for that week (season.fcs_strength).
//
// The game's job (game_job.js) holds the one copy of the two functions; `with_form` here is that function, and
// `ATTRS` its list.
import { round, int, get, isNumber } from "../engine_js/pyrt.js";
import { modules } from "../engine_js/modules.js";
import { FORM_ATTRS, with_form } from "./game_job.js";

const ATTRS = FORM_ATTRS;

export function _moved(p, keys, shift) {
  // A copy of the player with the ratings in `keys` moved by `shift` card points.
  const q = { ...p };
  for (const k of keys) {
    const v = get(p, k);
    if (isNumber(v)) q[k] = round(v + shift, 1);
  }
  return q;
}

export { with_form };

export const form = { ATTRS, _moved, with_form };
modules.form = form;
