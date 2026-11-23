// The FCS stand-ins: who they are, and the saves from before they were.
//
// The eight FCS stand-ins are one team per region, each with a name, a mascot, an abbreviation and two colors
// of its own (TEAMS below: the New England Lobsters, the Plains Thunderheads, ...). Their slugs are their regions'
// (`fcs-southeast`) and never change; they are still FCS (conference and level "FCS") and still no program a
// career can pick, browse or recruit against.
//
// They have been renamed twice. First they carried made-up school names, towns, mascots and stadiums; then
// they were named only for their region ("FCS Southeast", abbreviation "FCS", no mascot). A career saved in
// either time (its state, its box scores, a downloaded .ccsave, a cached league) still holds those slugs and
// names. `rewrite_text` turns every one of them into today's slug and name, once, when the save is read
// (season.load_season, season.load_box, career.read_save, coaches.load).
//
// The first set of old strings is kept here rot13-encoded so that none of them appears anywhere in the
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

// The stand-ins as every page shows them, by region. The team files (cfb_sim_data/teams/fcs-*.json) say the
// same (tests/test_no_standin_names.mjs holds them to it); season.stand_in_names puts these on a league's
// teams whatever its file says, so a league cached by an older save shows them too. A name is its region and
// its mascot, but for the Mountain West's: that is a real conference's name, so its team is the Rocky Mountain
// Jackalopes. *tune* names and colors
export const TEAMS = {
  "New England": { slug: "fcs-new-england", name: "New England Lobsters", mascot: "Lobsters", abbreviation: "LOB", stadium: "The Lobster Pot",
    colors: { primary: ["Lobster Red", "#C8322B"], secondary: ["Midnight Blue", "#14284B"], accent: ["White", "#FFFFFF"] } },
  "Mid-Atlantic": { slug: "fcs-mid-atlantic", name: "Mid-Atlantic Blue Crabs", mascot: "Blue Crabs", abbreviation: "CRAB", stadium: "The Crab Trap",
    colors: { primary: ["Crab Blue", "#1F6FB5"], secondary: ["Orange", "#F28C28"], accent: ["White", "#FFFFFF"] } },
  "Southeast": { slug: "fcs-southeast", name: "Southeast Possums", mascot: "Possums", abbreviation: "POSS", stadium: "Possum Hollow",
    colors: { primary: ["Charcoal", "#3A3D42"], secondary: ["Pink", "#F29CB7"], accent: ["White", "#FFFFFF"] } },
  "Gulf Coast": { slug: "fcs-gulf-coast", name: "Gulf Coast Shrimpers", mascot: "Shrimpers", abbreviation: "SHMP", stadium: "Shrimp Boat Stadium",
    colors: { primary: ["Coral", "#F26B5B"], secondary: ["Teal", "#0E7C7B"], accent: ["White", "#FFFFFF"] } },
  "Great Lakes": { slug: "fcs-great-lakes", name: "Great Lakes Walleyes", mascot: "Walleyes", abbreviation: "WALL", stadium: "Walleye Landing",
    colors: { primary: ["Lake Teal", "#0B5563"], secondary: ["Gold", "#E0B43A"], accent: ["White", "#FFFFFF"] } },
  "Plains": { slug: "fcs-plains", name: "Plains Thunderheads", mascot: "Thunderheads", abbreviation: "THND", stadium: "Storm Cellar Field",
    colors: { primary: ["Storm Gray", "#4A5560"], secondary: ["Lightning Yellow", "#FFD60A"], accent: ["White", "#FFFFFF"] } },
  "Mountain West": { slug: "fcs-mountain-west", name: "Rocky Mountain Jackalopes", mascot: "Jackalopes", abbreviation: "JACK", stadium: "Jackalope Flats",
    colors: { primary: ["Sage", "#8A9A78"], secondary: ["Burnt Orange", "#C2571A"], accent: ["White", "#FFFFFF"] } },
  "Pacific Northwest": { slug: "fcs-pacific-northwest", name: "Pacific Northwest Sasquatch", mascot: "Sasquatch", abbreviation: "SASQ", stadium: "Sasquatch Woods",
    colors: { primary: ["Evergreen", "#1E4D36"], secondary: ["Fog Cream", "#EDE6D3"], accent: ["White", "#FFFFFF"] } },
};

export function new_slug(region) {
  // A stand-in's slug: 'fcs-' and its region, e.g. fcs-mid-atlantic (written out in TEAMS: a slug never changes).
  return TEAMS[region].slug;
}

export function label(region) {
  // A stand-in's name as every page shows it: "Plains Thunderheads".
  return fcs_names.TEAMS[region].name;
}

export function old_label(region) {
  // What a stand-in was called while it was named only for its region: "FCS Plains".
  return `FCS ${region}`;
}

export function brand(slug) {
  // A stand-in's identity by its slug (name, mascot, abbreviation, stadium, colors), or null for anyone else.
  const region = own(fcs_names.NEW_SLUGS, slug) ? fcs_names.NEW_SLUGS[slug] : null;
  return region === null ? null : fcs_names.TEAMS[region];
}

export function hex_colors(region) {
  // A stand-in's colors as a league's team carries them: {primary: "#rrggbb", secondary, accent}.
  return Object.fromEntries(Object.entries(fcs_names.TEAMS[region].colors).map(([k, [, hex]]) => [k, hex]));
}

// re.escape: the characters Python puts a backslash before (the pattern's text is then Python's own)
const _escape = (s) => s.replace(/[()[\]{}?*+\-|^$\\.&~# \t\n\r\v\f]/g, "\\$&");

let _table_made = null;      // worked out once
export function _table() {
  // One pattern for every old token, longest first, and what each becomes. Returns [pattern, {old: new}].
  if (_table_made !== null) return _table_made;
  const to = {};
  const whole = new Set();           // the region labels: only as whole words ("FCS Southeast", not the start of a longer word)
  for (const [region, [slug, names, mascot, stadium]] of Object.entries(fcs_names._OLD)) {
    to[_r(slug)] = new_slug(region);
    for (const n of names) to[_r(n)] = label(region);
    if (mascot) to[_r(mascot)] = label(region);
    to[_r(stadium)] = fcs_names.TEAMS[region].stadium;
  }
  for (const c of fcs_names._OLD_CONFERENCE) to[_r(c)] = "FCS";
  for (const region of Object.keys(fcs_names.TEAMS)) {      // the names they had while named only for their regions
    to[`${old_label(region)} Stadium`] = fcs_names.TEAMS[region].stadium;
    to[old_label(region)] = label(region);
    whole.add(old_label(region));
  }
  const pat = new RegExp(sorted(Object.keys(to), (k) => Array.from(k).length, true)
    .map((k) => _escape(k) + (whole.has(k) ? "(?![A-Za-z])" : "")).join("|"), "g");
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
  // A stand-in's own team record (any dict whose slug is a stand-in's): its names, abbreviation and mascot
  // become today's, and it has no town.
  if (_is_dict(o)) {
    const slug = _get(o, "slug");
    const region = typeof slug === "string" && own(fcs_names.NEW_SLUGS, slug) ? fcs_names.NEW_SLUGS[slug] : null;
    if (region && (_has(o, "fictional") || _has(o, "mascot") || _has(o, "school_name") || _has(o, "short_name"))) {
      const b = fcs_names.TEAMS[region];
      for (const k of ["name", "short_name", "school", "school_name"]) if (_has(o, k)) _set(o, k, b.name);
      if (_has(o, "abbreviation")) _set(o, "abbreviation", b.abbreviation);
      if (_has(o, "mascot")) _set(o, "mascot", b.mascot);
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
  _OLD, _OLD_CONFERENCE, NEW_SLUGS, TEAMS,
  _r, new_slug, label, old_label, brand, hex_colors, _table, has_old, _fix_records, rewrite_text,
  _loads, _dumps, _float_repr,
};

modules.fcs_names = fcs_names;
