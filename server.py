"""CFP Coach Simulator web server.

Serves the single-page site in `web/` and a JSON API that runs games between any two
teams in `data/engine_teams.json` (built from `cfb_sim_data/` by `build_teams.py`) and
keeps a history of results in `data/games.json`.

Run:  python server.py        (then open http://127.0.0.1:8000)
"""
from __future__ import annotations

import json
import subprocess
import sys
import contextlib
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from engine.game import SLIDER_NAMES, default_sliders, simulate_game
import season

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
TEAMS_FILE = DATA_DIR / "engine_teams.json"
GAMES_FILE = DATA_DIR / "games.json"
INGEST_DIR = DATA_DIR / "ingest"
PRED_DIR = DATA_DIR / "predictions"
WEB_DIR = ROOT / "web"

MAX_HISTORY = 300
MAX_BATCH = 500

@contextlib.asynccontextmanager
async def _lifespan(_app: FastAPI):
    yield
    season.close_pool()   # stop the season workers so Ctrl-C exits at once


app = FastAPI(title="CFP Coach Simulator", lifespan=_lifespan)

_sim_lock = threading.Lock()  # the engine uses module-level state (sliders, TD log)
_games: list[dict] = []
_teams: dict[str, dict] = {}
_season_jobs: dict[str, dict] = {}   # season simulations, by job id


# ----- data ----------------------------------------------------------------

def _load_teams() -> None:
    global _teams
    if not TEAMS_FILE.exists():
        subprocess.run([sys.executable, str(ROOT / "build_teams.py")], check=True)
    _teams = json.loads(TEAMS_FILE.read_text(encoding="utf-8"))["teams"]


def _load_games() -> None:
    global _games
    if GAMES_FILE.exists():
        try:
            _games = json.loads(GAMES_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            _games = []


def _save_games() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    GAMES_FILE.write_text(json.dumps(_games), encoding="utf-8")


def _team(slug: str) -> dict:
    t = _teams.get(slug)
    if t is None:
        raise HTTPException(404, f"unknown team {slug}")
    return t


def _team_card(t: dict) -> dict:
    """What the team picker needs."""
    return {
        "slug": t["slug"], "name": t["name"], "school": t["school"], "abbreviation": t["abbreviation"],
        "mascot": t["mascot"], "conference": t["conference"], "subdivision": t["subdivision"],
        "fictional": t["fictional"], "colors": t["colors"], "stadium": t["stadium"],
        "home_field_advantage": t["home_field_advantage"], "prestige": t["prestige"],
        "ratings": t["team_ratings"],
        "head_coach": t["coaches"]["head_coach"]["name"],
        "tendencies": t.get("tendencies", {}),
    }


# ----- summaries -----------------------------------------------------------

def _summary(game: dict) -> dict:
    h, a = game["home"], game["away"]
    return {
        "id": game["id"], "played_at": game["played_at"],
        "home_name": h["name"], "away_name": a["name"],
        "home_slug": game.get("home_slug"), "away_slug": game.get("away_slug"),
        "home_score": h["score"], "away_score": a["score"],
        "winner": game["winner"], "overtime_periods": game["overtime_periods"],
        "venue": game.get("venue", "home"), "sliders": game.get("sliders", {}),
    }


def _team_line(team: dict) -> dict:
    s = team["team_stats"]
    return {
        "points": team["score"], "pass_yards": s["Pass Yards"], "rush_yards": s["Rush Yards"],
        "total_yards": s["Pass Yards"] + s["Rush Yards"],
        "turnovers": s["Interceptions Thrown"] + team.get("team_events", {}).get("fumbles_lost", 0),
        "sacks": s["Sacks"], "completions": s["Completions"], "pass_attempts": s["Pass Attempts"],
        "carries": s["Carries"],
    }


def _batch_summary(games: list[dict]) -> dict:
    n = len(games)
    if n == 0:
        return {"games": 0}
    home_wins = sum(1 for g in games if g["winner"] == "home")
    ot = sum(1 for g in games if g["overtime_periods"])
    keys = ["points", "pass_yards", "rush_yards", "total_yards", "turnovers", "sacks",
            "completions", "pass_attempts", "carries"]
    avg = {"home": {}, "away": {}}
    for side in ("home", "away"):
        lines = [_team_line(g[side]) for g in games]
        for k in keys:
            avg[side][k] = round(sum(l[k] for l in lines) / n, 1)
    margins = [g["home"]["score"] - g["away"]["score"] for g in games]
    return {
        "games": n, "home_name": games[0]["home"]["name"], "away_name": games[0]["away"]["name"],
        "venue": games[0].get("venue", "home"),
        "home_wins": home_wins, "away_wins": n - home_wins, "overtime_games": ot,
        "avg_margin_home": round(sum(margins) / n, 1),
        "biggest_home_win": max(margins), "biggest_away_win": -min(margins),
        "avg": avg,
    }


# ----- API -----------------------------------------------------------------

class SimRequest(BaseModel):
    home: str
    away: str
    venue: str = "home"           # "home" (first team hosts) or "neutral"
    count: int = Field(1, ge=1, le=MAX_BATCH)
    sliders: dict[str, Any] = Field(default_factory=dict)
    seed: Optional[int] = None


@app.get("/api/teams")
def list_teams() -> dict:
    cards = sorted((_team_card(t) for t in _teams.values()), key=lambda c: (c["fictional"], c["conference"], c["name"]))
    return {"teams": cards}


@app.get("/api/teams/{slug}")
def get_team(slug: str) -> dict:
    t = _team(slug)
    card = _team_card(t)
    card["coaches"] = t["coaches"]
    card["kick_returner"] = t.get("kick_returner")
    card["punt_returner"] = t.get("punt_returner")
    card["players"] = [
        {"name": p["name"], "slug": p.get("slug"), "position": p["position"], "unit": unit,
         "starter": bool(p.get("in_game")), "overall": _overall(p),
         "return_rating": p.get("return_rating"), "class": p.get("class"), "height": p.get("height"),
         "weight": p.get("weight"), "jersey": p.get("jersey"), "role": p.get("role")}
        for unit in ("offense", "defense") for p in t[unit]
    ]
    return card


@app.get("/api/sliders")
def get_sliders() -> dict:
    groups = {
        "Offense": ["qb_accuracy", "wr_catching", "pass_blocking", "run_blocking",
                    "running_ability", "fumble_frequency", "offensive_penalties"],
        "Defense": ["pass_defense", "interceptions", "pass_rush", "run_defense",
                    "tackling", "defensive_penalties", "forced_fumbles"],
        "Special Teams": ["kicking_power", "kicking_accuracy", "punt_accuracy",
                          "kickoff_power", "kickoff_return"],
        "Game": ["game_speed", "home_field_advantage"],
    }
    return {"defaults": default_sliders(), "groups": groups, "names": SLIDER_NAMES}


@app.post("/api/sim")
def post_sim(req: SimRequest) -> dict:
    home, away = _team(req.home), _team(req.away)
    if req.home == req.away:
        raise HTTPException(400, "pick two different teams")
    results = []
    with _sim_lock:
        for i in range(req.count):
            seed = None if req.seed is None else req.seed + i
            r = simulate_game(home, away, req.sliders, seed, venue=req.venue)
            r["home_slug"], r["away_slug"] = req.home, req.away
            results.append(r)
        _games.extend(results)
        del _games[:-MAX_HISTORY]
        _save_games()
    return {"games": results, "summary": _batch_summary(results)}


@app.get("/api/games")
def list_games(limit: int = 100) -> dict:
    recent = _games[-limit:] if limit > 0 else _games
    return {"games": [_summary(g) for g in reversed(recent)], "total": len(_games)}


@app.get("/api/games/{game_id}")
def get_game(game_id: str) -> dict:
    for g in _games:
        if g["id"] == game_id:
            return g
    raise HTTPException(404, "game not found")


@app.get("/api/history/summary")
def history_summary() -> dict:
    n = len(_games)
    if not n:
        return {"games": 0}
    return {
        "games": n,
        "home_wins": sum(1 for g in _games if g["winner"] == "home"),
        "overtime_games": sum(1 for g in _games if g["overtime_periods"]),
        "avg_points": round(sum(g["home"]["score"] + g["away"]["score"] for g in _games) / n, 1),
    }


@app.delete("/api/games")
def clear_games() -> dict:
    with _sim_lock:
        _games.clear()
        _save_games()
    return {"ok": True}


@app.get("/api/predictions")
def get_predictions() -> dict:
    """The latest frozen week of picks from forward_test.py, with its score report once
    the week has been scored. {"week": null, "games": []} when there are no predictions."""
    files = sorted(PRED_DIR.glob("week[0-9][0-9].json"))
    if not files:
        return {"week": None, "games": []}
    latest = files[-1]
    try:
        data = json.loads(latest.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"week": None, "games": []}
    score_file = latest.with_name(latest.stem + "_score.json")
    if score_file.exists():
        try:
            report = json.loads(score_file.read_text(encoding="utf-8"))
            data["score"] = {k: report.get(k) for k in ("scored", "pending", "straight_up", "mae", "slope", "total_bias")}
        except (OSError, ValueError):
            pass
    return data


@app.post("/api/ingest")
async def ingest(request: Request, name: str) -> dict:
    """Store a text payload under data/ingest/<name>.txt (used to collect real scores
    scraped in the browser for calibration)."""
    safe = "".join(c for c in name if c.isalnum() or c in "-_")[:40] or "payload"
    INGEST_DIR.mkdir(parents=True, exist_ok=True)
    body = await request.body()
    (INGEST_DIR / f"{safe}.txt").write_bytes(body)
    return {"ok": True, "bytes": len(body), "file": safe}


# ----- season simulation (week by week) --------------------------------------

class SeasonRequest(BaseModel):
    team: str
    mode: str = "full"            # "full" or "remaining"
    seed: Optional[int] = None


class AdvanceRequest(BaseModel):
    to: Optional[int] = None      # target week; omitted = one week


class SettingsRequest(BaseModel):
    god_mode: Optional[bool] = None


class PlayerEditRequest(BaseModel):
    team: str
    player: str                   # the player's slug
    changes: dict[str, Any]


class DepthRequest(BaseModel):
    role: Optional[str] = None
    player: Optional[str] = None
    move: str = "up"              # up, down or top
    reset: bool = False


_season_lock = threading.Lock()


def _season_state(season_id: str) -> dict:
    job = _season_jobs.get(season_id)
    if job and job.get("state") is not None:
        return job["state"]
    state = season.load_season(season_id)
    if state is None:
        raise HTTPException(404, "season not found")
    _season_jobs[season_id] = {"id": season_id, "status": "idle", "state": state, "done": state["current_week"], "total": state["current_week"]}
    return state


def _run_advance(job: dict, target: int) -> None:
    def progress(done: int, total: int) -> None:
        job["done"], job["total"] = done, total

    def report(stage: str, games_done: Optional[int], games_total: Optional[int]) -> None:
        job["stage"] = stage
        job["week"] = job["state"]["current_week"] + 1
        if games_total is not None:
            job["games_done"], job["games_total"] = games_done, games_total
        else:
            job["games_done"] = job["games_total"] = None

    try:
        with _season_lock:
            season.advance_to(job["state"], target, progress=progress, report=report, should_stop=lambda: job.get("stop", False))
            job["stage"] = "Saving"
            season.save_season(job["state"])
        job["paused"] = bool(job.get("stop")) and job["state"]["current_week"] < target and not job["state"]["done"]
        job["stop"] = False
        job["status"] = "idle"
        job["stage"] = None
    except Exception as exc:  # noqa: BLE001
        job["status"] = "error"
        job["error"] = str(exc)


@app.post("/api/season")
def create_season(req: SeasonRequest) -> dict:
    _team(req.team)
    if req.mode not in ("full", "remaining"):
        raise HTTPException(400, "mode must be full or remaining")
    state = season.new_season(req.team, req.mode, req.seed)
    season.save_season(state)
    _season_jobs[state["id"]] = {"id": state["id"], "status": "idle", "state": state, "done": state["current_week"], "total": state["current_week"]}
    return season.summary(state)


_season_cards: dict[str, tuple[float, dict]] = {}   # season id -> (file mtime, card)


@app.get("/api/seasons")
def list_seasons() -> dict:
    """The saved seasons, newest first. A season file can be several megabytes, so each
    card is cached by the file's modification time instead of re-read on every call."""
    out = []
    if season.SEASONS_DIR.exists():
        for path in sorted(season.SEASONS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:30]:
            mtime = path.stat().st_mtime
            cached = _season_cards.get(path.stem)
            if cached and cached[0] == mtime:
                out.append(cached[1])
                continue
            try:
                st = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if "current_week" not in st:
                continue
            rec = season._records(st)[st["team"]]
            card = {"id": st["id"], "team": st["team"], "team_name": st["team_name"], "mode": st["mode"],
                    "created_at": st["created_at"], "current_week": st["current_week"], "done": st["done"],
                    "wins": rec["wins"], "losses": rec["losses"], "champion_name": _teams.get(st.get("champion") or "", {}).get("name")}
            _season_cards[path.stem] = (mtime, card)
            out.append(card)
    return {"seasons": out}


@app.get("/api/season/{season_id}")
def get_season(season_id: str) -> dict:
    return season.summary(_season_state(season_id))


def _delete_season_file(season_id: str) -> bool:
    """Remove one saved season; False if it is simulating right now."""
    job = _season_jobs.get(season_id)
    if job and job.get("status") == "running":
        return False
    _season_jobs.pop(season_id, None)
    _season_cards.pop(season_id, None)
    folder = season.SEASONS_DIR / season_id
    if folder.exists():
        shutil.rmtree(folder, ignore_errors=True)
    path = season.SEASONS_DIR / f"{season_id}.json"
    if path.exists():
        path.unlink()
    return True


@app.delete("/api/season/{season_id}")
def delete_season(season_id: str) -> dict:
    if not (season.SEASONS_DIR / f"{season_id}.json").exists() and season_id not in _season_jobs:
        raise HTTPException(404, "season not found")
    if not _delete_season_file(season_id):
        raise HTTPException(409, "that season is simulating; wait for it to finish")
    return {"ok": True}


@app.delete("/api/seasons")
def delete_all_seasons() -> dict:
    """Delete every saved season except any that is simulating."""
    removed, kept = 0, 0
    if season.SEASONS_DIR.exists():
        for path in list(season.SEASONS_DIR.glob("*.json")):
            if _delete_season_file(path.stem):
                removed += 1
            else:
                kept += 1
    return {"ok": True, "removed": removed, "kept": kept}


@app.get("/api/season/{season_id}/status")
def season_status(season_id: str, since: Optional[int] = None) -> dict:
    """Job progress plus, while simming, your record and the results since week `since`."""
    state = _season_state(season_id)
    job = _season_jobs[season_id]
    out = {k: job.get(k) for k in ("id", "status", "done", "total", "error", "stage", "week", "games_done", "games_total", "paused")}
    out["current_week"] = state["current_week"]
    rec = season._records(state)[state["team"]]
    out["record"] = {"wins": rec["wins"], "losses": rec["losses"], "conf_wins": rec["conf_wins"], "conf_losses": rec["conf_losses"]}
    if since is not None:
        out["results"] = season.my_results(state, since)
    return out


@app.post("/api/season/{season_id}/pause")
def pause_season(season_id: str) -> dict:
    """Stop a running sim after the week in progress finishes."""
    _season_state(season_id)
    job = _season_jobs[season_id]
    if job.get("status") != "running":
        return {"status": job.get("status"), "stopping": False}
    job["stop"] = True
    return {"status": "running", "stopping": True}


@app.post("/api/season/{season_id}/advance")
def advance_season(season_id: str, req: AdvanceRequest) -> dict:
    state = _season_state(season_id)
    job = _season_jobs[season_id]
    if job["status"] == "running":
        raise HTTPException(409, "already simulating")
    if state["done"]:
        return {"status": "idle", "done": state["current_week"], "total": state["current_week"]}
    target = req.to if req.to is not None else state["current_week"] + 1
    target = max(state["current_week"] + 1, min(season.FINAL_WEEK, target))
    job.update(status="running", done=state["current_week"], total=target, stop=False, paused=False)
    threading.Thread(target=_run_advance, args=(job, target), daemon=True).start()
    return {"status": "running", "done": state["current_week"], "total": target}


@app.get("/api/season/{season_id}/week/{week}")
def season_week(season_id: str, week: int) -> dict:
    state = _season_state(season_id)
    table = season.standings(state) if week >= state["current_week"] else None
    return {"week": week, "games": season.week_view(state, week), "standings": table}


@app.get("/api/season/{season_id}/schedule/{slug}")
def season_team_schedule(season_id: str, slug: str) -> dict:
    """Any team's schedule with results, byes, ranks and opponent records."""
    state = _season_state(season_id)
    if slug not in _teams:
        raise HTTPException(404, "unknown team")
    return season.team_schedule_view(state, slug)


@app.get("/api/season/{season_id}/standings")
def season_standings(season_id: str) -> dict:
    return {"standings": season.standings(_season_state(season_id))}


@app.get("/api/season/{season_id}/review")
def season_review(season_id: str) -> dict:
    return season.season_review(_season_state(season_id))


@app.get("/api/season/{season_id}/resume")
def season_resume(season_id: str, week: Optional[int] = None, team: Optional[str] = None) -> dict:
    """The committee's resume for every FBS team through `week` (default: now); with
    `team`, that one team with its full game list."""
    return season.resume(_season_state(season_id), week, team)


@app.get("/api/season/{season_id}/game/{event_id}")
def season_game(season_id: str, event_id: str) -> dict:
    state = _season_state(season_id)
    box = season.load_box(state, event_id)
    if box is None:
        raise HTTPException(404, "no box score for that game")
    g = state["games"].get(event_id)
    if g is not None:
        riv = season.game_rivalry(state, g, after=True)
        if riv is not None:
            box = dict(box, rivalry=riv)
    return box


@app.get("/api/season/{season_id}/settings")
def season_settings(season_id: str) -> dict:
    return {"settings": season.settings(_season_state(season_id))}


@app.post("/api/season/{season_id}/settings")
def season_settings_change(season_id: str, req: SettingsRequest) -> dict:
    """Change a season's settings (god mode and the rest); saved with the season."""
    state = _season_state(season_id)
    with _season_lock:
        out = season.update_settings(state, req.model_dump())
        season.save_season(state)
    return {"settings": out}


@app.post("/api/season/{season_id}/player/edit")
def season_player_edit(season_id: str, req: PlayerEditRequest) -> dict:
    """God mode: change a player's ratings, class, size, jersey or development trait. The
    edit is saved with the season and used by every game from the next sim on."""
    state = _season_state(season_id)
    if not season.settings(state)["god_mode"]:
        raise HTTPException(403, "turn on god mode in Settings to edit players")
    if req.team not in _teams:
        raise HTTPException(404, "unknown team")
    job = _season_jobs.get(season_id)
    if job and job.get("status") == "running":
        raise HTTPException(409, "wait for the sim to finish")
    with _season_lock:
        try:
            edits = season.edit_player(state, req.team, req.player, req.changes)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        season.save_season(state)
    profile = season.player_profile(state, req.team, slug=req.player)
    return {"edits": edits, "player": profile}


@app.get("/api/season/{season_id}/preview")
def season_preview(season_id: str, team: Optional[str] = None) -> dict:
    """This week for a team (default: yours): the next game, a prediction from simulating
    it, and the injury report."""
    state = _season_state(season_id)
    slug = team or state["team"]
    if slug not in _teams:
        raise HTTPException(404, "unknown team")
    return season.game_preview(state, slug)


@app.get("/api/season/{season_id}/rivalries")
def season_rivalries(season_id: str, team: Optional[str] = None) -> dict:
    """A team's rivalries (default: yours): trophy, series today and this season's meeting."""
    state = _season_state(season_id)
    return season.rivalries_view(state, team or state["team"])


@app.get("/api/season/{season_id}/stats/teams")
def season_team_stats(season_id: str) -> dict:
    return season.team_stats_view(_season_state(season_id))


@app.get("/api/season/{season_id}/depth/{slug}")
def season_depth_chart(season_id: str, slug: str) -> dict:
    """One team's depth chart with each player's season headline."""
    state = _season_state(season_id)
    if slug not in _teams:
        raise HTTPException(404, "unknown team")
    return season.depth_chart_view(state, slug)


@app.get("/api/season/{season_id}/depth/{slug}/position/{role}")
def season_depth_position(season_id: str, slug: str, role: str) -> dict:
    """Every player on the roster rated at one depth-chart role."""
    state = _season_state(season_id)
    if slug not in _teams:
        raise HTTPException(404, "unknown team")
    if role not in season.ROLE_POSITION and role not in ("KR", "PR"):
        raise HTTPException(404, "unknown role")
    return season.position_candidates(state, slug, role)


@app.post("/api/season/{season_id}/depth/{slug}")
def season_depth_change(season_id: str, slug: str, req: DepthRequest) -> dict:
    """Move a player on a team's depth chart (or reset the team). The change is saved with
    the season and used by every game from then on."""
    state = _season_state(season_id)
    if slug not in _teams:
        raise HTTPException(404, "unknown team")
    if slug != state["team"] and not season.settings(state)["god_mode"]:
        raise HTTPException(403, "turn on god mode in Settings to edit another team's depth chart")
    job = _season_jobs.get(season_id)
    if job and job.get("status") == "running":
        raise HTTPException(409, "wait for the sim to finish")
    with _season_lock:
        if req.reset:
            season.reset_depth(state, slug)
        else:
            if not req.role or not req.player:
                raise HTTPException(400, "role and player are required")
            try:
                season.move_depth(state, slug, req.role, req.player, req.move)
            except ValueError as exc:
                raise HTTPException(400, str(exc))
        season.save_season(state)
    return season.depth_chart_view(state, slug)


@app.get("/api/season/{season_id}/injuries")
def season_injuries(season_id: str, team: Optional[str] = None) -> dict:
    """The injury list: one team or the whole league, with weeks left and the return week."""
    state = _season_state(season_id)
    return {"injuries": season.injury_report(state, team or None), "week": state["current_week"]}


@app.get("/api/season/{season_id}/awards")
def season_awards(season_id: str) -> dict:
    """Every award: the live race until they are given, then the results."""
    return season.awards_view(_season_state(season_id))


@app.get("/api/season/{season_id}/player")
def season_player(season_id: str, team: str, name: Optional[str] = None, position: Optional[str] = None, slug: Optional[str] = None) -> dict:
    """One player's page: bio, ratings, season totals, ranks, game log, honors."""
    state = _season_state(season_id)
    if team not in _teams:
        raise HTTPException(404, "unknown team")
    prof = season.player_profile(state, team, name=name or None, position=position or None, slug=slug or None)
    if prof is None:
        raise HTTPException(404, "player not found")
    return prof


@app.get("/api/season/{season_id}/stats/leaders")
def season_player_leaders(season_id: str, team: Optional[str] = None, n: int = 5, conference: Optional[str] = None) -> dict:
    state = _season_state(season_id)
    if team and team not in _teams:
        raise HTTPException(404, "unknown team")
    return season.player_leaders_view(state, team or None, max(1, min(n, 25)), conference or None)


@app.get("/api/season/{season_id}/stats/players")
def season_player_stats(season_id: str, team: Optional[str] = None, cat: str = "passing", limit: int = 100,
                        conference: Optional[str] = None) -> dict:
    state = _season_state(season_id)
    if team and team not in _teams:
        raise HTTPException(404, "unknown team")
    try:
        return season.player_stats_view(state, team or None, cat, limit, conference or None)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


# ----- ratings (display only; the engine uses the raw attributes) ----------

_OFF_KEYS = ["speed", "strength", "intelligence", "passing", "decision_making", "hands",
             "route_running", "run_blocking", "pass_blocking", "elusiveness", "vision"]
_DEF_KEYS = ["speed", "strength", "intelligence", "tackling", "coverage", "rushing"]


_overall = season.player_overall


# ----- static site ---------------------------------------------------------

@app.middleware("http")
async def no_cache_site_files(request: Request, call_next):
    """The page, script and stylesheet change between runs; make browsers revalidate."""
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.endswith((".js", ".css", ".html", ".json")):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/season")
def season_page() -> FileResponse:
    return FileResponse(WEB_DIR / "season.html")


app.mount("/", StaticFiles(directory=WEB_DIR), name="web")

_load_teams()
_load_games()

def _lan_ip() -> str:
    """The address other devices on the local network use to reach this PC."""
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))   # no traffic is sent; picks the outbound interface
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


if __name__ == "__main__":
    # `python server.py` serves on every interface so a phone on the same Wi-Fi can open
    # it at http://<this PC's address>:8000. `python server.py --local` keeps it to this PC.
    import os
    local_only = "--local" in sys.argv
    host = "127.0.0.1" if local_only else "0.0.0.0"
    port = int(os.environ.get("PORT", "8000"))   # hosting platforms set PORT
    print(f"CFP Coach Simulator: http://127.0.0.1:{port}  (this PC)")
    if not local_only:
        print(f"                     http://{_lan_ip()}:{port}  (phones and other devices on this network)")
    uvicorn.run(app, host=host, port=port)
