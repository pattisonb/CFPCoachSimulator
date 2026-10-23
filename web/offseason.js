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
      el("div", { class: "go-mini off-numbers" }, [stat("ROSTER", `${v.roster} / ${v.roster_limit || 85}`), stat("CLASS SIGNED", String(v.signed)),
        stat("OPEN SPOTS", String(v.open_spots)), stat("PORTAL", `${v.portal.signed} of ${v.portal.entrants} placed`)]),
    ]);
    const actions = el("div", { class: "go-play off-actions" });
    head.append(actions);
    box.append(head);
    const main = el("div", { class: "off-main" });
    box.append(main);
    const next = { departures: "OPEN THE TRANSFER PORTAL", portal_1: "END ROUND 1", portal_2: "CLOSE THE PORTAL", development: "STAFF CHANGES",
                   staff: "FINISH THE OFFSEASON", ready: `START THE ${v.year} SEASON` }[v.stage];
    const go = el("button", { type: "button", class: "go-btn primary big", text: next });
    go.addEventListener("click", () => advance(s, box, go, v.stage === "ready" ? "next_season" : null));
    actions.append(go);
    if (v.stage !== "ready") {
      const all = el("button", { type: "button", class: "go-btn big2", text: "Sim to next season" });
      all.addEventListener("click", () => advance(s, box, all, "next_season"));
      actions.append(all);
    }
    if (v.stage === "departures") renderDepartures(v, main);
    else if (v.stage === "portal_1" || v.stage === "portal_2") renderPortal(s, v, main, box);
    else if (v.stage === "development") renderDevelopment(v, main);
    else if (v.stage === "staff") renderStaff(s, v, main);
    else renderReady(v, main);
    if (v.history.length) main.append(renderHistory(v));
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

  function renderStaff(s, v, main) {
    const job = renderJob(s, v);
    if (job) main.append(job);
    const st = v.staff || { leaving: [], candidates: {}, hired: {} };
    const card = el("section", { class: "go-card" }, [el("div", { class: "go-kicker", text: "YOUR STAFF" })]);
    if (!st.leaving.length) card.append(el("p", { text: "Your whole staff is back. Everyone grew a little." }));
    for (const who of st.leaving) {
      card.append(el("p", {}, [el("b", { text: `${who.role} ${who.name}` }), who.role === "Recruiter" ? " is moving on." : " was hired away as a head coach."]));
      const row = el("div", { class: "off-cands" });
      (st.candidates[who.id] || []).forEach((c, i) => {
        const picked = st.hired[who.id] === i;
        const b = el("button", { type: "button", class: `go-card off-cand ${picked ? "picked" : ""}`, "aria-pressed": String(picked) }, [
          el("b", { text: c.name }), el("span", { class: "muted small", text: `Evaluation ${c.evaluation} · Recruiting ${c.recruiting}` }),
          el("span", { class: "go-tag", text: picked ? "Hired" : "Hire" })]);
        b.addEventListener("click", async () => {
          try { await H.api(`/api/season/${s.id}/offseason/hire`, H.postJSON({ staff_id: who.id, index: i })); render(s, document.getElementById("tab-offseason"), H); }
          catch (err) { H.toast(H.errText(err)); }
        });
        row.append(b);
      });
      card.append(row);
    }
    const coaches = el("section", { class: "go-card" }, [el("div", { class: "go-kicker", text: "COACHING CAROUSEL" }),
      v.coaching_changes.length ? el("ul", { class: "off-list" }, v.coaching_changes.map((c) => el("li", {}, [window.CFP.teamPill(c.team),
        c.reason === "hired" ? ` ${teamName(c.team)} hires ${c.new}${c.from ? ` (${c.from})` : ""}.` : ` ${teamName(c.team)}: ${c.old} ${c.reason}.`])))
        : el("p", { class: "muted", text: "No head coaching changes this year." })]);
    main.append(el("div", { class: "off-grid" }, [card, coaches]));
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
