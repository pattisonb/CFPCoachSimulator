/* The Custom Programs page (docs/superpowers/specs/2026-11-11-custom-programs-design.md): create a program or edit a
   real one, saved in this browser as you type (programs-lib.js), checked by the game's own league check, downloaded
   or loaded as a league file. The list and the editor patch in place; nothing redraws while you type. */
(function () {
  "use strict";
  const { $, el } = window.CFP;
  const P = window.CFP.programs;
  const ui = () => window.CFP.ui;
  const STATES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" ");
  let list = P.load(), real = {}, conferences = [], open = null, saveTimer = null, playbooks = { offense: [], defense: [] };
  const toast = (t, ms) => (ui() && ui().toast ? ui().toast(t, ms || 3500) : null);
  const byId = (id) => list.find((p) => p.id === id);

  async function api(path, opts) {
    const res = await window.CFP.game.fetch(path, opts);
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  }
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (!P.save(list)) $("#pg-store-note").hidden = false; }, 250);
  }

  // ----- the pill: the game's split square in the program's colors -----
  function pill(f) {
    const a = f.primary || "#5a6275", b = f.secondary || "#c9ced8", c = f.accent || a;
    return el("span", { class: "pg-pill", "aria-hidden": "true", style: `background:linear-gradient(135deg, ${a} 50%, ${b} 50%);border-color:${c}` });
  }
  const label = (p) => (p.f && p.f.name) || (p.kind === "edit" ? (real[p.base] || {}).short_name : "") || "Untitled Program";
  const confName = (id) => (conferences.find((c) => c.id === id) || {}).name || id || "";

  // ----- the list -----
  function card(p) {
    const f = p.f || {};
    const where = f.conference === "__new" ? (f.new_conf_name || "a new conference") : confName(f.conference);
    return el("div", { class: `pg-card${open === p.id ? " on" : ""}`, "data-id": p.id }, [
      pill(f),
      el("div", { class: "pg-card-text" }, [el("b", { text: label(p) }),
        el("span", { class: "muted small", text: [p.kind === "edit" ? `Edits ${(real[p.base] || {}).short_name || p.base}` : "New Program", where].filter(Boolean).join(" · ") })]),
      el("div", { class: "pg-card-acts" }, [
        el("button", { type: "button", class: "ghost small", text: "Edit", onclick: () => edit(p.id) }),
        el("button", { type: "button", class: "ghost small", text: "Download", onclick: () => download([p], `${P.slugOf(label(p), new Set())}.json`) }),
        el("button", { type: "button", class: "ghost small", text: "Delete", onclick: () => remove(p.id) })])]);
  }
  function drawList() {
    const box = $("#pg-list");
    const kids = list.length ? list.map(card) : [el("p", { class: "muted", text: "No custom programs yet. Create one, or edit a real program." })];
    if (ui() && ui().morph) ui().morph(box, el("div", {}, kids)); else box.replaceChildren(...kids);
  }
  function remove(id) {
    const p = byId(id);
    if (!p || !confirm(`Delete ${label(p)}?`)) return;
    list = list.filter((x) => x.id !== id);
    persist();
    if (open === id) { open = null; $("#pg-editor").hidden = true; }
    drawList();
  }

  // ----- the editor -----
  const field = (lab, input, hint) => el("label", { class: "pg-field" }, [el("span", { class: "pg-label", text: lab }), input, hint ? el("span", { class: "muted small", text: hint }) : null]);
  function input(p, key, attrs) {
    const f = p.f;
    const { tag, ...rest } = attrs || {};
    const node = el(tag === "textarea" ? "textarea" : "input", rest);
    node.value = f[key] == null ? "" : String(f[key]);
    node.addEventListener("input", () => { f[key] = node.value; p.updated = Date.now(); changed(p, key); });
    return node;
  }
  function select(p, key, options, attrs) {
    const node = el("select", attrs || {}, options.map(([v, t]) => el("option", { value: v, text: t })));
    node.value = p.f[key] == null ? "" : String(p.f[key]);
    node.addEventListener("change", () => { p.f[key] = node.value; p.updated = Date.now(); changed(p, key); });
    return node;
  }
  // rivals: a multi-pick of the game's FBS teams (stored as slugs)
  function rivalsPick(p) {
    const own = p.kind === "edit" ? p.base : null;
    const node = el("select", { multiple: "", size: "6", class: "pg-rivals", "aria-label": "Rivals" },
      Object.values(real).filter((t) => (t.level || "FBS") === "FBS" && t.slug !== own).map((t) => el("option", { value: t.slug, text: t.short_name || t.name })));
    const picked = new Set(p.f.rivals || []);
    for (const o of node.options) o.selected = picked.has(o.value);
    node.addEventListener("change", () => { p.f.rivals = [...node.selectedOptions].map((o) => o.value); p.updated = Date.now(); changed(p, "rivals"); });
    return node;
  }
  function changed(p, key) {
    persist();
    const ed = $("#pg-editor");
    if (["primary", "secondary", "accent", "name"].includes(key)) {
      const old = ed.querySelector(".pg-head .pg-pill");
      if (old) old.replaceWith(pill(p.f));
      const h = ed.querySelector(".pg-head b");
      if (h) h.textContent = label(p);
    }
    if (key === "conference") ed.querySelector(".pg-newconf").hidden = p.f.conference !== "__new";
    ed.querySelector(".pg-check-out").replaceChildren();
    drawList();
  }
  function edit(id) {
    open = id;
    const p = byId(id);
    const f = p.f;
    const ed = $("#pg-editor");
    const confOpts = [["", "Pick a Conference"], ...conferences.map((c) => [c.id, c.name]), ["__new", "New Conference…"]];
    const out = el("div", { class: "pg-check-out", "aria-live": "polite" });
    const check = el("button", { type: "button", class: "accent", text: "Check Program" });
    check.addEventListener("click", async () => {
      const body = new TextEncoder().encode(JSON.stringify(P.doc([p], real, label(p))));
      let r;
      try { r = await ui().busy(check, api("/api/league/check", { method: "POST", headers: { "Content-Type": "application/json" }, body })); }
      catch (err) { out.replaceChildren(el("p", { class: "pg-bad", text: "The game couldn't check it. Try again in a moment." })); return; }
      out.replaceChildren(...(r.ok ? [el("p", { class: "pg-good", text: "Ready to use. Tick it on the New Career screen." })]
        : (r.errors || []).map((e) => el("p", { class: "pg-bad", text: e }))));
    });
    const newConf = el("div", { class: "pg-row pg-newconf" }, [
      field("Conference Name", input(p, "new_conf_name", { type: "text", maxlength: "60" })),
      field("Conference Games", select(p, "new_conf_games", [["8", "8"], ["9", "9"]]))]);
    newConf.hidden = f.conference !== "__new";
    ed.replaceChildren(
      el("div", { class: "card-bar section-head pg-head" }, [el("span", { class: "pg-head-who" }, [pill(f), el("b", { text: label(p) })]),
        el("button", { type: "button", class: "ghost small", text: "Close", onclick: () => { open = null; ed.hidden = true; drawList(); } })]),
      el("h3", { class: "pg-sec", text: "Identity" }),
      el("div", { class: "pg-row" }, [field("Name", input(p, "name", { type: "text", maxlength: "60", placeholder: "Alder Tech" })),
        field("Short Name", input(p, "short_name", { type: "text", maxlength: "30" })),
        field("Abbreviation", input(p, "abbreviation", { type: "text", maxlength: "4" })),
        field("Mascot", input(p, "mascot", { type: "text", maxlength: "30" }))]),
      el("div", { class: "pg-row" }, [field("Primary Color", input(p, "primary", { type: "color" })),
        field("Secondary Color", input(p, "secondary", { type: "color" })),
        field("Accent Color", input(p, "accent", { type: "color" }))]),
      el("h3", { class: "pg-sec", text: "Home" }),
      el("div", { class: "pg-row" }, [field("City", input(p, "city", { type: "text", maxlength: "40" })),
        field("State", select(p, "state", [["", "Pick a State"], ...STATES.map((s) => [s, s])]))]),
      el("h3", { class: "pg-sec", text: "Program" }),
      el("div", { class: "pg-row" }, [field("Conference", select(p, "conference", confOpts)),
        field("Strength", select(p, "strength", [["", "Conference Average"], ...P.STRENGTHS.map((s) => [s, s])])),
        field("Prestige", input(p, "prestige", { type: "number", min: "0", max: "100", placeholder: "Conference average" }), "0 to 100")]),
      newConf,
      el("h3", { class: "pg-sec", text: "Coaches" }),
      el("div", { class: "pg-row" }, [field("Head Coach", input(p, "coach", { type: "text", maxlength: "40", placeholder: "Generated if blank" })),
        field("Offensive Coordinator", input(p, "oc", { type: "text", maxlength: "40", placeholder: "Generated if blank" })),
        field("Defensive Coordinator", input(p, "dc", { type: "text", maxlength: "40", placeholder: "Generated if blank" }))]),
      el("div", { class: "pg-row" }, [field("Offense", select(p, "offense", [["", "Conference's Usual"], ...playbooks.offense.map((x) => [x, x])])),
        field("Defense", select(p, "defense", [["", "Conference's Usual"], ...playbooks.defense.map((x) => [x, x])]))]),
      el("h3", { class: "pg-sec", text: "Rivals" }),
      field("Rivals", rivalsPick(p), "Pick any teams; each rivalry is scheduled every year. Ctrl or Cmd-click to pick more than one."),
      el("h3", { class: "pg-sec", text: "Roster" }),
      field("Players", input(p, "roster", { tag: "textarea", rows: "8", placeholder: "Jay Smith, QB, JR\nMax Lee, WR, SO, 74" }),
        "One a line: Name, Position, Class (and an overall if you like). Leave it empty and the game fills 85 players to your strength; players you list are kept and the rest are filled in."),
      el("div", { class: "pg-row pg-check" }, [check]),
      out);
    ed.hidden = false;
    drawList();
    ed.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function create(kind, base) {
    const r = base ? real[base] : null;
    const c = (r && r.colors) || {};
    const f = r ? { name: r.name, short_name: r.short_name, abbreviation: r.abbreviation, mascot: r.mascot, city: r.city, state: r.state,
      conference: r.conference, primary: (c.primary || {}).hex, secondary: (c.secondary || {}).hex, accent: (c.accent || {}).hex, prestige: r.prestige,
      offense: r.offense, defense: r.defense, rivals: [...(r.rivals || [])] }
      : { conference: "", primary: "#1f4e79", secondary: "#ffffff", accent: "#111111", new_conf_games: "8" };
    if (kind === "edit" && list.some((p) => p.kind === "edit" && p.base === base)) { toast(`You already have an edit of ${r.short_name}.`); return; }
    const p = { id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind, base: base || null, f, updated: Date.now() };
    list.unshift(p);
    persist();
    edit(p.id);
  }

  // ----- files -----
  function download(progs, name) {
    const blob = new Blob([JSON.stringify(P.doc(progs, real), null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: name || "custom-programs.json", hidden: "" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function loadFile(file) {
    let d;
    try { d = JSON.parse(await file.text()); } catch (e) { toast("That file isn't JSON."); return; }
    if (!d || d.format !== "cfp-league/1" || !Array.isArray(d.teams)) { toast("That file isn't a league file: its format is not cfp-league/1."); return; }
    const confs = Object.fromEntries((d.conferences || []).map((c) => [c.id, c]));
    let n = 0;
    for (const t of d.teams) {
      const isReal = !!real[t.slug];
      const c = t.colors || {};
      const nc = confs[t.conference];
      const f = { name: t.name, short_name: t.short_name, abbreviation: t.abbreviation, mascot: t.mascot, city: t.city, state: t.state,
        conference: nc ? "__new" : t.conference, new_conf_name: nc ? nc.name : undefined, new_conf_games: nc ? String(nc.games || 8) : undefined,
        primary: (c.primary || {}).hex, secondary: (c.secondary || {}).hex, accent: (c.accent || {}).hex,
        strength: t.strength == null ? "" : String(t.strength), prestige: t.prestige, coach: ((t.coaches || {}).head || {}).name,
        oc: ((t.coaches || {}).oc || {}).name, dc: ((t.coaches || {}).dc || {}).name, offense: (t.coaches || {}).offense, defense: (t.coaches || {}).defense,
        rivals: Array.isArray(t.rivals) ? [...t.rivals] : undefined,
        roster: (t.roster || []).map((r) => [r.name, r.pos, r.class, r.overall].filter((x) => x != null && x !== "").join(", ")).join("\n") };
      if (isReal) {
        const r = real[t.slug], rc = r.colors || {};
        for (const [k, v] of [["name", r.name], ["short_name", r.short_name], ["abbreviation", r.abbreviation], ["mascot", r.mascot], ["city", r.city], ["state", r.state], ["conference", r.conference], ["prestige", r.prestige]])
          if (f[k] == null) f[k] = v;
        for (const k of ["primary", "secondary", "accent"]) if (!f[k]) f[k] = (rc[k] || {}).hex;
      }
      list.unshift({ id: `p${Date.now().toString(36)}${n}${Math.random().toString(36).slice(2, 5)}`, kind: isReal ? "edit" : "new", base: isReal ? t.slug : null, f, updated: Date.now() });
      n++;
    }
    persist();
    drawList();
    toast(`Loaded ${n} program${n === 1 ? "" : "s"}.`);
  }

  // ----- wiring -----
  async function mount() {
    try { localStorage.setItem("cfp-probe", "1"); localStorage.removeItem("cfp-probe"); } catch (e) { $("#pg-store-note").hidden = false; }
    drawList();
    $("#pg-new").addEventListener("click", () => create("new"));
    $("#pg-real").addEventListener("change", (e) => { const v = e.currentTarget.value; e.currentTarget.value = ""; if (v) create("edit", v); });
    $("#pg-download-all").addEventListener("click", () => (list.length ? download(list, "custom-programs.json") : toast("Nothing to download yet.")));
    $("#pg-load").addEventListener("click", () => $("#pg-file").click());
    $("#pg-file").addEventListener("change", (e) => { const file = e.currentTarget.files[0]; e.currentTarget.value = ""; if (file) loadFile(file); });
    try {
      await window.CFP.game.ready;
      const d = await api("/api/league/programs");
      real = Object.fromEntries(d.teams.map((t) => [t.slug, t]));
      conferences = d.conferences.filter((c) => (c.level || "FBS") === "FBS");
      playbooks = { offense: [...new Set(d.teams.map((t) => t.offense).filter(Boolean))].sort(), defense: [...new Set(d.teams.map((t) => t.defense).filter(Boolean))].sort() };
      const sel = $("#pg-real");
      sel.append(...d.teams.filter((t) => (t.level || "FBS") === "FBS").map((t) => el("option", { value: t.slug, text: t.short_name || t.name })));
      drawList();
    } catch (err) { toast("The game's programs didn't load. Reload the page to try again.", 6000); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
