/* Headquarters (a Coach Career tab beside Recruiting): a dashboard the player builds from widgets.
   Spec: docs/superpowers/specs/2026-11-07-headquarters-design.md.
   window.HQ = { register(widget), render(season, box, helpers), widgets(), saving() }.
   A widget is a plain object (id, title, category, blurb, sizes, size, sources, sample, draw, viewAll, status);
   web/hq-widgets/*.js register them. The canvas fetches each source the placed widgets name once and hands
   each widget its own; the drawer's previews draw from each widget's sample, so the drawer never calls the
   server. The layout saves to the career (GET/POST /api/season/{id}/headquarters) a moment after each change. */
(function () {
  "use strict";
  const CFP = window.CFP;
  const ui = () => CFP.ui;
  // CFP.el with null, undefined and false attributes left off (CFP.el would write "null")
  const el = (tag, attrs = {}, kids = []) => {
    const a = {};
    for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) a[k] = v;
    return CFP.el(tag, a, kids);
  };

  const HQ_SAVE_DELAY = 600;       // *tune* ms after the last change before the layout saves
  const HQ_ROW = 4, HQ_GAP = 16;    // the masonry's row unit and the gap under every card (px; hq.css's grid-auto-rows and column-gap)
  const EMPTY_LINE = "Build your Headquarters. Add widgets for recruiting and scouting.";
  const SIZE_NAMES = { S: "Small", M: "Medium", L: "Large" };
  // heights: none is Auto (the card fits its content up to --hq-card-h, then scrolls); a set height is px
  const H_STEP = 40, H_MIN = 120, H_MAX = 1600;     // *tune* the edge snaps to this; the limits match headquarters.CARD_H
  const H_CHIPS = [["", "Auto"], [560, "Tall"], [800, "Extra Tall"]];     // *tune* a phone's height chips
  const snapH = (px) => Math.max(H_MIN, Math.min(H_MAX, Math.round(px / H_STEP) * H_STEP));
  function applyHeight(node, c) {
    node.classList.toggle("hq-set-h", !!c.h);
    node.style.height = c.h ? `${c.h}px` : "";
    for (const b of node.querySelectorAll(".hq-height")) b.setAttribute("aria-pressed", String(String(c.h || "") === b.dataset.h));
  }
  const CATS = [["all", "All"], ["recruiting", "Recruiting"], ["scouting", "Scouting"], ["program", "Program"]];
  // what each inline action changes: the sources refetched after it
  // (prospects is not refetched: Recruit Search keeps the player's own search and flips its own buttons)
  const ACT_SOURCES = { board: ["board", "scouting"], scout: ["scouting", "board"] };

  const registry = new Map();
  let H = null;                    // season.js helpers (api, postJSON, toast, onChange, errText)
  let view = null;                 // the open Headquarters: { season, box, cards, data, editing, cat, q, ... }
  let pending = 0, timer = null;   // saves in flight and a save waiting to go

  function register(w) {
    if (!w || !w.id || registry.has(w.id)) return;
    registry.set(w.id, Object.assign({ sizes: ["M"], size: "M", sources: [], status: "ready", category: "recruiting" }, w));
  }
  const ready = (w) => w && w.status !== "soon";
  const sizeOk = (w, s) => (w.sizes.includes(s) ? s : w.size);

  // ----- sources --------------------------------------------------------------------------------------
  function sourceUrl(name, s) {
    const id = encodeURIComponent(s.id);
    if (name === "board") return `/api/season/${id}/recruiting`;
    if (name === "scouting") return `/api/season/${id}/scouting`;
    if (name === "programs") return `/api/season/${id}/programs`;
    if (name === "classes") return `/api/season/${id}/classes`;
    if (name === "prospects") return `/api/season/${id}/prospects?limit=50`;
    if (name === "depth") return `/api/season/${id}/depth/${encodeURIComponent(s.team)}`;
    if (name === "hq") {
      const want = new Set();
      for (const c of view.cards) { const w = registry.get(c.widget); if (ready(w)) for (const x of w.want || []) want.add(x); }
      return `/api/season/${id}/headquarters?want=${[...want].join(",")}`;
    }
    return null;
  }
  // the sources the placed widgets need, fetched once each (a fetch in flight is shared)
  function fetchSource(name, fresh) {
    const url = sourceUrl(name, view.season);
    const key = name === "hq" ? url : name;          // the gap reads: one fetch per set of reads asked for
    if (!fresh && view.data[key]) return view.data[key];
    const p = url ? H.api(url) : Promise.reject(new Error(`unknown source ${name}`));
    view.data[key] = p;
    const mine = view;
    p.catch(() => { if (mine.data[key] === p) delete mine.data[key]; });
    return p;
  }
  async function dataFor(w, fresh) {
    const out = {};
    await Promise.all(w.sources.map(async (n) => { out[n] = await fetchSource(n, fresh && fresh.includes(n)); }));
    return out;
  }

  // ----- a card ---------------------------------------------------------------------------------------
  function ctxFor(w, size, sample) {
    return {
      size, sample: !!sample, season: view.season, helpers: H, api: H.api, postJSON: H.postJSON,
      act: (kind, who, button) => (sample ? Promise.resolve(false) : act(kind, who, button)),
      openProfile: (pid) => { if (!sample && window.Recruiting) window.Recruiting.openProfile(view.season, pid); },
      // after a widget saves something of its own (tasks, goals): refetch those sources and redraw the cards that read them
      refresh: (names) => (sample ? Promise.resolve() : refresh(names)),
      go: (tab) => { if (!sample && H.onChange) H.onChange(tab); },
    };
  }
  function failed() { return el("p", { class: "muted hq-failed", text: "Couldn't Load This Widget" }); }
  function drawSafe(w, data, ctx) {
    try {
      const node = w.draw(data, ctx);
      return node && node.nodeType ? node : failed();
    } catch (e) {
      console.error(`Headquarters: ${w.id} could not draw`, e);
      return failed();
    }
  }
  async function fillCard(node, c, opts = {}) {
    const w = registry.get(c.widget);
    const body = node.querySelector(".hq-body");
    const token = (node.__draw = (node.__draw || 0) + 1);
    let data;
    try { data = await dataFor(w, opts.fresh); }
    catch (e) {
      console.error(`Headquarters: ${w.id} could not load`, e);
      if (node.__draw === token) body.replaceChildren(failed());
      return;
    }
    if (node.__draw !== token || !node.isConnected) return;
    const fresh = el("div", { class: "hq-body" }, [drawSafe(w, data, ctxFor(w, c.size))]);
    if (opts.morph && body.firstChild) ui().morph(body, fresh, { pulse: true });
    else body.replaceChildren(...fresh.childNodes);
  }
  function editBar(c, w) {
    const i = () => view.cards.findIndex((x) => x.id === c.id);
    const handle = el("button", { type: "button", class: "hq-drag", "aria-label": "Drag to Move", title: "Drag to Move", text: "⠿" });
    handle.addEventListener("pointerdown", (e) => startDrag(e, c.id));
    const sizes = w.sizes.length > 1 ? el("div", { class: "hq-sizes", role: "group", "aria-label": "Size" },
      w.sizes.map((s) => {
        const b = el("button", { type: "button", class: "go-chip hq-card-size", "data-size": s, "aria-pressed": String(c.size === s), "aria-label": SIZE_NAMES[s], text: s });
        ui().on(b, "click", () => change((cards) => { cards[i()].size = s; }));
        return b;
      })) : null;
    const earlier = el("button", { type: "button", class: "go-btn hq-earlier", text: "◀", "aria-label": "Move Earlier", title: "Move Earlier" });
    const later = el("button", { type: "button", class: "go-btn hq-later", text: "▶", "aria-label": "Move Later", title: "Move Later" });
    const remove = el("button", { type: "button", class: "go-btn hq-remove", text: "✕", "aria-label": `Remove ${w.title}`, title: "Remove" });
    ui().on(earlier, "click", () => move(c.id, -1));
    ui().on(later, "click", () => move(c.id, +1));
    ui().on(remove, "click", () => removeCard(c.id));
    // a phone's height chips (the bottom edge is the wide screen's way)
    const heights = el("div", { class: "hq-heights", role: "group", "aria-label": "Height" }, H_CHIPS.map(([h, label]) => {
      const b = el("button", { type: "button", class: "go-chip hq-height", "data-h": String(h), "aria-pressed": String(String(c.h || "") === String(h)), text: label });
      ui().on(b, "click", () => change((cards) => { setH(cards[i()], h || null); }));
      return b;
    }));
    return el("div", { class: "hq-edit" }, [handle, sizes, heights, el("span", { class: "hq-edit-gap" }), earlier, later, remove]);
  }
  function cardNode(c) {
    const w = registry.get(c.widget);
    const all = w.viewAll ? el("button", { type: "button", class: "go-link hq-viewall", text: "View All" }) : null;
    if (all) ui().on(all, "click", () => H.onChange && H.onChange(w.viewAll));
    const node = el("section", { class: "go-card hq-card", "data-key": c.id, "data-widget": c.widget, "data-size": c.size, "aria-label": w.title }, [
      el("div", { class: "card-bar hq-bar" }, [el("h3", { class: "go-kicker", text: w.title }), all]),
      editBar(c, w),
      el("div", { class: "hq-body" }, [el("p", { class: "muted hq-wait", text: "Loading…" })]),
      resizeEdge(c),
    ]);
    applyHeight(node, c);
    fillCard(node, c);
    if (watcher) watcher.observe(node);
    return node;
  }
  function patchCard(node, c) {
    const w = registry.get(c.widget);
    applyHeight(node, c);
    if (node.dataset.size !== c.size) {
      node.dataset.size = c.size;
      for (const b of node.querySelectorAll(".hq-card-size")) b.setAttribute("aria-pressed", String(b.dataset.size === c.size));
      fillCard(node, c);
      ui().pulse(node);
    }
    void w;
  }

  // ----- masonry: each card, in order, goes to the column(s) with the most room ----------------------------
  // Small spans one column, Medium two (one on a phone), Large them all. Repacked when any card changes height,
  // the grid's width changes, a card is added, moved, resized or removed.
  let packing = false, watcher = null;
  const stillMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const PACK_MS = 170;              // *tune* how long a card takes to slide to its new place
  // pack({animate, from}): place the cards (and a drag's placeholder); with animate, every card that moved slides
  // from where it was (from: rects taken before the change, else now)
  function pack(opts = {}) {
    packing = false;
    const grid = view && view.box.querySelector(".hq-grid");
    if (!grid || !grid.isConnected) return;
    const items = [...grid.children].filter((n) => (n.classList.contains("hq-card") || n.classList.contains("hq-placeholder")) && !n.__leaving);
    const from = opts.animate && !stillMotion() ? opts.from || new Map(items.map((n) => [n, n.getBoundingClientRect()])) : null;
    const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
    const h = new Array(cols).fill(0);
    for (const n of items) {
      const w = n.dataset.size === "L" ? cols : n.dataset.size === "M" ? Math.min(2, cols) : 1;
      let at = 0, top = Infinity;
      for (let c = 0; c + w <= cols; c++) { const t = Math.max(...h.slice(c, c + w)); if (t < top) { top = t; at = c; } }
      const rows = Math.max(1, Math.ceil((n.getBoundingClientRect().height + HQ_GAP) / HQ_ROW));
      n.style.gridColumn = `${at + 1} / span ${w}`;
      n.style.gridRow = `${top + 1} / span ${rows}`;
      for (let c = at; c < at + w; c++) h[c] = top + rows;
    }
    if (!from) return;
    for (const n of items) {
      const a = from.get(n), b = n.getBoundingClientRect();
      if (!a || !n.animate) continue;
      const dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: PACK_MS, easing: "ease-out" });
    }
  }
  function queuePack() { if (!packing) { packing = true; requestAnimationFrame(pack); } }

  // ----- the layout -----------------------------------------------------------------------------------
  const placed = () => view.cards.filter((c) => ready(registry.get(c.widget)));
  function drawGrid(opts = {}) {
    const grid = view.box.querySelector(".hq-grid");
    ui().reconcile(grid, placed(), "id", cardNode, patchCard);
    pack();
    if (opts.pulse) { const n = grid.querySelector(`.hq-card[data-key="${opts.pulse}"]`); if (n) { ui().pulse(n); n.scrollIntoView({ block: "nearest", behavior: "smooth" }); } }
    view.box.querySelector(".hq-empty").hidden = placed().length > 0;
    syncDrawer();
  }
  function change(fn, opts) {
    const cards = view.cards.map((c) => Object.assign({}, c));
    fn(cards);
    view.cards = cards;
    drawGrid(opts);
    queueSave();
  }
  function move(id, step) {
    const vis = placed();
    const at = vis.findIndex((c) => c.id === id), to = at + step;
    if (at < 0 || to < 0 || to >= vis.length) return;
    change((cards) => {
      const a = cards.findIndex((c) => c.id === vis[at].id), b = cards.findIndex((c) => c.id === vis[to].id);
      [cards[a], cards[b]] = [cards[b], cards[a]];
    });
    const n = view.box.querySelector(`.hq-card[data-key="${id}"] ${step < 0 ? ".hq-earlier" : ".hq-later"}`);
    if (n && !n.disabled) n.focus();
  }
  function nextId() {
    let n = 1;
    const used = new Set(view.cards.map((c) => c.id));
    while (used.has(`c${n}`)) n++;
    return `c${n}`;
  }
  function addWidget(id, size) {
    const w = registry.get(id);
    if (!ready(w) || view.cards.some((c) => c.widget === id)) return;
    const c = { id: nextId(), widget: id, size: sizeOk(w, size || w.size) };
    change((cards) => { cards.push(c); }, { pulse: c.id });
  }
  function removeCard(id) {
    const at = view.cards.findIndex((c) => c.id === id);
    if (at < 0) return;
    const gone = view.cards[at], w = registry.get(gone.widget);
    change((cards) => { cards.splice(at, 1); });
    const t = ui().toast(`Removed ${w.title}.`, { ms: 6000 });
    const undo = el("button", { type: "button", class: "go-link hq-undo", text: "Undo" });
    const mine = view;
    undo.addEventListener("click", () => {
      if (view !== mine || view.cards.some((c) => c.id === gone.id)) return;
      change((cards) => { cards.splice(Math.min(at, cards.length), 0, gone); }, { pulse: gone.id });
    });
    if (t) t.append(" ", undo);
  }
  let queued = null;               // the save waiting for its delay: sent at once if the page redraws first
  function queueSave() {
    clearTimeout(timer);
    const s = view.season, cards = view.cards.map((c) => ({ id: c.id, widget: c.widget, size: c.size, ...(c.h ? { h: c.h } : {}) }));
    queued = async () => {
      clearTimeout(timer);
      timer = null;
      queued = null;
      pending++;
      try { await H.api(`/api/season/${encodeURIComponent(s.id)}/headquarters`, H.postJSON({ cards })); }
      catch (e) { ui().toast("Couldn't save your layout.", { kind: "error" }); }
      finally { pending--; }
    };
    timer = setTimeout(queued, HQ_SAVE_DELAY);
  }
  function flushSave() { if (queued) queued(); }

  // ----- dragging: the card lifts and follows the pointer; a placeholder shows where it will land -------------
  // The other cards slide to make room as the placeholder moves; the half of the card under the pointer decides the
  // side, so nothing flips back and forth. The drop puts the card where the placeholder is; Escape puts it back.
  function startDrag(e, id) {
    if (e.button !== 0) return;
    const grid = view.box.querySelector(".hq-grid");
    const node = grid.querySelector(`.hq-card[data-key="${id}"]`);
    if (!node) return;
    e.preventDefault();
    const r0 = node.getBoundingClientRect();
    const dx = e.clientX - r0.left, dy = e.clientY - r0.top;
    const home = node.nextSibling;
    const ph = el("div", { class: "hq-placeholder", "data-size": node.dataset.size, "aria-hidden": "true" });
    ph.style.height = `${r0.height}px`;
    const from = new Map([...grid.children].map((n) => [n, n.getBoundingClientRect()]));
    grid.insertBefore(ph, node);
    from.set(ph, r0);
    view.box.appendChild(node);                       // lifted off the grid while it moves
    Object.assign(node.style, { position: "fixed", left: `${r0.left}px`, top: `${r0.top}px`, width: `${r0.width}px`, height: `${r0.height}px`, margin: "0", zIndex: "70", pointerEvents: "none" });
    node.classList.add("hq-dragging");
    pack({ animate: true, from });
    const two = () => getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length > 1;
    const moveTo = (ev) => {
      node.style.left = `${ev.clientX - dx}px`;
      node.style.top = `${ev.clientY - dy}px`;
      const over = [...grid.children].find((n) => {
        if (!n.classList.contains("hq-card")) return false;
        const r = n.getBoundingClientRect();
        return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      });
      if (!over) return;
      const r = over.getBoundingClientRect();
      const before = two() ? ev.clientX < r.left + r.width / 2 : ev.clientY < r.top + r.height / 2;
      const ref = before ? over : over.nextSibling;
      if (ref !== ph && ph.nextSibling !== ref) { grid.insertBefore(ph, ref); pack({ animate: true }); }
    };
    const done = (cancel) => {
      window.removeEventListener("pointermove", moveTo);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", key, true);
      if (cancel === true) grid.insertBefore(ph, home && home.parentNode === grid ? home : null);
      const landing = new Map([...grid.children].map((n) => [n, n.getBoundingClientRect()]));
      landing.set(node, node.getBoundingClientRect());
      grid.insertBefore(node, ph);
      ph.remove();
      for (const k of ["position", "left", "top", "width", "height", "margin", "zIndex", "pointerEvents"]) node.style[k] = "";
      node.classList.remove("hq-dragging");
      pack({ animate: true, from: landing });
      const order = [...grid.querySelectorAll(".hq-card")].map((n) => n.dataset.key);
      const before = placed().map((c) => c.id);
      if (order.join() === before.join()) return;
      const rest = view.cards.filter((c) => !order.includes(c.id));      // unknown widgets keep their place at the end
      view.cards = [...order.map((k) => view.cards.find((c) => c.id === k)), ...rest];
      queueSave();
    };
    const up = () => done(false);
    const key = (ev) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); done(true); } };
    window.addEventListener("pointermove", moveTo);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", key, true);
  }

  // ----- heights: drag a card's bottom edge (snapped, the grid making room as it grows); a double-click is Auto ----
  function setH(c, h) { if (h) c.h = snapH(h); else delete c.h; }
  function resizeEdge(c) {
    const edge = el("button", { type: "button", class: "hq-resize", "aria-label": "Drag to Resize", title: "Drag to resize. Double-click for Auto." });
    const node = () => view.box.querySelector(`.hq-card[data-key="${c.id}"]`);
    const commit = (h) => change((cards) => { const x = cards.find((y) => y.id === c.id); if (x) setH(x, h); });
    edge.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const n = node();
      if (!n) return;
      const y0 = e.clientY, h0 = n.getBoundingClientRect().height;
      let h = h0;
      n.classList.add("hq-set-h", "hq-resizing");
      const move = (ev) => { h = snapH(h0 + ev.clientY - y0); n.style.height = `${h}px`; pack(); };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        n.classList.remove("hq-resizing");
        if (Math.abs(h - h0) >= H_STEP / 2) commit(h); else applyHeight(n, view.cards.find((x) => x.id === c.id) || c);
        pack();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    });
    edge.addEventListener("dblclick", () => commit(null));
    edge.addEventListener("keydown", (e) => {           // the keyboard's way: arrows step the height, Home is Auto
      const n = node(), cur = (view.cards.find((x) => x.id === c.id) || {}).h || (n ? n.getBoundingClientRect().height : 400);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); commit(cur + (e.key === "ArrowDown" ? H_STEP : -H_STEP)); }
      if (e.key === "Home") { e.preventDefault(); commit(null); }
    });
    return edge;
  }

  // ----- inline actions -------------------------------------------------------------------------------
  async function act(kind, who, button) {
    const s = view.season, id = encodeURIComponent(s.id);
    const call = kind === "board" ? H.api(`/api/season/${id}/board`, H.postJSON({ pid: who.pid, on: true }))
      : kind === "scout" ? H.api(`/api/season/${id}/recruit`, H.postJSON({ pid: who.pid, action: "scout" }))
      : Promise.reject(new Error(`unknown action ${kind}`));
    try { await ui().busy(button, call); }
    catch (e) {
      const t = H.errText ? H.errText(e) : String(e.message || e);
      ui().toast(t ? t.charAt(0).toUpperCase() + t.slice(1) : "That didn't work.", { kind: "error" });
      return false;
    }
    ui().toast(kind === "board" ? `Added ${who.name} to your board.` : `Your staff will take a look at ${who.name}.`);
    if (view) await refresh(ACT_SOURCES[kind]);
    return true;
  }
  // drop the named sources from the visit's cache and redraw, in place, every card that reads one of them
  async function refresh(names) {
    if (!view) return;
    for (const key of Object.keys(view.data)) {
      const name = key.startsWith("/api/") ? "hq" : key;          // the gap reads are cached by their URL
      if (names.includes(name)) delete view.data[key];
    }
    for (const node of view.box.querySelectorAll(".hq-grid > .hq-card")) {
      const c = view.cards.find((x) => x.id === node.dataset.key), w = c && registry.get(c.widget);
      if (w && w.sources.some((n) => names.includes(n))) fillCard(node, c, { morph: true });
    }
  }

  // ----- the drawer -----------------------------------------------------------------------------------
  function entryNode(w) {
    const soon = !ready(w);
    let size = w.size;
    const preview = el("div", { class: "hq-preview go-card", "aria-hidden": "true", "data-size": size });
    const drawPreview = () => preview.replaceChildren(drawSafe(w, w.sample || {}, ctxFor(w, size, true)));
    preview.__draw = drawPreview;
    const kids = [
      el("div", { class: "hq-entry-head" }, [el("h3", { class: "hq-entry-title", text: w.title }), soon ? el("span", { class: "go-tag", text: "Coming Soon" }) : null]),
      el("p", { class: "muted hq-blurb", text: w.blurb || "" }),
      preview,
    ];
    if (!soon) {
      const chips = w.sizes.length > 1 ? el("div", { class: "hq-sizes", role: "group", "aria-label": "Size" }, w.sizes.map((s) => {
        const b = el("button", { type: "button", class: "go-chip hq-size", "data-size": s, "aria-pressed": String(s === size), text: SIZE_NAMES[s] });
        ui().on(b, "click", () => {
          size = s;
          for (const x of b.parentNode.children) x.setAttribute("aria-pressed", String(x === b));
          preview.dataset.size = s;
          drawPreview();
        });
        return b;
      })) : null;
      const add = el("button", { type: "button", class: "go-btn primary hq-entry-add", text: "Add" });
      ui().on(add, "click", () => addWidget(w.id, size));
      kids.push(el("div", { class: "hq-entry-foot" }, [chips, add]));
    }
    return el("article", { class: `hq-entry${soon ? " soon" : ""}`, "data-widget": w.id, "data-key": w.id, "data-cat": w.category }, kids);
  }
  function syncDrawer() {
    const d = view && view.box.querySelector(".hq-drawer");
    if (!d) return;
    const on = new Set(view.cards.map((c) => c.widget));
    const q = view.q.trim().toLowerCase();
    for (const n of d.querySelectorAll(".hq-entry")) {
      const w = registry.get(n.dataset.widget);
      n.hidden = !((view.cat === "all" || w.category === view.cat) && (!q || `${w.title} ${w.blurb || ""}`.toLowerCase().includes(q)));
      const add = n.querySelector(".hq-entry-add");
      if (add) { const has = on.has(w.id); add.disabled = has; add.textContent = has ? "On Your Headquarters" : "Add"; add.classList.toggle("primary", !has); }
    }
    for (const b of d.querySelectorAll(".hq-cat")) b.setAttribute("aria-pressed", String(b.dataset.cat === view.cat));
    const shown = d.querySelectorAll(".hq-entry:not([hidden])").length;
    d.querySelector(".hq-none").hidden = shown > 0;
  }
  function drawerNode() {
    const order = (w) => [ready(w) ? 0 : 1, CATS.findIndex((c) => c[0] === w.category)];
    const list = [...registry.values()].sort((a, b) => { const x = order(a), y = order(b); return x[0] - y[0] || x[1] - y[1]; });
    const close = el("button", { type: "button", class: "go-btn hq-close", text: "Close" });
    ui().on(close, "click", () => openDrawer(false));
    const search = el("input", { type: "search", class: "hq-input hq-search", placeholder: "Search Widgets", "aria-label": "Search Widgets" });
    search.addEventListener("input", () => { view.q = search.value; syncDrawer(); });
    const cats = el("div", { class: "hq-cats", role: "group", "aria-label": "Category" }, CATS.map(([k, label]) => {
      const b = el("button", { type: "button", class: "go-chip hq-cat", "data-cat": k, "aria-pressed": String(k === view.cat), text: label });
      ui().on(b, "click", () => { view.cat = k; syncDrawer(); });
      return b;
    }));
    const entries = el("div", { class: "hq-entries" }, list.map(entryNode));
    const d = el("aside", { class: "hq-drawer", role: "dialog", "aria-label": "Add Widgets", hidden: "" }, [
      el("div", { class: "card-bar hq-drawer-bar" }, [el("h2", { class: "go-kicker", text: "Add Widgets" }), close]),
      el("div", { class: "hq-drawer-tools" }, [cats, search]),
      entries,
      el("p", { class: "muted hq-none", text: "No widgets match your search.", hidden: "" }),
    ]);
    // each preview draws the first time its entry scrolls into view
    const io = "IntersectionObserver" in window ? new IntersectionObserver((seen) => {
      for (const x of seen) if (x.isIntersecting) { const p = x.target.querySelector(".hq-preview"); if (p && p.__draw) { p.__draw(); p.__draw = null; } io.unobserve(x.target); }
    }, { root: entries }) : null;
    for (const n of entries.children) { if (io) io.observe(n); else n.querySelector(".hq-preview").__draw(); }
    d.addEventListener("keydown", (e) => { if (e.key === "Escape") openDrawer(false); });
    return d;
  }
  function openDrawer(on) {
    const d = view.box.querySelector(".hq-drawer");
    d.hidden = !on;
    view.box.classList.toggle("hq-drawer-open", on);
    if (on) { syncDrawer(); const f = d.querySelector(".hq-search"); if (f && window.matchMedia("(pointer: fine)").matches) f.focus(); }
    else { const b = view.box.querySelector(".hq-add-widget"); if (b) b.focus(); }
  }

  // ----- the page -------------------------------------------------------------------------------------
  function setEditing(on) {
    view.editing = on;
    view.box.classList.toggle("hq-editing", on);
    const b = view.box.querySelector(".hq-edit-toggle");
    b.textContent = on ? "Done" : "Edit Layout";
    b.setAttribute("aria-pressed", String(on));
  }
  async function render(season, box, helpers) {
    H = helpers;
    flushSave();
    if (watcher) watcher.disconnect();
    watcher = "ResizeObserver" in window ? new ResizeObserver(queuePack) : null;
    view = { season, box, cards: [], data: {}, editing: false, cat: "all", q: "" };
    const mine = view;
    box.classList.add("hq");
    box.classList.remove("hq-editing", "hq-drawer-open");
    box.replaceChildren(el("p", { class: "muted go-loading", text: "Opening Headquarters…" }));
    let saved;
    try { saved = await H.api(`/api/season/${encodeURIComponent(season.id)}/headquarters`); }
    catch (e) {
      if (view === mine) box.replaceChildren(el("p", { class: "muted", text: "Headquarters could not open. Try the tab again." }));
      return;
    }
    if (view !== mine) return;
    view.cards = ((saved.layout && saved.layout.cards) || []).map((c) => Object.assign({}, c));
    const add = el("button", { type: "button", class: "go-btn primary hq-add-widget", text: "Add Widget" });
    const edit = el("button", { type: "button", class: "go-btn hq-edit-toggle", "aria-pressed": "false", text: "Edit Layout" });
    ui().on(add, "click", () => openDrawer(true));
    ui().on(edit, "click", () => setEditing(!view.editing));
    const emptyAdd = el("button", { type: "button", class: "go-btn primary", text: "Add Widget" });
    ui().on(emptyAdd, "click", () => openDrawer(true));
    box.replaceChildren(
      el("header", { class: "hq-head" }, [
        el("div", { class: "hq-title" }, [el("h2", { class: "go-display", text: "Headquarters" }),
          el("p", { class: "muted", text: "Your recruiting and scouting at a glance." })]),
        el("div", { class: "hq-actions" }, [add, edit]),
      ]),
      el("div", { class: "go-card hq-empty", hidden: "" }, [el("p", { text: EMPTY_LINE }), emptyAdd]),
      el("div", { class: "hq-grid" }),
      drawerNode(),
    );
    if (watcher) watcher.observe(box.querySelector(".hq-grid"));
    drawGrid();
    if (!placed().length) openDrawer(true);
  }

  // ----- the kit: pieces every widget draws with ---------------------------------------------------------
  // a recruit's stars; a transfer has none, and gets nothing rather than five empty stars
  const stars = (n) => (n == null ? null : el("span", { class: "hq-stars", "aria-label": `${n} Stars`, text: "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n)) }));
  // a label in Title Case, small words lowercase inside it ("Behind, in the picture" -> "Behind, In the Picture")
  const SMALL = new Set(["a", "an", "the", "of", "to", "for", "and", "or", "in", "on", "at", "by"]);
  const title = (text) => String(text || "").split(" ").map((w, i, all) => {
    const bare = w.replace(/^[^A-Za-z]+/, "").toLowerCase();
    if (!bare || (SMALL.has(bare.replace(/[^a-z]/g, "")) && i > 0 && i < all.length - 1 && !/[,:]$/.test(all[i - 1]))) return w;
    return w.replace(/[A-Za-z]/, (c) => c.toUpperCase());
  }).join(" ");
  const kit = {
    el, stars, title,
    empty: (text) => el("p", { class: "hq-empty-line", text }),
    // [[value, label], ...] as big numbers
    stats: (pairs) => el("div", { class: "hq-stats" }, pairs.map(([v, k]) => el("div", { class: "hq-stat" }, [el("b", { text: String(v) }), el("span", { text: k })]))),
    // rows of [node or text, ...] as a list
    // rows: cells, or { key, cells } (a keyed row keeps its own node when the card is patched)
    list: (rows) => el("ul", { class: "hq-list" }, rows.map((r) => (Array.isArray(r) ? el("li", {}, r) : el("li", { "data-key": r.key }, r.cells)))),
    // a table: heads, rows of cells, and which row is yours
    table: (heads, rows, mine) => el("table", { class: "hq-table" }, [
      el("thead", {}, el("tr", {}, heads.map((h) => el("th", { text: h })))),
      el("tbody", {}, rows.map((r, i) => el("tr", { class: mine && mine(i) ? "mine" : null }, r.map((c) => el("td", {}, c == null ? "" : c))))),
    ]),
    // a labeled meter: the label, the value's words, a fill 0-1
    meter: (label, words, frac, tone) => el("div", { class: "go-meter hq-meter" }, [
      el("div", { class: "go-meter-top" }, [el("span", { text: label }), el("b", { text: words })]),
      el("div", { class: "go-meter-track" }, el("span", { class: `go-meter-fill${tone ? ` ${tone}` : ""}`, style: `width: ${Math.round(100 * Math.max(0, Math.min(1, frac || 0)))}%` })),
    ]),
    // a recruit's name that opens his profile
    name: (ctx, pid, text) => {
      const b = el("button", { type: "button", class: "go-link hq-grow", text });
      ui().on(b, "click", () => ctx.openProfile(pid));
      return b;
    },
    // a small line chart over points [[x label, y], ...]
    chart: (points) => {
      const ns = "http://www.w3.org/2000/svg", W = 300, Hh = 120, pad = 18;
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`);
      svg.setAttribute("class", "hq-chart");
      svg.setAttribute("role", "img");
      const ys = points.map((p) => p[1]), top = Math.max(1, ...ys);
      const x = (i) => pad + (points.length < 2 ? (W - 2 * pad) / 2 : (i * (W - 2 * pad)) / (points.length - 1));
      const y = (v) => Hh - pad - (v / top) * (Hh - 2 * pad);
      const mk = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); svg.appendChild(n); return n; };
      const line = points.map((p, i) => `${x(i)},${y(p[1])}`).join(" ");
      if (points.length) {
        mk("polygon", { class: "area", points: `${x(0)},${Hh - pad} ${line} ${x(points.length - 1)},${Hh - pad}` });
        mk("polyline", { class: "line", points: line });
        points.forEach((p, i) => mk("circle", { class: "dot", cx: x(i), cy: y(p[1]), r: 3.5 }));
        const step = Math.max(1, Math.ceil(points.length / 6));
        points.forEach((p, i) => { if (i % step === 0 || i === points.length - 1) mk("text", { x: x(i), y: Hh - 3, "text-anchor": "middle" }).textContent = p[0]; });
      }
      return svg;
    },
    // how many rows a list shows at a size
    // how many rows a list holds at a size (the card's body scrolls, so these are generous)
    rowsFor: (size) => ({ S: 20, M: 30, L: 50 }[size] || 20),
  };

  window.HQ = {
    register, render, kit,
    widgets: () => [...registry.values()],
    saving: () => !!timer || pending > 0,
  };
})();
