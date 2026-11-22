// Find real names left in a generic build: `leaks(root, terms)` reads the staged, swapped project at `root` (what
// ships: the game's code, its data and the app's source) and reports every real name in `terms` (scrub.terms of
// the real project) it still holds, as {kind: {name: where it was first seen}}.
import path from "node:path";

import { PY_SPACE, PY_WORD, any_upper, dict, is_dict, is_dir, len, longest_first, read_json, read_text, re_escape, rglob, sorted_text, suffix } from "./pyio.mjs";

export const SOURCE = new Set([".py", ".ts", ".tsx", ".js", ".mjs", ".html", ".css"]);
export const _NAME = new RegExp(`[A-Z][${PY_WORD}'’.\\-]*(?: [A-Z][${PY_WORD}'’.\\-]*){1,4}`, "gu");
// the game's JavaScript: shipped as one bundled file (tools/build_site.mjs)
export const JS_DIRS = ["engine_js", "sim_js", "teamdata_js", "career_js", "app_js"];
const BLOCK_COMMENT = /\/\*[^]*?\*\//gu;
const LINE_COMMENT = new RegExp(`(?:(?<![^\\n])|[${PY_SPACE}])//[^\\n]*`, "gu");

export function _strings(node, out) {
  if (is_dict(node)) {
    for (const k of Object.keys(node)) {
      out.add(k);
      _strings(node[k], out);
    }
  } else if (Array.isArray(node)) {
    for (const v of node) _strings(v, out);
  } else if (typeof node === "string") out.add(node);
}

/** The files a build ships from the staged project: `files` (the game archive's paths) and the app's source.
 * Each is a path under `root`, written with "/". */
export function shipped(root, files = null) {
  root = String(root);
  if (files === null) {
    files = rglob(root).filter((f) => (SOURCE.has(suffix(f.name)) || suffix(f.name) === ".json")
      && !f.path.split(/[\\/]+/).includes("node_modules") && f.parts[0] !== "ui").map((f) => f.parts.join("/"));
  }
  const out = files.map((f) => `${root}/${f}`);
  for (const js of JS_DIRS) {
    if (is_dir(path.join(root, js))) {
      for (const f of rglob(path.join(root, js))) {
        if (SOURCE.has(suffix(f.name)) && !f.parts.includes("test") && !path.join(root, js).split(/[\\/]+/).includes("test")) {
          out.push(`${root}/${js}/${f.parts.join("/")}`);
        }
      }
    }
  }
  const ui = path.join(root, "ui");
  if (is_dir(ui)) {
    const above = ui.split(/[\\/]+/);
    for (const f of rglob(ui)) {
      if (SOURCE.has(suffix(f.name)) && !f.parts.includes("node_modules") && !f.parts.includes("dist")
        && !above.includes("node_modules") && !above.includes("dist")) out.push(`${root}/ui/${f.parts.join("/")}`);
    }
  }
  return out;
}

export function leaks(root, terms, files = null) {
  root = String(root);
  const found = { people: dict(), phrases: dict(), words: dict(), slugs: dict(), player_slugs: dict() };
  const first_seen = (kind, name, where) => { if (!(name in found[kind])) found[kind][name] = where; };
  const whole = (keys) => new RegExp(`(?<![A-Za-z0-9_])(?:${keys.map(re_escape).join("|")})(?![A-Za-z0-9_])`, "gu");
  const phrase = whole(longest_first(terms["phrases"]));
  const word = whole(sorted_text(terms["words"]));
  for (const file of shipped(root, files)) {
    const where = file.slice(root.length + 1);
    const ext = suffix(where.slice(where.lastIndexOf("/") + 1));
    let strings;
    if (ext === ".json" && where.startsWith("cfb_sim_data/faces/")) {
      // a team's preset faces: the names in it are who each face belongs to (a player's id, a coach's name). The
      // faces themselves are part ids from the face library the app ships anyway, and one hair color there is
      // spelled like a school's id, so only the owners are read
      const doc = read_json(file);
      strings = new Set();
      for (const group of Object.values(doc)) {
        if (is_dict(group)) for (const k of Object.keys(group)) strings.add(k.startsWith("coach:") ? k.slice(6) : k);
      }
    } else if (ext === ".json") {
      strings = new Set();
      _strings(read_json(file), strings);
    } else {
      let text = read_text(file);
      if ([".ts", ".tsx", ".js", ".mjs", ".css"].includes(ext)) {       // comments never reach the built app
        text = text.replace(BLOCK_COMMENT, " ");
        text = text.replace(LINE_COMMENT, " ");
      }
      strings = new Set([text]);
    }
    for (const s of strings) {
      if (terms["slugs"].has(s)) first_seen("slugs", s, where);
      if (terms["player_slugs"].has(s)) first_seen("player_slugs", s, where);
      if (s.length < 3 || (s.length < 6 && len(s) < 3) || !any_upper(s)) continue;
      for (const m of s.matchAll(phrase)) first_seen("phrases", m[0], where);
      for (const m of s.matchAll(word)) first_seen("words", m[0], where);
      for (const m of s.matchAll(_NAME)) {
        const parts = m[0].split(" ");
        for (let i = 0; i < parts.length; i++) {
          for (let j = i + 2; j <= Math.min(parts.length, i + 4); j++) {
            const cand = parts.slice(i, j).join(" ");
            if (terms["people"].has(cand)) first_seen("people", cand, where);
          }
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(found).filter(([, v]) => Object.keys(v).length));
}

/** The module as one object (`check.leaks`). */
export const check = { SOURCE, _NAME, JS_DIRS, _strings, shipped, leaks };
