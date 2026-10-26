/* Coach Career's offseason on the season page: who leaves (the draft, graduation, the transfer
   portal), two portal rounds to fill your roster, who improved, staff changes, then the next
   season. window.Offseason.render(season, box, helpers); helpers as for recruiting.js. Colours
   come from the theme variables (light and dark). */
(function () {
  "use strict";
  const { el } = window.CFP;
  const GROUPS = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"];
  const USAGE = { starter: "Started", rotation: "Rotation", bench: "Bench" };
  const KIND_ORDER = ["draft", "undrafted", "graduated", "portal", "quit"];
  const view = { position: "", status: "available" };
  let H = null;

  const teamName = (slug) => (window.CFP.teamsBySlug[slug] || {}).name || slug;
  const loading = (text) => el("p", { class: "muted go-loading", text });
  const ordinal = (n) => { const t = n % 100, u = n % 10; return `${n}${t > 10 && t < 14 ? "th" : u === 1 ? "st" : u === 2 ? "nd" : u === 3 ? "rd" : "th"}`; };
  const stars = (n) => (n ? "★".repeat(n) : "");

  function stepper(v) {
    return el("ol", { class: "off-steps", "aria-label": "Offseason steps" }, v.stages.map((st, i) =>
      el("li", { class: `off-step ${st.done ? "done" : ""} ${st.current ? "now" : ""}`, "aria-current": st.current ? "step" : null }, [
        el("span", { class: "off-step-mark", text: st.done ? "✓" : String(i + 1) }), el("span", { text: st.name })])));
  }

  async function render(s, box, helpers) {
    H = helpers;
    box.innerHTML = "";
    box.append(loading("Opening the offseason…"));
    let v;
    try {
      const q = new URLSearchParams();
      if (view.position) q.set("position", view.position);
      if (view.status) q.set("status", view.status);
      v = await H.api(`/api/season/${s.id}/offseason?${q}`);
    } catch (err) {
      box.innerHTML = "";
      box.append(loading(`Could not open the offseason: ${H.errText(err)}`));
      return;
    }
    box.innerHTML = "";
    const head = el("section", { class: "go-card off-head" }, [
      el("div", { class: "go-kicker", text: `OFFSEASON · ON TO ${v.year}` }),
      el("div", { class: "go-display xl", text: v.stage_name.toUpperCase() }),
      stepper(v),
      el("div", { class: "go-mini off-numbers" }, [stat("ROSTER", `${v.roster} / ${v.roster_limit || 85}${v.retention && !v.retention.results && v.retention.players.length ? ` · ${v.retention.players.length} deciding` : ""}`), stat("CLASS SIGNED", String(v.signed)),
        stat("OPEN SPOTS", String(v.open_spots)), stat("PORTAL", `${v.portal.signed} of ${v.portal.entrants} placed`)]),
    ]);
    const actions = el("div", { class: "go-play off-actions" });
    head.append(actions);
    box.append(head);
    const main = el("div", { class: "off-main" });
    box.append(main);
    const next = { departures: v.retention && v.retention.players.length ? "KEEP THEM HOME" : "OPEN THE TRANSFER PORTAL", retention: "OPEN THE TRANSFER PORTAL",
                   portal_1: "END ROUND 1", portal_2: "CLOSE THE PORTAL", portal_w1: "END WEEK 1", portal_w2: "END WEEK 2",
      portal_w3: "END WEEK 3", portal_w4: "CLOSE THE PORTAL", development: "STAFF CHANGES",
                   staff: "FINISH THE OFFSEASON", ready: `START THE ${v.year} SEASON` }[v.stage];
    const go = el("button", { type: "button", class: "go-btn primary big", text: next });
    go.addEventListener("click", () => advance(s, box, go, v.stage === "ready" ? "next_season" : null));
    actions.append(go);
    if (v.stage !== "ready") {
      const all = el("button", { type: "button", class: "go-btn big2", text: "Sim to next season" });
      all.addEventListener("click", () => advance(s, box, all, "next_season"));
      actions.append(all);
    }
    if (v.review) main.append(renderReview(s, v, box));
    if (v.fired && v.stage !== "departures" && v.stage !== "staff" && v.stage !== "ready") main.append(firedNote(v));
    if (v.stage === "departures") renderDepartures(v, main);
    else if (v.stage === "retention") renderRetention(s, v, main, box);
    else if (v.stage === "portal_1" || v.stage === "portal_2") renderPortal(s, v, main, box);
    else if (v.stage.startsWith("portal_w")) renderPortalWeeks(s, v, main, box);
    else if (v.stage === "development") renderDevelopment(v, main);
    else if (v.stage === "staff") renderStaff(s, v, main);
    else renderReady(v, main);
    if (v.history.length) main.append(renderHistory(v));
  }

  function firedNote(v) {
    return el("section", { class: "go-card off-fired" }, [el("div", { class: "go-kicker", text: "YOU HAVE BEEN LET GO" }),
      el("p", { text: `The program's next coach runs the rest of the ${v.year} offseason. Walk the steps and pick your next job at the Staff step.` })]);
  }

  function meter(sec) {
    const cls = sec < 25 ? "bad" : sec < 40 ? "warn" : "good";
    return el("div", { class: `off-meter ${cls}` }, [el("div", { class: "off-meter-fill", style: `width:${Math.max(2, Math.min(100, sec))}%` })]);
  }

  function renderReview(s, v, box) {
    const r = v.review;
    const card = el("section", { class: "go-card off-review" }, [el("div", { class: "go-kicker", text: "YOUR MEETING WITH THE AD" }),
      el("div", { class: "go-mini off-numbers" }, [stat("THE GOAL", r.goal), stat("YOUR RECORD", `${r.record[0]}-${r.record[1]}`),
        stat("JOB SECURITY", `${r.security} / 100`), stat("HIS PATIENCE", `${r.patience} years`), stat("YEAR", `${r.tenure} in the job`)]),
      meter(r.security),
      el("p", { class: "off-why", text: r.words })]);
    if (r.decided) {
      if (r.outcome && r.outcome !== r.words) card.append(el("p", {}, [el("b", { text: r.outcome })]));
      if (r.fired) card.append(el("p", { class: "bad-text", text: "Firing happens only at the end of a season; you will pick your next job at the Staff step." }));
      return card;
    }
    if (v.stage !== "departures") return card;
    card.append(el("p", { class: "muted", text: r.risk === "fire" ? "He is deciding whether to make a change. What do you say?"
      : "A warning. What do you say?" }));
    const acts = el("div", { class: "off-review-acts" });
    const send = async (action, staffId) => {
      try { await H.api(`/api/season/${s.id}/offseason/review`, H.postJSON({ action, staff_id: staffId || null })); render(s, box, H); }
      catch (err) { H.toast(H.errText(err)); }
    };
    const tips = { case: "Point to the class you signed and the players you developed; a little goodwill.",
      change: "Let a coordinator go; the AD sees a coach who will not stand pat.",
      year: "He always says yes, but the goal must be met next season or you are gone.",
      nothing: "Leave it to him." };
    for (const o of r.options) {
      if (o === "change") {
        const coords = (v.your_staff || []).filter((x) => x.role === "OC" || x.role === "DC");
        for (const c of coords) {
          const b = el("button", { type: "button", class: "go-act" }, [`Let ${c.role} ${c.name} go`, el("span", { text: tips.change })]);
          b.addEventListener("click", () => send("change", c.id));
          acts.append(b);
        }
        continue;
      }
      const b = el("button", { type: "button", class: "go-act" }, [r.option_names[o], el("span", { text: tips[o] })]);
      b.addEventListener("click", () => send(o));
      acts.append(b);
    }
    card.append(acts);
    return card;
  }

  function stat(k, val) { return el("div", { class: "go-stat" }, [el("div", { class: "go-kicker muted", text: k }), el("div", { class: "go-stat-val", text: val })]); }

  async function advance(s, box, btn, to) {
    btn.disabled = true;
    btn.textContent = to ? "Working through the offseason…" : "Working…";
    try {
      const r = await H.api(`/api/season/${s.id}/offseason/advance`, H.postJSON(to ? { to } : {}));
      if (r.next_season) {
        H.toast(`On to ${r.year}: a new season and a new class of recruits.`, 3500);
        location.reload();
        return;
      }
      render(s, box, H);
    } catch (err) {
      btn.disabled = false;
      H.toast(`Could not continue: ${H.errText(err)}`);
    }
  }

  function renderDepartures(v, main) {
    const mine = v.departures.mine;
    const card = el("section", { class: "go-card" }, [el("div", { class: "go-kicker", text: `LEAVING YOUR PROGRAM · ${mine.length}` })]);
    for (const kind of KIND_ORDER) {
      const rows = mine.filter((d) => d.kind === kind);
      if (!rows.length) continue;
      card.append(el("div", { class: "go-kicker muted off-sub", text: `${rows[0].kind_name.toUpperCase()} · ${rows.length}` }),
        el("ul", { class: "off-list" }, rows.sort((a, b) => (a.pick || 999) - (b.pick || 999) || b.overall - a.overall).map((d) => el("li", {}, [
          el("b", { text: d.name }), el("span", { class: "muted", text: ` ${d.pos} · ${d.cls} · ${d.overall} OVR` }),
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
    main.append(el("div", { class: "off-grid" }, [card, league]));
  }

  // Keep them home: your leavers with eligibility left, what each wants, and your moves (API: offseason/retain)
  function renderRetention(s, v, main, box) {
    const r = v.retention;
    const act = async (pid, action, nil) => {
      try { await H.api(`/api/season/${s.id}/offseason/retain`, H.postJSON({ pid, action, nil: nil || 0 })); render(s, box, H); }
      catch (err) { H.toast(`Could not do that: ${H.errText(err)}`, 4000); }
    };
    const head = el("section", { class: "go-card" }, [
      el("div", { class: "go-kicker", text: `KEEP THEM HOME · ${r.players.length} WANT OUT` }),
      el("p", {}, [`${r.players.length} of your players with eligibility left mean to leave: transfers and early draft entrants. Meet each one to hear what it would take. `,
        "A promised starting role only counts if your depth chart would really start him; NIL comes out of next year's budget, so it is money you will not have for recruits or the portal. ",
        "Nobody decides until you advance; graduating seniors are gone either way."]),
      el("div", { class: "go-row wrap" }, [el("span", { class: "go-stat" }, [el("div", { class: "go-kicker muted", text: "NEXT YEAR'S NIL" }), el("div", { class: "go-stat-val", text: `${r.left} / ${r.budget}` })]),
        el("span", { class: "go-stat" }, [el("div", { class: "go-kicker muted", text: "COMMITTED TO KEEP THEM" }), el("div", { class: "go-stat-val", text: `${r.spent}` })])]),
    ]);
    const cards = el("div", { class: "go-cards off-keep" });
    for (const e of r.players) {
      const c = el("article", { class: `go-card go-pcard ${e.offers.released ? "muted" : ""}` });
      c.append(el("div", { class: "go-card-head" }, [el("div", {}, [el("b", { class: "go-name", text: e.name }),
        el("div", { class: "muted small", text: `${e.pos} · ${e.cls} next year · ${e.overall} OVR${e.stars ? ` · ${"★".repeat(e.stars)}` : ""}` })]),
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
      const btn = (label, sub, onclick, tone, off) => { const b = el("button", { type: "button", class: `go-act ${tone || ""}` }, [el("b", { text: label }), el("span", { text: sub })]); if (off) b.disabled = true; b.addEventListener("click", onclick); return b; };
      const row = el("div", { class: "go-actions off-keep-acts" }, [
        btn("Meet", e.met ? "done" : "free", () => act(e.id, "meet"), "", e.met),
        btn("Promise a start", e.role_next === "starter" ? "he would start" : "he would not", () => act(e.id, "promise"), e.role_next === "starter" ? "go" : "", e.offers.promise),
        btn("Let him go", e.offers.released ? "letting go" : "", () => act(e.id, "release"), "", e.offers.released)]);
      const nil = el("input", { type: "number", min: "0", step: "5", value: String(e.offers.nil || e.ask.nil || 0), class: "go-nil", id: `keep-nil-${e.id}` });
      const nilRow = el("div", { class: "go-row off-keep-nil" }, [el("label", { for: `keep-nil-${e.id}`, class: "muted small", text: "NIL" }), nil,
        btn("Offer NIL", "from next year's", () => act(e.id, "nil", Number(nil.value) || 0), "alt")]);
      c.append(row, nilRow);
      cards.append(c);
    }
    if (!r.players.length) head.append(el("p", { class: "muted", text: "Nobody with eligibility left wants out. Open the portal." }));
    main.append(head, cards);
  }

  function renderPortalWeeks(s, v, main, box) {
    const p = v.portal;
    const head = el("section", { class: "go-card" }, [
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
    const board = el("div", { class: "off-board" });
    main.append(head, board);
    window.Recruiting.board(s, board, H);
  }

  function renderPortal(s, v, main, box) {
    const p = v.portal;
    const head = el("section", { class: "go-card" }, [
      el("div", { class: "go-kicker", text: `TRANSFER PORTAL · ROUND ${p.round} OF 2` }),
      el("p", {}, [`You have ${v.open_spots} open spots${v.release_spots ? ` (and ${v.release_spots} more by releasing the end of your roster)` : ""} and ${p.offers_left} offers left this round. Entrants with offers pick a school when the round ends: `,
        "playing time first, then the program, winning and home."]),
    ]);
    const filters = el("div", { class: "off-filters" });
    const pos = el("select", { "aria-label": "Position" }, [el("option", { value: "", text: "All positions" }), ...GROUPS.map((g) => el("option", { value: g, text: g }))]);
    pos.value = view.position;
    pos.addEventListener("change", () => { view.position = pos.value; render(s, box, H); });
    const status = el("select", { "aria-label": "Status" }, [["available", "Still available"], ["offered", "Offered by you"], ["signed", "Signed"], ["", "Everyone"]]
      .map(([k, t]) => el("option", { value: k, text: t })));
    status.value = view.status;
    status.addEventListener("change", () => { view.status = status.value; render(s, box, H); });
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
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try { await H.api(`/api/season/${s.id}/offseason/portal`, H.postJSON({ pid: r.id, on: !r.offered })); render(s, box, H); }
        catch (err) { btn.disabled = false; H.toast(H.errText(err)); }
      });
      body.append(el("tr", { class: r.offered ? "offered" : "" }, [
        el("td", {}, [el("b", { text: r.name }), r.stars ? el("span", { class: "muted small", text: ` ${stars(r.stars)}` }) : null]),
        el("td", { text: r.pos }), el("td", { text: r.cls }), el("td", { class: "num", text: String(r.overall) }),
        el("td", {}, [window.CFP.teamPill(r.from), ` ${r.from_name}`]), el("td", { text: USAGE[r.last_year] || "" }),
        el("td", {}, [el("span", { class: `go-tag ${r.fit === "Would start" ? "good" : r.fit === "Next in line" ? "warn" : "muted"}`, text: r.fit })]),
        el("td", { class: "num", text: r.signed ? r.signed_name : String(r.offers) }), el("td", {}, [btn])]));
    }
    table.append(body);
    main.append(head, el("section", { class: "go-card off-scroll" }, [p.rows.length ? table : el("p", { class: "muted", text: "Nobody matches." })]));
  }

  function renderDevelopment(v, main) {
    const r = v.report || { mine: [] };
    main.append(el("section", { class: "go-card" }, [
      el("div", { class: "go-kicker", text: "WHO IMPROVED" }),
      el("p", { class: "muted", text: `Every returning player grows toward his potential at his coachability's pace, faster under good developers and faster still after a big year: production and honors raise a player's ceiling and his pace. ${r.walk_ons} walk-ons and lower-level transfers joined around the league to fill out rosters.` }),
      el("ul", { class: "off-list" }, r.mine.map((d) => el("li", {}, [el("b", { text: d.name }), el("span", { class: "muted", text: ` ${d.pos} · ${d.cls} · now ${d.overall} OVR ` }),
        el("span", { class: `go-tag ${d.gain > 0 ? "good" : "muted"}`, text: d.gain > 0 ? `+${d.gain}` : "no change" }),
        ...(d.why || []).map((w) => el("span", { class: `go-tag ${/Struggled/.test(w) ? "bad" : "warn"}`, text: w }))])))]));
  }

  function renderJob(s, v) {
    const j = v.job;
    if (!j) return null;
    const you = j.you || {};
    const card = el("section", { class: "go-card" }, [el("div", { class: "go-kicker", text: "YOUR JOB" })]);
    if (you.goal) card.append(el("p", {}, [`Your AD's goal: ${you.goal.text}. `, you.met ? "You met it." : "You fell short.",
      ` Job security ${you.security} of 100 (patience: ${you.patience} years).`]));
    const list = you.fired ? j.openings : j.offers;
    if (you.fired) card.append(el("p", {}, [el("b", { text: "You have been fired. " }), "Pick your next job from the openings (Auto takes the best one)."]));
    else if (list.length) card.append(el("p", { text: "After the year you had, these programs want you as their head coach:" }));
    else card.append(el("p", { class: "muted", text: "No offers this year. Win big and better programs with an opening will call." }));
    for (const o of list) {
      const picked = j.choice === o.team;
      const b = el("button", { type: "button", class: `go-card off-cand ${picked ? "picked" : ""}`, "aria-pressed": String(picked) }, [
        el("span", {}, [window.CFP.teamPill(o.team), el("b", { text: ` ${o.name}` })]),
        el("span", { class: "muted small", text: `${o.conference} · team rating ${Math.round(o.rating)} · goal: ${o.goal}` }),
        el("span", { class: "go-tag", text: picked ? "Taking it" : "Take this job" })]);
      b.addEventListener("click", async () => {
        try { await H.api(`/api/season/${s.id}/offseason/job`, H.postJSON({ team: picked ? null : o.team })); render(s, document.getElementById("tab-offseason"), H); }
        catch (err) { H.toast(H.errText(err)); }
      });
      card.append(b);
    }
    return card;
  }

  function candidateCard(c, picked, onClick) {
    const stops = (c.history || []).slice(-3).map((h) => `${h.team_name || h.team}${h.year ? ` ${h.year}–${h.to || ""}` : ""}`).join(" · ");
    const b = el("button", { type: "button", class: `go-card off-cand ${picked ? "picked" : ""}`, "aria-pressed": String(picked) }, [
      el("b", { text: `${c.name}${c.age ? `, ${c.age}` : ""}` }),
      el("span", { class: "muted small", text: `Evaluation ${c.evaluation} · Recruiting ${c.recruiting}${c.play_calling ? ` · Play calling ${c.play_calling}` : ""}` }),
      c.previous_job ? el("span", { class: "small", text: c.previous_job }) : null,
      c.why ? el("span", { class: "muted small off-cand-why", text: c.why }) : null,
      stops ? el("span", { class: "muted small", text: stops }) : null,
      el("span", { class: "go-tag", text: picked ? "Hired" : "Hire" })]);
    b.addEventListener("click", onClick);
    return b;
  }

  function renderStaff(s, v, main) {
    const job = renderJob(s, v);
    if (job) main.append(job);
    const st = v.staff || { leaving: [], candidates: {}, hired: {}, reasons: {}, market: [] };
    const card = el("section", { class: "go-card" }, [el("div", { class: "go-kicker", text: "YOUR STAFF" })]);
    if (!st.leaving.length) card.append(el("p", { text: "Your whole staff is back. Everyone grew a little." }));
    for (const who of st.leaving) {
      card.append(el("p", {}, [el("b", { text: `${who.role} ${who.name}` }), ` ${(st.reasons || {})[who.id] || "is moving on"}.`]));
      const row = el("div", { class: "off-cands" });
      (st.candidates[who.id] || []).forEach((c, i) => {
        row.append(candidateCard(c, st.hired[who.id] === i, async () => {
          try { await H.api(`/api/season/${s.id}/offseason/hire`, H.postJSON({ staff_id: who.id, index: i })); render(s, document.getElementById("tab-offseason"), H); }
          catch (err) { H.toast(H.errText(err)); }
        }));
      });
      card.append(row);
    }
    const leaving = new Set(st.leaving.map((w) => w.id));
    const staying = (v.your_staff || []).filter((x) => !leaving.has(x.id));
    if (staying.length && !v.fired) {
      card.append(el("div", { class: "go-kicker muted off-sub", text: "STAYING · LET ONE GO AND HIRE FROM THE MARKET" }));
      const row = el("div", { class: "off-letgo" });
      for (const x of staying) {
        const b = el("button", { type: "button", class: "go-act" }, [`${x.role} ${x.name}`, el("span", { text: "Let him go" })]);
        b.addEventListener("click", async () => {
          if (!window.confirm(`Let ${x.role} ${x.name} go? He joins the coaching market and you hire his replacement now.`)) return;
          try { await H.api(`/api/season/${s.id}/offseason/open_role`, H.postJSON({ staff_id: x.id })); render(s, document.getElementById("tab-offseason"), H); }
          catch (err) { H.toast(H.errText(err)); }
        });
        row.append(b);
      }
      card.append(row);
    }
    const coaches = el("section", { class: "go-card" }, [el("div", { class: "go-kicker", text: "COACHING CAROUSEL" }),
      v.coaching_changes.length ? el("ul", { class: "off-list" }, v.coaching_changes.map((c) => el("li", {}, [window.CFP.teamPill(c.team),
        c.reason === "hired" ? ` ${teamName(c.team)} hires ${c.new}${c.from ? ` (${c.from})` : ""}.` : ` ${teamName(c.team)}: ${c.old} ${c.reason}.`])))
        : el("p", { class: "muted", text: "No head coaching changes this year." })]);
    main.append(el("div", { class: "off-grid" }, [card, coaches]));
    if ((st.market || []).length) {
      const t = el("table", { class: "off-table" }, [el("thead", {}, [el("tr", {}, ["Coach", "Would take", "Rating", "Why he is available", "Last job"].map((h) => el("th", { text: h })))])]);
      const body = el("tbody");
      for (const m of st.market) {
        body.append(el("tr", {}, [el("td", { text: `${m.name}, ${m.age}` }), el("td", { text: m.roles.join(", ") }), el("td", { class: "num", text: String(m.rating) }),
          el("td", { text: `${m.why}${m.sits_out ? " · sitting out this cycle" : ""}` }), el("td", { text: m.previous_job })]));
      }
      t.append(body);
      main.append(el("section", { class: "go-card off-scroll" }, [el("div", { class: "go-kicker", text: `COACHES FOR HIRE · THE TOP ${st.market.length}` }),
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
    return el("section", { class: "go-card off-scroll" }, [el("div", { class: "go-kicker", text: "YOUR PROGRAM'S HISTORY" }), t]);
  }

  window.Offseason = { render };
})();
