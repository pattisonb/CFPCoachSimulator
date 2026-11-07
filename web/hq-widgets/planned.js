/* Headquarters: the planned widgets, shown in the drawer as Coming Soon with sample data. Staff Assignments
   needs a recruiting mechanic of its own (assigning targets to assistants, and what that earns), designed
   separately; building it means naming its sources, drawing from them and setting status to "ready". */
(function () {
  "use strict";
  const HQ = window.HQ, k = HQ.kit, el = k.el;
  const words = (rows) => k.list(rows.map(([a, b]) => [el("span", { class: "hq-grow", text: a }), el("span", { class: "go-tag", text: b })]));
  HQ.register({ id: "staff", title: "Staff Assignments", category: "scouting", status: "soon", sizes: ["M"], size: "M", sources: [],
    blurb: "Which assistant works which targets, and how much ground each covers.",
    sample: { rows: [["Defensive Coordinator", "Secondary"], ["Offensive Coordinator", "Quarterbacks"], ["Line Coach", "Both Lines"]] },
    draw: (d) => words(d.rows) });
})();
