// The scale fit's build sequence (game_scale.fit): one build without the frozen scale to measure
// the card scale, then the real build. The second build must carry every card overall (the fit
// once wrote data/engine_teams.json with all 12,427 overalls empty). Three teams' sources, in one
// process, the way fit() does it.
// `node tests/test_scale_fit_build.mjs`
import { start, test, run, assert } from "./harness.mjs";
import { get, json_dumps, truthy } from "../engine_js/pyrt.js";

const game = await start();
const build_teams = game.modules.build_teams;
const game_scale = game.modules.game_scale;
const files = game.files;

// The offline fit that made the scale is not part of the game (teamdata_js/game_scale.js says so), so the writer is
// here: the scale file written with json_dumps and no indent, and every kept copy dropped (the parsed file goes with
// the write; the card overalls kept by skills are cleared).
function write_scale(out) {
  files.write_text(game_scale.FILE, json_dumps(out, { indent: 0 }));
  files.forget(game_scale.FILE);
  game_scale._card_overall.cache_clear();
}

test("scale_fit_build", () => {
  // three teams in the source format the build reads (a league's teams), each player's overall left for the build
  const lgd = game.modules.league.from_base(2027);
  const sources = ["ohio-state", "georgia", "boise-state"].map((s) => game.modules.league.source_team(lgd, s));
  for (const t of sources) for (const p of t["roster"]) { delete p["ovr"]; delete p["overall"]; }
  let with_ratings = 0;
  for (const t of sources) for (const p of t["roster"]) if (truthy(get(p, "ratings"))) with_ratings++;
  // There is one copy of game_scale (the one build_teams reads), so the writer is the helper above; the scale file
  // is a temporary one.
  const good = JSON.parse(files.read_text(game_scale.FILE));
  const real = game_scale.FILE;
  const tmp = "data/test_scale_fit_build/game_scale.json";      // under the run's temporary folder (the harness)
  game_scale.FILE = tmp;
  let first, second;
  try {
    // step 1 of fit(): the scale without card scale or overall formulas, one build without the frozen scale
    write_scale({ keys: good["keys"], skills: good["skills"], card_scale: {}, overall: {} });
    build_teams.USE_FROZEN = false;
    try {
      first = build_teams.build(sources, undefined, undefined, true);
    } finally {
      build_teams.USE_FROZEN = true;
    }
    // step 2: the formulas written, then the real build
    write_scale({ ...good, card_scale: first["attribute_scale"] });
    second = build_teams.build(sources, undefined, undefined, true);
  } finally {
    game_scale.FILE = real;
    files.forget(real);
    game_scale._card_overall.cache_clear();
  }
  const overalls = (built) => {
    let n = 0;
    for (const t of Object.values(built["teams"])) for (const p of [...t["offense"], ...t["defense"]]) if (Number.isInteger(get(p, "ovr"))) n++;
    return n;
  };
  assert(game_scale.has_overall(), "the frozen scale has no overall formulas");
  const n = overalls(second);
  assert(n >= with_ratings - 5, `the second build carries ${n} card overalls for ${with_ratings} players with ratings`);
  console.log(`scale fit build ok: ${overalls(first)} overalls without the frozen scale, ${n} with it, ${with_ratings} players with ratings`);
});

await run();
