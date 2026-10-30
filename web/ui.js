/* Shared UI helpers for every page: the toast stack, the change pulse, fades, keyed lists, a busy
   state for the control that acted, and an in-place patch (morph) so an action updates the screen
   instead of rebuilding it. window.CFP.ui = { toast, pulse, fadeIn, fadeOut, reconcile, busy, on, morph }.
   Motion honors prefers-reduced-motion. Loaded after gameview.js (which makes window.CFP). */
(function () {
  "use strict";
  const CFP = (window.CFP = window.CFP || {});
  const PULSE_MS = 600, FADE_MS = 150, MAX_TOASTS = 3;
  const mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const still = () => !!(mq && mq.matches);

  // ----- the toast stack -----------------------------------------------------------------------
  // #toasts: bottom-left, newest on top, three at most, a polite status region. #toast is a hidden
  // mirror of the latest toast (its text and hidden state) for the scripts and tests that read it;
  // a script that writes #toast itself (the storage warning in the page) still shows a toast.
  let stack = null, mirror = null;
  const mirrored = { text: "", hidden: true };
  function setMirror(text, hidden) {
    if (!mirror) return;
    mirrored.text = text; mirrored.hidden = hidden;
    if (mirror.textContent !== text) mirror.textContent = text;
    if (mirror.hidden !== hidden) mirror.hidden = hidden;
  }
  function syncMirror() {
    const live = stack ? [...stack.children].filter((t) => !t.__leaving) : [];
    if (live.length) setMirror(live[0].textContent, false);
    else setMirror(mirrored.text, true);
  }
  function mount() {
    if (stack || !document.body) return;
    stack = document.getElementById("toasts");
    if (!stack) {
      stack = document.createElement("div");
      stack.id = "toasts";
      stack.className = "toasts";
      document.body.append(stack);
    }
    stack.setAttribute("role", "status");
    stack.setAttribute("aria-live", "polite");
    mirror = document.getElementById("toast");
    if (!mirror) {
      mirror = document.createElement("div");
      mirror.id = "toast";
      mirror.hidden = true;
      document.body.append(mirror);
    }
    mirror.className = "toast-mirror";
    mirror.setAttribute("aria-hidden", "true");
    // a write to #toast from outside (not ours): show it, or take it down
    new MutationObserver(() => {
      const text = mirror.textContent, hidden = mirror.hidden;
      if (text === mirrored.text && hidden === mirrored.hidden) return;
      if (!hidden && text) toast(text, { ms: 6000, kind: "error" });
      else if (hidden) {
        for (const t of [...stack.children]) if (t.textContent === text) dismiss(t);
        setMirror(text, true);
      }
    }).observe(mirror, { attributes: true, childList: true, characterData: true, subtree: true });
  }
  function dismiss(node) {
    if (!node || node.__leaving) return;
    clearTimeout(node.__timer);
    fadeOut(node).then(syncMirror);
    syncMirror();
  }
  // toast(text, {ms = 3500, kind = "info" | "error"}): ms 0 keeps it up until dismissed or pushed out
  function toast(text, opts) {
    const o = typeof opts === "number" ? { ms: opts } : (opts || {});
    const ms = o.ms == null ? 3500 : o.ms;
    mount();
    const node = document.createElement("div");
    node.className = `toast-item ${o.kind === "error" ? "error" : ""}`;
    node.textContent = String(text);
    node.addEventListener("click", () => dismiss(node));
    node.dismiss = () => dismiss(node);
    if (!stack) return node;
    stack.prepend(node);
    fadeIn(node);
    const live = [...stack.children].filter((t) => !t.__leaving);
    for (const old of live.slice(MAX_TOASTS)) dismiss(old);
    if (ms > 0) node.__timer = setTimeout(() => dismiss(node), ms);
    syncMirror();
    return node;
  }

  // ----- motion ------------------------------------------------------------------------------------
  function pulse(el) {
    if (!el || el.nodeType !== 1 || still()) return;
    clearTimeout(el.__pulse);
    el.classList.remove("go-changed");
    void el.offsetWidth;                                // restart the pulse if it is running
    el.classList.add("go-changed");
    el.__pulse = setTimeout(() => el.classList.remove("go-changed"), PULSE_MS);
  }
  function fadeIn(el) {
    if (!el || el.nodeType !== 1 || still()) return el;
    el.classList.add("go-fade-in");
    setTimeout(() => el.classList.remove("go-fade-in"), FADE_MS + 30);
    return el;
  }
  function fadeOut(el) {
    if (!el || !el.parentNode) return Promise.resolve();
    if (el.__leaving) return el.__leaving;
    if (el.nodeType !== 1 || still()) { el.remove(); return Promise.resolve(); }
    el.classList.add("go-leaving");
    el.__leaving = new Promise((done) => setTimeout(() => { el.remove(); done(); }, FADE_MS));
    return el.__leaving;
  }

  // ----- keyed lists -------------------------------------------------------------------------------
  // reconcile(container, rows, key, draw, patch): children keyed by data-key; an existing node is
  // patched (patch(node, row)), a new one drawn (draw(row)) and faded in, the order follows rows,
  // and a node whose key is gone fades out. key is a function of the row or a property name.
  function place(container, nodes) {
    let prev = null;
    for (const n of nodes) {
      let want = prev ? prev.nextSibling : container.firstChild;
      while (want && want.__leaving) want = want.nextSibling;
      if (want !== n) container.insertBefore(n, want);
      prev = n;
    }
  }
  function reconcile(container, rows, key, draw, patch) {
    const keyOf = typeof key === "function" ? key : (r) => r[key];
    const have = new Map();
    for (const c of container.children) if (c.dataset.key != null && !c.__leaving) have.set(c.dataset.key, c);
    const out = [];
    for (const row of rows) {
      const k = String(keyOf(row));
      let n = have.get(k);
      if (n) { have.delete(k); if (patch) patch(n, row); }
      else { n = draw(row); n.dataset.key = k; n.__fresh = true; }
      out.push(n);
    }
    for (const n of have.values()) fadeOut(n);
    place(container, out);
    for (const n of out) if (n.__fresh) { delete n.__fresh; fadeIn(n); }
    return out;
  }

  // ----- the acting control ----------------------------------------------------------------------
  const FOCUSABLE = "button:not([disabled]), select:not([disabled]), input:not([disabled]):not([type=hidden]), textarea:not([disabled]), a[href]";
  const visible = (n) => !!(n && n.isConnected && !n.disabled && n.getClientRects().length && !n.closest(".go-leaving"));
  function focusNear(button, chain) {
    if (visible(button)) { button.focus({ preventScroll: true }); return; }
    // the control went away or is off now: the nearest live control around where it was (its
    // ancestors at the click, the closest one still on the page first)
    let at = chain.find((n) => n.isConnected && !n.closest(".go-leaving"));
    for (; at && at !== document.documentElement; at = at.parentElement) {
      const n = [...at.querySelectorAll(FOCUSABLE)].find(visible);
      if (n) { n.focus({ preventScroll: true }); return; }
    }
  }
  // busy(button, promise): the button is disabled and marked .go-busy until the promise settles,
  // then restored (to what a patch made of it meanwhile) and focused again. Returns the promise.
  function busy(button, promise) {
    if (!button) return promise;
    const was = button.disabled;
    const chain = [];
    for (let n = button.parentElement; n && n !== document.body; n = n.parentElement) chain.push(n);
    button.__busyWant = was;
    button.classList.add("go-busy");
    button.setAttribute("aria-busy", "true");
    button.disabled = true;
    const done = () => {
      button.classList.remove("go-busy");
      button.removeAttribute("aria-busy");
      button.disabled = !!button.__busyWant;
      delete button.__busyWant;
      const now = document.activeElement;
      if (!now || now === document.body || now === button || !now.isConnected) focusNear(button, chain);
    };
    return Promise.resolve(promise).then((v) => { done(); return v; }, (e) => { done(); throw e; });
  }

  // ----- handlers a patch can update -------------------------------------------------------------
  // on(node, type, fn): one listener per type that calls the node's current handler, so morph can
  // hand an old node the new closure (the event's currentTarget is the live node).
  function on(node, type, fn) {
    node.__on = node.__on || {};
    if (!node.__on[type]) node.addEventListener(type, (e) => { const f = node.__on[type]; if (f) return f(e); });
    node.__on[type] = fn;
    return node;
  }

  // ----- morph: patch a live tree to match a freshly drawn one -----------------------------------
  // Nodes are matched by data-key among siblings where they carry one, otherwise in order; a node
  // of another tag is replaced. Text, attributes, form values (unless the player is typing in it)
  // and on() handlers move to the live node. Children of an element marked data-keep stay as they
  // are. Changed elements pulse, new ones fade in. Returns the changed elements.
  const VALUE_TAGS = { INPUT: 1, SELECT: 1, TEXTAREA: 1 };
  const TRANSIENT = ["go-changed", "go-fade-in", "go-leaving"];
  function morph(live, fresh) {
    const changed = new Set(), born = [];
    morphChildren(live, fresh, changed, born);
    for (const n of born) fadeIn(n);
    for (const n of changed) if (n.isConnected && !born.includes(n)) pulse(n);
    return [...changed];
  }
  function keyOfNode(n) { return n.nodeType === 1 ? n.getAttribute("data-key") || null : null; }
  function same(a, b) { return a.nodeType === b.nodeType && a.nodeName === b.nodeName; }
  function morphChildren(a, b, changed, born) {
    const oldKids = [...a.childNodes].filter((n) => !n.__leaving), newKids = [...b.childNodes];
    const byKey = new Map();
    for (const o of oldKids) { const k = keyOfNode(o); if (k && !byKey.has(k)) byKey.set(k, o); }
    const loose = oldKids.filter((o) => !keyOfNode(o) || byKey.get(keyOfNode(o)) !== o);
    const used = new Set(), out = [];
    let li = 0;
    for (const n of newKids) {
      const k = keyOfNode(n);
      let o = k ? byKey.get(k) : loose[li++];
      if (o && used.has(o)) o = null;
      if (o && same(o, n)) { used.add(o); morphNode(o, n, changed, born); out.push(o); }
      else { out.push(n); if (n.nodeType === 1) born.push(n); else if (n.nodeType === 3 && n.data.trim()) changed.add(a); }
    }
    for (const o of oldKids) if (!used.has(o)) {
      if (o.nodeType === 1 && keyOfNode(o)) fadeOut(o);
      else { if (o.nodeType === 3 && o.data.trim()) changed.add(a); o.remove(); }
    }
    place(a, out);
  }
  function morphNode(a, b, changed, born) {
    if (a.nodeType === 3 || a.nodeType === 8) {
      if (a.data !== b.data) { a.data = b.data; if (a.parentElement) changed.add(a.parentElement); }
      return;
    }
    const isBusy = a.classList.contains("go-busy");
    let attrChanged = false;
    for (const { name, value } of [...b.attributes]) {
      if (isBusy && (name === "disabled" || name === "aria-busy")) continue;
      if (isBusy && name === "class") {
        const want = `${value} go-busy`.trim();
        if (a.getAttribute("class") !== want) { a.setAttribute("class", want); attrChanged = true; }
        continue;
      }
      if (name === "class") {
        const cur = a.className.split(/\s+/).filter((c) => c && !TRANSIENT.includes(c)), nxt = value.split(/\s+/).filter(Boolean);
        if (cur.join(" ") !== nxt.join(" ")) { a.setAttribute("class", [...nxt, ...TRANSIENT.filter((c) => a.classList.contains(c))].join(" ")); attrChanged = true; }
        continue;
      }
      if (a.getAttribute(name) !== value) {
        a.setAttribute(name, value);
        attrChanged = true;
        if (name === "value" && VALUE_TAGS[a.tagName] && document.activeElement !== a) a.value = b.value;
      }
    }
    for (const { name } of [...a.attributes]) {
      if (b.hasAttribute(name)) continue;
      if (name === "class" && isBusy) continue;
      if (isBusy && (name === "disabled" || name === "aria-busy")) continue;
      a.removeAttribute(name); attrChanged = true;
    }
    if (isBusy) a.__busyWant = b.hasAttribute("disabled") || !!b.disabled;
    if (b.__on) for (const [t, f] of Object.entries(b.__on)) on(a, t, f);
    if (a.__on) for (const t of Object.keys(a.__on)) if (!b.__on || !b.__on[t]) a.__on[t] = null;
    if (attrChanged && a.tagName !== "TR" && a.tagName !== "TABLE") changed.add(a);
    if (a.hasAttribute("data-keep")) return;
    morphChildren(a, b, changed, born);
    if (a.tagName === "SELECT" && a.value !== b.value && document.activeElement !== a) a.value = b.value;
    if (a.tagName === "INPUT" && (a.type === "checkbox" || a.type === "radio") && a.checked !== b.checked) a.checked = b.checked;
  }

  CFP.ui = { toast, pulse, fadeIn, fadeOut, reconcile, busy, on, morph };
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
