// Skins, the build's side (ui/public/skin.js is the browser's and says what a skin is).
//
// The published site's scripts (game.js and the app) carry lookalike names inside their strings. For a skin to put
// other names there, the generic build publishes beside each script a list of the spots where a name stands
// (`names_map`): it builds the same script from the source rosters' names too, reads both as programs (TypeScript's
// parser), walks them side by side and, wherever a string differs, records where the lookalike stands, how long it
// is, what kind of spot it is and a 16-bit mark of the name that belongs there. The list holds no name. `check_map`
// then proves the list: the published script with the names written in is the other script, token for token, but for
// the short names the minifier gives local variables.
//
// `make` builds a skin file from two staged projects (tools/make_skin.mjs).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import "../ui/public/skin.js";

export const Skin = globalThis.Skin;

/** Every swap the scrub makes in source text, turned around: lookalike -> the names it stands for (sorted). */
export function pairs_of(maps) {
  const by = new Map();
  const add = (table) => {
    for (const [real, made] of Object.entries(table)) {
      if (!real || !made || real === made || typeof made !== "string") continue;
      if (!by.has(made)) by.set(made, new Set());
      by.get(made).add(real);
    }
  };
  add(maps.exact); add(maps.team_exact); add(maps.fcs_state_places); add(maps.slug); add(maps.source_phrases); add(maps.phrases);
  const out = {};
  for (const made of [...by.keys()].sort()) out[made] = [...by.get(made)].sort();
  return out;
}

// ---- a script as a list of leaves -----------------------------------------------------------------------------

let _ts = null;
function typescript(ui) {
  _ts ??= createRequire(path.join(ui, "package.json"))("typescript");
  return _ts;
}

/**
 * A script as the flat list of what it is made of, in order: {t: "n", v} a piece of syntax; {t: "id", v} a variable's
 * name; {t: "fix", v} a name the minifier leaves alone; {t: "num"|"re", v}; {t: "str", v, s, e, cut} a string (its
 * value, where it stands with its quotes, and how many characters close it); {t: "prop", v, s, e, form} a property's
 * name ("str": written as a string; "id": a bare key; "dot"/"qdot": after a dot or `?.`). `imports`: the strings that
 * name another module.
 */
export function leaves(ts, text) {
  const sf = ts.createSourceFile("script.js", text, ts.ScriptTarget.ESNext, false, ts.ScriptKind.JS);
  const K = ts.SyntaxKind;
  const out = [], imports = [];
  const start = (n) => n.getStart(sf, false);
  const is_text = (n) => n && (n.kind === K.StringLiteral || n.kind === K.NoSubstitutionTemplateLiteral);
  const str = (n, t = "str", form = "str") => out.push({ t, v: n.text, s: start(n), e: n.end, cut: n.kind === K.TemplateHead || n.kind === K.TemplateMiddle ? 2 : 1, form });
  const key = (n) => {
    if (n.kind === K.Identifier) out.push({ t: "prop", v: n.text, s: start(n), e: n.end, form: "id" });
    else if (is_text(n)) str(n, "prop");
    else visit(n);
  };
  const rest = (n, skip) => ts.forEachChild(n, (c) => { if (!skip.includes(c)) visit(c); });
  function visit(n) {
    switch (n.kind) {
      case K.Identifier: case K.PrivateIdentifier: out.push({ t: "id", v: n.text }); return;
      case K.StringLiteral: case K.NoSubstitutionTemplateLiteral: case K.TemplateHead: case K.TemplateMiddle: case K.TemplateTail:
        str(n); return;
      case K.RegularExpressionLiteral: out.push({ t: "re", v: n.text }); return;
      case K.NumericLiteral: case K.BigIntLiteral: out.push({ t: "num", v: n.text }); return;
      case K.PropertyAccessExpression:
        out.push({ t: "n", v: "access" });
        visit(n.expression);
        if (n.questionDotToken) out.push({ t: "n", v: "?." });
        if (n.name.kind === K.Identifier) out.push({ t: "prop", v: n.name.text, s: start(n.name), e: n.name.end, form: n.questionDotToken ? "qdot" : "dot" });
        else visit(n.name);
        return;
      case K.ElementAccessExpression:
        if (is_text(n.argumentExpression)) {
          out.push({ t: "n", v: "access" });
          visit(n.expression);
          if (n.questionDotToken) out.push({ t: "n", v: "?." });
          str(n.argumentExpression, "prop");
          return;
        }
        break;
      case K.PropertyAssignment: case K.MethodDeclaration: case K.PropertyDeclaration: case K.GetAccessor: case K.SetAccessor:
        out.push({ t: "n", v: n.kind });
        key(n.name);
        rest(n, [n.name]);
        return;
      case K.ShorthandPropertyAssignment:
        // `{n}` is `{n: n}`: the minifier writes the short one only when a variable happens to be given the name of
        // the property it fills, which it may be in one build and not in the other (it names variables by how often
        // each letter is used in the script, names included). Read as the long one, so the two stay the same program.
        out.push({ t: "n", v: K.PropertyAssignment });
        out.push({ t: "prop", v: n.name.text, s: start(n.name), e: n.name.end, form: "short" });
        out.push({ t: "id", v: n.name.text });
        return;
      case K.BindingElement:
        if (n.propertyName) {
          out.push({ t: "n", v: n.kind });
          key(n.propertyName);
          rest(n, [n.propertyName]);
          return;
        }
        break;
      case K.ImportSpecifier: case K.ExportSpecifier: {
        out.push({ t: "n", v: n.kind });
        const outer = n.kind === K.ImportSpecifier ? n.propertyName || n.name : n.name;
        for (const c of [n.propertyName, n.name]) if (c) out.push({ t: c === outer ? "fix" : "id", v: c.text });
        return;
      }
      case K.MetaProperty: out.push({ t: "n", v: n.kind }, { t: "fix", v: n.name.text }); return;
      case K.LabeledStatement: out.push({ t: "n", v: n.kind }); visit(n.statement); return;
      case K.BreakStatement: case K.ContinueStatement: out.push({ t: "n", v: n.kind }); return;
      case K.PrefixUnaryExpression: case K.PostfixUnaryExpression: out.push({ t: "n", v: `${n.kind}:${n.operator}` }); visit(n.operand); return;
      case K.VariableDeclarationList: out.push({ t: "n", v: `${n.kind}:${n.flags & 7}` }); ts.forEachChild(n, visit); return;
      case K.ImportDeclaration: case K.ExportDeclaration:
        if (is_text(n.moduleSpecifier)) imports.push([start(n.moduleSpecifier) + 1, n.moduleSpecifier.end - start(n.moduleSpecifier) - 2]);
        break;
      case K.CallExpression:
        if (n.expression.kind === K.ImportKeyword && is_text(n.arguments[0])) imports.push([start(n.arguments[0]) + 1, n.arguments[0].end - start(n.arguments[0]) - 2]);
        break;
      default:
    }
    out.push({ t: "n", v: n.kind });
    ts.forEachChild(n, visit);
  }
  visit(sf);
  return { leaves: out, imports: imports.filter(([at, len]) => text.substr(at, len).startsWith(".")) };
}

/** For a string as it is written (between its quotes), where each character of its value starts: one entry a
 * character of the value, and the end. Null when the value read this way is not `value`. */
function written(raw, value) {
  const at = [];
  let i = 0, made = "";
  while (i < raw.length) {
    const c = raw[i];
    if (c !== "\\") { at.push(i); made += c; i += 1; continue; }
    const d = raw[i + 1];
    let len = 2, got;
    if (d === "x") { len = 4; got = String.fromCharCode(parseInt(raw.substr(i + 2, 2), 16)); }
    else if (d === "u" && raw[i + 2] === "{") { const end = raw.indexOf("}", i); len = end - i + 1; got = String.fromCodePoint(parseInt(raw.slice(i + 3, end), 16)); }
    else if (d === "u") { len = 6; got = String.fromCharCode(parseInt(raw.substr(i + 2, 4), 16)); }
    else if (d === "\r" && raw[i + 2] === "\n") { len = 3; got = ""; }
    else if (d === "\n" || d === "\r" || d === "\u2028" || d === "\u2029") got = "";
    else if (d >= "0" && d <= "7") { const m = /^[0-3][0-7]{0,2}|^[4-7][0-7]?/.exec(raw.slice(i + 1)); len = 1 + m[0].length; got = String.fromCharCode(parseInt(m[0], 8)); }
    else got = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v" }[d] ?? d;
    for (let k = 0; k < got.length; k++) at.push(i);
    made += got;
    i += len;
  }
  at.push(raw.length);
  return made === value ? at : null;
}

const common = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };

/** The swaps, ready to be found from the place two texts first differ. */
function finder(pairs) {
  const by_char = new Map(), loose = [];
  for (const [made, reals] of Object.entries(pairs)) {
    for (const real of reals) {
      const c = common(real, made), p = { real, made, c };
      if (c === real.length || c === made.length) loose.push(p);       // one opens the other: they part somewhere after
      else {
        const k = real[c] + made[c];
        if (!by_char.has(k)) by_char.set(k, []);
        by_char.get(k).push(p);
      }
    }
  }
  /** The swaps that turn `made` into `real`: [[at in made, lookalike, name], ...], or null when they do not explain it. */
  return function explain(made, real) {
    const whole = pairs[made];
    if (whole && whole.includes(real)) return [[0, made, real]];
    const out = [];
    let i = 0, j = 0;
    while (i < made.length || j < real.length) {
      if (i < made.length && j < real.length && made[i] === real[j]) { i++; j++; continue; }
      let best = null;
      const tries = (p, b) => {
        if (b > i || b > j || !made.startsWith(p.made, i - b) || !real.startsWith(p.real, j - b)) return;
        if (out.length && i - b < out[out.length - 1][0] + out[out.length - 1][1].length) return;      // it would run into the one before
        let agree = 0;
        const gi = i - b + p.made.length, rj = j - b + p.real.length;
        while (agree < 24 && gi + agree < made.length && made[gi + agree] === real[rj + agree]) agree++;
        if (gi + agree === made.length && rj + agree === real.length) agree = 25;
        const score = agree * 1000 + p.made.length + p.real.length;
        if (!best || score > best.score) best = { p, b, score };
      };
      for (const p of by_char.get((real[j] ?? "") + (made[i] ?? "")) || []) tries(p, p.c);
      for (const p of loose) for (let b = p.c; b <= p.c + 40; b++) tries(p, b);
      if (!best) return null;
      out.push([i - best.b, best.p.made, best.p.real]);
      i = i - best.b + best.p.made.length;
      j = j - best.b + best.p.real.length;
    }
    return out;
  };
}

/**
 * The list of names for a published script: `generic` its text, `real` the same script built with the source names,
 * `pairs` from pairs_of. Returns {names: what is published, problems: what could not be listed (the first few, in
 * words), spots, strings}. `names.complete` is false when something could not be listed: a skin then leaves the
 * site's own name there.
 */
export function names_map(ui, generic, real, pairs) {
  const ts = typescript(ui);
  const a = leaves(ts, generic), b = leaves(ts, real);
  const problems = [];
  const names = { format: Skin.FORMAT, length: generic.length, hash: Skin.hash(generic), complete: false, spots: [], imports: a.imports };
  if (a.leaves.length !== b.leaves.length) {
    problems.push(`the two scripts are not the same program (${a.leaves.length} pieces and ${b.leaves.length})`);
    return { names, problems };
  }
  const explain = finder(pairs);
  const marks = (made, name) => {
    const tag = Skin.tag(name);
    if ((pairs[made] || []).filter((r) => Skin.tag(r) === tag).length !== 1) problems.push(`two names of ${JSON.stringify(made)} share a mark`);
    if (!Skin.plain(name)) problems.push(`${JSON.stringify(name)} is not plain name text`);
    return tag;
  };
  let strings = 0;
  for (let i = 0; i < a.leaves.length; i++) {
    const g = a.leaves[i], r = b.leaves[i];
    const same_kind = g.t === r.t || (g.t === "prop" && r.t === "prop");
    if (!same_kind) { problems.push(`piece ${i} is a ${g.t} in one script and a ${r.t} in the other`); break; }
    if (g.v === r.v || g.t === "id") continue;
    if (g.t !== "str" && g.t !== "prop") { problems.push(`a ${g.t} differs: ${JSON.stringify(String(g.v).slice(0, 60))}`); continue; }
    strings++;
    const swaps = explain(g.v, r.v);
    if (!swaps) { problems.push(`no swap explains ${JSON.stringify(g.v.slice(0, 80))}`); continue; }
    if (g.form === "str") {
      const from = g.s + 1, raw = generic.slice(from, g.e - g.cut);
      const at = written(raw, g.v);
      if (!at) { problems.push(`a string is written in a way this does not read: ${JSON.stringify(raw.slice(0, 60))}`); continue; }
      for (const [k, made, name] of swaps) {
        const s = at[k], e = at[k + made.length];
        if (generic.slice(from + s, from + e).replace(/\\(['"])/g, "$1") !== made) { problems.push(`${JSON.stringify(made)} is written with an escape`); continue; }
        names.spots.push([from + s, e - s, marks(made, name), "s"]);
      }
    } else {
      if (swaps.length !== 1 || swaps[0][1] !== g.v) { problems.push(`a bare property name is only part of a swap: ${g.v}`); continue; }
      if (g.form === "short") { problems.push(`a name is a property written short: {${g.v}}`); continue; }
      const dot = g.form === "dot";
      if (dot && generic[g.s - 1] !== ".") { problems.push(`no dot before .${g.v}`); continue; }
      names.spots.push([dot ? g.s - 1 : g.s, dot ? g.e - g.s + 1 : g.e - g.s, marks(g.v, r.v), g.form === "id" ? "k" : "b"]);
    }
  }
  names.spots.sort((x, y) => x[0] - y[0]);
  names.complete = !problems.length;
  return { names, problems, strings };
}

/**
 * Proof of a list: `generic` with the names of `pairs` written in (as the browser writes them, Skin.apply) is `real`
 * piece for piece: the same syntax, numbers, strings and property names, and variables that differ only by a
 * one-to-one renaming. Returns the list of what differs (empty: proven).
 */
export function check_map(ui, generic, real, names, pairs) {
  const ts = typescript(ui);
  const made = Skin.apply(generic, names, Skin.lookup(pairs), null);
  const wrong = [];
  if (made.missed) wrong.push(`${made.missed} spots found no name`);
  const a = leaves(ts, made.text).leaves, b = leaves(ts, real).leaves;
  if (a.length !== b.length) return { wrong: [...wrong, `the scripts have ${a.length} and ${b.length} pieces`], spots: made.done, renamed: 0 };
  const to = new Map(), back = new Map();
  let renamed = 0;
  for (let i = 0; i < a.length && wrong.length < 10; i++) {
    const g = a[i], r = b[i];
    if (g.t !== r.t) { wrong.push(`piece ${i}: ${g.t} and ${r.t}`); continue; }
    if (g.t === "id") {
      if (!to.has(g.v) && !back.has(r.v)) { to.set(g.v, r.v); back.set(r.v, g.v); }
      if (to.get(g.v) !== r.v || back.get(r.v) !== g.v) renamed++;
    } else if (g.v !== r.v) wrong.push(`piece ${i}: ${JSON.stringify(String(g.v).slice(0, 60))} and ${JSON.stringify(String(r.v).slice(0, 60))}`);
  }
  return { wrong, spots: made.done, renamed };
}

// ---- the skin file --------------------------------------------------------------------------------------------

function* walk(dir, rel = "") {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
    if (e.isDirectory()) yield* walk(path.join(dir, e.name), `${rel}${e.name}/`);
    else yield `${rel}${e.name}`;
  }
}

/**
 * The skin that gives the published game the names and rosters of the project staged at `real` (tools/build_site.mjs
 * `stage`, without the swap). `generic`: the published game's data, {files: its paths in the pack's order, read};
 * `build`: tools/build_site.mjs; `maps`: the scrub's (new Maps(ROOT)).
 *
 *   files     what the game reads that differs: path -> text (the real project's)
 *   sources   what only the making of the teams reads (the rosters): path -> text
 *   pack      every path the game's data holds under this skin; `generated`: the ones the game makes itself, in the
 *             browser, from `sources` (so a skin outlives a change to how they are made)
 *   words     lookalike -> names, for the spots in the site's scripts
 *   base      a mark of the site's own data the skin was made beside (the browser says when the site has moved on)
 */
export function make(build, generic, real, maps, { id, name, commit }) {
  const read = (f) => fs.readFileSync(path.join(real, f), "utf8");
  const real_pack = build.game_files(read, (dir) => fs.readdirSync(path.join(real, dir)));
  // (the rosters are files like any other: a skin carries its own, and the browser makes only the league from them)
  const generated = build.GENERATED.filter((f) => real_pack.includes(f) && !build.ROSTERS.includes(f));
  const in_generic = new Set(generic.files);
  const files = {}, sources = {};
  for (const f of real_pack) {
    if (generated.includes(f)) continue;
    const text = read(f);
    if (!in_generic.has(f) || generic.read(f) !== text) files[f] = text;
  }
  const packed = new Set(real_pack);
  for (const top of ["data", "cfb_sim_data"]) {
    for (const rel of walk(path.join(real, top))) {
      const f = `${top}/${rel}`;
      if (f.endsWith(".json") && !packed.has(f) && !build.GENERATED.includes(f)) sources[f] = read(f);
    }
  }
  let base = Skin.hash("");
  for (const f of generic.files) if (!generated.includes(f)) base = Skin.hash(generic.read(f), Skin.hash(f, base));
  return {
    skin: "pocket-college-football", format: Skin.FORMAT, id, name, made: { commit, at: new Date().toISOString() },
    base, pack: real_pack, generated, words: pairs_of(maps), files, sources,
  };
}

/** The data pack's files (tools/build_site.mjs pack_bytes; ui/public/worker.js `unpack`): {files: paths, read}. */
export function unpack(bytes) {
  const index_length = bytes.readUInt32LE(8);
  const index = JSON.parse(bytes.subarray(12, 12 + index_length).toString("utf8"));
  const texts = new Map();
  let at = 12 + index_length;
  for (const [f, length] of index) {
    texts.set(f, bytes.subarray(at, at + length).toString("utf8"));
    at += length;
  }
  return { files: index.map(([f]) => f), read: (f) => texts.get(f), texts };
}
