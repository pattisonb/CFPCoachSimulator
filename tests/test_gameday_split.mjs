// Game day plays only your game; the week's other games wait for Advance, and the
// results are the same as simulating the whole week at once. Also the title-game week:
// the matchups are set before your game.
// `node tests/test_gameday_split.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { odict, is_odict } from "../engine_js/pyrt.js";

const game = await start();
const { season } = game;

// copy.deepcopy of a season's state (key order kept, an odict's too)
function deepcopy(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(deepcopy);
  const out = is_odict(v) ? odict() : {};
  for (const k of Object.keys(v)) out[k] = deepcopy(v[k]);
  return out;
}

test("gameday split", () => {
  const base = season.new_season("ohio-state", "full", 21);
  season.advance_to(base, 2);
  const whole = deepcopy(base);
  const split = deepcopy(base);
  season.advance(whole);                       // week 3 at once
  let eid = season.play_my_game(split);        // game day: only your game
  const g = split["games"][eid];
  assert(g["played"] && split["current_week"] === 2, () => JSON.stringify([g["played"], split["current_week"]]));
  const others = Object.entries(split["games"]).filter(([k, x]) => x["week"] === 3 && k !== eid).map(([, x]) => x);
  assert(others.length && !others.some((x) => x["played"]), "only your game should be played");
  assert(season.my_game_id(split) === null, "your game should count as played");
  season.advance(split);                       // the rest of the week
  assert(split["current_week"] === 3);
  for (const [k, x] of Object.entries(whole["games"])) {
    if (x["week"] === 3) {
      const y = split["games"][k];
      assert(x["home_score"] === y["home_score"] && x["away_score"] === y["away_score"],
        () => JSON.stringify([k, x["home_score"], x["away_score"], y["home_score"], y["away_score"]]));
    }
  }
  equal(whole["rng_state"], split["rng_state"]);
  console.log(`week 3 identical either way: ${g["away_display"]} ${g["away_score"]} at ${g["home_display"]} ${g["home_score"]}`);
  // a bye: no game to play
  const bye = deepcopy(base);
  bye["games"] = odict(Object.entries(bye["games"]).filter(([, v]) => !(v["week"] === 3 && ["ohio-state"].some((s) => s === v["home"] || s === v["away"]))));
  assert(season.play_my_game(bye) === null);
  // championship week: the title game is set before game day, and the rest follows
  const cc = season.new_season("ohio-state", "full", 21);
  season.advance_to(cc, season.CCG_WEEK - 1);
  eid = season.play_my_game(cc);
  if (eid) console.log("CCG week game day:", cc["games"][eid]["title"]);
  season.advance(cc);
  assert(cc["current_week"] === season.CCG_WEEK && cc["bracket"] && Object.keys(cc["bracket"]).length, "the bracket is built after the full week");
  console.log("gameday split ok");
});

await run();
