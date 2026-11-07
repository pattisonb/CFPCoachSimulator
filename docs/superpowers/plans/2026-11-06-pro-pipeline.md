# Pro Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every program carries a living Pro Pipeline grade (overall and per position group) from the last ten NFL drafts, in the rating at 10%, shown in eight-word grades on the Programs tab, and pitched to recruits as Path to the League at their position.

**Architecture:** `coach_career/programs.py` owns the score, the scale, the per-group grade and the yearly update from the career's draft; `tools/build_program_history.py` seeds the base values from `data/nfl_drafts.json`; `coach_career/recruiting.py` adds the pitch topic and its pull; `coach_career/scenes.py` and `persona.py` carry the copy; `web/recruiting.js` draws the bar, the chips, the column and the eight words. No engine (game sim) change; the golden recruiting hash is regenerated once.

**Tech Stack:** Python 3.13 (no third-party deps in the engine), vanilla JS, Playwright tests as plain scripts.

**Spec:** `docs/superpowers/specs/2026-11-06-pro-pipeline-design.md`

## Global Constraints

- Work in the worktree `/home/user/CFPCoachSimulator/.claude/worktrees/pro-pipeline`, branch `pro-pipeline`. Tests are plain scripts: `python3 tests/<file>.py` from the worktree root; the full suite is `python3 tests/run_all.py --strict --retry 1`.
- Copy: titles, labels, tags, kickers, column headers and chips in Title Case ("Pro Pipeline", "Path to the League"); sentences with a period; American spelling; no "null"/"undefined"/"NaN" on a page.
- Tunable constants are module-level, marked `*tune*`, one-line comment.
- `python3 tests/test_sim_golden.py`: the games and stat lines stay byte-identical in every task; the recruiting hash is regenerated once, in Task 7 only, with `--record`, and the diff of `tests/golden/sim_seed11_two_weeks.json` must touch only `recruiting_sha256`.
- `python3 tools/check_programs.py` must keep at least 20 of its expected 25 in the starting top 25 by rating.
- Commits end with the two trailer lines (`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01HFbivHLRXCS9LsHMpURgp2`); no model identifiers in code or comments.
- Front-end actions patch in place; a full redraw only on tab open.

## Review Focus

1. A program with no picks in ten years (Army, Kent State): `pro` 0, every group grade 0, the page reads Weak, the pitch pull is the floor, never a KeyError or NaN. Pinned in Task 1 and Task 3.
2. A career draft where a team's departure event has a position the draft groups do not know (a legacy save with an odd `pos`): the pick is skipped, not crashed. Pinned in Task 2.
3. An old save whose programs predate `drafts` (no `pro`, no `drafts` on `program`): `update` and the page read 0 and ten empty lines rather than failing. Pinned in Task 2 and Task 5.
4. An athlete (ATH) and a kicker read the overall grade, an offensive lineman the mean of OT and IOL. Pinned in Task 3.
5. The scene's pro lines claim a pipeline only when the school can (`truth["pro"]`); a Weak program's lead is the honest one. Pinned in Task 4.

---

### Task 1: The score, the scale and the base values

**Files:**
- Modify: `coach_career/programs.py` (constants after `WEIGHTS`; `BASE_DEFAULT`; `init`; new functions)
- Modify: `tools/build_program_history.py` (`build`)
- Modify: `data/program_history.json` (rebuilt by the tool)
- Test: `tests/test_program_history.py`

**Interfaces:**
- Produces: `PRO_ROUND_POINTS: dict[int, int] = {1: 4, 2: 3, 3: 2}` (later rounds 1), `PRO_RECENT_YEARS = 5`, `PRO_RECENT_WEIGHT = 2.0`, `PRO_YEARS = 10`, `WEIGHTS` with `"pro": 0.10` (prestige 0.30, winning 0.15, nil 0.15, market 0.10, conference 0.10, coach 0.10).
- `pick_points(round_: int) -> int`.
- `draft_line(year: int, picks: list[tuple[int, str]]) -> list` → `[year, points, {group: points}]` from `(round, group)` pairs.
- `pro_score(lines: list, year_now: int) -> float` and `pro_group_scores(lines: list, year_now: int) -> dict[str, float]`: the last `PRO_YEARS` lines, a line whose year is within the newest `PRO_RECENT_YEARS` of `year_now` (year > year_now − PRO_RECENT_YEARS) weighted `PRO_RECENT_WEIGHT`.
- `pro_recompute(p: dict, year_now: int) -> None`: sets `p["pro"]` and `p["pro_groups"]` from `p["drafts"]` through `scaled` with `_history()["scales"]["pro"]` and `["pro_group"][group]` (a missing scale → 0).
- `data/program_history.json` teams carry `pro`, `pro_groups`, `drafts` (ten lines, oldest first, years 2016–2025); `scales.pro = {lo, hi, k}`, `scales.pro_group = {group: {lo, hi, k}}`.

- [ ] **Step 1: Write the failing tests** in `tests/test_program_history.py` (append after the existing checks):

```python
    from coach_career import programs
    assert programs.pick_points(1) == 4 and programs.pick_points(3) == 2 and programs.pick_points(7) == 1
    line = programs.draft_line(2025, [(1, "WR"), (2, "CB"), (7, "WR")])
    assert line == [2025, 8, {"WR": 5, "CB": 3}]
    lines = [[y, 1, {"QB": 1}] for y in range(2016, 2026)]
    assert programs.pro_score(lines, 2025) == 15 and programs.pro_group_scores(lines, 2025) == {"QB": 15}   # five old at 1, five new at 2
    assert programs.pro_score([[2010, 50, {"QB": 50}]] + lines, 2025) == 15, "only the last ten lines count"
    for s in fbs:
        p = d[s]
        assert 0 <= p["pro"] <= 100 and len(p["drafts"]) == 10 and p["drafts"][0][0] == 2016 and p["drafts"][-1][0] == 2025, (s, p.get("pro"))
        assert all(0 <= v <= 100 for v in p["pro_groups"].values())
    assert d["alabama"]["pro"] == 100 and d["ohio-state"]["pro"] >= 85 and d["georgia"]["pro"] >= 85
    assert d["army"]["pro"] == 0 and d["army"]["pro_groups"] == {} and d["kent-state"]["pro"] == 0
    pro = [d[s]["pro"] for s in fbs]
    assert 32 <= st.median(pro) <= 48, st.median(pro)
    assert d["ohio-state"]["pro_groups"]["WR"] >= 80 and d["iowa"]["pro_groups"].get("OT", 0) >= 60
    sc = json.loads(programs.HISTORY.read_text(encoding="utf-8"))["scales"]
    assert sc["pro"]["lo"] == 0 and sc["pro"]["hi"] > 0 and set(sc["pro_group"]) >= {"QB", "WR", "OT", "EDGE", "CB"}
    assert abs(sum(programs.WEIGHTS.values()) - 1.0) < 1e-9 and programs.WEIGHTS["pro"] == 0.10
```

- [ ] **Step 2: Run** `python3 tests/test_program_history.py` → FAIL (`AttributeError: pick_points`).

- [ ] **Step 3: Implement** in `coach_career/programs.py`: the constants (`*tune*` comments), `pick_points`, `draft_line`, `pro_score`, `pro_group_scores`, `pro_recompute`; `WEIGHTS` as above; `BASE_DEFAULT["pro"] = 0`; `init` copies `pro`, `pro_groups` (default `{}`) and `drafts` (default: ten `[year, 0, {}]` lines ending at `lgd.get("year", 2026) - 1`) onto the program. `base()` for an unknown program gets `pro_groups: {}` and the ten empty lines.

- [ ] **Step 4: Implement** in `tools/build_program_history.py`: read `data/nfl_drafts.json`, build each FBS program's ten lines with `draft_line` from its picks (`p["team"]`, `p["round"]`, `p["group"]`; `group` None skipped); the raw scores with `pro_score(lines, 2025)`; `scales.pro` by `scale_fixed(raw, lo=0, hi=max(raw), median=MEDIAN_TARGET, name="pro")`; per group `scale_fixed` over the programs' group scores with `name=f"pro_group.{g}"` collected into `SCALES["pro_group"][g]`; write `pro`, `pro_groups`, `drafts` per team; the rating mix now includes `pro`. Run `python3 tools/build_program_history.py` and `python3 tools/check_programs.py`; if the start check drops below 20 of 25, lower `WEIGHTS["pro"]` toward 0.08 and raise prestige back, and say so in the commit.

- [ ] **Step 5: Run** `python3 tests/test_program_history.py`, `python3 tests/test_program_readers.py`, `python3 tests/test_programs_update.py`, `python3 tests/test_program_market.py`, `python3 tools/check_programs.py` → all pass.

- [ ] **Step 6: Commit** `Pro Pipeline: the score, the scale and every program's base grades from the last ten drafts`.

---

### Task 2: Living with the career's draft

**Files:**
- Modify: `coach_career/programs.py` (`update`)
- Test: `tests/test_programs_update.py`

**Interfaces:**
- Consumes: Task 1's `draft_line`, `pro_recompute`, `PRO_YEARS`.
- Produces: `update(state, results, ranks, year=None, only=None)` also appends the year's draft line and recomputes; `draft_picks(state) -> dict[str, list[tuple[int, str]]]` (team slug → `(round, group)` from `state["offseason"]["departures"]` events with `kind == "draft"`, the group `offseason.DRAFT_GROUP.get(ev["pos"])`, an unknown position skipped).

- [ ] **Step 1: Write the failing tests** (append to `tests/test_programs_update.py`, where `lgd`, `off`, `st` and the update already ran):

```python
    from coach_career import offseason
    picks = programs.draft_picks(st)
    assert sum(len(v) for v in picks.values()) >= 150, sum(len(v) for v in picks.values())
    for s, t in lgd["teams"].items():
        p = t["program"]
        assert len(p["drafts"]) == programs.PRO_YEARS and p["drafts"][-1][0] == off["year"] - 1 and p["drafts"][0][0] == off["year"] - programs.PRO_YEARS
        assert p["drafts"][-1][1] == sum(programs.pick_points(r) for r, _ in picks.get(s, []))
        assert 0 <= p["pro"] <= 100 and all(0 <= v <= 100 for v in p["pro_groups"].values())
    before = {s: t["program"]["pro"] for s, t in lgd["teams"].items()}
    programs.update(st, results, ranks, year=off["year"])            # the same year again: nothing added twice
    assert all(len(t["program"]["drafts"]) == programs.PRO_YEARS and t["program"]["pro"] == before[s] for s, t in lgd["teams"].items())
    # ten empty drafts take a factory to the floor
    p = lgd["teams"]["alabama"]["program"]
    for y in range(off["year"], off["year"] + programs.PRO_YEARS):
        p["drafts"] = p["drafts"][1:] + [[y, 0, {}]]
    programs.pro_recompute(p, off["year"] + programs.PRO_YEARS)
    assert p["pro"] == 0 and p["pro_groups"] == {}
    # an old save: a program without drafts reads 0 and gets its ten lines
    q = lgd["teams"]["akron"]["program"]; q.pop("drafts", None); q.pop("pro", None); q.pop("pro_groups", None); q["year"] = off["year"] - 1
    programs.update(st, results, ranks, year=off["year"], only=["akron"])
    assert len(q["drafts"]) == programs.PRO_YEARS and q["pro"] >= 0 and isinstance(q["pro_groups"], dict)
    # an unknown position is skipped, not a crash
    st["offseason"]["departures"].append({"id": "x", "team": "akron", "kind": "draft", "pos": "???", "round": 1})
    assert programs.draft_picks(st)["akron"] == [(r, g) for r, g in programs.draft_picks(st)["akron"] if g]
```
(Use the names the file already binds for `results` and `ranks`; read its top before writing.)

- [ ] **Step 2: Run** `python3 tests/test_programs_update.py` → FAIL (`draft_picks`).

- [ ] **Step 3: Implement** `draft_picks` and the `update` addition: after the winning/prestige/market/coach block and before `p["rating"] = round(mix(p), 1)`, `p.setdefault("drafts", <ten empty lines ending year-2>)`, append `draft_line(year - 1, picks.get(s, []))`, trim to `PRO_YEARS`, `pro_recompute(p, year - 1)`; `p.setdefault("pro", 0)`, `p.setdefault("pro_groups", {})` before the mix. The `p.get("year") == year` guard already prevents a second add.

- [ ] **Step 4: Run** `python3 tests/test_programs_update.py`, `python3 tests/test_program_readers.py`, `python3 tests/test_offseason.py`, `python3 tests/test_league_career.py` → pass. Add to `tools/check_programs.py` a printed line "draft points a year: career N vs real mean M" using `draft_picks` on the run's last league when one is given (no new assertion).

- [ ] **Step 5: Commit** `Pro Pipeline: each career draft becomes the year's line; the grade lives`.

---

### Task 3: The pitch's pull, priority and deciders

**Files:**
- Modify: `coach_career/programs.py` (`pro_group_grade`)
- Modify: `coach_career/recruiting.py` (`PITCHES`, `PRIORITY_ODDS`, `PORTAL_PRIORITY_ODDS`, `PORTAL_TOP_PRIORITY_ODDS`, `pull`, `PRO_PULL_K`)
- Modify: `coach_career/persona.py` (`DECIDER_TOPICS`)
- Test: `tests/test_pro_pitch.py` (new)

**Interfaces:**
- Produces: `programs.pro_group_grade(p: dict, group: str) -> float` with `GROUP_DRAFT = {"QB": ("QB",), "RB": ("RB",), "WR": ("WR",), "TE": ("TE",), "OL": ("OT", "IOL"), "DL": ("EDGE", "DL"), "LB": ("LB",), "CB": ("CB",), "S": ("S",), "K": ("K",), "P": ("P",)}`: the mean of the listed groups' `pro_groups` values (missing → 0); any other group (ATH) → `p.get("pro", 0)`.
- `recruiting.PITCHES = ("proximity", "playing_time", "prestige", "winning", "nil", "coach", "pro", "academics")`; `PRIORITY_ODDS` proximity 0.18, playing_time 0.17, prestige 0.14, winning 0.13, nil 0.13, coach 0.10, pro 0.10, academics 0.05; `PORTAL_PRIORITY_ODDS` playing_time 0.40, nil 0.20, winning 0.15, proximity 0.10, prestige 0.07, pro 0.05, coach 0.03; `PORTAL_TOP_PRIORITY_ODDS` nil 0.30, winning 0.22, playing_time 0.18, prestige 0.12, pro 0.08, proximity 0.06, coach 0.04; `PRO_PULL_K = 1.2` (`*tune*`); `pull()["pro"] = _logistic(PRO_PULL_K * (grade - 50) / 25)` with `grade = programs.pro_group_grade(programs.get(state, slug), _group(p["ea_position"]))`.
- `persona.DECIDER_TOPICS`: `dad` gains `"pro"`, `trainer` gains `"pro"`, `hs_coach` gains `"pro"`.

- [ ] **Step 1: Write the failing test** `tests/test_pro_pitch.py`:

```python
"""Path to the League: a school's pull on a recruit is its Pro Pipeline grade at his position group,
one recruit in ten has it first, and the deciders who care about it carry it."""
import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
from coach_career import persona, programs, recruiting
from sim import season

if __name__ == "__main__":
    assert "pro" in recruiting.PITCHES and recruiting.PITCHES.index("pro") == len(recruiting.PITCHES) - 2
    for table in (recruiting.PRIORITY_ODDS, recruiting.PORTAL_PRIORITY_ODDS, recruiting.PORTAL_TOP_PRIORITY_ODDS):
        assert abs(sum(table.values()) - 1.0) < 1e-9 and table["pro"] > 0, table
    p = {"pro": 40, "pro_groups": {"OT": 80, "IOL": 40, "WR": 95, "EDGE": 70}}
    assert programs.pro_group_grade(p, "OL") == 60 and programs.pro_group_grade(p, "WR") == 95
    assert programs.pro_group_grade(p, "DL") == 35 and programs.pro_group_grade(p, "QB") == 0 and programs.pro_group_grade(p, "ATH") == 40
    assert programs.pro_group_grade({}, "WR") == 0
    assert "pro" in persona.DECIDER_TOPICS["dad"] and "pro" in persona.DECIDER_TOPICS["trainer"] and "pro" in persona.DECIDER_TOPICS["hs_coach"]
    st = season.new_season("ohio-state", "full", seed=11, career=True)
    rc = st["recruiting"]
    wr = next(pid for pid, pr in rc["prospects"].items() if pr["ea_position"] == "WR")
    k = next(pid for pid, pr in rc["prospects"].items() if pr["ea_position"] in ("K", "P"))
    osu, sjsu = recruiting.strengths(st, "ohio-state", wr), recruiting.strengths(st, "san-jose-state", wr)
    assert osu["pro"] > 0.85 and sjsu["pro"] < 0.2, (osu["pro"], sjsu["pro"])
    assert 0.0 <= recruiting.strengths(st, "army", wr)["pro"] <= 0.1, "no picks in ten years: the floor"
    assert abs(recruiting.strengths(st, "ohio-state", k)["pro"] - recruiting._logistic(recruiting.PRO_PULL_K * (programs.get(st, "ohio-state")["pro"] - 50) / 25)) < 0.01
    share = sum(1 for pr in rc["prospects"].values() if "pro" in pr["priorities"]) / len(rc["prospects"])
    assert 0.22 <= share <= 0.38, share
    first = sum(1 for pr in rc["prospects"].values() if pr["priorities"][0] == "pro") / len(rc["prospects"])
    assert 0.07 <= first <= 0.13, first
    print(f"pro pitch ok: Ohio State WR {osu['pro']:.2f} vs San José State {sjsu['pro']:.2f}; {share:.0%} of the class carry it, {first:.0%} first")
```

- [ ] **Step 2: Run** `python3 tests/test_pro_pitch.py` → FAIL on `PITCHES`.

- [ ] **Step 3: Implement** the interfaces above. `pull()` reads `programs.get(state, slug)`, which it already does for prestige.

- [ ] **Step 4: Run** `python3 tests/test_pro_pitch.py`, `python3 tests/test_recruiting_api.py`, `python3 tests/test_recruiting.py`, `python3 tests/test_portal_outcome.py`, `python3 tests/test_persona_rules.py`, `python3 tests/test_persona_scenes.py` → pass (a test that enumerates topics by hand: add "pro"; a test pinning the old odds: update to the table above). `python3 tests/test_sim_golden.py` now fails only on the recruiting hash: confirm the message is the recruiting one, not a game one, and leave it red until Task 7.

- [ ] **Step 5: Commit** `Path to the League: the pull at his position, the priority odds, the deciders`.

---

### Task 4: The copy

**Files:**
- Modify: `coach_career/scenes.py` (`PHRASES`, `LINES`, `LEAD_LINES`, `LEAD_HONEST`, `HONEST_HIT`, `SAID_HONEST`, `NEEDS`, `truth`)
- Modify: `web/recruiting.js` (`PITCH_NAMES`)
- Test: `tests/test_pro_pitch.py` (extend), `tests/test_copy_case.py`

**Interfaces:**
- Consumes: Task 3's topic `"pro"`.
- Produces: `PHRASES["pro"] = "getting to the league"`; `LINES["pro"]` with the spec's cue/hit/polite/quiet pools (section 3, verbatim); `LEAD_LINES["pro"]`, `LEAD_HONEST["pro"]`, `HONEST_HIT["pro"]`, `SAID_HONEST["pro"]` verbatim from the spec; `NEEDS` maps the three `LINES["pro"]["hit"]` lines to `"pro"`; `truth()` adds `"pro"` to the `CLAIM_FROM` topics tuple; `PITCH_NAMES.pro = "Path to the League"`.

- [ ] **Step 1: Write the failing test** (append to `tests/test_pro_pitch.py`, before the print):

```python
    from coach_career import scenes
    assert scenes.PHRASES["pro"] == "getting to the league" and scenes.SAID_HONEST["pro"] == "a path to Sundays"
    assert all(k in scenes.LINES["pro"] and len(scenes.LINES["pro"][k]) == 3 for k in ("cue", "hit", "polite", "quiet"))
    assert all(scenes.NEEDS.get(line) == "pro" for line in scenes.LINES["pro"]["hit"])
    assert "{position}" in scenes.LEAD_LINES["pro"] and "{first}" in scenes.LEAD_HONEST["pro"] and len(scenes.HONEST_HIT["pro"]) == 2
    assert scenes.truth(st, "ohio-state", wr)["pro"] is True and scenes.truth(st, "army", wr)["pro"] is False
    js = (_Path(__file__).resolve().parents[1] / "web" / "recruiting.js").read_text()
    assert 'pro: "Path to the League"' in js
```

- [ ] **Step 2: Run** → FAIL on `PHRASES["pro"]`.

- [ ] **Step 3: Implement** the copy (every line from the spec, section 3) and `truth`.

- [ ] **Step 4: Run** `python3 tests/test_pro_pitch.py`, `python3 tests/test_copy_case.py`, `python3 tests/test_scenes.py`, `python3 tests/test_persona_scenes.py`, `python3 tests/test_recruit_questions.py`, `python3 tests/test_scene_window.py`, `python3 tests/test_contact_menu.py` → pass (a test that counts the pitch menu's items: now eight).

- [ ] **Step 5: Commit** `Path to the League: his lines, your lead, the honest version, the page's name`.

---

### Task 5: Eight words and the Programs tab

**Files:**
- Modify: `coach_career/programs.py` (`WORD_FLOORS`, `rows`)
- Modify: `app/api.py` (`programs_view`)
- Modify: `web/recruiting.js` (`METRIC_WORDS`, `PROGRAM_METRICS`, `programCard`, `programsTable`)
- Modify: `web/styles.css` (`.go-programs td.*`, `.go-program-groups`)
- Test: `tests/test_pro_page.py` (new, browser), `tests/test_program_readers.py`

**Interfaces:**
- Produces: `programs.WORD_FLOORS = (("Elite", 90), ("Excellent", 80), ("Strong", 70), ("Good", 60), ("Solid", 50), ("Fair", 40), ("Thin", 30), ("Weak", 0))`; `programs.word_of(v: float) -> str`; `rows()` rows carry `pro` and `pro_groups`; `/programs` answers `words: [[word, floor], ...]`, `you.pro`, `you.pro_groups`.
- Page: `METRIC_WORDS(v)` reads `pv.words`; `PROGRAM_METRICS` gains `["pro", "Pro Pipeline", "The last ten drafts, by position"]`; under the bars a `div.go-program-groups` of `span.go-tag` chips, every group in `DRAFT_GROUP`'s value order with a grade, best first, text `"WR Elite"` (a group absent from `pro_groups` reads `"K Weak"`); the table gains a "Pro Pipeline" column after Coach; cells carry `word <lowercase>`; `td.elite, td.excellent, td.strong` read in the text color and weight, `td.thin, td.weak` muted.

- [ ] **Step 1: Write the failing tests.** In `tests/test_program_readers.py` append: `assert programs.word_of(92) == "Elite" and programs.word_of(80) == "Excellent" and programs.word_of(69.9) == "Good" and programs.word_of(29) == "Weak"` and `r = programs.rows(st); assert "pro" in r[0] and isinstance(r[0]["pro_groups"], dict)`. New `tests/test_pro_page.py` on the pattern of `tests/test_office_game.py`'s Programs check: open a career (ohio-state, seed 31), `tab_click(page, "programs")`, assert the Your Program card has a bar labeled "Pro Pipeline" whose word is one of the eight, `.go-program-groups .go-tag` count ≥ 8 with the first chip's text matching `/^[A-Z]+ (Elite|Excellent|Strong|Good|Solid|Fair|Thin|Weak)$/`, the table's header row contains "Pro Pipeline", and every `td.word` text is one of the eight words; at 400 wide the chips wrap with no horizontal scroll (`document.documentElement.scrollWidth <= 400`).

- [ ] **Step 2: Run** `python3 tests/test_program_readers.py` → FAIL on `word_of`.

- [ ] **Step 3: Implement** the interfaces above.

- [ ] **Step 4: Run** `python3 tests/test_program_readers.py`, `python3 tests/test_pro_page.py`, `python3 tests/test_office_game.py`, `python3 tests/test_copy_case.py`, `python3 tests/test_spacing.py`, `python3 tests/test_ux_sweep.py` (with `FONTCONFIG_FILE=/tmp/claude-0/-home-user-CFPCoachSimulator/0f35ca12-7ad6-5429-b5d3-c5036b2fa8ba/scratchpad/fonts.conf`) → pass; a sweep assertion that names one of the five old words updates to the eight.

- [ ] **Step 5: Commit** `Programs tab: Pro Pipeline bar, position chips and column; eight metric words`.

---

### Task 6: Docs

**Files:**
- Modify: `docs/HOW_IT_WORKS.md` ("Program ratings" table: a `pro` row; the rating mix line; the words line; a "Path to the League" paragraph under the recruiting pitches; `tools/fetch_drafts.py` in the "What is where" table)

- [ ] **Step 1:** Write the rows and paragraphs from the spec's sections 2–5 (the numbers as built: Alabama 100, the median, the five factories' words).
- [ ] **Step 2:** `python3 tests/test_copy_case.py` → pass. Commit `Docs: Pro Pipeline and Path to the League`.

---

### Task 7: The golden digest and the full suite

**Files:**
- Modify: `tests/golden/sim_seed11_two_weeks.json` (recorded)

- [ ] **Step 1:** `git diff --stat` is clean; `cp tests/golden/sim_seed11_two_weeks.json /tmp/golden_before.json`; `python3 tests/test_sim_golden.py --record`; `python3 - <<'EOF'` comparing the two JSONs: every key equal except `recruiting_sha256` → print "only recruiting_sha256 changed"; else STOP and report.
- [ ] **Step 2:** `python3 tests/test_sim_golden.py` → "sim golden ok".
- [ ] **Step 3:** `python3 tests/run_all.py --strict --retry 1` (background, ~30 min) → every test passes; fix anything red in its own commit.
- [ ] **Step 4:** `python3 tools/long_run.py` for 10 seasons if it runs under 20 minutes (else 5): the league's mean `pro` within 5 of its start; note the numbers in the commit.
- [ ] **Step 5:** Commit `Golden: the recruiting week with Path to the League (the games unchanged)`; push `git push -u origin pro-pipeline`.
