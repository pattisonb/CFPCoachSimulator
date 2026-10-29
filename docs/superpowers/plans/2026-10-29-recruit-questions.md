# Recruit Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On playing-time calls and visits a recruit asks about a named player (the one ahead of him on your roster, or another recruit you offered at his position); you answer Straight, Promise or Deflect; promises are remembered.

**Architecture:** Task 1 is the engine (scenes get a `question`; a new `answer` action; points, reveals, cooling and the recruit-promise firmness rule in `recruiting.py`; the roster promise handed to the existing `promised` rule in `offseason._sign_classes`), with a native test. Task 2 is the page (the question block in the scene, History wording) and the sweep. The API shape is fixed below so the two run in parallel in separate worktrees; Task 3 integrates and pushes.

**Tech Stack:** Python stdlib, vanilla JS, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-recruit-questions-design.md`

## Global Constraints

- `python tests/test_sim_golden.py` passes at every commit: the question's RNG is its own `random.Random(f"question-{rc['seed']}-{slug}-{pid}-{week}")`; no existing draw moves; `_event` only appends.
- Constants, exact: `QUESTION_RATE = 0.6`, `ANSWER_STRAIGHT = 1.0`, `ANSWER_PROMISE = 3.0`, `ANSWER_HOLLOW = 2.0`, `PROMISE_RIVAL = 20`, hollow-promise cooling `week + 1`; the recruit-promise cooling for an uncommitted recruit `COOL_WEEKS`.
- Copy exactly as the spec's section 2 (question lines) and section 3 (button copy, replies).
- API: `POST /api/season/{id}/recruit` with `{pid, action: "answer", scene, answer}`; 409 messages: "no call or visit open", "he asked nothing", "you already answered", and for a pitch while unanswered "answer him first". The scene dict carries `question` as the spec's section 2 defines (or `null`); after an answer, `question.answer` and `question.reply` are set and the response returns the updated scene plus `{"points": float, "truthful": bool | null, "revealed": [...]}`.
- Contact log: `kind: "answer"` with `answer`, `about` (name), `truthful`; `kind: "promise_broken"` with `about`.
- Commits carry the session's two attribution trailer lines; no model identifiers.

## Review Focus

1. **A recruit with no playing-time priority never gets a question**; one with it but neither a player ahead nor another offered recruit gets none. Task 1 test.
2. **Hanging up and resuming** keeps the question and its answered state; the pitch stays locked until answered. Task 1 test (resume via a second `call` returns the same scene) and Task 2 sweep.
3. **The week advancing with an open question** drops the scene as any stale scene; no dangling promise is recorded. Task 1 test.
4. **A truthful promise then the recruit's commit, and the other recruit never commits**: no firmness drop ever. Task 1 test.
5. **Portal recruits** (`is_portal`): roster questions read the career league's roster; recruit questions use portal offers; copy says "next year" still reads fine. Task 1 test runs one portal case.

---

### Task 1: Engine (worktree `rq-engine`)

**Files:**
- Modify: `coach_career/scenes.py` (`open_scene` ~184: add `question`; new `QUESTION_LINES`, `ANSWER_COPY`, `REPLY_LINES`, `answer_reply(...)`), `coach_career/recruiting.py` (`_act` ~1070-1215: the `answer` action and the pitch lock; `ahead_of(state, slug, pid)` near `_ahead` ~422; `_firm` ~1545: the recruit-promise rule; constants near `COOL_WEEKS` ~94), `coach_career/offseason.py` (`_sign_classes` ~855: `promised = year` for a roster promise held by the signed recruit), `tools/check_recruiting.py` (one line: questions per scene, answer mix, hollow share)
- Create: `tests/test_recruit_questions.py`

**Interfaces:**
- Produces: `scenes.open_scene(...)["question"]`; `recruiting.ahead_of(state, slug, pid) -> dict | None` (`{name, position, cls, ovr, slug}`); `recruiting.other_offered(state, slug, pid) -> dict | None` (`{pid, name, position, rank}`); the `answer` action response; `contact["promises"]` entries `{"kind", "about": {...}, "week", "broken": week | None}`; events `answer`, `promise_broken`.
- Consumes: `_role`, `_returning`, `LEAVING`, `_add_points`, `_event`, `rc["revealed"]`, `cooled_until`, `_firm`, `offseason._sign_classes`'s `p["promised"]`.

- [ ] **Step 1: Tests first** (`tests/test_recruit_questions.py`, plain script printing `ok`): seeded SMU career; find a cold recruit with `playing_time` in `rc["prospects"][pid]["priorities"]` and a returning player rated ≥ him (assert `ahead_of` names the best-rated such player); call him with `QUESTION_RATE` forced to 1.0 and assert the scene's question is `roster` naming him; pitch before answer → 409 "answer him first"; `answer` straight → points `ANSWER_STRAIGHT` on the contact, `playing_time` in revealed, reply text from the table; answer again → 409 "you already answered"; a second recruit (or the same scene re-opened under another forced rate) with `deflect` → no points; a `promise` where `_role` is `wait` → `-ANSWER_HOLLOW`, `cooled_until == week + 1`, a `not_buying` event; a `promise` where `_role == "start"` (force with `recruiting.forced_strength(... "playing_time", 1.0)`) → `+ANSWER_PROMISE`, a promise on the contact; recruit kind: monkeypatch `_returning` to return `()` and offer another recruit at his group → question `recruit` naming the higher-ranked one; a recruit promise then the other recruit committing to you (`_commit`) → after `_firm`, firmness `-PROMISE_RIVAL`, `promise_broken` logged, and not twice; a roster promise then `finished` + `offseason.start` → the signed player's record has `promised == year`; no question for a recruit without the priority; no question with neither source; one portal case (`is_portal`) where the roster question reads the career league.
- [ ] **Step 2: Run to fail**: `python3 tests/test_recruit_questions.py` → AttributeError on `ahead_of`.
- [ ] **Step 3: Implement**; `python3 tests/test_recruit_questions.py`, `python3 tests/test_recruiting.py`, `python3 tests/test_recruiting_api.py`, `python3 tests/test_scouting.py`, `python3 tests/test_offseason.py`, `python3 tests/test_sim_golden.py`, `python3 tools/check_recruiting.py` (prints the new line).
- [ ] **Step 4: Commit** on `rq-engine`.

### Task 2: The page (worktree `rq-page`)

**Files:**
- Modify: `web/recruiting.js` (`sceneView` ~1000-1070: the question block; `act()`/`run()`: the `answer` action; History row wording for `answer` and `promise_broken`), `web/recruiting.css` (`.go-question`, `.go-answer`, `.go-question-reply`), `tests/test_ux_sweep.py`
- Consumes the API shape in Global Constraints; until Task 1 lands the sweep's question assertions are written against a scene the test seeds with a `question` by stubbing: use `page.route` to inject `question` into the `/recruit` call/visit response, and `page.route` the `answer` POST to return the reply, so the page work is testable before the merge; the route stubs are removed at integration (Task 3) and the real engine drives them.

- [ ] **Step 1: Sweep assertions first**: a call whose scene has a question shows `.go-question` with the text, three `.go-answer` buttons with the spec's copy, `button:has-text('Pitch')` disabled with title "Answer him first", the `.go-pitch` radios disabled; clicking `.go-answer[data-answer=straight]` posts `{action: "answer", answer: "straight", scene}` and shows `.go-question-reply`; the pitch unlocks; Hang up then Finish shows the answered question (no buttons); History shows `Told him straight about <name>`.
- [ ] **Step 2: Implement**; `python3 tests/test_ux_sweep.py`, `python3 tests/test_web_urls.py`, `python3 tests/test_spacing.py` (the new buttons obey the gap rules).
- [ ] **Step 3: Commit** on `rq-page`.

### Task 3: Integrate (main)

- [ ] Merge both; remove the sweep's route stubs so the real engine drives the question (force `QUESTION_RATE` through a test-only env var `CFP_QUESTION_RATE` read by `scenes.py` at import, default 0.6, which the dev server inherits; the sweep sets it to 1.0 when launching the server); run `python3 tests/test_recruit_questions.py`, `python3 tests/test_ux_sweep.py`, `python3 tests/test_recruiting_api.py`, `python3 tests/test_sim_golden.py`, then `python3 tests/run_all.py`; `docs/HOW_IT_WORKS.md` gets a paragraph; commit; push.
