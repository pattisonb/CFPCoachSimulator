// coach_career/recruits.py, as far as it is ported: the recruiting model's file and EA's curve, which the game's
// scale needs (teamdata_js/game_scale.js from_ea). The rest of that file comes later and is added to this namespace.
import { read_json } from "../engine_js/files.js";

const MODEL_FILE = "data/recruiting_model.json";

export function model() {
  return read_json(recruits.MODEL_FILE);      // parsed once (files.js keeps it)
}

// (Python keeps 4,096 answers; the answer is the same worked out again.)
export function curve(ea) {
  // EA's scale -> the source scale (cfb_sim_data/league.json's piecewise-linear curve).
  const pts = recruits.model()["players"]["curve"];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (ea <= x1) return y0 + (ea - x0) * (y1 - y0) / (x1 - x0);
  }
  return pts[pts.length - 1][1];
}

export const recruits = { MODEL_FILE, model, curve };
