# Client-side Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coach Career runs entirely in the browser (Pyodide in a Web Worker, saves in IndexedDB), published as static files to GitHub Pages; the FastAPI server and the Render deployment go.

**Architecture:** `server.py`'s career handlers move into a framework-free dispatcher, `app/api.py`, with one `call(method, path, body)` entry point and a `step()` that plays one week at a time. The page keeps every screen and every `/api/...` path; its `fetch` is swapped for a shim that posts the call to `web/worker.js`, which runs the dispatcher under Pyodide with `data/seasons` and `data/coaches` mounted on IndexedDB. A thin dev server (`tools/dev_server.py`) wraps the same dispatcher over HTTP for local play and the Playwright tests; `tools/build_site.py` packs code and data into `dist/` for Pages.

**Tech Stack:** Python 3.12 stdlib (dispatcher, dev server, build), Pyodide 0.26.4 from `https://cdn.jsdelivr.net/pyodide/v0.26.4/full/`, Emscripten IDBFS, vanilla JS, GitHub Actions + Pages, Playwright (tests only, Chromium at `/opt/pw-browsers/chromium`).

**Spec:** `docs/superpowers/specs/2026-10-29-client-side-runtime-design.md`

## Global Constraints

- Game logic under `engine/`, `sim/`, `coach_career/`, `teamdata/` does not change behavior: `python tests/test_sim_golden.py` passes without `--record` at every commit.
- The browser runs the Python with `SIM_WORKERS=1` set before `sim.season` is imported (the dispatcher sets it when `app.api` is imported; the dev server and native tests may use the pool).
- Every `/api/...` path the page calls today keeps its method, path, query parameters, body and response shape (section 5 of the spec). Status codes keep their numbers (400, 404, 409, 413, 422).
- Pyodide version is pinned in one place, `web/worker.js`: `const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/"`.
- Every URL in `web/` (HTML `href`/`src`, `manifest.json`, JS navigation) is relative (`./styles.css`, `./coach.html`), never root-absolute: GitHub Pages serves a project site under `/<repo>/`.
- No `fastapi`, `uvicorn` or `pydantic` import anywhere after Task 4. `requirements.txt` lists only what tests need (`playwright`).
- Removed modes and limits (spec section 3): Sim a game, Real 2026, Start from today, `MAX_CAREERS`, `MAX_SEASONS`, `_evict_others`, the `X-CFP-Browser` header and the career's `browser` field. No migration of Render-era IndexedDB saves.
- Commit messages carry the trailer lines the session's attribution reminder gives; no model identifiers in commits or code.
- Run `python tests/run_all.py` before the final commit of Task 8; the Playwright tests need `CFP_MAX_CAREERS` no longer (the variable is removed with the server).

## Review Focus

1. **A `.ccsave` of a career that is simulating** (import while `step()` is running): expected refusal 409, the running career untouched. Pinned in Task 2 (`test_import_refused_while_running`).
2. **Reload mid-season after a week that just saved**: the career must come back from IndexedDB at the same week with its box scores for the player's games. Pinned in Task 6 (`test_reload_restores_career`).
3. **IndexedDB write failure** (quota, private window): the page must keep working from memory and show the toast copy in the spec. Pinned in Task 6 (`test_syncfs_failure_toasts`, the worker's `syncfs` forced to fail).
4. **A second `advance` while one is running**: 409 "already simulating", the first continues. Pinned in Task 2 (`test_advance_while_running_refused`).
5. **Opening the site under a subpath** (`/cfpcoachsimulator/`): every asset and page link must resolve. Pinned in Task 7 (`test_no_root_absolute_urls` and the browser test serving `dist/` under `/sub/`).

---

### Task 1: The dispatcher core, seasons and coaches

**Files:**
- Create: `app/__init__.py` (empty), `app/api.py`
- Test: `tests/test_api_dispatch.py`
- Reference (read, do not change yet): `server.py:371-430` (season state), `server.py:552-700` (create, export, import, list, get, delete), `server.py:1374-1405` (coach routes), `server.py:192-215` (teams routes)

**Interfaces:**
- Produces, in `app/api.py`:
  - `class ApiError(Exception)` with `status: int` and `message: str` (`ApiError(409, "already simulating")`).
  - `class Params` (dataclass): `path: dict[str, str]`, `query: dict[str, str]`, `body: dict | bytes | None`; helper `q(name, cast=str, default=None)` that returns `cast(query[name])` or the default, raising `ApiError(422, f"{name} must be a {cast.__name__}")` when the cast fails.
  - `ROUTES: list[tuple[str, str, Callable[[Params], dict | bytes]]]`, entries like `("GET", "/api/season/{season_id}/status", season_status)`; `route(method, pattern)` decorator that appends to it.
  - `call(method: str, path: str, body: dict | bytes | None = None) -> dict | bytes`: splits the query string with `urllib.parse`, matches the pattern (`{name}` segments), builds `Params`, calls the handler; no match raises `ApiError(404, "not found")`; a wrong method on a known path `ApiError(405, "method not allowed")`.
  - `changed() -> bool`: True once after any call that saved a season or coach file (or deleted one); reading clears it. Handlers set it through `_mark_changed()`.
  - `loaded_state() -> dict | None`: the one season in memory (for tests and `step()`).
  - `job() -> dict`: the job record for the loaded season (`status`, `done`, `total`, `stage`, `week`, `games_done`, `games_total`, `week_frac`, `paused`, `gameday_event`, `error`, `stop`, `target`, `kind`).
  - Module state: `_loaded: dict | None`, `_job: dict`, `_changed: bool`, `_cards: dict[str, tuple[float, dict]]` (the list cache). Loading a season other than the loaded one replaces it (saving the old one first if a change is pending); the loaded one is activated with `season.use_league(league.ensure_built(state) or season.TEAMS_FILE)` as `_activate` does today, minus the "another season is simulating" 409.
- Consumes: `sim.season` (`new_season`, `save_season`, `load_season`, `summary`, `SEASONS_DIR`, `TEAMS_FILE`, `use_league`, `_records`), `coach_career.career` (`export_save`, `read_save`, `restore`, `is_career`), `coach_career.league` (`ensure_built`, `forget`), `sim.coaches` (`save`, `load`, `list_all`, `delete`, `options`).

Request bodies replace the pydantic models: a handler reads `p.body["team"]` etc.; a missing or wrongly typed required field raises `ApiError(422, "<field> is required")`. `import_career` receives `bytes` in `p.body`; `export_career` returns `bytes`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_api_dispatch.py (run as a file; uses a temp SEASONS_DIR and data/coaches dir like test_recruiting_api.py)
def test_unknown_route():
    refused(lambda: api.call("GET", "/api/nothing"), 404)
    refused(lambda: api.call("DELETE", "/api/teams"), 405)

def test_teams_and_coach_options():
    assert any(t["slug"] == "smu" for t in api.call("GET", "/api/teams")["teams"])
    assert api.call("GET", "/api/teams/smu")["slug"] == "smu"
    assert api.call("GET", "/api/coach-options")           # a non-empty dict: the coach page's option lists

def test_create_get_list_delete_career():
    s = api.call("POST", "/api/season", {"team": "smu", "seed": 11, "career": True})
    assert s["career"] and api.changed() and not api.changed()
    assert api.call("GET", f"/api/season/{s['id']}")["id"] == s["id"]
    cards = api.call("GET", "/api/seasons")["seasons"]
    assert [c["id"] for c in cards] == [s["id"]] and "browser" not in cards[0]
    assert api.call("DELETE", f"/api/season/{s['id']}")["deleted"]
    assert api.changed() and api.call("GET", "/api/seasons")["seasons"] == []

def test_create_refusals():
    refused(lambda: api.call("POST", "/api/season", {"team": "nope", "career": True}), 404)
    refused(lambda: api.call("POST", "/api/season", {"career": True}), 422)
    refused(lambda: api.call("POST", "/api/season", {"team": "smu", "mode": "remaining", "career": True}), 400)

def test_export_import_roundtrip():
    s = api.call("POST", "/api/season", {"team": "smu", "seed": 11, "career": True})
    blob = api.call("GET", f"/api/season/{s['id']}/export?full=true")
    assert isinstance(blob, bytes) and blob[:2] == b"\x1f\x8b"
    api.call("DELETE", f"/api/season/{s['id']}")
    back = api.call("POST", "/api/season/import", blob)
    assert back["id"] == s["id"] and api.changed()
    refused(lambda: api.call("POST", "/api/season/import", b"not a save"), 400)
    refused(lambda: api.call("POST", "/api/season/import", b"x" * (api.MAX_SAVE_BYTES + 1)), 413)

def test_coaches_crud():
    c = api.call("POST", "/api/coaches", {"first_name": "Pat", "last_name": "Day"})
    assert api.changed() and api.call("GET", f"/api/coaches/{c['id']}")["last_name"] == "Day"
    assert c["id"] in [x["id"] for x in api.call("GET", "/api/coaches")["coaches"]]
    assert api.call("DELETE", f"/api/coaches/{c['id']}")["deleted"]
    refused(lambda: api.call("GET", f"/api/coaches/{c['id']}"), 404)
```

`refused(fn, code)` asserts an `ApiError` with that status (copy the shape of `tests/test_recruiting_api.py`'s helper). Check the real field names of `/api/coach-options` and the coach POST body against `server.py:1374-1405` and `sim/coaches.py:215-260` and use them in the assertions.

- [ ] **Step 2: Run the test to verify it fails**

Run: `python tests/test_api_dispatch.py`
Expected: `ModuleNotFoundError: No module named 'app'`

- [ ] **Step 3: Implement `app/api.py` with the interfaces above and the routes `GET /api/teams`, `GET /api/teams/{slug}`, `POST /api/season`, `GET /api/seasons`, `GET /api/season/{season_id}`, `DELETE /api/season/{season_id}`, `DELETE /api/seasons`, `GET /api/season/{season_id}/export`, `POST /api/season/import`, `GET /api/coach-options`, `GET/POST /api/coaches`, `GET/DELETE /api/coaches/{coach_id}`**

Move the handler bodies from `server.py`; `HTTPException(code, msg)` becomes `ApiError(code, msg)`. `create_season` accepts `career` only as `True` (default True) and `mode` only as `"full"` (default); `remaining` is the 400 above. Set `os.environ.setdefault("SIM_WORKERS", "1")` only when `sys.platform == "emscripten"`, before importing `sim.season`. The list card drops `browser`. `MAX_SAVE_BYTES` keeps its value.

- [ ] **Step 4: Run the test to verify it passes**

Run: `python tests/test_api_dispatch.py`
Expected: last line `ok` (print it) and exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/ tests/test_api_dispatch.py
git commit -m "Add the framework-free dispatcher: seasons, coaches, teams"
```

---

### Task 2: Advance, game day, pause and status as steps

**Files:**
- Modify: `app/api.py`
- Test: `tests/test_api_dispatch.py`
- Reference: `server.py:458-530` (`_reporter`, `_run_advance`, `_run_gameday`, gameday), `server.py:705-755` (status, pause, advance), `sim/season.py:1783-1815` (`advance_to`), `season.play_my_game`, `season.my_game_id`, `season.shared_pool`

**Interfaces:**
- Produces, in `app/api.py`:
  - `step(report: Callable[[str], None] | None = None) -> dict | None`: when `job()["status"] == "running"`, plays the next unit (one week via `season.advance_to(state, done + 1, report=..., should_stop=lambda: job["stop"])` for `kind == "advance"`; `season.play_my_game(state, None, report=...)` for `kind == "gameday"`), saves the season, updates the job (`done`, `paused`, `status` back to `"idle"` when `done >= target`, stopped, finished or on gameday), marks changed, and returns the status dict `GET .../status` would return with `since` = the week the run started from. Returns `None` when nothing is running. The `report` callable, when given, is called with `json.dumps(status_dict)` after every `_reporter` callback (so a caller sees in-week progress) and once more at the end of the step. An exception sets `status = "error"`, `error = str(exc)` and is not raised.
  - `POST .../advance` and `POST .../gameday` only set the job running (`kind`, `target`, `done`, `total`, `stop=False`, `since=current_week`) and return `{"status": "running", "done", "total"}` as today; they do not play anything.
  - `POST .../pause` sets `job["stop"] = True` and returns `{"status": "running", "stopping": True}` while running, else `{"status": <status>, "stopping": False}`.
  - `GET .../status?since=N` returns exactly today's fields (`server.py:705-727`); `_season_state` of another season while a job runs raises `ApiError(409, "wait for the sim to finish")` instead of evicting.
  - Mutating handlers call `_check_not_running()` (409 "wait for the sim to finish"); `POST /api/season/import` of the running career raises 409 "that career is simulating; try again when the week is done".

- [ ] **Step 1: Write the failing tests**

```python
def test_advance_runs_in_steps():
    s = api.call("POST", "/api/season", {"team": "smu", "seed": 11, "career": True})
    r = api.call("POST", f"/api/season/{s['id']}/advance", {"to": 2})
    assert r == {"status": "running", "done": 0, "total": 2}
    refused(lambda: api.call("POST", f"/api/season/{s['id']}/advance", {}), 409)   # test_advance_while_running_refused
    seen = []
    st = api.step(seen.append)
    assert st["status"] == "running" and st["done"] == 1 and api.changed()
    assert any('"stage"' in m for m in seen)
    st = api.step()
    assert st["status"] == "idle" and st["done"] == 2 and api.loaded_state()["current_week"] == 2
    assert api.step() is None
    assert api.call("GET", f"/api/season/{s['id']}/status?since=0")["results"]

def test_pause_between_weeks():
    s = api.call("POST", "/api/season", {"team": "smu", "seed": 11, "career": True})
    api.call("POST", f"/api/season/{s['id']}/advance", {"to": 4})
    api.step()
    assert api.call("POST", f"/api/season/{s['id']}/pause")["stopping"]
    st = api.step()
    assert st["status"] == "idle" and st["paused"] and st["done"] == 2

def test_import_refused_while_running():
    s = api.call("POST", "/api/season", {"team": "smu", "seed": 11, "career": True})
    blob = api.call("GET", f"/api/season/{s['id']}/export")
    api.call("POST", f"/api/season/{s['id']}/advance", {})
    refused(lambda: api.call("POST", "/api/season/import", blob), 409)
    api.step()

def test_gameday_step():
    s = api.call("POST", "/api/season", {"team": "smu", "seed": 11, "career": True})
    r = api.call("POST", f"/api/season/{s['id']}/gameday")
    assert r["status"] == "running"
    st = api.step()
    assert st["status"] == "idle" and st["gameday_event"]
```

Check `advance_to`'s `should_stop` semantics (`sim/season.py:1790`) so the pause test's expected `done` matches: the week in progress finishes, the next does not start.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python tests/test_api_dispatch.py`
Expected: `AttributeError: module 'app.api' has no attribute 'step'` (or 404 on advance).

- [ ] **Step 3: Implement `step()`, the advance/gameday/pause/status routes and `_check_not_running()` in `app/api.py`**

Reuse `_reporter`'s body for the `week_frac` arithmetic; it writes onto `_job` and then calls `report(json.dumps(season_status_dict()))` when a report callable was given.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python tests/test_api_dispatch.py`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/api.py tests/test_api_dispatch.py
git commit -m "Dispatcher: advance and game day as steps, pause, status"
```

---

### Task 3: Every other career route

**Files:**
- Modify: `app/api.py`
- Modify: `tests/test_recruiting_api.py` (port to the dispatcher)
- Test: `tests/test_api_dispatch.py` (route coverage)
- Reference: `server.py:756-890` (week, schedule, schedule_edit, redshirt, standings, review, resume, game, settings), `server.py:912-1017` (recruiting), `server.py:1034-1218` (offseason), `server.py:1219-1348` (player edit, preview, rivalries, stats, depth, injuries, awards, player, leaders)

**Interfaces:**
- Produces: every route in spec section 5 registered in `ROUTES`, and `routes() -> set[tuple[str, str]]` listing `(method, pattern)`.
- The save timer is gone: a handler that changed the state calls `_save_loaded()` (writes the file, marks changed) before returning. `_career_state(season_id, change)` and `_recruiting_call` move as they are.

- [ ] **Step 1: Write the failing coverage test**

```python
EXPECTED = {("GET", "/api/season/{season_id}/week/{week}"), ("GET", "/api/season/{season_id}/schedule/{slug}"),
            ("GET", "/api/season/{season_id}/schedule_edit"), ("POST", "/api/season/{season_id}/schedule_edit"),
            ("POST", "/api/season/{season_id}/redshirt"), ("GET", "/api/season/{season_id}/standings"),
            ("GET", "/api/season/{season_id}/review"), ("GET", "/api/season/{season_id}/resume"),
            ("GET", "/api/season/{season_id}/game/{event_id}"), ("GET", "/api/season/{season_id}/settings"),
            ("POST", "/api/season/{season_id}/settings"), ("GET", "/api/season/{season_id}/recruiting"),
            ("GET", "/api/season/{season_id}/programs"), ("GET", "/api/season/{season_id}/recruiting/report"),
            ("GET", "/api/season/{season_id}/prospects"), ("GET", "/api/season/{season_id}/classes"),
            ("GET", "/api/season/{season_id}/prospect/{pid}"), ("POST", "/api/season/{season_id}/recruit"),
            ("POST", "/api/season/{season_id}/board"), ("POST", "/api/season/{season_id}/staff"),
            ("GET", "/api/season/{season_id}/offseason"), ("POST", "/api/season/{season_id}/offseason/advance"),
            ("POST", "/api/season/{season_id}/offseason/portal"), ("POST", "/api/season/{season_id}/offseason/redshirt"),
            ("GET", "/api/season/{season_id}/offseason/position_options"), ("POST", "/api/season/{season_id}/offseason/position"),
            ("POST", "/api/season/{season_id}/offseason/retain"), ("POST", "/api/season/{season_id}/offseason/review"),
            ("POST", "/api/season/{season_id}/offseason/job"), ("POST", "/api/season/{season_id}/offseason/hire"),
            ("POST", "/api/season/{season_id}/offseason/open_role"), ("POST", "/api/season/{season_id}/player/edit"),
            ("GET", "/api/season/{season_id}/preview"), ("GET", "/api/season/{season_id}/rivalries"),
            ("GET", "/api/season/{season_id}/stats/teams"), ("GET", "/api/season/{season_id}/stats/leaders"),
            ("GET", "/api/season/{season_id}/stats/players"), ("GET", "/api/season/{season_id}/depth/{slug}"),
            ("POST", "/api/season/{season_id}/depth/{slug}"), ("GET", "/api/season/{season_id}/depth/{slug}/position/{role}"),
            ("GET", "/api/season/{season_id}/injuries"), ("GET", "/api/season/{season_id}/awards"),
            ("GET", "/api/season/{season_id}/player")}

def test_every_career_route_registered():
    assert EXPECTED <= api.routes()
    assert not {r for r in api.routes() if "/api/real" in r[1] or r[1] in ("/api/sim", "/api/games", "/api/ingest", "/api/sliders", "/api/predictions")}

def test_offseason_rollover_no_season_limit():
    from tests.test_offseason import finished    # the helper that marks a season done
    s = api.call("POST", "/api/season", {"team": "smu", "seed": 11, "career": True})
    finished(api.loaded_state()); api._save_loaded()
    for _ in range(5):
        r = api.call("POST", f"/api/season/{s['id']}/offseason/advance", {"to": "next_season"})
        assert r["next_season"]
        finished(api.loaded_state()); api._save_loaded()
    assert api.loaded_state()["year"] == 2031
```

(`finished` lives in `tests/test_offseason.py:17`; import it with the same `sys.path` setup, or move it to `tests/helpers.py` if importing a test module is awkward.) The rollover loop takes a few minutes; keep it, it is the only test of "no five-season limit".

- [ ] **Step 2: Port `tests/test_recruiting_api.py`**

Replace every `server.<handler>(sid, Model(...))` with `api.call(method, path, body)` and every `server._season_state(sid)` with `api.loaded_state()` after a call that loads it; delete the career-limit and `MAX_SEASONS` assertions (`tests/test_recruiting_api.py:27-40`); `refused` catches `ApiError`. The docstring names `app/api.py`.

- [ ] **Step 3: Run both tests to verify they fail**

Run: `python tests/test_api_dispatch.py && python tests/test_recruiting_api.py`
Expected: the coverage assertion fails listing the missing routes; the recruiting test fails with 404 "not found".

- [ ] **Step 4: Move the remaining handlers into `app/api.py`**

Query parameters through `p.q("stars", int)`, `p.q("position")`, etc.; bodies through `p.body[...]` with 422 for missing required fields (the pydantic `Field` constraints that the page relies on, such as `n` bounds on leaders, become explicit checks). Drop `_no_real`, `_warm_preview` (the preview computes on request), `_season_cards` eviction by `realdata.REAL_ID`.

- [ ] **Step 5: Run the tests and the golden test**

Run: `python tests/test_api_dispatch.py && python tests/test_recruiting_api.py && python tests/test_sim_golden.py`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/api.py tests/test_api_dispatch.py tests/test_recruiting_api.py
git commit -m "Dispatcher: every Coach Career route; recruiting API test ported"
```

---

### Task 4: The dev server replaces server.py

**Files:**
- Create: `tools/dev_server.py`
- Modify: `tests/test_career_e2e.py:61`, `tests/test_offseason_e2e.py:34`, `tests/test_ux_sweep.py:57` (launch command), `tests/test_ux_sweep.py:395-415` (drop the "server forgets a career but this device kept it" scenario)
- Delete: `server.py`, `render.yaml`, `Procfile`
- Modify: `run.bat`, `requirements.txt`, `.gitignore` (nothing new), `README.md` (the "Run" lines)

**Interfaces:**
- Produces: `python tools/dev_server.py [--port N]` serving `http://127.0.0.1:N` (`PORT` env honored, default 8000): static files from `web/` (`/` and `/season` → `season.html` until Task 7 renames it, then `index.html`; `/coach` → `coach.html`), `/api/*` → `app.api.call`. JSON responses `application/json`; `bytes` → `application/gzip` with the `Content-Disposition` the server used; `ApiError` → status code with body `{"detail": message}`; any other exception → 500 `{"detail": str(exc)}`. Request bodies: `application/json` parsed to a dict, anything else passed as bytes. One `threading.Lock` serializes dispatcher calls; a daemon thread runs `api.step()` in a loop while `api.job()["status"] == "running"`, holding the lock per step. `GET .../status` is served without the lock (as the FastAPI server did) so the page's progress poll sees in-week `week_frac`. `Cache-Control: no-store` on everything.
- Consumes: `app.api.call`, `app.api.step`, `app.api.job`, `app.api.ApiError`.

- [ ] **Step 1: Point the Playwright tests at the dev server**

In the three tests replace `[sys.executable, "server.py", "--local"]` with `[sys.executable, "tools/dev_server.py"]` and drop `"CFP_MAX_CAREERS": "0"` from the env. In `tests/test_ux_sweep.py` delete the forgotten-career scenario (around line 401) and any screenshot of `/` as Sim a game or of `/real`.

- [ ] **Step 2: Run one e2e test to verify it fails**

Run: `python tests/test_career_e2e.py`
Expected: fails to connect (no `tools/dev_server.py`).

- [ ] **Step 3: Write `tools/dev_server.py` (stdlib `http.server.ThreadingHTTPServer`, no FastAPI)**

- [ ] **Step 4: Delete `server.py`, `render.yaml`, `Procfile`; `run.bat` runs `python tools/dev_server.py`; `requirements.txt` becomes `playwright>=1.45  # tests only; the game has no runtime dependencies`; README "Run" section names the dev server**

- [ ] **Step 5: Run the e2e tests and the suite**

Run: `python tests/test_career_e2e.py && python tests/test_offseason_e2e.py && python tests/test_ux_sweep.py && grep -rn "import server\|fastapi\|uvicorn\|pydantic" --include=*.py . | grep -v "\.claude/"`
Expected: three exit 0; the grep prints nothing.

- [ ] **Step 6: Commit**

```bash
git add -A tools/dev_server.py tests/ run.bat requirements.txt README.md
git rm server.py render.yaml Procfile
git commit -m "Dev server over the dispatcher; the FastAPI server and Render files go"
```

---

### Task 5: Precomputed base league and the site bundle

**Files:**
- Modify: `coach_career/league.py:77-96` (`base_team`, `base_meta`, `base_slugs`), `:175-194` (`from_base`)
- Create: `tools/build_site.py`
- Modify: `.gitignore` (+ `dist/`, `data/base_league.json`, `data/base_meta.json`)
- Test: `tests/test_base_league.py`, `tests/test_site_bundle.py`; `tests/run_all.py` (`SLOW` += `test_site_bundle.py`)

**Interfaces:**
- Produces, in `coach_career/league.py`: `BASE_LEAGUE_FILE = ROOT / "data" / "base_league.json"`, `BASE_META_FILE = ROOT / "data" / "base_meta.json"`. `from_base(year)` returns `json.loads(BASE_LEAGUE_FILE.read_text())` with `["year"] = year` when the file exists, else computes as today. `base_meta(slug)` reads from `BASE_META_FILE` (a dict slug → meta, loaded once) when it exists; `base_slugs()` from its keys. `base_team(slug)` is unchanged (the fictional eight's files ship in the bundle). `write_base_files() -> None` computes and writes both files.
- Produces, in `tools/build_site.py`: `build(out: Path = ROOT / "dist") -> dict` returning `{"zip_bytes": int, "files": [...]}`; `python tools/build_site.py` builds `dist/` with: `web/`'s files (every file except `app.js`, `gameview.js` stays), `game.zip`, `version.json` (`{"commit": <git rev-parse HEAD or "dev">}`), `.nojekyll`. `game.zip` holds `engine/`, `sim/`, `coach_career/`, `teamdata/`, `app/` (`.py` only, no `__pycache__`), `data/` files from the list in spec section 7 plus `base_league.json` and `base_meta.json`, `cfb_sim_data/coaches.json`, `cfb_sim_data/teams_index.json`, `cfb_sim_data/league.json` and `cfb_sim_data/teams/<slug>.json` for the eight fictional teams; nothing under `data/seasons`, `data/coaches`, `data/leagues`. Zip paths are relative to the project root. Calls `league.write_base_files()` first.
- `tests/test_offseason.py:17` `finished(st)` is reused.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_base_league.py
def test_precomputed_league_matches_live(tmp_dir):
    live = league.from_base(2027)
    league.BASE_LEAGUE_FILE, league.BASE_META_FILE = tmp_dir / "bl.json", tmp_dir / "bm.json"
    league.write_base_files()
    league.base_meta.cache_clear(); league.base_slugs.cache_clear()
    assert league.from_base(2028)["year"] == 2028
    assert json.dumps(league.from_base(2027), sort_keys=True) == json.dumps(live, sort_keys=True)
    assert league.base_slugs() == tuple(sorted(json.loads(league.BASE_META_FILE.read_text())))
    assert league.base_meta("smu")["conference"] and "roster" not in league.base_meta("smu")

# tests/test_site_bundle.py  (SLOW)
def test_bundle_plays_a_season_and_its_offseason(tmp_dir):
    info = build_site.build(tmp_dir / "dist")
    assert info["zip_bytes"] < 12_000_000
    zipfile.ZipFile(tmp_dir / "dist" / "game.zip").extractall(tmp_dir / "game")
    assert not (tmp_dir / "game" / "data" / "seasons").exists()
    assert len(list((tmp_dir / "game" / "cfb_sim_data" / "teams").glob("*.json"))) == 8
    r = subprocess.run([sys.executable, "-I", "-c", SCRIPT], cwd=tmp_dir / "game", capture_output=True, text=True, env={"SIM_WORKERS": "1"})
    assert r.returncode == 0, r.stderr[-2000:]
    assert r.stdout.strip().endswith("week 1 of 2027 ok")
```

`SCRIPT` (a string in the test, run from inside the unpacked bundle so every `ROOT`-relative read hits the bundle): create an SMU seed-11 career through `api.call`, `advance` + `step()` through week 1, mark it finished the way `finished()` does (copy its few lines into the script; the bundle has no tests folder), `offseason/advance {"to": "next_season"}`, `advance` + `step()` one week of 2027, print `week 1 of 2027 ok`. Any data file missing from the bundle fails here with its name.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python tests/test_base_league.py; python tests/test_site_bundle.py`
Expected: `AttributeError: ... BASE_LEAGUE_FILE`; `ModuleNotFoundError: tools.build_site`.

- [ ] **Step 3: Implement the league changes and `tools/build_site.py`**

- [ ] **Step 4: Run the tests, the memory test and the golden test**

Run: `python tests/test_base_league.py && python tests/test_site_bundle.py && python tests/test_league_memory.py && python tests/test_sim_golden.py`
Expected: all exit 0 (the memory test still reads the source files: no base files exist in `data/` unless built; if `python tools/build_site.py` was run, delete `data/base_*.json` before the memory test or make the test clear them).

- [ ] **Step 5: Commit**

```bash
git add coach_career/league.py tools/build_site.py tests/test_base_league.py tests/test_site_bundle.py tests/run_all.py .gitignore
git commit -m "Precomputed base league; tools/build_site.py packs the game for the browser"
```

---

### Task 6: The worker, the fetch shim and the browser runtime test

**Files:**
- Create: `web/worker.js`, `web/game-client.js`
- Modify: `web/season.html` (script tags, loading overlay), `web/coach.html` (script tag), `web/season.js:7-24` (`api()`), `web/coach.js:14-21` (`api()`), `web/careersave.js:40,49,62` (`fetch` → shim)
- Modify: `app/api.py` (+ `call_js`)
- Test: `tests/test_browser_runtime.py`

**Interfaces:**
- Produces, in `app/api.py`: `call_js(method: str, path: str, body_json: str | None, body_bytes=None) -> str | bytes`: `body_bytes` (a Pyodide `JsProxy` of a `Uint8Array`, converted with `.to_bytes()`) wins over `body_json`; returns `bytes` results as is, else `json.dumps({"ok": True, "result": r, "changed": changed()})`; an `ApiError` returns `json.dumps({"ok": False, "status", "message", "changed": changed()})`; any other exception `{"ok": False, "status": 500, "message": str(exc)}`.
- Produces, in `web/worker.js`: on start, `importScripts(PYODIDE_URL + "pyodide.js")`, `loadPyodide({indexURL: PYODIDE_URL})`, fetch `./game.zip?v=<version>` (version passed in the first message), `unpackArchive` into `/home/pyodide`, `FS.mkdirTree` + `FS.mount(FS.filesystems.IDBFS, {}, dir)` for `/home/pyodide/data/seasons` and `/home/pyodide/data/coaches`, `syncfs(true)`, then Python `import sys, os; sys.path.insert(0, "/home/pyodide"); os.environ["SIM_WORKERS"] = "1"; import app.api`. Posts `{kind: "loading", stage, loaded, total}` during the fetch, `{kind: "ready"}` after, `{kind: "fatal", message}` on failure. Then a message pump: incoming `{id, method, path, bodyJson, bodyBytes}` are queued; the pump takes one, calls `call_js`, replies `{id, ok, status, result | bytes, message}`; after any reply with `changed` true it runs `syncfs(false)` and on failure posts `{kind: "storage-error", message}` once per failure; after each reply, while `api.job()["status"] == "running"` it calls `step(report)` where `report` posts `{kind: "status", status: JSON.parse(s), busy: true}`, posts the final `{kind: "status", status, busy: false}`, runs `syncfs(false)`, and `await`s a macrotask (`setTimeout 0`) so queued messages (pause, status) are served between weeks.
- Produces, in `web/game-client.js`: `window.CFP.game = { ready: Promise<void>, fetch(path, options): Promise<Response>, onLoading(cb), onStorageError(cb) }`. `fetch` resolves after `ready`; builds the message from `options.method` (default GET), `options.body` (string → `bodyJson`; `Blob`/`File`/`ArrayBuffer` → `bodyBytes`); returns a real `Response` (`new Response(JSON.stringify(result), {status: 200, headers: {"Content-Type": "application/json"}})`, bytes → `new Response(bytes, {status: 200, headers: {"Content-Type": "application/gzip"}})`, errors → `new Response(JSON.stringify({detail: message}), {status})`). While the latest `{kind: "status"}` message had `busy: true`, a `GET /api/season/<id>/status...` is answered from that snapshot without a round trip; every other call waits in the worker's queue. Mode is decided by one `GET ./version.json` at start: 200 → worker mode (`version` from the file); 404 → passthrough mode, where `fetch(path, options)` is the browser's `fetch` and `ready` resolves at once (the dev server, Task 4, serves `web/` and has no `version.json`).
- Page: `season.js`'s `api()` and `coach.js`'s `api()` call `window.CFP.game.fetch` instead of `fetch`; `careersave.js`'s three fetches likewise. `season.html` and `coach.html` load `game-client.js` before `season.js`/`coach.js` and show a `#loading` overlay ("Loading the game, about 20 MB the first time; it is kept for next time" with a progress bar) until `ready`, or the fatal message ("This browser cannot run the game: it needs WebAssembly and Web Workers") when `window.Worker`/`WebAssembly` are missing or the worker posts `fatal`. A `storage-error` shows the toast "Your browser could not save the career: free some space or download it" (6 s).

- [ ] **Step 1: Write the failing browser test**

```python
# tests/test_browser_runtime.py: build dist to a temp dir, serve it with http.server (also under a /sub/ prefix: see Task 7), Playwright Chromium.
def native_digest():   # in-process, SIM_WORKERS=1, seed 11 SMU career, advance_to(st, 2); sha256 of sorted {event: [home, away]} [:12]

def test_two_weeks_match_native_and_reload_restores(page, base_url):
    page.goto(base_url + "/season.html")          # index.html after Task 7
    page.wait_for_selector("#loading", state="hidden", timeout=180_000)
    # the real page: pick SMU, New season with seed 11 (the Settings/seed control the e2e tests already use), Advance twice, wait for idle
    digest = page.evaluate(DIGEST_JS)             # fetches /api/season/<id>/week/1 and /2 through CFP.game.fetch and hashes like native_digest
    assert digest == native_digest()
    page.reload(); page.wait_for_selector("#loading", state="hidden", timeout=180_000)   # test_reload_restores_career
    assert page.evaluate(f"CFP.game.fetch('/api/season/{sid}').then(r => r.json()).then(s => s.current_week)") == 2

def test_syncfs_failure_toasts(page, base_url):   # Review Focus 3
    page.add_init_script("window.__cfpBreakStorage = true")   # worker.js: when the first message carries breakStorage, syncfs(false) rejects
    ... create a career; expect the toast text "Your browser could not save the career" visible, and GET /api/season/<id> still 200
```

Use `tests/test_career_e2e.py` as the model for launching Chromium and driving the page (seed entry, waiting for the sim). Keep each test under the 1500 s budget the spike used.

- [ ] **Step 2: Run it to verify it fails**

Run: `python tests/test_browser_runtime.py`
Expected: times out on `#loading` (no overlay/worker yet) or fails on `window.CFP.game`.

- [ ] **Step 3: Implement `call_js`, `web/worker.js`, `web/game-client.js`, the page hooks and the overlay**

Pyodide notes for the implementer: `FS.syncfs(populate, cb)` is callback-style, wrap it in a Promise; `pyodide.pyimport("app.api")` gives the module, `mod.call_js(...)` returns a JS string or a `PyProxy` of bytes (`.toJs()` → `Uint8Array`, then `.destroy()`); pass `report` as a JS function (Pyodide wraps it; call `report.destroy()` is not needed for plain functions); a `Uint8Array` passed into Python arrives as a `JsProxy` with `.to_bytes()`.

- [ ] **Step 4: Run the browser test, then the e2e tests on the dev server**

Run: `python tests/test_browser_runtime.py && python tests/test_career_e2e.py`
Expected: both exit 0. The dev server serves `web/`, which has no `version.json`, so `game-client.js` runs in passthrough mode there and the e2e tests exercise the same page code over HTTP.

- [ ] **Step 5: Commit**

```bash
git add app/api.py web/worker.js web/game-client.js web/season.html web/coach.html web/season.js web/coach.js web/careersave.js tests/test_browser_runtime.py
git commit -m "Run the game in a Web Worker on Pyodide, saves on IndexedDB; browser runtime test"
```

---

### Task 7: The page becomes Coach Career only

**Files:**
- Rename: `web/season.html` → `web/index.html` (overwriting the Sim a game page); create a new tiny `web/season.html` that redirects (`<meta http-equiv="refresh" content="0; url=./index.html">`)
- Delete: `web/app.js`
- Modify: `web/index.html` (nav: Coach Career, Your coach only; remove `#btn-today`, the `/real` script; meta description and og tags describe Coach Career; relative URLs), `web/coach.html` (nav, relative URLs), `web/manifest.json` (`start_url: "./"`, icon paths `./icons/...`), `web/season.js` (remove `browserId`, the `X-CFP-Browser` header, `mode=remaining` handling and `#btn-today`, the `browser` card field, `CareerSave.backup/restore/list/remove` calls at lines 73, 151, 161, 174, 271, 657, 866; relative `location` navigations), `web/coach.js` (`START_MODE`), `web/careersave.js` (only `download(id)` and `upload(file)` remain; the IndexedDB code goes; header comment rewritten), `web/gameview.js` (keep: `window.CFP` helpers; drop anything only `app.js` used, if trivially separable), `tools/dev_server.py` (`/` → `index.html`), `tests/test_browser_runtime.py` (goto `index.html`; serve `dist/` under `/sub/` for one of the tests), `tests/test_ux_sweep.py` (nav/screens that no longer exist)
- Test: `tests/test_web_urls.py`

**Interfaces:**
- Consumes `window.CFP.game.fetch` (Task 6).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_web_urls.py
def test_no_root_absolute_urls():
    bad = []
    for f in WEB.glob("*.html"): bad += re.findall(r'(?:href|src)="/(?!/)', f.read_text())
    for f in WEB.glob("*.js"):   bad += [m for m in re.findall(r'["\'](/(?!api/)[a-z][^"\']*)["\']', f.read_text())]
    bad += re.findall(r'"/(?!api/)', (WEB / "manifest.json").read_text())
    assert not bad, bad

def test_removed_modes_gone():
    assert not (WEB / "app.js").exists()
    for f in ("index.html", "coach.html"):
        t = (WEB / f).read_text()
        assert "Sim a game" not in t and "Real 2026" not in t and "Start from today" not in t and "btn-today" not in t
    assert "X-CFP-Browser" not in (WEB / "season.js").read_text() and "indexedDB" not in (WEB / "careersave.js").read_text()
```

And in `tests/test_browser_runtime.py`, serve `dist/` at `http://127.0.0.1:<port>/sub/` for the reload test (an `http.server` handler that strips the prefix) so a root-absolute link would 404.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python tests/test_web_urls.py`
Expected: the absolute-URL list is non-empty; `app.js` exists.

- [ ] **Step 3: Make the page changes listed in Files**

- [ ] **Step 4: Run the page tests, the browser test and the dev-server tests**

Run: `python tests/test_web_urls.py && python tests/test_browser_runtime.py && python tests/test_career_e2e.py && python tests/test_offseason_e2e.py && python tests/test_ux_sweep.py`
Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A web/ tools/dev_server.py tests/
git commit -m "The site is Coach Career: index page, relative URLs, no server-era modes or backups"
```

---

### Task 8: Publish to GitHub Pages, docs, final suite

**Files:**
- Create: `.github/workflows/pages.yml`
- Modify: `README.md`, `docs/HOW_IT_WORKS.md` (the "Running", "Saves", "Deployment" parts: the game runs in the browser; saves live in the browser's IndexedDB and as `.ccsave` downloads; local play is `python tools/dev_server.py`; publishing is a push to `main`), `tools/clean_data.py` (also removes `dist/` and `data/base_*.json`), `.gitignore`
- Delete: any `web/` or `sim/` code only the removed modes used that the earlier tasks left (grep `realdata` outside `sim/realdata.py` and the owner tools; `real_import`; `mode == "remaining"` in `sim/season.py` stays only if the golden test depends on it)
- Test: `tests/test_pages_workflow.py`

**Interfaces:**
- `pages.yml`: `on: push: branches: [main]` and `workflow_dispatch`; `permissions: pages: write, id-token: write, contents: read`; one job on `ubuntu-latest`: `actions/checkout@v4`, `actions/setup-python@v5` with `python-version: "3.12"`, `python -m teamdata.build_teams`, `python tools/build_site.py`, `actions/upload-pages-artifact@v3` with `path: dist`, `actions/deploy-pages@v4` in a `deploy` environment `github-pages`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pages_workflow.py
def test_workflow_builds_and_deploys_dist():
    wf = (ROOT / ".github" / "workflows" / "pages.yml").read_text()
    for s in ("python -m teamdata.build_teams", "python tools/build_site.py", "actions/upload-pages-artifact", "actions/deploy-pages", "path: dist", 'python-version: "3.12"'):
        assert s in wf, s
    assert "render" not in (ROOT / "README.md").read_text().lower()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python tests/test_pages_workflow.py`
Expected: `FileNotFoundError` on `pages.yml`.

- [ ] **Step 3: Write the workflow, update the docs and the cleaner, remove the leftovers**

- [ ] **Step 4: Run the whole suite**

Run: `python tests/run_all.py`
Expected: every test `PASS` (the e2e, bundle and browser tests included); `python tests/test_sim_golden.py` among them unchanged.

- [ ] **Step 5: Commit and push**

```bash
git add -A
git commit -m "Publish to GitHub Pages; docs for the browser runtime"
git push -u origin main
```

Then tell the user the one manual step: in the repository's Settings → Pages, set Source to "GitHub Actions"; the next push to `main` deploys, and the site's URL appears there.
