/* Headquarters: the planned widgets, shown in the drawer as Coming Soon with sample data. Each needs a system
   the game does not have yet (spec section 8); building one later means naming its sources, drawing from
   them and setting status to "ready". Moods and chances stay words. */
(function () {
  "use strict";
  const HQ = window.HQ, k = HQ.kit, el = k.el;
  const words = (rows) => k.list(rows.map(([a, b]) => [el("span", { class: "hq-grow", text: a }), el("span", { class: "go-tag", text: b })]));
  const soon = (id, title, category, blurb, sample, draw) => HQ.register({ id, title, category, blurb, sizes: ["M"], size: "M", sources: [], sample, status: "soon", draw });

  soon("tasks", "Recruiting Tasks", "recruiting", "A to-do list for the week: your own tasks and ones your staff suggests.",
    { rows: [["Call Marcus Williams", "Today"], ["Send an offer to Caleb Mitchell", "Today"], ["Check on Brandon King", "Next Week"]] },
    (d) => words(d.rows));
  soon("goals", "Recruiting Goals", "recruiting", "Goals for your class and how close you are to each.",
    { rows: [["Sign 25 Commits", "22 of 25", 0.88], ["Land Five Top 100 Recruits", "3 of 5", 0.6], ["Finish in the Top 10", "On Track", 0.7]] },
    (d) => el("div", {}, d.rows.map(([a, b, f]) => k.meter(a, b, f, "good"))));
  soon("alerts", "Alerts and Needs Attention", "recruiting", "Targets going quiet, commits wavering and offers sitting unanswered.",
    { rows: [["A top target has not heard from you in three weeks", "Contact"], ["A commit is hearing out a rival", "Review"], ["Only one quarterback in your pipeline", "View"]] },
    (d) => words(d.rows));
  soon("staff", "Staff Assignments", "scouting", "Which assistant works which targets, and how much ground each covers.",
    { rows: [["Defensive Coordinator", "Secondary"], ["Offensive Coordinator", "Quarterbacks"], ["Line Coach", "Both Lines"]] },
    (d) => words(d.rows));
  soon("scholarships", "Scholarship Budget", "program", "Scholarships used and open for the coming class.",
    { used: 0.72 },
    (d) => k.meter("Scholarships Used", "Most of Them", d.used, "warn"));
  soon("calendar", "Recruiting Calendar", "recruiting", "Visits, contact periods and dead periods by week.",
    { rows: [["Week 6", "Official Visit"], ["Week 7", "Contact Period"], ["Week 9", "Dead Period"]] },
    (d) => words(d.rows));
  soon("what-if", "What-If", "recruiting", "See where your class would land if a recruit commits.",
    { rows: [["If a top WR commits", "Class Climbs"], ["Receiver Need", "Filled"]] },
    (d) => words(d.rows));
  soon("senior-impact", "Senior Impact and Retention", "program", "Your seniors, and how likely each is to leave early.",
    { rows: [["Starting Cornerback", "High Risk"], ["Left Tackle", "Some Risk"], ["Linebacker", "Low Risk"]] },
    (d) => words(d.rows));
  soon("roster-loss", "Roster Loss Projections", "program", "Graduation, transfers, the draft and injuries: who you lose next year.",
    { rows: [["Graduation", "Many"], ["Transfer Risk", "A Few"], ["Draft Early", "A Couple"]] },
    (d) => words(d.rows));
  soon("position-battles", "Position Battle Board", "program", "The starter and his top challenger at each position.",
    { rows: [["Quarterback", "Secure"], ["Running Back", "Close"], ["Receiver", "Open"]] },
    (d) => words(d.rows));
  soon("offer-efficiency", "Offer Efficiency", "recruiting", "Offers to visits to commits: where your pipeline leaks.",
    { rows: [["Offers to Visits", "Strong"], ["Visits to Commits", "Fair"]] },
    (d) => words(d.rows));
  soon("board-health", "Board Health", "scouting", "Your board's prospects by state: active, going stale, at risk or unscouted.",
    { rows: [["Active", "Most"], ["Going Stale", "Some"], ["At Risk", "A Few"], ["Unscouted", "A Few"]] },
    (d) => words(d.rows));
})();
