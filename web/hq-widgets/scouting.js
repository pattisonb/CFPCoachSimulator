/* Headquarters: the scouting widgets (spec section 7), from GET /scouting: the queue (the Prospect Database's
   first page, your needs and looks), your staff's flags and your area scouts. Send Scout and Add to Board act
   in place. Potential reads as grade words, never a number. */
(function () {
  "use strict";
  const HQ = window.HQ, k = HQ.kit, el = k.el;
  const on = (n, t, f) => window.CFP.ui.on(n, t, f);     // handlers a patch can hand to the live node
  const reg = (w) => HQ.register(Object.assign({ category: "scouting", status: "ready", sources: ["scouting"], viewAll: "scouting" }, w));
  const pos = (r) => r.display_pos || r.position || "";
  const FLAG_WORDS = { generational: "Generational", gem: "Gem", bust: "Bust Risk" };
  const ROLE_SHORT = { "Offensive Coordinator": "OC", "Defensive Coordinator": "DC" };
  const looksText = (n) => `${n || 0} of 3 Looks`;
  const potential = (p) => (!p || !p.length ? null : p[0] === p[p.length - 1] ? p[0] : `${p[0]} to ${p[p.length - 1]}`);
  const addButton = (ctx, r) => {
    const b = el("button", { type: "button", class: "go-btn hq-add-board", text: r.on_board ? "On Board" : "Add", "aria-label": r.on_board ? `${r.name} Is on Your Board` : `Add ${r.name} to Your Board`, disabled: r.on_board ? "" : null });
    on(b, "click", async () => { if (await ctx.act("board", { pid: r.pid, name: r.name }, b)) { b.textContent = "On Board"; b.disabled = true; } });
    return b;
  };

  const SAMPLE = {
    queue: [
      { pid: "s1", name: "Marques Williams", position: "EDGE", stars: 5, looks: 1, can_send: true, on_board: true, potential: ["Strong", "Elite"] },
      { pid: "s2", name: "Aden Neal", position: "OT", stars: 4, looks: 0, can_send: true, on_board: false },
      { pid: "s3", name: "Davis Hammond", position: "QB", stars: 4, looks: 2, can_send: true, on_board: true, potential: ["Solid", "Strong"] }],
    flags: [{ pid: "s4", name: "Robert Soles", position: "LB", stars: 3, flag: "gem", likes: null, on_board: false },
      { pid: "s5", name: "James Clanton", position: "LB", stars: 4, flag: "likes", likes: { who: "DC", name: "Matt Patricia", text: "He would start for us." }, on_board: true }],
    scouts: [{ id: "a1", name: "Mark Johnson", role: "Area Scout", area: "Texas", evaluation_word: "Strong", yield: { looks: 6.5, flags: 1 } },
      { id: "a2", name: "Chris Williams", role: "Area Scout", area: "Florida", evaluation_word: "Solid", yield: { looks: 4, flags: 0 } }],
  };

  // ----- Scouting Queue ------------------------------------------------------------------------------------
  reg({ id: "scout-queue", title: "Scouting Queue", blurb: "The top prospects your staff can still look at, with Send Scout and Add to Board.",
    sizes: ["M", "L"], size: "M", sample: { scouting: SAMPLE },
    draw: (d, ctx) => {
      const rows = (d.scouting.queue || []).filter((r) => r.looks < 3).slice(0, k.rowsFor(ctx.size));
      if (!rows.length) return k.empty("Every prospect in view has a complete report.");
      return k.list(rows.map((r) => {
        const send = r.can_send ? el("button", { type: "button", class: "go-btn hq-send-scout", text: "Scout", "aria-label": `Send a Scout to ${r.name}` }) : null;
        if (send) on(send, "click", () => ctx.act("scout", { pid: r.pid, name: r.name }, send));
        const pot = ctx.size === "L" ? potential(r.potential) : null;
        return { key: r.pid, cells: [k.name(ctx, r.pid, r.name), el("span", { class: "hq-sub", text: pos(r) }), k.stars(r.stars),
          el("span", { class: "hq-sub hq-looks", text: looksText(r.looks) }), pot ? el("span", { class: "go-tag", text: pot }) : null, send, addButton(ctx, r)] };
      }));
    } });

  // ----- Flags ---------------------------------------------------------------------------------------------
  reg({ id: "flags", title: "Flags", blurb: "Your staff's finds: gems, bust risks and the recruits your coaches like.",
    sizes: ["S", "M"], size: "S", sample: { scouting: SAMPLE },
    draw: (d, ctx) => {
      const rows = (d.scouting.flags || []).slice(0, k.rowsFor(ctx.size));
      if (!rows.length) return k.empty("No flags yet. Your staff flags prospects once their reports are complete.");
      return k.list(rows.map((f) => {
        // likes is your coordinator's word on him, {who: "OC" | "DC", name, text}, as the Scouting tab shows it
        const who = f.likes && typeof f.likes === "object" ? f.likes.who : f.likes;
        const word = f.flag === "likes" ? `${ROLE_SHORT[who] || who || "Staff"} Likes Him` : FLAG_WORDS[f.flag] || k.title(f.flag);
        return { key: `${f.pid}-${f.flag}`, cells: [el("span", { class: "go-tag", text: word }), k.name(ctx, f.pid, f.name), el("span", { class: "hq-sub", text: pos(f) }),
          ctx.size === "M" ? addButton(ctx, { pid: f.pid, name: f.name, on_board: !!f.on_board }) : null] };
      }));
    } });

  // ----- Area Scouts ---------------------------------------------------------------------------------------
  reg({ id: "area-scouts", title: "Area Scouts", blurb: "Your scouts, their areas and what each turned up this week.",
    sizes: ["M"], size: "M", sample: { scouting: SAMPLE },
    draw: (d, ctx) => {
      const rows = (d.scouting.scouts || []).slice(0, k.rowsFor(ctx.size));
      if (!rows.length) return k.empty("You have no scouts on staff.");
      return k.table(["Scout", "Area", "Eye", "This Week"], rows.map((s) => {
        const y = s.yield || {};
        const looks = Number(y.looks || 0);
        return [`${s.name}${ROLE_SHORT[s.role] ? ` (${ROLE_SHORT[s.role]})` : ""}`, s.area || "Anywhere", s.evaluation_word || "",
          `${looks === 1 ? "1 Look" : `${looks} Looks`}${y.flags ? ` · ${y.flags} ${y.flags === 1 ? "Flag" : "Flags"}` : ""}`];
      }));
    } });

  // ----- Scouted Players: every prospect your staff has looked at, at a glance; a tile opens his report -----------
  const GRADE_NAMES = [["potential", "Potential"], ["athleticism", "Athleticism"], ["size_strength", "Size & Strength"],
    ["technique", "Technique"], ["football_iq", "Football IQ"], ["coachability", "Coachability"]];
  const viewing = new Map();                     // season id -> the pid whose report is open (kept across redraws)
  const SAMPLE_SCOUTED = { queue: [
    { pid: "s1", name: "Marques Williams", position: "EDGE", stars: 5, looks: 3, potential: ["Elite", "Elite"], on_board: true, flags: ["gem"] },
    { pid: "s2", name: "Aden Neal", position: "OT", stars: 4, looks: 2, potential: ["Solid", "Strong"], on_board: false, flags: [] },
    { pid: "s3", name: "Davis Hammond", position: "QB", stars: 4, looks: 1, potential: ["Fair", "Strong"], on_board: true, flags: [] },
    { pid: "s4", name: "Robert Soles", position: "LB", stars: 3, looks: 3, potential: ["Strong", "Strong"], on_board: false, flags: [] }] };
  reg({ id: "scouted", title: "Scouted Players", blurb: "Every prospect your staff has looked at, at a glance. Open one to step through their reports.",
    sizes: ["S", "M", "L"], size: "M", sources: ["scouted"], sample: { scouted: SAMPLE_SCOUTED },
    draw: (d, ctx) => {
      const rows = (d.scouted.queue || []);
      if (!rows.length) return k.empty("No scouted players yet. Send scouts from the Scouting Queue or the Scouting tab.");
      const root = el("div", { class: "hq-scouted" });
      const key = ctx.season ? ctx.season.id : "sample";
      const tag = (r) => (r.flags && r.flags.length ? FLAG_WORDS[r.flags[0]] || k.title(r.flags[0]) : r.likes ? `${(r.likes && r.likes.who) || "Staff"} Likes Him` : null);
      // the report lies over the card's content, under its header, so the card never changes size (one Scouted
      // Players card a Headquarters; found by its widget id, since a redraw keeps the live card, not this draw's root)
      const cardEl = () => document.querySelector('#tab-headquarters .hq-card[data-widget="scouted"]');
      const closeReport = () => { const c = cardEl(); if (c) for (const o of c.querySelectorAll(".hq-scout-detail")) o.remove(); };
      const grid = () => {
        viewing.delete(key);
        closeReport();
        root.replaceChildren(el("div", { class: "hq-tiles" }, rows.map((r) => {
          const t = el("button", { type: "button", class: "hq-tile", "data-key": r.pid, "aria-label": `Open ${r.name}'s Report` }, [
            el("span", { class: "hq-tile-name", text: r.name }),
            el("span", { class: "hq-tile-line" }, [el("span", { class: "hq-sub", text: pos(r) }), k.stars(r.stars)]),
            el("span", { class: "hq-tile-line" }, [potential(r.potential) ? el("span", { class: "go-tag", text: potential(r.potential) }) : null,
              el("span", { class: "hq-sub", text: looksText(r.looks) })]),
            tag(r) ? el("span", { class: "go-tag hq-tile-flag", text: tag(r) }) : null,
          ]);
          on(t, "click", () => { if (!ctx.sample) detail(rows.indexOf(r)); });
          return t;
        })));
      };
      const detail = (i) => {
        const r = rows[i];
        viewing.set(key, r.pid);
        const prev = el("button", { type: "button", class: "go-btn hq-detail-prev", text: "◀", "aria-label": "Previous Player", disabled: i === 0 ? "" : null });
        const next = el("button", { type: "button", class: "go-btn hq-detail-next", text: "▶", "aria-label": "Next Player", disabled: i === rows.length - 1 ? "" : null });
        const back = el("button", { type: "button", class: "go-btn hq-detail-back", text: "Back to All" });
        on(prev, "click", () => detail(i - 1));
        on(next, "click", () => detail(i + 1));
        on(back, "click", grid);
        const grades = el("div", { class: "hq-grades" }, [el("p", { class: "muted hq-wait", text: "Loading his report…" })]);
        const profile = el("button", { type: "button", class: "go-btn", text: "Open Profile" });
        on(profile, "click", () => ctx.openProfile(r.pid));
        const c = cardEl();
        if (!c) return;
        closeReport();
        const bar = c.querySelector(".hq-bar");
        const layer = el("div", { class: "hq-scout-detail", "data-key": `detail-${r.pid}` }, [
          el("div", { class: "hq-detail-nav" }, [back, el("span", { class: "hq-grow hq-sub", text: `${i + 1} of ${rows.length}` }), prev, next]),
          el("div", { class: "hq-detail-head" }, [el("b", { class: "hq-detail-name", text: r.name }), el("span", { class: "hq-sub", text: pos(r) }), k.stars(r.stars),
            el("span", { class: "hq-sub", text: looksText(r.looks) }), tag(r) ? el("span", { class: "go-tag", text: tag(r) }) : null]),
          grades,
          el("div", { class: "hq-detail-acts" }, [profile, addButton(ctx, r)]),
        ]);
        layer.style.top = `${bar ? bar.offsetTop + bar.offsetHeight : 0}px`;
        c.appendChild(layer);
        ctx.api(`/api/season/${encodeURIComponent(ctx.season.id)}/prospect/${encodeURIComponent(r.pid)}`).then((pr) => {
          if (!grades.isConnected) return;
          const g = pr.our_grades || {};
          const home = pr.hometown ? `${pr.hometown.city}, ${pr.hometown.state}` : null;
          grades.replaceChildren(
            ...(home || pr.archetype ? [el("p", { class: "hq-empty-line", text: [pr.archetype, home].filter(Boolean).join(" · ") })] : []),
            el("div", { class: "hq-grade-grid" }, GRADE_NAMES.map(([id, label]) => el("div", { class: "hq-grade" }, [
              el("span", { class: "hq-sub", text: label }), el("b", { text: potential(g[id]) || "Not Seen Yet" })]))));
        }).catch(() => { if (grades.isConnected) grades.replaceChildren(k.empty("His report didn't load. Open his profile instead.")); });
      };
      const open = viewing.get(key), at = rows.findIndex((r) => r.pid === open);
      grid();
      if (at >= 0 && !ctx.sample) { viewing.set(key, open); requestAnimationFrame(() => detail(at)); }   // a redraw keeps an open report
      return root;
    } });
})();
