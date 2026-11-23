// What a recruit's story changes in recruiting (career_js/persona.js story rules, read by recruiting): a Legacy's
// head start at his school and what it costs that school to let him down; a Hometown Hero's pull to his state; a
// Package Deal committing together, and only where both hold an offer; a Two-Sport recruit's draft risk and his
// signing-day roll; an Injury Comeback's loyalty, the AI's doubt and his clouded potential; a Late Bloomer's jump.
// Each rule forces the story on one prospect (his persona) and compares him with the same prospect with none.
// `node tests/test_story_rules.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random } from "../engine_js/pyrt.js";

const game = await start();
const { season, recruiting } = game;
recruiting.LOCKOUT_AT = 99;        // nobody shuts the door here: the lockout has its own test (tests/test_standards.mjs)
const { persona, prospects } = game.modules;

const ME = "ohio-state", OTHER = "michigan";
const NEUTRAL = { personality: "guarded", decider: "self", decider_topic: null };
const show = (v) => JSON.stringify(v);
const approx = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;
const teams = season.load_teams();

/** A new career on `seed`, shared by the tests that ask for the same one (each takes its own prospects). */
const careers = {};
function fresh(seed) {
  if (!careers[seed]) {
    careers[seed] = season.new_season(ME, "full", seed, undefined, undefined, true);
  }
  careers[seed]["current_week"] = 1;
  return careers[seed];
}

function force(st, pid, kind = null, data = {}) {
  st["recruiting"]["prospects"][pid]["persona"] = { ...NEUTRAL, story: kind, story_data: data };
}

function reset(st, pid, slug = ME) {
  const rc = st["recruiting"];
  delete rc["contacts"][pid];
  rc["pending"] = {}; rc["why_week"] = {}; rc["scenes"] = {};
  rc["hours"][slug] = 1000;
  for (const s of Object.keys(rc["offers"])) rc["offers"][s] = rc["offers"][s].filter((q) => q !== pid);
}

/** An untouched prospect with no story (optionally from `state`). */
function plain(st, used = [], state = null) {
  const rc = st["recruiting"];
  const by_rank = Object.keys(rc["prospects"]).sort((a, b) => rc["prospects"][a]["rank"] - rc["prospects"][b]["rank"]);
  for (const pid of by_rank) {
    const p = rc["prospects"][pid];
    if (used.includes(pid) || p["hidden"] || rc["status"][pid]["committed"] || persona.story(st, pid)[0] || ME in rc["lists"][pid]) continue;
    if (state && p["hometown"]["state"] !== state) continue;
    return pid;
  }
  throw new Error("no prospect fits");
}

/** The points one pitched contact from `slug` lands on him (the one-pitch path every school's contact takes). */
function pts(st, pid, slug, action, pitch) {
  reset(st, pid, slug);
  recruiting._act(st, slug, pid, action, pitch);
  return recruiting.pending(st, slug, pid);
}

/** A random source whose every chance comes up: whoever can commit this week does. */
class Always extends Random { random() { return 0.0; } }

test("a legacy's school starts ahead, and its lowball or hollow promise costs double", () => {
  const st = fresh(5), rc = st["recruiting"];
  const pid = plain(st);
  const win = recruiting._winning(st);
  force(st, pid);
  const flat = recruiting.interest(st, ME, pid, win);
  force(st, pid, "legacy", { school: ME });
  assert(approx(recruiting.interest(st, ME, pid, win), flat + persona.LEGACY_HEAD, 1e-6), "the legacy school's head start");
  assert(!(ME in rc["lists"][pid]), "a head start, not a place on his list");
  // another school's Coach or Prestige pitch against a legacy counts more; its Academics pitch as usual
  for (const t of ["coach", "prestige", "academics"]) {
    force(st, pid);
    const base = pts(st, pid, OTHER, "message", t);
    force(st, pid, "legacy", { school: ME });
    const want = base * (["coach", "prestige"].includes(t) ? persona.LEGACY_PITCH : 1.0);
    assert(approx(pts(st, pid, OTHER, "message", t), want), () => show([t, want]));
  }
  force(st, pid);
  const own = pts(st, pid, ME, "message", "coach");
  force(st, pid, "legacy", { school: ME });
  assert(approx(pts(st, pid, ME, "message", "coach"), own), "the legacy school's own Coach pitch is not raised");
  // the legacy school's lowball cools him twice as long; another school's as usual
  assert(recruiting.ask_from(st, ME, pid) >= 10);
  reset(st, pid);
  recruiting._act(st, ME, pid, "offer", "coach", 0);
  assert(rc["contacts"][pid][ME]["cooled_until"] === st["current_week"] + recruiting.COOL_WEEKS * persona.LEGACY_COST, () => show(rc["contacts"][pid][ME]));
  force(st, pid, "legacy", { school: OTHER });
  reset(st, pid);
  recruiting._act(st, ME, pid, "offer", "coach", 0);
  assert(rc["contacts"][pid][ME]["cooled_until"] === st["current_week"] + recruiting.COOL_WEEKS);
  reset(st, pid);
  force(st, pid, "legacy", { school: ME });
  assert(persona.hollow_mult(st, pid, ME) === persona.LEGACY_COST * persona.hollow_mult(st, pid, OTHER));
});

test("a Hometown Hero is pulled harder to his state's schools, and an out-of-state pitch counts less", () => {
  const st = fresh(5), rc = st["recruiting"];
  const home = teams[ME]["state"];
  assert(teams[OTHER]["state"] !== home);
  const pid = plain(st, [], home);
  const win = recruiting._winning(st);
  // his pull toward a school: his interest less his list points and less the fit (what he wants against the program,
  // which rides on top of the pull and is no part of his story)
  const pull = (slug) => recruiting.interest(st, slug, pid, win) - (rc["lists"][pid][slug] ?? 0.0) - recruiting.fit_interest(st, slug, pid, win);
  force(st, pid);
  const [pull_in, pull_out] = [pull(ME), pull(OTHER)];
  force(st, pid, "hero", { state: home });
  assert(approx(pull(ME), pull_in * persona.HERO_STATE, 1e-6), () => show([pull(ME), pull_in]));
  assert(approx(pull(OTHER), pull_out, 1e-6), "an out-of-state school's pull is as usual");
  for (const t of ["prestige", "coach", "playing_time", "nil"]) {
    force(st, pid);
    const [base_out, base_in] = [pts(st, pid, OTHER, "message", t), pts(st, pid, ME, "message", t)];
    force(st, pid, "hero", { state: home });
    const want = base_out * (persona.HERO_FULL.includes(t) ? 1.0 : persona.HERO_AWAY);     // Playing Time and NIL travel in full
    assert(approx(pts(st, pid, OTHER, "message", t), want), () => show([t, want]));
    assert(approx(pts(st, pid, ME, "message", t), base_in), "an in-state school's pitch is as usual");
  }
});

test("a Package Deal commits only where his mate holds an offer too, and they commit and flip together", () => {
  const st = fresh(6), rc = st["recruiting"];
  st["current_week"] = 10;
  const a = plain(st);
  const b = plain(st, [a], rc["prospects"][a]["hometown"]["state"]);
  force(st, a, "package", { mate: b, lead: true });
  force(st, b, "package", { mate: a, lead: false });
  equal([persona.mate(st, a), persona.mate(st, b)], [b, a]);
  const [x, y] = ["texas", "alabama"];
  rc["offers"][x] = [...new Set([...(rc["offers"][x] || []), a, b])];
  rc["offers"][y] = [...new Set([...(rc["offers"][y] || []), a])];
  rc["lists"][a][y] = 80.0;                  // he likes Alabama best, but Alabama has not offered his mate
  rc["lists"][a][x] = 40.0;
  rc["lists"][b][x] = 40.0;
  recruiting._draws(st, 10, new Always(1));
  assert(rc["status"][a]["committed"] === x, () => show(rc["status"][a]));
  assert(rc["status"][b]["committed"] === x, "his mate commits with him, the same week");
  const weeks = Object.fromEntries(rc["log"].filter((e) => e["kind"] === "commit" && [a, b].includes(e["pid"])).map((e) => [e["pid"], e["week"]]));
  assert(weeks[a] === weeks[b], () => show(weeks));
  // Alabama offers the mate too: now he flips there, and his mate with him
  rc["offers"][y].push(b);
  rc["status"][a]["firmness"] = 0;
  rc["status"][b]["firmness"] = 0;
  rc["lists"][b][y] = 80.0;
  recruiting._draws(st, 11, new Always(1));
  equal([rc["status"][a]["committed"], rc["status"][b]["committed"]], [y, y]);
});

test("a Two-Sport recruit's draft risk falls with Playing Time pitches and NIL over his ask, never under the floor", () => {
  const st = fresh(7), rc = st["recruiting"];
  const pid = plain(st);
  force(st, pid, "two_sport");
  assert(approx(persona.draft_risk(st, ME, pid), persona.DRAFT_RISK));
  equal([persona.draft_word(persona.DRAFT_RISK), persona.draft_word(0.06), persona.draft_word(0.03)], ["High", "Some", "Low"]);
  reset(st, pid);
  recruiting._contact(st, ME, pid)["pt"] = 2;          // two Playing Time pitches
  assert(approx(persona.draft_risk(st, ME, pid), persona.DRAFT_RISK - 2 * persona.DRAFT_PT));
  const ask = recruiting.ask_from(st, ME, pid);
  recruiting._act(st, ME, pid, "offer", "playing_time", Math.trunc(ask * 1.4) + 5);
  const held = rc["nil"][ME]["held"][pid];
  const pt = rc["contacts"][pid][ME]["pt"];
  const over = Math.max(0.0, held / Math.max(ask, 5) - 1);
  const want = Math.max(persona.DRAFT_FLOOR, persona.DRAFT_RISK - pt * persona.DRAFT_PT - persona.DRAFT_NIL * over);
  assert(approx(persona.draft_risk(st, ME, pid), want, 1e-6), () => show([persona.draft_risk(st, ME, pid), want]));
  rc["contacts"][pid][ME]["pt"] = 50;                  // many pitches cannot take it under the floor
  assert(approx(persona.draft_risk(st, ME, pid), persona.DRAFT_FLOOR));
  force(st, pid);
  assert(persona.draft_risk(st, ME, pid) === 0.0, "no story, no draft risk");
});

test("on signing day a Two-Sport recruit may go pro: he signs nowhere and his school's NIL comes back", () => {
  const st = fresh(7), rc = st["recruiting"];
  const keep = [persona.DRAFT_RISK, persona.DRAFT_FLOOR];
  try {
    const pid = plain(st);
    force(st, pid, "two_sport");
    reset(st, pid);
    recruiting._act(st, ME, pid, "offer", "playing_time", 10);
    recruiting._commit(st, pid, ME);
    const budget = rc["nil"][ME]["budget"];
    [persona.DRAFT_RISK, persona.DRAFT_FLOOR] = [1.0, 1.0];          // a sure thing
    recruiting._sign(st, false);
    const s = rc["status"][pid];
    assert(s["pro"] && s["signed"] === "FCS", () => show(s));
    assert(rc["nil"][ME]["budget"] === budget && !(pid in rc["nil"][ME]["held"]), "the package is not spent");
    const ev = rc["log"].filter((e) => e["pid"] === pid && e["kind"] === "pro");
    assert(ev.length && ev[0]["school"] === ME && /^[A-Z].*\.$/.test(ev[0]["line"]), () => show(ev));
    assert(prospects.row(st, pid, ME)["school_name"] === "Pro Baseball");
    // and with no risk he signs
    const other = plain(st, [pid]);
    force(st, other, "two_sport");
    rc["offers"][ME].push(other);
    recruiting._commit(st, other, ME);
    [persona.DRAFT_RISK, persona.DRAFT_FLOOR] = [0.0, 0.0];
    recruiting._sign(st, false);
    assert(rc["status"][other]["signed"] === ME && !rc["status"][other]["pro"]);
  } finally {
    [persona.DRAFT_RISK, persona.DRAFT_FLOOR] = keep;
  }
});

test("an Injury Comeback rewards the schools that reached him early, is doubted by some AI schools and reads less surely", () => {
  const st = fresh(8), rc = st["recruiting"];
  const pid = plain(st);
  force(st, pid);
  st["current_week"] = 7;
  const base = pts(st, pid, ME, "call", "coach");
  force(st, pid, "comeback");
  reset(st, pid);
  st["current_week"] = 3;
  recruiting._act(st, ME, pid, "message", null);         // an early contact
  rc["pending"] = {}; rc["why_week"] = {};
  st["current_week"] = 7;
  rc["contacts"][pid][ME]["n"] = 0;                      // the same diminishing as the baseline
  recruiting._act(st, ME, pid, "call", "coach");
  assert(approx(recruiting.pending(st, ME, pid), base * persona.LOYALTY, 1e-6), () => show([recruiting.pending(st, ME, pid), base]));
  assert(approx(pts(st, pid, ME, "call", "coach"), base), "a school that first reached him in Week 6 or later has no loyalty");
  const schools = recruiting.fbs_schools(st);
  const share = schools.filter((s) => persona.ai_doubts(st, s, pid)).length / schools.length;
  assert(share >= 0.25 && share <= 0.55, () => String(share));
  assert(!persona.ai_doubts(st, ME, pid), "your school is never doubted for him: that is your call");
  force(st, pid);
  assert(!schools.some((s) => persona.ai_doubts(st, s, pid)));
  // his potential reads less certain: the same look's error on it is larger
  const spread = (kind) => {
    force(st, pid, kind);
    delete rc["reads"][pid];
    recruiting.look(st, pid, 70, new Random(1));
    return recruiting.read_spread(st, pid, "potential")[1];
  };
  const [wide, narrow] = [spread("comeback"), spread(null)];
  assert(wide > narrow, () => show([wide, narrow]));
});

test("a prospect shown under his real stars has public grades that understate him", () => {
  const st = fresh(8), rc = st["recruiting"];
  const p = Object.values(rc["prospects"]).find((q) => q["real"]);
  const shown = prospects._public_grades(p);
  const { real, ...rest } = p;
  const as_is = prospects._public_grades(rest);
  for (const g of recruiting.GROUPS) assert(approx(shown[g], as_is[g] - persona.SHOWN_BAND), () => show([g, shown[g], as_is[g]]));
});

test("a Late Bloomer jumps once to his real stars: the class is re-ranked, his ask follows and AI schools take notice", () => {
  const st = fresh(9), rc = st["recruiting"];
  const [q, s] = Object.entries(persona.stories(st)).find(([, x]) => x["story"] === "bloomer");
  const p = rc["prospects"][q];
  const real = { ...p["real"] };
  const version = rc["class_v"] ?? 0;
  assert(persona.bloom(st, s["story_data"]["week"]).includes(q));
  assert(p["stars"] === real["stars"] && p["composite"] === real["composite"] && !("real" in p), () => show(p));
  assert(p["nil_ask"] === recruiting.nil_ask(p, rc["year"], rc["seed"]), "his ask is a prospect of his new stars'");
  assert(rc["class_v"] === version + 1 && recruiting.tier_of(p) === real["stars"]);
  const order = Object.keys(rc["prospects"]).sort((a, b) => rc["prospects"][a]["rank"] - rc["prospects"][b]["rank"]);
  equal(order.map((z) => rc["prospects"][z]["rank"]), order.map((_, i) => i + 1), "the ranking is one order 1..N");
  assert(order.slice(1).every((v, i) => rc["prospects"][order[i]]["composite"] >= rc["prospects"][v]["composite"]), "ranked by the shown composite");
  const ev = rc["log"].filter((e) => e["pid"] === q && e["kind"] === "bloomed");
  assert(ev.length === 1 && ev[0]["line"] === `He jumped to ${persona.STAR_WORD[real["stars"]]} stars.`, () => show(ev));
  const on = Object.entries(rc["boards"]).filter(([slug, b]) => slug !== ME && b.includes(q));
  assert(on.length >= persona.BLOOM_BOARDS, () => String(on.length));
  assert(!persona.bloom(st, s["story_data"]["week"]).includes(q), "he jumps once");
});

await run();
