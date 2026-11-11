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
  // a field: a <label> around a single control; a group of controls (the rival picker) gets a <div>, since a label sends
  // every click inside it to its first input (the blinking cursor jumping into the search box)
  const field = (lab, input, hint, key) => el(["INPUT", "SELECT", "TEXTAREA"].includes(input.tagName) ? "label" : "div", { class: "pg-field", ...(key ? { "data-key": key } : {}) },
    [el("span", { class: "pg-label", text: lab }), input, hint ? el("span", { class: "muted small", text: hint }) : null]);
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
  // the roster: add players one at a time (name, position, class, an optional overall) or paste a list; both edit the same
  // lines (p.f.roster, "Name, POS, CLASS[, overall]"), and the list under them shows each player with an x to drop him
  const CLASSES = ["FR", "SO", "JR", "SR", "FRRS", "SORS", "JRRS", "SRRS"];
  const CLASS_WORD = { FRRS: "RS FR", SORS: "RS SO", JRRS: "RS JR", SRRS: "RS SR" };
  function rosterEditor(p) {
    const text = input(p, "roster", { tag: "textarea", rows: "6", placeholder: "Jay Smith, QB, JR\nMax Lee, WR, SO, 74" });
    const listBox = el("div", { class: "pg-players", "aria-live": "polite" });
    const draw = () => {
      const rows = P.roster(p.f.roster);
      listBox.replaceChildren(...(rows.length ? rows.map((r, i) => el("div", { class: `pg-player${r.name && P.POS.has(r.pos) && P.CLASSES.has(r.class) ? "" : " bad"}` }, [
        el("b", { text: r.name || "No Name" }),
        el("span", { class: "muted small", text: [r.pos, CLASS_WORD[r.class] || r.class, r.overall != null ? `${r.overall} OVR` : null].filter(Boolean).join(" · ") }),
        el("button", { type: "button", class: "ghost small pg-player-x", "aria-label": `Remove ${r.name || "player"}`, text: "×", onclick: () => {
          const lines = String(p.f.roster || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
          lines.splice(i, 1);
          setText(lines.join("\n"));
        } })])) : [el("p", { class: "muted small", text: "No players yet: the game fills 85 to your strength." })]));
    };
    const setText = (v) => { p.f.roster = v; text.value = v; p.updated = Date.now(); changed(p, "roster"); draw(); };
    text.addEventListener("input", draw);       // (changed() runs too: the problems update as you type)
    const name = el("input", { type: "text", name: "pname", maxlength: "40", placeholder: "Player name", "aria-label": "Player name" });
    const pos = el("select", { name: "ppos", "aria-label": "Position" }, [...P.POS].map((x) => el("option", { value: x, text: x })));
    const cls = el("select", { name: "pcls", "aria-label": "Class" }, CLASSES.map((x) => el("option", { value: x, text: CLASS_WORD[x] || x })));
    const ovr = el("input", { type: "number", name: "povr", min: "40", max: "99", placeholder: "OVR (optional)", "aria-label": "Overall (optional)" });
    const add = el("button", { type: "button", class: "ghost", text: "Add Player" });
    const doAdd = () => {
      const n = name.value.trim();
      if (!n) { name.focus(); toast("Give the player a name first."); return; }
      const line = [n.replace(/,/g, " "), pos.value, cls.value, ovr.value ? String(Math.round(Number(ovr.value))) : null].filter(Boolean).join(", ");
      setText([String(p.f.roster || "").trim(), line].filter(Boolean).join("\n"));
      name.value = ""; ovr.value = "";
      name.focus();
    };
    add.addEventListener("click", doAdd);
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doAdd(); } });
    draw();
    return el("div", { class: "pg-roster" }, [
      el("div", { class: "pg-row pg-add" }, [name, pos, cls, ovr, add]),
      listBox,
      field("Or Paste a List", text, "One a line: Name, Position, Class (and an overall if you like). Leave the roster empty and the game fills 85 players to your strength; players you list are kept and the rest are filled in.", "roster")]);
  }

  // rivals: a multi-pick of the game's FBS teams (stored as slugs)
  // rivals: search a team, pick it (a chip with a field for the rivalry's name and an x), up to P.MAX_RIVALS
  function rivalsPick(p) {
    const own = p.kind === "edit" ? p.base : null;
    const pool = () => Object.values(real).filter((t) => (t.level || "FBS") === "FBS" && t.slug !== own && !(p.f.rivals || []).includes(t.slug));
    const chips = el("div", { class: "pg-rival-chips" });
    const search = el("input", { type: "search", class: "pg-rival-search", placeholder: "Search a team to add as a rival", "aria-label": "Search a rival" });
    const hits = el("div", { class: "pg-rival-hits", role: "listbox" });
    const count = el("span", { class: "muted small pg-rival-count" });
    const save = () => { p.updated = Date.now(); changed(p, "rivals"); draw(); };
    function draw() {
      const rv = p.f.rivals || [];
      p.f.rivalry_names = p.f.rivalry_names || {};
      chips.replaceChildren(...rv.map((slug) => {
        const t = real[slug] || {};
        const nm = el("input", { type: "text", maxlength: "60", class: "pg-rival-name", placeholder: "Rivalry name (optional)", "aria-label": `Rivalry name with ${t.short_name || slug}` });
        nm.value = p.f.rivalry_names[slug] || "";
        nm.addEventListener("input", () => { p.f.rivalry_names[slug] = nm.value; p.updated = Date.now(); persist(); });
        p.f.rivalry_often = p.f.rivalry_often || {};
        const weekTaken = rv.some((x) => x !== slug && p.f.rivalry_often[x] === "week");
        const how = el("select", { class: "pg-rival-often", "aria-label": `How often you play ${t.short_name || slug}` }, [
          el("option", { value: "year", text: "Every Year" }),
          el("option", { value: "week", text: "Every Year, Rivalry Week", ...(weekTaken ? { disabled: "" } : {}) }),
          el("option", { value: "some", text: "Sometimes" })]);
        how.value = p.f.rivalry_often[slug] || "year";
        how.title = "Every Year reserves a week each season; Rivalry Week plays it in the season's rivalry week (one rival only); Sometimes keeps the name and the series but plays only when the schedule pairs you";
        how.addEventListener("change", () => { p.f.rivalry_often[slug] = how.value; save(); });
        return el("div", { class: "pg-rival", "data-slug": slug }, [
          el("b", { text: t.short_name || t.name || slug }), nm, how,
          el("button", { type: "button", class: "ghost small pg-rival-x", "aria-label": `Remove ${t.short_name || slug}`, text: "×", onclick: () => {
            p.f.rivals = rv.filter((x) => x !== slug);
            delete p.f.rivalry_names[slug];
            if (p.f.rivalry_often) delete p.f.rivalry_often[slug];
            save();
          } })]);
      }));
      const full = rv.length >= P.MAX_RIVALS;
      search.disabled = full;
      search.placeholder = full ? `${P.MAX_RIVALS} rivals is the most a schedule always fits` : "Search a team to add as a rival";
      count.textContent = `${rv.length} of ${P.MAX_RIVALS}`;
      showHits();
    }
    function showHits() {
      const q = search.value.trim().toLowerCase();
      if (!q) { hits.replaceChildren(); return; }
      hits.replaceChildren(...pool().filter((t) => `${t.short_name} ${t.name} ${t.abbreviation}`.toLowerCase().includes(q)).slice(0, 8).map((t) =>
        el("button", { type: "button", class: "ghost small pg-rival-hit", "data-slug": t.slug, role: "option", text: t.short_name || t.name, onclick: () => {
          p.f.rivals = [...(p.f.rivals || []), t.slug].slice(0, P.MAX_RIVALS);
          search.value = "";
          save();
          if (!search.disabled) search.focus();
        } })));
    }
    search.addEventListener("input", showHits);
    draw();
    return el("div", { class: "pg-rivals-box" }, [el("div", { class: "pg-row" }, [search, count]), hits, chips]);
  }
  // the problems the page shows as you type (programs-lib.js problems): each field marked, the list under Check Program,
  // and Check Program waits until there are none
  function showProblems(p) {
    const ed = $("#pg-editor");
    if (!ed || ed.hidden) return [];
    const probs = P.problems(p);
    for (const f of ed.querySelectorAll("[data-key]")) f.classList.toggle("pg-invalid", probs.some((x) => x.key === f.dataset.key));
    const box = ed.querySelector(".pg-problems");
    if (box) box.replaceChildren(...probs.map((x) => el("p", { class: "pg-bad", text: x.msg })));
    const check = ed.querySelector(".pg-check button");
    if (check) { check.disabled = probs.length > 0; check.title = probs.length ? "Fix the marked fields first" : "Run the game's own check on this program"; }
    return probs;
  }
  function changed(p, key) {
    persist();
    showProblems(p);
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
    if (p.kind === "edit" && real[p.base] && !real[p.base].colors) details(p.base).then(() => { if (open === id) edit(id); }).catch(() => {});
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
      out.replaceChildren(...(r.ok ? [el("p", { class: "pg-good", text: "Ready to use. Check it on the New Career screen." })]
        : (r.errors || []).map((e) => el("p", { class: "pg-bad", text: e }))));
    });
    const newConf = el("div", { class: "pg-row pg-newconf" }, [
      field("Conference Name", input(p, "new_conf_name", { type: "text", maxlength: "60" }), null, "new_conf_name"),
      field("Conference Games", select(p, "new_conf_games", [["8", "8"], ["9", "9"]]))]);
    newConf.hidden = f.conference !== "__new";
    ed.replaceChildren(
      el("div", { class: "card-bar section-head pg-head" }, [el("span", { class: "pg-head-who" }, [pill(f), el("b", { text: label(p) })]),
        el("button", { type: "button", class: "ghost small", text: "Close", onclick: () => { open = null; ed.hidden = true; drawList(); } })]),
      el("h3", { class: "pg-sec", text: "Identity" }),
      el("div", { class: "pg-row" }, [field("Name", input(p, "name", { type: "text", maxlength: "60", placeholder: "Alder Tech" }), null, "name"),
        field("Short Name", input(p, "short_name", { type: "text", maxlength: "30" })),
        field("Abbreviation", input(p, "abbreviation", { type: "text", maxlength: "4" }), null, "abbreviation"),
        field("Mascot", input(p, "mascot", { type: "text", maxlength: "30" }))]),
      el("div", { class: "pg-row" }, [field("Primary Color", input(p, "primary", { type: "color" })),
        field("Secondary Color", input(p, "secondary", { type: "color" })),
        field("Accent Color", input(p, "accent", { type: "color" }))]),
      el("h3", { class: "pg-sec", text: "Home" }),
      el("div", { class: "pg-row" }, [field("City", input(p, "city", { type: "text", maxlength: "40" })),
        field("State", select(p, "state", [["", "Pick a State"], ...STATES.map((s) => [s, s])]))]),
      el("h3", { class: "pg-sec", text: "Program" }),
      el("div", { class: "pg-row" }, [field("Conference", select(p, "conference", confOpts), null, "conference"),
        field("Strength", select(p, "strength", [["", "Conference Average"], ...P.STRENGTHS.map((s) => [s, s])])),
        field("Prestige", input(p, "prestige", { type: "number", min: "0", max: "100", placeholder: "Conference average" }), "0 to 100", "prestige")]),
      newConf,
      el("h3", { class: "pg-sec", text: "Coaches" }),
      el("div", { class: "pg-row" }, [field("Head Coach", input(p, "coach", { type: "text", maxlength: "40", placeholder: "Generated if blank" })),
        field("Offensive Coordinator", input(p, "oc", { type: "text", maxlength: "40", placeholder: "Generated if blank" })),
        field("Defensive Coordinator", input(p, "dc", { type: "text", maxlength: "40", placeholder: "Generated if blank" }))]),
      el("div", { class: "pg-row" }, [field("Offense", select(p, "offense", [["", "Conference's Usual"], ...playbooks.offense.map((x) => [x, x])])),
        field("Defense", select(p, "defense", [["", "Conference's Usual"], ...playbooks.defense.map((x) => [x, x])]))]),
      el("h3", { class: "pg-sec", text: "Rivals" }),
      field("Rivals", rivalsPick(p), `Up to ${P.MAX_RIVALS}. Every Year reserves a game each season (a rival outside your conference takes one of your non-conference weeks); Rivalry Week plays it in the season's rivalry week; Sometimes keeps the name and the series but plays only when the schedule pairs you. Name it if you like: the name shows on the game.`, "rivals"),
      el("h3", { class: "pg-sec", text: "Roster" }),
      rosterEditor(p),
      el("div", { class: "pg-problems", "aria-live": "polite" }),
      el("div", { class: "pg-row pg-check" }, [check]),
      out);
    ed.hidden = false;
    showProblems(p);
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
  async function download(progs, name) {
    try { await Promise.all(progs.filter((p) => p.kind === "edit").map((p) => details(p.base))); } catch (e) { /* an edit then writes every field it has */ }
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
        rivals: Array.isArray(t.rivals) ? t.rivals.map((r) => (typeof r === "string" ? r : r && r.slug)).filter(Boolean) : undefined,
        rivalry_names: Array.isArray(t.rivals) ? Object.fromEntries(t.rivals.filter((r) => r && typeof r === "object" && r.name).map((r) => [r.slug, r.name])) : undefined,
        rivalry_often: Array.isArray(t.rivals) ? Object.fromEntries(t.rivals.filter((r) => r && typeof r === "object").map((r) => [r.slug, r.rivalry_week ? "week" : r.every_year === false ? "some" : "year"])) : undefined,
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

  // the game's programs are loading: Create and Edit wait (their conference and rival lists come with them)
  function ready(on) {
    for (const id of ["#pg-new", "#pg-real"]) $(id).disabled = !on;
    $("#pg-loading").hidden = on;
  }
  // a real team's full details, fetched when you open it (the list carries names only)
  async function details(slug) {
    if (real[slug] && real[slug].colors) return real[slug];
    const d = await api(`/api/league/programs/${encodeURIComponent(slug)}`);
    real[slug] = { ...(real[slug] || {}), ...d };
    return real[slug];
  }

  // ----- wiring -----
  async function mount() {
    ready(false);
    try { localStorage.setItem("cfp-probe", "1"); localStorage.removeItem("cfp-probe"); } catch (e) { $("#pg-store-note").hidden = false; }
    drawList();
    $("#pg-new").addEventListener("click", () => create("new"));
    $("#pg-real").addEventListener("change", async (e) => {
      const sel = e.currentTarget, v = sel.value;
      sel.value = "";
      if (!v) return;
      try { await ui().busy(sel, details(v)); } catch (err) { toast("That program's details didn't load. Try again."); return; }
      create("edit", v);
    });
    $("#pg-download-all").addEventListener("click", () => (list.length ? download(list, "custom-programs.json") : toast("Nothing to download yet.")));
    $("#pg-load").addEventListener("click", () => $("#pg-file").click());
    $("#pg-file").addEventListener("change", (e) => { const file = e.currentTarget.files[0]; e.currentTarget.value = ""; if (file) loadFile(file); });
    try {
      await window.CFP.game.ready;
      const d = await api("/api/league/programs");
      real = Object.fromEntries(d.teams.map((t) => [t.slug, t]));
      conferences = d.conferences.filter((c) => (c.level || "FBS") === "FBS");
      playbooks = d.playbooks || playbooks;
      const sel = $("#pg-real");
      sel.append(...d.teams.filter((t) => (t.level || "FBS") === "FBS").map((t) => el("option", { value: t.slug, text: t.short_name || t.name })));
      ready(true);
      drawList();
      if (open && byId(open)) edit(open);            // an editor opened before the list arrived: its conferences and rivals fill in
    } catch (err) { toast("The game's programs didn't load. Reload the page to try again.", 6000); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
