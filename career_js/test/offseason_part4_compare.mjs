// career_js/offseason/part4.js against the Python it was ported from: node career_js/test/offseason_part4_compare.mjs OUTDIR
// (after python3 career_js/test/offseason_part4_reference.py OUTDIR). The part is loaded alone on the offseason namespace;
// every case the reference asked is asked here, in its order, on the same career, and the answer (or what was raised),
// and for the cases that change the career what they left, are compared exactly, key order included.
// Real here: the season, the league, the schedule maker, programs, the carousel's coach maker, shown ratings. Replayed
// from Python's record, call by call in Python's order (a call out of order or with other arguments fails the case): the
// other parts of offseason.py, recruiting, and prospects' and the carousel's views. Three small helpers of part 1
// (seed_key, _rng, house) are written out below as the Python has them.
import fs from "fs";
import os from "os";
import path from "path";
import { use_repo_files, tally } from "./compare_tools.mjs";
import { modules } from "../../engine_js/modules.js";
import { env } from "../../engine_js/files.js";
import { Random, parse_ordered, get, int } from "../../engine_js/pyrt.js";

const out = process.argv[2];
use_repo_files();
env.CFP_SEASONS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "seasons-"));
const setup = JSON.parse(fs.readFileSync(path.join(out, "setup.json"), "utf8"));
const deep = (o) => JSON.parse(JSON.stringify(o === undefined ? null : o));

// ----- Python's answers, call by call ---------------------------------------------------------------------------------
let R = null;       // the case being replayed: { state, calls, at }
function norm(a) {
  if (a === undefined) return null;
  if (a instanceof Random) return "<rng>";
  if (typeof a === "function") return "<fn>";
  if (a !== null && typeof a === "object" && !Array.isArray(a)) {
    if ("games" in a && "team" in a) return "<state>";
    if ("teams" in a && "attrs" in a) return "<league>";
    if ("coaches" in a || "roster" in a) return "<team>";
    if ("players" in a && "moves" in a) return "<portal>";
  }
  return a;
}
let on_start = null;
const replay = (name) => (...args) => {
  while (args.length && args[args.length - 1] === undefined) args.pop();
  const key = JSON.stringify(args.map(norm));
  const c = R.calls[R.at];
  if (!c || c[0] !== name || JSON.stringify(c[1]) !== key) {
    throw new Error(`${name}(${key.slice(0, 200)}) asked where Python asked ${c ? `${c[0]}(${JSON.stringify(c[1]).slice(0, 200)})` : "nothing more"}`);
  }
  R.at++;
  if (name === "recruiting.act") args[0]["recruiting"]["offers"][args[1]] = deep(c[3]);      // what the real one leaves
  if (name === "recruiting.start" && on_start) on_start(args[0]);
  return deep(c[2]);
};
const stub = (mod, names) => Object.fromEntries(names.map((n) => [n, replay(`${mod}.${n}`)]));

// ----- the namespace as the other parts leave it ----------------------------------------------------------------------
const { offseason } = await import("../offseason_ns.js");
Object.assign(offseason, setup.offseason);
offseason.ReviewError = class ReviewError extends Error { constructor(code, message) { super(message); this.code = code; } };
offseason.seed_key = (state) => (get(state, "seed") !== null ? state["seed"] : state["id"]);
offseason._rng = (state, what) => new Random(`offseason-${offseason.seed_key(state)}-${get(state, "year", 2026)}-${what}`);
offseason.house = (pos, ovr) => int(ovr);
Object.assign(offseason, stub("offseason", ["_retention_view", "open_spots", "churn_left", "my_spots", "playing_time", "expiring", "term_of",
  "_record", "fill_roles", "review_decide", "_resolve_retention", "_run_draft", "_apply_redshirts", "_open_portal", "_close_portal",
  "_develop_all", "_fill_rosters", "_develop_coaches", "resolve_round", "_close_portal_rounds", "_staff_changes", "_apply_staff", "start"]));
modules.recruiting = { ...setup.recruiting, reset_caches: () => null, school_name: () => { throw new Error("school_name is only handed on"); },
  ...stub("recruiting", ["is_portal", "weekly_step", "portal_spots", "offer_cap", "pool_record", "lost_line", "lost_reason", "shown_range",
    "no_room", "ask_from", "use_league_models", "_baseline", "act", "start"]) };
for (const f of ["../clear.js", "../promises.js", "../programs.js", "../grades.js", "../coach_names.js", "../word.js", "../ability_goals.js",
  "../headquarters.js", "../office.js", "../../sim_js/grade.js", "../../sim_js/form.js", "../../sim_js/schedule_gen.js", "../../sim_js/season.js"]) {
  await import(f);
}
const season = modules.season;
const { league } = await import("../league.js");
const { carousel } = await import("../carousel.js");
const { prospects } = await import("../prospects.js");
Object.assign(carousel, stub("carousel", ["goal", "job_rows", "market_rows", "run"]));
Object.assign(prospects, stub("prospects", ["seen_status", "_schools", "standing", "class_rank"]));
await import("../offseason/part4.js");
league.CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leagues-"));

const t = tally();
// the part's own constants
t.same("KIND_NAMES, RECAP_MOVES, RECAP_STAGES", setup.names, { KIND_NAMES: offseason.KIND_NAMES, RECAP_MOVES: offseason.RECAP_MOVES, RECAP_STAGES: offseason.RECAP_STAGES });
t.same("PT_NAMES", setup.PT_NAMES.map(([, v]) => v), setup.PT_NAMES.map(([k]) => offseason.PT_NAMES[k]));

const coach_side = (st) => {
  const off = st.offseason, lgd = st.league;
  return Object.fromEntries([st.team, get(off, "move_to")].filter((s) => s).map((s) => [s, { head_coach: lgd.teams[s].coaches.head_coach,
    style: get(lgd.teams[s], "style"), security: get(get(lgd.teams[s], "ad") || {}, "security") }]));
};
const AFTER = {
  draft: (st) => ({ draft: get(st.offseason, "draft"), stage: get(st.offseason, "stage"), departures: get(st.offseason, "departures") }),
  old: (st) => get(st, "offseason"),
  choice: (st) => st.offseason.carousel,
  moves: (st) => ({ league: get(st.league, "conference_moves"), log: get(st.offseason, "conference_moves") }),
  schedule: (st) => ({ changes: st.offseason.next_schedule.changes,
    games: Object.entries(st.offseason.next_schedule.games).map(([e, g]) => [e, g.home, g.away, g.week]) }),
  legacy_offers: (st) => get(st.offseason.portal.offers, st.team),
  retention: (st) => ({ stage: st.offseason.stage }),
  departures: (st) => ({ stage: st.offseason.stage }),
  portal_week: (st) => ({ stage: st.offseason.stage, week: st.recruiting.week }),
  portal_last: (st) => ({ stage: st.offseason.stage }),
  portal_round: (st) => ({ stage: st.offseason.stage, round: st.offseason.portal.round }),
  report: (st) => ({ stage: st.offseason.stage, report: st.offseason.report }),
  development: (st) => ({ stage: st.offseason.stage, carousel: st.offseason.carousel, staff: st.offseason.staff, coaching_changes: st.offseason.coaching_changes }),
  staff: (st) => ({ stage: st.offseason.stage, changes: st.offseason.staff.changes, roles_filled: st.offseason.roles_filled,
    move_to: get(st.offseason, "move_to"), coaching_changes: st.offseason.coaching_changes, sides: coach_side(st) }),
  conferences: (st) => ({ stage: st.offseason.stage, next_schedule: st.offseason.next_schedule }),
  stage: (st) => ({ stage: st.offseason.stage }),
  career: (st) => ({ career: Object.fromEntries(Object.entries(st.career).filter(([k]) => k !== "saved_at")), year: st.league.year,
    schedule_history: get(st.league, "schedule_history") }),
};

function run(c, st) {
  const off = get(st, "offseason");
  const args = c.args.map((a) => (a === "<state>" ? st : a !== null && typeof a === "object" && !Array.isArray(a) && a["@"] ? a["@"].reduce((d, k) => d[k], st) : a));
  const lgd = get(st, "league");
  switch (c.label) {
    case "page (odd values)": return args[0].map((x) => offseason.page(x));
    case "_stayed (teams)": return args[0].map((s) => offseason._stayed(off, lgd.teams[s].roster));
    case "_new_transfer (teams)": return args[0].map((s) => lgd.teams[s].roster.map((p) => offseason._new_transfer(off, p, s)));
    case "player_next (players)": return args[0].map((x) => offseason.player_next(st, x));
    case "_player_next (players)": return args[0].map((x) => offseason._player_next(st, x));
    case "_school_name (slugs)": return args[0].map((x) => offseason._school_name(st, x));
    case "advance refused: the AD is waiting": {
      const rv = off.review, was = rv.decided;
      rv.decided = false; off.auto = false;
      try { return offseason.advance(st); } finally { rv.decided = was; off.auto = true; }
    }
    default: break;
  }
  const got = offseason[c.fn](...args);
  if (c.fn === "_your_jobs") return [...got].sort();
  if (c.fn === "advance") return got.stage;
  if (c.fn === "next_season") return null;
  return got;
}

const byCareer = {};
for (const s of setup.stages) {
  const text = fs.readFileSync(path.join(out, s.file), "utf8");
  const data = parse_ordered(text, [["state", "games"], ["state", "offseason", "next_schedule", "games"]]);
  const st = data.state;
  if (s.league_file) {
    const p = league.path(st.id, get(st, "year"));
    if (!fs.existsSync(p)) fs.copyFileSync(path.join(out, s.league_file), p);
    season.use_league(p);
  } else season.use_league(null);
  let bad = 0;
  for (const c of data.cases) {
    R = { state: st, calls: c.calls, at: 0 };
    let made = null;
    on_start = (n) => { made = deep(Object.fromEntries(Object.entries(n).filter(([k]) => !["league", "career", "my_boxes"].includes(k)))); };
    let got;
    try {
      got = { out: deep(run(c, st)) };
    } catch (e) {
      const type = e.constructor.name;
      if (!["ValueError", "KeyError", "OverflowError", "ConferenceError", "ReviewError", "ScheduleError"].includes(type) || !("error" in c)) {
        got = { crashed: String(e.stack || e).split("\n").slice(0, 4).join(" | ") };
      } else got = { error: { type, message: e.message, code: e.code === undefined ? null : e.code } };
    }
    const want = "error" in c ? { error: c.error } : { out: c.out };
    const name = `${s.file} ${c.label}`;
    let ok = t.same(name, want, got);
    if (R.at !== c.calls.length && !("crashed" in got)) ok = t.same(`${name}: calls made`, c.calls.length, R.at) && ok;
    if (c.after && !("crashed" in got)) ok = t.same(`${name}: after (${c.after[0]})`, c.after[1], AFTER[c.after[0]](st)) && ok;
    if (c.new) ok = t.same(`${name}: the new season`, c.new, made) && ok;
    if (!ok) bad++;
    if (c.fn === "next_season" && !("error" in c)) season.use_league(s.league_file ? league.path(st.id, get(st, "year")) : null);
  }
  byCareer[s.career] = (byCareer[s.career] || 0) + data.cases.length;
  console.log(`${s.file}: ${data.cases.length} cases${bad ? `, ${bad} DIFFERENT` : ""}`);
}
t.done("offseason part 4");
