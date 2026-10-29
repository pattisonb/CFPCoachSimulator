/* The game in a Web Worker: Pyodide (CPython on WebAssembly) runs the dispatcher (app/api.py)
   from game.zip, unpacked into the worker's in-memory filesystem; the seasons and coaches
   folders are IDBFS mounts, persisted to IndexedDB after every call that wrote a file.
   Messages from the page (web/game-client.js): first {kind: "init", version, breakStorage},
   then {id, method, path, bodyJson, bodyBytes}, answered with {id, ok, status, result | bytes,
   message}. The worker posts {kind: "loading", stage, loaded, total} while it starts,
   {kind: "ready"} or {kind: "fatal", message}, {kind: "status", status, busy} while a sim runs
   and {kind: "storage-error", message} when a save could not be persisted. */
"use strict";

const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const HOME = "/home/pyodide";
const STORES = [HOME + "/data/seasons", HOME + "/data/coaches"];   // what IndexedDB keeps

const queue = [];          // messages from the page, served in order
let wake = null;           // resolves the pump's wait for a message
let pyodide = null;
let api = null;            // the app.api module
let breakStorage = false;  // a test hook: every persist fails
let breakStep = false;     // a test hook: the next sim step throws (a failure after ready)

self.onmessage = (e) => { queue.push(e.data); if (wake) { const w = wake; wake = null; w(); } };

function untilMessage() { return queue.length ? Promise.resolve() : new Promise((r) => { wake = r; }); }

function loading(stage, loaded, total) { postMessage({ kind: "loading", stage, loaded: loaded || 0, total: total || 0 }); }

function syncfs(populate) {
  return new Promise((resolve, reject) => {
    if (breakStorage && !populate) { reject(new Error("storage is switched off")); return; }
    pyodide.FS.syncfs(populate, (err) => (err ? reject(err) : resolve()));
  });
}

// Persist the IDBFS mounts; a failure is reported once, the game keeps playing from memory.
async function persist() {
  try { await syncfs(false); }
  catch (err) { postMessage({ kind: "storage-error", message: String((err && err.message) || err) }); }
}

async function fetchZip(version) {
  const res = await fetch(`./game.zip?v=${encodeURIComponent(version || "dev")}`);
  if (!res.ok) throw new Error(`game.zip: HTTP ${res.status}`);
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
    loading("Downloading the game", loaded, total);
  }
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out.buffer;
}

async function start(init) {
  breakStorage = !!init.breakStorage;
  breakStep = !!init.breakStep;
  loading("Loading Python");
  importScripts(PYODIDE_URL + "pyodide.js");
  pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
  loading("Downloading the game");
  const zip = await fetchZip(init.version);
  loading("Unpacking the game");
  pyodide.unpackArchive(zip, "zip", { extractDir: HOME });
  for (const dir of STORES) {
    pyodide.FS.mkdirTree(dir);
    pyodide.FS.mount(pyodide.FS.filesystems.IDBFS, {}, dir);
  }
  await syncfs(true);                       // the saves kept from last time
  loading("Starting the game");
  await pyodide.runPythonAsync(`import sys, os\nsys.path.insert(0, ${JSON.stringify(HOME)})\nos.environ["SIM_WORKERS"] = "1"\nimport app.api`);
  api = pyodide.pyimport("app.api");
}

// One dispatcher call; the answer goes back and what it wrote is persisted.
async function handle(msg) {
  const out = api.call_js(msg.method, msg.path, msg.bodyJson == null ? null : msg.bodyJson, msg.bodyBytes == null ? null : msg.bodyBytes);
  let changed;
  if (typeof out === "string") {
    const r = JSON.parse(out);
    changed = r.changed;
    postMessage(r.ok ? { id: msg.id, ok: true, status: 200, result: r.result } : { id: msg.id, ok: false, status: r.status, message: r.message });
  } else {
    const bytes = new Uint8Array(out.toJs());
    out.destroy();
    changed = api.changed();
    postMessage({ id: msg.id, ok: true, status: 200, bytes }, [bytes.buffer]);
  }
  if (changed) await persist();
}

// One step of the running job (a week, or your game): the page sees every progress callback.
async function step() {
  let last = null;
  const report = (s) => { last = s; postMessage({ kind: "status", status: JSON.parse(s), busy: true }); };
  if (breakStep) { await new Promise((r) => setTimeout(r, 300)); throw new Error("the sim step is switched off"); }   // calls sent meanwhile are in flight
  const out = api.step(report);
  if (out && out.destroy) out.destroy();
  if (last !== null) postMessage({ kind: "status", status: JSON.parse(last), busy: false });
  if (api.changed()) await persist();
  await new Promise((r) => setTimeout(r, 0));      // a macrotask: messages sent meanwhile (pause, status) are served next
}

async function main() {
  await untilMessage();
  try { await start(queue.shift()); }
  catch (err) { postMessage({ kind: "fatal", message: String((err && err.message) || err) }); return; }
  postMessage({ kind: "ready" });
  try {
    for (;;) {
      if (queue.length) await handle(queue.shift());
      else if (api.running()) await step();
      else await untilMessage();
    }
  } catch (err) {                 // a crash in the pump: the page hears it instead of hanging
    console.error(err);
    postMessage({ kind: "fatal", message: String((err && err.message) || err) });
  }
}

main();
