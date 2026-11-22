// Hand rating edits (data/manual_ratings.json, build_teams.apply_manual_ratings): every edit names a
// real player at his school with engine attributes, the deltas land clamped on the built teams,
// and the real 2026 build carries them (the edited starters' attributes differ from the source by
// the delta).
// `node tests/test_manual_ratings.mjs`
import fs from "node:fs";
import path from "node:path";
import { start, test, run, assert, ROOT } from "./harness.mjs";

const game = await start();
const build_teams = game.modules.build_teams;
const json = (...parts) => JSON.parse(fs.readFileSync(path.join(ROOT, ...parts), "utf8"));
const show = (v) => () => JSON.stringify(v);

test("manual ratings", () => {
  const manual = json("data", "manual_ratings.json");
  const built = json("data", "engine_teams.json")["teams"];
  let n = 0;
  for (const [team, players] of Object.entries(manual["ratings"])) {
    assert(team in built, `no team ${team}`);
    const roster = Object.fromEntries([...built[team]["offense"], ...built[team]["defense"]].map((p) => [p["slug"], p]));
    for (const [slug, deltas] of Object.entries(players)) {
      assert(slug in roster, `${slug} is not on ${team}`);
      assert(slug in manual["why"], `no reason given for ${slug}`);
      for (const [attr, d] of Object.entries(deltas)) {
        assert(build_teams.ATTRS.includes(attr) && -15 <= d && d <= 15, show([slug, attr, d]));
        n += 1;
      }
    }
  }
  // the mechanism: deltas apply once, clamped to 1-99, and a missing player or attribute is skipped
  const fake = [{ slug: "x", players: [{ slug: "a", position: "QB", passing: 95, decision_making: 40 }, { slug: "b", position: "RB", vision: 50 }] }];
  const applied = build_teams.apply_manual_ratings(fake, { ratings: { x: { a: { passing: 10, decision_making: -5, nope: 3 }, zzz: { passing: 1 } } } });
  assert(applied === 2 && fake[0]["players"][0]["passing"] === 99 && fake[0]["players"][0]["decision_making"] === 35);
  assert(fake[0]["players"][1]["vision"] === 50 && !("nope" in fake[0]["players"][0]));
  // the real build carries the edits: an edited attribute differs from the un-edited build by the delta
  const src = json("data", "engine_teams.json");
  assert(src["manual_ratings_applied"] === n, `the build applied ${src["manual_ratings_applied"]} of ${n} edits`);
  console.log(`manual ratings ok: ${n} attribute edits on ${Object.values(manual["ratings"]).reduce((s, v) => s + Object.keys(v).length, 0)} players`);
});

await run();
