// What the career compare scripts share: the repo's files for the JavaScript (as sim_js/test/season_whole_compare.mjs
// sets them up) and an exact comparison of two JSON values, key order included.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { set_reader, set_store } from "../../engine_js/files.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

export function use_repo_files() {
  set_reader((p) => fs.readFileSync(abs(p), "utf8"));
  set_store({
    write: (p, text) => { fs.mkdirSync(path.dirname(abs(p)), { recursive: true }); fs.writeFileSync(abs(p), text); },
    exists: (p) => fs.existsSync(abs(p)),
    remove: (p) => fs.rmSync(abs(p), { force: true }),
    remove_dir: (p) => fs.rmSync(abs(p), { recursive: true, force: true }),
    list: (p) => (fs.existsSync(abs(p)) ? fs.readdirSync(abs(p)).sort() : []),
    mtime: (p) => fs.statSync(abs(p)).mtimeMs,
  });
}

export const read = (out, name) => JSON.parse(fs.readFileSync(path.join(out, name), "utf8"));

/** A fresh copy of a JSON value, keys in their order. */
export const copy = (v) => JSON.parse(JSON.stringify(v));

/**
 * The differences between Python's value and the JavaScript's, at most 12 kept. A JavaScript value is first written
 * as JSON and read back (undefined keys drop, as nothing in Python has them). Numbers must be the same number;
 * `close` (a relative tolerance) is only passed where the port says a last digit may differ, and counts those.
 */
export function differences(py, js, { close = 0 } = {}) {
  const found = [];
  found.close = 0;
  found.close_at = {};                       // which fields those were: the last name in each one's path
  const walk = (a, b, where) => {
    if (found.length >= 12 || a === b) return;
    if (close && typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= close * Math.max(1, Math.abs(a), Math.abs(b))) {
      found.close++;
      const at = where.replace(/\[\d+\]/g, "").split("/").slice(-2).join("/");
      found.close_at[at] = (found.close_at[at] || 0) + 1;
      return;
    }
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) {
      found.push(`${where}: py ${String(JSON.stringify(a)).slice(0, 90)} | js ${String(JSON.stringify(b)).slice(0, 90)}`); return;
    }
    if (Array.isArray(a)) {
      if (a.length !== b.length) { found.push(`${where}: length py ${a.length} | js ${b.length}`); return; }
      a.forEach((v, i) => walk(v, b[i], `${where}[${i}]`));
      return;
    }
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.join("\u0000") !== kb.join("\u0000")) {
      const sa = new Set(ka), sb = new Set(kb);
      const only_py = ka.filter((k) => !sb.has(k)), only_js = kb.filter((k) => !sa.has(k));
      found.push(only_py.length || only_js.length ? `${where}: keys only py [${only_py.slice(0, 6)}] only js [${only_js.slice(0, 6)}]`
        : `${where}: key order differs (${ka.findIndex((k, i) => k !== kb[i])} of ${ka.length})`);
    }
    for (const k of ka) if (k in b) walk(a[k], b[k], `${where}/${k}`);
  };
  walk(py, js === undefined ? null : copy(js), "");
  return found;
}

/** A tally of checks: `t.same(name, py, js)` counts one case and prints what differs. */
export function tally() {
  const t = { cases: 0, bad: 0, close: 0, close_at: {} };
  t.same = (name, py, js, opts) => {
    t.cases++;
    const found = differences(py, js, opts);
    t.close += found.close;
    for (const [k, n] of Object.entries(found.close_at)) t.close_at[k] = (t.close_at[k] || 0) + n;
    if (found.length) {
      t.bad++;
      if (t.bad <= 15) { console.log(`DIFFERENT ${name}`); for (const f of found.slice(0, 6)) console.log("   " + f); }
    }
    return !found.length;
  };
  t.done = (what) => {
    console.log(t.bad ? `${what}: ${t.bad} of ${t.cases} cases DIFFERENT` : `${what}: all ${t.cases} cases the same`
      + (t.close ? ` (${t.close} numbers differ only past the ninth digit)` : ""));
    if (t.close) console.log("   those numbers, by field: " + Object.entries(t.close_at).map(([k, n]) => `${k || "(the value itself)"} ${n}`).join(", "));
    process.exit(t.bad ? 1 : 0);
  };
  return t;
}
