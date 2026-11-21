/* The game in a Web Worker: Pyodide (CPython on WebAssembly) runs the dispatcher (app/api.py)
   from game.tar.xz, unpacked into the worker's in-memory filesystem; the seasons and coaches
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
   mounts the store and refuses to start (fatal) when another tab holds it. */
"use strict";

const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const ARCHIVE = "game.tar.xz";   // the game and its data, xz-packed (tools/build_site.py write_archive)
const HOME = "/home/pyodide";
const STORES = [HOME + "/data/seasons", HOME + "/data/coaches"];   // what IndexedDB keeps

const queue = [];          // messages from the page, served in order
let wake = null;           // resolves the pump's wait for a message
let pyodide = null;
let api = null;            // the app.api module
let breakStorage = false;  // a test hook: every persist fails
let breakRestore = false;  // a test hook: reading the saves at start fails
let breakStep = false;     // a test hook: the next sim step throws (a failure after ready)
let warmed = false;        // the league has been read once, ahead of the first call that needs it
let restoreError = null;   // the saves could not be read at start: told to the page once ready

const LOCK_TRIES = 16;      // *tune* how many times the store's lock is asked for before another tab is blamed...
const LOCK_WAIT_MS = 250;   // ... and how long between asks (four seconds in all)
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

function loading(stage, loaded, total) { postMessage({ kind: "loading", stage, loaded: loaded || 0, total: total || 0 }); }

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

// Become the one tab that holds the store, for the worker's life; throws when another tab does.
// Web Locks where the browser has them (Chrome 69, Firefox 96, Safari 15.4); else a ping on a
// BroadcastChannel: whoever answers within 300 ms was there first, and a running worker answers.
async function claimStore() {
  if (self.navigator && navigator.locks) {
    const ask = () => new Promise((resolve) => {
      navigator.locks.request(LOCK, { ifAvailable: true }, (lock) => {
        resolve(!!lock);
        return lock ? new Promise(() => {}) : null;     // never settles: the lock is held until the worker ends
      }).catch(() => resolve(false));
    });
    // a page reloaded (or left and come back to) finds its old worker still letting go of the lock for a moment:
    // asked once, that read as "open in another tab" and the game never started. Ask again for a few seconds first
    for (let tries = 0; tries < LOCK_TRIES; tries++) {
      if (await ask()) return;
      await new Promise((r) => setTimeout(r, LOCK_WAIT_MS));
    }
    throw otherTab();
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
  await claimStore();
  importScripts(PYODIDE_URL + "pyodide.js");
  pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
  pythonUp = true;       // from here the download says how far along it is
  loading("Downloading the game");
  const [zip] = await Promise.all([zipping, pyodide.loadPackage("lzma")]);   // Python's xz reader is an add-on (70 KB)
  loading("Unpacking the game");
  // by tarfile itself: Pyodide's own unpackArchive learned its formats before the xz reader was loaded
  pyodide.FS.writeFile("/tmp/" + ARCHIVE, new Uint8Array(zip));
  pyodide.runPython(`import os, tarfile\nwith tarfile.open("/tmp/${ARCHIVE}") as t:\n    t.extractall(${JSON.stringify(HOME)}, filter="data")\nos.remove("/tmp/${ARCHIVE}")`);
  for (const dir of STORES) {
    pyodide.FS.mkdirTree(dir);
    pyodide.FS.mount(pyodide.FS.filesystems.IDBFS, {}, dir);
  }
  try { await syncfs(true); }               // the saves kept from last time
  catch (err) { restoreError = String((err && err.message) || err); }   // blocked storage: play from memory, say so once ready
  loading("Starting the game");
  await pyodide.runPythonAsync(`import sys, os\nsys.path.insert(0, ${JSON.stringify(HOME)})\nos.environ["SIM_WORKERS"] = "1"\nimport app.api`);
  api = pyodide.pyimport("app.api");
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
      else {
        // nothing asked yet: read the league now (the first call's wait, a second or two), while the player is
        // still looking at the team picker
        if (!warmed) { warmed = true; try { api.call_js("GET", "/api/teams", null, null); } catch (err) { console.error(err); } }
        if (!queue.length) await untilMessage();
      }
    }
  } catch (err) {                 // a crash in the pump: the page hears it instead of hanging
    console.error(err);
    postMessage({ kind: "fatal", message: String((err && err.message) || err) });
  }
}

main();
