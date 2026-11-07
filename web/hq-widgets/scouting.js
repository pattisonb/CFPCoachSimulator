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
      { pid: "s5", name: "James Clanton", position: "LB", stars: 4, flag: "likes", likes: "DC", on_board: true }],
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
        const word = f.flag === "likes" ? `${ROLE_SHORT[f.likes] || f.likes || "Staff"} Likes Him` : FLAG_WORDS[f.flag] || k.title(f.flag);
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
})();
