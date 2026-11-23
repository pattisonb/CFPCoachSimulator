import { beginBusy } from "./busy.ts";
import { ROOT } from "./router.ts";
import { current as currentSkin, fail as failSkin, type SkinReport } from "./skin.ts";

// The page's way to the game. There is no server: the game runs in this browser, in a Web Worker (public/worker.js,
// the whole game as one script), and every call is a message to it, answered as a Response so api.ts reads it the way
// it would read a server's. Saves live in the browser (IndexedDB). It is the same on the published site (built by
// tools/build_site.mjs) and under `npm run dev` (vite.config.ts serves the worker its game and its data).
// The worker takes a moment to start (the game's data is downloaded and unpacked), so it starts with the page, and
// until it is up the team picker's reads are answered from plain files the build wrote (boot/, tools/build_site.mjs):
// the first screen shows at once and the game loads behind it.
// With a skin on (skin.ts) those files are not read: they hold the site's own names, and the game answers with the
// skin's once it is up.

interface Reply {
  id: number;
  ok: boolean;
  status: number;
  /** the answer as JSON text */
  json?: string;
  bytes?: Uint8Array;
  message?: string;
}
interface Snapshot {
  id: string;
  results?: { week: number }[];
}

const CANNOT = "This browser cannot run the game: it needs Web Workers.";
const JSON_HEADERS = { "Content-Type": "application/json" };
const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

const pending = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>();
let nextId = 1;
let worker: Worker | null = null;
let ready: Promise<void> | null = null;
/** the latest status while a sim runs: the worker is busy playing, so the page's progress poll reads this */
let snapshot: Snapshot | null = null;
/** the error once the worker has failed: every call rejects with it */
let dead: Error | null = null;
/** the worker is up: every call goes to it */
let up = false;
/** a read was answered from the build's files: a worker that then fails must say so itself, no call is waiting on it */
let servedBoot = false;

/** what the game said of its skin when it came up (null: none is on) */
let skinReport: SkinReport | null = null;
const skinWaiters: ((r: SkinReport | null) => void)[] = [];

/** The skin the game is running on, once the game is up: null when none is on. */
export function gameSkin(): Promise<SkinReport | null> {
  if (up) return Promise.resolve(skinReport);
  return new Promise((resolve) => skinWaiters.push(resolve));
}

/** how far the worker's start has come, in words; shown only while a call waits on it (or the start itself is held up) */
let stageText = "";
let waiting = 0;
let blocked = false;
let stageNote: (() => void) | null = null;
// The start's notice. The game starts with the page, behind whatever is on the screen, so its stages are not said
// unless something the player did is waiting on it, or the start is waiting on another tab.
function showStage() {
  stageNote?.();
  stageNote = !up && !dead && stageText && (waiting > 0 || blocked) ? beginBusy(stageText) : null;
}

// The team picker's reads while the worker is still starting: the answers the build wrote ahead (a game just started
// gives the same ones). Anything else, or a file that is not there, waits for the worker.
async function fromBoot(method: string, path: string): Promise<Response | null> {
  if (up || dead || method !== "GET" || currentSkin()) return null;
  const m = /\/api\/teams(?:\/([^/]+))?$/.exec(new URL(path, location.href).pathname);
  if (!m) return null;
  try {
    const res = await fetch(`${ROOT}boot/${m[1] ? `teams/${m[1]}` : "teams"}.json`);
    // a missing file can come back as the app's own page (the site sends every unknown path there)
    if (!res.ok || !(res.headers.get("Content-Type") || "").includes("json") || up) return null;
    servedBoot = true;
    return res;
  } catch {
    return null;
  }
}

// a GET of the running sim's status: the snapshot, with the page's `since` applied to the results
function fromSnapshot(method: string, path: string): Response | null {
  if (method !== "GET" || !snapshot) return null;
  const url = new URL(path, location.href);
  const m = /\/api\/season\/([^/]+)\/status$/.exec(url.pathname);
  if (!m || decodeURIComponent(m[1]) !== snapshot.id) return null;
  const since = url.searchParams.get("since");
  const out = { ...snapshot };
  if (since !== null && Array.isArray(out.results)) out.results = out.results.filter((r) => r.week > Number(since));
  return jsonResponse(out);
}

async function bodyOf(body: BodyInit | null | undefined): Promise<{ bodyJson?: string; bodyBytes?: Uint8Array }> {
  if (body == null) return {};
  if (typeof body === "string") return { bodyJson: body };
  if (body instanceof Blob) return { bodyBytes: new Uint8Array(await body.arrayBuffer()) };
  if (body instanceof ArrayBuffer) return { bodyBytes: new Uint8Array(body.slice(0)) };
  if (ArrayBuffer.isView(body))
    return { bodyBytes: new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)) };
  return { bodyJson: JSON.stringify(body) };
}

function start(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (!window.Worker) {
      reject(new Error(CANNOT));
      return;
    }
    stageText = "Loading the game…";
    showStage();
    const w = new Worker(`${ROOT}worker.js`);
    // the worker failed: before ready, `ready` rejects; after, every call in flight or to come rejects
    const die = (reason: string, plain = false) => {
      dead = new Error(plain ? reason : `The game could not load: ${reason}`);
      snapshot = null;
      for (const p of pending.values()) p.reject(dead);
      pending.clear();
      showStage();
      if (servedBoot) beginBusy(dead.message); // the picker is already on the screen: the notice stays to say why it won't start
      reject(dead);
    };
    w.onerror = (e) => die(e.message || "the worker failed");
    w.onmessage = (e) => {
      const m = e.data;
      if (m.kind === "loading") {
        const pct = m.total ? ` ${Math.round((100 * m.loaded) / m.total)}%` : "";
        blocked = !!m.blocked;
        stageText = blocked ? m.stage : `${m.stage}${pct}…`;
        showStage();
      } else if (m.kind === "ready") {
        up = true;
        skinReport = m.skin ?? null;
        for (const told of skinWaiters.splice(0)) told(skinReport);
        showStage();
        resolve();
      } else if (m.kind === "skin-failed") {
        // the game could not start on the skin: the skin comes off and the page starts again on the site's own names
        void failSkin(String(m.message)).then(() => location.reload());
      } else if (m.kind === "fatal") die(m.message, m.plain);
      else if (m.kind === "status") snapshot = m.busy ? m.status : null;
      else if (m.kind === "storage-error") console.warn(m.copy || m.message);
      else if (pending.has(m.id)) {
        const p = pending.get(m.id)!;
        pending.delete(m.id);
        p.resolve(m as Reply);
      }
    };
    w.postMessage({ kind: "init", version: import.meta.env.VITE_GAME_VERSION || "dev", skin: !!currentSkin() });
    worker = w;
  });
}

/**
 * One call to the game, answered like fetch answers. `background`: a read nobody is waiting on (the ticker, the page
 * following a sim); the game answers one call at a time, and these wait behind the screen's own reads.
 */
export async function gameFetch(path: string, init: RequestInit = {}, background = false): Promise<Response> {
  ready ??= start();
  const method = (init.method || "GET").toUpperCase();
  const boot = await fromBoot(method, path);
  if (boot) return boot;
  if (!up) {
    // this call waits on the game's start: the notice says how far along it is until it is up
    waiting++;
    showStage();
    try {
      await ready;
    } finally {
      waiting--;
      showStage();
    }
  }
  if (dead) throw dead;
  const quick = fromSnapshot(method, path);
  if (quick) return quick;
  const msg = { id: nextId++, method, path, bodyJson: null, bodyBytes: null, background, ...(await bodyOf(init.body)) };
  const reply = await new Promise<Reply>((resolve, reject) => {
    pending.set(msg.id, { resolve, reject });
    worker!.postMessage(msg, msg.bodyBytes ? [msg.bodyBytes.buffer] : []);
  });
  if (!reply.ok) return jsonResponse({ detail: reply.message }, reply.status);
  if (reply.bytes) return new Response(reply.bytes, { status: 200, headers: { "Content-Type": "application/gzip" } });
  return new Response(reply.json ?? "null", { status: 200, headers: JSON_HEADERS });
}

// The game starts loading with the page, not with the first call (a failure is told to whoever calls next). Once the
// app's modules have all run: this one is read before the router's ROOT is set.
window.setTimeout(() => {
  ready ??= start();
  ready.catch(() => {});
}, 0);
