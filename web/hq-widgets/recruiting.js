/* Headquarters: the recruiting widgets (spec section 7). Each reads the sources it names, already fetched:
   board (GET /recruiting), classes (GET /classes), prospects (GET /prospects) and hq (GET /headquarters with
   want=commits,movers). Recruit names open his profile; Recruit Search adds to the board and sends a scout.
   Every empty case is a sentence; standings and chances are words. */
(function () {
  "use strict";
  const HQ = window.HQ, k = HQ.kit, el = k.el;
  const on = (n, t, f) => window.CFP.ui.on(n, t, f);     // handlers a patch can hand to the live node
  const rec = () => window.CFP.recruiting || {};
  const teamName = (slug) => ((window.CFP.teamsBySlug || {})[slug] || {}).name || slug;
  const me = (ctx) => ctx.season && ctx.season.team;
  // where you stand with him, as the board says it
  const standingWord = (b, ctx) => {
    if (!b) return "";
    if (rec().standingOf) { const sd = rec().standingOf(b, me(ctx)); return k.title(sd.odds || sd.word || ""); }
    return k.title(b.standing_word || "");
  };
  const pos = (b) => b.display_pos || b.position || "";
  const reg = (w) => HQ.register(Object.assign({ category: "recruiting", status: "ready" }, w));

  // ----- sample data (the drawer's previews) -----------------------------------------------------------
  const P = (id, name, position, stars, extra) => Object.assign({ id, name, position, display_pos: position, stars, national_rank: 10 }, extra);
  const SAMPLE_BOARD = {
    committed: 9, open_spots: 14, class_rank: 6, offers: 21, offers_left: 14, hours: 155, hours_left: 95,
    nil: { budget: 275, left: 120 }, points_left: 140, points_week: 230,
    targets: [P("s1", "Marcus Williams", "CB", 5, { sample_word: "Clear Favorite" }), P("s2", "Caleb Mitchell", "OT", 4, { sample_word: "Close Race" }),
      P("s3", "David Johnson", "WR", 4, { sample_word: "Narrow Favorite" }), P("s4", "James Taylor", "DL", 4, { sample_word: "Behind, In the Picture" }),
      P("s5", "Tyler White", "LB", 3, { sample_word: "Long Shot" })],
    needs_detail: { QB: { need: 1, commits: 1, board: 3 }, WR: { need: 3, commits: 1, board: 5 }, OL: { need: 4, commits: 2, board: 6 },
      DL: { need: 3, commits: 1, board: 4 }, CB: { need: 2, commits: 0, board: 3 }, LB: { need: 1, commits: 1, board: 2 } },
    board: [P("s1", "Marcus Williams", "CB", 5, { visit: { week: 6, done: false, game: { opponent_name: "USC", venue: "home" } } }),
      P("s3", "David Johnson", "WR", 4, { visit: { week: 9, done: false, game: { opponent_name: "Penn State", venue: "home" } } }),
      P("s6", "Terrell Davis", "RB", 5, { committed: "you" }), P("s7", "Lucas Franklin", "CB", 4, { committed: "you" })],
    recap: [{ week: 5, kind: "commit", pid: "s6", name: "Terrell Davis", school: "you" }, { week: 5, kind: "offer", pid: "s2", name: "Caleb Mitchell", school: "georgia" },
      { week: 4, kind: "commit", pid: "s7", name: "Lucas Franklin", school: "you" }],
  };
  const SAMPLE_CLASSES = { schools: [
    { school: "s-a", name: "Georgia", count: 18, stars: { 5: 4, 4: 10, 3: 4, 2: 0 }, top: [{ name: "A. Reed", position: "QB", stars: 5 }] },
    { school: "s-b", name: "Texas", count: 16, stars: { 5: 3, 4: 9, 3: 4, 2: 0 }, top: [{ name: "B. Cole", position: "EDGE", stars: 5 }] },
    { school: "you", name: "Your School", count: 9, yours: true, stars: { 5: 2, 4: 5, 3: 2, 2: 0 }, top: [{ name: "Terrell Davis", position: "RB", stars: 5 }] },
    { school: "s-c", name: "Alabama", count: 15, stars: { 5: 2, 4: 9, 3: 4, 2: 0 }, top: [] },
    { school: "s-d", name: "Ohio State", count: 14, stars: { 5: 3, 4: 7, 3: 4, 2: 0 }, top: [] }] };
  const sampleMe = (ctx) => (ctx.sample ? "you" : me(ctx));

  // ----- Class at a Glance ----------------------------------------------------------------------------------
  reg({ id: "class-glance", title: "Class at a Glance", blurb: "Your commits, open spots, class rank and offers out.",
    sizes: ["S", "M"], size: "S", sources: ["board"], sample: { board: SAMPLE_BOARD }, viewAll: "recruiting",
    draw: (d) => {
      const b = d.board;
      return k.stats([[b.committed, "Commits"], [b.open_spots, "Open Spots"], [b.committed ? `#${b.class_rank}` : "Unranked", "Class Rank"],
        [`${b.offers} of ${b.offers + b.offers_left}`, "Offers Out"]]);
    } });

  // ----- Week's Resources ----------------------------------------------------------------------------------
  reg({ id: "resources", title: "Week's Resources", blurb: "Recruiting hours, NIL and scouting points left this week.",
    sizes: ["S"], size: "S", sources: ["board"], sample: { board: SAMPLE_BOARD }, viewAll: "recruiting",
    draw: (d) => {
      const b = d.board, nil = b.nil || {};
      const frac = (a, t) => (t ? a / t : 0);
      return el("div", {}, [
        k.meter("Hours", `${b.hours_left} of ${b.hours} Left`, frac(b.hours_left, b.hours)),
        k.meter("NIL", `${nil.left || 0} of ${nil.budget || 0} Left`, frac(nil.left || 0, nil.budget || 0)),
        k.meter("Scouting Points", `${b.points_left} of ${b.points_week} Left`, frac(b.points_left, b.points_week)),
      ]);
    } });

  // ----- Top Targets ---------------------------------------------------------------------------------------
  reg({ id: "top-targets", title: "Top Targets", blurb: "Your board's best chances, with where you stand with each.",
    sizes: ["M", "L"], size: "M", sources: ["board"], sample: { board: SAMPLE_BOARD }, viewAll: "recruiting",
    draw: (d, ctx) => {
      const rows = (d.board.targets || []).slice(0, k.rowsFor(ctx.size));
      if (!rows.length) return k.empty("No targets yet. Add recruits to your board and offer them to see your chances here.");
      return k.list(rows.map((b) => [k.name(ctx, b.id, b.name), el("span", { class: "hq-sub", text: pos(b) }), k.stars(b.stars),
        el("span", { class: "go-tag", text: b.sample_word || standingWord(b, ctx) })]));
    } });

  // ----- Class Needs ---------------------------------------------------------------------------------------
  reg({ id: "class-needs", title: "Class Needs", blurb: "What your class still needs by position, against commits and your board.",
    sizes: ["S", "M"], size: "S", sources: ["board"], sample: { board: SAMPLE_BOARD }, viewAll: "recruiting",
    draw: (d, ctx) => {
      const rows = Object.entries(d.board.needs_detail || {}).filter(([, n]) => n.need > 0 || n.commits > 0)
        .sort((a, b) => b[1].need - a[1].need).slice(0, ctx.size === "S" ? 6 : 12);
      if (!rows.length) return k.empty("Your class has no open needs.");
      return ctx.size === "S"
        ? k.table(["Pos", "Need", "Commits"], rows.map(([g, n]) => [g, String(n.need), String(n.commits)]))
        : k.table(["Pos", "Need", "Commits", "On Board"], rows.map(([g, n]) => [g, String(n.need), String(n.commits), String(n.board)]));
    } });

  // ----- Visit Schedule ------------------------------------------------------------------------------------
  reg({ id: "visit-schedule", title: "Visit Schedule", blurb: "Official visits booked with you, week by week.",
    sizes: ["S", "M"], size: "S", sources: ["board"], sample: { board: SAMPLE_BOARD }, viewAll: "recruiting",
    draw: (d, ctx) => {
      const rows = (d.board.board || []).filter((b) => b.visit && !b.visit.done).sort((a, b) => a.visit.week - b.visit.week).slice(0, k.rowsFor(ctx.size));
      if (!rows.length) return k.empty("No official visits booked yet.");
      return k.list(rows.map((b) => {
        const g = b.visit.game;
        const vs = g && g.opponent_name ? ` · ${g.venue === "away" ? "at" : "vs"} ${g.opponent_name}` : "";
        return [el("span", { class: "go-tag", text: `Wk ${b.visit.week}` }), k.name(ctx, b.id, b.name), el("span", { class: "hq-sub", text: `${pos(b)}${ctx.size === "M" ? vs : ""}` })];
      }));
    } });

  // ----- Recent Commits ------------------------------------------------------------------------------------
  reg({ id: "recent-commits", title: "Recent Commits", blurb: "The recruits who committed to you most recently.",
    sizes: ["S", "M"], size: "S", sources: ["board"], sample: { board: SAMPLE_BOARD }, viewAll: "classes",
    draw: (d, ctx) => {
      const mine = sampleMe(ctx), byId = new Map((d.board.board || []).map((b) => [b.id, b]));
      const seen = new Set(), rows = [];
      for (const e of [...(d.board.recap || [])].reverse()) {
        if ((e.kind === "commit" || e.kind === "flip") && e.school === mine && !seen.has(e.pid)) { seen.add(e.pid); rows.push({ pid: e.pid, name: e.name, week: e.portal_week ?? e.week, b: byId.get(e.pid) }); }
      }
      for (const b of d.board.board || []) if (b.committed === mine && !seen.has(b.id)) { seen.add(b.id); rows.push({ pid: b.id, name: b.name, b }); }
      if (!rows.length) return k.empty("No commits yet this cycle.");
      return k.list(rows.slice(0, k.rowsFor(ctx.size)).map((r) => [k.name(ctx, r.pid, r.name),
        r.b ? el("span", { class: "hq-sub", text: pos(r.b) }) : null, r.b ? k.stars(r.b.stars) : null,
        r.week != null ? el("span", { class: "hq-sub", text: `Week ${r.week}` }) : null]));
    } });

  // ----- Recruiting Activity -------------------------------------------------------------------------------
  reg({ id: "activity", title: "Recruiting Activity", blurb: "This week's news on your recruits: offers, commits, flips and more.",
    sizes: ["M"], size: "M", sources: ["board"], sample: { board: SAMPLE_BOARD }, viewAll: "recruiting",
    draw: (d, ctx) => {
      const mine = sampleMe(ctx);
      const evs = [...(d.board.recap || [])].reverse().slice(0, k.rowsFor(ctx.size));
      if (!evs.length) return k.empty("Nothing new yet. News on your recruits lands here as the weeks play.");
      const line = (e) => {
        if (ctx.sample) return e.kind === "commit" ? "Committed to you" : `Offered by ${teamName(e.school) === e.school ? "Georgia" : teamName(e.school)}`;
        const t = (rec().historyLines ? rec().historyLines([e], mine)[0] : "") || "";
        return t.replace(/^Week \d+ · /, "");
      };
      return k.list(evs.map((e) => [k.name(ctx, e.pid, e.name), el("span", { class: "hq-grow", text: line(e) }),
        el("span", { class: "hq-sub", text: `Week ${e.portal_week ?? e.week}` })]));
    } });

  // ----- Commitment Tracker --------------------------------------------------------------------------------
  reg({ id: "commit-tracker", title: "Commitment Tracker", blurb: "Your commits week by week, with this week's change.",
    sizes: ["M"], size: "M", sources: ["hq"], want: ["commits"], viewAll: "recruiting",
    sample: { hq: { commits: [1, 2, 3, 4, 5, 6].map((w, i) => ({ week: w, gained: i ? 1 + (i % 2) : 2, lost: 0, total: [2, 3, 5, 6, 8, 9][i] })) } },
    draw: (d) => {
      const rows = d.hq.commits || [];
      if (!rows.length) return k.empty("No weeks played yet.");
      const last = rows[rows.length - 1], net = last.gained - last.lost;
      return el("div", {}, [
        k.stats([[last.total, "Total Commits"], [net > 0 ? `+${net}` : String(net), "This Week"]]),
        k.chart(rows.map((r) => [`Wk ${r.week}`, r.total])),
      ]);
    } });

  // ----- Hot and Cold Movers -------------------------------------------------------------------------------
  reg({ id: "movers", title: "Hot and Cold Movers", blurb: "Recruits whose list moved toward you, or away, this week.",
    sizes: ["M"], size: "M", sources: ["hq", "board"], want: ["movers"], viewAll: "recruiting",
    sample: { board: SAMPLE_BOARD, hq: { movers: { up: [{ pid: "s1", name: "Marcus Williams", position: "CB", stars: 5, word: "Clear Favorite" }, { pid: "s3", name: "David Johnson", position: "WR", stars: 4, word: "Narrow Favorite" }],
      down: [{ pid: "s4", name: "James Taylor", position: "DL", stars: 4, word: "Long Shot" }] } } },
    draw: (d, ctx) => {
      const m = d.hq.movers || { up: [], down: [] };
      const byId = new Map((d.board.board || []).map((b) => [b.id, b]));
      const col = (title, rows, up) => el("div", {}, [el("h4", { text: title }),
        rows.length ? k.list(rows.map((r) => [el("span", { class: up ? "hq-up" : "hq-down", "aria-hidden": "true", text: up ? "▲" : "▼" }), k.name(ctx, r.pid, r.name),
          el("span", { class: "go-tag", text: r.word || standingWord(byId.get(r.pid), ctx) || r.position })]))
          : k.empty(up ? "Nobody moved toward you this week." : "Nobody moved away this week.")]);
      return el("div", { class: "hq-split" }, [col("Rising", m.up || [], true), col("Falling", m.down || [], false)]);
    } });

  // ----- Class Breakdown -----------------------------------------------------------------------------------
  reg({ id: "class-breakdown", title: "Class Breakdown", blurb: "Your commits by star rating.",
    sizes: ["S", "M"], size: "S", sources: ["classes"], sample: { classes: SAMPLE_CLASSES }, viewAll: "classes",
    draw: (d, ctx) => {
      const mine = (d.classes.schools || []).find((r) => r.yours || r.school === me(ctx));
      const stars = (mine && mine.stars) || {};
      const counts = [5, 4, 3, 2].map((n) => [n, Number(stars[n] || stars[String(n)] || 0)]).filter(([, c]) => c > 0);
      const total = counts.reduce((a, [, c]) => a + c, 0);
      if (!total) return k.empty("No commits yet this cycle.");
      const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "0 0 42 42");
      svg.setAttribute("role", "img");
      const tones = { 5: "var(--go-primary, var(--accent))", 4: "var(--good)", 3: "var(--muted)", 2: "var(--border)" };
      let at = 25;
      for (const [n, c] of counts) {
        const seg = (100 * c) / total, circ = document.createElementNS(ns, "circle");
        for (const [a, v] of Object.entries({ cx: 21, cy: 21, r: 15.915, fill: "none", stroke: tones[n], "stroke-width": 6, "stroke-dasharray": `${seg} ${100 - seg}`, "stroke-dashoffset": at })) circ.setAttribute(a, v);
        svg.appendChild(circ);
        at -= seg;
      }
      return el("div", { class: "hq-donut" }, [svg, k.list(counts.map(([n, c]) => [el("span", { class: "hq-grow", text: `${n}-Star` }), el("b", { text: String(c) })]))]);
    } });

  // ----- Recruiting Rankings -------------------------------------------------------------------------------
  reg({ id: "rankings", title: "Recruiting Rankings", blurb: "The nation's top classes, and where yours stands.",
    sizes: ["M"], size: "M", sources: ["classes"], sample: { classes: SAMPLE_CLASSES }, viewAll: "classes",
    draw: (d, ctx) => {
      const all = d.classes.schools || [];
      const isMine = (r) => r.yours || r.school === me(ctx);
      const top = all.slice(0, 5).map((r, i) => [r.rank || i + 1, r]);
      const at = all.findIndex(isMine);
      if (at >= 5) top.push([all[at].rank || at + 1, all[at]]);
      if (!top.length) return k.empty("No school has a commit yet.");
      return k.table(["#", "School", "Commits", "5-Star"], top.map(([n, r]) => [String(n), r.name, String(r.count), String((r.stars || {})[5] || 0)]),
        (i) => isMine(top[i][1]));
    } });

  // ----- Recruit Search ------------------------------------------------------------------------------------
  const SAMPLE_PROSPECTS = { rows: [P("s8", "Derrick Clark", "LB", 4, { on_board: false }), P("s9", "Ethan Harris", "WR", 4, { on_board: true }), P("s10", "Ryan Edwards", "OT", 3, { on_board: false })] };
  reg({ id: "recruit-search", title: "Recruit Search", blurb: "Find recruits by name, position or state, and add them to your board.",
    sizes: ["M", "L"], size: "M", sources: ["prospects"], sample: { prospects: SAMPLE_PROSPECTS }, viewAll: "prospects",
    draw: (d, ctx) => {
      const out = el("div", { class: "hq-results" });
      const fill = (rows) => {
        if (!rows.length) { out.replaceChildren(k.empty("No recruits match that search.")); return; }
        out.replaceChildren(k.list(rows.slice(0, k.rowsFor(ctx.size)).map((r) => {
          const add = el("button", { type: "button", class: "go-btn hq-add-board", text: r.on_board ? "On Your Board" : "Add to Board", disabled: r.on_board ? "" : null });
          on(add, "click", async () => { if (await ctx.act("board", { pid: r.id, name: r.name }, add)) { add.textContent = "On Your Board"; add.disabled = true; } });
          const scout = ctx.size === "L" && !r.scouted ? el("button", { type: "button", class: "go-btn hq-send-scout", text: "Send Scout" }) : null;
          if (scout) on(scout, "click", async () => { if (await ctx.act("scout", { pid: r.id, name: r.name }, scout)) { scout.textContent = "Scout Sent"; scout.disabled = true; } });
          return { key: r.id, cells: [k.name(ctx, r.id, r.name), el("span", { class: "hq-sub", text: pos(r) }), k.stars(r.stars), scout, add] };
        })));
      };
      const search = async (params) => {
        if (ctx.sample) return;
        const q = new URLSearchParams(Object.assign({ limit: "30" }, params));
        out.replaceChildren(el("p", { class: "muted hq-wait", text: "Searching…" }));
        try { const r = await ctx.api(`/api/season/${encodeURIComponent(ctx.season.id)}/prospects?${q}`); fill(r.rows || []); }
        catch (e) { out.replaceChildren(k.empty("The search didn't work. Try again.")); }
      };
      const input = el("input", { type: "search", class: "hq-input", placeholder: "Search by Name", "aria-label": "Search Recruits by Name" });
      const go = el("button", { type: "button", class: "go-btn", text: "Search" });
      go.addEventListener("click", () => search({ q: input.value.trim() }));
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") search({ q: input.value.trim() }); });
      const need = Object.entries((d.prospects && d.prospects.needs) || {}).sort((a, b) => b[1] - a[1])[0];
      const quick = [["Top 100", { sort: "rank", limit: "100" }], ["5-Star", { stars: "5" }]];
      if (need && need[1] > 0) quick.push([`Need: ${need[0]}`, { group: need[0] }]);
      const chips = el("div", { class: "hq-quick" }, quick.map(([label, params]) => {
        const b = el("button", { type: "button", class: "go-chip", text: label });
        b.addEventListener("click", () => search(params));
        return b;
      }));
      fill((d.prospects && d.prospects.rows) || []);
      return el("div", {}, [el("div", { class: "hq-search-row" }, [input, go]), chips, out]);
    } });
})();
