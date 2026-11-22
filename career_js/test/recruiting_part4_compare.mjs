// career_js/recruiting/part4.js held to Python's answers, one call at a time:
//   node career_js/test/recruiting_part4_compare.mjs OUT     (after recruiting_part4_reference.py OUT)
//
// The part is loaded alone on the recruiting namespace. The Python wrote one stream (ops.jsonl): the state the part
// reads, then "cases" (one call of one of the part's functions each) and "digests". This script keeps that state itself
// and replays the stream in order. In a case every call out of the part (another part of the recruiting file, persona,
// word, programs, the season) is a stub that must be asked in Python's order with Python's arguments, checks that the
// part's own edits so far are the ones Python's made, applies the edits that call made in Python and gives Python's
// answer. The case's answer must be Python's, and at a digest the whole state must hash as Python's did.
// Small pure helpers of the other parts are written out here (tier_of, _group_of, need_factor, group_cap, _ck) and so
// is _pair_ok, which calls back into the part's _Room.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import readline from "readline";
import { use_repo_files } from "./compare_tools.mjs";
import { modules } from "../../engine_js/modules.js";
import { Random, odict, is_odict, json_dumps, get, truthy } from "../../engine_js/pyrt.js";
import { recruiting } from "../recruiting_ns.js";

use_repo_files();
await import("../recruiting/part4.js");

const out = process.argv[2];
const setup = JSON.parse(fs.readFileSync(path.join(out, "setup.json"), "utf8"));
const CLOSE = 1e-12;                              // a fit's last digit (exp, sin, cos, asin: PORTING.md)
const CLOSE_FNS = new Set(["_fits", "probe_redo"]);

// ----- values ---------------------------------------------------------------------------------------------------------------

const BLOBS = new Map();
for (const line of fs.readFileSync(path.join(out, "blobs.jsonl"), "utf8").split("\n")) {
  if (line) { const b = JSON.parse(line); BLOBS.set(b.id, b.value); }
}
const blob_cache = new Map();
let state = null;

const at = (p) => p.reduce((o, k) => o[k], state);

/** A value as the Python wrote it: marked dicts as odicts, sets, places in the state, big answers by their hash. */
function dec(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(dec);
  if ("$od" in v) return odict(v.$od.map(([k, x]) => [k, dec(x)]));
  if ("$set" in v) return new Set(v.$set);
  if ("$ref" in v) return at(v.$ref);
  if ("$rng" in v) { const r = new Random(0); r.mt.set(v.$rng[0]); r.index = v.$rng[1]; r.gaussNext = v.$rng[2]; return r; }
  if ("$blob" in v) {
    if (!blob_cache.has(v.$blob)) blob_cache.set(v.$blob, dec(BLOBS.get(v.$blob)));
    return blob_cache.get(v.$blob);
  }
  const o = {};
  for (const k of Object.keys(v)) o[k] = dec(v[k]);
  return o;
}

/** A JavaScript value in the shape `dec` gives Python's, for comparing. */
function norm(v) {
  if (v === undefined) return null;
  if (v instanceof Random) return { $rng: [Array.from(v.mt), v.index, v.gaussNext] };
  if (v instanceof Set) return { $set: [...v].sort() };
  return v;
}

const failures = [];
let close_count = 0;
function fail(where, text) {
  if (failures.length < 40) failures.push(`${where}: ${text}`);
  if (process.env.SAY) console.log(`${where}: ${text}`.slice(0, 600));
  fail.count = (fail.count || 0) + 1;
}

/** Python's value against the JavaScript's, key order included. Returns the first difference or null. */
function differ(a, b, where, close) {
  b = norm(b);
  if (a instanceof Set) a = { $set: [...a].sort() };
  if (a instanceof Random) a = norm(a);
  if (a === b) return null;
  if (typeof a === "function" && typeof b === "function") return null;
  if (close && typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= close * Math.max(1, Math.abs(a), Math.abs(b))) { close_count++; return null; }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) {
    return `${where}: py ${String(JSON.stringify(a)).slice(0, 100)} | js ${String(JSON.stringify(b)).slice(0, 100)}`;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${where}: length py ${a.length} | js ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = differ(a[i], b[i], `${where}[${i}]`, close); if (d) return d; }
    return null;
  }
  const ka = Object.keys(a), kb = Object.keys(b).filter((k) => b[k] !== undefined);
  if (ka.join("\u0001") !== kb.join("\u0001")) {
    const sa = new Set(ka), sb = new Set(kb);
    const only_py = ka.filter((k) => !sb.has(k)), only_js = kb.filter((k) => !sa.has(k));
    return only_py.length || only_js.length ? `${where}: keys only py [${only_py.slice(0, 6)}] only js [${only_js.slice(0, 6)}]`
      : `${where}: key order differs (py ${ka.slice(0, 8)} | js ${kb.slice(0, 8)})`;
  }
  for (const k of ka) { const d = differ(a[k], b[k], `${where}/${k}`, close); if (d) return d; }
  return null;
}

// ----- the state's edits ----------------------------------------------------------------------------------------------------

const NUMKEY = /^(0|[1-9]\d*)$/;

/** Apply Python's edits. A number-like key set into a plain object makes it an odict first (its order so far is right). */
function apply(ops) {
  for (const op of ops) {
    const p = op[1];
    if (!p.length) throw new Error("an edit of the whole state");
    let parent = state, holder = null, hk = null;
    for (let i = 0; i < p.length - 1; i++) { holder = parent; hk = p[i]; parent = parent[p[i]]; }
    const k = p[p.length - 1];
    if (parent === undefined || parent === null) throw new Error(`an edit with nowhere to go: ${JSON.stringify(op).slice(0, 200)}`);
    if (op[0] === "del") delete parent[k];
    else if (op[0] === "ext") parent[k].push(...dec(op[2]));
    else {
      if (NUMKEY.test(k) && !Array.isArray(parent) && !is_odict(parent) && holder !== null && !(k in parent)) {
        parent = holder[hk] = odict(Object.entries(parent));
      }
      parent[k] = dec(op[2]);
    }
  }
}

/** The part's own edits, as Python's part made them: the JavaScript's state must already show each. */
function verify(ops, where) {
  for (const op of ops) {
    const p = op[1];
    let parent = state, ok = true;
    for (let i = 0; i < p.length - 1; i++) { parent = parent === null || parent === undefined ? undefined : parent[p[i]]; }
    const k = p[p.length - 1];
    const here = `${where} ${p.join("/")}`;
    if (parent === undefined || parent === null) { fail(here, "nothing there in the JavaScript's state"); ok = false; }
    else if (op[0] === "del") { if (parent[k] !== undefined) { fail(here, `still there: ${JSON.stringify(parent[k]).slice(0, 80)}`); ok = false; } }
    else if (op[0] === "ext") {
      const tail = dec(op[2]), mine = parent[k];
      if (!Array.isArray(mine) || mine.length !== op[3]) { fail(here, `list length py ${op[3]} | js ${mine && mine.length}`); ok = false; }
      else { const d = differ(tail, mine.slice(mine.length - tail.length), here); if (d) { fail("own", d); ok = false; } }
    } else {
      const d = differ(dec(op[2]), parent[k], here);
      if (d) { fail("own", d); ok = false; }
    }
    if (!ok) { try { apply([op]); } catch (e) { /* the place itself is missing: the next digest says so */ } }
  }
}

// ----- the names the part reaches ---------------------------------------------------------------------------------------------

class RecruitingError extends Error {
  constructor(code, message) { super(message); this.code = code; this.message = message; }
}
recruiting.RecruitingError = RecruitingError;
for (const [k, v] of Object.entries(setup.constants)) recruiting[k] = v;

let current = null;       // the case being replayed: {rec, i, where}

function stub(label) {
  return (...args) => {
    const c = current;
    if (!c) throw new Error(`${label} asked outside a case`);
    const call = c.rec.calls[c.i];
    const where = `${c.where} call ${c.i} ${label}`;
    if (!call || call.f !== label) {
      throw new Error(`${where}: Python asked ${call ? call.f : "nothing more"} here (${call ? JSON.stringify(call.a).slice(0, 120) : ""})`);
    }
    c.i++;
    call.a.forEach((e, i) => {
      if (e === "$o" || args[i] === undefined) return;
      const a = args[i];
      if (a !== e && !(typeof a === "object" && a !== null)) fail(where, `argument ${i}: py ${JSON.stringify(e)} | js ${JSON.stringify(a)}`);
      else if (typeof a === "object" && a !== null && e !== "$o") fail(where, `argument ${i}: py ${JSON.stringify(e)} | js an object`);
    });
    if (call.own) verify(call.own, where);
    if (call.patch) apply(call.patch);
    if (call.x) throw new RecruitingError(call.x[0], call.x[1]);
    return dec(call.r);
  };
}

const OUT_REC = ("not_considering _pester_exempt cooled _grade_points _contact_points _team_model model needs _tiers open_spots is_portal _p4 "
  + "academic manual_offers _coach_edge offer_cap _winning commits_by_group is_generational offers_by_group group_full "
  + "portal_upgrade best_pitch would_pester _logistic top_group strengths auto_mode portal_room _interp interest "
  + "early_signing_week _contact ask_from _nil nil_left _hours _act _add_points _unmark _hat").split(" ");
for (const n of OUT_REC) recruiting[n] = stub(`recruiting.${n}`);
const persona = { ...setup.persona };
for (const n of ("pester_free board_front scared_off ai_doubts mate start_firmness quiet_mark decommit_mult counts_as_priority climbs of "
  + "needs_attention _school_name style note_contact set_cooled_why").split(" ")) persona[n] = stub(`persona.${n}`);
modules.persona = persona;
modules.scenes = { ...setup.scenes };
modules.word = { recruit_event: stub("word.recruit_event") };
modules.programs = { get: stub("programs.get") };
modules.season = { load_teams: stub("season.load_teams") };

// the other parts' small pure helpers, written out (coach_career/recruiting.py)
recruiting.tier_of = (p) => {
  if (get(p, "stars") !== null) return p["stars"];
  return get(p, "tier") || recruiting.TIER_FROM_OVERALL.find(([from, t]) => p["ovr"] >= from)[1];
};
recruiting._group_of = (p) => {
  let g = get(p, "group");
  if (g === null) g = p["group"] = get(setup.group, p["ea_position"], "S");
  return g;
};
recruiting.need_factor = (need) => {
  for (const [from, factor] of recruiting.NEED_FACTOR) if (need >= from) return factor;
  return recruiting.NEED_FLOOR;
};
recruiting.group_cap = (need, group) => (recruiting.ONE_A_CLASS.includes(group) ? Math.max(1, need[group]) : need[group] + 1);
recruiting._ck = (rc) => get(rc, "cache_key") || rc["year"];
recruiting._pair_ok = (st, slug, pid, offered, room) => {
  const mate = modules.persona.mate(st, pid);
  if (!truthy(mate)) return true;
  const ms = st["recruiting"]["status"][mate];
  if (truthy(ms["signed"])) return ms["signed"] === slug;
  if (ms["committed"] === slug) return true;
  if (truthy(get(ms, "hard")) || !Array.from(get(offered, mate, [])).includes(slug)) return false;
  room.took(slug, pid);                                 // room for both: him first, then his mate
  const ok = room(slug, mate);
  room.took(slug, pid, -1);
  return ok;
};

// ----- what is asked directly that is not one function of the part (as in the reference) -----------------------------------

const PROBES = {
  probe_room(st, flier, steps) {
    const room = recruiting._Room(st, flier);
    const got = [];
    for (const s of steps) {
      if (s[0] === "why") got.push(room.why_not(s[1], s[2], s[3]));
      else if (s[0] === "call") got.push(room(s[1], s[2]));
      else { room.took(s[1], s[2], s[3]); got.push(null); }
    }
    return { got, commits: room.commits, groups: room.groups, slack: room.slack, yours: room.yours, portal: room.portal };
  },
  probe_rng(st, what) {
    const r = recruiting._rng(st, what);
    return [r.random(), r.random(), r.randint(1, 1000)];
  },
  probe_redo(st, slugs, pid, stars) {
    const rc = st["recruiting"], p = rc["prospects"][pid];
    const was = p["stars"], had = "class_v" in rc, v = get(rc, "class_v", 0);
    const first = slugs.map((s) => recruiting._fits(st, s)[pid]);
    p["stars"] = stars; rc["class_v"] = v + 1;
    try {
      return [first, Object.fromEntries(slugs.map((s) => [s, recruiting._fits(st, s)])), recruiting._fits(st, slugs[0]) === recruiting._FITS[1][slugs[0]]];
    } finally {
      p["stars"] = was;
      if (had) rc["class_v"] = v; else delete rc["class_v"];
    }
  },
  probe_shares: () => [2, 3, 4, 5].map((n) => recruiting._national_share(n)),
};

// ----- the stream ---------------------------------------------------------------------------------------------------------------

const counts = {}, bad = {};
let n = 0, digests = 0, digests_ok = 0, calls = 0;
const t0 = Date.now();
const lines = readline.createInterface({ input: fs.createReadStream(path.join(out, "ops.jsonl")), crlfDelay: Infinity });
for await (const line of lines) {
  if (!line) continue;
  const rec = JSON.parse(line);
  if (rec.t === "init") {
    state = dec(rec.state);
    recruiting._FITS = [null, {}, null, null, {}];
    continue;
  }
  apply(rec.sync);
  if (rec.t === "digest") {
    digests++;
    const sha = crypto.createHash("sha1").update(json_dumps(state)).digest("hex");
    if (sha === rec.sha) digests_ok++;
    else {
      fail(`digest ${rec.label}`, "the state after the week's step is not Python's");
      const full = path.join(out, `full_${rec.label}.json`);
      if (fs.existsSync(full)) {
        const d = differ(JSON.parse(fs.readFileSync(full, "utf8")), JSON.parse(JSON.stringify(state)), "");
        console.log(`  digest ${rec.label}: ${d}`);
      }
    }
    continue;
  }
  n++;
  counts[rec.fn] = (counts[rec.fn] || 0) + 1;
  const where = `case ${n} ${rec.fn}`;
  const before = fail.count || 0;
  current = { rec, i: 0, where };
  recruiting._FITS = [null, {}, null, null, {}];       // as the reference: no fits kept from an earlier case
  const args = rec.args.map((a) => (a === "$state" ? state : dec(a)));
  let result = null, raised = null;
  try {
    const fn = PROBES[rec.fn] || recruiting[rec.fn];
    result = fn(...args);
  } catch (err) {
    if (err instanceof RecruitingError) raised = [err.code, err.message];
    else fail(where, String(err && err.stack ? err.stack.split("\n").slice(0, 3).join(" | ") : err));
  }
  calls += current.i;
  if (current.i !== rec.calls.length) fail(where, `asked ${current.i} of Python's ${rec.calls.length} calls (next: ${rec.calls[current.i].f})`);
  current = null;
  if (rec.raise || raised) {
    const d = differ(rec.raise || null, raised, `${where} raised`);
    if (d) fail("raise", d);
  } else {
    const d = differ(dec(rec.result), result, `${where} result`, CLOSE_FNS.has(rec.fn) ? CLOSE : 0);
    if (d) fail("result", d);
  }
  verify(rec.own, `${where} after`);
  if ((fail.count || 0) > before) bad[rec.fn] = (bad[rec.fn] || 0) + 1;
}

console.log(`cases: ${n} (${calls} calls out of the part replayed), ${Object.keys(bad).length ? "FAILED in " + JSON.stringify(bad) : "all the same as Python"}`);
console.log(Object.entries(counts).sort().map(([k, v]) => `${k} ${v}`).join(", "));
console.log(`digests: ${digests_ok} of ${digests} the same; fits within ${CLOSE} of Python's but not equal: ${close_count}; ${((Date.now() - t0) / 1000).toFixed(0)}s`);
for (const f of failures) console.log("  " + f);
if (fail.count) { console.log(`${fail.count} differences`); process.exit(1); }
