/* The game in a Web Worker: the whole game is JavaScript (game.js, one script: app_js/game.js bundled by
   tools/build_site.mjs or the dev server), with its files in memory. The game's own data (the teams, the base league,
   the faces) is one download, the data pack; the seasons, coaches and leagues folders are kept in IndexedDB, written
   after every call that changed a file.
   Messages from the page (ui/src/gameClient.ts): first {kind: "init", version, breakStorage,
   breakRestore, breakStep}, then {id, method, path, bodyJson, bodyBytes, background}, answered with {id, ok,
   status, json | bytes, message} (`json`: the answer as JSON text, which the page reads as it reads a server's).
   The worker posts {kind: "loading", stage, loaded, total}
   while it starts, {kind: "ready"} or {kind: "fatal", message}, {kind: "status", status, busy}
   while a sim runs and {kind: "storage-error", message, copy} when a save could not be
   persisted (or, right after ready, when the saves could not be read: the game then plays from
   memory). One tab at a time holds the store: each worker has its own in-memory copy of the saved
   files and writes what it changed back, so a second tab would roll
   the first one's saves back. The worker takes the "cfp-game" Web Lock for its life before it
   reads the store, waiting for it while another tab holds it (the page is told it is waiting).
   A skin (skin.js says what one is): when the page's init says one is on, the game's script is loaded with the
   skin's names written into it, the skin's files take the place of the site's own, and the saves are another store's
   (see "a skin" below). Anything wrong with a skin is told to the page ({kind: "skin-failed", message}), which takes
   the skin off and starts again without it. */
"use strict";

const GAME = "game.js";              // the game, one script (ui/game.entry.js): the global `Game`
// The data pack (tools/build_site.mjs write_pack): the brotli one where the server says so (Content-Encoding: br,
// vercel.json: the browser has unpacked it by the time it is read here), else the gzip one, unpacked here.
const PACK = "game-data.br", PACK_GZIP = "game-data.gz";
const PACK_MAGIC = [0x43, 0x46, 0x50, 0x4b];      // "CFPK"
// What IndexedDB keeps: the saves, the coaches, and a career's own league as the game plays it (data/leagues: built
// once a season, and without it every reopening of a career past its first season built it again).
const KEPT = ["data/seasons/", "data/coaches/", "data/leagues/"];
const DB_NAME = "cfp-game-files", DB_STORE = "files";     // path -> {t: the file's text, m: when it was written}
let dbName = DB_NAME;      // a skin's careers are a store of their own (`${DB_NAME}@<the skin's id>`): team ids differ between skins

const queue = [];          // messages from the page, served in order
let wake = null;           // resolves the pump's wait for a message
let api = null;            // the game's dispatcher (app_js/api.js)
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

// ---- the game's files -------------------------------------------------------------------------------------------
// Every file the game reads or writes, by its path from the project's root: the data pack's (never written back) and
// the kept folders' (KEPT), which are also in IndexedDB. The game reads and writes at once (engine_js/files.js), so
// everything is in memory; `changes` is what the store has not been told yet.
const mem = new Map();          // path -> text
const times = new Map();        // path -> when it was written (ms), for the files written here or read from the store
const folders = new Map();      // folder -> the names of the files in it (a folder made by a write is in here)
const changes = new Map();      // path -> true (written) | false (removed), for the kept folders

const clean = (path) => { let p = String(path); while (p.startsWith("./")) p = p.slice(2); while (p.startsWith("/")) p = p.slice(1); return p.endsWith("/") ? p.slice(0, -1) : p; };
const kept = (path) => KEPT.some((dir) => path.startsWith(dir));

function put(path, text, when) {
  if (!mem.has(path)) {
    let at = path.lastIndexOf("/"), name = path.slice(at + 1);
    for (;;) {                                   // the file in its folder, and that folder in the ones above it
      const dir = at < 0 ? "" : path.slice(0, at);
      let names = folders.get(dir);
      const known = !!names;
      if (!names) folders.set(dir, (names = new Set()));
      if (name !== null) names.add(name);
      if (known || at < 0) break;
      name = null;
      at = dir.lastIndexOf("/");
    }
  }
  mem.set(path, text);
  if (when !== undefined) times.set(path, when);
}

function drop(path) {
  if (!mem.delete(path)) return false;
  times.delete(path);
  const at = path.lastIndexOf("/");
  const names = folders.get(at < 0 ? "" : path.slice(0, at));
  if (names) names.delete(path.slice(at + 1));
  return true;
}

const store = {
  read(path) {
    const text = mem.get(clean(path));
    if (text === undefined) throw new Error(`${path} is not here`);
    return text;
  },
  write(path, text) {
    const p = clean(path);
    put(p, String(text), Date.now());
    if (kept(p)) changes.set(p, true);
  },
  exists(path) { const p = clean(path); return mem.has(p) || folders.has(p); },
  remove(path) {
    const p = clean(path);
    if (drop(p) && kept(p)) changes.set(p, false);
  },
  remove_dir(path) {
    const dir = clean(path), head = dir + "/";
    for (const p of [...mem.keys()]) if (p.startsWith(head)) store.remove(p);
    for (const d of [...folders.keys()]) if (d === dir || d.startsWith(head)) folders.delete(d);
  },
  list(path) { const names = folders.get(clean(path)); return names ? [...names].sort() : []; },
  mtime(path) { const p = clean(path); return mem.has(p) ? times.get(p) || 0 : null; },
};

// ---- IndexedDB ----------------------------------------------------------------------------------------------------
// (A store of its own: the folders the game kept when it was Python in the browser are other databases, left alone.)
let db = null;

const asked = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("the saved files are held by another page"));
  });
}

// The saves kept from last time, into memory.
async function restore() {
  if (breakRestore) throw new Error("the saved files could not be read");
  db = await openDb();
  const from = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE);
  const [paths, values] = await Promise.all([asked(from.getAllKeys()), asked(from.getAll())]);
  for (let i = 0; i < paths.length; i++) if (values[i] && typeof values[i].t === "string") put(String(paths[i]), values[i].t, values[i].m || 0);
}

// What changed since the last write goes to the store in one transaction; a failure is reported once, the game keeps
// playing from memory (and the changes are tried again with the next).
async function persist() {
  if (restoreError !== null || !changes.size) return;      // the saves could not be read: a memory-only session
  const batch = [...changes];
  changes.clear();
  try {
    if (breakStorage) throw new Error("storage is switched off");
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      const to = tx.objectStore(DB_STORE);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("the save was stopped"));
      for (const [path, written] of batch) {
        if (written && mem.has(path)) to.put({ t: mem.get(path), m: times.get(path) || 0 }, path);
        else to.delete(path);
      }
    });
  } catch (err) {
    for (const [path, written] of batch) if (!changes.has(path)) changes.set(path, written);
    postMessage({ kind: "storage-error", message: String((err && err.message) || err) });
  }
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

// ---- the data pack ------------------------------------------------------------------------------------------------
// One file: "CFPK", its whole length and its index's length (two 32-bit numbers, low byte first), the index as JSON
// ([[path, bytes], ...]), then every file's text one after another.
const isPack = (bytes) => bytes.length >= 12 && PACK_MAGIC.every((b, i) => bytes[i] === b);
const packNumber = (bytes, at) => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;

// Every byte of a download; `loud()` answers whether its progress is posted (the pack says its own length up front:
// the server's is the packed one).
async function readAll(stream, loud) {
  const reader = stream.getReader();
  const chunks = [];
  let loaded = 0, total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (!total && chunks.length === 1 && isPack(value)) total = packNumber(value, 4);
    if (loud()) loading("Downloading the game", Math.min(loaded, total), total);
  }
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

async function fetchPack(version, loud) {
  const v = `?v=${encodeURIComponent(version || "dev")}`;
  let bytes = null;
  try {
    const res = await fetch(`./${PACK}${v}`);
    if (res.ok && res.body) bytes = await readAll(res.body, loud);
  } catch (err) { /* the gzip one is asked for next */ }
  if (bytes && isPack(bytes)) return bytes;
  // a server that does not say the first is brotli sends it still packed: the same pack as gzip, unpacked here
  const res = await fetch(`./${PACK_GZIP}${v}`);
  if (!res.ok || !res.body) throw new Error(`${PACK_GZIP}: HTTP ${res.status}`);
  bytes = await readAll(res.body.pipeThrough(new DecompressionStream("gzip")), loud);
  if (!isPack(bytes)) throw new Error(`${PACK_GZIP} is not the game's data`);
  return bytes;
}

function unpack(bytes) {
  const indexLength = packNumber(bytes, 8);
  const decoder = new TextDecoder();
  const index = JSON.parse(decoder.decode(bytes.subarray(12, 12 + indexLength)));
  let at = 12 + indexLength;
  for (const [path, length] of index) {
    put(path, decoder.decode(bytes.subarray(at, at + length)));
    at += length;
  }
  return index.map(([path]) => path);
}

// ---- a skin -------------------------------------------------------------------------------------------------------
// What a skin (skin.js; tools/make_skin.mjs makes one) changes here:
//   - the game's script: game.js with the skin's names written into the spots the site lists (game.names.json);
//   - the game's data: every path the skin lists (`pack`) and no other. The skin's own files (`files`) take the place
//     of the site's, and the files the game makes itself (`generated`: the engine's teams, the base league) are made
//     here from the skin's rosters (`sources`), by the game, the way the site's build makes its own: one step a
//     worker (this script again, with `task`), as the build runs one step a process. They are kept (IndexedDB) and
//     made again only when the site's own have changed, so a skin outlives a new version of the site;
//   - the saves: a store of their own.
const SKIN_NAMES = "game.names.json";
const SKIN_STEPS = [["teams", "Making the skin's teams"], ["base", "Making the skin's league"]];
let skin = null;           // the skin that is on: {meta, files, gameText, missed, mark, stale}

const fetched = async (url, how) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.split("?")[0]}: HTTP ${res.status}`);
  return res[how]();
};

// The kept skin and the game's script with its names in it.
async function readSkin(version) {
  importScripts("./skin.js");
  const kept = await self.Skin.read(["meta", "words", "files"]);
  const meta = kept.meta;
  if (!meta || !kept.words || !kept.files) throw new Error("no skin is kept in this browser");
  if (meta.format !== self.Skin.FORMAT) throw new Error("the skin was made for another version of the game");
  const v = `?v=${encodeURIComponent(version || "dev")}`;
  const [text, names] = await Promise.all([fetched(`./${GAME}${v}`, "text"), fetched(`./${SKIN_NAMES}${v}`, "json")]);
  const made = self.Skin.apply(text, names, self.Skin.lookup(kept.words), null);
  return { meta, files: kept.files, gameText: made.text, missed: made.missed + (names.complete ? 0 : 1), mark: names.hash, stale: false };
}

// A failure that is the skin's: the page takes the skin off and starts again without it.
function skinTrouble(err) { const e = err instanceof Error ? err : new Error(String(err)); e.skin = true; return e; }

const scriptUrl = (text) => URL.createObjectURL(new Blob([text], { type: "text/javascript" }));

// One step of making the skin's own data, in a worker of its own: it is given every file the game has (and reads the
// skin's rosters itself) and answers with what the step wrote.
function skinStep(task, files) {
  return new Promise((resolve, reject) => {
    if (typeof Worker === "undefined") { reject(new Error("this browser cannot make a skin's teams")); return; }
    const w = new Worker("./worker.js");
    const end = (err, written) => { w.terminate(); if (err) reject(err); else resolve(written); };
    w.onerror = (e) => end(new Error(e.message || "the step failed"));
    w.onmessage = (e) => {
      if (e.data.kind === "task-done") end(null, e.data.written);
      else if (e.data.kind === "task-failed") end(new Error(e.data.message));
    };
    w.postMessage({ kind: "init", task, gameText: skin.gameText, files });
  });
}

// This worker as one step (`init.task`): the game with the files given and the skin's rosters, the step run, and
// what it wrote sent back.
async function runTask(init) {
  try {
    importScripts("./skin.js");
    const kept = await self.Skin.read(["sources"]);
    if (!kept.sources) throw new Error("the skin's rosters are not kept in this browser");
    for (const [path, text] of init.files) put(path, text);
    for (const path of Object.keys(kept.sources)) put(path, kept.sources[path]);
    importScripts(scriptUrl(init.gameText));
    const game = self.Game, written = new Map();
    game.files.set_reader(store.read);
    game.files.set_store({ ...store, write(path, text) { store.write(path, text); written.set(clean(path), String(text)); } });
    if (init.task === "teams") game.modules.build_teams.main([]);
    else if (init.task === "base") game.modules.league.write_base_files();
    else throw new Error(`unknown step: ${init.task}`);
    postMessage({ kind: "task-done", written: [...written] });
  } catch (err) {
    console.error(err);
    postMessage({ kind: "task-failed", message: String((err && err.message) || err) });
  }
}

// The game's data under the skin: `order` is the site's own data as it was unpacked.
async function dressData(order) {
  const S = self.Skin, meta = skin.meta;
  const generated = new Set(meta.generated), pack = new Set(meta.pack);
  // (a mark of the site's own data says whether the site has moved on since the skin was made, and another whether
  // the kept made files are still the ones this site would make)
  const { stale, key } = S.dress(order, { get: (path) => mem.get(path), put, drop }, meta, skin.files, skin.mark);
  skin.stale = stale;
  skin.files = null;
  let made = (await S.read(["cache"])).cache;
  if (!made || made.key !== key) {
    const files = [...mem];
    made = { key, files: {} };
    for (const [task, saying] of SKIN_STEPS) {
      loading(saying);
      for (const [path, text] of await skinStep(task, files)) {
        files.push([path, text]);
        if (generated.has(path)) made.files[path] = text;
      }
    }
    try { await S.write({ cache: made }); } catch (err) { console.warn("skin:", err); }      // not kept: made again next time
  }
  for (const path of Object.keys(made.files)) if (generated.has(path)) put(path, made.files[path]);
  for (const path of pack) if (!mem.has(path)) throw new Error(`the skin has no ${path}`);
}

// ---- a week's games on several cores ----------------------------------------------------------------------------
// Helper workers (sim-worker.js), each the same script of the game, playing games and nothing else. A week's jobs
// (sim_js/season: `season.play_jobs`, which `playJobs` below replaces) go to every helper that is up, and this worker
// plays games itself meanwhile: the same job on the same code, so every result is the one this worker would have
// made, and the season applies them in schedule order as it always has. This worker is inside the game's call for
// the whole week and cannot hear messages, so the helpers and it share two buffers (sim-worker.js lays out the
// control one): that needs the page to be cross-origin isolated (vercel.json's two headers), and without it, or on a
// small machine, there are no helpers and nothing changes. With no helper up, a helper that stops answering, or a
// job a helper hands back, the games are played here.
const SIM_HELPERS_MAX = 3;           // *tune* the most helpers (each holds the league's teams: some 100 MB of memory)
const SIM_SPARE_CORES = 2;           // *tune* cores left alone: this worker's and the page's
// *tune* helpers by the memory the device says it has (Chrome only, and it never says more than 8): [at least GB, helpers]
const SIM_BY_MEMORY = [[8, 3], [4, 2], [0, 0]];
const SIM_HELPERS_UNKNOWN_MEMORY = 2;   // *tune* ... and where the browser does not say
const SIM_DATA_BYTES = 24 << 20;     // room for a week's results (some 45 KB a game)
const SIM_MAX_GAMES = 400;
const SIM_START_MS = 500;            // *tune* how long after a career is first asked for the first helper starts (they start at once)
const SIM_MIN_JOBS = 4;              // *tune* fewer games than this are played here: sharing them costs more than it saves
const SIM_STALL_MS = 120000;         // *tune* how long the helpers may go without finishing a game before theirs are played here
const S_GEN = 0, S_NEXT = 2, S_ALLOC = 3, S_DONE = 4, S_READY = 8, S_TABLE = 32;
const sims = { ctrl: null, data: null, workers: [], gen: 0, n: 0, taken: new Set(), asked: false, broken: false, version: "dev", max: null,
  helped: 0, spent: 0 };      // (for a step's `ms`: the games the helpers have played, and the time the games have taken)

function simHelperCount() {
  if (typeof SharedArrayBuffer === "undefined" || !self.crossOriginIsolated) return 0;
  const nav = self.navigator || {};
  const byMemory = nav.deviceMemory ? SIM_BY_MEMORY.find(([gb]) => nav.deviceMemory >= gb)[1] : SIM_HELPERS_UNKNOWN_MEMORY;
  const count = Math.max(0, Math.min(SIM_HELPERS_MAX, byMemory, (nav.hardwareConcurrency || 2) - SIM_SPARE_CORES));
  return sims.max === null ? count : Math.min(count, sims.max);
}

// Start the helpers, one after another (each loads the game: together they would crowd the page).
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
    w.postMessage({ kind: "init", me: k, ctrl: sims.ctrl.buffer, data: sims.data.buffer, game: `./${GAME}?v=${encodeURIComponent(sims.version)}`,
      gameText: skin ? skin.gameText : null });      // (under a skin: the script with the skin's names in it)
  };
  setTimeout(() => startOne(0), SIM_START_MS);
}

const simDecoder = new TextDecoder();
const simStatus = (i) => Atomics.load(sims.ctrl, S_TABLE + 3 * i);

const simBridge = {
  // A week's jobs (as JSON) to every helper that is up; returns how many took them (0: they are all played here).
  start(jobs, n, path) {
    if (!sims.ctrl || sims.broken || n > SIM_MAX_GAMES) return 0;
    const ready = sims.workers.filter((h) => Atomics.load(sims.ctrl, S_READY + h.me) === 1);
    if (!ready.length) return 0;
    const text = store.read(path);
    const sig = `${path}:${text.length}:${store.mtime(path)}`;
    sims.gen += 1;
    sims.n = n;
    sims.taken.clear();
    for (let i = 0; i < 3 * n; i++) Atomics.store(sims.ctrl, S_TABLE + i, 0);
    Atomics.store(sims.ctrl, S_NEXT, 0);
    Atomics.store(sims.ctrl, S_ALLOC, 0);
    Atomics.store(sims.ctrl, S_DONE, 0);
    Atomics.store(sims.ctrl, S_GEN, sims.gen);
    for (const h of ready) {
      // the league's teams file is this worker's: its text goes with the first week a helper plays in it
      h.worker.postMessage({ kind: "jobs", gen: sims.gen, n, jobs, league: { path, sig, text: h.league === sig ? null : text } });
      h.league = sig;
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
  // A game a helper has finished and this worker has not yet taken, or -1; with `wait`, after waiting that long for one.
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
  // The helpers have gone quiet: they are let go for good, and the games they still held come back to this worker.
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

// `season.play_jobs`: every job played once, `onResult` called with each result as it is known (in any order).
function playJobs(jobs, onResult) {
  const t0 = performance.now();
  try { shareJobs(jobs, onResult); } finally { sims.spent += performance.now() - t0; }
}

function shareJobs(jobs, onResult) {
  const season = self.Game.season;
  const here = (job) => onResult(season._sim_one(job));
  let helpers = 0;
  if (jobs.length >= SIM_MIN_JOBS) {
    try { helpers = simBridge.start(JSON.stringify(jobs), jobs.length, clean(season._TEAMS_PATH || String(season._league_path))); }
    catch (err) { console.warn(err); helpers = 0; }      // the helpers are an optimization: without them the games are played here
  }
  if (!helpers) { for (const job of jobs) here(job); return; }
  // the helper could not play it (or its result did not fit): played here
  const taken = (i) => {
    if (simBridge.failed(i)) return here(jobs[i]);
    sims.helped += 1;
    return onResult(JSON.parse(simBridge.result(i)));
  };
  let got = 0;
  for (;;) {
    const i = simBridge.claim();
    if (i < 0) break;
    here(jobs[i]);
    got += 1;
    for (let j = simBridge.pop(0); j >= 0; j = simBridge.pop(0)) { taken(j); got += 1; }
  }
  while (got < jobs.length) {
    const j = simBridge.pop(SIM_STALL_MS);
    if (j < 0) {                         // the helpers have gone quiet: what they still owe is played here
      for (const k of simBridge.abandon()) { here(jobs[k]); got += 1; }
      break;
    }
    taken(j);
    got += 1;
  }
}


async function start(init) {
  breakStorage = !!init.breakStorage;
  breakRestore = !!init.breakRestore;
  breakStep = !!init.breakStep;
  sims.version = init.version || "dev";
  if (init.helpers !== undefined && init.helpers !== null) sims.max = Number(init.helpers);     // a test hook: at most this many helpers
  loading("Loading the game");
  // the data's download starts now and runs beside the game's own script; a failure waits for the await below
  let scriptUp = false;
  const packing = fetchPack(init.version, () => scriptUp);
  packing.catch(() => {});
  // the store's lock is asked for now and awaited where the store is opened: the game loads meanwhile
  let waitingTab = false;
  const locked = claimStore(() => { waitingTab = true; loading(WAITING_TAB, 0, 0, true); });
  locked.catch(() => {});
  if (init.skin) {
    try {
      skin = await readSkin(init.version);
      dbName = `${DB_NAME}@${skin.meta.id}`;
      importScripts(scriptUrl(skin.gameText));
    } catch (err) { throw skinTrouble(err); }
  } else importScripts(`./${GAME}?v=${encodeURIComponent(sims.version)}`);
  const game = self.Game;
  scriptUp = true;       // from here the download says how far along it is
  loading("Downloading the game");
  const pack = await packing;
  loading("Unpacking the game");
  const order = unpack(pack);
  if (skin) { try { await dressData(order); } catch (err) { throw skinTrouble(err); } }
  if (waitingTab) loading(WAITING_TAB, 0, 0, true);      // the stages since took the notice over
  await locked;
  if (waitingTab) loading("Unpacking the game");
  try { await restore(); }                  // the saves kept from last time
  catch (err) { restoreError = String((err && err.message) || err); }   // blocked storage: play from memory, say so once ready
  loading("Starting the game");
  game.files.set_reader(store.read);
  game.files.set_store(store);
  game.career.zip = game.zip;
  game.season.play_jobs = playJobs;         // a week's games on several cores, where the browser allows it
  api = game.api;
}

// One dispatcher call; the answer goes back and what it wrote is persisted. A failure answers
// this one message with a 500; the worker stays up.
// The save reaches IndexedDB before the page hears the answer: the page may reload on it (the
// offseason's last step), and a reload ends this worker mid-write.
// Every answer says where its time went (`ms`: the game's own work and the save), for
// tools/speed_sweep.js and for anyone reading the worker's messages in the browser's tools.
const OK_HEAD = '{"ok":true,"result":';
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
      ms.bytes = out.length;
      if (out.startsWith(OK_HEAD)) {
        // {"ok":true,"result":...,"changed":true|false}: the result's own text goes to the page as it is
        const end = out.lastIndexOf(',"changed":');
        reply = { id: msg.id, ok: true, status: 200, json: out.slice(OK_HEAD.length, end) };
        if (out.endsWith("true}")) await saved();
      } else {
        const r = JSON.parse(out);
        reply = { id: msg.id, ok: false, status: r.status, message: r.message };
        if (r.changed) await saved();
      }
    } else {
      const bytes = new Uint8Array(out);            // a copy of its own, handed over to the page
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
  const t0 = performance.now(), helped = sims.helped, spent = sims.spent;
  api.step(report);
  const t1 = performance.now();
  if (api.changed()) await persist();            // the week is in the store before the page is told it is over
  // where the step's time went (`games`: the part of `run` that was the week's games), and how many of them the helpers played
  const ms = { run: Math.round(t1 - t0), games: Math.round(sims.spent - spent), save: Math.round(performance.now() - t1), helped: sims.helped - helped };
  if (last !== null) postMessage({ kind: "status", status: JSON.parse(last), busy: false, ms });
  else postMessage({ kind: "step", ms });
  await new Promise((r) => setTimeout(r, 0));      // a macrotask: messages sent meanwhile (pause, status) are served next
}

async function main() {
  await untilMessage();
  const init = queue.shift();
  if (init.task) { await runTask(init); return; }      // this worker is one step of making a skin's data
  try { await start(init); }
  catch (err) {
    console.error(err);
    postMessage({ kind: err && err.skin ? "skin-failed" : "fatal", message: String((err && err.message) || err), plain: !!(err && err.plain) });
    return;
  }
  postMessage({ kind: "ready", skin: skin ? { id: skin.meta.id, name: skin.meta.name, stale: skin.stale, missed: skin.missed } : null });
  if (restoreError !== null) postMessage({ kind: "storage-error", message: restoreError, copy: NO_SAVES });
  try {
    for (;;) {
      if (queue.length) await handle(queue.splice(nextIndex(), 1)[0]);
      else if (api.running()) await step();
      else if (!warmed) {
        // nothing asked yet: read the league now (the first call's wait), while the player is
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
