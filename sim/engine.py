"""The game engine, which is JavaScript (engine_js/): how the Python still around it asks it for a game.

    from sim import engine
    r = engine.simulate_game(home_team, away_team, None, seed, venue="home", momentum=False)

In the browser the engine is loaded beside this Python and called directly (the worker registers it as the module
`js_engine`, taking and returning JSON text). On a computer a Node process is kept running for each Python process
(engine_js/bridge.mjs) and asked over its pipes, a line of JSON each way. Either way the answers are the same.

Besides games: `config()` has the engine's settings and `personnel()` its personnel tables (as attributes, the way
the Python modules had them), and `formations(team)` how a team lines up (the Depth Chart's formations)."""
from __future__ import annotations

import atexit
import json
import os
import subprocess
import threading
from pathlib import Path
from types import SimpleNamespace
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / "engine_js" / "bridge.mjs"
NODE = os.environ.get("CFP_NODE", "node")     # the Node that runs the engine on a computer

_lock = threading.Lock()
_node: dict = {"proc": None, "pid": None, "n": 0}
_tables: dict = {}


def _in_browser():
    try:
        import js_engine  # registered by ui/public/worker.js and sim-worker.js
        return js_engine
    except ImportError:
        return None


def _start() -> subprocess.Popen:
    proc = subprocess.Popen([NODE, str(BRIDGE)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1)
    _node.update(proc=proc, pid=os.getpid())
    return proc


def _stop() -> None:
    proc = _node.get("proc")
    if proc is not None and _node.get("pid") == os.getpid():
        try:
            proc.stdin.close()
            proc.wait(timeout=2)
        except Exception:  # noqa: BLE001
            proc.kill()
    _node["proc"] = None


atexit.register(_stop)


class NotHere(Exception):
    """A game job the JavaScript does not play (sim_js/game_job.js NotHere): the caller plays it the older way."""


def call(fn: str, *args):
    """One call of the engine's API (engine_js/api.js) by name."""
    js = _in_browser()
    if js is not None:
        out = json.loads(js.call(fn, json.dumps(args)))
        if isinstance(out, dict) and out.get("__not_here__"):
            raise NotHere(fn)
        return out
    with _lock:
        proc = _node["proc"]
        if proc is None or _node["pid"] != os.getpid() or proc.poll() is not None:     # none yet, a forked copy, or it died
            proc = _start()
        _node["n"] += 1
        n = _node["n"]
        try:
            proc.stdin.write(json.dumps({"id": n, "fn": fn, "args": args}) + "\n")
            proc.stdin.flush()
            line = proc.stdout.readline()
        except (BrokenPipeError, OSError) as exc:
            _node["proc"] = None
            raise RuntimeError(f"the engine (node {BRIDGE.name}) stopped: {exc}") from exc
    if not line:
        _node["proc"] = None
        raise RuntimeError(f"the engine (node {BRIDGE.name}) stopped without an answer; is Node installed?")
    reply = json.loads(line)
    if reply.get("not_here"):
        raise NotHere(fn)
    if not reply.get("ok"):
        raise RuntimeError(f"engine.{fn}: {reply.get('error')}")
    return reply["result"]


def simulate_game(home_data: dict, away_data: dict, slider_overrides: Optional[dict] = None, seed: Optional[int] = None,
                  venue: str = "home", momentum: bool = False, play_log: bool = False) -> dict:
    """One game (engine_js/game.js simulate_game). `play_log`: the game's play log comes back as r["play_log"]."""
    return call("play", home_data, away_data, slider_overrides, seed, venue, bool(momentum), bool(play_log))


def sim_one(league_path: str, job: list) -> dict:
    """One whole game job (season._run_games builds them) in the league whose teams file is `league_path`: the teams
    prepared, the game played and the result boiled down, all in JavaScript. Raises NotHere for a job it leaves to Python."""
    st = os.stat(league_path)
    return call("sim_one", [league_path, f"{st.st_size}:{st.st_mtime_ns}"], job)


def _load() -> dict:
    if not _tables:
        raw = call("config")
        _tables["cfg"] = SimpleNamespace(**raw["game_config"])
        p = raw["personnel"]
        _tables["personnel"] = SimpleNamespace(
            GROUPINGS=p["GROUPINGS"], FRONTS=p["FRONTS"], SCHEME_FRONT=p["SCHEME_FRONT"],
            SCHEME_MIX={scheme: dict(pairs) for scheme, pairs in p["SCHEME_MIX"].items()}, DEFAULT_MIX=dict(p["DEFAULT_MIX"]))
    return _tables


def config() -> SimpleNamespace:
    """The engine's settings (engine_js/game_config.js), by name: config().TARGET_MULT_MAX."""
    return _load()["cfg"]


def personnel() -> SimpleNamespace:
    """The engine's personnel tables: GROUPINGS, SCHEME_MIX and DEFAULT_MIX (in the order the engine draws from), FRONTS,
    SCHEME_FRONT."""
    return _load()["personnel"]


def formations(team: dict) -> dict:
    """How a team lines up (engine_js/api.js formations)."""
    return call("formations", team)
