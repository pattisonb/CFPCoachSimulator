# Recruiting Tasks That Tick Themselves Off — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A task added from a suggestion in Recruiting Tasks (the Headquarters to-do list) ticks itself done when you do it in recruiting. A task on your list never disappears: one that no longer applies keeps its place with a note. Suggestions that no longer apply disappear, as they do now. Nothing is added for you.

**The player's rules (November 11):** tick off, never vanish from your list; irrelevant suggestions vanish; no auto-add.

**Architecture:** A suggestion carries what it asks for (`do`: a kind and the recruit). Adding it stores `do` and `since` (the week) on the task. `headquarters.tasks(state)` checks each open task with a `do` against the recruiting log and the board, then stores `done` and `auto`, or a `note` when the task is moot. Typed tasks stay manual.

**Spec:** this plan (a small feature from the player's message); the house rules in `CLAUDE.md`.

## Global Constraints

- Branch `auto-tasks` (worktree `.claude/worktrees/auto-tasks`), from `main`.
- `python3 tests/test_sim_golden.py` stays identical: tasks are Headquarters state, not the sim.
- Copy: the moot note is a sentence ("No longer needed: he committed to Georgia."); the tick's title is "Done for You".
- `set_plan` validation stays strict. `do.kind` must be one of `KINDS`; `pid` is a string of at most 80 characters; `nil` is an int from 0 to 1000; `since` is an int; `note` is at most 120 characters.

## Task kinds and when each is done

| kind | Suggested when | Done when (since the task was added) |
|---|---|---|
| `nil` | A money promise is owed | NIL held on him ≥ `nil` |
| `call` | He hasn't heard from you, or he cooled because he felt ignored or saw you lose | A call or in-home visit to him is logged |
| `raise` | He cooled at a lowball | An offer or NIL raise to him is logged, or he is no longer cooled |
| `wait` | He doubts a promise you made | A week has passed |
| `leave` | He's tuning you out | A week has passed with no contact to him |
| `scout` | A top target has no report | A scout trip to him is logged |
| `pull` | He's locked in elsewhere and your offer holds a slot | Your offer to him is gone |
| `need` | Nobody at a needed position is on your board | Someone at that position is on your board |

**Moot:** the recruit committed or signed elsewhere (except for `pull`, whose point is that). The task stays, not done, with the note.

## Review Focus

1. **A task added before this feature, with no `do`:** it stays manual and nothing crashes.
2. **The recruit leaves the class or the board:** the task stays, with no crash on a missing prospect.
3. **Untick an auto-done task:** your choice holds. It is not re-ticked, because `auto` is cleared and the task is marked `manual`.
4. **The same suggestion added twice:** two tasks, both tick.
5. **The portal weeks:** the `do` pid is a portal entrant. The check reads that block's log, and it works there too.

### Task 1: Server — store `do`, check it

**Files:** `coach_career/headquarters.py` (`KINDS`, `set_plan` validation, `tasks` evaluation); Test: `tests/test_hq_auto_tasks.py` (new).

- [ ] Write failing tests:
  - `test_call_ticks`: a `call` task, then `recruiting.act(..., "call")` and its pitch. `tasks()` shows `done` and `auto`.
  - `test_nil_ticks`: offer with NIL ≥ `do.nil` ticks it.
  - `test_scout_ticks`.
  - `test_pull_ticks`.
  - `test_leave_after_quiet_week`.
  - `test_moot_note_keeps_task`: he commits elsewhere. The task is not done, its note names the school, and it is still in the list.
  - `test_untick_holds`: set `done` False on an auto-done task. It stays undone, and `manual` is True.
  - `test_plain_task_manual`: a typed task never ticks.
  - `test_bad_do_refused`: an unknown kind gives `LayoutError`.
- [ ] Run, watch fail; implement; run `python3 tests/test_hq_auto_tasks.py`, `python3 tests/test_headquarters.py`, `python3 tests/test_sim_golden.py`.
- [ ] Commit.

### Task 2: Page — suggestions carry `do`; the list shows auto ticks and notes

**Files:** `web/hq-widgets/outlook.js` (`alertsOf` adds `do`; the Recruiting Tasks widget saves `do` and `since` on Add, shows an auto tick with the title "Done for You", and shows the note under the task; unticking sends `manual: true`); Test: `tests/test_headquarters_browser.py` (`check_suggested_tasks` extended).

- [ ] Extend the browser check: Add the money suggestion, put the NIL on the offer through the API, and reopen. The task is ticked with the title "Done for You".
- [ ] Run, watch fail; implement; run `python3 tests/test_headquarters_browser.py`, `python3 tests/test_spacing.py`.
- [ ] Commit; `docs/HOW_IT_WORKS.md` (Headquarters tasks) updated.
