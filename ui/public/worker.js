/* The game in a Web Worker: Pyodide (CPython on WebAssembly) runs the dispatcher (app/api.py)
   from game.tar.xz, unpacked into the worker's in-memory filesystem; the seasons, coaches and leagues
   folders are IDBFS mounts, persisted to IndexedDB after every call that wrote a file.
   Messages from the page (ui/src/gameClient.ts): first {kind: "init", version, breakStorage,
   breakRestore, breakStep}, then {id, method, path, bodyJson, bodyBytes, background}, answered with {id, ok,
   status, result | bytes, message}. The worker posts {kind: "loading", stage, loaded, total}
   while it starts, {kind: "ready"} or {kind: "fatal", message}, {kind: "status", status, busy}
   while a sim runs and {kind: "storage-error", message, copy} when a save could not be
   persisted (or, right after ready, when the saves could not be read: the game then plays from
   memory). One tab at a time holds the store: each worker has its own in-memory mirror of the
   same IndexedDB folders and a persist writes the whole mirror back, so a second tab would roll
   the first one's saves back. The worker takes the "cfp-game" Web Lock for its life before it
   mounts the store, waiting for it while another tab holds it (the page is told it is waiting). */
"use strict";

const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const ARCHIVE = "game.tar.xz";   // the game and its data, xz-packed (tools/build_site.py write_archive)
const HOME = "/home/pyodide";
// What IndexedDB keeps: the saves, the coaches, and a career's own league as the game plays it (data/leagues: built
// once a season, and without it every reopening of a career past its first season built it again, about fifteen
// seconds of a twenty-second load).
const STORES = [HOME + "/data/seasons", HOME + "/data/coaches", HOME + "/data/leagues"];

const queue = [];          // messages from the page, served in order
let wake = null;           // resolves the pump's wait for a message
let pyodide = null;
let api = null;            // the app.api module
let breakStorage = false;  // a test hook: every persist fails
let breakRestore = false;  // a test hook: reading the saves at start fails
let breakStep = false;     // a test hook: the next sim step throws (a failure after ready)
let warmed = false;        // the league has been read once, ahead of the first call that needs it
let restoreError = null;   // the saves could not be read at start: told to the page once ready

const LOCK_WAIT_MS = 5000;  // *tune* how long the store's lock is waited for before the page is told another tab has it
const WARM_AFTER_MS = 1500;  // *tune* how long the game sits idle after starting before it reads the league ahead
const WAITING_TAB = "The game is open in another tab. This one starts when that one is closed.";
const OTHER_TAB = "The game is already open in another tab. Close it and reload this one.";
const NO_SAVES = "Your browser's storage could not be read: saves will not be kept in this browser. Download a career you want to keep.";
const LOCK = "cfp-game";

// The other-tab refusal: `plain` tells the page to show the message as it is, with no "could not load" prefix.
function otherTab() { const err = new Error(OTHER_TAB); err.plain = true; return err; }

self.onmessage = (e) => { queue.push(e.data); if (wake) { const w = wake; wake = null; w(); } };

// Which queued message is served next. A call that changes the game (anything but a GET) keeps its
// place: nothing sent after it runs before it. Among the reads ahead of the first such call, the newest
// one the player is waiting on goes first (the screen just opened, not the one just left), and the
// background reads (the ticker, the page following a sim) go last.
function nextIndex() {
  let end = queue.findIndex((m) => m.method !== "GET");
  if (end === -1) end = queue.length;
  for (let i = end - 1; i >= 0; i--) if (!queue[i].background) return i;
  return 0;
}

function untilMessage() { return queue.length ? Promise.resolve() : new Promise((r) => { wake = r; }); }

// `blocked`: the stage is a wait the player should hear of even with nothing asked of the game yet (another tab).
function loading(stage, loaded, total, blocked) { postMessage({ kind: "loading", stage, loaded: loaded || 0, total: total || 0, blocked: !!blocked }); }

function syncfs(populate) {
  return new Promise((resolve, reject) => {
    if (breakStorage && !populate) { reject(new Error("storage is switched off")); return; }
    if (breakRestore && populate) { reject(new Error("the saved files could not be read")); return; }
    pyodide.FS.syncfs(populate, (err) => (err ? reject(err) : resolve()));
  });
}

// Persist the IDBFS mounts; a failure is reported once, the game keeps playing from memory.
async function persist() {
  if (restoreError !== null) return;        // the saves could not be read: memory-only session (a write-back would wipe the store)
  try { await syncfs(false); }
  catch (err) { postMessage({ kind: "storage-error", message: String((err && err.message) || err) }); }
}

// Become the one tab that holds the store, for the worker's life. Web Locks where the browser has them (Chrome 69,
// Firefox 96, Safari 15.4): the worker waits in line for the lock, however long that takes, and `onWait` is told
// when it has waited a while. A page reloaded (or left and come back to) finds its old worker still letting go, for
// seconds on a slow machine when that worker was in the middle of starting; asking a few times and then blaming
// another tab stopped the game for good, on a tab that was the only one. A real second tab now starts by itself when
// the first is closed. Else a ping on a BroadcastChannel: whoever answers within 300 ms was there first, a running
// worker answers, and this one throws.
async function claimStore(onWait) {
  if (self.navigator && navigator.locks) {
    await new Promise((resolve) => {
      let held = false;
      const timer = setTimeout(() => { if (!held) onWait(); }, LOCK_WAIT_MS);
      navigator.locks.request(LOCK, () => {
        held = true;
        clearTimeout(timer);
        resolve();
        return new Promise(() => {});     // never settles: the lock is held until the worker ends
      }).catch(() => { clearTimeout(timer); resolve(); });     // locks refused here: nothing to coordinate with
    });
    return;
  }
  if (typeof BroadcastChannel === "undefined") return;   // nothing to coordinate with
  const channel = new BroadcastChannel(LOCK);
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);   // the tie-break between tabs starting together
  const taken = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 300);
    channel.onmessage = (e) => {
      const m = e.data || {};
      if (m.kind === "here") { clearTimeout(timer); resolve(true); }                  // a running tab, or a waiting one that wins
      else if (m.kind === "who" && token < m.token) channel.postMessage({ kind: "here", token });   // the lower token wins the tie
    };
    channel.postMessage({ kind: "who", token });
  });
  if (taken) { channel.close(); throw otherTab(); }
  channel.onmessage = (e) => { if ((e.data || {}).kind === "who") channel.postMessage({ kind: "here", token }); };
}

// `loud`: the download's progress is posted only once it answers true (until then Python's loading has the notice).
async function fetchZip(version, loud) {
  const res = await fetch(`./${ARCHIVE}?v=${encodeURIComponent(version || "dev")}`);
  if (!res.ok) throw new Error(`${ARCHIVE}: HTTP ${res.status}`);
  const total = Number(res.headers.get("Content-Length")) || 0;
  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (loud()) loading("Downloading the game", loaded, total);
  }
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out.buffer;
}

// ---- a week's games on several cores ----------------------------------------------------------------------------
// Helper workers (sim-worker.js), each the JavaScript that plays a game and nothing else. Python hands a week's jobs to
// `simBridge` (the module "sim_bridge"; app/browser_pool.py says what each call is for) and plays games itself
// meanwhile. This worker is inside a Python call for the whole week and cannot hear messages, so the helpers and it
// share two buffers (sim-worker.js lays out the control one): that needs the page to be cross-origin isolated
// (vercel.json's two headers), and without it, or on a small machine, there are no helpers and nothing changes.
const SIM_HELPERS_MAX = 3;           // *tune* the most helpers (each holds the league's teams: some 100 MB of memory)
const SIM_SPARE_CORES = 2;           // *tune* cores left alone: this worker's and the page's
// *tune* helpers by the memory the device says it has (Chrome only, and it never says more than 8): [at least GB, helpers]
const SIM_BY_MEMORY = [[8, 3], [4, 2], [0, 0]];
const SIM_HELPERS_UNKNOWN_MEMORY = 2;   // *tune* ... and where the browser does not say
const SIM_DATA_BYTES = 24 << 20;     // room for a week's results (some 45 KB a game)
const SIM_MAX_GAMES = 400;
const SIM_START_MS = 500;            // *tune* how long after a career is first asked for the first helper starts (they start at once)
const S_GEN = 0, S_NEXT = 2, S_ALLOC = 3, S_DONE = 4, S_READY = 8, S_TABLE = 32;
const sims = { ctrl: null, data: null, workers: [], gen: 0, n: 0, taken: new Set(), asked: false, broken: false, version: "dev" };

function simHelperCount() {
  if (typeof SharedArrayBuffer === "undefined" || !self.crossOriginIsolated) return 0;
  const nav = self.navigator || {};
  const byMemory = nav.deviceMemory ? SIM_BY_MEMORY.find(([gb]) => nav.deviceMemory >= gb)[1] : SIM_HELPERS_UNKNOWN_MEMORY;
  return Math.max(0, Math.min(SIM_HELPERS_MAX, byMemory, (nav.hardwareConcurrency || 2) - SIM_SPARE_CORES));
}

// Start the helpers, one after another (each loads Python and the game: together they would crowd the page).
function simStartHelpers() {
  if (sims.asked) return;
  sims.asked = true;
  const count = simHelperCount();
  if (!count) return;
  try {
    sims.ctrl = new Int32Array(new SharedArrayBuffer(4 * (S_TABLE + 3 * SIM_MAX_GAMES)));
    sims.data = new Uint8Array(new SharedArrayBuffer(SIM_DATA_BYTES));
  } catch (err) { console.warn(err); sims.ctrl = null; return; }
  const startOne = (k) => {
    if (k >= count || sims.broken) return;
    let w;
    try { w = new Worker("./sim-worker.js"); } catch (err) { console.warn(err); return; }
    const helper = { worker: w, me: k, league: null };
    sims.workers.push(helper);
    w.onmessage = (e) => { if (e.data.kind === "ready") startOne(k + 1); else if (e.data.kind === "failed") console.warn("sim helper:", e.data.message); };
    w.onerror = (e) => console.warn("sim helper:", e.message);
    w.postMessage({ kind: "init", me: k, ctrl: sims.ctrl.buffer, data: sims.data.buffer });
  };
  setTimeout(() => startOne(0), SIM_START_MS);
}

const simDecoder = new TextDecoder();
const simStatus = (i) => Atomics.load(sims.ctrl, S_TABLE + 3 * i);

const simBridge = {
  // A week's jobs (pickled) to every helper that is up; returns how many took them (0: Python plays them all here).
  start(jobs, n, path) {
    if (!sims.ctrl || sims.broken || n > SIM_MAX_GAMES) return 0;
    const ready = sims.workers.filter((h) => Atomics.load(sims.ctrl, S_READY + h.me) === 1);
    if (!ready.length) return 0;
    const stat = pyodide.FS.stat(path);
    const sig = `${path}:${stat.size}:${+stat.mtime}`;
    sims.gen += 1;
    sims.n = n;
    sims.taken.clear();
    for (let i = 0; i < 3 * n; i++) Atomics.store(sims.ctrl, S_TABLE + i, 0);
    Atomics.store(sims.ctrl, S_NEXT, 0);
    Atomics.store(sims.ctrl, S_ALLOC, 0);
    Atomics.store(sims.ctrl, S_DONE, 0);
    Atomics.store(sims.ctrl, S_GEN, sims.gen);
    for (const h of ready) {
      // the league's teams file is this worker's: its bytes go with the first week a helper plays in it
      const league = { path, sig, bytes: h.league === sig ? null : pyodide.FS.readFile(path) };
      h.league = sig;
      h.worker.postMessage({ kind: "jobs", gen: sims.gen, n, jobs, league }, league.bytes ? [league.bytes.buffer] : []);
    }
    return ready.length;
  },
  // The next game for this worker to play itself, or -1 when every game is taken.
  claim() {
    const i = Atomics.add(sims.ctrl, S_NEXT, 1);
    if (i >= sims.n) return -1;
    Atomics.store(sims.ctrl, S_TABLE + 3 * i, 5);
    return i;
  },
  // A game a helper has finished and Python has not yet taken, or -1; with `wait`, after waiting that long for one.
  pop(wait) {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < sims.n; i++) {
        const st = simStatus(i);
        if ((st === 2 || st === 3) && !sims.taken.has(i)) { sims.taken.add(i); return i; }
      }
      if (!wait || pass) break;
      Atomics.wait(sims.ctrl, S_DONE, sims.taken.size, wait);      // DONE counts the same games `taken` does
    }
    return -1;
  },
  failed: (i) => simStatus(i) === 3,
  result(i) {
    const at = Atomics.load(sims.ctrl, S_TABLE + 3 * i + 1), len = Atomics.load(sims.ctrl, S_TABLE + 3 * i + 2);
    return simDecoder.decode(sims.data.slice(at, at + len));      // (a copy: text cannot be read straight from shared memory)
  },
  // The helpers have gone quiet: they are let go for good, and the games they still held come back to Python.
  abandon() {
    sims.broken = true;
    Atomics.store(sims.ctrl, S_GEN, sims.gen + 1);
    for (const h of sims.workers) { try { h.worker.terminate(); } catch (err) { /* already gone */ } }
    const owed = [];
    for (let i = 0; i < sims.n; i++) if (!sims.taken.has(i) && simStatus(i) !== 5) owed.push(i);
    console.warn("sim helpers stopped answering:", owed.length, "games played here");
    return owed;
  },
};


async function start(init) {
  breakStorage = !!init.breakStorage;
  breakRestore = !!init.breakRestore;
  breakStep = !!init.breakStep;
  loading("Loading Python");
  // the game's download starts now and runs beside Python's (they were one after the other); a failure waits for
  // the await below
  let pythonUp = false;
  const zipping = fetchZip(init.version, () => pythonUp);
  zipping.catch(() => {});
  // the store's lock is asked for now and awaited where the store is opened: Python and the game load meanwhile
  let waitingTab = false;
  const locked = claimStore(() => { waitingTab = true; loading(WAITING_TAB, 0, 0, true); });
  locked.catch(() => {});
  importScripts(PYODIDE_URL + "pyodide.js");
  pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
  // the game engine is JavaScript (engine_js/, bundled as engine.js): the Python asks it for games through this
  // module (sim/engine.py), JSON text each way
  importScripts("./engine.js");
  self.EngineJS.api.set_reader((path) => pyodide.FS.readFile(path, { encoding: "utf8" }));     // a league's teams file
  pyodide.registerJsModule("js_engine", {
    call: (fn, args) => {
      try { return JSON.stringify(self.EngineJS.api[fn](...JSON.parse(args))); }
      catch (err) {
        if (err instanceof self.EngineJS.api.NotHere) return '{"__not_here__":true}';      // a job the Python plays
        throw err;
      }
    },
  });
  pythonUp = true;       // from here the download says how far along it is
  loading("Downloading the game");
  const [zip] = await Promise.all([zipping, pyodide.loadPackage("lzma")]);   // Python's xz reader is an add-on (70 KB)
  loading("Unpacking the game");
  // by tarfile itself: Pyodide's own unpackArchive learned its formats before the xz reader was loaded
  pyodide.FS.writeFile("/tmp/" + ARCHIVE, new Uint8Array(zip));
  pyodide.runPython(`import os, tarfile\nwith tarfile.open("/tmp/${ARCHIVE}") as t:\n    t.extractall(${JSON.stringify(HOME)}, filter="data")\nos.remove("/tmp/${ARCHIVE}")`);
  if (waitingTab) loading(WAITING_TAB, 0, 0, true);      // the stages since took the notice over
  await locked;
  if (waitingTab) loading("Unpacking the game");
  for (const dir of STORES) {
    pyodide.FS.mkdirTree(dir);
    pyodide.FS.mount(pyodide.FS.filesystems.IDBFS, {}, dir);
  }
  try { await syncfs(true); }               // the saves kept from last time
  catch (err) { restoreError = String((err && err.message) || err); }   // blocked storage: play from memory, say so once ready
  loading("Starting the game");
  await pyodide.runPythonAsync(`import sys, os\nsys.path.insert(0, ${JSON.stringify(HOME)})\nos.environ["SIM_WORKERS"] = "1"\nimport app.api`);
  api = pyodide.pyimport("app.api");
  sims.version = init.version || "dev";
  try {                                       // a week's games on several cores, where the browser allows it
    pyodide.registerJsModule("sim_bridge", simBridge);
    pyodide.runPython("from app import browser_pool\nbrowser_pool.install()");
  } catch (err) { console.warn(err); }
}

// One dispatcher call; the answer goes back and what it wrote is persisted. A failure answers
// this one message with a 500 (a reply that could not be parsed, say); the worker stays up.
// The save reaches IndexedDB before the page hears the answer: the page may reload on it (the
// offseason's last step), and a reload ends this worker mid-write.
// Every answer says where its time went (`ms`: the game's own work, turning its answer into an object, the save), for
// tools/speed_sweep.js and for anyone reading the worker's messages in the browser's tools.
async function handle(msg) {
  let reply, transfer = [];
  const ms = { run: 0, parse: 0, save: 0 };
  const t0 = performance.now();
  const saved = async () => { const t = performance.now(); await persist(); ms.save = Math.round(performance.now() - t); };
  if (!sims.asked && msg.path.includes("/api/season/")) simStartHelpers();     // a career is open: sims are coming
  try {
    const out = api.call_js(msg.method, msg.path, msg.bodyJson == null ? null : msg.bodyJson, msg.bodyBytes == null ? null : msg.bodyBytes);
    ms.run = Math.round(performance.now() - t0);
    if (typeof out === "string") {
      const t1 = performance.now();
      const r = JSON.parse(out);
      ms.parse = Math.round(performance.now() - t1);
      ms.bytes = out.length;
      reply = r.ok ? { id: msg.id, ok: true, status: 200, result: r.result } : { id: msg.id, ok: false, status: r.status, message: r.message };
      if (r.changed) await saved();
    } else {
      const bytes = new Uint8Array(out.toJs());
      out.destroy();
      reply = { id: msg.id, ok: true, status: 200, bytes };
      transfer = [bytes.buffer];
      if (api.changed()) await saved();
    }
  } catch (err) {
    console.error(err);
    reply = { id: msg.id, ok: false, status: 500, message: String((err && err.message) || err) };
    try { if (api.changed()) await persist(); } catch (e) { console.error(e); }
  }
  reply.ms = ms;
  postMessage(reply, transfer);
}

// One step of the running job (a week, or your game): the page sees every progress callback.
async function step() {
  let last = null;
  const report = (s) => { last = s; postMessage({ kind: "status", status: JSON.parse(s), busy: true }); };
  if (breakStep) { await new Promise((r) => setTimeout(r, 300)); throw new Error("the sim step is switched off"); }   // calls sent meanwhile are in flight
  const t0 = performance.now();
  const out = api.step(report);
  if (out && out.destroy) out.destroy();
  const t1 = performance.now();
  if (api.changed()) await persist();            // the week is in the store before the page is told it is over
  const ms = { run: Math.round(t1 - t0), save: Math.round(performance.now() - t1) };      // where the step's time went
  if (last !== null) postMessage({ kind: "status", status: JSON.parse(last), busy: false, ms });
  else postMessage({ kind: "step", ms });
  await new Promise((r) => setTimeout(r, 0));      // a macrotask: messages sent meanwhile (pause, status) are served next
}

async function main() {
  await untilMessage();
  try { await start(queue.shift()); }
  catch (err) { postMessage({ kind: "fatal", message: String((err && err.message) || err), plain: !!(err && err.plain) }); return; }
  postMessage({ kind: "ready" });
  if (restoreError !== null) postMessage({ kind: "storage-error", message: restoreError, copy: NO_SAVES });
  try {
    for (;;) {
      if (queue.length) await handle(queue.splice(nextIndex(), 1)[0]);
      else if (api.running()) await step();
      else if (!warmed) {
        // nothing asked yet: read the league now (the first call's wait, a second or two), while the player is
        // still looking at the team picker. Not at once: the calls that waited on the start arrive a moment after
        // "ready", and one of them stood behind this read with a Loading note up
        await Promise.race([untilMessage(), new Promise((r) => setTimeout(r, WARM_AFTER_MS))]);     // a call ends the wait at once
        if (queue.length || api.running()) continue;
        warmed = true;
        try { api.call_js("GET", "/api/teams", null, null); } catch (err) { console.error(err); }
      }
      else await untilMessage();
    }
  } catch (err) {                 // a crash in the pump: the page hears it instead of hanging
    console.error(err);
    postMessage({ kind: "fatal", message: String((err && err.message) || err) });
  }
}

main();
