import { trackSlow } from "./busy.ts";
import { gameFetch } from "./gameClient.ts";

// The one way to the game (gameClient.ts): a fetch the Vite dev server hands to the Python game server
// (tools/dev_server.py), or on the published site a message to the game running in this browser.

export interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: BodyInit | object;
  /**
   * a read in the background (the ticker, the page following a sim): it never raises the "Loading…" notice, and in the
   * browser it waits behind the reads a screen is showing
   */
  quiet?: boolean;
}

export function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const quiet = options.quiet || /\/status(\?|$)/.test(path);
  const work = request<T>(path, options, quiet);
  return quiet ? work : trackSlow(work, options.method && options.method !== "GET" ? "Working…" : "Loading…");
}

async function request<T>(path: string, options: ApiOptions, quiet: boolean): Promise<T> {
  const { body, headers, quiet: _quiet, ...rest } = options;
  const init: RequestInit = { ...rest, headers };
  if (body !== undefined) {
    const isRaw =
      typeof body === "string" || body instanceof Blob || body instanceof ArrayBuffer || body instanceof FormData;
    init.body = isRaw ? (body as BodyInit) : JSON.stringify(body);
    if (!isRaw) init.headers = { "Content-Type": "application/json", ...(headers as Record<string, string>) };
  }
  const res = await gameFetch(path, init, quiet);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || data?.detail || `Request failed (${res.status})`);
  return data as T;
}
