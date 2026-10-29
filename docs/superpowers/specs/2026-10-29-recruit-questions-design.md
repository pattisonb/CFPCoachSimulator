# Recruit questions: "Is he still your QB next year?"

Status: approved in conversation 2026-10-29 ("Yes, write the spec and plan"). Extends the scenes
(`coach_career/scenes.py`), the recruiting actions (`coach_career/recruiting.py`), the offseason's
existing promise rule (`coach_career/offseason.py`, `PROMISE_BROKEN`) and the board's scene view
(`web/recruiting.js`). Builds on the recruiting board redesign spec.

## 1. Why

A recruit who cares about playing time does not ask about playing time in the abstract. He asks
about the sophomore quarterback, or about the other kid at his position you offered last week.
The player wants to field those questions: to be straight, to promise, or to deflect, and to live
with what he said.

## 2. When a question comes

In a call or in-home visit scene for a recruit whose true priorities include `playing_time`, the
scene carries a `question` 60% of the time (`QUESTION_RATE = 0.6`, tunable), drawn from a seeded
RNG keyed `f"question-{seed}-{slug}-{pid}-{week}"` so no other draw moves (the golden test
stays). The kind depends on what is true on your roster, roster questions first:

- **Roster** (`kind: "roster"`): there is a returning player at his position group on your roster
  rated at least as high as him (the same test `_ahead` uses: `_returning(slug, group)`, class
  not in `LEAVING`). The question names the best-rated such player. New helper
  `ahead_of(state, slug, pid) -> dict | None` returns `{name, position, cls, ovr, slug}` for him,
  read from `season.load_teams()[slug]` (the career league's roster in the portal). Lines
  (his voice, `{ahead}` is the name, `{ahead_cls}` the class word, `{position}` his position):
  - "Is {ahead} still your {position} next year? I'm not coming to sit behind him."
  - "{ahead} is a {ahead_cls}. That's two more years of him. Where does that leave me?"
  - "My dad looked at your depth chart. He says {ahead} has that spot locked."
- **Recruit** (`kind: "recruit"`): no such player, but you have offered another recruit at his
  position group who is uncommitted or committed to you (`rc["offers"][slug]` joined with the
  prospects' groups; the highest-ranked other one). Lines (`{other}` is the name):
  - "You offered {other} too. Which one of us do you actually want?"
  - "I saw {other} post your offer. You telling him the same thing you're telling me?"
  - "If {other} commits first, is there still a spot for me?"
- Neither true: no question this scene.

The scene dict gains `"question": {"kind", "text", "about": {"id" | "pid", "name", "position",
"cls"}, "answer": null, "reply": null}` or `"question": null`. The question line comes after the
cue line in `lines` only as its own field: the page draws it as a quoted question with the reply
buttons; `lines` is unchanged.

## 3. Fielding it

A new action `answer` through `POST /api/season/{id}/recruit` with `{pid, action: "answer",
scene, answer}` where `answer` is `straight | promise | deflect`. Refused with 409 when the scene
is not open, has no question, or was answered already. No hours. The pitch (`action: "pitch"`)
is refused with 409 "answer him first" while a question is open and unanswered. His reply text
comes from `scenes.answer_reply(state, slug, pid, question, answer, truthful)`.

| Answer | Button copy (roster / recruit) | Effect | His reply |
|---|---|---|---|
| straight | "He's the starter today. You'd compete, and the best man plays." / "I offered him too. One of you starts; I want it to be you." | `+ANSWER_STRAIGHT` (1.0 base points on this scene's contact); reveals `playing_time` as a known priority if not yet | "Fair. At least you're not blowing smoke." |
| promise | "The job's yours." / "You're the one I want." | truthful when his projected role is `start` (`scenes._role == "start"`) for roster, or his `ovr` ≥ the other recruit's for recruit: `+ANSWER_PROMISE` (3.0); untruthful: `-ANSWER_HOLLOW` (2.0), an `asked_more`-style event `not_buying` and `cooled_until = week + 1` | truthful: "That's what I needed to hear, Coach." / untruthful: "I've heard that one before." |
| deflect | "Let's talk about what you'd bring." | nothing | "...Okay." |

Points go through the existing `_add_points(state, slug, pid, points, action)` on the scene's
action. The answer is stored on the scene (`question.answer`, `question.reply`) and on his contact
record: `contact["promises"]` gains `{"kind", "about", "week"}` on a promise (truthful or not).
The contact log (History) gets `kind: "answer"` with `answer`, `about` name, `truthful`.

## 4. Promises follow him

- **Recruit promise, during the season.** Each weekly firmness update (`_firm`), for a recruit
  committed to you with a `recruit` promise whose `about` recruit is now committed to you too
  (he was told he was the one, and the other kid signed up as well): firmness `-PROMISE_RIVAL`
  (20) once (the promise is marked `broken: week`), a recap event `promise_broken` with both
  names ("Hale remembers what you told him about Brooks"). For a recruit not committed to you,
  the same trigger sets `cooled_until = week + COOL_WEEKS` once. Hard commits are immune.
- **Roster promise, next year.** When a signed recruit with a `roster` promise joins the roster
  (`offseason._sign_classes`), his player record gets `promised = year` exactly as the retention
  step's "promise a starting role" does today. The existing `PROMISE_BROKEN` rule then triples
  his portal chance the following offseason if he did not start, with the existing reason text.
  Nothing new to invent; the recruit's promise and the retention promise are the same promise.

## 5. The page

In the scene (`sceneView`): after the lines, a quoted block with the question (`.go-question`,
`blockquote`), three reply buttons (`.go-answer[data-answer]`) with the copy of section 3; the
pitch picker and the Pitch button are disabled with the title "Answer him first" until he is
answered. After an answer, his reply appears under the question (`.go-question-reply`) and the
pitch unlocks. Hanging up keeps the question for when the call resumes. The History sub-tab row
reads `Week 6 · Call · Promised him the job over Marcus Hale` / `… · Told him straight about …`
/ `… · Deflected his question about …`, and `Week 9 · He remembers your promise about Jaylen
Brooks` for the broken one. The Office news carries the `promise_broken` event.

## 6. Tests

- `tests/test_recruit_questions.py` (native, through `app.api`): a seeded career where the first
  cold recruit with `playing_time` in his priorities gets a roster question naming the right
  player (the best-rated returning player at his group rated ≥ him); the recruit kind when no
  such player exists (force by choosing a recruit rated above everyone at a thin position, or by
  monkeypatching `_returning`); `answer` refusals (no scene, no question, already answered, pitch
  before answer); each answer's points and events; the untruthful promise's cooling; the recruit
  promise's firmness drop and recap event when the other recruit commits; `_sign_classes` setting
  `promised` for a roster promise.
- `tests/test_sim_golden.py` unchanged.
- The sweep: a call with a question shows the quoted question and three buttons, the Pitch button
  is disabled until an answer, the reply appears, the pitch goes out, the History row reads as
  section 5 says.
- `tools/check_recruiting.py` gains a line on question frequency and answer mix over a season
  (how often questions come, how often promises are hollow).

## 7. Out of scope

Questions on other priorities (NIL, proximity); AI schools answering questions; promises made in
messages; changing the retention step.
