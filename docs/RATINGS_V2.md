# Ratings v2: proposal

Status (October 20, 2026): agreed. Brian's answers to the open questions: keep the house scale,
roll out phase by phase, build traits in this revamp. Phase 1 is built: `teamdata/ratings.py` holds the
catalogue; build_teams writes each player's attributes (house scale), height in inches,
play style and traits; the player card, its details view and god mode use them; edits move
the engine composites through `ratings.COMPOSITES`. The sim is unchanged (same play-log
fingerprint). Phase 2 (passing by depth, man and zone, contested catches) is built; see
docs/HOW_IT_WORKS.md, "Passing by depth". Phases 3-6 are built too (running, pass rush,
turnovers and the body, traits); see "Running, pass rush, turnovers and traits".

## Why

Today every player carries 8 to 11 engine ratings, and a position's card shows 6 or 7. They
are built by blending a few of EA's 54 source ratings into each one:

- *passing* is 0.3 short accuracy, 0.35 mid, 0.2 deep and 0.15 throw power;
- the engine then blends them again on every play (a run reads speed, strength, elusiveness
  and vision as one number).

So two players with the same composite play the same way. Examples:
- a deep-ball QB and a quick-game QB with the same *passing*;
- a power back and a scat back with the same carrier rating;
- a press corner and a zone corner.

Recruits and development will need players who differ in kind, not only in level.

## The plan in one paragraph

Each position carries 15 to 20 attributes plus height and weight. Each attribute has its
own name and a clear job in the sim. They are built from EA's source ratings, renamed so
the names say what they do and are our own. The engine reads them situationally:
- deep accuracy on deep throws;
- press against release at the snap;
- power running against block shedding on inside runs;
- burst and agility against pursuit outside.

It rolls out in phases. Phase 1 changes the cards and the data with the sim untouched
(the old composites come from the new attributes). Each later phase moves one part of the
game onto the new attributes and has to pass the same checks as today's tuning:
- game picks and Brier score;
- the week-8 comparison;
- full seasons against 2023-2025;
- the forward test.

## Attribute catalogue

Our name, what it does in the sim, and the EA source rating(s) it is built from.

### Physical and mental (every position)

| Attribute | What it does | Source |
|---|---|---|
| Top Speed | Long runs, deep routes, pursuit angles, separation over distance | speed |
| Burst | First steps: hitting the hole, getting off the line, closing on the ball | acceleration |
| Agility | Cutting and changing direction: jukes, route breaks, staying with a cut | agility, change of direction |
| Strength | Winning at the point of contact: blocks, sheds, tackles, broken tackles | strength |
| Leaping | Contested catches, high-point throws, batted passes, blocked kicks | jumping |
| Stamina | How fast he tires and recovers (rotation, late-game drop-off) | stamina |
| Durability | Injury chance and how long injuries last | injury, toughness |
| Football IQ | Penalties, fumbles, assignment errors, reading the play | awareness |
| Height | Catch radius, passing lanes over the line, batted passes, leverage | measured |
| Weight | Mass in blocking, tackling and short yardage, against speed | measured |

### Passing (QB)

| Attribute | What it does | Source |
|---|---|---|
| Arm Strength | Deep and outside throws (distance and velocity), throws into tight windows | throw power |
| Short Accuracy | Completion on throws under 10 yards (and checkdowns) | short accuracy |
| Intermediate Accuracy | Completion at 10-20 yards | mid accuracy |
| Deep Accuracy | Completion on 20+ yard throws | deep accuracy |
| Throwing on the Move | Accuracy on scrambles, rollouts and under a free rusher | throw on the run |
| Pocket Poise | Accuracy and decisions when pressured; fewer forced throws | throw under pressure |
| Play-Action | How well a fake holds the linebackers (play-action gains) | play action |
| Sack Escape | Escaping a sack that is about to land (turns sacks into throwaways or scrambles) | break sack |
| Decision Making | Interceptions and throwaways vs forced throws; reads coverage | awareness, throw under pressure |

### Ball carrying (QB, RB, WR, TE)

| Attribute | What it does | Source |
|---|---|---|
| Running Vision | Finding the hole and cutback lanes; yards before contact | ball-carrier vision |
| Ball Security | Fumbles, especially against hard hitters | carrying |
| Elusiveness | Making the first tackler miss in space | juke, spin |
| Power Running | Yards after contact; short-yardage conversions | trucking |
| Stiff Arm | Breaking arm tackles on the edge | stiff arm |
| Tackle Breaking | Broken tackles of any kind | break tackle |

### Receiving (RB, WR, TE)

| Attribute | What it does | Source |
|---|---|---|
| Hands | Drops on catchable balls | catching |
| Contested Catches | Catches with a defender on him (with Height and Leaping) | catch in traffic |
| Highlight Catches | Catching a bad or off-target throw | spectacular catch |
| Short Routes | Separation on short routes (slants, outs, hitches) | short route running |
| Intermediate Routes | Separation at 10-20 yards | medium route running |
| Deep Routes | Separation on go, post and corner routes | deep route running |
| Release | Getting off press coverage at the line | release |

### Blocking (OL, TE, RB, FB)

| Attribute | What it does | Source |
|---|---|---|
| Drive Blocking | Moving a defender on inside and power runs | run block power |
| Reach Blocking | Sealing and getting to the second level on outside and zone runs | run block finesse |
| Pass Pro: Anchor | Holding up against power rushers and bull rushes | pass block power |
| Pass Pro: Footwork | Mirroring speed and finesse rushers | pass block finesse |
| Lead Blocking | Fullbacks, pullers and screens in space | lead block |
| Finishing Blocks | Pancakes and knockdowns (springs longer runs) | impact blocking |

### Defense

| Attribute | What it does | Source |
|---|---|---|
| Tackling | Wrapping up: missed tackles, yards after contact allowed | tackle |
| Hit Power | Forced fumbles, jarring incompletions; more missed tackles when it fails | hit power |
| Pursuit | Closing from the backside; limits long runs and yards after the catch | pursuit |
| Diagnosis | Reading run vs pass and play-action; first-step reaction | play recognition |
| Block Shedding | Getting off blocks against the run | block shedding |
| Power Rush | Bull rush and power moves against Anchor | power moves |
| Speed Rush | Edge and finesse moves against Footwork | finesse moves |
| Man Coverage | Staying with a receiver in man calls | man coverage |
| Zone Coverage | Breaking on throws in zone calls | zone coverage |
| Press | Disrupting releases at the line (against Release) | press |
| Ball Skills | Interceptions and pass breakups when in position | catching |

### Special teams

| Attribute | What it does | Source |
|---|---|---|
| Kick Power | Field goal range and kickoff distance | kick power |
| Kick Accuracy | Field goal and extra point make chance | kick accuracy |
| Punt Power | Punt distance | kick power (punters) |
| Punt Accuracy | Directional punting and pinning it inside the 20 | kick accuracy (punters) |
| Return Skill | Kick and punt return yards | kick return |

## What each position carries

| Position | Count | Attributes |
|---|---|---|
| QB | 20 | the 10 physical and mental; Arm Strength; Short, Intermediate and Deep Accuracy; Throwing on the Move; Pocket Poise; Play-Action; Sack Escape; Decision Making; Running Vision; Ball Security (plus Elusiveness for running QBs) |
| RB | 19 | the 10; Running Vision; Ball Security; Elusiveness; Power Running; Stiff Arm; Tackle Breaking; Hands; Short Routes; Pass Pro: Footwork; Return Skill |
| FB | 17 | as RB with Lead Blocking and Drive Blocking in place of the open-field skills |
| WR | 20 | the 10; Hands; Contested Catches; Highlight Catches; Short, Intermediate and Deep Routes; Release; Elusiveness; Tackle Breaking; Reach Blocking (stalk blocking); Return Skill |
| TE | 19 | the 10; Hands; Contested Catches; Short and Intermediate Routes; Release; Drive Blocking; Reach Blocking; Pass Pro: Anchor; Tackle Breaking |
| OL | 16 | the 10; Drive Blocking; Reach Blocking; Pass Pro: Anchor; Pass Pro: Footwork; Lead Blocking (pulling); Finishing Blocks |
| DL | 17 | the 10; Power Rush; Speed Rush; Block Shedding; Tackling; Hit Power; Pursuit; Diagnosis |
| LB | 19 | the 10; Tackling; Hit Power; Pursuit; Diagnosis; Block Shedding; Power Rush and Speed Rush (blitzing); Man Coverage; Zone Coverage; Ball Skills |
| CB | 19 | the 10; Man Coverage; Zone Coverage; Press; Ball Skills; Diagnosis; Tackling; Pursuit; Hit Power; Return Skill |
| S | 19 | the 10; Zone Coverage; Man Coverage; Diagnosis; Tackling; Hit Power; Pursuit; Ball Skills; Block Shedding; Return Skill |
| K | 4 | Kick Power, Kick Accuracy, Football IQ (pressure kicks), Stamina |
| P | 4 | Punt Power, Punt Accuracy, Football IQ, Stamina |

Every player keeps every attribute he has a source for, so a receiver moved to corner still
has Man Coverage. The card shows his position's set; "All ratings" shows everything.

## How the sim would use them (phases 2-5)

- **Passing.** Each throw gets a depth (short, intermediate, deep) from the call and the
  down and distance.
  - Completion reads the QB's accuracy at that depth, Arm Strength on deep and outside
    throws, and Pocket Poise when pressured.
  - On the other side, the target's route skill at that depth against the defender's Man
    or Zone Coverage (the defense's call picks which).
  - Contested Catches with Height and Leaping decide close coverage.
  - Hands decides drops; Ball Skills and Decision Making decide interceptions.
- **Release and press.** On press calls, Release against Press sets early separation
  (timing routes suffer when the receiver loses).
- **Running.** Inside runs read Drive Blocking, Strength and Weight against Block Shedding.
  Outside runs read Reach Blocking, Burst and Agility against Pursuit and Speed.
  - The carrier's Running Vision sets yards before contact.
  - Elusiveness, Tackle Breaking, Power Running and Stiff Arm set yards after contact,
    against the tackler's Tackling and Hit Power.
- **Pass rush.** Each rush is power or speed: Power Rush against Anchor, or Speed Rush
  against Footwork. Sack Escape and Pocket Poise answer it.
- **Turnovers.** Fumbles come from Ball Security against Hit Power. Interceptions come from
  Decision Making and the throw depth against Ball Skills.
- **Body.** Stamina sets fatigue, Durability sets injuries, and Football IQ sets penalties
  and busted assignments.

## Archetypes and traits (phase 6)

- **Archetypes.** EA's archetypes become play-style tags (Pocket Passer, Contact Seeker,
  Speed Rusher, Press Corner), renamed where needed.
- **Traits.** The unlocked abilities (Bronze to Platinum, about 1 in 9 of all ability
  slots) become traits with our own names and small situational effects. Examples:
  - a "pinpoint" thrower is more accurate on short throws when not pressured;
  - a "ball hawk" safety makes more plays on deep throws.

Recruits get archetypes and traits too.

## Rollout

1. **Data, cards and god mode; the sim unchanged.**
   - build_teams writes the new attributes.
   - The engine's current composites are computed from them (play-log fingerprint
     unchanged or near enough).
   - The player card groups the attributes as Physical, then the position skills, with
     plain-language names and a "what it does" hint on each.
   - God mode edits all of them, and the overall is recomputed per position from the new set.
2. **Passing:** throw depth, accuracy by depth, routes by depth, man and zone coverage, contested catches.
3. **Running and blocking:** inside and outside runs, vision, after contact.
4. **Pass rush and protection:** power and speed rushes.
5. **Turnovers, fatigue, injuries, penalties.**
6. **Archetypes and traits.**

Each phase from 2 on ends with the full checks against today's numbers:
- 20 seasons through week 8 (game picks, Brier score);
- full seasons against 2023-2025;
- `calibrate_season`;
- `calibrate.py league`.

A phase only lands if it does not cost game picks. That is the rule that left the
interception change out on October 20.

## Open questions

1. **Scale.** Keep today's house scale for the attributes (50 is an average Power 4
   starter, 80 elite), or an EA-like scale where starters sit around 70-90? The card
   overall is already EA-like.
2. **Rollout.** Phase by phase as above, or all at once?
3. **Traits.** Now (phase 6), or later with recruiting?
4. **The receiver tuning** on branch `receivers-and-repeatability` (target-share shrink 30,
   target power 3.5, pass lean 0.004). Phase 2 will rework targets anyway. Push the
   repeatability fix now and hold the receiver tuning, or push both?
