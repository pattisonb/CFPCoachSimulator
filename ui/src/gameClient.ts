import { beginBusy } from "./busy.ts";
import { ROOT } from "./router.ts";

// The page's way to the game. On this computer (`npm run dev`) every call is a plain fetch, which Vite hands to the
// Python game server. On the published site (built by tools/build_site.py, which sets VITE_GAME=browser) there is no
// server: the same Python game runs in a Web Worker (public/worker.js, Pyodide) and every call is a message to it,
// answered as a Response so api.ts reads both the same way. Saves live in the browser (IndexedDB).
// The worker takes a while to start (Python and the game are downloaded and unpacked), so it starts with the page, and
// until it is up the team picker's reads are answered from plain files the build wrote (boot/, tools/build_site.py):
// the first screen shows at once and the game loads behind it.

/** True on the published site: the game runs in this browser. */
export const IN_BROWSER = import.meta.env.VITE_GAME === "browser";

interface Reply {
  id: number;
  ok: boolean;
  status: number;
  result?: unknown;
  bytes?: Uint8Array;
  message?: string;
}
interface Snapshot {
  id: string;
  results?: { week: number }[];
}

const CANNOT = "This browser cannot run the game: it needs WebAssembly and Web Workers.";
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

// The team picker's reads while the worker is still starting: the answers the build wrote ahead (a game just started
// gives the same ones). Anything else, or a file that is not there, waits for the worker.
async function fromBoot(method: string, path: string): Promise<Response | null> {
  if (up || dead || method !== "GET") return null;
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
    if (!window.Worker || !window.WebAssembly) {
      reject(new Error(CANNOT));
      return;
    }
    let done = beginBusy("Loading the game…");
    const say = (text: string) => {
      done();
      done = beginBusy(text);
    };
    const w = new Worker(`${ROOT}worker.js`);
    // the worker failed: before ready, `ready` rejects; after, every call in flight or to come rejects
    const die = (reason: string, plain = false) => {
      dead = new Error(plain ? reason : `The game could not load: ${reason}`);
      snapshot = null;
      for (const p of pending.values()) p.reject(dead);
      pending.clear();
      done();
      if (servedBoot) beginBusy(dead.message); // the picker is already on the screen: the notice stays to say why it won't start
      reject(dead);
    };
    w.onerror = (e) => die(e.message || "the worker failed");
    w.onmessage = (e) => {
      const m = e.data;
      if (m.kind === "loading") {
        const pct = m.total ? ` ${Math.round((100 * m.loaded) / m.total)}%` : "";
        say(`${m.stage}${pct}…`);
      } else if (m.kind === "ready") {
        up = true;
        done();
        resolve();
      } else if (m.kind === "fatal") die(m.message, m.plain);
      else if (m.kind === "status") snapshot = m.busy ? m.status : null;
      else if (m.kind === "storage-error") console.warn(m.copy || m.message);
      else if (pending.has(m.id)) {
        const p = pending.get(m.id)!;
        pending.delete(m.id);
        p.resolve(m as Reply);
      }
    };
    w.postMessage({ kind: "init", version: import.meta.env.VITE_GAME_VERSION || "dev" });
    worker = w;
  });
}

async function viaWorker(path: string, init: RequestInit, background: boolean): Promise<Response> {
  ready ??= start();
  const method = (init.method || "GET").toUpperCase();
  const boot = await fromBoot(method, path);
  if (boot) return boot;
  await ready;
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
  return jsonResponse(reply.result);
}

/**
 * One call to the game, answered like fetch answers. `background`: a read nobody is waiting on (the ticker, the page
 * following a sim); in the browser the game answers one call at a time, and these wait behind the screen's own reads.
 */
export function gameFetch(path: string, init: RequestInit = {}, background = false): Promise<Response> {
  return IN_BROWSER ? viaWorker(path, init, background) : fetch(path, init);
}

// The game starts loading with the page, not with the first call (a failure is told to whoever calls next). Once the
// app's modules have all run: this one is read before the router's ROOT is set.
if (IN_BROWSER)
  window.setTimeout(() => {
    ready ??= start();
    ready.catch(() => {});
  }, 0);
