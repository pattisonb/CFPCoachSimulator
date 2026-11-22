// Who gets into the AP Top 25 from outside (sim/polls.next_poll): voters rank a team's whole
// resume, so a team nobody voted for with three losses does not jump in on one big win (3 of 456
// real entries since 2014 came from zero votes with three or more losses), while a team already
// receiving votes that wins enters ahead of it.
// `node tests/test_poll_entries.mjs`
import { start, test, run, assert } from "./harness.mjs";
import { sorted } from "../engine_js/pyrt.js";

const game = await start();
const polls = game.modules.polls;

function frame() {
  const prev = [];
  for (let i = 1; i < 26; i++) prev.push({ team: `t${i}`, rank: i, points: 1700 - 62 * (i - 1), first_place: 0 });
  prev.push({ team: "votes", rank: null, points: 128, first_place: 0 }, { team: "fewvotes", rank: null, points: 30, first_place: 0 });
  const tiers = { ...Object.fromEntries(prev.map((e) => [e["team"], "P4"])), nobody: "P4", unranked_a: "P4", unranked_b: "P4" };
  const records = { ...Object.fromEntries(prev.map((e) => [e["team"], [6, 1]])), t1: [7, 0], t2: [6, 1], nobody: [4, 3], votes: [5, 2], fewvotes: [5, 2], unranked_a: [3, 4], unranked_b: [3, 4] };
  const games = [{ home: "nobody", away: "t2", home_score: 39, away_score: 31, neutral: false },        // a 4-3 team nobody voted for beats No. 2
                 { home: "votes", away: "unranked_a", home_score: 57, away_score: 24, neutral: false }, // first in line last week wins big
                 { home: "t25", away: "unranked_b", home_score: 10, away_score: 13, neutral: false }];  // No. 25 loses at home to a 3-4 team
  return [prev, games, records, tiers];
}

test("poll_entries", () => {
  const [prev, games, records, tiers] = frame();
  const [order] = polls.next_poll(prev, games, records, tiers);
  assert(!order.includes("nobody"), () => `a 4-3 team with no votes entered at #${order.indexOf("nobody") + 1}`);
  assert(order.includes("votes"), "the team first in line with a win did not enter");
  assert(!order.includes("t25"), "No. 25 stayed after losing at home to a 3-4 team");
  assert(order.indexOf("t2") >= 5, () => `No. 2 only fell to #${order.indexOf("t2") + 1} after losing to an unranked team`);
  // a team with no votes can still enter unbeaten: 7-0 beating No. 2 goes in
  const records2 = { ...records, nobody: [7, 0] };
  const [order2] = polls.next_poll(prev, games, records2, tiers);
  assert(order2.includes("nobody"), "a 7-0 team beating No. 2 did not enter");
  // the same through the voters' ballots (the game's path): each voter moves their own ballot
  const seeded = polls.seed_ballots(prev, undefined, 3);
  const [, points] = polls.next_ballots(seeded, prev, games, records, tiers, polls.load_ballot_params(), 3);
  const top = sorted(Object.keys(points), (t) => -points[t]).slice(0, 25);
  assert(!top.includes("nobody"), () => `ballots: a 4-3 team with no votes entered at #${top.indexOf("nobody") + 1} with ${points["nobody"]} points`);
  assert(top.includes("votes"), "ballots: the team first in line with a win did not enter");
  const [, points2] = polls.next_ballots(seeded, prev, games, records2, tiers, polls.load_ballot_params(), 3);
  const top2 = sorted(Object.keys(points2), (t) => -points2[t]).slice(0, 25);
  assert(top2.includes("nobody"), "ballots: a 7-0 team beating No. 2 did not enter");
  console.log(`poll entries ok: nobody out, votes in at #${order.indexOf("votes") + 1}, No. 2 to #${order.indexOf("t2") + 1}, a 7-0 upset winner in at #${order2.indexOf("nobody") + 1}`);
});

await run();
