/* The Scouting tab (replaces Staff): the Scouting Center, master and detail.
   - The header: "Recruiting Intelligence / Class of 2027", SCOUTING CENTER, a subtitle and All Reports; beside it four
     stat cards: My Board, Full Reports, Scouting Queue (your trips this week) and Scouting Points (the points left for trips, a bar, "Points Left: 35 of 50",
     and the week's recruiting hours as a second line).
   - Left, the Prospect Database: the whole class you can see (the API's queue; a full report stays listed), 20 to a page, with a search, the chips
     All Prospects · My Board · Scouted, a position filter and a sort; a row is the board star, the avatar, the name,
     "POS · ST · stars", any flag, the rank, the potential read ("Unscouted" before a look) and the Scouting
     Confidence meter (three segments filled in halves, "1.5/3"). A row selects him; the list scrolls in its card.
   - Right, the Player Intelligence Report on the selected prospect: portrait, name, position, hometown, national
     rank, stars and a status pill; Potential, Team Need and Report boxes; the sub-tabs Ratings (your staff's grade
     words as bars, never numbers the scouting does not reveal), Overview (the profile's summary) and Scouting (his
     looks, flags, a coordinator's word, this and last week's reads); Send Scout (its cost in scouting points: 5 close to home or in the portal, 10 in a scout's area, 15 elsewhere; half that when half a look finishes his report) and Add to / Remove from Board,
     both patched in place with a toast; View Full Profile opens the profile modal.
   - Bottom, Scouting Operations: a bar that opens the staff rows (area dropdown, contract, narrowed bar, coverage).
   - All Reports (a modal, token "reports" or "reports:last_week|flags"): This Week · Last Week · Flags by scout.
   A prospect's name never puts him on your board or leaves the tab. The address (web/route.js) keeps the chip
   (qboard), the selected prospect (spid), the sub-tab (ssub) and an open Operations bar (sops).
   window.CFP.scouting.render(season, box, helpers); helpers are season.js's recruitingHelpers. Smoothness through
   window.CFP.ui: an action never rebuilds the block the player is looking at. */
(function () {
  "use strict";
  const { el } = window.CFP;
  const ui = () => window.CFP.ui;
  const R = () => window.Recruiting;                 // wordTag, openProfile
  const NO_POINTS = "Not enough scouting points left this week.";
  const REPORT_LOOKS = 3, SEND_LOOK = 1, AREA_LOOK = 0.5;   // REPORT_LOOKS, SEND_LOOK, AREA_LOOK
  // looks come in trip units: a Send is one, a week in a scout's area half, a full report three; a count shows its half only when it has one
  const fmtLooks = (n) => (Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(1));
  const looksText = (n) => `${fmtLooks(n)} look${Number(n) === 1 ? "" : "s"}`;
  const leftOf = (looks) => Math.max(0, REPORT_LOOKS - (looks || 0));
  const PAGE = 20;
  const RECRUITERS = 3;                              // recruiters on a full staff (recruiting.make_staff): fewer shows an open spot                                   // rows a page
  const POSITIONS = ["QB", "RB", "WR", "TE", "OT", "IOL", "EDGE", "DL", "LB", "CB", "S", "ATH", "K", "P"];
  const WORDS = ["Weak", "Fair", "Solid", "Strong", "Elite", "All-American"];         // recruiting.WORDS, low to high
  const GRADE_NAMES = { potential: "Potential", athleticism: "Athleticism", size_strength: "Size & Strength", technique: "Technique", football_iq: "Football IQ", coachability: "Coachability" };
  const FLAGS = { generational: ["Generational", "Your staff's find after three looks: a once-in-a-generation talent every program in the country wants"],
                  gem: ["Gem", "Your staff's find: even the low end of his potential read beats all but a few prospects at his star level, and few programs rate him that high"],
                  bust: ["Bust Risk", "Your staff's find: his ranking is high but even the top of their read sits under nearly every prospect at his star level"] };
  const ROLE_SHORT = { "Offensive Coordinator": "OC", "Defensive Coordinator": "DC", Recruiter: "Recruiter" };
  // the list's orders, applied by the API over the whole class (prospects.QUEUE_SORTS), never just to the page on screen
  const SORTS = [["rank", "Sort: Rank"], ["board", "Sort: Board First"], ["need", "Sort: Need"], ["potential", "Sort: Potential"], ["looks", "Sort: Looks"]];
  const CHIPS = [["all", "All Prospects"], ["on", "My Board"], ["scouted", "Scouted"]];
  const SUBS = [["report", "Report"], ["looks", "Looks"], ["profile", "Profile"]];
  const OLD_SUBS = { ratings: "report", overview: "report", scouting: "looks" };      // the sub-tabs before the redesign, in old addresses
  const WEEKS = [["this_week", "This Week"], ["last_week", "Last Week"], ["flags", "Flags"]];
  // the filters, the page, the sort, the selection and its sub-tab, kept across renders (and in the address)
  const desk = { q: "", position: "", board: "all", page: 0, sort: "rank", pid: null, sub: "report", ops: false };
  let H = null;
  let cur = null;                                    // the tab as drawn: { s, v (the latest view), rv (/recruiting), st, ... }
  let wanted = null;                                 // a modal to open once the tab draws: the pane's "Reports on the Scouting Tab"

  const stars = (n) => "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const num = (n) => Number(n).toLocaleString("en-US");
  const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
  const loading = (text) => el("p", { class: "muted go-loading", text });
  const api = (s, path, body) => (body === undefined ? H.api(`/api/season/${s.id}/${path}`) : H.api(`/api/season/${s.id}/${path}`, H.postJSON(body)));
  const wordRange = (r) => (r[0] === r[1] ? [R().wordTag(r[0])] : [R().wordTag(r[0]), " to ", R().wordTag(r[1])]);
  const rangeText = (r) => (r[0] === r[1] ? r[0] : `${r[0]} to ${r[1]}`);
  // a read as plain words in their tone color on one line ("Elite–All-American"), as the pane's grade cards
  const gradeWord = (w) => el("b", { class: `go-grade ${String(w).toLowerCase()}`, text: w });
  const gradePlain = (r) => (r[0] === r[1] ? [gradeWord(r[0])] : [gradeWord(r[0]), el("span", { class: "go-grade-dash", text: "–" }), gradeWord(r[1])]);
  const flagBadge = (f) => el("span", { class: `go-badge ${f}`, text: (FLAGS[f] || [f])[0], title: (FLAGS[f] || [])[1] || "" });
  const likesTag = (l) => el("span", { class: "go-tag good go-likes", text: `${l.who} Likes Him`, title: l.text });
  const feet = (h) => (h ? `${Math.floor(h / 12)}'${h % 12}"` : "");
  function avatar(seed, cls) {
    // a portrait from the coach sprite system, its look picked from the id (as the board's rows)
    let h = 0;
    for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const pick = (arr) => arr[(h = (h * 1103515245 + 12345) >>> 0) % arr.length];
    const look = { skin: pick(["#f1c9a5", "#e0b48f", "#c68e64", "#a26a42", "#7b4a2c", "#5a3520"]), hair: pick(["short", "buzz", "curly", "side part"]),
                   hair_color: pick(["#1d1410", "#3b2416", "#5a3a22", "#8a5a32", "#c49a5a"]), outfit: "hoodie" };
    const span = el("span", { class: `go-avatar ${cls || "sm"}`, "aria-hidden": "true" });
    if (window.CoachSprite) span.innerHTML = window.CoachSprite(look, null);
    return span;
  }
  // the Scouting Confidence meter: three segments filled in halves
  const meterSegs = (looks) => Array.from({ length: REPORT_LOOKS }, (_, i) => el("i", { class: `sc-trip${looks >= i + 1 ? " on" : looks > i ? " half" : ""}` }));
  function deskPath(offset, limit, extra) {
    const q = new URLSearchParams();
    if (desk.q) q.set("q", desk.q);
    if (desk.position) q.set("position", desk.position);
    if (desk.board === "scouted") q.set("scouted", "1");
    if (desk.board === "on") q.set("on_board", "1");
    if (desk.sort && desk.sort !== "rank") q.set("sort", desk.sort);
    if (offset) q.set("offset", String(offset));
    if (limit) q.set("limit", String(limit));
    for (const [k, v] of Object.entries(extra || {})) q.set(k, v);
    const qs = q.toString();
    return `scouting${qs ? `?${qs}` : ""}`;
  }
  // a name in All Reports opens his Prospect Profile over the tab: no board change, no tab switch
  function openHim(s, pid) { R().openProfile(s, pid); }
  function nameLink(s, pid, name, cls) {
    const b = el("button", { type: "button", class: `go-link ${cls || ""}`, "data-pid": pid, text: name, title: "Open his profile" });
    ui().on(b, "click", () => openHim(s, pid));
    return b;
  }
  // a list longer than n folds past n with "Show All n" (a toggle)
  function foldable(lis, n = 8) {
    lis.forEach((li, i) => { if (i >= n) li.hidden = true; });
    if (lis.length <= n) return null;
    const more = el("button", { type: "button", class: "go-link small sc-report-more", text: `Show All ${lis.length}`, "aria-expanded": "false" });
    more.addEventListener("click", () => {
      const open = more.getAttribute("aria-expanded") !== "true";
      more.setAttribute("aria-expanded", String(open));
      more.textContent = open ? "Show Fewer" : `Show All ${lis.length}`;
      lis.forEach((li, i) => { if (i >= n) li.hidden = !open; });
    });
    return more;
  }

  // the tab's place in the address: the chip, the selected prospect, the sub-tab, an open Operations bar (a replace)
  const syncRoute = () => {
    if (window.CFP.route) window.CFP.route.set({ qboard: desk.board !== "all" ? desk.board : null, spid: desk.pid || null,
      ssub: desk.sub !== "report" ? desk.sub : null, sops: desk.ops ? "1" : null, ssort: desk.sort !== "rank" ? desk.sort : null });
  };
  function applyRoute(r) {
    desk.board = ["on", "scouted"].includes(r.qboard) ? r.qboard : "all";
    desk.pid = typeof r.spid === "string" && r.spid ? r.spid : null;
    const sub = OLD_SUBS[r.ssub] || r.ssub;
    desk.sub = SUBS.some(([k]) => k === sub) ? sub : "report";
    desk.ops = r.sops === "1";
    desk.sort = SORTS.some(([k]) => k === r.ssort) ? r.ssort : "rank";
  }

  async function render(s, box, helpers) {
    H = helpers;
    desk.page = 0;
    if (!box.firstChild) box.append(loading("Loading the Scouting Center…"));
    let v, rv;
    try { [v, rv] = await Promise.all([api(s, deskPath(0, PAGE)), api(s, "recruiting")]); }
    catch (err) { box.innerHTML = ""; box.append(loading(`Could not load the Scouting Center: ${H.errText(err)}`)); return; }
    cur = { s, v, rv, board: v.board_size != null ? v.board_size : (rv.board || []).length };
    const st = { hours: v.hours, left: v.hours_left, points: v.points_left, pointsWeek: v.points_week, total: v.queue_total, rows: [] };
    cur.st = st;
    box.innerHTML = "";
    const head = headBlock(s, v, st);
    const intel = intelPanel(s);
    const db = databasePanel(s, v, st, intel);
    box.append(head, el("div", { class: "sc-main" }, [db, intel]), opsBar(s, v, rv));
    if (wanted) { wanted = null; openReports(s, "this_week"); }
  }

  // ----- the header: "Class of 2027", SCOUTING CENTER, four meters (a value and a thin bar each), All Reports -----
  // Scouting Points (left of the week's), Trips This Week, Board Scouted (prospects on your board with a look, of the
  // board) and Full Reports (complete reports in the class)
  function headBlock(s, v, st) {
    const meterOf = (key, label, extra, value, more) => {
      const fill = el("i");
      const node = el("div", { class: "sc-stat", "data-stat": key, ...(extra || {}) }, [el("div", { class: "sc-stat-value" }, value), el("div", { class: "sc-stat-label", text: label }),
        el("div", { class: "pv-thin", "aria-hidden": "true" }, [fill]), ...(more || [])]);
      node.__fill = fill;
      return node;
    };
    const pointsBig = el("span", { class: "sc-points-val" }), pointsOf = el("span", { class: "sc-points-of" });
    const pointsVal = el("span", { id: "sc-points", class: "pv-sr sc-points" }), hoursVal = el("span", { class: "pv-sr sc-hours-line" });
    const boardVal = el("span", { class: "sc-board-n" }), fullVal = el("span", { class: "sc-full-n" }), tripsVal = el("span", { class: "sc-trips-n" });
    const pointsCard = meterOf("points", "Scouting Points", { id: "sc-points-card", role: "status" }, [pointsBig, pointsOf], [pointsVal, hoursVal]);
    const trips = meterOf("trips", "Trips This Week", null, [tripsVal]);
    const board = meterOf("board", "Board Scouted", null, [boardVal]);
    const full = meterOf("full", "Full Reports", null, [fullVal]);
    const cards = el("div", { class: "sc-stats" }, [pointsCard, trips, board, full]);
    const newCount = el("span", { class: "go-tag good sc-new-n", hidden: "" });
    const all = el("button", { type: "button", id: "sc-all-reports", class: "go-btn sc-all-reports" }, ["All Reports", newCount]);
    ui().on(all, "click", () => openReports(s, "this_week"));
    // patchHead(v): the numbers from the latest view
    const set = (node, text) => { if (node.textContent !== text) node.textContent = text; };
    const fillTo = (node, x) => { node.__fill.style.width = `${Math.round(100 * Math.max(0, Math.min(1, x || 0)))}%`; };
    cur.patchHead = (d) => {
      const size = cur.board, scouted = Math.min(size, d.board_scouted != null ? d.board_scouted : 0);
      set(boardVal, `${scouted} of ${size}`);
      fillTo(board, size ? scouted / size : 0);
      board.title = `${scouted} of the ${plural(size, "prospect")} on your board have had a look`;
      set(fullVal, String(d.full_reports || 0));
      fillTo(full, size ? (d.full_reports || 0) / Math.max(size, d.full_reports || 0) : 0);
      const t = d.trips_this_week || 0, more = st.points ? Math.floor(st.points / 10) : 0;
      set(tripsVal, String(t));
      fillTo(trips, t + more ? t / (t + more) : 0);
      trips.title = `${plural(t, "trip")} this week; about ${plural(more, "more")} at 10 points`;
      set(pointsBig, String(st.points));
      set(pointsOf, ` / ${st.pointsWeek}`);
      fillTo(pointsCard, st.pointsWeek ? st.points / st.pointsWeek : 0);
      set(pointsVal, `Points Left: ${st.points} of ${st.pointsWeek}`);
      set(hoursVal, ` Recruiting Hours: ${st.left} of ${st.hours}`);
      pointsCard.title = `${st.points} of ${plural(st.pointsWeek, "scouting point")} left for trips this week; ${st.left} of ${plural(st.hours, "recruiting hour")} left for calls and visits`;
      pointsCard.setAttribute("aria-label", pointsCard.title);
      const n = finds(d).length;
      newCount.hidden = !n;
      newCount.textContent = n ? `${n} New` : "";
      all.title = n ? `${plural(n, "find")} this week: flags and Likes Him reads` : "This week's and last week's reports, and your flags";
    };
    cur.patchHead(v);
    return el("div", { class: "sc-head" }, [
      el("div", { class: "sc-head-text" }, [el("div", { class: "pv-kick sc-kicker", text: `Class of ${(s.year || 2026) + 1}` }),
        el("h2", { class: "go-display l sc-title" }, ["Scouting Center ",
          ui().tip("Evaluate talent: a full report is three looks; a trip is one, a week in a scout's area half.", "Scouting Center")])]),
      cards, el("div", { class: "sc-head-actions" }, [all])]);
  }
  // this week's finds from the reports: a flag gained or a coordinator's word, one a recruit
  function finds(v) {
    const seen = new Map();
    for (const g of (v.reports && v.reports.this_week) || []) for (const it of g.items || []) if ((it.flags && it.flags.length) || it.likes) seen.set(it.pid, it);
    return [...seen.values()];
  }

  // ----- the Prospect Database: search, chips, position, sort, the rows (keyed, patched in place), the pager -----
  function databasePanel(s, v, st, intel) {
    const count = el("span", { class: "go-pill sc-count", role: "status" });
    const chips = el("div", { class: "sc-chips", role: "group", "aria-label": "Which prospects" }, CHIPS.map(([k, t]) =>
      el("button", { type: "button", class: `go-chip small${desk.board === k ? " on" : ""}`, "data-board": k, "aria-pressed": String(desk.board === k), text: t,
        onclick: () => { if (desk.board === k) return; desk.board = k; desk.page = 0; syncRoute(); for (const c of chips.children) { c.classList.toggle("on", c.dataset.board === k); c.setAttribute("aria-pressed", String(c.dataset.board === k)); } load(); } })));
    const search = el("input", { type: "search", id: "sc-search", value: desk.q, placeholder: "Search prospects by name or state", "aria-label": "Search prospects" });
    const sel = (id, label, options, value) => {
      const node = el("select", { id, class: "go-sel", "aria-label": label }, options.map(([k, t]) => el("option", { value: k, text: t })));
      node.value = value;
      return node;
    };
    const pos = sel("sc-position", "Position", [["", "Any Position"], ...POSITIONS.map((p) => [p, p])], desk.position);
    const sort = sel("sc-sort", "Sort", SORTS, desk.sort);
    const list = el("ul", { class: "sc-list", "aria-label": "Prospects" });
    const wrap = el("div", { class: "sc-list-wrap" }, [list]);
    const empty = el("p", { class: "muted sc-queue-empty", text: "Nobody matches: clear the search or a filter.", hidden: "" });
    const showing = el("span", { class: "muted small sc-showing", role: "status" });
    const pager = el("nav", { class: "sc-pager", "aria-label": "Pages" });
    function paint() {
      ui().reconcile(list, st.rows, (r) => r.pid, (r) => drawRow(r), (n, r) => { n.__row = r; fill(n, r); });
      const from = st.rows.length ? desk.page * PAGE + 1 : 0, to = desk.page * PAGE + st.rows.length;
      showing.textContent = st.rows.length ? `${num(from)}–${num(to)} of ${num(st.total)}` : `0 of ${num(st.total)}`;
      count.textContent = `${num(st.total)} ${st.total === 1 ? "Prospect" : "Prospects"}`;
      empty.hidden = st.rows.length > 0;
      drawPager();
    }
    function drawPager() {
      const pages = Math.max(1, Math.ceil(st.total / PAGE)), at = desk.page + 1;
      const want = [...new Set([1, pages, at - 1, at, at + 1])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
      const btn = (cls, text, attrs, to, off) => {
        const b = el("button", { type: "button", class: `go-btn ${cls}`, text, ...attrs });
        b.disabled = !!off;
        return ui().on(b, "click", () => go(to));
      };
      const nodes = [btn("sc-prev", "‹", { "aria-label": "Previous page", title: "Previous" }, desk.page - 1, at <= 1)];
      let last = 0;
      for (const p of want) {
        if (p - last > 1) nodes.push(el("span", { class: "muted sc-gap", "aria-hidden": "true", text: "…" }));
        nodes.push(btn(`sc-page${p === at ? " primary" : ""}`, String(p), { "data-page": String(p), ...(p === at ? { "aria-current": "page" } : {}) }, p - 1, false));
        last = p;
      }
      nodes.push(btn("sc-next", "›", { "aria-label": "Next page", title: "Next" }, desk.page + 1, at >= pages));
      ui().morph(pager, el("nav", { class: "sc-pager", "aria-label": "Pages" }, nodes));
    }
    function go(page) {
      desk.page = Math.max(0, Math.min(Math.max(1, Math.ceil(st.total / PAGE)) - 1, page));
      load();
      wrap.scrollTop = 0;
    }
    let seq = 0;
    // load(keep): the page the filters, the chip, the sort and desk.page name; the API filters and sorts the whole class
    // and returns that page. keep: a pid whose row stays even if a filter would now drop him (his third trip under a chip).
    // Every load patches the header's numbers.
    async function load(keep) {
      const mine = ++seq;
      wrap.setAttribute("aria-busy", "true");
      let d;
      try { d = await api(s, deskPath(desk.page * PAGE, PAGE)); }
      catch (err) { if (mine === seq) wrap.removeAttribute("aria-busy"); ui().toast(`Could not load the prospects: ${H.errText(err)}`, { ms: 4000, kind: "error" }); return; }
      if (mine !== seq) return;                       // a newer ask landed first
      wrap.removeAttribute("aria-busy");
      if (keep && !d.queue.some((r) => r.pid === keep)) {
        const i = st.rows.findIndex((r) => r.pid === keep);
        if (i >= 0) d.queue.splice(Math.min(i, d.queue.length), 0, st.rows[i]);
      }
      st.total = d.queue_total; st.left = d.hours_left; st.hours = d.hours; st.points = d.points_left; st.pointsWeek = d.points_week;
      st.rows = d.queue;
      Object.assign(cur.v, { scouts: d.scouts, reports: d.reports, flags: d.flags, full_reports: d.full_reports, trips_this_week: d.trips_this_week, board_scouted: d.board_scouted });
      if (d.board_size != null) cur.board = d.board_size;
      paint();
      cur.patchHead(cur.v);
      const row = st.rows.find((r) => r.pid === desk.pid);
      if (row) intel.__row(row);
      if (!desk.pid && st.rows[0]) select(st.rows[0].pid);
    }
    function select(pid) {
      desk.pid = pid;
      syncRoute();
      for (const li of list.children) { const on = li.dataset.pid === pid; li.classList.toggle("selected", on); const b = li.querySelector(".sc-row-btn"); if (b) b.setAttribute("aria-pressed", String(on)); }
      const picked = list.querySelector(".sc-row.selected");
      if (picked && !window.matchMedia("(max-width: 899px)").matches) ui().keepInView(picked);   // an address's prospect shows in the list's own scroll
      intel.__show(pid, st.rows.find((r) => r.pid === pid) || null);
    }
    function drawRow(r) {
      const btn = el("button", { type: "button", class: "sc-row-btn", "aria-pressed": "false" }, [
        el("span", { class: "sc-star", "aria-hidden": "true" }),
        avatar(r.pid, "sm"),
        el("span", { class: "sc-id" }, [el("span", { class: "sc-name" }), el("span", { class: "sc-line-row" }, [el("span", { class: "go-stars sc-row-stars" }), el("span", { class: "muted small sc-line" }), el("span", { class: "sc-row-flags" })])]),
        el("span", { class: "sc-right" }, [el("span", { class: "sc-eval" }),
          el("span", { class: "sc-conf" }, [el("span", { class: "sc-trips", role: "img" }, meterSegs(0)), el("span", { class: "muted small sc-looks-text" })])])]);
      const li = el("li", { class: "sc-row", "data-pid": r.pid, "data-key": r.pid }, [btn]);
      ui().on(btn, "click", () => { if (desk.pid !== li.dataset.pid) select(li.dataset.pid); intel.__focus(); });
      li.__row = r;
      fill(li, r);
      return li;
    }
    cur.reload = (keep) => load(keep);
    cur.select = select;
    cur.fillRow = (pid) => { const li = list.querySelector(`.sc-row[data-pid='${pid}']`); if (li) { fill(li, li.__row); return li; } return null; };
    let qTimer = null;
    search.addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(() => { desk.q = search.value.trim(); desk.page = 0; load(); }, 150); });
    pos.addEventListener("change", () => { desk.position = pos.value; desk.page = 0; load(); });
    sort.addEventListener("change", () => { desk.sort = sort.value; desk.page = 0; syncRoute(); load(); });
    // the first page: the view render fetched (the whole board when My Board is on)
    if (desk.board === "on") { const mineRows = v.queue.filter((r) => r.on_board); st.rows = mineRows.slice(0, PAGE); st.total = mineRows.length; }
    else { st.rows = v.queue.slice(); st.total = v.queue_total; }
    paint();
    // the selection: the address's prospect, else the first row
    queueMicrotask(() => select(desk.pid || (st.rows[0] && st.rows[0].pid) || null));
    return el("section", { class: "go-card sc-panel sc-db", "aria-label": "Prospect Database" }, [
      el("div", { class: "sc-panel-head" }, [el("div", {}, [el("h2", { class: "sc-h" }, ["Prospect Database ", ui().tip("Every prospect in the class: filter and sort the whole list.", "Prospect Database")])]), count]),
      search,
      el("div", { class: "sc-toolbar" }, [chips, el("div", { class: "sc-tools" }, [pos, sort])]),
      wrap, empty,
      el("div", { class: "sc-foot" }, [showing, pager])]);
  }
  // a row's cells from its data: the star, the line, the flags, the rank, the read and the meter
  function fill(li, r) {
    const on = !!r.on_board;
    li.classList.toggle("on-board", on);
    li.classList.toggle("selected", r.pid === desk.pid);
    const btn = li.querySelector(".sc-row-btn");
    btn.setAttribute("aria-pressed", String(r.pid === desk.pid));
    const looks = Math.min(REPORT_LOOKS, r.looks || 0);
    btn.setAttribute("aria-label", `${r.name}, ${r.position}, ${r.state}, ${r.stars} stars, rank ${r.national_rank || "unranked"}${on ? ", on your board" : ""}: ${r.potential ? `potential ${rangeText(r.potential)}` : "unscouted"}, ${fmtLooks(looks)} of ${REPORT_LOOKS} looks`);
    const star = li.querySelector(".sc-star");
    const want = on ? "★" : "☆";
    if (star.textContent !== want) { const had = star.textContent; star.textContent = want; star.classList.toggle("on", on); star.title = on ? "On your board" : "Not on your board"; }
    li.querySelector(".sc-name").textContent = r.name;
    li.querySelector(".sc-row-stars").textContent = r.stars ? stars(r.stars) : "";
    li.querySelector(".sc-line").textContent = ` ${r.display_pos || r.position} · ${r.state}`;
    li.dataset.rank = r.national_rank ? String(r.national_rank) : "";
    // the right-hand tag: a flag (Generational, Gem, Bust Risk) when your staff has one, else the potential read
    const flagged = (r.flags || []).filter((f) => FLAGS[f]);
    const flags = li.querySelector(".sc-row-flags"), fkey = [...flagged.slice(1), r.likes ? `likes:${r.likes.who}` : ""].join("|");
    if (flags.dataset.v !== fkey) {
      flags.dataset.v = fkey;
      flags.innerHTML = "";
      flags.append(...flagged.slice(1).map(flagBadge), ...(r.likes ? [el("span", { class: "go-tag good sc-likes", text: `${r.likes.who} ♥`, title: r.likes.text })] : []));
    }
    const ev = li.querySelector(".sc-eval"), key = flagged.length ? `flag:${flagged[0]}` : r.potential ? r.potential.join("|") : "-";
    if (ev.dataset.v !== key) {
      ev.dataset.v = key;
      ev.innerHTML = "";
      ev.className = `sc-eval${flagged.length ? " flag" : r.potential ? ` sc-tag ${String(r.potential[1]).toLowerCase()}` : " sc-tag muted"}`;
      ev.append(...(flagged.length ? [flagBadge(flagged[0])] : r.potential ? gradePlain(r.potential) : [el("span", { text: "Unscouted" })]));
    }
    [...li.querySelectorAll(".sc-trip")].forEach((t, i) => { t.classList.toggle("on", looks >= i + 1); t.classList.toggle("half", looks < i + 1 && looks > i); });
    li.querySelector(".sc-trips").setAttribute("aria-label", `Scouting confidence: ${looksText(looks)} of ${REPORT_LOOKS}`);
    li.querySelector(".sc-looks-text").textContent = `${fmtLooks(looks)}/${REPORT_LOOKS}`;
  }

  // ----- the Player Intelligence Report: the selected prospect, patched in place -----
  function intelPanel(s) {
    const body = el("div", { class: "sc-intel-body" }, [loading("Loading his report…")]);
    const panel = el("section", { class: "go-card sc-panel sc-intel", "aria-label": "Player Intelligence Report" }, [body]);
    const sel = { pid: null, row: null, pr: null, look: null, seq: 0 };
    // the row's data for him: from the list, else one ask by his name (a selection restored from the address on another page)
    async function rowFor(pid, pr) {
      const fromList = cur.st.rows.find((r) => r.pid === pid);
      if (fromList) return fromList;
      try {
        const d = await api(s, `scouting?${new URLSearchParams({ q: pr.public.name, limit: "50" })}`);
        const r = d.queue.find((x) => x.pid === pid);
        if (r) return r;
      } catch (err) { /* below: what the profile says */ }
      const p = pr.public;
      return { pid, name: p.name, position: p.position, stars: p.stars, state: p.hometown.state, national_rank: p.national_rank, looks: pr.looks || 0,
               potential: pr.our_grades && pr.our_grades.potential, need: null, on_board: !!p.on_board, likes: pr.likes || null, flags: [], can_send: !!pr.can_scout,
               why: pr.looks >= REPORT_LOOKS ? `His report is complete: ${REPORT_LOOKS} of ${REPORT_LOOKS} looks` : null };
    }
    panel.__show = async (pid, row) => {
      if (!pid) { ui().morph(body, el("div", {}, [el("p", { class: "muted sc-intel-empty", text: "Nobody here yet: clear the search or a filter." })])); return; }
      const mine = ++sel.seq;
      const other = sel.pid !== pid;
      if (other) sel.look = null;
      sel.pid = pid;
      panel.setAttribute("aria-busy", "true");
      let pr;
      try { pr = await api(s, `prospect/${encodeURIComponent(pid)}`); }
      catch (err) { pr = null; }
      if (mine !== sel.seq) return;
      panel.removeAttribute("aria-busy");
      if (!pr || !pr.public) {                       // gone (an old address): the first row instead, quietly
        const first = cur.st.rows[0];
        if (first && first.pid !== pid) { cur.select(first.pid); return; }
        ui().morph(body, el("div", {}, [el("p", { class: "muted sc-intel-empty", text: "This prospect is no longer in the class." })]));
        return;
      }
      sel.pr = pr;
      sel.row = row || (await rowFor(pid, pr));
      if (mine !== sel.seq) return;
      paintIntel();
      if (other) panel.scrollTop = 0;   // a wide screen: the report scrolls in its column, and another prospect opens at his top
    };
    panel.__row = (row) => { if (sel.pid === row.pid) { sel.row = row; if (sel.pr) paintIntel(); } };
    panel.__focus = () => { if (window.matchMedia("(max-width: 899px)").matches) panel.scrollIntoView({ block: "start" }); };
    // the selected prospect, drawn with the board's pieces (window.Recruiting.parts, web/profileview.js): the hero with
    // Nat. Rank, Pos. Rank, Team Need and his Potential (with how sure the read is), the tabs Report · Looks · Profile and,
    // on the tab row, Send Scout, View Full Profile and the board star
    const CERTAINTY = { Low: "Confident", Medium: "Could Change", High: "Early Look" };
    const POT_TONE = { "All-American": "good", Elite: "good", Strong: "good", Solid: "warn", Fair: "warn", Weak: "bad" };
    function paintIntel() {
      const { row: r, pr } = sel, p = pr.public;
      const P = R().parts, me = s.team;
      const b = pr.row || { id: r.pid, name: p.name, stars: p.stars, position: p.position, display_pos: p.display_pos, hometown: p.hometown, national_rank: p.national_rank,
        pos_rank: p.pos_rank, height_display: p.height_display, weight_display: p.weight_display, looks: pr.looks, traits: pr.traits, priorities_known: p.priorities_known, list: [] };
      const looks = Math.min(REPORT_LOOKS, r.looks || 0), complete = looks >= REPORT_LOOKS;
      const sp = complete ? ["Fully Scouted", "good"] : looks > 0 ? [`${fmtLooks(looks)} of ${REPORT_LOOKS} Looks`, "warn"] : ["Unscouted", "muted"];
      const potential = r.potential || (pr.our_grades && pr.our_grades.potential);
      const rep = pr.report;
      const need = r.need != null ? r.need : pr.need;
      const needWord = need == null ? "Not Listed" : need >= 3 ? "High" : need >= 1 ? "Medium" : "Set";
      const name = el("h2", { class: "sc-big-name pv-name", "data-key": "name", text: p.name });
      const status = el("span", { class: `go-chip pv-tag sc-status ${sp[1]}`, "data-key": "chip", text: sp[0], title: r.on_board ? "On your board" : "Not on your board" });
      const hero = P.heroOf(b, me, { nameNode: name, chip: { text: sp[0], tone: sp[1] },
        stats: [{ key: "nat", label: "Nat. Rank", value: p.national_rank ? `#${p.national_rank}` : "—" }, { key: "pos", label: "Pos. Rank", value: p.pos_rank ? `#${p.pos_rank}` : "—", sub: p.display_pos },
          { key: "need", label: "Team Need", value: needWord, tone: needWord === "High" ? "good" : needWord === "Medium" ? "warn" : "" }],
        badge: { kicker: "Potential", value: potential ? (potential[0] === potential[1] ? potential[0] : `${potential[0]} – ${potential[1]}`) : "Not Read",
          sub: rep && rep.certainty ? CERTAINTY[rep.certainty] : potential ? null : "Send a Scout", tone: rep && rep.potential_tone ? rep.potential_tone : potential ? POT_TONE[potential[0]] || "" : "" } });
      const chip = hero.querySelector(".pv-tag");
      if (chip) chip.replaceWith(status);
      const sub = el("div", { class: "go-subtabs sc-subtabs", role: "tablist", "aria-label": "Report", "data-key": "subtabs" }, SUBS.map(([k, t]) => {
        const btn = el("button", { type: "button", role: "tab", "data-sub": k, "aria-selected": String(desk.sub === k), text: t });
        ui().on(btn, "click", () => { if (desk.sub === k) return; desk.sub = k; syncRoute(); paintIntel(); });
        return btn;
      }));
      // the actions: Send Scout (its cost), View Full Profile, the board star; the reason under them when Send cannot act
      const left = leftOf(looks);
      const reason = complete ? `His report is complete: ${REPORT_LOOKS} of ${REPORT_LOOKS} looks` : cur.st.points < r.cost ? NO_POINTS : r.can_send === false ? (r.why || "Not now") : null;
      const send = el("button", { type: "button", id: "sc-send", class: "go-btn primary sc-send", text: `Send Scout · ${r.cost} Pts${!complete && left <= SEND_LOOK ? " · Finishes His Report" : ""}`,
        title: reason || `Spend ${r.cost} scouting points on one more look at ${r.name}`, ...(reason ? { disabled: "" } : {}) });
      ui().on(send, "click", () => sendScout(send));
      const on = !!r.on_board;
      const boardBtn = el("button", { type: "button", id: "sc-board", class: "go-btn sc-board-btn", "aria-pressed": String(on), text: on ? "★ Remove From Board" : "☆ Add to Board" });
      ui().on(boardBtn, "click", () => toggleBoard(boardBtn));
      const full = el("button", { type: "button", class: "go-btn sc-full-profile", text: "View Full Profile" });
      ui().on(full, "click", () => openHim(s, r.pid));
      let cards;
      if (desk.sub === "looks") cards = [P.looksCard(s, b, pr, Math.min(REPORT_LOOKS, pr.looks != null ? pr.looks : looks), { reads: readsOf(s, r) })];
      else if (desk.sub === "profile") cards = null;
      else cards = P.scoutCards(s, b, pr).slice(0, 2);
      const fresh = el("div", {}, [
        el("div", { class: "sc-hero", "data-key": `who-${r.pid}` }, [hero]),
        el("div", { class: "pv-tabrow", "data-key": "tabrow" }, [sub, el("div", { class: "pv-acts sc-actions", "data-key": "actions" }, [send, full, boardBtn])]),
        reason ? el("p", { class: "muted small sc-why", "data-key": "why", text: reason }) : null,
        el("div", { class: "sc-sub-body pv-host", "data-key": `sub-${desk.sub}`, role: "tabpanel" }, [cards ? window.CFP.pv.grid(cards) : P.profileCards(s, b, me, pr)])]);
      ui().morph(body, fresh);
    }
    // this and last week's report lines on him: who looked and what moved, with the All Reports link
    function readsOf(s, r) {
      const lines = [];
      for (const [wk, label] of [["this_week", "This Week"], ["last_week", "Last Week"]]) {
        const items = [];
        for (const g of (cur.v.reports && cur.v.reports[wk]) || []) for (const it of g.items || []) if (it.pid === r.pid && it.change)
          items.push(el("li", { class: "small sc-read" }, [el("b", { text: `${g.area || g.scout}: ` }), cap(it.change)]));
        lines.push(el("div", { class: "sc-reads-week", "data-key": `reads-${wk}` }, [el("h4", { class: "pv-kick", text: label }),
          items.length ? el("ul", { class: "sc-reads" }, items) : el("p", { class: "muted small sc-no-reads", text: wk === "this_week" ? "No report lines on him this week." : "No report lines on him last week." })]));
      }
      const all = el("button", { type: "button", class: "go-link small sc-reports-open", "data-key": "all-reports", text: "All Reports" });
      ui().on(all, "click", () => openReports(s, (r.flags && r.flags.length) || r.likes ? "flags" : "this_week"));
      return [...lines, all];
    }
    async function sendScout(btn) {
      const r = sel.row;
      let res;
      try { res = await ui().busy(btn, api(s, "recruit", { pid: r.pid, action: "scout" })); }
      catch (err) { ui().toast(`Could not send a scout: ${H.errText(err)}`, { ms: 4000, kind: "error" }); return; }
      r.trips = (r.trips || 0) + 1;
      r.looks = Math.min(REPORT_LOOKS, (r.looks || 0) + SEND_LOOK);
      const look = res.look || null;
      if (look && look.after && look.after.potential) r.potential = look.after.potential;
      if (look && "likes" in look) r.likes = look.likes;
      cur.st.left = res.hours_left;
      cur.st.points = Math.max(0, cur.st.points - (r.cost || 0));      // the trip's cost (the desk's `cost`); the next load reads the week's truth
      sel.look = look;
      const li = cur.fillRow(r.pid);
      if (li) ui().pulse(li.querySelector(".sc-conf"));
      cur.patchHead(cur.v);
      // the toast is the trip's whole result: the grades it moved show in the Ratings tab, a coordinator's like on his row
      ui().toast(`Scouted ${r.name} · ${fmtLooks(r.looks)} of ${REPORT_LOOKS} looks${r.looks >= REPORT_LOOKS ? " · his report is complete" : ""}${look && look.likes ? ` · ${look.likes.who} likes him` : ""}`, { ms: 3000 });
      try { sel.pr = await api(s, `prospect/${encodeURIComponent(r.pid)}`); } catch (err) { /* the old read stands */ }
      paintIntel();
      // the Send that completed his report disabled itself: the focus moves on to the board button, never the page body
      const keepFocus = () => { const a = document.activeElement; if (!a || a === document.body || a.disabled) { const next = body.querySelector("#sc-board"); if (next) next.focus({ preventScroll: true }); } };
      keepFocus();
      // the counts, the flags and every other row follow; the browser may drop the focus off the disabled Send only now
      // (its focus fix-up runs late), so the board button takes it again once the list has settled
      Promise.resolve(cur.reload(r.pid)).then(() => requestAnimationFrame(keepFocus));
    }
    async function toggleBoard(btn) {
      const r = sel.row, p = sel.pr.public, on = !r.on_board;
      // taking him off pulls your offer too (the engine does it): the board's own confirm, one misclick should not cost you a recruit
      if (!on && p.offered_by_you && !window.confirm(`Take ${r.name} off your board? Your offer to him is pulled too: the NIL points come back to you${p.committed === s.team && !p.signed ? ", and he decommits from you" : ""}.`)) return;
      const hadOffer = !on && p.offered_by_you;
      try { await ui().busy(btn, api(s, "board", { pid: r.pid, on })); }
      catch (err) { ui().toast(`Could not change your board: ${H.errText(err)}`, { ms: 4000, kind: "error" }); return; }
      r.on_board = on;
      p.on_board = on;
      if (hadOffer) p.offered_by_you = false;
      cur.board += on ? 1 : -1;
      cur.fillRow(r.pid);
      cur.patchHead(cur.v);
      paintIntel();
      ui().toast(on ? `${r.name} is on your board.` : hadOffer ? `${r.name} is off your board · offer pulled.` : `${r.name} is off your board.`, { ms: 2500 });
      // reload either way: a list read still in flight (a trip's reload) was taken before this change and would paint
      // his old star back; the new load supersedes it (load's seq drops the older answer)
      cur.reload(r.pid);
    }
    return panel;
  }
  // ----- Scouting Operations: a bar that opens the staff rows (area dropdown, contract, narrowed bar, coverage) -----
  const uncovered = (v, rv) => {
    const covered = new Set(v.scouts.map((m) => m.area).filter(Boolean));
    return Object.keys(rv.areas || {}).filter((a) => !covered.has(a));
  };
  function openText(v, rv) {
    const open = uncovered(v, rv);
    return open.length ? `Not covered: ${open.map((a) => `${a} (${rv.area_counts[a]})`).join(", ")}. Prospects there show public information only.` : "Every area has a scout.";
  }
  function opsBar(s, v, rv) {
    const list = el("ul", { class: "sc-scout-list" });
    // one card a staff member; an open recruiter spot (fewer than RECRUITERS) shows as a card too
    const draw = (x) => el("ul", { class: "sc-scout-list" }, [...x.scouts.map((m) => scoutRow(s, m, rv, list)),
      ...Array.from({ length: Math.max(0, RECRUITERS - x.scouts.filter((m) => String(m.role) === "Recruiter").length) }, (_, i) =>
        el("li", { class: "sc-scout sc-open-spot", "data-key": `open-${i}` }, [avatar(`open-${i}`, "sm"), el("div", { class: "sc-scout-main" }, [
          el("div", { class: "sc-scout-line" }, [el("b", { class: "sc-scout-name", text: "Open Spot" }), el("span", { class: "muted small sc-role", text: "Recruiter" })]),
          el("p", { class: "muted small", text: "Hire one in the offseason." })])]))]);
    list.append(...[...draw(v).children]);           // a copy of the live collection: moving a node while walking it skips the next
    const note = el("p", { class: "muted small sc-open" }, [openText(v, rv)]);
    const summary = el("span", { class: "muted small sc-ops-summary" });
    const sumText = (x) => `${plural(x.scouts.length, "scout")}: ${x.scouts.map((m) => m.area || "no area").join(", ")}`;
    summary.textContent = sumText(v);
    list.__redraw = async () => {
      let x;
      try { x = await api(s, deskPath(0, 1)); } catch (err) { return; }
      ui().morph(list, draw(x));
      note.textContent = openText(x, rv);
      summary.textContent = sumText(x);
      cur.v.scouts = x.scouts;
    };
    const body = el("div", { class: "sc-ops-body sc-block-scouts", id: "sc-ops-body" }, [
      list, note]);
    body.hidden = !desk.ops;
    const toggle = el("button", { type: "button", class: "sc-ops-toggle", "aria-expanded": String(desk.ops), "aria-controls": "sc-ops-body" }, [
      el("span", { class: "sc-chev", "aria-hidden": "true", text: "▾" }), el("b", { class: "sc-ops-title", text: "Scouting Operations" }),
      el("span", { class: "muted small sc-ops-tag", text: "Staff assignments, regions and coverage" })]);
    const opsTip = ui().tip("Each scout takes a look at every prospect in his area each week: half a look, up to two. Pick the area each one covers.", "Scouting Operations");
    const manage = el("button", { type: "button", id: "sc-manage", class: "go-btn sc-manage", text: desk.ops ? "Hide Staff" : "Manage Staff", "aria-controls": "sc-ops-body" });
    const bar = el("section", { class: `go-card sc-ops${desk.ops ? " open" : ""}`, "aria-label": "Scouting Operations" }, [el("div", { class: "sc-ops-head" }, [toggle, opsTip, summary, manage]), body]);
    const setOpen = (open) => {
      desk.ops = open;
      body.hidden = !open;
      bar.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
      manage.textContent = open ? "Hide Staff" : "Manage Staff";
      syncRoute();
      if (open) bar.scrollIntoView({ block: "nearest" });
    };
    ui().on(toggle, "click", () => setOpen(!desk.ops));
    ui().on(manage, "click", () => setOpen(!desk.ops));
    return bar;
  }
  function scoutRow(s, m, rv, list) {
    const sel = el("select", { id: `area-${m.id}`, class: "go-sel sc-area", "aria-label": `${m.name}'s scouting area` },
      Object.keys(rv.areas || {}).map((a) => el("option", { value: a, text: `${a} (${rv.area_counts[a]})` })));
    if (m.area) sel.value = m.area;
    else { sel.prepend(el("option", { value: "", text: "No Area: Assign One" })); sel.value = ""; }
    ui().on(sel, "change", async () => {
      const area = sel.value;
      if (!area) return;
      try { await api(s, "staff", { staff_id: m.id, area }); }
      catch (err) { sel.value = m.area || ""; ui().toast(`Could not reassign: ${H.errText(err)}`, { ms: 4000, kind: "error" }); return; }
      ui().toast(`${m.name} now scouts ${area}.`, { ms: 2500 });
      list.__redraw();
    });
    const y = m.yield || { looks: 0, narrowed: 0, flags: 0 };
    const taken = y.looks / AREA_LOOK;                // his yield is in look units; each of his looks is half a look
    const pct = taken ? Math.round(100 * Math.min(taken, y.narrowed) / taken) : 0;
    const role = String(m.role);
    return el("li", { class: "sc-scout", "data-key": m.id }, [
      avatar(`staff-${m.id}-${m.name}`, "sm"),
      el("div", { class: "sc-scout-main" }, [
        el("div", { class: "sc-scout-line" }, [el("b", { class: "sc-scout-name", text: m.name }),
          el("span", { class: "muted small sc-role", text: `${ROLE_SHORT[role] || role}${m.contract_until ? ` · through ${m.contract_until}` : ""}`, title: role }), R().wordTag(m.evaluation_word)]),
        sel,
        el("div", { class: "sc-scout-yield", title: m.area ? `${looksText(y.looks)} this week in ${m.area} (half a look a prospect): ${y.narrowed} narrowed a read` : "No area: assign one" }, [
          el("div", { class: "sc-bar", role: "progressbar", "aria-label": "Narrowed this week", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) },
            [el("i", { class: "sc-bar-fill", style: `width:${pct}%` })]),
          el("span", { class: "muted small sc-yield-text", text: m.area ? `${looksText(y.looks)} this week · ${num(y.narrowed)} narrowed` : "No area: assign one" }),
          y.flags > 0 ? el("span", { class: "go-tag warn sc-flags-n", text: plural(y.flags, "Flag") }) : null])])]);
  }

  // ----- All Reports (a modal, token "reports" or "reports:last_week|flags"): This Week · Last Week · Flags, by scout -----
  async function tabData(s, fresh) {
    if (!fresh && cur && cur.s.id === s.id) return cur;
    const v = await api(s, deskPath(0, 1));
    if (cur && cur.s.id === s.id) { Object.assign(cur.v, { scouts: v.scouts, reports: v.reports, flags: v.flags }); return cur; }
    return { s, v };
  }
  async function openReports(s, week, opts = {}) {
    let d;
    try { d = await tabData(s, !!opts.restore); } catch (err) { if (opts.restore) return false; ui().toast(`Could not load the reports: ${H.errText(err)}`, { ms: 4000, kind: "error" }); return false; }
    const v = d.v;
    let at = WEEKS.some(([k]) => k === week) ? week : "this_week";
    const body = el("div", { class: "sc-report-list" });
    const strip = el("div", { class: "go-subtabs sc-tabs", role: "tablist", "aria-label": "Reports" });
    const node = el("section", { class: "sc-block sc-reports", "aria-label": "Reports" }, [strip, body]);
    const draw = () => {
      body.innerHTML = "";
      for (const t of strip.children) t.setAttribute("aria-selected", String(t.dataset.week === at));
      if (at === "flags") { body.append(flagsList(s, v)); return; }
      const groups = v.reports[at] || [];
      if (!groups.length) body.append(el("p", { class: "muted sc-reports-empty", text: at === "this_week" ? "No looks yet this week: your scouts' looks land at the week step; a trip adds one now." : "No looks last week." }));
      for (const g of groups) body.append(reportGroup(s, g));
    };
    for (const [k, t] of WEEKS) {
      strip.append(el("button", { type: "button", role: "tab", "data-week": k, "aria-selected": "false", text: k === "flags" && v.flags && v.flags.length ? `Flags (${v.flags.length})` : t,
        onclick: () => { at = k; if (H.retoken) H.retoken(node, k === "this_week" ? "reports" : `reports:${k}`); draw(); } }));
    }
    draw();
    H.openModal("All Reports", node, at === "this_week" ? "reports" : `reports:${at}`, { restore: !!opts.restore });
    return true;
  }
  function reportGroup(s, g) {
    const items = g.items || [];
    const lis = items.map((it) => el("li", { class: "sc-report-item" }, [el("span", { class: "go-stars sc-item-stars", text: stars(it.stars) }),
      el("span", { class: "muted small sc-item-pos", text: it.position }), nameLink(s, it.pid, it.name),
      it.change ? el("span", { class: "muted small sc-item-change", text: cap(it.change) }) : null,
      it.flags && it.flags.length || it.likes ? el("span", { class: "go-tags sc-item-flags" }, [...(it.flags || []).map(flagBadge), it.likes ? likesTag(it.likes) : null]) : null]));
    const more = foldable(lis);
    return el("div", { class: "sc-report", "data-key": g.scout_id }, [
      el("div", { class: "sc-report-head" }, [el("b", { text: [g.scout, g.area].filter(Boolean).join(" · ") }),
        el("span", { class: "muted small", text: items.length ? `${looksText(g.looks)}, ${g.changed} changed` : `${looksText(g.looks)}, nothing new` })]),
      items.length ? el("ul", { class: "sc-report-items" }, lis) : null, more]);
  }
  // the flags: gems, bust risks and generational prospects your staff found this class, and the recruits a coordinator likes
  function flagsList(s, v) {
    const rows = v.flags || [];
    if (!rows.length) return el("p", { class: "muted sc-flags-empty", text: "No finds yet: as the looks add up your scouts flag gems, bust risks and generational prospects here, and your coordinators name the recruits they think start for you." });
    const lis = rows.map((f) => el("li", { class: `sc-flag ${f.flag === "likes" ? "sc-flag-likes" : ""}`, "data-pid": f.pid, "data-flag": f.flag }, [f.flag === "likes" && f.likes ? likesTag(f.likes) : flagBadge(f.flag),
      el("span", { class: "sc-flag-id" }, [nameLink(s, f.pid, f.name), el("span", { class: "muted small", text: `${f.position} · ${stars(f.stars)} · ${looksText(f.looks)}` })]),
      f.flag !== "likes" && f.likes ? likesTag(f.likes) : null,
      el("span", { class: "muted small sc-standing", text: f.standing_word })]));
    const more = foldable(lis);
    return el("div", { class: "sc-flags" }, [el("ul", { class: "sc-flag-list" }, lis), more]);
  }

  // a modal the address names (season.js's openToken, on a load or Back/Forward): "reports" with its tab
  async function openToken(s, helpers, kind, arg, opts) {
    H = H || helpers;
    if (kind === "reports") return openReports(s, arg || "this_week", opts);
    return false;
  }
  // want("reports"): open All Reports once the tab next draws (the pane's "Reports on the Scouting Tab");
  // want("scouts"): the Operations bar opens (a profile's "Assign Your Staff")
  const want = (kind) => { if (kind === "scouts") desk.ops = true; else wanted = kind; };

  window.CFP.scouting = { render, applyRoute, openToken, want };
})();
