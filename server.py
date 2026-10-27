"""CFP Coach Simulator web server.

Serves the single-page site in `web/` and a JSON API that runs games between any two
teams in `data/engine_teams.json` (built from `cfb_sim_data/` by `teamdata/build_teams.py`) and
keeps a history of results in `data/games.json`.

Run:  python server.py        (then open http://127.0.0.1:8000)
"""
from __future__ import annotations

import contextlib
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from engine.game import SLIDER_NAMES, default_sliders, simulate_game
from coach_career import career
from coach_career import league
from coach_career import offseason
from coach_career import prospects
from sim import realdata
from coach_career import recruiting
from sim import season
from sim import coaches

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
TEAMS_FILE = DATA_DIR / "engine_teams.json"
GAMES_FILE = DATA_DIR / "games.json"
INGEST_DIR = DATA_DIR / "ingest"
PRED_DIR = DATA_DIR / "predictions"
WEB_DIR = ROOT / "web"

MAX_HISTORY = 300
MAX_BATCH = 500

_real_ready = threading.Event()


def _startup_real() -> None:
    try:
        if realdata.stale():
            _refresh_real()
    finally:
        _real_ready.set()


@contextlib.asynccontextmanager
async def _lifespan(_app: FastAPI):
    # the real season is rebuilt in the background when its data changed, so /real opens at once
    threading.Thread(target=_startup_real, daemon=True).start()
    threading.Thread(target=prospects.warm, daemon=True).start()   # the first Prospect Profile opens at once
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
    builder = ROOT / "teamdata" / "build_teams.py"
    if not TEAMS_FILE.exists() or builder.stat().st_mtime > TEAMS_FILE.stat().st_mtime:   # missing, or built by an older builder
        subprocess.run([sys.executable, "-m", "teamdata.build_teams"], cwd=ROOT, check=True)
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


def _check_team(slug: str) -> None:
    """404 for a slug that is not a team."""
    if slug not in _teams:
        raise HTTPException(404, "unknown team")


_overall = season.player_overall   # the display rating (the engine uses the raw attributes)


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
    # alphabetical (FBS first, then the FCS stand-ins): every team drop-down follows this order
    cards = sorted((_team_card(t) for t in _teams.values()), key=lambda c: (c["fictional"], c["name"].casefold()))
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
    coach: Optional[str] = None   # a saved coach (the Your coach page) to put on the team
    career: bool = False          # a Coach Career (career.py)


class CoachRequest(BaseModel):
    coach: dict[str, Any]


class AdvanceRequest(BaseModel):
    to: Optional[int] = None      # target week; omitted = one week


class SettingsRequest(BaseModel):
    god_mode: Optional[bool] = None
    morale: Optional[bool] = None
    auto_recruit: Optional[bool | str] = None   # a Coach Career's Auto-recruit: "off", "week" or "season" (true/false still read)


class RecruitRequest(BaseModel):
    pid: str
    action: str                   # message, call, hc_visit, offer, official_visit, pull_offer
    pitch: Optional[str] = None
    nil: int = 0


class BoardRequest(BaseModel):
    pid: str
    on: bool = True


class StaffRequest(BaseModel):
    staff_id: str
    area: str


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


def _idle_job(season_id: str, state: dict) -> dict:
    """A season's job record when nothing is simulating."""
    return {"id": season_id, "status": "idle", "state": state, "done": state["current_week"], "total": state["current_week"]}


def _check_not_running(season_id: str) -> None:
    """409 while the season is simulating."""
    job = _season_jobs.get(season_id)
    if job and job.get("status") == "running":
        raise HTTPException(409, "wait for the sim to finish")


def _season_state(season_id: str) -> dict:
    if season_id == realdata.REAL_ID:
        _real_ready.wait(timeout=600)          # a rebuild started at launch: wait for it, do not start another
        if realdata.stale():
            _refresh_real()
    job = _season_jobs.get(season_id)
    if job and job.get("state") is not None:
        _activate(job["state"])
        return job["state"]
    state = season.load_season(season_id)
    if state is None:
        raise HTTPException(404, "season not found")
    _activate(state)
    _season_jobs[season_id] = _idle_job(season_id, state)
    return state


def _activate(state: dict) -> None:
    """Put the season's league in play (a career's later seasons have their own, league.py).
    Never while another league's sim is running: its games read the league in play."""
    path = Path(league.ensure_built(state) or season.TEAMS_FILE)
    if path != season._league_path:
        if any(j.get("status") == "running" for j in _season_jobs.values()):
            raise HTTPException(409, "another season is simulating; try again when it finishes")
        season.use_league(path)


def _refresh_real(follow: Optional[str] = None) -> dict:
    """Rebuild the real season from the data on disk (results, box scores, polls)."""
    with _season_lock:
        old = _season_jobs.get(realdata.REAL_ID, {}).get("state")
        st = realdata.build(follow or (old or {}).get("team") or (season.load_season(realdata.REAL_ID) or {}).get("team") or realdata.DEFAULT_FOLLOW)
        _season_jobs[realdata.REAL_ID] = _idle_job(realdata.REAL_ID, st)
    return st


def _no_real(state: dict) -> None:
    if state.get("mode") == "real":
        raise HTTPException(403, "the real season is read-only")


def _warm_preview(state: dict) -> None:
    """Start the This week card's simulations for the next game in the background, so the
    card is ready, or nearly, when the page asks for it (the page's request waits for this
    one instead of simulating the game again)."""
    if state.get("mode") == "real" or state.get("done"):
        return

    def run() -> None:
        try:
            season.game_preview(state, state["team"])
        except Exception:  # noqa: BLE001 - a failed warm-up only means the page's request computes it
            pass
    threading.Thread(target=run, daemon=True).start()


def _reporter(job: dict):
    """The callback a sim calls with its stage and game count, written onto the job for /status."""
    def report(stage: str, games_done: Optional[int], games_total: Optional[int]) -> None:
        job["stage"] = stage
        week = job["done"] + 1                     # the week being simmed (`done` moves once all of it is over)
        if job.get("week") != week:
            job["week"], job["_played"] = week, False
        if games_total is not None:
            job["games_done"], job["games_total"] = games_done, games_total
            job["_played"] = job["_played"] or games_done >= games_total
            job["week_frac"] = 0.05 + 0.75 * games_done / max(1, games_total)
        else:
            job["games_done"] = job["games_total"] = None
            # before the games a sliver; after them (polls, awards, recruiting) the last part of the week
            played = job["_played"] or job["state"]["current_week"] >= week
            job["week_frac"] = max(job.get("week_frac", 0), 0.85) if played else 0.02
    return report


def _run_advance(job: dict, target: int) -> None:
    def progress(done: int, total: int) -> None:
        job["done"], job["total"] = done, total

    report = _reporter(job)
    try:
        with _season_lock:
            season.advance_to(job["state"], target, progress=progress, report=report, should_stop=lambda: job.get("stop", False))
            job["stage"] = "Saving"
            season.save_season(job["state"])
        job["paused"] = bool(job.get("stop")) and job["state"]["current_week"] < target and not job["state"]["done"]
        job["stop"] = False
        _warm_preview(job["state"])
        job["status"] = "idle"
        job["stage"] = None
    except Exception as exc:  # noqa: BLE001
        job["status"] = "error"
        job["error"] = str(exc)


def _run_gameday(job: dict) -> None:
    try:
        with _season_lock:
            eid = season.play_my_game(job["state"], season.shared_pool(), report=_reporter(job))
            job["stage"] = "Saving"
            season.save_season(job["state"])
        job["gameday_event"] = eid
        job["status"] = "idle"
        job["stage"] = None
    except Exception as exc:  # noqa: BLE001
        job["status"] = "error"
        job["error"] = str(exc)


@app.post("/api/season/{season_id}/gameday")
def gameday_season(season_id: str) -> dict:
    """Game day: simulate only your game this week (the week's matchups are set first if
    they are not yet). Advance then plays the rest of the week."""
    state = _season_state(season_id)
    _no_real(state)
    job = _season_jobs[season_id]
    if job["status"] == "running":
        raise HTTPException(409, "already simulating")
    if state["done"]:
        return {"status": "idle", "done": state["current_week"], "total": state["current_week"]}
    if season.my_game_id(state) is None:
        raise HTTPException(409, "no game this week: a bye, or your game is already played")
    job.update(status="running", done=state["current_week"], total=state["current_week"] + 1, stop=False, paused=False, gameday_event=None,
               stage="Simming your game", week=state["current_week"] + 1)
    threading.Thread(target=_run_gameday, args=(job,), daemon=True).start()
    return {"status": "running", "done": state["current_week"], "total": state["current_week"] + 1}


@app.post("/api/season")
def create_season(req: SeasonRequest) -> dict:
    _team(req.team)
    if req.mode not in ("full", "remaining"):
        raise HTTPException(400, "mode must be full or remaining")
    coach = None
    if req.coach:
        coach = coaches.load(req.coach)
        if coach is None:
            raise HTTPException(404, "unknown coach")
    if req.career and req.mode != "full":
        raise HTTPException(400, "Coach Career starts from week 1")
    state = season.new_season(req.team, req.mode, req.seed, coach=coach, career=req.career)
    if req.mode == "remaining":
        # started from today: the weeks already played carry their real stats and box scores
        state["real_import"] = realdata.import_real_boxes(state)
    season.save_season(state)
    _season_jobs[state["id"]] = _idle_job(state["id"], state)
    return season.summary(state)


MAX_SAVE_BYTES = 40 * 1024 * 1024    # an uploaded career (gzip); a career with its recruiting class is about 5 MB compressed


@app.get("/api/season/{season_id}/export")
def export_career(season_id: str, full: bool = False) -> Response:
    """The career as one gzip file: the browser keeps the state each week (web/careersave.js);
    `full` adds every game's box score, for the Download career button."""
    state = _season_state(season_id)
    if not career.is_career(state):
        raise HTTPException(404, "not a Coach Career")
    with _season_lock:                  # never a half-simmed week: a sim holds this lock
        blob = career.export_save(state, boxes=full)
    return Response(blob, media_type="application/gzip",
                    headers={"Content-Disposition": f'attachment; filename="coach-career-{season_id}.ccsave"'})


@app.post("/api/season/import")
async def import_career(request: Request) -> dict:
    """A career from the browser or a file. The server keeps whichever copy is newer, so a stale
    upload never replaces a career that has moved on."""
    blob = await request.body()
    if len(blob) > MAX_SAVE_BYTES:
        raise HTTPException(413, "that file is too large to be a Coach Career save")
    try:
        sid = career.read_save(blob)[0]["id"]
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    job = _season_jobs.get(sid)
    if job and job.get("status") == "running":
        raise HTTPException(409, "that career is simulating; try again when the week is done")
    current = job["state"] if job and job.get("state") is not None else season.load_season(sid)
    try:
        state = career.restore(blob, current)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    _season_jobs[sid] = _idle_job(sid, state if state is current else season.load_season(sid))
    return season.summary(_season_jobs[sid]["state"])


_season_cards: dict[str, tuple[float, dict]] = {}   # season id -> (file mtime, card)


@app.get("/api/seasons")
def list_seasons() -> dict:
    """The saved seasons, newest first. A season file can be several megabytes, so each
    card is cached by the file's modification time instead of re-read on every call."""
    out = []
    if season.SEASONS_DIR.exists():
        for path in sorted((p for p in season.SEASONS_DIR.glob("*.json") if p.stem != realdata.REAL_ID),
                           key=lambda p: p.stat().st_mtime, reverse=True)[:30]:
            mtime = path.stat().st_mtime
            cached = _season_cards.get(path.stem)
            if cached and cached[0] == mtime:
                out.append(cached[1])
                continue
            try:
                st = json.loads(path.read_text(encoding="utf-8"))
                if "current_week" not in st:
                    continue
                rec = season._records(st, include_playoff=True)[st["team"]]
                card = {"id": st["id"], "team": st["team"], "team_name": st["team_name"], "mode": st["mode"],
                        "created_at": st["created_at"], "current_week": st["current_week"], "done": st["done"],
                        "wins": rec["wins"], "losses": rec["losses"], "champion_name": _teams.get(st.get("champion") or "", {}).get("name"),
                        "year": st.get("year") or 2026, "career": bool(st.get("career")), "offseason": (st.get("offseason") or {}).get("stage")}
            except Exception:  # noqa: BLE001 - one unreadable file must not break the list for everyone
                continue
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
    pending = _pending_saves.pop(season_id, None)       # a recruiting save on its way would bring it back
    if pending:
        pending.cancel()
    folder = season.SEASONS_DIR / season_id
    if folder.exists():
        shutil.rmtree(folder, ignore_errors=True)
    path = season.SEASONS_DIR / f"{season_id}.json"
    if path.exists():
        path.unlink()
    league.forget(season_id)
    return True


@app.delete("/api/season/{season_id}")
def delete_season(season_id: str) -> dict:
    if season_id == realdata.REAL_ID:
        raise HTTPException(403, "the real season is rebuilt from the real data, not deleted")
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
            if path.stem == realdata.REAL_ID:
                continue
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
    out = {k: job.get(k) for k in ("id", "status", "done", "total", "error", "stage", "week", "games_done", "games_total", "week_frac", "paused", "gameday_event")}
    out["current_week"] = state["current_week"]
    # The sim thread adds games and results to this state while we read it; if the read
    # collides with a change, answer with the last good record and results instead of failing.
    try:
        rec = season._records(state, include_playoff=True)[state["team"]]
        record = {"wins": rec["wins"], "losses": rec["losses"], "conf_wins": rec["conf_wins"], "conf_losses": rec["conf_losses"]}
        results = season.my_results(state, since) if since is not None else None
        rank = season.current_rank(state)
        job["last_status"] = (record, results, rank)
    except RuntimeError:
        record, results, rank = job.get("last_status") or ({"wins": 0, "losses": 0, "conf_wins": 0, "conf_losses": 0}, [], None)
    out["record"] = record
    out["my_rank"] = rank           # the header's rank follows the sim week by week
    if since is not None:
        out["results"] = results or []
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
    _no_real(state)
    job = _season_jobs[season_id]
    if job["status"] == "running":
        raise HTTPException(409, "already simulating")
    if state["done"]:
        return {"status": "idle", "done": state["current_week"], "total": state["current_week"]}
    target = req.to if req.to is not None else state["current_week"] + 1
    target = max(state["current_week"] + 1, min(season.FINAL_WEEK, target))
    job.update(status="running", done=state["current_week"], total=target, stop=False, paused=False, gameday_event=None)
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
    _check_team(slug)
    return season.team_schedule_view(state, slug)


@app.get("/api/season/{season_id}/schedule_edit")
def schedule_edit_view(season_id: str) -> dict:
    """Your non-conference games you can still trade (a career, before week 1), with the options for each."""
    state = _season_state(season_id)
    with _season_lock:
        games = season.schedule_editable(state)
        return {"games": [dict(g, options=season.schedule_options(state, g["event_id"])) for g in games],
                "changes": state.get("schedule_changes") or []}


class RedshirtSeasonRequest(BaseModel):
    team: str
    player: str
    on: bool = True


@app.post("/api/season/{season_id}/redshirt")
def season_redshirt(season_id: str, req: RedshirtSeasonRequest) -> dict:
    """Redshirt one of your players for the rest of the season, or take him off it (four games or fewer)."""
    state = _career_state(season_id)
    _check_team(req.team)
    if req.team != state["team"]:
        raise HTTPException(403, "only your own players")
    _check_not_running(season_id)
    with _season_lock:
        try:
            out = season.redshirt_toggle(state, req.team, req.player, req.on)
        except season.RedshirtError as e:
            raise HTTPException(e.code, str(e))
        season.save_season(state)
        _season_cards.pop(season_id, None)
    return out


class ScheduleSwapRequest(BaseModel):
    event_id: str
    slug: str


@app.post("/api/season/{season_id}/schedule_edit")
def schedule_edit_swap(season_id: str, req: ScheduleSwapRequest) -> dict:
    """Trade one of your non-conference games for another school's that week."""
    state = _season_state(season_id)
    _check_not_running(season_id)
    with _season_lock:
        try:
            season.schedule_swap(state, req.event_id, req.slug)
        except season.ScheduleError as e:
            raise HTTPException(e.code, str(e))
        season.save_season(state)
        _season_cards.pop(season_id, None)
    return {"changes": state.get("schedule_changes") or []}


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
    """Change a season's settings (god mode and the rest; a career's Auto-recruit); saved with the season."""
    state = _season_state(season_id)
    _no_real(state)
    changes = req.model_dump()
    auto = changes.pop("auto_recruit", None)
    mode = {True: "season", False: "off"}.get(auto, auto) if isinstance(auto, bool) else auto
    if auto is not None and mode not in recruiting.AUTO_MODES:
        raise HTTPException(400, "Auto-recruit is off, week or season")
    if auto is not None and not state.get("recruiting"):
        raise HTTPException(404, "not a Coach Career")
    with _season_lock:
        out = season.update_settings(state, changes)
        if auto is not None:
            state["career"]["settings"]["auto_recruit"] = mode
        season.save_season(state)
    res = {"settings": out}
    if state.get("career"):
        res["auto_recruit"] = recruiting.auto_mode(state)
    return res


# ----- Coach Career recruiting ------------------------------------------------------------------
# Recruiting actions are saved a moment after the last one (several clicks, one save); board,
# staff and settings changes are saved at once.

SAVE_DELAY = 2.0                     # seconds after the last recruiting action
_pending_saves: dict[str, threading.Timer] = {}


def _save_soon(season_id: str) -> None:
    old = _pending_saves.pop(season_id, None)
    if old:
        old.cancel()
    timer = threading.Timer(SAVE_DELAY, _save_now, args=(season_id,))
    timer.daemon = True
    _pending_saves[season_id] = timer
    timer.start()


def _save_now(season_id: str) -> None:
    _pending_saves.pop(season_id, None)
    job = _season_jobs.get(season_id)
    if not job or job.get("state") is None or job.get("status") == "running":
        return                               # a running week saves when it is done
    with _season_lock:
        season.save_season(job["state"])

def _career_state(season_id: str, change: bool = False) -> dict:
    state = _season_state(season_id)
    if not state.get("recruiting"):
        raise HTTPException(404, "not a Coach Career")
    if change:
        _check_not_running(season_id)
    return state


def _recruiting_call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except recruiting.RecruitingError as e:
        raise HTTPException(404 if e.message in ("unknown prospect",) else e.code, e.message) from e


# Recruiting reads wait for a running sim too (409): the week's step changes what they read.

@app.get("/api/season/{season_id}/recruiting")
def recruiting_view(season_id: str) -> dict:
    st = _career_state(season_id, change=True)
    with _season_lock:
        return prospects.recruiting_view(st)


@app.get("/api/season/{season_id}/programs")
def programs_view(season_id: str) -> dict:
    """Every program's living rating (prestige, winning, NIL, market, conference, coach; tier and goal), yours first."""
    from coach_career import programs
    st = _career_state(season_id)
    with _season_lock:
        rows = programs.rows(st)
        me = next((r for r in rows if r["team"] == st["team"]), None)
        return {"you": me, "rows": rows, "tiers": programs.TIER_NAMES, "weights": programs.WEIGHTS}


@app.get("/api/season/{season_id}/recruiting/report")
def recruiting_reports(season_id: str) -> dict:
    """The weekly reports kept (what changed for the prospects on your board), latest last."""
    st = _career_state(season_id, change=True)
    with _season_lock:
        return {"reports": st["recruiting"].get("reports") or []}


@app.get("/api/season/{season_id}/prospects")
def prospect_search(season_id: str, position: Optional[str] = None, stars: Optional[int] = None, state: Optional[str] = None,
                    status: Optional[str] = None, q: Optional[str] = None, offset: int = 0, limit: int = 50,
                    sort: str = "rank", group: Optional[str] = None) -> dict:
    st = _career_state(season_id, change=True)
    with _season_lock:
        return prospects.search(st, st["team"], position, stars, state, status, q, max(0, offset), limit, sort, group)


@app.get("/api/season/{season_id}/classes")
def national_classes(season_id: str, school: Optional[str] = None) -> dict:
    """Every FBS school's class ranked nationally; with `school`, that class's recruits too."""
    st = _career_state(season_id, change=True)
    if school:
        _check_team(school)
    with _season_lock:
        with prospects.class_block(st):
            out = prospects.national_classes(st, st["team"])
            if school:
                out["class"] = prospects.class_detail(st, school, st["team"])
    return out


@app.get("/api/season/{season_id}/prospect/{pid}")
def prospect_profile(season_id: str, pid: str) -> dict:
    st = _career_state(season_id, change=True)
    with _season_lock:
        return _recruiting_call(prospects.profile, st, pid, st["team"])


@app.post("/api/season/{season_id}/recruit")
def recruit_action(season_id: str, req: RecruitRequest) -> dict:
    st = _career_state(season_id, change=True)
    with _season_lock:
        if req.pid not in recruiting.visible(st):
            raise HTTPException(404, "unknown prospect")
        out = _recruiting_call(recruiting.act, st, st["team"], req.pid, req.action, req.pitch, req.nil)
    _save_soon(season_id)
    return out


@app.post("/api/season/{season_id}/board")
def board_change(season_id: str, req: BoardRequest) -> dict:
    st = _career_state(season_id, change=True)
    rc = st["recruiting"]
    if req.pid not in recruiting.visible(st):
        raise HTTPException(404, "unknown prospect")
    with _season_lock:
        recruiting.set_board(st, req.pid, req.on)
        season.save_season(st)
    return {"board": rc["board"]}


@app.post("/api/season/{season_id}/staff")
def staff_change(season_id: str, req: StaffRequest) -> dict:
    st = _career_state(season_id, change=True)
    with _season_lock:
        _recruiting_call(recruiting.assign, st, req.staff_id, req.area)
        season.save_season(st)
    return {"staff": st["career"]["staff"]}


# ----- the offseason (offseason.py): departures, the transfer portal, development, staff -----

class PortalRequest(BaseModel):
    pid: str
    on: bool = True


class HireRequest(BaseModel):
    staff_id: str
    index: int


class OffseasonRequest(BaseModel):
    to: Optional[str] = None        # "next_season": every remaining stage on Auto, then the next season


def _offseason_state(season_id: str) -> dict:
    """A career whose season is over, with its offseason open (opened on first ask)."""
    st = _career_state(season_id, change=True)
    if not st.get("done"):
        raise HTTPException(409, "the season is not over")
    if not st.get("offseason"):
        with _season_lock:
            offseason.start(st)
            season.save_season(st)
    return st


@app.get("/api/season/{season_id}/offseason")
def offseason_view(season_id: str, position: Optional[str] = None, status: Optional[str] = None) -> dict:
    st = _offseason_state(season_id)
    with _season_lock:
        return offseason.view(st, position, status)


@app.post("/api/season/{season_id}/offseason/advance")
def offseason_advance(season_id: str, req: OffseasonRequest) -> dict:
    """The next offseason stage; past the last one (or with to="next_season"), the next season."""
    st = _offseason_state(season_id)
    with _season_lock:
        if req.to == "next_season":
            offseason.run_all(st)
        elif st["offseason"]["stage"] != "ready":
            offseason.advance(st)
            season.save_season(st)
            return offseason.view(st)
        new = offseason.next_season(st)
        season.save_season(new)
        _season_jobs[season_id] = _idle_job(season_id, new)
        _season_cards.pop(season_id, None)
    return {"next_season": True, "year": new["year"], "summary": season.summary(new)}


@app.post("/api/season/{season_id}/offseason/portal")
def offseason_portal(season_id: str, req: PortalRequest) -> dict:
    st = _offseason_state(season_id)
    with _season_lock:
        try:
            offers = offseason.portal_offer(st, req.pid, req.on)
        except KeyError:
            raise HTTPException(404, "unknown portal player")
        except OverflowError as e:
            raise HTTPException(409, str(e))
        except ValueError as e:
            raise HTTPException(409, str(e))
    _save_soon(season_id)
    return {"offers": offers}


class JobRequest(BaseModel):
    team: Optional[str] = None


class RedshirtRequest(BaseModel):
    pid: str
    on: bool = True


class PositionRequest(BaseModel):
    pid: str
    pos: str


@app.post("/api/season/{season_id}/offseason/redshirt")
def offseason_redshirt(season_id: str, req: RedshirtRequest) -> dict:
    """Your call on one player's redshirt (the Departures step)."""
    st = _offseason_state(season_id)
    with _season_lock:
        try:
            offseason.redshirt(st, req.pid, req.on)
        except offseason.RosterError as e:
            raise HTTPException(e.code, str(e))
        season.save_season(st)
    return offseason.view(st)


@app.get("/api/season/{season_id}/offseason/position_options")
def offseason_position_options(season_id: str, pid: str) -> dict:
    """What one of your players would be at every position."""
    st = _offseason_state(season_id)
    with _season_lock:
        try:
            return {"options": offseason.position_options(st, pid)}
        except offseason.RosterError as e:
            raise HTTPException(e.code, str(e))


@app.post("/api/season/{season_id}/offseason/position")
def offseason_position(season_id: str, req: PositionRequest) -> dict:
    """Move one of your players to another position for next season."""
    st = _offseason_state(season_id)
    with _season_lock:
        try:
            offseason.change_position(st, req.pid, req.pos)
        except offseason.RosterError as e:
            raise HTTPException(e.code, str(e))
        season.save_season(st)
    return offseason.view(st)


class RetainRequest(BaseModel):
    pid: str
    action: str                   # meet, promise, nil, release
    nil: int = 0


@app.post("/api/season/{season_id}/offseason/retain")
def offseason_retain(season_id: str, req: RetainRequest) -> dict:
    """Keep them home: one move with a leaver (meet, promise a starting role, NIL from next year's budget, let him go)."""
    st = _offseason_state(season_id)
    with _season_lock:
        try:
            offseason.retain(st, req.pid, req.action, nil=req.nil)
        except offseason.RetentionError as e:
            raise HTTPException(e.code, str(e))
        season.save_season(st)
    return offseason.view(st)


class ReviewRequest(BaseModel):
    action: str                   # case, change, year, nothing
    staff_id: Optional[str] = None


@app.post("/api/season/{season_id}/offseason/review")
def offseason_review(season_id: str, req: ReviewRequest) -> dict:
    """Your meeting with the AD: what you say, then his decision (firing happens only here)."""
    st = _offseason_state(season_id)
    with _season_lock:
        try:
            offseason.review_decide(st, req.action, staff_id=req.staff_id)
        except offseason.ReviewError as e:
            raise HTTPException(e.code, str(e))
        season.save_season(st)
    return offseason.view(st)


@app.post("/api/season/{season_id}/offseason/job")
def offseason_job(season_id: str, req: JobRequest) -> dict:
    """Take a job offer (or, fired, an opening); team null stays put."""
    st = _offseason_state(season_id)
    with _season_lock:
        try:
            car = offseason.choose_job(st, req.team)
        except ValueError as e:
            raise HTTPException(409, str(e))
    _save_soon(season_id)
    return {"choice": car["choice"]}


@app.post("/api/season/{season_id}/offseason/hire")
def offseason_hire(season_id: str, req: HireRequest) -> dict:
    st = _offseason_state(season_id)
    with _season_lock:
        try:
            staff = offseason.hire(st, req.staff_id, req.index)
        except ValueError as e:
            raise HTTPException(400, str(e))
    _save_soon(season_id)
    return {"hired": staff["hired"]}


class OpenRoleRequest(BaseModel):
    staff_id: str


@app.post("/api/season/{season_id}/offseason/open_role")
def offseason_open_role(season_id: str, req: OpenRoleRequest) -> dict:
    """Let one of your own coaches go at the Staff step: he joins the market, his job gets candidates."""
    st = _offseason_state(season_id)
    with _season_lock:
        try:
            offseason.open_role(st, req.staff_id)
        except ValueError as e:
            raise HTTPException(409, str(e))
        season.save_season(st)
    return offseason.view(st)


@app.post("/api/season/{season_id}/player/edit")
def season_player_edit(season_id: str, req: PlayerEditRequest) -> dict:
    """God mode: change a player's ratings, class, size, jersey or development trait. The
    edit is saved with the season and used by every game from the next sim on."""
    state = _season_state(season_id)
    _no_real(state)
    if not season.settings(state)["god_mode"]:
        raise HTTPException(403, "turn on god mode in Settings to edit players")
    _check_team(req.team)
    _check_not_running(season_id)
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
    _check_team(slug)
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
    _check_team(slug)
    return season.depth_chart_view(state, slug)


@app.get("/api/season/{season_id}/depth/{slug}/position/{role}")
def season_depth_position(season_id: str, slug: str, role: str) -> dict:
    """Every player on the roster rated at one depth-chart role."""
    state = _season_state(season_id)
    _check_team(slug)
    if role not in season.ROLE_POSITION and role not in ("KR", "PR"):
        raise HTTPException(404, "unknown role")
    return season.position_candidates(state, slug, role)


@app.post("/api/season/{season_id}/depth/{slug}")
def season_depth_change(season_id: str, slug: str, req: DepthRequest) -> dict:
    """Move a player on a team's depth chart (or reset the team). The change is saved with
    the season and used by every game from then on."""
    state = _season_state(season_id)
    _no_real(state)
    _check_team(slug)
    if slug != state["team"] and not season.settings(state)["god_mode"]:
        raise HTTPException(403, "turn on god mode in Settings to edit another team's depth chart")
    _check_not_running(season_id)
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
    _check_team(team)
    prof = season.player_profile(state, team, name=name or None, position=position or None, slug=slug or None)
    if prof is None:
        raise HTTPException(404, "player not found")
    return prof


@app.get("/api/season/{season_id}/stats/leaders")
def season_player_leaders(season_id: str, team: Optional[str] = None, n: int = 5, conference: Optional[str] = None) -> dict:
    state = _season_state(season_id)
    if team:
        _check_team(team)
    return season.player_leaders_view(state, team or None, max(1, min(n, 25)), conference or None)


@app.get("/api/season/{season_id}/stats/players")
def season_player_stats(season_id: str, team: Optional[str] = None, cat: str = "passing", limit: int = 100,
                        conference: Optional[str] = None) -> dict:
    state = _season_state(season_id)
    if team:
        _check_team(team)
    try:
        return season.player_stats_view(state, team or None, cat, limit, conference or None)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


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


@app.get("/coach")
def coach_page() -> FileResponse:
    """Your coach: create a head coach, his background, style and look."""
    return FileResponse(WEB_DIR / "coach.html")


@app.get("/api/coach-options")
def coach_options() -> dict:
    return coaches.options()


@app.get("/api/coaches")
def coach_list() -> dict:
    return {"coaches": coaches.list_all()}


@app.get("/api/coaches/{coach_id}")
def coach_get(coach_id: str) -> dict:
    c = coaches.load(coach_id)
    if c is None:
        raise HTTPException(404, "unknown coach")
    return c


@app.post("/api/coaches")
def coach_save(req: CoachRequest) -> dict:
    try:
        return coaches.save(req.coach)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.delete("/api/coaches/{coach_id}")
def coach_delete(coach_id: str) -> dict:
    try:
        return {"deleted": coaches.delete(coach_id)}
    except ValueError as exc:
        raise HTTPException(404, str(exc))


@app.get("/real")
def real_page() -> FileResponse:
    """The real 2026 season: the season page in read-only mode on the real data."""
    return FileResponse(WEB_DIR / "season.html")


class FollowRequest(BaseModel):
    team: str


@app.post("/api/real/follow")
def real_follow(req: FollowRequest) -> dict:
    """Which team the real season page centres on (header, schedule, awards)."""
    _check_team(req.team)
    state = _season_state(realdata.REAL_ID)
    with _season_lock:
        teams = season.load_teams()
        state.update(team=req.team, team_name=teams[req.team]["name"], conference=teams[req.team]["conference"])
        season.save_season(state)
    return season.summary(state)


_real_fetch = {"status": "idle", "error": None}


def _run_real_fetch() -> None:
    try:
        realdata.fetch()
        _refresh_real()
        _real_fetch.update(status="idle", error=None, finished=datetime.now().isoformat(timespec="seconds"))
    except Exception as exc:  # noqa: BLE001
        _real_fetch.update(status="error", error=str(exc))


@app.post("/api/real/refresh")
def real_refresh() -> dict:
    """Download the latest real results, box scores and polls, then rebuild (a few minutes)."""
    if _real_fetch["status"] == "running":
        return dict(_real_fetch)
    _real_fetch.update(status="running", error=None, started=datetime.now().isoformat(timespec="seconds"))
    threading.Thread(target=_run_real_fetch, daemon=True).start()
    return dict(_real_fetch)


@app.get("/api/real/refresh")
def real_refresh_status() -> dict:
    return dict(_real_fetch)


app.mount("/", StaticFiles(directory=WEB_DIR), name="web")

_load_teams()
_load_games()


def _lan_ip() -> str:
    """The address other devices on the local network use to reach this PC."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))   # no traffic is sent; picks the outbound interface
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


if __name__ == "__main__":
    # `python server.py` serves on every interface so a phone on the same Wi-Fi can open
    # it at http://<this PC's address>:8000. `python server.py --local` keeps it to this PC.
    local_only = "--local" in sys.argv
    host = "127.0.0.1" if local_only else "0.0.0.0"
    port = int(os.environ.get("PORT", "8000"))   # hosting platforms set PORT
    print(f"CFP Coach Simulator: http://127.0.0.1:{port}  (this PC)")
    if not local_only:
        print(f"                     http://{_lan_ip()}:{port}  (phones and other devices on this network)")
    uvicorn.run(app, host=host, port=port)
