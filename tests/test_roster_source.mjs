// The roster file is where a real player's ratings live (the player's rule): a career's league takes them from
// data/engine_teams.json (each player's `skills`, career_js/league.js _roster_ratings and compact), not from the source
// rosters, so a rating changed in the roster file is his rating in every season of a career. Today the two agree, so
// the league built this way is the league as it was.
// `node tests/test_roster_source.mjs`
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { start, test, run, assert, equal } from "./harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const game = await start();
const { league } = game.modules;
const game_scale = game.modules.game_scale ?? (await import("../teamdata_js/game_scale.js")).game_scale;
const file = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "engine_teams.json"), "utf8"));
const attrs = game_scale.keys();

test("every real player's ratings are read from the roster file, by team and player", () => {
  const rated = league._roster_ratings();
  const texas = file["teams"]["texas"];
  const p = texas["offense"].find((x) => x["position"] === "QB");
  equal(rated["texas"][p["slug"]], p["skills"]);
  assert(p["skills"].length === attrs.length, "a rating for every skill, in the scale's order");
  const n = Object.values(rated).reduce((k, t) => k + Object.keys(t).length, 0);
  assert(n > 10000, `${n} players`);
});

test("the league takes a player's ratings as the roster file has them: changed there, they are his", () => {
  const src = league.base_team("texas");
  const sp = src["roster"].find((x) => x["position"] === "QB" && x["ratings"]);
  const as_file = league._roster_ratings()["texas"][sp["slug"]];
  const plain = league.compact(sp, attrs, "TX", as_file);
  equal(plain["r"], as_file);
  const edited = [...as_file];
  edited[0] = Math.min(99, edited[0] + 7);
  edited[5] = Math.max(1, edited[5] - 9);
  const moved = league.compact(sp, attrs, "TX", edited);
  equal(moved["r"], edited);
  assert(moved["o"] !== undefined && moved["id"] === plain["id"] && moved["n"] === plain["n"], "the same player");
  // (his room to grow is measured from where he is now)
  assert(moved["g"].every((v) => v >= 0));
  // without the roster file's ratings he is read from his source ratings, as before
  equal(league.compact(sp, attrs, "TX")["r"], league.compact(sp, attrs, "TX", null)["r"]);
});

test("the first offseason's league is built from the roster file's ratings", () => {
  const lgd = league._compute_base(league.FIRST_YEAR + 1);
  const rated = league._roster_ratings();
  let checked = 0;
  for (const slug of ["texas", "ohio-state", "akron"]) {
    for (const c of lgd["teams"][slug]["roster"]) {
      const r = rated[slug][c["id"]];
      if (!r) continue;
      equal(c["r"], r, `${slug} ${c["n"]}`);
      checked += 1;
    }
  }
  assert(checked > 150, String(checked));
});

await run();
