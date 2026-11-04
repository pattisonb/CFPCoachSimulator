# Recruit Variety: Every Recruitment Feels Different

Status: approved in conversation (Sections 1–3), 2026-11-03. Builds in three pull requests, each held for the player's preview.

## Why

Every recruit today draws his words from the same three lines per priority (`coach_career/scenes.py` LINES) and plays by the same rules: only his name, town and three priorities (`recruiting._priorities`) differ. Two NIL recruits read and play alike. The player wants each recruitment to feel like its own story, with real strategy: reading a recruit right should win him.

## Decisions (the player's)

- All four levers: **Personality**, **Who Decides**, **His Story**, **Twists and Commit Style**.
- **Earned discovery**: every trait starts "Not Known Yet" and is revealed by scouting and talking.
- **Real strategy**: traits change outcomes, not just words.
- **Budgets**: recruiting hours about **150 a week** (140–160 by recruiting rating); a separate **scouting budget in points**, 40–60 a week by the best evaluator.
- AI schools play by the same rules.

## Approach

Each prospect gets a **profile**, drawn once at class creation from its own seeded stream (`random.Random(f"persona-{seed}-{pid}")`), stored on the prospect: `persona = {"personality", "decider", "decider_topic", "story", "story_data", "commit_style"}`. Each trait is a named row in a module-level table in a new module `coach_career/persona.py`: the modifiers it applies at existing hook points in `recruiting.py`, and its scene lines (`scenes.py` reads them). Twists are a weekly roll per prospect (`_rng(state, "twists")`), from a table, appended after existing draws. Rules are data, so new traits are rows, not code paths.

Rejected: authored storylines per recruit (richer once, repetitive by season two, much more writing).

The season sim digest (`tests/test_sim_golden.py`) is untouched: recruiting is not in it. `tools/check_recruiting.py` gains rows for the new rules and is the realism gate: commit timing by week, class sizes, blue-chip spread by tier, flips and decommits stay within today's bands.

## Section 1: Budgets, Personality, Who Decides, Discovery

### Budgets

| Budget | Rule | Constant (*tune*) |
|---|---|---|
| Recruiting hours | `140 + (recruiting rating − 50) / 2.5`, in fives, 140–160 | `WEEKLY_HOURS_BASE = 140`, `WEEKLY_HOURS_PER = 0.4` |
| Scouting points | `40 + (best evaluator − 50) × 0.4`, in fives, 40–60 | `SCOUT_POINTS_BASE = 40`, `SCOUT_POINTS_PER = 0.4` |
| A look | 10 points in an area a staff scout covers, 15 elsewhere, 5 for a portal transfer | `LOOK_COST = {"area": 10, "away": 15, "portal": 5}` |

- Action hour costs are unchanged (message 5, call 15, in-home visit 30, official visit 10). `scout` leaves `HOURS` and spends scouting points.
- Unused hours and points do not carry over.
- Area scouts' weekly half-looks (`scout_week`) are unchanged and free.
- AI schools get the hours rule. They do not take looks (their boards read the truth through `_board`'s noise), so scouting points are the player's; AI boards stay as built.
- Retune `BASE_POINTS`, `DIMINISH`, `PESTER_FREE` and the AI contact plan so interest per week, commit timing and class sizes match today's bands with nearly three times the contact.
- UI: the board shows Hours Left as now; the Scouting Center shows "Points Left: 35 of 50" and each Send shows its cost.

### Personality (20% each)

| Personality | Rules |
|---|---|
| **Cocky** | Playing Time and Prestige pitches ×1.3. An offer under 70% of his ask is a lowball (not 50%). A hollow promise costs double. |
| **Shy** | Your first call reveals nothing and earns half. In-home visits ×1.5. |
| **Guarded** | A call never reveals a priority; an in-home visit does. Once committed, decommit chance ×0.5. |
| **Loves the Attention** | Pestering starts after 5 contacts, not 3. Two weeks without your contact cools him (as a lowball's cooling, one week). |
| **All Business** | Messages ×0.3. Offer and NIL value ×1.3. His scenes skip the small talk. |

### Who Decides

| Decider | Share | Their Topic |
|---|---|---|
| Himself | 30% | none |
| Mom | 20% | Proximity or Academics |
| Dad | 15% | NIL or Playing Time |
| Grandmother | 10% | Proximity or Coach |
| High School Coach | 15% | Coach, Playing Time or Winning |
| Trainer | 10% | NIL only |

- Pitching the decider's topic counts as one of his priorities (`PITCH_PRIORITY`) even if it is not.
- At an in-home visit the decider speaks one line, and a pitch on their topic earns ×1.2.
- The Trainer: an offer under his ask cools the recruit as a lowball would at 80%; NIL over the ask counts at full value up to 1.2× the ask (not `NIL_OVER`).

### Discovery

| Trait | Revealed By |
|---|---|
| His Story, Who Decides | Scouting: the decider at 2 looks, the story at a complete report (3). Public stories show at once. |
| Personality | Your first call (Guarded: your first in-home visit). |
| Commit Style | An official visit, or four weeks holding your offer. |

- Shown on his profile and the pane's tags as "Not Known Yet" until revealed; your staff's read can be wrong with low looks (the same slack as ratings reads), firming as looks grow.
- Kept per viewer in `rc["revealed"][pid]` beside today's revealed priorities.

## Section 2: His Story

About 35% of the class has one (50% of four- and five-stars), at most one each.

| Story | Share | Rule | Shown |
|---|---|---|---|
| **Legacy** | 15% | `story_data.school` (weighted to programs by prestige) starts with a head start (`LEGACY_HEAD = 8` interest). Coach and Prestige pitches from others ×1.2 against it. If you are the legacy school, a lowball or hollow promise costs double. | Scouting |
| **Hometown Hero** | 20% | Schools in his state get `HERO_STATE = 1.4` on his pull; out-of-state pitches ×0.8 except Playing Time and NIL. His commitment makes the news. | Public |
| **Package Deal** | 15% | Paired with a lower-rated prospect from his town or state (`story_data.mate`). He commits only where his mate holds an offer; they commit together (both, same week). | Scouting, or his first call |
| **Two-Sport** | 15% | On signing day he goes pro in baseball with chance `DRAFT_RISK = 0.30`, lowered by Playing Time pitches and NIL over his ask (to a floor of 0.05). Shown as "Draft Risk: High / Some / Low". | Scouting |
| **Injury Comeback** | 15% | His shown ratings and stars understate him by a band. AI offers ×0.6. Schools that contacted him before Week 6 keep a loyalty bonus (`LOYALTY = 1.25` on their contacts). Potential reads are less certain. | Public |
| **Late Bloomer** | 20% | Starts at 2–3 stars, unranked; jumps one or two stars between Weeks 5 and 9. AI boards add him after the jump. | The jump is public; "bloomer" is found by scouting |

AI schools follow the same rules (a legacy school recruits its legacy hard; state schools push for a hero). Each story has its own scene lines; the decider brings it up at visits.

## Section 3: Twists and Commit Style

### Twists

A weekly roll per uncommitted prospect on any board, about one per recruit per season (more for blue-chips: `TWIST_RATE` by stars). Shown in the weekly report, on his profile and in the news.

| Twist | Effect |
|---|---|
| **Surprise Visit** | A school outside his top three jumps into it for two weeks. Your next contact knocks it back. |
| **At Your Game** | A home game within 400 miles: a win ×1.3 on his interest in you (a blowout ×1.5), a loss cools him a week. Works for any school. |
| **Hot Seat** | His leader's head coach has AD security under `HOT_SEAT = 30` (`carousel`): Coach pitches against that school ×2 for three weeks. A firing at the review lets that school's commits reopen. |
| **Late Offer** | A blue blood that had not offered offers; it enters his list near the top and his ask rises 10%. |
| **Family Move** | His home moves to another state: proximity and a hero's state move with it. |
| **Grades Scare** | Academic schools (`ACADEMIC`) drop him from their boards; an Academics pitch from anyone else ×2 for three weeks. |
| **Wants to See You Beat X** | Names one of the school's next three opponents: a win is a big boost, a loss a drop. Only for the school he told. |

### Commit Style (20% each)

| Style | Rule |
|---|---|
| **Early Bird** | Commit odds ×3 in Weeks 4–8; starts at `HARD_AT − 15` firmness. |
| **Signing Day** | Never commits before the final week; then signs with his leader. |
| **Hat Ceremony** | Two weeks out he names a date and three finalists; only they can win. |
| **Quiet Commit** | Commits without the news; others see "Quiet" and his interest in them stops climbing. |
| **Needs Attention** | Firmness drops each week without your contact, even committed; three weeks of silence makes a flip possible. |

## Build Order

1. **PR 1: Budgets, Personality, Who Decides, Discovery.** `persona.py` (profile draw, tables), hooks in `recruiting.py`, scene lines in `scenes.py`, API fields (`revealed` traits), pane and profile tags, Scouting Center points, retune with `tools/check_recruiting.py`.
2. **PR 2: His Story.** Story draw and rules, Package Deal commits, Two-Sport signing-day roll, Late Bloomer jump, the stories' lines and tags.
3. **PR 3: Twists and Commit Style.** The weekly twist roll and its effects, commit styles in `weekly_step` and `_commit`, the weekly report and news lines.

Each PR: `hold` label, Vercel preview link to the player, merge on "merge N".

## Testing

- `tests/test_persona.py`: the draw is deterministic per seed and pid and matches the shares over a class; each personality and decider rule changes points as specified (unit, against `_act`); discovery reveals in the stated order.
- Story, twist and commit-style rules each get a unit test against the engine (PR 2, PR 3).
- `tools/check_recruiting.py` bands hold over 20 seeded seasons; `python3 tests/test_sim_golden.py` byte-identical.
- UI: `tests/test_ux_sweep.py`, `tests/test_spacing.py`, `tests/test_smoothness.py` pass; the profile shows "Not Known Yet" then the revealed trait; no "null" or numbers out of 100 reach the page; Title Case on every tag.
