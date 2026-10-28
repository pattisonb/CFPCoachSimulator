# Recruiting Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recruiting reads in words, badges a few generational prospects and your staff's gems, shows the board as a five-column pipeline with a US map, and plays calls and in-home visits as two-step scenes, while AI schools and Auto-recruit keep recruiting unchanged.

**Architecture:** Backend changes live in `coach_career/recruiting.py` (word cuts, the generational draw, the stage snapshot, the scene lifecycle inside the one `_act` path), a new `coach_career/scenes.py` (the line bank and the cue), and `coach_career/prospects.py` (viewer-side flags: `generational`, `find`, `stage_move`, `home`). The server grows one optional request field. The frontend is `web/recruiting.js` (pipeline, pane, race, scenes), a new `web/us-map.js` (the map card and the Albers USA projection), a generated `web/us-states.js` (state outlines) and `web/styles.css`. Every CPU path (`auto_recruit`, `_auto_week`, AI boards) is untouched; only the player's client calls the new scene form.

**Tech Stack:** Python 3.13, FastAPI, vanilla JS (`window.CFP.el`), Playwright for the UX sweep, `tests/run_all.py` (each test is a script run as `python tests/<file>.py`).

**Spec:** `docs/superpowers/specs/2026-10-28-recruiting-experience-design.md`

## Global Constraints

- Word cuts: All-American 90, Elite 80, Strong 65, Solid 50, Fair 40, Weak below 40. The word "Generational" is only the public tag; no grade ever reads "Generational".
- Generational: drawn once per class from four- and five-stars with true potential ≥ `GENERATIONAL_FROM = 95`, odds `{5: 0.4, 4: 0.1}`, cap `GENERATIONAL_MAX = 4` (the highest true potentials keep the tag past the cap), seeded from the class seed; ask × `GENERATIONAL_ASK = 1.5`.
- Gem: read low end on potential ≥ 80 and (stars ≤ 3 or rank > `GEM_RANK = 300`). Bust risk: read high end on potential < 50 and stars ≥ 4. Both need `FIND_LOOKS = 2` looks. Never read from the truth.
- Scenes: only `call` and `hc_visit` open one; `message` stays one tap. Points, backfire (`BACKFIRE`, `BACKFIRE_COST`), cooled, `DIMINISH`, `WEEKLY_ONCE`, `HC_VISIT_GAP` are unchanged. `CUE_TWO_SIDED = 0.5`. An abandoned scene adds no points and clears at the week step.
- CPU parity: `auto_recruit`, `_auto_week`, `best_pitch`, `CALL_REVEAL` keep working on the one-shot `_act(..., pitch=...)` path. The one-shot call with a pitch stays valid for the player.
- House copy: word scales, never a number out of 100; costs on the controls; every control says what it does or why it is off. Colours from theme variables so both themes read.
- The sim golden test is re-recorded once (Task 3) and must stay identical afterwards.
- Tests run as scripts: `python tests/test_x.py`; the whole suite with `python tests/run_all.py`.

## Review Focus

1. A career saved before this change (no `generational`, no `scenes`, no stage snapshot) loads, draws its generational tag, shows no stage move for one week, and never errors on the board. Test in Task 3 and Task 5.
2. A scene left open when the week advances, or when Auto-recruit turns on, must not double-spend hours or leave a dangling "Finish the call" after the week step. Test in Task 6.
3. A prospect in the Committed column who is committed elsewhere must still show his flip odds and allow Message, Call and Visit per today's rules; one committed to you shows no actions. Test in Task 8.
4. The map must place a Texas prospect inside Texas and an Alaska or Hawaii prospect in the inset, and a hometown without coordinates must fall back to his state's centre, never off the canvas. Test in Task 7 and Task 9.
5. On a 400px phone the detail pane must be reachable right after a tap, and the pipeline must never scroll the page sideways. Test in Task 8 and Task 11.

---

### Task 1: Word grades (backend)

**Files:**
- Modify: `coach_career/recruiting.py:189-199` (constants), `:1783-1820` (`letter`, `read_interval`, `grade_range`)
- Modify: `coach_career/prospects.py:45` (docstring of the cuts), `:330-342` (`_evaluation` docstring)
- Test: `tests/test_scouting.py`

**Interfaces:**
- Produces: `recruiting.WORDS: tuple[str, ...] = ("All-American", "Elite", "Strong", "Solid", "Fair", "Weak")`, `recruiting.WORD_FLOORS = (90, 80, 65, 50, 40, -1e9)`, `recruiting.word(points: float) -> str`, `recruiting.WORD_SLACK: float`. `grade_range(state, pid, group) -> Optional[tuple[str, str]]` returns `(low_word, high_word)`. `recruiting.LETTERS`, `LETTER_FLOORS`, `letter` and `LETTER_SLACK` are removed.

- [ ] **Step 1: Write the failing tests** in `tests/test_scouting.py`, replacing the letter assertions at lines 29-30, 119 and 128:

```python
assert [recruiting.word(v) for v in (95, 90, 85, 80, 70, 65, 55, 50, 45, 40, 30)] == \
    ["All-American", "All-American", "Elite", "Elite", "Strong", "Strong", "Solid", "Solid", "Fair", "Fair", "Weak"]
assert "Generational" not in recruiting.WORDS
assert eighties and all(recruiting.word(q["truth"]["athleticism"]) in ("All-American", "Elite") for q in eighties)
# coverage() keeps its band: WORDS.index replaces LETTERS.index in the held check
```

In `coverage()` use `recruiting.WORDS.index(recruiting.word(...))` for `truth`, `hi_l`, `lo_l`. Keep the existing coverage band assertions (68% at 40, 81% at 60, 92% at 95, each with its current tolerance) unchanged.

- [ ] **Step 2: Run to verify it fails**

Run: `python tests/test_scouting.py`
Expected: FAIL with `AttributeError: module 'coach_career.recruiting' has no attribute 'word'`

- [ ] **Step 3: Implement** in `coach_career/recruiting.py`: replace `LETTERS`/`LETTER_FLOORS` with `WORDS`/`WORD_FLOORS`, rename `letter` to `word`, rename `LETTER_SLACK` to `WORD_SLACK` and retune it (start at 4.0; a word spans 10-15 points where a letter spanned 5-7, so the slack that keeps the coverage band is larger) until the three coverage assertions pass. Update the `grade_range` docstring example to `("Solid", "Strong")`. In `prospects.py` change the comment on line 45 to "a Solid-and-up read is a strength (60), below 45 a weakness" and the `_evaluation` docstring to say Strong/Solid/Fair instead of B and C.

- [ ] **Step 4: Run to verify it passes**

Run: `python tests/test_scouting.py && python tests/test_recruiting.py && python tests/test_recruiting_api.py`
Expected: each prints its final ok line; grep the repo for `LETTERS`, `letter(` and `LETTER_SLACK` and expect no hits outside git history.

- [ ] **Step 5: Commit**

```bash
git add coach_career/recruiting.py coach_career/prospects.py tests/test_scouting.py
git commit -m "Scouting grades read in words: All-American, Elite, Strong, Solid, Fair, Weak"
```

---

### Task 2: Word grades (frontend)

**Files:**
- Modify: `web/recruiting.js:336-343` (`scoutLine`), `:620-624` (Prospects potential column), `:751-780` (profile grade cells and the tooltip legend), the Staff screen's explanatory copy in `renderStaff`
- Modify: `web/styles.css` (a `.go-word` class per tier for colour)
- Test: `tests/test_ux_sweep.py`

**Interfaces:**
- Consumes: `our_grades: {group: [low_word, high_word]}`, `our_potential: [low_word, high_word]` from Task 1.
- Produces: `wordTag(word: string) -> HTMLElement` in `recruiting.js`, a `.go-word.<tier>` span (tier = the word lower-cased with the hyphen kept: `all-american`, `elite`, `strong`, `solid`, `fair`, `weak`), reused by Tasks 8 and 10.

- [ ] **Step 1: Write the failing test** in `tests/test_ux_sweep.py`, after the profile assertions (around line 100):

```python
LETTER = re.compile(r"(^|\s)[A-D][+-]?(\s|$)|(^|\s)F(\s|$)")
grades = page.inner_text(".go-profile .go-grades") + " " + page.inner_text(".go-profile .go-scouted")
assert not LETTER.search(grades), f"a letter grade on the profile: {LETTER.search(grades).group(0)!r}"
assert any(w in grades for w in ("All-American", "Elite", "Strong", "Solid", "Fair", "Weak")), grades
assert "Generational" not in grades, "the grade tier must never read as the generational tag"
assert "C+ starts at 50" not in page.inner_text(".go-profile"), "the letter legend is gone"
```

- [ ] **Step 2: Run to verify it fails**

Run: `python tests/test_ux_sweep.py`
Expected: FAIL on the letter assertion (grades still read like "B- to A").

- [ ] **Step 3: Implement**: `scoutLine` and the profile cells render `wordTag` per end of the range joined with " to " (one tag when both ends match). Replace the tooltip legend sentence with: "on the game's scale (50 is the middle Power 4 starter: Solid from 50, Strong from 65, Elite from 80, All-American from 90)". The Prospects column reads `Potential Solid to Strong`. Add `.go-word` styles: a pill with the tier colours from theme tokens (`--good` for All-American and Elite, text colour for Strong and Solid, `--muted` for Fair and Weak).

- [ ] **Step 4: Run to verify it passes**

Run: `python tests/test_ux_sweep.py`
Expected: prints its final ok line.

- [ ] **Step 5: Commit**

```bash
git add web/recruiting.js web/styles.css tests/test_ux_sweep.py
git commit -m "Board, Prospects and the profile read grades in words"
```

---

### Task 3: Generational prospects

**Files:**
- Modify: `coach_career/recruiting.py` (constants after line 101; `start` at 228-260; `ask_from` at 316; a new `draw_generational` and `upgrade_generational` beside `upgrade_asks` at 298)
- Modify: `coach_career/prospects.py:344-385` (`profile`), `:393-416` (`row`), `:583-612` (`national_classes` top rows)
- Modify: `sim/season.py:1868-1869` (call `upgrade_generational` on load)
- Modify: `tests/golden/sim_seed11_two_weeks.json` (re-recorded)
- Test: `tests/test_recruiting.py`, `tests/test_recruiting_realism.py`, `tests/test_sim_golden.py`

**Interfaces:**
- Produces: `GENERATIONAL_FROM = 95`, `GENERATIONAL_ODDS = {5: 0.4, 4: 0.1}`, `GENERATIONAL_MAX = 4`, `GENERATIONAL_ASK = 1.5`; `draw_generational(rc: dict) -> list[str]` (pure: reads `rc["prospects"]` and `rc["seed"]`, returns pids, highest true potential first); `is_generational(state, pid) -> bool`; `upgrade_generational(state) -> bool`; `rc["generational"]: list[str]`. Every prospect view (`row`, `board_row` via `row`, `profile()["public"]`, `national_classes()["schools"][i]["top"][j]`) carries `generational: bool`.

- [ ] **Step 1: Write the failing tests** in `tests/test_recruiting.py` (a new block after the class assertions):

```python
gen = rc["generational"]
assert gen == recruiting.draw_generational(rc), "the draw is seeded: drawing again gives the same list"
assert len(gen) <= recruiting.GENERATIONAL_MAX
assert all(rc["prospects"][q]["stars"] >= 4 and rc["prospects"][q]["truth"]["potential"] >= recruiting.GENERATIONAL_FROM for q in gen)
assert all(rc["prospects"][gen[i]]["truth"]["potential"] >= rc["prospects"][gen[i + 1]]["truth"]["potential"] for i in range(len(gen) - 1))
# a class with no qualifier has none; a class of only qualifiers stays under the cap
fake = {"seed": 1, "prospects": {q: dict(p, truth=dict(p["truth"], potential=50.0)) for q, p in list(rc["prospects"].items())[:200]}}
assert recruiting.draw_generational(fake) == []
fake = {"seed": 1, "prospects": {q: dict(p, stars=5, truth=dict(p["truth"], potential=99.0)) for q, p in list(rc["prospects"].items())[:200]}}
assert len(recruiting.draw_generational(fake)) == recruiting.GENERATIONAL_MAX
# over many seeds the count is a few, often none: never a guaranteed number
counts = [len(recruiting.draw_generational(dict(rc, seed=s))) for s in range(40)]
assert min(counts) <= 1 and 1.0 <= sum(counts) / len(counts) <= 5.0, counts
if gen:
    g = gen[0]
    assert recruiting.ask_from(st, "ohio-state", g) == int(round(recruiting.GENERATIONAL_ASK * recruiting.ask_from(dict(st, recruiting=dict(rc, generational=[])), "ohio-state", g)))
    assert prospects.row(st, g, "ohio-state")["generational"] and prospects.profile(st, g, "ohio-state")["public"]["generational"]
# an old save draws on load
rc.pop("generational")
assert recruiting.upgrade_generational(st) and rc["generational"] == gen and not recruiting.upgrade_generational(st)
```

In `tests/test_recruiting_realism.py` add, where signed classes are measured: among the generational prospects of both seeds' classes (skip the assertion if there are none in either), at least 80% sign with a school whose class rank is 25 or better.

- [ ] **Step 2: Run to verify it fails**

Run: `python tests/test_recruiting.py`
Expected: FAIL with `KeyError: 'generational'`

- [ ] **Step 3: Implement** `draw_generational(rc)`: candidates are prospects with `stars >= 4` and `truth["potential"] >= GENERATIONAL_FROM`, sorted by `(-truth potential, id)`; each draws `random.Random(f"generational-{rc['seed']}-{pid}").random() < GENERATIONAL_ODDS[stars]`; keep the first `GENERATIONAL_MAX` of those drawn in that order. `start` sets `rc["generational"]` after `_truths`. `upgrade_generational` fills a missing key and returns whether it did; `sim/season.py` calls it next to `upgrade_asks`. `ask_from` multiplies its result by `GENERATIONAL_ASK` when `is_generational`. Views add `generational` as listed in Interfaces. The portal block has no generational prospects (`is_generational` is False when the key is missing or the block is the portal).

- [ ] **Step 4: Run to verify it passes, then re-record the golden**

Run: `python tests/test_recruiting.py && python tests/test_recruiting_realism.py`
Expected: both print their ok lines.
Run: `python tests/test_sim_golden.py`
Expected: FAIL on `recruiting_sha256` (asks moved for the tagged prospects). Then `python tests/test_sim_golden.py --record && python tests/test_sim_golden.py` and expect `sim golden ok`.

- [ ] **Step 5: Commit**

```bash
git add coach_career/recruiting.py coach_career/prospects.py sim/season.py tests/test_recruiting.py tests/test_recruiting_realism.py tests/golden/sim_seed11_two_weeks.json
git commit -m "Generational prospects: a seeded draw among the top four- and five-stars, a few a class, public, with a bigger ask (golden re-recorded)"
```

---

### Task 4: Gems and bust risk

**Files:**
- Modify: `coach_career/recruiting.py` (constants `GEM_RANK = 300`, `FIND_LOOKS = 2` after the generational constants)
- Modify: `coach_career/prospects.py` (new `find(state, pid) -> Optional[str]`; `row`, `profile`, `class_detail`)
- Test: `tests/test_scouting.py`

**Interfaces:**
- Consumes: `recruiting.read_interval(state, pid, "potential") -> (lo, hi)`, `rc["reads"][pid]["looks"]`.
- Produces: `prospects.find(state, pid) -> Optional[str]` returning `"gem"`, `"bust"` or `None`; `row()["find"]`, `profile()["find"]`; `class_detail()` rows for the viewer's signees add `find_held: Optional[bool]` (True when the find matched the truth: a gem's true potential ≥ 80, a bust's < 50; None when there was no find).

- [ ] **Step 1: Write the failing test** in `tests/test_scouting.py`:

```python
# a gem is your staff's read, never the truth: force a tight high read on a two-star and he reads as a gem
two = next(pid for pid, q in rc["prospects"].items() if q["stars"] == 2 and not q.get("hidden"))
rc["reads"][two] = {"looks": 3, "by": {"95": 3}, "g": {g: [88.0, 100.0] for g in recruiting.GROUPS}}
assert prospects.find(st, two) == "gem" and prospects.row(st, two, "ohio-state")["find"] == "gem"
rc["reads"][two]["looks"] = 1
assert prospects.find(st, two) is None, "a find needs FIND_LOOKS looks"
five = next(pid for pid, q in rc["prospects"].items() if q["stars"] == 5)
rc["reads"][five] = {"looks": 3, "by": {"95": 3}, "g": {g: [40.0, 100.0] for g in recruiting.GROUPS}}
assert prospects.find(st, five) == "bust"
rc["reads"][five]["g"]["potential"] = [88.0, 100.0]
assert prospects.find(st, five) is None, "a five-star reading Elite is just a five-star"
# the find is judged when he signs with you
rc["status"][two].update(signed="ohio-state", committed="ohio-state")
held = next(r for r in prospects.class_detail(st, "ohio-state", "ohio-state") if r["id"] == two)["find_held"]
assert held == (rc["prospects"][two]["truth"]["potential"] >= 80)
```

- [ ] **Step 2: Run to verify it fails**

Run: `python tests/test_scouting.py`
Expected: FAIL with `AttributeError: module 'coach_career.prospects' has no attribute 'find'`

- [ ] **Step 3: Implement** `find` per the Global Constraints, using `read_interval` on `"potential"` and the prospect's `stars` and `rank`; `None` for portal prospects and before `FIND_LOOKS` looks. `class_detail` computes `find_held` only for rows whose signer is the viewer, from `find` and `p["truth"]["potential"]`.

- [ ] **Step 4: Run to verify it passes**

Run: `python tests/test_scouting.py`
Expected: ok line.

- [ ] **Step 5: Commit**

```bash
git add coach_career/recruiting.py coach_career/prospects.py tests/test_scouting.py
git commit -m "Gems and bust risk: your staff's finds from the read, judged when he signs with you"
```

---

### Task 5: Stage snapshot, stage move, map data on the view

**Files:**
- Modify: `coach_career/recruiting.py:930-947` (`_snapshot_ranks`)
- Modify: `coach_career/prospects.py:423-447` (`board_row`), `:621-660` (`recruiting_view`), `:393-416` (`row`: `home`)
- Test: `tests/test_recruiting.py`

**Interfaces:**
- Produces: `rc["stages"]: {pid: {"week": int, "now": str, "prev": Optional[str]}}` for the viewer's board and offers, written in `_snapshot_ranks`; `board_row()["stage_move"]: "up" | "down" | None` (the stage order is `STAGES`; committed-elsewhere counts as no move); `row()["home"]: [lat, lon]`; `recruiting_view()["areas"]: {area_name: [state codes]}` (replacing the list of names; the Staff screen reads `Object.keys`).

- [ ] **Step 1: Write the failing test** in `tests/test_recruiting.py`, after an action and a week step already in the file:

```python
# the stage snapshot: a prospect who was cold and was called this week moved up at the week step
rc["board"] = [pid] + [q for q in rc["board"] if q != pid]
assert recruiting.stage(st, "ohio-state", pid) in ("contact", "top", "visited")
recruiting._snapshot_ranks(st, st["current_week"])
assert rc["stages"][pid]["now"] == recruiting.stage(st, "ohio-state", pid)
b = prospects.board_row(st, pid, "ohio-state")
assert b["stage_move"] in ("up", None) and b["home"] == rc["prospects"][pid]["home"]
v = prospects.recruiting_view(st)
assert v["areas"]["Texas"] == ["TX"] and set(v["areas"]) == set(recruiting.AREAS)
# an old save without the snapshot shows no move
rc.pop("stages")
assert prospects.board_row(st, pid, "ohio-state")["stage_move"] is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `python tests/test_recruiting.py`
Expected: FAIL with `KeyError: 'stages'`

- [ ] **Step 3: Implement**: `_snapshot_ranks` records, for `pids = board ∪ offers[me]`, `stages[pid] = {"week": week, "now": stage(...), "prev": previous now or None}`; `board_row` derives `stage_move` by comparing `STAGES.index` of `now` and `prev` when both are in `STAGES` and the snapshot week is the current week or the week before. Update `renderStaff` in `web/recruiting.js` to iterate `Object.keys(v.areas)` so the Staff screen keeps working.

- [ ] **Step 4: Run to verify it passes**

Run: `python tests/test_recruiting.py && python tests/test_recruiting_api.py && python tests/test_sim_golden.py`
Expected: ok lines; the golden stays identical (`stages` is not in its digest).

- [ ] **Step 5: Commit**

```bash
git add coach_career/recruiting.py coach_career/prospects.py web/recruiting.js tests/test_recruiting.py
git commit -m "The week step snapshots each board prospect's stage; the view carries his move, his coordinates and the areas' states"
```

---

### Task 6: Scenes (backend and API)

**Files:**
- Create: `coach_career/scenes.py`
- Modify: `coach_career/recruiting.py` (`HOURS` gains `"pitch": 0`; `_act` at 995-1120; `_flush` at 917; `act` at 886)
- Modify: `server.py:339-343` (`RecruitRequest.scene`), `:935-943` (`recruit_action` passes `scene`), `:813-832` (settings: Auto-recruit on clears scenes)
- Modify: `tools/check_recruiting.py` (a `reveal_rate(seed)` function and its line in `main`)
- Test: `tests/test_recruiting.py`, `tests/test_recruiting_api.py`

**Interfaces:**
- Produces in `scenes.py`: `CUE_TWO_SIDED = 0.5`; `open_scene(state, slug, pid, action, week) -> dict` returning `{"id": str, "action": str, "week": int, "lines": list[str], "cue": {"topics": list[str], "text": str}, "ask": dict}` where `cue.topics` has one true unrevealed priority or two topics (one true, one not) and the `id` is `f"{action}-{pid}-{week}"`; `reaction(state, slug, pid, action, pitch, p) -> dict` returning `{"kind": "hit" | "polite" | "quiet", "text": str}`; `LINES: dict[str, dict[str, list[str]]]` keyed `topic -> {"cue", "hit", "polite", "quiet"}` with at least three variants each, templated with `{name}`, `{first}`, `{town}`, `{state}`, `{school}`, `{position}`, `{role}` (from `strengths()["playing_time"]`: "start", "compete", "wait"), `{record}`; two-sided cue lines under `LINES["_two_sided"]` with `{a}` and `{b}` topic phrases; one `COLOUR` list and one `FAMILY` list for the in-home visit.
- Produces in `recruiting.py`: `_act` with `action in ("call", "hc_visit") and pitch is None` opens a scene (spends hours, marks `WEEKLY_ONCE`/`hc_week`/`last_contact`, bumps nothing else, stores `rc["scenes"][slug][pid]`, returns the scene via `act()["scene"]`); `action == "pitch"` with `scene` id and `pitch` applies today's points for the stored action through `_contact_points`, runs `_reveal` on the pitched topic when it is a priority (`hit` or `quiet`), increments `contact["n"]`, clears the scene and returns `act()["reaction"]`; `_flush` drops every open scene; `clear_scenes(state, slug) -> None`. `act(state, slug, pid, action, pitch=None, nil=0, scene=None) -> dict`.
- `RecruitRequest.scene: Optional[str] = None`.

- [ ] **Step 1: Write the failing tests** in `tests/test_recruiting.py`:

```python
# a call without a pitch opens a scene: hours spent, the week marked, no points yet
from coach_career import scenes
q = next(x for x in rc["prospects"] if x not in rc["contacts"] and not rc["prospects"][x].get("hidden"))
rc["hours"]["ohio-state"] = 100
r = recruiting.act(st, "ohio-state", q, "call")
sc = r["scene"]
assert r["hours_left"] == 85 and sc["action"] == "call" and 2 <= len(sc["lines"]) <= 4
assert set(sc["cue"]["topics"]) & set(rc["prospects"][q]["priorities"]) and len(sc["cue"]["topics"]) in (1, 2)
assert recruiting.pending(st, "ohio-state", q) == 0.0 and rc["scenes"]["ohio-state"][q]["id"] == sc["id"]
try:
    recruiting.act(st, "ohio-state", q, "call"); raise AssertionError("a second call this week")
except recruiting.RecruitingError as e:
    assert e.code == 409
# the pitch finishes it: a priority at strength lights him up and is revealed; points are today's
pri = next(t for t in sc["cue"]["topics"] if t in rc["prospects"][q]["priorities"])
with recruiting.forced_strength(st, "ohio-state", q, pri, 0.9):
    r = recruiting.act(st, "ohio-state", q, "pitch", pitch=pri, scene=sc["id"])
    want = recruiting._contact_points(st, "ohio-state", rc["prospects"][q], "call", pri)
assert r["reaction"]["kind"] == "hit" and pri in rc["revealed"]["ohio-state"][q]
assert abs(recruiting.pending(st, "ohio-state", q) - want) < 1e-6 and q not in rc["scenes"]["ohio-state"]
# quiet: a priority where you are weak backfires and logs not_buying; polite: not a priority
st["current_week"] += 1
sc = recruiting.act(st, "ohio-state", q, "call")["scene"]
other = next(t for t in recruiting.PITCHES if t not in rc["prospects"][q]["priorities"])
assert recruiting.act(st, "ohio-state", q, "pitch", pitch=other, scene=sc["id"])["reaction"]["kind"] == "polite"
st["current_week"] += 1
sc = recruiting.act(st, "ohio-state", q, "call")["scene"]
pri2 = rc["prospects"][q]["priorities"][-1]
with recruiting.forced_strength(st, "ohio-state", q, pri2, 0.1):
    r = recruiting.act(st, "ohio-state", q, "pitch", pitch=pri2, scene=sc["id"])
assert r["reaction"]["kind"] == "quiet" and any(e["kind"] == "not_buying" and e["pid"] == q for e in rc["log"])
# a wrong scene id is refused; an abandoned scene adds nothing and clears at the week step
st["current_week"] += 1
sc = recruiting.act(st, "ohio-state", q, "call")["scene"]
try:
    recruiting.act(st, "ohio-state", q, "pitch", pitch=pri, scene="nope"); raise AssertionError("a stale scene id")
except recruiting.RecruitingError as e:
    assert e.code == 409
landed = rc["lists"][q].get("ohio-state", 0.0) + recruiting.pending(st, "ohio-state", q)
recruiting._flush(st, st["current_week"])
assert not rc["scenes"].get("ohio-state"), "the week step clears open scenes"
assert abs(rc["lists"][q].get("ohio-state", 0.0) - landed) < 1e-6, "an abandoned scene added no points"
assert any(e["kind"] == "hung_up" and e["pid"] == q for e in rc["log"]), "the report notes the call you never finished"
# Auto-recruit on clears scenes; the one-shot call with a pitch still works and the CPU coin flip stands
st["current_week"] += 1
recruiting.act(st, "ohio-state", q, "call")
recruiting.clear_scenes(st, "ohio-state")
assert not rc["scenes"].get("ohio-state")
st["current_week"] += 1
assert "scene" not in recruiting.act(st, "ohio-state", q, "call", pitch=pri)
calls = [recruiting._act(st, "texas", x, "call", None, 0) for x in list(rc["prospects"])[:60]]
assert 0.25 <= sum(1 for c in calls if c) / len(calls) <= 0.75
# an in-home visit scene carries his number
st["current_week"] += 4
sc = recruiting.act(st, "ohio-state", q, "hc_visit")["scene"]
assert sc["ask"].get("exact") == recruiting.ask_from(st, "ohio-state", q)
```

Note the CPU line above: `_act(..., "call", None, 0)` from a non-player school must keep today's coin-flip behaviour, so `_act` opens a scene only when `slug == state["team"]`; the AI path with `pitch=None` is unchanged.

In `tests/test_recruiting_api.py` add: `POST /recruit {pid, action: "call"}` returns 200 with `scene.id`; `POST /recruit {pid, action: "pitch", scene, pitch}` returns `reaction.kind`; `POST /settings {auto_recruit: "week"}` after an open scene leaves `GET /recruiting` rows with `scene: null`.

- [ ] **Step 2: Run to verify it fails**

Run: `python tests/test_recruiting.py`
Expected: FAIL with `KeyError: 'scene'`

- [ ] **Step 3: Implement `coach_career/scenes.py`** with the line bank and the two functions. Cue choice: the first of his priorities not in `rc["revealed"][slug][pid]` (if all three are revealed, the first priority); two-sided with `random.Random(f"cue-{rc['seed']}-{slug}-{pid}-{week}").random() < CUE_TWO_SIDED`, the decoy drawn from `PITCHES` minus his priorities. `reaction` kind: `hit` when `pitch in p["priorities"] and strength >= BACKFIRE`, `quiet` when `pitch in p["priorities"]` and below, else `polite`. Write lines in his voice, present tense, short, no numbers; a visit's `lines` prepend one `FAMILY` line and append his exact ask in words ("his dad asks what the collective can do: {ask} points").

- [ ] **Step 4: Implement the lifecycle in `recruiting.py`** per Interfaces. The scene-open branch runs every check that the one-shot call runs (hours, weekly-once, visit gap), spends the hours and marks the contact, then stores and returns the scene without touching `contact["n"]` or points. The `pitch` branch requires `rc["scenes"][slug][pid]["id"] == scene` (409 "no open call with him" otherwise), then runs the one-shot path's point code for the stored action with the pitch: `_contact_points` divided by `(1 + DIMINISH * contact["n"])`, `COOLED_CONTACT`, `_add_points`, `not_buying` on negative points, `contact["n"] += 1`; `_reveal` is replaced for scenes by marking the pitched topic revealed when it is a priority (append to `rc["revealed"][slug][pid]` if absent). `act()` returns `{"hours_left", "revealed", "scene"?}` or `{"hours_left", "reaction"}`. `_flush` logs a `hung_up` event (`_event(state, "hung_up", pid, slug)`, added to `REPORT_KINDS`) for every open scene of the player's school, then sets `rc["scenes"] = {}`. `server.py` passes `req.scene` and calls `recruiting.clear_scenes(state, state["team"])` when Auto-recruit turns on. `tools/check_recruiting.py` gains `reveal_rate(seed) -> float`: a fresh career, the first 100 visible unhidden prospects, for each a call scene, the pitch chosen as the first cue topic (a two-sided cue picks the first named), count `hit` and `quiet` reactions; print `player reveal rate` in `main`. Expected band 0.55-0.75; tune `CUE_TWO_SIDED` if outside.

- [ ] **Step 5: Run to verify it passes**

Run: `python tests/test_recruiting.py && python tests/test_recruiting_api.py && python tests/test_sim_golden.py && python tools/check_recruiting.py`
Expected: ok lines, golden identical, `player reveal rate` between 0.55 and 0.75.

- [ ] **Step 6: Commit**

```bash
git add coach_career/scenes.py coach_career/recruiting.py server.py tools/check_recruiting.py tests/test_recruiting.py tests/test_recruiting_api.py
git commit -m "Calls and in-home visits open a scene: his lines and a cue, then your pitch and his reaction; the CPU keeps the one-shot path"
```

---

### Task 7: The US map asset and projection

**Files:**
- Create: `tools/make_us_map.py`, `web/us-states.js` (generated, committed), `web/us-map.js`
- Modify: `web/season.html:201` (script tags for `us-states.js` and `us-map.js` before `recruiting.js`)
- Test: `tests/test_ux_sweep.py` (a projection check in the page), `tests/test_us_map.py` (the tool's output)

**Interfaces:**
- Produces: `window.US_STATES = {viewBox: "0 0 975 610", paths: {AL: "M…", …, DC: "M…"}}` (51 keys, postal codes); `window.USMap.project([lat, lon]) -> [x, y] | null` (Albers USA composite below; null outside all three regions); `window.USMap.render(opts) -> SVGElement` where `opts = {areas: {name: [states]}, staffed: {name: staff_name}, dots: [{id, home, tone, ring, big, label}], selectedState, onDot(id), onState(code), teamColor}`; `window.USMap.centroid(code) -> [x, y]`.
- The tool reads `us-atlas@3.0.1/states-10m.json` (ISC licence; Census data) from a local path given on the command line, decodes the TopoJSON arcs (delta-decoded, `transform.scale` and `translate`), projects every ring with the same Albers USA, drops Puerto Rico and the territories (FIPS 60, 66, 69, 72, 78), maps FIPS to postal codes, rounds to one decimal and writes `web/us-states.js`.

Albers USA (port of d3-geo's `geoAlbersUsa`, for a 975 × 610 canvas, `k = 1070`):

```
lower48: conic equal area, parallels 29.5° and 45.5°, rotate longitude +96°, centre (-0.6°, 38.7°), scale k, translate (487.5, 305)
alaska:  conic equal area, parallels 55° and 65°, rotate +154°, centre (-2°, 58.5°), scale 0.35 k, translate (487.5 - 0.307 k, 305 + 0.201 k)
hawaii:  conic equal area, parallels 8° and 18°, rotate +157°, centre (-3°, 19.9°), scale k, translate (487.5 - 0.205 k, 305 + 0.212 k)
conic equal area (φ0, φ1): n = (sin φ0 + sin φ1) / 2; C = cos²φ0 + 2 n sin φ0; ρ(φ) = sqrt(C - 2 n sin φ) / n;
  x = ρ sin(n λ), y = ρ0 - ρ cos(n λ) with ρ0 = ρ(φc), λ = rotated longitude in radians minus the centre's, output scaled by `scale` and shifted by `translate`
region pick: Alaska when lat ≥ 50 and lon < -130 (and not Hawaii), Hawaii when 18 ≤ lat ≤ 23 and -161 ≤ lon ≤ -154, else lower 48
```

- [ ] **Step 1: Write the failing tests**. `tests/test_us_map.py` (a script like the others):

```python
import json, re, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
js = (ROOT / "web" / "us-states.js").read_text()
paths = json.loads(re.search(r"paths\s*:\s*(\{.*\})\s*\}\s*;?\s*$", js, re.S).group(1))
assert len(paths) == 51 and {"TX", "AK", "HI", "DC"} <= set(paths)
assert all(p.startswith("M") for p in paths.values()) and len(js) < 200_000
```

In `tests/test_ux_sweep.py`, on any career page after load:

```python
hits = page.evaluate("""() => { const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox', US_STATES.viewBox); document.body.append(svg);
  const inside = (code, ll) => { const p = document.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('d', US_STATES.paths[code]); svg.append(p);
    const [x, y] = USMap.project(ll); const pt = svg.createSVGPoint(); pt.x = x; pt.y = y; return p.isPointInFill(pt); };
  const r = [inside('TX', [29.76, -95.37]), inside('CA', [34.05, -118.24]), inside('AK', [61.22, -149.9]), inside('HI', [21.31, -157.86]), inside('FL', [25.76, -80.19])]; svg.remove(); return r; }""")
assert all(hits), f"Houston, Los Angeles, Anchorage, Honolulu, Miami inside their states: {hits}"
```

- [ ] **Step 2: Run to verify it fails**

Run: `python tests/test_us_map.py`
Expected: FAIL with `FileNotFoundError` on `web/us-states.js`.

- [ ] **Step 3: Implement** `tools/make_us_map.py` (`python tools/make_us_map.py path/to/states-10m.json`), run it once with the file fetched from `https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-10m.json` (fetch into a scratch directory, never into the repo), commit the generated `web/us-states.js` with a header comment naming the source and licence. Implement `web/us-map.js`: `project` per the block above (one function `conic(parallels, rotate, center, scale, translate)` returning a projector), `centroid` from each path's bounding box centre, and `render` drawing areas (one `<g>` per area, its states' paths with `fill` from `staffed`), state paths with `data-state` and a click handler, then dots as `<circle r=4>` (`r=6` when `big`) with `class="us-dot <tone>"` and a `<title>` from `label`; `ring` adds a second circle in `teamColor`. Add the script tags.

- [ ] **Step 4: Run to verify it passes**

Run: `python tests/test_us_map.py && python tests/test_ux_sweep.py`
Expected: ok lines.

- [ ] **Step 5: Commit**

```bash
git add tools/make_us_map.py web/us-states.js web/us-map.js web/season.html tests/test_us_map.py tests/test_ux_sweep.py
git commit -m "A US map for recruiting: state outlines from us-atlas, an Albers USA projection, areas and dots"
```

---

### Task 8: The board as a pipeline with a detail pane

**Files:**
- Modify: `web/recruiting.js:388-540` (`renderRecruiting`, `card`, `panel`, remove `CHIPS` and `chipOf`, `view.chip`)
- Modify: `web/styles.css:1107-1150` (board styles) and the phone block at `:1231-1245`
- Modify: `web/offseason.js:303` keeps calling `window.Recruiting.board` (no change expected; verify the portal renders)
- Test: `tests/test_ux_sweep.py`

**Interfaces:**
- Consumes: `board_row` fields `stage`, `stage_move`, `find`, `generational`, `standing`, `list`, `firmness`, `hard`, `cooled`, `need`, `offered`, `nil`, `ask`, `strength`, `priorities_known`, `scene` (Task 6; null until Task 10 uses it), `our_grades`, `scouted`; `wordTag` (Task 2).
- Produces: `COLUMNS = [["cold","Cold"],["contact","In touch"],["top","Top 8"],["visited","Visited"],["committed","Committed"]]`; `columnOf(b) -> key` (committed or signed anywhere → `committed`, else `b.stage`); `view.selected`, `view.state` (map state filter, Task 9), `view.group`; `pane(b) -> HTMLElement` with class `go-pane` (desktop: `position: sticky`; under 760px: `go-pane sheet` fixed to the bottom with a close button); `race(b, me) -> HTMLElement` (`.go-race` track with `.go-race-pill` per school, `style="left: {bar*100}%"`, `.you` on yours, an arrow glyph for `move`); `badges(b) -> HTMLElement` (`.go-badge.generational`, `.go-badge.gem`, `.go-badge.bust`, plus today's Need, Offered, Cooled, Verbal/Hard tags). Cards keep class `go-pcard`; the selected one has `selected`; a moved card has `moved-up` or `moved-down`.

- [ ] **Step 1: Write the failing test** in `tests/test_ux_sweep.py`, replacing the two board assertions at lines 108-118:

```python
# --- Recruiting board: five columns with counts; a tap opens the pane; nothing scrolls sideways
page.set_viewport_size({"width": 1280, "height": 1000})
open_tab(page, base, A, "recruiting", ".go-col")
cols = page.evaluate("() => [...document.querySelectorAll('.go-col')].map(c => c.querySelector('.go-col-head').textContent.trim())")
assert [c.split()[0] for c in cols] == ["Cold", "In", "Top", "Visited", "Committed"], cols
assert not page.query_selector(".go-chip:has-text('You lead')"), "the lead/close/behind chips are gone"
page.click(".go-pcard .go-pcard-top >> nth=0")
time.sleep(0.8)
box = page.evaluate("() => { const p = document.querySelector('.go-pane'); const r = p.getBoundingClientRect(); return [r.top, r.bottom, getComputedStyle(p).position]; }")
assert box[2] == "sticky" and 0 <= box[0] < 400, box
assert page.query_selector(".go-pane .go-race"), "his list draws as a race"
page.set_viewport_size({"width": 400, "height": 860})
open_tab(page, base, A, "recruiting", ".go-col")
assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "no sideways page scroll on a phone"
page.click(".go-pcard .go-pcard-top >> nth=0")
time.sleep(0.8)
sheet = page.evaluate("() => { const p = document.querySelector('.go-pane.sheet'); if (!p) return null; const r = p.getBoundingClientRect(); return [r.top, r.bottom, window.innerHeight]; }")
assert sheet and sheet[0] >= 0 and sheet[1] <= sheet[2] + 1, f"the pane is a bottom sheet inside the viewport: {sheet}"
page.click(".go-pane .go-pane-close")
assert not page.query_selector(".go-pane.sheet")
```

Also in `tests/test_ux_sweep.py`, using the finished career `B` (every class signed, so the Committed column has both yours and lost ones): open its board and assert a `.go-pcard.lost` card exists in the last column with text matching `flip|Signed|commit` and that a card committed to you (`.go-pcard.mine`) has no `.go-act` buttons.

- [ ] **Step 2: Run to verify it fails**

Run: `python tests/test_ux_sweep.py`
Expected: FAIL waiting for `.go-col`.

- [ ] **Step 3: Implement** the pipeline in `renderRecruiting`: keep the header (meters, Auto-recruit), the needs strip, the ticker, the sort select (chance, rank) and "Find prospects"; drop the chips. Build `.go-pipeline` with five `.go-col` (each a `.go-col-head` "Name · count" and a `.go-col-body`), cards sorted per column by `key[view.sort]`, filtered by `view.group` and `view.state`. The card body: avatar, name button, position and stars (none for portal), `wordTag` for potential or "Not scouted", `badges`, the standing bar and one line of standing text, `moved-up`/`moved-down` class from `stage_move`, `.mine` when committed to you, `.lost` when committed or signed elsewhere. Clicking a card sets `view.selected` and renders the pane: on desktop, `.go-pane` is a sibling column to the right of the pipeline (grid `minmax(0,1fr) 340px`); under 760px it is appended to `document.body` as `.go-pane.sheet` with a `.go-pane-close` button and removed on close or on re-render. The pane carries everything the old `panel()` had (pitch picker, NIL, Offer or Raise, Full profile, Pull offer, Off the board) plus the action buttons moved off the card, `race(b, me)`, the word grades strip and the badges. Phone columns: `.go-pipeline` is `display: flex; overflow-x: auto; scroll-snap-type: x mandatory` with each column `flex: 0 0 100%`, and a `.go-seg` above it with one button per column that scrolls its column into view. In the portal (`v.portal`) the Visited column reads "Campus visit". Verify the portal weeks still render through `window.Recruiting.board`.

- [ ] **Step 4: Run to verify it passes**

Run: `python tests/test_ux_sweep.py && python tests/test_offseason_e2e.py`
Expected: ok lines.

- [ ] **Step 5: Commit**

```bash
git add web/recruiting.js web/styles.css tests/test_ux_sweep.py
git commit -m "The board is a pipeline: five stage columns, compact cards with badges and moves, a sticky pane or bottom sheet with his list as a race"
```

---

### Task 9: The map card on the board and the Prospects tab

**Files:**
- Modify: `web/recruiting.js` (`renderRecruiting`: a map card; `renderProspects`: a small map that sets the state filter)
- Modify: `web/styles.css` (`.go-map`, `.us-dot.<tone>`, `.us-area.staffed`, `.us-state.selected`)
- Test: `tests/test_ux_sweep.py`

**Interfaces:**
- Consumes: `window.USMap.render`, `window.USMap.centroid`; view fields `areas`, `staff[].area`, `staff[].name`, board rows' `home`, `standing`, `committed`, `generational`.
- Produces: `view.state: string | null`; `mapCard(v, s, me) -> HTMLElement` (`.go-card.go-map`, a header with "YOUR FOOTPRINT", a collapse button whose state is kept at `localStorage["cfp-map-open"]`, the SVG, a legend, and a "List the states" button toggling a `.go-map-table` with rows state / prospects on your board / your best standing).

- [ ] **Step 1: Write the failing test** in `tests/test_ux_sweep.py` on career `A`'s board at 1280:

```python
dots = page.evaluate("() => document.querySelectorAll('.go-map .us-dot').length")
board = page.evaluate("() => document.querySelectorAll('.go-pcard').length")
assert dots == board, (dots, board)
assert page.evaluate("() => document.querySelectorAll('.go-map .us-state').length") == 51
# every dot sits on the canvas (a hometown without coordinates falls back to its state's centre)
assert page.evaluate("() => [...document.querySelectorAll('.go-map .us-dot')].every(c => { const x = +c.getAttribute('cx'), y = +c.getAttribute('cy'); return x > 0 && y > 0 && x < 975 && y < 610; })")
page.click(".go-map .us-state[data-state='TX']")
time.sleep(0.6)
assert page.evaluate("() => [...document.querySelectorAll('.go-pcard .muted')].every(m => !/, [A-Z]{2}/.test(m.textContent) || /, TX|D\\.C\\./.test(m.textContent))"), "a state tap filters the columns to it"
page.click(".go-map button:has-text('List the states')")
assert page.query_selector(".go-map-table tr"), "an accessible table alternative"
page.set_viewport_size({"width": 340, "height": 700})
open_tab(page, base, A, "recruiting", ".go-col")
assert page.evaluate("() => { const m = document.querySelector('.go-map svg'); return !m || m.offsetParent === null; }"), "the map hides under 360px"
page.set_viewport_size({"width": 1280, "height": 1000})
```

- [ ] **Step 2: Run to verify it fails**

Run: `python tests/test_ux_sweep.py`
Expected: FAIL with `dots == board` (0 dots).

- [ ] **Step 3: Implement** `mapCard`: dots from `b.home` via `USMap.project`, falling back to `USMap.centroid(b.hometown.state)` when `project` returns null; `tone` from `standing(b, me).tone`, `ring` when `b.committed === me || b.signed === me`, `big` when `b.generational`, `label` "Name · position · standing text"; `onDot` sets `view.selected` and re-renders; `onState` toggles `view.state` and re-renders; staffed areas from `v.staff` (`area → name`). The Prospects tab adds the same card above the filters at 60% height; its `onState` sets `f.state` and reloads. Media query `@media (max-width: 359px) { .go-map svg { display: none } }`.

- [ ] **Step 4: Run to verify it passes**

Run: `python tests/test_ux_sweep.py`
Expected: ok line.

- [ ] **Step 5: Commit**

```bash
git add web/recruiting.js web/styles.css tests/test_ux_sweep.py
git commit -m "Your footprint: a US map of your areas and your board, a tap to select a prospect or filter a state"
```

---

### Task 10: Scenes on the pane

**Files:**
- Modify: `web/recruiting.js` (`act`, `pane`, `card`: the scene flow, "Heard:", resume)
- Modify: `web/styles.css` (`.go-scene`, `.go-scene-line`, `.go-reaction.<kind>`)
- Test: `tests/test_ux_sweep.py`

**Interfaces:**
- Consumes: `act()` responses `{scene}` and `{reaction}` (Task 6), `board_row.scene` (the open scene or null), `PITCH_NAMES`.
- Produces: `openScene(s, b, scene)` rendering `.go-scene` in the pane: his avatar, the lines as `.go-scene-line` (the cue line marked `.cue`), the pitch picker with the cue's topics marked "Heard", a "Pitch" button that posts `{action: "pitch", scene: scene.id, pitch}`, and a "Hang up" link that just closes (the scene stays open on the server); `reactionView(r)` showing his reaction with the kind's tone; the card shows a `Heard: <topics>` tag while a scene or a cue from this week exists and a "Finish the call" button when `b.scene` is set.

- [ ] **Step 1: Write the failing test** in `tests/test_ux_sweep.py` on career `A`'s board at 1280, with a card that has not been called selected (the first Cold card):

```python
page.click(".go-col[data-col='cold'] .go-pcard .go-pcard-top >> nth=0")
time.sleep(0.6)
page.click(".go-pane .go-act:has-text('Call')")
page.wait_for_selector(".go-pane .go-scene .go-scene-line.cue", timeout=30_000)
assert page.query_selector(".go-pane .go-pitch .go-tag:has-text('Heard')"), "the cue marks a pitch"
page.click(".go-pane .go-pitch:has(.go-tag:has-text('Heard')) >> nth=0")
page.click(".go-pane button:has-text('Pitch')")
page.wait_for_selector(".go-pane .go-reaction", timeout=30_000)
kind = page.get_attribute(".go-pane .go-reaction", "data-kind")
assert kind in ("hit", "polite", "quiet"), kind
assert page.query_selector(".go-pcard.selected .go-tag:has-text('Heard')"), "the card keeps what you heard this week"
# an abandoned scene resumes from the card
page.click(".go-col[data-col='cold'] .go-pcard .go-pcard-top >> nth=0")
time.sleep(0.6)
if page.query_selector(".go-pane .go-act:has-text('Call'):not(:disabled)"):
    page.click(".go-pane .go-act:has-text('Call')")
    page.wait_for_selector(".go-pane .go-scene", timeout=30_000)
    page.click(".go-pane .go-scene a:has-text('Hang up')")
    time.sleep(0.5)
    assert page.query_selector(".go-pcard.selected button:has-text('Finish the call')")
```

- [ ] **Step 2: Run to verify it fails**

Run: `python tests/test_ux_sweep.py`
Expected: FAIL waiting for `.go-scene`.

- [ ] **Step 3: Implement**: in `act`, when the response has `scene`, call `openScene` instead of toasting; when it has `reaction`, render `reactionView` in the pane for 4 seconds then re-render the board (which re-fetches). `openScene` disables the other action buttons while open. The pitch picker in a scene tags the cue's topics "Heard" and pre-selects the first. `card` adds the Heard tag from `b.scene?.cue.topics` or from the week's last cue kept in `view.heard[b.id] = {week, topics}` after a pitch. The toast copy for a reaction: hit "He lit up: {topic} matters to him", polite "He was polite and moved on", quiet "He went quiet: he isn't buying {topic} from you".

- [ ] **Step 4: Run to verify it passes**

Run: `python tests/test_ux_sweep.py`
Expected: ok line.

- [ ] **Step 5: Commit**

```bash
git add web/recruiting.js web/styles.css tests/test_ux_sweep.py
git commit -m "Calls and in-home visits play on the pane: his lines, the cue you heard, your pitch and his reaction"
```

---

### Task 11: Badges everywhere, Classes, docs

**Files:**
- Modify: `web/recruiting.js` (`renderProspects` rows and the profile head: generational and find badges; `renderClasses`: the generational badge on `top` and class rows, `find_held` on your signees)
- Modify: `docs/HOW_IT_WORKS.md` ("Coach Career (recruiting, scouting and saves)" and "Scouting": words, generational, gems, scenes, the pipeline and the map), `README.md` (the Recruiting bullet)
- Test: `tests/test_ux_sweep.py`

**Interfaces:**
- Consumes: `generational`, `find` on list rows and the profile; `find_held` on `class_detail` rows (Task 4); `badges` (Task 8).

- [ ] **Step 1: Write the failing test** in `tests/test_ux_sweep.py` on the finished career `B`: open Classes, expand your class, and assert each `.go-class-list li` either has no `.go-badge` or has one of `.go-badge.generational`, `.go-badge.gem-held`, `.go-badge.gem-missed`; on career `A`'s Prospects tab assert that when `GET /api/season/A/prospects?stars=5&limit=50` (via `call`) has a row with `generational: true`, a `.go-badge.generational` is on the page after filtering to five-stars, and that the badge text is exactly "Generational".

- [ ] **Step 2: Run to verify it fails**

Run: `python tests/test_ux_sweep.py`
Expected: FAIL on the missing badge.

- [ ] **Step 3: Implement** the badges in `renderProspects`, the profile head (`badges` from Task 8 reused with a `{generational, find}` object) and `renderClasses` (`find_held === true` → "Gem: the read held", `false` → "The read was off"). Update the docs: the two HOW_IT_WORKS sections and the README's Recruiting bullet (words not letters; a few generational prospects a class, public; gems and bust risk are your staff's finds; the pipeline, the map; calls and in-home visits as scenes; the CPU unchanged).

- [ ] **Step 4: Run the whole suite**

Run: `python tests/run_all.py`
Expected: every line `PASS` (the slow ones take minutes); `python tools/check_recruiting.py 2` holds every tolerance and prints the generational count and the player reveal rate per seed.

- [ ] **Step 5: Commit**

```bash
git add web/recruiting.js docs/HOW_IT_WORKS.md README.md tests/test_ux_sweep.py
git commit -m "Generational and gem badges on Prospects, the profile and Classes; docs for the recruiting experience"
```
