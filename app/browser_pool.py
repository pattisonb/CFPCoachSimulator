"""The published site's game pool: a week's games played on several cores at once.

In the browser the game runs in one Web Worker (ui/public/worker.js), so a week's ninety-odd games were played one
after another on one core. Here they are shared with helper workers (ui/public/sim-worker.js), each a second copy of
the game that only plays games: the same `season._sim_one` on the same job, so every result is the one the single
worker would have made, and `season._run_games` applies them in schedule order as it always has. This worker plays
games too while it waits. With no helper up (a browser without shared memory, a small machine, the first week before
they have started) or a helper that stops answering, the games are played here, as before.

`bridge` is the worker's side (JavaScript, the module "sim_bridge"): start(jobs, n, league path) -> how many helpers
took the week; claim() -> the next game for this worker, or -1; pop(wait ms) -> a game a helper finished, or -1;
failed(i); result(i) -> its pickled result; abandon() -> the games the helpers still owe when they have gone quiet.
"""
from __future__ import annotations

import pickle
import random

MIN_JOBS = 4          # *tune* fewer games than this are played here: sharing them costs more than it saves
STALL_MS = 120_000    # *tune* how long the helpers may go without finishing a game before theirs are played here


class BrowserPool:
    def __init__(self, bridge):
        self.bridge = bridge

    def _here(self, fn, job):
        # as in a pool on a computer, this worker's own random stream is not moved by a game (each game seeds its own)
        state = random.getstate()
        try:
            return fn(job)
        finally:
            random.setstate(state)

    def imap_unordered(self, fn, jobs, chunksize: int = 1):
        jobs = list(jobs)
        b = self.bridge
        helpers = 0
        if len(jobs) >= MIN_JOBS:
            try:
                helpers = int(b.start(pickle.dumps(jobs), len(jobs), _league_path()))
            except Exception:  # noqa: BLE001 - the bridge is an optimization: without it the games are played here
                helpers = 0
        if not helpers:
            for job in jobs:
                yield fn(job)
            return
        got = 0

        def taken(i: int):
            if b.failed(i):                  # the helper could not play it (or its result did not fit): played here
                return self._here(fn, jobs[i])
            return pickle.loads(b.result(i).to_bytes())

        while True:
            i = int(b.claim())
            if i < 0:
                break
            yield self._here(fn, jobs[i])
            got += 1
            while (j := int(b.pop(0))) >= 0:
                yield taken(j)
                got += 1
        while got < len(jobs):
            j = int(b.pop(STALL_MS))
            if j < 0:                         # the helpers have gone quiet: what they still owe is played here
                for k in list(b.abandon().to_py()):
                    yield self._here(fn, jobs[int(k)])
                    got += 1
                break
            yield taken(j)
            got += 1


def _league_path() -> str:
    from sim import season
    return str(season._league_path)


def install() -> None:
    """Called by the worker once the game is up: a week's games go through the helpers from here on."""
    import sim_bridge  # the worker registers it (pyodide.registerJsModule)
    from sim import season
    season.EXTERNAL_POOL = BrowserPool(sim_bridge)
