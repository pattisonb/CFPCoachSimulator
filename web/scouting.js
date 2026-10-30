/* The Scouting tab (replaces Staff): your scouts with their areas and this week's yield, the queue of
   recruits worth a trip (Send spends the trip and patches the row in place), this and last week's
   reports from the look log, and your staff's flags this class.
   window.CFP.scouting.render(season, box, helpers); helpers are season.js's recruitingHelpers, the same
   H as web/recruiting.js: { api, postJSON, toast, errText, onChange(tab), ... }. Smoothness through
   window.CFP.ui: an action never rebuilds the block the player is looking at. */
(function () {
  "use strict";
  const { el } = window.CFP;
  const ui = () => window.CFP.ui;
  const R = () => window.Recruiting;                 // wordTag, reveal (the board's pane on him), openProfile
  const SCOUT_HOURS = 5, TRIPS = 3, LOOKS_PER_TRIP = 1;   // recruiting.HOURS["scout"], SCOUT_MAX, SCOUT_LOOKS
  const POSITIONS = ["QB", "RB", "WR", "TE", "OT", "IOL", "EDGE", "DL", "LB", "CB", "S", "ATH", "K", "P"];
  const GROUPS = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"];     // offseason.GROUP's roster groups
  const GRADE_NAMES = { potential: "Potential", athleticism: "Athleticism", size_strength: "Size & strength", technique: "Technique", football_iq: "Football IQ", coachability: "Coachability" };
  const FLAGS = { generational: ["Generational", "Your staff's find after three looks: a once-in-a-generation talent every program in the country wants"],
                  gem: ["Gem", "Your staff's find: his potential reads Elite even at the low end, and few programs rate him that high"],
                  bust: ["Bust risk", "Your staff's find: his ranking is high but even the top of their read is below Solid"] };
  const desk = { q: "", position: "", group: "", week: "this_week" };     // the filters and the reports' week, kept across renders
  let H = null;

  const stars = (n) => "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const loading = (text) => el("p", { class: "muted go-loading", text });
  // api(s, "board", body): one call on this season (the path after /api/season/{id}/; a body posts)
  const api = (s, path, body) => (body === undefined ? H.api(`/api/season/${s.id}/${path}`) : H.api(`/api/season/${s.id}/${path}`, H.postJSON(body)));
  const wordRange = (r) => (r[0] === r[1] ? [R().wordTag(r[0])] : [R().wordTag(r[0]), " to ", R().wordTag(r[1])]);
  const flagBadge = (f) => el("span", { class: `go-badge ${f}`, text: (FLAGS[f] || [f])[0], title: (FLAGS[f] || [])[1] || "" });
  function avatar(seed) {
    // a portrait from the coach sprite system, its look picked from the id (as the board's rows)
    let h = 0;
    for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const pick = (arr) => arr[(h = (h * 1103515245 + 12345) >>> 0) % arr.length];
    const look = { skin: pick(["#f1c9a5", "#e0b48f", "#c68e64", "#a26a42", "#7b4a2c", "#5a3520"]), hair: pick(["short", "buzz", "curly", "side part"]),
                   hair_color: pick(["#1d1410", "#3b2416", "#5a3a22", "#8a5a32", "#c49a5a"]), outfit: "hoodie" };
    const span = el("span", { class: "go-avatar", "aria-hidden": "true" });
    if (window.CoachSprite) span.innerHTML = window.CoachSprite(look, null);
    return span;
  }
  function deskPath(offset) {
    const q = new URLSearchParams();
    if (desk.q) q.set("q", desk.q);
    if (desk.position) q.set("position", desk.position);
    if (desk.group) q.set("group", desk.group);
    if (offset) q.set("offset", String(offset));
    const qs = q.toString();
    return `scouting${qs ? `?${qs}` : ""}`;
  }
  // a recruit's name anywhere on the desk opens him in the board's pane: he goes on your board (a set, so
  // one already there stays put), the board reveals him, and the tab switches. A prospect the board cannot
  // hold (hidden) opens as his profile instead.
  function nameLink(s, pid, name, cls) {
    const b = el("button", { type: "button", class: `go-link ${cls || ""}`, "data-pid": pid, text: name, title: "Open him on your board" });
    ui().on(b, "click", async () => {
      try { await ui().busy(b, api(s, "board", { pid, on: true })); }
      catch (err) { ui().toast(`Could not put him on your board: ${H.errText(err)}`, { ms: 4000, kind: "error" }); R().openProfile(s, pid); return; }
      R().reveal(pid);
      H.onChange("recruiting");
    });
    return b;
  }

  async function render(s, box, helpers) {
    H = helpers;
    if (!box.firstChild) box.append(loading("Loading the scouting desk…"));
    let v, rv;
    try { [v, rv] = await Promise.all([api(s, deskPath()), api(s, "recruiting")]); }
    catch (err) { box.innerHTML = ""; box.append(loading(`Could not load the scouting desk: ${H.errText(err)}`)); return; }
    box.innerHTML = "";
    box.append(el("div", { class: "sc-head" }, [el("div", { class: "go-display l", text: "SCOUTING" }),
      el("p", { class: "muted", text: "Every week each prospect in a scout's area gets a look; a trip from the queue buys one more. Looks narrow the read and never reset." })]));
    box.append(scoutsBlock(s, v, rv), sendBlock(s, v), reportsBlock(s, v), flagsBlock(s, v));
  }

  // ----- your scouts: a card each, the area dropdown posts to /staff; a change refetches and morphs the grid -----
  function scoutsBlock(s, v, rv) {
    const grid = el("div", { class: "sc-scouts go-staff rc-staff" });
    const draw = (d) => { const g = el("div", { class: "sc-scouts go-staff rc-staff" }, d.scouts.map((m) => scoutCard(s, m, rv, grid))); return g; };
    for (const n of draw(v).children) grid.append(n);
    grid.__redraw = async () => {
      let d;
      try { d = await api(s, deskPath()); } catch (err) { return; }
      ui().morph(grid, draw(d));
    };
    const covered = new Set(v.scouts.map((m) => m.area).filter(Boolean));
    const open = Object.keys(rv.areas || {}).filter((a) => !covered.has(a));
    return el("section", { class: "sc-block sc-block-scouts", "aria-label": "Your scouts" }, [
      el("div", { class: "go-kicker", text: "YOUR SCOUTS" }), grid,
      open.length ? el("p", { class: "muted small", text: `Not covered: ${open.map((a) => `${a} (${rv.area_counts[a]})`).join(", ")}. Prospects there show public information only.` }) : null]);
  }
  function scoutCard(s, m, rv, grid) {
    const sel = el("select", { id: `area-${m.id}`, class: "go-sel", "aria-label": `${m.name}'s scouting area` },
      Object.keys(rv.areas || {}).map((a) => el("option", { value: a, text: `${a} (${rv.area_counts[a]})` })));
    if (m.area) sel.value = m.area;
    else { sel.prepend(el("option", { value: "", text: "No area: assign one" })); sel.value = ""; }
    ui().on(sel, "change", async () => {
      const area = sel.value;
      if (!area) return;
      try { await api(s, "staff", { staff_id: m.id, area }); }
      catch (err) { sel.value = m.area || ""; ui().toast(`Could not reassign: ${H.errText(err)}`, { ms: 4000, kind: "error" }); return; }
      ui().toast(`${m.name} now scouts ${area}.`, { ms: 2500 });
      grid.__redraw();
    });
    const y = m.yield || { looks: 0, narrowed: 0, flags: 0 };
    return el("div", { class: "go-card go-coach rc-staff-card sc-scout", "data-key": m.id }, [
      el("div", { class: "go-coach-top" }, [avatar(`staff-${m.id}-${m.name}`), el("div", { class: "sc-scout-id" }, [
        el("div", { class: "go-kicker muted", text: String(m.role).toUpperCase() }),
        el("div", { class: "go-display m", text: m.name.toUpperCase() })])]),
      el("div", { class: "sc-eval small" }, [el("span", { class: "muted", text: "Evaluation " }), R().wordTag(m.evaluation_word)]),
      el("label", { class: "go-area", for: `area-${m.id}` }, [el("span", { class: "muted small", text: "Scouting area (prospects there)" }), sel]),
      el("div", { class: "sc-looking small", text: m.area ? `Looking at ${plural(m.looking_at, "prospect")}` : "No area: assign one" }),
      el("div", { class: "sc-yield small", text: `This week: ${plural(y.looks, "look")} · ${y.narrowed} narrowed · ${plural(y.flags, "flag")}` }),
    ]);
  }

  // ----- send a scout: the hours, the filters, the queue (keyed rows, patched in place) and Show more -----
  function sendBlock(s, v) {
    const st = { hours: v.hours, left: v.hours_left, total: v.queue_total, rows: v.queue.slice() };
    const hoursText = () => `${st.left} of ${plural(st.hours, "hour")} left this week`;
    const hours = el("div", { id: "sc-hours", class: "go-pill sc-hours", role: "status", text: hoursText() });
    const search = el("input", { type: "search", id: "sc-search", value: desk.q, placeholder: "Search name or state", "aria-label": "Search the queue" });
    const sel = (id, label, options, value) => {
      const node = el("select", { id, class: "go-sel", "aria-label": label }, options.map(([k, t]) => el("option", { value: k, text: t })));
      node.value = value;
      return node;
    };
    const pos = sel("sc-position", "Position", [["", "Any position"], ...POSITIONS.map((p) => [p, p])], desk.position);
    const grp = sel("sc-group", "Roster group", [["", "Any group"], ...GROUPS.map((g) => [g, `${g} group`])], desk.group);
    const queue = el("div", { class: "sc-queue", role: "list", "aria-label": "Recruits worth a look" });
    const count = el("span", { class: "muted small sc-count" });
    const more = el("button", { type: "button", class: "go-btn sc-more", text: "Show more" });
    const empty = el("p", { class: "muted sc-queue-empty", text: "Nobody matches: clear the search or a filter." });
    const foot = el("div", { class: "go-list-foot" }, [count, more]);
    const update = () => {
      count.textContent = `${st.rows.length} of ${plural(st.total, "recruit")}`;
      more.hidden = st.rows.length >= st.total;
      empty.hidden = st.rows.length > 0;
    };
    let seq = 0;
    async function refill(offset) {
      const mine = ++seq;
      let d;
      try { d = await api(s, deskPath(offset)); }
      catch (err) { ui().toast(`Could not load the queue: ${H.errText(err)}`, { ms: 4000, kind: "error" }); return; }
      if (mine !== seq) return;                       // a newer ask landed first
      st.total = d.queue_total; st.left = d.hours_left; st.hours = d.hours;
      hours.textContent = hoursText();
      st.rows = offset ? st.rows.concat(d.queue) : d.queue;
      ui().reconcile(queue, st.rows, "pid", (r) => drawRow(s, r, st, ctx), (n, r) => { n.__row = r; fill(n, r, st); });
      update();
    }
    const ctx = { hours, hoursText, queue };
    let qTimer = null;
    search.addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(() => { desk.q = search.value.trim(); refill(0); }, 150); });
    pos.addEventListener("change", () => { desk.position = pos.value; refill(0); });
    grp.addEventListener("change", () => { desk.group = grp.value; refill(0); });
    ui().on(more, "click", () => ui().busy(more, refill(st.rows.length)));
    ui().reconcile(queue, st.rows, "pid", (r) => drawRow(s, r, st, ctx));
    update();
    return el("section", { class: "sc-block sc-send", "aria-label": "Send a scout" }, [
      el("div", { class: "go-filterbar sc-sendbar" }, [el("div", { class: "sc-send-title" }, [el("div", { class: "go-kicker", text: "SEND A SCOUT" }), hours]),
        el("div", { class: "go-tools sc-tools" }, [search, pos, grp])]),
      el("p", { class: "muted small", text: `A trip costs ${SCOUT_HOURS} hours: one more look at him by your best evaluator, up to ${TRIPS} trips a prospect. Your board first, then the class by your need and his rank.` }),
      queue, empty, foot]);
  }
  function drawRow(s, r, st, ctx) {
    const node = el("div", { class: "sc-row", role: "listitem", "data-pid": r.pid });
    node.__row = r;
    const send = el("button", { type: "button", class: "go-btn sc-send-btn sc-send", text: `Send (${SCOUT_HOURS}h)` });
    ui().on(send, "click", async () => {
      const row = node.__row;
      let res;
      try { res = await ui().busy(send, api(s, "recruit", { pid: row.pid, action: "scout" })); }
      catch (err) { ui().toast(`Could not send a scout: ${H.errText(err)}`, { ms: 4000, kind: "error" }); return; }
      row.trips = (row.trips || 0) + 1;
      row.looks = (row.looks || 0) + LOOKS_PER_TRIP;
      const look = res.look || null;
      if (look && look.after && look.after.potential) row.potential = look.after.potential;
      st.left = res.hours_left;
      ctx.hours.textContent = ctx.hoursText();
      ui().pulse(ctx.hours);
      showResult(node, look);
      for (const other of ctx.queue.children) if (other.__row && !other.__leaving) fill(other, other.__row, st);   // the hours moved: every Send re-reads its reason
      ui().pulse(node);
      ui().toast(`Scouted ${row.name} · look ${row.trips} of ${TRIPS}`, { ms: 3000 });
    });
    node.append(avatar(r.pid),
      el("div", { class: "sc-id" }, [nameLink(s, r.pid, r.name, "sc-name"), el("span", { class: "muted small sc-line" })]),
      el("div", { class: "sc-looks", title: `Trips so far, of ${TRIPS}` }, [el("span", { class: "sc-trips" }, Array.from({ length: TRIPS }, () => el("i", { class: "sc-trip" }))), el("span", { class: "muted small sc-looks-text" })]),
      el("div", { class: "sc-pot" }),
      el("div", { class: "sc-act" }, [send, el("span", { class: "muted small sc-why" })]),
      el("div", { class: "sc-result", hidden: "" }));
    fill(node, r, st);
    return node;
  }
  // the row's text from its data: the line, the trips, the potential range and the Send button's state
  function fill(node, r, st) {
    node.querySelector(".sc-line").textContent = `${r.position} · ${stars(r.stars)} · ${r.state}${r.national_rank ? ` · #${r.national_rank}` : ""}${r.need > 0 ? ` · need ${r.need}` : ""}`;
    [...node.querySelectorAll(".sc-trip")].forEach((t, i) => t.classList.toggle("on", i < (r.trips || 0)));
    node.querySelector(".sc-looks-text").textContent = `${plural(r.looks || 0, "look")} · ${r.trips || 0} of ${TRIPS} trips`;
    const pot = node.querySelector(".sc-pot");
    pot.innerHTML = "";
    pot.append(el("span", { class: "muted small", text: "Potential " }), ...(r.potential ? wordRange(r.potential) : [el("span", { class: "muted small", text: "not read yet" })]));
    const send = node.querySelector(".sc-send"), why = node.querySelector(".sc-why");
    const reason = (r.trips || 0) >= TRIPS ? `Scouted ${TRIPS} of ${TRIPS}` : st.left < SCOUT_HOURS ? "Not enough hours" : r.can_send === false ? (r.why || "Not now") : null;
    send.disabled = !!reason || send.classList.contains("go-busy");
    if (send.classList.contains("go-busy")) send.__busyWant = !!reason;
    send.title = reason || `Spend ${SCOUT_HOURS} hours on one more look at ${r.name}`;
    why.textContent = reason || "";
    why.hidden = !reason;
  }
  // the inline before/after of the trip's look: each grade that moved, the flags gained, or that nothing changed
  function showResult(node, look) {
    const out = node.querySelector(".sc-result");
    out.innerHTML = "";
    const after = (look && look.after) || {}, before = (look && look.before) || {}, flags = (look && look.flags) || [];
    const groups = ["potential", ...Object.keys(GRADE_NAMES).filter((g) => g !== "potential")].filter((g) => after[g]);
    if (!groups.length && !flags.length) out.append(el("span", { class: "muted small", text: "This look changed nothing: his read holds." }));
    for (const g of groups) out.append(el("span", { class: "sc-change" }, [el("span", { class: "muted small", text: `${GRADE_NAMES[g]} ` }),
      ...(before[g] ? [...wordRange(before[g]), " → "] : ["first read: "]), ...wordRange(after[g])]));
    if (flags.length) out.append(el("span", { class: "go-tags sc-flags-gained" }, flags.map(flagBadge)));
    out.hidden = false;
    ui().fadeIn(out);
  }

  // ----- the reports: the look log by scout, this week or last -----
  function reportsBlock(s, v) {
    const list = el("div", { class: "sc-report-list" });
    const seg = el("div", { class: "go-seg sc-weeks", role: "group", "aria-label": "Which week" });
    const draw = () => {
      list.innerHTML = "";
      for (const b of seg.children) { b.classList.toggle("on", b.dataset.week === desk.week); b.setAttribute("aria-pressed", String(b.dataset.week === desk.week)); }
      const groups = v.reports[desk.week] || [];
      if (!groups.length) list.append(el("p", { class: "muted sc-reports-empty", text: desk.week === "this_week" ? "No looks yet this week: your scouts' looks land at the week step; a trip from the queue adds one now." : "No looks last week." }));
      for (const g of groups) list.append(reportGroup(s, g));
    };
    for (const [k, t] of [["this_week", "This week"], ["last_week", "Last week"]]) seg.append(el("button", { type: "button", class: "go-seg-btn", "data-week": k, text: t, onclick: () => { desk.week = k; draw(); } }));
    draw();
    return el("section", { class: "sc-block sc-reports", "aria-label": "Reports" }, [el("div", { class: "go-filterbar" }, [el("div", { class: "go-kicker", text: "REPORTS" }), seg]), list]);
  }
  const REPORT_SHOWN = 8;                            // a group opens on its most notable looks; Show all lists the rest
  function reportGroup(s, g) {
    const head = [g.area, g.scout, plural(g.looks, "look")].filter(Boolean).join(" · ");
    const items = g.items || [];
    const lis = items.map((it, i) => el("li", i >= REPORT_SHOWN ? { hidden: "" } : {}, [nameLink(s, it.pid, it.name),
      el("span", { class: "muted small", text: ` (${it.position}, ${stars(it.stars)})` }), it.change ? `: ${it.change}` : "",
      it.flags && it.flags.length ? el("span", { class: "go-tags sc-item-flags" }, it.flags.map(flagBadge)) : null]));
    const more = items.length > REPORT_SHOWN ? el("button", { type: "button", class: "go-link small sc-report-more", text: `Show all ${items.length}`, "aria-expanded": "false",
      onclick: () => { const open = more.getAttribute("aria-expanded") !== "true"; more.setAttribute("aria-expanded", String(open)); more.textContent = open ? "Show fewer" : `Show all ${items.length}`;
        lis.forEach((li, i) => { if (i >= REPORT_SHOWN) li.hidden = !open; }); } }) : null;
    return el("div", { class: "go-card sc-report", "data-key": g.scout_id }, [
      el("div", { class: "sc-report-head" }, [el("b", { text: head }), el("span", { class: "muted small", text: items.length ? `${g.changed} changed a read` : "nothing new" })]),
      items.length ? el("ul", { class: "sc-report-items" }, lis) : null, more]);
  }

  // ----- the flags: gems, bust risks and generational prospects your staff found this class -----
  function flagsBlock(s, v) {
    const rows = v.flags || [];
    return el("section", { class: "sc-block sc-flags", "aria-label": "Flags" }, [el("div", { class: "go-kicker", text: "FLAGS" }),
      rows.length ? el("ul", { class: "sc-flag-list" }, rows.map((f) => el("li", { class: "go-list-row sc-flag", "data-pid": f.pid }, [flagBadge(f.flag),
        el("span", { class: "sc-flag-id" }, [nameLink(s, f.pid, f.name), el("span", { class: "muted small", text: `${f.position} · ${stars(f.stars)} · ${plural(f.looks, "look")}` })]),
        el("span", { class: "muted small sc-standing", text: f.standing_word })])))
        : el("p", { class: "muted sc-flags-empty", text: "No finds yet: as the looks add up your scouts flag gems, bust risks and generational prospects here." })]);
  }

  window.CFP.scouting = { render };
})();
