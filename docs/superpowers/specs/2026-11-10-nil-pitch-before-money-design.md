# NIL pitch before money is on the table

**Status:** draft (November 10), not yet approved by the player.

## The bug

`recruiting.strengths` reads NIL two ways:

- **No offer yet:** the program's NIL pull, `_logistic(1.4 * z_of(program nil))` (measured: Ohio State 0.96 Strong,
  Iowa 0.80 Strong, SMU 0.49 Fair, Tulane 0.35 Fair).
- **Offered:** the NIL attached against his ask, `held / ask`. An offer with no NIL on it reads **0.0, Weak**
  (measured: Iowa, a prospect asking 40, 0.80 before the offer and 0.0 after).

So the common order (offer, then call or visit and talk money) is punished. NIL shows Weak on the pitch picker, and
pitching NIL to a prospect who cares about it **backfires** (`pitch_points`: under `BACKFIRE` on a priority costs
`BACKFIRE_COST`), even at a school that could pay his whole ask.

## The fix

The player's rule (November 10): a small program that means to spend its whole budget on one five-star should not
pitch NIL as Weak, but a school that never backs the pitch with money should not get a free Strong either.

1. **Until NIL is attached, the grade reads what you could pay him**: your room (`nil_left` plus anything held on
   him) against his ask, `min(1, room / ask)`. It does not read the program's NIL tier: a Group of 5 school with
   the room to cover a five-star reads Strong for him; Ohio State with its budget spent reads Weak.
2. **Pitching NIL with nothing attached is a promise of money.** If NIL is one of his priorities (or his decider's
   topic), he names his number (his ask becomes exact, as the in-home visit's ask note does today), the pitch scores
   off rule 1, and he carries a **money promise**: put NIL on your offer (at least `NIL_PROMISE_SHARE` of his ask,
   *tune*, about 80%) within `NIL_PROMISE_WEEKS` (*tune*, 2) or the promise breaks: he cools, a History line says
   why ("You talked money and never put it on the table."), and it counts against Keeps His Word
   (`2026-11-10-promises-expansion-design.md`). Kept, it lands like a Package Deal promise kept.
3. **Once NIL is attached, it reads the deal**, `held / ask`, as today.
4. **If he does not care about NIL**, he says so ("The money isn't what this is about for me.") and it counts as an
   off-priority pitch, with no promise.
5. **AI schools read rule 1 too**, so the race stays fair. They carry no money promises (AI schools make no promises).

The honest version of "talk money before you pay it": you can, at full strength, as long as you follow through.

## Checks

- A test: offer with no NIL, then NIL strength is `min(pull, room / ask)`, not 0; a NIL pitch to a NIL-priority
  prospect with nothing held does not backfire and makes his ask exact.
- `tools/check_recruiting.py` before and after: how often a NIL pitch lands and the share of commits by tier
  should move only a little.
- `tests/test_sim_golden.py` includes a recruiting week. If this changes it, the player approves the new golden
  before it is regenerated (CLAUDE.md).
