// Coach Career (docs/superpowers/specs/2026-10-22-coach-career-design.md): a season played as
// the head coach. A career is a season state with a `career` block: the year, your coach, your
// settings and when it was last saved. Seasons without one (older saves, "remaining" mode, Real
// 2026) are plain seasons and nothing here touches them.
//
// A save is one gzip file. JavaScript has no gzip of its own that answers at once in every host, so the host gives
// this file its two functions (`career.zip`):
//   gzip(bytes)             the bytes packed as a gzip file (a Uint8Array)
//   gunzip(bytes, most)     a gzip file unpacked (a Uint8Array); throws when it is not gzip or unpacks past `most` bytes
// Files (the box scores, the season's own file) go through engine_js/files.js as everywhere else.
import { cmp, get, truthy, json_dumps, parse_ordered } from "../engine_js/pyrt.js";
import { read_text, write_text, exists, list_dir } from "../engine_js/files.js";
import { modules } from "../engine_js/modules.js";
import { coaches } from "../sim_js/coaches.js";
import { fcs_names } from "../sim_js/fcs_names.js";

const FIRST_YEAR = 2026;
const MAX_UNPACKED = 200 * 1024 * 1024;     // an uploaded save, unpacked (a full season of box scores is well under this)
const MAX_BOXES = 2000;                     // box scores in one save (a season has about 900)
const BOX_NAME = /^[A-Za-z0-9_-]+\.json$/;  // (matched whole)

// ---- small helpers ----
const is_dict = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// Python's white space (str.strip): JavaScript's trim takes U+FEFF and leaves U+001C-U+001F and U+0085
const WS = "[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const ENDS = new RegExp(`^${WS}+|${WS}+$`, "g");
const strip = (s) => s.replace(ENDS, "");
/** str(v) of what a save holds: a name, a number, None, True (a list or a dict is never a name or an id here) */
const str = (v) => (v === null || v === undefined ? "None" : v === true ? "True" : v === false ? "False" : typeof v === "string" ? v : is_dict(v) || Array.isArray(v) ? json_dumps(v) : String(v));
/** s.isalnum(): one character or more, every one a letter or a number */
const isalnum = (s) => /^[\p{L}\p{N}]+$/u.test(s);

export function _now() {
  return new Date().toISOString().slice(0, 19) + "+00:00";
}

export function new_career(state, coach) {
  // Make `state` a career and return its career block. `coach` is a created coach (the Your
  // coach page) or null for the team's own head coach.
  state["career"] = {
    year: career.FIRST_YEAR,
    coach: truthy(coach) ? { id: get(coach, "id"), name: strip(`${str(get(coach, "first_name", ""))} ${str(get(coach, "last_name", ""))}`) } : null,
    settings: { auto_recruit: false },
    saved_week: 0,
    saved_at: career._now(),
  };
  const recruiting = modules.recruiting;
  recruiting.start(state);
  state["career"]["staff"] = recruiting.make_staff(state);
  return state["career"];
}

export function is_career(state) {
  return truthy(get(state, "career"));
}

// ----- saves: the browser keeps a copy and restores it when the server has forgotten the season -----

export function export_save(state, boxes = true) {
  // The career as one gzip file: the season state and every saved box score (`boxes=false`:
  // the state alone, your own games' box scores included, for the browser's weekly copy).
  const season = modules.season;
  const files = {};
  if (boxes && exists(season.box_dir(state))) {
    const dir = season.box_dir(state);
    for (const name of list_dir(dir).filter((n) => n.endsWith(".json")).sort((a, b) => cmp(a, b))) {
      files[name] = fcs_names.rewrite_text(read_text(`${dir}/${name}`));
    }
  }
  return career.zip.gzip(new TextEncoder().encode(json_dumps({ state, boxes: files }, { separators: [",", ":"] })));
}

export function read_save(blob) {
  // A downloaded career's [state, box scores], without writing anything. Throws ValueError
  // for anything that is not a career save.
  let data, state;
  try {
    const raw = career.zip.gunzip(blob, career.MAX_UNPACKED);      // gzip, never unpacked past MAX_UNPACKED
    const text = fcs_names.rewrite_text(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw));   // a save from before the FCS stand-ins' rename
    data = parse_ordered(text, [["state", "games"], ["state", "my_boxes"]]);     // event ids look like numbers: keep the saved order
    if (data === null || typeof data !== "object") throw new TypeError("not a dict");
    if (Array.isArray(data) || data["state"] === undefined) throw new Error("KeyError: 'state'");
    state = data["state"];
  } catch (exc) {
    throw new coaches.ValueError("not a Coach Career save", { cause: exc });
  }
  if (!career._looks_like_career(state)) throw new coaches.ValueError("not a Coach Career save");
  const boxes = truthy(get(data, "boxes")) ? data["boxes"] : {};
  if (!is_dict(boxes) || Object.keys(boxes).length > career.MAX_BOXES) throw new coaches.ValueError("not a Coach Career save");
  const coach_names = modules.coach_names;
  coach_names.distinct(state);          // a save with one coach in two jobs or two coaches under one name heals
  const out = {};
  for (const [n, t] of Object.entries(boxes)) if (typeof t === "string" && career.BOX_NAME.test(n)) out[n] = fcs_names.rewrite_text(t);
  return [state, out];
}

export function _looks_like_career(state) {
  // A career save's shape: what the server reads from it before trusting it.
  const season = modules.season;
  if (!is_dict(state) || !isalnum(str(get(state, "id", "")))) return false;
  const c = get(state, "career");
  return (is_dict(c) && ["year", "settings", "saved_week", "saved_at"].every((k) => Object.hasOwn(c, k))
    && get(state, "mode") === "full" && (has(career._own_teams(state), get(state, "team")) || has(season.load_teams(), get(state, "team")))
    && is_dict(get(state, "games")) && is_dict(get(state, "recruiting"))
    && (Number.isInteger(get(state, "current_week")) || typeof get(state, "current_week") === "boolean"));
}
/** key in a dict, for a key a save gives (a team's slug, or anything else) */
const has = (d, k) => typeof k === "string" && Object.hasOwn(d, k);

export function _own_teams(state) {
  // The teams of a save's own league (a career from a league file plays teams the built-in league lacks).
  const lgd = get(state, "league");
  const teams = is_dict(lgd) ? get(lgd, "teams") : null;
  return is_dict(teams) ? teams : {};
}

export function write_save(state, boxes) {
  // Put a career on the server's disk as it was saved (its stamp unchanged).
  const season = modules.season;
  const d = season.box_dir(state);
  for (const [name, text] of Object.entries(boxes)) write_text(`${d}/${name}`, text);
  write_text(`${season.SEASONS_DIR}/${state["id"]}.json`, JSON.stringify(state));
}

export function import_save(blob) {
  // Write a downloaded career back to the server's disk and return its state.
  const [state, boxes] = career.read_save(blob);
  career.write_save(state, boxes);
  return state;
}

export function restore(blob, current) {
  // An uploaded career against the server's copy of it (`current`, null when the server has
  // forgotten it): the newer one is kept and returned; the upload is written only if it wins.
  const [state, boxes] = career.read_save(blob);
  if (current !== null && current !== undefined && get(current, "id") === state["id"]) {
    if (!career.is_career(current)) throw new coaches.ValueError("a different season on this server has that id");
    if (career.newer(current, state) === current) return current;
  }
  career.write_save(state, boxes);
  return state;
}

export function newer(a, b) {
  // The later of two copies of the same career: more weeks played, then saved later.
  const key = (s) => [get(s["career"], "saved_week", 0), get(s["career"], "saved_at", "")];
  return cmp(key(b), key(a)) > 0 ? b : a;
}

export const career = {
  FIRST_YEAR, MAX_UNPACKED, MAX_BOXES, BOX_NAME, zip: null, _now, new_career, is_career, export_save, read_save, _looks_like_career,
  _own_teams, write_save, import_save, restore, newer,
};
modules.career = career;
