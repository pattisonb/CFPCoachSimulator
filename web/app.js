/* CFP Coach Simulator front end: pick two teams and a venue, run games through the API,
   and show the results. */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
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

  const state = {
    teams: [],
    teamsBySlug: {},
    sliderDefaults: {},
    sliderGroups: {},
    sliders: {},
    currentGame: null,
    history: [],
  };

  // ----- API ---------------------------------------------------------------

  async function api(path, options) {
    const res = await fetch(path, options);
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  }

  function sliderOverrides() {
    const out = {};
    for (const [k, v] of Object.entries(state.sliders)) {
      if (v !== state.sliderDefaults[k]) out[k] = v;
    }
    return out;
  }

  function venue() {
    const checked = document.querySelector('input[name="venue"]:checked');
    return checked ? checked.value : "home";
  }

  async function runSim(count) {
    const home = $("#home-select").value;
    const away = $("#away-select").value;
    if (!home || !away) return toast("Pick two teams first.", 2500);
    if (home === away) return toast("Pick two different teams.", 2500);
    const buttons = [$("#btn-sim"), $("#btn-sim-batch")];
    buttons.forEach((b) => (b.disabled = true));
    toast(count === 1 ? "Simulating…" : `Simulating ${count} games…`);
    try {
      const data = await api("/api/sim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ home, away, venue: venue(), count, sliders: sliderOverrides() }),
      });
      await loadHistory();
      if (count === 1) showGame(data.games[0]);
      else showBatch(data);
      hideToast();
    } catch (err) {
      toast(`Sim failed: ${err.message}`, 4000);
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  // ----- teams -------------------------------------------------------------

  async function loadTeams() {
    const data = await api("/api/teams");
    state.teams = data.teams;
    for (const t of data.teams) state.teamsBySlug[t.slug] = t;
    for (const id of ["home-select", "away-select"]) {
      const sel = document.getElementById(id);
      sel.innerHTML = "";
      let group = null, groupName = null;
      for (const t of data.teams) {
        const g = t.fictional ? `${t.conference} (FCS)` : t.conference;
        if (g !== groupName) {
          groupName = g;
          group = el("optgroup", { label: g });
          sel.appendChild(group);
        }
        group.appendChild(el("option", { value: t.slug, text: `${t.name} (${t.ratings.overall.toFixed(0)})` }));
      }
    }
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem("cfp.matchup") || "{}"); } catch (_) { /* ignore */ }
    $("#home-select").value = state.teamsBySlug[saved.home] ? saved.home : "ohio-state";
    $("#away-select").value = state.teamsBySlug[saved.away] ? saved.away : "texas";
    if (saved.venue) { const r = document.querySelector(`input[name="venue"][value="${saved.venue}"]`); if (r) r.checked = true; }
    renderTeamCards();
  }

  function persistMatchup() {
    try {
      localStorage.setItem("cfp.matchup", JSON.stringify({ home: $("#home-select").value, away: $("#away-select").value, venue: venue() }));
    } catch (_) { /* ignore */ }
  }

  function renderTeamCards() {
    for (const side of ["home", "away"]) {
      const t = state.teamsBySlug[$(`#${side}-select`).value];
      const box = $(`#${side}-card`);
      box.innerHTML = "";
      if (!t) continue;
      box.style.borderLeftColor = t.colors.primary || "#888";
      const r = t.ratings;
      box.append(
        el("div", { class: "card-name", text: `${t.name} ${t.mascot}` }),
        el("div", { class: "card-sub muted", text: `${t.conference} · ${t.head_coach || "no head coach"}` }),
        el("div", { class: "card-ratings" }, [
          tag("OVR", r.overall), tag("OFF", r.offense), tag("DEF", r.defense), tag("ST", r.special_teams),
        ]),
        el("div", { class: "card-sub muted", text: side === "home" && venue() === "home"
          ? `${t.stadium.name} · ${Number(t.stadium.capacity).toLocaleString()} · home edge ${t.home_field_advantage}`
          : `${t.stadium.name}` }),
      );
    }
    persistMatchup();
    renderRosterPreview();
  }

  function tag(label, value) {
    return el("span", { class: "rating-tag" }, [el("b", { text: Math.round(value) }), ` ${label}`]);
  }

  async function renderRosterPreview() {
    const box = $("#rosters");
    box.innerHTML = "";
    const slugs = [$("#away-select").value, $("#home-select").value];
    const order = ["QB", "RB", "WR", "TE", "OL", "K", "P", "DL", "MLB", "ROLB", "LOLB", "CB", "S"];
    for (const slug of slugs) {
      if (!slug) continue;
      try {
        const t = await api(`/api/teams/${slug}`);
        const ul = el("ul");
        for (const pos of order) {
          const ps = t.players.filter((p) => p.position === pos && p.starter).sort((a, b) => b.overall - a.overall);
          if (!ps.length) continue;
          for (const p of ps) {
            const roles = [];
            if (p.slug === t.kick_returner) roles.push("KR");
            if (p.slug === t.punt_returner) roles.push("PR");
            ul.appendChild(el("li", {}, [
              el("span", {}, [el("b", { text: pos }), ` ${p.name}`, roles.length ? el("span", { class: "starter", text: roles.join(" ") }) : null]),
              el("span", { class: "muted", text: `OVR ${p.overall}` }),
            ]));
          }
        }
        const c = t.coaches;
        const coachLine = `HC ${c.head_coach.name} · OC ${c.offensive_coordinator.name || "vacant"} · DC ${c.defensive_coordinator.name || "vacant"}`;
        box.appendChild(el("div", { class: "panel" }, [
          el("h2", { text: `${t.name} starters` }),
          el("div", { class: "muted small-text", text: coachLine }),
          el("div", { class: "muted small-text", text: `Pass rate ${t.tendencies.pass_rate} · tempo ${t.tendencies.tempo} · 4th-down ${t.tendencies.fourth_down_go_rate}` }),
          ul,
        ]));
      } catch (err) {
        box.appendChild(el("div", { class: "panel muted", text: `Could not load ${slug}: ${err.message}` }));
      }
    }
  }

  // ----- history -----------------------------------------------------------

  async function loadHistory() {
    const data = await api("/api/games?limit=150");
    state.history = data.games;
    renderHistory();
    const s = await api("/api/history/summary");
    const box = $("#history-summary");
    if (!s.games) { box.textContent = "No games yet."; return; }
    box.innerHTML = "";
    box.append(
      el("div", {}, [el("b", { text: `${s.games} games` }), ` · ${s.overtime_games} went to OT`]),
      el("div", {}, [`Home teams ${s.home_wins}–${s.games - s.home_wins} · avg ${s.avg_points} combined points`]),
    );
  }

  function renderHistory() {
    const list = $("#history-list");
    list.innerHTML = "";
    for (const g of state.history) {
      const sep = g.venue === "neutral" ? "vs" : "at";
      const li = el("li", { onclick: () => openGame(g.id) }, [
        el("span", { class: "teams" }, [
          `${g.away_name} ${sep} ${g.home_name}`,
          g.overtime_periods ? el("span", { class: "ot", text: `OT${g.overtime_periods > 1 ? g.overtime_periods : ""}` }) : null,
        ]),
        el("span", { class: "score", text: `${g.away_score}–${g.home_score}` }),
        el("span", { class: "when", text: when(g.played_at) + (Object.keys(g.sliders || {}).length ? " · sliders" : "") }),
      ]);
      if (state.currentGame && state.currentGame.id === g.id) li.classList.add("active");
      list.appendChild(li);
    }
  }

  async function openGame(id) {
    try { showGame(await api(`/api/games/${id}`)); }
    catch (err) { toast(`Could not load game: ${err.message}`, 3000); }
  }

  // ----- this week's picks (data/predictions, written by forward_test.py) ----

  async function loadPicks() {
    const box = $("#picks");
    const data = await api("/api/predictions");
    if (!data.week || !data.games.length) { box.hidden = true; return; }
    box.hidden = false;
    try { box.open = localStorage.getItem("cfp.picksOpen") !== "0"; } catch (_) { /* ignore */ }
    const made = new Date(data.created_at);
    $("#picks-title").textContent = `Week ${data.week} picks`;
    $("#picks-sub").textContent = `${data.games.length} games · ${data.sims_per_game} sims each · frozen ${made.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    const list = $("#picks-list");
    list.innerHTML = "";
    for (const g of data.games) {
      const m = g.pred_margin;
      const favSide = m >= 0 ? "home" : "away";
      const fav = g[favSide];
      const favProb = favSide === "home" ? g.home_win_prob : 1 - g.home_win_prob;
      const sep = g.neutral ? "vs" : "at";
      const name = (t) => [t.rank ? el("span", { class: "rank", text: `#${t.rank} ` }) : null, t.name];
      list.appendChild(el("li", {}, [
        el("span", { class: "teams" }, [...name(g.away), ` ${sep} `, ...name(g.home)]),
        el("span", { class: `pick ${favSide}` }, [
          el("b", { text: Math.abs(m) < 0.05 ? "Even" : `${fav.name} by ${Math.abs(m).toFixed(1)}` }),
          el("span", { class: "prob", text: `${Math.round(100 * favProb)}% · total ${g.pred_total.toFixed(0)}` }),
        ]),
        el("button", { class: "ghost small", type: "button", onclick: () => openMatchup(g) }, "Open"),
        el("span", { class: "date", text: g.date }),
      ]));
    }
    const note = $("#picks-note");
    if (data.score && data.score.scored) {
      note.textContent = `Scored: ${Math.round(100 * data.score.straight_up)}% straight up over ${data.score.scored} games, margin error ${data.score.mae} points.`;
    } else {
      note.textContent = "Margin is the average of the sims; the percentage is how often the favorite won them. Open sets the pickers to that game.";
    }
    box.addEventListener("toggle", () => { try { localStorage.setItem("cfp.picksOpen", box.open ? "1" : "0"); } catch (_) { /* ignore */ } });
  }

  function openMatchup(g) {
    if (!state.teamsBySlug[g.home.slug] || !state.teamsBySlug[g.away.slug]) return toast("Teams not loaded yet.", 2000);
    $("#home-select").value = g.home.slug;
    $("#away-select").value = g.away.slug;
    const r = document.querySelector(`input[name="venue"][value="${g.neutral ? "neutral" : "home"}"]`);
    if (r) r.checked = true;
    renderTeamCards();
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast(`${g.away.name} ${g.neutral ? "vs" : "at"} ${g.home.name} is set up. Hit Sim Game.`, 2500);
  }

  // ----- game view ---------------------------------------------------------

  function showGame(g) {
    state.currentGame = g;
    $("#empty").hidden = true;
    $("#batch").hidden = true;
    $("#season").hidden = true;
    $("#season-progress").hidden = true;
    $("#game").hidden = false;
    renderScoreboard(g);
    renderScoring(g);
    renderTeamStats(g);
    renderPlayers(g.home, $("#tab-home"));
    renderPlayers(g.away, $("#tab-away"));
    renderDrives(g);
    selectTab("scoring");
    renderHistory();
    revealResult($("#game"));
  }

  function revealResult(node) {
    // On a phone the history sits above the result, so bring the result into view.
    if (window.innerWidth < 900) {
      requestAnimationFrame(() => {
        const top = node.getBoundingClientRect().top + window.scrollY - 60;  // under the sticky header
        window.scrollTo({ top: Math.max(0, top) });
      });
    } else {
      window.scrollTo({ top: 0 });
    }
  }

  function teamColor(g, side) {
    const t = state.teamsBySlug[g[`${side}_slug`]];
    return t && t.colors && t.colors.primary ? t.colors.primary : (side === "home" ? "#4f8cff" : "#ff6b5a");
  }

  const GAME_IDS = { scoreRow: "#score-row", quarters: "#quarters", meta: "#score-meta", scoring: "#tab-scoring", team: "#tab-team", home: "#tab-home", away: "#tab-away", drives: "#tab-drives" };
  const SBOX_IDS = { scoreRow: "#sbox-score-row", quarters: "#sbox-quarters", meta: "#sbox-meta", scoring: "#sbox-scoring", team: "#sbox-team", home: "#sbox-home", away: "#sbox-away", drives: "#sbox-drives" };

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
          el("td", { class: "name" }, [p.name, el("span", { class: "pos", text: p.position })]),
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

  // ----- batch view --------------------------------------------------------

  function showBatch(data) {
    const s = data.summary;
    $("#empty").hidden = true;
    $("#game").hidden = true;
    $("#season").hidden = true;
    $("#season-progress").hidden = true;
    const box = $("#batch");
    box.hidden = false;
    box.innerHTML = "";
    const sep = s.venue === "neutral" ? "vs" : "at";
    box.append(el("h2", { text: `${s.games} games: ${s.away_name} ${sep} ${s.home_name}` }));
    const tile = (label, value, cls = "") =>
      el("div", { class: "tile" }, [el("div", { class: "label", text: label }), el("div", { class: `value ${cls}`, text: String(value) })]);
    box.append(el("div", { class: "batch-grid" }, [
      tile(`${s.home_name} wins`, `${s.home_wins} (${Math.round((100 * s.home_wins) / s.games)}%)`, "home"),
      tile(`${s.away_name} wins`, `${s.away_wins} (${Math.round((100 * s.away_wins) / s.games)}%)`, "away"),
      tile("Avg margin", `${s.home_name} ${s.avg_margin_home > 0 ? "+" : ""}${s.avg_margin_home}`),
      tile("Avg score", `${s.avg.away.points}–${s.avg.home.points}`),
      tile("Overtime games", s.overtime_games),
      tile("Biggest wins", `${s.biggest_away_win} / ${s.biggest_home_win}`),
    ]));
    const rows = [
      ["Points", "points"], ["Total yards", "total_yards"], ["Pass yards", "pass_yards"], ["Rush yards", "rush_yards"],
      ["Completions / attempts", null, (a) => `${a.completions} / ${a.pass_attempts}`], ["Carries", "carries"],
      ["Turnovers", "turnovers"], ["Sacks (defense)", "sacks"],
    ];
    const table = el("table", { class: "stats compare" });
    table.appendChild(el("tr", {}, [el("th", { class: "away", text: s.away_name }), el("th", { text: "Per game" }), el("th", { class: "home", text: s.home_name })]));
    for (const r of rows) {
      const av = r[1] ? s.avg.away[r[1]] : r[2](s.avg.away);
      const hv = r[1] ? s.avg.home[r[1]] : r[2](s.avg.home);
      table.appendChild(el("tr", {}, [
        el("td", { class: "away", style: "text-align:left", text: String(av) }),
        el("td", { class: "label", style: "text-align:center", text: r[0] }),
        el("td", { class: "home", text: String(hv) }),
      ]));
    }
    box.append(table);
    box.append(el("h3", { text: "Games in this batch" }));
    const list = el("ul", { class: "history-list batch-games" });
    data.games.forEach((g, i) => {
      list.appendChild(el("li", { onclick: () => showGame(g) }, [
        el("span", { class: "teams" }, [`Game ${i + 1}`, g.overtime_periods ? el("span", { class: "ot", text: "OT" }) : null]),
        el("span", { class: "score", text: `${g.away.score}–${g.home.score}` }),
        el("span", { class: "when", text: `${g[g.winner].name} won · ${g.scoring_plays.length} scoring plays` }),
      ]));
    });
    box.append(list);
    revealResult(box);
  }

  // ----- sliders -----------------------------------------------------------

  async function loadSliders() {
    const data = await api("/api/sliders");
    state.sliderDefaults = data.defaults;
    state.sliderGroups = data.groups;
    try {
      const saved = JSON.parse(localStorage.getItem("cfp.sliders") || "{}");
      state.sliders = { ...data.defaults, ...saved };
    } catch (_) {
      state.sliders = { ...data.defaults };
    }
    renderSliders();
    updateSliderButton();
  }

  function renderSliders() {
    const body = $("#sliders-body");
    body.innerHTML = "";
    for (const [group, names] of Object.entries(state.sliderGroups)) {
      const wrap = el("div", { class: "slider-group" }, [el("h3", { text: group })]);
      for (const name of names) {
        const value = state.sliders[name];
        const row = el("div", { class: `slider-row ${value !== state.sliderDefaults[name] ? "changed" : ""}` });
        const lab = el("label", {}, [label(name), el("b", { text: String(value) })]);
        const input = el("input", { type: "range", min: 0, max: 100, value });
        input.addEventListener("input", () => {
          state.sliders[name] = Number(input.value);
          lab.querySelector("b").textContent = input.value;
          row.classList.toggle("changed", state.sliders[name] !== state.sliderDefaults[name]);
          persistSliders();
        });
        row.append(lab, input, el("button", { class: "ghost small", text: "50", type: "button", onclick: () => { input.value = 50; input.dispatchEvent(new Event("input")); } }));
        wrap.appendChild(row);
      }
      body.appendChild(wrap);
    }
  }

  function persistSliders() {
    try { localStorage.setItem("cfp.sliders", JSON.stringify(sliderOverrides())); } catch (_) { /* ignore */ }
    updateSliderButton();
  }

  function updateSliderButton() {
    const n = Object.keys(sliderOverrides()).length;
    $("#btn-sliders").textContent = n ? `Sliders (${n})` : "Sliders";
  }

  // ----- small helpers -----------------------------------------------------

  function selectTab(name) {
    for (const b of $("#tabs").querySelectorAll("button")) b.classList.toggle("active", b.dataset.tab === name);
    for (const t of ["scoring", "team", "home", "away", "drives"]) $(`#tab-${t}`).hidden = t !== name;
  }
  function when(iso) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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

  let toastTimer = null;
  function toast(msg, ms) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(hideToast, ms);
  }
  function hideToast() { $("#toast").hidden = true; }

  // ----- wiring ------------------------------------------------------------

  $("#btn-sim").addEventListener("click", () => runSim(1));
  $("#btn-sim-batch").addEventListener("click", () => {
    const n = Math.max(1, Math.min(500, Number($("#sim-count").value) || 25));
    $("#sim-count").value = n;
    runSim(n);
  });
  $("#btn-swap").addEventListener("click", () => {
    const h = $("#home-select").value;
    $("#home-select").value = $("#away-select").value;
    $("#away-select").value = h;
    renderTeamCards();
  });
  $("#home-select").addEventListener("change", renderTeamCards);
  $("#away-select").addEventListener("change", renderTeamCards);
  for (const r of document.querySelectorAll('input[name="venue"]')) r.addEventListener("change", renderTeamCards);
  $("#btn-clear").addEventListener("click", async () => {
    if (!confirm("Delete all saved games?")) return;
    await api("/api/games", { method: "DELETE" });
    state.currentGame = null;
    $("#game").hidden = true;
    $("#batch").hidden = true;
    $("#empty").hidden = false;
    await loadHistory();
  });
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (b) selectTab(b.dataset.tab);
  });
  $("#btn-sliders").addEventListener("click", () => { $("#sliders-panel").hidden = !$("#sliders-panel").hidden; });
  $("#btn-sliders-close").addEventListener("click", () => { $("#sliders-panel").hidden = true; });
  $("#btn-sliders-reset").addEventListener("click", () => {
    state.sliders = { ...state.sliderDefaults };
    renderSliders();
    persistSliders();
  });


  // ----- season mode -------------------------------------------------------

  const season = { id: null, result: null, timer: null };

  async function startSeason() {
    const team = $("#home-select").value;
    const mode = $("#season-mode").value;
    if (!team) return toast("Pick your team in the Home box first.", 2500);
    $("#btn-season").disabled = true;
    try {
      let data;
      try {
        data = await api("/api/season", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ team, mode }) });
      } catch (err) {
        if (String(err.message).startsWith("409")) {
          const j = await api("/api/season");
          if (j.running) { data = { id: j.running.id }; toast("A season is already running; showing its progress.", 3000); }
          else throw err;
        } else throw err;
      }
      season.id = data.id;
      $("#empty").hidden = true; $("#game").hidden = true; $("#batch").hidden = true; $("#season").hidden = true;
      $("#season-progress").hidden = false;
      const what = mode === "full" ? "full season" : "remaining schedule";
      $("#season-progress-title").textContent = `Simulating the ${what} for ${state.teamsBySlug[team].name} and every other game`;
      $("#season-progress-bar").style.width = "0%";
      $("#season-progress-text").textContent = "Starting…";
      revealResult($("#season-progress"));
      pollSeason();
    } catch (err) {
      toast(`Season failed to start: ${err.message}`, 4000);
      $("#btn-season").disabled = false;
    }
  }

  function pollSeason() {
    clearTimeout(season.timer);
    season.timer = setTimeout(async () => {
      try {
        const j = await api(`/api/season/${season.id}`);
        if (j.status === "running") {
          const pct = j.total ? Math.round((100 * j.done) / j.total) : 0;
          $("#season-progress-bar").style.width = `${pct}%`;
          $("#season-progress-text").textContent = `${j.done} of ${j.total} games simulated`;
          pollSeason();
        } else if (j.status === "done") {
          $("#btn-season").disabled = false;
          showSeason(j.result);
          loadSeasons();
        } else {
          $("#btn-season").disabled = false;
          toast(`Season failed: ${j.error || "unknown error"}`, 5000);
          $("#season-progress").hidden = true;
        }
      } catch (err) {
        $("#btn-season").disabled = false;
        toast(`Lost contact with the season sim: ${err.message}`, 5000);
      }
    }, 800);
  }

  function showSeason(r) {
    season.result = r;
    season.id = r.id;
    $("#empty").hidden = true; $("#game").hidden = true; $("#batch").hidden = true; $("#season-progress").hidden = true;
    $("#season").hidden = false;
    const rec = r.my_record;
    $("#season-title").innerHTML = "";
    $("#season-title").append(r.team_name, el("span", { class: "rec", text: `${rec.wins}-${rec.losses}` }),
      el("span", { class: "muted", style: "font-size:14px;margin-left:8px", text: `${rec.conf_wins}-${rec.conf_losses} ${r.conference}` }));
    const how = r.mode === "full" ? "Full season simulated from week 1" : "Real results kept through today, rest simulated";
    $("#season-meta").textContent = `${how} · ${r.games_simulated} games in ${r.elapsed_s}s · ${when(r.created_at)}`;
    renderSeasonSchedule(r);
    renderStandings(r);
    renderTop25(r);
    $("#season-tabs button[data-stab='box']").hidden = true;
    selectSeasonTab("schedule");
    revealResult($("#season"));
  }

  function renderSeasonSchedule(r) {
    const box = $("#stab-schedule");
    box.innerHTML = "";
    const table = el("table", { class: "stats" });
    table.appendChild(el("tr", {}, ["Week", "Opponent", "Where", "Result", "Score", ""].map((h) => el("th", { text: h, style: h === "Opponent" ? "text-align:left" : "" }))));
    for (const g of r.my_record.results) {
      const prefix = g.venue === "away" ? "at" : g.venue === "neutral" ? "vs (neutral)" : "vs";
      const tr = el("tr", { class: g.has_box ? "clickable" : "" }, [
        el("td", { text: g.week == null ? "" : String(g.week) }),
        el("td", { style: "text-align:left", text: `${prefix} ${g.opponent_name}` }),
        el("td", { text: g.venue === "home" ? "Home" : g.venue === "away" ? "Away" : "Neutral" }),
        el("td", { class: g.won ? "win" : "loss", text: g.won ? "W" : "L" }),
        el("td", { text: `${g.points_for}–${g.points_against}${g.overtime ? " OT" : ""}` }),
        el("td", { class: "muted", text: g.real ? "real result" : g.has_box ? "box score" : "" }),
      ]);
      if (g.has_box) tr.addEventListener("click", () => openSeasonBox(g.event_id));
      table.appendChild(tr);
    }
    box.appendChild(table);
  }

  function standingsTable(rows, mine) {
    const table = el("table", { class: "stats" });
    table.appendChild(el("tr", {}, ["#", "Team", "Conf", "Overall", "PF", "PA"].map((h) => el("th", { text: h, style: h === "Team" ? "text-align:left" : "" }))));
    for (const t of rows) {
      table.appendChild(el("tr", { class: t.slug === mine ? "mine" : "" }, [
        el("td", { text: String(t.conf_rank) }),
        el("td", { style: "text-align:left", class: "name", text: t.name }),
        el("td", { text: `${t.conf_wins}-${t.conf_losses}` }),
        el("td", { text: `${t.wins}-${t.losses}` }),
        el("td", { text: String(t.points_for) }),
        el("td", { text: String(t.points_against) }),
      ]));
    }
    return table;
  }

  function renderStandings(r) {
    const box = $("#stab-standings");
    box.innerHTML = "";
    const confs = Object.keys(r.standings).sort((a, b) => (a === r.conference ? -1 : b === r.conference ? 1 : a.localeCompare(b)));
    const grid = el("div", { class: "conf-grid" });
    for (const conf of confs) {
      grid.appendChild(el("div", { class: "conf-block" }, [el("h3", { text: conf }), standingsTable(r.standings[conf], r.team)]));
    }
    box.appendChild(grid);
  }

  function renderTop25(r) {
    const box = $("#stab-top25");
    box.innerHTML = "";
    box.appendChild(el("p", { class: "muted small-text", text: "Ordered by winning percentage, then point differential. No committee, no strength of schedule." }));
    const table = el("table", { class: "stats" });
    table.appendChild(el("tr", {}, ["#", "Team", "Conference", "Record", "PF", "PA"].map((h) => el("th", { text: h, style: ["Team", "Conference"].includes(h) ? "text-align:left" : "" }))));
    r.top25.forEach((t, i) => {
      table.appendChild(el("tr", { class: t.slug === r.team ? "mine" : "" }, [
        el("td", { text: String(i + 1) }), el("td", { style: "text-align:left", class: "name", text: t.name }),
        el("td", { style: "text-align:left", class: "muted", text: t.conference }), el("td", { text: `${t.wins}-${t.losses}` }),
        el("td", { text: String(t.points_for) }), el("td", { text: String(t.points_against) }),
      ]));
    });
    box.appendChild(table);
  }

  async function openSeasonBox(eventId) {
    try {
      const g = await api(`/api/season/${season.id}/game/${eventId}`);
      renderScoreboard(g, SBOX_IDS);
      renderScoring(g, SBOX_IDS);
      renderTeamStats(g, SBOX_IDS);
      renderPlayers(g.home, $("#sbox-home"));
      renderPlayers(g.away, $("#sbox-away"));
      renderDrives(g, SBOX_IDS);
      $("#season-tabs button[data-stab='box']").hidden = false;
      selectSeasonTab("box");
      selectBoxTab("scoring");
    } catch (err) {
      toast(`Could not load that game: ${err.message}`, 3000);
    }
  }

  function selectSeasonTab(name) {
    for (const b of $("#season-tabs").querySelectorAll("button")) b.classList.toggle("active", b.dataset.stab === name);
    for (const t of ["schedule", "standings", "top25", "box"]) $(`#stab-${t}`).hidden = t !== name;
  }
  function selectBoxTab(name) {
    for (const b of $("#sbox-tabs").querySelectorAll("button")) b.classList.toggle("active", b.dataset.btab === name);
    for (const t of ["scoring", "team", "home", "away", "drives"]) $(`#sbox-${t}`).hidden = t !== name;
  }

  async function loadSeasons() {
    try {
      const data = await api("/api/seasons");
      const list = $("#season-list");
      list.innerHTML = "";
      if (!data.seasons.length) list.appendChild(el("li", { class: "muted", text: "No seasons yet." }));
      for (const s of data.seasons) {
        list.appendChild(el("li", { onclick: async () => { try { showSeason((await api(`/api/season/${s.id}`)).result); } catch (err) { toast(err.message, 3000); } } }, [
          el("span", { class: "teams", text: `${s.team_name} ${s.mode === "full" ? "season" : "rest of season"}` }),
          el("span", { class: "score", text: `${s.wins}-${s.losses}` }),
          el("span", { class: "when", text: `${s.conf_wins}-${s.conf_losses} conf · ${when(s.created_at)}` }),
        ]));
      }
    } catch (_) { /* seasons list is optional */ }
  }

  $("#btn-season").addEventListener("click", startSeason);
  // Attach to a season that is already simulating (page reload, or started from another device).
  api("/api/season").then((j) => {
    if (!j.running) return;
    season.id = j.running.id;
    $("#empty").hidden = true; $("#game").hidden = true; $("#batch").hidden = true; $("#season").hidden = true;
    $("#season-progress").hidden = false;
    const t = state.teamsBySlug[j.running.team];
    $("#season-progress-title").textContent = `Simulating the season for ${t ? t.name : j.running.team}`;
    $("#btn-season").disabled = true;
    pollSeason();
  }).catch(() => {});
  $("#season-tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-stab]"); if (b) selectSeasonTab(b.dataset.stab); });
  $("#sbox-tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-btab]"); if (b) selectBoxTab(b.dataset.btab); });
  loadSeasons();

  loadSliders().catch((err) => toast(`Sliders unavailable: ${err.message}`, 4000));
  loadTeams().catch((err) => toast(`Teams unavailable: ${err.message}`, 4000));
  loadHistory().catch((err) => toast(`History unavailable: ${err.message}`, 4000));
  loadPicks().catch(() => { $("#picks").hidden = true; });
})();
