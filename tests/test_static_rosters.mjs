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
  assert(build.ROSTERS.every((f) => build.DATA_FILES.includes(f)));
  equal(build.GENERATED, []);                                    // no build makes any data from other data
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
  assert(r.status !== 0 && /nothing is made/.test(r.stderr), "the old command still runs");
  assert(!fs.existsSync(path.join(ROOT, "data", "manual_ratings.json")), "the hand ratings file is back");
  // the source rosters they were once made from, and the files of adjustments laid over them, are gone too
  for (const f of ["cfb_sim_data/teams", "data/real_adjustments.json", "data/scheme_overrides.json", "data/base_league.json"]) {
    assert(!fs.existsSync(path.join(ROOT, f)), `${f} is back`);
    assert(!build.DATA_FILES.some((d) => d.startsWith(f)), `${f} is packed`);
  }
  assert(!/base_team|write_base_files|cfb_sim_data\/teams/.test(read("career_js/league.js")), "the league reads source rosters");
});

test("every player in them has one set of ratings by the names his card prints, an id and a name, and nothing worked out", async () => {
  const file = JSON.parse(read("data/engine_teams.json"));
  const { start } = await import("./harness.mjs");
  const { rosters } = (await start()).modules;
  equal(file["format"], 3);
  const teams = file["teams"];
  assert(Object.keys(teams).length >= 138, String(Object.keys(teams).length));
  const worked_out = ["skills", "ovr", "attributes", "ratings_at", "speed", "strength", "passing", "hands", "coverage", "tackling", "stats"];
  let n = 0;
  for (const [slug, t] of Object.entries(teams)) {
    assert(t["slug"] === slug && t["name"] && t["abbreviation"], slug);
    for (const p of [...t["offense"], ...t["defense"]]) {
      const who = `${slug} ${p["name"]}`;
      assert(p["slug"] && p["name"] && p["position"] && p["source_position"], who);
      equal(Object.keys(p["ratings"]), rosters.names_for(p["position"], p["role"]).map(([name]) => name), who);     // every rating, by his card's names, his card's first
      assert(Object.values(p["ratings"]).every((v) => Number.isInteger(v) && v >= 1 && v <= 99), who);
      for (const k of worked_out) assert(!(k in p), `${who} stores ${k}`);
      n += 1;
    }
  }
  assert(n > 10000, `${n} players`);
});

test("a player is a line of the file: a rating changed by hand is one line changed", () => {
  const lines = read("data/engine_teams.json").split("\n");
  const mine = lines.filter((l) => l.startsWith('{"name":'));
  assert(mine.length > 10000, String(mine.length));
  assert(mine.every((l) => /"ratings":\{"[A-Z][A-Za-z :-]*":\d+,/.test(l)), "a player without his ratings on his line");
  assert(!mine.some((l) => /"(throw_under_pressure|acceleration|bc_vision)":/.test(l)), "a rating under a name no card prints");
});

await run();
