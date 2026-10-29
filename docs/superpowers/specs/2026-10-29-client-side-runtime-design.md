# Client-side runtime: Coach Career in the browser, no server

Status: design, for review. Spike measured 2026-10-29 (section 2). Builds on everything under
`coach_career/`, `sim/`, `engine/` and `teamdata/`, which stay as they are; replaces `server.py`
as a web process, the Render deployment and the browser's dependence on a backend.

## 1. Why

- The game runs on a shared free Render instance: 512 MB, one slow CPU, a disk that empties on
  every restart. A played career's first offseason peaked at 530 MB (now 470); two careers at
  once cannot both be in memory; the server sleeps and wakes slowly; and the limits added this
  week (one career per browser, one season in memory, five seasons) exist only to protect it.
- Every player's data already lives in their browser (careersave.js keeps a copy of the career
  after every week). The server adds nothing a browser cannot do for itself, the way ZenGM runs
  entirely client-side.
- The game logic is about 19,000 lines of standard-library Python. A browser can run it as it is.

## 2. The measurement that decides the approach

Pyodide 0.26.4 (CPython 3.12 compiled to WebAssembly) in headless Chromium on this machine, the
game's packages and data unpacked from one zip, `SIM_WORKERS=1`, seed 11, SMU career:

| Step | Native, one process | Pyodide |
|---|---|---|
| Load the runtime | — | 2.7 s (then cached) |
| Unpack game code and data (5.5 MB zip) | — | 1.2 s |
| New career (class of 4,092 generated) | 5.1 s | 6.8 s |
| Week 1 (99 games, the recruiting week) | 3.7 s | 5.6 s |
| Week 2 | 5.4 s | 9.4 s |
| A plain season's week | 0.9 s | 1.5 s |
| Scores after two weeks (sha256 prefix) | `007fcb29e84b` | `007fcb29e84b` |
| Python heap after two weeks | — | 190 MB |

Pyodide runs the existing Python at about 1.5x native single-process time and reproduces every
score byte for byte, because Pyodide's `random` is CPython's. The golden test and every realism
result carry over. A season sims in about two minutes; a new career opens in seven seconds.

Rejected: a TypeScript rewrite (months, every tuned result re-earned, high divergence risk); a
hybrid that ports the play engine to JavaScript later stays open as a follow-on if speed matters.

## 3. Scope

**In:** Coach Career, complete: the Office, recruiting (board, pipeline, map, scenes), Prospects,
Staff, Classes, schedule, depth chart, players, stats, polls and the playoff, awards, rivalries,
the resume, the offseason (departures, retention, the portal weeks, development, staff, the AD
review, the carousel), the next season, Your coach, saves (browser, download, load), settings.

**Out (removed with their code, screens and data):** Sim a game (`index.html`, `app.js`, the
`/api/sim`, `/api/games`, `/api/history`, `/api/predictions`, `/api/ingest`, `/api/sliders`
endpoints and the sim history), Real 2026 (`/real`, `/api/real/*`, `realdata` as a runtime),
Start from today (`mode="remaining"`, `real_import`), the forward test's prediction publishing.
Their owner-side tools (`tools/fetch_*.py`, `tools/forward_test.py`, `tools/realism*.py`) stay
in the repo as offline tools; `sim/realdata.py` stays importable for them.

**Fresh start:** the new app reads nothing from the Render era (no IndexedDB migration). The
`.ccsave` download format stays, so a career can move between devices from here on.

**Removed limits:** `MAX_CAREERS`, `MAX_SEASONS`, `_evict_others`, the browser id header and the
career's `browser` field: a browser holds its own careers and pays for its own memory.

## 4. Architecture

```
GitHub Pages (static files)
  index.html  season.js recruiting.js offseason.js coach.js ...   (the page: UI only)
  worker.js   ──── postMessage ────▶  Pyodide (CPython/wasm) in a Web Worker
  game.zip    (python packages + data, unpacked into the worker's in-memory FS at /home/pyodide)
  pyodide/    (served from the Pyodide CDN, version pinned; cached by the browser)
IndexedDB     ◀── Emscripten IDBFS mounted at /home/pyodide/data/seasons and /data/coaches
```

- **The page** keeps every screen. `api(path, options)` in season.js and coach.js posts
  `{id, method, path, body}` to the worker and awaits `{id, ok, result | error}`; the roughly 80
  call sites and their paths do not change. careersave.js's three raw `fetch` calls (export,
  export full, import) go through the same client with a bytes body or result. A long call (advance) streams `{id, progress}`
  messages the page renders where it renders the status poll today.
- **The worker** loads Pyodide, unpacks `game.zip`, mounts IDBFS, imports `app.api` and loops
  on messages: one dispatcher call per message, in order (one career in play at a time, as the
  server has today).
- **The dispatcher** (`app/api.py`) is `server.py`'s career handlers without FastAPI: one
  `call(method, path, body) -> dict | bytes` routing the same paths to the same functions and
  raising `ApiError(status, message)` where the server raised `HTTPException`. It owns what the
  server owned: the loaded season, the advance job, the pending-save timer (now an explicit
  `flush()` the worker calls after each mutating message), the real-season guards (gone).
- **The dev server** (`tools/dev_server.py`, FastAPI or `http.server`) wraps the same dispatcher
  over HTTP and serves `web/`, so local play and the Playwright tests keep an HTTP path. It is a
  tool, not a deployment.

## 5. The dispatcher's routes

Kept, moved to `app/api.py` with their behaviour (the handler bodies move; the `_season_jobs`,
`_season_lock`, `_pending_saves` machinery shrinks to one loaded season and an explicit flush):

`POST /api/season` (career only; `mode` is always `full`), `GET/DELETE /api/season/{id}`,
`GET /api/seasons`, `DELETE /api/seasons`, `GET .../export`, `POST /api/season/import`,
`.../status`, `.../pause`, `.../advance`, `.../gameday`, `.../week/{w}`, `.../schedule/{slug}`,
`.../schedule_edit` (GET, POST), `.../redshirt`, `.../standings`, `.../review`, `.../resume`,
`.../game/{event}`, `.../settings` (GET, POST), `.../recruiting`, `.../programs`,
`.../recruiting/report`, `.../prospects`, `.../classes`, `.../prospect/{pid}`, `.../recruit`,
`.../board`, `.../staff`, `.../offseason` and its eight POSTs, `.../player/edit`, `.../preview`,
`.../rivalries`, `.../stats/teams`, `.../stats/leaders`, `.../stats/players`, `.../depth/{slug}`
(GET, POST) and `.../depth/{slug}/position/{role}`, `.../injuries`, `.../awards`, `.../player`,
`GET /api/teams`, `GET /api/teams/{slug}`, `GET /api/coach-options`, `/api/coaches` (GET, POST,
GET one, DELETE).

Removed: everything under section 3's "Out".

**Advance.** Today `POST .../advance` starts a thread and the page polls `.../status`. In the
worker there is one thread, so `advance` runs the weeks inline and calls a `progress(stage,
done, total)` callback the worker turns into progress messages; `.../status` stays as a plain
query of the loaded season for the page's existing code paths; `.../pause` sets the stop flag the
sim already checks between weeks (the worker handles the pause message between dispatcher calls,
which is why `advance` yields to the message loop after each week: `advance_to` is called one
week at a time from the worker, not once for the whole range). The dev server keeps the thread.

**Exports.** `GET .../export` returns bytes (the gzip save); the worker returns them as a
transferable buffer and the page makes the download. `POST /api/season/import` takes the file
bytes the same way.

## 6. Storage

- Emscripten's IDBFS is mounted at `/home/pyodide/data/seasons` and `/home/pyodide/data/coaches`
  before the first call; `FS.syncfs(true)` loads it at start, `FS.syncfs(false)` persists it after
  every message whose dispatcher call changed a file (the dispatcher returns `changed: true`;
  the worker syncs). Python's own file I/O (`season.save_season`, `save_box`, `coaches.save`,
  `league.ensure_built` writing `data/leagues`) is untouched. `data/leagues` is not persisted:
  a career's league teams file is rebuilt on demand (about 4 s) the first time it is needed after
  a reload; a later task may persist it if that wait matters.
- The browser's own copy (careersave.js backup after every week) is therefore no longer a copy
  of something else: it is the store. careersave.js keeps Download career and Load career, drops
  the server backup/restore and the import-on-reopen path, and the Seasons list reads
  `GET /api/seasons` as today (now a listing of IDBFS).
- Quota: a career save is 5-18 MB plus box scores; browsers allow hundreds of MB to GB. A
  failed `syncfs` surfaces as a toast ("Your browser could not save the career: free some space
  or download it") and the page keeps working from memory.
- A fallback if IDBFS proves unreliable on a browser: the worker reads the save file bytes after
  each changed call and writes them to IndexedDB itself (the careersave store), restoring them
  into the FS at start. The dispatcher contract is the same either way.

## 7. The data bundle

`tools/build_site.py` writes `dist/`:

- `game.zip`: `engine/`, `sim/`, `coach_career/`, `teamdata/`, `app/` (`.py` only) and the data
  a career reads (measured by opening every file through a season, its offseason and the next
  season's first week): `engine_teams.json`, `player_potential.json`, `recruiting_model.json`,
  `history/polls.json`, `schedules.json`, `schedule_rules.json`, `series.json`, `rivalries.json`,
  `bowls.json`, `fcs_map.json`, `game_scale.json`, `observed_tendencies.json`,
  `manual_ratings.json`, `scheme_overrides.json`, `poll_params.json`, `program_history.json`,
  `program_market.json`, `real_adjustments.json`, `coach_birth_years.json`, `draft_targets.json`,
  `cfb_sim_data/coaches.json`, `cfb_sim_data/teams_index.json`, `cfb_sim_data/league.json`.
- The first offseason today reads all 146 source rosters (68 MB raw, 7.2 MB compressed) to build
  the career's league (`league.from_base`). Instead the bundle carries `data/base_league.json`:
  `from_base()`'s output computed at build time (the compact league, about 7 MB raw, 1.5 MB
  compressed), `data/base_meta.json` (every team's identity: what `league.base_meta` returns)
  and the eight fictional teams' full files under `cfb_sim_data/teams/`. `league.from_base`
  returns the precomputed league when the file exists (a deep copy); `base_meta` reads the
  meta file; `base_team` is only ever called for the fictional eight in the browser.
- Target: about 8 MB compressed in `game.zip`; Pyodide's own files (about 13 MB) come from
  `https://cdn.jsdelivr.net/pyodide/v0.26.4/full/`, version pinned in `worker.js`.
- `dist/version.json` carries the commit; the page fetches `game.zip?v=<commit>` so a deploy is
  never served stale.

## 8. Build and publish

- `tools/build_site.py`: copies `web/` (minus the removed pages), writes `game.zip`,
  `base_league.json`, `base_meta.json`, `version.json`. Idempotent; runs in CI and locally.
- `.github/workflows/pages.yml`: on push to `main`, set up Python 3.12, `python -m
  teamdata.build_teams` (as Render's build did), `python tools/build_site.py`, upload `dist/`
  with `actions/upload-pages-artifact`, deploy with `actions/deploy-pages`. Pages is configured
  to "GitHub Actions" as its source (a one-time setting in the repository).
- Data refreshes (real results, recruiting model, ratings) remain owner tools: run, commit, push.
- `render.yaml`, `Procfile`, `run.bat`'s server line and `requirements.txt`'s FastAPI/uvicorn (kept
  only if the dev server uses FastAPI; `http.server` otherwise) go or shrink accordingly.

## 9. The page

- `index.html` becomes the career page (what `season.html` is today: the Seasons list, New
  season, Load career, Your coach). `season.html` redirects to it; `coach.html` stays.
- A loading screen while Pyodide and `game.zip` arrive on first visit ("Loading the game, about
  20 MB the first time; it is kept for next time"), with progress from the fetches.
- `api()` goes through `worker.js`'s client: a promise per message id, progress callbacks for
  `advance`, errors carrying the status and message the toasts already print.
- The top bar loses Sim a game, Real 2026 and Start from today.
- The card "Download career" asks the worker for the export bytes; "Load career" sends the file's
  bytes to the import call.
- If the browser cannot run WebAssembly or a Worker, the page says so and stops.

## 10. Dev server and tests

- `tools/dev_server.py` serves `web/` and routes `/api/*` to `app.api.call`, running `advance`
  on a thread with the status poll as today so the page's progress code is exercised the same
  way the worker exercises it. `python tools/dev_server.py` replaces `uvicorn server:app`.
- Native tests keep running on CPython: every `tests/test_*.py` imports `app.api` (or the modules
  under it) instead of `server`; `tests/test_recruiting_api.py` calls the dispatcher directly;
  the Playwright tests (`test_career_e2e`, `test_offseason_e2e`, `test_ux_sweep`) launch the dev
  server. The golden test is unchanged.
- New `tests/test_browser_runtime.py`: builds `dist/`, serves it, opens it in Chromium with
  Pyodide, creates a seed-11 SMU career, advances two weeks through the real page, and asserts
  the score digest equals the native digest for the same seed (the spike's check, made a test).
  It also reloads the page and asserts the career comes back from IndexedDB with its week.
- `tools/check_recruiting.py`, `tools/long_run.py` and the realism tools are unchanged.

## 11. Risks and answers

- **Speed on phones.** Pyodide on a mid-range phone is 2-4x slower than this machine: a week in
  15-30 s, a season in 5-8 minutes. The worker keeps the page responsive and the Office shows
  progress; "Sim to the end" is a background task the player can leave running. Follow-on if it
  matters: a second worker for games (the pool pattern) or the engine in JavaScript.
- **Memory.** 190 MB after two weeks in the spike; the first offseason adds the league (about
  60 MB in Python objects). Mobile Safari kills tabs past roughly 1-1.5 GB; a career stays well
  inside. The precomputed league removes the 146-file read that was the old peak.
- **IDBFS quirks.** Safari's IndexedDB has had bugs with large values; the fallback in section
  6 is designed in. The browser test covers reload.
- **First load.** About 20 MB once; a cold Render wake was a minute, so this is a better first
  minute, and later visits are instant.
- **Determinism.** Proven by the spike for the game engine; the browser test pins it.

## 12. Out of scope

Porting Python to JavaScript; cloud saves or sync between devices; multiplayer; the Sim a game
and Real 2026 modes; migrating Render-era saves; changing any game rule.
