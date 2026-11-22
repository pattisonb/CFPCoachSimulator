// The precomputed base league (league.write_base_files): data/base_league.json is from_base()'s
// output and data/base_meta.json every team's identity, so the browser bundle never reads the 146
// source rosters. With the files, from_base, base_meta and base_slugs answer from them, the same as
// the source files would. The files go to a temporary folder, never into data/.
// `node tests/test_base_league.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { start, test, run, assert, equal } from "./harness.mjs";
import { json_dumps, sorted } from "../engine_js/pyrt.js";

const game = await start();
const league = game.modules.league;

function test_precomputed_league_matches_live(tmp_dir) {
  const files = [league.BASE_LEAGUE_FILE, league.BASE_META_FILE];
  try {
    const live = league._compute_base(2027);            // the source path, whatever data/ holds
    league.BASE_LEAGUE_FILE = path.join(tmp_dir, "bl.json");
    league.BASE_META_FILE = path.join(tmp_dir, "bm.json");
    league.write_base_files();
    league.base_meta.cache_clear(); league.base_slugs.cache_clear();
    assert(league.from_base(2028)["year"] === 2028);
    equal(new Set(Object.values(league.from_base(2028)["teams"]).map((t) => t["program"]["year"])), new Set([2027]));   // as programs.init sets it
    assert(json_dumps(league.from_base(2027), { sort_keys: true }) === json_dumps(live, { sort_keys: true }));
    equal([...league.base_slugs()], sorted(Object.keys(JSON.parse(fs.readFileSync(league.BASE_META_FILE, "utf8")))));
    assert(league.base_meta("smu")["conference"] && !("roster" in league.base_meta("smu")));
  } finally {
    [league.BASE_LEAGUE_FILE, league.BASE_META_FILE] = files;
    league.base_meta.cache_clear(); league.base_slugs.cache_clear();
  }
}

test("test_precomputed_league_matches_live", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cfp-base-league-"));
  try {
    test_precomputed_league_matches_live(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log("ok");
});

await run();
