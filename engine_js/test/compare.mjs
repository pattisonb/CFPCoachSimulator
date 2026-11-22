// The JavaScript engine against the Python engine's own games (tools/engine_reference.py writes them):
//   node engine_js/test/compare.mjs reference.json            every game, what differs
//   node engine_js/test/compare.mjs reference.json --trace 3 [--stack 1234]
//       game 3's random draws, one a line (which generator, which call, the value), to lay beside
//       tools/engine_trace.py's; --stack prints where draw 1234 was asked for
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Random, random } from "../pyrt.js";
import { cfg } from "../game_config.js";
import { simulate_game } from "../index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const ref = JSON.parse(fs.readFileSync(args[0], "utf8"));
const teams = JSON.parse(fs.readFileSync(path.join(ROOT, ref.teams_file), "utf8")).teams;
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const NOT_THE_GAME = new Set(["id", "played_at", "duration_ms"]);

function diff(a, b, at, out, close) {
  if (out.length > 40) return;
  if (typeof a === "number" && typeof b === "number") {
    if (a === b || Object.is(a, b)) return;
    if (Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) { close.n++; return; }
    out.push(`${at}: python ${a}, js ${b}`);
  } else if (typeof a === "boolean" && typeof b === "number" || typeof a === "number" && typeof b === "boolean") {
    if (Number(a) !== Number(b)) out.push(`${at}: python ${a}, js ${b}`);
  } else if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    if (a !== b) out.push(`${at}: python ${JSON.stringify(a)}, js ${JSON.stringify(b)}`);
  } else if (Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${at}: python ${Array.isArray(a) ? "list" : "dict"}, js ${Array.isArray(b) ? "list" : "dict"}`);
  } else if (Array.isArray(a)) {
    if (a.length !== b.length) out.push(`${at}: python ${a.length} items, js ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${at}[${i}]`, out, close);
  } else {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) out.push(`${at}.${k}: only in js (${JSON.stringify(b[k])?.slice(0, 60)})`);
      else if (!(k in b) || b[k] === undefined) out.push(`${at}.${k}: only in python (${JSON.stringify(a[k])?.slice(0, 60)})`);
      else diff(a[k], b[k], `${at}.${k}`, out, close);
    }
  }
}

const play = (g) => {
  const r = simulate_game(teams[g.home], teams[g.away], null, g.seed, g.venue, g.momentum);
  const out = JSON.parse(JSON.stringify(r));
  for (const k of NOT_THE_GAME) delete out[k];
  return out;
};

if (flag("--trace") !== null) {
  const which = Number(flag("--trace")), stackAt = flag("--stack") === null ? -1 : Number(flag("--stack"));
  // the games before it are played first: the Python reference played them in the same process
  for (const g of ref.games.slice(0, which)) play(g);
  const lines = [];
  const names = new Map([[random, "random"], [cfg.stat_rng, "stat"], [cfg.injury_rng, "injury"]]);
  for (const m of ["random", "randint", "choice", "choices", "gauss", "uniform", "gammavariate", "randrange"]) {
    const real = Random.prototype[m];
    Random.prototype[m] = function (...a) {
      const depth = (this.__depth = (this.__depth || 0) + 1);
      let v;
      try { v = real.apply(this, a); } finally { this.__depth--; }
      if (depth === 1) {
        if (lines.length === stackAt) console.error(`draw ${stackAt}: ${names.get(this)}.${m} ->`, v, "\n", new Error().stack.split("\n").slice(2, 9).join("\n"));
        lines.push(`${names.get(this) || "?"}.${m} ${typeof v === "number" ? v : JSON.stringify(Array.isArray(v) ? v.map((x) => (x && x.name) || x) : (v && v.name) || v)}`);
      }
      return v;
    };
  }
  play(ref.games[which]);
  fs.writeFileSync(flag("--out") || "/dev/stdout", lines.join("\n") + "\n");
} else {
  let same = 0, close = { n: 0 };
  const t = Date.now();
  ref.games.forEach((g, i) => {
    let out = [];
    try { diff(g.result, play(g), "", out, close); } catch (err) { out = [`threw: ${err && err.stack ? err.stack.split("\n").slice(0, 4).join(" | ") : err}`]; }
    if (!out.length) same++;
    else if (same + 1 <= i + 1 && out.length) console.log(`game ${i} (seed ${g.seed}, ${g.home} v ${g.away}): ${out.length > 40 ? "40+" : out.length} differences\n  ` + out.slice(0, Number(flag("--show") || 6)).join("\n  "));
  });
  console.log(`${same} of ${ref.games.length} games identical (${close.n} numbers differ only in the last places), ${((Date.now() - t) / ref.games.length).toFixed(1)} ms a game`);
  process.exit(same === ref.games.length ? 0 : 1);
}
