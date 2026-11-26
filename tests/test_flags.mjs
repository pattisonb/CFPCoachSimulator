// Gem and bust risk flags on recruits (prospects.find, recruiting.flag_cuts). The cuts are relative to his star tier,
// so across a class the flags are a few percent of the prospects fully scouted, and nearly all the gems are real; a
// flag once found holds through a look that moves the read a little (FLAG_HOLD), so the Scouting tab's Flags list does
// not flicker. Measured on two seeds with every prospect in a staffed area given a complete report by his area's scout.
// `node tests/test_flags.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted } from "../engine_js/pyrt.js";

const game = await start({ env: { SIM_WORKERS: "1" } });
const { season, recruiting } = game;
const prospects = game.modules.prospects;
const show = (v) => JSON.stringify(v);

const SEEDS = [["smu", 62], ["ohio-state", 8]];
const BAND = [0.02, 0.05];            // *tune* gems, as a share of the prospects with a complete report
const BUST_BAND = [0.015, 0.05];      // *tune* bust risks, as a share of the four- and five-stars with one (a seed has about 240, so one prospect is 0.4 points)
const PRECISION = 0.5;                // *tune* at least this share of the gems are truly top-decile for their star tier

const stars_of = (p) => (p["real"] || p)["stars"];          // his real stars (his story may show him lower)
function truth_cut(rc, stars, q) {
  return recruiting._percentile(sorted(Object.values(rc["prospects"]).filter((p) => stars_of(p) === stars).map((p) => p["truth"]["potential"])), q);
}
const free = (rc, me, pid) => !rc["status"][pid]["signed"] && rc["status"][pid]["committed"] !== me;

/** Every prospect in a staffed area gets a complete report: FIND_LOOKS full looks (as trips) at his area scout's rating. */
function complete_reports(st) {
  const rc = st["recruiting"], me = st["team"];
  const rng = new Random(`flags-${rc["seed"]}`);
  for (const member of st["career"]["staff"]) {
    for (const code of recruiting.AREAS[member["area"]] || []) {
      for (const [pid, p] of Object.entries(rc["prospects"])) {
        if (p["hometown"]["state"] !== code || !free(rc, me, pid)) continue;
        for (let k = 0; k < recruiting.FIND_LOOKS; k++) recruiting.look(st, pid, member["evaluation"], rng, "trip", 1);
      }
    }
  }
}

function rates(st) {
  const rc = st["recruiting"];
  const looked = Object.keys(rc["reads"]).filter((pid) => rc["reads"][pid]["looks"] >= recruiting.FIND_LOOKS && rc["prospects"][pid]["stars"] !== null);
  const finds = Object.fromEntries(looked.map((pid) => [pid, prospects.find(st, pid)]));
  const gems = looked.filter((pid) => finds[pid] === "gem"), busts = looked.filter((pid) => finds[pid] === "bust");
  const high = looked.filter((pid) => rc["prospects"][pid]["stars"] >= 4);
  const p90 = Object.fromEntries([2, 3, 4, 5].map((s) => [s, truth_cut(rc, s, 0.9)]));
  const real = gems.filter((pid) => rc["prospects"][pid]["truth"]["potential"] >= p90[rc["prospects"][pid]["stars"]]).length;
  return { looked: looked.length, gems: gems.length, busts: busts.length, high: high.length,
    gem_rate: gems.length / looked.length, bust_rate: busts.length / high.length, precision: gems.length ? real / gems.length : 1.0,
    high_star_gems: gems.filter((pid) => rc["prospects"][pid]["stars"] >= 4).length };
}

const careers = SEEDS.map(([team, seed]) => season.new_season(team, "full", seed, undefined, undefined, true));

// potential varies nearly as much inside a star tier as across tiers, which is why a flag is cut per tier
test("each star tier has its own cuts, read from the class once", () => {
  for (const st of careers) {
    const rc = st["recruiting"];
    for (const s of [2, 3]) {
      const tier = Object.values(rc["prospects"]).filter((p) => p["stars"] === s);
      assert(tier.filter((p) => p["truth"]["potential"] >= 80).length / tier.length > 0.1, `few ${s}-stars with high potential`);
    }
    const cuts = recruiting.flag_cuts(rc);
    equal(new Set(Object.keys(cuts).map(Number)), new Set([2, 3, 4, 5]));
    assert(Object.values(cuts).every(([gem, bust]) => gem > bust), show(cuts));
    assert(cuts[2][0] === truth_cut(rc, 2, recruiting.GEM_PERCENTILE) && cuts[4][1] === truth_cut(rc, 4, recruiting.BUST_PERCENTILE));
    assert(recruiting.flag_cuts(rc) === cuts, "the cuts are worked out again on every call");
  }
});

test("with complete reports a few percent are gems, most of them real, never a four-star; a few percent of the top are bust risks", () => {
  for (const st of careers) {
    complete_reports(st);
    const r = rates(st);
    assert(BAND[0] <= r["gem_rate"] && r["gem_rate"] <= BAND[1], show(r));
    assert(BUST_BAND[0] <= r["bust_rate"] && r["bust_rate"] <= BUST_BAND[1], show(r));
    assert(r["precision"] >= PRECISION, show(r));
    equal(r["high_star_gems"], 0, "a gem is a three-star or less");
    assert(prospects.scouting_view(st)["flags"].every((f) => ["gem", "bust", "generational", "likes"].includes(f["flag"])));
  }
});

// A read this sure has no width, so only its middle decides.
const tight = (mean) => ({ looks: recruiting.FIND_LOOKS - 1, by: { 95: recruiting.FIND_LOOKS - 1 },
  g: Object.fromEntries(recruiting.GROUPS.map((g) => [g, [mean, 1000.0]])) });

test("a flag needs a complete report, then holds through a small move of the read and lets go after a clear one", () => {
  for (const st of careers) {
    const rc = st["recruiting"], me = st["team"];
    const cuts = recruiting.flag_cuts(rc), hold = recruiting.FLAG_HOLD * recruiting.POTENTIAL_STEP;   // (in overall points)
    // (a read this high also wins a coordinator's liking, which is another kind of flag)
    const in_view = (pid) => new Set(prospects.scouting_view(st)["flags"].filter((f) => f["pid"] === pid && f["flag"] !== "likes").map((f) => f["flag"]));

    const two = Object.keys(rc["prospects"]).find((pid) => rc["prospects"][pid]["stars"] === 2 && rc["prospects"][pid]["rank"] > recruiting.GEM_RANK && free(rc, me, pid));
    const gem_cut = cuts[2][0];
    rc["reads"][two] = tight(gem_cut + 0.5);
    assert(prospects.find(st, two) == null, "a flag before the report is complete");
    let entry = recruiting.look(st, two, 95, new Random(1));           // the look that completes the report
    assert(entry["flags"].length === 1 && entry["flags"][0] === "gem" && rc["reads"][two]["find"] === "gem", show(entry));
    equal(in_view(two), new Set(["gem"]));
    rc["reads"][two]["g"]["potential"] = [gem_cut - hold / 2, 1000.0];
    equal(prospects.find(st, two), "gem", "a read that slipped a little under the cut lost the flag");
    entry = recruiting.look(st, two, 95, new Random(2));
    assert(entry["flags"].length === 0 && rc["reads"][two]["find"] === "gem", show(entry));
    equal(in_view(two), new Set(["gem"]));
    rc["reads"][two]["g"]["potential"] = [gem_cut - hold - 1.0, 1000.0];
    assert(prospects.find(st, two) == null, "a read clearly past the cut kept the flag");
    recruiting.look(st, two, 95, new Random(3));
    assert(rc["reads"][two]["find"] == null && in_view(two).size === 0);
    rc["reads"][two]["g"]["potential"] = [gem_cut - hold / 2, 1000.0];
    assert(prospects.find(st, two) == null, "the hold is for a flag found, not for a read that never crossed the cut");

    // a bust risk: its cut sits near a grade word's edge, so a small move changes the word; the flag holds through it
    const four = Object.keys(rc["prospects"]).find((pid) => rc["prospects"][pid]["stars"] === 4 && free(rc, me, pid));
    const bust_cut = cuts[4][1];
    rc["reads"][four] = tight(bust_cut - 0.5);
    entry = recruiting.look(st, four, 95, new Random(4));
    assert(entry["flags"].length === 1 && entry["flags"][0] === "bust" && rc["reads"][four]["find"] === "bust", show(entry));
    rc["reads"][four]["g"]["potential"] = [bust_cut + hold / 2, 1000.0];
    equal(prospects.find(st, four), "bust");
    entry = recruiting.look(st, four, 95, new Random(5));
    assert(entry["flags"].length === 0 && rc["reads"][four]["find"] === "bust", show(entry));
    equal(in_view(four), new Set(["bust"]));
    rc["reads"][four]["g"]["potential"] = [bust_cut + hold + 1.0, 1000.0];
    assert(prospects.find(st, four) == null);
  }
});

await run();
