/* The page's way to the game: window.CFP.game.fetch(path, options) answers like the server's
   fetch did, with a Response. On the static site (a version.json beside the page) the game runs
   in a Web Worker (web/worker.js) and every call is a message to it; on the dev server (no
   version.json) the calls are plain fetches. window.CFP.game: ready (resolves once the game
   can answer, rejects with the message to show when the browser cannot run it), fetch,
   onLoading(cb) for {stage, loaded, total} while it starts, onStorageError(cb) when a save
   could not be kept, mode ("worker" | "passthrough") and version. */
(function () {
  "use strict";
  window.CFP = window.CFP || {};
  const CANNOT = "This browser cannot run the game: it needs WebAssembly and Web Workers";
  const JSON_HEADERS = { "Content-Type": "application/json" };
  const loadingCbs = [], storageCbs = [];
  const pending = new Map();      // message id -> resolve
  let nextId = 1;
  let impl = null;                // the fetch for the mode
  let snapshot = null;            // the latest status while a sim runs, answered without a round trip
  const game = {
    mode: null, version: null,
    onLoading: (cb) => loadingCbs.push(cb),
    onStorageError: (cb) => storageCbs.push(cb),
    fetch: async (path, options) => { await game.ready; return impl(path, options); },
  };
  window.CFP.game = game;
  const emit = (cbs, arg) => { for (const cb of cbs) { try { cb(arg); } catch (e) { console.error(e); } } };
  const jsonResponse = (data, status) => new Response(JSON.stringify(data), { status: status || 200, headers: JSON_HEADERS });

  // a GET of the running sim's status: the snapshot, with the page's `since` applied to the results
  function fromSnapshot(method, path) {
    if (method !== "GET" || !snapshot) return null;
    const url = new URL(path, location.href);
    const m = /\/api\/season\/([^/]+)\/status$/.exec(url.pathname);
    if (!m || decodeURIComponent(m[1]) !== snapshot.id) return null;
    const since = url.searchParams.get("since");
    const out = { ...snapshot };
    if (since !== null && Array.isArray(out.results)) out.results = out.results.filter((r) => r.week > Number(since));
    return jsonResponse(out);
  }

  async function bodyOf(options) {
    const b = options.body;
    if (b == null) return {};
    if (typeof b === "string") return { bodyJson: b };
    if (b instanceof Blob) return { bodyBytes: new Uint8Array(await b.arrayBuffer()) };
    if (b instanceof ArrayBuffer) return { bodyBytes: new Uint8Array(b.slice(0)) };
    if (ArrayBuffer.isView(b)) return { bodyBytes: new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) };
    return { bodyJson: JSON.stringify(b) };
  }

  function startWorker(version) {
    return new Promise((resolve, reject) => {
      const worker = new Worker("./worker.js");
      worker.onerror = (e) => reject(new Error(`The game could not load: ${e.message || "the worker failed"}`));
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.kind === "loading") emit(loadingCbs, m);
        else if (m.kind === "ready") resolve();
        else if (m.kind === "fatal") reject(new Error(`The game could not load: ${m.message}`));
        else if (m.kind === "status") snapshot = m.busy ? m.status : null;
        else if (m.kind === "storage-error") emit(storageCbs, m);
        else if (pending.has(m.id)) { const done = pending.get(m.id); pending.delete(m.id); done(m); }
      };
      worker.postMessage({ kind: "init", version, breakStorage: !!window.__cfpBreakStorage });
      impl = async (path, options) => {
        options = options || {};
        const method = (options.method || "GET").toUpperCase();
        const quick = fromSnapshot(method, path);
        if (quick) return quick;
        const msg = { id: nextId++, method, path, bodyJson: null, bodyBytes: null, ...(await bodyOf(options)) };
        const reply = await new Promise((done) => { pending.set(msg.id, done); worker.postMessage(msg, msg.bodyBytes ? [msg.bodyBytes.buffer] : []); });
        if (!reply.ok) return jsonResponse({ detail: reply.message }, reply.status);
        if (reply.bytes) return new Response(reply.bytes, { status: 200, headers: { "Content-Type": "application/gzip" } });
        return jsonResponse(reply.result);
      };
    });
  }

  game.ready = (async () => {
    let res = null;
    try { res = await window.fetch("./version.json", { cache: "no-store" }); } catch (e) { /* no site: the dev server */ }
    if (!res || !res.ok) {
      game.mode = "passthrough";
      impl = window.fetch.bind(window);
      return;
    }
    game.version = String(((await res.json().catch(() => ({}))) || {}).commit || "dev");
    game.mode = "worker";
    emit(loadingCbs, { stage: "Starting", loaded: 0, total: 0 });
    if (!window.Worker || !window.WebAssembly) throw new Error(CANNOT);
    await startWorker(game.version);
  })();
})();
