// An offer lands at the week step, as a call does (the player's ask): his board row says the offer is on its way
// (`offer_landing`) until the week advances, so the page shows "Offer Sent", not "Clear Favorite", the moment you offer.
// `node tests/test_offer_lands.mjs`
import { start, test, run, assert } from "./harness.mjs";

const game = await start();
const { season, recruiting } = game;
const { prospects } = game.modules;

const ME = "iowa";

test("test_offer_lands_at_the_week_step", () => {
  const st = season.new_season(ME, "full", 11, undefined, undefined, true);
  const rc = st["recruiting"];
  const by_rank = Object.keys(rc["prospects"]).sort((a, b) => rc["prospects"][a]["rank"] - rc["prospects"][b]["rank"]);
  const pid = by_rank.slice(40).find((q) => !rc["prospects"][q]["hidden"]);
  recruiting.set_board(st, pid, true);
  assert(prospects.board_row(st, pid, ME)["offer_landing"] === false, "no offer: nothing on its way");
  recruiting.act(st, ME, pid, "offer", "winning", 0);
  let row = prospects.board_row(st, pid, ME);
  assert(row["offered"] && row["offer_landing"], () => String(row["offer_landing"]));
  recruiting.weekly_step(st, st["current_week"]);
  st["current_week"] += 1;                       // the season's advance moves the week on
  row = prospects.board_row(st, pid, ME);
  assert(row["offered"] && !row["offer_landing"], "the week step lands it");
});

test("test_ai_offers_never_marked", () => {
  const st = season.new_season(ME, "full", 11, undefined, undefined, true);
  recruiting.weekly_step(st, st["current_week"]);
  assert(!Object.keys(st["recruiting"]["offer_landing"] || {}).length, "only your offers are marked");
});

await run();
