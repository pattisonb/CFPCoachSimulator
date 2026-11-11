# Promise Him the Job — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On any call or visit, in recruiting or the portal, you can promise a recruit the starting job, whether or not he asks. It helps land him and is a real promise, judged all season once he signs. When two promises cover one position, both are judged on who actually starts. The second promise may not be believed, and it strains the first.

**Architecture:**
- A new action, `promise_job`, works on an open scene and reuses the roster-promise path. `_answer`'s promise branch already records a `"roster"` promise on his contact, and signing already marks `promised`.
- New code in `recruiting.py` decides how many points it earns: Keeps His Word's `promise_mult`, his Playing Time priority, and the crowd at his position.
- It also strains the promises already made at that position.
- The scene shows a "Promise Him the Job" button with his reply.

**Tech Stack:** Python 3, vanilla JS, plain-script tests, Playwright (`playwright==1.63.0`).

**Spec:** `docs/superpowers/specs/2026-11-11-promise-the-job-design.md` (decided with the player on November 11).

## Global Constraints

- The branch is `promise-job`, from `main` after School Grades Phase 2. The full suite is `python3 tests/run_all.py --retry 1`.
- `python3 tests/test_sim_golden.py` stays identical. Only your school makes promises, and AI coaches make none. New draws use their own stream: `random.Random(f"promise-job-{seed}-{slug}-{pid}-{week}")`.
- One job promise per recruit, counting any open `"roster"` promise from his question.
- Copy: the button is "Promise Him the Job"; replies are sentences; the History line is "You told him the job is his."
- Tunables are module-level `*tune*` in `recruiting.py`:
  - `JOB_PRIORITY = 1.5`: worth this much more when Playing Time is one of his priorities.
  - `JOB_NOT_PRIORITY = 0.5`: worth this much when it isn't.
  - `JOB_CROWD = 0.6`: worth this much less for each open promise you already hold at his position.
  - `JOB_CROWD_DOUBT = 0.25`: his chance to hear it as hollow, for each such promise.
  - `JOB_STRAIN_FIRM = 10`: the firmness a committed earlier promise loses.
  - `JOB_STRAIN_SCORE = 0.1`: what a promised roster player's season score loses for each strain.

## Review Focus

1. **A recruit who already holds a roster promise** from his question gets a 409 "You already promised him the job." Nothing is added or charged.
2. **His roster question is pending:** the button is hidden, because answering is the promise.
3. **The portal:** an entrant's promise signs as `promised` (the existing portal path), and the crowd counts next year's promised roster players at his group.
4. **A strained promise whose player is gone** (he committed elsewhere, or signed elsewhere): no strain and no crash.
5. **Keeps His Word under the floor:** a believable job promise is doubted (0 points, the doubt line). A hollow one still costs what a hollow promise does.

---

### Task 1: The action (server)

**Files:**
- Modify: `coach_career/recruiting.py`:
  - `act`: `action == "promise_job"` → `_promise_job`.
  - Add `_promise_job`, `job_crowd`, `_strain` and the constants.
- Modify: `coach_career/scenes.py`:
  - `REPLY_LINES["crowded"]`: "Everybody gets that line, Coach. I hear you've already got guys at my spot."
  - `HEARD_RIVAL`: "Coach, I heard you told another kid the same thing."
- Test: `tests/test_promise_job.py` (new)

**Interfaces:**
- Produces: `_promise_job(state, slug, pid, scene) -> dict`, shaped like `_answer`'s result: `{"scene", "points", "truthful", "doubted", "crowded", "hours_left"}`.
  - Requires an open scene (409 otherwise) and no open roster promise (409 "You already promised him the job.").
  - `about = ahead_of(...)`, or `{"name": None, "ovr": 0, "last_year": True}` when nobody is ahead.
  - `truthful = promise_holds(state, slug, pid, {"kind": "roster", "about": about})`.
  - Points: truthful and believed gives `ANSWER_PROMISE × promise_mult × (JOB_PRIORITY or JOB_NOT_PRIORITY) × JOB_CROWD ** crowd`. With a crowd, the seeded draw `< JOB_CROWD_DOUBT × crowd` makes it crowded: hollow, with the hollow cost and a cooling. Untruthful gives the hollow cost.
  - Appends `{"kind": "roster", "about": about, "week": week, "broken": None, "job": True}` to his contact, then logs `answer` with `job=True` and the History line.
- Produces: `job_crowd(state, slug, group, but: str) -> list[dict]`, the open promises at that group other than `but`:
  - recruits' open roster promises on your contacts (not broken or closed; he is uncommitted or committed to you)
  - your promised roster players this season (`promises.promised_now`)
  - in the portal, next year's roster rows with `promised == year`
- Produces: `_strain(state, slug, crowd, week) -> None`:
  - An uncommitted recruit cools (`cooled_until = week + COOL_WEEKS`, why "promise") and gets `heard_rival = week` on his contact.
  - A committed one who isn't a hard commit loses `JOB_STRAIN_FIRM`.
  - A promised roster player gets `+1` on `promises.record(state)[year][slug]` key `strain`, read by `promises.score` as `- JOB_STRAIN_SCORE` each.
  - Each logs `promise_strained` with the line `HEARD_RIVAL`.

- [ ] **Step 1: Write the failing tests:**
  - `test_promise_job_helps`: a recruit with Playing Time a priority and nobody ahead. Points equal `ANSWER_PROMISE × promise_mult × JOB_PRIORITY`, and the contact holds one roster promise with `job`.
  - `test_not_his_priority_counts_less`: the same, without Playing Time, gives `× JOB_NOT_PRIORITY`.
  - `test_one_per_recruit`: a second call raises 409, and the points are unchanged.
  - `test_hollow_costs`: a better returning starter ahead (not in his last year). Points equal `-ANSWER_HOLLOW × hollow_mult` and he cools.
  - `test_crowd_and_strain`: promise recruit A at a group, then recruit B at the same group.
    - B's points are `× JOB_CROWD` (or crowded-hollow by the seeded draw; force `JOB_CROWD_DOUBT = 0` for the points check).
    - A is cooled, his contact has `heard_rival`, and a `promise_strained` event exists.
  - `test_strain_on_roster_player`: a promised roster player at the group (second season; `tests/test_promises.second_season`). After the job promise, his record has `strain == 1`, and `promises.score` is lower by `JOB_STRAIN_SCORE`.
  - `test_ai_no_job_promise`: `act(..., "promise_job")` for an AI slug raises.
  - `test_signs_promised`: a job-promised recruit signing (the existing signing path, as in `tests/test_promise_follows.py`) is `promised` on next year's roster.
- [ ] **Step 2: Run** `python3 tests/test_promise_job.py`. Expected: fails (unknown action).
- [ ] **Step 3: Implement.** `promises.score(weeks, position, personality)` gains a `strain: int = 0` parameter. `bands` and `chips_now` pass the record's strain.
- [ ] **Step 4: Run** `python3 tests/test_promise_job.py`, `python3 tests/test_promises.py`, `python3 tests/test_recruit_questions.py`, `python3 tests/test_word.py`, `python3 tests/test_sim_golden.py`. All pass.
- [ ] **Step 5: Commit** "Promise Him the Job: on any call or visit; two promises at a position strain each other".

### Task 2: The scene (page) and his next line

**Files:**
- Modify: `web/recruiting.js` (`drawFinish`): a secondary button, `.go-btn.go-promise-job`, labeled "Promise Him the Job".
  - Hidden while his roster or recruit question is pending, and when `b.job_promised` is set.
  - Posts `promise_job`, adds your turn ("The job's yours.") and his reply as turns, then hides itself.
  - The toast reads "Promise: the job is his" plus the points word.
- Modify: `coach_career/prospects.py` (`board_row`): `job_promised: bool`, whether he holds an open roster promise from you.
- Modify: `coach_career/scenes.py` (the scene's opening). When his contact has `heard_rival` newer than his last scene, his first line is `HEARD_RIVAL`. Clear it once said.
- Test: `tests/test_promise_job.py` (the next-line check); a browser check in `tests/test_scene_window.py`.

- [ ] **Step 1: Write the failing tests:**
  - `test_heard_rival_line`: after a strain, his next call's first "him" turn is `HEARD_RIVAL`, and a later call's isn't.
  - Browser: open a call, present three, and click Promise Him the Job (when shown). His reply joins the conversation, the button is gone, the History has "You told him the job is his.", and no null or undefined shows.
- [ ] **Step 2: Run** them. Expected: fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `python3 tests/test_promise_job.py`, `python3 tests/test_scene_window.py`, `python3 tests/test_ux_sweep.py`, `python3 tests/test_spacing.py`. All pass.
- [ ] **Step 5: Commit** "Promise Him the Job: the scene's button, his reply, and the line he brings up next time"; update `docs/HOW_IT_WORKS.md` (Promises).
