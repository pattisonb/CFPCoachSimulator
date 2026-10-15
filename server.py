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
import threading
from pathlib import Path
from typing import Any, Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from engine.game import SLIDER_NAMES, default_sliders, simulate_game

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
TEAMS_FILE = DATA_DIR / "engine_teams.json"
GAMES_FILE = DATA_DIR / "games.json"
INGEST_DIR = DATA_DIR / "ingest"
WEB_DIR = ROOT / "web"

MAX_HISTORY = 300
MAX_BATCH = 500

app = FastAPI(title="CFP Coach Simulator")

_sim_lock = threading.Lock()  # the engine uses module-level state (sliders, TD log)
_games: list[dict] = []
_teams: dict[str, dict] = {}


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
         "return_rating": p.get("return_rating")}
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


@app.post("/api/ingest")
async def ingest(request: Request, name: str) -> dict:
    """Store a text payload under data/ingest/<name>.txt (used to collect real scores
    scraped in the browser for calibration)."""
    safe = "".join(c for c in name if c.isalnum() or c in "-_")[:40] or "payload"
    INGEST_DIR.mkdir(parents=True, exist_ok=True)
    body = await request.body()
    (INGEST_DIR / f"{safe}.txt").write_bytes(body)
    return {"ok": True, "bytes": len(body), "file": safe}


# ----- ratings (display only; the engine uses the raw attributes) ----------

_OFF_KEYS = ["speed", "strength", "intelligence", "passing", "decision_making", "hands",
             "route_running", "run_blocking", "pass_blocking", "elusiveness", "vision"]
_DEF_KEYS = ["speed", "strength", "intelligence", "tackling", "coverage", "rushing"]


def _overall(p: dict) -> int:
    pos = p["position"]
    if pos == "K":
        primary, secondary = ["kick_power", "kick_accuracy"], []
    elif pos == "P":
        primary, secondary = ["punt_power", "punt_accuracy"], []
    elif pos == "QB":
        primary, secondary = ["passing", "decision_making", "intelligence"], ["speed", "elusiveness"]
    elif pos == "RB":
        primary, secondary = ["speed", "elusiveness", "vision", "strength"], ["hands", "pass_blocking"]
    elif pos in ("WR", "TE"):
        primary, secondary = ["hands", "route_running", "speed"], ["run_blocking", "elusiveness"]
    elif pos == "OL":
        primary, secondary = ["run_blocking", "pass_blocking", "strength"], ["intelligence"]
    elif pos == "DL":
        primary, secondary = ["rushing", "tackling", "strength"], ["intelligence", "speed"]
    elif pos in ("MLB", "ROLB", "LOLB"):
        primary, secondary = ["tackling", "rushing", "coverage", "speed"], ["intelligence"]
    else:
        primary, secondary = ["coverage", "speed", "tackling"], ["intelligence", "hands"]
    total = count = 0
    for k in primary:
        if isinstance(p.get(k), (int, float)):
            total += p[k] * 3
            count += 3
    for k in secondary:
        if isinstance(p.get(k), (int, float)):
            total += p[k]
            count += 1
    return round(total / count) if count else 0


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
