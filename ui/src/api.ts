import { trackSlow } from "./busy.ts";
import { gameFetch } from "./gameClient.ts";

// The one way to the game (gameClient.ts): a fetch the Vite dev server hands to the Python game server
// (tools/dev_server.py), or on the published site a message to the game running in this browser.

export interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: BodyInit | object;
  /** a read in the background (the ticker, the page following a sim): it never raises the "Loading…" notice */
  quiet?: boolean;
}

// Reads kept (the player's ask: the site loaded too much). The game changes only through a write from this page or a
// running sim, so between those a read's answer is still true: the same read asked again (a section opened a second
// time, two parts of a page wanting one thing, React's double run in dev) is answered from here, and one already on
// its way is shared. Every write, and every status poll (a sim may be moving the season), starts the store over;
// nothing is kept while a sim runs. Whoever gets an answer must not change it: it is shared.
const KEEP_MS = 5 * 60 * 1000; // *tune* how long a kept answer is trusted
const kept = new Map<string, { at: number; data: Promise<unknown> }>();
let era = 0; // counts the writes and status polls: an answer from an older era is not kept
let simRunning = false;
const NEVER = /\/(status|export)(\?|$)/;

/** Forget every kept read (something outside the page's own writes changed the game). */
export function forgetReads(): void {
  era += 1;
  kept.clear();
}

export function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const isStatus = /\/status(\?|$)/.test(path);
  const quiet = options.quiet || isStatus;
  const read = !options.method || options.method === "GET";
  let work: Promise<T>;
  if (read && !NEVER.test(path) && !simRunning) {
    const hit = kept.get(path);
    if (hit && Date.now() - hit.at < KEEP_MS) return hit.data as Promise<T>;
    const mine = era;
    work = request<T>(path, options);
    kept.set(path, { at: Date.now(), data: work });
    const drop = () => kept.get(path)?.data === work && kept.delete(path);
    // an answer that crossed a write may be the old one: it serves who asked, and is not kept
    work.then(() => mine !== era && drop(), drop);
  } else if (read) {
    work = request<T>(path, options);
    if (isStatus)
      void work.then(
        (s) => {
          simRunning = (s as { status?: string } | null)?.status === "running";
          forgetReads();
        },
        () => forgetReads(),
      );
  } else {
    forgetReads();
    work = request<T>(path, options);
    void work.then(forgetReads, forgetReads);
  }
  return quiet ? work : trackSlow(work, options.method && options.method !== "GET" ? "Working…" : "Loading…");
}

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, headers, quiet: _quiet, ...rest } = options;
  const init: RequestInit = { ...rest, headers };
  if (body !== undefined) {
    const isRaw =
      typeof body === "string" || body instanceof Blob || body instanceof ArrayBuffer || body instanceof FormData;
    init.body = isRaw ? (body as BodyInit) : JSON.stringify(body);
    if (!isRaw) init.headers = { "Content-Type": "application/json", ...(headers as Record<string, string>) };
  }
  const res = await gameFetch(path, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || data?.detail || `Request failed (${res.status})`);
  return data as T;
}
