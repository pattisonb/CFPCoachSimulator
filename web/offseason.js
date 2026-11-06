/* Coach Career's offseason on the season page: who leaves (the draft, graduation, the transfer
   portal), keeping players home, four portal weeks to fill your roster, who improved, staff changes,
   then the next season. window.Offseason.render(season, box, helpers); helpers as for recruiting.js.
   Colors come from the theme variables (light and dark); the layout is in web/offseason.css.

   Every page has one frame: the header (the title, the stage chip, the stepper), the page's cards, and
   the footer (Back on the left, the primary Advance on the right). Two pages per stage:
     the Overview ("hub"): the hero, your numbers, the AD's meeting, the takeaway and your history. The
       tab opens on it at Departures; Back from any stage returns to it; its primary button opens the
       stage the offseason is on (no call to the server).
     the stage's own page: Departures, Keep Them Home, the portal weeks (the rules, your moves, who got away and
       a compact Your Portal Board card; the board itself is the Recruiting tab's, drawn by recruiting.js),
       Development, Staff, and the Recap at Ready (no Overview, no Back).
   Which page shows (view.page) and Development's tab (view.devTab) are in the address (opage, odev). */
(function () {
  "use strict";
  const { el } = window.CFP;
  const GROUPS = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"];
  const USAGE = { starter: "Started", rotation: "Rotation", bench: "Bench" };
  const KIND_ORDER = ["draft", "undrafted", "graduated", "portal", "quit", "stayed"];
  const SHOWN = 6;                 // rows a long list shows before "+ N More"
  const FIRST_SHOWN = 8;           // first-round picks shown before "+ N More"
  const BOARD_SHOWN = 6;           // entrants the portal week's Your Portal Board card lists
  const view = { position: "", status: "available", posPick: "", recapOpen: false,
                 page: "stage", pageFor: null, want: null, devTab: "redshirts", more: {}, closed: {} };
  const ui = window.CFP.ui;
  let H = null;
  let BOX = null;                 // #tab-offseason
  let drawn = null;               // what is on screen: { sid, stage }
  let last = null;                // the view on screen: { s, v } (a page switch or a tab draws from it)
  let seq = 0;                    // the latest fetch; an older one landing late is dropped

  const teamName = (slug) => (window.CFP.teamsBySlug[slug] || {}).name || slug;
  const loading = (text) => el("p", { class: "muted go-loading", text });
  const stars = (n) => (n ? "★".repeat(n) : "");
  const num = (n) => Number(n || 0).toLocaleString("en-US");
  // every offseason change carries the stage on screen: the server refuses one meant for a stage it has left
  const movedOn = (err) => /^409\b/.test((err && err.message) || "") && /moved on/.test(err.message);
  const staged = (body) => H.postJSON({ ...body, stage: drawn ? drawn.stage : null });

  // the stepper's short names, and where a primary button goes ("Advance to …")
  const SHORT = { departures: "Departures", retention: "Keep Them Home", portal_w1: "Portal (Week 1)", portal_w2: "Portal (Week 2)",
    portal_w3: "Portal (Week 3)", portal_w4: "Portal (Week 4)", development: "Development", staff: "Staff Changes", ready: "Recap" };
  const LONG = { departures: "Departures", retention: "Keep Them Home", portal_w1: "Transfer Portal (Week 1)", portal_w2: "Transfer Portal (Week 2)",
    portal_w3: "Transfer Portal (Week 3)", portal_w4: "Transfer Portal (Week 4)", portal_1: "Transfer Portal (Round 1)", portal_2: "Transfer Portal (Round 2)",
    development: "Development", staff: "Staff Changes", ready: "Recap" };
  const PAGE_OF = { departures: "departures", retention: "retention", portal_1: "portal", portal_2: "portal", development: "development", staff: "staff", ready: "ready" };
  const pageName = (stage) => PAGE_OF[stage] || (stage.startsWith("portal_w") ? "portal" : "ready");
  const isFirst = (v) => !!(v.stages && v.stages.length && v.stages[0].key === v.stage);   // Keep Them Home (an older save: Departures)

  // ----- small pieces -----------------------------------------------------------------------------
  const ICONS = {     // 24 px line icons (stroke currentColor), for Around the League and the Road Ahead
    grad: "M2 9l10-5 10 5-10 5z M6 11v5c3 2.5 9 2.5 12 0v-5",
    draft: "M4 12c0-5 4-8 8-8s8 3 8 8-4 8-8 8-8-3-8-8z M8 12h8 M10 10v4 M14 10v4",
    portal: "M4 8h14l-3-3 M20 16H6l3 3",
    left: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6 M17 11a3 3 0 1 0 0-6 M21 20c0-3-1.6-5.2-4-5.8",
    undrafted: "M12 4v9 M12 17v1 M4 20h16L12 4z",
    cal: "M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4",
    class: "M12 4l9 5-9 5-9-5z M7 12v5 M17 12v5",
    goal: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 12h.01",
    job: "M4 8h16v11H4z M9 8V5h6v3",
    swap: "M4 8h14l-3-3 M20 16H6l3 3",
  };
  function icon(name) {
    const span = el("span", { class: "off-icon", "aria-hidden": "true" });
    span.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name]}"/></svg>`;
    return span;
  }
  function avatar(seed, size) {          // a portrait from the coach sprite system, its look picked from his id (as recruiting.js does)
    let h = 0;
    for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const pick = (arr) => arr[(h = (h * 1103515245 + 12345) >>> 0) % arr.length];
    const look = { skin: pick(["#f1c9a5", "#e0b48f", "#c68e64", "#a26a42", "#7b4a2c", "#5a3520"]), hair: pick(["short", "buzz", "curly", "side part"]),
                   hair_color: pick(["#1d1410", "#3b2416", "#5a3a22", "#8a5a32", "#c49a5a"]), outfit: "hoodie" };
    const span = el("span", { class: `go-avatar ${size || ""}`, "aria-hidden": "true" });
    if (window.CoachSprite) span.innerHTML = window.CoachSprite(look, null);
    return span;
  }
  function stat(k, val, sub) {
    return el("div", { class: "go-stat off-stat" }, [el("div", { class: "go-kicker muted off-stat-label", text: k }), el("div", { class: "go-stat-val", text: val }),
      sub ? el("div", { class: "muted small", text: sub }) : null]);
  }
  const card = (cls, key, kids) => el("section", { class: `go-card ${cls || ""}`, "data-key": key }, kids);
  const kicker = (text, extra) => el("div", { class: "go-kicker" }, [text, extra || null]);
  // a row of cards: two equal columns ("g2") or two to one ("g21"); a lone card (or an odd last one) spans the row
  function row(kind, key, items) {
    const kids = items.filter(Boolean);
    if (kids.length % 2 === 1) kids[kids.length - 1].classList.add("off-span");
    return el("div", { class: `off-row off-${kind}`, "data-key": key }, kids);
  }
  // a column of cards in a row (its last card fills it, so the row's bottoms line up)
  const column = (key, items) => el("div", { class: "off-col", "data-key": key }, items.filter(Boolean));
  // "+ N More" under a long list: opens the rest in place (a patch)
  function more(key, hidden) {
    if (hidden <= 0 || view.more[key]) return null;
    const b = el("button", { type: "button", class: "go-link off-more", text: `+ ${hidden} More` });
    ui.on(b, "click", () => { view.more[key] = true; repaint(); });
    return b;
  }
  const cut = (key, list, n) => (view.more[key] ? list : list.slice(0, n || SHOWN));

  // the portal list's filters (the old two-round portal) and the page in the address (web/route.js, a replace)
  const syncRoute = () => {
    if (!window.CFP.route) return;
    const dev = drawn && drawn.stage === "development";
    window.CFP.route.set({ opos: view.position, ostatus: view.status !== "available" ? view.status || "all" : null,
      opage: drawn && drawn.stage !== "ready" ? view.page : null, odev: dev && view.page === "stage" && view.devTab !== "redshirts" ? view.devTab : null });
  };
  function applyRoute(r) {
    view.position = GROUPS.includes(r.opos) ? r.opos : "";
    view.status = ["offered", "signed"].includes(r.ostatus) ? r.ostatus : r.ostatus === "all" ? "" : "available";
    view.want = r.opage === "hub" || r.opage === "stage" ? r.opage : null;
    view.devTab = ["redshirts", "positions", "improved", "transfers"].includes(r.odev) ? r.odev : "redshirts";
  }

  function fetchView(s) {
    const q = new URLSearchParams();
    if (view.position) q.set("position", view.position);
    if (view.status) q.set("status", view.status);
    return H.api(`/api/season/${s.id}/offseason?${q}`);
  }

  // The full draw: opening the tab, and the offseason moving to its next stage.
  async function render(s, box, helpers) {
    H = helpers;
    BOX = box;
    const token = ++seq;
    box.innerHTML = "";
    box.append(loading("Opening the offseason…"));
    let v;
    try { v = await fetchView(s); }
    catch (err) {
      if (token !== seq) return;
      box.innerHTML = "";
      box.append(loading(`Could not open the offseason: ${H.errText(err)}`));
      return;
    }
    if (token !== seq) return;
    box.innerHTML = "";
    draw(s, v, box, false);
  }

  // Fetch again and patch what is on screen to match (web/ui.js morph): the cards stay, the scroll
  // stays. opts.pulse (after an action) flashes what changed; a filter change does not. A new stage
  // (or another career) draws in full.
  async function refresh(s, opts) {
    const box = BOX;
    const token = ++seq;
    const v = await fetchView(s);
    if (token !== seq) return;
    if (!box || !box.isConnected || !drawn || drawn.sid !== s.id || drawn.stage !== v.stage) {
      box.innerHTML = "";
      draw(s, v, box, false);
      return;
    }
    const fresh = el("div");
    draw(s, v, fresh, true);
    ui.morph(box, fresh, opts);
  }

  // the view on screen drawn again and patched in (a tab, "+ N More"): nothing fetched, nothing flashes
  function repaint() {
    if (!last || !BOX || !BOX.isConnected) return;
    const fresh = el("div");
    draw(last.s, last.v, fresh, true);
    ui.morph(BOX, fresh);
  }

  // the Overview and the stage's page: another page of the same view, drawn from it (no fetch)
  function goPage(page) {
    if (!last) return;
    view.page = page;
    view.want = null;
    BOX.innerHTML = "";
    draw(last.s, last.v, BOX, false);
    syncRoute();
    const top = BOX.getBoundingClientRect().top + window.scrollY - 80;
    if (window.scrollY > top) window.scrollTo({ top: Math.max(0, top) });
    const h = BOX.querySelector(".off-title");
    if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
  }

  // One decision button: the button is busy, the call goes out, the screen patches, a toast says what
  // happened (said: text, or a function of the call's answer). Errors keep their toasts (fail).
  function act(ev, s, call, said, opt = {}) {
    const btn = ev && ev.currentTarget instanceof HTMLElement ? ev.currentTarget : null;
    const work = (async () => {
      let r;
      try { r = await call(); }
      catch (err) {
        if (movedOn(err)) { H.toast(H.errText(err), 4000); render(s, BOX, H); return; }   // the screen was a stage behind: draw the one it is on
        if (opt.fail) opt.fail(err); else H.toast(H.errText(err));
        return;
      }
      try { await refresh(s, { pulse: true }); if (opt.after) await opt.after(r); }
      catch (err) { H.toast(`Could not refresh the offseason: ${H.errText(err)}`, 4000); return; }
      const msg = typeof said === "function" ? said(r) : said;
      if (msg) H.toast(msg, 3500);
    })();
    return btn ? ui.busy(btn, work) : work;
  }

  // ----- the frame ---------------------------------------------------------------------------------
  function stepper(v) {
    return el("ol", { class: "off-steps", "aria-label": "Offseason steps" }, v.stages.map((st, i) =>
      el("li", { class: `off-step ${st.done ? "done" : ""} ${st.current ? "now" : ""}`, "aria-current": st.current ? "step" : null }, [
        el("span", { class: "off-step-mark", text: st.done ? "✓" : String(i + 1) }), el("span", { class: "off-step-name", text: SHORT[st.key] || st.name })])));
  }
  function header(v, title) {
    const at = Math.max(0, v.stages.findIndex((st) => st.current));
    const chip = v.stage === "ready" ? el("span", { class: "off-chip good", text: "✓ Offseason Complete" })
      : el("span", { class: "off-chip", text: `Stage ${at + 1} of ${v.stages.length}` });
    return el("header", { class: "off-head", "data-key": "head" }, [el("div", { class: "off-head-row" }, [el("h2", { class: "go-display l off-title", text: title }), chip]), stepper(v)]);
  }
  // Back on the left, Sim to Next Season and the primary button on the right
  function footer(s, v, opt) {
    const go = el("button", { type: "button", class: `go-btn primary big off-next ${opt.center ? "off-start" : ""}`, text: opt.label });
    ui.on(go, "click", opt.onGo);
    const right = [go];
    if (v.stage !== "ready") {
      const all = el("button", { type: "button", class: "go-btn off-sim", text: "Sim to Next Season" });
      ui.on(all, "click", (ev) => { if (window.confirm("Sim the rest of the offseason? Every decision still open (players deciding, the portal, your staff) is made for you.")) advance(s, BOX, ev.currentTarget, "next_season"); });
      right.unshift(all);
    }
    let left = el("span");
    if (opt.back) {
      left = el("button", { type: "button", class: "go-btn off-back", text: "Back to Offseason" });
      ui.on(left, "click", () => goPage("hub"));
    }
    return el("div", { class: `go-play off-actions off-foot ${opt.center ? "center" : ""}`, "data-key": "foot" }, [opt.center ? null : left, el("div", { class: "off-go" }, right)]);
  }
  // the primary button on a stage's page: where the next stage is ("Advance to …"), never what it does
  function nextLabel(v) {
    const w = v.stage.startsWith("portal_w") ? Number(v.stage.slice(-1)) : 0;
    if (w) return w < 4 ? `Advance to Transfer Portal (Week ${w + 1})` : "Close the Portal and Advance";
    return { retention: "Advance to Departures", departures: v.retention ? "Advance to Transfer Portal (Week 1)" : "Advance to the Transfer Portal", portal_1: "Advance to Portal Round 2", portal_2: "Close the Portal and Advance",
      development: "Advance to Staff Changes", staff: "Finish the Offseason", ready: `Start the ${v.year} Season` }[v.stage];
  }

  // the stage drawn into root; patching: drawn off screen to patch the live one
  function draw(s, v, root, patching) {     // root: the live box, or a detached one to patch from (handlers use BOX)
    drawn = { sid: s.id, stage: v.stage };
    last = { s, v };
    const key = `${s.id}:${v.stage}`;
    if (view.pageFor !== key) {               // a stage (or career) drawn for the first time: the tab opens on the Overview at the first step
      view.pageFor = key;
      view.page = view.want || (isFirst(v) ? "hub" : "stage");
      view.more = {};
      if (v.stage !== "development") view.devTab = "redshirts";
    } else if (view.want) view.page = view.want;
    view.want = null;
    if (v.stage === "ready") view.page = "stage";
    const hub = view.page === "hub";
    const page = el("div", { class: "off-page", "data-page": hub ? "hub" : pageName(v.stage), "data-key": `page-${hub ? "hub" : v.stage}` });
    const fired = v.fired && !["staff", "ready"].includes(v.stage) ? firedNote(v) : null;
    const advanceGo = (ev) => advance(s, BOX, ev.currentTarget, v.stage === "ready" ? "next_season" : null);
    if (hub) {
      page.append(header(v, `Offseason · On to ${v.year}`));
      if (fired) page.append(fired);
      drawHub(s, v, page);
      page.append(footer(s, v, { label: `Advance to ${LONG[v.stage] || "the Next Step"}`, onGo: () => goPage("stage") }));
    } else {
      const p = v.portal || {};
      const title = v.stage.startsWith("portal_w") ? `Transfer Portal · Week ${p.week} of ${p.weeks}` : v.stage === "portal_1" || v.stage === "portal_2" ? `Transfer Portal · Round ${p.round} of 2`
        : v.stage === "ready" ? "Offseason Recap" : v.stage === "staff" ? "Staff Changes" : v.stage_name;
      page.append(header(v, title));
      if (fired && v.stage !== "departures") page.append(fired);
      if (v.stage === "departures") drawDepartures(s, v, page, patching);
      else if (v.stage === "retention") drawRetention(s, v, page);
      else if (v.stage === "portal_1" || v.stage === "portal_2") drawOldPortal(s, v, page);
      else if (v.stage.startsWith("portal_w")) drawPortalWeek(s, v, page, patching);
      else if (v.stage === "development") drawDevelopment(s, v, page, patching);
      else if (v.stage === "staff") drawStaff(s, v, page);
      else drawReady(v, page, s);
      page.append(footer(s, v, { label: nextLabel(v), onGo: advanceGo, back: v.stage !== "ready", center: v.stage === "ready" }));
    }
    root.append(page);
    if (!patching) syncRoute();
  }

  function firedNote(v) {
    return card("off-fired", "fired", [kicker("You Have Been Let Go"),
      el("p", { text: `The program's next coach runs the rest of the ${v.year} offseason. Walk the steps and pick your next job at the Staff step.` })]);
  }

  const clsWord = (c) => (c && c.endsWith("RS") ? `RS ${c.slice(0, -2)}` : c);   // FRRS -> "RS FR"
  function meter(sec) {
    const cls = sec < 25 ? "bad" : sec < 40 ? "warn" : "good";
    return el("div", { class: `off-meter ${cls}`, role: "img", "aria-label": `Job security ${sec < 25 ? "low" : sec < 40 ? "shaky" : "solid"}` },
      [el("div", { class: "off-meter-fill", style: `width:${Math.max(2, Math.min(100, sec))}%` })]);
  }

  // ----- the Overview --------------------------------------------------------------------------------
  const HERO = {
    retention: (v) => `Keep key players home, see who left and fill your roster from the portal for ${v.year}.`,
    departures: () => "Your answers are in and the draft is done. See who left, who was picked and who you kept.",
    portal: (v) => `Week ${v.portal.week} of ${v.portal.weeks}: recruit transfers on your board on the Recruiting tab. Entrants with offers decide at the week's end.`,
    portal_old: () => "Offer transfers from the portal table. Entrants with offers pick a school when the round ends.",
    development: () => "The portal is closed. See who improved, check the redshirts and move players between positions.",
    staff: () => "Fill the jobs on your staff, hire from the coaching market and see the carousel around the league.",
  };
  function drawHub(s, v, page) {
    const kind = v.stage.startsWith("portal_w") ? "portal" : v.stage === "portal_1" || v.stage === "portal_2" ? "portal_old" : v.stage;
    const hero = card("off-hero", "hero", [el("div", { class: "go-kicker off-hero-kick", text: "Offseason" }),
      el("div", { class: "off-hero-title", text: isFirst(v) ? "Ready for the Offseason" : `Up Next: ${LONG[v.stage]}` }),
      el("p", { class: "off-hero-line", text: (HERO[kind] || HERO.staff)(v) })]);
    const deciding = v.retention && !v.retention.results && v.retention.players.length ? v.retention.players.length : 0;
    const numbers = card("off-numbers-card", "numbers", [el("div", { class: "off-numbers" }, [
      stat("Roster", `${v.roster} / ${v.roster_limit || 85}`, deciding ? `${deciding} deciding whether to stay` : null), stat("Class Signed", String(v.signed)),
      stat("Open Spots", String(v.open_spots)), stat("Portal Placed", `${v.portal.signed} of ${v.portal.entrants}`)])]);
    page.append(row("g2", "hub-top", [hero, numbers]));
    if (v.review) page.append(row("g2", "hub-review", [renderReview(s, v), takeaway(v.review)]));
    if (v.history.length) page.append(renderHistory(v));
  }

  function renderReview(s, v) {
    const r = v.review;
    const tone = r.security < 25 ? "bad" : r.security < 40 ? "warn" : "good";
    const card_ = card("off-review", "review", [kicker("Your Meeting With the AD"),
      el("dl", { class: "off-kv" }, [el("dt", { text: "The Goal" }), el("dd", { text: r.goal }),
        el("dt", { text: "Your Record" }), el("dd", { text: `${r.record[0]}-${r.record[1]}` }),
        el("dt", { text: "Job Security" }), el("dd", { class: `off-tone ${tone}`, text: r.mood || "" }),
        el("dt", { text: "His Patience" }), el("dd", { text: `${r.patience} ${r.patience === 1 ? "Year" : "Years"}` }),
        el("dt", { text: "Year" }), el("dd", { text: `${r.tenure} in the Job` })]),
      meter(r.security)]);
    if (r.decided) {
      if (r.fired) card_.append(el("p", { class: "bad-text", text: "Firing happens only at the end of a season; you will pick your next job at the Staff step." }));
      return card_;
    }
    if (!v.review_open) return card_;
    card_.append(el("p", { class: "muted off-ask", text: r.risk === "fire" ? "He is deciding whether to make a change. What do you say?"
      : "A warning. What do you say?" }));
    const acts = el("div", { class: "off-review-acts" });
    const said = { case: "You make your case to the AD", year: "You ask the AD for one more year", nothing: "You say nothing to the AD" };
    const send = (ev, action, staffId, line) =>
      act(ev, s, () => H.api(`/api/season/${s.id}/offseason/review`, staged({ action, staff_id: staffId || null })), line || said[action]);
    const tips = { case: "Point to the class you signed and the players you developed; a little goodwill.",
      change: "Let a coordinator go; the AD sees a coach who will not stand pat.",
      year: "He always says yes, but the goal must be met next season or you are gone.",
      nothing: "Leave it to him." };
    for (const o of r.options) {
      if (o === "change") {
        const coords = (v.your_staff || []).filter((x) => x.role === "OC" || x.role === "DC");
        for (const c of coords) {
          const b = el("button", { type: "button", class: "go-act" }, [`Let ${c.role} ${c.name} go`, el("span", { text: tips.change })]);
          ui.on(b, "click", (ev) => send(ev, "change", c.id, `You let ${c.role} ${c.name} go`));
          acts.append(b);
        }
        continue;
      }
      const b = el("button", { type: "button", class: "go-act" }, [r.option_names[o], el("span", { text: tips[o] })]);
      ui.on(b, "click", (ev) => send(ev, o));
      acts.append(b);
    }
    card_.append(acts);
    return card_;
  }

  // The AD's words, his answer once given, and the pool's math for the portal: "60 left + 40 earned (nine
  // wins, AD goal met) = 100", "raised to the 85 portal fund" when the collective's floor applied, then what
  // keeping players home cost and what carries into next year once the portal has closed.
  function takeaway(r) {
    const c = card("off-takeaway", "takeaway", [kicker("The Takeaway"), el("p", { class: "off-why", text: r.words })]);
    if (r.decided && r.outcome && r.outcome !== r.words) c.append(el("p", { class: "off-why" }, [el("b", { text: r.outcome })]));
    const n = r.nil_portal;
    if (n) {
      const why = (n.reward_why || []).join(", ");
      let text = `${n.left} left + ${n.reward} earned${why ? ` (${why})` : ""} = ${n.left + n.reward}`;
      if (n.pool === n.floor && n.pool > n.left + n.reward) text += `, raised to the ${n.floor} portal fund`;
      const notes = [];
      if (n.retained > 0) notes.push(`${n.retained} spent keeping players home.`);
      if (n.carry != null) notes.push(`${n.carry} carries into next year.`);
      c.append(el("div", { class: "off-nil", "data-key": "nil" }, [el("div", { class: "go-kicker muted", text: "NIL for the Portal" }),
        el("b", { class: "off-nil-line", text }), notes.length ? el("p", { class: "muted small off-nil-notes", text: notes.join(" ") }) : null]));
    }
    return c;
  }

  // While an advance is out: a cover over the tab ("Working Through the Offseason"), the stage under it
  // inert and aria-busy; season.js holds every other change until the call is back. Returns the undo.
  function holdTab(box) {
    const cover = el("section", { class: "go-card off-busy", role: "status", "data-key": "busy" }, [
      el("span", { class: "off-busy-spin", "aria-hidden": "true" }),
      el("div", {}, [el("div", { class: "go-kicker", text: "Working Through the Offseason" }),
        el("p", { class: "muted small", text: "This takes a moment; everything waits until it is done." })])]);
    const under = [...box.children];
    for (const n of under) n.inert = true;
    box.setAttribute("aria-busy", "true");
    box.classList.add("off-held");
    box.prepend(cover);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      cover.remove();
      for (const n of under) n.inert = false;
      box.removeAttribute("aria-busy");
      box.classList.remove("off-held");
    };
  }

  async function advance(s, box, btn, to) {
    if (H.holding && H.holding()) { H.api(`/api/season/${s.id}/offseason/advance`, staged({})).catch(() => {}); return; }   // says "Hold on", sends nothing
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = to ? "Working Through the Offseason…" : "Working…";
    const lift = holdTab(box);
    const wk = /^portal_w(\d)$/.exec((drawn && drawn.stage) || "");   // a portal week's step: say where your recruits went
    try {
      const r = await (H.long || H.api)(`/api/season/${s.id}/offseason/advance`, staged(to ? { to } : {}));
      lift();
      if (r.next_season) {
        H.toast(`On to ${r.year}: a new season and a new class of recruits.`, 3500);
        await H.openSeason(s.id);          // in place: no reload, no loading screen
        return;
      }
      window.scrollTo({ top: 0 });
      render(s, box, H);            // the next stage: a full draw
      const gone = wk ? (((r.portal && r.portal.away && r.portal.away.length ? r.portal.away : (r.portal_recap || {}).away)) || []).filter((x) => x.week === Number(wk[1])) : [];
      if (gone.length) H.toast(`${awaySentence(gone[0])}${gone.length > 1 ? ` ${gone.length - 1} more of your recruits went elsewhere: see Who Got Away.` : ""}`, 6000);
    } catch (err) {
      lift();
      btn.disabled = false;
      btn.textContent = label;
      if (movedOn(err)) { H.toast(H.errText(err), 4000); render(s, box, H); return; }
      H.toast(`Could not continue: ${H.errText(err)}`);
    }
  }

  // ----- your roster: who takes a redshirt (Departures), who changes position (Departures, Development) -----
  const POS_NAMES = { QB: "QB", HB: "HB", FB: "FB", WR: "WR", TE: "TE", LT: "LT", LG: "LG", C: "C", RG: "RG", RT: "RT", LEDG: "LEDG", REDG: "REDG", DT: "DT",
    SAM: "SAM", MIKE: "MIKE", WILL: "WILL", CB: "CB", FS: "FS", SS: "SS", K: "K", P: "P" };
  const NEXT_CLASS = { FR: "SO", FRRS: "SORS", SO: "JR", SORS: "JRRS", JR: "SR", JRRS: "SRRS" };
  const decision = (p) => (p.redshirt ? `Redshirt → ${clsWord(`${p.cls}RS`)}` : `Plays On → ${clsWord(NEXT_CLASS[p.cls] || p.cls)}`);
  function redshirtToggles(s, v) {
    const rs = v.redshirts;
    const picked = rs.players.filter((p) => p.redshirt).length;
    const out = [el("div", { class: "go-kicker muted off-sub" }, [`Redshirts · ${picked} of ${rs.players.length} `,
      ui.tip("Four games or fewer and the year unused: a redshirt keeps his class for next season (he still develops). Freshmen off the depth chart's top take it unless you say otherwise.", "Redshirts")])];
    if (rs.decided) out.push(el("p", { class: "muted small", text: "Decided: the classes below are set for next season." }));
    if (!rs.players.length) out.push(el("p", { class: "muted", text: "Nobody on your roster can take a redshirt this year." }));
    const list = el("div", { class: "off-rs", "data-key": "rs" });
    for (const p of rs.players) {
      const b = el("button", { type: "button", class: `go-act ${p.redshirt ? "on" : ""}`, "aria-pressed": String(p.redshirt), "data-key": p.id, ...(rs.decided ? { disabled: "true" } : {}),
        title: `${p.name}: played ${p.games} of ${p.team_games} games · ${p.use === "starter" ? "a starter" : p.use === "rotation" ? "in the rotation" : "off the depth chart"}` },
        [el("b", { text: p.name }), el("span", { text: `${p.pos} · ${clsWord(p.cls)} · ${p.overall} OVR · ${p.games} of ${p.team_games} games` }),
         el("span", { class: `go-tag ${p.redshirt ? "good" : "muted"}`, text: decision(p) })]);
      if (!rs.decided) ui.on(b, "click", (ev) => act(ev, s, () => H.api(`/api/season/${s.id}/offseason/redshirt`, staged({ pid: p.id, on: !p.redshirt })),
        p.redshirt ? `Plays on: ${p.name}` : `Redshirt: ${p.name}`));
      list.append(b);
    }
    out.push(list);
    return out;
  }
  // position changes: pick a player, see what he would be everywhere, move him
  function positionMoves(s, v, patching) {
    const out = [el("div", { class: "go-kicker muted off-sub" }, [`Position Changes · ${(v.position_changes || []).length} `,
      ui.tip("Move a player to another spot; his overall follows our formula there. Changes apply at once.", "Position Changes")])];
    const option = (r) => el("option", { value: r.id, text: `${r.pos} · ${r.name} · ${clsWord(r.cls)} · ${r.overall} OVR${r.moved_from ? ` (was ${r.moved_from})` : ""}${r.transfer ? ` · transfer from ${teamName(r.transfer)}` : ""}` });
    const roster = v.my_roster || [];
    const transfers = roster.filter((r) => r.transfer);
    if (view.posPick && !roster.some((r) => r.id === view.posPick)) view.posPick = "";
    const pick = el("select", { class: "go-sel", "aria-label": "Player to move" }, [el("option", { value: "", text: "Pick a Player…" }),
      ...(transfers.length ? [el("optgroup", { label: "Transfers" }, transfers.map(option)), el("optgroup", { label: "Everyone Else" }, roster.filter((r) => !r.transfer).map(option))]
        : roster.map(option))]);
    pick.value = view.posPick;
    // his options as chips (keyed by position, patched in place); a patch of the card keeps them (data-keep)
    const opts = el("div", { class: "off-pos-opts", "data-keep": "" });
    const nameOf = (pid) => (roster.find((r) => r.id === pid) || {}).name || "He";
    const loadOpts = async (live) => {
      const pid = view.posPick;
      const fresh = el("div");
      if (pid) {
        const d = await H.api(`/api/season/${s.id}/offseason/position_options?pid=${encodeURIComponent(pid)}`);
        if (pid !== view.posPick) return;
        for (const o of d.options) {
          const b = el("button", { type: "button", class: `go-chip small ${o.current ? "on" : ""}`, "data-key": o.pos, text: `${POS_NAMES[o.pos] || o.pos} ${o.overall}`, ...(o.current ? { disabled: "true" } : {}), title: o.current ? "His position now" : `Move him to ${o.pos}: ${o.overall} OVR there` });
          if (!o.current) ui.on(b, "click", (ev) => act(ev, s, () => H.api(`/api/season/${s.id}/offseason/position`, staged({ pid, pos: o.pos })),
            `${nameOf(pid)} moves to ${o.pos}`, { after: () => loadOpts(live) }));
          fresh.append(b);
        }
      }
      ui.morph(live, fresh);
    };
    ui.on(pick, "change", (ev) => {
      view.posPick = ev.currentTarget.value;
      const live = ev.currentTarget.closest(".off-roster").querySelector(".off-pos-opts");
      loadOpts(live).catch((err) => H.toast(H.errText(err)));
    });
    if (view.posPick && !patching) loadOpts(opts).catch((err) => H.toast(H.errText(err)));
    out.push(el("div", { class: "go-row wrap" }, [pick]), opts);
    if ((v.position_changes || []).length) out.push(el("ul", { class: "off-list", "data-key": "moves" }, v.position_changes.map((m) => {
      const undo = el("button", { type: "button", class: "go-link", text: "Undo" });
      ui.on(undo, "click", (ev) => act(ev, s, () => H.api(`/api/season/${s.id}/offseason/position`, staged({ pid: m.id, pos: m.from })), `${m.name} moves back to ${m.from}`,
        { after: () => loadOpts(document.querySelector("#tab-offseason .off-pos-opts")) }));
      return el("li", { "data-key": m.id }, [el("b", { text: m.name }), ` ${m.from} → ${m.to} · ${m.overall} OVR `, undo]);
    })));
    return out;
  }

  // ----- Departures ---------------------------------------------------------------------------------
  function drawDepartures(s, v, page, patching) {
    const r = v.review;
    if (r && !r.decided) {
      const b = el("button", { type: "button", class: "go-btn primary", text: "Back to the Meeting" });
      ui.on(b, "click", () => goPage("hub"));
      page.append(card("off-ad-wait", "ad-wait", [kicker("Your Meeting With the AD"),
        el("div", { class: "off-wait-row" }, [el("p", { text: "The AD is waiting for your answer before the offseason moves on." }), b])]));
    }
    if (v.fired) page.append(firedNote(v));
    const mine = v.departures.mine;
    const all = mine.concat(v.departures.stayed || []);       // who left, then who you kept home
    const leaving = card("off-leaving", "leaving", [kicker(`Leaving Your Program · ${mine.length}`)]);
    for (const kind of KIND_ORDER) {
      const rows = all.filter((d) => d.kind === kind).sort((a, b) => (a.pick || 999) - (b.pick || 999) || b.overall - a.overall);
      if (!rows.length) continue;
      const shown = cut(`kind-${kind}`, rows);
      const table = el("table", { class: "off-table off-dep-table" }, [el("thead", {}, [el("tr", {}, [el("th", { text: "Player" }), el("th", { class: "num", text: "Pos" }), el("th", { class: "num", text: "OVR" })])]),
        el("tbody", {}, shown.map((d) => el("tr", { "data-key": d.id }, [
          el("td", {}, [el("b", { text: d.name }), d.kind === "draft" ? el("span", { class: "go-tag good off-pick", text: `Round ${d.round}, Pick ${d.pick}${d.early ? " · Early" : ""}` }) : null]),
          el("td", { class: "num", text: d.pos }), el("td", { class: "num", text: String(d.overall) })])))]);
      const det = el("details", { class: "off-group", "data-key": `kind-${kind}`, ...(view.closed[kind] ? {} : { open: "" }) }, [
        el("summary", { class: "off-group-sum", text: `${rows[0].kind_name} · ${rows.length}` }), table, more(`kind-${kind}`, rows.length - shown.length)]);
      ui.on(det, "toggle", (ev) => { view.closed[kind] = !ev.currentTarget.open; });
      leaving.append(det);
    }
    if (!all.length) leaving.append(el("p", { class: "muted", text: "Nobody leaves." }));
    const lg = v.departures.league;
    const line = (ic, label, value) => el("li", {}, [icon(ic), el("span", { class: "muted", text: label }), el("b", { text: value })]);
    const league = card("off-league", "league", [kicker("Around the League"), el("ul", { class: "off-icons" }, [
      line("grad", "Graduated", num(lg.graduated)),
      line("draft", "Drafted", `${num(lg.draft)} (${num(v.departures.early_entrants)} early)`),
      lg.undrafted ? line("undrafted", "Declared, Undrafted", num(lg.undrafted)) : null,
      line("portal", "Entered the Portal", num(lg.portal)),
      line("left", "Left Their Teams", num(lg.quit))].filter(Boolean))]);
    const fr = v.departures.first_round;
    const firstShown = cut("first", fr, FIRST_SHOWN);
    const first = card("off-first", "first", [kicker("The First Round"),
      fr.length ? el("ol", { class: "off-draft" }, firstShown.map((d) => el("li", { "data-key": d.id || `p${d.pick}` }, [
        el("span", { class: "muted off-pick-no", text: `${d.pick}.` }), window.CFP.teamPill(d.team), el("b", { text: d.name }),
        el("span", { class: "muted", text: `${d.pos} · ${d.team_name}${d.early ? " · early" : ""}` })])))
        : el("p", { class: "muted", text: "Nobody was drafted." }),
      more("first", fr.length - firstShown.length)]);
    page.append(row("g21", "departures", [leaving, column("league-col", [league, first])]));
    const roster = card("off-roster", "roster", [kicker("Your Roster")]);
    if (v.redshirts) roster.append(...redshirtToggles(s, v));
    roster.append(...positionMoves(s, v, patching));
    page.append(roster);
  }

  // ----- Keep Them Home: your leavers with eligibility left, what each wants, and your moves (API: offseason/retain)
  function drawRetention(s, v, page) {
    const r = v.retention;
    const retain = (ev, pid, action, said, nil) => act(ev, s, () => H.api(`/api/season/${s.id}/offseason/retain`, staged({ pid, action, nil: nil || 0 })), said,
      { fail: (err) => H.toast(`Could not do that: ${H.errText(err)}`, 4000) });
    const strip = card("off-keep-strip", "keep-head", [el("div", { class: "off-strip3" }, [stat("Players Want Out", String(r.players.length)),
      stat("Next Year's NIL", `${r.left} / ${r.budget}`), stat("NIL Committed", String(r.spent))]),
      el("p", { class: "muted small off-rules" }, [`${r.players.length} of your players with eligibility left mean to leave: transfers and early draft entrants. Meet each one to hear what it would take. `,
        "A promised starting role only counts if your depth chart would really start him; NIL comes out of next year's budget, so it is money you will not have for recruits or the portal. ",
        "Nobody decides until you advance, and the draft runs after: a player you keep is never drafted. Graduating seniors are gone either way."])]);
    if (!r.players.length) strip.append(el("p", { class: "muted", text: "Nobody with eligibility left wants out. Advance to see who left." }));
    page.append(strip);
    const cards = el("div", { class: "go-cards off-keep", "data-key": "keep" });
    for (const e of r.players) {
      const c = el("article", { class: `go-card go-pcard off-leaver ${e.offers.released ? "released" : ""}`, "data-key": e.id });
      c.append(el("div", { class: "off-leaver-top" }, [avatar(e.id), el("div", { class: "off-leaver-id" }, [
        el("div", { class: "off-leaver-name" }, [el("b", { class: "go-name", text: e.name }),
          el("span", { class: `go-tag ${e.intent === "draft" ? "warn" : "bad"}`, text: e.intent === "draft" ? "NFL Draft" : "Transfer Portal" })]),
        el("div", { class: "muted small" }, [`${e.pos} · ${clsWord(e.cls)} Next Year · ${e.overall} OVR `, e.stars ? el("span", { class: "go-stars", text: stars(e.stars) }) : null])]),
        el("dl", { class: "off-roles" }, [el("div", {}, [el("dt", { text: "Now" }), el("dd", { text: e.role_now_name })]),
          el("div", { title: "Where he would sit on your depth chart next season" }, [el("dt", { text: "Next Year" }), el("dd", { class: e.role_next === "starter" ? "off-tone good" : "", text: e.role_next_name })])])]));
      c.append(el("p", { class: "off-why" }, [el("b", { text: "Why: " }), `${e.reason}${e.draft_pick ? ` (projected pick ${e.draft_pick})` : ""}${/[.!?]$/.test(e.reason || "") ? "" : "."}`]));
      if (e.elite) c.append(el("p", { class: "small off-elite", "data-key": "elite" }, [el("b", { text: "Nearly Impossible to Keep: " }),
        `Rated ${e.overall} after a strong season, he is a projected top pick. He stays about 1 in ${Math.round(1 / (r.elite_stay || 0.02))} times, whatever you offer.`]));
      const askText = !e.ask.known ? "Meet with him to hear what it would take."
        : e.ask.kind === "playing_time" ? `He wants a starting role${e.ask.nil ? `; short of that, about ${e.ask.nil} NIL would do it` : ""}.`
        : `He wants about ${e.ask.nil} NIL to stay.`;
      const offers = [];
      if (e.offers.promise) offers.push(e.role_next === "starter" ? "Promised a starting role" : "Promised a starting role he would not get");
      if (e.offers.nil) offers.push(`${e.offers.nil} NIL on the table`);
      if (e.offers.released) offers.push("Letting him go");
      const nil = el("input", { type: "number", min: "0", step: "5", value: String(e.offers.nil || e.ask.nil || 0), class: "go-nil", id: `keep-nil-${e.id}`, "aria-label": `NIL offer for ${e.name}` });
      c.append(el("div", { class: "off-leaver-ask" }, [el("div", {}, [el("p", { class: "muted small", text: askText }),
        offers.length ? el("p", { class: "small" }, [el("b", { text: "Your Offer: " }), offers.join(" · ")]) : null]),
        el("div", { class: "off-keep-nil" }, [e.chance_word ? el("span", { class: `go-tag ${e.chance >= 0.65 ? "good" : e.chance >= 0.4 ? "warn" : "bad"}`, text: e.chance_word }) : null,
          el("label", { for: `keep-nil-${e.id}`, class: "muted small", text: "NIL Offer" }), nil])]));
      const btn = (label, sub, onclick, tone, off) => { const b = el("button", { type: "button", class: `go-act ${tone || ""}` }, [el("b", { text: label }), el("span", { text: sub })]); if (off) b.setAttribute("disabled", ""); ui.on(b, "click", onclick); return b; };
      c.append(el("div", { class: "go-actions off-keep-acts" }, [
        btn("Meet", e.met ? "Done: you heard his ask." : "Free: hear his ask.", (ev) => retain(ev, e.id, "meet", `Met with ${e.name}`), "", e.met),
        btn("Promise a Start", e.role_next === "starter" ? "He would start." : "He would not.", (ev) => retain(ev, e.id, "promise", `Promised ${e.name} a start`), e.role_next === "starter" ? "go" : "", e.offers.promise),
        btn("Offer NIL", "From next year's NIL.", (ev) => {        // the amount typed in the live box beside the button
          const amount = Number(document.getElementById(`keep-nil-${e.id}`).value) || 0;
          retain(ev, e.id, "nil", `Offer to ${e.name} · ${amount} NIL`, amount);
        }, "alt"),
        btn("Let Him Go", e.offers.released ? "Letting him go." : "No NIL, no promise.", (ev) => { if (window.confirm(`Let ${e.name} go? He leaves when you advance; no NIL, no promise.`)) retain(ev, e.id, "release", `Letting ${e.name} go`); }, "", e.offers.released)]));
      cards.append(c);
    }
    if (r.players.length) page.append(cards);
  }

  // ----- the transfer portal, week by week: the rules, the answers from Keep Them Home, your moves, and your board in brief
  function movesCard(s, moves) {
    return card("off-moves", "moves", [kicker("Your Moves"), el("ul", { class: "off-lines" }, moves.map((m) => el("li", { "data-key": `${m.id}-${m.to}` }, [
      icon("swap"), el("b", { text: m.name }), el("span", { class: "muted", text: `${m.pos} · ${m.overall} OVR` }),
      m.to === s.team ? el("span", { class: "go-tag good", text: `Joins You From ${teamName(m.from)}` }) : el("span", { class: "go-tag bad", text: `Left for ${teamName(m.to)}` })])))]);
  }
  function drawPortalWeek(s, v, page, patching) {
    const p = v.portal;
    const overview = card("off-overview", "portal-head", [kicker("Portal Overview"), el("ul", { class: "off-bullets" }, [
      el("li", { text: `You have ${v.open_spots} spots (the roster limit, plus up to 8 by releasing the end of your roster) and ${p.offers_left} offers left.` }),
      el("li", { text: "Transfers are recruited like a class, condensed: message, call, a campus visit, an offer with a pitch and NIL from your portal pool." }),
      el("li", { text: "Entrants with offers decide at each week's end (a quarter of them, then 40%, 60%, then everyone), for the school they like best with room; what you do this week lands at the step." }),
      el("li", { text: `${p.signed} of ${p.entrants} have picked a school.` })])]);
    const kept = (v.retention && v.retention.results) || [];
    let answers = null;
    if (kept.length && p.week === 1) {
      const shown = cut("answers", kept);
      answers = card("off-answers", "answers", [kicker("Keep Them Home · The Answers"), el("ul", { class: "off-lines" }, shown.map((k) => el("li", { "data-key": k.id || k.name }, [
        icon("swap"), el("b", { text: k.name }), el("span", { class: "muted", text: k.pos }),
        k.status === "stayed" ? el("span", { class: "go-tag good", text: `Stays${k.nil ? ` · ${k.nil} NIL` : ""}${k.promise ? " · Promised a Start" : ""}` })
          : el("span", { class: "go-tag bad", text: k.intent === "draft" ? "Off to the Draft" : "Into the Portal" })]))), more("answers", kept.length - shown.length)]);
    }
    const moves = p.moves_mine || [];
    const away = p.away || [];
    const awayCard = away.length ? card("off-away", "away", [kicker(`Who Got Away · ${away.length}`), awayList(away)]) : null;
    const items = [overview, boardCard(s, v), answers, moves.length ? movesCard(s, moves) : null, awayCard].filter(Boolean);
    if (items.length % 2 === 1) items[items.length - 1].classList.add("off-span");
    page.append(el("div", { class: "off-row off-g2 off-portal", "data-key": "portal" }, items));
  }
  // Your Portal Board: a compact card in place of the board itself (that is the Recruiting tab's): the count, your
  // offers out of the week's allowance, your open spots, the top entrants by your chance with the board's own standing
  // word (recruiting.js's ladder, so the chip agrees with the tab), and the button that opens the tab
  function boardCard(s, v) {
    const p = v.portal;
    const bd = p.board || { count: 0, rows: [] };
    const R = window.CFP.recruiting;
    const offers = (p.offers || []).length;
    const top = bd.rows.slice().sort(R.byChance(s.team)).slice(0, BOARD_SHOWN);
    const go = el("button", { type: "button", class: "go-btn primary off-board-go", text: "Recruit on the Board →" });
    ui.on(go, "click", () => H.onChange("recruiting"));
    return card("off-your-board", "board", [kicker("Your Portal Board"),
      el("div", { class: "off-strip3" }, [stat("On Your Board", String(bd.count)), stat("Offers Out", `${offers} / ${offers + p.offers_left}`), stat("Open Spots", String(v.open_spots))]),
      top.length ? el("ul", { class: "off-lines off-board-lines" }, top.map((b) => {
        const sd = R.standingOf(b, s.team);
        const word = sd.odds === "No Room" ? "No Room" : sd.word;
        return el("li", { "data-key": b.id }, [avatar(b.id, "sm"), el("div", { class: "off-board-who" }, [el("b", { text: b.name }),
          el("div", { class: "muted small", text: `${b.pos} · ${b.overall} OVR${b.signed_week ? ` · Signed Week ${b.signed_week}` : ""}` })]),
          el("span", { class: `go-tag ${sd.tone}`, text: word, ...(sd.odds === "No Room" && b.no_room ? { title: b.no_room.tip } : {}) })]);
      })) : el("p", { class: "muted", text: "Nobody on your board yet. Pick entrants on the Prospects tab, then recruit them on the Recruiting tab." }),
      bd.count > top.length ? el("p", { class: "muted small", text: `And ${bd.count - top.length} more on the Recruiting tab.` }) : null,
      el("div", { class: "off-board-foot" }, [go])]);
  }

  // a recruit of yours who went elsewhere, in a sentence: "Zach Lutmer signed with Georgia. You had no roster spot left for him."
  function awaySentence(x) {
    const went = !x.to ? "went unsigned" : x.walk_on ? `walked on at ${x.to_name}` : `signed with ${x.to_name}`;
    return `${x.name} ${went}.${x.reason ? ` ${x.reason}` : ""}`;
  }
  // Who Got Away: the entrants you recruited (your offer, or on your board) who went elsewhere, each with where and why not you
  function awayList(rows) {
    return el("ul", { class: "off-list off-recap-list off-away" }, rows.map((r) => el("li", {}, [r.to ? window.CFP.teamPill(r.to) : null, r.to ? " " : null,
      el("b", { text: r.name }), el("span", { class: "muted", text: ` ${r.pos} · ${r.overall} OVR${r.week ? ` · Week ${r.week}` : ""}` }),
      el("div", { class: "small off-away-line", text: r.line })])));
  }

  // the two-round portal of an older save: offers from a table
  function drawOldPortal(s, v, page) {
    const p = v.portal;
    const filters = el("div", { class: "off-filters go-row wrap" });
    const pos = el("select", { class: "go-sel", "aria-label": "Position" }, [el("option", { value: "", text: "All Positions" }), ...GROUPS.map((g) => el("option", { value: g, text: g }))]);
    pos.value = view.position;
    ui.on(pos, "change", (ev) => { view.position = ev.currentTarget.value; syncRoute(); refresh(s).catch((err) => H.toast(H.errText(err))); });
    const status = el("select", { class: "go-sel", "aria-label": "Status" }, [["available", "Still Available"], ["offered", "Offered by You"], ["signed", "Signed"], ["", "Everyone"]]
      .map(([k, t]) => el("option", { value: k, text: t })));
    status.value = view.status;
    ui.on(status, "change", (ev) => { view.status = ev.currentTarget.value; syncRoute(); refresh(s).catch((err) => H.toast(H.errText(err))); });
    filters.append(pos, status);
    const head = card("off-overview", "portal-head", [kicker("Portal Overview"), el("ul", { class: "off-bullets" }, [
      el("li", { text: `You have ${v.open_spots} open spots${v.release_spots ? ` (and ${v.release_spots} more by releasing the end of your roster)` : ""} and ${p.offers_left} offers left this round.` }),
      el("li", { text: "Entrants with offers pick a school when the round ends: playing time first, then the program, winning and home." })]), filters]);
    page.append(row("g2", "portal-top", [head, (p.moves_mine || []).length ? movesCard(s, p.moves_mine) : null]));
    const table = el("table", { class: "off-table" }, [el("thead", {}, [el("tr", {}, ["Player", "Pos", "Year", "OVR", "From", "Last Year", "With You", "Offers", "Offer"].map((h) => el("th", { text: h })))])]);
    const body = el("tbody");
    for (const r of p.rows) {
      const btn = el("button", { type: "button", class: `go-btn small ${r.offered ? "" : "primary"}`, text: r.signed ? "Signed" : r.offered ? "Withdraw" : "Offer" });
      btn.disabled = !!r.signed || (!r.offered && p.offers_left <= 0);
      ui.on(btn, "click", (ev) => act(ev, s, () => H.api(`/api/season/${s.id}/offseason/portal`, staged({ pid: r.id, on: !r.offered })),
        r.offered ? `Offer to ${r.name} pulled` : `Offer sent to ${r.name}`));
      body.append(el("tr", { class: r.offered ? "offered" : "", "data-key": r.id }, [
        el("td", {}, [el("b", { text: r.name }), r.stars ? el("span", { class: "muted small", text: ` ${stars(r.stars)}` }) : null]),
        el("td", { text: r.pos }), el("td", { text: clsWord(r.cls) }), el("td", { class: "num", text: String(r.overall) }),
        el("td", {}, [window.CFP.teamPill(r.from), ` ${r.from_name}`]), el("td", { text: USAGE[r.last_year] || "" }),
        el("td", {}, [el("span", { class: `go-tag ${r.fit === "Would Start" ? "good" : r.fit === "Next in Line" ? "warn" : "muted"}`, text: r.fit })]),
        el("td", { class: "num", text: r.signed ? r.signed_name : String(r.offers) }), el("td", {}, [btn])]));
    }
    table.append(body);
    page.append(card("off-scroll", "portal-table", [p.rows.length ? table : el("p", { class: "muted", text: "Nobody matches." })]));
  }

  const teamAbbr = (slug) => (window.CFP.teamsBySlug[slug] || {}).abbreviation || teamName(slug);

  // the transfer portal's who you got and who you lost (and where he went)
  function recapLists(rec) {
    const got = el("div", { class: "off-recap-col" }, [el("div", { class: "go-kicker muted off-sub", text: `Who You Got · ${rec.signed.length}` })]);
    got.append(rec.signed.length ? el("ul", { class: "off-list off-recap-list" }, rec.signed.map((r) => el("li", { "data-key": r.id }, [window.CFP.teamPill(r.from), " ", el("b", { text: r.name }),
      el("span", { class: "muted", text: ` ${r.pos} · ${clsWord(r.cls)} · ${r.overall} OVR · from ${r.from_name}` }),
      r.walk_on ? el("span", { class: "go-tag muted", text: "Walk-On" }) : null])))
      : el("p", { class: "muted", text: "Nobody came in through the portal." }));
    const lost = el("div", { class: "off-recap-col" }, [el("div", { class: "go-kicker muted off-sub", text: `Who You Lost · ${rec.lost.length}` })]);
    lost.append(rec.lost.length ? el("ul", { class: "off-list off-recap-list" }, rec.lost.map((r) => el("li", { "data-key": r.id }, [el("b", { text: r.name }),
      el("span", { class: "muted", text: ` ${r.pos} · ${r.overall} OVR → ` }), r.to ? window.CFP.teamPill(r.to) : null, r.to ? " " : null, el("span", { text: r.to_name }),
      r.reason ? el("span", { class: "muted small off-recap-why", text: ` · ${r.reason}` }) : null])))
      : el("p", { class: "muted", text: "Nobody left through the portal." }));
    const away = rec.away || [];
    return el("div", {}, [el("div", { class: "off-recap-cols" }, [got, lost]),
      away.length ? el("div", { class: "off-recap-away" }, [el("div", { class: "go-kicker muted off-sub", text: `Who Got Away · ${away.length}` }), awayList(away)]) : null]);
  }
  const recapLine = (rec) => `You signed ${rec.signed.length} of the ${rec.entrants} players who entered.${rec.signed_league ? ` ${rec.signed_league} found a new school around the league.` : ""}`;
  // at Staff and Ready: one line that opens on click (a patch keeps whether the player opened it: view.recapOpen)
  function recapFolded(v) {
    const rec = v.portal_recap;
    const det = el("details", { class: "go-card off-recap", "data-key": "recap", ...(view.recapOpen ? { open: "" } : {}) }, [el("summary", { class: "off-recap-sum" }, [el("span", { class: "go-kicker", text: "Transfer Portal Recap" }),
      el("span", { class: "muted", text: `Portal: +${rec.signed.length} / −${rec.lost.length} · details` })]), el("p", { class: "off-recap-line", text: recapLine(rec) }), recapLists(rec)]);
    ui.on(det, "toggle", (ev) => { view.recapOpen = ev.currentTarget.open; });
    return det;
  }

  function devRow(d) {
    return el("li", { "data-key": d.id }, [el("b", { text: d.name }), el("span", { class: "muted", text: ` ${d.pos} · ${clsWord(d.cls)} · now ${d.overall} OVR ` }),
      el("span", { class: `go-tag ${d.gain > 0 ? "good" : "muted"}`, text: d.gain > 0 ? `+${d.gain}` : "No Change" }),
      d.transfer ? el("span", { class: "go-tag", text: `Transfer · From ${teamAbbr(d.transfer)}` }) : null,
      ...(d.why || []).map((w) => el("span", { class: `go-tag ${/Struggled|Benched/.test(w) ? "bad" : "warn"}`, text: w }))]);
  }

  // ----- Development: your roster's numbers, the portal's +/−, the tabs, the top improvements
  function drawDevelopment(s, v, page, patching) {
    const r = v.report || { mine: [], transfers: [], walk_ons: 0 };
    const rs = v.redshirts;
    const picked = rs ? rs.players.filter((p) => p.redshirt).length : 0;
    const stats = card("off-dev-stats", "dev-stats", [el("div", { class: "off-strip3" }, [stat("Roster Size", `${v.roster} / ${v.roster_limit || 85}`),
      stat("Redshirts", rs ? `${picked} / ${rs.players.length}` : "0"), stat("Position Changes", String((v.position_changes || []).length))])]);
    const rec = v.portal_recap;
    const recap = rec ? card("off-recap", "recap", [kicker("Transfer Portal Recap"), el("div", { class: "off-plusminus" }, [
      el("div", {}, [el("b", { class: "off-plus", text: `+${rec.signed.length}` }), el("span", { class: "muted", text: "Signed" })]),
      el("div", {}, [el("b", { class: "off-minus", text: `−${rec.lost.length}` }), el("span", { class: "muted", text: "Lost" })])]),
      el("p", { class: "muted small off-recap-line", text: recapLine(rec) })]) : null;
    page.append(row("g21", "dev-top", [stats, recap]));
    // the tabs (a patch: nothing fetched)
    const TABS = [["redshirts", `Redshirts (${picked})`], ["positions", `Position Changes (${(v.position_changes || []).length})`], ["improved", "Who Improved"],
      ["transfers", `Your Transfers (${(r.transfers || []).length})`]];
    if (!TABS.some(([k]) => k === view.devTab)) view.devTab = "redshirts";
    const pick = (k) => { view.devTab = k; syncRoute(); repaint(); };
    page.append(el("div", { class: "off-tabs", role: "tablist", "aria-label": "Development", "data-key": "dev-tabs" }, TABS.map(([k, label]) => {
      const b = el("button", { type: "button", role: "tab", class: `off-tab ${view.devTab === k ? "on" : ""}`, id: `off-tab-${k}`, "aria-selected": String(view.devTab === k), "aria-controls": `off-panel-${k}`, "data-key": k, text: label });
      ui.on(b, "click", () => pick(k));
      return b;
    })));
    const panel = (k, cls, kids) => el("div", { class: `off-tabpanel ${cls || ""}`, role: "tabpanel", id: `off-panel-${k}`, "aria-labelledby": `off-tab-${k}`, "data-tab": k, "data-key": `panel-${k}`, ...(view.devTab === k ? {} : { hidden: "" }) }, kids);
    const rsPanel = rs && rs.players.length ? el("div", { class: "off-scroll" }, [el("table", { class: "off-table off-rs-table" }, [el("thead", {}, [el("tr", {}, ["Player", "Pos", "OVR", "GP", "Decision"].map((h, i) => el("th", { class: i && i < 4 ? "num" : "", text: h })))]),
      el("tbody", {}, cut("rs", rs.players, 10).map((p) => el("tr", { "data-key": p.id }, [el("td", {}, [el("b", { text: p.name })]), el("td", { class: "num", text: p.pos }), el("td", { class: "num", text: String(p.overall) }),
        el("td", { class: "num", text: `${p.games} / ${p.team_games}` }), el("td", {}, [el("span", { class: `go-tag ${p.redshirt ? "good" : "muted"}`, text: decision(p) })])])))])])
      : el("p", { class: "muted", text: "Nobody on your roster could take a redshirt this year." });
    const improved = [el("div", { class: "go-kicker" }, ["Who Improved ", ui.tip("Every returning player grows toward his potential at his coachability's pace, faster under good developers and faster still after a big year: production and honors raise a player's ceiling and his pace.", "Who Improved")]),
      el("p", { class: "muted", text: `${r.walk_ons} walk-ons and lower-level transfers joined around the league to fill out rosters.` }),
      el("div", { class: "go-kicker muted off-sub", text: `The Top ${r.mine.length}` }), el("ul", { class: "off-list off-dev-list" }, r.mine.map(devRow))];
    const transfers = [el("div", { class: "go-kicker", text: `Your Transfers · ${(r.transfers || []).length}` }),
      (r.transfers || []).length ? el("ul", { class: "off-list off-dev-list" }, r.transfers.map(devRow)) : el("p", { class: "muted", text: "No transfers joined your roster." }),
      rec ? recapLists(rec) : null];
    const panels = card("off-panel", "dev-panel", [
      panel("redshirts", "", [el("div", { class: "go-kicker", text: "Redshirts" }), rsPanel, rs ? more("rs", rs.players.length - 10) : null]),
      panel("positions", "off-roster", positionMoves(s, v, patching)),
      panel("improved", "", improved),
      panel("transfers", "", transfers)]);
    const best = r.mine.filter((d) => d.gain > 0).slice().sort((a, b) => b.gain - a.gain).slice(0, 5);
    const all = el("button", { type: "button", class: "go-link off-viewall", text: `View All ${r.mine.length} →` });
    ui.on(all, "click", () => pick("improved"));
    const top = card("off-top", "dev-top-list", [kicker("Top Improvements"),
      best.length ? el("ul", { class: "off-top-list" }, best.map((d) => el("li", { "data-key": d.id }, [avatar(d.id, "sm"),
        el("div", {}, [el("b", { text: d.name }), el("div", { class: "muted small", text: `${d.pos} · ${d.overall} OVR` })]),
        el("span", { class: "go-tag good", text: `+${d.gain}` })]))) : el("p", { class: "muted", text: "Nobody on your roster improved this offseason." }),
      r.mine.length ? all : null]);
    page.append(row("g21", "dev-main", [panels, top]));
  }

  // ----- Staff -------------------------------------------------------------------------------------
  function renderJob(s, v) {
    const j = v.job;
    if (!j) return null;
    const you = j.you || {};
    const c = card("off-job", "job", [kicker("Your Job")]);
    if (you.goal) c.append(el("p", {}, [`Your AD's goal: ${you.goal.text}. `, you.met ? "You met it." : "You fell short.",
      you.mood ? ` Job security: ${you.mood.toLowerCase()}` : "", you.patience != null ? `${you.mood ? " (patience" : " His patience"}: ${you.patience} ${you.patience === 1 ? "year" : "years"}${you.mood ? ")" : ""}.` : you.mood ? "." : ""]));
    const list = you.fired ? j.openings : j.offers;
    if (you.fired) c.append(el("p", {}, [el("b", { text: "You have been fired. " }), "Pick your next job from the openings (Auto takes the best one)."]));
    else if (list.length) c.append(el("p", { text: "After the year you had, these programs want you as their head coach:" }));
    else c.append(el("p", { class: "muted", text: "No offers this year. Win big and better programs with an opening will call." }));
    const grid = el("div", { class: "off-cands" });
    for (const o of list) {
      const picked = j.choice === o.team;
      const b = el("button", { type: "button", class: `go-card off-cand ${picked ? "picked" : ""}`, "aria-pressed": String(picked), "data-key": o.team }, [
        el("span", {}, [window.CFP.teamPill(o.team), el("b", { text: ` ${o.name}` })]),
        el("span", { class: "muted small", text: `${o.conference} · team rating ${Math.round(o.rating)} · goal: ${o.goal}` }),
        el("span", { class: "go-tag", text: picked ? "Taking It" : "Take This Job" })]);
      ui.on(b, "click", (ev) => act(ev, s, () => H.api(`/api/season/${s.id}/offseason/job`, staged({ team: picked ? null : o.team })),
        picked ? `Not taking the ${o.name} job` : `Taking the job at ${o.name}`));
      grid.append(b);
    }
    if (list.length) c.append(grid);
    return c;
  }

  function candidateCard(c, picked, onClick, key, year) {
    const stops = (c.history || []).slice(-3).map((h) => `${h.team_name || h.team}${h.year ? ` ${h.year}–${h.to || ""}` : ""}`).join(" · ");
    const b = el("button", { type: "button", class: `go-card off-cand ${picked ? "picked" : ""}`, "aria-pressed": String(picked), "data-key": key }, [
      el("b", { text: `${c.name}${c.age ? `, ${c.age}` : ""}` }),
      el("span", { class: "muted small", text: `Evaluation ${c.evaluation} · Recruiting ${c.recruiting}${c.play_calling ? ` · Play calling ${c.play_calling}` : ""}` }),
      c.years ? el("span", { class: "small off-cand-years", text: `Wants ${c.years} ${c.years === 1 ? "year" : "years"}${year ? ` (through ${year + c.years - 1})` : ""}` }) : null,
      c.previous_job ? el("span", { class: "small", text: c.previous_job }) : null,
      c.why ? el("span", { class: "muted small off-cand-why", text: c.why }) : null,
      stops ? el("span", { class: "muted small", text: stops }) : null,
      el("span", { class: `go-btn off-cand-hire ${picked ? "" : "primary"}`, text: picked ? "Hired" : `Hire ${c.name.split(" ").slice(-1)[0]}` })]);
    ui.on(b, "click", onClick);
    return b;
  }

  function drawStaff(s, v, page) {
    const job = renderJob(s, v);
    if (job) page.append(job);
    if (v.portal_recap) page.append(recapFolded(v));
    const st = v.staff || { leaving: [], candidates: {}, hired: {}, reasons: {}, market: [], contract: {}, renewed: [], turned_down: {} };
    const contract = st.contract || {};
    const renewed = new Map((st.renewed || []).map((r) => [r.id, r]));
    const staffCard = card("off-staff", "staff", [kicker("Your Staff")]);
    if (!st.leaving.length) staffCard.append(el("p", { "data-key": "all-back", text: "Your whole staff is back." }));
    for (const who of st.leaving) {
      const c = contract[who.id] || {};
      staffCard.append(el("p", { "data-key": `leaving-${who.id}` }, [el("b", { text: `${who.role} ${who.name}` }), ` ${(st.reasons || {})[who.id] || "is moving on"}.`,
        c.expiring ? el("span", { class: "go-tag warn off-contract", text: "Contract Up: He Is Shopping" }) : null]));
      const r = el("div", { class: "off-cands", "data-key": `cands-${who.id}` });
      (st.candidates[who.id] || []).forEach((cand, i) => {
        r.append(candidateCard(cand, st.hired[who.id] === i, (ev) => act(ev, s, () => H.api(`/api/season/${s.id}/offseason/hire`, staged({ staff_id: who.id, index: i })),
          `Hired ${cand.name} as ${who.role}`), `${who.id}-${i}`, v.year));
      });
      staffCard.append(r);
    }
    const leaving = new Set(st.leaving.map((w) => w.id));
    const staying = (v.your_staff || []).filter((x) => !leaving.has(x.id));
    // a coordinator another program wanted as its head coach, who turned it down: he is under contract
    for (const x of staying) {
      if (!(x.id in (st.turned_down || {}))) continue;
      const school = st.turned_down[x.id];
      staffCard.append(el("p", { class: "muted", "data-key": `declined-${x.id}` }, [el("b", { text: `${x.role} ${x.name}` }),
        ` turned down ${school ? school : "a bigger job"}: under contract${x.contract_until ? ` through ${x.contract_until}` : ""}.`]));
    }
    if (staying.length && !v.fired) {
      staffCard.append(el("div", { class: "go-kicker muted off-sub", "data-key": "staying", text: "Staying · Let One Go and Hire From the Market" }));
      const r = el("div", { class: "off-letgo", "data-key": "letgo" });
      for (const x of staying) {
        const rn = renewed.get(x.id);
        const term = rn ? el("span", { class: "go-tag good off-contract", text: `Re-signed Through ${rn.through}` })
          : x.contract_until ? el("span", { class: "go-tag muted off-contract", text: `Signed Through ${x.contract_until}` }) : null;
        const b = el("button", { type: "button", class: "go-act", "data-key": x.id }, [el("span", { class: "off-staff-name" }, [`${x.role} ${x.name} `, term]), el("span", { text: "Let Him Go" })]);
        ui.on(b, "click", (ev) => {
          if (!window.confirm(`Let ${x.role} ${x.name} go? He joins the coaching market and you hire his replacement now.`)) return;
          act(ev, s, () => H.api(`/api/season/${s.id}/offseason/open_role`, staged({ staff_id: x.id })), `${x.role} ${x.name} is out · hire his replacement`);
        });
        r.append(b);
      }
      staffCard.append(r);
    }
    // your staff developed like the players did: one row per coach with each rating that moved and why
    const dev = st.developed || [];
    if (dev.length) {
      staffCard.append(el("div", { class: "go-kicker muted off-sub", "data-key": "developed", text: "Your Staff Developed" }));
      staffCard.append(el("ul", { class: "off-list off-dev", "data-key": "developed-list" }, dev.map((d) => el("li", { "data-key": `dev-${d.id}` }, [
        el("b", { text: `${d.role} ${d.name}` }), d.age ? el("span", { class: "muted small", text: ` · ${d.age}` }) : null, " ",
        ...(d.changes.length ? d.changes.map((c) => { const n = c.to - c.from;
          return el("span", { class: `go-tag ${n > 0 ? "good" : "bad"} off-dev-change`, text: `${c.rating} ${c.from} → ${c.to} (${n > 0 ? "+" : ""}${n})` }); })
          : [el("span", { class: "go-tag muted", text: "No Change" })]),
        ...(d.why || []).map((w) => el("span", { class: `go-tag ${/Bottom|outside|^Age$/.test(w) ? "warn" : ""}`, text: w }))]))));
    }
    const coaches = card("off-carousel", "carousel", [kicker("Coaching Carousel"),
      v.coaching_changes.length ? el("ul", { class: "off-list" }, v.coaching_changes.map((c) => el("li", {}, [window.CFP.teamPill(c.team),
        c.reason === "hired" ? ` ${teamName(c.team)} hires ${c.new}${c.from ? ` (${c.from})` : ""}.` : ` ${teamName(c.team)}: ${c.old} ${c.reason}.`])))
        : el("p", { class: "muted", text: "No head coaching changes this year." })]);
    const grid = row("g2", "staff-grid", [staffCard, coaches]);
    grid.classList.add("off-grid");
    page.append(grid);
    if ((st.market || []).length) {
      const t = el("table", { class: "off-table" }, [el("thead", {}, [el("tr", {}, ["Coach", "Would Take", "Rating", "Why He Is Available", "Last Job"].map((h) => el("th", { text: h })))])]);
      const body = el("tbody");
      // a role is a label (Title Case): "head coach" → "Head Coach", "defensive coordinator at Texas" → "Defensive Coordinator at Texas"
      const roleCase = (t) => String(t || "").replace(/\b(head coach|offensive coordinator|defensive coordinator)\b/g, (r) => r.replace(/\b\w/g, (c) => c.toUpperCase()));
      const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
      for (const m of st.market) {
        body.append(el("tr", {}, [el("td", { text: `${m.name}, ${m.age}` }), el("td", { text: m.roles.map(roleCase).join(", ") }), el("td", { class: "num", text: String(m.rating) }),
          el("td", { text: `${cap(m.why)}${m.sits_out ? " · Sitting out this cycle" : ""}` }), el("td", { text: m.previous_job && m.previous_job !== m.why ? cap(roleCase(m.previous_job)) : "—" })]));
      }
      t.append(body);
      page.append(card("off-market", "market", [el("div", { class: "go-kicker" }, [`Coaches for Hire · The Top ${st.market.length} `,
        ui.tip("The coaching market: fired and let-go coaches, head coaches from the FCS and lower divisions, NFL assistants and position coaches. Open a job on your staff to hire from it.", "Coaches for Hire")]),
      el("div", { class: "off-scroll" }, [t])]));
    }
  }

  // ----- Ready: the recap ------------------------------------------------------------------------------
  function drawReady(v, page, s) {
    const moving = v.job && v.job.moving_to;
    const team = moving || s.team;
    const t = window.CFP.teamsBySlug[team] || {};
    page.append(card("off-hero off-recap-hero", "hero", [el("div", { class: "off-hero-mark" }, [window.CFP.teamPill(team)]), el("div", {}, [
      el("div", { class: "off-hero-title", text: moving ? `On to ${t.name || teamName(team)}` : "Offseason Recap" }),
      el("p", { class: "off-hero-line", text: moving ? `You are the new head coach at ${teamName(moving)}. A new class of high school seniors is waiting, and the ${v.year} schedule is out.`
        : `Your roster is set at ${v.roster}. A new class of high school seniors is waiting, and the ${v.year} schedule is out.` })])]));
    const mine = v.departures.mine;
    const kinds = {};
    for (const d of mine) kinds[d.kind] = (kinds[d.kind] || 0) + 1;
    const parts = [[kinds.graduated, "graduated"], [kinds.draft, "drafted"], [kinds.undrafted, "declared and went undrafted"], [kinds.portal, "to the portal"], [kinds.quit, "left the team"]]
      .filter(([n]) => n).map(([n, w]) => `${n} ${w}`);
    const items = [["Departures", `${mine.length}${parts.length ? ` (${parts.join(", ")})` : ""}`]];
    const kept = (v.retention && v.retention.results) || null;
    if (kept && kept.length) items.push(["Keep Them Home", `${kept.filter((k) => k.status === "stayed").length} of ${kept.length} kept`]);
    if (v.portal_recap) items.push(["Transfer Portal", `+${v.portal_recap.signed.length} / −${v.portal_recap.lost.length}`]);
    items.push(["Roster", `${v.roster} / ${v.roster_limit || 85}`], ["Class Signed", String(v.signed)]);
    const r = v.review || {};
    if (r.nil_next != null) items.push(["Next Year's NIL", `About ${r.nil_next}${r.nil_now != null && r.nil_now !== r.nil_next ? ` (${r.nil_next > r.nil_now ? "up" : "down"} from ${r.nil_now})` : ""}`]);
    const results = card("off-results", "results", [kicker("Key Results"), el("ul", { class: "off-check" }, items.map(([k, val]) =>
      el("li", { "data-key": k }, [el("span", { class: "off-mark", "aria-hidden": "true", text: "✓" }), el("b", { text: `${k}:` }), ` ${val}`])))]);
    const road = [[`${v.year} Schedule`, "Released", "cal"], ["Recruiting", `Class of ${v.year + 1} Is Waiting`, "class"]];
    if (moving) road.push(["Your New Job", teamName(moving), "job"]);
    if (v.goal_next) road.push(["The Goal", v.goal_next, "goal"]);
    const roadCard = card("off-road", "road", [kicker("The Road Ahead"), el("ul", { class: "off-icons" }, road.map(([k, val, ic]) => el("li", {}, [icon(ic), el("span", { class: "muted", text: k }), el("b", { text: val })])))]);
    page.append(row("g2", "ready", [results, column("ready-col", [v.history.length ? renderHistory(v) : null, roadCard])]));
    if (v.portal_recap) page.append(recapFolded(v));
  }

  function renderHistory(v) {
    const t = el("table", { class: "off-table" }, [el("thead", {}, [el("tr", {}, ["Year", "Record", "Final AP", "Honors", "Class", "Drafted"].map((h) => el("th", { text: h })))])]);
    const body = el("tbody");
    for (const h of v.history.slice().reverse()) {
      const notes = [h.won_title ? "National Champions" : "", h.conference_champion ? "Conference Champions" : ""].filter(Boolean).join(" · ");
      body.append(el("tr", {}, [el("td", { text: String(h.year) }), el("td", { class: "num", text: `${h.wins}-${h.losses}` }),
        el("td", { class: "num", text: h.ap_rank ? `#${h.ap_rank}` : "—" }), el("td", { text: notes || "—" }),
        el("td", { class: "num", text: h.class_rank ? `#${h.class_rank}` : "—" }), el("td", { class: "num", text: String(h.drafted || 0) })]));
    }
    t.append(body);
    return card("off-history", "history", [kicker("Your Program's History"), el("div", { class: "off-scroll" }, [t])]);
  }

  window.Offseason = { render, applyRoute };
})();
