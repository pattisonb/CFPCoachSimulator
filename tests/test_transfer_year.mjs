// Last year's transfers are not this year's (the player's report: the picker's Transfers group still listed players who
// transferred in a year ago). A transfer is stamped with the offseason he came; only this offseason's are named
// transfers. An older save without the stamp reads this offseason's portal moves.
// `node tests/test_transfer_year.mjs`
import { start, test, run, assert } from "./harness.mjs";

const game = await start();
const { offseason } = game;

test("test_new_transfer", () => {
  const off = { year: 2028, portal: { moves: [{ id: "b", to: "iowa" }, { id: "c", to: "ohio-state" }] } };
  assert(offseason._new_transfer(off, { id: "a", transfer: "ucla", transfer_year: 2028 }, "iowa"));
  assert(!offseason._new_transfer(off, { id: "a", transfer: "ucla", transfer_year: 2027 }, "iowa"), "last year's");
  assert(offseason._new_transfer(off, { id: "b", transfer: "ucla" }, "iowa"), "an old save: this year's moves");
  assert(!offseason._new_transfer(off, { id: "c", transfer: "ucla" }, "iowa"), "an old save: not his move to you");
  assert(!offseason._new_transfer(off, { id: "d", transfer: "ucla" }, "iowa"), "an old save: last year's");
  assert(!offseason._new_transfer(off, { id: "e" }, "iowa"), "never a transfer");
  console.log("transfer year ok: only this offseason's transfers are named transfers");
});

await run();
