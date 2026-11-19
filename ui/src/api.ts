import { trackSlow } from "./busy.ts";

// The one way to the game: fetch, which the Vite dev server proxies to the Python game server (tools/dev_server.py).

export interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: BodyInit | object;
}

export function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const quiet = /\/status(\?|$)/.test(path);
  const work = request<T>(path, options);
  return quiet ? work : trackSlow(work, options.method && options.method !== "GET" ? "Working…" : "Loading…");
}

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;
  const init: RequestInit = { ...rest, headers };
  if (body !== undefined) {
    const isRaw =
      typeof body === "string" || body instanceof Blob || body instanceof ArrayBuffer || body instanceof FormData;
    init.body = isRaw ? (body as BodyInit) : JSON.stringify(body);
    if (!isRaw) init.headers = { "Content-Type": "application/json", ...(headers as Record<string, string>) };
  }
  const res = await fetch(path, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || data?.detail || `Request failed (${res.status})`);
  return data as T;
}
