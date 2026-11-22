// Your coach: the head coach a player creates (the Your coach page), saved in data/coaches/,
// and how he changes the team he takes over in a season.
//
// A coach has an identity and a background (story only), ratings from an archetype, a
// coaching style (schemes and tendencies on the league scale, 50 = the FBS average), whether he
// calls his own offense and defense, and a look for his sprite. `apply_coach` puts him on a
// team: he replaces the head coach, and where he calls his own plays his schemes and
// tendencies replace the coordinator's, which the engine reads.
//
// `apply_coach` lives with the game's job (game_job.js) and is that one function here. The saved coaches are files
// (data/coaches/<id>.json): save, load, list_all and delete go through `coaches.store`, which a host sets:
//   read(id)         the saved text of one coach, or null when there is none
//   write(id, text)  save it
//   remove(id)       take it away
//   list()           the ids of every saved coach
import { sum, sorted, get, truthy } from "../engine_js/pyrt.js";
import { modules } from "../engine_js/modules.js";
import { fcs_names } from "./fcs_names.js";
import { apply_coach } from "./game_job.js";

const COACHES_DIR = "data/coaches";

const OFFENSE_SCHEMES = {
  "Air Raid": "Spreads the field and throws: more deep shots and quick throws, little play-action.",
  "West Coast": "Short, timed passes that move the chains: few deep shots, high completion rate.",
  "Spread RPO": "Run-pass options from the spread: quick throws, more outside runs, plenty of play-action.",
  "Power Spread": "Spread formations with a downhill run game: more inside runs and play-action shots.",
  "Spread Option": "Option runs from the spread: more outside runs and quarterback carries.",
  "Pro Style": "Under-center, balanced: inside runs and the most play-action.",
  "Flexbone Triple Option": "The academies' option: the fullback dive, almost no passing, rare deep shots off it.",
  "Multiple": "No fixed identity: the league-average mix.",
};
const DEFENSE_SCHEMES = {
  "4-3": "Four linemen and three linebackers: sound against the run.",
  "3-4": "Three linemen and four linebackers: rushers can come from anywhere.",
  "4-2-5": "Four linemen, two linebackers and a nickel back: built for spread offenses.",
  "Multiple 4-2-5": "The 4-2-5 with more disguises.",
  "3-3-5": "Three linemen, three linebackers and three safeties: speed over size.",
  "Tite Front 3-4": "A 3-4 with the tackles pinched inside: stops the inside run.",
};
// rating presets for the archetypes (the sliders start here)
const ARCHETYPES = {
  "Offensive Guru": { about: "Built the offense from the ground up. Elite play-caller on offense, less hands-on with the defense.",
    ratings: { offense: 90, defense: 60, recruiting: 65, player_development: 75, game_management: 70, motivation: 70, discipline: 65 } },
  "Defensive Mastermind": { about: "Came up as a defensive coordinator. The defenses are disciplined and hard to read.",
    ratings: { offense: 60, defense: 90, recruiting: 65, player_development: 75, game_management: 70, motivation: 70, discipline: 80 } },
  "Recruiting Ace": { about: "Wins in living rooms. Brings in talent; leans on coordinators for the X's and O's.",
    ratings: { offense: 68, defense: 68, recruiting: 92, player_development: 70, game_management: 65, motivation: 78, discipline: 62 } },
  "Program Builder": { about: "Turns programs around: develops players, runs a tight ship.",
    ratings: { offense: 70, defense: 70, recruiting: 70, player_development: 88, game_management: 72, motivation: 72, discipline: 82 } },
  "Players' Coach": { about: "Players run through walls for this coach. Loose on the details.",
    ratings: { offense: 70, defense: 70, recruiting: 78, player_development: 75, game_management: 62, motivation: 92, discipline: 55 } },
  "Game-Day CEO": { about: "Manages the clock, the fourth downs and the headset better than anyone.",
    ratings: { offense: 72, defense: 72, recruiting: 70, player_development: 70, game_management: 92, motivation: 70, discipline: 75 } },
};
const RATING_KEYS = ["offense", "defense", "recruiting", "player_development", "game_management", "motivation", "discipline"];
const RATING_LABELS = { offense: "Offense", defense: "Defense", recruiting: "Recruiting", player_development: "Player Development",
  game_management: "Game Management", motivation: "Motivation", discipline: "Discipline" };
const RATING_ABOUT = {
  offense: "Play-calling on offense, when the coach calls it: wins more of the guessing game.",
  defense: "Play-calling on defense, when the coach calls it.",
  recruiting: "Recruiting classes (coming with recruiting).",
  player_development: "How fast players improve (coming with the offseason).",
  game_management: "Clock and timeout decisions late in halves (coming with coach mode).",
  motivation: "How much a hot streak or a big win lifts the team (coming with coach mode).",
  discipline: "Fewer penalties.",
};
const RATING_BUDGET = 525;          // the seven ratings may add up to at most this
const RATING_LIVE = ["offense", "defense", "discipline"];   // the ratings games use today; the rest come with later features
// style sliders: key -> [label, side, what it does in the sim]; 50 = the FBS average
const STYLE = {
  pass_rate: ["Pass rate", "offense", "How often the offense calls a pass instead of a run."],
  tempo: ["Tempo", "offense", "How fast the offense snaps the ball: more plays a game."],
  deep_shot_rate: ["Deep shots", "offense", "How often throws go 20+ yards downfield."],
  play_action_rate: ["Play-action", "offense", "How often first- and second-down passes start with a run fake."],
  fourth_down_go_rate: ["Fourth-down aggressiveness", "head", "How often the team goes for it instead of punting or kicking."],
  blitz_rate: ["Blitz", "defense", "How often the defense sends extra rushers: more sacks, more big plays allowed."],
  man_coverage_rate: ["Man coverage", "defense", "How often the defense plays man instead of zone."],
  press_rate: ["Press", "defense", "How often corners press receivers at the line in man coverage."],
};
const POSITIONS_PLAYED = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "DB", "K/P", "Did not play"];
const PLAYING_LEVELS = ["Walk-on", "College starter", "All-conference", "All-American", "NFL"];
// the sprite: option lists the page offers (coach.js draws them)
const LOOK = {
  skin: ["#f1d3b8", "#e0b48f", "#c68b5e", "#9c6640", "#734a2c", "#4b2f1d"],
  hair: ["short", "buzz", "side part", "curly", "bald", "long"],
  hair_color: ["#1f1a17", "#4a3020", "#8b5a2b", "#c8a165", "#9a9a9a", "#e6e6e6"],
  facial_hair: ["none", "stubble", "mustache", "goatee", "beard"],
  glasses: ["none", "round", "square", "sunglasses"],
  headwear: ["none", "cap", "visor", "headset"],
  outfit: ["polo", "quarter-zip", "hoodie", "suit"],
};

/** A value the page sent that cannot be used: what `clean` and the saved-coach functions throw with a readable message. */
export class ValueError extends Error {}

// ---- small helpers, for what the page sends ----
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const is_dict = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// Python's white space (str.strip): JavaScript's trim takes U+FEFF and leaves U+001C-U+001F and U+0085
const WS = "[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const ENDS = new RegExp(`^${WS}+|${WS}+$`, "g");
const strip = (s) => s.replace(ENDS, "");
/** s[:n]: the first n characters (Python counts whole characters, not UTF-16 halves). */
const first = (s, n) => (s.length <= n ? s : Array.from(s).slice(0, n).join(""));

/** repr(v) of what JSON can hold, for str() of a list or dict. */
function py_repr(v) {
  if (typeof v === "string") {
    const q = v.includes("'") && !v.includes('"') ? '"' : "'";
    return q + v.replace(/[\\\n\r\t]/g, (c) => ({ "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t" })[c]).replaceAll(q, q === "'" ? "\\'" : '"') + q;
  }
  if (Array.isArray(v)) return `[${v.map(py_repr).join(", ")}]`;
  if (is_dict(v)) return `{${Object.entries(v).map(([k, x]) => `${py_repr(k)}: ${py_repr(x)}`).join(", ")}}`;
  return py_str(v);
}

/** str(v). */
function py_str(v) {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") {
    if (Number.isNaN(v)) return "nan";
    if (!Number.isFinite(v)) return v > 0 ? "inf" : "-inf";
    return Number.isInteger(v) ? String(v) : fcs_names._float_repr(v);    // (a JSON 4.0 is 4 here: Python would write "4.0")
  }
  return py_repr(v);
}

/** int() could not make a number of it (Python's TypeError or ValueError). */
class NotANumber extends Error {}
const ND = /^\p{Nd}$/u;
/** The value of a decimal digit of any script: the digits of a script sit in a row from its zero. */
function digit_value(ch) {
  let cp = ch.codePointAt(0), start = cp;
  if (cp >= 48 && cp <= 57) return cp - 48;
  while (start > 0 && ND.test(String.fromCodePoint(start - 1))) start--;
  return (cp - start) % 10;
}
const INT_TEXT = new RegExp(`^${WS}*([+-]?)(\\p{Nd}+(?:_\\p{Nd}+)*)${WS}*$`, "u");

/** int(v): a whole number as it is, a float cut toward zero, True and False as 1 and 0, text read as a whole number. */
function py_int(v) {
  if (v === true) return 1;
  if (v === false) return 0;
  if (typeof v === "number") {
    if (Number.isNaN(v)) throw new NotANumber("cannot convert float NaN to integer");
    if (!Number.isFinite(v)) throw new Error("OverflowError: cannot convert float infinity to integer");
    return Math.trunc(v);
  }
  if (typeof v === "string") {
    const m = INT_TEXT.exec(v);
    if (!m) throw new NotANumber(`invalid literal for int() with base 10: ${py_repr(v)}`);
    const digits = Array.from(m[2].replaceAll("_", ""), digit_value);
    if (digits.length > 4300) throw new NotANumber("Exceeds the limit (4300 digits) for integer string conversion");
    const n = Number(digits.join(""));      // (past 2**53 the last digits go; every caller clamps it to two digits)
    return m[1] === "-" ? -n : n;
  }
  throw new NotANumber("int() argument must be a string, a bytes-like object or a real number");
}

/** `d.get(k) or {}` then read as a dict: Python stops (AttributeError) on a list or a string there. */
function as_dict(v) {
  if (!truthy(v)) return {};
  if (!is_dict(v)) throw new TypeError("AttributeError: this is not a dict");
  return v;
}
/** `v in table` for a dict's keys: Python stops (TypeError: unhashable) on a list or a dict. */
function is_key(v, table) {
  if (v !== null && typeof v === "object") throw new TypeError("unhashable type");
  return typeof v === "string" && own(table, v);
}
/** `v or d`, by Python's truth (an empty list or dict is false). */
const or_ = (v, d) => (truthy(v) ? v : d);
const fullmatch = (re, s) => new RegExp(`^(?:${re.source})$`, re.flags).test(s);

export function blank() {
  // A new coach with the page's defaults.
  const style = {};
  for (const k of Object.keys(coaches.STYLE)) style[k] = 50;
  return { id: null, first_name: "", last_name: "", age: 42, hometown: "", alma_mater: null,
    archetype: "Program Builder", ratings: { ...coaches.ARCHETYPES["Program Builder"]["ratings"] },
    played: "Did not play", playing_level: "Walk-on", background: "",
    offense_scheme: "Multiple", defense_scheme: "4-2-5", calls_offense: true, calls_defense: false,
    style,
    look: { skin: coaches.LOOK["skin"][1], hair: "short", hair_color: coaches.LOOK["hair_color"][1], facial_hair: "none",
      glasses: "none", headwear: "cap", outfit: "polo" },
    face: null };
}

export function clean(data) {
  // Validate a coach from the page; throws ValueError with a readable message.
  const c = coaches.blank();
  const first_name = first(strip(py_str(or_(get(data, "first_name"), ""))), 30);
  const last_name = first(strip(py_str(or_(get(data, "last_name"), ""))), 30);
  if (!first_name || !last_name) throw new ValueError("give your coach a first and last name");
  c["first_name"] = first_name;
  c["last_name"] = last_name;
  c["id"] = truthy(get(data, "id")) ? data["id"] : null;
  try {
    c["age"] = Math.max(28, Math.min(75, py_int(truthy(get(data, "age")) ? data["age"] : 42)));
  } catch (e) {
    if (e instanceof NotANumber) throw new ValueError("age must be a number");
    throw e;
  }
  c["hometown"] = first(strip(py_str(or_(get(data, "hometown"), ""))), 60);
  c["alma_mater"] = truthy(get(data, "alma_mater")) ? first(py_str(data["alma_mater"]), 60) : null;
  c["background"] = first(strip(py_str(or_(get(data, "background"), ""))), 1500);
  if (!is_key(get(data, "archetype"), coaches.ARCHETYPES)) throw new ValueError("pick an archetype");
  c["archetype"] = data["archetype"];
  const given_ratings = as_dict(get(data, "ratings"));
  const preset = coaches.ARCHETYPES[c["archetype"]]["ratings"];
  const ratings = {};
  for (const k of coaches.RATING_KEYS) {
    try {
      ratings[k] = Math.max(40, Math.min(99, py_int(own(given_ratings, k) ? given_ratings[k] : preset[k])));
    } catch (e) {
      if (e instanceof NotANumber) throw new ValueError(`${coaches.RATING_LABELS[k]} must be a number`);
      throw e;
    }
  }
  const total = sum(Object.values(ratings));
  if (total > coaches.RATING_BUDGET) throw new ValueError(`the ratings add up to ${total}; the most is ${coaches.RATING_BUDGET}`);
  c["ratings"] = ratings;
  c["played"] = coaches.POSITIONS_PLAYED.includes(get(data, "played")) ? data["played"] : "Did not play";
  c["playing_level"] = coaches.PLAYING_LEVELS.includes(get(data, "playing_level")) ? data["playing_level"] : "Walk-on";
  if (!is_key(get(data, "offense_scheme"), coaches.OFFENSE_SCHEMES) || !is_key(get(data, "defense_scheme"), coaches.DEFENSE_SCHEMES)) {
    throw new ValueError("pick an offensive and a defensive scheme");
  }
  c["offense_scheme"] = data["offense_scheme"];
  c["defense_scheme"] = data["defense_scheme"];
  c["calls_offense"] = truthy(get(data, "calls_offense"));
  c["calls_defense"] = truthy(get(data, "calls_defense"));
  const given_style = as_dict(get(data, "style"));
  const style = {};
  for (const k of Object.keys(coaches.STYLE)) {
    try {
      style[k] = Math.max(0, Math.min(100, py_int(own(given_style, k) ? given_style[k] : 50)));
    } catch (e) {
      if (e instanceof NotANumber) throw new ValueError(`${coaches.STYLE[k][0]} must be a number`);
      throw e;
    }
  }
  c["style"] = style;
  const given_look = as_dict(get(data, "look"));
  const look = {};
  for (const [k, opts] of Object.entries(coaches.LOOK)) {
    const v = own(given_look, k) ? given_look[k] : null;
    look[k] = opts.includes(v) ? v : c["look"][k];
  }
  c["look"] = look;
  c["face"] = coaches._clean_face(get(data, "face"));
  return c;
}

// a pocket-faces look from the new UI (ui/): its fields come from that package's data (0.2 adds categories without code),
// so any field named in letters holding a part id or null is kept, plus the fade and the list of flipped layers
const FACE_ID = /[a-z0-9_]{1,40}/;
const FACE_KEY = /[A-Za-z]{1,30}/;
const FACE_MAX_FIELDS = 32;  // *tune* more fields than any face has: the rest are dropped

export function _clean_face(face) {
  // The face's fields kept as plain ids (letters, digits, underscores) or null, `hairFade` as a bool and `flip`
  // as a list of ids; anything else is dropped.
  if (!is_dict(face)) return null;
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(face)) {
    if (n >= coaches.FACE_MAX_FIELDS || !fullmatch(coaches.FACE_KEY, k)) continue;
    if (k === "hairFade") {
      out[k] = v === true;
    } else if (k === "flip") {
      out[k] = Array.isArray(v) ? v.filter((x) => typeof x === "string" && fullmatch(coaches.FACE_ID, x)).slice(0, 8) : [];
    } else if (v === null || (typeof v === "string" && fullmatch(coaches.FACE_ID, v))) {
      out[k] = v;
    } else {
      continue;
    }
    n++;
  }
  return out;
}

export function _path(coach_id) {
  // A saved coach's file (its path from the project's root); throws ValueError for an id that is not 12 hex characters.
  const id = truthy(coach_id) ? coach_id : "";
  if (typeof id !== "string") throw new TypeError("expected string or bytes-like object");
  if (!/^[a-f0-9]{12}$/.test(id)) throw new ValueError("unknown coach");
  return `${coaches.COACHES_DIR}/${id}.json`;
}

function _store() {
  if (!coaches.store) throw new Error("no way to save or read a coach: coaches.store is not set (read, write, remove, list)");
  return coaches.store;
}
const pad = (n, w = 2) => String(n).padStart(w, "0");
/** time.strftime("%Y-%m-%dT%H:%M:%S"): this computer's time now. */
function _now() {
  const d = new Date();
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
/** json.dumps(c, indent=1): one space a level, everything outside plain ASCII as \uXXXX. */
const _dumps = (c) => JSON.stringify(c, null, 1).replace(/[\u007f-￿]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));

export function save(data) {
  const c = coaches.clean(data);
  if (truthy(c["id"])) coaches._path(c["id"]);          // validates the id
  else c["id"] = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  c["updated_at"] = _now();
  _store().write(c["id"], _dumps(c));
  return c;
}

export function load(coach_id) {
  try {
    coaches._path(coach_id);
  } catch (e) {
    if (e instanceof ValueError) return null;
    throw e;
  }
  const text = _store().read(coach_id);
  return text === null || text === undefined ? null : JSON.parse(fcs_names.rewrite_text(text));
}

export function list_all() {
  const store = _store();
  const out = [];
  for (const id of store.list()) {
    const text = store.read(id);
    if (text !== null && text !== undefined) out.push(JSON.parse(fcs_names.rewrite_text(text)));
  }
  return sorted(out, (c) => get(c, "updated_at", ""), true);
}

function delete_(coach_id) {
  coaches._path(coach_id);
  const store = _store();
  const text = store.read(coach_id);
  if (text !== null && text !== undefined) {
    store.remove(coach_id);
    return true;
  }
  return false;
}
export { delete_ as delete };

export function options() {
  // Everything the page needs to build its form.
  const style = {};
  for (const [k, v] of Object.entries(coaches.STYLE)) style[k] = { label: v[0], side: v[1], about: v[2] };
  return { offense_schemes: coaches.OFFENSE_SCHEMES, defense_schemes: coaches.DEFENSE_SCHEMES,
    archetypes: coaches.ARCHETYPES, rating_keys: coaches.RATING_KEYS, rating_labels: coaches.RATING_LABELS, rating_about: coaches.RATING_ABOUT,
    rating_budget: coaches.RATING_BUDGET, rating_live: coaches.RATING_LIVE, style,
    positions_played: coaches.POSITIONS_PLAYED, playing_levels: coaches.PLAYING_LEVELS, look: coaches.LOOK, blank: coaches.blank() };
}

export function _coordinator(team, side) {
  // 'OC Brian Hartline (Spread RPO)': the team's own coordinator on one side.
  const cs = get(team, "coaches") || {};
  const hc_scheme = get(get(cs, "head_coach") || {}, "scheme") || {};
  if (side === "offense") {
    const oc = get(cs, "offensive_coordinator") || {};
    const scheme = get(get(oc, "scheme") || {}, "offensive_scheme") || get(hc_scheme, "offensive_philosophy") || "Multiple";
    return `OC ${get(oc, "name") || "unnamed"} (${scheme})`;
  }
  const dc = get(cs, "defensive_coordinator") || {};
  const scheme = get(get(dc, "scheme") || {}, "defensive_scheme") || get(hc_scheme, "defensive_philosophy") || "4-2-5";
  return `DC ${get(dc, "name") || "unnamed"} (${scheme})`;
}

export function staff(coach, team) {
  // Who runs each side of the ball this season: {"offense": text, "defense": text}. The
  // team's coordinators stay for the season; a created coach who calls a side himself uses
  // his own scheme and style on it.
  const out = {};
  for (const [side, calls, scheme] of [["offense", "calls_offense", "offense_scheme"], ["defense", "calls_defense", "defense_scheme"]]) {
    if (truthy(coach) && truthy(get(coach, calls))) out[side] = `calls the ${coach[scheme]} ${side} as head coach`;
    else out[side] = coaches._coordinator(team, side);
  }
  return out;
}

export { apply_coach };

export const coaches = {
  COACHES_DIR, OFFENSE_SCHEMES, DEFENSE_SCHEMES, ARCHETYPES, RATING_KEYS, RATING_LABELS, RATING_ABOUT, RATING_BUDGET, RATING_LIVE,
  STYLE, POSITIONS_PLAYED, PLAYING_LEVELS, LOOK, FACE_ID, FACE_KEY, FACE_MAX_FIELDS,
  ValueError, store: null,
  blank, clean, _clean_face, _path, save, load, list_all, delete: delete_, options, _coordinator, staff, apply_coach,
};

modules.coaches = coaches;
