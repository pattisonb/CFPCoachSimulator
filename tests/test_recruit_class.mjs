// The recruiting class and what each prospect wants (career_js/recruits.js, career_js/recruiting/part1.js and part2.js).
// A generated class is the same for the same year and seed, holds the real star counts, ranks every prospect once
// under a name no real player has, keeps ratings on the scale with potential at or above them, and develops toward
// potential and never past it. In a career the class starts uncommitted, every prospect has three priorities drawn
// from the thirteen topics at the odds in PRIORITY_ODDS (tilted by who he is), an NIL ask from his stars and position,
// and a pull toward each school that reads the school's grades; a few of the best are generational, found only by a
// complete scouting report.
// `node tests/test_recruit_class.mjs`
import fs from "node:fs";
import path from "node:path";
import { start, test, run, assert, equal, ROOT } from "./harness.mjs";
import { Random, round } from "../engine_js/pyrt.js";

const game = await start();
const { season, recruiting } = game;
const { recruits, build_teams, prospects, programs, persona } = game.modules;

const ME = "ohio-state";
const J = (v) => () => JSON.stringify(v);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const NEW_TOPICS = ["facilities", "location", "stability", "game_day", "exposure"];

// the real players, in the source format the seeding and the team builder read (a league's teams: career_js/league.js)
const source_teams = game.modules.league.source_teams(game.modules.league.from_base(2027));
const team_file = (slug) => source_teams.find((t) => t["slug"] === slug);
const real_roster = source_teams.flatMap((t) => t["roster"]);
const real_names = new Set(real_roster.map((p) => p["name"].toLowerCase()));

const cls = recruits.generate_class(2027, 7, new Set(real_names));
const st = season.new_season(ME, "full", 4, undefined, undefined, true);
const rc = st["recruiting"];

// ----- the generated class (recruits.js) ---------------------------------------------------------------------------

test("the same year and seed give the same class, another seed a different one", () => {
  const again = recruits.generate_class(2027, 7, new Set(real_names));
  equal(cls.map((p) => p["name"]), again.map((p) => p["name"]));
  equal(cls[0]["ratings_ea"], again[0]["ratings_ea"]);
  const other = recruits.generate_class(2027, 8);
  assert(other[0]["name"] !== cls[0]["name"] || other[1]["name"] !== cls[1]["name"]);
});

test("a class holds the real star counts and ranks every prospect once, best first", () => {
  const counts = {};
  for (const p of cls) counts[String(p["stars"])] = (counts[String(p["stars"])] || 0) + 1;
  equal(counts, { ...recruits.model()["generation"]["prospects_per_class"] });
  equal(cls.map((p) => p["rank"]), cls.map((_, i) => i + 1));
  assert(cls.every((p, i) => i === 0 || cls[i - 1]["composite"] >= p["composite"]), "ranked by composite");
});

test("every prospect has a name of his own that no real player has", () => {
  const names = cls.map((p) => p["name"].toLowerCase());
  assert(new Set(names).size === names.length, "two prospects share a name");
  assert(!names.some((n) => real_names.has(n)), "a prospect has a real player's name");
});

test("ratings stay on the scale, potential is never under a rating, and every coachability level appears", () => {
  equal(new Set(cls.map((p) => p["coachability"])), new Set(Object.keys(recruits.RATE)));
  for (const p of cls) {
    assert(Object.values(p["ratings_ea"]).every((v) => v >= 0 && v <= 99), p["name"]);
    assert(Object.entries(p["ratings_ea"]).every(([k, v]) => p["potential_ea"][k] >= v), p["name"]);
    assert(p["overall_ea"] >= 1 && p["overall_ea"] <= 99 && p["hometown"]["state"], p["name"]);
  }
});

test("athleticism is mostly set by high school: speed has little room to grow, awareness a lot", () => {
  const wr = cls.filter((p) => p["ea_position"] === "WR");
  const room = (k) => mean(wr.map((p) => p["potential_ea"][k] - p["ratings_ea"][k]));
  assert(room("speed") < 2 && 2 < room("awareness") - 5, J([room("speed"), room("awareness")]));
});

test("more stars start higher", () => {
  const by = {};
  for (const s of [5, 4, 3, 2]) by[s] = mean(cls.filter((p) => p["stars"] === s).map((p) => p["overall"]));
  assert(by[5] > by[4] && by[4] > by[3] && by[3] > by[2], J(by));
});

test("development closes the gap to potential, never passes it, and is faster for the coachable", () => {
  const rng = new Random(1);
  const copy = (p) => JSON.parse(JSON.stringify(p));
  const fast = copy(cls.find((p) => p["coachability"] === "Coach's Dream" && p["stars"] === 3));
  const slow = copy(cls.find((p) => p["coachability"] === "Set in His Ways" && p["stars"] === 3));
  const gap = (p) => Object.entries(p["ratings_ea"]).reduce((a, [k, v]) => a + p["potential_ea"][k] - v, 0);
  const gap0 = [gap(fast), gap(slow)];
  for (let i = 0; i < 3; i++) for (const p of [fast, slow]) recruits.develop(p, rng);
  for (const p of [fast, slow]) assert(Object.entries(p["ratings_ea"]).every(([k, v]) => v <= p["potential_ea"][k]), "past his potential");
  const closed = [1 - gap(fast) / Math.max(1, gap0[0]), 1 - gap(slow) / Math.max(1, gap0[1])];
  assert(closed[0] > closed[1] + 0.3, J(closed));
});

test("a signed recruit joins a roster in the format the team builder reads", () => {
  const team = team_file("ohio-state");
  cls.slice(0, 200).forEach((p, i) => {
    const m = build_teams.map_player(recruits.as_roster_player(p, team, `gen-${i}`));
    assert(m && typeof m["speed"] === "number", p["name"]);
  });
});

test("a career's class is 4092 prospects, nobody committed, each with three different priorities", () => {
  assert(Object.keys(rc["prospects"]).length === 4092, String(Object.keys(rc["prospects"]).length));
  assert(Object.values(rc["status"]).every((s) => s["committed"] === null));
  for (const p of Object.values(rc["prospects"])) {
    assert(p["priorities"].length === 3 && new Set(p["priorities"]).size === 3 && p["priorities"].every((t) => recruiting.PITCHES.includes(t)), p["name"]);
  }
  assert(rc["topics_v"] === 2, "a new class is marked as drawn with the campus topics");
});

test("the generational draw is seeded, capped, best first, and only from four- and five-stars at the top", () => {
  const gen = rc["generational"];
  equal(gen, recruiting.draw_generational(rc), "drawing again gives the same list");
  assert(gen.length <= recruiting.GENERATIONAL_MAX);
  const P = rc["prospects"];
  assert(gen.every((q) => P[q]["stars"] >= 4 && P[q]["truth"]["potential"] >= recruiting.GENERATIONAL_FROM));
  assert(gen.every((q, i) => i === 0 || P[gen[i - 1]]["truth"]["potential"] >= P[q]["truth"]["potential"]));
  const some = Object.entries(P).slice(0, 200);
  const none = { seed: 1, prospects: Object.fromEntries(some.map(([q, p]) => [q, { ...p, truth: { ...p["truth"], potential: 50.0 } }])) };
  equal(recruiting.draw_generational(none), []);
  const all = { seed: 1, prospects: Object.fromEntries(some.map(([q, p]) => [q, { ...p, stars: 5, truth: { ...p["truth"], potential: 99.0 } }])) };
  assert(recruiting.draw_generational(all).length === recruiting.GENERATIONAL_MAX, "a class of only qualifiers stays under the cap");
  // never a guaranteed number: over many seeds a few, often none
  const counts = [];
  for (let s = 0; s < 40; s++) counts.push(recruiting.draw_generational({ ...rc, seed: s }).length);
  assert(Math.min(...counts) <= 1 && mean(counts) >= 1.0 && mean(counts) <= 5.0, J(counts));
});

test("a generational prospect asks for more, and an old save draws its list on load", () => {
  const gen = [...rc["generational"]];
  const g = gen[0] ?? Object.keys(rc["prospects"])[0];
  rc["generational"] = [g];
  const plain = recruiting.ask_from({ ...st, recruiting: { ...rc, generational: [] } }, ME, g);
  assert(recruiting.ask_from(st, ME, g) === Math.trunc(round(recruiting.GENERATIONAL_ASK * plain)), J([recruiting.ask_from(st, ME, g), plain]));
  delete rc["generational"];
  assert(recruiting.upgrade_generational(st) && !recruiting.upgrade_generational(st), "drawn once");
  equal(rc["generational"], gen);
});

test("the generational tag is your staff's to find: hidden until his report is complete", () => {
  const kept_gen = rc["generational"];
  const g = kept_gen[0] ?? Object.keys(rc["prospects"]).find((q) => !rc["prospects"][q]["hidden"]);
  rc["generational"] = [g];
  const kept = rc["reads"][g];
  const groups = Object.fromEntries(recruiting.GROUPS.map((grp) => [grp, [90.0, 100.0]]));
  delete rc["reads"][g];
  assert(!prospects.row(st, g, ME)["generational"] && !prospects.profile(st, g, ME)["public"]["generational"], "no report, no tag");
  for (const looks of [recruiting.FIND_LOOKS - 1, recruiting.FIND_LOOKS - 0.5]) {
    rc["reads"][g] = { looks, by: { 95: 2 }, g: groups };
    assert(!prospects.row(st, g, ME)["generational"] && !recruiting._flags(st, g).includes("generational"), `${looks} looks are not enough`);
  }
  rc["reads"][g]["looks"] = recruiting.FIND_LOOKS;
  assert(prospects.row(st, g, ME)["generational"] && prospects.profile(st, g, ME)["public"]["generational"]);
  assert(recruiting._flags(st, g).includes("generational"));
  delete rc["reads"][g];
  if (kept) rc["reads"][g] = kept;
  rc["generational"] = kept_gen;
});

test("every prospect has an NIL ask from his stars and position; what he wants from you is never less", () => {
  const P = Object.values(rc["prospects"]);
  const five = P.find((p) => p["stars"] === 5 && p["ea_position"] === "QB");
  const tx = P.find((p) => p["hometown"]["state"] === "TX" && p["stars"] === 3);
  assert(P.every((p) => "nil_ask" in p) && five["nil_ask"] > 40 && tx["nil_ask"] <= 20, J([five["nil_ask"], tx["nil_ask"]]));
  assert(recruiting.ask_from(st, ME, five["id"]) >= five["nil_ask"]);
});

// ----- the thirteen topics and a school's pull -----------------------------------------------------------------------

test("there are thirteen topics, the five campus ones last, and a pull has every one of them", () => {
  assert(recruiting.PITCHES.length === 13, String(recruiting.PITCHES.length));
  equal([...recruiting.PITCHES].slice(-5), NEW_TOPICS);
  const pid = Object.keys(rc["prospects"])[40];
  equal(new Set(Object.keys(recruiting.pull(st, ME, pid))), new Set(recruiting.PITCHES));
  const s = recruiting.strengths(st, ME, pid);
  assert(recruiting.PITCHES.every((t) => s[t] >= 0 && s[t] <= 1), J(s));
});

test("a school pulls harder on a prospect close to home, and a better program has a better field", () => {
  const tx = Object.values(rc["prospects"]).find((p) => p["hometown"]["state"] === "TX" && p["stars"] === 3);
  assert(recruiting.pull(st, "texas", tx["id"])["proximity"] > recruiting.pull(st, "oregon", tx["id"])["proximity"]);
  assert(recruiting.interest(st, "texas", tx["id"]) > 0);
  assert(recruiting.on_field(st, ME, 0) > recruiting.on_field(st, "kent-state", 0));
});

test("this season counts more every week: a 7-0 team is a hot program by Week 7", () => {
  const fake = { ...st, current_week: 7, games: Object.fromEntries(Object.entries(st["games"]).map(([k, v]) => [k, { ...v }])) };
  recruiting._set_record(fake, "kent-state", 7, 0);
  assert(recruiting.on_field(fake, "kent-state", 7) > recruiting.on_field(st, "kent-state", 0) + 0.2);
});

test("the campus topics and Academics read the school's grades", () => {
  const pid = Object.keys(rc["prospects"])[40];
  const pu = recruiting.pull(st, "stanford", pid, false), g = programs.grades("stanford");
  for (const t of ["academics", "facilities", "stability", "game_day", "exposure"]) {
    assert(Math.abs(pu[t] - g[t] / 100) < 1e-9, J([t, pu[t], g[t]]));
  }
  assert(recruiting.academic("stanford") && !recruiting.academic("akron"));
  // a program the research has no row for pulls the same on every campus topic, and is academic only if the old list says so
  const bare = "fcs-plains";                              // (an FCS stand-in: every FBS program has a row now)
  assert(programs.grades(bare) === null);
  const none = recruiting.pull(st, bare, pid, false);
  for (const t of NEW_TOPICS) assert(none[t] === recruiting.NEUTRAL_PULL, J([t, none[t]]));
  const listed = recruiting.ACADEMIC instanceof Set ? recruiting.ACADEMIC.has(bare) : recruiting.ACADEMIC.includes(bare);
  assert(recruiting.academic(bare) === listed);
});

test("Location reads the school's setting and climate against his taste", () => {
  const pid = Object.keys(rc["prospects"])[40];
  const tags = programs.tags("stanford"), grade = programs.grades("stanford")["location"] / 100;
  const saved = recruiting.place_taste;
  try {
    recruiting.place_taste = () => ({ setting: tags["setting"], climate: tags["climate"] });
    recruiting.reset_caches();
    assert(Math.abs(recruiting.pull(st, "stanford", pid, false)["location"] - Math.min(1.0, grade + 2 * recruiting.LOCATION_MATCH)) < 1e-9, "both tags match");
    recruiting.place_taste = () => ({
      setting: tags["setting"] !== "Small Town" ? "Small Town" : "Big City", climate: tags["climate"] !== "Cold" ? "Cold" : "Warm",
    });
    recruiting.reset_caches();
    assert(Math.abs(recruiting.pull(st, "stanford", pid, false)["location"] - Math.max(0.0, grade - 2 * recruiting.LOCATION_CLASH)) < 1e-9, "both tags clash");
  } finally {
    recruiting.place_taste = saved;
    recruiting.reset_caches();
  }
});

test("his taste in a place is his own and stable, and leans to the climate he grew up in", () => {
  const p = { id: "t1", hometown: { state: "FL" } };
  equal(recruiting.place_taste(p), recruiting.place_taste(p));
  let warm = 0;
  for (let i = 0; i < 100; i++) if (recruiting.place_taste({ id: `t${i}`, hometown: { state: "FL" } })["climate"] === "Warm") warm++;
  assert(warm >= 60, String(warm));
});

test("the priority odds tables each cover the thirteen topics and add up to one", () => {
  for (const t of [recruiting.PRIORITY_ODDS, recruiting.PORTAL_PRIORITY_ODDS, recruiting.PORTAL_TOP_PRIORITY_ODDS]) {
    const total = Object.values(t).reduce((a, b) => a + b, 0);
    assert(Math.abs(total - 1.0) < 1e-9, String(total));
    equal(new Set(Object.keys(t)), new Set(recruiting.PITCHES));
  }
  assert(recruiting.PORTAL_PRIORITY_ODDS["playing_time"] === 0.34 && recruiting.PORTAL_TOP_PRIORITY_ODDS["nil"] === 0.25);
});

test("first priorities come out at the table's odds", () => {
  const n = 4000, firsts = {};
  for (let i = 0; i < n; i++) {
    const t = recruiting._priorities(`s${i}`)[0];
    firsts[t] = (firsts[t] || 0) + 1;
  }
  for (const [t, odds] of Object.entries(recruiting.PRIORITY_ODDS)) {
    assert(Math.abs((firsts[t] || 0) / n - odds) <= 0.03, J([t, (firsts[t] || 0) / n, odds]));
  }
});

test("who he is tilts what he wants: mom leans to home, school and stability, a quarterback's coach to the coach", () => {
  const share = (topic, tilt, n = 3000) => {
    let k = 0;
    for (let i = 0; i < n; i++) if (recruiting._priorities(`x${i}`, null, tilt).includes(topic)) k++;
    return k / n;
  };
  const mom = recruiting.tilt_for({ stars: 4, ea_position: "K" }, { decider: "mom", personality: null });
  equal(mom, { proximity: recruiting.TILT, academics: recruiting.TILT, stability: recruiting.TILT });
  assert(share("stability", mom) > share("stability", null) + 0.01);
  const qb = recruiting.tilt_for({ stars: 4, ea_position: "QB" }, { decider: "hs_coach", personality: null });
  assert(share("coach", qb) > share("coach", null) + 0.01);
  // dad, a kid who likes attention, five stars and quarterback all lean to Exposure: the leans multiply
  const both = recruiting.tilt_for({ stars: 5, ea_position: "QB" }, { decider: "dad", personality: "attention" });
  assert(Math.abs(both["exposure"] - recruiting.TILT ** 4) < 1e-9, J(both));
  const portal = recruiting.tilt_for({ stars: null, tier: 4, portal: true, group: "RB" }, { decider: "self", personality: "shy" });
  const pri = recruiting._priorities("portal-x", recruiting.PORTAL_PRIORITY_ODDS, portal);
  assert(new Set(pri).size === 3 && pri.every((t) => recruiting.PITCHES.includes(t)));
});

test("his three priorities carry the set weights and the other ten topics share the rest", () => {
  const p = { ...Object.values(rc["prospects"])[40], priorities: ["nil", "coach", "academics"] };
  const w = recruiting.weights(p);
  assert(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1.0) < 1e-9);
  assert(w["nil"] === recruiting.PRIORITY_WEIGHTS[0] && Math.abs(w["facilities"] - recruiting.OTHER_WEIGHT / 10) < 1e-9, J(w));
});

test("whoever decides for him cares about a topic that fits, and a recruit who decides himself has none", () => {
  let stability = false;
  const fits = { mom: ["proximity", "academics", "stability"], trainer: ["nil", "pro", "facilities", "exposure"] };
  for (let i = 0; i < 400; i++) {
    const d = persona.draw(`d${i}`, 7);
    if (d["decider"] === "self") assert(d["decider_topic"] === null);
    if (fits[d["decider"]]) assert(fits[d["decider"]].includes(d["decider_topic"]), J(d));
    stability ||= d["decider_topic"] === "stability";
  }
  assert(stability, "the campus topics get their share");
});

test("a class saved before the campus topics keeps its deciders' old topics", () => {
  const old = {
    mom: ["proximity", "academics"], dad: ["nil", "playing_time", "pro"], grandma: ["proximity", "coach"],
    hs_coach: ["coach", "playing_time", "winning", "pro"], trainer: ["nil", "pro"],
  };
  for (let i = 0; i < 300; i++) {
    const d = persona.draw(`k${i}`, 7, false, false);
    if (d["decider_topic"] !== null) assert(old[d["decider"]].includes(d["decider_topic"]), J(d));
  }
  delete rc["topics_v"];
  try {
    for (const pid of Object.keys(rc["prospects"]).slice(0, 300)) {
      const p = rc["prospects"][pid], kept = p["persona"];
      delete p["persona"];
      const d = persona.of(st, pid);
      if (kept !== undefined) p["persona"] = kept;
      if (d["decider_topic"] !== null) assert(old[d["decider"]].includes(d["decider_topic"]), J(d));
    }
  } finally {
    rc["topics_v"] = 2;
  }
});

// ----- hours, areas and the offer cap --------------------------------------------------------------------------------

test("a school's energy a week follows its program's stars: 180 at none, 30 more a half star, 480 at five", () => {
  equal([recruiting.ENERGY_ZERO, recruiting.ENERGY_PER_STAR], [180, 60]);
  const stars = (slug) => programs.stars_of(programs.get(st, slug)["rating"]);
  for (const slug of ["ohio-state", "texas-tech", "memphis", "kent-state", ME]) {
    assert(recruiting.weekly_hours(st, slug) === 180 + 60 * stars(slug), J([slug, stars(slug), recruiting.weekly_hours(st, slug)]));
  }
  assert(stars("ohio-state") === 5 && recruiting.weekly_hours(st, "ohio-state") === 480, "sixteen video calls a week at the top");
  // the stars run from none to five by halves, and the energy with them
  equal([0, 0.5, 2.5, 5].map((s) => 180 + 60 * s), [180, 210, 330, 480]);
  assert(programs.stars_of(0) === 0 && programs.stars_of(17.9) === 0 && programs.stars_of(18) === 0.5 && programs.stars_of(99) === 5);
  // your head coach's recruiting rating no longer sets it
  const coach = (rating) => ({ id: "c1", first_name: "Pat", last_name: "Test", ratings: { recruiting: rating, evaluation: 60, offense: 70, defense: 70 } });
  const hours = (rating) => recruiting.weekly_hours(season.new_season("kent-state", "full", 6, undefined, coach(rating), true), "kent-state");
  assert(hours(30) === hours(100));
});

test("the country is nine scouting areas and no state is in two", () => {
  const states = Object.values(recruiting.AREAS).flat();
  assert(Object.keys(recruiting.AREAS).length === 9 && recruiting.AREAS["Texas"].includes("TX"));
  assert(new Set(states).size === states.length, "a state in two areas");
  equal(prospects.recruiting_view(st)["areas"]["Texas"], ["TX"]);
});

test("the staff's offers are capped from your open spots (Auto-recruit: an offer by hand has no limit)", () => {
  const cap = recruiting.offer_cap(st, ME);
  assert(cap >= 15 && cap <= 45, String(cap));
});

test("real head coaches recruit as they really do", () => {
  const rr = (slug) => season.load_teams()[slug]["coaches"]["head_coach"]["ratings"]["recruiting"];
  assert(rr("oregon") > rr("oklahoma"), J([rr("oregon"), rr("oklahoma")]));
});

test("interest is graded inside a star band: about 15% of each band is High, so a small school is not shown a top class that all loves it", () => {
  const stk = season.new_season("kent-state", "full", 11, undefined, undefined, true);
  const vis = recruiting.prospect_list(stk);
  const [vals, cuts] = prospects.your_interest(stk, "kent-state", vis);
  const level = (q) => prospects._level(vals[q], stk["recruiting"]["prospects"][q]["stars"], cuts);
  const bands = {};
  for (const q of vis) (bands[stk["recruiting"]["prospects"][q]["stars"]] ||= []).push(level(q));
  for (const [stars, levels] of Object.entries(bands)) {
    if (levels.length < 30) continue;
    const share = levels.filter((l) => l === "High").length / levels.length;
    assert(share >= 0.10 && share <= 0.20, J([stars, share]));
  }
  assert(vis.slice(0, 50).filter((q) => level(q) === "High").length < 25);
  const keen = prospects.search(stk, "kent-state", null, null, null, "interested", null, 0, 100)["rows"];
  assert(keen.length && keen.every((r) => r["interest_level"] === "High"));
});

await run();
