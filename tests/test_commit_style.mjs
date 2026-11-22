// Commit Style (career_js/persona.js): how a recruit goes about committing. The draw is seeded per prospect and never
// stored, and each style is a fifth of the class. An Early Bird commits sooner and firmer; a Signing Day recruit waits
// for the early signing period; a Hat Ceremony names finalists and a date and picks among them on the day; a Quiet
// Commit is kept from the news and from other schools (and his interest in them stops climbing); Needs Attention
// softens when you go quiet. Your staff learns the style by an official visit or by holding your offer four weeks.
// Each rule is checked with the style forced on one prospect.
// `node tests/test_commit_style.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { get } from "../engine_js/pyrt.js";

const game = await start();
const { season, recruiting } = game;
const { persona, prospects, news } = game.modules;

const ME = "ohio-state";
const RIVALS = ["michigan", "texas", "georgia", "oregon"];
const J = (v) => () => JSON.stringify(v);
const ALWAYS = { random: () => 0.0 };     // a stand-in for the week's stream: every roll comes up (a commit whenever the odds are above zero)

const st = season.new_season(ME, "full", 5, undefined, undefined, true);
st["current_week"] = 1;
const rc = st["recruiting"];
const used = new Set();

const force = (pid, style, personality = "guarded") => {
  rc["prospects"][pid]["persona"] = { personality, decider: "self", decider_topic: null, story: null, story_data: {}, commit_style: style };
};
/** A prospect with no story, on nobody's list and with no offers; each is handed out once. */
function plain() {
  const pid = Object.keys(rc["prospects"]).sort((a, b) => rc["prospects"][a]["rank"] - rc["prospects"][b]["rank"]).find((q) => !used.has(q)
    && !rc["prospects"][q]["hidden"] && !rc["status"][q]["committed"] && !persona.story(st, q)[0] && !Object.keys(rc["lists"][q]).length
    && !Object.values(rc["offers"]).some((pids) => pids.includes(q)));
  assert(pid !== undefined, "no prospect fits");
  used.add(pid);
  return pid;
}
/** Four schools offer him; `leader` far ahead on his list, the others close together. */
function race(pid, leader = RIVALS[0], lead = 30.0) {
  RIVALS.forEach((s, i) => {
    (rc["offers"][s] ||= []).push(pid);
    rc["lists"][pid][s] = 10.0 - i;
  });
  rc["lists"][pid][leader] = lead;
}
const draws = (week) => { st["current_week"] = week; recruiting._draws(st, week, ALWAYS); };
const last_event = (pid, kind) => rc["log"].filter((e) => e["kind"] === kind && e["pid"] === pid).at(-1);

test("the style is a seeded draw, a fifth of the class each, and never stored on the prospect", () => {
  assert(persona.draw_style("p1", 7) === persona.draw_style("p1", 7));
  const some = new Set();
  for (let i = 0; i < 40; i++) some.add(persona.draw_style(`q${i}`, 7));
  assert(some.size === 5);
  const n = 6000, got = {};
  for (let i = 0; i < n; i++) { const k = persona.draw_style(`x${i}`, 3); got[k] = (got[k] || 0) + 1; }
  for (const [k, want] of Object.entries(persona.STYLES)) assert(Math.abs((got[k] || 0) / n - want) <= 0.025, J([k, got[k] / n]));
  const pids = Object.keys(rc["prospects"]);
  for (const k of Object.keys(persona.STYLES)) {
    const share = pids.filter((q) => persona.style(st, q) === k).length / pids.length;
    assert(share >= 0.17 && share <= 0.23, J([k, share]));
  }
  assert(pids.slice(0, 200).every((q) => persona.style(st, q) === persona.draw_style(q, rc["seed"])));
  assert(!Object.values(rc["prospects"]).some((p) => "persona" in p), "a commit style is a fixed draw: never stored");
  equal(new Set(Object.keys(persona.STYLE_LABEL)), new Set(Object.keys(persona.STYLES)));
  for (const label of Object.values(persona.STYLE_LABEL)) {
    assert(label.split(" ").every((w) => /^[A-Z]/.test(w) || ["a", "of", "to"].includes(w)), `${label} is not Title Case`);
  }
});

test("an Early Bird is likelier to commit from Week 4 to Week 8 and starts firmer", () => {
  const pid = plain(), other = plain();
  force(pid, "early_bird");
  force(other, "hat");
  equal([3, 4, 8, 9].map((w) => persona.commit_odds_mult(st, pid, w)), [1.0, persona.EARLY_ODDS, persona.EARLY_ODDS, 1.0]);
  assert(persona.commit_odds_mult(st, other, 6) === 1.0);
  for (const q of [pid, other]) {
    (rc["offers"][ME] ||= []).push(q);
    recruiting._commit(st, q, ME);
  }
  assert(rc["status"][pid]["firmness"] === recruiting.HARD_AT - persona.EARLY_FIRM, J(rc["status"][pid]));
  assert(rc["status"][other]["firmness"] === recruiting.FIRM_START);
});

test("a Signing Day recruit commits to nobody before the early signing period, however far ahead his leader is", () => {
  const pid = plain();
  force(pid, "signing_day");
  race(pid);
  for (const w of [4, 9, 14]) {
    draws(w);
    assert(rc["status"][pid]["committed"] === null, `committed in Week ${w}`);
  }
  draws(recruiting.early_signing_week());
  assert(rc["status"][pid]["committed"] === RIVALS[0], J(rc["status"][pid]));
  const q = plain();                                      // the same race for an Early Bird ends at once
  force(q, "early_bird");
  race(q);
  draws(5);
  assert(rc["status"][q]["committed"] === RIVALS[0]);
});

test("a Hat Ceremony names his finalists and a date, and picks the finalist he likes most on the day, never one left out", () => {
  const pid = plain();
  force(pid, "hat");
  race(pid);
  draws(6);
  assert(rc["status"][pid]["committed"] === null);
  const [day, fin] = rc["hats"][pid];
  assert(day === 6 + persona.HAT_LEAD && fin.length === persona.HAT_FINALISTS && fin.includes(RIVALS[0]) && fin.every((s) => RIVALS.includes(s)), J(rc["hats"][pid]));
  const e = last_event(pid, "hat");
  assert(e["line"].startsWith("He will pick from ") && e["line"].includes(season.week_label(day)) && e["line"].endsWith("."), e["line"]);
  const out = RIVALS.find((s) => !fin.includes(s));
  rc["lists"][pid][out] = 80.0;                           // the school left out surges: too late
  rc["lists"][pid][fin[1]] = 60.0;
  draws(7);
  assert(rc["status"][pid]["committed"] === null, "nobody wins before the day he named");
  draws(day);
  assert(rc["status"][pid]["committed"] === fin[1], J([rc["status"][pid], fin]));
  assert(last_event(pid, "commit")["hat"] === true && !(pid in rc["hats"]));
  const keep = rc["prospects"][pid]["stars"];
  rc["prospects"][pid]["stars"] = 5;
  const items = news._recruiting(st, season.load_teams(), day).filter((x) => get(x["link"], "pid") === pid);
  rc["prospects"][pid]["stars"] = keep;
  assert(items.length && items[0]["text"].includes("hat ceremony"), J(items));
  const q = plain();                                      // a ceremony set late lands on the early signing period
  force(q, "hat");
  race(q);
  draws(recruiting.early_signing_week() - 1);
  assert(rc["hats"][q][0] === recruiting.early_signing_week());
});

test("a Quiet Commit is kept from the news and from every other school, and his interest in them stops climbing", () => {
  const pid = plain();
  force(pid, "quiet");
  rc["prospects"][pid]["stars"] = 5;
  race(pid, "michigan");
  (rc["offers"][ME] ||= []).push(pid);
  draws(5);
  assert(rc["status"][pid]["committed"] === "michigan" && last_event(pid, "commit")["quiet"] === true);
  assert(!news._recruiting(st, season.load_teams(), 5).some((x) => get(x["link"], "pid") === pid), "a quiet commit is not news");
  const row = prospects.row(st, pid, ME);
  assert(row["committed"] === null && row["quiet"] === true && row["school_name"] === null, J([row["committed"], row["quiet"]]));
  const prof = prospects.profile(st, pid, ME);
  assert(prof["public"]["committed"] === null && prof["public"]["quiet"] && prof["flip"] === null);
  const theirs = prospects.row(st, pid, "michigan");
  assert(theirs["committed"] === "michigan" && !theirs["quiet"], "his own school knows");
  assert(!(prospects.history_index(st, ME)[pid] || []).some((h) => h["kind"] === "commit"));
  assert((prospects.history_index(st, "michigan")[pid] || []).some((h) => h["kind"] === "commit"));
  const mich = prospects.national_classes(st, ME)["schools"].find((r) => r["school"] === "michigan");
  assert(mich && !mich["top"].some((t) => t["id"] === pid), "he is left out of the class you see for his school");
  rc["hours"][ME] = rc["hours"]["michigan"] = 500;
  const before = recruiting.pending(st, ME, pid);
  recruiting.act(st, ME, pid, "message");
  assert(recruiting.pending(st, ME, pid) === before, "a quiet commit's interest in another school does not climb");
  recruiting._act(st, "michigan", pid, "message", "playing_time");
  assert(recruiting.pending(st, "michigan", pid) > 0);
  assert(persona.climbs(st, ME, pid, -2.0) === -2.0, "but it can still fall");
});

test("a Needs Attention commit firms up in a week you were in touch, slips in a quiet one, and can come unlocked", () => {
  const pid = plain();
  force(pid, "needs_attention");
  (rc["offers"][ME] ||= []).push(pid);
  recruiting._commit(st, pid, ME);
  recruiting._contact(st, ME, pid)["last_contact"] = 5;
  rc["status"][pid]["firmness"] = 50;
  st["current_week"] = 6;
  recruiting._firm_up(st, 6);
  const f = rc["status"][pid]["firmness"];
  assert(f > 50, "in touch the week before: he firms up");
  st["current_week"] = 7;
  recruiting._firm_up(st, 7);
  assert(rc["status"][pid]["firmness"] === f - persona.NEEDS_DROP, J(rc["status"][pid]));
  Object.assign(rc["status"][pid], { firmness: 99, hard: true });
  st["current_week"] = 8;
  recruiting._firm_up(st, 8);
  assert(rc["status"][pid]["hard"] && recruiting.flip_weekly(st, pid, 10.0) === 0.0, "a hard commit holds through one quiet week");
  st["current_week"] = 9;
  recruiting._firm_up(st, 9);
  assert(!rc["status"][pid]["hard"] && rc["status"][pid]["firmness"] < recruiting.HARD_AT && recruiting.flip_weekly(st, pid, 10.0) > 0);
  const e = last_event(pid, "softened");
  assert(e["line"].startsWith("He has not heard from ") && e["line"].endsWith("."), e["line"]);
  const q = plain();                                      // any other style's hard commit stays locked
  force(q, "early_bird");
  rc["offers"][ME].push(q);
  recruiting._commit(st, q, ME);
  Object.assign(rc["status"][q], { firmness: 99, hard: true });
  recruiting._firm_up(st, 14);
  assert(rc["status"][q]["hard"] && rc["status"][q]["firmness"] === 99);
});

test("your staff learns his style by hosting his official visit or by holding your offer four weeks", () => {
  const pid = plain();
  force(pid, "hat");
  let v = persona.view(st, ME, pid);
  assert(v["commit_style"] === null && v["has_style"]);
  rc["hours"][ME] = 500;
  st["current_week"] = 2;
  recruiting.act(st, ME, pid, "offer");
  for (const w of [3, 4, 5]) {
    persona.learn_styles(st, w);
    assert(persona.view(st, ME, pid)["commit_style"] === null, `known in Week ${w}`);
  }
  persona.learn_styles(st, 2 + persona.STYLE_OFFER_WEEKS);
  v = persona.view(st, ME, pid);
  assert(v["commit_style"] === "Hat Ceremony" && v["style_key"] === "hat", J(v));
  assert((prospects.history_index(st, ME)[pid] || []).some((h) => h["kind"] === "learned" && h["line"] === persona.STYLE_LEARNED["hat"]));
  const q = plain();
  force(q, "quiet");
  (rc["visits"][q] ||= {})[ME] = { week: 3, done: true };
  persona.learn_styles(st, 3);
  assert(persona.view(st, ME, q)["commit_style"] === "Quiet Commit");
  const r = plain();                                      // a visit to another school tells you nothing
  (rc["visits"][r] ||= {})["michigan"] = { week: 3, done: true };
  persona.learn_styles(st, 9);
  assert(persona.view(st, ME, r)["commit_style"] === null);
});

await run();
