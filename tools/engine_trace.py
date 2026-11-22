"""One reference game's random draws, one a line, to lay beside the JavaScript engine's (engine_js/test/compare.mjs --trace):

    python3 tools/engine_trace.py reference.json 3 [--stack 1234] > python.trace

The games before it in the reference are played first (they were played in one process when the reference was made).
`--stack N` prints where draw N was asked for."""
from __future__ import annotations

import json
import random
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

METHODS = ("random", "randint", "choice", "choices", "gauss", "uniform", "gammavariate", "randrange")


def _show(v):
    if isinstance(v, float):
        return repr(v)
    if isinstance(v, list):
        return json.dumps([getattr(x, "name", x) for x in v])
    return json.dumps(getattr(v, "name", v))


def main() -> None:
    from engine import game_config as cfg
    from engine.game import simulate_game
    ref = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    which = int(sys.argv[2])
    stack_at = int(sys.argv[sys.argv.index("--stack") + 1]) if "--stack" in sys.argv else -1
    teams = json.loads((ROOT / ref["teams_file"]).read_text(encoding="utf-8"))["teams"]
    play = lambda g: simulate_game(teams[g["home"]], teams[g["away"]], None, g["seed"], venue=g["venue"], momentum=g["momentum"])   # noqa: E731
    for g in ref["games"][:which]:
        play(g)
    lines: list[str] = []
    depth = {"n": 0}
    names = {id(random._inst): "random", id(cfg.stat_rng): "stat", id(cfg.injury_rng): "injury"}

    def wrap(inst, m):
        real = getattr(inst, m)

        def call(*a, **k):
            depth["n"] += 1
            try:
                v = real(*a, **k)
            finally:
                depth["n"] -= 1
            if depth["n"] == 0:
                if len(lines) == stack_at:
                    print(f"draw {stack_at}: {names[id(inst)]}.{m} -> {v!r}", file=sys.stderr)
                    traceback.print_stack(limit=8, file=sys.stderr)
                lines.append(f"{names[id(inst)]}.{m} {_show(v)}")
            return v
        return call

    for inst in (random._inst, cfg.stat_rng, cfg.injury_rng):
        for m in METHODS:
            setattr(inst, m, wrap(inst, m))
    for m in METHODS:                       # `random.random()` is the module's bound method: point it at the wrapped one
        setattr(random, m, getattr(random._inst, m))
    play(ref["games"][which])
    sys.stdout.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
