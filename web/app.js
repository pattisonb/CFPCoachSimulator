/* CFP Coach Simulator front end: pick two teams and a venue, run games through the API,
   and show the results. */
(function () {
  "use strict";

  const { $, el, GAME_IDS, SBOX_IDS, teamColor, renderScoreboard, renderScoring, renderTeamStats, renderPlayers, renderDrives,
          label, quarterName, kindLabel, resultLabel, fieldPos, fmtTime } = window.CFP;

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
    for (const t of data.teams) { state.teamsBySlug[t.slug] = t; window.CFP.teamsBySlug[t.slug] = t; }
    for (const id of ["home-select", "away-select"]) {
      const sel = document.getElementById(id);
      sel.innerHTML = "";
      // FBS teams alphabetically, then the FCS stand-ins in their own group (the API sorts by name)
      let fcs = null;
      for (const t of data.teams) {
        const opt = el("option", { value: t.slug, text: `${t.name} (${t.ratings.overall.toFixed(0)})${t.fictional ? "" : " · " + t.conference}` });
        if (t.fictional) { if (!fcs) { fcs = el("optgroup", { label: "FCS" }); sel.appendChild(fcs); } fcs.appendChild(opt); }
        else sel.appendChild(opt);
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
          el("b", { text: `${fav.name} by ${Math.max(1, Math.round(Math.abs(m)))}` }),
          el("span", { class: "prob", text: `${Math.round(100 * favProb)}% · total ${g.pred_total.toFixed(0)}` }),
        ]),
        el("button", { class: "ghost small", type: "button", onclick: () => openMatchup(g) }, "Open"),
        el("span", { class: "date", text: g.date }),
      ]));
    }
    const note = $("#picks-note");
    if (data.score && data.score.scored) {
      const a = data.score.ats;
      const atsText = a && a.games_with_line ? `, ${a.wins}-${a.losses}${a.pushes ? "-" + a.pushes : ""} against the closing spread` : "";
      note.textContent = `Scored: ${Math.round(100 * data.score.straight_up)}% straight up over ${data.score.scored} games${atsText}, margin error ${data.score.mae} points.`;
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
    $("#game").hidden = false;
    renderScoreboard(g);
    renderScoring(g);
    renderTeamStats(g);
    renderPlayers(g.home, $("#tab-home"));
    renderPlayers(g.away, $("#tab-away"));
    $("#tabs button[data-tab=home]").textContent = `${g.home.name} players`;   // the tabs name the teams
    $("#tabs button[data-tab=away]").textContent = `${g.away.name} players`;
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









  // ----- batch view --------------------------------------------------------

  function showBatch(data) {
    const s = data.summary;
    $("#empty").hidden = true;
    $("#game").hidden = true;
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


  // ----- season mode lives on its own page -----------------------------------
  $("#btn-season").addEventListener("click", () => {
    const team = $("#home-select").value;
    const mode = $("#season-mode").value;
    if (!team) return toast("Pick your team in the Home box first.", 2500);
    window.location.href = `/season?team=${encodeURIComponent(team)}&mode=${mode}`;
  });

  loadSliders().catch((err) => toast(`Sliders unavailable: ${err.message}`, 4000));
  loadTeams().catch((err) => toast(`Teams unavailable: ${err.message}`, 4000));
  loadHistory().catch((err) => toast(`History unavailable: ${err.message}`, 4000));
  loadPicks().catch(() => { $("#picks").hidden = true; });
})();
