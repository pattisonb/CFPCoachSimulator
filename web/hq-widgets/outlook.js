/* Headquarters round 2 (spec "Round 2"): the widgets that were Coming Soon. Read-only views over the board, the
   depth chart, the season and the outlook (GET /headquarters want=contacts,outlook), plus the player's own tasks
   and goals (want=tasks,goals; saved with POST /headquarters/plan). Nothing here changes how games or recruiting
   play. Moods and chances are words; every empty case is a sentence. */
(function () {
  "use strict";
  const HQ = window.HQ, k = HQ.kit, el = k.el;
  const on = (n, t, f) => window.CFP.ui.on(n, t, f);
  const rec = () => window.CFP.recruiting || {};
  const me = (ctx) => (ctx.sample ? "you" : ctx.season && ctx.season.team);
  const pos = (b) => b.display_pos || b.position || "";
  const STALE_WEEKS = 3;                     // *tune* weeks without contact before an offered target goes stale (headquarters.STALE_WEEKS)
  const LATE_WEEK = 8;                       // *tune* from this week, many unused offers is worth a word
  const UNUSED_OFFERS = 10;                  // *tune* ... this many unused
  const SIGNING = { 16: "Early Signing Period", 20: "National Signing Day" };
  const reg = (w) => HQ.register(Object.assign({ status: "ready" }, w));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;
  const sid = (ctx) => encodeURIComponent(ctx.season.id);
  async function savePlan(ctx, body) {
    try { await ctx.api(`/api/season/${sid(ctx)}/headquarters/plan`, ctx.postJSON(body)); }
    catch (e) { window.CFP.ui.toast("Couldn't save that. Try again.", { kind: "error" }); return false; }
    await ctx.refresh(["hq"]);
    return true;
  }

  // ----- sample data -----------------------------------------------------------------------------------------
  const S = (id, name, position, stars, extra) => Object.assign({ id, name, position, display_pos: position, stars, looks: 1 }, extra);
  const SAMPLE_BOARD = {
    week: 6, committed: 9, open_spots: 14, offers: 21, offers_left: 14,
    targets: [S("s1", "Marcus Williams", "CB", 5, { offered: true }), S("s2", "Caleb Mitchell", "OT", 4, { offered: true, looks: 0 })],
    needs_detail: { QB: { need: 1, commits: 0, board: 0 }, WR: { need: 3, commits: 1, board: 5 } },
    board: [S("s1", "Marcus Williams", "CB", 5, { offered: true, visit: { week: 8, done: false } }), S("s2", "Caleb Mitchell", "OT", 4, { offered: true, looks: 0 }),
      S("s3", "David Johnson", "WR", 4, { offered: true, visit: { week: 5, done: true }, committed: "you" }), S("s4", "James Taylor", "DL", 4, { offered: true, committed: "georgia", hard: true }),
      S("s5", "Tyler White", "LB", 3, { offered: false, looks: 0 })],
  };
  const SAMPLE_CONTACTS = { s1: 6, s3: 5, s4: 1 };
  const SAMPLE_OUTLOOK = {
    players: [{ name: "Marcus Lane", position: "CB", class: "SR", overall: 88, starter: true, leaving: "graduation", draft: null, transfer: null, replacement: { pid: "s1", name: "Marcus Williams", status: "Offered" } },
      { name: "Caleb Ford", position: "OT", class: "JR", overall: 91, starter: true, leaving: null, draft: "Likely", transfer: "Low", replacement: { pid: "s2", name: "Caleb Mitchell", status: "Committed" } },
      { name: "Drew Hill", position: "WR", class: "SO", overall: 74, starter: false, leaving: null, draft: null, transfer: "High" }],
    counts: { graduation: 17, draft: 2, draft_likely: 1, transfer_high: 9, transfer_some: 12, roster: 85 },
  };

  // ----- the alerts (shared by Alerts and Needs Attention, and Recruiting Tasks' suggestions) ------------------
  // the pitch to lead with when he cooled: the strongest of his known priorities (the board row's strength words)
  const bestPitch = (b) => {
    const known = (b.priorities_known || []).filter((t) => b.strength && b.strength[t] != null);
    known.sort((x, y) => b.strength[y] - b.strength[x]);
    return known.length ? (window.CFP.recruiting && window.CFP.recruiting.pitchName ? window.CFP.recruiting.pitchName(known[0]) : known[0]) : null;
  };
  function alertsOf(board, contacts, ctx) {
    const out = [], week = board.week || 0, mine = me(ctx);
    // first what you owe: a money promise has a deadline
    for (const b of board.board || []) {
      const mo = b.money_owed;
      if (mo) out.push({ kind: "Promise", pid: b.id, name: b.name, text: `You talked money with ${b.name}: put ${mo.nil} NIL on your offer by Week ${mo.by_week}.`,
        task: `Put ${mo.nil} NIL on ${b.name}'s offer by Week ${mo.by_week}.` });
    }
    // then who cooled on you, with what to do about it
    for (const b of board.board || []) {
      if (!b.cooled || b.signed || (b.committed && b.committed !== mine)) continue;
      const pitch = bestPitch(b);
      const task = b.cooled_why === "lowball" ? `Raise your offer to ${b.name} to what he wants.`
        : b.cooled_why === "promise" ? `Give ${b.name} a week: he doubts a promise you made.`
        : pitch ? `Call ${b.name} and lead with ${pitch}.` : `Call ${b.name}.`;
      out.push({ kind: "Cooled", pid: b.id, name: b.name, text: `${b.name} has cooled on you.`, task });
    }
    for (const b of board.board || []) {
      if (b.pestering) out.push({ kind: "Contact", pid: b.id, name: b.name, text: `${b.name} is tuning you out.`, task: `Leave ${b.name} alone this week.` });
    }
    for (const b of board.board || []) {
      const school = b.signed || b.committed;
      if (b.offered && school && school !== mine && (b.signed || b.hard))
        out.push({ kind: "Offer", pid: b.id, name: b.name, text: `${b.name} is locked in elsewhere, and your offer still holds a slot.`, task: `Pull the offer to ${b.name}.` });
      else if (b.offered && !school) {
        const last = contacts[b.id];
        const gap = last == null ? null : week - last;
        if (last == null || gap >= STALE_WEEKS)
          out.push({ kind: "Contact", pid: b.id, name: b.name, text: last == null ? `${b.name} hasn't heard from you since your offer.` : `${b.name} hasn't heard from you in ${plural(gap, "week")}.`, task: `Call ${b.name}.` });
      }
    }
    for (const b of (board.targets || []).slice(0, 5))
      if (!b.looks) out.push({ kind: "Scout", pid: b.id, name: b.name, text: `${b.name} is a top target with no scouting report.`, task: `Send a scout to ${b.name}.` });
    for (const [g, n] of Object.entries(board.needs_detail || {}))
      if (n.need > 0 && !n.board) out.push({ kind: "Need", text: `You need ${n.need} more at ${g}, and nobody at ${g} is on your board.`, task: `Find ${g} prospects for the board.` });
    if (week >= LATE_WEEK && board.offers_left >= UNUSED_OFFERS)
      out.push({ kind: "Offer", text: `You have ${board.offers_left} offers unused with the season half gone.`, task: "Use more of your offers." });
    return out;
  }

  // ----- Alerts and Needs Attention ---------------------------------------------------------------------------
  reg({ id: "alerts", title: "Alerts and Needs Attention", category: "recruiting", blurb: "Targets going quiet, top targets unscouted, needs with nobody on your board.",
    sizes: ["M", "L"], size: "M", sources: ["board", "hq"], want: ["contacts"], viewAll: "recruiting",
    sample: { board: SAMPLE_BOARD, hq: { contacts: SAMPLE_CONTACTS } },
    draw: (d, ctx) => {
      const rows = alertsOf(d.board, d.hq.contacts || {}, ctx).slice(0, k.rowsFor(ctx.size));
      if (!rows.length) return k.empty("Nothing needs you right now.");
      // his name is the link (a label); what is wrong reads after it as a sentence
      const rest = (a) => (a.name && a.text.startsWith(a.name) ? a.text.slice(a.name.length).trim() : a.text);
      return k.list(rows.map((a, i) => ({ key: `${a.kind}-${a.pid || i}`, cells: [el("span", { class: "go-tag", text: a.kind }),
        ...(a.pid ? [(() => { const n = k.name(ctx, a.pid, a.name); n.classList.remove("hq-grow"); return n; })(), el("span", { class: "hq-sub hq-grow", text: rest(a) })] : [el("span", { class: "hq-grow", text: a.text })])] })));
    } });

  // ----- Board Health -----------------------------------------------------------------------------------------
  function health(board, contacts, ctx) {
    const week = board.week || 0, mine = me(ctx);
    const out = { active: 0, stale: 0, risk: 0, unscouted: 0 };
    const live = (board.board || []).filter((b) => !(b.signed || b.committed) || (b.signed || b.committed) === mine);
    for (const b of live) {
      if ((b.signed || b.committed) === mine) { out.active++; continue; }
      const last = contacts[b.id];
      const sd = rec().standingOf && !ctx.sample ? rec().standingOf(b, mine) : { word: b.sample_word || "In It" };
      if (!b.looks) out.unscouted++;
      else if (sd.word === "Long Shot") out.risk++;
      else if (last == null || week - last >= STALE_WEEKS) out.stale++;
      else out.active++;
    }
    return { ...out, total: live.length };
  }
  reg({ id: "board-health", title: "Board Health", category: "scouting", blurb: "Your board's recruits: active, going stale, at risk or unscouted.",
    sizes: ["S", "M"], size: "S", sources: ["board", "hq"], want: ["contacts"], viewAll: "recruiting",
    sample: { board: SAMPLE_BOARD, hq: { contacts: SAMPLE_CONTACTS } },
    draw: (d, ctx) => {
      const h = health(d.board, d.hq.contacts || {}, ctx);
      if (!h.total) return k.empty("Your board is empty. Add recruits to see its health.");
      const m = (label, n, tone) => k.meter(label, `${n} of ${h.total}`, n / h.total, tone);
      return el("div", {}, [m("Active", h.active, "good"), m("Going Stale", h.stale, "warn"), m("At Risk", h.risk, "bad"), m("Unscouted", h.unscouted)]);
    } });

  // ----- Offer Efficiency ---------------------------------------------------------------------------------------
  const rateWord = (n, of) => (!of ? "None Yet" : n / of >= 0.5 ? "Strong" : n / of >= 0.25 ? "Fair" : "Low");
  reg({ id: "offer-efficiency", title: "Offer Efficiency", category: "recruiting", blurb: "Offers to visits to commits: where your pipeline leaks.",
    sizes: ["S", "M"], size: "S", sources: ["board"], sample: { board: SAMPLE_BOARD }, viewAll: "recruiting",
    draw: (d, ctx) => {
      const mine = me(ctx), offered = (d.board.board || []).filter((b) => b.offered || (b.signed || b.committed) === mine);
      if (!offered.length) return k.empty("No offers out yet.");
      const visited = offered.filter((b) => b.visit && b.visit.done).length, committed = offered.filter((b) => (b.signed || b.committed) === mine).length;
      return el("div", {}, [k.stats([[offered.length, "Offered"], [visited, "Visited"], [committed, "Committed"]]),
        k.meter("Visit Rate", rateWord(visited, offered.length), visited / offered.length),
        k.meter("Commit Rate", rateWord(committed, offered.length), committed / offered.length, "good")]);
    } });

  // ----- Position Battle Board ----------------------------------------------------------------------------------
  const battleWord = (a, b) => (!b ? "No Backup" : a - b >= 5 ? "Secure" : a - b >= 2 ? "Close" : "Open");
  const SAMPLE_DEPTH = { units: [{ name: "Offense", rows: [
    { role: "QB", label: "Quarterback", players: [{ name: "J. Sanders", overall: 88 }, { name: "D. Williams", overall: 80 }] },
    { role: "RB", label: "Running Back", players: [{ name: "C. Cooper", overall: 82 }, { name: "M. Harris", overall: 80 }] },
    { role: "WR", label: "Receiver", players: [{ name: "D. Thomas", overall: 85 }, { name: "R. Davis", overall: 85 }] }] }] };
  reg({ id: "position-battles", title: "Position Battle Board", category: "program", blurb: "The starter and his top challenger at each position.",
    sizes: ["M", "L"], size: "M", sources: ["depth"], sample: { depth: SAMPLE_DEPTH }, viewAll: "depth",
    draw: (d, ctx) => {
      const rows = [];
      for (const u of d.depth.units || []) for (const r of u.rows || []) {
        const [a, b] = r.players || [];
        if (a) rows.push([r.role || r.label, k.player(ctx, a.name, a.position, a.slug), b ? k.player(ctx, b.name, b.position, b.slug) : "Nobody", battleWord(a.overall, b && b.overall)]);
      }
      if (!rows.length) return k.empty("No depth chart yet.");
      const shown = rows.slice(0, ctx.size === "L" ? rows.length : 8);
      return k.table(["Pos", "Starter", "Challenger", "Status"], shown.map((r) => [r[0], r[1], r[2], el("span", { class: "go-tag", text: r[3] })]));
    } });

  // ----- Scholarship Budget ---------------------------------------------------------------------------------------
  const ROSTER_LIMIT = 85;                   // offseason.ROSTER_LIMIT
  reg({ id: "scholarships", title: "Scholarship Budget", category: "program", blurb: "Your class's scholarships: committed, still open, and the roster limit.",
    sizes: ["S"], size: "S", sources: ["board"], sample: { board: SAMPLE_BOARD }, viewAll: "recruiting",
    draw: (d) => {
      const used = d.board.committed || 0, open = d.board.open_spots || 0, total = used + open;
      return el("div", {}, [k.stats([[used, "Committed"], [open, "Open"]]),
        k.meter("Class Spots Filled", `${used} of ${total}`, total ? used / total : 0, "good"),
        el("p", { class: "hq-empty-line", text: `Rosters hold ${ROSTER_LIMIT}. Open spots are what next year's roster leaves room for.` })]);
    } });

  // ----- Recruiting Calendar --------------------------------------------------------------------------------------
  const SAMPLE_SEASON = { current_week: 5, schedule: [{ week: 6, opponent: "x", opponent_name: "USC", venue: "home", played: false },
    { week: 7, opponent: "y", opponent_name: "Penn State", venue: "away", played: false }, { week: 8, opponent: "z", opponent_name: "Iowa", venue: "home", played: false }] };
  reg({ id: "calendar", title: "Recruiting Calendar", category: "recruiting", blurb: "Your games ahead, official visits and the signing dates, week by week.",
    sizes: ["M", "L"], size: "M", sources: ["board"], sample: { board: SAMPLE_BOARD, season: SAMPLE_SEASON }, viewAll: "recruiting",
    draw: (d, ctx) => {
      const s = ctx.sample ? d.season : ctx.season || {};
      const from = (s.current_week || 0) + 1, items = [];
      for (let w = from; w <= 20; w++) {
        const g = (s.schedule || []).find((x) => x.week === w && x.opponent && !x.played);
        if (g) items.push([w, `${g.venue === "away" ? "at" : "vs"} ${g.opponent_name}`, "Game"]);
        for (const b of d.board.board || []) if (b.visit && !b.visit.done && b.visit.week === w) items.push([w, `${b.name} on an official visit`, "Visit"]);
        if (SIGNING[w]) items.push([w, SIGNING[w], "Signing"]);
      }
      if (!items.length) return k.empty("Nothing left on the calendar this season.");
      return k.list(items.slice(0, k.rowsFor(ctx.size)).map(([w, text, kind], i) => ({ key: `${w}-${i}`, cells: [
        el("span", { class: "go-tag", text: `Wk ${w}` }), el("span", { class: "hq-grow", text }), el("span", { class: "hq-sub", text: kind })] })));
    } });

  // ----- What-If ----------------------------------------------------------------------------------------------------
  reg({ id: "what-if", title: "What-If", category: "recruiting", blurb: "See where your class lands if a recruit commits.",
    sizes: ["M"], size: "M", sources: ["board"], viewAll: "classes",
    sample: { board: SAMPLE_BOARD, whatif: { name: "Marcus Williams", group: "CB", rank_now: 14, rank_if: 9, need_now: 2, need_if: 1 } },
    draw: (d, ctx) => {
      const mine = me(ctx);
      const pool = [...(d.board.targets || []), ...(d.board.board || [])].filter((b, i, all) => all.findIndex((x) => x.id === b.id) === i && !(b.signed || b.committed));
      const result = el("div", { class: "hq-whatif-out" });
      const show = (w) => {
        const now = d.board.committed ? `#${w.rank_now}` : "Unranked";
        result.replaceChildren(el("div", { class: "hq-whatif-result" }, [
          k.stats([[now, "Class Rank Now"], [`#${w.rank_if}`, "If He Commits"]]),
          el("p", { class: "hq-empty-line", text: w.need_now > 0 ? `He fills a need at ${w.group}: ${w.need_now} open now, ${w.need_if} after.` : `Your class has no open need at ${w.group}.` })]));
      };
      if (ctx.sample) { show(d.whatif); return el("div", {}, [result]); }
      if (!pool.length) return k.empty("Add recruits to your board to try a What-If.");
      const pick = el("select", { class: "hq-input", "aria-label": "Pick a Recruit" }, [el("option", { value: "", text: "Pick a Recruit" }),
        ...pool.slice(0, 40).map((b) => el("option", { value: b.id, text: `${b.name} · ${pos(b)}` }))]);
      on(pick, "change", async () => {
        if (!pick.value) { result.replaceChildren(); return; }
        result.replaceChildren(el("p", { class: "muted hq-wait", text: "Working it out…" }));
        try { show((await ctx.api(`/api/season/${sid(ctx)}/headquarters?want=whatif&pid=${encodeURIComponent(pick.value)}`)).whatif); }
        catch (e) { result.replaceChildren(k.empty("That didn't work. Try again.")); }
      });
      void mine;
      return el("div", {}, [pick, result]);
    } });

  const impactFilter = { pos: "", role: "", cls: "", outlook: "", rep: "" };   // Player Impact and Retention's filters (this visit)
  // ----- Player Impact and Retention ------------------------------------------------------------------------------
  reg({ id: "senior-impact", title: "Player Impact and Retention", category: "program", blurb: "Your seniors, draft-eligible starters and transfer risks, how likely each is to leave (in the offseason, what really happened), and the recruit who could take his place.",
    sizes: ["M", "L"], size: "M", sources: ["hq"], want: ["outlook"], sample: { hq: { outlook: SAMPLE_OUTLOOK } }, viewAll: "depth",
    draw: (d, ctx) => {
      // in the offseason a player's real outcome (offseason.player_next) replaces the projection: gone, going or kept
      const me = ctx.season && ctx.season.team;
      const gone = (p) => p.next && p.next.status !== "returning" && !(p.next.status === "transfer_in" && p.next.team === me);
      const ps = ((d.hq.outlook || {}).players || []).filter((p) => gone(p) || (!p.next && (p.leaving || p.draft || (p.starter && p.transfer === "High"))))
        .sort((a, b) => (b.starter - a.starter) || (b.overall - a.overall));
      if (!ps.length) return k.empty("Nobody on your roster looks likely to leave.");
      const outcome = (n) => (n.status === "transfer_in" ? `Transferred: ${n.team_name}` : n.status === "portal" ? "In the Portal" : n.status_name);
      const why = (p) => (gone(p) ? outcome(p.next) : p.leaving ? "Graduating" : p.draft ? `Draft: ${p.draft}` : "Transfer Risk");
      // his replacement: the best recruit at his position who is yours (committed, offered, on your board)
      const rep = (p) => (p.replacement
        ? el("span", { class: "hq-rep" }, [k.name(ctx, p.replacement.pid, p.replacement.name), el("span", { class: "go-tag", text: p.replacement.status })])
        : el("span", { class: "hq-sub", text: "Nobody Yet" }));
      // a filter for each column: position, role, class, outlook and replacement (committed, offered, on board, nobody)
      const role = (p) => (p.starter ? "Starter" : "Reserve");
      const repWord = (p) => (p.replacement ? p.replacement.status : "Nobody Yet");
      const cols = [["pos", "Pos", (p) => p.position], ["role", "Role", role], ["cls", "Class", (p) => p.class], ["outlook", "Outlook", why], ["rep", "Replacement", repWord]];
      const f = impactFilter;
      const box = el("div", { class: "hq-impact-rows" });
      const paint = () => {
        const shown = ps.filter((p) => cols.every(([key, , get]) => !f[key] || get(p) === f[key])).slice(0, k.rowsFor(ctx.size));
        box.replaceChildren(!shown.length ? k.empty("Nobody matches these filters.") : ctx.size === "L"
          ? k.table(["Player", "Pos", "Class", "Role", "Outlook", "Replacement"], shown.map((p) =>
            [k.player(ctx, p.name, p.position, p.slug), p.position, p.class, role(p), el("span", { class: "go-tag", text: why(p) }), rep(p)]))
          : k.table(["Player", "Pos", "Outlook", "Replacement"], shown.map((p) => [k.player(ctx, p.name, p.position, p.slug), p.position, el("span", { class: "go-tag", text: why(p) }), rep(p)])));
      };
      const bar = el("div", { class: "hq-filters" }, cols.map(([key, label, get]) => {
        const vals = [...new Set(ps.map(get))].filter(Boolean).sort();
        if (f[key] && !vals.includes(f[key])) f[key] = "";
        const sel = el("select", { class: "hq-input hq-filter", "aria-label": label },
          [el("option", { value: "", text: `Any ${label}` }), ...vals.map((v) => el("option", { value: v, text: v }))]);
        sel.value = f[key];
        on(sel, "change", (e) => { f[key] = e.currentTarget.value; paint(); });
        return sel;
      }));
      paint();
      return el("div", {}, [bar, box]);
    } });

  // ----- Roster Loss Projections ---------------------------------------------------------------------------------
  const lossWord = (n) => (n >= 30 ? "Heavy" : n >= 18 ? "Normal" : "Light");     // *tune* a year's projected losses as a word
  reg({ id: "roster-loss", title: "Roster Loss Projections", category: "program", blurb: "Graduation, the draft and the transfer portal: who you could lose next year.",
    sizes: ["S", "M"], size: "S", sources: ["hq"], want: ["outlook"], sample: { hq: { outlook: SAMPLE_OUTLOOK } }, viewAll: "depth",
    draw: (d, ctx) => {
      const c = (d.hq.outlook || {}).counts;
      if (!c) return k.empty("No roster to project yet.");
      const total = c.graduation + c.draft_likely + c.transfer_high;
      const kids = [k.stats([[c.graduation, "Graduating"], [c.draft, "May Declare"], [c.transfer_high, "Transfer Risk"]]),
        k.meter("Projected Losses", lossWord(total), Math.min(1, total / 40), total >= 30 ? "bad" : total >= 18 ? "warn" : "good")];
      if (ctx.size === "M") {
        const by = {};
        for (const p of (d.hq.outlook.players || [])) if (p.leaving || p.draft === "Likely" || p.transfer === "High") by[p.position] = (by[p.position] || 0) + 1;
        const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (top.length) kids.push(k.table(["Pos", "Could Leave"], top.map(([p, n]) => [p, String(n)])));
      }
      return el("div", {}, kids);
    } });

  // ----- Recruiting Tasks -------------------------------------------------------------------------------------------
  const nextTaskId = (ts) => { let n = 1; const used = new Set(ts.map((t) => t.id)); while (used.has(`t${n}`)) n++; return `t${n}`; };
  reg({ id: "tasks", title: "Recruiting Tasks", category: "recruiting", blurb: "Your to-do list for the week, with tasks your staff suggests.",
    sizes: ["M", "L"], size: "M", sources: ["hq", "board"], want: ["tasks", "contacts"],
    sample: { board: SAMPLE_BOARD, hq: { contacts: SAMPLE_CONTACTS, tasks: [{ id: "t1", text: "Call Marcus Williams.", done: false }, { id: "t2", text: "Book a visit for David Johnson.", done: true }] } },
    draw: (d, ctx) => {
      const tasks = (d.hq.tasks || []).map((t) => ({ ...t }));
      const save = (next) => savePlan(ctx, { tasks: next });
      const rows = tasks.map((t) => {
        const tick = el("button", { type: "button", class: "go-btn hq-task-done", role: "checkbox", "aria-checked": String(t.done), "aria-label": t.text, text: t.done ? "✓" : "" });
        on(tick, "click", () => save(tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x))));
        const del = el("button", { type: "button", class: "go-btn hq-task-del", "aria-label": `Delete ${t.text}`, title: "Delete", text: "✕" });
        on(del, "click", () => save(tasks.filter((x) => x.id !== t.id)));
        return el("li", { class: `hq-task${t.done ? " done" : ""}`, "data-key": t.id }, [tick, el("span", { class: "hq-grow", text: t.text }), del]);
      });
      const input = el("input", { type: "text", class: "hq-input hq-task-input", placeholder: "Add a Task", "aria-label": "Add a Task", maxlength: "120" });
      const add = el("button", { type: "button", class: "go-btn", text: "Add" });
      const addNow = () => { const text = input.value.trim(); if (!text) return; input.value = ""; save([...tasks, { id: nextTaskId(tasks), text, done: false }]); };
      on(add, "click", addNow);
      on(input, "keydown", (e) => { if (e.key === "Enter") addNow(); });
      const have = new Set(tasks.map((t) => t.text));
      const ideas = alertsOf(d.board, d.hq.contacts || {}, ctx).map((a) => a.task).filter((t) => t && !have.has(t)).slice(0, 3);
      const sugg = ideas.map((text) => {
        const b = el("button", { type: "button", class: "go-btn hq-task-add-suggest", text: "Add" });
        on(b, "click", () => save([...tasks, { id: nextTaskId(tasks), text, done: false }]));
        return el("li", { class: "hq-task-suggest", "data-key": `s-${text}` }, [el("span", { class: "go-tag", text: "Suggested" }), el("span", { class: "hq-grow", text }), b]);
      });
      return el("div", {}, [
        el("div", { class: "hq-search-row" }, [input, add]),
        rows.length ? el("ul", { class: "hq-list hq-tasks" }, rows) : k.empty("No tasks yet. Add one, or take a suggestion."),
        sugg.length ? el("ul", { class: "hq-list hq-suggestions" }, sugg) : null,
      ]);
    } });

  // ----- Recruiting Goals -------------------------------------------------------------------------------------------
  const editingGoals = new Set();            // "<season id>:<goal id>" while its target box is open
  const SAMPLE_GOALS = [{ id: "commits", title: "Sign Your Class", target: 23, now: 9, met: false }, { id: "top100", title: "Land Top 100 Recruits", target: 3, now: 2, met: false },
    { id: "rank", title: "Finish in the Top", target: 25, now: 14, met: true }];
  reg({ id: "goals", title: "Recruiting Goals", category: "recruiting", blurb: "Goals for your class and how close you are to each. Set your own targets.",
    sizes: ["M"], size: "M", sources: ["hq"], want: ["goals"], sample: { hq: { goals: SAMPLE_GOALS } }, viewAll: "classes",
    draw: (d, ctx) => {
      const gs = d.hq.goals || [];
      if (!gs.length) return k.empty("No goals yet.");
      return el("div", {}, gs.map((g) => {
        const isRank = g.id === "rank";
        const label = isRank ? `${g.title} ${g.target}` : g.title;
        const words = isRank ? (g.now == null ? "Unranked" : `#${g.now}`) : `${g.now} of ${g.target}`;
        const frac = isRank ? (g.now == null ? 0 : Math.min(1, g.target / g.now)) : (g.target ? g.now / g.target : 0);
        // the goal being edited lives outside the card, so a redraw while you type keeps the box open
        const key = `${ctx.season && ctx.season.id}:${g.id}`;
        let control;
        if (!ctx.sample && editingGoals.has(key)) {
          control = el("input", { type: "number", class: "hq-input hq-goal-input", min: "1", max: "200", value: String(g.target), "aria-label": `Target for ${label}` });
          const close = () => { editingGoals.delete(key); };
          on(control, "keydown", (e) => {
            if (e.key === "Enter") {
              const n = parseInt(control.value, 10);
              close();
              if (n >= 1 && n <= 200 && n !== g.target) savePlan(ctx, { goals: { [g.id]: n } }); else ctx.refresh(["hq"]);
            }
            if (e.key === "Escape") { close(); ctx.refresh(["hq"]); }
          });
        } else {
          control = el("button", { type: "button", class: "go-link hq-goal-edit", text: "Edit", "aria-label": `Edit ${label}` });
          on(control, "click", async () => {
            editingGoals.add(key);
            await ctx.refresh(["hq"]);
            const box = document.querySelector(`.hq-goal[data-goal="${g.id}"] .hq-goal-input`);
            if (box) { box.focus(); box.select(); }
          });
        }
        const row = el("div", { class: "hq-goal", "data-goal": g.id, "data-key": g.id }, [
          k.meter(label, words, frac, g.met ? "good" : null),
          el("div", { class: "hq-goal-foot" }, [el("span", { class: "go-tag", text: g.met ? "Met" : "On the Way" }), control]),
        ]);
        return row;
      }));
    } });
})();
