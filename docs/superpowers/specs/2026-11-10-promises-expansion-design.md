# Promises expansion: your word, judged week by week

**Status:** draft (November 10), with the player's calls of November 10 folded in (see "Decided"). It rebuilds a talk
whose notes were lost.

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
- **Personas weigh it differently.** A player whose decider cares about playing time, or who is Guarded,
  weighs it most.
- **Only you have it.** AI coaches make no promises and carry no Keeps His Word (decided: too much to model for
  what it adds).

### 2. A promised player who did not get his snaps is all but gone

When a promise to a recruit or a portal signee is broken, he is **likely to enter the portal, and close to certain
the older he is**, not the current 3×. The leave chance rises with what he has left to lose: a freshman who still
has years to win the job might wait it out; a junior or senior with eligibility left is all but gone. A Broken
promise in a big way (benched in big games, a quarterback) pushes it higher; a Shy player's a little lower. At Keep Them Home his card says so ("Was promised a starting role and did not get it")
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
- **Injuries do not count against you.** The engine rolls in-season injuries (`engine/game_config.INJURIES`, the
  Injury Report; `sim/season._injured` marks a hurt player `injured`, `in_game` False). A week he is injured is
  left out of his score.
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

Every promised player wears a **chip** on your roster and depth chart showing where the promise is landing right now:
**On Track**, **Slipping** or **Broken** (the band the score would give if the season ended today). Midseason a
slipping player says so ("Coach, you told me this was my job."), so you can change the depth chart before the
offseason judges it.

### 5. Unhappy players: what he came for, and whether he is getting it (added November 11)

A player remembers what he cared about as a recruit (his three priorities and his decider's topic) and the promises
he was made, and the game checks them during the season:

- **Playing time** against his role; **NIL** against what he is paid; **the coach** (the head coach who recruited him
  still there); **winning**, **prestige** and **proximity** stay as they were when he signed, so they rarely sour.
- **A broken promise** (section 3) sours him outright.
- Each unmet one raises his transfer chance at the offseason (a new `portal_odds` segment, "Not what he signed up
  for", like the `promised` one), so the reason on his Keep Them Home card is the real one.
- **Player Impact and Retention** (Headquarters) lists unhappy players with what is missing ("Wants More Snaps",
  "Coach Who Recruited Him Left", "Promise Broken"), so you can act before the offseason.

This needs the recruit's priorities carried onto the roster when he signs (`_sign_classes`, `_close_portal`: the
league roster rows carry no priorities today) and kept on saves from before (none: they simply have no priorities,
so nothing sours).

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

## Decided (November 10)

1. **A broken promise hurts recruiting everywhere, most at his position.** Keeps His Word has an overall reading and
   a per-position memory; the position he played takes the heavy hit.
2. **"Guaranteed to leave" depends on him.** Close to certain for a junior or senior with eligibility left, lower
   for a freshman; the size of the break and his personality move it.
3. **AI coaches have no promises and no Keeps His Word.** Only the player.
4. **A chip shows where each promise is landing** during the season.
5. **The softer "real role" promise comes later**, after the three phases.
6. **Injured weeks do not count**: the game has in-season injuries.
