/* Shared game renderers: used by the matchup page (app.js) and the season page (season.js). */
window.CFP = (function () {
  "use strict";
  const $ = (sel) => document.querySelector(sel);
  const teamsBySlug = {};
  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c == null) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  };

  const GAME_IDS = { scoreRow: "#score-row", quarters: "#quarters", meta: "#score-meta", scoring: "#tab-scoring", team: "#tab-team", home: "#tab-home", away: "#tab-away", drives: "#tab-drives" };

  const SBOX_IDS = { scoreRow: "#sbox-score-row", quarters: "#sbox-quarters", meta: "#sbox-meta", scoring: "#sbox-scoring", team: "#sbox-team", home: "#sbox-home", away: "#sbox-away", drives: "#sbox-drives" };

  // A small square in the team's colors: primary and secondary split on a diagonal,
  // the accent color as the border. Teams without an accent get a theme-aware ring.
  function teamPill(slug) {
    const t = teamsBySlug[slug];
    const col = (t && t.colors) || {};
    const c1 = col.primary || "#888", c2 = col.secondary || c1, c3 = col.accent;
    const node = document.createElement("span");
    node.className = `pill-inline team-pill${c3 ? "" : " no-accent"}`;
    node.style.setProperty("--c1", c1);
    node.style.setProperty("--c2", c2);
    if (c3) node.style.setProperty("--c3", c3);
    node.title = t ? t.name : "";
    return node;
  }

  // ----- theme (dark / light) -------------------------------------------------
  const THEME_KEY = "cfp.theme";
  function currentTheme() {
    const set = document.documentElement.dataset.theme;
    if (set) return set;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "light" ? "#ffffff" : "#131a2e";
    for (const b of document.querySelectorAll(".btn-theme")) {
      b.textContent = theme === "light" ? "\u263E" : "\u2600";
      b.title = theme === "light" ? "Switch to dark mode" : "Switch to light mode";
    }
  }
  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (_) { /* ignore */ }
    applyTheme(saved || currentTheme());
    for (const b of document.querySelectorAll(".btn-theme")) {
      b.addEventListener("click", () => {
        const next = currentTheme() === "light" ? "dark" : "light";
        try { localStorage.setItem(THEME_KEY, next); } catch (_) { /* ignore */ }
        applyTheme(next);
      });
    }
  }
  document.addEventListener("DOMContentLoaded", initTheme);

  function teamColor(g, side) {
    const t = teamsBySlug[g[`${side}_slug`]];
    return t && t.colors && t.colors.primary ? t.colors.primary : (side === "home" ? "#4f8cff" : "#ff6b5a");
  }

  function renderScoreboard(g, ids = GAME_IDS) {
    const row = $(ids.scoreRow);
    row.innerHTML = "";
    const block = (side, team) =>
      el("div", { class: `team-block ${side} ${g.winner === side ? "winner" : ""}` }, [
        side === "home" ? el("div", { class: "pill", style: `background:${teamColor(g, side)}` }) : null,
        el("div", {}, [
          el("div", { class: "name", text: team.name }),
          el("div", { class: "sub", text: side === "home" ? (g.venue === "neutral" ? "Neutral site" : "Home") : "Away" }),
        ]),
        el("div", { class: "big", text: String(team.score) }),
        side === "away" ? el("div", { class: "pill", style: `background:${teamColor(g, side)}` }) : null,
      ]);
    row.append(
      block("away", g.away),
      el("div", { class: "final-tag", text: g.overtime_periods ? `Final / ${g.overtime_periods}OT` : "Final" }),
      block("home", g.home),
    );

    const table = $(ids.quarters);
    table.innerHTML = "";
    const otCols = g.home.overtime.map((_, i) => `OT${g.home.overtime.length > 1 ? i + 1 : ""}`);
    table.appendChild(el("tr", {}, [el("th", { text: "" }), ...["1", "2", "3", "4", ...otCols, "T"].map((t) => el("th", { text: t }))]));
    for (const side of ["away", "home"]) {
      const t = g[side];
      table.appendChild(el("tr", {}, [
        el("td", { text: t.name }),
        ...t.quarters.map((q) => el("td", { text: String(q) })),
        ...t.overtime.map((q) => el("td", { text: String(q) })),
        el("td", { class: "total", text: String(t.score) }),
      ]));
    }

    const meta = $(ids.meta);
    meta.innerHTML = "";
    const bits = [
      `${g[g.received_first].name} received the opening kickoff`,
      `${g.drives.length} drives`,
      g.venue === "neutral" ? "neutral site" : `home edge ${g.home_advantage_points} rating pts`,
    ];
    const sl = Object.entries(g.sliders || {});
    if (sl.length) bits.push("sliders: " + sl.map(([k, v]) => `${label(k)} ${v}`).join(", "));
    meta.append(bits.join(" · "));
    // injuries suffered in this game, per team
    for (const side of ["away", "home"]) {
      const inj = (g[side].injuries || []);
      if (!inj.length) continue;
      meta.append(el("div", { class: "injury-line" }, [
        el("b", { text: `${g[side].name} injuries: ` }),
        inj.map((i) => `${i.name} (${i.position}, ${i.type}${i.weeks ? `, out ${i.weeks} ${i.weeks === 1 ? "week" : "weeks"}` : ", returned to the bench"})`).join("; "),
      ]));
    }
    if (g.home.personnel || g.away.personnel) {
      const show = (t) => Object.entries(t.personnel || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
      meta.append(el("div", { class: "muted small-text", text: `Personnel (snaps) · ${g.away.name}: ${show(g.away)} · ${g.home.name}: ${show(g.home)}` }));
    }
    for (const side of ["home", "away"]) {
      const v = g[side].verification;
      if (!v.ok) meta.append(el("div", { class: "warn", text: `${g[side].name}: stats imply ${v.expected} points but the score is ${v.actual}` }));
    }
  }

  function renderScoring(g, ids = GAME_IDS) {
    const box = $(ids.scoring);
    box.innerHTML = "";
    if (!g.scoring_plays.length) { box.append(el("p", { class: "muted", text: "No scoring." })); return; }
    const list = el("ul", { class: "scoring-list" });
    let lastQ = null;
    for (const s of g.scoring_plays) {
      if (s.quarter !== lastQ) {
        lastQ = s.quarter;
        list.appendChild(el("li", { class: "q-head", style: "display:block", text: quarterName(s.quarter) }));
      }
      const kind = kindLabel(s.kind);
      list.appendChild(el("li", {}, [
        el("span", { class: "q", text: s.clock }),
        el("span", { class: `kind ${s.team}`, text: kind, style: `color:${teamColor(g, s.team)}` }),
        el("span", { class: "desc" }, [`${s.team_name}: ${s.description || kind}`, s.try ? el("span", { class: "try", text: `(${s.try})` }) : null]),
        el("span", { class: "running", html: `<b>${s.away_score}</b> – <b>${s.home_score}</b>` }),
      ]));
    }
    box.appendChild(list);
  }

  function teamTotals(team, drives, side) {
    const s = team.team_stats;
    const e = team.team_events || {};
    const lost = e.fumbles_lost != null ? e.fumbles_lost : s["Fumbles"];
    const ownDrives = drives.filter((d) => d.offense === side && d.quarter <= 4);
    const top = ownDrives.reduce((a, d) => a + d.seconds, 0);
    const plays = ownDrives.reduce((a, d) => a + d.plays, 0);
    const puntAvg = s["Punts"] ? (s["Punt Yards"] / s["Punts"]).toFixed(1) : "–";
    const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "–");
    return [
      ["Points", team.score, "hi"],
      ["Total yards", s["Pass Yards"] + s["Rush Yards"], "hi"],
      ["Plays (excl. penalties)", plays, null],
      ["Yards per play", plays ? ((s["Pass Yards"] + s["Rush Yards"]) / plays).toFixed(1) : "–", "hi"],
      ["First downs", e.first_downs || 0, "hi"],
      ["Third downs", `${e.third_down_conversions || 0}/${e.third_downs || 0} (${pct(e.third_down_conversions || 0, e.third_downs || 0)})`, null],
      ["Fourth downs", `${e.fourth_down_conversions || 0}/${e.fourth_down_attempts || 0}`, null],
      ["Red zone", `${e.red_zone_scores || 0}/${e.red_zone_trips || 0} (${e.red_zone_touchdowns || 0} TD)`, null],
      ["Time of possession", fmtTime(top), "hi"],
      ["Passing", `${s["Completions"]}/${s["Pass Attempts"]}, ${s["Pass Yards"]} yds`, null],
      ["Passing TD / INT", `${s["Passing Touchdowns"]} / ${s["Interceptions Thrown"]}`, null],
      ["Rushing", `${s["Carries"]} car, ${s["Rush Yards"]} yds`, null],
      ["Yards per carry", s["Carries"] ? (s["Rush Yards"] / s["Carries"]).toFixed(1) : "–", "hi"],
      ["Rushing TD", s["Rushing Touchdowns"], "hi"],
      ["Fumbles / lost", `${s["Fumbles"]} / ${lost}`, null],
      ["Turnovers (INT + fumbles lost)", s["Interceptions Thrown"] + lost, "lo"],
      ["Penalties / yards", `${e.penalties || 0} / ${e.penalty_yards || 0}`, null],
      ["Sacks taken", s["Sacks Taken"], "lo"],
      ["Defensive sacks", s["Sacks"], "hi"],
      ["Tackles (solo + ast)", `${s["Solo Tackles"]} + ${s["Assisted Tackles"]}`, null],
      ["Takeaways (INT + FR)", s["Interceptions"] + s["Fumble Recoveries"], "hi"],
      ["Defensive TD", s["Defensive Touchdowns"], "hi"],
      ["Field goals", `${s["Field Goals Made"]}/${s["Field Goals Attempted"]}`, null],
      ["PATs", `${s["PATs Made"]}/${s["PATS Attempted"]}`, null],
      ["Punts / net avg", `${s["Punts"]} / ${puntAvg}`, null],
      ["Kick returns", `${s["Kickoff Returns"]} for ${s["Kickoff Return Yards"]}${s["Kickoff Return Touchdowns"] ? `, ${s["Kickoff Return Touchdowns"]} TD` : ""}`, null],
      ["Punt returns", `${s["Punt Returns"]} for ${s["Punt Return Yards"]}${s["Punt Return Touchdowns"] ? `, ${s["Punt Return Touchdowns"]} TD` : ""}`, null],
      ["Safeties", s["Safeties"], null],
    ];
  }

  function renderTeamStats(g, ids = GAME_IDS) {
    const box = $(ids.team);
    box.innerHTML = "";
    const away = teamTotals(g.away, g.drives, "away");
    const home = teamTotals(g.home, g.drives, "home");
    const table = el("table", { class: "stats compare" });
    table.appendChild(el("tr", {}, [
      el("th", { class: "away", text: g.away.name, style: `color:${teamColor(g, "away")}` }),
      el("th", { text: "" }),
      el("th", { class: "home", text: g.home.name, style: `color:${teamColor(g, "home")}` }),
    ]));
    away.forEach((a, i) => {
      const h = home[i];
      const av = a[1], hv = h[1];
      let aBetter = false, hBetter = false;
      if (a[2] && typeof av === "number" && typeof hv === "number" && av !== hv) {
        aBetter = a[2] === "hi" ? av > hv : av < hv;
        hBetter = !aBetter;
      }
      table.appendChild(el("tr", {}, [
        el("td", { class: `away ${aBetter ? "better" : ""}`, style: `text-align:left;color:${teamColor(g, "away")}`, text: String(av) }),
        el("td", { class: "label", style: "text-align:center", text: a[0] }),
        el("td", { class: `home ${hBetter ? "better" : ""}`, style: `color:${teamColor(g, "home")}`, text: String(hv) }),
      ]));
    });
    box.appendChild(table);
  }

  function renderPlayers(team, box) {
    box.innerHTML = "";
    const P = team.players;
    const st = (p, k) => p.stats[k] || 0;
    const has = (p, ...keys) => keys.some((k) => st(p, k));

    const section = (title, rows, cols, sortKey) => {
      if (!rows.length) return;
      rows = rows.slice().sort((a, b) => st(b, sortKey) - st(a, sortKey));
      box.appendChild(el("h3", { text: title }));
      const table = el("table", { class: "stats" });
      table.appendChild(el("tr", {}, [el("th", { text: "Player" }), ...cols.map((c) => el("th", { text: c[0] }))]));
      for (const p of rows) {
        table.appendChild(el("tr", {}, [
          el("td", { class: "name" }, [(() => { const slugs = window.CFP.currentBoxSlugs || {}; const slug = slugs[box.id && box.id.endsWith("home") ? "home" : "away"]; return el("span", slug ? { text: p.name, "data-player": `${slug}|${p.name}|${p.position}`, class: "plink", title: "Open player page" } : { text: p.name }); })(), el("span", { class: "pos", text: p.position }), p.injury ? el("span", { class: "pos injured", text: `injured (${p.injury.type})` }) : null]),
          ...cols.map((c) => el("td", { text: String(c[1](p)) })),
        ]));
      }
      const totals = cols.map((c) => (c[2] ? c[2](rows) : ""));
      if (totals.some((t) => t !== "")) {
        table.appendChild(el("tr", { class: "total" }, [el("td", { text: "Team" }), ...totals.map((t) => el("td", { text: String(t) }))]));
      }
      box.appendChild(table);
    };
    const sum = (k) => (rows) => rows.reduce((a, p) => a + st(p, k), 0);
    const avg = (num, den) => (p) => (st(p, den) ? (st(p, num) / st(p, den)).toFixed(1) : "–");
    const avgT = (num, den) => (rows) => {
      const d = rows.reduce((a, p) => a + st(p, den), 0);
      return d ? (rows.reduce((a, p) => a + st(p, num), 0) / d).toFixed(1) : "–";
    };

    section("Passing", P.filter((p) => has(p, "pass_attempts")), [
      ["C/ATT", (p) => `${st(p, "completions")}/${st(p, "pass_attempts")}`, (rows) => `${sum("completions")(rows)}/${sum("pass_attempts")(rows)}`],
      ["Pct", (p) => (st(p, "pass_attempts") ? Math.round((100 * st(p, "completions")) / st(p, "pass_attempts")) : "–"), null],
      ["Yds", (p) => st(p, "pass_yards"), sum("pass_yards")],
      ["Y/A", avg("pass_yards", "pass_attempts"), avgT("pass_yards", "pass_attempts")],
      ["TD", (p) => st(p, "passing_touchdowns"), sum("passing_touchdowns")],
      ["INT", (p) => st(p, "interceptions_thrown"), sum("interceptions_thrown")],
      ["Sacked", (p) => st(p, "sacks_taken"), sum("sacks_taken")],
    ], "pass_yards");

    section("Rushing", P.filter((p) => has(p, "carries")), [
      ["Car", (p) => st(p, "carries"), sum("carries")],
      ["Yds", (p) => st(p, "rush_yards"), sum("rush_yards")],
      ["Avg", avg("rush_yards", "carries"), avgT("rush_yards", "carries")],
      ["TD", (p) => st(p, "rushing_touchdowns"), sum("rushing_touchdowns")],
      ["Fum", (p) => st(p, "fumbles"), sum("fumbles")],
    ], "rush_yards");

    section("Receiving", P.filter((p) => has(p, "targets", "receptions")), [
      ["Tgt", (p) => st(p, "targets"), sum("targets")],
      ["Rec", (p) => st(p, "receptions"), sum("receptions")],
      ["Yds", (p) => st(p, "receiving_yards"), sum("receiving_yards")],
      ["Avg", avg("receiving_yards", "receptions"), avgT("receiving_yards", "receptions")],
      ["TD", (p) => st(p, "receiving_touchdowns"), sum("receiving_touchdowns")],
    ], "receiving_yards");

    section("Defense", P.filter((p) => p.unit === "defense" && has(p, "solo_tackles", "assisted_tackles", "sacks", "interceptions", "forced_fumbles", "fumble_recoveries", "defensive_touchdowns")), [
      ["Solo", (p) => st(p, "solo_tackles"), sum("solo_tackles")],
      ["Ast", (p) => st(p, "assisted_tackles"), sum("assisted_tackles")],
      ["Tot", (p) => st(p, "solo_tackles") + st(p, "assisted_tackles"), (rows) => sum("solo_tackles")(rows) + sum("assisted_tackles")(rows)],
      ["Sacks", (p) => st(p, "sacks"), sum("sacks")],
      ["INT", (p) => st(p, "interceptions"), sum("interceptions")],
      ["INT Yds", (p) => st(p, "interception_return_yards"), sum("interception_return_yards")],
      ["FF", (p) => st(p, "forced_fumbles"), sum("forced_fumbles")],
      ["FR", (p) => st(p, "fumble_recoveries"), sum("fumble_recoveries")],
      ["TD", (p) => st(p, "defensive_touchdowns"), sum("defensive_touchdowns")],
    ], "solo_tackles");

    section("Kicking", P.filter((p) => has(p, "fg_attempted", "pat_attempts")), [
      ["FG", (p) => `${st(p, "fg_made")}/${st(p, "fg_attempted")}`, null],
      ["PAT", (p) => `${st(p, "pat_made")}/${st(p, "pat_attempts")}`, null],
      ["Pts", (p) => st(p, "fg_made") * 3 + st(p, "pat_made"), null],
    ], "fg_made");

    section("Punting", P.filter((p) => has(p, "punts")), [
      ["Punts", (p) => st(p, "punts"), null],
      ["Yds", (p) => st(p, "punt_yards"), null],
      ["Net avg", avg("punt_yards", "punts"), null],
    ], "punts");

    section("Returns", P.filter((p) => has(p, "kickoff_returns", "punt_returns")), [
      ["KR", (p) => st(p, "kickoff_returns"), null],
      ["KR Yds", (p) => st(p, "kickoff_return_yards"), null],
      ["PR", (p) => st(p, "punt_returns"), null],
      ["PR Yds", (p) => st(p, "punt_return_yards"), null],
      ["TD", (p) => st(p, "kickoff_return_touchdowns") + st(p, "punt_return_touchdowns"), null],
    ], "kickoff_return_yards");

    if (!box.children.length) box.append(el("p", { class: "muted", text: "No player stats recorded." }));
  }

  function renderDrives(g, ids = GAME_IDS) {
    const box = $(ids.drives);
    box.innerHTML = "";
    const table = el("table", { class: "stats" });
    table.appendChild(el("tr", {}, ["#", "Qtr", "Offense", "Start", "Plays", "Yards", "Time", "Result", "Field"].map((h) => el("th", { text: h }))));
    g.drives.forEach((d, i) => {
      const yards = d.end_yardline - d.start_yardline;
      const resClass = "res-" + d.result.split(" ")[0];
      const left = Math.min(d.start_yardline, d.end_yardline);
      const width = Math.max(1, Math.abs(yards));
      table.appendChild(el("tr", { class: "drive-row" }, [
        el("td", { text: String(i + 1) }),
        el("td", { text: d.quarter > 4 ? `OT${d.quarter - 4}` : String(d.quarter) }),
        el("td", { style: "text-align:left", text: d.offense_name }),
        el("td", { text: fieldPos(d.start_yardline) }),
        el("td", { text: String(d.plays) }),
        el("td", { text: String(yards) }),
        el("td", { text: fmtTime(d.seconds) }),
        el("td", { class: resClass, style: "text-align:left", text: resultLabel(d.result) }),
        el("td", {}, [el("div", { class: "bar" }, [el("span", { style: `left:${left}%;width:${width}%;background:${teamColor(g, d.offense)}` })])]),
      ]));
    });
    box.appendChild(table);
  }

  function label(key) {
    return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(Qb|Wr)\b/g, (m) => m.toUpperCase());
  }

  function quarterName(q) { return q <= 4 ? `${["1st", "2nd", "3rd", "4th"][q - 1]} quarter` : `Overtime ${q - 4}`; }

  function kindLabel(kind) {
    return { pass: "TD", run: "TD", kickoff_return: "KR TD", punt_return: "PR TD", defensive: "DEF TD", field_goal: "FG", safety: "SAF", two_point: "2PT" }[kind] || kind.toUpperCase();
  }

  function resultLabel(r) {
    return { touchdown: "Touchdown", "field goal": "Field goal", "missed kick": "Missed FG", punt: "Punt", turnover: "Turnover", safety: "Safety", defensive_touchdown: "Defensive TD", punt_return_td: "Punt return TD", first_down: "Stalled at the 1", end_of_half: "End of half" }[r] || r;
  }

  function fieldPos(y) { return y <= 50 ? `Own ${y}` : `Opp ${100 - y}`; }

  function fmtTime(sec) { return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; }

  return { $, el, teamsBySlug, GAME_IDS, SBOX_IDS, teamColor, teamPill, applyTheme, renderScoreboard, renderScoring, renderTeamStats,
           renderPlayers, renderDrives, label, quarterName, kindLabel, resultLabel, fieldPos, fmtTime };
})();
