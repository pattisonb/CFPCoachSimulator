# Promises expansion: your word, judged week by week

**Status:** draft (November 10). It rebuilds a talk whose notes were lost; the player has not approved it yet.
The "Open Calls" section lists the decisions still to make.

## Today

- You can promise a starting role at Keep Them Home, to a recruit on a call or visit ("Promised him the job
  over …"), or to a portal signee. He carries `promised = year` onto the roster.
- At the offseason one test judges it: `offseason.portal_odds` reads `use != "starter"` from `_usage()`,
  which is **the end-of-season depth chart** (`in_game`). It is all or nothing: one snapshot decides.
- A broken promise adds a `promised` portal segment worth `PROMISE_BROKEN - 1` (2) times his role chance.
  That is all it costs. No recruit hears about it, and you can make the same promise again next week.
- Package Deal promises (an offer to his teammate) are judged within `PACKAGE_PROMISE_WEEKS` and cost firmness
  (`PROMISE_RIVAL`). They stay as they are; they feed the new reputation below.

## What changes

### 1. Keeps His Word: your reputation for keeping promises

A new coach reading, **Keeps His Word**, shown in words (Elite … Weak, `programs.WORD_FLOORS`), never as a number.

- **It belongs to the coach, not the school.** It follows you to a new job.
- **Kept promises raise it, broken ones lower it, and broken ones cost more than kept ones earn.** A broken
  promise to a high-profile player (a starter-level transfer, a top recruit) costs more. It recovers slowly
  toward neutral each offseason.
- **It has a position memory.** Besides the overall reading, each position group remembers the last few years.
  Break a promise to a quarterback and quarterback recruits hear about it most; every other position hears a little.
- **Recruits read it.** "Make Him a Promise" (`ANSWER_PROMISE`) is worth more with a strong word and less with
  a weak one, and below a floor he does not believe you at all ("Coach, I heard what happened with Jalen.").
  Rival schools can use it against you in negative recruiting scenes.
- **Personas weigh it differently.** A player whose decider cares about playing time, or who is Guarded,
  weighs it most.
- AI coaches get a starting reading from their rating and tenure so the comparison is fair. Only your
  promises move it in the first version.

### 2. A promised player who did not get his snaps is all but gone

When a promise to a recruit or a portal signee is broken, he is **nearly certain to enter the portal**,
not the current 3×. At Keep Them Home his card says so ("Was promised a starting role and did not get it")
and gives you two ways to try:

- **Promise him again.** It works only when your Keeps His Word is strong enough and your depth chart would
  really start him next year. A second promise broken means he is gone for good; there is no third.
- **Pay him a lot.** NIL at a big multiple of his normal ask. A Business-minded player takes the money most
  easily; a Cocky one least.

Otherwise he leaves, and the History line says why.

### 3. The promise is judged all season, not on one snapshot

Each week the career records whether every promised player started. Nothing in the season sim changes; this is a
read of the depth chart at each week's advance. At the offseason his **promise score** is the weighted share of the
starts he got:

- **Late weeks count more than early ones.** He sat the first six games and started the second half? To him that
  is mostly kept. He started six and lost the job? That reads worse than the same six starts the other way around.
- **Big games count more.** Rivalry games (`data/rivalries.json`), ranked opponents, the conference title game,
  bowls and the playoff. Being **benched in a big game** is its own hit.
- **Position changes the weight.** A quarterback's benching is public and counts most. A rotational lineman or
  specialist counts less.
- **Injuries, later.** The season sim has no in-season injuries today. When it does, the weeks he is out will not
  count against you.
- **Personality sets how hard he grades** (`persona.PERSONALITIES`):

| Personality | How he judges the promise |
|---|---|
| Cocky | High bar. Hates being benched; one big-game benching can break it |
| Shy | Patient. A second-half starting job is enough |
| Guarded | Fair bar, long memory: a broken promise costs your word the most |
| Loves the Attention | Big games and national TV count double |
| All Business | Counts starts plainly. NIL can make up the gap |

The score lands in one of three bands:

- **Kept:** your word rises; he settles in (his portal chance drops, like `kept`).
- **Bent:** partly kept. A small portal bump, a small word hit. A fair Keep Them Home talk fixes it.
- **Broken:** section 2 applies, and your word takes the full hit.

### 4. You can see it coming

Your roster and Office show each promise's standing in words: **On Track**, **Slipping**, **Broken**. Midseason a
slipping player says so ("Coach, you told me this was my job."), so you can change the depth chart before the
offseason judges it.

## Phases

1. **Weekly tracking and the score.** Record starts per week; replace the one-snapshot test with the score, the
   bands and personality. The promise tracker on the roster.
2. **Keeps His Word.** The reading, its position memory, recruits and scenes reading it.
3. **Second chances.** Near-certain departure for broken recruit and portal promises; promise-again and big NIL at
   Keep Them Home.

## Rules this keeps

- `python3 tests/test_sim_golden.py` stays byte-identical. Tracking reads the depth chart and never draws from the
  season's random streams. New draws get their own stream (`_rng(state, "promise")`).
- Weights (week curve, big-game factor, position weights, band floors, word gains and costs) are module-level
  `*tune*` constants, checked over a long run with `tools/long_run.py`.
- Labels Title Case ("Keeps His Word", "On Track", "Promise Him Again").

## Open Calls (the player decides)

1. **Does a broken promise hurt recruiting at every position, or mostly the same one?** Recommended: both,
   the same position heavily and every other position lightly.
2. **How certain is "basically guaranteed to leave"?** Recommended: about 90% when nothing is done, so a rare one
   stays and it never reads as scripted.
3. **More promise kinds?** For example "a real role" (rotation) as a softer promise that is easier to keep and
   worth less. Recommended: later, after the three phases.
4. **Is Keeps His Word visible on rival coaches?** Recommended: yes on the coaching carousel and in recruit scenes,
   so you can use a rival's broken promises against him.
