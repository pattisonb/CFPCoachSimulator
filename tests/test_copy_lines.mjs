// Copy in generated sentences: an injury reads naturally after "with" in the league's news ("with a concussion",
// "with an ankle sprain", "with back spasms").
// `node tests/test_copy_lines.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { cfg } from "../engine_js/game_config.js";

const game = await start();
const news = game.modules.news;

test("an injury takes the right article after \"with\"", () => {
  equal(news._with("back spasms"), "back spasms");
  equal(news._with("ankle sprain"), "an ankle sprain");
  equal(news._with("concussion"), "a concussion");
  equal(news._with("high ankle sprain"), "a high ankle sprain");
});

test("every injury the game can give reads as English after \"with\"", () => {
  assert(cfg.INJURY_TYPES.length >= 5);
  for (const t of cfg.INJURY_TYPES) {
    const phrase = news._with(t);
    const plural = t.endsWith("s") && !t.endsWith("ss");
    if (plural) equal(phrase, t, "a plural takes no article");
    else assert(phrase === `${/^[aeiou]/.test(t) ? "an" : "a"} ${t}`, phrase);
  }
});

await run();
