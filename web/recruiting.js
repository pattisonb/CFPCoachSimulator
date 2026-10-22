/* Coach Career recruiting on the season page: the Recruiting tab (your board, hours, NIL points,
   actions, Auto-recruit and the week's news), the Prospects tab (the class, filtered, each row
   opening his Prospect Profile) and the Staff tab (who scouts which area).
   window.Recruiting.render(tab, season, helpers); helpers: { api, postJSON, toast, openModal,
   errText, onChange } from season.js. */
(function () {
  "use strict";
  const { el } = window.CFP;
  const ACTIONS = [["message", "Message"], ["call", "Phone call"], ["hc_visit", "Head coach visit"], ["official_visit", "Official visit"],
                   ["offer", "Offer"], ["pull_offer", "Pull offer"]];
  const PITCH_NAMES = { proximity: "Close to home", playing_time: "Playing time", prestige: "Program prestige", winning: "Winning now",
                        nil: "NIL", coach: "The head coach", academics: "Academics" };
  const GROUP_NAMES = { athleticism: "Athleticism", size_strength: "Size & strength", technique: "Technique", football_iq: "Football IQ",
                        potential: "Potential", coachability: "Coachability" };
  const STATUS = [["", "Any status"], ["open", "Uncommitted"], ["committed", "Committed"], ["signed", "Signed"], ["leaning_fcs", "Leaning FCS"],
                  ["offered", "Offered by you"], ["board", "On your board"]];
  const POSITIONS = ["QB", "RB", "WR", "TE", "OT", "IOL", "EDGE", "DL", "LB", "CB", "S", "ATH", "K", "P"];
  const STATES = ["AK", "AL", "AR", "AZ", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "IA", "ID", "IL", "IN", "KS", "KY", "LA", "MA", "MD", "ME",
                  "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI", "SC", "SD",
                  "TN", "TX", "UT", "VA", "VT", "WA", "WI", "WV", "WY"];
  const view = { filters: { q: "", position: "", stars: "", state: "", status: "" }, offset: 0, data: null };
  let H = null;

  const stars = (n) => "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
  const height = (inches) => `${Math.floor(inches / 12)}'${inches % 12}"`;
  function status(r) {
    if (r.signed) return r.signed === "FCS" ? "Signed with an FCS program" : `Signed · ${r.school_name}`;
    if (r.committed) return `Committed · ${r.school_name}`;
    if (r.leaning_fcs) return "Leaning FCS";
    return "Uncommitted";
  }
  function meter(label, left, total, unit) {
    const pct = total ? Math.max(0, Math.min(100, (100 * left) / total)) : 0;
    return el("div", { class: "rc-meter" }, [
      el("div", { class: "rc-meter-label" }, [el("span", { text: label }), el("b", { text: `${left} / ${total}${unit ? ` ${unit}` : ""}` })]),
      el("div", { class: "progress" }, [el("div", { class: "progress-bar", style: `width:${pct}%` })]),
    ]);
  }
  function bar(value, max) {
    const pct = max ? Math.max(2, Math.min(100, (100 * value) / max)) : 0;
    return el("span", { class: "rc-bar" }, [el("span", { style: `width:${pct}%` })]);
  }
  function avatar(seed) {
    // a portrait from the coach sprite system, its look picked from his id
    let h = 0;
    for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const pick = (arr) => arr[(h = (h * 1103515245 + 12345) >>> 0) % arr.length];
    const look = { skin: pick(["#f1c9a5", "#e0b48f", "#c68e64", "#a26a42", "#7b4a2c", "#5a3520"]), hair: pick(["short", "buzz", "curly", "side part"]),
                   hair_color: pick(["#1d1410", "#3b2416", "#5a3a22", "#8a5a32", "#c49a5a"]), outfit: "hoodie" };
    const span = el("span", { class: "rc-avatar", "aria-hidden": "true" });
    if (window.CoachSprite) span.innerHTML = window.CoachSprite(look, null);
    return span;
  }
  async function act(s, pid, action, pitch, nil) {
    const body = { pid, action };
    if (pitch) body.pitch = pitch;
    if (nil) body.nil = nil;
    try {
      const r = await H.api(`/api/season/${s.id}/recruit`, H.postJSON(body));
      const what = ACTIONS.find((a) => a[0] === action)[1];
      H.toast(`${what} done · ${r.hours_left} hours left${r.revealed ? ` · he cares about ${PITCH_NAMES[r.revealed].toLowerCase()}` : ""}`, 3000);
      return r;
    } catch (err) {
      H.toast(`Could not do that: ${H.errText(err)}`, 4000);
      return null;
    }
  }
  async function setBoard(s, pid, on) {
    try { await H.api(`/api/season/${s.id}/board`, H.postJSON({ pid, on })); }
    catch (err) { H.toast(`Could not change your board: ${H.errText(err)}`, 4000); }
  }
  const tableWrap = (table) => el("div", { class: "table-scroll" }, [table]);

  // ----- the Recruiting tab ---------------------------------------------------------------------

  async function renderRecruiting(s, box) {
    box.innerHTML = "";
    box.append(el("p", { class: "muted", text: "Loading recruiting…" }));
    let v;
    try { v = await H.api(`/api/season/${s.id}/recruiting`); }
    catch (err) { box.innerHTML = ""; box.append(el("p", { class: "muted", text: `Could not load recruiting: ${H.errText(err)}` })); return; }
    box.innerHTML = "";
    const auto = el("input", { type: "checkbox", id: "rc-auto" });
    auto.checked = v.auto_recruit;
    auto.addEventListener("change", async () => {
      try { await H.api(`/api/season/${s.id}/settings`, H.postJSON({ auto_recruit: auto.checked })); H.toast(auto.checked ? "Auto-recruit on: your staff spend your hours each week." : "Auto-recruit off.", 3000); }
      catch (err) { auto.checked = !auto.checked; H.toast(`Could not change Auto-recruit: ${H.errText(err)}`, 4000); }
    });
    box.append(el("div", { class: "rc-head" }, [
      meter("Hours this week", v.hours_left, v.hours),
      meter("NIL points", v.nil.left, v.nil.budget),
      meter("Offers left", v.offers_left, v.offers + v.offers_left),
      meter("Commitments", v.committed, v.open_spots, "spots"),
      el("label", { class: "rc-auto", for: "rc-auto" }, [auto, " Auto-recruit"]),
    ]));
    // the week's news
    if (v.recap.length) {
      const words = { commit: "committed to", flip: "flipped to", decommit: "decommitted from", signed: "signed with" };
      box.append(el("h3", { text: s.current_week ? `Recruiting news · week ${v.week}` : "Recruiting news" }),
        el("ul", { class: "rc-recap" }, v.recap.slice().reverse().map((e) => el("li", {}, [
          el("a", { href: "#", text: e.name, onclick: (ev) => { ev.preventDefault(); openProfile(s, e.pid); } }),
          ` ${words[e.kind] || e.kind} ${e.school === "FCS" ? "an FCS program" : (window.CFP.teamsBySlug[e.school] || {}).name || e.school || ""}`,
          e.school === s.team && (e.kind === "commit" || e.kind === "flip") ? el("b", { class: "rc-good", text: " · yours" }) : null,
        ]))));
    }
    box.append(el("h3", { text: `Your board (${v.board.length})` }));
    if (!v.board.length) {
      box.append(el("p", { class: "muted" }, ["Your board is empty. Add prospects from the ",
        el("a", { href: "#", text: "Prospects", onclick: (e) => { e.preventDefault(); H.onChange("prospects"); } }), " tab, then recruit them here: each action costs hours, and only an offer lets him commit."]));
      return;
    }
    const maxI = Math.max(1, ...v.board.map((b) => Math.max(b.interest, b.leader ? b.leader.interest : 0)));
    const rows = v.board.map((b) => {
      const sel = el("select", { "aria-label": `Action for ${b.name}` }, ACTIONS.map(([k, label]) =>
        el("option", { value: k, text: `${label}${v.hours_cost[k] ? ` · ${v.hours_cost[k]}h` : ""}` })));
      const pitch = el("select", { "aria-label": `Pitch to ${b.name}` }, [el("option", { value: "", text: "Pitch…" }),
        ...v.pitches.map((p) => el("option", { value: p, text: `${b.priorities_known.includes(p) ? "★ " : ""}${PITCH_NAMES[p]}` }))]);
      const nil = el("input", { type: "number", min: "0", step: "5", value: "0", class: "rc-nil", "aria-label": `NIL points with the offer to ${b.name}`, title: "NIL points with the offer" });
      const sync = () => { const a = sel.value; pitch.hidden = !["message", "call", "hc_visit"].includes(a); nil.hidden = a !== "offer"; };
      sel.addEventListener("change", sync);
      sel.value = b.offered ? "call" : "offer";
      sync();
      const go = el("button", { type: "button", class: "ghost", text: "Go" });
      go.addEventListener("click", async () => {
        go.disabled = true;
        const r = await act(s, b.id, sel.value, pitch.hidden ? null : pitch.value, nil.hidden ? 0 : Number(nil.value) || 0);
        go.disabled = false;
        if (r) renderRecruiting(s, box);
      });
      const drop = el("button", { type: "button", class: "ghost rc-x", title: "Take him off your board", "aria-label": `Take ${b.name} off your board`, text: "×" });
      drop.addEventListener("click", async () => { await setBoard(s, b.id, false); renderRecruiting(s, box); });
      const leader = b.leader ? `${b.leader.name}${b.leader.school === s.team ? " (you)" : ""}` : "—";
      return el("tr", {}, [
        el("td", { class: "name" }, [el("a", { href: "#", text: b.name, onclick: (e) => { e.preventDefault(); openProfile(s, b.id); } }),
          el("span", { class: "pos", text: `${b.position} · #${b.national_rank}` })]),
        el("td", { class: "rc-stars", text: stars(b.stars) }),
        el("td", { text: `${b.hometown.city}, ${b.hometown.state}` }),
        el("td", { text: status(b) + (b.offered ? " · offered" : "") }),
        el("td", {}, [bar(b.interest, maxI), ` ${b.interest.toFixed(1)}`]),
        el("td", { text: leader }),
        el("td", { class: "rc-actions" }, [sel, pitch, nil, go, drop]),
      ]);
    });
    box.append(tableWrap(el("table", { class: "stats rc-board" }, [
      el("thead", {}, [el("tr", {}, ["Prospect", "Stars", "Home", "Status", "Your pull", "Leader", "Recruit"].map((h) => el("th", { text: h })))]),
      el("tbody", {}, rows),
    ])));
    box.append(el("p", { class: "muted small-text", text: "Pitch one of his priorities (★ once a call has revealed it) for about double the effect. A head coach visit is once a month; an official visit is at your next home game." }));
  }

  // ----- the Prospects tab ------------------------------------------------------------------------

  async function renderProspects(s, box) {
    const f = view.filters;
    box.innerHTML = "";
    const q = el("input", { type: "search", placeholder: "Search by name", value: f.q, "aria-label": "Search by name" });
    const mk = (key, opts, label) => {
      const sel = el("select", { "aria-label": label }, opts.map(([v, t]) => el("option", { value: v, text: t })));
      sel.value = f[key];
      sel.addEventListener("change", () => { f[key] = sel.value; view.offset = 0; load(); });
      return sel;
    };
    let qTimer = null;
    q.addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(() => { f.q = q.value; view.offset = 0; load(); }, 250); });
    box.append(el("div", { class: "rc-filters" }, [q,
      mk("position", [["", "Any position"], ...POSITIONS.map((p) => [p, p])], "Position"),
      mk("stars", [["", "Any stars"], ["5", "5 stars"], ["4", "4 stars"], ["3", "3 stars"], ["2", "2 stars"]], "Stars"),
      mk("state", [["", "Any state"], ...STATES.map((c) => [c, c])], "Home state"),
      mk("status", STATUS, "Status"),
    ]));
    const body = el("div");
    box.append(body);
    async function load() {
      const params = new URLSearchParams({ offset: view.offset, limit: 50 });
      for (const [k, v] of Object.entries(f)) if (v) params.set(k, v);
      body.innerHTML = "";
      body.append(el("p", { class: "muted", text: "Loading prospects…" }));
      let d;
      try { d = await H.api(`/api/season/${s.id}/prospects?${params}`); }
      catch (err) { body.innerHTML = ""; body.append(el("p", { class: "muted", text: `Could not load the class: ${H.errText(err)}` })); return; }
      body.innerHTML = "";
      body.append(el("p", { class: "muted small-text", text: `Class of 2027 · ${d.total} prospects · national rankings · hidden prospects appear once your staff scout their area` }));
      const rows = d.rows.map((r) => {
        const add = el("button", { type: "button", class: "ghost", text: r.on_board ? "On board" : "+ Board" });
        if (r.on_board) add.disabled = true;
        add.addEventListener("click", async (e) => { e.stopPropagation(); await setBoard(s, r.id, true); add.textContent = "On board"; add.disabled = true; });
        return el("tr", { class: "rc-row", onclick: () => openProfile(s, r.id) }, [
          el("td", { text: String(r.national_rank) }),
          el("td", { class: "name" }, [r.name, el("span", { class: "pos", text: `${r.position} · ${height(r.height)} ${r.weight}` })]),
          el("td", { class: "rc-stars", text: stars(r.stars) }),
          el("td", { text: `${r.hometown.city}, ${r.hometown.state}` }),
          el("td", { text: status(r) }),
          el("td", { text: r.our_potential ? `${r.our_potential[0]} to ${r.our_potential[1]}` : r.looks ? "" : "—", title: "Your staff's read of his potential" }),
          el("td", {}, [add]),
        ]);
      });
      body.append(tableWrap(el("table", { class: "stats rc-list" }, [
        el("thead", {}, [el("tr", {}, ["#", "Prospect", "Stars", "Home", "Status", "Our potential", ""].map((h) => el("th", { text: h })))]),
        el("tbody", {}, rows),
      ])));
      const prev = el("button", { type: "button", class: "ghost", text: "← Previous" });
      const next = el("button", { type: "button", class: "ghost", text: "Next →" });
      if (view.offset <= 0) prev.disabled = true;
      if (view.offset + 50 >= d.total) next.disabled = true;
      prev.addEventListener("click", () => { view.offset = Math.max(0, view.offset - 50); load(); });
      next.addEventListener("click", () => { view.offset += 50; load(); });
      body.append(el("div", { class: "rc-pager" }, [prev, el("span", { class: "muted", text: `${view.offset + 1}–${Math.min(d.total, view.offset + 50)} of ${d.total}` }), next]));
    }
    load();
  }

  // ----- the Prospect Profile ---------------------------------------------------------------------

  async function openProfile(s, pid) {
    let p;
    try { p = await H.api(`/api/season/${s.id}/prospect/${encodeURIComponent(pid)}`); }
    catch (err) { H.toast(`Could not open his profile: ${H.errText(err)}`, 4000); return; }
    const pub = p.public;
    const node = el("div", { class: "rc-profile" });
    node.append(el("div", { class: "rc-profile-head" }, [avatar(pub.avatar_seed), el("div", {}, [
      el("div", { class: "rc-stars big", text: stars(pub.stars) }),
      el("div", { text: `${pub.position} (${pub.ea_position}) · ${pub.archetype} · ${height(pub.height)}, ${pub.weight} lb` }),
      el("div", { class: "muted", text: `${pub.high_school} · ${pub.hometown.city}, ${pub.hometown.state}` }),
      el("div", { class: "muted", text: `National rankings: #${pub.national_rank} overall · #${pub.position_rank} ${pub.position} · #${pub.state_rank} in ${pub.hometown.state} · composite ${pub.composite.toFixed(4)}` }),
      el("div", { class: "rc-status", text: status({ ...pub, school_name: pub.signed || pub.committed ? ((window.CFP.teamsBySlug[pub.signed || pub.committed] || {}).name || pub.signed || pub.committed) : null }) }),
    ])]));
    const onBoard = el("button", { type: "button", class: "ghost", text: "+ Add to your board" });
    onBoard.addEventListener("click", async () => { await setBoard(s, pid, true); onBoard.textContent = "On your board"; onBoard.disabled = true; });
    node.append(el("div", { class: "rc-profile-actions" }, [onBoard]));
    if (pub.schools.length) {
      const max = Math.max(...pub.schools.map((x) => x.interest), 1);
      node.append(el("h3", { text: "His list" }), el("table", { class: "stats" }, [el("tbody", {}, pub.schools.map((x, i) => el("tr", {}, [
        el("td", { class: "name", text: `${i === 0 ? "Leader · " : ""}${x.name}${x.school === s.team ? " (you)" : ""}` }),
        el("td", {}, [bar(x.interest, max)]),
        el("td", { text: [x.offered ? "Offer" : "", x.visit ? (x.visit.done ? "Visited" : `Visit wk ${x.visit.week}`) : ""].filter(Boolean).join(" · ") }),
      ])))]));
    } else node.append(el("p", { class: "muted", text: "No school is recruiting him yet." }));
    if (pub.priorities_known.length) node.append(el("p", {}, [el("b", { text: "What he cares about: " }), pub.priorities_known.map((t) => PITCH_NAMES[t]).join(", ")]));
    if (p.evaluation) {
      node.append(el("h3", { text: "Evaluation" }),
        el("ul", { class: "rc-eval" }, [...p.evaluation.strengths.map((t) => el("li", { class: "rc-good", text: t })), ...p.evaluation.weaknesses.map((t) => el("li", { class: "rc-bad", text: t }))]),
        el("p", { text: p.evaluation.outlook }));
    }
    const comp = (c) => `${c.name}, ${c.school} (${c.position}${c.overall_ea ? `, ${c.overall_ea} OVR` : ""})`;
    if (p.public_comp) node.append(el("p", {}, [el("b", { text: "Comp: " }), comp(p.public_comp)]));
    node.append(el("h3", { text: "Our staff's grades" }));
    if (p.our_grades) {
      node.append(el("table", { class: "stats" }, [el("tbody", {}, Object.entries(p.our_grades).map(([g, r]) =>
        el("tr", {}, [el("td", { class: "name", text: GROUP_NAMES[g] || g }), el("td", { text: r[0] === r[1] ? r[0] : `${r[0]} to ${r[1]}` })])))]),
        el("p", { class: "muted small-text", text: `${p.looks} look${p.looks === 1 ? "" : "s"}. Ranges narrow with every look, but a read can be wrong; the truth shows once he is on your roster.` }));
      node.append(p.our_comp ? el("p", {}, [el("b", { text: "Our comp: " }), comp(p.our_comp)])
        : el("p", { class: "muted", text: p.looks >= 3 ? "Our comp: nobody close enough among the starters." : `Our comp after 3 looks (${p.looks} so far).` }));
    } else node.append(el("p", { class: "muted", text: "Not scouted yet: put a staff member on his area (Staff tab)." }));
    H.openModal(pub.name, node);
  }

  // ----- the Staff tab --------------------------------------------------------------------------

  async function renderStaff(s, box) {
    box.innerHTML = "";
    let v;
    try { v = await H.api(`/api/season/${s.id}/recruiting`); }
    catch (err) { box.append(el("p", { class: "muted", text: `Could not load your staff: ${H.errText(err)}` })); return; }
    box.append(el("p", { class: "muted", text: "Each week every prospect in a staff member's area gets a look. Looks add up and never reset; better evaluators read closer to the truth." }));
    const grid = el("div", { class: "rc-staff" });
    for (const m of v.staff) {
      const sel = el("select", { "aria-label": `${m.name}'s area` }, v.areas.map((a) => el("option", { value: a, text: a })));
      sel.value = m.area;
      sel.addEventListener("change", async () => {
        try { await H.api(`/api/season/${s.id}/staff`, H.postJSON({ staff_id: m.id, area: sel.value })); H.toast(`${m.name} now scouts ${sel.value}.`, 2500); }
        catch (err) { sel.value = m.area; H.toast(`Could not reassign: ${H.errText(err)}`, 4000); }
      });
      grid.append(el("div", { class: "panel rc-staff-card" }, [
        el("div", { class: "rc-staff-role", text: m.role === "Recruiter" ? "Recruiter" : m.role === "OC" ? "Offensive coordinator" : "Defensive coordinator" }),
        el("div", { class: "rc-staff-name", text: m.name }),
        el("div", { class: "muted", text: `Evaluation ${m.evaluation} · Recruiting ${m.recruiting}` }),
        el("label", {}, ["Area ", sel]),
      ]));
    }
    box.append(grid);
  }

  function render(tab, season, helpers) {
    H = helpers;
    const box = document.getElementById(`tab-${tab}`);
    if (tab === "recruiting") renderRecruiting(season, box);
    else if (tab === "prospects") renderProspects(season, box);
    else if (tab === "staff") renderStaff(season, box);
  }

  window.Recruiting = { render, openProfile: (s, pid) => openProfile(s, pid) };
})();
