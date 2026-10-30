/* Coach Career's offseason on the season page: who leaves (the draft, graduation, the transfer
   portal), two portal rounds to fill your roster, who improved, staff changes, then the next
   season. window.Offseason.render(season, box, helpers); helpers as for recruiting.js. Colors
   come from the theme variables (light and dark). */
(function () {
  "use strict";
  const { el } = window.CFP;
  const GROUPS = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"];
  const USAGE = { starter: "Started", rotation: "Rotation", bench: "Bench" };
  const KIND_ORDER = ["draft", "undrafted", "graduated", "portal", "quit"];
  const view = { position: "", status: "available", posPick: "", recapOpen: false };
  const ui = window.CFP.ui;
  let H = null;
  let BOX = null;                 // #tab-offseason
  let drawn = null;               // what is on screen: { sid, stage }
  let seq = 0;                    // the latest fetch; an older one landing late is dropped

  const teamName = (slug) => (window.CFP.teamsBySlug[slug] || {}).name || slug;
  const loading = (text) => el("p", { class: "muted go-loading", text });
  const ordinal = (n) => { const t = n % 100, u = n % 10; return `${n}${t > 10 && t < 14 ? "th" : u === 1 ? "st" : u === 2 ? "nd" : u === 3 ? "rd" : "th"}`; };
  const stars = (n) => (n ? "★".repeat(n) : "");

  function stepper(v) {
    return el("ol", { class: "off-steps", "aria-label": "Offseason steps" }, v.stages.map((st, i) =>
      el("li", { class: `off-step ${st.done ? "done" : ""} ${st.current ? "now" : ""}`, "aria-current": st.current ? "step" : null }, [
        el("span", { class: "off-step-mark", text: st.done ? "✓" : String(i + 1) }), el("span", { text: st.name })])));
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

  // After an action: fetch again and patch what is on screen to match (web/ui.js morph): the cards
  // stay, the scroll stays, what changed pulses. A new stage (or another career) draws in full.
  async function refresh(s) {
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
    ui.morph(box, fresh);
  }

  // One decision button: the button is busy, the call goes out, the screen patches, a toast says what
  // happened (said: text, or a function of the call's answer). Errors keep their toasts (fail).
  function act(ev, s, call, said, opt = {}) {
    const btn = ev && ev.currentTarget instanceof HTMLElement ? ev.currentTarget : null;
    const work = (async () => {
      let r;
      try { r = await call(); }
      catch (err) { if (opt.fail) opt.fail(err); else H.toast(H.errText(err)); return; }
      try { await refresh(s); if (opt.after) await opt.after(r); }
      catch (err) { H.toast(`Could not refresh the offseason: ${H.errText(err)}`, 4000); return; }
      const msg = typeof said === "function" ? said(r) : said;
      if (msg) H.toast(msg, 3500);
    })();
    return btn ? ui.busy(btn, work) : work;
  }

  // the stage drawn into root; patching: drawn off screen to patch the live one (the portal board
  // keeps itself: recruiting.js draws it once)
  function draw(s, v, root, patching) {     // root: the live box, or a detached one to patch from (handlers use BOX)
    drawn = { sid: s.id, stage: v.stage };
    const head = el("section", { class: "go-card off-head", "data-key": "head" }, [
      el("div", { class: "go-kicker", text: `OFFSEASON · ON TO ${v.year}` }),
      el("div", { class: "go-display xl", text: v.stage_name.toUpperCase() }),
      stepper(v),
      el("div", { class: "go-mini off-numbers" }, [stat("ROSTER", `${v.roster} / ${v.roster_limit || 85}${v.retention && !v.retention.results && v.retention.players.length ? ` · ${v.retention.players.length} deciding` : ""}`), stat("CLASS SIGNED", String(v.signed)),
        stat("OPEN SPOTS", String(v.open_spots)), stat("PORTAL", `${v.portal.signed} of ${v.portal.entrants} placed`)]),
    ]);
    const actions = el("div", { class: "go-play off-actions" });
    head.append(actions);
    root.append(head);
    const main = el("div", { class: "off-main", "data-key": "main" });
    root.append(main);
    // the primary button says where it takes you ("Advance to …"), never what the next stage does
    const next = { departures: v.retention && v.retention.players.length ? "Advance to Keep them home" : "Advance to the transfer portal", retention: "Advance to the transfer portal",
                   portal_1: "Advance to portal round 2", portal_2: "Close the portal and advance", portal_w1: "Advance to portal week 2", portal_w2: "Advance to portal week 3",
                   portal_w3: "Advance to portal week 4", portal_w4: "Close the portal and advance", development: "Advance to staff changes",
                   staff: "Finish the offseason", ready: `Start the ${v.year} season` }[v.stage];
    const go = el("button", { type: "button", class: "go-btn primary big", text: next });
    ui.on(go, "click", (ev) => advance(s, BOX, ev.currentTarget, v.stage === "ready" ? "next_season" : null));
    actions.append(go);
    if (v.stage !== "ready") {
      const all = el("button", { type: "button", class: "go-btn big2", text: "Sim to next season" });
      ui.on(all, "click", (ev) => { if (window.confirm("Sim the rest of the offseason? Every decision still open (players deciding, the portal, your staff) is made for you.")) advance(s, BOX, ev.currentTarget, "next_season"); });
      actions.append(all);
    }
    if (v.review) main.append(renderReview(s, v));
    if (v.fired && v.stage !== "departures" && v.stage !== "staff" && v.stage !== "ready") main.append(firedNote(v));
    if (v.stage === "departures" || v.stage === "development") main.append(renderRosterMoves(s, v, patching));
    if (v.portal_recap && (v.stage === "staff" || v.stage === "ready")) main.append(renderPortalRecap(v, true));
    if (v.stage === "departures") renderDepartures(v, main);
    else if (v.stage === "retention") renderRetention(s, v, main);
    else if (v.stage === "portal_1" || v.stage === "portal_2") renderPortal(s, v, main);
    else if (v.stage.startsWith("portal_w")) renderPortalWeeks(s, v, main, patching);
    else if (v.stage === "development") renderDevelopment(v, main);
    else if (v.stage === "staff") renderStaff(s, v, main);
    else renderReady(v, main);
    if (v.history.length) main.append(renderHistory(v));
  }

  function firedNote(v) {
    return el("section", { class: "go-card off-fired", "data-key": "fired" }, [el("div", { class: "go-kicker", text: "YOU HAVE BEEN LET GO" }),
      el("p", { text: `The program's next coach runs the rest of the ${v.year} offseason. Walk the steps and pick your next job at the Staff step.` })]);
  }

  const clsWord = (c) => (c && c.endsWith("RS") ? `RS ${c.slice(0, -2)}` : c);   // FRRS -> "RS FR"
  function meter(sec) {
    const cls = sec < 25 ? "bad" : sec < 40 ? "warn" : "good";
    return el("div", { class: `off-meter ${cls}` }, [el("div", { class: "off-meter-fill", style: `width:${Math.max(2, Math.min(100, sec))}%` })]);
  }

  function renderReview(s, v) {
    const r = v.review;
    const card = el("section", { class: "go-card off-review", "data-key": "review" }, [el("div", { class: "go-kicker", text: "YOUR MEETING WITH THE AD" }),
      el("div", { class: "go-mini off-numbers" }, [stat("THE GOAL", r.goal), stat("YOUR RECORD", `${r.record[0]}-${r.record[1]}`),
        stat("JOB SECURITY", r.mood || ""), stat("HIS PATIENCE", `${r.patience} years`), stat("YEAR", `${r.tenure} in the job`)]),
      meter(r.security),
      el("p", { class: "off-why", text: r.words })]);
    if (r.nil_portal) card.append(nilPortalLine(r.nil_portal));
    if (r.decided) {
      if (r.outcome && r.outcome !== r.words) card.append(el("p", {}, [el("b", { text: r.outcome })]));
      if (r.fired) card.append(el("p", { class: "bad-text", text: "Firing happens only at the end of a season; you will pick your next job at the Staff step." }));
      return card;
    }
    if (v.stage !== "departures") return card;
    card.append(el("p", { class: "muted", text: r.risk === "fire" ? "He is deciding whether to make a change. What do you say?"
      : "A warning. What do you say?" }));
    const acts = el("div", { class: "off-review-acts" });
    const said = { case: "You make your case to the AD", year: "You ask the AD for one more year", nothing: "You say nothing to the AD" };
    const send = (ev, action, staffId, line) =>
      act(ev, s, () => H.api(`/api/season/${s.id}/offseason/review`, H.postJSON({ action, staff_id: staffId || null })), line || said[action]);
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
    card.append(acts);
    return card;
  }

  function stat(k, val) { return el("div", { class: "go-stat" }, [el("div", { class: "go-kicker muted", text: k }), el("div", { class: "go-stat-val", text: val })]); }

  // The pool's math for the portal: "NIL for the portal: 60 left + 40 earned (nine wins, AD goal met) = 100",
  // "… raised to the 85 portal fund" when the collective's floor applied, then what keeping players home
  // cost and what carries into next year once the portal has closed.
  function nilPortalLine(n) {
    const why = (n.reward_why || []).join(", ");
    let text = `NIL for the portal: ${n.left} left + ${n.reward} earned${why ? ` (${why})` : ""} = ${n.left + n.reward}`;
    if (n.pool === n.floor && n.pool > n.left + n.reward) text += `, raised to the ${n.floor} portal fund`;
    if (n.retained > 0) text += ` · ${n.retained} spent keeping players home`;
    if (n.carry != null) text += ` · ${n.carry} carries into next year`;
    return el("p", { class: "muted small off-nil-line", "data-key": "nil", text });
  }

  async function advance(s, box, btn, to) {
    btn.disabled = true;
    btn.textContent = to ? "Working through the offseason…" : "Working…";
    try {
      const r = await H.api(`/api/season/${s.id}/offseason/advance`, H.postJSON(to ? { to } : {}));
      if (r.next_season) {
        H.toast(`On to ${r.year}: a new season and a new class of recruits.`, 3500);
        await H.openSeason(s.id);          // in place: no reload, no loading screen
        return;
      }
      render(s, box, H);            // the next stage: a full draw
    } catch (err) {
      btn.disabled = false;
      H.toast(`Could not continue: ${H.errText(err)}`);
    }
  }

  // your roster at the Departures step: who takes a redshirt, who changes position
  const POS_NAMES = { QB: "QB", HB: "HB", FB: "FB", WR: "WR", TE: "TE", LT: "LT", LG: "LG", C: "C", RG: "RG", RT: "RT", LEDG: "LEDG", REDG: "REDG", DT: "DT",
    SAM: "SAM", MIKE: "MIKE", WILL: "WILL", CB: "CB", FS: "FS", SS: "SS", K: "K", P: "P" };
  const NEXT_CLASS = { FR: "SO", FRRS: "SORS", SO: "JR", SORS: "JRRS", JR: "SR", JRRS: "SRRS" };
  function renderRosterMoves(s, v, patching) {
    const card = el("section", { class: "go-card off-roster", "data-key": "roster" }, [el("div", { class: "go-kicker", text: "YOUR ROSTER" })]);
    const rs = v.redshirts;
    if (rs && v.stage === "departures") {
      const picked = rs.players.filter((p) => p.redshirt).length;
      card.append(el("div", { class: "go-kicker muted off-sub", text: `REDSHIRTS · ${picked} OF ${rs.players.length}` }),
        el("p", { class: "muted small", text: rs.decided ? "Decided: the classes below are set for next season."
          : "Four games or fewer and the year unused: a redshirt keeps his class for next season (he still develops). Freshmen off the depth chart's top take it unless you say otherwise." }));
      if (!rs.players.length) card.append(el("p", { class: "muted", text: "Nobody on your roster can take a redshirt this year." }));
      const list = el("div", { class: "off-rs", "data-key": "rs" });
      for (const p of rs.players) {
        const b = el("button", { type: "button", class: `go-act ${p.redshirt ? "on" : ""}`, "aria-pressed": String(p.redshirt), "data-key": p.id, ...(rs.decided ? { disabled: "true" } : {}),
          title: `${p.name}: played ${p.games} of ${p.team_games} games · ${p.use === "starter" ? "a starter" : p.use === "rotation" ? "in the rotation" : "off the depth chart"}` },
          [el("b", { text: p.name }), el("span", { text: `${p.pos} · ${clsWord(p.cls)} · ${p.overall} OVR · ${p.games} of ${p.team_games} games` }),
           el("span", { class: `go-tag ${p.redshirt ? "good" : "muted"}`, text: p.redshirt ? `Redshirt → ${clsWord(`${p.cls}RS`)}` : `Plays on → ${clsWord(NEXT_CLASS[p.cls] || p.cls)}` })]);
        if (!rs.decided) ui.on(b, "click", (ev) => act(ev, s, () => H.api(`/api/season/${s.id}/offseason/redshirt`, H.postJSON({ pid: p.id, on: !p.redshirt })),
          p.redshirt ? `Plays on: ${p.name}` : `Redshirt: ${p.name}`));
        list.append(b);
      }
      card.append(list);
    }
    // position changes: pick a player, see what he would be everywhere, move him
    card.append(el("div", { class: "go-kicker muted off-sub", text: `POSITION CHANGES · ${(v.position_changes || []).length}` }),
      el("p", { class: "muted small", text: "Move a player to another spot; his overall follows our formula there. Changes apply at once." }));
    const option = (r) => el("option", { value: r.id, text: `${r.pos} · ${r.name} · ${clsWord(r.cls)} · ${r.overall} OVR${r.moved_from ? ` (was ${r.moved_from})` : ""}${r.transfer ? ` · transfer from ${teamName(r.transfer)}` : ""}` });
    const roster = v.my_roster || [];
    const transfers = roster.filter((r) => r.transfer);
    if (view.posPick && !roster.some((r) => r.id === view.posPick)) view.posPick = "";
    const pick = el("select", { class: "go-sel", "aria-label": "Player to move" }, [el("option", { value: "", text: "Pick a player…" }),
      ...(transfers.length ? [el("optgroup", { label: "Transfers" }, transfers.map(option)), el("optgroup", { label: "Everyone else" }, roster.filter((r) => !r.transfer).map(option))]
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
          if (!o.current) ui.on(b, "click", (ev) => act(ev, s, () => H.api(`/api/season/${s.id}/offseason/position`, H.postJSON({ pid, pos: o.pos })),
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
    card.append(el("div", { class: "go-row wrap" }, [pick]), opts);
    if ((v.position_changes || []).length) card.append(el("ul", { class: "off-list", "data-key": "moves" }, v.position_changes.map((m) => {
      const undo = el("button", { type: "button", class: "go-link", text: "undo" });
      ui.on(undo, "click", (ev) => act(ev, s, () => H.api(`/api/season/${s.id}/offseason/position`, H.postJSON({ pid: m.id, pos: m.from })), `${m.name} moves back to ${m.from}`,
        { after: () => loadOpts(document.querySelector("#tab-offseason .off-pos-opts")) }));
      return el("li", { "data-key": m.id }, [el("b", { text: m.name }), ` ${m.from} → ${m.to} · ${m.overall} OVR `, undo]);
    })));
    return card;
  }

  function renderDepartures(v, main) {
    const mine = v.departures.mine;
    const card = el("section", { class: "go-card" }, [el("div", { class: "go-kicker", text: `LEAVING YOUR PROGRAM · ${mine.length}` })]);
    for (const kind of KIND_ORDER) {
      const rows = mine.filter((d) => d.kind === kind);
      if (!rows.length) continue;
      card.append(el("div", { class: "go-kicker muted off-sub", text: `${rows[0].kind_name.toUpperCase()} · ${rows.length}` }),
        el("ul", { class: "off-list" }, rows.sort((a, b) => (a.pick || 999) - (b.pick || 999) || b.overall - a.overall).map((d) => el("li", {}, [
          el("b", { text: d.name }), el("span", { class: "muted", text: ` ${d.pos} · ${clsWord(d.cls)} · ${d.overall} OVR` }),
          d.kind === "draft" ? el("span", { class: "go-tag good", text: `Round ${d.round}, pick ${d.pick}${d.early ? " · early" : ""}` }) : null]))));
    }
    if (!mine.length) card.append(el("p", { class: "muted", text: "Nobody leaves." }));
    const league = el("section", { class: "go-card" }, [el("div", { class: "go-kicker", text: "AROUND THE LEAGUE" }),
      el("p", {}, [`${v.departures.league.graduated || 0} graduated, ${v.departures.league.draft || 0} drafted (${v.departures.early_entrants} declared early), `,
        `${v.departures.league.portal || 0} entered the transfer portal, ${v.departures.league.quit || 0} left their teams.`]),
      el("div", { class: "go-kicker muted off-sub", text: "THE FIRST ROUND" }),
      el("ol", { class: "off-list off-draft" }, v.departures.first_round.map((d) => el("li", {}, [
        el("span", { class: "muted", text: `${d.pick}. ` }), window.CFP.teamPill(d.team), el("b", { text: ` ${d.name}` }),
        el("span", { class: "muted", text: ` ${d.pos} · ${d.team_name}${d.early ? " · early" : ""}` })])))]);
    main.append(el("div", { class: "off-grid", "data-key": "departures" }, [card, league]));
  }

  // Keep them home: your leavers with eligibility left, what each wants, and your moves (API: offseason/retain)
  function renderRetention(s, v, main) {
    const r = v.retention;
    const retain = (ev, pid, action, said, nil) => act(ev, s, () => H.api(`/api/season/${s.id}/offseason/retain`, H.postJSON({ pid, action, nil: nil || 0 })), said,
      { fail: (err) => H.toast(`Could not do that: ${H.errText(err)}`, 4000) });
    const head = el("section", { class: "go-card", "data-key": "keep-head" }, [
      el("div", { class: "go-kicker", text: `KEEP THEM HOME · ${r.players.length} WANT OUT` }),
      el("p", {}, [`${r.players.length} of your players with eligibility left mean to leave: transfers and early draft entrants. Meet each one to hear what it would take. `,
        "A promised starting role only counts if your depth chart would really start him; NIL comes out of next year's budget, so it is money you will not have for recruits or the portal. ",
        "Nobody decides until you advance; graduating seniors are gone either way."]),
      el("div", { class: "go-row wrap" }, [el("span", { class: "go-stat" }, [el("div", { class: "go-kicker muted", text: "NEXT YEAR'S NIL" }), el("div", { class: "go-stat-val", text: `${r.left} / ${r.budget}` })]),
        el("span", { class: "go-stat" }, [el("div", { class: "go-kicker muted", text: "COMMITTED TO KEEP THEM" }), el("div", { class: "go-stat-val", text: `${r.spent}` })])]),
    ]);
    const cards = el("div", { class: "go-cards off-keep", "data-key": "keep" });
    for (const e of r.players) {
      const c = el("article", { class: `go-card go-pcard ${e.offers.released ? "muted" : ""}`, "data-key": e.id });
      c.append(el("div", { class: "go-card-head" }, [el("div", {}, [el("b", { class: "go-name", text: e.name }),
        el("div", { class: "muted small", text: `${e.pos} · ${clsWord(e.cls)} next year · ${e.overall} OVR${e.stars ? ` · ${"★".repeat(e.stars)}` : ""}` })]),
        el("span", { class: `go-tag ${e.intent === "draft" ? "warn" : "bad"}`, text: e.intent === "draft" ? "NFL draft" : "Transfer portal" })]));
      c.append(el("p", { class: "off-why" }, [el("b", { text: "Why: " }), e.reason, e.draft_pick ? ` (projected pick ${e.draft_pick})` : ""]));
      c.append(el("div", { class: "go-tags" }, [el("span", { class: "go-tag muted", text: `Now: ${e.role_now_name}` }), el("span", { class: `go-tag ${e.role_next === "starter" ? "good" : "muted"}`, text: `Next year: ${e.role_next_name}`, title: "Where he would sit on your depth chart next season" }),
        e.chance_word ? el("span", { class: `go-tag ${e.chance >= 0.65 ? "good" : e.chance >= 0.4 ? "warn" : "bad"}`, text: e.chance_word }) : null]));
      const askText = !e.ask.known ? "Meet with him to hear what it would take."
        : e.ask.kind === "playing_time" ? `He wants a starting role${e.ask.nil ? `; short of that, about ${e.ask.nil} NIL would do it` : ""}.`
        : `He wants about ${e.ask.nil} NIL to stay.`;
      c.append(el("p", { class: "muted small", text: askText }));
      const offers = [];
      if (e.offers.promise) offers.push(e.role_next === "starter" ? "Promised a starting role" : "Promised a starting role he would not get");
      if (e.offers.nil) offers.push(`${e.offers.nil} NIL on the table`);
      if (e.offers.released) offers.push("Letting him go");
      if (offers.length) c.append(el("p", { class: "small" }, [el("b", { text: "Your offer: " }), offers.join(" · ")]));
      const btn = (label, sub, onclick, tone, off) => { const b = el("button", { type: "button", class: `go-act ${tone || ""}` }, [el("b", { text: label }), el("span", { text: sub })]); if (off) b.setAttribute("disabled", ""); ui.on(b, "click", onclick); return b; };
      const row = el("div", { class: "go-actions off-keep-acts" }, [
        btn("Meet", e.met ? "done" : "free", (ev) => retain(ev, e.id, "meet", `Met with ${e.name}`), "", e.met),
        btn("Promise a start", e.role_next === "starter" ? "he would start" : "he would not", (ev) => retain(ev, e.id, "promise", `Promised ${e.name} a start`), e.role_next === "starter" ? "go" : "", e.offers.promise),
        btn("Let him go", e.offers.released ? "letting go" : "", (ev) => { if (window.confirm(`Let ${e.name} go? He leaves when you advance; no NIL, no promise.`)) retain(ev, e.id, "release", `Letting ${e.name} go`); }, "", e.offers.released)]);
      const nil = el("input", { type: "number", min: "0", step: "5", value: String(e.offers.nil || e.ask.nil || 0), class: "go-nil", id: `keep-nil-${e.id}` });
      const nilRow = el("div", { class: "go-row off-keep-nil" }, [el("label", { for: `keep-nil-${e.id}`, class: "muted small", text: "NIL" }), nil,
        btn("Offer NIL", "from next year's", (ev) => {        // the amount typed in the live box beside the button
          const amount = Number(document.getElementById(`keep-nil-${e.id}`).value) || 0;
          retain(ev, e.id, "nil", `Offer to ${e.name} · ${amount} NIL`, amount);
        }, "alt")]);
      c.append(row, nilRow);
      cards.append(c);
    }
    if (!r.players.length) head.append(el("p", { class: "muted", text: "Nobody with eligibility left wants out. Open the portal." }));
    main.append(head, cards);
  }

  function renderPortalWeeks(s, v, main, patching) {
    const p = v.portal;
    const head = el("section", { class: "go-card", "data-key": "portal-head" }, [
      el("div", { class: "go-kicker", text: `TRANSFER PORTAL · WEEK ${p.week} OF ${p.weeks}` }),
      el("p", {}, [`You have ${v.open_spots} spots (the roster limit, plus up to 8 by releasing the end of your roster) and ${p.offers_left} offers left. `,
        "Transfers are recruited like a class, condensed: message, call, a campus visit, an offer with a pitch and NIL from your portal pool. ",
        "Entrants with offers decide at each week's end (a quarter of them, then 40%, 60%, then everyone), for the school they like best with room; what you do this week lands at the step. ",
        `${p.signed} of ${p.entrants} have picked a school.`]),
    ]);
    const kept = (v.retention && v.retention.results) || [];
    if (kept.length && p.week === 1) {
      head.append(el("div", { class: "go-kicker muted off-sub", text: "KEEP THEM HOME · THE ANSWERS" }),
        el("ul", { class: "off-list" }, kept.map((k) => el("li", {}, [el("b", { text: k.name }), el("span", { class: "muted", text: ` ${k.pos} · ` }),
          k.status === "stayed" ? el("span", { class: "go-tag good", text: `Stays${k.nil ? ` · ${k.nil} NIL` : ""}${k.promise ? " · promised a start" : ""}` })
            : el("span", { class: "go-tag bad", text: k.intent === "draft" ? "Off to the draft" : "Into the portal" })]))));
    }
    const moves = p.moves_mine || [];
    if (moves.length) {
      head.append(el("div", { class: "go-kicker muted off-sub", text: "YOUR MOVES" }),
        el("ul", { class: "off-list" }, moves.map((m) => el("li", {}, [el("b", { text: m.name }), el("span", { class: "muted", text: ` ${m.pos} · ${m.overall} OVR · ` }),
          m.to === s.team ? el("span", { class: "go-tag good", text: `Joins you from ${teamName(m.from)}` }) : el("span", { class: "go-tag bad", text: `Left for ${teamName(m.to)}` })]))));
    }
    const board = el("div", { class: "off-board", "data-key": "board", "data-keep": "" });     // the board draws and patches itself (recruiting.js)
    main.append(head, board);
    if (!patching) window.Recruiting.board(s, board, H);
  }

  function renderPortal(s, v, main) {
    const p = v.portal;
    const head = el("section", { class: "go-card", "data-key": "portal-head" }, [
      el("div", { class: "go-kicker", text: `TRANSFER PORTAL · ROUND ${p.round} OF 2` }),
      el("p", {}, [`You have ${v.open_spots} open spots${v.release_spots ? ` (and ${v.release_spots} more by releasing the end of your roster)` : ""} and ${p.offers_left} offers left this round. Entrants with offers pick a school when the round ends: `,
        "playing time first, then the program, winning and home."]),
    ]);
    const filters = el("div", { class: "off-filters" });
    const pos = el("select", { "aria-label": "Position" }, [el("option", { value: "", text: "All positions" }), ...GROUPS.map((g) => el("option", { value: g, text: g }))]);
    pos.value = view.position;
    ui.on(pos, "change", (ev) => { view.position = ev.currentTarget.value; refresh(s).catch((err) => H.toast(H.errText(err))); });
    const status = el("select", { "aria-label": "Status" }, [["available", "Still available"], ["offered", "Offered by you"], ["signed", "Signed"], ["", "Everyone"]]
      .map(([k, t]) => el("option", { value: k, text: t })));
    status.value = view.status;
    ui.on(status, "change", (ev) => { view.status = ev.currentTarget.value; refresh(s).catch((err) => H.toast(H.errText(err))); });
    filters.append(pos, status);
    head.append(filters);
    const moves = p.moves_mine;
    if (moves.length) {
      head.append(el("div", { class: "go-kicker muted off-sub", text: "YOUR MOVES" }),
        el("ul", { class: "off-list" }, moves.map((m) => el("li", {}, [el("b", { text: m.name }), el("span", { class: "muted", text: ` ${m.pos} · ${m.overall} OVR · ` }),
          m.to === s.team ? el("span", { class: "go-tag good", text: `Joins you from ${teamName(m.from)}` }) : el("span", { class: "go-tag bad", text: `Left for ${teamName(m.to)}` })]))));
    }
    const table = el("table", { class: "off-table" }, [el("thead", {}, [el("tr", {}, ["Player", "Pos", "Year", "OVR", "From", "Last year", "With you", "Offers", ""].map((h) => el("th", { text: h })))])]);
    const body = el("tbody");
    for (const r of p.rows) {
      const btn = el("button", { type: "button", class: `go-btn small ${r.offered ? "" : "primary"}`, text: r.signed ? "Signed" : r.offered ? "Withdraw" : "Offer" });
      btn.disabled = !!r.signed || (!r.offered && p.offers_left <= 0);
      ui.on(btn, "click", (ev) => act(ev, s, () => H.api(`/api/season/${s.id}/offseason/portal`, H.postJSON({ pid: r.id, on: !r.offered })),
        r.offered ? `Offer to ${r.name} pulled` : `Offer sent to ${r.name}`));
      body.append(el("tr", { class: r.offered ? "offered" : "", "data-key": r.id }, [
        el("td", {}, [el("b", { text: r.name }), r.stars ? el("span", { class: "muted small", text: ` ${stars(r.stars)}` }) : null]),
        el("td", { text: r.pos }), el("td", { text: clsWord(r.cls) }), el("td", { class: "num", text: String(r.overall) }),
        el("td", {}, [window.CFP.teamPill(r.from), ` ${r.from_name}`]), el("td", { text: USAGE[r.last_year] || "" }),
        el("td", {}, [el("span", { class: `go-tag ${r.fit === "Would start" ? "good" : r.fit === "Next in line" ? "warn" : "muted"}`, text: r.fit })]),
        el("td", { class: "num", text: r.signed ? r.signed_name : String(r.offers) }), el("td", {}, [btn])]));
    }
    table.append(body);
    main.append(head, el("section", { class: "go-card off-scroll", "data-key": "portal-table" }, [p.rows.length ? table : el("p", { class: "muted", text: "Nobody matches." })]));
  }

  const teamAbbr = (slug) => (window.CFP.teamsBySlug[slug] || {}).abbreviation || teamName(slug);

  // the transfer portal recap: who you got, who you lost and where he went; at Development a card
  // above Who improved, at Staff and Ready one line that opens on click
  function renderPortalRecap(v, collapsed) {
    const rec = v.portal_recap;
    const body = [el("p", { class: "off-recap-line", text: `You signed ${rec.signed.length} of the ${rec.entrants} players who entered.${rec.signed_league ? ` ${rec.signed_league} found a new school around the league.` : ""}` })];
    const got = el("div", { class: "off-recap-col" }, [el("div", { class: "go-kicker muted off-sub", text: `WHO YOU GOT · ${rec.signed.length}` })]);
    got.append(rec.signed.length ? el("ul", { class: "off-list off-recap-list" }, rec.signed.map((r) => el("li", {}, [window.CFP.teamPill(r.from), " ", el("b", { text: r.name }),
      el("span", { class: "muted", text: ` ${r.pos} · ${clsWord(r.cls)} · ${r.overall} OVR · from ${r.from_name}` }),
      r.walk_on ? el("span", { class: "go-tag muted", text: "walk-on" }) : null])))
      : el("p", { class: "muted", text: "Nobody came in through the portal." }));
    const lost = el("div", { class: "off-recap-col" }, [el("div", { class: "go-kicker muted off-sub", text: `WHO YOU LOST · ${rec.lost.length}` })]);
    lost.append(rec.lost.length ? el("ul", { class: "off-list off-recap-list" }, rec.lost.map((r) => el("li", {}, [el("b", { text: r.name }),
      el("span", { class: "muted", text: ` ${r.pos} · ${r.overall} OVR → ` }), r.to ? window.CFP.teamPill(r.to) : null, r.to ? " " : null, el("span", { text: r.to_name }),
      r.reason ? el("span", { class: "muted small off-recap-why", text: ` · ${r.reason}` }) : null])))
      : el("p", { class: "muted", text: "Nobody left through the portal." }));
    body.push(el("div", { class: "off-recap-cols" }, [got, lost]));
    if (!collapsed) return el("section", { class: "go-card off-recap", "data-key": "recap" }, [el("div", { class: "go-kicker", text: "TRANSFER PORTAL RECAP" }), ...body]);
    // a patch (ui.morph) redraws this card: it keeps whether the player opened it (view.recapOpen)
    const det = el("details", { class: "go-card off-recap", "data-key": "recap", ...(view.recapOpen ? { open: "" } : {}) }, [el("summary", { class: "off-recap-sum" }, [el("span", { class: "go-kicker", text: "TRANSFER PORTAL RECAP" }),
      el("span", { class: "muted", text: `Portal: +${rec.signed.length} / −${rec.lost.length} · details` })]), ...body]);
    ui.on(det, "toggle", (ev) => { view.recapOpen = ev.currentTarget.open; });
    return det;
  }

  function devRow(d) {
    return el("li", {}, [el("b", { text: d.name }), el("span", { class: "muted", text: ` ${d.pos} · ${clsWord(d.cls)} · now ${d.overall} OVR ` }),
      el("span", { class: `go-tag ${d.gain > 0 ? "good" : "muted"}`, text: d.gain > 0 ? `+${d.gain}` : "no change" }),
      d.transfer ? el("span", { class: "go-tag", text: `Transfer · from ${teamAbbr(d.transfer)}` }) : null,
      ...(d.why || []).map((w) => el("span", { class: `go-tag ${/Struggled/.test(w) ? "bad" : "warn"}`, text: w }))]);
  }

  function renderDevelopment(v, main) {
    const r = v.report || { mine: [], transfers: [] };
    if (v.portal_recap) main.append(renderPortalRecap(v, false));
    const card = el("section", { class: "go-card", "data-key": "improved" }, [
      el("div", { class: "go-kicker", text: "WHO IMPROVED" }),
      el("p", { class: "muted", text: `Every returning player grows toward his potential at his coachability's pace, faster under good developers and faster still after a big year: production and honors raise a player's ceiling and his pace. ${r.walk_ons} walk-ons and lower-level transfers joined around the league to fill out rosters.` })]);
    if ((r.transfers || []).length) card.append(el("div", { class: "go-kicker muted off-sub", text: `YOUR TRANSFERS · ${r.transfers.length}` }),
      el("ul", { class: "off-list" }, r.transfers.map(devRow)), el("div", { class: "go-kicker muted off-sub", text: `THE TOP ${r.mine.length}` }));
    card.append(el("ul", { class: "off-list" }, r.mine.map(devRow)));
    main.append(card);
  }

  function renderJob(s, v) {
    const j = v.job;
    if (!j) return null;
    const you = j.you || {};
    const card = el("section", { class: "go-card off-job", "data-key": "job" }, [el("div", { class: "go-kicker", text: "YOUR JOB" })]);
    if (you.goal) card.append(el("p", {}, [`Your AD's goal: ${you.goal.text}. `, you.met ? "You met it." : "You fell short.",
      ` Job security: ${(you.mood || "").toLowerCase()} (patience: ${you.patience} years).`]));
    const list = you.fired ? j.openings : j.offers;
    if (you.fired) card.append(el("p", {}, [el("b", { text: "You have been fired. " }), "Pick your next job from the openings (Auto takes the best one)."]));
    else if (list.length) card.append(el("p", { text: "After the year you had, these programs want you as their head coach:" }));
    else card.append(el("p", { class: "muted", text: "No offers this year. Win big and better programs with an opening will call." }));
    for (const o of list) {
      const picked = j.choice === o.team;
      const b = el("button", { type: "button", class: `go-card off-cand ${picked ? "picked" : ""}`, "aria-pressed": String(picked), "data-key": o.team }, [
        el("span", {}, [window.CFP.teamPill(o.team), el("b", { text: ` ${o.name}` })]),
        el("span", { class: "muted small", text: `${o.conference} · team rating ${Math.round(o.rating)} · goal: ${o.goal}` }),
        el("span", { class: "go-tag", text: picked ? "Taking it" : "Take this job" })]);
      ui.on(b, "click", (ev) => act(ev, s, () => H.api(`/api/season/${s.id}/offseason/job`, H.postJSON({ team: picked ? null : o.team })),
        picked ? `Not taking the ${o.name} job` : `Taking the job at ${o.name}`));
      card.append(b);
    }
    return card;
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

  function renderStaff(s, v, main) {
    const job = renderJob(s, v);
    if (job) main.append(job);
    const st = v.staff || { leaving: [], candidates: {}, hired: {}, reasons: {}, market: [], contract: {}, renewed: [], turned_down: {} };
    const contract = st.contract || {};
    const renewed = new Map((st.renewed || []).map((r) => [r.id, r]));
    const card = el("section", { class: "go-card off-staff", "data-key": "staff" }, [el("div", { class: "go-kicker", text: "YOUR STAFF" })]);
    if (!st.leaving.length) card.append(el("p", { "data-key": "all-back", text: "Your whole staff is back." }));
    for (const who of st.leaving) {
      const c = contract[who.id] || {};
      card.append(el("p", { "data-key": `leaving-${who.id}` }, [el("b", { text: `${who.role} ${who.name}` }), ` ${(st.reasons || {})[who.id] || "is moving on"}.`,
        c.expiring ? el("span", { class: "go-tag warn off-contract", text: "Contract up: he is shopping" }) : null]));
      const row = el("div", { class: "off-cands", "data-key": `cands-${who.id}` });
      (st.candidates[who.id] || []).forEach((c, i) => {
        row.append(candidateCard(c, st.hired[who.id] === i, (ev) => act(ev, s, () => H.api(`/api/season/${s.id}/offseason/hire`, H.postJSON({ staff_id: who.id, index: i })),
          `Hired ${c.name} as ${who.role}`), `${who.id}-${i}`, v.year));
      });
      card.append(row);
    }
    const leaving = new Set(st.leaving.map((w) => w.id));
    const staying = (v.your_staff || []).filter((x) => !leaving.has(x.id));
    // a coordinator another program wanted as its head coach, who turned it down: he is under contract
    for (const x of staying) {
      if (!(x.id in (st.turned_down || {}))) continue;
      const school = st.turned_down[x.id];
      card.append(el("p", { class: "muted", "data-key": `declined-${x.id}` }, [el("b", { text: `${x.role} ${x.name}` }),
        ` turned down ${school ? school : "a bigger job"}: under contract${x.contract_until ? ` through ${x.contract_until}` : ""}.`]));
    }
    if (staying.length && !v.fired) {
      card.append(el("div", { class: "go-kicker muted off-sub", "data-key": "staying", text: "STAYING · LET ONE GO AND HIRE FROM THE MARKET" }));
      const row = el("div", { class: "off-letgo", "data-key": "letgo" });
      for (const x of staying) {
        const r = renewed.get(x.id);
        const term = r ? el("span", { class: "go-tag good off-contract", text: `Re-signed through ${r.through}` })
          : x.contract_until ? el("span", { class: "go-tag muted off-contract", text: `Signed through ${x.contract_until}` }) : null;
        const b = el("button", { type: "button", class: "go-act", "data-key": x.id }, [el("span", { class: "off-staff-name" }, [`${x.role} ${x.name} `, term]), el("span", { text: "Let him go" })]);
        ui.on(b, "click", (ev) => {
          if (!window.confirm(`Let ${x.role} ${x.name} go? He joins the coaching market and you hire his replacement now.`)) return;
          act(ev, s, () => H.api(`/api/season/${s.id}/offseason/open_role`, H.postJSON({ staff_id: x.id })), `${x.role} ${x.name} is out · hire his replacement`);
        });
        row.append(b);
      }
      card.append(row);
    }
    const coaches = el("section", { class: "go-card", "data-key": "carousel" }, [el("div", { class: "go-kicker", text: "COACHING CAROUSEL" }),
      v.coaching_changes.length ? el("ul", { class: "off-list" }, v.coaching_changes.map((c) => el("li", {}, [window.CFP.teamPill(c.team),
        c.reason === "hired" ? ` ${teamName(c.team)} hires ${c.new}${c.from ? ` (${c.from})` : ""}.` : ` ${teamName(c.team)}: ${c.old} ${c.reason}.`])))
        : el("p", { class: "muted", text: "No head coaching changes this year." })]);
    main.append(el("div", { class: "off-grid", "data-key": "staff-grid" }, [card, coaches]));
    if ((st.market || []).length) {
      const t = el("table", { class: "off-table" }, [el("thead", {}, [el("tr", {}, ["Coach", "Would take", "Rating", "Why he is available", "Last job"].map((h) => el("th", { text: h })))])]);
      const body = el("tbody");
      for (const m of st.market) {
        body.append(el("tr", {}, [el("td", { text: `${m.name}, ${m.age}` }), el("td", { text: m.roles.join(", ") }), el("td", { class: "num", text: String(m.rating) }),
          el("td", { text: `${m.why}${m.sits_out ? " · sitting out this cycle" : ""}` }), el("td", { text: m.previous_job && m.previous_job !== m.why ? m.previous_job : "—" })]));
      }
      t.append(body);
      main.append(el("section", { class: "go-card off-scroll", "data-key": "market" }, [el("div", { class: "go-kicker", text: `COACHES FOR HIRE · THE TOP ${st.market.length}` }),
        el("p", { class: "muted small", text: "The coaching market: fired and let-go coaches, head coaches from the FCS and lower divisions, NFL assistants and position coaches. Open a job on your staff to hire from it." }), t]));
    }
  }

  function renderReady(v, main) {
    const moving = v.job && v.job.moving_to;
    main.append(el("section", { class: "go-card" }, [el("div", { class: "go-kicker", text: "READY" }),
      el("p", { text: moving ? `You are the new head coach at ${teamName(moving)}. A new class of high school seniors is waiting, and the ${v.year} schedule is out.`
        : `Your roster is set at ${v.roster}. A new class of high school seniors is waiting, and the ${v.year} schedule is out.` })]));
  }

  function renderHistory(v) {
    const t = el("table", { class: "off-table" }, [el("thead", {}, [el("tr", {}, ["Year", "Record", "Final AP", "", "Class", "Drafted"].map((h) => el("th", { text: h })))])]);
    const body = el("tbody");
    for (const h of v.history.slice().reverse()) {
      const notes = [h.won_title ? "National champions" : "", h.conference_champion ? "Conference champions" : ""].filter(Boolean).join(" · ");
      body.append(el("tr", {}, [el("td", { text: String(h.year) }), el("td", { class: "num", text: `${h.wins}-${h.losses}` }),
        el("td", { class: "num", text: h.ap_rank ? `#${h.ap_rank}` : "—" }), el("td", { text: notes }),
        el("td", { class: "num", text: h.class_rank ? `#${h.class_rank}` : "—" }), el("td", { class: "num", text: String(h.drafted || 0) })]));
    }
    t.append(body);
    return el("section", { class: "go-card off-scroll", "data-key": "history" }, [el("div", { class: "go-kicker", text: "YOUR PROGRAM'S HISTORY" }), t]);
  }

  window.Offseason = { render };
})();
