// The one way to the game. The old UI's web/game-client.js (window.CFP.game) runs the game in a
// Web Worker on the static site; when it is on the page we use it, otherwise plain fetch, which
// the Vite dev server proxies to the Python dev server.
declare global {
  interface Window {
    CFP?: { game?: { fetch: (path: string, init?: RequestInit) => Promise<Response> } };
  }
}

export interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: BodyInit | object;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const doFetch = window.CFP?.game?.fetch ?? fetch;
  const { body, headers, ...rest } = options;
  const init: RequestInit = { ...rest, headers };
  if (body !== undefined) {
    const isRaw =
      typeof body === "string" || body instanceof Blob || body instanceof ArrayBuffer || body instanceof FormData;
    init.body = isRaw ? (body as BodyInit) : JSON.stringify(body);
    if (!isRaw) init.headers = { "Content-Type": "application/json", ...(headers as Record<string, string>) };
  }
  const res = await doFetch(path, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || data?.detail || `Request failed (${res.status})`);
  return data as T;
}
