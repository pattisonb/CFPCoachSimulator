// What is yours stays yours through Auto-recruit's weeks (recruiting.contact_week, manual_offers), played through the
// API and the week-by-week dispatcher as the page plays it:
// - an offer you make by hand, and a prospect you put on your board, stay through Auto-recruit's weeks, even in a
//   group at its cap or after he commits elsewhere, while the offers Auto-recruit made itself go by its rules; a pull
//   by hand clears the mark; a hand offer still counts toward the offer limit;
// - an offer you raise by hand keeps your NIL;
// - you may Message and Call each recruit once a week, in the week you are playing: Auto-recruit's contacts in a week
//   step count against the week that step closes, never the one you are about to play, and the board's
//   `done_this_week` agrees with the server; a call you open and never finish closes at the step;
// - in the transfer portal the season's week stands still, so the rule runs on the portal's own week;
// - an old save with a call left open, or marks from a frozen week, heals on load.
// `node tests/test_contact_limits.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, get, sorted } from "../engine_js/pyrt.js";

const game = await start();
const { api, season, recruiting } = game;
const rec = recruiting;

const ME = "ohio-state";
const PITCH = rec.PITCHES[0];

function refused(fn, code, words = "") {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof api.ApiError)) throw e;
    assert(e.status === code && e.message.includes(words), `${e.status} ${e.message}`);
    return;
  }
  throw new Error(`expected ${code} ${words}`);
}

const sid = api.call("POST", "/api/season", { team: ME, mode: "full", seed: 11, career: true })["id"];
const G = (p) => api.call("GET", `/api/season/${sid}/${p}`);
const R = (p, body) => api.call("POST", `/api/season/${sid}/${p}`, body);
const row = (pid) => G("recruiting")["board"].find((b) => b["id"] === pid);
const contact = (pid, action, more = {}) => R("recruit", { pid, action, ...more });
const live = () => [api.loaded_state(), api.loaded_state()["recruiting"]];

/** One week through the dispatcher, as the page plays it (Advance, then a step at a time). */
function advance_one() {
  R("advance", { to: api.loaded_state()["current_week"] + 1 });
  while (api.step() !== null && api.running()) { /* the week's stages */ }
}

/** Commit uncommitted prospects of `group` to you until your commits there reach its cap. */
function cap_group(st, group, skip) {
  const rc = st["recruiting"];
  const pool = sorted(Object.keys(rc["prospects"]), (q) => rc["prospects"][q]["rank"]).filter((q) => rec._group_of(rc["prospects"][q]) === group
    && !skip.has(q) && rc["status"][q]["committed"] === null && !Object.values(rc["offers"]).some((pids) => pids.includes(q)));
  while (rec.commits_by_group(st, ME)[group] < rec.group_cap(rec.needs(st, ME), group)) {
    Object.assign(rc["status"][pool.shift()], { committed: ME, firmness: rec.FIRM_START, hard: false });
    rc["commits_v"] = get(rc, "commits_v", 0) + 1;
  }
}

/** Your recruits Auto-recruit called or messaged in the step just run (uncommitted, unsigned). */
function staff_contacted(st) {
  const rc = st["recruiting"];
  return Object.keys(rc["contacts"]).filter((pid) => Object.keys(get(get(rc["contacts"][pid], ME) || {}, "week") || {}).length
    && !rc["status"][pid]["signed"] && [null, ME].includes(rc["status"][pid]["committed"]));
}

/** Every game played, every school's class signed, the season over (as tests/test_portal_recap.mjs ends one). */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const h = teams[g["home"]]["team_ratings"]["overall"], a = teams[g["away"]]["team_ratings"]["overall"];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 12));
    Object.assign(g, { played: true, home_score: win ? hs : Math.max(0, hs - rng.randint(1, 20)), away_score: win ? hs - rng.randint(1, 20) : hs });
    if (g["home_score"] === g["away_score"]) g["home_score"] += 3;
  }
  const rc = st["recruiting"];
  const schools = Object.keys(teams).filter((s) => !teams[s]["fictional"]);
  sorted(Object.keys(rc["prospects"]), (p) => rc["prospects"][p]["rank"]).slice(0, schools.length * 21)
    .forEach((pid, i) => { rc["status"][pid]["signed"] = schools[i % schools.length]; });
  Object.assign(st, { done: true, current_week: season.FINAL_WEEK, champion: ME });
}

let mine, gone;      // the two hand offers of the first test, read by the second

test("Auto-recruit leaves your hand offers and your board alone, and still pulls its own by its rules", () => {
  let [st, rc] = live();
  // low-ranked three-stars: Auto-recruit would let one who commits elsewhere go
  const rows = G("prospects?stars=3&limit=5000")["rows"].filter((r) => r["national_rank"] > rec.RIVAL_RANK + 500).map((r) => r["id"]);
  const group_of = (q) => rec._group_of(rc["prospects"][q]);
  mine = rows.at(-1);
  const group = group_of(mine);
  gone = rows.slice(0, -1).find((q) => group_of(q) !== group);
  for (const q of [mine, gone]) {
    R("board", { pid: q, on: true });
    contact(q, "offer", { nil: 0 });
  }
  // offers Auto-recruit made itself (no mark): one in the same group, one to a prospect committed elsewhere
  const auto_same = rows.slice(0, -1).find((q) => group_of(q) === group && q !== gone);
  const auto_gone = rows.slice(0, -1).find((q) => ![gone, auto_same].includes(q) && group_of(q) !== group);
  rc["offers"][ME].push(auto_same, auto_gone);
  for (const q of [gone, auto_gone]) Object.assign(rc["status"][q], { committed: "michigan", firmness: rec.FIRM_START, hard: false });
  rc["commits_v"] = get(rc, "commits_v", 0) + 1;
  cap_group(st, group, new Set([mine, auto_same, gone, auto_gone]));
  assert(rec.group_full(st, ME, group));
  assert(R("settings", { auto_recruit: "season" })["auto_recruit"] === "season");
  for (let wk = 0; wk < 2; wk++) {
    advance_one();
    [st, rc] = live();
    assert(st["current_week"] === wk + 1);
    const offers = rc["offers"][ME];
    assert(offers.includes(mine) && rc["board"].includes(mine), `week ${wk + 1}: Auto-recruit pulled your offer or took him off your board`);
    if (!rc["status"][gone]["signed"]) assert(offers.includes(gone), `week ${wk + 1}: Auto-recruit pulled your offer to one committed elsewhere`);
    assert(rc["board"].includes(gone));
    if (wk === 0) {
      assert(!offers.includes(auto_same) || rc["status"][auto_same]["committed"] === ME, "an Auto offer in a capped group was kept");
      assert(!offers.includes(auto_gone) || [null, ME].includes(rc["status"][auto_gone]["committed"]), "an Auto offer to one gone elsewhere was kept");
    }
  }
  assert([mine, gone].every((q) => rc["manual_offers"].includes(q)));
  assert(rc["manual_offers"].every((q) => rc["offers"][ME].includes(q)), "a mark outlived its offer");
});

test("Auto-recruit's contacts count against the week its step closes: your new week's Message and Call are still yours", () => {
  // the two weeks just played were Auto-recruit "season"; then one on "week"
  for (const mode of ["season", "week"]) {
    if (mode === "week") {
      assert(R("settings", { auto_recruit: "week" })["auto_recruit"] === "week");
      advance_one();
    }
    const [st] = live();
    assert(rec.auto_mode(st) === (mode === "season" ? "season" : "off"), "a week of Auto-recruit turns itself off");
    const worked = staff_contacted(st);
    assert(worked.length, `Auto-recruit (${mode}) called or messaged nobody`);
    R("settings", { auto_recruit: "off" });
    const pid = worked[0];
    equal(row(pid)["done_this_week"], [], `Auto (${mode}): the board says this week's contacts are used up`);
    contact(pid, "message");
    contact(pid, "call", { pitch: PITCH });
    equal([...row(pid)["done_this_week"]].sort(), ["call", "message"]);
    refused(() => contact(pid, "message"), 409, "Done this week");
    refused(() => contact(pid, "call", { pitch: PITCH }), 409, "Done this week");
  }
});

test("a pull by hand clears the mark, and a hand offer counts toward the offer limit", () => {
  const [st, rc] = live();
  contact(mine, "pull_offer");
  assert(!rc["offers"][ME].includes(mine) && !rc["manual_offers"].includes(mine));
  const cap = rec.offer_cap(st, ME);
  const spare = rec.prospect_list(st).filter((q) => !rc["offers"][ME].includes(q) && !rc["status"][q]["committed"] && !rc["status"][q]["signed"]).slice(-80);
  rc["offers"][ME].push(...spare.slice(0, Math.max(0, cap - 1 - rc["offers"][ME].length)));
  assert(rc["offers"][ME].length === cap - 1, "the test filled your offers to one short of the cap");
  const [extra, last] = spare.slice(-2);
  contact(last, "offer", { nil: 0 });
  assert(rc["manual_offers"].includes(last) && rc["offers"][ME].length === cap);
  refused(() => contact(extra, "offer", { nil: 0 }), 409);
  rc["offers"][ME] = rc["offers"][ME].filter((q) => !spare.includes(q) || q === last);      // the filler comes back off
});

test("the week you and Auto-recruit both work a recruit, Auto does not contact him a second time", () => {
  let [st, rc] = live();
  const pid = staff_contacted(st).find((q) => get(rc["contacts"][q][ME]["week"], "message") === rec.contact_week(st))
    ?? (() => { const q = staff_contacted(st)[0]; contact(q, "message"); return q; })();
  const marks = { ...rc["contacts"][pid][ME]["week"] };
  // a call twice in one week is refused; one opened and left alone closes at the step
  const fresh = rec.prospect_list(st).filter((q) => !rc["status"][q]["committed"] && !rc["status"][q]["signed"]
    && !(ME in get(rc["contacts"], q, {})) && !rec.would_pester(st, ME, q));
  const [a, b] = fresh;
  rc["hours"][ME] = 200;
  for (const q of [a, b]) R("board", { pid: q, on: true });
  contact(a, "call", { pitch: PITCH });
  refused(() => contact(a, "call", { pitch: PITCH }), 409, "Done this week");
  assert(contact(b, "call")["scene"] && row(b)["scene"], "a call with no pitch opens a conversation");
  refused(() => contact(b, "call"), 409, "Done this week");
  R("settings", { auto_recruit: "week" });
  advance_one();
  [st, rc] = live();
  assert(get(rc["contacts"][pid][ME]["week"], "message") === marks["message"], "Auto messaged him again the week you did");
  assert(!get(get(get(rc, "scenes") || {}, ME) || {}, b), "the abandoned call outlived the week");
  assert(row(b)["scene"] === null);
  rc["hours"][ME] = 200;
  equal(row(b)["done_this_week"], [], "the call you hung up on does not block the next week's");
  assert(contact(b, "call")["scene"], "next week's call to the one you hung up on");
});

test("NIL you set by hand stays through Auto-recruit's weeks, on its offer and on yours, even in a group at its cap", () => {
  let [st, rc] = live();
  rc["hours"][ME] = 200;
  const kept = new Set(get(rc, "manual_offers") || []);
  const open = (q) => rc["status"][q]["committed"] === null && !rc["status"][q]["signed"];
  const auto_offer = rc["offers"][ME].find((q) => !kept.has(q) && open(q));
  delete rc["nil"][ME]["held"][auto_offer];              // Auto's offer at no NIL, as the player saw it
  const group = rec._group_of(rc["prospects"][auto_offer]);
  const own = rec.prospect_list(st).find((q) => open(q) && !rc["offers"][ME].includes(q) && rec._group_of(rc["prospects"][q]) === group
    && rec.blocked(st, ME, q) === null);                 // (one who will consider you: the board refuses the rest)
  if (rc["board"].length >= rec.BOARD_CAP) rc["board"].pop();     // room on a full board
  R("board", { pid: own, on: true });
  rc["nil"][ME]["budget"] += 80 + Math.max(0, -rec.nil_left(st, ME));
  contact(own, "offer", { nil: 0 });
  contact(auto_offer, "raise_nil", { nil: 40 });
  contact(own, "raise_nil", { nil: 40 });
  assert([auto_offer, own].every((q) => rc["manual_offers"].includes(q)), "a raise by hand marks the offer as yours");
  cap_group(st, group, new Set([auto_offer, own]));       // Auto pulls the offers it made in a group at its cap
  R("settings", { auto_recruit: "week" });
  advance_one();
  [st, rc] = live();
  for (const q of [auto_offer, own]) {
    if (rc["status"][q]["signed"] || ![null, ME].includes(rc["status"][q]["committed"])) continue;   // a signing or a commitment elsewhere still ends it
    assert(rc["offers"][ME].includes(q), `Auto pulled the offer you raised to ${q}`);
    assert(rc["nil"][ME]["held"][q] === 40, `Auto reset the NIL you set on ${q}: ${rc["nil"][ME]["held"][q]}`);
  }
});

test("an old save without the list of hand offers plays on", () => {
  const [st, rc] = live();
  delete rc["manual_offers"];
  const week = st["current_week"];
  R("settings", { auto_recruit: "week" });
  advance_one();
  assert(api.loaded_state()["current_week"] === week + 1);
  R("settings", { auto_recruit: "off" });
});

test("an old save heals on load: a call left open from an earlier week, and marks stamped with the week you are playing", () => {
  const [st, rc] = live();
  const pid = rec.prospect_list(st).find((q) => !rc["status"][q]["signed"] && [null, ME].includes(rc["status"][q]["committed"])
    && !rec.would_pester(st, ME, q));
  R("board", { pid, on: true });
  const c = ((rc["contacts"][pid] ||= {})[ME] ||= { n: 1, hc_week: null });
  c["week"] = { message: st["current_week"], call: st["current_week"] };       // the old stamp
  ((rc["scenes"] ||= {})[ME] ||= {})[pid] = { id: "old", action: "call", week: st["current_week"] - 1, turns: [], lines: [] };
  season.save_season(st);
  const healed = season.load_season(sid);
  assert(!(pid in (get(get(healed["recruiting"], "scenes") || {}, ME) || {})), "the call left open from an earlier week survived the load");
  api._loaded = null;                                     // the page reloads the career from its file
  assert(row(pid)["scene"] === null);
  equal(row(pid)["done_this_week"], []);
  api.loaded_state()["recruiting"]["hours"][ME] = 200;
  contact(pid, "message");
  assert(contact(pid, "call")["scene"]);
});

test("in the transfer portal the once-a-week rule runs on the portal's own week", () => {
  finished(api.loaded_state());
  api._save_loaded();
  G("offseason");
  while (api.loaded_state()["offseason"]["stage"] !== "portal_w1") R("offseason/advance", {});
  let [st, rc] = live();
  assert(rec.is_portal(st) && rc["week"] === 1);
  const pid = rec.prospect_list(st).find((q) => !rec.would_pester(st, ME, q));
  R("board", { pid, on: true });
  contact(pid, "message");
  assert(contact(pid, "call")["scene"]);                 // opened and left
  refused(() => contact(pid, "call"), 409, "Done this week");
  equal([...row(pid)["done_this_week"]].sort(), ["call", "message"]);
  R("settings", { auto_recruit: "season" });
  R("offseason/advance", {});
  R("settings", { auto_recruit: "off" });
  [st, rc] = live();
  assert(rc["week"] === 2 && st["current_week"] === season.FINAL_WEEK, "the season's week stands still");
  equal(row(pid)["done_this_week"], [], "portal week 2: last week's contacts still count");
  rc["hours"][ME] = 200;
  contact(pid, "message");
  assert(contact(pid, "call")["scene"], "portal week 2: you could not call him again");
  // an old portal save: marks from the season's frozen week heal on load
  const other = rec.prospect_list(st).find((q) => q !== pid);
  ((rc["contacts"][other] ||= {})[ME] ||= { n: 1, hc_week: null })["week"] = { call: season.FINAL_WEEK };
  season.save_season(st);
  assert(!("call" in season.load_season(sid)["recruiting"]["contacts"][other][ME]["week"]));
});

await run();
