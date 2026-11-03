/* The Scouting tab (replaces Staff), queue first. Top to bottom: the header (title, the hours left this week, one help
   line); the scouts strip (a chip per scout: avatar, role, area; the areas nobody covers; Manage Scouts opens the full
   scout rows with the area dropdowns in a modal, token "scouts"); then the Scouting queue, the page itself: a table of
   recruits worth a trip, 20 to a page (NAME with an On Board mark, NEED, RANK, POTENTIAL, LOOKS in halves of three,
   Send), with a board filter, a search, sortable headers and Previous · 1 2 … n · Next pagination on the API's
   offset/limit; beside it (above it, folded, on a narrow screen) the This Week digest: the finds, the reports
   completed, the reads that moved on your board, one summary line and All Reports, which opens the full reports
   (This Week · Last Week · Flags, by scout, Show All) in a modal, token "reports[:last_week|flags]".
   A prospect's name anywhere here opens his Prospect Profile over the tab: nothing goes on your board by itself.
   window.CFP.scouting.render(season, box, helpers); helpers are season.js's recruitingHelpers, the same
   H as web/recruiting.js: { api, postJSON, toast, errText, openModal, retoken, onChange(tab), ... }. Smoothness through
   window.CFP.ui: an action never rebuilds the block the player is looking at. */
(function () {
  "use strict";
  const { el } = window.CFP;
  const ui = () => window.CFP.ui;
  const R = () => window.Recruiting;                 // wordTag, openProfile
  const SCOUT_HOURS = 5, REPORT_LOOKS = 3, SEND_LOOK = 1, AREA_LOOK = 0.5;   // recruiting.HOURS["scout"], REPORT_LOOKS, SEND_LOOK, AREA_LOOK
  // looks come in trip units: a Send is one, a week in a scout's area half, a full report three; a count shows its half only when it has one
  const fmtLooks = (n) => (Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(1));
  const looksTotal = (n) => `${Number.isInteger(Number(n)) ? Number(n).toLocaleString("en-US") : fmtLooks(n)} looks`;   // a week's total, with its comma
  const looksText = (n) => `${fmtLooks(n)} look${Number(n) === 1 ? "" : "s"}`;
  const leftOf = (looks) => Math.max(0, REPORT_LOOKS - (looks || 0));
  const PAGE = 20, WHOLE = 400;                      // rows a page (20 keeps the page short: the queue is the page); the most one ask returns (prospects.QUEUE_MAX)
  const DIGEST_ROWS = 5;                             // a digest section's rows before "n more in All Reports"
  const POSITIONS = ["QB", "RB", "WR", "TE", "OT", "IOL", "EDGE", "DL", "LB", "CB", "S", "ATH", "K", "P"];
  const GROUPS = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"];     // offseason.GROUP's roster groups
  const WORDS = ["Weak", "Fair", "Solid", "Strong", "Elite", "All-American"];         // recruiting.WORDS, low to high
  const GRADE_NAMES = { potential: "Potential", athleticism: "Athleticism", size_strength: "Size & Strength", technique: "Technique", football_iq: "Football IQ", coachability: "Coachability" };
  const FLAGS = { generational: ["Generational", "Your staff's find after three looks: a once-in-a-generation talent every program in the country wants"],
                  gem: ["Gem", "Your staff's find: even the low end of his potential read beats all but a few prospects at his star level, and few programs rate him that high"],
                  bust: ["Bust Risk", "Your staff's find: his ranking is high but even the top of their read sits under nearly every prospect at his star level"] };
  const ROLE_SHORT = { "Offensive Coordinator": "OC", "Defensive Coordinator": "DC", Recruiter: "Recruiter" };
  const SORTS = { need: (r) => r.need || 0, rank: (r) => r.national_rank || 1e9, looks: (r) => r.looks || 0,
                  potential: (r) => (r.potential ? WORDS.indexOf(r.potential[1]) * 10 + WORDS.indexOf(r.potential[0]) : -1) };
  const SORT_DEFAULT = { need: -1, rank: 1, looks: -1, potential: -1 };     // the first click: the most need, the best rank, the most looks, the best read
  const WEEKS = [["this_week", "This Week"], ["last_week", "Last Week"], ["flags", "Flags"]];
  // the filters, the page and the sort, kept across renders
  const desk = { q: "", position: "", group: "", board: "all", page: 0, sort: null, dir: 1 };
  let H = null;
  let cur = null;                                    // the tab as drawn: { s, v (the latest view), rv (/recruiting: the areas), strip, digest, reload }
  let wanted = null;                                 // a modal to open once the tab draws ("scouts", "reports"): the pane's links here

  const stars = (n) => "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const num = (n) => Number(n).toLocaleString("en-US");
  const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
  const loading = (text) => el("p", { class: "muted go-loading", text });
  // api(s, "board", body): one call on this season (the path after /api/season/{id}/; a body posts)
  const api = (s, path, body) => (body === undefined ? H.api(`/api/season/${s.id}/${path}`) : H.api(`/api/season/${s.id}/${path}`, H.postJSON(body)));
  const wordRange = (r) => (r[0] === r[1] ? [R().wordTag(r[0])] : [R().wordTag(r[0]), " to ", R().wordTag(r[1])]);
  // the queue's potential: plain words in their tone color on one line ("Elite–All-American"), as the pane's grade cards
  const gradeWord = (w) => el("b", { class: `go-grade ${String(w).toLowerCase()}`, text: w });
  const gradePlain = (r) => (r[0] === r[1] ? [gradeWord(r[0])] : [gradeWord(r[0]), el("span", { class: "go-grade-dash", text: "–" }), gradeWord(r[1])]);
  const flagBadge = (f) => el("span", { class: `go-badge ${f}`, text: (FLAGS[f] || [f])[0], title: (FLAGS[f] || [])[1] || "" });
  // "OC likes him" (the API's `likes`: {who, name, text}): his report is complete and the read says he would start for you.
  // The tag on report items, Flags rows and the digest; a small "OC ♥" pill in the queue's NAME cell
  const likesTag = (l) => el("span", { class: "go-tag good go-likes", text: `${l.who} Likes Him`, title: l.text });
  const likesPill = (l) => el("span", { class: "go-tag good sc-likes", text: `${l.who} ♥`, title: l.text });
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
  function deskPath(offset, limit) {
    const q = new URLSearchParams();
    if (desk.q) q.set("q", desk.q);
    if (desk.position) q.set("position", desk.position);
    if (desk.group) q.set("group", desk.group);
    if (offset) q.set("offset", String(offset));
    if (limit) q.set("limit", String(limit));
    const qs = q.toString();
    return `scouting${qs ? `?${qs}` : ""}`;
  }
  // a recruit's name anywhere on the tab opens his Prospect Profile over it: no board change, no tab switch (putting
  // him on the board is the profile's own Add to Your Board). When the profile closes the queue refetches, so a
  // board change made there shows as his On Board mark.
  const openLayers = () => document.querySelectorAll(".modal:not([hidden])").length;
  function openHim(s, pid) {
    R().openProfile(s, pid);
    const n = openLayers();
    const watch = new MutationObserver(() => {
      if (openLayers() >= n) return;
      watch.disconnect();
      if (cur && cur.s.id === s.id && cur.reload) cur.reload();
    });
    watch.observe(document.body, { childList: true, subtree: false });
    const base = document.getElementById("modal");
    if (base) watch.observe(base, { attributes: true, attributeFilter: ["hidden"] });
  }
  function nameLink(s, pid, name, cls) {
    const b = el("button", { type: "button", class: `go-link ${cls || ""}`, "data-pid": pid, text: name, title: "Open his profile" });
    ui().on(b, "click", () => openHim(s, pid));
    return b;
  }
  // a list longer than n folds past n with "Show All n" (a toggle)
  const SHOWN = 8;
  function foldable(items, n = SHOWN) {
    const lis = items;
    lis.forEach((li, i) => { if (i >= n) li.hidden = true; });
    if (items.length <= n) return null;
    const more = el("button", { type: "button", class: "go-link small sc-report-more", text: `Show All ${items.length}`, "aria-expanded": "false" });
    more.addEventListener("click", () => {
      const open = more.getAttribute("aria-expanded") !== "true";
      more.setAttribute("aria-expanded", String(open));
      more.textContent = open ? "Show Fewer" : `Show All ${items.length}`;
      lis.forEach((li, i) => { if (i >= n) li.hidden = !open; });
    });
    return more;
  }

  // the tab's place in the address (web/route.js): the queue's board chip (a replace); Manage Scouts and All Reports are modal tokens
  const syncRoute = () => { if (window.CFP.route) window.CFP.route.set({ qboard: desk.board !== "all" ? desk.board : null }); };
  function applyRoute(r) { desk.board = ["on", "off"].includes(r.qboard) ? r.qboard : "all"; }

  async function render(s, box, helpers) {
    H = helpers;
    desk.page = 0;
    if (!box.firstChild) box.append(loading("Loading the scouting desk…"));
    let v, rv;
    try { [v, rv] = await Promise.all([api(s, deskPath(0, PAGE)), api(s, "recruiting")]); }
    catch (err) { box.innerHTML = ""; box.append(loading(`Could not load the scouting desk: ${H.errText(err)}`)); return; }
    cur = { s, v, rv };
    const hours = el("div", { id: "sc-hours", class: "go-pill sc-hours", role: "status" });
    box.innerHTML = "";
    box.append(el("div", { class: "sc-head" }, [
      el("div", { class: "sc-title-row" }, [el("div", { class: "go-display l", text: "Scouting" }), hours]),
      el("p", { class: "muted sc-help", text: `A full report is three looks. A trip (${SCOUT_HOURS} hours) is one look; a week in a scout's area is half a look, up to two.` })]));
    cur.strip = scoutStrip(s, v, rv);
    cur.digest = digestPanel(s, v);
    box.append(cur.strip, el("div", { class: "sc-main" }, [queuePanel(s, v, hours), cur.digest]));
    if (wanted) {
      const k = wanted;
      wanted = null;
      if (k === "scouts") openScouts(s);
      else openReports(s, "this_week");
    }
  }

  // ----- the scouts strip: a chip each, the uncovered areas, Manage Scouts -----
  const uncovered = (v, rv) => {
    const covered = new Set(v.scouts.map((m) => m.area).filter(Boolean));
    return Object.keys(rv.areas || {}).filter((a) => !covered.has(a));
  };
  const roleShort = (m) => ROLE_SHORT[String(m.role)] || String(m.role);
  function scoutChip(m) {
    return el("li", { class: "sc-scout-chip", "data-key": m.id, title: `${m.name}, ${m.role}: ${m.area || "no area"}` }, [
      avatar(`staff-${m.id}-${m.name}`, "xs"), el("b", { class: "sc-chip-role", text: roleShort(m) }),
      el("span", { class: `sc-chip-area${m.area ? "" : " muted"}`, text: m.area || "No Area" })]);
  }
  function stripList(v) { return el("ul", { class: "sc-strip-list", "aria-label": "Your scouts and their areas" }, v.scouts.map(scoutChip)); }
  function openNote(v, rv) {
    const open = uncovered(v, rv);
    return el("span", { class: "muted small sc-strip-open", "data-key": "open", title: open.length ? `Prospects there show public information only: ${open.join(", ")}` : "",
      text: open.length ? `Not covered: ${open.join(", ")}` : "Every area covered." });
  }
  function scoutStrip(s, v, rv) {
    const manage = el("button", { type: "button", id: "sc-manage", class: "go-btn sc-manage", text: "Manage Scouts" });
    ui().on(manage, "click", () => openScouts(s));
    const list = stripList(v), note = el("div", { class: "sc-strip-note" }, [openNote(v, rv)]);
    const strip = el("section", { class: "sc-strip", "aria-label": "Your scouts" }, [
      el("span", { class: "go-kicker sc-strip-kicker", text: plural(v.scouts.length, "Scout") }), list, note, manage]);
    strip.__patch = (d) => { ui().morph(list, stripList(d)); ui().morph(note, el("div", {}, [openNote(d, cur.rv)])); };
    return strip;
  }

  // ----- Manage Scouts (a modal, token "scouts"): a row each with the area dropdown, contract and narrowed bar -----
  async function tabData(s, fresh) {
    if (!fresh && cur && cur.s.id === s.id) return cur;
    const [v, rv] = await Promise.all([api(s, deskPath(0, 1)), api(s, "recruiting")]);
    if (cur && cur.s.id === s.id) { Object.assign(cur.v, { scouts: v.scouts, reports: v.reports, flags: v.flags }); cur.rv = rv; return cur; }
    return { s, v, rv };
  }
  async function openScouts(s, opts = {}) {
    let d;
    try { d = await tabData(s, !!opts.restore); } catch (err) { if (opts.restore) return false; ui().toast(`Could not load your scouts: ${H.errText(err)}`, { ms: 4000, kind: "error" }); return false; }
    const { v, rv } = d;
    const list = el("ul", { class: "sc-scout-list" });
    const draw = (x) => el("ul", { class: "sc-scout-list" }, x.scouts.map((m) => scoutRow(s, m, rv, list)));
    list.append(...[...draw(v).children]);           // a copy of the live collection: moving a node while walking it skips the next
    const note = el("p", { class: "muted small sc-open" }, [openText(v, rv)]);
    list.__redraw = async () => {
      let x;
      try { x = await api(s, deskPath(0, 1)); } catch (err) { return; }
      ui().morph(list, draw(x));
      note.textContent = openText(x, rv);
      if (cur && cur.s.id === s.id) { cur.v.scouts = x.scouts; if (cur.strip) cur.strip.__patch(x); }
    };
    const node = el("div", { class: "sc-block sc-block-scouts" }, [
      el("p", { class: "muted small sc-manage-help", text: "Each scout takes a look at every prospect in his area each week: half a look, up to two. Pick the area each one covers." }),
      list, note]);
    H.openModal("Manage Scouts", node, "scouts", { restore: !!opts.restore });
    return true;
  }
  function openText(v, rv) {
    const open = uncovered(v, rv);
    return open.length ? `Not covered: ${open.map((a) => `${a} (${rv.area_counts[a]})`).join(", ")}. Prospects there show public information only.` : "Every area has a scout.";
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

  // ----- the This Week digest: only what needs attention, then one summary line and All Reports -----
  function digestBody(s, v) {
    const groups = (v.reports && v.reports.this_week) || [];
    const seen = new Map();                          // one row a recruit: a scout's look and your trip on the same man merge
    for (const g of groups) for (const it of g.items || []) {
      const had = seen.get(it.pid);
      if (!had) seen.set(it.pid, { ...it, flags: [...(it.flags || [])] });
      else { for (const f of it.flags || []) if (!had.flags.includes(f)) had.flags.push(f); had.change = had.change || it.change; }
    }
    const items = [...seen.values()];
    const finds = items.filter((it) => it.flags.length || it.likes);
    const done = items.filter((it) => it.complete && !finds.includes(it));
    const board = items.filter((it) => it.on_board && it.change && !finds.includes(it) && !done.includes(it));
    const looks = groups.reduce((n, g) => n + (g.looks || 0), 0), changed = groups.reduce((n, g) => n + (g.changed || 0), 0);
    const areas = new Set(groups.map((g) => g.area).filter(Boolean)).size;
    const who = (it) => [nameLink(s, it.pid, it.name, "sc-dg-name"), el("span", { class: "muted small sc-dg-pos", text: it.position })];
    const section = (key, title, rows, draw) => {
      if (!rows.length) return null;
      const shown = rows.slice(0, DIGEST_ROWS), more = rows.length - shown.length;
      return el("div", { class: "sc-dg-section", "data-key": key }, [el("div", { class: "sc-dg-title", text: title }),
        el("ul", { class: "sc-dg-list" }, shown.map((it) => el("li", { class: "sc-dg-item", "data-key": it.pid, "data-pid": it.pid }, draw(it)))),
        more > 0 ? moreLink(s, `${more} More in All Reports`, "this_week") : null]);
    };
    const out = [
      section("finds", "Finds", finds, (it) => [el("span", { class: "go-tags sc-dg-tags" }, [...it.flags.map(flagBadge), it.likes ? likesTag(it.likes) : null]), ...who(it)]),
      section("done", "Reports Completed", done, (it) => [el("span", { class: "go-tag good sc-dg-done", text: "Complete" }), ...who(it)]),
      section("board", "Your Board", board, (it) => [...who(it), el("span", { class: "muted small sc-dg-change", text: cap(it.change) })])].filter(Boolean);
    const notable = out.length;
    if (!looks && !notable) out.push(el("p", { class: "muted sc-dg-empty", "data-key": "empty", text: "Nothing new this week: send a scout from the queue." }));
    else {
      if (!notable) out.push(el("p", { class: "muted small sc-dg-quiet", "data-key": "quiet", text: "No finds and nothing moved on your board this week." }));
      out.push(el("p", { class: "muted small sc-dg-summary", "data-key": "summary",
        text: `${num(changed)} ${changed === 1 ? "read" : "reads"} changed across ${plural(areas, "area")} this week (${looksTotal(looks)} in all).` }));
    }
    const all = el("button", { type: "button", class: "go-btn sc-all-reports", id: "sc-all-reports", text: "All Reports" });
    ui().on(all, "click", () => openReports(s, "this_week"));
    const flagsN = (v.flags || []).length;
    out.push(el("div", { class: "sc-dg-foot", "data-key": "foot" }, [all, flagsN ? moreLink(s, `${plural(flagsN, "Find")} This Class`, "flags") : null]));
    return { nodes: out, count: finds.length + done.length + board.length };
  }
  function moreLink(s, text, week) {
    const b = el("button", { type: "button", class: "go-link small sc-dg-more", "data-week": week, text });
    ui().on(b, "click", () => openReports(s, week));
    return b;
  }
  const narrow = () => window.matchMedia && window.matchMedia("(max-width: 1099px)").matches;
  function digestPanel(s, v) {
    const body = el("div", { class: "sc-dg-body" });
    const count = el("span", { class: "go-tag sc-dg-count" });
    const fill = (d) => {
      const b = digestBody(s, d);
      ui().morph(body, el("div", {}, b.nodes));
      count.textContent = b.count ? `${b.count} New` : "Quiet";
      count.classList.toggle("good", b.count > 0);
    };
    const b = digestBody(s, v);
    body.append(...b.nodes);
    count.textContent = b.count ? `${b.count} New` : "Quiet";
    count.classList.toggle("good", b.count > 0);
    // a side column on a wide screen (always open); a folded block above the queue on a narrow one
    const panel = el("details", { class: "go-card sc-panel sc-digest", "aria-label": "This week" }, [
      el("summary", { class: "sc-dg-head" }, [el("span", { class: "go-kicker", text: "This Week" }), count]), body]);
    if (!narrow()) panel.open = true;
    panel.addEventListener("toggle", () => { if (!panel.open && !narrow()) panel.open = true; });
    panel.__patch = fill;
    return panel;
  }

  // ----- All Reports (a modal, token "reports" or "reports:last_week|flags"): This Week · Last Week · Flags, by scout -----
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
      if (!groups.length) body.append(el("p", { class: "muted sc-reports-empty", text: at === "this_week" ? "No looks yet this week: your scouts' looks land at the week step; a trip from the queue adds one now." : "No looks last week." }));
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
  // (flag "likes": the tag is the row's badge; a gem or bust row he also earned carries the tag beside his name)
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

  // ----- the Scouting queue: the chips and tools, the table (keyed rows patched in place), the pager -----
  function queuePanel(s, v, hours) {
    const st = { hours: v.hours, left: v.hours_left, total: v.queue_total, rows: v.queue.slice() };
    const results = new Map();                       // pid -> the last trip's look, shown as a row under him
    const hoursText = () => `${st.left} of ${plural(st.hours, "hour")} left this week`;
    hours.textContent = hoursText();
    const chips = el("div", { class: "sc-chips", role: "group", "aria-label": "Whose rows" }, [["all", "All"], ["on", "On My Board"], ["off", "Not On My Board"]].map(([k, t]) =>
      el("button", { type: "button", class: `go-chip small${desk.board === k ? " on" : ""}`, "data-board": k, "aria-pressed": String(desk.board === k), text: t,
        onclick: () => { if (desk.board === k) return; desk.board = k; desk.page = 0; syncRoute(); for (const c of chips.children) { c.classList.toggle("on", c.dataset.board === k); c.setAttribute("aria-pressed", String(c.dataset.board === k)); } load(); } })));
    const search = el("input", { type: "search", id: "sc-search", value: desk.q, placeholder: "Search name or state", "aria-label": "Search the queue" });
    const sel = (id, label, options, value) => {
      const node = el("select", { id, class: "go-sel", "aria-label": label }, options.map(([k, t]) => el("option", { value: k, text: t })));
      node.value = value;
      return node;
    };
    const pos = sel("sc-position", "Position", [["", "Any Position"], ...POSITIONS.map((p) => [p, p])], desk.position);
    const grp = sel("sc-group", "Roster group", [["", "Any Group"], ...GROUPS.map((g) => [g, `${g} Group`])], desk.group);
    // the table: a sticky header with sortable columns, the body a keyed list
    const sortBtn = (key, label) => el("button", { type: "button", class: "sc-sort", "data-sort": key, text: label, title: `Sort by ${label.toLowerCase()}`,
      onclick: () => { if (desk.sort === key) desk.dir = -desk.dir; else { desk.sort = key; desk.dir = SORT_DEFAULT[key]; } paint(); } });
    const th = (cls, content, key) => el("th", { scope: "col", class: `sc-c-${cls}`, ...(key ? { "aria-sort": "none" } : {}) }, key ? [sortBtn(key, content)] : [el("span", { text: content })]);
    const heads = { need: th("need", "Need", "need"), rank: th("rank", "Rank", "rank"), potential: th("pot", "Potential", "potential"), looks: th("looks", "Looks", "looks") };
    const tbody = el("tbody", { class: "sc-tbody" });
    const table = el("table", { class: "sc-table" }, [el("thead", {}, [el("tr", {}, [th("name", "Name"), heads.need, heads.rank, heads.potential, heads.looks,
      el("th", { scope: "col", class: "sc-c-act" }, [el("span", { class: "sc-sr", text: "Send a Scout" })])])]), tbody]);
    const wrap = el("div", { class: "sc-table-wrap" }, [table]);
    const empty = el("p", { class: "muted sc-queue-empty", text: "Nobody matches: clear the search or a filter.", hidden: "" });
    const showing = el("span", { class: "muted small sc-showing", role: "status" });
    const pager = el("nav", { class: "sc-pager", "aria-label": "Pages" });
    const ctx = { hours, hoursText, tbody, results, paint: () => paint(), reload: (keep) => load(keep) };
    if (cur) cur.reload = () => load();
    const sorted = (rows) => {
      if (!desk.sort) return rows;
      const f = SORTS[desk.sort];
      return rows.slice().sort((a, b) => (f(a) - f(b)) * desk.dir || (a.national_rank || 0) - (b.national_rank || 0));
    };
    function paint() {
      for (const [k, h] of Object.entries(heads)) h.setAttribute("aria-sort", desk.sort === k ? (desk.dir > 0 ? "ascending" : "descending") : "none");
      const items = [];
      for (const r of sorted(st.rows)) { items.push(r); if (results.has(r.pid)) items.push({ pid: r.pid, __result: true }); }
      ui().reconcile(tbody, items, (r) => (r.__result ? `${r.pid}:result` : r.pid),
        (r) => (r.__result ? resultRow(results.get(r.pid)) : drawRow(s, r, st, ctx)), (n, r) => { if (!r.__result) { n.__row = r; fill(n, r, st); } });
      const from = st.rows.length ? desk.page * PAGE + 1 : 0, to = desk.page * PAGE + st.rows.length;
      showing.textContent = st.rows.length ? `Showing ${num(from)} to ${num(to)} of ${num(st.total)}` : `Showing 0 of ${num(st.total)}`;
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
      const nodes = [btn("sc-prev", "Previous", {}, desk.page - 1, at <= 1)];
      let last = 0;
      for (const p of want) {
        if (p - last > 1) nodes.push(el("span", { class: "muted sc-gap", "aria-hidden": "true", text: "…" }));
        nodes.push(btn(`sc-page${p === at ? " primary" : ""}`, String(p), { "data-page": String(p), ...(p === at ? { "aria-current": "page" } : {}) }, p - 1, false));
        last = p;
      }
      nodes.push(btn("sc-next", "Next", {}, desk.page + 1, at >= pages));
      ui().morph(pager, el("nav", { class: "sc-pager", "aria-label": "Pages" }, nodes));
    }
    function go(page) {
      const pages = Math.max(1, Math.ceil(st.total / PAGE));
      desk.page = Math.max(0, Math.min(pages - 1, page));
      load();
      wrap.scrollIntoView({ block: "nearest" });
    }
    let seq = 0;
    // load(keep): the page the filters, the board chip and desk.page name. "On my board" and "Not on my board" are
    // client-side on the whole board (each row's on_board): the API lists board rows first, so one ask of 400 holds
    // them all; the rest of the class pages past them. keep: a pid whose row stays even if the API dropped him (his
    // third trip just landed). Every load also patches the digest and the scouts strip from the view it fetched.
    async function load(keep) {
      const mine = ++seq;
      wrap.setAttribute("aria-busy", "true");
      let d;
      try {
        if (desk.board === "all") d = await api(s, deskPath(desk.page * PAGE, PAGE));
        else {
          const big = await api(s, deskPath(0, WHOLE));
          const mineRows = big.queue.filter((r) => r.on_board);
          if (desk.board === "on") d = { ...big, queue: mineRows.slice(desk.page * PAGE, desk.page * PAGE + PAGE), queue_total: mineRows.length };
          else {
            const off = mineRows.length + desk.page * PAGE;
            const page = off + PAGE <= big.queue.length || big.queue.length < WHOLE ? big.queue.slice(off, off + PAGE) : (await api(s, deskPath(off, PAGE))).queue;
            d = { ...big, queue: page.filter((r) => !r.on_board), queue_total: Math.max(0, big.queue_total - mineRows.length) };
          }
        }
      } catch (err) { if (mine === seq) wrap.removeAttribute("aria-busy"); ui().toast(`Could not load the queue: ${H.errText(err)}`, { ms: 4000, kind: "error" }); return; }
      if (mine !== seq) return;                       // a newer ask landed first
      wrap.removeAttribute("aria-busy");
      if (keep && !d.queue.some((r) => r.pid === keep)) {
        const i = st.rows.findIndex((r) => r.pid === keep);
        if (i >= 0) d.queue.splice(Math.min(i, d.queue.length), 0, st.rows[i]);
      }
      st.total = d.queue_total; st.left = d.hours_left; st.hours = d.hours;
      if (hours.textContent !== hoursText()) { hours.textContent = hoursText(); ui().pulse(hours); }
      st.rows = d.queue;
      paint();
      if (cur && cur.s.id === s.id) {
        Object.assign(cur.v, { scouts: d.scouts, reports: d.reports, flags: d.flags });
        if (cur.digest && cur.digest.isConnected) cur.digest.__patch(cur.v);
      }
    }
    let qTimer = null;
    search.addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(() => { desk.q = search.value.trim(); desk.page = 0; load(); }, 150); });
    pos.addEventListener("change", () => { desk.position = pos.value; desk.page = 0; load(); });
    grp.addEventListener("change", () => { desk.group = grp.value; desk.page = 0; load(); });
    paint();
    if (desk.board !== "all") load();
    return el("section", { class: "go-card sc-panel sc-block sc-queue-panel", "aria-label": "Scouting queue" }, [
      el("div", { class: "sc-panel-head sc-queue-head" }, [el("div", { class: "go-kicker", text: "Scouting Queue" }),
        el("span", { class: "muted small sc-queue-note", text: "Your board first, then the class by your need and his rank." })]),
      el("div", { class: "go-filterbar sc-toolbar" }, [chips, el("div", { class: "go-tools sc-tools" }, [search, pos, grp])]),
      wrap, empty,
      el("div", { class: "sc-foot" }, [showing, pager])]);
  }
  function drawRow(s, r, st, ctx) {
    const node = el("tr", { class: "sc-row", "data-pid": r.pid });
    node.__row = r;
    const send = el("button", { type: "button", class: "go-btn sc-send", text: `Send (${SCOUT_HOURS}h)` });
    ui().on(send, "click", async () => {
      const row = node.__row;
      let res;
      try { res = await ui().busy(send, api(s, "recruit", { pid: row.pid, action: "scout" })); }
      catch (err) { ui().toast(`Could not send a scout: ${H.errText(err)}`, { ms: 4000, kind: "error" }); return; }
      row.trips = (row.trips || 0) + 1;
      row.looks = Math.min(REPORT_LOOKS, (row.looks || 0) + SEND_LOOK);
      const look = res.look || null;
      if (look && look.after && look.after.potential) row.potential = look.after.potential;
      if (look && "likes" in look) row.likes = look.likes;        // the look that completed his report may have won him a coordinator
      st.left = res.hours_left;
      ctx.hours.textContent = ctx.hoursText();
      ui().pulse(ctx.hours);
      ctx.results.set(row.pid, look);
      ctx.paint();                                    // his row patches (fill), the result row fades in under him
      ui().pulse(node.querySelector(".sc-c-looks"));
      ui().pulse(node.querySelector(".sc-c-pot"));
      ui().toast(`Scouted ${row.name} · ${fmtLooks(row.looks)} of ${REPORT_LOOKS} looks${row.looks >= REPORT_LOOKS ? " · his report is complete" : ""}`, { ms: 3000 });
      ctx.reload(row.pid);                            // the other rows' Send follows can_send, reconciled by pid; the digest patches
    });
    // a click on the row itself (not on a control) opens his profile
    node.addEventListener("click", (e) => {
      if (e.target.closest("button, select, input, a, .sc-result-row")) return;
      openHim(s, node.__row.pid);
    });
    node.append(
      el("td", { class: "sc-c-name" }, [el("div", { class: "sc-who" }, [avatar(r.pid, "sm"), el("div", { class: "sc-id" }, [nameLink(s, r.pid, r.name, "sc-name"),
        el("span", { class: "sc-line-row" }, [el("span", { class: "muted small sc-line" }), el("span", { class: "sc-board-cell" })])])])]),
      el("td", { class: "sc-c-need" }, [el("span", { class: "sc-need-cell" })]),
      el("td", { class: "sc-c-rank" }, [el("span", { class: "sc-rank" })]),
      el("td", { class: "sc-c-pot" }, [el("span", { class: "sc-pot" })]),
      el("td", { class: "sc-c-looks" }, [el("div", { class: "sc-looks", title: `Looks so far of the ${REPORT_LOOKS} a full report takes: a trip adds one, a week in a scout's area half` }, [
        el("span", { class: "sc-trips", role: "img" }, Array.from({ length: REPORT_LOOKS }, () => el("i", { class: "sc-trip" }))), el("span", { class: "muted small sc-looks-text" })])]),
      el("td", { class: "sc-c-act" }, [send, el("span", { class: "go-tag sc-complete", text: "Complete", title: `His report is complete: ${REPORT_LOOKS} of ${REPORT_LOOKS} looks`, hidden: "" })]));
    fill(node, r, st);
    return node;
  }
  // the row's cells from its data: the board mark, the line, the need, the rank, the potential, the looks and the Send button's state
  function fill(node, r, st) {
    const on = !!r.on_board;
    node.classList.toggle("on-board", on);
    const board = node.querySelector(".sc-board-cell");
    if (on && !board.firstChild) board.append(el("span", { class: "go-tag sc-board-mark", title: "On your board" }, [el("span", { "aria-hidden": "true", text: "★ " }), "On Board"]));
    else if (!on && board.firstChild) board.innerHTML = "";
    node.querySelector(".sc-line").textContent = `${r.position} · ${stars(r.stars)} · ${r.state}`;
    const lineRow = node.querySelector(".sc-line-row"), pill = lineRow.querySelector(".sc-likes");
    if (r.likes && !pill) { lineRow.append(likesPill(r.likes)); ui().pulse(lineRow.lastChild); }
    else if (r.likes && pill) { pill.textContent = `${r.likes.who} ♥`; pill.title = r.likes.text; }
    else if (!r.likes && pill) pill.remove();
    const need = node.querySelector(".sc-need-cell");
    const needText = r.need > 0 ? `Need ${r.need}` : "Set", needCls = r.need > 0 ? "go-tag warn" : "go-tag muted";
    if (!need.firstChild) need.append(el("span", { class: needCls, text: needText, title: r.need > 0 ? `${r.group}: ${plural(r.need, "spot")} to fill` : `${r.group}: your class is set there` }));
    else { const t = need.firstChild; if (t.textContent !== needText) { t.textContent = needText; t.className = needCls; } }
    node.querySelector(".sc-rank").textContent = r.national_rank ? `#${r.national_rank}` : "—";
    const looks = Math.min(REPORT_LOOKS, r.looks || 0), left = leftOf(looks), complete = left <= 0;
    [...node.querySelectorAll(".sc-trip")].forEach((t, i) => { t.classList.toggle("on", looks >= i + 1); t.classList.toggle("half", looks < i + 1 && looks > i); });   // filled in halves
    node.querySelector(".sc-trips").setAttribute("aria-label", `${looksText(looks)} of ${REPORT_LOOKS}`);
    node.querySelector(".sc-looks-text").textContent = `${fmtLooks(looks)} of ${REPORT_LOOKS}`;
    const pot = node.querySelector(".sc-pot");
    const potKey = r.potential ? r.potential.join("|") : "";
    if (pot.dataset.v !== potKey) {
      pot.dataset.v = potKey;
      pot.innerHTML = "";
      pot.append(...(r.potential ? gradePlain(r.potential) : [el("span", { class: "muted small", text: "Not Read" })]));
      pot.title = r.potential ? `Potential: ${r.potential[0] === r.potential[1] ? r.potential[0] : `${r.potential[0]} to ${r.potential[1]}`}` : "No look yet";
    }
    const send = node.querySelector(".sc-send"), tag = node.querySelector(".sc-complete");
    send.hidden = complete;                           // a complete report shows the tag where Send was
    tag.hidden = !complete;
    const label = `Send (${SCOUT_HOURS}h)${!complete && left <= SEND_LOOK ? " · Finishes His Report" : ""}`;
    if (send.textContent !== label) send.textContent = label;
    const reason = complete ? `His report is complete: ${REPORT_LOOKS} of ${REPORT_LOOKS} looks` : st.left < SCOUT_HOURS ? "Not enough hours" : r.can_send === false ? (r.why || "Not now") : null;
    send.disabled = !!reason || send.classList.contains("go-busy");
    if (send.classList.contains("go-busy")) send.__busyWant = !!reason;
    send.title = reason || `Spend ${SCOUT_HOURS} hours on one more look at ${r.name}${left <= SEND_LOOK ? ": it finishes his report" : ""}`;
  }
  // the one-line result of the trip's look under his row: each grade that moved, the flags gained, or that nothing changed
  function resultRow(look) {
    const out = el("div", { class: "sc-result" });
    const after = (look && look.after) || {}, before = (look && look.before) || {}, flags = (look && look.flags) || [];
    const groups = ["potential", ...Object.keys(GRADE_NAMES).filter((g) => g !== "potential")].filter((g) => after[g]);
    if (!groups.length && !flags.length) out.append(el("span", { class: "muted small", text: "This look changed nothing: his read holds." }));
    for (const g of groups) out.append(el("span", { class: "sc-change" }, [el("span", { class: "muted small", text: `${GRADE_NAMES[g]}: ` }),
      ...(before[g] ? [...wordRange(before[g]), " → "] : ["first read: "]), ...wordRange(after[g])]));
    if (flags.length) out.append(el("span", { class: "sc-change" }, [el("span", { class: "muted small", text: "flagged " }), el("span", { class: "go-tags sc-flags-gained" }, flags.map(flagBadge))]));
    if (look && look.likes) out.append(el("span", { class: "sc-change" }, [el("span", { class: "muted small", text: "and " }), likesTag(look.likes)]));
    return el("tr", { class: "sc-result-row" }, [el("td", { colspan: "6" }, [out])]);
  }

  // a modal the address names (season.js's openToken, on a load or Back/Forward): "scouts", or "reports" with its tab
  async function openToken(s, helpers, kind, arg, opts) {
    H = H || helpers;
    if (kind === "scouts") return openScouts(s, opts);
    if (kind === "reports") return openReports(s, arg || "this_week", opts);
    return false;
  }
  // want(kind): open Manage Scouts or All Reports once the tab next draws (the profile's and the pane's links here)
  const want = (kind) => { wanted = kind; };

  window.CFP.scouting = { render, applyRoute, openToken, want };
})();
