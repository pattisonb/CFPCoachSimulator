/* The depth chart screen: its own page in the app at index.html?id=…&screen=depth. A sidebar of
   management screens (Overview, Personnel, Redshirts, Availability) and the three units; Overview
   lays the team's two or three most-used formations out on a field as the next game fills them
   (Formation) or lists the unit's depth chart (List view); Personnel is one position at a time with
   the moves. Players are drawn with the locker room's portraits (portraits.js).
   window.CFPDepth = { open(ctx, params), close(), isOpen(), refresh() }; ctx comes from season.js. */
(function () {
  "use strict";
  // window.CFP.el, with null and undefined attributes left off (an optional aria-current, a click)
  const el = (tag, attrs = {}, children = []) => window.CFP.el(tag, Object.fromEntries(Object.entries(attrs).filter(([, v]) => v != null)), children);

  const UNITS = [
    { id: "offense", name: "Offense", chart: "Offense", roles: ["QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT"] },
    { id: "defense", name: "Defense", chart: "Defense", roles: ["LEDG", "DT", "REDG", "SAM", "MIKE", "WILL", "CB", "FS", "SS"] },
    { id: "special", name: "Special teams", chart: "Special teams", roles: ["K", "P", "KR", "PR"] },
  ];
  const SCREENS = [
    { id: "overview", name: "Overview", key: "1" },
    { id: "players", name: "Players", key: "2" },
    { id: "redshirts", name: "Redshirts", key: "3" },
    { id: "availability", name: "Availability", key: "4" },
  ];
  const ROLE_NAME = { QB: "Quarterback", HB: "Running back", FB: "Fullback", WR: "Wide receiver", TE: "Tight end", LT: "Left tackle", LG: "Left guard", C: "Center",
    RG: "Right guard", RT: "Right tackle", LEDG: "Left edge", DT: "Defensive tackle", REDG: "Right edge", SAM: "Strongside LB", MIKE: "Middle LB", WILL: "Weakside LB",
    CB: "Cornerback", FS: "Free safety", SS: "Strong safety", K: "Kicker", P: "Punter", KR: "Kick returner", PR: "Punt returner" };
  const CLASS_LABEL = { FR: "Fr.", FRRS: "RS Fr.", SO: "So.", SORS: "RS So.", JR: "Jr.", JRRS: "RS Jr.", SR: "Sr.", SRRS: "RS Sr." };
  const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  // "McClain", "Henry Jr.", "St. Clair": what fits on a card (the full name is its title)
  const lastName = (n) => { const w = n.split(" "); return w.length > 1 ? w.slice(1).join(" ") : n; };
  const shortName = (n) => { const w = n.split(" "); return w.length > 1 ? `${w[0][0]}. ${w.slice(1).join(" ")}` : n; };
  const posGroup = (pos) => (["MLB", "ROLB", "LOLB", "OLB"].includes(pos) ? "LB" : pos);   // the three linebacker spots are one group
  const tier = (v) => (v >= 80 ? "hi" : v < 50 ? "lo" : "");
  const inches = (h) => { const m = /(\d+)'\s*(\d+)/.exec(h || ""); return m ? Number(m[1]) * 12 + Number(m[2]) : undefined; };

  let ctx = null;          // season.js's helpers: api, postJSON, toast, errText, godMode, openPlayer, season(), teams(), setParams, close
  let host = null;
  const S = { team: null, screen: "overview", unit: "offense", view: "formation", form: {}, role: "QB", sel: null, q: "", showAll: false,
    psel: null, pgroup: "all", psort: "overall", pdesc: true, pclass: "all", pstatus: "all" };
  const cache = { key: null, chart: null, forms: null, roster: null, pos: {} };

  // ----- data ---------------------------------------------------------------

  const base = () => `/api/season/${ctx.season().id}/depth/${S.team}`;
  function freshCache() {
    const s = ctx.season();
    const key = `${s.id}|${s.current_week}|${S.team}`;
    if (cache.key !== key) Object.assign(cache, { key, chart: null, forms: null, roster: null, pos: {} });
  }
  function dropCache() { cache.key = null; profiles.clear(); }
  async function need(what) {
    freshCache();
    if (what === "chart" && !cache.chart) cache.chart = await ctx.api(base());
    if (what === "forms" && !cache.forms) cache.forms = await ctx.api(`${base()}/formations`);
    if (what === "roster" && !cache.roster) cache.roster = await ctx.api(`${base()}/roster`);
    if (what === "pos" && !cache.pos[S.role]) cache.pos[S.role] = await ctx.api(`${base()}/position/${S.role}`);
  }
  const canEdit = () => { const s = ctx.season(); return !s.done && (S.team === s.team || ctx.godMode()); };

  // a move on the depth chart (saved with the season, used by every game from the next sim on)
  async function change(body) {
    try {
      await ctx.api(base(), ctx.postJSON(body));
      dropCache();
      render();
    } catch (err) { ctx.toast(`Could not change the depth chart: ${ctx.errText(err)}`, 4000); }
  }
  async function redshirt(p, on) {
    try {
      await ctx.api(`/api/season/${ctx.season().id}/redshirt`, ctx.postJSON({ team: S.team, player: p.slug, on }));
      ctx.toast(on ? `${p.name} is redshirting: he keeps his year.` : `${p.name} is back in the lineup.`, 3000);
      dropCache();
      render();
    } catch (err) { ctx.toast(`Could not do that: ${ctx.errText(err)}`, 4000); }
  }

  // ----- portraits ------------------------------------------------------------

  const faces = new Map();
  // A player's locker-room portrait as an <img>: his face from his slug, his size, his number, his
  // team's colours. Drawn at one pixel a pixel; the stylesheet scales it by whole numbers.
  function face(p, crop, cls) {
    const P = window.CFPPortraits;
    if (!P || !p || !p.slug) return el("span", { class: `${cls} dc-noface`, "aria-hidden": "true" });
    const key = `${S.team}|${p.slug}|${p.jersey}|${crop}`;
    let url = faces.get(key);
    if (!url) {
      const colors = (window.CFP.teamsBySlug[S.team] || {}).colors || {};
      const n = parseInt(p.jersey, 10);
      try {
        url = P.portraitCanvas({ seed: p.slug, number: Number.isFinite(n) ? n : undefined, height: inches(p.height), weight: p.weight || undefined }, colors, crop, 1).toDataURL();
      } catch (err) { console.error(err); url = ""; }
      faces.set(key, url);
    }
    return url ? el("img", { class: cls, src: url, alt: "", draggable: "false" }) : el("span", { class: `${cls} dc-noface`, "aria-hidden": "true" });
  }

  // ----- the shell: top bar, sidebar, page header ------------------------------

  function setParams() {
    const s = ctx.season();
    ctx.setParams({ screen: "depth", team: S.team !== s.team ? S.team : null, sub: S.screen !== "overview" ? S.screen : null, unit: S.unit !== "offense" ? S.unit : null,
      view: S.screen === "overview" && S.view !== "formation" ? S.view : null, player: S.screen === "players" ? S.psel : null, f: S.form[S.unit] || null, role: S.view === "list" ? S.role : null });
  }
  const unitOf = (id) => UNITS.find((u) => u.id === id) || UNITS[0];
  function go(patch) {
    Object.assign(S, patch);
    const u = unitOf(S.unit);
    if (!u.roles.includes(S.role)) S.role = u.roles[0];
    smooth(render);
  }

  // A switch (screen, unit, formation, position) as a short cross-fade: the same player's card glides to
  // his new spot and a tab's underline slides to the new tab (view transitions, where the browser has them;
  // none when the player asks for reduced motion).
  function smooth(update) {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || still) return update();
    host.classList.add("dc-vt");
    const vt = document.startViewTransition(() => update());
    vt.finished.finally(() => host && host.classList.remove("dc-vt"));
    return vt.updateCallbackDone;
  }
  function cycleUnit(step) {
    const i = UNITS.findIndex((u) => u.id === S.unit);
    go({ unit: UNITS[(i + step + UNITS.length) % UNITS.length].id, sel: null });   // go() cross-fades
  }

  async function render() {
    if (!host || !ctx) return;
    setParams();
    const s = ctx.season();
    const t = window.CFP.teamsBySlug[S.team] || { name: S.team };
    host.innerHTML = "";
    const work = el("div", { class: "dc-work" });
    host.append(work);
    const main = el("section", { class: "dc-main", "aria-live": "polite" });
    work.append(sidebar(t, s), main);
    try {
      await need("chart");
      header(main);
      if (S.screen === "overview") await overview(main);
      else if (S.screen === "players") await players(main);
      else if (S.screen === "redshirts") await redshirts(main);
      else await availability(main);
      fit();
    } catch (err) {
      main.append(el("p", { class: "dc-muted", text: `Could not load the depth chart: ${ctx.errText(err)}` }));
      console.error(err);
    }
  }

  // the sidebar: the team's mark and name, the week, the team picker and the way back, the screens, the head coach
  function sidebar(t, s) {
    const coach = (cache.chart && cache.chart.head_coach) || t.head_coach || "";
    const initials = coach.split(" ").map((w) => w[0]).join("").slice(0, 2);
    const teamSel = el("select", { class: "dc-team-select", "aria-label": "Team" }, ctx.teams().filter((x) => !x.fictional).map((x) => el("option", { value: x.slug, text: x.name })));
    teamSel.value = S.team;
    teamSel.addEventListener("change", () => { S.team = teamSel.value; S.sel = null; render(); });
    const status = s.done ? "Season complete" : (s.week_labels && s.week_labels[s.current_week + 1]) || `Week ${s.current_week + 1}`;
    return el("aside", { class: "dc-side", "aria-label": "Depth chart" }, [
      el("button", { type: "button", class: "dc-btn dc-btn-back", text: "← Season", onclick: () => ctx.close() }),
      el("div", { class: "dc-brand" }, [el("span", { class: "dc-mark", text: t.abbreviation || "", "aria-hidden": "true" }), el("div", { class: "dc-brand-text" }, [
        el("span", { class: "dc-brand-name", text: (t.mascot || t.name || "").toUpperCase() }),
        el("span", { class: "dc-brand-sub", text: `${s.done ? "Final" : s.current_week === 0 ? "Preseason" : "In season"} · ${status}` }),
      ])]),
      el("div", { class: "dc-side-team" }, [teamSel, S.team !== s.team ? el("button", { type: "button", class: "dc-btn", text: "My team", onclick: () => { S.team = s.team; S.sel = null; render(); } }) : null]),
      el("div", { class: "dc-label", text: "Depth chart" }),
      el("nav", { class: "dc-nav" }, SCREENS.map((x) => el("button", { type: "button", class: `dc-nav-item ${S.screen === x.id ? "on" : ""}`, "aria-current": S.screen === x.id ? "page" : null,
        onclick: () => go({ screen: x.id, sel: null }) }, [el("span", { text: x.name }), el("kbd", { text: x.key, title: `Press ${x.key}` })]))),
      coach ? el("div", { class: "dc-side-foot" }, [el("span", { class: "dc-coach-mark", text: initials, "aria-hidden": "true" }), el("div", {}, [el("strong", { text: coach }), el("small", { text: "Head coach" })])]) : null,
    ]);
  }

  // the page head, one line: the title, and the arrows that cycle the units
  function header(main) {
    const u = unitOf(S.unit);
    const word = u.id === "special" ? ["Special", "teams"] : ["First team", u.name.toLowerCase()];
    const titles = {
      overview: S.view === "list" ? [ROLE_NAME[S.role] || S.role, "depth"] : word,
      players: [`${u.name}`, "box"],
      redshirts: ["Redshirt", "board"],
      availability: ["Who is", "available"],
    };
    const [a, b] = titles[S.screen];
    main.append(el("div", { class: "dc-page-head" }, [
      el("h1", { class: "dc-title", title: `${u.name} / ${SCREENS.find((x) => x.id === S.screen).name}` }, [`${a} `, el("em", { text: b })]),
      el("div", { class: "dc-cycle", role: "group", "aria-label": "Unit" }, [
        el("button", { type: "button", class: "dc-btn dc-icon", "aria-label": `Previous unit: ${UNITS[(UNITS.indexOf(u) + 2) % 3].name}`, title: "Previous unit ([)", text: "‹", onclick: () => cycleUnit(-1) }),
        el("span", { class: "dc-cycle-name" }, [u.name, el("span", { class: "dc-cycle-dots", "aria-hidden": "true" }, UNITS.map((x) => el("i", { class: x.id === u.id ? "on" : "" })))]),
        el("button", { type: "button", class: "dc-btn dc-icon", "aria-label": `Next unit: ${UNITS[(UNITS.indexOf(u) + 1) % 3].name}`, title: "Next unit (])", text: "›", onclick: () => cycleUnit(1) }),
      ]),
    ]));
    if (!canEdit()) main.append(el("p", { class: "dc-note", text: ctx.season().done ? "The season is complete: the depth chart is read-only." : "Another team's chart: turn on god mode in ⚙ Settings to edit it." }));
  }

  // every screen's toolbar: its own controls on the left (tabs, a summary), the search on the right,
  // and an optional note under it, so nothing moves when you switch screens
  function toolbar(main, left, note, middle) {
    main.append(el("div", { class: "dc-toolbar" }, [el("div", { class: "dc-toolbar-left" }, [left]), middle || null, search("Find a player…")]));
    if (note) main.append(el("p", { class: "dc-note", text: note }));
  }

  function search(placeholder) {
    const input = el("input", { type: "search", class: "dc-search-input", placeholder, "aria-label": "Find a player", value: S.q, autocomplete: "off", spellcheck: "false" });
    input.addEventListener("input", () => { S.q = input.value; highlight(); });
    input.addEventListener("keydown", (e) => { if (e.key === "Escape" && input.value) { e.stopPropagation(); input.value = ""; S.q = ""; highlight(); } });
    return el("label", { class: "dc-search" }, [
      el("span", { class: "dc-search-icon", "aria-hidden": "true", text: "⌕" }), input,
      el("span", { class: "dc-search-count", "aria-live": "polite" }),
      el("kbd", { text: "/", title: "Press / to search" }),
    ]);
  }
  // cards and rows whose player matches the search stand out; the rest fade
  function highlight() {
    const q = S.q.trim().toLowerCase();
    const found = new Set();
    for (const node of host.querySelectorAll("[data-name]")) {
      const hit = !!q && node.dataset.name.includes(q);
      if (hit) found.add(node.dataset.name);
      node.classList.toggle("match", hit);
      node.classList.toggle("dim", !!q && !hit);
    }
    const count = host.querySelector(".dc-search-count");
    if (count) count.textContent = q ? (found.size ? `${found.size} found` : "none here") : "";
  }

  // ----- overview: formations and the list ---------------------------------------

  async function overview(main) {
    const tabs = el("div", { class: "dc-tabs", role: "tablist" }, [["formation", "Formation"], ["list", "List view"]].map(([v, label]) =>
      el("button", { type: "button", role: "tab", "aria-selected": String(S.view === v), class: `dc-tab ${S.view === v ? "on" : ""}`, text: label, onclick: () => go({ view: v }) })));
    if (S.view === "list") return personnel(main, tabs);
    await need("forms");
    const unit = cache.forms[S.unit];
    const forms = unit.formations;
    let f = forms.find((x) => x.id === S.form[S.unit]) || forms[0];
    if (f) S.form[S.unit] = f.id;
    toolbar(main, tabs, null, el("div", { class: "dc-forms", role: "group", "aria-label": "Formation" }, forms.map((x) =>
      el("button", { type: "button", class: `dc-form ${f && x.id === f.id ? "on" : ""}`, "aria-pressed": String(!!f && x.id === f.id), onclick: () => { S.form[S.unit] = x.id; smooth(render); } }, [
        el("span", { class: "dc-form-name", text: x.name }),
        el("span", { class: "dc-form-sub", text: [x.personnel, x.usage ? `${Math.round(x.usage * 100)}%` : ""].filter(Boolean).join(" · ") }),
      ]))));
    if (!f) { main.append(el("p", { class: "dc-muted", text: "No formations for this unit." })); return; }
    main.append(field(f, unit));
    drawer();
    highlight();
  }

  // The field's cards take the biggest whole-pixel size (4×, 3× or 2× the portrait) that fits the
  // screen without scrolling; on a phone the page scrolls instead.
  function fit() {
    const rows = host && host.querySelector(".dc-rows");
    if (!rows) return;
    if (window.matchMedia("(max-width: 860px)").matches) { rows.style.removeProperty("--s"); return; }
    // biggest first; then without the 3rd strings, then without strings at all (they are in the drawer and the list);
    // if nothing fits, the field scrolls
    const steps = [[4, 0], [3, 0], [3, 1], [2, 0], [2, 1], [2, 2], [2, 3]];
    let fits = false;
    for (const [sc, level] of steps) {
      rows.style.setProperty("--s", sc);
      rows.classList.toggle("fit-1", level === 1);
      rows.classList.toggle("fit-2", level >= 2);
      rows.classList.toggle("fit-3", level === 3);
      if (rows.scrollHeight <= rows.clientHeight + 1) { fits = true; break; }
    }
    rows.classList.toggle("fit-scroll", !fits);
  }
  let fitFrame = 0;
  const onResize = () => { cancelAnimationFrame(fitFrame); fitFrame = requestAnimationFrame(fit); };

  // where each slot stands: rows of a nine-column field, the offense from behind the quarterback
  // (the line on top), the defense facing it (the line at the bottom)
  function layout(fid, slots) {
    const by = Object.fromEntries(slots.map((s) => [s.slot, s]));
    const rows = [[], [], [], []];
    const taken = new Set();
    const put = (r, c, id) => {
      if (!by[id]) return;
      while (taken.has(`${r}|${c}`) && c < 9) c++;
      taken.add(`${r}|${c}`);
      rows[r].push({ ...by[id], col: c });
    };
    if (S.unit === "offense") {
      put(0, 1, "WR1");
      ["LT", "LG", "C", "RG", "RT"].forEach((id, i) => put(0, 3 + i, id));
      if (by.OL6) put(0, 8, "OL6");
      put(0, by.OL6 ? 9 : 8, "TE1");
      put(0, 2, "TE2");
      put(by.OL6 ? 1 : 0, 9, "WR2");                // jumbo: the tight end is split out, the receiver off the line
      put(1, 8, "TE3");
      put(1, 2, "WR3");
      put(1, 8, "WR4");
      put(1, 5, "QB");
      const backs = ["RB1", "RB2", "RB3"].filter((id) => by[id]);
      if (fid === "option") { put(2, 5, "RB1"); put(1, 3, "RB2"); put(1, 7, "RB3"); }
      else if (backs.length === 1) put(1, 6, "RB1");
      else { put(2, 4, "RB2"); put(2, 6, "RB1"); put(2, 3, "RB3"); }
      return { rows: rows.filter((r) => r.length), los: "top" };
    }
    if (S.unit === "defense") {
      const ids = (pre) => slots.filter((s) => s.slot.startsWith(pre)).map((s) => s.slot);
      const spread = (n) => ({ 1: [5], 2: [3, 7], 3: [2, 5, 8], 4: [2, 4, 6, 8] }[n] || []);
      ids("S").forEach((id, i, a) => put(0, spread(a.length)[i], id));
      const lbs = ids("LB");
      lbs.forEach((id, i) => put(1, ({ 1: [5], 2: [4, 6], 3: [3, 5, 7], 4: [2, 4, 6, 8] }[lbs.length] || [])[i], id));
      put(1, 1, "CB3");
      put(1, 9, "CB4");
      put(2, 1, "CB1");
      put(2, 3, "LE");
      const dts = ids("DT");
      dts.forEach((id, i) => put(2, dts.length === 1 ? 5 : [4, 6][i], id));
      put(2, 7, "RE");
      put(2, 9, "CB2");
      return { rows: rows.filter((r) => r.length), los: "bottom" };
    }
    if (fid === "return") { put(0, 3, "KR"); put(0, 7, "PR"); }
    else slots.forEach((s) => put(0, 5, s.slot));
    return { rows: rows.filter((r) => r.length), los: null };
  }

  function field(f, unit) {
    const { rows, los } = layout(f.id, f.slots);
    const node = el("div", { class: `dc-field dc-field-${S.unit}`, role: "group", "aria-label": `${f.name}: ${f.personnel}` });
    node.append(el("div", { class: "dc-field-head" }, [el("div", { class: "dc-field-label", text: `${f.personnel} · ${f.note}` }), identity(f, unit)]));
    const body = el("div", { class: "dc-rows" });
    body.addEventListener("mouseleave", () => node.querySelector(".dc-field-head").classList.remove("previewing"));
    rows.forEach((row, i) => {
      if (los === "top" && i === 0) body.append(el("div", { class: "dc-los", "aria-hidden": "true" }, [el("span", { text: "Line of scrimmage" })]));
      body.append(el("div", { class: "dc-row" }, row.sort((a, b) => a.col - b.col).map((s) => slotCard(s))));
      if (los === "bottom" && i === rows.length - 1) body.append(el("div", { class: "dc-los", "aria-hidden": "true" }, [el("span", { text: "Line of scrimmage" })]));
    });
    if (S.unit === "special") body.append(el("p", { class: "dc-field-note", text: "Only the kicker, punter and returners are on the depth chart; the rest of each unit is not." }));
    node.append(body);
    return node;
  }

  // the strings behind a starter at his spot: a role with n starters deals its backups out in
  // turn (WR1 gets the 4th receiver, WR2 the 5th...); a backup on the field (the starter hurt) has
  // the men after him
  function strings(p) {
    const row = rowOf(p);
    if (!row) return [];
    const i = row.players.findIndex((x) => x.slug === p.slug);
    const n = Math.max(1, row.starters);
    if (["KR", "PR"].includes(row.role) || i < 0) return [];
    const behind = i < n ? row.players.slice(n).filter((_, k) => k % n === i) : row.players.slice(i + 1);
    return behind.slice(0, 2);
  }

  // one spot on the field, one button: the card (portrait, overall, name, class) on its stack of
  // strings, and its label under it. A click on a string picks that backup; anywhere else, the starter.
  function slotCard(s) {
    const p = s.player;
    const wrap = el("div", { class: "dc-slot", style: `grid-column: ${s.col}` });
    if (!p) {
      wrap.append(el("div", { class: "dc-card dc-card-empty", text: "Nobody" }), el("span", { class: "dc-slot-label", text: s.label }));
      return wrap;
    }
    const behind = strings(p);
    const by = Object.fromEntries([p, ...behind].map((x) => [x.slug, x]));
    const names = [p, ...behind].map((x, k) => `${k ? ordinal(k + 1) + " string " : ""}${x.name} ${x.overall}`).join(", ");
    const stack = el("button", { type: "button", style: `view-transition-name: dc-p-${p.slug.replace(/[^a-z0-9-]/gi, "")}`, class: `dc-stack ${[p, ...behind].some((x) => x.slug === S.sel) ? "has-sel" : ""}`, "aria-label": `${s.label}: ${names}`,
      onclick: (e) => { const hit = e.target.closest("[data-slug]"); const x = by[hit ? hit.dataset.slug : p.slug] || p; S.sel = S.sel === x.slug ? null : x.slug; render(); } }, [
      card(p, { selected: S.sel === p.slug }),
      ...behind.map((x, k) => el("span", { class: `dc-layer dc-layer-${k + 2} ${S.sel === x.slug ? "sel" : ""} ${x.injury ? "hurt" : ""}`, "data-slug": x.slug, "data-name": x.name.toLowerCase(),
        title: `${ordinal(k + 2)} string: ${x.name}, ${x.overall}` }, [
        el("span", { class: "dc-layer-n", text: ordinal(k + 2) }),
        el("span", { class: "dc-layer-name", text: shortName(x.name) }),
        el("span", { class: `dc-layer-ovr ${tier(x.overall)}`, text: x.injury ? "OUT" : String(x.overall) }),
      ])),
    ]);
    stack.addEventListener("mouseenter", () => preview(p, behind));
    stack.addEventListener("focus", () => preview(p, behind));
    const row = rowOf(p);
    if (canEdit() && row && !["KR", "PR"].includes(row.role)) {
      stack.draggable = true;
      stack.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", `${row.role}|${p.slug}`); e.dataTransfer.effectAllowed = "move"; stack.classList.add("dragging"); });
      stack.addEventListener("dragend", () => stack.classList.remove("dragging"));
      stack.addEventListener("dragover", (e) => { e.preventDefault(); stack.classList.add("drop"); });
      stack.addEventListener("dragleave", () => stack.classList.remove("drop"));
      stack.addEventListener("drop", (e) => {
        e.preventDefault(); stack.classList.remove("drop");
        const [r, slug] = e.dataTransfer.getData("text/plain").split("|");
        if (r !== row.role) { ctx.toast(`Drop him on another ${ROLE_NAME[r] ? ROLE_NAME[r].toLowerCase() : r}: swaps stay within a position. Use the list to move him across.`, 3500); return; }
        if (slug === p.slug) return;
        const order = row.players.map((x) => x.slug);
        const i = order.indexOf(slug), j = order.indexOf(p.slug);
        if (i < 0 || j < 0) return;
        [order[i], order[j]] = [order[j], order[i]];
        smooth(() => change({ role: row.role, order }));
      });
    }
    wrap.append(stack, el("span", { class: "dc-slot-label", text: s.label }));
    return wrap;
  }

  // a player card, kept simple: portrait on a plain ground, a rule, his name and one line
  function card(p, opts = {}) {
    const flags = [p.injury ? "OUT" : "", p.redshirt && p.redshirt.on ? "RS" : ""].filter(Boolean);
    return el("span", { class: `dc-card ${opts.selected ? "sel" : ""} ${p.injury ? "hurt" : ""}`, "data-name": p.name.toLowerCase(), "data-slug": p.slug,
      title: `${p.name}: ${p.position}, ${CLASS_LABEL[p.class] || p.class || ""}, ${p.overall} overall` }, [
      el("span", { class: "dc-card-pic" }, [face(p, "hair", "dc-card-face")]),
      el("span", { class: "dc-card-name", text: lastName(p.name) }),
      // the meta line and, at its end, the rating: clear of the face, and the name keeps the card's width
      el("span", { class: "dc-card-foot" }, [
        el("span", { class: "dc-card-meta" }, [
          p.jersey ? el("span", { text: `#${p.jersey}` }) : null, el("span", { text: p.position }), el("span", { text: CLASS_LABEL[p.class] || p.class || "" }),
          flags.length ? el("span", { class: "dc-card-flag", text: flags.join(" · ") }) : null,
        ]),
        el("span", { class: `dc-card-ovr ${tier(p.overall)}`, title: `Overall ${p.overall}`, text: String(p.overall) }),
      ]),
    ]);
  }

  // the player under the pointer, on the field's header line in place of the unit's identity; back to it when the
  // pointer leaves the field
  function preview(p, behind) {
    const head = host.querySelector(".dc-field-head");
    if (!head) return;
    let line = head.querySelector(".dc-preview");
    if (!line) { line = el("div", { class: "dc-preview", "aria-live": "polite" }); head.append(line); }
    line.replaceChildren(
      el("strong", { text: p.name }),
      el("span", { class: "dc-muted", text: [p.jersey ? `#${p.jersey}` : "", p.position, CLASS_LABEL[p.class] || p.class, p.height && p.weight ? `${p.height} ${p.weight}` : ""].filter(Boolean).join(" · ") }),
      el("span", { class: `dc-card-ovr ${tier(p.overall)}`, text: String(p.overall) }),
      behind.length ? el("span", { class: "dc-muted", text: behind.map((b, k) => `${ordinal(k + 2)} ${shortName(b.name)} ${b.overall}`).join(" · ") }) : null,
    );
    head.classList.add("previewing");
  }

  // beside the formation picker: the unit's scheme and the eleven's numbers
  function identity(f, unit) {
    const onField = f.slots.map((s) => s.player).filter(Boolean);
    const label = { offense: "Offensive identity", defense: "Defensive identity", special: "Special teams" }[S.unit];
    const words = (unit.scheme || "Specialists").split(" ");
    const avg = onField.length ? (onField.reduce((n, x) => n + x.overall, 0) / onField.length).toFixed(1) : "–";
    return el("div", { class: "dc-ident", title: label }, [
      el("div", { class: "dc-ident-name" }, [words.length > 1 ? `${words.slice(0, -1).join(" ")} ` : "", el("em", { text: words[words.length - 1] })]),
      el("dl", { class: "dc-ident-stats" }, [
        ["On field", String(onField.length)], ["Avg. OVR", avg], f.usage ? ["Snaps", `${Math.round(f.usage * 100)}%`] : null, ["Starters out", String(onField.filter((x) => x.injury).length)],
      ].filter(Boolean).map(([k, v]) => el("div", {}, [el("dt", { text: k }), el("dd", { text: v })]))),
    ]);
  }

  // the picked player, in a drawer over the right of the screen: his card and the depth at his spot
  function drawer() {
    const p = S.sel && cache.chart.units.flatMap((u) => u.rows.flatMap((r) => r.players)).find((x) => x.slug === S.sel);
    if (!p) return;
    const close = el("button", { type: "button", class: "dc-btn dc-icon dc-drawer-close", "aria-label": "Close", title: "Close (Esc)", text: "×", onclick: () => { S.sel = null; render(); } });
    const node = el("aside", { class: "dc-drawer", role: "dialog", "aria-label": p.name }, [close, ...playerPanel(p).filter(Boolean)]);
    host.append(node);
    close.focus({ preventScroll: true });
  }
  // his player page (season.js's modal); a button, so the page's [data-player] links pass it by
  const playerLink = (p) => el("button", { type: "button", class: "dc-btn dc-link dc-player-link", text: "Player page →", onclick: () => ctx.openPlayer(S.team, p.name, p.position) });
  const stat = (k, v) => el("div", { class: "dc-stat" }, [el("span", { text: k }), el("strong", { text: v })]);

  // the depth chart row a player sits on (KR and PR are their own rows)
  function rowOf(p) {
    for (const u of cache.chart.units) for (const r of u.rows) if (r.role === p.role && r.players.some((x) => x.slug === p.slug)) return r;
    for (const u of cache.chart.units) for (const r of u.rows) if (r.players.some((x) => x.slug === p.slug)) return r;
    return null;
  }

  function playerPanel(p) {
    const row = rowOf(p);
    const edit = canEdit() && row && !["KR", "PR"].includes(row.role);
    const out = [
      el("div", { class: "dc-kicker", text: row ? `${ROLE_NAME[row.role] || row.role}` : p.position }),
      el("div", { class: "dc-panel-pic" }, [face(p, "bust", "dc-panel-face")]),
      el("h2", { class: "dc-rail-title dc-panel-name", text: p.name }),
      el("p", { class: "dc-muted dc-rail-copy", text: [p.jersey ? `#${p.jersey}` : "", p.position, CLASS_LABEL[p.class] || p.class, p.height && p.weight ? `${p.height} ${p.weight}` : ""].filter(Boolean).join(" · ") }),
      stat("OVR", String(p.overall)),
      p.dev_trait ? stat("Development", p.dev_trait) : null,
      p.archetype ? stat("Type", p.archetype) : null,
      p.injury ? stat("Injury", `${p.injury.type}, ${p.injury.weeks_left}w`) : null,
      p.headline ? el("p", { class: "dc-muted dc-rail-copy", text: p.headline }) : null,
    ];
    if (row) {
      out.push(el("div", { class: "dc-kicker dc-panel-sub", text: `${row.role} depth` }));
      out.push(el("ol", { class: "dc-depth" }, row.players.map((x, i) => el("li", { class: `${x.slug === p.slug ? "on" : ""} ${i < Math.max(1, row.starters) ? "start" : ""}` }, [
        el("button", { type: "button", class: "dc-depth-name", text: `${i + 1}. ${shortName(x.name)}`, onclick: () => { S.sel = x.slug; render(); } }),
        el("span", { class: `dc-depth-ovr ${tier(x.overall)}`, text: String(x.overall) }),
        edit ? el("span", { class: "dc-depth-acts" }, [
          i > 0 ? el("button", { type: "button", class: "dc-btn dc-mini tiny", title: "Make starter", "aria-label": `Make ${x.name} the starter`, text: "★", onclick: () => change({ role: row.role, player: x.slug, move: "top" }) }) : null,
          i > 0 ? el("button", { type: "button", class: "dc-btn dc-mini tiny", title: "Move up", "aria-label": `Move ${x.name} up`, text: "▲", onclick: () => change({ role: row.role, player: x.slug, move: "up" }) }) : null,
          i < row.players.length - 1 ? el("button", { type: "button", class: "dc-btn dc-mini tiny", title: "Move down", "aria-label": `Move ${x.name} down`, text: "▼", onclick: () => change({ role: row.role, player: x.slug, move: "down" }) }) : null,
        ]) : null,
      ]))));
    }
    out.push(el("div", { class: "dc-panel-acts" }, [
      row ? el("button", { type: "button", class: "dc-btn", text: "Open in list", onclick: () => go({ screen: "overview", view: "list", role: row.role, sel: p.slug }) }) : null,
      playerLink(p),
    ]));
    return out;
  }

  // ----- personnel: one position at a time ---------------------------------------

  async function personnel(main, tabs) {
    const u = unitOf(S.unit);
    toolbar(main, tabs, null, el("div", { class: "dc-roles", role: "tablist", "aria-label": "Position" }, u.roles.map((r) =>
      el("button", { type: "button", role: "tab", "aria-selected": String(S.role === r), class: `dc-role ${S.role === r ? "on" : ""}`, title: ROLE_NAME[r], text: r, onclick: () => go({ role: r, sel: null, showAll: false }) }))));
    await need("pos");
    const d = cache.pos[S.role];
    const role = S.role;
    const returner = ["KR", "PR"].includes(role);
    const inRole = d.players.filter((p) => p.in_role).sort((a, b) => a.spot - b.spot);
    const others = d.players.filter((p) => !p.in_role);
    if (!d.players.some((p) => p.slug === S.sel)) S.sel = (inRole[0] || d.players[0] || {}).slug;
    const sel = d.players.find((p) => p.slug === S.sel);
    const wrap = el("div", { class: "dc-personnel" });
    const table = el("div", { class: "dc-table-wrap" });
    wrap.append(table, el("aside", { class: "dc-rail" }, sel ? personnelPanel(d, sel, inRole) : []));
    main.append(wrap);
    const edit = canEdit() && !returner && inRole.length > 1;
    table.append(el("div", { class: "dc-table-head" }, [
      el("span", { class: "dc-kicker", text: d.starters === 0 ? `${role} · not in the base formation` : `${role} · ${d.starters} ${d.starters === 1 ? "starter" : "starters"}` }),
      edit ? el("button", { type: "button", class: "dc-btn", title: "Order this position by OVR, best first", text: "Auto reorder", onclick: () => {
        const order = inRole.slice().sort((a, b) => b.rating - a.rating || a.spot - b.spot).map((p) => p.slug);
        if (order.every((slug, i) => slug === inRole[i].slug)) { ctx.toast(`The ${role} order already follows the ratings.`, 2500); return; }
        change({ role, order });
      } }) : null,
    ]));
    const movable = canEdit() && !returner;
    // a new order for the role: a swap, a drag, a pick from the spot list; a player from Others comes onto the chart first
    const reorder = async (slug, toIndex) => {
      const order = inRole.map((p) => p.slug).filter((x) => x !== slug);
      order.splice(Math.max(0, Math.min(toIndex, order.length)), 0, slug);
      if (!inRole.some((p) => p.slug === slug)) {
        try { await ctx.api(base(), ctx.postJSON({ role, player: slug, move: "add" })); } catch (err) { ctx.toast(`Could not change the depth chart: ${ctx.errText(err)}`, 4000); return; }
      }
      S.sel = slug;
      change({ role, order });
    };
    const swap = (a, b) => {
      const order = inRole.map((p) => p.slug);
      const i = order.indexOf(a), j = order.indexOf(b);
      if (i < 0 || j < 0) return;
      [order[i], order[j]] = [order[j], order[i]];
      change({ role, order });
    };
    S.reorder = { reorder, swap, inRole, movable };
    const selInRole = sel && sel.in_role;
    const t = el("table", { class: "dc-table" });
    t.append(el("thead", {}, [el("tr", {}, [
      movable ? el("th", { class: "dc-grip-col", "aria-label": "Drag to reorder" }) : null,
      el("th", { text: "#" }), el("th", { class: "left", text: "Player" }), el("th", { text: "Pos" }), el("th", { text: "Class" }),
      el("th", { text: "OVR", title: `Rating as a ${role}` }), el("th", { class: "ph", text: "NAT", title: "Rating at his own position" }),
      ...d.columns.map((c) => el("th", { class: "ph", text: c.short, title: c.label })),
      movable ? el("th", { class: "dc-swap-col", "aria-label": "Swap" }) : null,
    ])]));
    const body = el("tbody");
    const ncols = 6 + d.columns.length + (movable ? 2 : 0);
    const group = (label, extra) => body.append(el("tr", { class: "grp" }, [el("td", { colspan: String(ncols) }, [el("span", { text: label }), extra || null])]));
    const row = (p) => {
      const tr = el("tr", { class: `${p.slug === S.sel ? "sel" : ""} ${p.in_role ? "" : "off"}`, tabindex: "0", "data-name": p.name.toLowerCase(), "data-slug": p.slug,
        "aria-selected": String(p.slug === S.sel), draggable: movable ? "true" : null }, [
        movable ? el("td", { class: "dc-grip", "aria-hidden": "true", title: "Drag to move him", text: "⠿" }) : null,
        el("td", { class: "dc-muted", text: p.in_role ? String(p.spot) : "–" }),
        el("td", { class: "left" }, [el("span", { class: "dc-table-player" }, [face(p, "head", "dc-chip-face"), el("span", { text: p.name }),
          p.injury ? el("span", { class: "dc-flag bad", text: `OUT ${p.injury.weeks_left}w` }) : null, p.redshirt && p.redshirt.on ? el("span", { class: "dc-flag", text: "RS" }) : null])]),
        el("td", { text: p.position }), el("td", { text: CLASS_LABEL[p.class] || p.class || "" }),
        el("td", { class: `num ${tier(p.rating)}`, text: String(p.rating) }),
        el("td", { class: "ph dc-muted", text: String(p.natural) }),
        ...d.columns.map((c) => { const v = p.attrs[c.key]; return el("td", { class: `ph num ${v == null ? "dc-muted" : tier(v)}`, text: v == null ? "–" : String(v) }); }),
        // with a player on the chart picked, every other one on it offers a swap
        movable ? el("td", { class: "dc-swap" }, [selInRole && p.in_role && p.slug !== S.sel ? el("button", { type: "button", class: "dc-btn dc-mini tiny", text: "⇄",
          title: `Swap with ${sel.name}`, "aria-label": `Swap ${p.name} with ${sel.name}`, onclick: (e) => { e.stopPropagation(); swap(S.sel, p.slug); } }) : null]) : null,
      ]);
      const pick = () => { S.sel = p.slug; render(); };
      tr.addEventListener("click", pick);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
        // Alt+Up and Alt+Down move the picked player a spot
        else if (movable && e.altKey && p.in_role && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          const to = p.spot - 1 + (e.key === "ArrowUp" ? -1 : 1);
          if (to >= 0 && to < inRole.length) { S.sel = p.slug; reorder(p.slug, to); }
        }
      });
      if (movable) {
        tr.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", p.slug); e.dataTransfer.effectAllowed = "move"; tr.classList.add("dragging"); });
        tr.addEventListener("dragend", () => tr.classList.remove("dragging"));
        if (p.in_role) {
          tr.addEventListener("dragover", (e) => { e.preventDefault(); tr.classList.add("drop"); });
          tr.addEventListener("dragleave", () => tr.classList.remove("drop"));
          tr.addEventListener("drop", (e) => { e.preventDefault(); tr.classList.remove("drop"); const slug = e.dataTransfer.getData("text/plain"); if (slug && slug !== p.slug) reorder(slug, p.spot - 1); });
        }
      }
      body.append(tr);
    };
    const starters = d.starters === 0 ? [] : inRole.slice(0, d.starters);
    const backups = d.starters === 0 ? inRole : inRole.slice(d.starters);
    if (starters.length) { group(returner ? "Returner" : starters.length === 1 ? "Starter" : `Starters · ${starters.length}`); starters.forEach(row); }
    if (backups.length) { group(d.starters === 0 ? "On the chart, not in the base formation" : `Backups · ${backups.length}`); backups.forEach(row); }
    if (others.length) {
      const shown = S.showAll ? others : others.slice(0, 8);
      group(`Others who can play ${role} · ${others.length}`, others.length > 8 ? el("button", { type: "button", class: "dc-link btn-link dc-mini-text", text: S.showAll ? "Show fewer" : `Show all ${others.length}`,
        onclick: (e) => { e.stopPropagation(); S.showAll = !S.showAll; render(); } }) : null);
      shown.forEach(row);
    }
    t.append(body);
    table.append(el("div", { class: "dc-scroll" }, [t]));
    highlight();
  }

  function personnelPanel(d, p, inRole) {
    const role = S.role;
    const returner = ["KR", "PR"].includes(role);
    const where = !p.in_role ? "Not on this chart" : d.starters === 0 ? ordinal(p.spot) : p.spot <= d.starters ? "Starter" : `Backup · ${ordinal(p.spot)}`;
    const acts = [];
    if (canEdit()) {
      if (!p.in_role) {
        acts.push(el("button", { type: "button", class: "dc-btn dc-primary", text: returner ? `Make ${role === "KR" ? "kick" : "punt"} returner` : `Start at ${role}`, onclick: () => change({ role, player: p.slug, move: "top" }) }));
        if (!returner) acts.push(el("button", { type: "button", class: "dc-btn", text: `+ Add to ${role}`, title: `Add him to the bottom of the ${role} chart`, onclick: () => change({ role, player: p.slug, move: "add" }) }));
      } else if (!returner) {
        if (p.spot > 1) acts.push(el("button", { type: "button", class: "dc-btn dc-primary", text: "Make starter", onclick: () => change({ role, player: p.slug, move: "top" }) }));
        if (p.spot > 1) acts.push(el("button", { type: "button", class: "dc-btn dc-icon", "aria-label": "Move up", title: "Move up", text: "▲", onclick: () => change({ role, player: p.slug, move: "up" }) }));
        if (p.spot < inRole.length) acts.push(el("button", { type: "button", class: "dc-btn dc-icon", "aria-label": "Move down", title: "Move down", text: "▼", onclick: () => change({ role, player: p.slug, move: "down" }) }));
      }
      if (!returner && (p.in_role || inRole.length)) {
        const spots = el("select", { class: "dc-spot-select", "aria-label": "Move to spot" }, [
          el("option", { value: "", text: p.in_role ? `Spot ${p.spot}` : "Put him at…" }),
          ...inRole.map((_, i) => el("option", { value: String(i), text: `${ordinal(i + 1)}${i < d.starters ? " (starts)" : ""}` })).concat(p.in_role ? [] : [el("option", { value: String(inRole.length), text: `${ordinal(inRole.length + 1)}` })]),
        ]);
        spots.addEventListener("change", () => { if (spots.value !== "" && S.reorder) S.reorder.reorder(p.slug, Number(spots.value)); });
        acts.push(spots);
      }
      const rs = p.redshirt;
      if (rs && (rs.can || rs.on)) acts.push(el("button", { type: "button", class: "dc-btn", text: rs.on ? "Off redshirt" : "Redshirt", title: rs.on ? "He plays again" : `Sit him out and keep his year (${rs.games} of ${rs.limit} games)`, onclick: () => redshirt(p, !rs.on) }));
    }
    return [
      el("div", { class: "dc-kicker", text: `${role} · ${where}` }),
      el("div", { class: "dc-panel-pic" }, [face(p, "bust", "dc-panel-face")]),
      el("h2", { class: "dc-rail-title dc-panel-name", text: p.name }),
      el("p", { class: "dc-muted dc-rail-copy", text: [p.jersey ? `#${p.jersey}` : "", p.position, CLASS_LABEL[p.class] || p.class, p.height && p.weight ? `${p.height} ${p.weight}` : ""].filter(Boolean).join(" · ") }),
      stat(`OVR at ${role}`, String(p.rating)),
      stat("At his own position", `${p.natural} ${p.position}`),
      p.dev_trait ? stat("Development", p.dev_trait) : null,
      p.archetype ? stat("Type", p.archetype) : null,
      p.injury ? stat("Injury", `${p.injury.type}, ${p.injury.weeks_left}w`) : null,
      p.headline ? el("p", { class: "dc-muted dc-rail-copy", text: p.headline }) : null,
      el("div", { class: "dc-panel-acts" }, [...acts, playerLink(p)]),
    ];
  }

  // ----- players: the roster as a box of portraits, the picked one's full card beside it -----------

  const GROUPS = { offense: ["QB", "RB", "WR", "TE", "OL"], defense: ["DL", "LB", "CB", "S"], special: ["K", "P"] };
  const GROUP_NAME = { QB: "Quarterbacks", RB: "Running backs", WR: "Receivers", TE: "Tight ends", OL: "Linemen", DL: "Line", LB: "Linebackers", CB: "Corners", S: "Safeties", K: "Kickers", P: "Punters" };
  const CLASS_ORDER = ["FR", "FRRS", "SO", "SORS", "JR", "JRRS", "SR", "SRRS"];
  const SORTS = [["overall", "OVR"], ["position", "Position"], ["name", "Name"], ["class", "Class"], ["jersey", "Jersey"]];
  const STATUSES = [["all", "Everyone"], ["starters", "Starters"], ["injured", "Injured"], ["redshirt", "Can redshirt"]];
  const profiles = new Map();

  // the box's players: the unit's (by position), the filters, then the sort
  function boxPlayers() {
    const groups = GROUPS[S.unit];
    const byGroup = (p) => groups.indexOf(posGroup(p.position));
    let list = cache.roster.players.filter((p) => byGroup(p) >= 0);
    if (S.pgroup !== "all") list = list.filter((p) => posGroup(p.position) === S.pgroup);
    if (S.pclass !== "all") list = list.filter((p) => (p.class || "").replace("RS", "") === S.pclass);
    if (S.pstatus === "starters") list = list.filter((p) => p.starter);
    if (S.pstatus === "injured") list = list.filter((p) => p.injury);
    if (S.pstatus === "redshirt") list = list.filter((p) => p.redshirt && (p.redshirt.can || p.redshirt.on));
    const key = {
      overall: (p) => p.overall, jersey: (p) => parseInt(p.jersey, 10) || 0, class: (p) => CLASS_ORDER.indexOf(p.class),
      name: (p) => lastName(p.name).toLowerCase(), position: (p) => byGroup(p) * 1000 - p.overall,
    }[S.psort];
    const dir = S.pdesc ? -1 : 1;
    return list.sort((a, b) => { const x = key(a), y = key(b); return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir || b.overall - a.overall; });
  }

  async function players(main) {
    await need("roster");
    const groups = GROUPS[S.unit];
    if (S.pgroup !== "all" && !groups.includes(S.pgroup)) S.pgroup = "all";
    const pick = (opts, value, label, onPick) => {
      const sel = el("select", { class: "dc-filter", "aria-label": label }, opts.map(([v, t]) => el("option", { value: v, text: t })));
      sel.value = value;
      sel.addEventListener("change", () => onPick(sel.value));
      return sel;
    };
    const controls = el("div", { class: "dc-filters" }, [
      pick(SORTS, S.psort, "Sort by", (v) => { S.psort = v; S.pdesc = v === "overall" || v === "class"; go({}); }),
      el("button", { type: "button", class: "dc-btn dc-icon", "aria-label": S.pdesc ? "Highest first: show lowest first" : "Lowest first: show highest first", title: "Reverse the order",
        text: S.pdesc ? "↓" : "↑", onclick: () => go({ pdesc: !S.pdesc }) }),
      pick([["all", "Any class"], ["FR", "Freshmen"], ["SO", "Sophomores"], ["JR", "Juniors"], ["SR", "Seniors"]], S.pclass, "Class", (v) => go({ pclass: v })),
      pick(STATUSES, S.pstatus, "Status", (v) => go({ pstatus: v })),
    ]);
    toolbar(main, controls);
    const chips = el("div", { class: "dc-roles", role: "group", "aria-label": "Position" }, [["all", "All"], ...groups.map((g) => [g, g])].map(([g, t]) =>
      el("button", { type: "button", class: `dc-role ${S.pgroup === g ? "on" : ""}`, "aria-pressed": String(S.pgroup === g), title: g === "all" ? "Every position" : GROUP_NAME[g], text: t, onclick: () => go({ pgroup: g }) })));
    const list = boxPlayers();
    if (!list.some((p) => p.slug === S.psel)) S.psel = list[0] && list[0].slug;
    const grid = el("div", { class: "dc-tiles", role: "listbox", "aria-label": `${unitOf(S.unit).name} players` }, list.map((p) => tile(p)));
    const card = el("section", { class: "dc-pcard", "aria-live": "polite" });
    main.append(el("div", { class: "dc-box" }, [
      el("div", { class: "dc-box-grid" }, [
        el("div", { class: "dc-box-head" }, [chips, el("span", { class: "dc-kicker", text: `${list.length} ${list.length === 1 ? "player" : "players"}` })]),
        list.length ? grid : el("p", { class: "dc-muted dc-empty", text: "Nobody matches these filters." }),
        el("div", { class: "dc-keys-hint" }, [el("kbd", { text: "←" }), el("kbd", { text: "→" }), el("kbd", { text: "↑" }), el("kbd", { text: "↓" }), " browse",
          el("kbd", { text: "Enter" }), " player page", el("kbd", { text: "[" }), el("kbd", { text: "]" }), " other box", el("kbd", { text: "/" }), " search"]),
      ]),
      card,
    ]));
    const p = list.find((x) => x.slug === S.psel);
    if (p) fillCard(card, p);
    highlight();
  }

  // a tile: the portrait on a plain ground, his rating under it, his position in the corner; the picked one
  // carries his name on a flag above it
  function tile(p) {
    const on = p.slug === S.psel;
    return el("button", { type: "button", role: "option", "aria-selected": String(on), class: `dc-tile ${on ? "on" : ""} ${p.injury ? "hurt" : ""}`, "data-name": p.name.toLowerCase(), "data-slug": p.slug,
      title: `${p.name} · ${p.position} · ${p.overall}`, onclick: () => choose(p.slug) }, [
      on ? el("span", { class: "dc-tile-flag", text: p.name }) : null,
      el("span", { class: "dc-tile-pos", text: p.position }),
      p.starter ? el("span", { class: "dc-tile-start", title: "Starter", "aria-label": "Starter" }) : null,
      face(p, "head", "dc-tile-face"),
      el("span", { class: "dc-tile-ovr" }, [el("small", { text: p.injury ? "OUT" : p.redshirt && p.redshirt.on ? "RS" : "OVR" }), el("b", { text: String(p.overall) })]),
    ]);
  }

  // picking a tile: the flag and the card move, nothing else redraws, so browsing with the arrows is quick
  function choose(slug, focus) {
    const p = cache.roster && cache.roster.players.find((x) => x.slug === slug);
    if (!p) return;
    S.psel = slug;
    setParams();
    for (const t of host.querySelectorAll(".dc-tile")) {
      const on = t.dataset.slug === slug;
      t.classList.toggle("on", on);
      t.setAttribute("aria-selected", String(on));
      const flag = t.querySelector(".dc-tile-flag");
      if (on && !flag) t.prepend(el("span", { class: "dc-tile-flag", text: p.name }));
      if (!on && flag) flag.remove();
      if (on && focus) { t.focus({ preventScroll: true }); t.scrollIntoView({ block: "nearest" }); }
    }
    const card = host.querySelector(".dc-pcard");
    if (card) fillCard(card, p);
  }

  // the arrows walk the grid: left and right a tile, up and down a row
  function browse(key) {
    const tiles = [...host.querySelectorAll(".dc-tile")];
    if (!tiles.length) return;
    const i = Math.max(0, tiles.findIndex((t) => t.dataset.slug === S.psel));
    const cols = tiles.filter((t) => t.offsetTop === tiles[0].offsetTop).length || 1;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[key];
    const j = Math.max(0, Math.min(tiles.length - 1, i + step));
    if (j !== i) choose(tiles[j].dataset.slug, true);
  }

  // the card: what the box knows at once, then his whole profile (attributes, traits, stars, form) when it comes
  async function fillCard(card, p) {
    const key = `${ctx.season().id}|${ctx.season().current_week}|${S.team}|${p.slug}`;
    card.replaceChildren(...cardBody(p, profiles.get(key)));
    if (profiles.has(key)) return;
    try {
      const pr = await ctx.api(`/api/season/${ctx.season().id}/player?team=${encodeURIComponent(S.team)}&slug=${encodeURIComponent(p.slug)}`);
      profiles.set(key, pr);
      if (S.psel === p.slug && card.isConnected) card.replaceChildren(...cardBody(p, pr));
    } catch (err) { card.append(el("p", { class: "dc-muted", text: `Could not load his ratings: ${ctx.errText(err)}` })); }
  }

  function cardBody(p, pr) {
    const status = p.injury ? `${p.injury.type} · out ${p.injury.weeks_left}w` : p.redshirt && p.redshirt.on ? "Redshirting" : "Healthy";
    const depth = p.role && p.depth ? `${ROLE_NAME[p.role] || p.role} · ${ordinal(p.depth)}${p.starter ? " · starter" : ""}` : "Not on the chart";
    const info = (k, v) => el("div", { class: "dc-pc-info" }, [el("span", { class: "dc-kicker", text: k }), el("strong", { text: v })]);
    const attrs = pr ? pr.attributes || [] : [];
    const groups = [...new Set(attrs.map((a) => a.group))];
    const rs = p.redshirt;
    return [
      el("header", { class: "dc-pc-head" }, [
        el("span", { class: "dc-pc-pic" }, [face(p, "bust", "dc-pc-face")]),
        el("div", { class: "dc-pc-id" }, [
          el("h2", { class: "dc-pc-name", text: p.name }),
          el("div", { class: "dc-pc-tags" }, [
            el("span", { class: "dc-pc-no" }, [el("b", { text: p.jersey ? `#${p.jersey}` : "#–" }), el("span", { text: p.position })]),
            el("span", { class: "dc-pc-tag", text: CLASS_LABEL[p.class] || p.class || "" }),
            p.archetype ? el("span", { class: "dc-pc-tag", text: p.archetype }) : null,
            p.dev_trait ? el("span", { class: "dc-pc-tag", text: `${p.dev_trait} dev` }) : null,
            pr && pr.stars ? el("span", { class: "dc-pc-tag", title: `${pr.stars}-star recruit`, text: "★".repeat(pr.stars) }) : null,
          ]),
        ]),
        el("div", { class: "dc-pc-ovr" }, [el("small", { text: "OVR" }), el("b", { class: tier(p.overall), text: String(p.overall) })]),
      ]),
      el("div", { class: "dc-pc-mid" }, [
        el("div", { class: "dc-pc-infos" }, [
          info("Depth chart", depth),
          info("Size", [p.height, p.weight ? `${p.weight} lb` : ""].filter(Boolean).join(" · ") || "–"),
          info("Status", status),
          info("This season", p.headline || (p.games ? `${p.games} games` : "Has not played")),
          pr && pr.morale && pr.morale.enabled ? info("Form", pr.morale.label || "Steady") : null,
        ]),
        attrs.length >= 3 ? radar(attrs) : el("div", { class: "dc-pc-radar dc-muted", text: pr ? "" : "…" }),
      ]),
      pr && pr.traits && pr.traits.length ? el("div", { class: "dc-pc-traits" }, pr.traits.map((tr) =>
        el("span", { class: `dc-pc-trait t${tr.tier}`, title: tr.about || "" }, [el("b", { text: tr.name }), el("small", { text: tr.tier_name || "" })]))) : null,
      groups.length ? el("div", { class: "dc-pc-attrs" }, groups.map((g) => el("div", { class: "dc-pc-group" }, [
        el("div", { class: "dc-kicker", text: g }),
        ...attrs.filter((a) => a.group === g).map((a) => el("div", { class: "dc-pc-bar", title: a.about || "" }, [
          el("span", { text: a.label }), el("i", { style: `--v: ${a.value}%`, class: tier(a.value) }), el("b", { class: tier(a.value), text: String(a.value) }),
        ])),
      ]))) : null,
      el("footer", { class: "dc-pc-foot" }, [
        playerLink(p),
        p.role && !["KR", "PR"].includes(p.role) ? el("button", { type: "button", class: "dc-btn", text: "Open in list", onclick: () => go({ screen: "overview", view: "list", role: p.role, sel: p.slug }) }) : null,
        canEdit() && rs && (rs.can || rs.on) ? el("button", { type: "button", class: "dc-btn", text: rs.on ? "Off redshirt" : "Redshirt", onclick: () => redshirt(p, !rs.on) }) : null,
      ]),
    ];
  }

  // his six key attributes as a hexagon: three physical, the first three of his position's
  function radar(attrs) {
    const phys = ["top_speed", "burst", "strength"].map((k) => attrs.find((a) => a.key === k)).filter(Boolean);
    const own = attrs.filter((a) => a.group !== "Physical").slice(0, 6 - phys.length);
    const six = [...phys, ...own].slice(0, 6);
    const n = six.length, R = 64, C = 100;
    const at = (i, r) => { const t = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [C + r * Math.cos(t), C + r * Math.sin(t)]; };
    const ring = (r) => six.map((_, i) => at(i, r).map((v) => v.toFixed(1)).join(",")).join(" ");
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 200 200");
    svg.setAttribute("class", "dc-pc-radar");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", six.map((a) => `${a.label} ${a.value}`).join(", "));
    const add = (tag, attrsIn, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrsIn)) e.setAttribute(k, v); if (text != null) e.textContent = text; svg.append(e); return e; };
    for (const r of [R / 3, (2 * R) / 3, R]) add("polygon", { points: ring(r), class: "dc-radar-grid" });
    add("polygon", { points: six.map((a, i) => at(i, (R * a.value) / 99).map((v) => v.toFixed(1)).join(",")).join(" "), class: "dc-radar-shape" });
    six.forEach((a, i) => {
      const [x, y] = at(i, R + 22);
      add("text", { x: x.toFixed(1), y: (y - 4).toFixed(1), class: "dc-radar-label", "text-anchor": "middle" }, a.label.replace("Intermediate", "Mid").replace("Pass Pro: ", ""));
      add("text", { x: x.toFixed(1), y: (y + 11).toFixed(1), class: "dc-radar-value", "text-anchor": "middle" }, String(a.value));
    });
    return svg;
  }

  // ----- redshirts and availability ----------------------------------------------

  // the roster's players in the unit picked in the sidebar (by depth-chart role, else position)
  const UNIT_POS = { offense: ["QB", "RB", "WR", "TE", "OL"], defense: ["DL", "MLB", "ROLB", "LOLB", "OLB", "CB", "S"], special: ["K", "P"] };
  const inUnit = (p) => (unitOf(S.unit).roles.includes(p.role) || (!p.role && UNIT_POS[S.unit].includes(p.position)));

  async function redshirts(main) {
    await need("roster");
    const players = cache.roster.players.filter((p) => inUnit(p) && p.redshirt && (p.redshirt.on || p.redshirt.can));
    if (!cache.roster.players.some((p) => p.redshirt)) {
      toolbar(main, el("div", { class: "dc-summary" }), "Redshirts are for your own roster in a Coach Career, while the season is on.");
      return;
    }
    const sitting = players.filter((p) => p.redshirt.on);
    const can = players.filter((p) => !p.redshirt.on).sort((a, b) => b.overall - a.overall);
    toolbar(main, el("div", { class: "dc-summary" }, [stat("Redshirting", String(sitting.length)), stat("Still eligible", String(can.length))]),
      "Four games or fewer and the year unused: sit a player out and he keeps his year.");
    const list = el("div", { class: "dc-people" });
    const person = (p) => el("div", { class: "dc-person", "data-name": p.name.toLowerCase() }, [
      face(p, "head", "dc-chip-face"),
      el("div", { class: "dc-person-main" }, [el("strong", { text: p.name }), el("span", { class: "dc-muted", text: [p.position, CLASS_LABEL[p.class] || p.class, p.role && p.depth ? `${p.role} #${p.depth}` : ""].filter(Boolean).join(" · ") })]),
      el("span", { class: "dc-muted", text: `${p.redshirt.games} of ${p.redshirt.limit} games` }),
      el("span", { class: `dc-person-ovr ${tier(p.overall)}`, text: String(p.overall) }),
      canEdit() ? el("button", { type: "button", class: `dc-btn ${p.redshirt.on ? "dc-on" : ""}`, text: p.redshirt.on ? "Off redshirt" : "Redshirt", onclick: () => redshirt(p, !p.redshirt.on) }) : el("span"),
    ]);
    if (sitting.length) { list.append(el("div", { class: "dc-kicker", text: "Sitting out" })); sitting.forEach((p) => list.append(person(p))); }
    list.append(el("div", { class: "dc-kicker", text: "Eligible" }));
    if (can.length) can.forEach((p) => list.append(person(p)));
    else list.append(el("p", { class: "dc-muted", text: "Nobody else is eligible: everyone with a year to keep has played more than four games." }));
    main.append(list);
    highlight();
  }

  async function availability(main) {
    await need("roster");
    const s = ctx.season();
    const all = cache.roster.players;
    const out = all.filter((p) => inUnit(p) && (p.injury || (p.redshirt && p.redshirt.on)));
    toolbar(main, el("div", { class: "dc-summary" }, [stat("Injured", String(out.filter((p) => p.injury).length)), stat("Redshirting", String(out.filter((p) => !p.injury).length))]),
      "Who is hurt or sitting out, and who plays in his place.");
    if (!out.length) { main.append(el("p", { class: "dc-muted dc-empty", text: `Everyone on the ${unitOf(S.unit).name.toLowerCase()} is available.` })); return; }
    // who plays instead: the next man at his role who is neither hurt nor sitting
    const next = (p) => all.filter((x) => x.role === p.role && x.slug !== p.slug && !x.injury && !(x.redshirt && x.redshirt.on)).sort((a, b) => (a.depth || 99) - (b.depth || 99))[0];
    const list = el("div", { class: "dc-people" });
    for (const p of out.sort((a, b) => (a.depth || 99) - (b.depth || 99))) {
      const sub = next(p);
      list.append(el("div", { class: "dc-person", "data-name": p.name.toLowerCase() }, [
        face(p, "head", "dc-chip-face"),
        el("div", { class: "dc-person-main" }, [el("strong", { text: p.name }), el("span", { class: "dc-muted", text: [p.position, p.role && p.depth ? `${p.role} #${p.depth}` : ""].filter(Boolean).join(" · ") })]),
        el("span", { class: p.injury ? "dc-flag bad" : "dc-flag", text: p.injury ? `${p.injury.type} · back ${(s.week_labels && s.week_labels[p.injury.returns_week]) || "week " + p.injury.returns_week}` : "Redshirting" }),
        el("span", { class: "dc-muted", text: sub ? `In his place: ${shortName(sub.name)} (${sub.overall})` : "Nobody behind him" }),
        el("span", { class: `dc-person-ovr ${tier(p.overall)}`, text: String(p.overall) }),
      ]));
    }
    main.append(list);
    highlight();
  }

  // ----- keyboard ----------------------------------------------------------------

  function onKey(e) {
    if (!host || host.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.target.closest && e.target.closest("input, select, textarea")) || document.querySelector(".modal:not([hidden])")) return;
    if (e.key === "[") cycleUnit(-1);
    else if (e.key === "]") cycleUnit(1);
    else if (e.key === "/") { const i = host.querySelector(".dc-search-input"); if (i) { e.preventDefault(); i.focus(); } }
    else if (e.key === "Escape" && S.sel && S.screen === "overview" && S.view !== "list") { S.sel = null; render(); }
    else if (S.screen === "players" && e.key.startsWith("Arrow")) { e.preventDefault(); browse(e.key); }
    else if (S.screen === "players" && e.key === "Enter" && S.psel && e.target.closest && e.target.closest(".dc-tile")) {
      const p = cache.roster.players.find((x) => x.slug === S.psel);
      if (p) ctx.openPlayer(S.team, p.name, p.position);
    }
    else { const sc = SCREENS.find((x) => x.key === e.key); if (sc) go({ screen: sc.id, sel: null }); else return; }
  }

  // ----- open and close ------------------------------------------------------------

  window.CFPDepth = {
    // params: the URL's (unit, sub, view, f, role, team)
    open(c, params) {
      ctx = c;
      host = c.host;
      const s = ctx.season();
      S.team = params.get("team") && window.CFP.teamsBySlug[params.get("team")] ? params.get("team") : s.team;
      S.screen = SCREENS.some((x) => x.id === params.get("sub")) ? params.get("sub") : "overview";
      if (params.get("sub") === "personnel") params.set("view", "list");      // the old Personnel screen is the List view now
      S.unit = UNITS.some((u) => u.id === params.get("unit")) ? params.get("unit") : "offense";
      S.view = params.get("view") === "list" ? "list" : "formation";
      if (params.get("f")) S.form[S.unit] = params.get("f");
      S.role = unitOf(S.unit).roles.includes(params.get("role")) ? params.get("role") : unitOf(S.unit).roles[0];
      S.sel = null; S.q = "";
      S.psel = params.get("player") || null;
      host.hidden = false;
      document.body.classList.add("dc-open");
      document.addEventListener("keydown", onKey);
      window.addEventListener("resize", onResize);
      window.scrollTo({ top: 0 });
      render();
    },
    close() {
      if (!host) return;
      host.hidden = true;
      host.innerHTML = "";
      document.body.classList.remove("dc-open");
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    },
    isOpen: () => !!host && !host.hidden,
    // the season changed under it (a god-mode edit, a sim): load again
    refresh() { dropCache(); faces.clear(); profiles.clear(); if (host && !host.hidden) render(); },
  };
})();
