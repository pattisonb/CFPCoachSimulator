# Coach Career Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn "Sim a season" into Coach Career: each week you recruit generated high school seniors (hours, NIL points, staff scouting by area), play or sim your game, and advance while every other FBS school recruits from its real footprint, through national signing day.

**Architecture:** Season mode grows in place. A season state created as a career gains `state["career"]` (career.py: coach, staff, settings, save export/import) and `state["recruiting"]` (recruiting.py: the class, interest, actions, commitments, scouting reads). `season.advance` calls one hook, `recruiting.weekly_step`, after the week's games. Web: new tabs on web/season.html, the logic in a new web/recruiting.js. Each stage ends playable.

**Tech Stack:** Python 3.12, FastAPI (server.py), vanilla JS (web/), IndexedDB in the browser, plain-script tests run by `python tests/run_all.py <name>`.

**Spec:** docs/superpowers/specs/2026-10-22-coach-career-design.md (read it first; PLAYER_DEVELOPMENT.md for reads and coachability).

## Global Constraints

- No new Python dependencies (requirements.txt stays fastapi, uvicorn); pure Python like the rest of the repo.
- The engine fingerprint stays `abb51a974b89dafa` on this branch (tests/test_play_log.py): recruiting never changes how games play.
- Seasons without `"recruiting"` (older saves, "remaining" mode, Real 2026) behave exactly as today.
- High school seniors only: during the 2026 season the class is 2027 (`recruits.generate_class(2027, seed)`).
- No prospect is committed at week 0.
- Hours per week: `50 + max(0, recruiting_rating - 50) / 4`, rounded down. Costs: message 5, phone call 15, head coach in-home visit 30 (once per 4 weeks per prospect), offer 0, official visit invite 10 (one per school per prospect, at one of your home games).
- Offers capped at `ceil(1.5 * open_spots)`; open spots = 105 minus returning players (players not in their final year: class_year not "Senior (RS)", and "Senior" counts as leaving).
- Pitch topics: `"proximity", "playing_time", "prestige", "winning", "nil", "coach", "academics"`; a contact pitching one of the prospect's top three priorities is worth 2x, any other topic 0.5x.
- On-field standing weight on last season: 0.8 at week 0, 0.3 at week 7, 0.05 at week 15 and after (linear between).
- Signing: early period at `season.SELECTION_WEEK` (16) signs every committed prospect; national signing day after `season.FINAL_WEEK` (20) signs the rest; prospects with no FBS school at the end sign with "FCS".
- FCS schools never recruit. A prospect whose best FBS interest is below the FCS line shows "Leaning FCS".
- Staff: head coach's OC and DC plus 3 fictional recruiters; 9 areas (Task 5 defines them).
- Copy: the mode is "Coach Career"; the profile is "Prospect Profile"; public numbers are labeled "National rankings".
- Values marked *tune* in the spec are constants at the top of recruiting.py, set by Task 8's realism check.
- Deferred to the offseason project (they need signees to join a roster or a second season): your staff's
  reads carrying into a signee's player card, and trimming past seasons in the save.

## Review Focus

1. **The server forgot the season and the browser copy is older or newer than the server's:** the newer one (higher `career.saved_week`, then `career.saved_at`) wins; an upload never replaces a newer server copy. Test in Task 3.
2. **Sim to the end with recruiting on:** recruiting must add under 1.0 s per week on the test machine (20 weeks under 20 s), or Sim to the end becomes a stall. Test in Task 8.
3. **Caps under pressure:** with flips, decommitments and signing periods, no school (yours or AI) ever signs more than its open spots, a prospect never signs twice, and every prospect ends signed (an FBS school or "FCS"). Test in Task 8.
4. **Old saves and other modes:** a season saved before this branch, a "remaining" season and Real 2026 load and advance with no recruiting and no errors; their API views omit recruiting. Test in Task 2.
5. **Bad actions:** acting on a signed prospect, spending more hours than left, a second official visit, offering past the cap or acting during a running sim returns a clear 409/400 and changes nothing. Test in Task 6.

---

## Stage 1: Coach Career shell and saves (playable: the renamed mode, careers that survive restarts)

### Task 1: Rename the mode to Coach Career

**Files:**
- Modify: `web/index.html:37`, `web/season.html:6,37`, `web/coach.html:26`, `web/season.js:643`, `README.md` ("Sim a season" section)

**Interfaces:**
- Produces: nav label "Coach Career" at `/season`; page title `Coach Career · CFP Coach Simulator` (Real 2026 keeps `Real 2026 · CFP Coach Simulator`).

- [ ] **Step 1:** Change every visible "Sim a season" to "Coach Career" (`grep -rn "Sim a season" web README.md` returns nothing afterwards); season.js sets `document.title` to `Coach Career · CFP Coach Simulator` outside /real.
- [ ] **Step 2:** Run `python tests/run_all.py test_preview test_resume`; expected PASS. Load `/season` in Chromium (scratchpad Playwright script, path `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`) and check the nav text.
- [ ] **Step 3:** Commit: `Coach Career: the season mode's new name`.

### Task 2: Career state on new seasons

**Files:**
- Create: `career.py`
- Modify: `season.py` (`new_season`: add `career: bool = False`), `server.py` (`SeasonRequest.career: bool = False`, `create_season` passes it), `web/season.js` (New season sends `career: true`)
- Test: `tests/test_career.py`

**Interfaces:**
- Produces: `career.new_career(state: dict, coach: Optional[dict]) -> dict` returns and stores `state["career"] = {"year": 2026, "coach": coach_summary, "settings": {"auto_recruit": False}, "saved_week": 0, "saved_at": iso}`; `career.is_career(state: dict) -> bool`.
- `season.new_season(..., career=True)` calls `career.new_career`; with `mode="remaining"` it raises `ValueError("Coach Career starts from week 1")`.

- [ ] **Step 1: Write the failing test** `tests/test_career.py` (script style, `if __name__ == "__main__":`):

```python
st = season.new_season("ohio-state", "full", seed=3, career=True)
assert career.is_career(st) and st["career"]["year"] == 2026 and st["career"]["settings"]["auto_recruit"] is False
plain = season.new_season("ohio-state", "full", seed=3)
assert not career.is_career(plain) and "recruiting" not in plain
season.advance(plain); assert plain["current_week"] == 1          # Review Focus 4: old-style seasons unchanged
try: season.new_season("ohio-state", "remaining", career=True); raise AssertionError("remaining career allowed")
except ValueError: pass
print("career ok")
```

- [ ] **Step 2:** `python tests/run_all.py test_career` → FAIL (`career` not defined).
- [ ] **Step 3:** Implement `career.py` and the `new_season` / server / client changes.
- [ ] **Step 4:** `python tests/run_all.py test_career test_resume test_realdata` → PASS.
- [ ] **Step 5:** Commit: `Coach Career: career state on new seasons`.

### Task 3: Saves that survive restarts

**Files:**
- Modify: `career.py`, `server.py`, `web/season.js`
- Create: `web/careersave.js` (IndexedDB backup, restore, download, upload)
- Test: `tests/test_career.py` (extend)

**Interfaces:**
- Produces: `career.export_save(state: dict) -> bytes` (gzip of the state JSON plus its box scores from `season.box_dir`), `career.import_save(blob: bytes) -> dict` (validates `"career"` and `"id"`, restores boxes, returns state); `career.newer(a: dict, b: dict) -> dict` (higher `career.saved_week`, then `saved_at`).
- Server: `GET /api/season/{id}/export` (application/gzip), `POST /api/season/import` (body: the gzip bytes; keeps the newer of the upload and any server copy by `career.newer`; returns `season.summary`). `career.saved_week`/`saved_at` are updated by `season.save_season` for careers.
- Client: after every completed week and on Download career, `careersave.backup(id)` stores the export in IndexedDB (`cfp-careers`, store `saves`, key = season id). `openSeason` on a 404 for a career id found in IndexedDB uploads it and opens the result. Buttons "Download career" and "Load career" in the season toolbar.

- [ ] **Step 1: Failing test** (extend test_career): round trip and conflict rule.

```python
blob = career.export_save(st); back = career.import_save(blob)
assert back["id"] == st["id"] and back["career"] == st["career"]
older = dict(st, career=dict(st["career"], saved_week=2)); newer = dict(st, career=dict(st["career"], saved_week=5))
assert career.newer(older, newer) is newer and career.newer(newer, older) is newer      # Review Focus 1
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `career.export_save`, `import_save`, `newer`, the endpoints and `web/careersave.js`.
- [ ] **Step 4:** Run the test → PASS. Browser check (scratchpad Playwright): start a career, advance a week, delete `data/seasons/<id>.json` and its box folder, reload `/season?id=<id>` → the season opens at week 1. Then repeat with a server copy newer than the browser copy → the server copy stays.
- [ ] **Step 5:** Commit: `Coach Career: browser-kept saves, restored when the server forgets them`.

---

## Stage 2: Recruiting engine (playable through the API; every school on Auto-recruit)

### Task 4: The class, schools' pulls and interest

**Files:**
- Create: `recruiting.py`
- Modify: `career.py` (`new_career` calls `recruiting.start(state)`), `season.py` (`advance` calls `recruiting.weekly_step(state, week, auto_user)` after games when `"recruiting"` in state)
- Test: `tests/test_recruiting.py`

**Interfaces:**
- Produces: `recruiting.start(state: dict, year: int = 2027) -> None` creates `state["recruiting"] = {"year", "prospects": {pid: prospect}, "lists": {pid: {slug: interest}}, "status": {pid: {"committed": None|slug, "signed": None|slug, "fcs": bool}}, "offers": {slug: [pid]}, "visits": {pid: {slug: week}}, "contacts": {pid: {slug: {"hc_week": int}}}, "hours": {slug: float}, "nil": {slug: {"budget": int, "held": {pid: int}}}, "revealed": {slug: {pid: [topic]}}, "board": [pid], "log": [event]}`. Prospects come from `recruits.generate_class(year, seed=state["rng_state"])` with `taken` = every roster name; each gets `priorities` (top three pitch topics, seeded per prospect) and `home` coordinates.
- `recruiting.pull(state: dict, slug: str, pid: str) -> dict[str, float]`: the fixed pulls by topic (proximity from the distance bands in `recruiting_model.json` national.distance_bands by tier and stars; prestige from `teams[slug].strength.baseline`; winning from `on_field(state, slug, week)`; coach from the measured edge; nil from program level; playing_time from players ahead at the prospect's EA position on that roster; academics from a fixed per-school value, 0.5 default).
- `recruiting.on_field(state: dict, slug: str, week: int) -> float`: blend of last season (model `teams[slug].strength.by_class` latest) and this season's win percentage plus the poll bump (top 10 +0.15, 11-25 +0.07), with the last-season weight from Global Constraints.
- `recruiting.interest(state, slug, pid) -> float`: pulls weighted by the prospect's priorities plus accumulated action points.

- [ ] **Step 1: Failing tests** in `tests/test_recruiting.py`:

```python
st = season.new_season("ohio-state", "full", seed=4, career=True); rc = st["recruiting"]
assert len(rc["prospects"]) == 4092 and all(s["committed"] is None for s in rc["status"].values())   # none committed at week 0
tx = next(p for p in rc["prospects"].values() if p["hometown"]["state"] == "TX" and p["stars"] == 3)
assert recruiting.pull(st, "texas", tx["id"])["proximity"] > recruiting.pull(st, "oregon", tx["id"])["proximity"]
assert recruiting.on_field(st, "ohio-state", 0) > recruiting.on_field(st, "kent-state", 0)
# this season counts more every week: a 7-0 team off a bad year beats its week-0 standing by week 7
fake = dict(st, current_week=7); recruiting._set_record(fake, "kent-state", 7, 0)
assert recruiting.on_field(fake, "kent-state", 7) > recruiting.on_field(st, "kent-state", 0) + 0.2
```

(`_set_record(state, slug, wins, losses)` is a test helper in recruiting.py that marks games played.)

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; `python tests/run_all.py test_play_log` still prints `abb51a974b89dafa`.
- [ ] **Step 5:** Commit: `Recruiting: the class, schools' pulls and prospects' interest`.

### Task 5: Actions, hours, NIL points and areas

**Files:**
- Modify: `recruiting.py`
- Test: `tests/test_recruiting.py` (extend)

**Interfaces:**
- Produces: `recruiting.PITCHES` (the seven topics in Global Constraints), `recruiting._contact_points(prospect, action, pitch) -> float`, `recruiting.AREAS: dict[str, list[str]]` (9 areas: Texas; Florida; Georgia-Carolinas (GA, SC, NC); Deep South (AL, MS, LA, TN, AR); Mid-Atlantic (VA, MD, DC, DE, PA, NJ, WV); Northeast (NY, CT, MA, RI, VT, NH, ME); Midwest (OH, MI, IN, IL, WI, MN, IA, MO, KY, KS, NE, ND, SD); West Coast (CA, OR, WA, HI, AK); Mountain-Southwest (AZ, NV, UT, CO, NM, ID, MT, WY, OK)).
- `recruiting.weekly_hours(state, slug) -> int` (Global Constraints formula); `recruiting.nil_budget(state, slug) -> int` (program level: `round(100 * (1 + prestige_z))`, floor 30 *tune*).
- `recruiting.act(state, slug, pid, action, pitch=None, nil=0) -> dict` with `action` in `"message", "call", "hc_visit", "offer", "official_visit", "pull_offer"`; returns `{"interest": float, "hours_left": float, "revealed": Optional[str]}`; raises `recruiting.RecruitingError(code, message)` (code 400 or 409) for: no hours, signed or committed-elsewhere-and-signed prospect, second official visit, hc_visit within 4 weeks, offer past the cap, no home game left for the visit, nil past the budget.
- A call reveals the next unrevealed priority (stored in `state["recruiting"]["revealed"][slug][pid]`).

- [ ] **Step 1: Failing tests:**

```python
pid = tx["id"]; h0 = recruiting.weekly_hours(st, "ohio-state")
r = recruiting.act(st, "ohio-state", pid, "call", pitch=tx["priorities"][0])
assert r["hours_left"] == h0 - 15 and r["revealed"] in tx["priorities"]
recruiting.act(st, "ohio-state", pid, "hc_visit")
try:
    recruiting.act(st, "ohio-state", pid, "hc_visit"); raise AssertionError("second in-home visit inside 4 weeks allowed")
except recruiting.RecruitingError as e:
    assert e.code == 409
# a pitch on one of his priorities is worth 2x, any other 0.5x: four times as much
off = next(t for t in recruiting.PITCHES if t not in tx["priorities"])
assert recruiting._contact_points(tx, "call", tx["priorities"][0]) == 4 * recruiting._contact_points(tx, "call", off)
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `Recruiting: actions, hours, NIL points and areas`.

### Task 6: The weekly step: AI schools, commitments, flips and signing

**Files:**
- Modify: `recruiting.py`, `season.py` (`advance` hook; `advance_to` passes `auto_user=True` for every week after the first)
- Test: `tests/test_recruiting.py` (extend)

**Interfaces:**
- Produces: `recruiting.weekly_step(state: dict, week: int, auto_user: bool) -> list[dict]` (events: commit, decommit, flip, signed, leaning_fcs); runs, in order: official-visit effects from this week's home games (win +, loss by 21+ −, crowd via stadium capacity), Auto-recruit for every AI FBS school and for yours when `auto_user` or `career.settings.auto_recruit`, commitment and decommitment draws, signing at `SELECTION_WEEK` and after `FINAL_WEEK`, hours reset.
- `recruiting.auto_recruit(state: dict, slug: str) -> None`: board from the school's footprint (state shares from `recruiting_model.json` teams[slug].top_states and in_state_share), its star level (blue_chip_share), open spots by position; spends hours and NIL by the spec's rules.
- `recruiting.open_spots(state, slug) -> int`, `recruiting.signed_class(state, slug) -> list[pid]`.

- [ ] **Step 1: Failing tests** (Review Focus 3 and 5):

```python
st = season.new_season("georgia", "full", seed=5, career=True)
season.advance_to(st, season.FINAL_WEEK)
rc = st["recruiting"]; signed = [s["signed"] for s in rc["status"].values()]
assert all(signed), "a prospect never signed"
from collections import Counter; per = Counter(s for s in signed if s != "FCS")
assert all(per[t] <= recruiting.open_spots(st, t) for t in per), "a school signed past its open spots"
with_fcs = sum(1 for s in signed if s == "FCS") / len(signed); assert 0.25 < with_fcs < 0.45
try: recruiting.act(st, "georgia", next(iter(rc["prospects"])), "message", pitch="nil"); raise AssertionError
except recruiting.RecruitingError as e: assert e.code == 409          # acting on a signed prospect
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; time it: `advance_to(..., FINAL_WEEK)` with recruiting under 20 s more than without (Review Focus 2; print both).
- [ ] **Step 5:** Commit: `Recruiting: the weekly step, AI schools, commitments and signing`.

### Task 7: Real coaches' recruiting ratings from their measured edge

**Files:**
- Modify: `build_teams.py` (after loading coaches: head coach `ratings.recruiting` = `round(50 + 40 * shrunk_edge / 0.25)`, clamped 30-95, where `shrunk_edge = edge * classes / (classes + 3)` from `recruiting_model.json` coaches.current; coaches with no edge keep theirs)
- Test: `tests/test_recruiting.py` (extend)

**Interfaces:**
- Consumes: `recruiting_model.json` `coaches.current[slug] = {"coach", "classes", "edge"}`.
- Produces: engine teams' head coach `ratings.recruiting` used by `recruiting.weekly_hours`.

- [ ] **Step 1: Failing test:** Oregon's head coach rating > Oklahoma's after a rebuild (edge 0.524 vs -0.086); a created coach in a career keeps his own rating.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; rebuild (`python build_teams.py`). **Step 4:** Run → PASS; `test_play_log` fingerprint unchanged (the engine does not read this rating).
- [ ] **Step 5:** Commit: `Real coaches' recruiting ratings from how they really recruit`.

### Task 8: Realism check and tuning

**Files:**
- Create: `tools/check_recruiting.py`, `tests/test_recruiting_realism.py`
- Modify: `recruiting.py` (constants only)

**Interfaces:**
- Consumes: `recruiting_model.json` (teams, national), `season.advance_to`.
- Produces: `tools/check_recruiting.py [seasons]` prints generated against real; the test asserts tolerances on 2 seeds.

- [ ] **Step 1: Failing test** with these tolerances (real values from recruiting_model.json):

```python
# class size: Power 4 mean 19.5-24.5 (real 21.7), Group of 5 16.5-21.5 (real 18.9)
# FBS in-state share 0.30-0.42 (real ~0.36); median distance 220-340 mi (real ~280)
# 18 +/- 6 schools with blue-chip share >= 0.50; no school more than 6 five-stars
# rank correlation of class strength with the real baseline >= 0.75
# commitments: >= 50% of eventual FBS signees committed before week 12; 80-90% sign at SELECTION_WEEK
# decommitments among the top 300: 8-22%
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Tune the *tune* constants in recruiting.py (record each change and its effect in the commit message). **Step 4:** Run → PASS on both seeds. Also run Task 6's timing.
- [ ] **Step 5:** Commit: `Recruiting tuned to real classes` with the before/after numbers.

---

## Stage 3: Scouting and Prospect Profiles (playable through the API)

### Task 9: Staff, areas and reads

**Files:**
- Modify: `recruiting.py`, `career.py` (`new_career` creates staff)
- Test: `tests/test_scouting.py`

**Interfaces:**
- Produces: `state["career"]["staff"] = [{"id", "role": "OC"|"DC"|"Recruiter", "name", "evaluation": int, "recruiting": int, "area": str}]` (OC and DC from the team's coordinators, evaluation = their `player_development`; 3 recruiters with generated names (recruits model names) and ratings drawn 40-80, seeded); `recruiting.assign(state, staff_id, area) -> None`.
- `recruiting.look(state, pid, evaluator_rating: int, rng) -> None` adds one look per group (athleticism, size_strength, technique, football_iq, potential, coachability) to `state["recruiting"]["reads"][pid]` (a running weighted mean and precision; look error sd = `12 * (1 - s) + 2` in grade points with `s = rating / 99`); `weekly_step` gives one look to every prospect in each staffed area.
- `recruiting.grade_range(state, pid, group) -> tuple[str, str]` letter grades A+ to F; the range is the read ± `z * sd` with `z = 0.6 + 1.1 * s` (s of the staff member who gave most of the looks): about 70% of truths at s 0.4, 79% at 0.6, 90% at 0.95, so weak evaluators are sometimes tight and wrong.
- Hidden prospects: two-stars and three-stars under composite 0.82 are hidden at rate 15% (seeded) until any look.

- [ ] **Step 1: Failing tests** over 500 prospects after 4 looks: an average evaluator's (60) ranges contain the true grade 72-88% of the time, an elite one's (95) 85-95%, and a weak one's (40) ranges are wider yet miss more often (some tight and wrong); looks never reset when an area is reassigned; a hidden prospect is absent from the public list until looked at.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `Scouting: staff, areas and reads that can be wrong`.

### Task 10: Prospect Profile data: evaluations and comps

**Files:**
- Create: `prospects.py` (profile assembly, evaluation text, comps)
- Test: `tests/test_scouting.py` (extend)

**Interfaces:**
- Produces: `prospects.profile(state: dict, pid: str, viewer: str) -> dict` with `public` (name, avatar seed, hometown, high school, size, position, archetype, stars, composite, national/position/state rank, list with leader, offers, visits, status), `evaluation` (top 300 by national rank only: strengths, weaknesses, outlook; text built from his public profile's three strongest and two weakest groups for his position), `public_comp` (top 300 only), `our_grades` (from Task 9), `our_comp` (when every group has at least 3 looks).
- `prospects.comp(profile_vector: dict, position: str, pool: list[dict]) -> Optional[dict]`: nearest starter (the real 2026 depth-chart starters at the same EA position, plus career-season starters later) by attribute distance; returns None when the distance exceeds `COMP_MAX_DISTANCE` (*tune*: about the 30th percentile of starter-to-starter distances at the position).

- [ ] **Step 1: Failing tests:** rank-1 prospect has an evaluation and a public comp who is a starter at his position; rank 900 has neither; a two-star with no close starter gets `public_comp` None; `our_comp` is None before scouting and appears after 3 looks per group; the evaluation names his true strongest public group.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `Prospect Profiles: evaluations for the top 300 and comps only to starters`.

---

## Stage 4: The screens (playable in the browser)

### Task 11: Recruiting API

**Files:**
- Modify: `server.py`
- Test: `tests/test_recruiting_api.py` (FastAPI TestClient)

**Interfaces:**
- `GET /api/season/{id}/recruiting` → `{"week", "hours_left", "hours", "nil": {"budget", "held"}, "open_spots", "offers_left", "board": [prospect rows], "recap": [events since last week], "auto_recruit": bool}`
- `GET /api/season/{id}/prospects?position=&stars=&state=&status=&q=&offset=&limit=` → `{"total", "rows"}` (hidden prospects excluded)
- `GET /api/season/{id}/prospect/{pid}` → `prospects.profile(..., viewer=state["team"])`
- `POST /api/season/{id}/recruit` body `{"pid", "action", "pitch"?, "nil"?}` → the `act` result; `RecruitingError` → its code; 409 while a sim runs
- `POST /api/season/{id}/board` body `{"pid", "on": bool}`; `POST /api/season/{id}/staff` body `{"staff_id", "area"}`; `POST /api/season/{id}/settings` accepts `auto_recruit`
- Non-career seasons: every recruiting route returns 404 `{"detail": "not a Coach Career"}`.

- [ ] **Step 1: Failing tests** for each route's happy path and Review Focus 5 (no hours → 409, unknown pid → 404, during a running sim → 409, non-career → 404).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `Recruiting API`.

### Task 12: Recruiting, Prospects and Staff tabs

**Files:**
- Create: `web/recruiting.js`
- Modify: `web/season.html` (tabs `recruiting`, `prospects`, `staff`, shown only for careers; week banner "Recruit → Your game → Advance"), `web/season.js` (load recruiting.js views, refresh after advance), `web/styles.css`

**Interfaces:**
- Consumes: Task 11 routes.
- Produces: Recruiting tab (board table with interest bars, leader, status; per-row actions with hour costs and a pitch picker; hours and NIL meters; Auto-recruit toggle; weekly recap list), Prospects tab (filters and paging, row opens the Prospect Profile modal: public block, evaluation, comps, our grades as ranges), Staff tab (staff cards with ratings and an area select).

- [ ] **Step 1:** Build the three tabs and the profile modal; phone width 390 px has no horizontal page scroll.
- [ ] **Step 2:** Browser check (scratchpad Playwright, phone and desktop): start a career, add 5 prospects to the board, spend all hours (the meter reaches 0 and further actions show the 409 message), assign a recruiter to Texas, advance 3 weeks, see the recap and a commitment, open a profile with "Our comp". No page errors.
- [ ] **Step 3:** Commit: `Coach Career: Recruiting, Prospects and Staff tabs`.

### Task 13: End-to-end, docs and the full suite

**Files:**
- Create: `tests/test_career_e2e.py` (Playwright if importable, else skipped with a printed reason)
- Modify: `docs/HOW_IT_WORKS.md` (a "Coach Career" section with the realism numbers from Task 8), `README.md` (the Coach Career mode), `docs/PLAYER_DEVELOPMENT.md` status line

- [ ] **Step 1:** The e2e test runs a career from week 0 to national signing day with Auto-recruit, then downloads the save, deletes the server copy, uploads it and checks the signed class is intact.
- [ ] **Step 2:** `python tests/run_all.py` → every test passes; the fingerprint is `abb51a974b89dafa`.
- [ ] **Step 3:** Commit: `Coach Career: end-to-end test and docs`; push the branch.
