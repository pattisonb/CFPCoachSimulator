# Player development, potential and scouting (spec)

Status: agreed design, October 22, 2026. Built so far: generated classes and development
and the real players' potential and coachability (`recruits.py`, docs/HOW_IT_WORKS.md "Generated
recruiting classes"); not yet staff reads, potential that moves, or god mode. Numbers marked *tune* are
starting values, to be set so the league's growth matches the real class-year gains below.

Every player, real or generated, gets a current value and a potential value for each attribute,
and a coachability level instead of EA's development trait. You never see potential as a number
(god mode aside). Your staff reads it, and how well they read it depends on who they are and how
long the player has been in your program.

## 1. Potential per attribute

Each attribute has a hidden potential: the most it can reach in college. Room to grow is
potential minus current. How much room an attribute can have depends on what kind of attribute it
is, measured on the real 2026 rosters (EA scale, true freshmen against fifth-year players; mean
gain, cross-sectional, so a little optimistic: the players who did not develop often left):

| Group | Attributes | Typical gain over a career |
|---|---|---|
| Physical gifts | speed, acceleration, agility, jumping, throw power | about 0 (OL speed drops about 5) |
| Strength and body | strength, hit power, trucking, stamina | +2 to +6 |
| Technique | route running, release, catching, blocking, coverage, moves, accuracy, tackling | +3 to +14 |
| Football IQ | awareness, play recognition, BC vision, throw under pressure | +13 to +17 |

A player's room in each attribute = the group's typical room for his years left x his potential
level (from his stars or, for real players, his evaluation below) x random spread *tune*. So a
fast, raw receiver has little room in speed and a lot in route running and awareness; a slow,
smart lineman the reverse.

Potential is a starting point, not fixed. It moves with what happens:
- **Up:** a breakout season (well above his expected line), awards and all-conference honors, a
  big jump in an offseason.
- **Down:** a serious injury (physical attributes), a lost year, off-field trouble.

## 2. Coachability (replaces EA's development trait)

Coachability is how fast a player closes the gap to his potential. Each offseason every attribute
gains `rate x coach factor x (potential - current) x random (0.8 to 1.2)`.

| Level | Meaning | Gap closed per offseason *tune* | Share of players *tune* |
|---|---|---|---|
| Coach's Dream | Absorbs everything, a coach on the field | ~55% | 2% |
| Film Junkie | Lives in the film room, improves fast | ~45% | 8% |
| Quick Study | Picks things up well | ~35% | 20% |
| Steady Grinder | Normal development, gets there with reps | ~27% | 40% |
| Slow to Click | Slow to put teaching into practice | ~18% | 20% |
| Set in His Ways | Hard to coach, may never reach his ceiling | ~10% | 10% |

- **Coach factor:** the head coach's player development rating, with the position side's
  coordinator: about 0.8 at 30, 1.0 at 50, 1.2 at 90 *tune*.
- **It can change:** a breakout year, awards or a new position coach can move a player up a level;
  off-field trouble or a lost year down.
- **Recruits:** not tied to stars (some two-stars are Coach's Dreams). Hidden until scouted.

## 3. What you know: staff reads that only get sharper

The truth (potential, coachability) sits behind the scenes. What you see is your staff's read.

**Hover notes.** Each attribute shows a note for its room to grow, never a number:
Maxed out (under 2) / A little room (2-6) / Some room to grow (6-12) / A lot of room (12-20) /
Sky's the limit (20+) *tune*. Coachability shows as the level your staff believes.

**Looks.** Every season a player spends in your program is a look; every scouting visit to a
recruit is a look. A look's sharpness comes from the evaluators:
- Offensive players: head coach and OC. Defensive players: head coach and DC.
- Combined so either strong evaluator is enough: `skill = 1 - (1 - HC/99) x (1 - coordinator/99)`.
  Your own coach's player development rating is the head coach's part, so a maxed-out head coach
  reads players nearly right by himself.
- A look's error shrinks with skill (for example 12 points of room at skill 0, 2 at skill 1) *tune*.

**Looks add up and never reset.** The read is the combination of every look so far (each weighted
by its sharpness). A worse staff adds a little, a better one a lot, and nothing is lost: replace a
great DC with a weak one and your read on returning defenders stays where it was and still
improves next season. Each read is fixed for the season (hovering again does not re-roll it) and
updates each offseason, after scouting visits, or when a new look comes in.

Example, a sophomore with +18 still to come:

| | Weak staff (HC 55, DC 50) | Maxed-out HC (99), weak DC |
|---|---|---|
| After the recruiting visits | Some room to grow (one level off) | A lot of room |
| After year 1 | A lot of room | A lot of room, certain |
| After year 2, even with a worse DC | A lot of room, certain | certain |

Scouting a recruit shows letter grades (designed later); what was learned carries over when he signs.

## 4. Generated recruits

From `data/recruiting_model.json` (real classes, distributions only):
- **Who he is:** star band and composite rating, position, height and weight, hometown (state by
  star band, then a real town), all drawn from the real distributions.
- **Current ratings, athleticism first:** a recruit's athleticism is what he will have for his
  whole career, so it is drawn first, not scaled down from his overall. Real first- and second-
  year players by recruiting stars (EA scale): WR speed 92.4 / 90.0 / 87.7 / 87.5 (5* to 2*),
  WR jumping 93.2 / 89.6 / 84.9 / 84.1, CB agility 92.9 / 90.2 / 86.7 / 85.0; technique rises
  with stars too (CB man coverage 84.0 / 76.9 / 70.9 / 68.4); football IQ does not (CB play
  recognition 76.6 / 70.0 / 63.2 / 67.7). In order:
  1. **Athleticism** (speed, acceleration, agility, jumping, throw power): drawn for his position,
     tied to his stars, at or near its final value.
  2. **Size and strength:** drawn for his position, with the modest room in section 1.
  3. **Technique:** below its ceiling by the room in section 1, set so his true freshman overall
     lands on the real one for his stars and place in the band (game scale: 5* about 65, 4* 53,
     3* 43, 2* 39), with spread.
  4. **Football IQ:** drawn independently of stars, with the most room.
  The profile within each group follows real players at his position and archetype. This makes
  the real archetypes on its own: the sleeper (a three-star with elite speed and raw technique,
  a star if he is coachable), the polished bust (a five-star rated on high school technique,
  ordinary athleticism, little room) and the athletic bust (a freak athlete who is Set in His Ways).
- **Potential and coachability:** potential level correlates with stars but is noisy, tuned so
  outcomes match real life by star (about 62% of five-stars and 5.5% of three-stars drafted; 1 in
  4 five-stars and 1 in 56 three-stars All-Americans), so most stars still come from the three-
  star pool. Coachability is drawn from the shares above, independent of stars.
- **Real roster check** (8,674 players matched to their recruiting record), game overall by year:
  5* 65 / 71 / 75 / 73, 4* 53 / 57 / 64 / 66, 3* 43 / 48 / 54 / 61, 2* 39 / 45 / 48 / 54
  (freshman to senior). A generated class, developed over four seasons, should land close to this.

## 5. Real players (2026 rosters)

- **Coachability from EA's dev trait**, ranked within each trait by how far ahead of the norm
  for his stars and class year the player already is, so the league matches the shares above:
  Elite and the top sixth of Star -> Coach's Dream; the rest of Star and the top tenth of Impact ->
  Film Junkie; most of Impact -> Quick Study (the rest Steady Grinder); Normal -> Steady Grinder,
  Slow to Click and Set in His Ways.
- **Potential** from his years left, his recruiting stars (74% of players have a record) and how
  far ahead of his class norm he is (a 3-star sophomore already at 60, against a norm of 48,
  points to a high ceiling). Players with no record use dev trait and class year alone.

## 6. God mode and settings

- God mode shows and edits everything: name, position, class year, jersey, height, weight, every
  attribute and its potential, and coachability.
- Showing exact potential numbers becomes a setting later. The default is the staff reads above.

## Later

- Playing against a player is a look too: when an opponent shows up in the transfer portal, the
  games you played against him (and how much he played) sharpen your read on him.
- Letter-grade scouting, recruiting actions (scouting, pitching, offers) and in-season commitments
  get their own spec.
