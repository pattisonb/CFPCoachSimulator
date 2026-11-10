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

1. **Until NIL is attached, the grade reads what you could pay.** An offer with nothing held reads your room
   (`nil_left` plus anything held) against his ask, capped by the program's NIL pull: `min(pull, room / ask)`. A
   school with the money and the collective reads Strong; one that cannot cover him reads Weak, honestly.
2. **Once NIL is attached, it reads the deal**, `held / ask`, as today. You put up less than he wants, and it says so.
3. **Pitching NIL with nothing attached is money talk, not a backfire.** If NIL is one of his priorities (or his
   decider's topic), he names his number: his ask becomes exact, as the in-home visit's ask note does today, and a
   History line says so ("He told you he's looking for 40 in NIL."). The pitch scores off what you could pay (rule 1).
   If he does not care about NIL, he says so ("The money isn't what this is about for me.") and it counts as an
   off-priority pitch.
4. **AI schools follow the same rule**, so the race stays fair.

## Checks

- A test: offer with no NIL, then NIL strength is `min(pull, room / ask)`, not 0; a NIL pitch to a NIL-priority
  prospect with nothing held does not backfire and makes his ask exact.
- `tools/check_recruiting.py` before and after: how often a NIL pitch lands and the share of commits by tier
  should move only a little.
- `tests/test_sim_golden.py` includes a recruiting week. If this changes it, the player approves the new golden
  before it is regenerated (CLAUDE.md).
