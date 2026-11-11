# School Grades, Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six new school grades built from the researched data for all 136 programs: **Academics, Facilities, Location, Stability, Game Day, Exposure**. Location also carries tags (setting, climate, region). The grades show on the Programs tab with the existing seven, grouped Football and Campus. No recruit reads them yet (Phase 2), and none moves yet (Phase 3).

**Architecture:**
- `tools/build_program_profile.py` turns the research files into `data/program_profile.json`: one row per program with the facts, the source of each, and the estimates marked.
- `coach_career/programs.py` grades those facts on read (`programs.grades(slug)`). Phase 1 grades are fixed, so nothing new goes into saves.
- `programs.rows` adds them, and the Programs tab draws them.

**Tech Stack:** Python 3 (no third-party deps), vanilla JS, plain-script tests, Playwright (`playwright==1.63.0`).

**Spec:** `docs/superpowers/specs/2026-11-10-school-grades-expansion-design.md` (with "Decided"). Research: `research_notes/school_grades/` (seven batch files, `instagram_handles.csv`, `BRIEF.md`).

## Global Constraints

- Branch `claude/jolly-clarke-jivd5o`. Full suite: `python3 tests/run_all.py`.
- **The rating, tiers, AD goals and job market do not change** (Decided 2). `programs.WEIGHTS` and `mix` are untouched; `python3 tests/test_sim_golden.py` stays byte-identical; `python3 tools/check_programs.py` is unchanged.
- **Market stays as it is.** Ruling against the spec's "Market = 0.6 × Game Day + 0.4 × Exposure": deriving it would change every Market and so the rating, which Decided 2 rules out. Game Day and Exposure show as Market's two parts beside the unchanged Market reading.
- **Facilities is fixed** (Decided 3). In Phase 1 every new grade is fixed.
- Grades are 0-100, shown only as `programs.WORD_FLOORS` words (Elite … Weak), never as numbers on the page.
- Labels, chips and column headers are Title Case ("Game Day", "College Town", "Mid-Size City"); tooltips are sentences.
- Grading constants are module-level in `coach_career/programs.py`, marked `*tune*`.
- Commits end with the two trailer lines from the session's attribution reminder; no model identifiers.

## Grading (the decisions the code carries)

All scales are linear between the two anchors and clamped to 0-100, unless marked log.

| Grade | Facts | Score |
|---|---|---|
| Academics | U.S. News rank, football GSR, football APR | 0.6 × rank score + 0.25 × GSR score + 0.15 × APR score. Rank score is log: rank 1 → 100, rank 400 → 0. GSR 60 → 0, 100 → 100. APR 930 → 0, 1000 → 100. `"unranked"` → 25, except the service academies (Army, Navy, Air Force) → 85 (ranked as top liberal arts colleges). A missing rank → the conference median, marked as an estimate. |
| Facilities | Stadium renovated, football building year, indoor practice year | 0.35 × stadium + 0.40 × building + 0.25 × indoor. Each recency: 2026 → 100, minus 4 a year, floor 10. Indoor `"none"` → 10. A missing year → its conference's median year, marked as an estimate. |
| Location | Metro population, January temperature | 0.6 × size + 0.4 × warmth. Size is log: 50,000 → 20, 5,000,000 → 100. Warmth: 20°F → 20, 65°F → 100. |
| Location tags | metro, January temperature, state | Setting: **Big City** (metro 1M+), **Mid-Size City** (500K-1M, unless the research set College Town), otherwise the research's College Town or Small Town. Climate: **Warm** (January 50°F+), **Mild** (35-50), **Cold**. Region from the state: **South**, **Midwest**, **West**, **Northeast**. |
| Stability | Head coaches since 2010 | 100 − 15 × (coaches − 1), floor 10 (one coach → 100, three → 70, six → 25). |
| Game Day | Home crowd (`program_market.json` attendance), stadium capacity | 0.6 × crowd + 0.4 × fill. Crowd: 15,000 → 15, 105,000 → 100. Fill = crowd / capacity: 50% → 20, 100% → 100. |
| Exposure | TV millions (`program_market.json`), Instagram followers (the player's sheet, 2026-11-10) | 0.5 × TV + 0.5 × Instagram. TV is log: 0.3M → 10, 8M → 100. Instagram is log: 20,000 → 10, 2,000,000 → 100. |

## Review Focus

1. **A program in the league with no profile row** (an imported league file's fictional or new program): `grades` returns `None`, the page shows "Not Graded" and nothing crashes. Pinned in Task 2.
2. **A value the research wrote as a string** ("unranked", "none", "120,000", "36,500 seats"): parsed or treated as missing, never a crash or NaN. Pinned in Task 1.
3. **A stadium capacity smaller than its crowd** (some sources conflict): fill clamps at 100%. Pinned in Task 2.
4. **The six schools tied at a rounded 1M or 2M Instagram followers**: graded without error. The tie is accepted (log scale). Pinned in Task 2.
5. **An old save:** grades are read from the file, so an old save gets them with no migration. Pinned in Task 2.

---

### Task 1: The profile file (`tools/build_program_profile.py` → `data/program_profile.json`)

**Files:**
- Create: `tools/build_program_profile.py`, `data/program_profile.json` (built, committed)
- Test: `tests/test_program_profile.py` (new)

**Interfaces:**
- Produces: `data/program_profile.json`, shaped `{"source": str, "built": "2026-11-11", "teams": {slug: {"facts": {field: value}, "sources": {field: url}, "estimates": [field, ...], "notes": {field: str}}}}`.
- Fields:
  - The brief's fields (minus `instagram_followers`).
  - `instagram_followers` (int) from `followers_num` in the CSV.
  - `attendance` and `tv_millions` from `program_market.json`.
  - `state`, from the teams file.
- Produces: `parse_number(v) -> Optional[float]`: handles `"120,000"`, `"2M"`, `"36,500 seats"`, ints and floats; `"unranked"`, `"none"` and None return None.
- Facilities gaps take the conference median and are listed in `estimates`, with a note.

- [ ] **Step 1: Write the failing tests:**
  - `test_all_programs`: 136 teams, and the slugs equal `program_market.json`'s.
  - `test_fields`: every team has every field, either filled or listed in `estimates`.
  - `test_parse_number`: `"120,000"` → 120000, `"2M"` → 2,000,000, `"36,500 seats"` → 36500, `"unranked"` → None.
  - `test_instagram`: `ohio-state` 2,000,000 and `akron` 22,000.
  - `test_facility_gap_estimated`: a team whose research has `football_building_year` null gets the conference median, and the field is in `estimates`.
- [ ] **Step 2: Run** `python3 tests/test_program_profile.py`. Expected: fails (no file).
- [ ] **Step 3: Implement** the tool and run it: `python3 tools/build_program_profile.py`.
- [ ] **Step 4: Run** the test. Expected: passes.
- [ ] **Step 5: Commit** "School Grades: the program profile from the research".

### Task 2: The grades (`coach_career/programs.py`)

**Files:**
- Modify: `coach_career/programs.py` (add `PROFILE`, `profile(slug)`, `grades(slug)`, `tags(slug)` and the constants; `rows` adds `grades` and `tags`)
- Test: `tests/test_school_grades.py` (new)

**Interfaces:**
- Consumes: Task 1's file.
- Produces: `grades(slug) -> Optional[dict]`: `{"academics", "facilities", "location", "stability", "game_day", "exposure"}`, each 0-100 rounded to 0.1, per the Grading table; None for a program with no profile row.
- Produces: `tags(slug) -> dict`: `{"setting", "climate", "region"}`, the Title Case words in the Grading table.
- Produces: each `rows(state)` row gains `"grades"` (or None) and `"tags"`.

- [ ] **Step 1: Write the failing tests:**
  - `test_every_grade_in_range`: all 136 have six grades in 0-100, none NaN.
  - `test_anchors`: Stanford's Academics > 85; Akron's Exposure < Ohio State's; Hawaiʻi's Location warmth is above Minnesota's; a single-coach program's Stability is 100.
  - `test_academies`: Army, Navy and Air Force get Academics ≥ 70.
  - `test_fill_clamped`: a crowd above capacity gives fill 100%.
  - `test_tags`: Texas State (Austin metro) → Big City, South, Warm; Akron → Mid-Size City, Midwest, Cold.
  - `test_unknown_program`: `grades("no-such")` is None; `rows` on a fresh career does not crash.
  - `test_rating_untouched`: every program's `rating` and `tier` equal `programs.base(slug)`'s.
- [ ] **Step 2: Run** `python3 tests/test_school_grades.py`. Expected: fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `python3 tests/test_school_grades.py`, `python3 tests/test_sim_golden.py`, `python3 tools/check_programs.py`. All pass, and check_programs is unchanged.
- [ ] **Step 5: Commit** "School Grades: six grades and Location's tags from the profile".

### Task 3: The Programs tab

**Files:**
- Modify: `web/recruiting.js` (`PROGRAM_METRICS` and the School Grades column about line 300; the Every Program table), and the CSS if needed
- Test: the Programs tab check in `tests/test_ux_sweep.py` (find it by `go-program`), or `tests/test_programs_page.py` if one exists

**Interfaces:**
- Consumes: Task 2's `grades` and `tags` on each row.
- Produces:
  - **School Grades**, in two labeled groups with each bar in its word:
    - **Football:** Prestige, Winning, Coach, Stability, Conference, Pro Pipeline.
    - **Campus:** Academics, Facilities, Location, Game Day, Exposure, NIL.
  - Market stays a headline reading.
  - Location's tags as chips beside its bar.
  - Every Program table: the six new columns, in words.
  - "Not Graded" for a program with no grades.
  - Tooltips, as sentences:
    - Academics: "U.S. News rank, and the football team's graduation and progress rates."
    - Facilities: "How recently the stadium, the football building and the indoor practice facility were built or renovated."
    - Location: "The size of the metro and the winter weather."
    - Stability: "How few head coaches the program has had since 2010."
    - Game Day: "The home crowd and how full the stadium is."
    - Exposure: "TV audiences and the football team's Instagram following."

- [ ] **Step 1: Write the failing test:** the Programs tab shows 12 grade bars in two groups titled "Football" and "Campus". Each bar's word is in `WORD_FLOORS`, the Location chips are present, every label is Title Case, and nothing reads null, undefined or NaN, at 1280 and 400 px.
- [ ] **Step 2: Run** it. Expected: fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `python3 tests/test_ux_sweep.py`, `python3 tests/test_spacing.py`, `python3 tests/test_smoothness.py`. All pass.
- [ ] **Step 5: Commit** "School Grades: the Programs tab shows the six, Football and Campus".

### Task 4: The write-up and docs

**Files:**
- Create: `research_notes/school_grades/README.md` (the sources, editions, coverage table, judgment calls and the gaps left for a later pass)
- Modify: `docs/HOW_IT_WORKS.md` (the Programs section)

- [ ] **Step 1:** Write the README from the seven batch reports and the coverage counts (graduation rates 136/136 … facilities 94/136, Instagram 136/136 from the player).
- [ ] **Step 2:** Update `docs/HOW_IT_WORKS.md`.
- [ ] **Step 3:** Run `python3 tests/run_all.py`. It passes.
- [ ] **Step 4: Commit** "School Grades Phase 1: research write-up and docs".
