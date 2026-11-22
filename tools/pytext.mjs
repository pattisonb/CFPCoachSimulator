// What the measuring tools (tools/realism.mjs, long_run.mjs, check_recruiting.mjs) share: the game on Node with its
// writes in a temporary folder, their command lines, and Python's way of writing a number or a dict in a printed
// line (the tools print what their Python printed, to the digit).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { round, pyfloat } from "../engine_js/pyrt.js";
import { host } from "./game_host.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The whole game (tools/game_host.mjs), everything it writes kept in a temporary folder that goes when the process ends. */
export async function boot(env = {}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cfp-tool-"));
  process.on("exit", () => fs.rmSync(scratch, { recursive: true, force: true }));
  return host(ROOT, { overlay: scratch, env: { ...process.env, ...env } });
}

/** Whether the file at `url` (a module's import.meta.url) is the script Node was started with. */
export const is_main = (url) => Boolean(process.argv[1]) && url === pathToFileURL(fs.realpathSync(process.argv[1])).href;

/** f"{x:.{n}f}" (with `plus`, f"{x:+.{n}f}"): the nearest decimal, a half to even, and a small negative keeps its sign ("-0"). */
export function f(x, n = 0, plus = false) {
  x = Number(x);
  if (Number.isNaN(x)) return plus ? "+nan" : "nan";
  const neg = x < 0 || Object.is(x, -0);
  const body = Number.isFinite(x) ? Math.abs(round(x, n)).toFixed(n) : "inf";
  return (neg ? "-" : plus ? "+" : "") + body;
}

/** f"{x:.{n}%}". */
export const pct = (x, n = 0) => f(100 * x, n) + "%";
/** f"{s:<{w}}" and f"{s:>{w}}". */
export const left = (s, w) => String(s).padEnd(w);
export const right = (s, w) => String(s).padStart(w);

/**
 * Python's repr of plain data, as an f-string prints a dict, list, string, None or number. JavaScript has one kind
 * of number and its keys are text, so the caller says what Python had: `floats` for values that were floats (a whole
 * one prints "2.0"), `int_keys` for a dict keyed by whole numbers ({1: 3}, not {'1': 3}).
 */
export function repr(v, { floats = false, int_keys = false } = {}) {
  const opt = { floats, int_keys };
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return Number.isInteger(v) ? (floats ? `${v}.0` : String(v)) : Number.isFinite(v) ? pyfloat(v) : Number.isNaN(v) ? "nan" : v > 0 ? "inf" : "-inf";
  if (typeof v === "string") return v.includes("'") && !v.includes('"') ? `"${v}"` : `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (Array.isArray(v)) return "[" + v.map((x) => repr(x, opt)).join(", ") + "]";
  return "{" + Object.entries(v).map(([k, x]) => `${int_keys && /^-?\d+$/.test(k) ? k : repr(k)}: ${repr(x, opt)}`).join(", ") + "}";
}

/**
 * A command line as Python's argparse read it. `spec`: { name: "flag" | "int" | "str" | "list" } for --name
 * ("--no-2026" is the key "no-2026"; a "list" takes every word up to the next option, and is null when the option is
 * not given). Returns { name: value } with `defaults` filled in; a bad line prints the usage and exits 2, as argparse.
 */
export function parse_args(argv, spec, defaults, usage) {
  const out = { ...defaults };
  const fail = (why) => { console.error(`${usage}\nerror: ${why}`); process.exit(2); };
  for (let i = 0; i < argv.length; i++) {
    let word = argv[i], inline = null;
    if (word === "-h" || word === "--help") { console.log(usage); process.exit(0); }
    if (word.startsWith("--") && word.includes("=")) [word, inline] = [word.slice(0, word.indexOf("=")), word.slice(word.indexOf("=") + 1)];
    const name = word.startsWith("--") ? word.slice(2) : null;
    const kind = name === null ? undefined : spec[name];
    if (kind === undefined) fail(`unrecognized arguments: ${argv[i]}`);
    if (kind === "flag") { out[name] = true; continue; }
    if (kind === "list") {
      out[name] = inline === null ? [] : [inline];
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) out[name].push(argv[++i]);
      continue;
    }
    const value = inline !== null ? inline : argv[++i];
    if (value === undefined) fail(`argument --${name}: expected one argument`);
    if (kind === "int") {
      if (!/^\s*[-+]?\d+\s*$/.test(value)) fail(`argument --${name}: invalid int value: '${value}'`);
      out[name] = Number(value);
    } else out[name] = value;
  }
  return out;
}

/** glob.glob(pattern) for the patterns a shell would have opened ("*", "?" in a file or folder name); a plain path is itself when it is there. */
export function glob(pattern) {
  if (!/[*?[]/.test(pattern)) return fs.existsSync(pattern) ? [pattern] : [];
  const parts = pattern.split(/[\\/]/);
  let found = [parts[0] === "" ? path.sep : ""];
  parts.forEach((part, i) => {
    if (i === 0 && part === "") return;
    const next = [];
    for (const base of found) {
      if (!/[*?[]/.test(part)) { if (fs.existsSync(path.join(base, part) || ".")) next.push(path.join(base, part)); continue; }
      const re = new RegExp("^" + part.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
      let names = [];
      try { names = fs.readdirSync(base || "."); } catch { /* not a folder */ }
      for (const name of names) if (re.test(name) && (part.startsWith(".") || !name.startsWith("."))) next.push(path.join(base, name));
    }
    found = next;
  });
  return found;
}
