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
})();
