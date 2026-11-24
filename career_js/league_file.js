// The league as a file (docs/superpowers/specs/2026-11-05-league-file-design.md): the built-in league
// exported losslessly in the "cfp-league/1" format, so an import that leaves a team alone keeps exactly
// what the game has. The FCS stand-ins and their conference are never written (league.base_meta's
// "fictional" flag says which they are).
//
// Notes:
//  - A file's bytes are a Uint8Array. Its JSON is read by `json_loads` below, which reads as Python's json.loads
//    does (the same errors at the same line and column, NaN and Infinity as Python treats them), since the sentences
//    a bad file gets carry them. An object of the file with a number-like key ("12") is an odict, so walking it
//    follows the file's order.
//  - `YEAR` and `UNTOUCHED_LINE` are read from `league` when asked for (league.FIRST_YEAR), not at load.
//  - The sets (`_builtin()`'s slugs, fict_slugs, fict_conf) are Sets in sorted-slug order.
//  - `builtin_bytes`, `_builtin`, `_builtin_rosters`, `_words` and `_builtin_docs` keep one answer and have
//    `cache_clear()`.
import { Random, sorted, minBy, get, truthy, int, fmt, pyfloat, odict, is_odict } from "../engine_js/pyrt.js";
import { modules } from "../engine_js/modules.js";
import { cfg } from "../engine_js/game_config.js";
import { coaches as sim_coaches, ValueError } from "../sim_js/coaches.js";
import { game_scale } from "../teamdata_js/game_scale.js";
import { ratings as rv } from "../teamdata_js/ratings.js";
import { recruits } from "./recruits.js";

// ---- Python's ways with values, where JavaScript's differ ----------------------------------------------------------

const _own = Object.prototype.hasOwnProperty;
const _INDEX_KEY = /^(?:0|[1-9][0-9]{0,9})$/;      // a key a JavaScript object would list out of its turn
/** `k in d` for a dict whose keys come from a file (a plain `in` would find "constructor"). */
const has = (d, k) => typeof k === "string" && _own.call(d, k);
/** d.get(k, default) for such a dict. */
const dget = (d, k, dflt = null) => (has(d, k) ? d[k] : dflt);
const is_dict = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const is_str = (v) => typeof v === "string";
const is_list = (v) => Array.isArray(v);
/** A new dict that keeps number-like keys in order when any of `like` does. */
const new_dict = (...like) => (like.some((d) => is_odict(d)) ? odict() : {});

/** A dict of a Map's entries in their order: a plain object, or an odict when a key is number-like ("12"). */
function dict_of(map) {
  const pairs = [...map].map(([k, v]) => [k === null ? "None" : String(k), v]);
  if (pairs.some((p) => _INDEX_KEY.test(p[0]))) return odict(pairs);
  const o = {};
  for (const [k, v] of pairs) {
    if (k === "__proto__") Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
    else o[k] = v;
  }
  return o;
}

/** copy.deepcopy of JSON data (an odict stays one). */
function deepcopy(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(deepcopy);
  const out = new_dict(v);
  for (const k of Object.keys(v)) out[k] = deepcopy(v[k]);
  return out;
}

/** Python's == on JSON data: dicts whatever their key order, True as 1 and False as 0. */
function pyeq(a, b) {
  if (a === b) return true;
  if (typeof a === "boolean") a = a ? 1 : 0;
  if (typeof b === "boolean") b = b ? 1 : 0;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
  const la = Array.isArray(a), lb = Array.isArray(b);
  if (la !== lb) return false;
  if (la) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!pyeq(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!_own.call(b, k) || !pyeq(a[k], b[k])) return false;
  return true;
}

// str.strip(): Python's white space (it has \x1c-\x1f and \x85, and not ﻿, where JavaScript's trim differs)
const _WS = "\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const _STRIP = new RegExp(`^[${_WS}]+|[${_WS}]+$`, "g");
const strip = (s) => s.replace(_STRIP, "");
/** len(s): characters, not UTF-16 units. */
const pylen = (s) => { let n = 0; for (const _ of s) n++; return n; };

// str.casefold(): each character's lowercase, but for the ones below ([code point, fold] or [first, last, offset]).
const _FOLD_ROWS = [
  [181,"\u03bc"],[223,"\u0073\u0073"],[329,"\u02bc\u006e"],[383,"\u0073"],[496,"\u006a\u030c"],[837,"\u03b9"],
  [912,"\u03b9\u0308\u0301"],[944,"\u03c5\u0308\u0301"],[962,"\u03c3"],[976,"\u03b2"],[977,"\u03b8"],[981,"\u03c6"],
  [982,"\u03c0"],[1008,"\u03ba"],[1009,"\u03c1"],[1013,"\u03b5"],[1415,"\u0565\u0582"],[5024,5109,0],[5112,5117,-8],
  [7296,"\u0432"],[7297,"\u0434"],[7298,"\u043e"],[7299,7300,-6210],[7301,"\u0442"],[7302,"\u044a"],[7303,"\u0463"],
  [7304,"\ua64b"],[7830,"\u0068\u0331"],[7831,"\u0074\u0308"],[7832,"\u0077\u030a"],[7833,"\u0079\u030a"],
  [7834,"\u0061\u02be"],[7835,"\u1e61"],[7838,"\u0073\u0073"],[8016,"\u03c5\u0313"],[8018,"\u03c5\u0313\u0300"],
  [8020,"\u03c5\u0313\u0301"],[8022,"\u03c5\u0313\u0342"],[8064,"\u1f00\u03b9"],[8065,"\u1f01\u03b9"],
  [8066,"\u1f02\u03b9"],[8067,"\u1f03\u03b9"],[8068,"\u1f04\u03b9"],[8069,"\u1f05\u03b9"],[8070,"\u1f06\u03b9"],
  [8071,"\u1f07\u03b9"],[8072,"\u1f00\u03b9"],[8073,"\u1f01\u03b9"],[8074,"\u1f02\u03b9"],[8075,"\u1f03\u03b9"],
  [8076,"\u1f04\u03b9"],[8077,"\u1f05\u03b9"],[8078,"\u1f06\u03b9"],[8079,"\u1f07\u03b9"],[8080,"\u1f20\u03b9"],
  [8081,"\u1f21\u03b9"],[8082,"\u1f22\u03b9"],[8083,"\u1f23\u03b9"],[8084,"\u1f24\u03b9"],[8085,"\u1f25\u03b9"],
  [8086,"\u1f26\u03b9"],[8087,"\u1f27\u03b9"],[8088,"\u1f20\u03b9"],[8089,"\u1f21\u03b9"],[8090,"\u1f22\u03b9"],
  [8091,"\u1f23\u03b9"],[8092,"\u1f24\u03b9"],[8093,"\u1f25\u03b9"],[8094,"\u1f26\u03b9"],[8095,"\u1f27\u03b9"],
  [8096,"\u1f60\u03b9"],[8097,"\u1f61\u03b9"],[8098,"\u1f62\u03b9"],[8099,"\u1f63\u03b9"],[8100,"\u1f64\u03b9"],
  [8101,"\u1f65\u03b9"],[8102,"\u1f66\u03b9"],[8103,"\u1f67\u03b9"],[8104,"\u1f60\u03b9"],[8105,"\u1f61\u03b9"],
  [8106,"\u1f62\u03b9"],[8107,"\u1f63\u03b9"],[8108,"\u1f64\u03b9"],[8109,"\u1f65\u03b9"],[8110,"\u1f66\u03b9"],
  [8111,"\u1f67\u03b9"],[8114,"\u1f70\u03b9"],[8115,"\u03b1\u03b9"],[8116,"\u03ac\u03b9"],[8118,"\u03b1\u0342"],
  [8119,"\u03b1\u0342\u03b9"],[8124,"\u03b1\u03b9"],[8126,"\u03b9"],[8130,"\u1f74\u03b9"],[8131,"\u03b7\u03b9"],
  [8132,"\u03ae\u03b9"],[8134,"\u03b7\u0342"],[8135,"\u03b7\u0342\u03b9"],[8140,"\u03b7\u03b9"],
  [8146,"\u03b9\u0308\u0300"],[8147,"\u03b9\u0308\u0301"],[8150,"\u03b9\u0342"],[8151,"\u03b9\u0308\u0342"],
  [8162,"\u03c5\u0308\u0300"],[8163,"\u03c5\u0308\u0301"],[8164,"\u03c1\u0313"],[8166,"\u03c5\u0342"],
  [8167,"\u03c5\u0308\u0342"],[8178,"\u1f7c\u03b9"],[8179,"\u03c9\u03b9"],[8180,"\u03ce\u03b9"],
  [8182,"\u03c9\u0342"],[8183,"\u03c9\u0342\u03b9"],[8188,"\u03c9\u03b9"],[43888,43967,-38864],
  [64256,"\u0066\u0066"],[64257,"\u0066\u0069"],[64258,"\u0066\u006c"],[64259,"\u0066\u0066\u0069"],
  [64260,"\u0066\u0066\u006c"],[64261,"\u0073\u0074"],[64262,"\u0073\u0074"],[64275,"\u0574\u0576"],
  [64276,"\u0574\u0565"],[64277,"\u0574\u056b"],[64278,"\u057e\u0576"],[64279,"\u0574\u056d"],
];
const _FOLD = new Map();
for (const row of _FOLD_ROWS) {
  if (row.length === 2) _FOLD.set(row[0], row[1]);
  else for (let cp = row[0]; cp <= row[1]; cp++) _FOLD.set(cp, String.fromCodePoint(cp + row[2]));
}
function casefold(s) {
  let out = "";
  for (const ch of s) out += _FOLD.get(ch.codePointAt(0)) ?? ch.toLowerCase();
  return out;
}

/** repr() of a JSON value, for the few sentences that can carry one that is not text. */
function pyrepr(v) {
  if (typeof v === "string") {
    const q = v.includes("'") && !v.includes('"') ? '"' : "'";
    let out = "";
    for (const ch of v) {
      const c = ch.codePointAt(0);
      if (ch === "\\" || ch === q) out += "\\" + ch;
      else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else if (c < 32 || c === 127) out += "\\x" + c.toString(16).padStart(2, "0");
      else out += ch;
    }
    return q + out + q;
  }
  if (Array.isArray(v)) return "[" + v.map(pyrepr).join(", ") + "]";
  if (is_dict(v)) return "{" + Object.keys(v).map((k) => `${pyrepr(k)}: ${pyrepr(v[k])}`).join(", ") + "}";
  return pystr(v);
}
/** str() of a JSON value (an f-string's "{v}"). */
function pystr(v) {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") {
    if (Number.isNaN(v)) return "nan";
    if (!Number.isFinite(v)) return v > 0 ? "inf" : "-inf";
    return Number.isInteger(v) ? String(v) : pyfloat(v);
  }
  return pyrepr(v);
}

/** `for x in (v or [])`: a list's items, a dict's keys, a text's characters; Python cannot walk anything else and says so. */
function walk(v) {
  if (!truthy(v)) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return Array.from(v);
  if (typeof v === "object") return Object.keys(v);
  throw new TypeError(`'${typeof v === "boolean" ? "bool" : "int"}' object is not iterable`);
}

/** sorted() of a pair of slugs; Python cannot order text against anything else and says so. */
function sorted_pair(a, b) {
  if (typeof a !== "string" || typeof b !== "string") throw new TypeError("'<' not supported between instances");
  return a <= b ? [a, b] : [b, a];
}
const pair_key = (pair) => pair.join("\u0000");
const same_list = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** functools.lru_cache(maxsize=1) on a function of no arguments. */
function cached(fn) {
  let known = false, value;
  const f = () => { if (!known) { value = fn(); known = true; } return value; };
  f.cache_clear = () => { known = false; value = undefined; };
  return f;
}

/** A dict key Python could not look up (KeyError). */
export class KeyError extends Error {}

// ---- json.loads, as Python reads a file's text -----------------------------------------------------------------------

/** json.JSONDecodeError: `msg`, and where (`pos` in the text, `lineno`, `colno` counted in characters). */
export class JSONDecodeError extends ValueError {
  constructor(msg, doc, pos) {
    const before = doc.lastIndexOf("\n", pos - 1);
    let lineno = 1;
    for (let i = doc.indexOf("\n"); i !== -1 && i < pos; i = doc.indexOf("\n", i + 1)) lineno++;
    const colno = pylen(doc.slice(pos > 0 ? before + 1 : 0, pos)) + 1;
    super(`${msg}: line ${lineno} column ${colno} (char ${pos})`);
    this.msg = msg; this.pos = pos; this.lineno = lineno; this.colno = colno;
  }
}
/** Python's RecursionError (a file nested deeper than Python's decoder goes). */
export class RecursionError extends Error {}

const JSON_MAX_DEPTH = 9998;        // the arrays and objects inside one another Python 3.13's decoder reads before it gives up
const INT_MAX_DIGITS = 4300;        // Python's longest whole number read from text
const _NUMBER = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;
const _ESCAPES = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
const _HEX4 = /^[0-9a-fA-F]{4}$/;
const _YEAR_TOKEN = Symbol("year as the file wrote it");

/**
 * json.loads(text, parse_constant=_no_constant): the value, or JSONDecodeError with Python's message and place,
 * ValueError for NaN, Infinity and a whole number too long, RecursionError past JSON_MAX_DEPTH.
 */
function json_loads(s) {
  if (s.startsWith("﻿")) throw new JSONDecodeError("Unexpected UTF-8 BOM (decode using utf-8-sig)", s, 0);
  const n = s.length;
  let i = 0;
  const fail = (msg, pos) => { throw new JSONDecodeError(msg, s, pos); };
  const ws = () => { for (;;) { const c = s.charCodeAt(i); if (c === 32 || c === 9 || c === 10 || c === 13) i++; else break; } };
  const scanstring = () => {            // at the character after the opening quote; leaves i after the closing one
    const begin = i - 1;
    let out = "";
    for (;;) {
      let j = i, c = 0;
      for (; j < n; j++) {
        c = s.charCodeAt(j);
        if (c === 34 || c === 92) break;
        if (c <= 0x1f) fail("Invalid control character at", j);
      }
      if (j >= n) fail("Unterminated string starting at", begin);
      out += s.slice(i, j);
      if (c === 34) { i = j + 1; return out; }
      j++;
      if (j >= n) fail("Unterminated string starting at", begin);
      const e = s[j];
      if (e !== "u") {
        const ch = _ESCAPES[e];
        if (ch === undefined || !_own.call(_ESCAPES, e)) fail("Invalid \\escape", j - 1);
        out += ch;
        i = j + 1;
      } else {
        j++;
        const end = j + 4;
        if (end > n) fail("Invalid \\uXXXX escape", j - 1);
        const hex = s.slice(j, end);
        if (!_HEX4.test(hex)) fail("Invalid \\uXXXX escape", end - 5);
        out += String.fromCharCode(parseInt(hex, 16));       // a pair of surrogates written as two escapes joins by itself
        i = end;
      }
    }
  };
  const build = (pairs) => {
    for (const p of pairs) if (_INDEX_KEY.test(p[0])) return odict(pairs);
    const o = {};
    for (const [k, v] of pairs) {
      if (k === "__proto__") Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
      else o[k] = v;
    }
    return o;
  };
  const key = () => {                   // a property name and its colon; leaves i at the value
    if (s[i] !== '"') fail("Expecting property name enclosed in double quotes", i);
    i++;
    const k = scanstring();
    ws();
    if (s[i] !== ":") fail("Expecting ':' delimiter", i);
    i++;
    ws();
    return k;
  };
  const stack = [];                     // the open arrays ({list}) and objects ({pairs, key})
  const enter = (what) => {
    if (stack.length + 1 > JSON_MAX_DEPTH) throw new RecursionError(`maximum recursion depth exceeded while decoding a JSON ${what} from a unicode string`);
  };
  let v, token = null, year = null;
  ws();
  for (;;) {
    // a value starts at i
    token = null;
    const c = s[i];
    if (c === '"') { i++; v = scanstring(); }
    else if (c === "{") {
      enter("object");
      i++; ws();
      if (s[i] === "}") { i++; v = {}; }
      else { const k = key(); stack.push({ pairs: [], key: k }); continue; }
    } else if (c === "[") {
      enter("array");
      i++; ws();
      if (s[i] === "]") { i++; v = []; }
      else { stack.push({ list: [] }); continue; }
    } else if (c === "n" && s.startsWith("null", i)) { i += 4; v = null; }
    else if (c === "t" && s.startsWith("true", i)) { i += 4; v = true; }
    else if (c === "f" && s.startsWith("false", i)) { i += 5; v = false; }
    else if ((c === "N" && s.startsWith("NaN", i)) || (c === "I" && s.startsWith("Infinity", i)) || (c === "-" && s.startsWith("-Infinity", i))) {
      const name = c === "N" ? "NaN" : c === "I" ? "Infinity" : "-Infinity";
      v = league_file._no_constant(name);              // parse_constant: it raises (were it to answer, that would be the value)
      i += name.length;
    } else {
      _NUMBER.lastIndex = i;
      const m = i < n ? _NUMBER.exec(s) : null;
      if (m === null) fail("Expecting value", i);
      const is_float = m[1] !== undefined || m[2] !== undefined;
      const digits = m[0].length - (m[0][0] === "-" ? 1 : 0);
      if (!is_float && digits > INT_MAX_DIGITS) {
        throw new ValueError(`Exceeds the limit (${INT_MAX_DIGITS} digits) for integer string conversion: value has ${digits} digits; use sys.set_int_max_str_digits() to increase the limit`);
      }
      v = Number(m[0]);
      token = { text: m[0], is_float };
      i += m[0].length;
    }
    // v is read: put it where it belongs, closing what ends
    for (;;) {
      if (!stack.length) {
        ws();
        if (i !== n) fail("Extra data", i);
        if (year !== null && is_dict(v)) v[_YEAR_TOKEN] = year;
        return v;
      }
      const f = stack[stack.length - 1];
      if (f.list) {
        f.list.push(v);
        ws();
        if (s[i] === "]") { i++; v = f.list; stack.pop(); continue; }
        if (s[i] !== ",") fail("Expecting ',' delimiter", i);
        const comma = i;
        i++; ws();
        if (s[i] === "]") fail("Illegal trailing comma before end of array", comma);
        break;
      }
      if (stack.length === 1 && f.key === "year") year = token;
      f.pairs.push([f.key, v]);
      token = null;
      ws();
      if (s[i] === "}") { i++; v = build(f.pairs); stack.pop(); continue; }
      if (s[i] !== ",") fail("Expecting ',' delimiter", i);
      const comma = i;
      i++; ws();
      if (s[i] === "}") fail("Illegal trailing comma before end of object", comma);
      f.key = key();
      break;
    }
  }
}

const _JSON_ESCAPE = /["\\\x00-\x1f]/g;
const _JSON_ESCAPES = { '"': '\\"', "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f" };
/** A text as json.dumps(ensure_ascii=False) writes it (half a surrogate pair stays as it is; JSON.stringify escapes it). */
const json_string = (t) => '"' + t.replace(_JSON_ESCAPE, (c) => _JSON_ESCAPES[c] ?? "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")) + '"';

/** json.dumps(doc, ensure_ascii=False, separators=(",", ":")): a float is written as Python writes it, but a whole one (3.0) as "3". */
function json_text(v) {
  if (v === null || v === undefined) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") {
    if (Number.isNaN(v)) return "NaN";
    if (!Number.isFinite(v)) return v > 0 ? "Infinity" : "-Infinity";
    if (!Number.isInteger(v)) return pyfloat(v);
    return Math.abs(v) < 1e21 ? String(v) : BigInt(v).toString();
  }
  if (typeof v === "string") return json_string(v);
  if (Array.isArray(v)) {
    let out = "[";
    for (let i = 0; i < v.length; i++) out += (i ? "," : "") + json_text(v[i]);
    return out + "]";
  }
  let out = "{", first = true;
  for (const k of Object.keys(v)) {
    out += (first ? "" : ",") + json_string(k) + ":" + json_text(v[k]);
    first = false;
  }
  return out + "}";
}

const _encoder = new TextEncoder();
const _decoder = new TextDecoder("utf-8", { fatal: true });          // "utf-8-sig": it drops one leading byte order mark

const MAX_LEAGUE_BYTES = 64 * 1024 * 1024;  // *tune* the largest league file read (the built-in export is about 22 MB)
const MAX_TEAMS = 256;  // *tune* FBS teams in a merged league (138 built in)
const MAX_ERRORS = 50;  // errors listed before "And N more."
const MAX_CONFERENCE_GAMES = 11;  // *tune* the most conference games a conference may declare
const POSITIONS = ["QB", "RB", "WR", "TE", "LT", "LG", "C", "RG", "RT", "LEDG", "DT", "REDG", "SAM", "MIKE", "WILL", "CB", "FS", "SS", "K", "P"];
const POS_IN = { ...Object.fromEntries(POSITIONS.map((p) => [p, p])), RB: "HB", HB: "HB", FB: "FB" };   // file position to league position
const STRENGTH_WORDS = ["Elite", "Strong", "Average", "Weak"];
const FORMAT = "cfp-league/1";
const NAME = "Built-in League";
// YEAR = league.FIRST_YEAR: a getter on the namespace below (league may load after this file)
const LEVEL = "FBS";
const _COACH_ROLES = [["head", "head_coach"], ["oc", "offensive_coordinator"], ["dc", "defensive_coordinator"]];
const _FILE_POS = { HB: "RB" };                       // the file's position words; the game calls a running back HB
const _GAME_POS = Object.fromEntries(Object.entries(_FILE_POS).map(([k, v]) => [v, k]));
const _log = { error: (...a) => console.error(...a), exception: (...a) => console.error(...a) };

function conference_id(name) {
  // A conference's id: lowercase, runs of non-alphanumerics as one dash.
  return pystr(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function player_doc(c, attrs) {
  // A league player (league.compact's form) in file form.
  const league = modules.league;
  const out = { id: c["id"], name: c["n"], pos: dget(league_file._FILE_POS, c["pos"], c["pos"]), class: c["cls"], overall: c["o"] };
  if (get(c, "s") !== null) out["stars"] = c["s"];
  out["ratings"] = league.ratings(c, attrs);
  const pot = Object.values(league.potential(c, attrs));
  out["potential"] = {};
  for (let i = 0; i < Math.min(attrs.length, pot.length, c["g"].length); i++) if (c["g"][i] > 0) out["potential"][attrs[i]] = pot[i];
  Object.assign(out, { height: get(c, "ht"), weight: get(c, "wt"), jersey: get(c, "j"), archetype: get(c, "a"), dev: get(c, "dev"),
    abilities: (get(c, "ab") || []).map((a) => {
      const parts = a.split("|"), ab = {};                       // dict(zip(("name", "tier"), ...)): as many of the two as there are parts
      ab["name"] = parts[0];
      if (parts.length > 1) ab["tier"] = parts[1];
      return ab;
    }),
    coachability: get(c, "c"), hometown: get(c, "home"), years: get(c, "yrs") });
  if (truthy(get(c, "tm"))) out["target_share"] = c["tm"];
  if (typeof get(c, "dmv") === "number") {                       // a quarterback's Decision Making, a rating of its own, and where it could reach
    out["decision_making"] = c["dmv"];
    out["decision_making_potential"] = c["dmv"] + (get(c, "dmg") || 0);
  }
  return out;
}

function player_compact(p, attrs) {
  // The inverse of player_doc: a complete file player back to league.compact's form.
  const r = attrs.map((k) => {
    if (!has(p["ratings"], k)) throw new KeyError(k);
    return int(p["ratings"][k]);
  });
  const pot = truthy(get(p, "potential")) ? p["potential"] : {};
  const need = (k) => { if (p[k] === undefined) throw new KeyError(k); return p[k]; };
  const out = { id: need("id"), n: need("name"), pos: dget(league_file._GAME_POS, need("pos"), p["pos"]), cls: need("class"), ht: get(p, "height"),
    wt: get(p, "weight"), j: get(p, "jersey"), a: get(p, "archetype"), dev: get(p, "dev"), r,
    g: attrs.map((k, i) => (has(pot, k) ? Math.max(0, int(pot[k]) - r[i]) : 0)),
    c: get(p, "coachability"), s: get(p, "stars"), o: need("overall"), home: get(p, "hometown"), yrs: get(p, "years") };
  if (truthy(get(p, "abilities"))) {
    out["ab"] = p["abilities"].map((a) => {
      for (const k of ["name", "tier"]) if (a[k] === undefined) throw new KeyError(k);
      return `${pystr(a["name"])}|${pystr(a["tier"])}`;
    });
  }
  if (truthy(get(p, "target_share"))) out["tm"] = p["target_share"];
  if (typeof get(p, "decision_making") === "number") {
    out["dmv"] = Math.max(1, Math.min(99, int(p["decision_making"])));
    out["dmg"] = Math.max(0, Math.min(99, int(get(p, "decision_making_potential") || 0)) - out["dmv"]);
  } else {
    modules.league.own_decision(out, attrs);                     // a file from before: given once, his own from then on
  }
  return out;
}

function team_doc(lgd, slug) {
  // One built-in team in file form; `lgd` is league.from_base()'s league.
  const league = modules.league;
  const meta = league.base_meta(slug), entry = lgd["teams"][slug];
  const attrs = lgd["attrs"];
  const loc_ = get(dget(modules.recruiting.model()["teams"], slug, {}), "location");
  const loc = truthy(loc_) ? loc_ : [null, null];
  const head = entry["coaches"]["head_coach"];
  const coaches = {};
  for (const [k, role] of league_file._COACH_ROLES) coaches[k] = entry["coaches"][role];
  Object.assign(coaches, { offense: head["scheme"]["offensive_philosophy"], defense: head["scheme"]["defensive_philosophy"] });
  const fictional = new Set(league.base_slugs().filter((s) => league.base_meta(s)["fictional"]));
  const out = { slug, name: meta["school_name"], short_name: meta["short_name"], abbreviation: meta["abbreviation"],
    mascot: meta["mascot"], city: meta["city"], state: meta["state"], lat: loc[0], lon: loc[1],
    conference: league_file.conference_id(meta["conference"]), level: meta["subdivision"], colors: meta["colors"],
    stadium: meta["stadium"], home_field: meta["program"]["home_field_advantage"],
    prestige: entry["program"]["prestige"], rivals: meta["rivals"].filter((r) => !fictional.has(r)),
    coaches, formation: entry["formation"] };
  if (get(entry, "style", slug) !== slug) out["style"] = entry["style"];
  out["roster"] = entry["roster"].map((c) => league_file.player_doc(c, attrs));
  return out;
}

function to_league_team(doc, attrs) {
  // A complete team doc as a league entry (what league.from_base holds per team, less the program).
  const out = { roster: doc["roster"].map((p) => league_file.player_compact(p, attrs)),
    coaches: Object.fromEntries(league_file._COACH_ROLES.map(([k, role]) => [role, doc["coaches"][k]])), formation: doc["formation"] };
  if (truthy(get(doc, "style"))) out["style"] = doc["style"];
  return out;
}

function _games(conference) {
  const schedule_gen = modules.schedule_gen;
  const rule = dget(schedule_gen.rules()["conferences"], conference);
  return truthy(rule) ? schedule_gen._league_games(rule, league_file.YEAR) : 0;
}

function export_document() {
  const league = modules.league;
  const lgd = league.from_base(league_file.YEAR + 1);
  const slugs = league.base_slugs().filter((s) => !league.base_meta(s)["fictional"] && has(lgd["teams"], s));
  const names = sorted(new Set(slugs.map((s) => league.base_meta(s)["conference"])));
  return { format: league_file.FORMAT, name: league_file.NAME, year: league_file.YEAR,
    conferences: names.map((n) => ({ id: league_file.conference_id(n), name: n, level: league_file.LEVEL, games: league_file._games(n) })),
    teams: slugs.map((s) => league_file.team_doc(lgd, s)) };
}

const _LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

function dumps(doc) {
  const text = json_text(doc) + "\n";
  if (_LONE_SURROGATE.test(text)) throw new ValueError("'utf-8' codec can't encode a character: surrogates not allowed");   // (Python's UnicodeEncodeError)
  return _encoder.encode(text);
}

const builtin_bytes = cached(() => league_file.dumps(league_file.export_document()));


// ---- Parsing and validation -------------------------------------------------------------------

// (Python's "$" also matches before a newline that ends the text, so "abc\n" passes there: the same here)
const _SLUG = /^[a-z0-9]+(-[a-z0-9]+)*\n?$/;
const _HEX = /^#[0-9A-Fa-f]{6}\n?$/;
const _MB = 1024 * 1024;


/** A league file that cannot be read; `.errors` holds one sentence per problem. */
class LeagueFileError extends Error {
  constructor(errors) {
    super(errors.length ? errors[0] : "The league file cannot be read.");
    this.errors = Array.from(errors);
  }
}


function _no_constant(name) {
  throw new ValueError("numbers must be finite");
}


function parse(blob) {
  // The file's bytes as a document; raises LeagueFileError for size, text, JSON, shape and format.
  if (typeof blob === "string") blob = _encoder.encode(blob);
  if (blob.length > league_file.MAX_LEAGUE_BYTES) {
    throw new LeagueFileError([`The file is ${fmt(blob.length / _MB, 1)} MB; the game reads league files up to ${Math.floor(league_file.MAX_LEAGUE_BYTES / _MB)} MB.`]);
  }
  let text;
  try {
    text = _decoder.decode(blob);
  } catch (e) {
    throw new LeagueFileError(["The file is not UTF-8 text."]);
  }
  let doc;
  try {
    doc = json_loads(text);
  } catch (e) {
    if (e instanceof JSONDecodeError) throw new LeagueFileError([`The file is not valid JSON: line ${e.lineno}, column ${e.colno}: ${e.msg}.`]);
    if (e instanceof ValueError || e instanceof RecursionError) {
      throw new LeagueFileError([`The file is not valid JSON: ${e.message.replace(/\.+$/, "") || "it cannot be read"}.`]);
    }
    throw e;
  }
  if (!is_dict(doc)) throw new LeagueFileError(["The file's top level must be an object."]);
  const fmt_ = get(doc, "format");
  if (fmt_ !== league_file.FORMAT) {
    if (is_str(fmt_)) throw new LeagueFileError([`The file's format is '${fmt_}'; this game reads '${league_file.FORMAT}'.`]);
    throw new LeagueFileError([`The file has no format; this game reads '${league_file.FORMAT}'.`]);
  }
  return doc;
}


const _builtin = cached(() => {
  // What the game has: real (non-stand-in) slugs, short names, conference ids and names, FCS ids.
  const league = modules.league;
  const slugs = league.base_slugs().filter((s) => !league.base_meta(s)["fictional"]);
  const fict = league.base_slugs().filter((s) => league.base_meta(s)["fictional"]).map((s) => league.base_meta(s));
  const confs = {};
  const team_conf = {};
  for (const s of slugs) {
    const name = league.base_meta(s)["conference"];
    confs[league_file.conference_id(name)] = name;
    team_conf[s] = league_file.conference_id(name);
  }
  return { slugs: new Set(slugs), short: Object.fromEntries(slugs.map((s) => [s, league.base_meta(s)["short_name"]])), conf_names: confs,
    team_conf, games: Object.fromEntries(Object.entries(confs).map(([c, n]) => [c, league_file._games(n)])),
    fict_slugs: new Set(fict.map((m) => m["slug"])),
    fict_conf: new Set([...fict.map((m) => league_file.conference_id(m["conference"])), ...fict.map((m) => pystr(m["conference"]).toLowerCase())]) };
});


const _builtin_rosters = cached(() => {
  // slug -> [(player id, name)] of the built-in rosters (what a team that leaves its roster out keeps).
  const lgd = modules.league.from_base(league_file.YEAR + 1);
  const out = new_dict(lgd["teams"]);
  for (const [s, e] of Object.entries(lgd["teams"])) out[s] = e["roster"].map((p) => [p["id"], p["n"]]);
  return out;
});


function _is_int(v, lo, hi) {
  if (typeof v !== "number") return false;
  return v === v && lo <= v && v <= hi && Number.isInteger(v);
}


function _is_num(v, lo, hi) {
  if (typeof v !== "number") return false;
  return v === v && lo <= v && v <= hi;
}


function _say(v) {
  // A value to echo in a sentence: strings only, so nothing like None or NaN reaches the page.
  return is_str(v) ? v : "that value";
}


// ---- the field table: every key the export writes, at team, coach and player level ---------------

const HOME_FIELD_RANGE = [0, 100];          // a team's home_field, as the engine reads home_field_advantage (50 is neutral)
const STADIUM_CAPACITY_MAX = 200000;        // *tune* the largest stadium a file may give
const SURFACES = ["grass", "turf"];
const YEARS_RANGE = [0, 6];                 // *tune* a player's years in college football (the export runs 0 to 4)
const TARGET_SHARE_MIN = 0.3;               // *tune* a receiver's smallest real-usage target weight (the floor the real-usage tuning used)
const JERSEY_RANGE = [0, 99];
const MAX_HOMETOWN = 40;                    // *tune* the longest hometown text (the export writes a state code)
const UNIT_PLAYERS = 11;                    // the players on the field for the offense and for the defense
const FORMATION_ROLES = { offense: ["QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT"],
  defense: ["LEDG", "DT", "REDG", "LB", "SAM", "MIKE", "WILL", "CB", "FS", "SS"],
  special_teams: ["K", "P", "KR", "PR"] };
const ABILITY_TIERS = ["Locked", "Bronze", "Silver", "Gold", "Platinum"];   // Locked: named but not yet earned
const _ROLE_WORD = { head: "head coach", oc: "offensive coordinator", dc: "defensive coordinator" };
const _COACH_RATINGS = {
  head: ["overall", "offense", "defense", "recruiting", "player_development", "game_management", "motivation", "discipline"],
  oc: ["overall", "play_calling", "player_development", "qb_development", "ol_development", "recruiting"],
  dc: ["overall", "play_calling", "player_development", "pass_rush_development", "secondary_development", "recruiting"] };
const _COACH_TENDENCIES = {
  head: ["aggressiveness", "fourth_down_go_rate", "two_point_tendency", "clock_management"],
  oc: ["aggressiveness", "deep_shot_rate", "pass_rate", "play_action_rate", "tempo"],
  dc: ["aggressiveness", "blitz_rate", "man_coverage_rate", "press_rate"] };
const _COACH_SCHEMES = { head: [["offensive_philosophy", "offense"], ["defensive_philosophy", "defense"]],
  oc: [["offensive_scheme", "offense"]], dc: [["defensive_scheme", "defense"]] };
const _COACH_TEXT = ["coach_id", "team_slug", "previous_job", "alma_mater", "co_coordinator", "notes"];
const _COACH_FLAGS = ["is_interim", "ratings_generated", "vacant", "plays_called_by_hc"];


const _words = cached(() => {
  // The game's own words a file's fields must use (small; read once).
  const season = modules.season;
  const game_config = cfg;
  return { offense: Object.keys(sim_coaches.OFFENSE_SCHEMES), defense: Object.keys(sim_coaches.DEFENSE_SCHEMES),
    dev: Array.from(season.DEV_TRAITS), coachability: recruits.COACHABILITY.map(([n, _a, _b]) => n),
    // (a play style by either of its names: the game's own rosters carry the one the game shows)
    archetype: new Set([...Object.keys(rv.ARCHETYPES), ...Object.values(rv.ARCHETYPES)]), ability: new Set(rv.TRAITS.keys()),
    target_max: Number(game_config.TARGET_MULT_MAX) };
});


function _or(words) {
  // Words as a list in a sentence: "A, B or C".
  words = Array.from(words);
  return words.length === 1 ? words[0] : words.slice(0, -1).join(", ") + " or " + words[words.length - 1];
}


function _num_text(x) {
  // f"{x:g}": six significant digits, the zeros at the end dropped
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf";
  const [mant, e] = x.toExponential(5).split("e");
  const exp = Number(e);
  const trim = (t) => (t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, "") : t);
  if (exp < -4 || exp >= 6) return `${trim(mant)}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  return trim(Number(`${mant}e${e}`).toFixed(Math.max(0, 5 - exp)));
}


function _check_team_fields(label, t, b, add) {
  // A team's identity and setup fields beyond the core ones: home field, stadium, style, formation and coaches.
  const hf = get(t, "home_field");
  if (hf !== null && !league_file._is_num(hf, ...league_file.HOME_FIELD_RANGE)) {
    add(`${label}: home field must be a number from ${league_file.HOME_FIELD_RANGE[0]} to ${league_file.HOME_FIELD_RANGE[1]}.`);
  }
  const sd = get(t, "stadium");
  if (sd !== null) {
    if (!is_dict(sd)) add(`${label}: the stadium must list its name, capacity and surface.`);
    else {
      if (get(sd, "name") !== null && (!is_str(sd["name"]) || !strip(sd["name"]))) add(`${label}: the stadium's name must be text.`);
      if (get(sd, "capacity") !== null && !league_file._is_int(sd["capacity"], 0, league_file.STADIUM_CAPACITY_MAX)) {
        add(`${label}: the stadium's capacity must be a whole number from 0 to ${league_file.STADIUM_CAPACITY_MAX}.`);
      }
      if (get(sd, "surface") !== null && !league_file.SURFACES.includes(sd["surface"])) {
        add(`${label}: the stadium's surface must be ${league_file._or(league_file.SURFACES)}.`);
      }
    }
  }
  const style = get(t, "style");
  if (style !== null) {
    if (!is_str(style)) add(`${label}: style must be a built-in team's slug.`);
    else if (!b["slugs"].has(style)) add(`${label}: style '${style}' is not a team in the game; use a built-in team's slug.`);
  }
  const fm = get(t, "formation");
  if (fm !== null) league_file._check_formation(label, fm, add);
  const colors = get(t, "colors");
  if (is_dict(colors)) {
    for (const k of ["primary", "secondary", "accent"]) {
      const cv = get(colors, k);
      if (is_dict(cv) && get(cv, "name") !== null && !is_str(cv["name"])) add(`${label}: the ${k} color's name must be text.`);
    }
  }
  const coaches = get(t, "coaches");
  if (is_dict(coaches)) {
    const w = league_file._words();
    for (const side of ["offense", "defense"]) {
      const v = get(coaches, side);
      if (v === null) continue;
      if (!is_str(v)) add(`${label}: ${side} must be a scheme word such as ${w[side][0]}.`);
      else if (!w[side].includes(v)) add(`${label}: ${side} '${v}' is not a scheme in the game; use ${league_file._or(w[side])}.`);
    }
    for (const key of ["head", "oc", "dc"]) {
      if (is_dict(get(coaches, key))) league_file._check_coach(label, key, coaches[key], add);
    }
  }
}


function _check_formation(label, fm, add) {
  if (!is_dict(fm) || !is_dict(get(fm, "offense")) || !is_dict(get(fm, "defense"))
      || (get(fm, "special_teams") !== null && !is_dict(fm["special_teams"]))) {
    add(`${label}: the formation must list the offense, defense and special teams roles and their counts.`);
    return;
  }
  for (const [unit, roles] of Object.entries(league_file.FORMATION_ROLES)) {
    const counts = truthy(get(fm, unit)) ? fm[unit] : {};
    let ok = true;
    for (const [role, n] of Object.entries(counts)) {
      if (!roles.includes(role)) {
        add(`${label}: the formation's ${unit.replaceAll("_", " ")} role '${role}' is not a role in the game; use ${league_file._or(roles)}.`);
        ok = false;
      } else if (!league_file._is_int(n, 0, league_file.UNIT_PLAYERS)) {
        add(`${label}: the formation's ${unit.replaceAll("_", " ")} ${role} count must be a whole number from 0 to ${league_file.UNIT_PLAYERS}.`);
        ok = false;
      }
    }
    if (ok && unit !== "special_teams") {
      let total = 0;
      for (const n of Object.values(counts)) total += int(n);
      if (total !== league_file.UNIT_PLAYERS) add(`${label}: the formation's ${unit} must have ${league_file.UNIT_PLAYERS} players; it has ${total}.`);
    }
  }
}


function _check_coach(label, key, c, add) {
  // One coach as the file gives him (all of him, or the fields a built-in coach changes).
  const w = league_file._words(), role = league_file._ROLE_WORD[key];
  const who = `${label}: the ${role}'s`;
  if (get(c, "name") !== null && (!is_str(c["name"]) || !strip(c["name"]))) add(`${who} name must be text.`);
  if (get(c, "rating") !== null && !league_file._is_int(c["rating"], 1, 99)) add(`${who} rating must be a whole number from 1 to 99.`);
  for (const [field, keys, lo, hi, word, whole] of [["ratings", league_file._COACH_RATINGS[key], 1, 99, "rating", true],
    ["tendencies", league_file._COACH_TENDENCIES[key], 0, 100, "tendency", false]]) {
    const vals = get(c, field);
    if (vals === null) continue;
    if (!is_dict(vals)) {
      add(`${who} ${field} must list ${field} and their values.`);
      continue;
    }
    for (const [k, v] of Object.entries(vals)) {
      if (!keys.includes(k)) add(`${who} ${word} '${k}' is not a ${role} ${word}; use ${league_file._or(keys)}.`);
      else if (!(whole ? league_file._is_int(v, lo, hi) : league_file._is_num(v, lo, hi))) {
        add(`${who} ${word} '${k}' must be a ${whole ? "whole number" : "number"} from ${lo} to ${hi}.`);
      }
    }
  }
  const sc = get(c, "scheme");
  if (sc !== null) {
    if (!is_dict(sc)) add(`${who} scheme must list his ${league_file._or(league_file._COACH_SCHEMES[key].map(([k, _]) => k.replaceAll("_", " ")))}.`);
    else {
      for (const [k, side] of league_file._COACH_SCHEMES[key]) {
        const v = get(sc, k);
        if (v === null) continue;
        if (!is_str(v)) add(`${who} ${k.replaceAll("_", " ")} must be a scheme word such as ${w[side][0]}.`);
        else if (!w[side].includes(v)) add(`${who} ${k.replaceAll("_", " ")} '${v}' is not a scheme in the game; use ${league_file._or(w[side])}.`);
      }
    }
  }
  if (get(c, "since") !== null && !league_file._is_int(c["since"], 1900, league_file.YEAR)) add(`${who} 'since' must be a year such as ${league_file.YEAR - 2}.`);
  for (const k of league_file._COACH_FLAGS) {
    if (get(c, k) !== null && typeof c[k] !== "boolean") add(`${who} '${k}' must be true or false.`);
  }
  for (const k of league_file._COACH_TEXT) {
    if (get(c, k) !== null && !is_str(c[k])) add(`${who} '${k}' must be text.`);
  }
  const want = Object.fromEntries(league_file._COACH_ROLES)[key];
  if (get(c, "role") !== null && c["role"] !== want) add(`${who} 'role' must be ${want} or left out.`);
}


function _check_player_fields(who, p, add) {
  // A player's fields beyond name, position, class and the numbers checked with them.
  const w = league_file._words();
  const j = get(p, "jersey");
  if (j !== null) {
    const n = is_str(j) && /^[0-9]{1,2}$/.test(j) ? Number(j) : j;
    if (!league_file._is_int(n, ...league_file.JERSEY_RANGE)) {
      add(`${who}: jersey must be a whole number from ${league_file.JERSEY_RANGE[0]} to ${league_file.JERSEY_RANGE[1]}.`);
    }
  }
  const a = get(p, "archetype");
  if (a !== null && (!is_str(a) || !w["archetype"].has(a))) add(`${who}: archetype '${league_file._say(a)}' is not an archetype in the game.`);
  for (const field of ["dev", "coachability"]) {
    const v = get(p, field);
    if (v !== null && !w[field].includes(v)) add(`${who}: ${field} '${league_file._say(v)}' must be ${league_file._or(w[field])}.`);
  }
  const ab = get(p, "abilities");
  if (ab !== null) {
    if (!is_list(ab)) add(`${who}: abilities must be a list of names and tiers.`);
    else {
      ab.forEach((x, i0) => {
        const i = i0 + 1;
        if (!is_dict(x) || !is_str(get(x, "name")) || !is_str(get(x, "tier"))) add(`${who}: ability ${i} needs a name and a tier.`);
        else if (!w["ability"].has(x["name"])) add(`${who}: ability '${x["name"]}' is not an ability in the game.`);
        else if (!league_file.ABILITY_TIERS.includes(x["tier"])) add(`${who}: ability tier '${x["tier"]}' must be ${league_file._or(league_file.ABILITY_TIERS)}.`);
      });
    }
  }
  const h = get(p, "hometown");
  if (h !== null && (!is_str(h) || pylen(h) > league_file.MAX_HOMETOWN)) add(`${who}: hometown must be text of at most ${league_file.MAX_HOMETOWN} characters.`);
  const y = get(p, "years");
  if (y !== null && !league_file._is_int(y, ...league_file.YEARS_RANGE)) {
    add(`${who}: years must be a whole number from ${league_file.YEARS_RANGE[0]} to ${league_file.YEARS_RANGE[1]}.`);
  }
  const ts = get(p, "target_share");
  if (ts !== null && !league_file._is_num(ts, league_file.TARGET_SHARE_MIN, w["target_max"])) {
    add(`${who}: target share must be a number from ${league_file._num_text(league_file.TARGET_SHARE_MIN)} to ${league_file._num_text(w["target_max"])}.`);
  }
}


function validate(doc) {
  // Every problem in a parsed league file, as sentences (capped at MAX_ERRORS, then "And N more.").
  return league_file._capped(league_file.problems(doc));
}


function _capped(errs) {
  if (errs.length > league_file.MAX_ERRORS) return errs.slice(0, league_file.MAX_ERRORS).concat([`And ${errs.length - league_file.MAX_ERRORS} more.`]);
  return errs;
}


function problems(doc) {
  // Every problem in a parsed league file, as sentences, uncapped (validate caps them).
  const league = modules.league, offseason = modules.offseason, recruiting = modules.recruiting;
  const YEAR = league_file.YEAR, LEVEL = league_file.LEVEL;
  const errs = [];
  const add = (e) => { errs.push(e); };
  const b = league_file._builtin();
  if (!is_dict(doc)) return ["The file's top level must be an object."];

  const year = get(doc, "year");
  if (year !== null && year !== YEAR) {
    // (a number is one kind here: whether the file wrote a whole number is what parse kept of its text, when it read the file)
    const token = doc[_YEAR_TOKEN];
    const whole = typeof year === "number" && (token && Number(token.text) === year ? !token.is_float : Number.isInteger(year));
    if (whole) {
      const text = token && Number(token.text) === year ? (token.text === "-0" ? "0" : token.text) : String(year);
      add(`The file's year is ${text}; careers start in ${YEAR}, so use ${YEAR} or leave it out.`);
    } else add(`The file's year is not a whole number; careers start in ${YEAR}, so use ${YEAR} or leave it out.`);
  }

  // -- remove ---------------------------------------------------------------------------------
  const raw_remove = get(doc, "remove");
  let remove = [];
  if (raw_remove !== null) {
    if (!is_list(raw_remove)) add("The file's remove list must be a list of team slugs.");
    else remove = raw_remove;
  }
  const removed = new Set();
  remove.forEach((slug, i0) => {
    const i = i0 + 1;
    if (!is_str(slug)) add(`Team ${i}: a remove entry must be a team slug.`);
    else if (b["fict_slugs"].has(slug)) add(`Team ${i}: that slug is reserved for the game's FCS opponents; pick another.`);
    else if (!b["slugs"].has(slug)) add(`Team ${i}: the file removes '${slug}', which is not a team in the game.`);
    else removed.add(slug);
  });

  // -- conferences ----------------------------------------------------------------------------
  const raw_confs = get(doc, "conferences");
  let conferences = [];
  if (raw_confs !== null) {
    if (is_list(raw_confs)) conferences = raw_confs;
    else add("The file's conferences must be a list.");
  }
  const file_confs = new Map();     // id -> {"name", "games"}
  for (let i = 1; i <= conferences.length; i++) {
    const c = conferences[i - 1];
    if (!is_dict(c)) {
      add(`Conference ${i}: it must be an object.`);
      continue;
    }
    const cid = get(c, "id"), cname = get(c, "name");
    const label = is_str(cname) && strip(cname) ? cname : `Conference ${i}`;
    if (!is_str(cid) || !is_str(cname) || !strip(cname)) {
      add(`Conference ${i}: it needs an id and a name.`);
      continue;
    }
    if (b["fict_conf"].has(cid) || b["fict_conf"].has(cname.toLowerCase()) || b["fict_conf"].has(league_file.conference_id(cname))) {
      add(`Conference ${i}: that conference is reserved for the game's FCS opponents.`);
      continue;
    }
    if (!league_file._SLUG.test(cid)) {
      add(`${label}: the conference id '${cid}' must be lowercase letters, numbers and single dashes.`);
      continue;
    }
    if (file_confs.has(cid)) {
      add(`${label}: the conference id '${cid}' is used by two conferences; give each its own id.`);
      continue;
    }
    // every conference's name is its own: a new one's name is its engine name, and the page shows a renamed
    // built-in one by its new name, so no name may be another conference's name in the game or in the file
    const key = casefold(strip(cname));
    let bid = null;
    for (const [k, n] of Object.entries(b["conf_names"])) if (k !== cid && casefold(n) === key) { bid = k; break; }
    if (bid !== null) {
      if (!has(b["conf_names"], cid)) {
        add(`Conference ${i} (${cname}): that name belongs to a conference in the game; give the new conference `
          + `its own name, or use the id '${bid}' to change that one.`);
      } else add(`Conference ${i} (${cname}): that name belongs to another conference in the game; give it its own name.`);
      continue;
    }
    let twin = null;
    for (const fc of file_confs.values()) if (casefold(strip(fc["name"])) === key) { twin = fc["name"]; break; }
    if (twin !== null) {
      add(`Conference ${i} (${cname}): another conference in the file is named ${twin}; give each its own name.`);
      continue;
    }
    const lvl = get(c, "level");
    if (lvl !== null && lvl !== LEVEL) add(`${label}: level '${league_file._say(lvl)}' is not supported; FCS games use the game's own opponents.`);
    let games = get(c, "games");
    if (games === null) games = dget(b["games"], cid, 0);                   // a built-in conference keeps its own games; a new one plays none
    if (!league_file._is_int(games, 0, league_file.MAX_CONFERENCE_GAMES)) {
      add(`${label}: games must be a whole number from 0 to ${league_file.MAX_CONFERENCE_GAMES}.`);
      games = 0;
    }
    file_confs.set(cid, { name: cname, games: int(games) });
  }

  const resolve = (ref) => {
    // A team's `conference` value as a conference id, or None when nothing matches.
    if (!is_str(ref)) return null;
    if (file_confs.has(ref)) return ref;
    if (has(b["conf_names"], ref)) return ref;
    for (const [cid, name] of Object.entries(b["conf_names"])) if (ref === name) return cid;
    return null;
  };

  // -- teams ----------------------------------------------------------------------------------
  const raw_teams = get(doc, "teams");
  let teams = [];
  if (raw_teams !== null) {
    if (is_list(raw_teams)) teams = raw_teams;
    else add("The file's teams must be a list.");
  }
  const seen_slugs = new Map();
  const file_slugs = new Set();
  const replaced_roster = new Set();      // built-in slugs whose roster the file replaces
  const player_ids = new Map();           // file player id -> team label (for the whole merged league)
  const merged_conf = new Map();
  for (const [s, c] of Object.entries(b["team_conf"])) if (!removed.has(s)) merged_conf.set(s, c);
  const checks = [];                      // (label, doc) for the depth-chart pass after rosters are known
  const rosters = new Map();              // slug -> lowercase names on the roster as it will be

  for (let i = 1; i <= teams.length; i++) {
    const t = teams[i - 1];
    if (!is_dict(t)) {
      add(`Team ${i}: it must be an object.`);
      continue;
    }
    const slug = get(t, "slug");
    if (!is_str(slug)) {
      add(`Team ${i}: it needs a slug.`);
      continue;
    }
    if (b["fict_slugs"].has(slug)) {
      add(`Team ${i}: that slug is reserved for the game's FCS opponents; pick another.`);
      continue;
    }
    const is_builtin = b["slugs"].has(slug);
    const sn = get(t, "short_name"), nm = get(t, "name");
    const label = is_str(sn) && strip(sn) ? sn : is_str(nm) && strip(nm) ? nm
      : dget(b["short"], slug) || `Team ${i}`;
    if (!league_file._SLUG.test(slug)) {
      add(`${label}: the slug '${slug}' must be lowercase letters, numbers and single dashes.`);
      continue;
    }
    if (seen_slugs.has(slug)) {
      add(`${label}: the slug '${slug}' is used by two teams; give each its own slug.`);
      continue;
    }
    seen_slugs.set(slug, i);
    file_slugs.add(slug);
    if (removed.has(slug)) add(`${label}: the file removes it and also lists it; do one or the other.`);
    if (!is_builtin) {
      if (!is_str(nm) || !strip(nm)) add(`${label}: a new team needs a name.`);
      if (get(t, "conference") === null) add(`${label}: a new team needs a conference.`);
    }
    for (const key of ["name", "short_name", "abbreviation", "mascot", "city"]) {
      if (get(t, key) !== null && (!is_str(t[key]) || !strip(t[key]))) add(`${label}: ${key.replaceAll("_", " ")} must be text.`);
    }
    const lvl = get(t, "level");
    if (lvl !== null && lvl !== LEVEL) add(`${label}: level '${league_file._say(lvl)}' is not supported; FCS games use the game's own opponents.`);

    const conf = get(t, "conference");
    if (conf !== null) {
      let cid = resolve(conf);
      if (is_str(conf) && (b["fict_conf"].has(conf.toLowerCase()) || b["fict_conf"].has(league_file.conference_id(conf)))) {
        add(`${label}: that conference is reserved for the game's FCS opponents.`);
        cid = null;
      } else if (cid === null) add(`${label}: conference '${league_file._say(conf)}' is not in the file or the game.`);
      merged_conf.set(slug, cid);
    } else if (!merged_conf.has(slug)) merged_conf.set(slug, null);
    if (removed.has(slug)) merged_conf.delete(slug);

    const st = get(t, "strength");
    if (st !== null && !(is_str(st) ? league_file.STRENGTH_WORDS.includes(st) : league_file._is_num(st, 1, 100))) {
      add(`${label}: strength must be Elite, Strong, Average or Weak, or a number from 1 to 100.`);
    } else if (st !== null && is_builtin && (get(t, "roster") === null || (
      is_list(t["roster"]) && pyeq(t["roster"], get(dget(league_file._builtin_docs(), slug) || {}, "roster"))))) {
      // the fill aims a roster the file gives at the strength; a kept real roster is never nudged
      add(`${label}: strength applies only to a roster the file gives; add a roster or remove strength.`);
    }
    const pr = get(t, "prestige");
    if (pr !== null && !league_file._is_num(pr, 0, 100)) add(`${label}: prestige must be a number from 0 to 100.`);
    const colors = get(t, "colors");
    if (colors !== null) {
      if (!is_dict(colors)) add(`${label}: colors must list a primary, a secondary and an accent color.`);
      else {
        for (const k of ["primary", "secondary", "accent"]) {
          const cv = get(colors, k);
          if (cv === null) continue;
          const hx = is_dict(cv) ? get(cv, "hex") : null;
          if (!is_str(hx) || !league_file._HEX.test(hx)) add(`${label}: the ${k} color needs a hex value like #0B6E4F.`);
        }
      }
    }
    const lat = get(t, "lat"), lon = get(t, "lon");
    if (lat !== null && !league_file._is_num(lat, -90, 90)) add(`${label}: lat must be a number from -90 to 90.`);
    if (lon !== null && !league_file._is_num(lon, -180, 180)) add(`${label}: lon must be a number from -180 to 180.`);
    const state = get(t, "state");
    if (state !== null) {
      if (!(is_str(state) && pylen(state) === 2 && has(recruiting.model()["generation"]["towns"], state))) {
        add(`${label}: state must be a two-letter code the game knows, such as OR.`);
      }
    } else if (!is_builtin) {
      // the state is optional; location defaults are generated later
    }
    const coaches = get(t, "coaches");
    if (coaches !== null) {
      if (!is_dict(coaches)) add(`${label}: coaches must list a head coach, an offensive coordinator and a defensive coordinator.`);
      else {
        for (const k of ["head", "oc", "dc"]) {
          if (get(coaches, k) !== null && !is_dict(coaches[k])) add(`${label}: the ${league_file._ROLE_WORD[k]} must be an object with a name.`);
        }
      }
    }
    league_file._check_team_fields(label, t, b, add);
    checks.push([label, t, slug, is_builtin]);

    // -- roster -----------------------------------------------------------------------------
    const roster = get(t, "roster");
    if (roster === null) continue;
    if (!is_list(roster)) {
      add(`${label}: the roster must be a list of players.`);
      continue;
    }
    if (is_builtin) replaced_roster.add(slug);
    // (the game's own roster for the team is taken as it is: a few carry a real player or two past the limit, and the
    // first offseason's cuts bring every roster to it)
    const own_roster = is_builtin && pyeq(roster, get(dget(league_file._builtin_docs(), slug) || {}, "roster"));
    if (roster.length > offseason.ROSTER_LIMIT && !own_roster) add(`${label}: the roster has ${roster.length} players; the limit is ${offseason.ROSTER_LIMIT}.`);
    const names = new Map();
    const known = new Set();
    const attrs = new Set(game_scale.keys());
    for (let n = 1; n <= roster.length; n++) {
      const p = roster[n - 1];
      if (!is_dict(p)) {
        add(`${label}, player ${n}: it must be an object.`);
        continue;
      }
      const pname = get(p, "name");
      const who = is_str(pname) && strip(pname) ? `${label}, player ${n} (${pname})` : `${label}, player ${n}`;
      if (!is_str(pname) || !strip(pname)) add(`${who}: the name is required.`);
      else {
        const key = strip(pname).toLowerCase();
        known.add(key);
        if (names.has(key)) add(`${label}: players ${names.get(key)[0]} and ${n} are both named ${names.get(key)[1]}; give each a different name.`);
        else names.set(key, [n, strip(pname)]);
      }
      const pos = get(p, "pos");
      if (pos === null) add(`${who}: the position is required.`);
      else if (!is_str(pos) || !has(league_file.POS_IN, pos)) {
        add(`${who}: position '${league_file._say(pos)}' is not a position; use ${league_file._or(league_file.POSITIONS.concat(["FB"]))}.`);
      }
      const cls = get(p, "class");
      if (cls === null) add(`${who}: the class is required.`);
      else if (!is_str(cls) || !Array.from(league.CLASSES).includes(cls)) add(`${who}: class '${league_file._say(cls)}' is not a class; use ${league_file._or(league.CLASSES)}.`);
      if (get(p, "overall") !== null && !league_file._is_int(p["overall"], 1, 99)) add(`${who}: overall must be a whole number from 1 to 99.`);
      for (const field of ["ratings", "potential"]) {
        const vals = get(p, field);
        if (vals === null) continue;
        if (!is_dict(vals)) {
          add(`${who}: ${field} must list skills and their values.`);
          continue;
        }
        const word = field === "ratings" ? "rating" : "potential";
        for (const [k, v] of Object.entries(vals)) {
          if (!attrs.has(k)) add(`${who}: ${word} '${k}' is not a skill in the game.`);
          else if (typeof v !== "number" || v !== v) add(`${who}: ${word} '${k}' is not a number.`);
          else if (!league_file._is_int(v, 1, 99)) add(`${who}: ${word} '${k}' must be a whole number from 1 to 99.`);
        }
      }
      if (get(p, "stars") !== null && !league_file._is_int(p["stars"], 1, 5)) add(`${who}: stars must be a whole number from 1 to 5.`);
      if (get(p, "height") !== null && !league_file._is_num(p["height"], 60, 90)) add(`${who}: height must be from 60 to 90 inches.`);
      if (get(p, "weight") !== null && !league_file._is_num(p["weight"], 140, 420)) add(`${who}: weight must be from 140 to 420 pounds.`);
      league_file._check_player_fields(who, p, add);
      const pid = get(p, "id");
      if (pid !== null) {
        if (!is_str(pid) || !league_file._SLUG.test(pid)) add(`${who}: id must be lowercase letters, numbers and single dashes.`);
        else if (player_ids.has(pid)) add(`${who}: id '${pid}' is already used by another player.`);
        else player_ids.set(pid, slug);
      }
    }
    rosters.set(slug, known);
  }

  // -- depth charts, rivals, ids against the kept built-in rosters -----------------------------
  const kept_ids = new Map();
  if (player_ids.size || teams.some((t) => is_dict(t) && truthy(get(t, "depth_chart")))) {
    for (const [s, plist] of Object.entries(league_file._builtin_rosters())) {
      if (removed.has(s) || replaced_roster.has(s)) continue;
      for (const [pid, _] of plist) kept_ids.set(pid, s);
    }
  }
  for (const [pid, slug] of player_ids) {
    if (kept_ids.has(pid)) add(`${league_file.checks_label(checks, slug)}: player id '${pid}' is already used by another player in the league.`);
  }

  for (const [label, t, slug, is_builtin] of checks) {
    const dc = get(t, "depth_chart");
    if (dc !== null) {
      if (!is_dict(dc)) add(`${label}: the depth chart must list player names for each position.`);
      else {
        let on;
        if (rosters.has(slug)) on = rosters.get(slug);
        else if (is_builtin && !removed.has(slug)) on = new Set(dget(league_file._builtin_rosters(), slug, []).map(([_, n]) => strip(n).toLowerCase()));
        else on = new Set();
        for (const [k, lst] of Object.entries(dc)) {
          if (!league_file.POSITIONS.includes(k) && !["HB", "FB"].includes(k)) add(`${label}: the depth chart's '${k}' is not a position.`);
          else if (!is_list(lst)) add(`${label}: the depth chart's ${k} list must be a list of names.`);
          else {
            for (const nm of lst) {
              if (!is_str(nm) || !on.has(strip(nm).toLowerCase())) add(`${label}: the depth chart's ${k} list names ${league_file._say(nm)}, who is not on the roster.`);
            }
          }
        }
      }
    }
    const rvl = get(t, "rivals");
    if (rvl !== null) {
      if (!is_list(rvl)) add(`${label}: rivals must be a list of team slugs.`);
      else {
        for (const r of rvl) {
          const ok = is_str(r) && !removed.has(r) && (b["slugs"].has(r) || file_slugs.has(r));
          if (!ok) {
            if (is_str(r) && !b["fict_slugs"].has(r)) add(`${label}: rival '${r}' is not a team in the file or the game.`);
            else add(`${label}: a rival is not a team in the file or the game.`);
          }
        }
      }
    }
  }

  // -- merged league: size and conference widths ---------------------------------------------
  const fbs = new Set([...merged_conf.keys(), ...file_slugs]);
  for (const s of removed) if (!file_slugs.has(s)) fbs.delete(s);
  if (fbs.size > league_file.MAX_TEAMS) add(`The merged league has ${fbs.size} FBS teams; the limit is ${league_file.MAX_TEAMS}.`);
  const members = new Map();
  for (const s of fbs) {
    const c = merged_conf.has(s) ? merged_conf.get(s) : null;
    if (c !== null) members.set(c, (members.get(c) || 0) + 1);
  }
  for (const [cid, n] of sorted(members.entries())) {
    let games, name;
    if (file_confs.has(cid)) [games, name] = [file_confs.get(cid)["games"], file_confs.get(cid)["name"]];
    else [games, name] = [dget(b["games"], cid, 0), dget(b["conf_names"], cid, cid)];
    if (games > 0 && n - 1 < games) {
      add(`${name}: ${n} team${n !== 1 ? "s" : ""} can't play ${games} conference games each; it needs at least ${games + 1}.`);
    }
  }

  return errs;
}


function checks_label(checks, slug) {
  for (const c of checks) if (c[2] === slug) return c[0];
  return slug;
}


// ---- Merge ------------------------------------------------------------------------------------

const DEFAULT_NAME = "Imported League";


const _builtin_docs = cached(() => {
  // slug -> the built-in team's file form (what an import is compared with).
  const lgd = modules.league.from_base(league_file.YEAR + 1);
  const out = {};
  for (const s of league_file._builtin()["slugs"]) if (has(lgd["teams"], s)) out[s] = league_file.team_doc(lgd, s);
  return out;
});


function _deep_merge(base, over) {
  const out = deepcopy(base);
  for (const [k, v] of Object.entries(over)) {
    out[k] = is_dict(v) && is_dict(dget(out, k)) ? league_file._deep_merge(out[k], v) : deepcopy(v);
  }
  return out;
}


function _merge_coaches(base, given) {
  // A built-in team's staff with the file's coaches over it, role by role: a given role edits the
  // built-in coach (deep-merged), a role left out stays as built in, the offense/defense words replace.
  const out = deepcopy(base);
  for (const [k, v] of Object.entries(given)) {
    if (v === null) continue;
    out[k] = is_dict(v) && is_dict(dget(out, k)) ? league_file._deep_merge(out[k], v) : deepcopy(v);
  }
  return out;
}


function merge(doc) {
  // A validated file merged into the built-in league by slug. An imported team equal to its built-in
  // export is not "changed", so a round-tripped export is the built-in league (`builtin` is true).
  const LEVEL = league_file.LEVEL;
  const b = league_file._builtin(), base = league_file._builtin_docs();
  const remove = new Set(walk(get(doc, "remove")).filter((s) => is_str(s) && has(base, s)));
  const file_confs = new Map();
  for (const c of walk(get(doc, "conferences"))) if (is_dict(c) && is_str(get(c, "id"))) file_confs.set(c["id"], c);

  const resolve = (ref) => {
    if (!is_str(ref)) return ref;          // (Python looks any value up; only text can be an id or a name)
    if (file_confs.has(ref) || has(b["conf_names"], ref)) return ref;
    for (const [cid, name] of Object.entries(b["conf_names"])) if (ref === name) return cid;
    return ref;
  };

  const teams_ = new Map();
  for (const [s, d] of Object.entries(base)) if (!remove.has(s)) teams_.set(s, deepcopy(d));
  let added = [], changed = [];
  for (const t of walk(get(doc, "teams"))) {
    if (!is_dict(t) || !is_str(get(t, "slug"))) continue;
    const slug = t["slug"];
    const given = new_dict(t);
    for (const [k, v] of Object.entries(t)) if (v !== null) given[k] = v;
    if (get(given, "conference") !== null) given["conference"] = resolve(given["conference"]);
    let merged;
    if (has(base, slug)) {
      if (is_dict(get(given, "coaches"))) given["coaches"] = league_file._merge_coaches(get(base[slug], "coaches") || {}, given["coaches"]);
      merged = new_dict(given);
      Object.assign(merged, deepcopy(base[slug]));
      for (const k of Object.keys(given)) merged[k] = given[k];
      if (!pyeq(merged, base[slug])) changed.push(slug);
    } else {
      merged = given;
      added.push(slug);
    }
    teams_.set(slug, merged);
  }
  const teams = dict_of(teams_);
  const removed = sorted(remove);

  const members = new Map();
  for (const slug of sorted(Object.keys(teams))) {
    const cid = get(teams[slug], "conference");
    if (!members.has(cid)) members.set(cid, []);
    members.get(cid).push(slug);
  }
  const confs_ = new Map();
  for (const [cid, mem] of members) {
    const fc = file_confs.has(cid) ? file_confs.get(cid) : null;
    let name, games, level;
    if (fc !== null) {
      games = get(fc, "games");
      if (games === null) games = dget(b["games"], cid, 0);               // a built-in conference given without games keeps its own
      [name, level] = [fc["name"], get(fc, "level") || LEVEL];
    } else [name, games, level] = [dget(b["conf_names"], cid, cid), dget(b["games"], cid, 0), LEVEL];
    confs_.set(cid, { id: cid, name, level, games: int(games), members: mem });
  }
  const confs = dict_of(confs_);
  const base_members = {};
  for (const slug of sorted(Object.keys(base))) {
    const cid = b["team_conf"][slug];
    if (!has(base_members, cid)) base_members[cid] = [];
    base_members[cid].push(slug);
  }
  const conf_ids = Object.keys(confs);
  const structural = Boolean(added.length || removed.length) || conf_ids.length !== Object.keys(base_members).length
    || conf_ids.some((c) => !has(base_members, c)) || conf_ids.some(
    (c) => !same_list(confs[c]["members"], base_members[c]) || confs[c]["games"] !== dget(b["games"], c, 0));
  const conf_changed = sorted(conf_ids.filter((c) => has(b["conf_names"], c)
    && (confs[c]["name"] !== b["conf_names"][c] || confs[c]["level"] !== LEVEL)));
  [added, changed] = [sorted(added), sorted(changed)];
  const name = is_str(get(doc, "name")) && strip(doc["name"]) ? doc["name"] : league_file.DEFAULT_NAME;
  return { teams, added, changed, removed, conferences: confs,
    structural, conferences_changed: conf_changed,
    builtin: !(added.length || changed.length || removed.length || structural || conf_changed.length), name };
}


// ---- Schedules ----------------------------------------------------------------------------------

const NEW_CONFERENCE_POWER_ROAD = [1, 2];   // *tune* a new conference team's Power pay games a year (fewest, most)
const NEW_CONFERENCE_FCS_MAX = 1;           // *tune* a new conference team's FCS games a year, at most


function _base_members() {
  // Built-in conference id -> its teams, sorted.
  const b = league_file._builtin();
  const out = {};
  for (const s of sorted(b["slugs"])) {
    const cid = b["team_conf"][s];
    if (!has(out, cid)) out[cid] = [];
    out[cid].push(s);
  }
  return out;
}


function engine_name(merged, cid) {
  // The conference name the engine and the schedule rules use: a built-in conference keeps its
  // built-in name even when the file renames it (only its display name changes, conference_names);
  // a new conference's is its name in the file.
  const builtin = dget(league_file._builtin()["conf_names"], cid);
  if (builtin !== null) return builtin;
  const c = dget(merged["conferences"], cid);
  return truthy(c) ? c["name"] : pystr(cid);
}


function conference_names(merged) {
  // {engine name: display name} for each new or renamed conference (lgd["conference_names"]).
  const b = league_file._builtin()["conf_names"];
  const out = new Map();
  for (const [cid, c] of sorted(Object.entries(merged["conferences"]), (e) => e[0])) {
    if (!has(b, cid) || c["name"] !== b[cid]) out.set(league_file.engine_name(merged, cid), c["name"]);
  }
  return dict_of(out);
}


function _conf_changed(merged, cid) {
  // A built-in conference whose members or games the file changed (a rename alone changes only its display name).
  const b = league_file._builtin(), c = dget(merged["conferences"], cid);
  return c === null || !same_list(sorted(c["members"]), dget(league_file._base_members(), cid, [])) || c["games"] !== dget(b["games"], cid, 0);
}


function divisions(merged) {
  // {engine conference name: {division: [slugs]}} for each conference that plays divisions
  // (season.DIVISIONS) and whose membership (or games) the file changed: the built-in divisions less
  // the teams gone, each added member in the smaller division (a tie to the first alphabetically).
  // {} (no divisions) when a division would be empty or too big for the conference's games.
  const season = modules.season;
  const out = {};
  for (const [conf_name, divs] of Object.entries(season.DIVISIONS)) {
    const cid = league_file.conference_id(conf_name);
    if (!league_file._conf_changed(merged, cid)) continue;
    const c = dget(merged["conferences"], cid);
    const members = truthy(c) ? Array.from(c["members"]) : [];
    const keep = new Set(members);
    let fresh = {};
    for (const [d, ms] of Object.entries(divs)) fresh[d] = ms.filter((s) => keep.has(s));
    const placed = new Set(Object.values(fresh).flat());
    for (const s of sorted([...keep].filter((x) => !placed.has(x)))) {
      const d = minBy(sorted(Object.keys(fresh)), (dv) => fresh[dv].length);
      fresh[d].push(s);
    }
    if (!truthy(c) || Object.values(fresh).some((ms) => !ms.length) || Math.max(...Object.values(fresh).map((ms) => ms.length)) - 1 > c["games"]) {
      fresh = {};
    }
    out[conf_name] = fresh;
  }
  return out;
}


function _new_rule(n, games) {
  return { games, cycle: n - 1 === games ? 1 : 2, home_split: "even", protected: [], finales: [],
    non_conference: { games: 12 - games, power_road: Array.from(league_file.NEW_CONFERENCE_POWER_ROAD), fcs_max: league_file.NEW_CONFERENCE_FCS_MAX } };
}


function _trimmed_rule(base, c, divs, name) {
  // A built-in conference's rule for its merged members and games: the pairs, eight-game turns and
  // round robin its teams no longer allow are dropped; its divisions are divisions()'s.
  const rule = deepcopy(base);
  const mem = new Set(c["members"]), n = c["members"].length, games = c["games"];
  for (const k of ["protected", "finales", "neutral"]) {
    if (has(rule, k)) rule[k] = rule[k].filter((p) => mem.has(p[0]) && mem.has(p[1]));
  }
  if (has(rule, "eight_game_team")) {
    rule["eight_game_team"] = Object.fromEntries(Object.entries(rule["eight_game_team"]).filter(([y, s]) => mem.has(s)));
    if (!Object.keys(rule["eight_game_team"]).length) delete rule["eight_game_team"];
  }
  const schedule_gen = modules.schedule_gen;
  if (games !== schedule_gen._league_games(base, league_file.YEAR)) {  // the file set the conference's games: every year
    rule["games"] = games;
    delete rule["games_from"];
    if (!has(rule, "non_conference")) rule["non_conference"] = {};
    rule["non_conference"]["games"] = 12 - games;
  }
  if (has(rule, "games_from")) {
    rule["games_from"] = Object.fromEntries(Object.entries(rule["games_from"]).filter(([y, k]) => k <= n - 1));
    if (!Object.keys(rule["games_from"]).length) delete rule["games_from"];
  }
  if (truthy(get(rule, "round_robin")) && n - 1 !== games) delete rule["round_robin"];
  if (has(divs, name)) {
    const d = divs[name];
    if (Object.keys(d).length) {
      rule["divisions"] = d;
      rule["cross_division"] = Math.max(0, games - (Math.min(...Object.values(d).map((ms) => ms.length)) - 1));
    } else {
      delete rule["divisions"];
      delete rule["cross_division"];
    }
  }
  return rule;
}


function _protect_fits(rule, games, pair) {
  // A listed rivalry can be a protected pair: each team keeps a league game free beyond its
  // protected games and division, and a cross-division pair fits the cross-division games.
  const divs = truthy(get(rule, "divisions")) ? rule["divisions"] : {};
  const has_divs = Object.keys(divs).length > 0;
  const div_of = new Map();
  for (const [d, ms] of Object.entries(divs)) for (const s of ms) div_of.set(s, d);
  const of = (s) => (div_of.has(s) ? div_of.get(s) : null);
  const [a, b] = pair;
  if (has_divs && of(a) !== null && of(a) === of(b)) return false;                                    // division mates meet every year already
  for (const s of pair) {
    const cross = get(rule, "protected", []).filter((p) => p.includes(s) && !(div_of.size && of(p[0]) === of(p[1])));
    const load = cross.length + (div_of.has(s) ? dget(divs, div_of.get(s), []).length - 1 : 0);
    if (load + 1 >= games) return false;
    if (has_divs && get(rule, "cross_division") !== null && cross.length + 1 >= rule["cross_division"]) return false;
  }
  return true;
}


function schedule_rules(merged) {
  // The schedule generator's rules_override for a merged league: {"conferences": {name: rule}} for
  // each new conference and each built-in one whose members, games or name changed (or that gains a
  // protected pair), and {"annual": [...]} for listed rivalries across conferences. A rival in the
  // same conference is a protected pair; new conferences are never Power conferences.
  const schedule_gen = modules.schedule_gen;
  const R = schedule_gen.rules()["conferences"];
  const b = league_file._builtin(), docs = league_file._builtin_docs();
  const confs = merged["conferences"], teams = merged["teams"];
  const divs = league_file.divisions(merged);
  const work = new Map();
  const out_ids = new Set();

  const rule_for = (cid) => {
    if (!work.has(cid)) {
      const c = confs[cid];
      if (!has(b["conf_names"], cid)) {
        work.set(cid, league_file._new_rule(c["members"].length, c["games"]));
        out_ids.add(cid);
      } else if (dget(R, b["conf_names"][cid]) === null) work.set(cid, null);                        // the independents: scheduled team by team
      else if (league_file._conf_changed(merged, cid)) {
        work.set(cid, league_file._trimmed_rule(R[b["conf_names"][cid]], c, divs, b["conf_names"][cid]));
        out_ids.add(cid);
      } else work.set(cid, deepcopy(R[b["conf_names"][cid]]));
    }
    return work.get(cid);
  };

  for (const cid of Object.keys(confs)) rule_for(cid);

  const listed = (slug) => {
    // The rivals a team's schedule follows from the file: an added team's, a changed list, and for a
    // team that moved conference its built-in rivalries too (both ways), now perhaps across conferences.
    const rvl = get(teams[slug], "rivals") || [];
    let out = merged["added"].includes(slug) || !pyeq(rvl, get(dget(docs, slug) || {}, "rivals")) ? Array.from(rvl) : [];
    if (has(b["team_conf"], slug) && get(teams[slug], "conference") !== b["team_conf"][slug]) {
      out = out.concat(get(dget(docs, slug) || {}, "rivals") || []);
      out = out.concat(sorted(Object.entries(docs).filter(([t, d]) => (get(d, "rivals") || []).includes(slug)).map(([t, d]) => t)));
    }
    return [...new Set(out)].filter((r) => is_str(r));
  };

  const seen = new Set(schedule_gen.series()["annual"].map((s) => pair_key(sorted(s["teams"]))));
  const annual = [];
  for (const slug of sorted(new Set([...merged["added"], ...merged["changed"]]))) {
    if (!has(teams, slug)) continue;
    for (const r of listed(slug)) {
      if (r === slug || !has(teams, r)) continue;
      const pair = sorted([slug, r]);
      const ca = get(teams[slug], "conference"), cr = get(teams[r], "conference");
      const rule = ca === cr && has(confs, ca) ? rule_for(ca) : null;
      const finale = (get(merged, "finales") || []).some((f) => same_list(f, pair));            // Custom Programs: played in rivalry week
      if (rule !== null && confs[ca]["games"] > 0) {
        if (!has(rule, "protected")) rule["protected"] = [];
        const prot = rule["protected"];
        if (!truthy(get(rule, "round_robin")) && !prot.some((p) => same_list(sorted(p), pair))
            && league_file._protect_fits(rule, confs[ca]["games"], pair)) {
          prot.push(pair);
          out_ids.add(ca);
        }
        if (finale && !get(rule, "finales", []).some((f) => same_list(sorted(f), pair))) {
          if (!has(rule, "finales")) rule["finales"] = [];
          rule["finales"].push(pair);
          out_ids.add(ca);
        }
        continue;
      }
      if (!seen.has(pair_key(pair))) {
        seen.add(pair_key(pair));
        annual.push({ teams: pair, name: "", ...(finale ? { finale: true } : {}) });
      }
    }
  }
  const conferences = new Map();
  for (const cid of sorted(out_ids)) conferences.set(league_file.engine_name(merged, cid), work.get(cid));
  return { conferences: dict_of(conferences), annual };
}


// ---- Check: a file as the career it would start --------------------------------------------------

function _plain(reason, teams, conference_names = null) {
  // A ScheduleError's reason for the page: each team slug as its name, an FCS stand-in as "an FCS
  // opponent" (never its slug or a real school), a list without its brackets and quotes, and a
  // conference by its display name (lgd["conference_names"]).
  const season = modules.season;
  const names = truthy(conference_names) ? conference_names : {};

  const word = (m) => {
    const t = dget(teams, m);
    if (t === null) return m;
    return truthy(get(t, "fictional")) ? "an FCS opponent" : season.team_display(m, teams);
  };
  let text = pystr(reason).replace(/\[([^\]]*)\]/g, (_m, inner) => inner.replaceAll("'", "").replaceAll('"', ""));  // a list of slugs
  // (Python's \b counts every letter and digit as part of a word, JavaScript's only the plain ones: written out)
  text = text.replace(/(?<![\p{L}\p{N}_])no ([^\n]+?) slate(?![\p{L}\p{N}_])/gu, (_m, name) => `no ${dget(names, name, name)} slate`);
  text = text.replace(/(?<![A-Za-z])[a-z0-9]+(?:-[a-z0-9]+)*/g, word);
  return strip(text).replace(/\.+$/, "") || "no schedule fits its conferences";
}


function _count(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}


// a career league is built without the real 2026 depth charts and adjustments (league.build), so a team the
// file leaves alone can read an overall a point or so off its built-in card on the picker
// (UNTOUCHED_LINE is a getter on the namespace below: it carries YEAR)


function _failed(errors, total = null) {
  // A check that cannot start a career: its sentences (capped) and how many problems there are in all.
  return { ok: false, errors: league_file._capped(errors), errors_total: total === null ? errors.length : total };
}


function check(blob, seed = null) {
  // A league file read, checked, merged and filled: what Start Career needs. Errors as sentences
  // ({"ok": False, "errors", "errors_total"}: at most MAX_ERRORS and "And N more.", and the full count); an
  // import that changes nothing collapses to the built-in league ({"ok": True, "builtin": True, "summary"});
  // otherwise the career league (`league`), its engine teams file (`engine`, league.build(league): the same
  // bytes when Start builds it again, so a caller need not keep it), season one's
  // games (`games`: generated from the file's conferences with random.Random(f"league-schedule-{seed}") when
  // the file changes the league's shape, else None for the real 2026 schedule), `structural` (merge's: no
  // real 2026 AP poll then) and the summary ({"name", "added", "changed", "removed", "generated", "lines"};
  // `generated`: players the fill made). Anything the fill or the build still throws is one sentence (the
  // team's, when it is one team's), with the traceback in the server's log: a check never fails outright.
  let doc;
  try {
    doc = league_file.parse(blob);
  } catch (e) {
    if (e instanceof LeagueFileError) return league_file._failed(e.errors);
    throw e;
  }
  try {
    const [names, name_errs] = league_file.rivalry_names(doc);
    const errs = name_errs.concat(league_file.problems(doc));
    if (errs.length) return league_file._failed(errs);
    const out = league_file._check_merged(doc, blob, seed);
    if (get(out, "league") !== null && names.length) out["league"]["rivalries"] = names;          // the file's named rivalries: season.rivalry_for reads them for this career
    return out;
  } catch (e) {
    const league_fill = modules.league_fill;
    if (e instanceof league_fill.TeamBuildError) {
      league_file._log.error(`league check: building ${e.slug} failed`, e.cause || e);
      return league_file._failed([`${e.label}: the game could not build this team from the file; compare it with an exported league file.`]);
    }
    // the page shows a sentence; the traceback goes to the log
    league_file._log.exception("league check failed", e);
    return league_file._failed(["The game could not build a league from this file; compare it with an exported league file."]);
  } finally {
    league_file.release_caches();
  }
}


const RIVALRY_NAME_MAX = 60;       // *tune* the longest rivalry name a file may give


function rivalry_names(doc) {
  // A rival given as {"slug", "name", "every_year", "rivalry_week"} (Custom Programs): the entry becomes its slug in the
  // team's rivals (so the rest of the check reads slugs, as before), unless every_year is false: then it reserves no week
  // and is played only when the schedule pairs them. A name, or any rivalry that is not every year, is collected as a career
  // rivalry, {"teams": [a, b], "name", "trophy": "", "series": {}} (unnamed: "A vs. B"). rivalry_week true puts the
  // yearly game in rivalry week (doc["_finales"], read by schedule_rules); one per team. Returns (rivalries, errors).
  const out = [], errs = [], seen = new Set();
  const hashable = (v) => {              // a dict's key: Python cannot use a list or a dict as one
    if (v !== null && typeof v === "object") throw new TypeError(`unhashable type: '${Array.isArray(v) ? "list" : "dict"}'`);
    return typeof v === "boolean" ? Number(v) : v;
  };
  const shorts = new Map();
  for (const t of walk(get(doc, "teams"))) if (is_dict(t)) shorts.set(hashable(get(t, "slug")), truthy(get(t, "short_name")) ? t["short_name"] : get(t, "name"));
  const short = (slug) => {
    if (truthy(shorts.get(hashable(slug)) ?? null)) return shorts.get(hashable(slug));
    try {
      const m = modules.league.base_meta(slug);
      return truthy(get(m, "short_name")) ? m["short_name"] : slug;
    } catch (e) {                         // an unknown slug: the check names it
      return slug;
    }
  };
  if (get(doc, "_finales") === null && doc["_finales"] === undefined) doc["_finales"] = [];
  const finales = doc["_finales"];
  for (const t of walk(get(doc, "teams"))) {
    if (!is_dict(t) || !is_list(get(t, "rivals"))) continue;
    const label = truthy(get(t, "name")) ? t["name"] : truthy(get(t, "slug")) ? t["slug"] : "A team";
    const slugs = [];
    for (const r of t["rivals"]) {
      if (is_dict(r)) {
        const slug = get(r, "slug"), name = get(r, "name");
        if (!is_str(slug) || !slug) {
          errs.push(`${pystr(label)}: a named rivalry needs the rival's slug.`);
          continue;
        }
        if (name !== null && (!is_str(name) || pylen(strip(name)) > league_file.RIVALRY_NAME_MAX)) {
          errs.push(`${pystr(label)}: a rivalry name is at most ${league_file.RIVALRY_NAME_MAX} characters.`);
          continue;
        }
        const yearly = get(r, "every_year", true) !== false;
        if (yearly) slugs.push(slug);
        const mine = truthy(get(t, "slug")) ? t["slug"] : "";
        const pair = sorted_pair(mine, slug);
        if (truthy(get(r, "rivalry_week")) && yearly) {
          if (finales.some((f) => f.some((x) => pyeq(x, get(t, "slug"))))) {
            errs.push(`${pystr(label)}: only one rival can be the rivalry week game.`);
            continue;
          }
          finales.push(Array.from(pair));
        }
        if (((truthy(name) && strip(name)) || !yearly) && !seen.has(pair_key(pair))) {
          seen.add(pair_key(pair));
          const nm = truthy(name) && strip(name) ? strip(name) : `${pystr(short(get(t, "slug")))} vs. ${pystr(short(slug))}`;
          out.push({ teams: Array.from(pair), name: nm, trophy: "", series: {} });
        }
      } else slugs.push(r);
    }
    t["rivals"] = slugs;
  }
  return [out, errs];
}


function release_caches() {
  // Drop the built-in league copies a check reads (the export's team docs, the rosters, the fill's base
  // league): about 70 MB that would otherwise stay for the life of the server, and for good in the browser's
  // worker. The next check reads them again (a few seconds).
  const league_fill = modules.league_fill;
  league_file._builtin_docs.cache_clear();
  league_file._builtin_rosters.cache_clear();
  league_fill._base_league.cache_clear?.();      // (if the fill keeps its base league that way)
}


function _check_merged(doc, blob, seed) {
  // check() after validation: merge, fill, build and schedule.
  const league = modules.league, league_fill = modules.league_fill;
  const schedule_gen = modules.schedule_gen, season = modules.season;
  const YEAR = league_file.YEAR;
  const merged = league_file.merge(doc);
  merged["finales"] = walk(get(doc, "_finales")).map((f) => sorted(f));     // rivalry week games (rivalry_names)
  const counts = { added: merged["added"].length, changed: merged["changed"].length, removed: merged["removed"].length };
  if (merged["builtin"]) {
    return { ok: true, builtin: true,
      summary: { name: merged["name"], ...counts, generated: 0,
        lines: ["The file matches the game's own league, so the career starts from it."] } };
  }
  seed = league_fill.league_seed(blob, seed);          // the fill seed, fixed here: Start plays exactly this league
  const [lgd, lines] = league_fill.to_league(merged, seed);
  let generated = 0;
  for (const s of new Set([...merged["added"], ...merged["changed"]])) {
    if (has(lgd["teams"], s)) generated += Math.max(0, lgd["teams"][s]["roster"].length - (get(merged["teams"][s], "roster") || []).length);
  }
  const coach_names = modules.coach_names;
  coach_names.distinct({ league: lgd });   // one coach, one name, as every load applies it: the teams file Start
  const engine = league.build(lgd);        // writes is then the one a rebuild from the saved league gives, byte for byte
  let games = null;
  if (merged["structural"]) {
    // the teams as season.load_teams shows them (the stand-ins as themselves), as offseason.next_season passes them
    const teams = new_dict(engine["teams"]);
    for (const [s, t] of Object.entries(engine["teams"])) {
      teams[s] = truthy(get(t, "fictional")) ? season.stand_in_names({ [s]: { ...t } })[s] : t;
    }
    try {
      [games, lgd["schedule_history"]] = schedule_gen.generate(
        YEAR, teams, schedule_gen.empty_history(), new Random(`league-schedule-${seed}`), lgd["schedule_rules"]);
    } catch (e) {
      if (!(e instanceof schedule_gen.ScheduleError)) throw e;
      return league_file._failed([`The ${YEAR} schedule could not be built for this league: ${league_file._plain(e.message, teams, get(lgd, "conference_names"))}.`]);
    }
  }
  const changed = new Set(merged["changed"]);
  if ([...league_file._builtin()["slugs"]].some((s) => !changed.has(s) && has(lgd["teams"], s))) lines.splice(1, 0, league_file.UNTOUCHED_LINE);
  for (const c of walk(get(doc, "conferences"))) {             // validated: each has an id and a name
    if (!has(merged["conferences"], c["id"])) lines.push(`${strip(c["name"])} has no teams, so the league leaves it out.`);
  }
  lines.push(generated ? `Generated ${league_file._count(generated, "player", "players")} in all.` : "Generated no players.");
  lines.push(merged["structural"] ? `The ${YEAR} schedule is built from the file's conferences.`
    : `The real ${YEAR} schedule is kept.`);
  return { ok: true, builtin: false, league: lgd, engine, games, structural: merged["structural"],
    seed,
    summary: { name: merged["name"], ...counts, generated, lines, structural: Boolean(merged["structural"]) } };
}

export const league_file = {
  MAX_LEAGUE_BYTES, MAX_TEAMS, MAX_ERRORS, MAX_CONFERENCE_GAMES, POSITIONS, POS_IN, STRENGTH_WORDS, FORMAT, NAME,
  get YEAR() { return modules.league.FIRST_YEAR; },
  LEVEL, _COACH_ROLES, _FILE_POS, _GAME_POS, _log,
  conference_id, player_doc, player_compact, team_doc, to_league_team, _games, export_document, dumps, builtin_bytes,
  _SLUG, _HEX, _MB, LeagueFileError, _no_constant, parse, _builtin, _builtin_rosters, _is_int, _is_num, _say,
  HOME_FIELD_RANGE, STADIUM_CAPACITY_MAX, SURFACES, YEARS_RANGE, TARGET_SHARE_MIN, JERSEY_RANGE, MAX_HOMETOWN, UNIT_PLAYERS,
  FORMATION_ROLES, ABILITY_TIERS, _ROLE_WORD, _COACH_RATINGS, _COACH_TENDENCIES, _COACH_SCHEMES, _COACH_TEXT, _COACH_FLAGS,
  _words, _or, _num_text, _check_team_fields, _check_formation, _check_coach, _check_player_fields, validate, _capped,
  problems, checks_label, DEFAULT_NAME, _builtin_docs, _deep_merge, _merge_coaches, merge,
  NEW_CONFERENCE_POWER_ROAD, NEW_CONFERENCE_FCS_MAX, _base_members, engine_name, conference_names, _conf_changed, divisions,
  _new_rule, _trimmed_rule, _protect_fits, schedule_rules, _plain, _count,
  get UNTOUCHED_LINE() { return `Teams the file leaves alone play without the real ${league_file.YEAR} depth charts and adjustments.`; },
  _failed, check, RIVALRY_NAME_MAX, rivalry_names, release_caches, _check_merged,
  // (the JSON reader and its errors, for a caller that reads a file the same way)
  json_loads, json_text, JSONDecodeError, RecursionError, KeyError,
};

export {
  conference_id, player_doc, player_compact, team_doc, to_league_team, export_document, dumps, builtin_bytes, LeagueFileError,
  parse, validate, problems, checks_label, merge, engine_name, conference_names, divisions, schedule_rules, check,
  rivalry_names, release_caches, json_loads,
};

modules.league_file = league_file;
