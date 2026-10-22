# Coach Career: play the season as the coach, with recruiting (design)

Status: agreed in conversation October 22, 2026; awaiting review of this written spec.
Builds on docs/PLAYER_DEVELOPMENT.md (potential, coachability, staff reads) and recruits.py
(generated classes). Values marked *tune* are starting points, set by the realism check (section 8).

## 1. What and why

"Sim a season" becomes **Coach Career**: a game played as the head coach rather than a simulation
to watch. Each week you recruit, then play or sim your game, then advance. The rest of the league
(polls, playoff, bowls, awards, stats) runs around you as it does today. Success: every week has
real decisions, mainly recruiting; they visibly shape your roster; the league recruits realistically.

Scope of this spec: the career shell and in-season recruiting through national signing day.
Separate projects, later: the offseason (graduation, signees joining, development, the transfer
portal), the coaching carousel, recruiting juniors, composing your own messages to prospects,
evaluator blind spots, player retention with NIL points.

Decisions already made:
- Each week: recruiting plus your game. Depth charts and game plans stay automatic unless you open them.
- Saves live in your browser and are restored to the server when it has forgotten them.
- You stay at the school you pick (no firing, no job offers).
- High school seniors only (the class of next year). The transfer portal is offseason only.
- NIL is a yearly point budget, not money.
- Built by growing season mode (season.py, web/season.*) into Coach Career, with the new logic in
  its own modules: `recruiting.py` (the recruiting game) and `career.py` (career state and saves).

## 2. Calendar and weekly loop

**Start:** pick a school and a coach (your coach from the Your coach page, or the real head coach).
Week 0 (preseason): assign staff to areas, see the class (about 4,000 generated seniors,
recruits.generate_class), build your board. **No prospect is committed at the start.**

**Each week:** (1) recruiting: spend the week's hours and NIL points; staff scouting runs on its
own; Auto-recruit can spend for you. (2) your game: Game Day or sim. Prospects on an official visit
watch your home game: a win and a big crowd help, a blowout loss hurts. (3) advance: the league
plays, AI schools recruit, interest updates, commitments, decommitments and flips happen, and a
recruiting recap opens the next week.

| When | Recruiting |
|---|---|
| Weeks 0-14 | The main window; commitments build through the fall |
| Championship and selection weeks | Early signing period (December): committed prospects sign; 80-90% of a class *tune* |
| Playoff and bowl weeks | Final push for the uncommitted; late flips possible |
| After the title game | National signing day: the rest sign; the offseason project takes over |

Simming ahead (Advance several weeks, Sim to selection, Sim to the end) still works: Auto-recruit
acts for you in each skipped week, so a hands-off career lands a sensible class.

## 3. What a prospect wants and how he commits

- **His list:** about 10 schools at a time, each with an interest score. Schools join by offering
  or recruiting him hard.
- **Fixed pulls of each school:** distance from his home (the real distance curve,
  recruiting_model.json), program prestige (the school's real class-strength baseline), on-field
  standing, the coach's measured recruiting edge, NIL strength, and playing time (players ahead of
  him at his position on that roster).
- **On-field standing** blends last season and this one, shifting through the year: last season is
  most of it at week 0, this season dominates by mid-October, last season barely counts by December.
  The national ranking adds a bump (top 10 most).
- **What schools do:** contacts, pitches, visits and NIL, with diminishing returns.
- **His priorities:** each prospect weights the pulls differently (proximity, playing time,
  prestige, winning now, NIL, the coach, academics). Calls and scouting reveal his top three.
- **Committing:** each week his leader may land him, likelier with a bigger lead, later in the
  calendar and after an official visit; timing tuned so the class fills over the fall.
- **Committed is not signed:** a rival recruiting him hard, a losing streak or a crowded depth chart
  can bring a decommitment or a flip; about 15% of top prospects decommit at some point *tune*.
- **Class limits:** open roster spots under the 105-player limit after seniors leave (about 22-25).
  Offers are capped at about 1.5 times your open spots *tune*.
- **FCS:** not simulated as recruiters. A prospect without real FBS options shows "Leaning FCS"
  (still recruitable) and at signing "Signed with an FCS program"; about a third of rated prospects *tune*.

## 4. Your hours and NIL points

Hours: about 50 a week, plus 1 per 4 points of your coach's recruiting rating above 50 *tune*.

| Action | Hours | Effect |
|---|---|---|
| Message | 5 | Small interest gain |
| Phone call | 15 | Medium gain; reveals one of his priorities |
| Head coach in-home visit | 30 | Big gain; once a month per prospect |
| Offer | 0 | Needed to commit; capped (section 3) |
| Official visit invite | 10 | Big gain at one of your home games; one per school per prospect |

- **Pitches:** every contact carries a topic (close to home, playing time, prestige, winning now,
  NIL, the coach, academics). Matching one of his priorities is worth about double; a mismatch little *tune*.
- **NIL points:** a yearly budget sized from the program's real level. A package attached to an
  offer raises his interest; the points are held until he commits elsewhere or you pull it, and
  spent when he signs. Top prospects expect more; AI schools bid too. Staff costs come out of the
  same budget in the offseason project.
- **Auto-recruit:** spends hours and points by rules (offered prospects first, pitch known
  priorities, invite top targets to home games); on for one week or the season.

## 5. AI schools

Every other FBS school runs the Auto-recruit rules for itself each week:
- its board from its real footprint (states and shares, in-state share, reach), its usual star level
  (a Group of 5 school passes on five-stars unless he is local and it is hot), and its open roster
  spots by position;
- hours from its coach's recruiting rating, NIL points from its program level, and its coach's
  measured recruiting edge (recruiting_model.json).

The real head coaches' recruiting ratings are generated and do not match how they recruit
(correlation -0.02 with the measured edge across 78 coaches). Before recruiting lands they are
rebuilt from the measured edge, shrunk toward average for coaches with few classes; your created
coach keeps the rating you gave him.

## 6. Staff, scouting and the Prospect Profile

- **Staff:** your OC, DC and 2-3 fictional recruiters (named, with evaluation and recruiting
  ratings), each assigned one of about 9 areas built from states. Reassign at the start of any week.
- **Scouting:** each week every prospect in a covered area gets a look; looks add up and never reset
  (PLAYER_DEVELOPMENT.md section 3). Uncovered areas show public information only. About 15% of
  two-stars and low three-stars are hidden until their area is covered *tune*.
- **Grades:** letter grades (A+ to F) for athleticism, size and strength, technique, football IQ,
  potential and coachability, shown as a range (B- to A-) that narrows with looks.
- **Scouts can be wrong:** each look has error and the read combines them, so the read itself can be
  off. An average evaluator's range holds the truth about 80% of the time, an elite one's about 90%;
  a weak evaluator is sometimes confidently wrong *tune*. The truth shows once he is on your roster.
- **Prospect Profile:** name, avatar (the coach sprite system), hometown and high school, size,
  position and archetype; stars, composite, national, position and state ranks; his list with the
  leader, offers, visits and status (committed, signed, leaning FCS). The top 300 also get a written
  evaluation (strengths, weaknesses, outlook). Public numbers are labeled the national rankings; they
  are a public read with its own error, so they can be wrong. Your staff's grades sit beside them.
- **Comps:** only to starters (the real 2026 starters and watch-list players; in later seasons,
  starters from earlier seasons of the career, generated players included), and only when the match
  is genuinely close. The public comp is considered for the top 300 only. "Our comp" appears once
  your staff have scouted him enough, from your staff's read.
- **Signing:** your staff's knowledge carries into his player card (the room-to-grow notes start from it).

## 7. Saves and screens

- **Saves:** after every week the page keeps a compressed copy of the career in the browser
  (IndexedDB). When the server has forgotten it, the page uploads it and play continues.
  Download career / Load career move it as a file. Past seasons are trimmed to summaries (results,
  polls, awards, signed classes, records).
- **Screens:** the nav reads Coach Career instead of Sim a season. The career page keeps today's tabs
  and adds Recruiting (board, hours and points, actions, Auto-recruit, the weekly recap), Prospects
  (the class with search and filters, opening each Prospect Profile) and Staff (areas and ratings).
  The week banner shows recruiting, then your game, then advance.

## 8. Testing

- Unit tests (seeded, deterministic) for interest, commitments, hours, points and scouting reads.
- **Realism check, as a test with tolerances:** whole seasons with every school on Auto-recruit,
  against the real 2017-2026 classes (CFBD): class size by tier (Power 4 about 22, Group of 5 about
  19); star mix, blue-chip share and class-strength order by school (about 18 schools at 50%+
  blue-chips); in-state share (about 36%) and distance (median about 280 miles), by stars too; each
  school's top states; commitment timing; decommitment rate; a cap on five-stars per school.
- Save round trip: download, wipe the server's copy, upload, continue.
- An end-to-end browser run through a career season.
- Existing tests and the engine fingerprint stay as they are: recruiting does not change how games play.
