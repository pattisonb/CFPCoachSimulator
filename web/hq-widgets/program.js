/* Headquarters: the program widgets (spec section 7). Program Comparison reads GET /programs: your program
   against the top programs by rating, each grade as its word (programs.WORD_FLOORS), never the number. */
(function () {
  "use strict";
  const HQ = window.HQ, k = HQ.kit;
  const word = (v, floors) => { for (const [w, f] of floors) if (v >= f) return w; return floors.length ? floors[floors.length - 1][0] : ""; };
  const SAMPLE = {
    you: { team: "you", name: "Your School", tier_name: "Power", prestige: 74, winning: 68, nil: 71, pro: 66 },
    rows: [{ team: "a", name: "Georgia", tier_name: "Blue Blood", prestige: 95, winning: 93, nil: 92, pro: 96 },
      { team: "b", name: "Texas", tier_name: "Blue Blood", prestige: 94, winning: 88, nil: 95, pro: 90 },
      { team: "you", name: "Your School", tier_name: "Power", prestige: 74, winning: 68, nil: 71, pro: 66 },
      { team: "c", name: "Alabama", tier_name: "Blue Blood", prestige: 97, winning: 86, nil: 90, pro: 97 }],
    words: [["Elite", 90], ["Excellent", 80], ["Strong", 70], ["Good", 60], ["Solid", 50], ["Fair", 40], ["Thin", 30], ["Weak", 0]],
  };
  HQ.register({ id: "program-compare", title: "Program Comparison", category: "program", status: "ready",
    blurb: "Your program against the nation's best: prestige, winning, NIL and the Pro Pipeline.",
    sizes: ["M", "L"], size: "M", sources: ["programs"], sample: { programs: SAMPLE }, viewAll: "programs",
    draw: (d, ctx) => {
      const pv = d.programs, floors = pv.words || [];
      const mine = (pv.you && pv.you.team) || (ctx.season && ctx.season.team);
      const others = (pv.rows || []).filter((r) => r.team !== mine).slice(0, ctx.size === "L" ? 7 : 4);
      const rows = pv.you ? [pv.you, ...others] : others;
      if (!rows.length) return k.empty("No programs to compare yet.");
      const heads = ctx.size === "L" ? ["Program", "Tier", "Prestige", "Winning", "NIL", "Pro Pipeline"] : ["Program", "Prestige", "Winning", "NIL"];
      return k.table(heads, rows.map((r) => ctx.size === "L"
        ? [r.name, r.tier_name, word(r.prestige, floors), word(r.winning, floors), word(r.nil, floors), word(r.pro, floors)]
        : [r.name, word(r.prestige, floors), word(r.winning, floors), word(r.nil, floors)]), (i) => rows[i].team === mine);
    } });

  // ----- Next Year's Depth Chart: next year's roster by group, a class up, with your commits as they come in ---------
  const el = k.el;
  const SAMPLE_NEXT = { groups: [
    { group: "QB", target: 4, filled: 3, need: 1, players: [{ name: "J. Sanders", position: "QB", class_next: "SR", overall: 88, starter: true },
      { name: "D. Williams", position: "QB", class_next: "SO", overall: 74 }], commits: [{ pid: "s1", name: "Marcus Williams", stars: 5, position: "QB" }] },
    { group: "WR", target: 11, filled: 9, need: 2, players: [{ name: "D. Thomas", position: "WR", class_next: "JR", overall: 85, draft: "Possible" },
      { name: "R. Davis", position: "WR", class_next: "SO", overall: 79 }], commits: [] }] };
  HQ.register({ id: "next-depth", title: "Next Year's Depth Chart", category: "program", status: "ready",
    blurb: "Next year's roster by position: who returns a class up, your commits as they come in, and what each group still needs.",
    sizes: ["M", "L"], size: "L", sources: ["hq"], want: ["next_year"], sample: { hq: { next_year: SAMPLE_NEXT } }, viewAll: "depth",
    draw: (d, ctx) => {
      const groups = (d.hq.next_year || {}).groups || [];
      if (!groups.length) return k.empty("No roster to project yet.");
      const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
      return el("div", { class: "hq-groups" }, groups.map((g) => el("section", { class: "hq-group", "data-key": g.group }, [
        el("div", { class: "hq-group-head" }, [el("b", { text: g.group }),
          el("span", { class: "hq-sub hq-grow", text: `${g.players.length} Returning${g.commits.length ? ` · ${plural(g.commits.length, "Commit")}` : ""}` }),
          el("span", { class: `go-tag${g.need > 0 ? "" : " hq-full"}`, text: g.need > 0 ? `Need ${g.need}` : "Full" })]),
        k.list([
          ...g.commits.map((c) => ({ key: `c-${c.pid}`, cells: [el("span", { class: "go-tag hq-next-class hq-commit", text: c.signed ? "Signed" : "Commit" }),
            k.name(ctx, c.pid, c.name), el("span", { class: "hq-sub", text: c.position }), k.starsShort(c.stars)] })),
          ...g.players.map((p, i) => ({ key: `p-${g.group}-${i}-${p.name}`, cells: [el("span", { class: "go-tag hq-next-class", text: p.class_next }),
            el("span", { class: "hq-grow", text: p.name }), p.draft ? el("span", { class: "hq-sub", text: `Draft: ${p.draft}` }) : null,
            el("span", { class: "hq-sub", text: String(p.overall) })] })),
        ]),
      ])));
    } });
})();
