/* The Season Recap (the Summary tab): the season at a glance once it is over, and the season so far while it
   runs. The header carries the record, the Season Grade (sim/grade.py: a letter and a one-sentence verdict,
   only once the season is done) and the actions; the left column the national champion and the playoff
   bracket, the Heisman, your team's leaders, the conference champions and the final rankings; the right
   column your season (points, the conference and non-conference records, the postseason, the final rank,
   total offense and defense and the turnover margin with their national ranks), the highlights, the
   rivalries, the biggest surprise and disappointment and the national leaders.
   window.Recap.render(season, box, helpers); helpers from season.js: api, errText, openBox, onChange (a tab),
   openAwards(view), openRankings(), playerAttrs, rivalries(box). Reads GET /api/season/{id}/review. */
(function () {
  "use strict";
  // a regular-season week as the real calendar names it: the opening week (a handful of games before Labor Day
  // weekend) is Week 0, so engine week N reads Week N-1 (sim/season.py week_name); the portal's weeks are their own
  const seasonWeek = (w) => `Week ${w - 1}`;
  const { el } = window.CFP;
  let H = null;

  const team = (slug) => (window.CFP.teamsBySlug || {})[slug] || {};
  const colorOf = (slug) => (team(slug).colors && team(slug).colors.primary) || "";
  const edgeStyle = (slug) => (colorOf(slug) ? { style: window.CFP.teamVars(slug) } : {});   // the card's bar in that team's color
  const ordinal = (n) => { const t = n % 100, u = n % 10; return `${n}${t > 10 && t < 14 ? "th" : u === 1 ? "st" : u === 2 ? "nd" : u === 3 ? "rd" : "th"}`; };
  const kicker = (text) => el("div", { class: "go-kicker muted", text });
  const bar = (text, ...rest) => el("div", { class: "card-bar" }, [kicker(text), ...rest]);   // a card's header as its bar (styles.css .card-bar)
  const num = (v, digits) => (typeof v === "number" ? (digits == null ? String(v) : v.toFixed(digits)) : "–");
  function pill(slug, size) {
    const p = window.CFP.teamPill(slug);
    if (size) p.classList.add(size);
    return p;
  }
  const card = (cls, children, attrs) => el("section", { class: `go-card rcp-card ${cls || ""}`, ...(attrs || {}) }, children);
  // the conference's short name where the long one reads badly in a line
  const CONF_SHORT = { "American Athletic Conference": "American", "FBS Independent": "Independents", "FBS Independents": "Independents" };
  const confShort = (c) => CONF_SHORT[c] || c || "";
  const weekName = (s, w) => (s.week_labels && s.week_labels[w]) || seasonWeek(w);

  // ----- the header: the title, the record, the grade and the verdict ----------------------------------------
  function header(s, r) {
    const m = r.mine;
    const title = el("div", { class: "rcp-head-title" }, [el("h2", { class: "rcp-h1", text: r.done ? "Season Recap" : "Season So Far" })]);
    const head = bar(r.done ? `${r.year} Season Complete` : `Through ${r.current_week > 0 ? weekName(s, r.current_week) : "the Preseason"} · ${r.year} Season`);
    const rec = el("div", { class: "rcp-head-stat" }, [el("b", { class: "rcp-num", text: `${m.wins}-${m.losses}` }), kicker(m.name)]);
    const g = r.done && r.grade;
    const tone = !g ? "" : /^A/.test(g.grade) ? "" : /^[BC]/.test(g.grade) ? "warn" : "bad";
    return card("edge rcp-head", [head, el("div", { class: "rcp-head-body" }, [title, rec,
      g ? el("div", { class: `rcp-head-stat grade ${tone}` }, [el("b", { text: g.grade }), kicker("Season Grade")]) : null,
      g ? el("p", { class: "rcp-verdict", text: g.line }) : null].filter(Boolean))], { "aria-label": "Season Recap", ...edgeStyle(m.team) });
  }

  function actions(s, r) {
    const acts = el("div", { class: "rcp-acts" });
    const btn = (text, cls, onclick) => { const b = el("button", { type: "button", class: `go-btn ${cls}`, text }); window.CFP.ui.on(b, "click", onclick); return b; };
    if (r.done && s.career) acts.append(btn("Start the Offseason", "primary", () => H.onChange("offseason")));
    if (s.career) acts.append(btn("Back to the Office", "", () => H.onChange("office")));
    if (!H.awardsShown || H.awardsShown()) acts.append(btn("Awards", "", () => H.openAwards()));
    acts.append(btn("Schedule", "", () => H.onChange("schedule")));
    return acts;
  }

  // ----- the champion and the bracket ---------------------------------------------------------------------------
  function side(g, which, away) {
    const slug = g[which], won = g.played && g.winner === slug;
    const conf = confShort(team(slug).conference);
    return el("div", { class: `rcp-side ${away ? "away" : ""} ${g.played && !won ? "lost" : ""}` }, [pill(slug, "big"),
      el("div", { class: "rcp-side-text" }, [el("div", { class: "rcp-side-name", text: g[`${which}_name`] }),
        el("div", { class: "rcp-side-sub", text: [g[`${which}_record`], conf].filter(Boolean).join(" · ") })]),
      g.played ? el("div", { class: "rcp-score", text: String(g[`${which}_score`]) }) : null]);
  }

  function gameButton(g, cls, children) {
    if (!g.has_box) return el("div", { class: cls }, children);
    const b = el("button", { type: "button", class: cls, title: "Open the box score" }, children);
    window.CFP.ui.on(b, "click", () => H.openBox(g.event_id));
    return b;
  }

  function championCard(r) {
    const g = r.title_game;
    const kids = [bar(r.done && r.champion ? "National Champion" : "National Championship")];
    if (g && g.played) {
      kids.push(el("div", { class: "rcp-match" }, [side(g, "home"), el("div", { class: "rcp-vs", text: `FINAL${g.overtime ? ` · ${g.overtime > 1 ? g.overtime : ""}OT` : ""}` }), side(g, "away", true)]));
      const site = el("div", { class: "rcp-site" }, [g.site ? `${g.site} · ` : ""]);
      if (g.has_box) { const b = el("button", { type: "button", class: "rcp-link", text: "Open the Box Score" }); window.CFP.ui.on(b, "click", () => H.openBox(g.event_id)); site.append(b); }
      kids.push(site);
    } else {
      kids.push(el("div", { class: "rcp-big rcp-muted", text: "Not Decided Yet" }));
      if (g) kids.push(el("div", { class: "rcp-site", text: `${g.away_name} vs ${g.home_name}${g.site ? ` · ${g.site}` : ""}` }));
      else kids.push(el("div", { class: "rcp-site", text: "The title game is played after the semifinals." }));
    }
    return card("edge rcp-champ", kids, { "aria-label": "National Champion", ...(r.champion ? edgeStyle(r.champion) : {}) });
  }
  // the four rounds, their own card under the champion's
  function playoffCard(r) {
    if (!r.rounds.length) return null;
    const kids = [bar("Playoff")];
    {
      const rounds = el("div", { class: "rcp-rounds" });
      for (const rd of r.rounds) {
        const col = el("div", { class: "rcp-round" }, [kicker(ROUND_NAMES[rd.round] || rd.round)]);
        for (const g2 of rd.games) {
          const pair = el("div", { class: "rcp-pair" });
          for (const which of ["home", "away"]) {
            const slug = g2[which], won = g2.played && g2.winner === slug;
            pair.append(gameButton(g2, `rcp-gm ${g2.played ? (won ? "won" : "lost") : ""}`, [pill(slug), el("span", { class: "rcp-gm-name", text: g2[`${which}_name`] }),
              el("span", { class: "rcp-gm-score rcp-num", text: g2.played ? String(g2[`${which}_score`]) : "–" })]));
          }
          const note = rd.week >= 19 ? (g2.bowl || g2.site || "") : "";
          if (note) pair.append(el("div", { class: "rcp-sd", text: note }));
          col.append(pair);
        }
        rounds.append(col);
      }
      kids.push(rounds);
    }
    return card("rcp-playoff", kids, { "aria-label": "Playoff" });
  }
  const ROUND_NAMES = { "First round": "First Round", Quarterfinals: "Quarterfinals", Semifinals: "Semifinals", "National championship": "National Championship" };

  // ----- the Heisman ---------------------------------------------------------------------------------------------
  function heismanCard(s) {
    const h = s.heisman;
    if (!h || !h.winner) return null;
    const w = h.winner;
    const c = card("edge gold rcp-heis-card", [bar("Heisman Trophy"), el("div", { class: "rcp-heis" }, [pill(w.team, "xl"),
      el("div", { class: "rcp-heis-text" }, [
        el("div", { class: "rcp-who" }, [el("span", { text: w.name, ...H.playerAttrs(w.team, w.name, w.position) }), el("small", { text: `${w.position} · ${w.team_name} · ${w.line}` })]),
        h.finalists && h.finalists.length > 1 ? el("div", { class: "rcp-foot", text: `Finalists: ${h.finalists.filter((f) => f.name !== w.name).map((f) => `${f.name} (${f.team_name})`).join(", ")}.` }) : null]),
      el("div", { class: "rcp-pts" }, [el("b", { text: Number(w.points).toLocaleString() }), el("span", { text: `points · ${Number(h.share).toFixed(1)}% of possible` })])])],
      { "aria-label": "Heisman Trophy" });
    const open = el("button", { type: "button", class: "rcp-link", text: "Open the Vote" });
    window.CFP.ui.on(open, "click", () => H.openAwards("heisman"));
    c.querySelector(".rcp-heis-text").append(el("div", {}, [open]));
    return c;
  }

  // ----- the three tables: your leaders, the conference champions, the final rankings ---------------------------
  const st = (p, k) => (p && p.stats[k]) || 0;
  function leadersCard(r) {
    const L = r.mine.leaders || {};
    const rows = [
      ["QB", L.passer, (p) => `${st(p, "pass_yards").toLocaleString()} pass yds, ${st(p, "passing_touchdowns")} TD`],
      ["RB", L.rusher, (p) => `${st(p, "rush_yards").toLocaleString()} rush yds, ${st(p, "rushing_touchdowns")} TD`],
      ["WR", L.receiver, (p) => `${st(p, "receiving_yards").toLocaleString()} rec yds, ${st(p, "receiving_touchdowns")} TD`],
      ["LB", L.tackler, (p) => `${st(p, "solo_tackles") + st(p, "assisted_tackles")} tackles, ${st(p, "tackles_for_loss")} TFL`],
      ["DL", L.sacks, (p) => `${num(st(p, "sacks"), Number.isInteger(st(p, "sacks")) ? 0 : 1)} sacks`],
      ["DB", L.interceptions, (p) => `${st(p, "interceptions")} INT`],
    ].filter(([, p]) => p);
    const t = el("table", { class: "rcp-table" });
    for (const [slot, p, line] of rows) {
      t.append(el("tr", {}, [el("td", { class: "k", text: p.position || slot }), el("td", {}, [el("b", { text: p.name, ...H.playerAttrs(r.mine.team, p.name, p.position) }), el("div", { class: "rcp-table-sub", text: line(p) })])]));
    }
    return card("", [bar("Team Leaders"), rows.length ? t : el("div", { class: "aw-empty", text: "No games played yet." })], { "aria-label": "Team Leaders" });
  }

  function championsCard(r) {
    const t = el("table", { class: "rcp-table wrapk" });
    t.append(el("tr", {}, [el("th", { text: "Conference" }), el("th", { text: "Champion" })]));
    for (const c of r.champions) {
      const g = c.game;
      const tr = el("tr", { class: `${c.team === r.mine.team ? "mine" : ""} ${g && g.has_box ? "clickable" : ""}` }, [el("td", { class: "k", text: confShort(c.conference) }), el("td", {}, [pill(c.team), c.name])]);
      if (g && g.has_box) { tr.title = "Open the box score"; window.CFP.ui.on(tr, "click", () => H.openBox(g.event_id)); }
      t.append(tr);
    }
    return card("", [bar("Conference Champions"), r.champions.length ? t : el("div", { class: "aw-empty", text: "The title games are played in championship week." })], { "aria-label": "Conference Champions" });
  }

  function rankingsCard(r) {
    const list = r.final_cfp && r.final_cfp.length ? r.final_cfp : r.final_ap;
    const t = el("table", { class: "rcp-table" });
    t.append(el("tr", {}, [el("th", { text: "#" }), el("th", { text: "Team" }), el("th", { class: "n", text: "Record" })]));
    for (const e of list.slice(0, 6)) t.append(el("tr", { class: e.team === r.mine.team ? "mine" : "" }, [el("td", { class: "k rcp-num", text: String(e.rank) }), el("td", {}, [pill(e.team), e.name]), el("td", { class: "n", text: e.record })]));
    const all = el("button", { type: "button", class: "rcp-link", text: "View All 25" });
    window.CFP.ui.on(all, "click", () => H.openRankings());
    return card("", [bar(r.done ? "Final Rankings" : "Rankings"), list.length ? t : el("div", { class: "aw-empty", text: "No poll yet." }), el("div", {}, [all])], { "aria-label": "Final Rankings" });
  }

  // ----- your season ---------------------------------------------------------------------------------------------
  function mineCard(s, r) {
    const m = r.mine;
    const snap = el("div", { class: "rcp-snap" }, [[num(m.points_per_game, 1), "Points / Game"], [num(m.allowed_per_game, 1), "Allowed / Game"], [String(m.longest_streak), "Longest Streak"]]
      .map(([v, k]) => el("div", {}, [el("b", { text: v }), el("span", { text: k })])));
    const conf = confShort(m.conference);
    const place = m.conf_champion ? `${conf} champion` : m.conf_rank ? `${ordinal(m.conf_rank)} in the ${m.division ? `${conf} ${m.division}` : conf}` : "";
    const post = m.finish ? (m.finish === "No bowl" ? "None" : m.finish === "National champion" ? "National Champion" : m.finish) : (r.done ? "None" : "Not Decided Yet");
    const postNote = m.finish === "No bowl" && m.wins_short ? `${m.wins_short} ${m.wins_short === 1 ? "win" : "wins"} short` : "";
    const rank = m.final_cfp ? `#${m.final_cfp}` : m.final_ap ? `#${m.final_ap}` : "Unranked";
    const kv = el("div", { class: "rcp-kv" }, [
      ["Conference", `${m.conf_wins}-${m.conf_losses}`, place], ["Non-Conference", `${m.non_conf_wins}-${m.non_conf_losses}`, ""],
      ["Postseason", post, postNote], [r.done ? "Final Rank" : "Rank", rank, m.final_cfp && m.final_ap ? `AP #${m.final_ap}` : ""],
    ].map(([k, v, note]) => el("div", {}, [kicker(k), el("div", {}, [el("b", { class: "rcp-num", text: v }), note ? el("span", { class: "rcp-kv-note", text: ` · ${note}` }) : null])])));
    const ts = m.team_stats;
    const tile = (label, x, fmt) => el("div", { class: "rcp-tile" }, [el("b", { text: x ? fmt(x.value) : "–" }), el("span", { text: label }), el("small", { text: x ? `${ordinal(x.rank)} of ${x.of}` : "No league stats" })]);
    const tiles = el("div", { class: "rcp-tiles" }, [tile("Total Offense", ts && ts.total_offense, (v) => num(v, 1)), tile("Total Defense", ts && ts.total_defense, (v) => num(v, 1)),
      tile("Turnover Margin", ts && ts.turnover_margin, (v) => (v > 0 ? `+${v}` : String(v)))]);
    return card("edge rcp-mine", [bar("Your Season"), snap, kv, tiles], { "aria-label": "Your Season", ...edgeStyle(m.team) });
  }

  const PLAYOFF_WHEN = { 17: "First Round", 18: "Quarterfinals", 19: "Semifinals", 20: "Title Game" };
  function highlightsCard(s, r) {
    const m = r.mine;
    const rows = [["Best Win", m.best_win], ["Worst Loss", m.worst_loss], ["Biggest Win", m.biggest_win], ["Closest Loss", m.closest_loss]].filter(([, l]) => l);
    const list = el("div", { class: "rcp-hl" });
    for (const [label, l] of rows) {
      const when = l.kind === "playoff" ? (PLAYOFF_WHEN[l.week] || "Playoff") : l.kind !== "regular" && l.title ? l.title : weekName(s, l.week);
      list.append(gameButton(l, "rcp-hl-row", [el("span", { class: "rcp-hl-k", text: label }),
        el("span", { class: "rcp-hl-opp" }, [el("span", { class: `rcp-hl-score ${l.won ? "win" : "loss"}`, text: `${l.won ? "W" : "L"} ${l.points_for}–${l.points_against}${l.overtime ? " OT" : ""}` }),
          ` ${l.venue === "away" ? "at" : "vs"} ${l.opponent_rank ? `#${l.opponent_rank} ` : ""}${l.opponent_name}`]),
        el("span", { class: "rcp-hl-when", text: when })]));
    }
    return card("", [bar("Highlights"), rows.length ? list : el("div", { class: "aw-empty", text: "No games played yet." })], { "aria-label": "Highlights" });
  }

  // one sentence on a team's AP path: where it started, its peak, where it ended
  function expl(s, r, x, cls) {
    const wk = (w) => (w <= 14 ? seasonWeek(w) : weekName(s, w).toLowerCase().replace("selection", "selection day"));
    const endWord = r.done ? "finished" : "sits";
    const start = x.preseason_rank ? `Started the season #${x.preseason_rank}` : "Started the season unranked";
    if (x.peak_rank == null) return cls === "surprise" ? `${start} and ${r.done ? "went" : "is"} ${x.record} without the poll noticing.` : `${start} and ${r.done ? "stumbled to" : "is a disappointing"} ${x.record}.`;
    if (x.final_rank != null && x.final_rank === x.peak_rank) {
      if (x.preseason_rank === x.final_rank) return `Started and ${endWord} the season at #${x.final_rank}.`;
      const climbed = !x.preseason_rank || x.final_rank < x.preseason_rank;
      return `${start}, ${climbed ? "climbed" : "slipped"} to #${x.final_rank} and ${endWord} there.`;
    }
    const improved = (!x.preseason_rank || x.peak_rank <= x.preseason_rank - 2) && x.peak_week < x.last_ranked_week;
    const end = x.final_rank != null ? `slid to #${x.final_rank}` : `dropped out of the poll after ${wk(x.last_ranked_week)} and ${endWord} unranked`;
    return improved ? `${start}, reached #${x.peak_rank} by ${wk(x.peak_week)}, then ${end}.` : `${start}, ${end}.`;
  }

  function storyCard(s, r, title, rows, cls) {
    if (!rows.length) return null;
    const [first, ...rest] = rows;
    const kids = [bar(title), el("div", { class: "rcp-story-big" }, [pill(first.team, "mid"), `${first.name} ${first.record}`]),
      el("p", { text: `${confShort(first.conference)}. ${expl(s, r, first, cls)}` })];
    if (rest.length) kids.push(el("div", { class: "rcp-foot" }, rest.map((x) => el("div", {}, [pill(x.team), `${x.name} ${x.record} — ${expl(s, r, x, cls)}`]))));
    return card(`edge ${cls === "surprise" ? "good" : "bad"} rcp-story`, kids, { "aria-label": title });
  }

  function nationalCard(r) {
    const N = r.national_leaders || {};
    const cols = [["Passing", N.passing, (p) => `${st(p, "pass_yards").toLocaleString()} yds`], ["Rushing", N.rushing, (p) => `${st(p, "rush_yards").toLocaleString()} yds`],
      ["Receiving", N.receiving, (p) => `${st(p, "receiving_yards").toLocaleString()} yds`], ["Sacks", N.sacks, (p) => `${num(st(p, "sacks"), Number.isInteger(st(p, "sacks")) ? 0 : 1)}`]].filter(([, p]) => p);
    if (!cols.length) return card("", [bar("National Leaders"), el("div", { class: "aw-empty", text: r.done || r.current_week > 0 ? "This season kept no league-wide stats; start a new season to see national leaders." : "No games played yet." })], { "aria-label": "National Leaders" });
    return card("", [bar("National Leaders"), el("div", { class: "rcp-lead" }, cols.map(([k, p, big]) => el("div", {}, [kicker(k),
      el("b", { text: p.name, ...H.playerAttrs(p.team, p.name, p.position) }), el("span", {}, [pill(p.team), `${p.team_name} · ${big(p)}`])])))], { "aria-label": "National Leaders" });
  }

  // ----- the page ------------------------------------------------------------------------------------------------
  async function render(s, box, helpers) {
    H = helpers;
    box.innerHTML = "";
    const root = el("div", { class: "rcp" }, [el("p", { class: "muted go-loading", text: "Loading the season…" })]);
    box.append(root);
    let r;
    try { r = await H.api(`/api/season/${s.id}/review`); } catch (err) { root.innerHTML = ""; root.append(el("p", { class: "muted", text: `Could not load this: ${H.errText(err)}` })); return; }
    if (!root.isConnected) return;
    root.innerHTML = "";
    const left = el("div", { class: "rcp-col" }, [championCard(r), playoffCard(r), heismanCard(s),
      el("div", { class: "rcp-row" }, [leadersCard(r), championsCard(r), rankingsCard(r)])]);
    const rivalries = el("div", { class: "rcp-rivalries" });
    const right = el("div", { class: "rcp-col" }, [mineCard(s, r), highlightsCard(s, r), rivalries,
      storyCard(s, r, r.done ? "Biggest Surprise" : "Biggest Surprise So Far", r.surprises || [], "surprise"),
      storyCard(s, r, r.done ? "Biggest Disappointment" : "Biggest Disappointment So Far", r.disappointments || [], "letdown"), nationalCard(r)]);
    root.append(header(s, r), actions(s, r), el("div", { class: "rcp-main" }, [left, right]));
    if (H.rivalries) H.rivalries(rivalries);
    root.dataset.draw = String(Number(root.dataset.draw || 0) + 1);
  }

  window.Recap = { render };
})();
