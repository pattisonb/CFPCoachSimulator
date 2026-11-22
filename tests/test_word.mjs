// Keeps His Word (career_js/word.js): your reputation for keeping promises. It is kept on the coach, moved by kept
// and broken promises (most at the broken player's position), recovers a little each offseason and follows you to the
// next season, and recruits read it when you promise: a strong word makes a promise worth more, and under the floor
// he does not believe you at all.
// `node tests/test_word.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, get, sorted } from "../engine_js/pyrt.js";

const game = await start();
const { season, recruiting, offseason } = game;
const { word, persona, scenes, promises, office } = game.modules;

const ME = "iowa";
const J = (v) => () => JSON.stringify(v);
const clone = (v) => JSON.parse(JSON.stringify(v));
const bare = () => ({ career: {}, team: ME, season_year: 2026 });

// ----- the book -------------------------------------------------------------------------------------------------------------

test("a new coach's word starts Strong, and reading it writes nothing", () => {
  const st = bare();
  assert(word.reading(st) === word.WORD_START && word.reading(st, "QB") === word.WORD_START, "a position with no history reads the overall");
  assert(word.word_text(70) === "Strong" && !("word" in st["career"]));
  equal(word.view(st), { text: "Strong", weakest: null, recent: [] });
});

test("a broken promise costs more than a kept one earns, and hits the player's own position twice", () => {
  let st = bare();
  word.apply(st, "broken", "QB", "Jalen Moss");
  equal([word.reading(st), word.reading(st, "QB"), word.reading(st, "WR")], [62, 54, 62]);
  st = bare();
  word.apply(st, "kept", "WR", "A");
  word.apply(st, "broken", "WR", "B");
  assert(word.reading(st) < word.WORD_START);
});

test("breaking your word to a star costs half again, and to a Guarded one half again on top", () => {
  const st = bare();
  assert(word.apply(st, "broken", "QB", "A", true) === -12);
  assert(word.apply(st, "broken", "QB", "B", true, "guarded") === -18);
});

test("each offseason the word moves a quarter of the way back to where it started, and a position's extra halves", () => {
  const st = bare(), b = word.book(st);
  b["overall"] = 50;
  b["by_group"]["QB"] = -8;
  word.recover(st);
  assert(word.reading(st) === 55 && b["by_group"]["QB"] === -4, J(b));
});

test("the word stays between 0 and 100", () => {
  let st = bare();
  for (let i = 0; i < 20; i++) word.apply(st, "broken", "QB", `P${i}`);
  assert(word.reading(st) === 0 && word.reading(st, "QB") === 0);
  st = bare();
  for (let i = 0; i < 50; i++) word.apply(st, "kept", "QB", `P${i}`);
  assert(word.reading(st) === 100 && word.reading(st, "QB") === 100);
});

test("the last promise you broke at a position is remembered by name", () => {
  const st = bare();
  word.apply(st, "broken", "QB", "First Guy");
  word.apply(st, "kept", "QB", "Kept Guy");
  word.apply(st, "broken", "QB", "Second Guy");
  assert(word.last_broken(st, "QB") === "Second Guy" && word.last_broken(st, "WR") === null);
});

test("the Office card reads the word, your weakest position and the latest lines, newest first", () => {
  const st = bare();
  word.apply(st, "kept", "WR", "Ty Lane");
  word.apply(st, "broken", "QB", "Jalen Moss");
  word.apply(st, "money_broken", "QB", "Cam Ward");
  const v = word.view(st);
  assert(v["text"] === word.word_text(word.reading(st)));
  equal(v["weakest"], { group: "QB", name: "Quarterbacks", text: word.word_text(word.reading(st, "QB")) });
  equal(v["recent"], ["Broke your word to Cam Ward (QB).", "Broke your word to Jalen Moss (QB).", "Kept your word to Ty Lane (WR)."]);
});

// ----- recruits read it -------------------------------------------------------------------------------------------------------

const base = season.new_season(ME, "full", 5, undefined, undefined, true);
base["current_week"] = 1;
base["recruiting"]["hours"][ME] = 1000;
const fresh = () => { recruiting.reset_caches(); return clone(base); };
const ranked = (st) => {
  const rc = st["recruiting"];
  return Object.keys(rc["prospects"]).sort((a, b) => rc["prospects"][a]["rank"] - rc["prospects"][b]["rank"])
    .filter((q) => !rc["prospects"][q]["hidden"] && !rc["status"][q]["committed"]);
};
/** A recruit of a given personality whose decider cares about `decider` (or nobody's topic). */
function recruit(personality = "business", decider = null) {
  const st = fresh(), pid = ranked(st)[60];
  const p = st["recruiting"]["prospects"][pid];
  p["persona"] = { ...persona.of(st, pid), personality, decider_topic: decider };
  return [st, pid, recruiting._group_of(p)];
}
/** His question about a roster player, answered with a promise. */
function promise(st, pid, about = { name: "Old Guy", ovr: 0, last_year: true, cls: "SR" }) {
  const sc = { id: "s1", action: "call", week: st["current_week"],
    question: { kind: "roster", text: "Is he still your starter?", about, answer: null, reply: null } };
  ((st["recruiting"]["scenes"] ||= {})[ME] ||= {})[pid] = sc;
  return recruiting._answer(st, ME, pid, "s1", "promise");
}

test("a promise is worth more from a coach who keeps his word, and most to a recruit who cares most", () => {
  let [st, pid, group] = recruit();
  assert(Math.abs(word.promise_mult(st, pid, group) - 1.2) < 1e-9, "a new coach's Strong word");
  word.book(st)["overall"] = 30;
  assert(Math.abs(word.promise_mult(st, pid, group) - 0.8) < 1e-9);
  [st, pid, group] = recruit("guarded");
  assert(Math.abs(word.promise_mult(st, pid, group) - 1.3) < 1e-9, "a Guarded recruit reads it harder");
  [st, pid, group] = recruit("business", "playing_time");
  assert(Math.abs(word.promise_mult(st, pid, group) - 1.3) < 1e-9, "so does one whose decider cares about playing time");
  [st, pid] = recruit();
  word.book(st)["overall"] = 90;
  assert(Math.abs(promise(st, pid)["points"] - recruiting.ANSWER_PROMISE * 1.4) < 1e-9);
});

test("under the floor he does not believe your promise: it earns nothing, he names the one you broke, and he does not cool", () => {
  let [st, pid, group] = recruit();
  word.book(st)["overall"] = 30;
  word.apply(st, "broken", group, "Jalen Moss");
  word.book(st)["overall"] = 30;                          // still under the floor at his position
  let r = promise(st, pid);
  assert(r["points"] === 0 && r["scene"]["question"]["reply"] === scenes.WORD_DOUBT.replace("{name}", "Jalen Moss"), J(r["scene"]["question"]));
  assert(st["recruiting"]["log"].filter((e) => e["kind"] === "answer" && e["pid"] === pid).at(-1)["doubted"] === true);
  [st, pid] = recruit();
  word.book(st)["overall"] = 20;
  r = promise(st, pid);
  assert(r["points"] === 0 && r["scene"]["question"]["reply"] === scenes.WORD_DOUBT_ANY);
  // a promised start over a better player is your word, never a lie: doubted, it is worth nothing and costs nothing
  [st, pid] = recruit();
  word.book(st)["overall"] = 20;
  r = promise(st, pid, { name: "Star Guy", ovr: 99, last_year: false, cls: "SO" });
  assert(r["truthful"] === true && r["points"] === 0 && !recruiting.cooled(st, ME, pid));
});

// ----- what moves it ------------------------------------------------------------------------------------------------------------

/** A recruit with a real NIL ask whose priority is NIL, offered with nothing held, then pitched NIL on a call: a money promise. */
function money_promise(st, school = ME, personality = "business") {
  const rc = st["recruiting"];
  const pid = ranked(st).slice(40, 100).find((q) => recruiting.ask_from(st, school, q) >= 15);
  const p = rc["prospects"][pid];
  p["persona"] = { ...persona.of(st, pid), personality, decider_topic: null };
  p["priorities"] = ["nil", ...p["priorities"].filter((t) => t !== "nil")].slice(0, 3);
  recruiting.act(st, school, pid, "offer");
  recruiting._contact(st, school, pid)["calls"] ??= 1;
  let sc = recruiting.act(st, school, pid, "call")["scene"];
  sc = recruiting.act(st, school, pid, "present", null, 0, sc["id"], null, recruiting.PITCHES.slice(0, 3))["scene"];
  if (get(sc, "question")) recruiting.act(st, school, pid, "answer", null, 0, sc["id"], "straight");
  recruiting.act(st, school, pid, "pitch", "nil", 0, sc["id"]);
  return pid;
}
const deadline = (st) => { for (let w = st["current_week"] + 1; w < st["current_week"] + 1 + recruiting.NIL_PROMISE_WEEKS; w++) recruiting._promises(st, w); };
const star_cost = (st, pid) => ((st["recruiting"]["prospects"][pid]["stars"] || 0) >= 4 ? word.STAR_COST : 1.0)
  * (persona.of(st, pid)["personality"] === "guarded" ? word.GUARDED_COST : 1.0);

test("a money promise kept adds to your word; broken, it costs and is remembered at his position", () => {
  let st = fresh(), pid = money_promise(st);
  recruiting._nil(st, ME)["held"][pid] = recruiting._five(recruiting.NIL_PROMISE_SHARE * recruiting.ask_from(st, ME, pid) + 2.4);
  recruiting._promises(st, st["current_week"] + 1);
  assert(word.reading(st) === word.WORD_START + word.GAIN["money_kept"], J(word.book(st)));
  st = fresh();
  pid = money_promise(st);
  deadline(st);
  assert(word.reading(st) === word.WORD_START - word.COST["money_broken"] * star_cost(st, pid), J(word.book(st)));
  const p = st["recruiting"]["prospects"][pid];
  assert(word.last_broken(st, recruiting._group_of(p)) === p["name"]);
});

test("a broken promise he forgives costs your word nothing", () => {
  const saved = recruiting.MONEY_FORGIVE_CHANCE["shy"];
  recruiting.MONEY_FORGIVE_CHANCE["shy"] = 1.0;           // a sure thing, so the test reads the rule, not the draw
  try {
    const st = clone(tulane());
    const pid = money_promise(st, "tulane", "shy");
    deadline(st);
    assert(st["recruiting"]["log"].some((e) => e["pid"] === pid && e["kind"] === "promise_broken" && get(e, "forgiven")));
    assert(word.reading(st) === word.WORD_START && !(get(get(st["career"], "word") || {}, "log") || []).length, J(word.book(st)));
  } finally {
    recruiting.MONEY_FORGIVE_CHANCE["shy"] = saved;
  }
});
let _tulane = null;
function tulane() {
  if (!_tulane) {
    _tulane = season.new_season("tulane", "full", 5, undefined, undefined, true);
    _tulane["current_week"] = 1;
    _tulane["recruiting"]["hours"]["tulane"] = 1000;
  }
  recruiting.reset_caches();
  return _tulane;
}

test("only your coach has a word: another school's promise moves nothing", () => {
  const st = fresh(), pid = ranked(st)[50], rc = st["recruiting"];
  const c = recruiting._contact(st, "ohio-state", pid);
  (c["promises"] ||= []).push({ kind: "money", week: 1, about: { ask: 30 }, n: get(c, "n", 0) });
  (rc["nil"]["ohio-state"] ||= { held: {} })["held"][pid] = 30;
  recruiting._promises(st, 2);
  assert(!("word" in st["career"]));
});

test("a transfer rated a four-star or better counts as a star", () => {
  const st = fresh(), pid = ranked(st)[50];
  const p = st["recruiting"]["prospects"][pid];
  p["persona"] = { ...persona.of(st, pid), personality: "business" };
  Object.assign(p, { stars: null, portal: true, tier: recruiting.PORTAL_TOP_TIER });
  word.recruit_event(st, ME, pid, "money_broken");
  assert(word.reading(st) === word.WORD_START - word.COST["money_broken"] * word.STAR_COST, J(word.book(st)));
});

test("at Keep Them Home a promise of a starting role is believed as far as your word goes", () => {
  const st = bare();
  const e = { id: "x", pos: "QB", personality: "business", ask: { nil: 0, kind: "role", known: true }, offers: { promise: true },
    role_next: "starter", broken_promise: true, intent: "stay" };
  word.book(st)["overall"] = 90;
  assert(Math.abs(offseason.stay_chance(e, st) - Math.min(0.9, promises.PROMISE_AGAIN_STAY * 1.4)) < 1e-9);
  word.book(st)["overall"] = 20;
  assert(offseason.stay_chance(e, st) === 0.02, "under the floor he does not believe a second promise");
  assert(Math.abs(offseason.stay_chance(e) - promises.PROMISE_AGAIN_STAY) < 1e-9, "no career to read: the plain rule");
});

// ----- across the offseason -------------------------------------------------------------------------------------------------------

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
  Object.assign(st, { done: true, current_week: season.FINAL_WEEK, champion: "ohio-state" });
}

test("the word follows the coach into the next season, recovered once; and a season's judged promises feed it once", () => {
  const st = season.new_season(ME, "full", 5, undefined, undefined, true);
  assert(office.office_view(st)["word"]["text"] === "Strong" && !("word" in st["career"]), "the Office reads without writing");
  word.book(st)["overall"] = 40;
  finished(st);
  offseason.start(st);
  offseason.start(st);                                    // starting twice recovers once
  offseason.run_all(st);
  const next = offseason.next_season(st);
  assert(word.reading(next) === 47.5, J(word.book(next)));
  // the bands a season's promises were judged into (kept, bent, broken) move the word, once a year
  word.book(next)["overall"] = word.WORD_START;
  const year = season.season_year(next), roster = next["league"]["teams"][ME]["roster"];
  const qb = roster.find((c) => c["pos"] === "QB"), wr = roster.find((c) => c["pos"] === "WR");
  for (const c of [qb, wr]) Object.assign(c, { persona: { personality: "business" }, o: 40, s: 2 });     // not stars: the plain costs
  const bands = {
    [qb["id"]]: { band: "broken", score: 0.1, benched_big: false, personality: "business" },
    [wr["id"]]: { band: "kept", score: 0.9, benched_big: false, personality: "business" },
  };
  word.apply_bands(next, year, bands);
  word.apply_bands(next, year, bands);
  assert(word.reading(next) === word.WORD_START - 8 + 3, J(word.book(next)));
  assert(word.reading(next, offseason.GROUP["QB"]) === word.WORD_START - 8 + 3 - 8 && word.last_broken(next, "QB") === qb["n"]);
});

await run();
