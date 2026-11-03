/* The page's address: every place the player can be has a URL, so a refresh lands in the same
   place and Back goes where they came from. Query parameters on the same page only (a static site
   under a sub-path), every URL relative. The scheme is in docs/HOW_IT_WORKS.md ("Deep links").

   window.CFP.route:
     get()               the current params as a plain object; `modal` is an array (bottom to top)
     set(patch, {push})  merge patch into the URL (null, undefined, "" or false drops a key; an array
                         repeats it). push adds a history entry, otherwise the entry is replaced.
                         It never redraws anything: it only writes the address bar.
     back(n)             go back n entries the page itself pushed (a closed modal); no change event fires
                         for it, and a set() made before it lands waits for it
     depth()             the modal depth recorded on this history entry
     on(fn)              fn(route) when Back or Forward moved to another entry (not for back() above) */
(function () {
  "use strict";
  window.CFP = window.CFP || {};
  const listeners = [];
  let pendingBack = 0;          // entries back() is still waiting on
  let backTimer = null;
  const queued = [];            // set() calls made while a back() is in flight, in order
  const BACK_WAIT_MS = 800;     // *tune* how long a back() may take before queued sets go anyway

  function parse(search) {
    const q = new URLSearchParams(search);
    const out = {};
    for (const [k, v] of q) {
      if (k === "modal") (out.modal = out.modal || []).push(v);
      else if (!(k in out)) out[k] = v;
    }
    if (!out.modal) out.modal = [];
    return out;
  }
  const get = () => parse(location.search);

  // the id first, then the tab, then the rest in the order they were set: a URL reads from the outside in
  function build(r) {
    const q = new URLSearchParams();
    const keys = Object.keys(r).sort((a, b) => rank(a) - rank(b));
    for (const k of keys) {
      const v = r[k];
      if (Array.isArray(v)) { for (const x of v) if (x != null && x !== "") q.append(k, String(x)); }
      else if (v != null && v !== "" && v !== false) q.set(k, String(v));
    }
    const s = q.toString();
    return s ? `?${s}` : location.pathname.split("/").pop() || "./";
  }
  const ORDER = ["id", "tab", "screen", "week"];
  const rank = (k) => (ORDER.includes(k) ? ORDER.indexOf(k) : k === "modal" ? 99 : 50);

  function write(patch, opts) {
    const cur = get();
    const next = { ...cur, ...patch };
    const url = build(next);
    // a pushed entry starts its own state (no modal open on it unless opts.state says so); a replace keeps the entry's
    const st = { ...(opts.push ? {} : history.state || {}), cfp: true, ...(opts.state || {}) };
    if (!opts.push && url === build(cur) && !opts.state) return;
    try {
      if (opts.push) history.pushState(st, "", url);
      else history.replaceState(st, "", url);
    } catch (e) { /* a sandboxed frame: the page works without its address */ }
  }

  function set(patch, opts = {}) {
    if (pendingBack) { queued.push([patch, opts]); return; }
    write(patch || {}, opts);
  }

  function flush() {
    pendingBack = 0;
    clearTimeout(backTimer);
    while (queued.length) { const [p, o] = queued.shift(); write(p || {}, o); }
  }

  function back(n = 1) {
    if (n <= 0) return;
    pendingBack += n;
    clearTimeout(backTimer);
    backTimer = setTimeout(flush, BACK_WAIT_MS);
    history.go(-n);
  }

  const depth = () => ((history.state && Number(history.state.modal)) || 0);

  window.addEventListener("popstate", () => {
    if (pendingBack) { flush(); return; }     // the page's own back(): it already shows where that entry is
    const r = get();
    for (const fn of listeners) { try { fn(r); } catch (e) { console.error(e); } }
  });

  window.CFP.route = { get, set, back, depth, on: (fn) => listeners.push(fn) };
})();
