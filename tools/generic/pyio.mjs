// What scrub.mjs and check.mjs need to read and write a staged project byte for byte as the published site's files
// have always been written (the scrub was first written in Python): JSON with every dict in the file's key order
// and every number written back as Python writes it, text files with Python's line endings, a folder's files in
// pathlib's order, and Python's idea of a letter, a capital and a space. Node only (fs).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { odict } from "../../engine_js/pyrt.js";

// ---- text as Python sees it -----------------------------------------------------------------------------------

/** The characters str.isspace() is true for (what str.split(), str.strip() and a pattern's \s go by), for a regex class. */
export const PY_SPACE = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
/** A pattern's \w for text: a letter, a number or an underscore, in any script. */
export const PY_WORD = "\\p{L}\\p{N}_";
const SPACES = new RegExp(`[${PY_SPACE}]+`, "u");
const STRIP = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, "gu");
const LETTER = /^\p{L}/u;
const UPPER = /\p{Uppercase}/u;

/** s.split(): the words between runs of space. */
export const split = (s) => s.split(SPACES).filter((w) => w !== "");
/** s.strip(). */
export const strip = (s) => s.replace(STRIP, "");
/** ch.isalpha() of the character `s` starts with. */
export const isalpha = (s) => LETTER.test(s);
/** any(ch.isupper() for ch in s). */
export const any_upper = (s) => UPPER.test(s);
/** len(s): characters, not UTF-16 units. */
export function len(s) {
  let n = s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { n--; i++; }
    }
  }
  return n;
}
/** s[0]: the first character (a whole one), "" for an empty string. */
export const first = (s) => (s === "" ? "" : String.fromCodePoint(s.codePointAt(0)));

/** Python's order of two strings (by character; JavaScript's own is by UTF-16 unit, which differs past U+FFFF). */
export function cmp_text(a, b) {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i), y = b.charCodeAt(i);
    if (x !== y) {
      const sx = x >= 0xd800 && x <= 0xdfff, sy = y >= 0xd800 && y <= 0xdfff;
      if (sx !== sy) return sx ? 1 : -1;
      return x < y ? -1 : 1;
    }
  }
  return a.length < b.length ? -1 : 1;
}
/** sorted(strings). */
export const sorted_text = (xs) => [...xs].sort(cmp_text);
/** sorted(strings, key=len, reverse=True): longest first, equals in the order given. */
export function longest_first(xs) {
  const keyed = Array.from(xs, (x) => [len(x), x]);
  keyed.sort((p, q) => q[0] - p[0]);
  return keyed.map((p) => p[1]);
}

/** re.escape(s), for a pattern compiled with the "u" flag. */
export const re_escape = (s) => s.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

// ---- dicts ----------------------------------------------------------------------------------------------------
// A dict here is an object without a prototype (so any text is a safe key: "constructor", "__proto__"), and an
// `odict` (engine_js/pyrt.js) when one of its keys looks like a whole number, which a plain object would list first.

const NUMBER_LIKE = /^(?:0|[1-9]\d*)$/;

/** A dict of [key, value] pairs in their order (a key given twice keeps its first place and its last value). */
export function dict(pairs = []) {
  for (const p of pairs) if (NUMBER_LIKE.test(p[0])) return odict(pairs);
  const out = Object.create(null);
  for (const p of pairs) out[p[0]] = p[1];
  return out;
}
/** isinstance(v, dict). */
export const is_dict = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonNumber) && !(v instanceof Set);
/** d.get(k, default) of a dict made here. */
export const get = (d, k, fallback = null) => (d[k] === undefined ? fallback : d[k]);
/** Python's truth of a JSON value. */
export function truthy(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (v instanceof JsonNumber) return v.value !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

// ---- JSON -----------------------------------------------------------------------------------------------------

/** A number of a JSON file that JavaScript cannot hold as Python does (a float, or a whole number too big): its
 * value for arithmetic and comparisons, and the text json.dumps writes for it ("4.0", "58.3" for a file's "58.30"). */
export class JsonNumber {
  constructor(text, value) {
    this.text = text;
    this.value = value;
  }
  valueOf() { return this.value; }
  toJSON() { return this.value; }
}

/** repr(x) of a Python float. */
export function float_repr(x) {
  if (Number.isNaN(x)) return "NaN";
  if (x === Infinity) return "Infinity";
  if (x === -Infinity) return "-Infinity";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const [m, e] = x.toExponential().split("e");
  const n = Number(e);
  if (n < -4 || n >= 16) return `${m}e${n < 0 ? "-" : "+"}${String(Math.abs(n)).padStart(2, "0")}`;
  const t = String(x);                      // JavaScript writes these plainly too, with the same (shortest) digits
  return t.includes(".") ? t : t + ".0";
}

const NUMBER = /-?(?:0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?/y;

/** json.loads(text): dicts in the text's key order, floats kept as floats (JsonNumber). */
export function loads(text) {
  let i = 0;
  const n = text.length;
  const fail = (what) => { throw new SyntaxError(`JSON: ${what} at ${i}`); };
  const ws = () => {
    for (; i < n; i++) {
      const c = text.charCodeAt(i);
      if (c !== 32 && c !== 10 && c !== 13 && c !== 9) break;
    }
  };
  const string = () => {                    // at the opening quote
    const start = i++;
    let plain = true;
    for (; i < n; i++) {
      const c = text.charCodeAt(i);
      if (c === 34) break;
      if (c === 92) { plain = false; i++; }
    }
    if (i >= n) fail("an unterminated string");
    i++;
    return plain ? text.slice(start + 1, i - 1) : JSON.parse(text.slice(start, i));
  };
  const value = () => {
    ws();
    const c = text.charCodeAt(i);
    if (c === 34) return string();
    if (c === 123) {
      i++;
      const pairs = [];
      ws();
      if (text.charCodeAt(i) === 125) { i++; return dict(pairs); }
      for (;;) {
        ws();
        if (text.charCodeAt(i) !== 34) fail("a key was expected");
        const k = string();
        ws();
        if (text.charCodeAt(i) !== 58) fail("a colon was expected");
        i++;
        pairs.push([k, value()]);
        ws();
        const d = text.charCodeAt(i++);
        if (d === 125) return dict(pairs);
        if (d !== 44) fail("a comma was expected");
      }
    }
    if (c === 91) {
      i++;
      const out = [];
      ws();
      if (text.charCodeAt(i) === 93) { i++; return out; }
      for (;;) {
        out.push(value());
        ws();
        const d = text.charCodeAt(i++);
        if (d === 93) return out;
        if (d !== 44) fail("a comma was expected");
      }
    }
    if (text.startsWith("true", i)) { i += 4; return true; }
    if (text.startsWith("false", i)) { i += 5; return false; }
    if (text.startsWith("null", i)) { i += 4; return null; }
    if (text.startsWith("NaN", i)) { i += 3; return new JsonNumber("NaN", NaN); }
    if (text.startsWith("Infinity", i)) { i += 8; return new JsonNumber("Infinity", Infinity); }
    if (text.startsWith("-Infinity", i)) { i += 9; return new JsonNumber("-Infinity", -Infinity); }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (!m) fail("a value was expected");
    i = NUMBER.lastIndex;
    const x = Number(m[0]);
    if (m[1] === undefined && m[2] === undefined) {       // an int
      if (Number.isSafeInteger(x)) return x === 0 ? 0 : x;
      return new JsonNumber(m[0], x);
    }
    return new JsonNumber(float_repr(x), x);
  };
  const out = value();
  ws();
  if (i < n) fail("extra data");
  return out;
}

/** json.dumps(data, ensure_ascii=False, separators=(",", ":")). */
export function dumps(data) {
  const out = [];
  const walk = (v) => {
    if (v === null || v === undefined) out.push("null");
    else if (typeof v === "string") out.push(JSON.stringify(v));
    else if (typeof v === "number") out.push(Number.isInteger(v) ? String(v) : float_repr(v));
    else if (v === true) out.push("true");
    else if (v === false) out.push("false");
    else if (v instanceof JsonNumber) out.push(v.text);
    else if (Array.isArray(v)) {
      out.push("[");
      for (let j = 0; j < v.length; j++) {
        if (j) out.push(",");
        walk(v[j]);
      }
      out.push("]");
    } else {
      out.push("{");
      let any = false;
      for (const k of Object.keys(v)) {
        if (any) out.push(",");
        any = true;
        out.push(JSON.stringify(k), ":");
        walk(v[k]);
      }
      out.push("}");
    }
  };
  walk(data);
  return out.join("");
}

// ---- files ----------------------------------------------------------------------------------------------------

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** path.read_text(encoding="utf-8"): the text, every line ending a "\n" (a byte that is not UTF-8 is an error). */
export const read_text = (file) => utf8.decode(fs.readFileSync(file)).replace(/\r\n?/g, "\n");
/** path.write_text(text, encoding="utf-8"): "\n" written as the computer ends a line. */
export function write_text(file, text) {
  fs.writeFileSync(file, os.EOL === "\n" ? text : text.replace(/\n/g, os.EOL));
}
export const read_json = (file) => loads(read_text(file));
export const write_json = (file, data) => write_text(file, dumps(data));

/** Path.suffix of a file name: ".json", or "" without one. */
export function suffix(name) {
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? name.slice(i) : "";
}
/** Path.stem of a file name. */
export const stem = (name) => name.slice(0, name.length - suffix(name).length);
export const is_file = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } };
export const is_dir = (file) => { try { return fs.statSync(file).isDirectory(); } catch { return false; } };

/** A path's parts, as Path.parts gives them for the path as written. */
export const parts_of = (file) => file.split(/[\\/]+/).filter((p) => p !== "");

/**
 * sorted(root.rglob("*")), files only: [{ path, parts (from `root`), name }], in pathlib's order (part by part).
 * A linked folder is not walked into, as rglob does not.
 */
export function rglob(root) {
  const out = [];
  const walk = (dir, parts) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const file = path.join(dir, e.name);
      const here = [...parts, e.name];
      if (e.isDirectory()) walk(file, here);
      else if (e.isFile() || (e.isSymbolicLink() && is_file(file))) out.push({ path: file, parts: here, name: e.name });
    }
  };
  walk(root, []);
  out.sort((a, b) => {
    const n = Math.min(a.parts.length, b.parts.length);
    for (let i = 0; i < n; i++) {
      const c = cmp_text(a.parts[i], b.parts[i]);
      if (c) return c;
    }
    return a.parts.length - b.parts.length;
  });
  return out;
}
