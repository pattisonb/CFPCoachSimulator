"""The Coach Career API as plain functions: the same paths the page calls (`/api/season/...`,
`/api/coaches`, `/api/teams`), routed by `call(method, path, body)` to handlers that return a
dict (or bytes, for a save file) and raise `ApiError(status, message)` where a web server
would answer with an error. No web framework: the browser worker (Pyodide) and the dev server
both call this module.

One season is held in memory at a time (`_loaded`, with its job record `_job`); asking for
another one replaces it, except while its job runs. An advance or a game day only sets the job
running; the caller then calls `step()` until it returns None, one week (or your game) a call,
since in the browser there is one thread and no sim can run in the background. `changed()`
tells the caller that a season or coach file was written or deleted since it last asked (the
browser then persists its files).
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import urllib.parse
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

if sys.platform == "emscripten":                 # in the browser: no worker processes, games run in-process
    os.environ.setdefault("SIM_WORKERS", "1")

from coach_career import career
from coach_career import league
from coach_career import offseason
from coach_career import prospects
from coach_career import recruiting
from sim import coaches
from sim import season

MAX_SAVE_BYTES = 40 * 1024 * 1024    # an uploaded career (gzip); a career with its recruiting class is about 5 MB compressed


# ----- errors and params -----------------------------------------------------

class ApiError(Exception):
    """A refused call: `status` is the HTTP code a server would answer with."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass
class Params:
    """What a handler gets: the `{name}` parts of the path, the query string and the body
    (a JSON object as a dict, raw bytes for an upload, or None)."""
    path: dict[str, str] = field(default_factory=dict)
    query: dict[str, str] = field(default_factory=dict)
    body: dict | bytes | None = None

    def q(self, name: str, cast: Callable = str, default: Any = None) -> Any:
        """The query value `name` passed through `cast`, or `default` when it is not given."""
        if name not in self.query:
            return default
        try:
            return cast(self.query[name])
        except (TypeError, ValueError):
            raise ApiError(422, f"{name} must be a {cast.__name__}") from None


def boolean(text: str) -> bool:
    """A query flag: true/false (also 1/0, yes/no)."""
    v = text.strip().lower()
    if v in ("true", "1", "yes"):
        return True
    if v in ("false", "0", "no"):
        return False
    raise ValueError(text)


_MISSING = object()


def _field(p: Params, name: str, kind: type, default: Any = _MISSING) -> Any:
    """A field of the JSON body. Without a default it is required: missing or of the wrong
    type is a 422 "<name> is required". With one, a missing or null field gives the default and a
    wrongly typed one is a 422."""
    body = p.body if isinstance(p.body, dict) else {}
    value = body.get(name)
    if value is None:
        if default is _MISSING:
            raise ApiError(422, f"{name} is required")
        return default
    if not isinstance(value, kind) or (kind is int and isinstance(value, bool)):
        if default is _MISSING:
            raise ApiError(422, f"{name} is required")
        raise ApiError(422, f"{name} must be a {kind.__name__}")
    return value


# ----- routing -----------------------------------------------------------------

ROUTES: list[tuple[str, str, Callable[[Params], dict | bytes]]] = []


def route(method: str, pattern: str):
    """Register the decorated handler for `method` on `pattern` (`{name}` matches one path segment)."""
    def add(fn: Callable[[Params], dict | bytes]) -> Callable[[Params], dict | bytes]:
        ROUTES.append((method.upper(), pattern, fn))
        return fn
    return add


def routes() -> set[tuple[str, str]]:
    """Every registered `(method, pattern)`."""
    return {(m, pattern) for m, pattern, _ in ROUTES}


def _match(pattern: str, parts: list[str]) -> Optional[dict[str, str]]:
    """The path's `{name}` values if `parts` fits `pattern`, else None."""
    want = pattern.strip("/").split("/")
    if len(want) != len(parts):
        return None
    out = {}
    for w, part in zip(want, parts):
        if w.startswith("{") and w.endswith("}"):
            value = urllib.parse.unquote(part)
            if value in ("", ".", "..") or "/" in value or "\\" in value:   # an id never names a path outside its folder
                return None
            out[w[1:-1]] = value
        elif w != part:
            return None
    return out


def call(method: str, path: str, body: dict | bytes | None = None) -> dict | bytes:
    """Answer one API call the way the server did: the handler's dict (or bytes), or ApiError."""
    method = method.upper()
    url = urllib.parse.urlsplit(path)
    parts = url.path.strip("/").split("/")
    query = dict(urllib.parse.parse_qsl(url.query, keep_blank_values=True))
    known_path = False
    for m, pattern, fn in ROUTES:
        values = _match(pattern, parts)
        if values is None:
            continue
        known_path = True
        if m == method:
            return fn(Params(path=values, query=query, body=body))
    if known_path:
        raise ApiError(405, "method not allowed")
    raise ApiError(404, "not found")


def call_js(method: str, path: str, body_json: str | None, body_bytes=None) -> str | bytes:
    """The browser worker's entry point (web/worker.js): `call()` with the body as the page sent
    it, a JSON string or a `Uint8Array` (a Pyodide JsProxy, which wins when both are given), and
    the answer as JSON for the worker to parse: `{"ok": true, "result", "changed"}`, an ApiError
    as `{"ok": false, "status", "message", "changed"}` (another exception: status 500); a bytes
    result (a save file) comes back as the bytes themselves."""
    try:
        if body_bytes is not None:
            body = body_bytes.to_bytes() if hasattr(body_bytes, "to_bytes") else bytes(body_bytes)
        elif body_json is not None:
            try:
                body = json.loads(body_json)
            except ValueError as exc:
                raise ApiError(400, "invalid JSON") from exc
        else:
            body = None
        out = call(method, path, body)
    except ApiError as exc:
        return json.dumps({"ok": False, "status": exc.status, "message": exc.message, "changed": changed()})
    except Exception as exc:  # noqa: BLE001 - the page shows the error; the worker stays up
        return json.dumps({"ok": False, "status": 500, "message": str(exc), "changed": changed()})
    if isinstance(out, (bytes, bytearray)):
        return bytes(out)
    did_change = changed()
    try:
        return json.dumps({"ok": True, "result": out, "changed": did_change}, allow_nan=False)
    except ValueError as exc:   # a NaN or infinity in the result: JSON.parse would reject the whole reply
        return json.dumps({"ok": False, "status": 500, "message": f"the reply is not valid JSON: {exc}", "changed": did_change})


# ----- season state ------------------------------------------------------------

_loaded: dict | None = None          # the one season in memory
_job: dict = {}                      # its job record (an advance or game day in progress, or idle)
_changed: bool = False               # a season or coach file was written or deleted since changed() was last read
_cards: dict[str, tuple[float, dict]] = {}   # season id -> (file mtime, card) for the seasons list
_teams: dict[str, dict] = {}         # the 2026 teams (data/engine_teams.json), read on first use


def changed() -> bool:
    """True once after a call that saved or deleted a season or coach file; reading clears it."""
    global _changed
    out, _changed = _changed, False
    return out


def _mark_changed() -> None:
    global _changed
    _changed = True


def loaded_state() -> dict | None:
    """The season in memory, or None."""
    return _loaded


def job() -> dict:
    """The job record of the season in memory (empty when none is loaded)."""
    return _job


def _idle_job(state: dict) -> dict:
    """A season's job record when nothing is simulating."""
    week = state["current_week"]
    return {"id": state["id"], "status": "idle", "done": week, "total": week, "stage": None, "week": None,
            "games_done": None, "games_total": None, "week_frac": None, "paused": False, "gameday_event": None,
            "error": None, "stop": False, "target": None, "kind": None}


def _activate(state: dict) -> None:
    """Put the season's league in play (a career's later seasons have their own, league.py)."""
    season.use_league(league.ensure_built(state) or season.TEAMS_FILE)


def _hold(state: dict) -> None:
    """Make `state` the season in memory, with an idle job, and put its league in play. Every
    handler saves what it changes before returning, so the season it replaces has nothing
    left to write."""
    global _loaded, _job
    _loaded, _job = state, _idle_job(state)
    _activate(state)


def _drop(season_id: str) -> None:
    """Forget the season in memory if it is `season_id` (its file was deleted)."""
    global _loaded, _job
    if _loaded is not None and _loaded["id"] == season_id:
        _loaded, _job = None, {}


def running() -> bool:
    """True while an advance or game day is in progress: the caller then calls step()."""
    return _job.get("status") == "running"


def _check_not_running() -> None:
    """409 while the season in memory is simulating: nothing may change or replace it then."""
    if running():
        raise ApiError(409, "wait for the sim to finish")


def _season_state(season_id: str) -> dict:
    """The season, from memory or its file (which then replaces the one in memory; refused
    while the one in memory is simulating)."""
    if _loaded is not None and _loaded["id"] == season_id:
        _activate(_loaded)
        return _loaded
    _check_not_running()
    state = season.load_season(season_id)
    if state is None:
        raise ApiError(404, "season not found")
    _hold(state)
    return state


def _reporter(state: dict, report: Callable[[str], None] | None):
    """The callback a sim calls with its stage and game count: written onto the job for the
    status, then, when `report` is given, the status passed on as JSON (in-week progress)."""
    def on_progress(stage: str, games_done: Optional[int], games_total: Optional[int]) -> None:
        _job["stage"] = stage
        week = _job["done"] + 1                    # the week being simmed (`done` moves once all of it is over)
        if _job.get("week") != week:
            _job["week"], _job["_played"] = week, False
        if games_total is not None:
            _job["games_done"], _job["games_total"] = games_done, games_total
            _job["_played"] = _job.get("_played") or games_done >= games_total
            _job["week_frac"] = 0.05 + 0.75 * games_done / max(1, games_total)
        else:
            _job["games_done"] = _job["games_total"] = None
            # before the games a sliver; after them (polls, awards, recruiting) the last part of the week
            played = _job.get("_played") or state["current_week"] >= week
            _job["week_frac"] = max(_job.get("week_frac") or 0, 0.85) if played else 0.02
        if report is not None:
            report(json.dumps(_status(state, _job.get("since"))))
    return on_progress


def _status(state: dict, since: Optional[int]) -> dict:
    """Job progress plus your record and rank, and your results after week `since` when given."""
    out = {k: _job.get(k) for k in ("id", "status", "done", "total", "error", "stage", "week", "games_done",
                                    "games_total", "week_frac", "paused", "gameday_event")}
    out["current_week"] = state["current_week"]
    rec = season._records(state, include_playoff=True)[state["team"]]
    out["record"] = {"wins": rec["wins"], "losses": rec["losses"], "conf_wins": rec["conf_wins"], "conf_losses": rec["conf_losses"]}
    out["my_rank"] = season.current_rank(state)      # the header's rank follows the sim week by week
    if since is not None:
        out["results"] = season.my_results(state, since)
    return out


def step(report: Callable[[str], None] | None = None) -> dict | None:
    """Play the running job's next unit: one week of an advance, or your game on game day.
    Saves the season, moves the job on (back to idle when the run is over, paused or done)
    and returns the status with your results since the week the run started from. `report`,
    when given, gets that status as JSON once before the sim starts (the page sees the run at
    once), after every progress callback and once at the end. None when nothing is running. A
    failure sets the job to "error" instead of raising and reloads the season from its last
    save, so nothing half-played stays in memory."""
    if _loaded is None or not running():
        return None
    state = _loaded
    on_progress = _reporter(state, report)
    if report is not None:
        report(json.dumps(_status(state, _job.get("since"))))
    try:
        if _job["kind"] == "gameday":
            _job["gameday_event"] = season.play_my_game(state, None, report=on_progress)
            season.save_season(state)
            _mark_changed()
            over = True
        else:
            if not _job["stop"] and not state["done"]:   # a pause lands between weeks, as advance_to checked it
                # every week after the run's first runs your recruiting week too, as one advance_to call did
                season.advance(state, season.shared_pool(), on_progress, auto_recruit=state["current_week"] > _job["since"])
                season.save_season(state)
                _mark_changed()
            _job["done"] = state["current_week"]
            over = _job["done"] >= _job["target"] or state["done"] or _job["stop"]
            if over:
                _job["paused"] = _job["stop"] and _job["done"] < _job["target"] and not state["done"]
        if over:
            _job.update(status="idle", stage=None, stop=False)
    except Exception as exc:  # noqa: BLE001 - the page shows the error; the dispatcher stays up
        # the half-played week is dropped: the season in memory is the last save again, so the
        # next handler that saves cannot write it
        since = _job.get("since")
        saved = season.load_season(state["id"])
        if saved is not None:
            _hold(saved)
            state = _loaded
        _job.update(status="error", error=str(exc), stage=None, stop=False, since=since)
    out = _status(state, _job.get("since"))
    if report is not None:
        report(json.dumps(out))
    return out


def _all_teams() -> dict[str, dict]:
    """The 2026 teams by slug (every team drop-down and the team pages read these)."""
    global _teams
    if not _teams:
        _teams = json.loads(season.TEAMS_FILE.read_text(encoding="utf-8"))["teams"]
    return _teams


def _team(slug: str) -> dict:
    t = _all_teams().get(slug)
    if t is None:
        raise ApiError(404, f"unknown team {slug}")
    return t


# ----- teams -------------------------------------------------------------------

def _team_card(t: dict) -> dict:
    """What the team picker needs."""
    return {
        "slug": t["slug"], "name": t["name"], "school": t["school"], "abbreviation": t["abbreviation"],
        "mascot": t["mascot"], "conference": t["conference"], "subdivision": t["subdivision"],
        "fictional": t["fictional"], "colors": t["colors"], "stadium": t["stadium"],
        "home_field_advantage": t["home_field_advantage"], "prestige": t["prestige"],
        "ratings": t["team_ratings"],
        "head_coach": t["coaches"]["head_coach"]["name"],
        "staff": coaches.staff(None, t),
        "tendencies": t.get("tendencies", {}),
    }


@route("GET", "/api/teams")
def list_teams(p: Params) -> dict:
    # alphabetical (FBS first, then the FCS stand-ins): every team drop-down follows this order
    cards = sorted((_team_card(t) for t in _all_teams().values()), key=lambda c: (c["fictional"], c["name"].casefold()))
    return {"teams": cards}


@route("GET", "/api/teams/{slug}")
def get_team(p: Params) -> dict:
    t = _team(p.path["slug"])
    card = _team_card(t)
    card["coaches"] = t["coaches"]
    card["kick_returner"] = t.get("kick_returner")
    card["punt_returner"] = t.get("punt_returner")
    card["players"] = [
        {"name": pl["name"], "slug": pl.get("slug"), "position": pl["position"], "unit": unit,
         "starter": bool(pl.get("in_game")), "overall": season.player_overall(pl),
         "return_rating": pl.get("return_rating"), "class": pl.get("class"), "height": pl.get("height"),
         "weight": pl.get("weight"), "jersey": pl.get("jersey"), "role": pl.get("role")}
        for unit in ("offense", "defense") for pl in t[unit]
    ]
    return card


# ----- seasons -----------------------------------------------------------------

@route("POST", "/api/season")
def create_season(p: Params) -> dict:
    """A new Coach Career (the only mode; a `career` field in the body is ignored)."""
    team = _field(p, "team", str)
    mode = _field(p, "mode", str, "full")
    seed = _field(p, "seed", int, None)
    coach_id = _field(p, "coach", str, None)
    _team(team)
    coach = None
    if coach_id:
        coach = coaches.load(coach_id)
        if coach is None:
            raise ApiError(404, "unknown coach")
    if mode != "full":
        raise ApiError(400, "Coach Career starts from week 1")
    _check_not_running()
    season.use_league(season.TEAMS_FILE)          # a new career starts in the 2026 league
    state = season.new_season(team, mode, seed, coach=coach, career=True)
    season.save_season(state)
    _mark_changed()
    _hold(state)
    return season.summary(state)


@route("GET", "/api/season/{season_id}/export")
def export_career(p: Params) -> bytes:
    """The career as one gzip file (`full` adds every game's box score, for the Download career button)."""
    state = _season_state(p.path["season_id"])
    if not career.is_career(state):
        raise ApiError(404, "not a Coach Career")
    return career.export_save(state, boxes=p.q("full", boolean, False))


@route("POST", "/api/season/import")
def import_career(p: Params) -> dict:
    """A career from a file. Whichever copy is newer is kept, so a stale file never replaces a
    career that has moved on."""
    blob = p.body
    if not isinstance(blob, (bytes, bytearray)):
        raise ApiError(422, "body is required")
    if len(blob) > MAX_SAVE_BYTES:
        raise ApiError(413, "that file is too large to be a Coach Career save")
    try:
        sid = career.read_save(blob)[0]["id"]
    except ValueError as exc:
        raise ApiError(400, str(exc)) from exc
    if running() and _loaded["id"] == sid:
        raise ApiError(409, "that career is simulating; try again when the week is done")
    _check_not_running()
    current = _loaded if _loaded is not None and _loaded["id"] == sid else season.load_season(sid)
    try:
        state = career.restore(blob, current)
    except ValueError as exc:
        raise ApiError(409, str(exc)) from exc
    if state is not current:                  # the file won: it was written
        _mark_changed()
        _cards.pop(sid, None)
        state = season.load_season(sid)
    _hold(state)
    return season.summary(state)


@route("GET", "/api/season/{season_id}/status")
def season_status(p: Params) -> dict:
    """Job progress plus your record and, with `since`, your results after that week."""
    return _status(_season_state(p.path["season_id"]), p.q("since", int, None))


@route("POST", "/api/season/{season_id}/pause")
def pause_season(p: Params) -> dict:
    """Stop a running advance once the week in progress is over."""
    _season_state(p.path["season_id"])
    if not running():
        return {"status": _job.get("status"), "stopping": False}
    _job["stop"] = True
    return {"status": "running", "stopping": True}


@route("POST", "/api/season/{season_id}/advance")
def advance_season(p: Params) -> dict:
    """Set an advance running to week `to` (default: the next week); step() plays it."""
    state = _season_state(p.path["season_id"])
    to = _field(p, "to", int, None)
    if running():
        raise ApiError(409, "already simulating")
    week = state["current_week"]
    if state["done"]:
        return {"status": "idle", "done": week, "total": week}
    target = max(week + 1, min(season.FINAL_WEEK, to if to is not None else week + 1))
    _job.update(status="running", kind="advance", target=target, done=week, total=target, since=week,
                stop=False, paused=False, gameday_event=None, error=None)
    return {"status": "running", "done": week, "total": target}


@route("POST", "/api/season/{season_id}/gameday")
def gameday_season(p: Params) -> dict:
    """Game day: set only your game this week running (the week's matchups are set first if
    they are not yet); step() plays it. Advance then plays the rest of the week."""
    state = _season_state(p.path["season_id"])
    if running():
        raise ApiError(409, "already simulating")
    week = state["current_week"]
    if state["done"]:
        return {"status": "idle", "done": week, "total": week}
    if season.my_game_id(state) is None:
        raise ApiError(409, "no game this week: a bye, or your game is already played")
    _job.update(status="running", kind="gameday", target=week + 1, done=week, total=week + 1, since=week,
                stop=False, paused=False, gameday_event=None, error=None, stage="Simming your game", week=week + 1)
    return {"status": "running", "done": week, "total": week + 1}


@route("GET", "/api/seasons")
def list_seasons(p: Params) -> dict:
    """The saved seasons, newest first. A season file can be several megabytes, so each
    card is cached by the file's modification time instead of re-read on every call."""
    out = []
    if season.SEASONS_DIR.exists():
        for path in sorted(season.SEASONS_DIR.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True)[:30]:
            mtime = path.stat().st_mtime
            cached = _cards.get(path.stem)
            if cached and cached[0] == mtime:
                out.append(cached[1])
                continue
            try:
                st = json.loads(path.read_text(encoding="utf-8"))
                if "current_week" not in st or st.get("mode") == "real":   # the old server's real 2026 season
                    continue
                rec = season._records(st, include_playoff=True)[st["team"]]
                card = {"id": st["id"], "team": st["team"], "team_name": st["team_name"], "mode": st["mode"],
                        "created_at": st["created_at"], "current_week": st["current_week"], "done": st["done"],
                        "wins": rec["wins"], "losses": rec["losses"], "champion_name": _all_teams().get(st.get("champion") or "", {}).get("name"),
                        "year": st.get("year") or 2026, "career": bool(st.get("career")), "offseason": (st.get("offseason") or {}).get("stage")}
            except Exception:  # noqa: BLE001 - one unreadable file must not break the list
                continue
            _cards[path.stem] = (mtime, card)
            out.append(card)
    return {"seasons": out}


@route("GET", "/api/season/{season_id}")
def get_season(p: Params) -> dict:
    return season.summary(_season_state(p.path["season_id"]))


def _delete_season_file(season_id: str) -> bool:
    """Remove one saved season; False if it is simulating right now."""
    if _loaded is not None and _loaded["id"] == season_id and _job.get("status") == "running":
        return False
    _drop(season_id)
    _cards.pop(season_id, None)
    folder = season.SEASONS_DIR / season_id
    if folder.exists():
        shutil.rmtree(folder, ignore_errors=True)
    path = season.SEASONS_DIR / f"{season_id}.json"
    if path.exists():
        path.unlink()
    league.forget(season_id)
    _mark_changed()
    return True


@route("DELETE", "/api/season/{season_id}")
def delete_season(p: Params) -> dict:
    season_id = p.path["season_id"]
    in_memory = _loaded is not None and _loaded["id"] == season_id
    if not (season.SEASONS_DIR / f"{season_id}.json").exists() and not in_memory:
        raise ApiError(404, "season not found")
    if not _delete_season_file(season_id):
        raise ApiError(409, "that season is simulating; wait for it to finish")
    return {"ok": True, "deleted": True}


@route("DELETE", "/api/seasons")
def delete_all_seasons(p: Params) -> dict:
    """Delete every saved season except any that is simulating."""
    removed, kept = 0, 0
    if season.SEASONS_DIR.exists():
        for path in list(season.SEASONS_DIR.glob("*.json")):
            if _delete_season_file(path.stem):
                removed += 1
            else:
                kept += 1
    return {"ok": True, "removed": removed, "kept": kept}


# ----- coaches -----------------------------------------------------------------

@route("GET", "/api/coach-options")
def coach_options(p: Params) -> dict:
    return coaches.options()


@route("GET", "/api/coaches")
def coach_list(p: Params) -> dict:
    return {"coaches": coaches.list_all()}


@route("GET", "/api/coaches/{coach_id}")
def coach_get(p: Params) -> dict:
    c = coaches.load(p.path["coach_id"])
    if c is None:
        raise ApiError(404, "unknown coach")
    return c


@route("POST", "/api/coaches")
def coach_save(p: Params) -> dict:
    _check_not_running()
    try:
        c = coaches.save(_field(p, "coach", dict))
    except ValueError as exc:
        raise ApiError(400, str(exc)) from exc
    _mark_changed()
    return c


@route("DELETE", "/api/coaches/{coach_id}")
def coach_delete(p: Params) -> dict:
    _check_not_running()
    try:
        deleted = coaches.delete(p.path["coach_id"])
    except ValueError as exc:
        raise ApiError(404, str(exc)) from exc
    if deleted:
        _mark_changed()
    return {"deleted": deleted}


# ----- helpers for the season routes -------------------------------------------

def _save_loaded() -> None:
    """Write the season in memory to its file (a handler that changed it calls this before returning)."""
    season.save_season(_loaded)
    _cards.pop(_loaded["id"], None)
    _mark_changed()


def _check_team(slug: str) -> None:
    """404 for a slug that is not a team."""
    if slug not in _all_teams():
        raise ApiError(404, "unknown team")


def _need(p: Params, name: str) -> str:
    """A required query parameter: 422 when it is missing."""
    value = p.q(name)
    if value is None:
        raise ApiError(422, f"{name} is required")
    return value


def _career_state(season_id: str, change: bool = False) -> dict:
    """The season, which must be a Coach Career; with `change`, refused while it simulates."""
    state = _season_state(season_id)
    if not state.get("recruiting"):
        raise ApiError(404, "not a Coach Career")
    if change:
        _check_not_running()
    return state


def _recruiting_call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except recruiting.RecruitingError as e:
        raise ApiError(404 if e.message in ("unknown prospect",) else e.code, e.message) from e


def _offseason_state(season_id: str) -> dict:
    """A career whose season is over, with its offseason open (opened on first ask)."""
    st = _career_state(season_id, change=True)
    if not st.get("done"):
        raise ApiError(409, "the season is not over")
    if not st.get("offseason"):
        offseason.start(st)
        _save_loaded()
    return st


# ----- schedule, views and settings --------------------------------------------

@route("GET", "/api/season/{season_id}/week/{week}")
def season_week(p: Params) -> dict:
    try:
        week = int(p.path["week"])
    except ValueError:
        raise ApiError(422, "week must be an int") from None
    state = _season_state(p.path["season_id"])
    table = season.standings(state) if week >= state["current_week"] else None
    return {"week": week, "games": season.week_view(state, week), "standings": table}


@route("GET", "/api/season/{season_id}/schedule/{slug}")
def season_team_schedule(p: Params) -> dict:
    """Any team's schedule with results, byes, ranks and opponent records."""
    state = _season_state(p.path["season_id"])
    _check_team(p.path["slug"])
    return season.team_schedule_view(state, p.path["slug"])


@route("GET", "/api/season/{season_id}/schedule_edit")
def schedule_edit_view(p: Params) -> dict:
    """Your non-conference games you can still trade (a career, before week 1), with the options for each."""
    state = _season_state(p.path["season_id"])
    games = season.schedule_editable(state)
    return {"games": [dict(g, options=season.schedule_options(state, g["event_id"])) for g in games],
            "changes": state.get("schedule_changes") or []}


@route("POST", "/api/season/{season_id}/schedule_edit")
def schedule_edit_swap(p: Params) -> dict:
    """Trade one of your non-conference games for another school's that week."""
    state = _season_state(p.path["season_id"])
    event_id, slug = _field(p, "event_id", str), _field(p, "slug", str)
    _check_not_running()
    try:
        season.schedule_swap(state, event_id, slug)
    except season.ScheduleError as e:
        raise ApiError(e.code, str(e)) from e
    _save_loaded()
    return {"changes": state.get("schedule_changes") or []}


@route("POST", "/api/season/{season_id}/redshirt")
def season_redshirt(p: Params) -> dict:
    """Redshirt one of your players for the rest of the season, or take him off it (four games or fewer)."""
    state = _career_state(p.path["season_id"])
    team, player, on = _field(p, "team", str), _field(p, "player", str), _field(p, "on", bool, True)
    _check_team(team)
    if team != state["team"]:
        raise ApiError(403, "only your own players")
    _check_not_running()
    try:
        out = season.redshirt_toggle(state, team, player, on)
    except season.RedshirtError as e:
        raise ApiError(e.code, str(e)) from e
    _save_loaded()
    return out


@route("GET", "/api/season/{season_id}/standings")
def season_standings(p: Params) -> dict:
    return {"standings": season.standings(_season_state(p.path["season_id"]))}


@route("GET", "/api/season/{season_id}/review")
def season_review(p: Params) -> dict:
    return season.season_review(_season_state(p.path["season_id"]))


@route("GET", "/api/season/{season_id}/resume")
def season_resume(p: Params) -> dict:
    """The committee's resume for every FBS team through `week` (default: now); with
    `team`, that one team with its full game list."""
    return season.resume(_season_state(p.path["season_id"]), p.q("week", int), p.q("team"))


@route("GET", "/api/season/{season_id}/game/{event_id}")
def season_game(p: Params) -> dict:
    state = _season_state(p.path["season_id"])
    event_id = p.path["event_id"]
    box = season.load_box(state, event_id)
    if box is None:
        raise ApiError(404, "no box score for that game")
    g = state["games"].get(event_id)
    if g is not None:
        riv = season.game_rivalry(state, g, after=True)
        if riv is not None:
            box = dict(box, rivalry=riv)
    return box


@route("GET", "/api/season/{season_id}/settings")
def season_settings(p: Params) -> dict:
    return {"settings": season.settings(_season_state(p.path["season_id"]))}


@route("POST", "/api/season/{season_id}/settings")
def season_settings_change(p: Params) -> dict:
    """Change a season's settings (god mode and the rest; a career's Auto-recruit); saved with the season."""
    state = _season_state(p.path["season_id"])
    changes = {"god_mode": _field(p, "god_mode", bool, None), "morale": _field(p, "morale", bool, None)}
    auto = (p.body if isinstance(p.body, dict) else {}).get("auto_recruit")   # "off", "week" or "season" (true/false still read)
    if auto is not None and not isinstance(auto, (bool, str)):
        raise ApiError(422, "auto_recruit must be a bool or a str")
    mode = {True: "season", False: "off"}.get(auto, auto) if isinstance(auto, bool) else auto
    if auto is not None and mode not in recruiting.AUTO_MODES:
        raise ApiError(400, "Auto-recruit is off, week or season")
    if auto is not None and not state.get("recruiting"):
        raise ApiError(404, "not a Coach Career")
    out = season.update_settings(state, changes)
    if auto is not None:
        state["career"]["settings"]["auto_recruit"] = mode
        if mode != "off":                  # your staff take over: an open call or visit scene is dropped
            recruiting.clear_scenes(state, state["team"])
    _save_loaded()
    res = {"settings": out}
    if state.get("career"):
        res["auto_recruit"] = recruiting.auto_mode(state)
    return res


# ----- recruiting (reads wait for a running sim too: the week's step changes what they read) -----

@route("GET", "/api/season/{season_id}/recruiting")
def recruiting_view(p: Params) -> dict:
    return prospects.recruiting_view(_career_state(p.path["season_id"], change=True))


@route("GET", "/api/season/{season_id}/programs")
def programs_view(p: Params) -> dict:
    """Every program's living rating (prestige, winning, NIL, market, conference, coach; tier and goal), yours first."""
    from coach_career import programs
    st = _career_state(p.path["season_id"])
    rows = programs.rows(st)
    me = next((r for r in rows if r["team"] == st["team"]), None)
    return {"you": me, "rows": rows, "tiers": programs.TIER_NAMES, "weights": programs.WEIGHTS}


@route("GET", "/api/season/{season_id}/recruiting/report")
def recruiting_reports(p: Params) -> dict:
    """The weekly reports kept (what changed for the prospects on your board), latest last."""
    st = _career_state(p.path["season_id"], change=True)
    return {"reports": st["recruiting"].get("reports") or []}


@route("GET", "/api/season/{season_id}/prospects")
def prospect_search(p: Params) -> dict:
    st = _career_state(p.path["season_id"], change=True)
    return prospects.search(st, st["team"], p.q("position"), p.q("stars", int), p.q("state"), p.q("status"), p.q("q"),
                            max(0, p.q("offset", int, 0)), p.q("limit", int, 50), p.q("sort", str, "rank"), p.q("group"))


@route("GET", "/api/season/{season_id}/classes")
def national_classes(p: Params) -> dict:
    """Every FBS school's class ranked nationally; with `school`, that class's recruits too."""
    st = _career_state(p.path["season_id"], change=True)
    school = p.q("school")
    if school:
        _check_team(school)
    with prospects.class_block(st):
        out = prospects.national_classes(st, st["team"])
        if school:
            out["class"] = prospects.class_detail(st, school, st["team"])
    return out


@route("GET", "/api/season/{season_id}/prospect/{pid}")
def prospect_profile(p: Params) -> dict:
    st = _career_state(p.path["season_id"], change=True)
    return _recruiting_call(prospects.profile, st, p.path["pid"], st["team"])


@route("POST", "/api/season/{season_id}/recruit")
def recruit_action(p: Params) -> dict:
    st = _career_state(p.path["season_id"], change=True)
    pid, action = _field(p, "pid", str), _field(p, "action", str)
    pitch, nil, scene = _field(p, "pitch", str, None), _field(p, "nil", int, 0), _field(p, "scene", str, None)
    if pid not in recruiting.visible(st):
        raise ApiError(404, "unknown prospect")
    out = _recruiting_call(recruiting.act, st, st["team"], pid, action, pitch, nil, scene)
    _save_loaded()
    return out


@route("POST", "/api/season/{season_id}/board")
def board_change(p: Params) -> dict:
    st = _career_state(p.path["season_id"], change=True)
    pid, on = _field(p, "pid", str), _field(p, "on", bool, True)
    if pid not in recruiting.visible(st):
        raise ApiError(404, "unknown prospect")
    recruiting.set_board(st, pid, on)
    _save_loaded()
    return {"board": st["recruiting"]["board"]}


@route("POST", "/api/season/{season_id}/staff")
def staff_change(p: Params) -> dict:
    st = _career_state(p.path["season_id"], change=True)
    _recruiting_call(recruiting.assign, st, _field(p, "staff_id", str), _field(p, "area", str))
    _save_loaded()
    return {"staff": st["career"]["staff"]}


# ----- the offseason (offseason.py): departures, the transfer portal, development, staff -----

@route("GET", "/api/season/{season_id}/offseason")
def offseason_view(p: Params) -> dict:
    st = _offseason_state(p.path["season_id"])
    return offseason.view(st, p.q("position"), p.q("status"))


@route("POST", "/api/season/{season_id}/offseason/advance")
def offseason_advance(p: Params) -> dict:
    """The next offseason stage; past the last one (or with to="next_season"), the next season."""
    st = _offseason_state(p.path["season_id"])
    to = _field(p, "to", str, None)
    if to == "next_season":
        offseason.run_all(st)
    elif st["offseason"]["stage"] != "ready":
        offseason.advance(st)
        _save_loaded()
        return offseason.view(st)
    new = offseason.next_season(st)
    _hold(new)
    _save_loaded()
    return {"next_season": True, "year": new["year"], "summary": season.summary(new)}


@route("POST", "/api/season/{season_id}/offseason/portal")
def offseason_portal(p: Params) -> dict:
    st = _offseason_state(p.path["season_id"])
    pid, on = _field(p, "pid", str), _field(p, "on", bool, True)
    try:
        offers = offseason.portal_offer(st, pid, on)
    except KeyError:
        raise ApiError(404, "unknown portal player") from None
    except (OverflowError, ValueError) as e:
        raise ApiError(409, str(e)) from e
    _save_loaded()
    return {"offers": offers}


@route("POST", "/api/season/{season_id}/offseason/redshirt")
def offseason_redshirt(p: Params) -> dict:
    """Your call on one player's redshirt (the Departures step)."""
    st = _offseason_state(p.path["season_id"])
    pid, on = _field(p, "pid", str), _field(p, "on", bool, True)
    try:
        offseason.redshirt(st, pid, on)
    except offseason.RosterError as e:
        raise ApiError(e.code, str(e)) from e
    _save_loaded()
    return offseason.view(st)


@route("GET", "/api/season/{season_id}/offseason/position_options")
def offseason_position_options(p: Params) -> dict:
    """What one of your players would be at every position."""
    st = _offseason_state(p.path["season_id"])
    pid = _need(p, "pid")
    try:
        return {"options": offseason.position_options(st, pid)}
    except offseason.RosterError as e:
        raise ApiError(e.code, str(e)) from e


@route("POST", "/api/season/{season_id}/offseason/position")
def offseason_position(p: Params) -> dict:
    """Move one of your players to another position for next season."""
    st = _offseason_state(p.path["season_id"])
    pid, pos = _field(p, "pid", str), _field(p, "pos", str)
    try:
        offseason.change_position(st, pid, pos)
    except offseason.RosterError as e:
        raise ApiError(e.code, str(e)) from e
    _save_loaded()
    return offseason.view(st)


@route("POST", "/api/season/{season_id}/offseason/retain")
def offseason_retain(p: Params) -> dict:
    """Keep them home: one move with a leaver (meet, promise a starting role, NIL from next year's budget, let him go)."""
    st = _offseason_state(p.path["season_id"])
    pid, action, nil = _field(p, "pid", str), _field(p, "action", str), _field(p, "nil", int, 0)
    try:
        offseason.retain(st, pid, action, nil=nil)
    except offseason.RetentionError as e:
        raise ApiError(e.code, str(e)) from e
    _save_loaded()
    return offseason.view(st)


@route("POST", "/api/season/{season_id}/offseason/review")
def offseason_review(p: Params) -> dict:
    """Your meeting with the AD: what you say, then his decision (firing happens only here)."""
    st = _offseason_state(p.path["season_id"])
    action, staff_id = _field(p, "action", str), _field(p, "staff_id", str, None)
    try:
        offseason.review_decide(st, action, staff_id=staff_id)
    except offseason.ReviewError as e:
        raise ApiError(e.code, str(e)) from e
    _save_loaded()
    return offseason.view(st)


@route("POST", "/api/season/{season_id}/offseason/job")
def offseason_job(p: Params) -> dict:
    """Take a job offer (or, fired, an opening); team null stays put."""
    st = _offseason_state(p.path["season_id"])
    team = _field(p, "team", str, None)
    try:
        car = offseason.choose_job(st, team)
    except ValueError as e:
        raise ApiError(409, str(e)) from e
    _save_loaded()
    return {"choice": car["choice"]}


@route("POST", "/api/season/{season_id}/offseason/hire")
def offseason_hire(p: Params) -> dict:
    st = _offseason_state(p.path["season_id"])
    staff_id, index = _field(p, "staff_id", str), _field(p, "index", int)
    try:
        staff = offseason.hire(st, staff_id, index)
    except ValueError as e:
        raise ApiError(400, str(e)) from e
    _save_loaded()
    return {"hired": staff["hired"]}


@route("POST", "/api/season/{season_id}/offseason/open_role")
def offseason_open_role(p: Params) -> dict:
    """Let one of your own coaches go at the Staff step: he joins the market, his job gets candidates."""
    st = _offseason_state(p.path["season_id"])
    staff_id = _field(p, "staff_id", str)
    try:
        offseason.open_role(st, staff_id)
    except ValueError as e:
        raise ApiError(409, str(e)) from e
    _save_loaded()
    return offseason.view(st)


# ----- roster and stats: god-mode edits, preview, depth charts, injuries, awards, players, leaders -----

@route("POST", "/api/season/{season_id}/player/edit")
def season_player_edit(p: Params) -> dict:
    """God mode: change a player's ratings, class, size, jersey or development trait. The
    edit is saved with the season and used by every game from the next sim on."""
    state = _season_state(p.path["season_id"])
    team, player, changes = _field(p, "team", str), _field(p, "player", str), _field(p, "changes", dict)
    if not season.settings(state)["god_mode"]:
        raise ApiError(403, "turn on god mode in Settings to edit players")
    _check_team(team)
    _check_not_running()
    try:
        edits = season.edit_player(state, team, player, changes)
    except ValueError as exc:
        raise ApiError(400, str(exc)) from exc
    _save_loaded()
    return {"edits": edits, "player": season.player_profile(state, team, slug=player)}


@route("GET", "/api/season/{season_id}/preview")
def season_preview(p: Params) -> dict:
    """This week for a team (default: yours): the next game, a prediction from simulating
    it, and the injury report."""
    state = _season_state(p.path["season_id"])
    slug = p.q("team") or state["team"]
    _check_team(slug)
    return season.game_preview(state, slug)


@route("GET", "/api/season/{season_id}/rivalries")
def season_rivalries(p: Params) -> dict:
    """A team's rivalries (default: yours): trophy, series today and this season's meeting."""
    state = _season_state(p.path["season_id"])
    return season.rivalries_view(state, p.q("team") or state["team"])


@route("GET", "/api/season/{season_id}/stats/teams")
def season_team_stats(p: Params) -> dict:
    return season.team_stats_view(_season_state(p.path["season_id"]))


@route("GET", "/api/season/{season_id}/depth/{slug}")
def season_depth_chart(p: Params) -> dict:
    """One team's depth chart with each player's season headline."""
    state = _season_state(p.path["season_id"])
    _check_team(p.path["slug"])
    return season.depth_chart_view(state, p.path["slug"])


@route("GET", "/api/season/{season_id}/depth/{slug}/position/{role}")
def season_depth_position(p: Params) -> dict:
    """Every player on the roster rated at one depth-chart role."""
    state = _season_state(p.path["season_id"])
    slug, role = p.path["slug"], p.path["role"]
    _check_team(slug)
    if role not in season.ROLE_POSITION and role not in ("KR", "PR"):
        raise ApiError(404, "unknown role")
    return season.position_candidates(state, slug, role)


@route("POST", "/api/season/{season_id}/depth/{slug}")
def season_depth_change(p: Params) -> dict:
    """Move a player on a team's depth chart (or reset the team). The change is saved with
    the season and used by every game from then on."""
    state = _season_state(p.path["season_id"])
    slug = p.path["slug"]
    role, player = _field(p, "role", str, None), _field(p, "player", str, None)
    move, reset = _field(p, "move", str, "up"), _field(p, "reset", bool, False)
    _check_team(slug)
    if slug != state["team"] and not season.settings(state)["god_mode"]:
        raise ApiError(403, "turn on god mode in Settings to edit another team's depth chart")
    _check_not_running()
    if reset:
        season.reset_depth(state, slug)
    else:
        if not role or not player:
            raise ApiError(400, "role and player are required")
        try:
            season.move_depth(state, slug, role, player, move)
        except ValueError as exc:
            raise ApiError(400, str(exc)) from exc
    _save_loaded()
    return season.depth_chart_view(state, slug)


@route("GET", "/api/season/{season_id}/injuries")
def season_injuries(p: Params) -> dict:
    """The injury list: one team or the whole league, with weeks left and the return week."""
    state = _season_state(p.path["season_id"])
    return {"injuries": season.injury_report(state, p.q("team") or None), "week": state["current_week"]}


@route("GET", "/api/season/{season_id}/awards")
def season_awards(p: Params) -> dict:
    """Every award: the live race until they are given, then the results."""
    return season.awards_view(_season_state(p.path["season_id"]))


@route("GET", "/api/season/{season_id}/player")
def season_player(p: Params) -> dict:
    """One player's page: bio, ratings, season totals, ranks, game log, honors."""
    state = _season_state(p.path["season_id"])
    team = _need(p, "team")
    _check_team(team)
    prof = season.player_profile(state, team, name=p.q("name") or None, position=p.q("position") or None,
                                 slug=p.q("slug") or None)
    if prof is None:
        raise ApiError(404, "player not found")
    return prof


@route("GET", "/api/season/{season_id}/stats/leaders")
def season_player_leaders(p: Params) -> dict:
    state = _season_state(p.path["season_id"])
    team = p.q("team")
    if team:
        _check_team(team)
    return season.player_leaders_view(state, team or None, max(1, min(p.q("n", int, 5), 25)), p.q("conference") or None)


@route("GET", "/api/season/{season_id}/stats/players")
def season_player_stats(p: Params) -> dict:
    state = _season_state(p.path["season_id"])
    team = p.q("team")
    if team:
        _check_team(team)
    try:
        return season.player_stats_view(state, team or None, p.q("cat", str, "passing"), p.q("limit", int, 100),
                                        p.q("conference") or None)
    except ValueError as exc:
        raise ApiError(400, str(exc)) from exc
