// Letter grades for overall potential (career_js/grades.js): the bands, the plus and minus, how reads sort.
// `node tests/test_grades.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";

const game = await start();
const { grades, shown } = game.modules;

/** A potential on the game's own scale that shows as `v`. */
function shown_at(v) {
  return shown.overall_back(v);
}

test("test_bands", () => {
  const want = new Map([[99, "A"], [90, "A"], [89, "B"], [80, "B"], [79, "C"], [70, "C"], [69, "D"], [60, "D"], [59, "F"], [41, "F"]]);
  equal(new Map([...want.keys()].map((v) => [v, grades.letter(shown_at(v))])), want);
});

test("test_plus_and_minus_split_a_band_in_thirds", () => {
  equal([90, 92, 93, 96, 97, 99].map((v) => grades.letter(shown_at(v), true)), ["A-", "A-", "A", "A", "A+", "A+"]);
  equal([80, 82, 83, 86, 87, 89].map((v) => grades.letter(shown_at(v), true)), ["B-", "B-", "B", "B", "B+", "B+"]);
  assert(grades.letter(shown_at(50), true) === "F", "an F takes no plus or minus");
  assert(grades.letter(140, true) === "A+" && grades.letter(-5) === "F", "a read past the scale's ends stays on it");
});

test("test_order_and_sorting", () => {
  assert(grades.ORDER[0] === "F" && grades.ORDER[grades.ORDER.length - 1] === "A+");
  assert(grades.place("B") > grades.place("B-") && grades.place("B+") > grades.place("B") && grades.place("A-") > grades.place("B+"));
  // best first; two reads that show the same letters tie, whatever the numbers behind them
  assert(grades.sort_key(["A", "A"]) < grades.sort_key(["B", "A"]) && grades.sort_key(["B", "A"]) < grades.sort_key(["B", "B"]));
  equal(grades.sort_key(grades.span(shown_at(81), shown_at(82), false)), grades.sort_key(grades.span(shown_at(88), shown_at(89), false)));
});

test("test_span", () => {
  equal(grades.span(shown_at(85), shown_at(94), false), ["B", "A"]);
  equal(grades.span(shown_at(88), shown_at(94), true), ["B+", "A"]);
  equal(grades.span(shown_at(95), shown_at(91), true), ["A-", "A"], "low then high, whichever way it is given");
});

test("test_eye_unlocks_the_fine_read", () => {
  const state = { career: { staff: [{ evaluation: 55 }, { evaluation: grades.PLUS_MINUS_EYE }] }, team: null };
  assert(grades.fine(state));
  state["career"]["staff"][1]["evaluation"] = grades.PLUS_MINUS_EYE - 1;
  assert(!grades.fine(state));
});

await run();
