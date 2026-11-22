/* A helper of the game's worker (worker.js): a second copy of the Python game that only plays games, so a week's
   games run on several cores at once. It loads Pyodide and the game as worker.js does (from the browser's cache: the
   page has just fetched both), then waits for a week's jobs.

   From worker.js: {kind: "init", version, me, ctrl, data} once (its number and the two shared buffers), then for each
   week {kind: "jobs", gen, n, jobs, league: {path, sig, bytes?}}: the pickled jobs (season._run_games' own tuples) and
   the league they are played in (its file's bytes the first time, when it is a career's own league). The helper then
   claims games one at a time from the shared counter, plays each with season._sim_one and writes the pickled result
   into the shared data buffer; worker.js, which is inside a Python call and cannot hear messages, reads them there.

   The shared control buffer (Int32Array; worker.js lays it out the same way):
     [GEN] the week's number, bumped at each start and when the helpers are given up on
     [NEXT] the next game to claim   [ALLOC] bytes of the data buffer in use   [DONE] games the helpers have finished
     [READY + k] 1 once helper k can play
     [TABLE + 3i ...] game i: its status (1 a helper has it, 2 done, 3 could not be played here, 5 worker.js has it),
                      its result's offset and length in the data buffer */
"use strict";

const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const ARCHIVE = "game.tar.xz";
const HOME = "/home/pyodide";
const GEN = 0, NEXT = 2, ALLOC = 3, DONE = 4, READY = 8, TABLE = 32;

let pyodide = null, py = null, ctrl = null, data = null, me = 0;

async function boot(init) {
  me = init.me;
  ctrl = new Int32Array(init.ctrl);
  data = new Uint8Array(init.data);
  importScripts(PYODIDE_URL + "pyodide.js");
  pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
  const [res] = await Promise.all([fetch(`./${ARCHIVE}?v=${encodeURIComponent(init.version || "dev")}`), pyodide.loadPackage("lzma")]);
  if (!res.ok) throw new Error(`${ARCHIVE}: HTTP ${res.status}`);
  pyodide.FS.writeFile("/tmp/" + ARCHIVE, new Uint8Array(await res.arrayBuffer()));
  pyodide.runPython(`import os, sys, tarfile
with tarfile.open("/tmp/${ARCHIVE}") as t:
    t.extractall(${JSON.stringify(HOME)}, filter="data")
os.remove("/tmp/${ARCHIVE}")
sys.path.insert(0, ${JSON.stringify(HOME)})
os.environ["SIM_WORKERS"] = "1"
import pickle
from sim import season

_league = None
_jobs = []

def set_league(path, sig):
    """The league the week is played in: read once, and again when its file is another one."""
    global _league
    if _league != (path, sig):
        season._init(path)
        _league = (path, sig)

def load(jobs):
    global _jobs
    _jobs = pickle.loads(jobs.to_bytes())

def run(i):
    return pickle.dumps(season._sim_one(_jobs[i]))
`);
  py = { setLeague: pyodide.globals.get("set_league"), load: pyodide.globals.get("load"), run: pyodide.globals.get("run") };
  Atomics.store(ctrl, READY + me, 1);
  postMessage({ kind: "ready", me });
}

function finish(i, status, offset, length) {
  Atomics.store(ctrl, TABLE + 3 * i + 1, offset);
  Atomics.store(ctrl, TABLE + 3 * i + 2, length);
  Atomics.store(ctrl, TABLE + 3 * i, status);
  Atomics.add(ctrl, DONE, 1);
  Atomics.notify(ctrl, DONE);
}

function play(m) {
  if (m.league.bytes) {
    pyodide.FS.mkdirTree(m.league.path.slice(0, m.league.path.lastIndexOf("/")));
    pyodide.FS.writeFile(m.league.path, m.league.bytes);
  }
  py.setLeague(m.league.path, m.league.sig);
  py.load(m.jobs);
  for (;;) {
    if (Atomics.load(ctrl, GEN) !== m.gen) return;          // the week is over, or the helpers were given up on
    const i = Atomics.add(ctrl, NEXT, 1);
    if (i >= m.n) return;
    Atomics.store(ctrl, TABLE + 3 * i, 1);
    let bytes = null;
    try {
      const out = py.run(i);
      bytes = out.toJs();
      out.destroy();
    } catch (err) {
      console.error(err);
    }
    if (Atomics.load(ctrl, GEN) !== m.gen) return;
    if (!bytes) { finish(i, 3, 0, 0); continue; }
    const offset = Atomics.add(ctrl, ALLOC, bytes.length);
    if (offset + bytes.length > data.length) { finish(i, 3, 0, 0); continue; }     // no room: worker.js plays it
    data.set(bytes, offset);
    finish(i, 2, offset, bytes.length);
  }
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.kind === "init") boot(m).catch((err) => { console.error(err); postMessage({ kind: "failed", me: m.me, message: String((err && err.message) || err) }); });
  else if (m.kind === "jobs" && py) {
    try { play(m); } catch (err) { console.error(err); }
  }
};
