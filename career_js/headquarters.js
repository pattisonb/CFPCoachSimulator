// Headquarters: the player's own dashboard of recruiting and scouting widgets (spec
// docs/superpowers/specs/2026-11-07-headquarters-design.md). The page owns the widgets; this module keeps
// the layout in the career save and computes the two reads no other view has: your commits by week and this
// week's movers on your board. Nothing here touches the season sim (the layout is outside the golden digest).
//
// It was coach_career/headquarters.py; engine_js/PORTING.md has the rules it was ported by. Modules reached through
// `modules`: recruiting, offseason, season, prospects (class_rc, class_table, class_points, class_rank), promises,
// programs. What could not be written literally is listed at the end of this file.
import { int, sum, cmp, sorted, range, get, truthy } from "../engine_js/pyrt.js";
import { modules } from "../engine_js/modules.js";
import { shown as _shown } from "../teamdata_js/shown.js";

/** isinstance(v, dict) / isinstance(v, str) / isinstance(v, int) with a bool left out, as the checks here want it. */
const is_dict = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const is_str = (v) => typeof v === "string";
const is_whole = (v) => typeof v === "number" && Number.isInteger(v);
/** len(text): Python counts characters, not UTF-16 units. */
const len = (text) => [...text].length;
/** str.strip(): Python's own white space (it has four separators JavaScript's trim leaves, and leaves U+FEFF, which trim takes). */
const PY_SPACE = "\\t\\n\\x0b\\x0c\\r\\x1c\\x1d\\x1e\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const STRIP = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, "g");
const strip = (text) => text.replace(STRIP, "");
/** `x in coll` for a module's constant that may have been ported as a Set, a list or a dict. */
const contains = (coll, x) => (coll instanceof Set ? coll.has(x) : Array.isArray(coll) ? coll.includes(x) : x in coll);

const HQ_MAX_CARDS = 40;       // *tune* the most cards a Headquarters holds
const CARD_H = [120, 1600];    // *tune* the shortest and tallest height (px) a player may give a card; none is Auto
const MOVERS_SHOWN = 5;        // *tune* risers and fallers each the Hot and Cold Movers widget gets
const SIZES = ["S", "M", "L"];
const _ID = /^[a-z0-9-]{1,40}\n?$/;      // (Python's `$` also matches before a last newline)

/** A layout of the wrong shape; nothing was stored. */
export class LayoutError extends Error {
  constructor(message) {
    super(message);
    this.message = message;
  }
}

export function layout(state) {
  // The saved layout: {"cards": [{"id", "widget", "size"}, ...]}; an old save without one reads empty.
  const hq = get(get(state, "career") || {}, "headquarters") || {};
  return { "cards": (get(hq, "cards") || []).map((c) => ({ ...c })) };
}

export function set_layout(state, cards) {
  // Check the shape and store the layout. The widget ids are not checked against a list: the page owns the
  // widgets, and a newer page's widget in an older save is kept.
  if (!Array.isArray(cards)) throw new LayoutError("The layout must be a list of cards.");
  if (cards.length > headquarters.HQ_MAX_CARDS) throw new LayoutError(`A Headquarters holds at most ${headquarters.HQ_MAX_CARDS} widgets.`);
  const seen = new Set(), out = [];
  const CARD_H = headquarters.CARD_H;
  for (const c of cards) {
    if (!is_dict(c)) throw new LayoutError("Each card must have an id, a widget and a size.");
    const cid = get(c, "id"), widget = get(c, "widget"), size = get(c, "size");
    if (!(is_str(cid) && headquarters._ID.test(cid)) || !(is_str(widget) && headquarters._ID.test(widget))) {
      throw new LayoutError("Card and widget ids are short lowercase words with dashes.");
    }
    if (!headquarters.SIZES.includes(size)) throw new LayoutError("A widget's size is S, M or L.");
    if (seen.has(cid)) throw new LayoutError("Each card id appears once.");
    const h = get(c, "h");
    if (h !== null && (typeof h === "boolean" || !is_whole(h) || !(CARD_H[0] <= h && h <= CARD_H[1]))) {
      throw new LayoutError(`A card's height is Auto or ${CARD_H[0]} to ${CARD_H[1]} pixels.`);
    }
    seen.add(cid);
    out.push({ "id": cid, "widget": widget, "size": size, ...(h !== null ? { "h": h } : {}) });
  }
  headquarters._hq(state)["cards"] = out;
  return headquarters.layout(state);
}

export function _committed_now(state, me) {
  // Your commits in the live recruiting block (the class, or the portal in its weeks), as the board counts them.
  const rc = state["recruiting"];
  return sum(Object.values(rc["status"]).filter((s) => get(s, "committed") === me).map(() => 1));
}

export function commits_by_week(state) {
  // Your commits week by week from the recruiting log: [{"week", "gained", "lost", "total"}], a row for
  // every week from the first to now (the portal's weeks in the portal). A commit or a flip to you is gained,
  // a decommit from you lost; what you held before the log began counts in the first week's total, so the
  // last total is exactly your commits now.
  const rc = state["recruiting"], me = state["team"];
  const portal = truthy(get(rc, "portal"));
  const now = int((portal ? get(rc, "week") : get(state, "current_week")) || 0);
  const gained = new Map(), lost = new Map();        // week (a whole number) -> how many
  for (const e of get(rc, "log") || []) {
    if (get(e, "school") !== me) continue;
    let w = portal ? get(e, "portal_week") : get(e, "week");
    if (w === null) continue;
    w = int(w);
    if (["commit", "flip"].includes(get(e, "kind"))) gained.set(w, (gained.get(w) ?? 0) + 1);
    else if (get(e, "kind") === "decommit") lost.set(w, (lost.get(w) ?? 0) + 1);
  }
  const first = Math.min(now >= 1 ? 1 : 0, ...gained.keys(), ...lost.keys());
  const last = Math.max(now, ...gained.keys(), ...lost.keys());
  const start = Math.max(0, headquarters._committed_now(state, me) - (sum(gained.values()) - sum(lost.values())));
  const rows = [];
  let total = start;
  for (const w of range(first, last + 1)) {
    const g = gained.get(w) ?? 0, l = lost.get(w) ?? 0;
    total += g - l;
    rows.push({ "week": w, "gained": g, "lost": l, "total": Math.max(0, total) });
  }
  return rows;
}

export function movers(state) {
  // This week's risers and fallers on your board, from the latest weekly report: your place on his list
  // now against a week ago. {"up": [...], "down": [...]}, MOVERS_SHOWN each, most places moved first. The
  // page shows them with your standing in words, never the place itself.
  const report = modules.recruiting.latest_report(state);
  const up = [], down = [];
  for (const r of get(report || {}, "rows") || []) {
    const rank = get(r, "rank"), prev = get(r, "prev_rank");
    if (rank === null || prev === null || rank === prev) continue;
    const row = { "pid": r["pid"], "name": r["name"], "position": r["position"], "stars": r["stars"], "places": Math.abs(prev - rank) };
    (rank < prev ? up : down).push(row);
  }
  const key = (x) => [-x["places"], x["name"]];
  return { "up": sorted(up, key).slice(0, headquarters.MOVERS_SHOWN), "down": sorted(down, key).slice(0, headquarters.MOVERS_SHOWN) };
}

// ----- round 2: the reads behind the planned widgets (spec "Round 2") ----------------------------------------

const DRAFT_LIKELY = 90;       // *tune* a draft-eligible underclassman rated this (card overall) or better is likely to declare
const DRAFT_POSSIBLE = 84;     // *tune* ... and this or better might
const TRANSFER_HIGH = 0.15;    // *tune* a projected portal chance this high reads "High"
const TRANSFER_SOME = 0.07;    // *tune* ... and this high "Some"; under it "Low"
const TOP100_GOAL = { 1: 5, 2: 3, 3: 1, 4: 1, 5: 1 };        // *tune* the default top-100 recruits goal by program tier
const RANK_GOAL = { 1: 10, 2: 25, 3: 40, 4: 60, 5: 80 };     // *tune* the default class rank goal by program tier
const GOAL_IDS = ["commits", "top100", "rank"];
const GOAL_TITLES = { "commits": "Sign Your Class", "top100": "Land Top 100 Recruits", "rank": "Finish in the Top" };
const MAX_TASKS = 60;          // *tune* the most tasks a Headquarters keeps
const TASK_TEXT = 120;         // the longest a task's text may be

export function _hq(state) {
  if (!("headquarters" in state["career"])) state["career"]["headquarters"] = { "cards": [] };
  return state["career"]["headquarters"];
}

export function last_contacts(state) {
  // The last week you contacted, pitched or offered each recruit on your board, from the recruiting log
  // (the portal's weeks in the portal). A recruit you never contacted is left out.
  const rc = state["recruiting"], me = state["team"];
  const portal = truthy(get(rc, "portal"));
  const board = new Set(get(rc, "board") || []);
  const kinds = [...modules.recruiting.CONTACT_KINDS, "offer"];
  const out = {};
  for (const e of get(rc, "log") || []) {
    if (get(e, "school") !== me || !board.has(get(e, "pid")) || !kinds.includes(get(e, "kind"))) continue;
    const w = portal ? get(e, "portal_week") : get(e, "week");
    if (w !== null) out[e["pid"]] = Math.max(int(w), get(out, e["pid"], 0));
  }
  return out;
}

export function _word(chance) {
  return chance >= headquarters.TRANSFER_HIGH ? "High" : chance >= headquarters.TRANSFER_SOME ? "Some" : "Low";
}

export function outlook(state) {
  // Your roster's projected departures, as words: seniors graduate, draft-eligible underclassmen may declare
  // (by overall), and every player's portal chance by the offseason's own odds (class, role, a losing year).
  // A projection: the offseason decides.
  const offseason = modules.offseason, season = modules.season, recruiting = modules.recruiting;
  const me = state["team"];
  const view = season.depth_roster_view(state, me);
  const r = get(season._records(state), me) || {};
  const losing = get(r, "wins", 0) < get(r, "losses", 0);
  const players = [];
  for (const p of get(view, "players") || []) {
    const cls = get(p, "class") || "";
    const use = truthy(get(p, "starter")) ? "starter" : (get(p, "depth") || 99) <= 2 ? "rotation" : "bench";
    const base = !contains(offseason.PORTAL_BASE, cls) ? cls.replaceAll("RS", "") : cls;
    const chance = get(offseason.PORTAL_BASE, cls, get(offseason.PORTAL_BASE, base, 0.1)) * offseason.PORTAL_USAGE[use] * (losing ? offseason.PORTAL_LOSING : 1.0);
    const ovr = int(get(p, "overall") || 0);
    let draft = null;
    if (contains(offseason.UNDERCLASS_ELIGIBLE, cls)) {
      // the view's overall is as the page shows it (teamdata/shown.py); the cuts are on the game's own scale
      draft = ovr >= _shown.overall(headquarters.DRAFT_LIKELY) ? "Likely" : ovr >= _shown.overall(headquarters.DRAFT_POSSIBLE) ? "Possible" : null;
    }
    const grad = ["SR", "SRRS"].includes(cls);
    let group = get(offseason.GROUP, get(p, "role")) || get(offseason.GROUP, get(p, "position")) || get(p, "position");
    group = recruiting.spot_of_player(get(p, "role"), group);      // by position, as Recruiting counts (OT, OG, C, EDGE, DT, MIKE, WILL, FS, SS)
    players.push({ "slug": get(p, "slug"), "name": get(p, "name"), "position": get(p, "position"), "group": group, "class": cls,
      "overall": ovr, "starter": truthy(get(p, "starter")), "use": use,
      "leaving": grad ? "graduation" : null, "draft": draft,
      "transfer": grad ? null : headquarters._word(chance),     // a senior graduates: no portal word
      // the offseason: where he really is now (wants out, graduated, drafted, in the portal, at a new school)
      "next": truthy(get(state, "offseason")) && truthy(get(p, "slug")) ? offseason.player_next(state, p["slug"]) : null });
  }
  headquarters._replacements(state, players);
  const count = (f) => sum(players.filter(f).map(() => 1));
  const counts = { "graduation": count((p) => truthy(p["leaving"])), "draft": count((p) => truthy(p["draft"])),
    "draft_likely": count((p) => p["draft"] === "Likely"),
    "transfer_high": count((p) => p["transfer"] === "High"),
    "transfer_some": count((p) => p["transfer"] === "Some"),
    "roster": players.length, "losing": losing };
  return { "players": players, "counts": counts };
}

const REPLACE_ORDER = ["Committed", "Offered", "On Board"];

export function _replacements(state, players) {
  // Each player likely to leave (graduating, a likely or possible declare, a High portal risk) gets the best high
  // school recruit at his group who is yours: committed to you first, then offered, then on your board, best
  // national rank first. One recruit replaces one player; the best leaving player (starter, then overall) picks first.
  const recruiting = modules.recruiting;
  const rc = modules.prospects.class_rc(state), me = state["team"];
  const live = rc === state["recruiting"];
  const offered = live ? new Set(get(get(state["recruiting"], "offers", {}), me, [])) : new Set();
  const board = live ? new Set(get(state["recruiting"], "board") || []) : new Set();
  const pool = {};
  for (const [pid, st] of Object.entries(rc["status"])) {
    const school = st["signed"] || st["committed"];
    const status = school === me ? "Committed" : truthy(school) ? null : offered.has(pid) ? "Offered" : board.has(pid) ? "On Board" : null;
    if (status === null) continue;
    const p = rc["prospects"][pid];
    const g = recruiting.spot_of(p);
    if (!(g in pool)) pool[g] = [];
    pool[g].push([headquarters.REPLACE_ORDER.indexOf(status), p["rank"], pid, status]);
  }
  for (const g of Object.keys(pool)) pool[g].sort(cmp);
  for (const p of players) p["replacement"] = null;
  const leaving = players.filter((p) => truthy(p["leaving"]) || truthy(p["draft"]) || p["transfer"] === "High");
  for (const p of sorted(leaving, (x) => [!x["starter"], -x["overall"]])) {
    const cands = get(pool, p["group"]) || [];
    if (cands.length) {
      const [, , pid, status] = cands.shift();
      const q = rc["prospects"][pid];
      p["replacement"] = { "pid": pid, "name": q["name"], "stars": q["stars"], "position": q["position"], "status": status };
    }
  }
}

export function next_year(state) {
  // Next year's roster by group, as it stands: everyone the outlook keeps (seniors graduate) a class up, best overall
  // first, with his draft or portal word; your commits (and signees) in their groups as freshmen; each group's target,
  // the headcount filled, and `need`, recruiting.needs_detail's (which allows for the usual attrition and early leavers,
  // so it can be more than target - filled). `targets`: the rest of your recruits at the group (the player's ask), each
  // with `kind`, the most he is to you: offered, on your board, or contacted; one signed or committed elsewhere is left out.
  const offseason = modules.offseason, prospects = modules.prospects, recruiting = modules.recruiting;
  const me = state["team"];
  const detail = recruiting.needs_by_spot(state, me);                 // by position, as the board's Class Needs
  const groups = {};
  for (const [g, d] of Object.entries(detail)) groups[g] = { "group": g, "target": int(get(d, "target") || 0), "players": [], "commits": [] };
  for (const p of headquarters.outlook(state)["players"]) {
    if (truthy(p["leaving"]) || !(p["group"] in groups)) continue;
    groups[p["group"]]["players"].push({ "slug": get(p, "slug"), "name": p["name"], "position": p["position"], "class_now": p["class"],
      "class_next": get(offseason.NEXT_CLASS, p["class"], p["class"]), "overall": p["overall"],
      "starter": p["starter"], "draft": p["draft"], "transfer": p["transfer"] });
  }
  const rc = prospects.class_rc(state);
  for (const [pid, st] of Object.entries(rc["status"])) {
    if ((st["signed"] || st["committed"]) !== me) continue;
    const q = rc["prospects"][pid];
    const g = recruiting.spot_of(q);
    if (g in groups) {
      groups[g]["commits"].push({ "pid": pid, "name": q["name"], "position": q["position"], "stars": q["stars"],
        "signed": st["signed"] === me, "hard": truthy(get(st, "hard")), "rank": q["rank"] });
    }
  }
  const offered = new Set(get(rc["offers"], me, []));
  const board = new Set(get(rc, "board") || []);
  for (const [pid, st] of Object.entries(rc["status"])) {
    if (truthy(st["signed"]) || truthy(st["committed"])) continue;
    const kind = offered.has(pid) ? "offered" : board.has(pid) ? "board"
      : truthy(get(get(get(rc["contacts"], pid) || {}, me) || {}, "n")) ? "contacted" : null;
    if (kind === null) continue;
    const q = rc["prospects"][pid];
    const g = recruiting.spot_of(q);
    if (g in groups) {
      if (!("targets" in groups[g])) groups[g]["targets"] = [];
      groups[g]["targets"].push({ "pid": pid, "name": q["name"], "position": q["position"], "stars": q["stars"],
        "rank": q["rank"], "kind": kind });
    }
  }
  const out = [];
  const kind_order = { "offered": 0, "board": 1, "contacted": 2 };
  for (const g of Object.values(groups)) {
    g["players"] = sorted(g["players"], (x) => -x["overall"]);
    g["commits"] = sorted(g["commits"], (x) => x["rank"]);
    if (!("targets" in g)) g["targets"] = [];
    g["targets"] = sorted(g["targets"], (x) => [kind_order[x["kind"]], x["rank"]]);
    g["filled"] = g["players"].length + g["commits"].length;
    g["need"] = int(get(detail[g["group"]], "need") || 0);     // the game's own need: it allows for the usual attrition, as Class Needs
    out.push(g);
  }
  return { "groups": out };
}

export function promises_tracker(state) {
  // Every promise you have out (the Promises widget). `players`: your players promised a starting role, this season
  // with the week-by-week chip (promises.chips_now: On Track, Slipping, Broken; Not Judged Yet before a week counts) and
  // next season's as Next Season. `recruits`: each promise made to a recruit (a starting role, a start over a named
  // player, ahead of another recruit, an offer to his mate, NIL by a week) with its state: Open, Kept, Broken, Due Week N,
  // or Owed Next Season once he signs with you. A promise closed because he went elsewhere is left out.
  const pm = modules.promises, season = modules.season, recruiting = modules.recruiting;
  const me = get(state, "team");
  const year = season.season_year(state);
  const chips = pm.chips_now(state);
  const roster = get(get(get(get(state, "league") || {}, "teams") || {}, me) || {}, "roster") || [];
  let players = [];
  for (const c of roster) {
    const when = get(c, "promised");
    if (when === null || when < year) continue;
    players.push({ "slug": c["id"], "name": c["n"], "position": c["pos"],
      "status": when > year ? "Next Season" : get(chips, c["id"]) || "Not Judged Yet" });
  }
  const order = { "Broken": 0, "Slipping": 1, "Not Judged Yet": 2, "On Track": 3, "Next Season": 4 };
  players = sorted(players, (r) => [get(order, r["status"], 9), r["name"]]);
  const rc = get(state, "recruiting") || {};
  let recruits = [];
  const seen = new Set();
  for (const [pid, by] of Object.entries(get(rc, "contacts") || {})) {
    const c = get(by || {}, me) || {};
    const p = get(get(rc, "prospects") || {}, pid);
    if (!truthy(p)) continue;
    const signed = get(get(get(rc, "status") || {}, pid) || {}, "signed") === me;
    const made = get(c, "promises") || [];
    for (let i = 0; i < made.length; i++) {
      const pr = made[i];
      if (get(pr, "closed") !== null) continue;
      const kind = pr["kind"], about = get(pr, "about") || {};
      let what, status;
      if (kind === "roster") {
        what = truthy(get(about, "name")) && !truthy(get(pr, "job")) ? `Starts Over ${about["name"]}` : "Starting Role";
      } else if (kind === "recruit") {
        what = `Ahead of ${get(about, "name") || "Another Recruit"}`;
      } else if (kind === "package") {
        what = `Offer ${get(about, "name") || "His Teammate"}`;
      } else if (kind === "money") {
        what = "NIL Owed";
      } else {
        continue;
      }
      if (truthy(get(pr, "broken"))) {
        status = "Broken";
      } else if (truthy(get(pr, "kept"))) {
        status = "Kept";
      } else if (kind === "money") {
        const owed = recruiting.money_owed(state, me, pid);
        if (truthy(owed)) what = `NIL ${owed["nil"]}`;
        status = truthy(owed) ? `Due Week ${Math.max(0, owed["by_week"] - 1)}` : "Open";     // Week 0 opens the season
      } else if (signed && ["roster", "recruit"].includes(kind)) {
        status = "Owed Next Season";
      } else {
        status = "Open";
      }
      const mark = `${pid}\u0000${what}\u0000${status}`;
      if (seen.has(mark)) continue;          // the same promise made twice (an older save): shown once
      seen.add(mark);
      recruits.push({ "key": `${pid}-${i}`, "pid": pid, "name": p["name"], "position": get(p, "position"), "stars": get(p, "stars"),
        "what": what, "status": status, "week": get(pr, "week") });
    }
  }
  const rorder = { "Broken": 0, "Owed Next Season": 2, "Kept": 3 };
  recruits = sorted(recruits, (r) => [get(rorder, r["status"], 1), -(r["week"] || 0)]);
  return { "players": players, "recruits": recruits };
}

export function what_if(state, pid) {
  // Your class rank now and if he commits to you, and his group's need now and after. Changes nothing. Both ranks
  // come from prospects.class_table as you see it (another school's Quiet Commit left out), so the rank if he commits
  // is the rank you get when he does.
  const prospects = modules.prospects, recruiting = modules.recruiting;
  const rc = prospects.class_rc(state), me = state["team"];
  if (!(pid in rc["prospects"])) throw new LayoutError("Unknown recruit.");
  const table = prospects.class_table(state, me);
  const st = rc["status"][pid];
  const mine = (st["signed"] || st["committed"]) === me;
  const p = rc["prospects"][pid];
  const group = recruiting.spot_of(p);                                // his position, and its need as the board counts it
  const need = int(get(get(recruiting.needs_by_spot(state, me), group) || {}, "need", 0));
  const rank_now = table[me]["rank"];
  let rank_if;
  if (mine) {
    rank_if = rank_now;
  } else {
    const comps = sorted([...table[me]["pids"].filter((q) => q !== pid).map((q) => rc["prospects"][q]["composite"]), p["composite"]], undefined, true);
    const points = prospects.class_points(comps);
    rank_if = 1 + sum(Object.entries(table).filter(([slug, t]) => slug !== me && t["points"] > points).map(() => 1));
  }
  return { "pid": pid, "name": p["name"], "group": group, "rank_now": rank_now, "rank_if": rank_if,
    "need_now": need, "need_if": mine ? need : Math.max(0, need - 1) };
}

export function _tier(state) {
  const me = state["team"];
  const row = modules.programs.rows(state).find((r) => r["team"] === me);
  return int(get(row || {}, "tier") || 3);
}

export function goals(state) {
  // The three class goals: target (yours, or the default), now, and met.
  const prospects = modules.prospects, recruiting = modules.recruiting;
  const rc = prospects.class_rc(state), me = state["team"];
  const saved = get(headquarters._hq(state), "goals") || {};
  const mine = Object.entries(rc["status"]).filter(([_, st]) => (st["signed"] || st["committed"]) === me).map(([pid, _]) => pid);
  const tier = headquarters._tier(state);
  const committed = Object.values(state["recruiting"]["status"]).filter((s) => s["committed"] === me).length;
  const defaults = { "commits": committed + recruiting.open_spots(state, me), "top100": get(headquarters.TOP100_GOAL, tier, 1), "rank": get(headquarters.RANK_GOAL, tier, 40) };
  const now = { "commits": committed, "top100": sum(mine.filter((pid) => rc["prospects"][pid]["rank"] <= 100).map(() => 1)),
    "rank": mine.length ? prospects.class_rank(state, me) : null };       // no commits: unranked, not first
  const out = [];
  for (const g of headquarters.GOAL_IDS) {
    const target = int(get(saved, g) || defaults[g]);
    const met = g === "rank" ? (now[g] !== null && now[g] <= target) : now[g] >= target;
    out.push({ "id": g, "title": headquarters.GOAL_TITLES[g], "target": target, "now": now[g], "met": met, "default": !(g in saved) });
  }
  return out;
}

const KINDS = ["nil", "call", "raise", "wait", "leave", "scout", "pull", "need"];   // what a suggested task asks (docs/superpowers/plans/2026-11-11-auto-tasks.md)

export function _clock(state) {
  // (season week, portal week): in the portal the season's week stands still and the portal's own week moves.
  const rc = get(state, "recruiting") || {};
  return [get(state, "current_week") || 0, truthy(get(rc, "portal")) ? (get(rc, "week") || 0) : 0];
}

export function _task_check(state, t) {
  // (done, note) for a task added from a suggestion: done once you did what it asks since it was added; a note
  // (not done, kept) when it no longer applies: the recruit committed or signed elsewhere.
  const season = modules.season, recruiting = modules.recruiting;
  const rc = state["recruiting"], me = state["team"];
  const _do = t["do"];
  const since = [get(t, "since") || 0, get(t, "since_p") || 0];   // (season week, portal week): the season's week stands still in the portal
  const now = headquarters._clock(state);
  const kind = _do["kind"], pid = get(_do, "pid");
  if (kind === "need") {
    const g = get(_do, "group");
    let any = false;                                    // a position, or a group from an older task
    for (const q of get(rc, "board") || []) {
      if (q in rc["prospects"] && truthy(recruiting.spot_matches(rc["prospects"][q], g))) { any = true; break; }
    }
    return [any, null];
  }
  const p = get(rc["prospects"], pid), st_ = get(rc["status"], pid);
  if (p === null || st_ === null) return [false, null];
  // what you did after you added it: the log from its length then (`since_n`; a new recruiting block starts a new log),
  // else from the week you added it
  const full = get(rc, "log") || [], start = get(t, "since_n");
  const at = (e) => [get(e, "week") || 0, get(e, "portal_week") || 0];
  const whole = is_whole(start) || typeof start === "boolean";       // isinstance(start, int): a bool is one
  const after = whole && start <= full.length ? full.slice(Number(start)) : full.filter((e) => cmp(at(e), since) >= 0);
  const log = after.filter((e) => get(e, "pid") === pid && get(e, "school") === me);
  const contacted = log.filter((e) => ["contact", "pitch", "offer", "raise_nil"].includes(e["kind"]) && get(e, "action") !== "scout");   // a scout trip is no contact with him
  const elsewhere = [get(st_, "signed"), get(st_, "committed")].find((s) => truthy(s) && s !== me) ?? null;
  if (kind === "pull") return [!get(rc["offers"], me, []).includes(pid), null];
  if (elsewhere !== null) {
    const name = elsewhere === "FCS" ? "an FCS program" : elsewhere in season.load_teams() ? season.team_display(elsewhere, season.load_teams()) : elsewhere;
    if (truthy(get(st_, "pro"))) return [false, "No longer needed: he chose pro baseball."];
    const verb = truthy(get(st_, "signed")) ? "signed with" : "committed to";
    return [false, `No longer needed: he ${verb} ${name}.`];
  }
  if (kind === "nil") return [get(get(get(rc["nil"], me) || {}, "held", {}), pid, 0) >= int(get(_do, "nil") || 0), null];
  if (kind === "call") return [log.some((e) => e["kind"] === "contact" && ["call", "hc_visit"].includes(get(e, "action"))), null];
  if (kind === "scout") return [log.some((e) => e["kind"] === "contact" && get(e, "action") === "scout"), null];
  if (kind === "raise") return [log.some((e) => ["offer", "raise_nil"].includes(e["kind"])) || !truthy(recruiting.cooled(state, me, pid)), null];
  if (kind === "wait") return [cmp(now, since) > 0, null];
  if (kind === "leave") return [cmp(now, since) > 0 && !contacted.length, null];
  return [false, null];
}

export function tasks(state) {
  // Your tasks. One added from a suggestion (`do`) ticks itself done (`auto`) once you did it, unless you unticked it
  // yourself (`manual`); one that no longer applies keeps its place with a `note`. A task never leaves the list here.
  const out = [];
  for (const t of get(headquarters._hq(state), "tasks") || []) {
    if (truthy(get(t, "do")) && !truthy(get(t, "done")) && !truthy(get(t, "manual")) && truthy(get(state, "recruiting"))) {
      const [done, note] = headquarters._task_check(state, t);
      if (truthy(done)) {
        t["done"] = true;
        t["auto"] = true;
        delete t["note"];
      } else if (truthy(note)) {
        t["note"] = note;
      } else {
        delete t["note"];                      // live again (he decommitted): the note goes
      }
    }
    out.push({ ...t });
  }
  return out;
}

export function set_plan(state, body) {
  // Store tasks and goal targets (either optional); check every field first, so a bad one stores nothing.
  if (!is_dict(body)) throw new LayoutError("The plan must be an object.");
  const MAX_TASKS = headquarters.MAX_TASKS, TASK_TEXT = headquarters.TASK_TEXT;
  let new_tasks = null, new_goals = null;
  if ("tasks" in body) {
    const ts = body["tasks"];
    if (!Array.isArray(ts) || ts.length > MAX_TASKS) throw new LayoutError(`Tasks are a list of at most ${MAX_TASKS}.`);
    const seen = new Set();
    new_tasks = [];
    const old = new Map();
    for (const o of get(headquarters._hq(state), "tasks") || []) old.set(get(o, "id"), o);
    for (const t of ts) {
      if (!is_dict(t) || !(is_str(get(t, "id")) && headquarters._ID.test(t["id"])) || seen.has(t["id"])) {
        throw new LayoutError("Each task needs its own short lowercase id.");
      }
      const text = get(t, "text");
      if (!is_str(text) || !strip(text) || len(text) > TASK_TEXT) throw new LayoutError(`A task's text is 1 to ${TASK_TEXT} characters.`);
      if (typeof get(t, "done") !== "boolean") throw new LayoutError("A task is done or not.");
      const row = { "id": t["id"], "text": strip(text), "done": t["done"] };
      const _do = get(t, "do");
      if (_do !== null) {
        if (!is_dict(_do) || !headquarters.KINDS.includes(get(_do, "kind"))) throw new LayoutError("A suggested task asks for one of the known things.");
        if (_do["kind"] === "need") {
          if (!is_str(get(_do, "group")) || len(_do["group"]) > 20) throw new LayoutError("A position need names its group.");
        } else if (!is_str(get(_do, "pid")) || !_do["pid"] || len(_do["pid"]) > 80) {
          throw new LayoutError("A suggested task names its recruit.");
        }
        if ("nil" in _do && (typeof _do["nil"] === "boolean" || !is_whole(_do["nil"]) || !(0 <= _do["nil"] && _do["nil"] <= 1000))) {
          throw new LayoutError("A NIL amount is a whole number from 0 to 1000.");
        }
        row["do"] = {};
        for (const k of ["kind", "pid", "nil", "group"]) if (k in _do) row["do"][k] = _do[k];
        const since = get(t, "since", 0);
        if (typeof since === "boolean" || !is_whole(since)) throw new LayoutError("A task's week is a whole number.");
        const was = old.get(t["id"]) || {};
        if (truthy(get(was, "do"))) {                        // when it was added is the server's, kept from the first save
          for (const k of ["since", "since_p", "since_n"]) if (k in was) row[k] = was[k];
          if (!("since" in row)) row["since"] = since;
        } else {
          [row["since"], row["since_p"]] = headquarters._clock(state);
          row["since_n"] = (get(get(state, "recruiting") || {}, "log") || []).length;
        }
      }
      for (const k of ["auto", "manual"]) {
        if (get(t, k) === true) row[k] = true;
      }
      if (is_str(get(t, "note")) && len(t["note"]) > TASK_TEXT) throw new LayoutError(`A task's note is at most ${TASK_TEXT} characters.`);
      if (truthy(get(row, "do")) && truthy(get(old.get(t["id"]) || {}, "note"))) {
        row["note"] = old.get(t["id"])["note"];       // the note is the server's (tasks() sets and clears it), not the page's
      }
      if (row["done"] === false) delete row["auto"];
      seen.add(t["id"]);
      new_tasks.push(row);
    }
  }
  if ("goals" in body) {
    const gs = body["goals"];
    if (!is_dict(gs) || Object.keys(gs).some((k) => !headquarters.GOAL_IDS.includes(k))) throw new LayoutError("Goals are commits, top100 and rank.");
    for (const v of Object.values(gs)) {
      if (typeof v === "boolean" || !is_whole(v) || !(1 <= v && v <= 200)) throw new LayoutError("A goal is a whole number from 1 to 200.");
    }
    new_goals = { ...gs };
  }
  const hq = headquarters._hq(state);
  if (new_tasks !== null) hq["tasks"] = new_tasks;
  if (new_goals !== null) hq["goals"] = { ...(get(hq, "goals") || {}), ...new_goals };
  return { "tasks": headquarters.tasks(state), "goals": headquarters.goals(state) };
}

export const headquarters = {
  HQ_MAX_CARDS, CARD_H, MOVERS_SHOWN, SIZES, _ID, LayoutError, layout, set_layout, _committed_now, commits_by_week, movers,
  _shown, DRAFT_LIKELY, DRAFT_POSSIBLE, TRANSFER_HIGH, TRANSFER_SOME, TOP100_GOAL, RANK_GOAL, GOAL_IDS, GOAL_TITLES, MAX_TASKS, TASK_TEXT,
  _hq, last_contacts, _word, outlook, REPLACE_ORDER, _replacements, next_year, promises_tracker, what_if, _tier, goals, KINDS, _clock,
  _task_check, tasks, set_plan,
};

modules.headquarters = headquarters;

// What is not written as the Python has it (PORTING.md rule 9):
// - A whole number against a float: `isinstance(h, int)` (a card's height), `isinstance(do["nil"], int)`, a task's
//   `since`, a goal's value and `since_n` refuse 150.0 in Python and take it here (150 and 150.0 are one number in
//   JavaScript; a page sends whole numbers). A bool is refused in both.
// - `_ID.match(...)`: Python's `$` also matches before a last newline; the pattern here says so (`\n?$`).
// - `text.strip()` and `len(text)`: written out (Python's white space; characters, not UTF-16 units).
// - `(pid, what, status) in seen`: a tuple in a set is the three joined with U+0000 here.
// - commits_by_week: `gained`/`lost` (dicts keyed by a whole number) are Maps; they are only read by key and summed.
// - _task_check's `any(...)` for a position need is a loop that stops at the first match, as any() does.
// - `rc is state["recruiting"]` is `===`: the same object, as Python's `is`.
// - A missing key Python would raise on (KeyError) reads undefined here and goes on; none is reached with a real save.
// - Names sort by UTF-16 unit here and by character in Python: the same for every name outside the astral planes.
