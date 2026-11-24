// The rosters the game reads are static files in the repository (the player's rule): data/engine_teams.json and
// data/player_potential.json, committed, the one place a real player's ratings live. Nothing makes them: not the game,
// not the dev server, not a build of the site, real names or lookalike. The files that once went into making them
// (the hand ratings, the real-usage depth charts and nudges) are gone: they are part of the rosters now.
// `node tests/test_static_rosters.mjs`
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test, run, assert, equal } from "./harness.mjs";
import * as build from "../tools/build_site.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("the rosters are two files among the data the game is packed with", () => {
  equal(build.ROSTERS, ["data/engine_teams.json", "data/player_potential.json"]);
  assert(build.ROSTERS.every((f) => build.GENERATED.includes(f) && build.DATA_FILES.includes(f)));
  for (const f of build.ROSTERS) assert(fs.existsSync(path.join(ROOT, f)), `${f} is missing`);
});

test("git keeps them: neither is ignored, and both are tracked", () => {
  for (const f of build.ROSTERS) {
    equal(git("check-ignore", "-q", f).status, 1, `${f} is ignored by git`);
    equal(git("ls-files", "--error-unmatch", f).status, 0, `${f} is not committed`);
  }
});

test("nothing makes them: no build step, no host command, and the files that fed their making are gone", () => {
  const site = read("tools/build_site.mjs"), host = read("tools/game_host.mjs"), worker = read("ui/public/worker.js");
  assert(!/\[HOST, root, "teams"/.test(site), "the site build runs the roster builder");
  assert(!/build_teams\.main\(/.test(host) && !/build_teams\.main\(/.test(worker), "a host still calls the roster builder");
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools", "game_host.mjs"), ROOT, "teams"], { cwd: ROOT, encoding: "utf8" });
  assert(r.status !== 0 && /not made/.test(r.stderr), "the old command still runs");
  assert(!fs.existsSync(path.join(ROOT, "data", "manual_ratings.json")), "the hand ratings file is back");
  equal(Object.keys(JSON.parse(read("data/real_adjustments.json"))).sort(), ["built_from", "usage"]);
  assert(!build.DATA_FILES.includes("data/manual_ratings.json"));
});

test("every player in them has his ratings, an id and a name, and his team an identity", () => {
  const teams = JSON.parse(read("data/engine_teams.json"))["teams"];
  assert(Object.keys(teams).length >= 138, String(Object.keys(teams).length));
  let n = 0;
  for (const [slug, t] of Object.entries(teams)) {
    assert(t["slug"] === slug && t["name"] && t["abbreviation"], slug);
    if (t["fictional"]) continue;
    for (const p of [...t["offense"], ...t["defense"]]) {
      assert(p["slug"] && p["name"] && p["position"], `${slug} ${p["name"]}`);
      // (a real player added to a roster from real usage plays on a stand-in's numbers: he has no ratings of his own)
      if (!String(p["slug"]).startsWith("real-")) assert(Array.isArray(p["skills"]) && p["skills"].length === 54, `${slug} ${p["name"]}`);
      n += 1;
    }
  }
  assert(n > 10000, `${n} players`);
});

await run();
