// Saves from before the FCS stand-ins were renamed.
//
// The eight FCS stand-ins are named only for their region: slug `fcs-southeast`, name "FCS
// Southeast", no mascot, no town. They once carried made-up school names, towns, mascots and
// stadiums; a career saved then (its state, its box scores, a downloaded .ccsave, a cached league)
// still holds those slugs and names. `rewrite_text` turns every one of them into
// today's slug and label, once, when the save is read (season.load_season, season.load_box,
// career.read_save, coaches.load).
//
// The old strings are kept here rot13-encoded so that none of them appears anywhere in the
// repository as written (tests/test_no_standin_names.mjs checks every tracked file).
//
// Python's `json.loads` and `json.dumps` are written out here (_loads, _dumps): a rewritten save is the text
// Python would write (as the saves were first written), number for number and key for key,
// which JSON.parse and JSON.stringify do not give (1.0 would come back as 1, a key "2" would move ahead of "10").
import { sorted } from "../engine_js/pyrt.js";
import { modules } from "../engine_js/modules.js";

// region -> [old slug, [old names: school, short, town], old mascot, old stadium], rot13
const _OLD = {
  "Southeast": ["pnyqre-fcevatf", ["Pnyqre Fcevatf Havirefvgl", "Pnyqre Fcevatf"], "Pbggbazbhguf", "Yvir Bnx Objy"],
  "Gulf Coast": ["cbeg-eraavpx-fgngr", ["Cbeg Eraavpx Fgngr Havirefvgl", "Cbeg Eraavpx Fg.", "Cbeg Eraavpx"], "Znevaref", "Frnjnyy Fgnqvhz"],
  "Plains": ["erq-cenvevr-fgngr", ["Erq Cenvevr Fgngr Havirefvgl", "Erq Cenvevr Fg.", "Erq Cenvevr"], "Cynvafzra", "Jvaqoernx Fgnqvhz"],
  "Mid-Atlantic": ["nyqre-evqtr-fgngr", ["Nyqre Evqtr Fgngr Havirefvgl", "Nyqre Evqtr Fg.", "Nyqre Evqtr"], "Sbetref", "Sheanpr Uvyy Fgnqvhz"],
  "Great Lakes": ["jraqg-ynxr-grpu", ["Jraqg Ynxr Cbylgrpuavp Vafgvghgr", "Jraqg Ynxr Grpu", "Jraqg Ynxr"], "Servtugref", "Ber Qbpx Svryq"],
  // this one's mascot is also a real FBS team's, so it is only ever cleared on a stand-in's own record
  "Mountain West": ["gnyhf-crnx", ["Gnyhf Crnx Havirefvgl", "Gnyhf Crnx"], null, "Fjvgpuonpx Fgnqvhz"],
  "Pacific Northwest": ["prqne-fbhaq", ["Prqne Fbhaq Havirefvgl", "Prqne Fbhaq"], "Bepnf", "Qevsgjbbq Svryq"],
  "New England": ["xrfgery-onl", ["Xrfgery Onl Havirefvgl", "Xrfgery Onl"], "Frn Jbyirf", "Uneobeivrj Svryq"],
};
const _OLD_CONFERENCE = ["Rvtug Eviref Sbbgonyy Pbasrerapr", "Rvtug Eviref"];

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** codecs.decode(s, "rot13"): the 26 letters turned half way round, everything else as it is. */
export function _r(s) {
  return s.replace(/[A-Za-z]/g, (ch) => {
    const c = ch.charCodeAt(0), base = c < 97 ? 65 : 97;
    return String.fromCharCode(base + ((c - base + 13) % 26));
  });
}

export function new_slug(region) {
  // A stand-in's slug: 'fcs-' and its region, e.g. fcs-mid-atlantic.
  return "fcs-" + region.toLowerCase().replaceAll(" ", "-");
}

export function label(region) {
  return `FCS ${region}`;
}

// re.escape: the characters Python puts a backslash before (the pattern's text is then Python's own)
const _escape = (s) => s.replace(/[()[\]{}?*+\-|^$\\.&~# \t\n\r\v\f]/g, "\\$&");

let _table_made = null;      // worked out once
export function _table() {
  // One pattern for every old token, longest first, and what each becomes. Returns [pattern, {old: new}].
  if (_table_made !== null) return _table_made;
  const to = {};
  for (const [region, [slug, names, mascot, stadium]] of Object.entries(fcs_names._OLD)) {
    to[_r(slug)] = new_slug(region);
    for (const n of names) to[_r(n)] = label(region);
    if (mascot) to[_r(mascot)] = label(region);
    to[_r(stadium)] = `${label(region)} Stadium`;
  }
  for (const c of fcs_names._OLD_CONFERENCE) to[_r(c)] = "FCS";
  const pat = new RegExp(sorted(Object.keys(to), (k) => Array.from(k).length, true).map(_escape).join("|"), "g");
  _table_made = [pat, to];
  return _table_made;
}
_table.cache_clear = () => { _table_made = null; };

const NEW_SLUGS = Object.fromEntries(Object.keys(_OLD).map((r) => [new_slug(r), r]));

export function has_old(text) {
  // Does `text` hold any old slug or name?
  return text.search(fcs_names._table()[0]) !== -1;
}

// ---- Python's json, for a save's text ----
/** A number as the text had it: Python keeps a whole number whole (of any size) and reads the rest as a float. */
class _Num {
  constructor(text, is_float) {
    this.text = text;
    this.is_float = is_float;
  }
}
/** json.loads would raise (a ValueError in Python: the save's text is left as it is). */
class _NotJson extends Error {}
const INT_MAX_STR_DIGITS = 4300;      // Python will not read a whole number longer than this (sys.int_info.default_max_str_digits)

/** json.loads(text), keeping what JSON.parse loses: an object is a Map (its keys in the text's order, a repeated key
 * at its first place with its last value), a number is a _Num. NaN, Infinity and -Infinity are read, as Python reads them. */
export function _loads(s) {
  const n = s.length;
  let i = 0;
  const fail = () => { throw new _NotJson("not JSON"); };
  const ws = () => {
    for (;;) {
      const c = s.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else return;
    }
  };
  const digit = (c) => c >= 48 && c <= 57;
  function string() {
    // s[i] is the opening quote
    i++;
    let out = "", start = i;
    for (;;) {
      if (i >= n) fail();
      const c = s.charCodeAt(i);
      if (c === 34) {
        out += s.slice(start, i);
        i++;
        return out;
      }
      if (c <= 0x1f) fail();
      if (c !== 92) { i++; continue; }
      out += s.slice(start, i);
      i++;
      const e = s[i];
      if (e === "u") {
        const hex = s.slice(i + 1, i + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail();
        out += String.fromCharCode(parseInt(hex, 16));    // (the two halves of a pair come out side by side, which is the pair)
        i += 5;
      } else {
        const plain = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (e === undefined || !own(plain, e)) fail();
        out += plain[e];
        i++;
      }
      start = i;
    }
  }
  function number() {
    const start = i;
    if (s[i] === "-") i++;
    if (s[i] === "0") i++;
    else if (digit(s.charCodeAt(i))) while (digit(s.charCodeAt(i))) i++;
    else fail();
    let is_float = false;
    if (s[i] === "." && digit(s.charCodeAt(i + 1))) {
      is_float = true;
      i++;
      while (digit(s.charCodeAt(i))) i++;
    }
    if (s[i] === "e" || s[i] === "E") {
      let j = i + 1;
      if (s[j] === "+" || s[j] === "-") j++;
      if (digit(s.charCodeAt(j))) {
        while (digit(s.charCodeAt(j))) j++;
        is_float = true;
        i = j;
      }
    }
    const text = s.slice(start, i);
    if (!is_float && text.length - (text[0] === "-" ? 1 : 0) > INT_MAX_STR_DIGITS) fail();
    return new _Num(text, is_float);
  }
  function value() {
    const c = s[i];
    if (c === '"') return string();
    if (c === "{") {
      const o = new Map();
      i++;
      ws();
      if (s[i] === "}") { i++; return o; }
      for (;;) {
        if (s[i] !== '"') fail();
        const k = string();
        ws();
        if (s[i] !== ":") fail();
        i++;
        ws();
        o.set(k, value());
        ws();
        if (s[i] === "}") { i++; return o; }
        if (s[i] !== ",") fail();
        i++;
        ws();
      }
    }
    if (c === "[") {
      const a = [];
      i++;
      ws();
      if (s[i] === "]") { i++; return a; }
      for (;;) {
        a.push(value());
        ws();
        if (s[i] === "]") { i++; return a; }
        if (s[i] !== ",") fail();
        i++;
        ws();
      }
    }
    if (c === "n" && s.startsWith("null", i)) { i += 4; return null; }
    if (c === "t" && s.startsWith("true", i)) { i += 4; return true; }
    if (c === "f" && s.startsWith("false", i)) { i += 5; return false; }
    if (c === "N" && s.startsWith("NaN", i)) { i += 3; return NaN; }
    if (c === "I" && s.startsWith("Infinity", i)) { i += 8; return Infinity; }
    if (c === "-" && s.startsWith("-Infinity", i)) { i += 9; return -Infinity; }
    return number();
  }
  ws();
  const v = value();
  ws();
  if (i !== n) fail();
  return v;
}

/** repr(x) of a Python float: the shortest digits that read back as x, written Python's way (1e+16, 1e-05, 2.0). */
export function _float_repr(x) {
  if (Number.isNaN(x)) return "NaN";         // (as json.dumps writes them)
  if (x === Infinity) return "Infinity";
  if (x === -Infinity) return "-Infinity";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const sign = x < 0 ? "-" : "";
  const [mant, exp] = Math.abs(x).toExponential().split("e");
  const digits = mant.replace(".", ""), e = Number(exp);
  if (e < -4 || e >= 16) {
    const a = Math.abs(e);
    return `${sign}${digits[0]}${digits.length > 1 ? "." + digits.slice(1) : ""}e${e < 0 ? "-" : "+"}${a < 10 ? "0" : ""}${a}`;
  }
  if (e < 0) return `${sign}0.${"0".repeat(-e - 1)}${digits}`;
  if (digits.length <= e + 1) return `${sign}${digits}${"0".repeat(e + 1 - digits.length)}.0`;
  return `${sign}${digits.slice(0, e + 1)}.${digits.slice(e + 1)}`;
}

const _ESCAPES = { "\\": "\\\\", '"': '\\"', "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t" };
const _quote = (s) => '"' + s.replace(/[\\"]|[^ -~]/g, (ch) => _ESCAPES[ch] ?? "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0")) + '"';

/** json.dumps(o): ", " and ": " between things, everything outside plain ASCII as \uXXXX. */
export function _dumps(o) {
  const out = [];
  const put = (v) => {
    if (v === null || v === undefined) out.push("null");
    else if (v === true) out.push("true");
    else if (v === false) out.push("false");
    else if (typeof v === "string") out.push(_quote(v));
    else if (v instanceof _Num) out.push(v.is_float ? _float_repr(Number(v.text)) : v.text === "-0" ? "0" : v.text);
    else if (typeof v === "number") out.push(Number.isInteger(v) && !Object.is(v, -0) && Math.abs(v) < 1e16 ? String(v) : _float_repr(v));
    else if (Array.isArray(v)) {
      out.push("[");
      v.forEach((x, j) => {
        if (j) out.push(", ");
        put(x);
      });
      out.push("]");
    } else {
      out.push("{");
      let first = true;
      for (const [k, x] of v instanceof Map ? v : Object.entries(v)) {
        if (!first) out.push(", ");
        first = false;
        out.push(_quote(k), ": ");
        put(x);
      }
      out.push("}");
    }
  };
  put(o);
  return out.join("");
}

// a dict: a Map (a save read by _loads) or a plain object
const _is_dict = (o) => o instanceof Map || (o !== null && typeof o === "object" && !Array.isArray(o) && !(o instanceof _Num));
const _has = (o, k) => (o instanceof Map ? o.has(k) : own(o, k));
const _get = (o, k) => (o instanceof Map ? (o.has(k) ? o.get(k) : null) : own(o, k) ? o[k] : null);
const _set = (o, k, v) => { if (o instanceof Map) o.set(k, v); else o[k] = v; };
const _del = (o, k) => { if (o instanceof Map) o.delete(k); else delete o[k]; };

export function _fix_records(o) {
  // A stand-in's own team record (any dict whose slug is a stand-in's): its names become the
  // label, its abbreviation "FCS", no mascot and no town.
  if (_is_dict(o)) {
    const slug = _get(o, "slug");
    const region = typeof slug === "string" && own(fcs_names.NEW_SLUGS, slug) ? fcs_names.NEW_SLUGS[slug] : null;
    if (region && (_has(o, "fictional") || _has(o, "mascot") || _has(o, "school_name") || _has(o, "short_name"))) {
      for (const k of ["name", "short_name", "school", "school_name"]) if (_has(o, k)) _set(o, k, label(region));
      if (_has(o, "abbreviation")) _set(o, "abbreviation", "FCS");
      if (_has(o, "mascot")) _set(o, "mascot", "");
      _del(o, "city");
    }
    for (const v of o instanceof Map ? o.values() : Object.values(o)) _fix_records(v);
  } else if (Array.isArray(o)) {
    for (const v of o) _fix_records(v);
  }
  return o;
}

export function rewrite_text(text) {
  // `text` (a save, a box score, any JSON) with every old slug and name replaced; the same
  // string when there is none.
  const [pat, to] = fcs_names._table();
  if (text.search(pat) === -1) return text;
  const out = text.replace(pat, (m) => to[m]);
  let read;
  try {
    read = _loads(out);
  } catch (e) {
    if (e instanceof _NotJson) return out;
    throw e;
  }
  return _dumps(_fix_records(read));
}

export const fcs_names = {
  _OLD, _OLD_CONFERENCE, NEW_SLUGS,
  _r, new_slug, label, _table, has_old, _fix_records, rewrite_text,
  _loads, _dumps, _float_repr,
};

modules.fcs_names = fcs_names;
