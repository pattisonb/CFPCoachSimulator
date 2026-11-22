// His Story (persona.py, spec section 2): the class's stories are a fixed draw from the seed, worked out
// when asked and never stored; shares hold (about 35% of the class, half the four- and five-stars, at most
// one each); a Package Deal pairs two prospects both ways; a Late Bloomer starts at two or three stars and an
// Injury Comeback one star under his own, their real stars kept on the prospect; the class ranking stays one
// order 1..N by the shown composite; a save from before stories has none.
// `node tests/test_story.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { get, truthy, fmt } from "../engine_js/pyrt.js";

const game = await start();
const { season, recruiting } = game;
const persona = game.modules.persona;

const career = (seed) => season.new_season("ohio-state", "full", seed, undefined, undefined, true);
const is_dict = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// one script in the Python (its sections named in comments): one test here, the sections kept in order
test("story", () => {
  const st = career(4);
  const rc = st["recruiting"];
  const pros = rc["prospects"];
  const drawn = persona.stories(st);

  // test_not_persisted: nothing story-shaped in the save but a shown prospect's real stars
  assert(get(rc, "stories") === 1, "a class drawn with stories is marked");
  assert(!Object.values(pros).some((p) => "story" in p || "story_data" in p), "stories are a fixed draw, never stored on the prospect");
  assert(!("story_map" in rc) && !Object.values(rc).some((v) => is_dict(v) && Object.keys(v).length < 5 && "story" in v));

  // test_deterministic: a fresh draw from the saved class is the same
  persona._STORIES = [null, null, {}];
  equal(persona.stories(st), drawn);
  const st2 = career(4);
  equal(persona.stories(st2), drawn, "the same seed draws the same stories");

  // test_shares
  const n = Object.keys(pros).length;
  const share = Object.keys(drawn).length / n;
  assert(0.31 <= share && share <= 0.41, () => String(share));
  const real = (q) => (get(pros[q], "real") || pros[q])["stars"];
  const blue = Object.keys(pros).filter((q) => real(q) >= 4);
  const blue_share = blue.filter((q) => q in drawn).length / blue.length;
  assert(0.42 <= blue_share && blue_share <= 0.60, () => String(blue_share));
  const kinds = {};
  for (const s of Object.values(drawn)) kinds[s["story"]] = (kinds[s["story"]] || 0) + 1;
  const total = Object.values(kinds).reduce((a, b) => a + b, 0);
  for (const [k, want] of Object.entries(persona.STORIES)) {
    const got = (kinds[k] || 0) / total;
    assert(Math.abs(got - want) <= 0.06, () => JSON.stringify([k, got, want, kinds]));
  }
  for (const s of Object.values(drawn)) assert(s["story"] in persona.STORIES && is_dict(s["story_data"]), () => JSON.stringify(s));

  // test_package_symmetric
  let pairs = 0;
  for (const [pid, s] of Object.entries(drawn)) {
    if (s["story"] !== "package") continue;
    const mate = s["story_data"]["mate"];
    assert(drawn[mate]["story"] === "package" && drawn[mate]["story_data"]["mate"] === pid, () => JSON.stringify([pid, mate]));
    assert(s["story_data"]["lead"] !== drawn[mate]["story_data"]["lead"]);
    const [lead, other] = truthy(s["story_data"]["lead"]) ? [pid, mate] : [mate, pid];
    assert((get(pros[lead], "real") || pros[lead])["composite"] > (get(pros[other], "real") || pros[other])["composite"]);
    assert(pros[lead]["hometown"]["state"] === pros[other]["hometown"]["state"]);
    assert(persona.mate(st, pid) === mate);
    pairs += 1;
  }
  assert(pairs >= 40, () => String(pairs));

  // test_legacy_and_hero
  const teams = season.load_teams();
  for (const [pid, s] of Object.entries(drawn)) {
    if (s["story"] === "legacy") {
      assert(recruiting.fbs_schools(st).includes(s["story_data"]["school"]));
      const school = s["story_data"]["school"];
      assert(!(school in rc["lists"][pid]), "a head start, not a place on his list");
      const pull = recruiting.interest(st, school, pid) - persona.LEGACY_HEAD;
      assert(Math.abs(persona.story_interest(st, school, pid, pull) - pull - persona.LEGACY_HEAD) < 1e-9);
    }
    if (s["story"] === "hero") {
      assert(s["story_data"]["state"] === pros[pid]["hometown"]["state"]);
      assert(recruiting.fbs_schools(st).some((t) => get(teams[t], "state") === s["story_data"]["state"]));
    }
    if (s["story"] === "two_sport") assert([...persona.TWO_SPORT_GROUPS].includes(recruiting._group_of(pros[pid])));
  }

  // test_bloomer_and_comeback_shown_low
  const gen = new Set(get(rc, "generational") || []);
  for (const [pid, s] of Object.entries(drawn)) {
    const p = pros[pid];
    if (s["story"] === "bloomer") {
      const d = s["story_data"];
      assert(5 <= d["week"] && d["week"] <= 9 && [1, 2].includes(d["jump"]), () => JSON.stringify(d));
      assert([2, 3].includes(p["stars"]) && p["real"]["stars"] === p["stars"] + d["jump"], () => JSON.stringify([p["stars"], p["real"], d]));
      assert(p["composite"] < p["real"]["composite"] && p["rank"] > 300, "a bloomer starts unranked: outside the top 300");
      assert(!gen.has(pid));
    } else if (s["story"] === "comeback") {
      assert(p["stars"] === Math.max(2, p["real"]["stars"] - 1) && p["composite"] <= p["real"]["composite"], () => JSON.stringify([p["stars"], p["real"]]));
      assert(!gen.has(pid));
    } else {
      assert(!("real" in p));
    }
  }
  assert(!Object.keys(pros).some((q) => !(q in drawn) && "real" in pros[q]));
  const ranks = Object.values(pros).map((p) => p["rank"]).sort((a, b) => a - b);
  equal(ranks, Array.from({ length: n }, (_, i) => i + 1), "the ranking is one order 1..N");
  const order = Object.keys(pros).map((q, i) => [q, i]).sort((a, b) => pros[a[0]]["rank"] - pros[b[0]]["rank"] || a[1] - b[1]).map(([q]) => q);
  assert(order.slice(1).every((b, i) => pros[order[i]]["composite"] >= pros[b]["composite"]), "ranked by the shown composite");

  // test_old_save_has_none: a class from before stories (no marker) has no story at all
  delete rc["stories"];
  persona._STORIES = [null, null, {}];
  equal(persona.stories(st), {});
  equal(persona.story(st, Object.keys(drawn)[0]), [null, {}]);
  rc["stories"] = 1;
  // a test (or an old save) may set one on the prospect's persona
  const pid = order[10];
  pros[pid]["persona"] = { personality: "shy", decider: "self", decider_topic: null, story: "two_sport", story_data: {} };
  equal(persona.story(st, pid), ["two_sport", {}]);
  delete pros[pid]["persona"];

  // test_portal_has_none
  equal(persona.stories({ recruiting: { portal: true, prospects: {} } }), {});
  console.log(`test_story: ok (${Object.keys(drawn).length} stories of ${n}: ${JSON.stringify(kinds)}, blue chips ${fmt(blue_share, 2)})`);
});

await run();
