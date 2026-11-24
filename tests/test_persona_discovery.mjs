// Who a recruit is, and how your staff finds out (career_js/persona.js). His personality, who decides and the
// decider's topic are a fixed draw from the class's seed, never written into the save; a transfer's decider is never
// his high school coach or his grandmother. All of it starts Not Known Yet: two looks of his report tell who decides,
// your first call (a Guarded recruit: your first in-home visit) tells his personality, a complete report tells
// everything, and what your staff learned is a sentence in his History, never the week's news. His story is found
// out the same way: a Hometown Hero and an Injury Comeback are public, the rest wait on the report or a call.
// `node tests/test_persona_discovery.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random } from "../engine_js/pyrt.js";

const game = await start();
const { season, recruiting } = game;
const { persona, prospects, clear, news } = game.modules;
persona.DECIDERS_ON = true;   // who decides is switched off in the game for now (persona.DECIDERS_ON): these tests hold what it does when it is on

const ME = "ohio-state";
const show = (v) => JSON.stringify(v);

function fresh(seed = 5) {
  const st = season.new_season(ME, "full", seed, undefined, undefined, true);
  st["current_week"] = 1;
  st["recruiting"]["hours"][ME] = 1000;
  return st;
}

const st = fresh();
const rc = st["recruiting"];
const used = new Set();

/** The best untouched prospect no test has used yet, with no story of his own unless `want` says otherwise. */
function pick(want = (pid) => persona.story(st, pid)[0] === null) {
  const by_rank = Object.keys(rc["prospects"]).sort((a, b) => rc["prospects"][a]["rank"] - rc["prospects"][b]["rank"]);
  for (const pid of by_rank) {
    const p = rc["prospects"][pid];
    if (used.has(pid) || p["hidden"] || rc["status"][pid]["committed"] || ME in rc["lists"][pid] || ME in (rc["contacts"][pid] || {})) continue;
    if (!want(pid)) continue;
    used.add(pid);
    return pid;
  }
  throw new Error("no prospect fits");
}

function force(pid, personality, decider = "mom", topic = "proximity", story = null, data = {}) {
  rc["prospects"][pid]["persona"] = { personality, decider, decider_topic: topic, story, story_data: data, commit_style: "hat" };
}

/** `n` looks of `weight` each: a scouting trip's, or an area scout's (`by` a staff id). */
function looks(pid, n, weight = 1.0, seed = 1, by = null) {
  const rng = new Random(seed);
  for (let i = 0; i < n; i++) recruiting.look(st, pid, 70, rng, by, undefined, weight);
}

const learned = (pid, trait = null) => rc["log"].filter((e) => e["pid"] === pid && e["kind"] === "learned" && (trait === null || e["trait"] === trait));
const traits = (pid) => { const v = persona.view(st, ME, pid); return [v["personality"], v["decider"], v["decider_topic"]]; };

// ----- the draw -------------------------------------------------------------------------------------------------

test("the same prospect and seed always draw the same persona, and prospects differ", () => {
  equal(persona.draw("p1", 7), persona.draw("p1", 7));
  assert(Array.from({ length: 20 }, (_, i) => persona.draw(`q${i}`, 7)).some((d) => show(d) !== show(persona.draw("p1", 7))));
});

test("the five personalities are equally likely and the deciders hold their shares", () => {
  const n = 5000;
  const draws = Array.from({ length: n }, (_, i) => persona.draw(`x${i}`, 3));
  for (const k of persona.PERSONALITIES) {
    const share = draws.filter((d) => d["personality"] === k).length / n;
    assert(share >= 0.17 && share <= 0.23, () => show([k, share]));
  }
  for (const [k, want] of Object.entries(persona.DECIDERS)) {
    const share = draws.filter((d) => d["decider"] === k).length / n;
    assert(Math.abs(share - want) <= 0.03, () => show([k, share]));
  }
  for (const d of draws) {                    // a recruit who decides himself has no decider's topic; anyone else has one of the decider's
    assert((d["decider_topic"] === null) === (d["decider"] === "self"), () => show(d));
    if (d["decider"] !== "self") assert(persona.DECIDER_TOPICS[d["decider"]].includes(d["decider_topic"]), () => show(d));
  }
});

test("a class's personas are never stored in the save, and reading one stores nothing", () => {
  const stored = () => Object.values(rc["prospects"]).some((p) => "persona" in p);
  assert(!stored(), "the persona is a fixed draw: never stored in the save");
  for (const pid of Object.keys(rc["prospects"]).slice(0, 50)) {
    equal(persona.of(st, pid), persona.draw(pid, rc["seed"], false, rc["topics_v"] === 2));
  }
  assert(!stored(), "reading a persona must not store it");
});

test("a persona an old save stored on the prospect is read as it is", () => {
  const pid = Object.keys(rc["prospects"])[0];
  const kept = { personality: "shy", decider: "mom", decider_topic: "academics" };
  rc["prospects"][pid]["persona"] = kept;
  equal(persona.of(st, pid), kept);
  delete rc["prospects"][pid]["persona"];
  equal(persona.of(st, pid), persona.draw(pid, rc["seed"], false, rc["topics_v"] === 2));
});

test("a transfer's decider is Himself, Mom, Dad or Trainer, and the class draw stays put", () => {
  const seed = 7;
  const pids = Array.from({ length: 4000 }, (_, i) => `r2027-${String(i + 1).padStart(4, "0")}`);
  const count = (xs) => xs.reduce((m, x) => ({ ...m, [x]: (m[x] || 0) + 1 }), {});
  const portal = count(pids.map((pid) => persona.draw(pid, seed, true)["decider"]));
  equal(Object.keys(portal).sort(), [...persona.PORTAL_DECIDERS].sort());
  const total = persona.PORTAL_DECIDERS.reduce((a, d) => a + persona.DECIDERS[d], 0);
  for (const d of persona.PORTAL_DECIDERS) {
    assert(Math.abs(portal[d] / pids.length - persona.DECIDERS[d] / total) < 0.03, () => show([d, portal[d]]));
  }
  for (const pid of pids.slice(0, 500)) {
    assert(persona.draw(pid, seed)["personality"] === persona.draw(pid, seed, true)["personality"], "a transfer keeps his personality");
  }
  const cls = count(pids.map((pid) => persona.draw(pid, seed)["decider"]));
  assert(cls["hs_coach"] && cls["grandma"], () => show(cls));
  // through `of`: a portal's recruiting block picks the portal draw
  const block = { recruiting: { seed, portal: true, prospects: Object.fromEntries(pids.slice(0, 400).map((pid) => [pid, { id: pid }])) } };
  assert(!pids.slice(0, 400).some((pid) => ["hs_coach", "grandma"].includes(persona.of(block, pid)["decider"])));
});

// ----- finding out ----------------------------------------------------------------------------------------------

test("nothing about him is known at the start", () => {
  const pid = pick();
  equal(traits(pid), [null, null, null]);
  assert(prospects.profile(st, pid, ME)["traits"]["personality"] === null);
  assert(prospects.board_row(st, pid, ME)["traits"]["decider"] === null);
});

test("two looks of his report tell who decides and what the decider cares about, not his personality", () => {
  const pid = pick();
  force(pid, "business", "mom", "academics");
  looks(pid, 1);
  assert(persona.view(st, ME, pid)["decider"] === null);
  looks(pid, 1, 1.0, 2);
  equal(traits(pid), [null, "Mom", "academics"]);
});

test("half looks from an area scout add up: four of them tell who decides", () => {
  const pid = pick();
  force(pid, "business", "dad", "nil");
  looks(pid, 3, 0.5, 3, "scout-1");
  assert(persona.view(st, ME, pid)["decider"] === null);
  looks(pid, 1, 0.5, 4, "scout-1");
  assert(persona.view(st, ME, pid)["decider"] === "Dad");
});

test("your first call tells his personality; a message tells nothing", () => {
  const pid = pick();
  force(pid, "cocky");
  recruiting.act(st, ME, pid, "message");
  assert(persona.view(st, ME, pid)["personality"] === null);
  recruiting.act(st, ME, pid, "call");                  // the call opens a conversation: still the first call
  assert(persona.view(st, ME, pid)["personality"] === "Cocky");
  const shy = pick();
  force(shy, "shy");
  recruiting.act(st, ME, shy, "call");
  assert(persona.view(st, ME, shy)["personality"] === "Shy");
});

test("a Guarded recruit gives his personality away only at an in-home visit", () => {
  const pid = pick();
  force(pid, "guarded");
  recruiting.act(st, ME, pid, "call", "prestige");
  assert(persona.view(st, ME, pid)["personality"] === null);
  recruiting.act(st, ME, pid, "hc_visit", "prestige");
  assert(persona.view(st, ME, pid)["personality"] === "Guarded");
  const other = pick();
  force(other, "cocky");
  recruiting.act(st, ME, other, "hc_visit", "prestige");
  assert(persona.view(st, ME, other)["personality"] === "Cocky", "a first visit tells anyone's");
});

test("an in-home visit tells who decides", () => {
  const pid = pick();
  force(pid, "business", "mom", "proximity");
  assert(persona.view(st, ME, pid)["decider"] === null);
  recruiting.act(st, ME, pid, "hc_visit");
  assert(persona.view(st, ME, pid)["decider"] === "Mom");
});

test("what another school learns is not yours to see", () => {
  const pid = pick();
  force(pid, "cocky");
  rc["hours"]["alabama"] = 1000;
  recruiting._act(st, "alabama", pid, "call");
  assert(persona.view(st, ME, pid)["personality"] === null);
  assert(!persona.learn(st, "alabama", pid, "decider"), "only your school keeps what it learned");
  const k = persona.known(st, ME, pid);
  equal([k["personality"], k["decider"]], [false, false]);
});

test("each thing your staff learns is one sentence in his History, logged once", () => {
  const pid = pick();
  force(pid, "business", "mom");
  recruiting.act(st, ME, pid, "call");
  looks(pid, 2, 1.0, 2);
  const lines = prospects.board_row(st, pid, ME)["history"].filter((e) => e["kind"] === "learned").map((e) => e["line"]).sort();
  equal(lines, ["Your staff learned he's all business.", "Your staff learned his mom has the final say."]);
  looks(pid, 1, 1.0, 5);                                 // the report completes: his commit style is new, the rest is not said twice
  const after = learned(pid).map((e) => e["trait"]);
  assert(after.filter((t) => t === "personality").length === 1 && after.filter((t) => t === "decider").length === 1, () => show(after));
  for (const e of learned(pid)) assert(/^[A-Z]/.test(e["line"]) && e["line"].endsWith("."), e["line"]);
});

test("what your staff learned stays out of the week's news", () => {
  assert(recruiting.HISTORY_ONLY.includes("learned") && !recruiting.REPORT_KINDS.includes("learned"));
});

test("a complete report leaves no guesswork: his priorities, personality, decider and commit style are all known", () => {
  const pid = pick();
  const p = rc["prospects"][pid];
  looks(pid, recruiting.REPORT_LOOKS);
  assert(recruiting.report_complete(rc["reads"][pid]));
  const told = (rc["revealed"][ME] || {})[pid] || [];
  assert(p["priorities"].every((t) => told.includes(t)), () => show([p["priorities"], told]));
  const k = persona.known(st, ME, pid);
  assert(k["personality"] && k["decider"] && k["story"], () => show(k));
  assert(k["style"] === (persona.style(st, pid) !== null), "his commit style too, when he has one");
  const v = persona.view(st, ME, pid);
  assert(v["personality"] && v["decider"] && v["story"] === persona.NO_STORY, () => show(v));
});

// ----- his story ------------------------------------------------------------------------------------------------

test("a Hometown Hero and an Injury Comeback are public at once and never news to your staff", () => {
  const pid = pick();
  force(pid, "business", "self", null, "hero", { state: rc["prospects"][pid]["hometown"]["state"] });
  const v = persona.view(st, ME, pid);
  equal([v["story"], v["story_key"], v["story_detail"]], ["Hometown Hero", "hero", null]);
  force(pid, "business", "self", null, "comeback");
  assert(persona.view(st, ME, pid)["story"] === "Injury Comeback");
  assert(!learned(pid, "story").length);
});

test("a legacy is Not Known Yet until the complete report, which names his school in his History", () => {
  const teams = season.load_teams();
  const pid = pick();
  force(pid, "business", "self", null, "legacy", { school: "michigan" });
  let v = persona.view(st, ME, pid);
  equal([v["story"], v["story_detail"]], [null, null]);
  looks(pid, 2);
  assert(persona.view(st, ME, pid)["story"] === null, "two looks tell who decides, not his story");
  looks(pid, 1, 1.0, 2);
  v = persona.view(st, ME, pid);
  equal([v["story"], v["story_detail"]], ["Legacy", teams["michigan"]["name"]]);
  equal(learned(pid, "story").map((e) => e["line"]), [`Your staff learned he is a legacy at ${teams["michigan"]["name"]}.`]);
  assert(prospects.profile(st, pid, ME)["traits"]["story"] === "Legacy");
  assert(prospects.board_row(st, pid, ME)["traits"]["story"] === "Legacy");
});

test("a Two-Sport recruit's report tells his story and his draft risk from you in a word", () => {
  const pid = pick();
  force(pid, "business", "self", null, "two_sport");
  assert(persona.view(st, ME, pid)["story"] === null);
  looks(pid, 3);
  const v = persona.view(st, ME, pid);
  equal([v["story"], v["story_detail"]], ["Two-Sport", "Draft Risk: High"]);
  assert(learned(pid, "story")[0]["line"] === "Your staff learned he could go pro in baseball.");
});

test("a Package Deal comes out on your first call, naming his mate, and the call says so", () => {
  const a = pick(), b = pick();
  force(a, "business", "self", null, "package", { mate: b, lead: true });
  force(b, "business", "self", null, "package", { mate: a, lead: false });
  recruiting.act(st, ME, a, "message");
  assert(persona.view(st, ME, a)["story"] === null, "a message tells nothing");
  const sc = recruiting.act(st, ME, a, "call")["scene"];
  const mate = rc["prospects"][b]["name"];
  const v = persona.view(st, ME, a);
  equal([v["story"], v["story_detail"], v["story_mate"]], ["Package Deal", `With ${mate}`, b]);
  assert(learned(a, "story")[0]["line"] === `Your staff learned he and ${mate} want to go together.`);
  assert(sc["turns"].some((t) => t["who"] === "note" && t["text"] === `Package Deal: he wants ${mate} to come too.`), () => show(sc["turns"]));
});

test("a Late Bloomer is found by the report before his jump, and his jump is public to everyone", () => {
  const blooms = Object.entries(persona.stories(st)).filter(([q, s]) => s["story"] === "bloomer" && !rc["prospects"][q]["hidden"] && !used.has(q));
  const [early] = blooms[1];
  assert(persona.view(st, ME, early)["story"] === null);
  looks(early, 3);
  assert(persona.view(st, ME, early)["story"] === "Late Bloomer");
  assert(learned(early, "story")[0]["line"] === "Your staff learned he is a late bloomer.");
  const [q, s] = blooms[0];
  assert(persona.view(st, ME, q)["story"] === null);
  persona.bloom(st, s["story_data"]["week"]);
  assert(persona.view(st, ME, q)["story"] === "Late Bloomer");
  assert(!learned(q, "story").length, "a public jump is not something your staff learned");
});

test("every story has a learned sentence that starts 'Your staff learned he' and ends with a period", () => {
  for (const k of Object.keys(persona.STORIES)) {
    if (!persona.PUBLIC_STORIES.includes(k)) assert(k in persona.STORY_LEARNED, `${k} has no learned sentence`);
  }
  for (const line of Object.values(persona.STORY_LEARNED)) assert(line.startsWith("Your staff learned he ") && line.endsWith("."), line);
});

test("a Hometown Hero's commitment makes the league news, whoever he picks", () => {
  const teams = season.load_teams();
  const pid = pick();
  const home = rc["prospects"][pid]["hometown"]["state"];
  force(pid, "business", "self", null, "hero", { state: home });
  const week = st["current_week"];
  (rc["offers"]["texas"] ??= []).push(pid);
  recruiting._commit(st, pid, "texas");
  const items = news._recruiting(st, teams, week).filter((x) => (x["link"] || {})["pid"] === pid);
  const verb = teams["texas"]["state"] === home ? "stays home with" : "leaves home for";
  assert(items.length && items[0]["text"].startsWith("Hometown hero ") && items[0]["text"].includes(verb) && items[0]["text"].endsWith("."), () => show(items));
});

// ----- his ratings in the report ---------------------------------------------------------------------------------

test("his key ratings read as ranges that narrow with every look, each with a confidence word", () => {
  const by_rank = Object.keys(rc["prospects"]).sort((a, b) => rc["prospects"][a]["rank"] - rc["prospects"][b]["rank"]);
  const pid = by_rank.slice(40).find((q) => !used.has(q) && !rc["prospects"][q]["hidden"] && recruiting.visible(st).has(q) && !rc["reads"][q]);
  used.add(pid);
  assert(clear.ratings(st, pid) === null, "no ratings before a look");
  const widths = [];
  let r = null;
  const need = recruiting.looks_needed(st, pid);          // two, three or four of his looks finish the report, by your staff
  for (let i = 0; i < need; i++) {
    rc["hours"][ME] = 100;
    recruiting.act(st, ME, pid, "scout");
    r = clear.ratings(st, pid);
    // his position's own ratings, then the five physical traits every prospect is read on (a kicker's short list aside)
    assert(r["rows"].length >= 4 && r["rows"].length <= 10 && r["potential"]["label"].startsWith("Potential at "), () => show(r));
    if (r["rows"].length === 10) equal(r["rows"].slice(5).map((x) => x["key"]), clear.PHYSICAL);
    for (const x of r["rows"]) {
      assert(x["lo"] >= 1 && x["hi"] <= 99 && x["lo"] <= x["est"] && x["est"] <= x["hi"], () => show(x));
      assert(["High", "Medium", "Low"].includes(x["confidence"]), () => show(x));
    }
    widths.push(r["rows"].reduce((a, x) => a + x["hi"] - x["lo"], 0));
  }
  assert(widths.every((w, i) => i === 0 || widths[i - 1] >= w), `a read narrows with every look: ${widths}`);
  assert(r["complete"] && r["looks"] === recruiting.REPORT_LOOKS, () => show([r["complete"], r["looks"]]));
  const view = prospects.profile(st, pid, ME);
  assert(view["clear"] && view["abilities"] !== null, "the profile carries Key Ratings and his abilities once scouted");
  const bad = (v) => v === undefined || (typeof v === "number" && !Number.isFinite(v)) || (typeof v === "string" && /\b(undefined|null|NaN|None)\b/.test(v))
    || (v !== null && typeof v === "object" && Object.values(v).some(bad));
  assert(!bad(view["clear"]), () => show(view["clear"]));
  const e = (() => { try { rc["scout_points"] = { [ME]: 100 }; recruiting.act(st, ME, pid, "scout"); } catch (err) { return err; } return null; })();
  assert(e instanceof recruiting.RecruitingError && e.code === 409, "a complete report takes no more looks");
});

await run();
