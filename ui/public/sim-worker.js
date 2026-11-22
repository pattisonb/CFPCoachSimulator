/* A helper of the game's worker (worker.js): it only plays games, so a week's games run on several cores at once.
   The games are JavaScript (engine.js: the engine and the whole game job, sim_js/game_job.js), so a helper is that
   one script and the league's teams; it has no Python.

   From worker.js: {kind: "init", me, ctrl, data} once (its number and the two shared buffers), then for each week
   {kind: "jobs", gen, n, jobs, league: {path, sig, bytes?}}: the week's jobs as JSON (season._run_games' own) and the
   league they are played in (its teams file's bytes the first time it is played in here). The helper then claims
   games one at a time from the shared counter, plays each and writes its result, as JSON, into the shared data
   buffer; worker.js, which is inside a Python call and cannot hear messages, reads them there. A job the JavaScript
   leaves to Python (this season's position changes) is marked as not played here, and worker.js plays it.

   The shared control buffer (Int32Array; worker.js lays it out the same way):
     [GEN] the week's number, bumped at each start and when the helpers are given up on
     [NEXT] the next game to claim   [ALLOC] bytes of the data buffer in use   [DONE] games the helpers have finished
     [READY + k] 1 once helper k can play
     [TABLE + 3i ...] game i: its status (1 a helper has it, 2 done, 3 not played here, 5 worker.js has it),
                      its result's offset and length in the data buffer */
"use strict";

const GEN = 0, NEXT = 2, ALLOC = 3, DONE = 4, READY = 8, TABLE = 32;

let api = null, ctrl = null, data = null, me = 0;
const files = new Map();        // a league's signature -> its teams file's text, until the engine has read it
const encoder = new TextEncoder();

function boot(init) {
  me = init.me;
  ctrl = new Int32Array(init.ctrl);
  data = new Uint8Array(init.data);
  importScripts("./engine.js");
  api = self.EngineJS.api;
  api.set_reader((path, sig) => {
    const text = files.get(sig);
    files.delete(sig);            // the engine keeps the parsed teams: the text can go
    if (text === undefined) throw new Error(`no teams file for ${path}`);
    return text;
  });
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
  if (m.league.bytes) files.set(m.league.sig, new TextDecoder().decode(m.league.bytes));
  const league = [m.league.path, m.league.sig];
  const jobs = JSON.parse(m.jobs);
  for (;;) {
    if (Atomics.load(ctrl, GEN) !== m.gen) return;          // the week is over, or the helpers were given up on
    const i = Atomics.add(ctrl, NEXT, 1);
    if (i >= m.n) return;
    Atomics.store(ctrl, TABLE + 3 * i, 1);
    let bytes = null;
    try {
      bytes = encoder.encode(JSON.stringify(api.sim_one(league, jobs[i])));
    } catch (err) {
      if (!(err instanceof api.NotHere)) console.error(err);
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
  if (m.kind === "init") {
    try { boot(m); } catch (err) { console.error(err); postMessage({ kind: "failed", me: m.me, message: String((err && err.message) || err) }); }
  } else if (m.kind === "jobs" && api) {
    try { play(m); } catch (err) { console.error(err); }
  }
};
