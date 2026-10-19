/* Season page: play a season week by week with polls, standings, the bracket and the playoff. */
(function () {
  "use strict";
  const { $, el, SBOX_IDS, teamPill, renderScoreboard, renderScoring, renderTeamStats, renderPlayers, renderDrives } = window.CFP;

  const state = { teams: [], season: null, viewWeek: null, tab: "schedule", poll: "ap", timer: null, standings: null };

  async function api(path, options) {
    const res = await fetch(path, options);
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  }
  let toastTimer = null;
  function toast(msg, ms) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); if (ms) toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }
  function when(iso) { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  function name(slug) { const t = window.CFP.teamsBySlug[slug]; return t ? t.name : slug; }
  function color(slug) { const t = window.CFP.teamsBySlug[slug]; return t && t.colors && t.colors.primary ? t.colors.primary : "#888"; }

  // ----- setup -------------------------------------------------------------

  async function loadTeams() {
    const data = await api("/api/teams");
    state.teams = data.teams;
    const sel = $("#pick-team");
    // one alphabetical list (the API sorts by name); the conference rides in the label
    for (const t of data.teams) {
      window.CFP.teamsBySlug[t.slug] = t;
      if (!t.fictional) sel.appendChild(el("option", { value: t.slug, text: `${t.name} (${t.ratings.overall.toFixed(0)}) · ${CONF_SHORT[t.conference] || t.conference}` }));
    }
    const params = new URLSearchParams(location.search);
    if (params.get("team") && window.CFP.teamsBySlug[params.get("team")]) sel.value = params.get("team");
    else sel.value = "ohio-state";
    if (params.get("mode")) $("#pick-mode").value = params.get("mode");
  }

  async function loadSeasons() {
    const data = await api("/api/seasons");
    const list = $("#season-list");
    list.innerHTML = "";
    if (!data.seasons.length) list.appendChild(el("li", { class: "muted", text: "No seasons yet." }));
    for (const s of data.seasons) {
      const del = el("button", { class: "del", type: "button", title: "Delete this season", "aria-label": "Delete this season", text: "×" });
      del.addEventListener("click", (e) => { e.stopPropagation(); deleteSeason(s); });
      const li = el("li", { onclick: () => openSeason(s.id) }, [
        el("span", { class: "teams", text: `${s.team_name} · ${s.mode === "full" ? "full" : "rest of season"}` }),
        el("span", { class: "score", text: `${s.wins}-${s.losses}` }),
        el("span", { class: "when", text: `${s.done ? `done · champion ${s.champion_name}` : `through week ${s.current_week}`} · ${when(s.created_at)}` }),
        del,
      ]);
      if (state.season && state.season.id === s.id) li.classList.add("active");
      list.appendChild(li);
    }
    $("#btn-seasons").textContent = data.seasons.length ? `Seasons (${data.seasons.length})` : "Seasons";
    $("#btn-clear-seasons").hidden = !data.seasons.length;
  }

  // An API error as a sentence: FastAPI sends {"detail": "..."} after the status code.
  function errText(err) {
    const m = /^(\d{3}) (.*)$/s.exec(err.message || "");
    if (!m) return err.message;
    try { return JSON.parse(m[2]).detail || m[2]; } catch (e) { return m[2] || m[1]; }
  }
  const isGone = (err) => /^404\b/.test(err.message || "");

  // The server no longer has this season: the free host forgets saved seasons when it
  // restarts. Close it and say so instead of leaving the page waiting.
  function seasonGone() {
    closeSeason();
    loadSeasons().catch(() => {});
    toast("This season is no longer on the server. It forgets saved seasons when it restarts, so start a new one.", 9000);
  }

  // A sim request failed: put the page back the way it was, with the season reloaded so the
  // buttons and week strip match the server again.
  async function simFailed(err, what) {
    clearTimeout(state.timer);
    state.gamedayWanted = false;
    hideSimOverlay();
    setBusy(false);
    if (isGone(err)) return seasonGone();
    toast(`${what}: ${errText(err)}`, 5000);
    try { showSeason(await api(`/api/season/${state.season.id}`)); }
    catch (e) { if (isGone(e)) seasonGone(); }
  }

  function closeSeason() {
    clearTimeout(state.timer);
    state.season = null;
    applyTeamTheme(null);
    state.viewWeek = null;
    $("#season").hidden = true;
    $("#season-empty").hidden = false;
    history.replaceState(null, "", "/season");
    setSidebar(true, false);
  }

  async function deleteSeason(s) {
    const label = `${s.team_name} ${s.wins}-${s.losses} (${s.done ? "complete" : `through week ${s.current_week}`})`;
    if (!confirm(`Delete the ${label} season? This cannot be undone.`)) return;
    try {
      await api(`/api/season/${s.id}`, { method: "DELETE" });
      if (state.season && state.season.id === s.id) closeSeason();
      await loadSeasons();
      toast("Season deleted");
    } catch (err) { toast(`Could not delete: ${err.message}`, 4000); }
  }

  async function clearSeasons() {
    if (!confirm("Delete every saved season? This cannot be undone.")) return;
    try {
      const r = await api("/api/seasons", { method: "DELETE" });
      closeSeason();
      await loadSeasons();
      toast(r.kept ? `Deleted ${r.removed} seasons; ${r.kept} still simulating` : `Deleted ${r.removed} seasons`);
    } catch (err) { toast(`Could not clear: ${err.message}`, 4000); }
  }

  // The Seasons sidebar hides once a season is open so the season takes the full width;
  // the toolbar button brings it back, and the choice is remembered.
  function setSidebar(show, remember = true) {
    document.querySelector(".season-layout").classList.toggle("side-hidden", !show);
    $("#btn-seasons").setAttribute("aria-pressed", show ? "true" : "false");
    if (remember) { try { localStorage.setItem("cfp.seasonSide", show ? "1" : "0"); } catch (e) { /* private mode */ } }
  }

  function sidebarPreferred() {
    try { return localStorage.getItem("cfp.seasonSide"); } catch (e) { return null; }
  }

  async function newSeason() {
    const team = $("#pick-team").value, mode = $("#pick-mode").value;
    $("#btn-new").disabled = true;
    try {
      const s = await api("/api/season", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ team, mode }) });
      history.replaceState(null, "", `/season?id=${s.id}`);
      showSeason(s);
      loadSeasons();
    } catch (err) { toast(`Could not start the season: ${err.message}`, 4000); }
    finally { $("#btn-new").disabled = false; }
  }

  async function openSeason(id) {
    try {
      const s = await api(`/api/season/${id}`);
      if (s.mode !== "real") history.replaceState(null, "", `/season?id=${s.id}`);
      showSeason(s);
      if (s.mode !== "real") loadSeasons();
    } catch (err) {
      if (isGone(err) && !REAL) { closeSeason(); loadSeasons().catch(() => {}); toast("That season is no longer on the server. It forgets saved seasons when it restarts.", 8000); }
      else toast(`Could not open the season: ${errText(err)}`, 4000);
    }
  }

  // ----- the real 2026 season (/real) ------------------------------------------------
  const REAL = location.pathname === "/real";
  const REAL_ID = "real-2026";

  // The real page follows no team: the season is shown league-wide (Games first), and the
  // Schedule and Stats tabs pick a team inside the tab. The server still stores a team for
  // the state's sake; the page drops it so nothing is marked "yours".
  function leagueWide(s) {
    s.team = null;
    s.my_rank = null;
    return s;
  }

  // the team at the top of the latest AP poll: the Schedule tab's first team on the real page
  function topTeam(s) {
    for (let w = s.current_week; w >= 0; w--) {
      const ap = ((s.polls || {})[String(w)] || {}).ap;
      if (ap && ap.length) return ap[0].team;
    }
    return null;
  }

  async function refreshReal() {
    const b = $("#btn-real-refresh");
    b.disabled = true;
    b.textContent = "Downloading the latest results…";
    try {
      await api("/api/real/refresh", { method: "POST" });
      for (;;) {
        await new Promise((r) => setTimeout(r, 4000));
        const j = await api("/api/real/refresh");
        if (j.status !== "running") { if (j.status === "error") throw new Error(j.error); break; }
      }
      toast("Real data refreshed.", 2500);
      await openSeason(REAL_ID);
    } catch (err) { toast(`Refresh failed: ${err.message}`, 5000); }
    b.disabled = false;
    b.textContent = "Refresh real data";
  }

  // a real NCAA box score: the score, the team stats side by side, each team's players by category
  function renderRealBox(g) {
    const s = state.season;
    const node = el("div", { class: "real-box" });
    const sides = [["away", g.away], ["home", g.home]];
    const won = (side) => g[side].score > g[side === "home" ? "away" : "home"].score;
    node.append(el("div", { class: "real-box-score" }, sides.map(([side, t]) => el("div", { class: `real-box-team ${won(side) ? "win" : ""}` }, [
      teamPill(t.slug), el("span", { class: "name", text: t.name }), el("span", { class: "pts", text: String(t.score) })]))));
    const T = (t, k) => t.team[k] || 0;
    const E = (t, k) => (t.events || {})[k] || 0;
    const rows = [
      ["Total yards", (t) => T(t, "Pass Yards") + T(t, "Rush Yards")], ["Plays", (t) => t.plays || 0],
      ["Passing", (t) => `${T(t, "Completions")}/${T(t, "Pass Attempts")}, ${T(t, "Pass Yards")}`], ["Rushing", (t) => `${T(t, "Carries")}, ${T(t, "Rush Yards")}`],
      ["First downs", (t) => E(t, "first_downs")], ["Third downs", (t) => `${E(t, "third_down_conversions")}/${E(t, "third_downs")}`],
      ["Fourth downs", (t) => `${E(t, "fourth_down_conversions")}/${E(t, "fourth_down_attempts")}`],
      ["Turnovers", (t) => T(t, "Interceptions Thrown") + E(t, "fumbles_lost")], ["Sacks", (t) => T(t, "Sacks")],
      ["Penalties", (t) => `${E(t, "penalties")}-${E(t, "penalty_yards")}`],
    ];
    const ts = el("table", { class: "stats real-team-stats" });
    ts.append(el("tr", {}, [el("th", { class: "left", text: g.away.name }), el("th", { text: "" }), el("th", { text: g.home.name })]));
    for (const [label, f] of rows) ts.append(el("tr", {}, [el("td", { class: "left", text: String(f(g.away)) }), el("td", { class: "muted", style: "text-align:center", text: label }), el("td", { text: String(f(g.home)) })]));
    node.append(el("h4", { text: "Team stats" }), el("div", { class: "table-scroll" }, [ts]));
    const n = (p, k) => p.stats[k] || 0;
    const cats = [
      ["Passing", (p) => n(p, "pass_attempts"), [["C/ATT", (p) => `${n(p, "completions")}/${n(p, "pass_attempts")}`], ["YDS", (p) => n(p, "pass_yards")], ["TD", (p) => n(p, "passing_touchdowns")], ["INT", (p) => n(p, "interceptions_thrown")], ["LONG", (p) => n(p, "long_pass")]], "pass_yards"],
      ["Rushing", (p) => n(p, "carries"), [["CAR", (p) => n(p, "carries")], ["YDS", (p) => n(p, "rush_yards")], ["AVG", (p) => (n(p, "rush_yards") / n(p, "carries")).toFixed(1)], ["TD", (p) => n(p, "rushing_touchdowns")], ["LONG", (p) => n(p, "long_rush")]], "rush_yards"],
      ["Receiving", (p) => n(p, "receptions"), [["REC", (p) => n(p, "receptions")], ["YDS", (p) => n(p, "receiving_yards")], ["TD", (p) => n(p, "receiving_touchdowns")], ["LONG", (p) => n(p, "long_reception")]], "receiving_yards"],
      ["Defense", (p) => n(p, "solo_tackles") + n(p, "assisted_tackles") + n(p, "sacks") + n(p, "interceptions"), [["TKL", (p) => n(p, "solo_tackles") + n(p, "assisted_tackles")], ["SOLO", (p) => n(p, "solo_tackles")], ["TFL", (p) => n(p, "tackles_for_loss")], ["SACK", (p) => n(p, "sacks")], ["INT", (p) => n(p, "interceptions")], ["FF", (p) => n(p, "forced_fumbles")]], "solo_tackles"],
      ["Kicking", (p) => n(p, "fg_attempted") + n(p, "pat_attempts"), [["FG", (p) => `${n(p, "fg_made")}/${n(p, "fg_attempted")}`], ["LONG", (p) => n(p, "long_fg")], ["PAT", (p) => `${n(p, "pat_made")}/${n(p, "pat_attempts")}`]], "fg_made"],
      ["Punting", (p) => n(p, "punts"), [["PUNTS", (p) => n(p, "punts")], ["YDS", (p) => n(p, "punt_yards")], ["AVG", (p) => (n(p, "punt_yards") / n(p, "punts")).toFixed(1)], ["LONG", (p) => n(p, "long_punt")]], "punt_yards"],
      ["Returns", (p) => n(p, "kickoff_returns") + n(p, "punt_returns"), [["KR", (p) => `${n(p, "kickoff_returns")}-${n(p, "kickoff_return_yards")}`], ["PR", (p) => `${n(p, "punt_returns")}-${n(p, "punt_return_yards")}`], ["TD", (p) => n(p, "kickoff_return_touchdowns") + n(p, "punt_return_touchdowns")]], "kickoff_return_yards"],
    ];
    const pick = { side: "away" };
    const chips = chipRow(sides.map(([side, t]) => [side, t.name]), pick.side, (v) => { pick.side = v; draw(); });
    const body = el("div");
    function draw() {
      body.innerHTML = "";
      const t = g[pick.side];
      for (const [title, has, cols, sortKey] of cats) {
        const players = t.players.filter((p) => has(p) > 0).sort((a, b) => n(b, sortKey) - n(a, sortKey));
        if (!players.length) continue;
        const tb = el("table", { class: "stats" });
        tb.append(el("tr", {}, [el("th", { class: "left", text: title }), ...cols.map(([h]) => el("th", { text: h }))]));
        for (const p of players) tb.append(el("tr", {}, [el("td", { class: "left name" }, [el("span", { text: p.name, ...playerAttrs(t.slug, p.name, p.position) }), el("span", { class: "pos", text: `${p.number != null ? "#" + p.number + " " : ""}${p.position}` })]), ...cols.map(([, f]) => el("td", { text: String(f(p)) }))]));
        body.append(el("div", { class: "table-scroll" }, [tb]));
      }
    }
    draw();
    node.append(el("h4", { text: "Players" }), chips, body, el("p", { class: "muted small-text", text: "Real box score from NCAA.com. A player name opens his page with his real season." }));
    const title = el("span", {}, [teamPill(g.away.slug), `${g.away.name} ${g.away.score}`, el("span", { class: "muted", text: " at " }), teamPill(g.home.slug), `${g.home.name} ${g.home.score}`, el("span", { class: "muted small-text", text: " · Final" })]);
    openModal(title, node);
  }

  // ----- advancing ---------------------------------------------------------

  // Game day: only your game is simulated, then it replays drive by drive. Advance then
  // plays the rest of the week (or the whole week, if you skipped game day).
  async function playGameDay() {
    const s = state.season;
    if (!s || s.done) return;
    state.advanceFrom = s.current_week;
    state.simming = true;
    state.simResults = [];
    state.simTarget = s.current_week + 1;
    state.gamedayWanted = true;
    setBusy(true);
    showProgress({ status: "running", done: s.current_week, total: s.current_week + 1, stage: "Simming your game", week: s.current_week + 1 });
    try {
      await api(`/api/season/${s.id}/gameday`, { method: "POST" });
      poll();
    } catch (err) { simFailed(err, "Could not play the game"); }
  }

  async function advance(to) {
    const s = state.season;
    if (!s || s.done) return;
    // the highlighted week is the one Advance plays: a week further ahead sims through to it
    if (!to && state.viewWeek > s.current_week + 1) to = state.viewWeek;
    state.gamedayWanted = false;
    state.advanceFrom = s.current_week;
    state.simming = true;
    state.simResults = [];
    state.simTarget = to || s.current_week + 1;
    setBusy(true);
    showProgress({ status: "running", done: s.current_week, total: to || s.current_week + 1, stage: "Starting", week: s.current_week + 1 });
    try {
      await api(`/api/season/${s.id}/advance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(to ? { to } : {}) });
      poll();
    } catch (err) { simFailed(err, "Could not advance"); }
  }

  function poll() {
    clearTimeout(state.timer);
    state.timer = setTimeout(async () => {
      try {
        const j = await api(`/api/season/${state.season.id}/status?since=${state.advanceFrom != null ? state.advanceFrom : state.season.current_week}`);
        if (j.status === "running") {
          showProgress(j);
          poll();
        } else {
          if (j.paused) toast("Paused. Advance when you are ready.", 3000);
          hideSimOverlay();
          if (j.status === "error") toast(`Simulation error: ${j.error}`, 6000);
          const s = await api(`/api/season/${state.season.id}`);
          state.viewWeek = s.done ? s.current_week : Math.min(s.current_week + 1, 20);
          const gdEvent = state.gamedayWanted && j.status !== "error" ? j.gameday_event : null;
          const mine = gdEvent ? (j.results || []).find((r) => r.event_id === gdEvent) : null;
          state.gamedayWanted = false;
          showSeason(s);
          loadSeasons();
          setBusy(false);
          if (gdEvent) openGameDay(gdEvent, mine);
        }
        state.pollMisses = 0;
      } catch (err) {
        // a slow or dropped check (a busy server, a phone switching networks) is retried;
        // only a missing season or five misses in a row end the wait
        state.pollMisses = (state.pollMisses || 0) + 1;
        if (!isGone(err) && state.pollMisses < 5) { poll(); return; }
        state.pollMisses = 0;
        simFailed(err, "Lost track of the sim");
      }
    }, 500);
  }

  function setBusy(b) {
    if (!b) state.simming = false;
    for (const id of ["btn-advance", "btn-to-selection", "btn-to-end", "btn-gameday"]) $(`#${id}`).disabled = b || (state.season && state.season.done);
    $("#btn-settings").disabled = b;
    for (const chip of document.querySelectorAll("#week-strip .week-chip")) chip.disabled = b;
    $("#btn-new").disabled = b;
    $("#season-list").classList.toggle("locked", b);
    document.body.classList.toggle("simming", b);   // tabs, chips, pills and the toolbar ignore clicks
    if (!b) { $("#season-progress").hidden = true; $("#season-progress-text").hidden = true; $("#season-progress-bar").style.width = "0%"; }
  }

  // Progress while simming: weeks completed plus the fraction of the current week's games,
  // and a line saying what the sim is doing right now.
  function showProgress(j) {
    const s = state.season;
    const from = state.advanceFrom != null ? state.advanceFrom : Math.max(0, j.done - 1);
    const span = Math.max(1, j.total - from);
    const frac = j.games_total ? j.games_done / j.games_total : 0;
    const pct = Math.min(100, Math.round((100 * (j.done - from + frac)) / span));
    $("#season-progress").hidden = false;
    $("#season-progress-bar").style.width = `${pct}%`;
    const label = j.week ? (s.week_labels[j.week] || `Week ${j.week}`) : "";
    const text = $("#season-progress-text");
    text.innerHTML = "";
    const stage = j.stage || "Simming";
    const simming = /^Simming/.test(stage);
    text.append(el("b", { text: simming ? stage : `${label ? label + " · " : ""}${stage}` }));
    if (simming && j.games_total) text.append(` · ${j.games_done} of ${j.games_total} games`);
    if (span > 1) text.append(` · ${Math.max(0, j.done - from)} of ${span} weeks done`);
    text.append(` · ${pct}%`);
    text.hidden = false;
    $("#btn-advance").textContent = "Simming…";
    if (span > 1) showSimOverlay(j, pct, span, from);
  }

  // A multi-week sim hides the tabs and shows what is happening: the stage, the bar, your
  // record ticking up in the header, each of your results as it lands, and a Pause button.
  function showSimOverlay(j, pct, span, from) {
    const s = state.season;
    const ov = $("#sim-overlay");
    if (ov.hidden) {
      ov.hidden = false;
      $("#season-tabs").hidden = true;
      for (const t of document.querySelectorAll(".season-main .tab-body, #tab-box")) t.hidden = true;
      $("#sim-results").innerHTML = "";
      state.simShown = new Set();
      $("#btn-pause").disabled = false;
      $("#btn-pause").textContent = "Pause after this week";
    }
    const label = j.week ? (s.week_labels[j.week] || `Week ${j.week}`) : "";
    const stage = j.stage || "Simming";
    $("#sim-stage").textContent = /^Simming/.test(stage) ? stage : `${label} · ${stage}`;
    $("#sim-overlay .review-label").textContent = `Simming through ${s.week_labels[j.total] || "week " + j.total}`;
    $("#sim-sub").textContent = `${Math.max(0, j.done - from)} of ${span} weeks done${j.games_total ? ` · ${j.games_done} of ${j.games_total} games this week` : ""} · ${pct}%`;
    $("#sim-bar").style.width = `${pct}%`;
    if (j.record) {
      const rec = $("#season-title .rec");
      if (rec) rec.textContent = `${j.record.wins}-${j.record.losses}`;
      const conf = $("#season-title .conf-rec");
      if (conf) conf.textContent = `${j.record.conf_wins}-${j.record.conf_losses} ${s.conference}`;
    }
    // the week strip follows the sim
    if (j.done !== state.simLastDone) { state.simLastDone = j.done; state.viewWeek = j.done; state.season.current_week = j.done; renderWeekStrip(); $("#btn-advance").textContent = "Simming…"; }
    for (const r of j.results || []) {
      const key = `${r.week}|${r.opponent}`;
      if (state.simShown.has(key)) continue;
      state.simShown.add(key);
      const vs = r.venue === "away" ? "at" : "vs";
      const row = el("div", { class: `sim-result new ${r.won ? "win" : "loss"}` }, [
        el("span", { class: "muted", text: s.week_labels[r.week] && r.week > 14 ? (s.week_labels[r.week] || "").replace("Championship week", "CCG").replace(" & bowls", "").replace(" & New Year bowls", "") : `Week ${r.week}` }),
        el("span", { class: "wl", text: r.won ? "W" : "L" }),
        el("span", {}, [`${vs} `, teamPill(r.opponent), r.opponent_name, r.title ? el("span", { class: "muted small-text", text: ` · ${r.title}` }) : null]),
        el("span", { class: "score", text: `${r.points_for}–${r.points_against}${r.overtime ? " OT" : ""}` }),
      ]);
      $("#sim-results").prepend(row);
    }
  }

  function hideSimOverlay() {
    const ov = $("#sim-overlay");
    if (ov.hidden) return;
    ov.hidden = true;
    $("#season-tabs").hidden = false;
    selectTab(state.tab === "box" ? "games" : state.tab);
  }

  async function pauseSim() {
    const s = state.season;
    if (!s) return;
    try {
      const r = await api(`/api/season/${s.id}/pause`, { method: "POST" });
      if (r.stopping) { $("#btn-pause").disabled = true; $("#btn-pause").textContent = "Pausing after this week…"; }
    } catch (err) { toast(`Could not pause: ${err.message}`, 3000); }
  }

  // ----- rendering ---------------------------------------------------------

  // ----- team colours --------------------------------------------------------
  // While a season is open the page takes the team's colours: the accent (buttons, chips,
  // progress, highlights) is the first of the team's colours that reads against the page
  // background in the current light/dark theme, else the primary lightened or darkened
  // until it does; the ink on it is black or white, whichever contrasts more. The top
  // bar and season header get a tint of the primary. Every team ends up legible.
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(rgb) { return "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join(""); }
  function luminance(rgb) {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  }
  function contrast(a, b) { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
  function mix(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }
  function cssRgb(name) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return hexToRgb(v) || (v.startsWith("rgb") ? v.match(/\d+/g).slice(0, 3).map(Number) : null);
  }

  function teamTheme(colors) {
    const bg = cssRgb("--bg") || [11, 16, 32];
    const panel = cssRgb("--panel") || bg;
    const light = luminance(bg) > 0.5;
    const reads = (rgb) => Math.min(contrast(rgb, bg), contrast(rgb, panel)) >= 2.6;
    const candidates = [colors.primary, colors.secondary, colors.accent].map(hexToRgb).filter(Boolean);
    if (!candidates.length) return null;
    let accent = candidates.find(reads);
    if (!accent) {
      // push the primary toward white (dark theme) or black (light theme) until it reads
      const target = light ? [0, 0, 0] : [255, 255, 255];
      for (let t = 0.1; t <= 0.9 && !accent; t += 0.1) {
        const c = mix(candidates[0], target, t);
        if (reads(c)) accent = c;
      }
      if (!accent) accent = mix(candidates[0], target, 0.9);
    }
    const inkFor = (rgb) => (contrast(rgb, [0, 0, 0]) >= contrast(rgb, [255, 255, 255]) ? "#1a1200" : "#ffffff");
    const primary = candidates[0];
    const secondary = candidates[1] || accent;
    // the colour for buttons that sit on the primary band: the first other team colour that
    // reads against the primary, else white or black
    const onPrimary = candidates.slice(1).find((c) => contrast(c, primary) >= 3) || hexToRgb(inkFor(primary) === "#ffffff" ? "#ffffff" : "#1a1200");
    return { accent: rgbToHex(accent), ink: inkFor(accent), primary: rgbToHex(primary), primaryInk: inkFor(primary),
             secondary: rgbToHex(secondary), onPrimary: rgbToHex(onPrimary), onPrimaryInk: inkFor(onPrimary) };
  }

  function applyTeamTheme(slug) {
    const root = document.documentElement.style;
    const meta = document.querySelector('meta[name="theme-color"]');
    const t = slug && window.CFP.teamsBySlug[slug];
    const theme = t && t.colors ? teamTheme(t.colors) : null;
    if (!theme) {
      for (const v of ["--accent", "--accent-ink", "--team-primary", "--team-primary-ink", "--team-secondary", "--team-on-primary", "--team-on-primary-ink"]) root.removeProperty(v);
      document.body.classList.remove("team-theme");
      if (meta) meta.content = document.documentElement.dataset.theme === "light" ? "#ffffff" : "#131a2e";
      return;
    }
    root.setProperty("--accent", theme.accent);
    root.setProperty("--accent-ink", theme.ink);
    root.setProperty("--team-primary", theme.primary);
    root.setProperty("--team-primary-ink", theme.primaryInk);
    root.setProperty("--team-secondary", theme.secondary);
    root.setProperty("--team-on-primary", theme.onPrimary);
    root.setProperty("--team-on-primary-ink", theme.onPrimaryInk);
    document.body.classList.add("team-theme");
    if (meta) meta.content = theme.primary;
  }
  // light/dark flips change what reads, so re-pick the accent when the theme attribute changes
  new MutationObserver(() => applyTeamTheme(state.season ? state.season.team : null))
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  function showSeason(s) {
    if (s.mode === "real") leagueWide(s);
    const opening = !state.season || state.season.id !== s.id;
    state.season = s;
    // no more games once the season is complete: the Summary tab takes the Games tab's place
    $("#season-tabs button[data-tab=games]").hidden = !!s.done;
    $("#season-tabs button[data-tab=summary]").hidden = !s.done;
    if (s.done && state.tab === "games") state.tab = "summary";
    if (s.done && state.tab === "schedule" && !state.summaryShown && state.season && state.season.id === s.id) { state.tab = "summary"; state.summaryShown = true; }
    if (!s.done && state.tab === "summary") state.tab = "schedule";
    if (opening) { depthState.team = null; depthState.data = null; }
    if (opening) applyTeamTheme(s.team);
    // the team picker (for a new season) starts on the open season's team
    if (opening && s.mode !== "real" && $("#pick-team").querySelector(`option[value="${s.team}"]`)) $("#pick-team").value = s.team;
    state.standings = null;
    if (opening && sidebarPreferred() !== "1") setSidebar(false, false);
    const upNext = s.done ? s.current_week : Math.min(s.current_week + 1, 20);
    // the real page opens on the latest week with results; a sim season on the week up next
    if (state.viewWeek == null) state.viewWeek = s.mode === "real" ? Math.max(s.current_week, 1) : upNext;
    if (state.viewWeek > upNext) state.viewWeek = upNext;
    $("#season-empty").hidden = true;
    $("#season").hidden = false;
    const r = s.record;
    $("#season-title").innerHTML = "";
    if (s.mode === "real") $("#season-title").append("The 2026 college football season");
    else $("#season-title").append(
      teamPill(s.team),
      s.team_name,
      ...(s.my_rank && s.my_rank.rank ? [el("span", { class: "hdr-rank", text: s.my_rank.kind === "cfp" ? `CFP #${s.my_rank.rank}` : `#${s.my_rank.rank}`, title: s.my_rank.kind === "cfp" ? "College Football Playoff ranking" : "AP poll" })] : []),
      el("span", { class: "rec", text: `${r.wins}-${r.losses}` }),
      el("span", { class: "muted conf-rec", style: "font-size:14px;margin-left:8px", text: `${r.conf_wins}-${r.conf_losses} ${s.conference}` }),
    );
    const myNext = (s.schedule || []).find((g) => g.week === s.current_week + 1 && g.opponent);
    const played = myNext && myNext.played ? ` · your game is played (${myNext.won ? "W" : "L"} ${myNext.points_for}–${myNext.points_against}); Advance plays the rest of the week` : "";
    const phase = s.done ? `Season complete · national champion: ${s.champion_name}` : s.current_week === 0 ? `Preseason · ${s.week_labels[1] || "Week 1"} up next${played}` : `${s.week_labels[s.current_week + 1] || "Week " + (s.current_week + 1)} up next · through ${s.week_labels[s.current_week] || "week " + s.current_week}${played}`;
    const simDate = simDateText(s);
    $("#season-meta").textContent = `${phase}${simDate ? ` · ${simDate}` : ""} · ${s.mode === "full" ? "full season simulated" : "real results through today"} · ${when(s.created_at)}`;
    const real = s.mode === "real";
    document.body.classList.toggle("real-mode", real);
    $("#btn-real-refresh").hidden = !real;
    document.title = `${real ? "Real 2026" : "Season"} · CFP Coach Simulator`;
    for (const a of document.querySelectorAll(".site-nav a")) a.classList.toggle("active", a.dataset.nav === (real ? "real" : "season"));
    if (real) {
      $("#season-meta").textContent = `The real 2026 season through ${s.week_labels[s.current_week] || "week " + s.current_week}${simDate ? ` (${simDate})` : ""} · real results, real AP polls, real stats from the NCAA box scores · built ${when(s.real_built_at || s.created_at)}`;
    }
    setBusy(false);
    renderWeekStrip();
    renderTab();
  }

  function renderWeekStrip() {
    const s = state.season;
    const strip = $("#week-strip");
    strip.innerHTML = "";
    const weeks = [0, ...s.weeks];
    for (const w of weeks) {
      const label = w === 0 ? "Pre" : w <= 14 ? `W${w}` : (s.week_labels[w] || `W${w}`).replace("Championship week", "CCG").replace("National championship", "Title").replace("Quarterfinals", "QF").replace("Semifinals", "SF").replace("First round", "R1").replace("Selection", "Sel");
      const next = !s.done && w === s.current_week + 1;
      const b = el("button", { type: "button", class: `week-chip ${w === state.viewWeek ? "active" : ""} ${w > s.current_week ? "future" : ""} ${w === s.current_week ? "current" : ""} ${next ? "next" : ""}`, text: label, title: `${s.week_labels[w] || (w === 0 ? "Preseason" : "")} · ${weekDateText(s, w)}` });
      b.addEventListener("click", () => { if (state.simming) return; state.viewWeek = w; renderWeekStrip(); renderTab(); });
      if (state.simming) b.disabled = true;   // the strip only follows the sim while it runs
      strip.appendChild(b);
    }
    renderWeekDate();
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function parseDay(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
  function shortDay(iso) { const d = parseDay(iso); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; }
  function fmtDay(iso, withDay = true) { const d = parseDay(iso); return `${withDay ? DAYS[d.getDay()] + ", " : ""}${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; }

  function weekDateText(s, w) {
    const wd = s.week_dates && s.week_dates[w];
    if (!wd) return "";
    if (w === 0) return wd.end ? `preseason, through ${fmtDay(wd.end)}` : "preseason";
    if (wd.start === wd.end) return fmtDay(wd.end);
    const a = parseDay(wd.start), b = parseDay(wd.end);
    const span = a.getMonth() === b.getMonth() ? `${MONTHS[a.getMonth()]} ${a.getDate()}–${b.getDate()}, ${b.getFullYear()}` : `${MONTHS[a.getMonth()]} ${a.getDate()} – ${MONTHS[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
    return w <= 14 && wd.main ? `${fmtDay(wd.main)} (${span})` : span;
  }

  function simDateText(s) {
    const wd = s.week_dates && s.week_dates[s.current_week];
    if (!wd || !wd.end) return "";
    return `${s.current_week === 0 ? "sim date" : "as of"} ${fmtDay(wd.end)}`;
  }

  function renderWeekDate() {
    const s = state.season, w = state.viewWeek;
    const box = $("#week-date");
    box.innerHTML = "";
    const label = w === 0 ? "Preseason" : (s.week_labels[w] || `Week ${w}`);
    let status;
    if (s.done && w >= s.current_week) status = "season complete";
    else if (w <= s.current_week) status = w === 0 ? "" : "played";
    else if (w === s.current_week + 1) status = "up next";
    else status = `Advance sims through ${label}`;
    box.append(el("b", { text: label }), el("span", { text: ` · ${weekDateText(s, w)}` }));
    if (status) box.append(el("span", { text: ` · ${status}` }));
    const btn = $("#btn-advance");
    const next = (s.schedule || []).find((g) => g.week === s.current_week + 1 && g.opponent);
    const mineDone = !!(next && next.played);
    if (s.done) btn.textContent = "Season complete";
    else if (w > s.current_week + 1) btn.textContent = `Sim to ${label}`;
    else btn.textContent = "Advance to Next Week";
    btn.title = mineDone ? "Your game is in the books: this plays the rest of the week" : "Plays every game this week";
    // Game day plays only your game this week (hidden on a bye, once it is played, and after the season)
    // after the title game there is nothing left to sim; past selection, "Sim to selection" is moot
    btn.hidden = !!s.done;
    $("#btn-to-end").hidden = !!s.done;
    $("#btn-to-selection").hidden = !!s.done || s.current_week >= 15;
    const gd = $("#btn-gameday");
    gd.hidden = s.done || !next || mineDone;
    if (next) gd.textContent = `Game day · ${next.venue === "away" ? "at" : "vs"} ${next.opponent_name}`;
  }

  function selectTab(name) {
    state.tab = name;
    for (const b of $("#season-tabs").querySelectorAll("button")) b.classList.toggle("active", b.dataset.tab === name);
    for (const t of ["games", "schedule", "standings", "rankings", "bracket", "bowls", "summary", "awards", "stats", "depth"]) $(`#tab-${t}`).hidden = t !== name;
  }

  function renderTab() {
    selectTab(state.tab);
    const t = state.tab;
    if (t === "games") renderGames();
    else if (t === "schedule") renderSchedule();
    else if (t === "standings") renderStandings();
    else if (t === "rankings") renderRankings();
    else if (t === "bracket") renderBracket();
    else if (t === "bowls") renderBowls();
    else if (t === "summary") renderSummary();
    else if (t === "awards") renderAwards();
    else if (t === "stats") renderStats();
    else if (t === "depth") renderDepthChart();
  }

  // ----- stats tab: team stats, player stats and the depth chart under one tab --------

  const statsState = { view: "players" };
  const depthState = { team: null, data: null, key: null, unit: "", view: "chart", role: "QB", pos: null, posKey: null };
  const DEPTH_ROLES = ["QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT", "LEDG", "DT", "REDG", "SAM", "MIKE", "WILL", "CB", "FS", "SS", "K", "P", "KR", "PR"];

  function renderStats() {
    const s = state.season;
    if (!s) return;
    const st = statsState;
    const chips = $("#stats-chips");
    chips.innerHTML = "";
    for (const [v, label] of [["team", "Team stats"], ["players", "Player stats"]]) {
      const b = el("button", { type: "button", class: `chip ${st.view === v ? "active" : ""}`, text: label });
      b.addEventListener("click", () => { st.view = v; renderStats(); });
      chips.append(b);
    }
    for (const v of ["teamstats", "playerstats"]) $(`#tab-${v}`).hidden = v !== (st.view === "team" ? "teamstats" : "playerstats");
    if (st.view === "team") renderSeasonTeamStats();
    else renderSeasonPlayerStats();
  }

  // Depth chart: every role in formation order with the players in depth order, their
  // class, size, rating and season headline. Starters are the first column.
  async function renderDepthChart() {
    const s = state.season;
    if (!s) return;
    const box = $("#tab-depth");
    box.innerHTML = "";
    try { await renderDepthChartBody(box, s); }
    catch (err) { box.append(el("p", { class: "muted", text: `Could not draw the depth chart: ${err.message}` })); console.error(err); }
  }

  async function renderDepthChartBody(box, s) {
    const ds = depthState;
    if (ds.team === null) ds.team = s.team;
    const controls = el("div", { class: "stats-controls" });
    const confs = [...new Set(state.teams.filter((t) => !t.fictional).map((t) => t.conference))].sort();
    const teamSel = el("select", { "aria-label": "Team" }, state.teams.filter((t) => !t.fictional).map((t) => el("option", { value: t.slug, text: `${t.name} (${CONF_SHORT[t.conference] || t.conference})` })));
    teamSel.value = ds.team;
    teamSel.addEventListener("change", () => { ds.team = teamSel.value; renderDepthChart(); });
    const viewChips = el("div", { class: "view-chips" }, [["chart", "Depth chart"], ["position", "By position"]].map(([v, label]) => {
      const b = el("button", { type: "button", class: `chip ${ds.view === v ? "active" : ""}`, text: label });
      b.addEventListener("click", () => { ds.view = v; renderDepthChart(); });
      return b;
    }));
    const unitChips = ds.view === "position"
      ? el("div", { class: "view-chips" }, DEPTH_ROLES.map((r) => { const b = el("button", { type: "button", class: `chip ${ds.role === r ? "active" : ""}`, text: r }); b.addEventListener("click", () => { ds.role = r; renderDepthChart(); }); return b; }))
      : el("div", { class: "view-chips" }, [["", "All"], ["Offense", "Offense"], ["Defense", "Defense"], ["Special teams", "Special teams"]].map(([v, label]) => {
      const b = el("button", { type: "button", class: `chip ${ds.unit === v ? "active" : ""}`, text: label });
      b.addEventListener("click", () => { ds.unit = v; renderDepthChart(); });
      return b;
    }));
    controls.append(teamSel);
    if (ds.team !== s.team) {
      const mineBtn = el("button", { type: "button", class: "ghost small", text: "My team" });
      mineBtn.addEventListener("click", () => { ds.team = s.team; renderDepthChart(); });
      controls.append(mineBtn);
    }
    controls.append(viewChips, unitChips);
    box.append(controls);
    if (ds.view === "position") return renderDepthByPosition(box, ds, s);
    const key = `${s.id}|${s.current_week}|${ds.team}`;
    if (!ds.data || ds.key !== key) {
      try { ds.data = await api(`/api/season/${s.id}/depth/${ds.team}`); ds.key = key; } catch (err) { box.append(el("p", { class: "muted", text: err.message })); return; }
    }
    const d = ds.data;
    // moves are saved with the season and used by every game from then on
    const change = async (body) => {
      try { ds.data = await api(`/api/season/${s.id}/depth/${ds.team}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); renderDepthChart(); }
      catch (err) { toast(`Could not change the depth chart: ${err.message}`, 4000); }
    };
    const canEdit = !s.done && s.mode !== "real" && (ds.team === s.team || godMode());
    const note = el("div", { class: "stats-controls depth-note" }, [
      el("span", { class: "muted small-text", text: s.mode === "real" ? "The real depth chart: who has actually played the most over the last three games (tools/tune_from_real.py)." : s.done ? "Season complete; the depth chart is read-only." : !canEdit ? "Another team's depth chart: turn on god mode in ⚙ Settings to edit it." : `▲ ▼ move a player one spot, ★ makes him the starter.${ds.team !== s.team ? " God mode: this is another team's chart." : ""} Changes are saved with this season and used by every game from the next sim on.` }),
      d.overridden && canEdit ? (() => { const b = el("button", { type: "button", class: "ghost small", text: "Reset to the original depth chart" }); b.addEventListener("click", () => { if (confirm(`Reset the ${d.name} depth chart to the original?`)) change({ reset: true }); }); return b; })() : null,
    ]);
    box.append(note);
    const r = d.ratings || {};
    box.append(el("div", { class: "roster-head" }, [
      teamPill(ds.team), el("b", { text: d.name }),
      el("span", { class: "muted", text: ` · ${d.conference} · ${d.head_coach || ""} · overall ${Math.round(r.overall)} (off ${Math.round(r.offense)}, def ${Math.round(r.defense)}, ST ${Math.round(r.special_teams)}) · ${d.roster_size} players` }),
    ]));
    for (const unit of d.units) {
      if (ds.unit && unit.name !== ds.unit) continue;
      box.append(el("h3", { text: unit.name }));
      const width = Math.max(2, ...unit.rows.map((row) => Math.min(row.players.length, unit.name === "Offense" && row.role === "WR" ? 5 : 3)));
      const table = el("table", { class: "stats depth-table" });
      table.append(el("tr", {}, [el("th", { text: "" }), ...Array.from({ length: width }, (_, i) => el("th", { class: `left ${i >= 2 ? "ph" : ""}`, text: i === 0 ? "Starter" : ORD(i) }))]));
      for (const row of unit.rows) {
        const cells = [el("td", { class: "depth-role" }, [el("b", { text: row.role }), el("div", { class: "muted small-text", text: row.label })])];
        for (let i = 0; i < width; i++) {
          const p = row.players[i];
          if (!p) { cells.push(el("td", { class: `left muted ${i >= 2 ? "ph" : ""}`, text: "" })); continue; }
          const ctl = !canEdit ? null : el("span", { class: "depth-ctl" }, [
            i > 0 ? (() => { const b = el("button", { type: "button", class: "ghost tiny", text: "★", title: "Make starter" }); b.addEventListener("click", () => change({ role: row.role, player: p.slug, move: "top" })); return b; })() : null,
            i > 0 ? (() => { const b = el("button", { type: "button", class: "ghost tiny", text: "▲", title: "Move up" }); b.addEventListener("click", () => change({ role: row.role, player: p.slug, move: "up" })); return b; })() : null,
            i < row.players.length - 1 && !["KR", "PR"].includes(row.role) ? (() => { const b = el("button", { type: "button", class: "ghost tiny", text: "▼", title: "Move down" }); b.addEventListener("click", () => change({ role: row.role, player: p.slug, move: "down" })); return b; })() : null,
          ]);
          cells.push(el("td", { class: `left depth-cell ${i === 0 ? "starter" : ""} ${i >= 2 ? "ph" : ""}` }, [
            el("div", { class: "name" }, [p.jersey ? el("span", { class: "muted", text: `#${p.jersey} ` }) : null, el("span", { text: p.name, ...playerAttrs(ds.team, p.name, p.position) }), el("span", { class: "pos", text: `${p.class || ""}${p.position !== row.role ? " · " + p.position : ""}` }),
              p.form >= 0.35 ? el("span", { class: "form hot", text: "🔥", title: `Hot streak (form +${p.form})` }) : p.form <= -0.35 ? el("span", { class: "form cold", text: "❄", title: `Cold streak (form ${p.form})` }) : null,
              p.injury ? el("span", { class: "injury-tag", title: `${p.injury.type}, back ${s.week_labels[p.injury.returns_week] || "week " + p.injury.returns_week}`, text: `OUT ${p.injury.weeks_left}w` }) : null, ctl]),
            el("div", { class: "muted small-text", text: [`${p.overall} ovr`, p.height && p.weight ? `${p.height} ${p.weight}` : "", p.headline || (p.games ? `${p.games} games` : "")].filter(Boolean).join(" · ") }),
          ]));
        }
        table.append(el("tr", {}, cells));
      }
      box.append(el("div", { class: "table-scroll" }, [table]));
    }
  }



  // ----- season summary ------------------------------------------------------

  // ----- shared modal ----------------------------------------------------------
  // openModal(title, node): shows node in an overlay with a title and a close button.
  // Modals stack: opening one while another is open puts it on top, a little narrower,
  // with the first still visible behind it (a player page over a box score). Esc, the
  // backdrop, the close button and the browser's Back each close the top one; opening
  // pushes a history entry so Back on a phone closes a modal instead of leaving the page.
  const modalStack = [];   // [{layer, pushed}] bottom to top

  function makeLayer(nested) {
    const base = $("#modal");
    if (!nested) return base;
    const layer = base.cloneNode(true);
    layer.removeAttribute("id");
    layer.classList.add("modal-nested");
    layer.style.zIndex = String(60 + modalStack.length);
    for (const n of layer.querySelectorAll("[id]")) n.removeAttribute("id");
    layer.querySelector(".modal-backdrop").addEventListener("click", () => closeModal());
    layer.querySelector(".modal-close").addEventListener("click", () => closeModal());
    document.body.append(layer);
    return layer;
  }

  function openModal(title, node) {
    const layer = makeLayer(modalStack.length > 0);
    const t = layer.querySelector(".modal-title");
    t.innerHTML = "";
    t.append(typeof title === "string" ? document.createTextNode(title) : title);
    const body = layer.querySelector(".modal-body");
    body.innerHTML = "";
    body.append(node);
    body.scrollTop = 0;
    layer.hidden = false;
    document.body.classList.add("modal-open");
    let pushed = false;
    try { history.pushState({ cfpModal: modalStack.length + 1 }, ""); pushed = true; } catch (e) { pushed = false; }
    modalStack.push({ layer, pushed });
    layer.querySelector(".modal-close").focus({ preventScroll: true });
  }

  function closeModal(fromHistory = false) {
    const top = modalStack.pop();
    if (!top) return;
    if (top.layer.id === "modal") top.layer.hidden = true;
    else top.layer.remove();
    if (!modalStack.length) document.body.classList.remove("modal-open");
    // going back in history fires popstate, which must not close a second layer
    if (!fromHistory && top.pushed) { modalSkipPop = true; history.back(); }
  }
  let modalSkipPop = false;

  function closeAllModals() {
    while (modalStack.length) closeModal();
  }

  const modalOpen = () => modalStack.length > 0;
  window.addEventListener("popstate", () => { if (modalSkipPop) { modalSkipPop = false; return; } if (modalOpen()) closeModal(true); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modalOpen()) closeModal(); });
  $("#modal-backdrop").addEventListener("click", () => closeModal());
  $("#modal-close").addEventListener("click", () => closeModal());

  // ----- player profiles ------------------------------------------------------
  // Any element with data-player="team|name|position" opens the player's page. The page
  // is its own tab (like the box score) with a Back button to the tab you came from.

  const playerState = { back: null, cache: new Map() };
  const STAT_GROUPS = [
    ["Passing", [["pass_attempts", "Att"], ["completions", "Cmp"], ["pass_yards", "Yds"], ["passing_touchdowns", "TD"], ["interceptions_thrown", "INT"], ["sacks_taken", "Sacked"], ["passing_first_downs", "1st downs"], ["long_pass", "Long"]]],
    ["Rushing", [["carries", "Car"], ["rush_yards", "Yds"], ["rushing_touchdowns", "TD"], ["explosive_runs", "20+"], ["rushing_first_downs", "1st downs"], ["long_rush", "Long"], ["fumbles", "Fum"]]],
    ["Receiving", [["targets", "Tgt"], ["receptions", "Rec"], ["receiving_yards", "Yds"], ["receiving_touchdowns", "TD"], ["explosive_catches", "25+"], ["receiving_first_downs", "1st downs"], ["long_reception", "Long"]]],
    ["Defense", [["solo_tackles", "Solo"], ["assisted_tackles", "Ast"], ["tackles_for_loss", "TFL"], ["sacks", "Sacks"], ["hurries", "Hurries"], ["interceptions", "INT"], ["interception_return_yards", "INT yds"], ["passes_defended", "PBU"], ["forced_fumbles", "FF"], ["fumble_recoveries", "FR"], ["defensive_touchdowns", "TD"]]],
    ["Blocking", [["snaps", "Snaps"], ["games_started", "Starts"], ["key_blocks", "Key blocks"], ["sacks_allowed", "Sacks allowed"], ["pressures_allowed", "Pressures"], ["stuffs_allowed", "Stuffs"]]],
    ["Kicking", [["fg_made", "FGM"], ["fg_attempted", "FGA"], ["fg_40_made", "40-49 made"], ["fg_50_made", "50+ made"], ["long_fg", "Long"], ["pat_made", "PAT"], ["pat_attempts", "PAT att"]]],
    ["Punting", [["punts", "Punts"], ["punt_yards", "Yds"], ["punt_net_yards", "Net yds"], ["punts_inside_20", "Inside 20"], ["punt_touchbacks", "TB"], ["long_punt", "Long"]]],
    ["Returns", [["kickoff_returns", "KR"], ["kickoff_return_yards", "KR yds"], ["kickoff_return_touchdowns", "KR TD"], ["long_kickoff_return", "KR long"], ["punt_returns", "PR"], ["punt_return_yards", "PR yds"], ["punt_return_touchdowns", "PR TD"], ["long_punt_return", "PR long"]]],
  ];
  const DEF_POS = new Set(["DL", "MLB", "ROLB", "LOLB", "OLB", "CB", "S"]);

  function playerAttrs(team, name, position) {
    return team && name ? { "data-player": `${team}|${name}|${position || ""}`, class: "plink", title: "Open player page" } : {};
  }

  async function openPlayer(team, name, position) {
    const s = state.season;
    if (!s) return;
    const key = `${s.id}|${s.current_week}|${team}|${name}|${position}`;
    let p = playerState.cache.get(key);
    if (!p) {
      try { p = await api(`/api/season/${s.id}/player?team=${encodeURIComponent(team)}&name=${encodeURIComponent(name)}&position=${encodeURIComponent(position || "")}`); }
      catch (err) { toast(`Could not load that player: ${err.message}`, 3000); return; }
      playerState.cache.set(key, p);
    }
    const node = el("div", { class: "player-page" });
    renderPlayer(p, node);
    openModal(`${p.jersey ? "#" + p.jersey + " " : ""}${p.name}`, node);
  }

  function headlineTiles(p) {
    const st = p.stats || {};
    const g = Math.max(1, p.games || 1);
    const n = (k) => st[k] || 0;
    const pos = p.position;
    let tiles = [];
    if (pos === "QB") tiles = [["Pass yds", n("pass_yards").toLocaleString()], ["TD", `${n("passing_touchdowns")}`], ["INT", `${n("interceptions_thrown")}`], ["Rating", p.rating ? p.rating.toFixed(1) : "–"], ["Cmp %", n("pass_attempts") ? `${Math.round(100 * n("completions") / n("pass_attempts"))}%` : "–"], ["Rush yds", n("rush_yards").toLocaleString()]];
    else if (pos === "RB") tiles = [["Rush yds", n("rush_yards").toLocaleString()], ["TD", `${n("rushing_touchdowns") + n("receiving_touchdowns")}`], ["Yds/car", n("carries") ? (n("rush_yards") / n("carries")).toFixed(1) : "–"], ["Yds/game", (n("rush_yards") / g).toFixed(1)], ["Rec yds", n("receiving_yards").toLocaleString()], ["20+ runs", `${n("explosive_runs")}`]];
    else if (pos === "WR" || pos === "TE") tiles = [["Rec", `${n("receptions")}`], ["Yds", n("receiving_yards").toLocaleString()], ["TD", `${n("receiving_touchdowns")}`], ["Yds/rec", n("receptions") ? (n("receiving_yards") / n("receptions")).toFixed(1) : "–"], ["Yds/game", (n("receiving_yards") / g).toFixed(1)], ["25+ catches", `${n("explosive_catches")}`]];
    else if (pos === "OL") tiles = [["Snaps", `${n("snaps")}`], ["Starts", `${n("games_started")}`], ["Sacks allowed", `${n("sacks_allowed")}`], ["Pressures", `${n("pressures_allowed")}`], ["Key blocks", `${n("key_blocks")}`], ["Stuffs", `${n("stuffs_allowed")}`]];
    else if (DEF_POS.has(pos)) tiles = [["Tackles", `${n("solo_tackles") + n("assisted_tackles")}`], ["TFL", `${n("tackles_for_loss")}`], ["Sacks", `${n("sacks")}`], ["INT", `${n("interceptions")}`], ["PBU", `${n("passes_defended")}`], ["FF", `${n("forced_fumbles")}`]];
    else if (pos === "K") tiles = [["FG", `${n("fg_made")}/${n("fg_attempted")}`], ["FG %", n("fg_attempted") ? `${Math.round(100 * n("fg_made") / n("fg_attempted"))}%` : "–"], ["50+", `${n("fg_50_made")}/${n("fg_50_att")}`], ["Long", `${n("long_fg") || "–"}`], ["PAT", `${n("pat_made")}/${n("pat_attempts")}`], ["Points", `${3 * n("fg_made") + n("pat_made")}`]];
    else if (pos === "P") tiles = [["Punts", `${n("punts")}`], ["Avg", n("punts") ? (n("punt_yards") / n("punts")).toFixed(1) : "–"], ["Net", n("punts") ? (n("punt_net_yards") / n("punts")).toFixed(1) : "–"], ["Inside 20", `${n("punts_inside_20")}`], ["Touchbacks", `${n("punt_touchbacks")}`], ["Long", `${n("long_punt") || "–"}`]];
    return tiles;
  }

  function renderPlayer(p, box) {
    const s = state.season;
    box.innerHTML = "";
    const team = p.team;
    const t = window.CFP.teamsBySlug[team.slug] || {};
    const col = (t.colors || {});
    const primary = col.primary || "#888";

    // header: back link, hero in team colours
    const bar = el("div", { class: "player-bar" }, [
      el("span", { class: "muted small-text", text: `${team.name}${team.rank ? ` · #${team.rank}` : ""} · ${team.record} · ${team.conference}` }),
    ]);
    box.append(bar);
    const hero = el("div", { class: `player-hero ${team.slug === s.team ? "mine" : ""}` });
    hero.style.setProperty("--p-primary", primary);
    hero.style.setProperty("--p-secondary", col.secondary || primary);
    const facts = [p.position + (p.role && !["QB", "WR", "TE", "K", "P", "HB", "CB"].includes(p.role) ? ` · ${p.role}` : ""), p.class_name, p.height && p.weight ? `${p.height}, ${p.weight} lbs` : (p.height || "")].filter(Boolean);
    // development trait on a five-star scale: Normal 2, Impact 3, Star 4, Elite 5 (the data has those four tiers)
    const DEV_STARS = { Normal: 2, Impact: 3, Star: 4, Elite: 5 };
    const devStars = DEV_STARS[p.dev_trait] || 0;
    const devTag = devStars ? el("span", { class: `tag dev dev-${(p.dev_trait || "").toLowerCase()}`, title: "Development trait: how quickly the player improves (Normal, Impact, Star, Elite)." }, [el("b", { text: `${p.dev_trait} Development` })]) : null;
    // recruiting stars next to the name (estimated from the rating; the rosters carry no recruiting rankings)
    const recruit = p.stars ? el("span", { class: "recruit-stars", title: `${p.stars}-star recruit (estimated from the rating against the whole FBS pool)` }, [1, 2, 3, 4, 5].map((i) => el("span", { class: `rs ${i <= p.stars ? "on" : ""}`, text: "★" }))) : null;
    hero.append(
      el("div", { class: "player-hero-main" }, [
        (() => { const pill = teamPill(team.slug); pill.classList.add("big"); return pill; })(),
        el("div", {}, [
          el("div", { class: "player-name" }, [p.jersey ? el("span", { class: "player-jersey", text: `#${p.jersey} ` }) : null, p.name, recruit]),
          el("div", { class: "muted player-facts", text: facts.join(" · ") }),
          el("div", { class: "player-tags" }, [
            p.starter ? el("span", { class: "tag good", text: "Starter" }) : el("span", { class: "tag", text: p.depth ? `${p.role || p.position} #${p.depth}` : "Reserve" }),
            p.injured ? el("span", { class: "tag bad", text: "Injured" }) : null,
            p.morale && p.morale.enabled && p.morale.label !== "Steady" ? el("span", { class: `tag ${p.morale.label === "Hot streak" ? "good hot" : "bad cold"}`, text: `${p.morale.label === "Hot streak" ? "🔥" : "❄"} ${p.morale.label}`, title: `Form ${p.morale.form > 0 ? "+" : ""}${p.morale.form}: his recent games against his season so far` }) : null,
            p.morale && p.morale.enabled && p.morale.team_label ? el("span", { class: `tag ${p.morale.team > 0 ? "good" : "bad"}`, text: p.morale.team_label, title: `Team mood ${p.morale.team > 0 ? "+" : ""}${p.morale.team}` }) : null,
            p.games ? el("span", { class: "tag", text: `${p.games} of ${p.team_games} games` }) : el("span", { class: "tag", text: "No games yet" }),
          ]),
          devTag ? el("div", { class: "player-dev" }, [devTag]) : null,
        ]),
      ]),
      el("div", { class: "player-ovr" }, [el("div", { class: "player-ovr-num", text: String(p.overall) }), el("div", { class: "review-label", text: "Overall" })]),
    );
    box.append(hero);

    // headline tiles
    const tiles = headlineTiles(p);
    if (tiles.length && p.games) box.append(el("div", { class: "review-tiles player-tiles" }, tiles.map(([k, v]) => el("div", { class: "review-tile" }, [el("div", { class: "review-leader-big", text: v }), el("div", { class: "review-label", text: k })]))));

    const grid = el("div", { class: "player-grid" });
    // ratings
    const edited = new Set(p.edited || []);
    const editBtn = godMode() && !s.done ? el("button", { type: "button", class: "ghost small player-edit-open", text: "Edit", title: "God mode: change the ratings and identity" }) : null;
    const keySet = new Set(p.key_ratings || []);
    const shown = keySet.size ? p.ratings.filter((r) => keySet.has(r.key)).sort((a, b) => p.key_ratings.indexOf(a.key) - p.key_ratings.indexOf(b.key)) : p.ratings;
    const allBtn = el("button", { type: "button", class: "ghost small", text: `All ratings (${p.ratings.length})`, title: "Every rating he carries, and how he rates at other positions" });
    allBtn.addEventListener("click", () => openAllRatings(p));
    const rat = el("div", { class: "leader-card player-card" }, [el("div", { class: "leader-head" }, [el("h4", { text: `${p.position} ratings` }), el("span", { class: "muted small-text", text: edited.size ? `edited in god mode (${[...edited].length})` : "50 = average Power 4 starter" }), el("span", { class: "card-actions" }, [allBtn, editBtn])])]);
    if (editBtn) editBtn.addEventListener("click", () => { editBtn.hidden = true; rat.append(playerEditForm(p, rat)); });
    for (const r of shown) {
      const pct = Math.max(2, Math.min(100, r.value));
      const tone = r.value >= 75 ? "hi" : r.value >= 55 ? "mid" : "lo";
      const boost = r.boost ? el("span", { class: `boost ${r.boost > 0 ? "up" : "down"}`, text: `${r.boost > 0 ? "▲" : "▼"}${Math.abs(r.boost)}`, title: `${r.boost > 0 ? "+" : ""}${r.boost} from ${p.morale && p.morale.label !== "Steady" ? p.morale.label.toLowerCase() : "morale"}${p.morale && p.morale.team_label ? " and the team's mood" : ""}` }) : null;
      rat.append(el("div", { class: `rating-row ${edited.has(r.key) ? "edited" : ""} ${r.boost ? "boosted" : ""}` }, [el("span", { class: "rating-label", text: r.label, title: edited.has(r.key) ? "Edited in god mode" : "" }), el("div", { class: "rating-bar" }, [el("div", { class: `rating-fill ${tone}`, style: `width:${pct}%` })]), el("b", { class: "rating-num" }, [String(r.value), boost])]));
    }
    if (p.morale && p.morale.enabled && p.ratings.some((r) => r.boost)) rat.append(el("div", { class: "muted small-text", style: "margin-top:6px", text: `Arrows: how his ratings enter the next game (${p.morale.label.toLowerCase()}${p.morale.team_label ? ", " + p.morale.team_label.toLowerCase() : ""}).` }));
    const others = Object.entries(p.ratings_at || {}).filter(([pos]) => pos !== p.position && !(pos === "MLB" && /LB$/.test(p.position))).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (others.length) rat.append(el("div", { class: "muted small-text", style: "margin-top:8px", text: `Rated at other spots: ${others.map(([pos, v]) => `${pos} ${v}`).join(" · ")}` }));
    grid.append(rat);

    // ranks
    const rk = el("div", { class: "leader-card player-card" }, [el("div", { class: "leader-head" }, [el("h4", { text: "Where he ranks" }), el("span", { class: "muted small-text", text: p.ranks.length ? "FBS · conference" : "" })])]);
    if (!p.ranks.length) rk.append(el("p", { class: "muted small-text", text: p.games ? "Not enough games to rank yet." : "No games played yet." }));
    for (const r of p.ranks) {
      const ord = ordinal;
      rk.append(el("div", { class: "leader-row" }, [
        el("span", { class: "rank", text: "" }),
        el("span", { class: "who" }, [el("span", { class: "name", text: r.label }), el("span", { class: "muted small-text", text: `${ord(r.fbs_rank)} of ${r.fbs_n} in FBS · ${ord(r.conf_rank)} of ${r.conf_n} in the ${team.conference}` })]),
        el("span", { class: `value ${r.fbs_rank <= 10 ? "top" : ""}`, text: String(r.value) }),
      ]));
    }
    grid.append(rk);
    box.append(grid);

    // season totals by group
    const used = STAT_GROUPS.filter(([, cols]) => cols.some(([k]) => p.stats[k]));
    if (used.length) {
      box.append(el("h3", { text: "Season totals" }));
      const wrap = el("div", { class: "player-grid" });
      for (const [title, cols] of used) {
        const shown = cols.filter(([k]) => p.stats[k] != null && p.stats[k] !== 0);
        const table = el("table", { class: "stats" });
        table.append(el("tr", {}, [el("th", { class: "left", text: title === "Blocking" && p.position !== "OL" ? "Playing time" : title }), ...shown.map(([, lbl]) => el("th", { text: lbl }))]));
        table.append(el("tr", {}, [el("td", { class: "left muted", text: "Total" }), ...shown.map(([k]) => el("td", { text: fmtStatValue(p.stats[k]) }))]));
        if (p.games > 1) table.append(el("tr", {}, [el("td", { class: "left muted", text: "Per game" }), ...shown.map(([k]) => el("td", { class: "muted", text: /^long_/.test(k) ? "" : (p.stats[k] / p.games).toFixed(1) }))]));
        wrap.append(el("div", { class: "table-scroll" }, [table]));
      }
      box.append(wrap);
    }

    // game log
    box.append(el("h3", { text: "Game log" }));
    if (p.game_log === null) box.append(el("p", { class: "muted small-text", text: "Game-by-game lines are kept for your own team's games; other teams carry season totals." }));
    else if (!p.game_log.length) box.append(el("p", { class: "muted small-text", text: "No games played yet." }));
    else box.append(gameLogTable(p));

    // honors
    if (p.honors.length) {
      box.append(el("h3", { text: "Honors" }));
      const table = el("table", { class: "stats" });
      table.append(el("tr", {}, ["Stage", "Award", "Result"].map((h) => el("th", { class: "left", text: h }))));
      for (const h of p.honors) table.append(el("tr", {}, [el("td", { class: "left muted", text: h.stage }), el("td", { class: "left" }, [el("b", { text: h.award }), h.detail ? el("span", { class: "muted small-text", text: ` · ${h.detail}` }) : null]), el("td", { class: `left ${/winner|unanimous|first/i.test(h.place) ? "win" : ""}`, text: h.place })]));
      box.append(el("div", { class: "table-scroll" }, [table]));
    }
  }

  function fmtStatValue(v) { return typeof v === "number" && !Number.isInteger(v) ? v.toFixed(1) : String(v); }

  function gameLogTable(p) {
    const s = state.season;
    const pos = p.position;
    const n = (st, k) => st[k] || 0;
    let cols;
    if (pos === "QB") cols = [["C/ATT", (st) => `${n(st, "completions")}/${n(st, "pass_attempts")}`], ["Yds", (st) => n(st, "pass_yards")], ["TD", (st) => n(st, "passing_touchdowns")], ["INT", (st) => n(st, "interceptions_thrown")], ["Rush", (st) => `${n(st, "carries")}-${n(st, "rush_yards")}`], ["Rush TD", (st) => n(st, "rushing_touchdowns")]];
    else if (pos === "RB") cols = [["Car", (st) => n(st, "carries")], ["Yds", (st) => n(st, "rush_yards")], ["Avg", (st) => n(st, "carries") ? (n(st, "rush_yards") / n(st, "carries")).toFixed(1) : "–"], ["TD", (st) => n(st, "rushing_touchdowns")], ["Rec", (st) => `${n(st, "receptions")}-${n(st, "receiving_yards")}`], ["Rec TD", (st) => n(st, "receiving_touchdowns")]];
    else if (pos === "WR" || pos === "TE") cols = [["Tgt", (st) => n(st, "targets")], ["Rec", (st) => n(st, "receptions")], ["Yds", (st) => n(st, "receiving_yards")], ["TD", (st) => n(st, "receiving_touchdowns")], ["Long", (st) => n(st, "long_reception")]];
    else if (pos === "OL") cols = [["Snaps", (st) => n(st, "snaps")], ["Sacks all.", (st) => n(st, "sacks_allowed")], ["Pressures", (st) => n(st, "pressures_allowed")], ["Key blocks", (st) => n(st, "key_blocks")]];
    else if (DEF_POS.has(pos)) cols = [["Tkl", (st) => n(st, "solo_tackles") + n(st, "assisted_tackles")], ["TFL", (st) => n(st, "tackles_for_loss")], ["Sacks", (st) => n(st, "sacks")], ["INT", (st) => n(st, "interceptions")], ["PBU", (st) => n(st, "passes_defended")], ["FF", (st) => n(st, "forced_fumbles")]];
    else if (pos === "K") cols = [["FG", (st) => `${n(st, "fg_made")}/${n(st, "fg_attempted")}`], ["Long", (st) => n(st, "long_fg")], ["PAT", (st) => `${n(st, "pat_made")}/${n(st, "pat_attempts")}`]];
    else if (pos === "P") cols = [["Punts", (st) => n(st, "punts")], ["Avg", (st) => n(st, "punts") ? (n(st, "punt_yards") / n(st, "punts")).toFixed(1) : "–"], ["In 20", (st) => n(st, "punts_inside_20")]];
    else cols = [["Snaps", (st) => n(st, "snaps")]];
    const table = el("table", { class: "stats" });
    table.append(el("tr", {}, [el("th", { text: "Wk" }), el("th", { class: "left", text: "Opponent" }), el("th", { text: "Result" }), ...cols.map(([lbl]) => el("th", { text: lbl }))]));
    for (const g of p.game_log) {
      const row = el("tr", { class: "clickable" }, [
        el("td", { class: "muted", text: g.week > 14 ? (s.week_labels[g.week] || "").replace("Championship week", "CCG").replace(" & bowls", "").replace(" & New Year bowls", "") : String(g.week) }),
        el("td", { class: "left" }, [`${g.venue === "away" ? "at " : "vs "}`, teamPill(g.opponent), g.opponent_name, g.title ? el("span", { class: "muted small-text", text: ` · ${g.title}` }) : null]),
        el("td", { class: g.won ? "win" : "loss", text: `${g.won ? "W" : "L"} ${g.points_for}–${g.points_against}` }),
        ...cols.map(([, f]) => el("td", { text: String(f(g.stats)) })),
      ]);
      row.addEventListener("click", () => { closeAllModals(); openBox(g.event_id); });
      table.append(row);
    }
    return el("div", { class: "table-scroll" }, [table]);
  }

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-player]");
    if (!t || e.target.closest("button")) return;
    const [team, name, position] = t.dataset.player.split("|");
    e.preventDefault();
    e.stopPropagation();
    openPlayer(team, name, position);
  }, true);

  // ----- awards ------------------------------------------------------------

  const awardsState = { data: null, key: null, view: "mine", filter: "", sort: null, desc: true, conf: null, selector: "consensus",
                        level: 1, mineFilter: "" };
  const ORD = (i) => ordinal(i + 1);   // a 0-based index as an ordinal: 0 -> "1st"
  // roster class codes (FR, FRRS, SO, ...) as "Fr.", "RS Fr.", ...
  const CLASS_LABEL = { FR: "Fr.", FRRS: "RS Fr.", SO: "So.", SORS: "RS So.", JR: "Jr.", JRRS: "RS Jr.", SR: "Sr.", SRRS: "RS Sr." };
  const classLabel = (cls) => (cls ? ` · ${CLASS_LABEL[cls] || cls}` : "");
  const OFFENSE_KINDS = new Set(["qb", "qb_upper", "rb", "wr", "te", "interior", "c", "ol", "ol_unit", "blocker", "opoy", "off_freshman"]);
  const DEFENSE_KINDS = new Set(["dpoy", "dpoy_alt", "lb", "db", "edge", "dl", "front", "def_freshman"]);
  const ST_KINDS = new Set(["k", "p", "rs", "stpoy", "versatile"]);

  // A row of chips; clicking one moves the highlight to it, then calls onPick (callers that
  // redraw the row get the same result, callers that keep it, like a modal, stay correct).
  function chipRow(items, current, onPick, cls = "") {
    const row = el("div", { class: `view-chips ${cls}` });
    for (const [value, label, title] of items) {
      const b = el("button", { type: "button", class: `chip ${current === value ? "active" : ""}`, text: label, title: title || label });
      b.dataset.v = String(value);
      b.addEventListener("click", () => { markChip(row, b); onPick(value); });
      row.append(b);
    }
    return row;
  }

  function markChip(row, chip) {
    for (const c of row.querySelectorAll(":scope > .chip")) c.classList.toggle("active", c === chip);
  }

  function who(c, withTeam = true) {
    // name, position/class, team pill
    const bits = [teamPill(c.team), el("b", { text: c.name || c.coach || c.team_name, ...(c.name ? playerAttrs(c.team, c.name, c.position) : {}) })];
    const ROLE_SHOWN = new Set(["LT", "LG", "C", "RG", "RT", "LEDG", "REDG", "DT", "SAM", "MIKE", "WILL", "FS", "SS"]);
    const tag = c.position ? `${c.position}${c.role && ROLE_SHOWN.has(c.role) ? " · " + c.role : ""}${classLabel(c.class)}` : (c.role || (c.coach ? "Head coach" : ""));
    if (tag) bits.push(el("span", { class: "pos", text: tag }));
    if (withTeam && (c.name || c.coach)) bits.push(el("span", { class: "muted", text: ` ${c.team_name}` }));
    return el("span", { class: "award-who" }, bits);
  }

  function coachLine(c) {
    if (!c) return "";
    if (c.role) return `${c.role} · unit rank ${c.unit_rank} (roster rank ${c.rating_rank}) · ${c.wins} wins`;
    if ("surprise" in c) return `${c.wins}-${c.losses}${c.rank ? ` · #${c.rank}` : ""} · expected ${c.expected} wins${c.preseason_rank ? ` · preseason #${c.preseason_rank}` : " · preseason unranked"}${c.champion ? " · conference champion" : ""}`;
    if ("sack_rate" in c) return `${c.rush_ypg} rush yds/g · ${c.ypc} per carry · sacks on ${c.sack_rate}% of dropbacks`;
    return "";
  }
  const headlineOf = (c) => {
    if (c.headline) return c.headline;
    if ("surprise" in c) return `${c.wins}-${c.losses}`;
    if ("sack_rate" in c) return `${c.ypc} ypc`;
    if (c.coach) return `${c.wins} wins`;
    return c.line ? c.line.split(";")[0].split(",").slice(0, 2).join(",") : "";
  };

  // A sortable table. cols: [{key, label, left, get(row) -> text/node, sort(row) -> number|string}]
  function sortableTable(cols, rows, st, onSort, rowClass) {
    const table = el("table", { class: "stats" });
    const head = el("tr", {}, cols.map((c) => el("th", { class: `${c.sort ? "sortable" : ""} ${c.left ? "left" : ""} ${c.ph ? "ph" : ""} ${st.sort === c.key ? (st.desc ? "sorted-desc" : "sorted-asc") : ""}`, text: c.label, "data-key": c.sort ? c.key : "" })));
    head.addEventListener("click", (e) => { const th = e.target.closest("th[data-key]"); if (th && th.dataset.key) { if (st.sort === th.dataset.key) st.desc = !st.desc; else { st.sort = th.dataset.key; st.desc = true; } onSort(); } });
    table.append(head);
    let list = rows.slice();
    const sc = cols.find((c) => c.key === st.sort && c.sort);
    if (sc) list.sort((a, b) => { const av = sc.sort(a), bv = sc.sort(b); const r = typeof av === "string" ? av.localeCompare(bv) : av - bv; return st.desc ? -r : r; });
    for (const r of list) {
      table.append(el("tr", { class: rowClass ? rowClass(r) : "" }, cols.map((c) => { const v = c.get(r); return el("td", { class: `${c.left ? "left" : ""} ${c.ph ? "ph" : ""}` }, [v == null ? "" : v]); })));
    }
    return el("div", { class: "table-scroll" }, [table]);
  }

  function heismanHero(h, live) {
    const w = h.winner;
    const tiles = live
      ? [["Points", w.points], ["1st-place", w.first], ["Ballots", h.ballots], ["Record", w.record]]
      : [["Points", w.points], ["Share", `${h.share}%`], ["1st-place", `${w.first} of ${h.ballots}`], ["Record", `${w.record}${w.rank ? ` · #${w.rank}` : ""}`]];
    return el("div", { class: `review-card heisman-hero ${w.team === state.season.team ? "mine" : ""}` }, [
      el("div", { class: "review-label", text: live ? "Leading the straw poll" : "Heisman Trophy winner" }),
      el("div", { class: "review-big" }, [teamPill(w.team), w.name, el("span", { class: "pos", text: `${w.position}${classLabel(w.class)} · ${w.team_name}` })]),
      el("div", { class: "muted small-text", text: w.line }),
      el("div", { class: "review-tiles" }, tiles.map(([k, v]) => el("div", { class: "review-tile" }, [el("div", { class: "review-leader-big", text: String(v) }), el("div", { class: "review-label", text: k })]))),
      live ? null : el("div", { class: "muted small-text", text: `Finalists in New York: ${h.finalists.map((f) => `${f.name} (${f.team_name}, ${f.points})`).join(", ")}` }),
    ]);
  }

  function heismanView(box, h, live) {
    if (!h || !h.candidates || !h.candidates.length) { box.append(el("p", { class: "muted", text: "No Heisman race yet. Advance a week." })); return; }
    box.append(heismanHero(h, live));
    box.append(el("p", { class: "muted small-text", text: live
      ? `Straw poll of the Heisman electorate on the season so far: ${h.ballots} ballots, three names each, 3-2-1 points. Click a column to sort.`
      : `${h.ballots} ballots (870 media voters in six regions, the past winners and the fan vote), three names each, 3-2-1 points. Click a column to sort.` }));
    const st = awardsState;
    if (!st.sort) { st.sort = "points"; st.desc = true; }
    const cols = [
      { key: "rank", label: "#", get: (c) => String(c.i + 1), sort: (c) => c.i },
      { key: "player", label: "Player", left: true, get: (c) => who(c, false), sort: (c) => c.name },
      { key: "team", label: "Team", left: true, get: (c) => el("span", {}, [teamPill(c.team), c.team_name]), sort: (c) => c.team_name },
      { key: "record", label: "Rec", ph: true, get: (c) => c.record, sort: (c) => Number(c.record.split("-")[0]) - Number(c.record.split("-")[1]) / 100 },
      { key: "cfp", label: "Rank", get: (c) => (c.rank ? `#${c.rank}` : "–"), sort: (c) => -(c.rank || 99) },
      { key: "region", label: "Region", ph: true, get: (c) => c.region, sort: (c) => c.region },
      { key: "first", label: "1st", ph: true, get: (c) => String(c.first), sort: (c) => c.first },
      { key: "second", label: "2nd", ph: true, get: (c) => String(c.second), sort: (c) => c.second },
      { key: "third", label: "3rd", ph: true, get: (c) => String(c.third), sort: (c) => c.third },
      { key: "points", label: "Pts", get: (c) => el("b", { text: String(c.points) }), sort: (c) => c.points },
      { key: "line", label: "Season", left: true, ph: true, get: (c) => el("span", { class: "muted small-text", text: c.line }) },
    ];
    box.append(sortableTable(cols, h.candidates.map((c, i) => ({ ...c, i })), st, () => renderAwards(), (c) => c.team === state.season.team ? "mine" : ""));
  }

  function awardCard(a, live, mode) {
    // one award as a leader card: winner (or leader) on top, then the rest of the top five
    const card = el("div", { class: "leader-card award-card" });
    card.append(el("div", { class: "leader-head" }, [el("h4", { text: a.name }), a.honors ? el("span", { class: "muted small-text", text: a.honors }) : null]));
    const list = live ? (a.race || a.finalists || []) : (a.finalists || []);
    if (!list.length) { card.append(el("p", { class: "muted small-text", text: "No eligible players yet." })); return card; }
    list.forEach((c, i) => {
      const row = el("div", { class: `leader-row ${i === 0 ? "top" : ""} ${c.team === state.season.team ? "mine" : ""}` }, [
        el("span", { class: "rank", text: live ? String(i + 1) : (i === 0 ? "W" : String(i + 1)) }),
        el("span", { class: "who" }, [el("span", { class: "name" }, [teamPill(c.team), el("span", { text: c.name || c.coach || c.team_name, ...(c.name ? playerAttrs(c.team, c.name, c.position) : {}) }), el("span", { class: "pos", text: c.position ? `${c.position}${classLabel(c.class)}` : (c.role || "") })]),
          el("span", { class: "muted small-text", text: `${(c.name || c.coach) ? c.team_name + " · " : ""}${mode === "coach" ? coachLine(c) : (c.line || "")}` })]),
        el("span", { class: "value", text: headlineOf(c) }),
      ]);
      card.append(row);
    });
    return card;
  }

  function awardGrid(items, live, mode) {
    return el("div", { class: "leaders-grid awards-grid" }, items.map((a) => awardCard(a, live, mode)));
  }

  function awardSummaryTable(items, live, st) {
    // the compact view: one row per award
    const rows = items.map((a) => ({ a, w: (live ? (a.race || a.finalists || []) : (a.finalists || []))[0] })).filter((r) => r.w);
    const cols = [
      { key: "award", label: "Award", left: true, get: (r) => el("b", { text: r.a.name }), sort: (r) => r.a.name },
      { key: "who", label: live ? "Leader" : "Winner", left: true, get: (r) => who(r.w, false), sort: (r) => r.w.name || r.w.coach || "" },
      { key: "team", label: "Team", left: true, get: (r) => el("span", {}, [teamPill(r.w.team), r.w.team_name]), sort: (r) => r.w.team_name },
      { key: "conf", label: "Conference", left: true, ph: true, get: (r) => r.w.conference || "", sort: (r) => r.w.conference || "" },
      { key: "line", label: "Season", left: true, ph: true, get: (r) => el("span", { class: "muted small-text", text: r.w.line || coachLine(r.w) }) },
    ];
    return sortableTable(cols, rows, st, () => renderAwards(), (r) => r.w.team === state.season.team ? "mine" : "");
  }

  function teamTableView(box, title, picks, levels, st) {
    box.append(el("h3", { text: title }));
    const level = Math.min(st.level, levels || 1);
    if ((levels || 1) > 1) box.append(chipRow([[1, "First team"], [2, "Second team"], [3, "Third team"]].slice(0, levels), level, (v) => { st.level = v; renderAwards(); }));
    const rows = picks.filter((p) => p.level === level);
    const cols = [
      { key: "slot", label: "Slot", get: (c) => c.slot, sort: (c) => c.order },
      { key: "player", label: "Player", left: true, get: (c) => who(c, false), sort: (c) => c.name },
      { key: "team", label: "Team", left: true, get: (c) => el("span", {}, [teamPill(c.team), c.team_name]), sort: (c) => c.team_name },
      { key: "conf", label: "Conference", left: true, ph: true, get: (c) => c.conference, sort: (c) => c.conference },
      { key: "sel", label: "Selectors", get: (c) => (c.unanimous ? el("span", { class: "award-extra", text: "unanimous" }) : c.selectors ? `${c.selectors} of 5` : ""), sort: (c) => c.selectors || 0 },
      { key: "line", label: "Season", left: true, ph: true, get: (c) => el("span", { class: "muted small-text", text: c.line }) },
    ];
    if (!rows.some((c) => c.selectors)) cols.splice(4, 1);
    box.append(sortableTable(cols, rows.map((c, i) => ({ ...c, order: i })), st, () => renderAwards(), (c) => c.team === state.season.team ? "mine" : ""));
  }

  async function renderAwards() {
    const s = state.season;
    if (!s) return;
    const box = $("#tab-awards");
    box.innerHTML = "";
    const key = `${s.id}|${s.current_week}`;
    if (!awardsState.data || awardsState.key !== key) {
      try { awardsState.data = await api(`/api/season/${s.id}/awards`); awardsState.key = key; awardsState.sort = null; } catch (err) { box.append(el("p", { class: "muted", text: err.message })); return; }
    }
    const d = awardsState.data;
    const st = awardsState;
    const live = !d.national;
    const nat = live ? d.race : d.national;
    if (st.conf === null) st.conf = d.my_conference;
    const views = [["mine", "My team"], ["heisman", "Heisman"], ["national", "National awards"], ["coaches", "Coach awards"],
                   ["allamerica", "All-America"], ["conference", "Conference awards"]].filter(([v]) => !(live && v === "allamerica") && (v !== "mine" || s.team));
    if (!views.some(([v]) => v === st.view)) st.view = views[0][0];
    const controls = el("div", { class: "stats-controls" });
    controls.append(chipRow(views, st.view, (v) => { st.view = v; st.sort = null; st.filter = ""; renderAwards(); }));
    const given = d.given_through || 0;
    const through = s.week_labels[s.current_week] || `week ${s.current_week}`;
    controls.append(el("span", { class: "muted small-text", text: live
      ? `Live race through ${through}: who would win if the voting were held now. Conference awards are given after championship week, the Heisman and national awards in selection week, the postseason awards after the title game.`
      : `Conference awards given after championship week${given >= 15 ? "; Heisman, national awards and All-America teams in selection week" : ""}${given >= 19 ? "; postseason awards after the national championship" : ""}.` }));
    box.append(controls);
    const v = st.view;

    if (v === "heisman") { heismanView(box, nat && nat.heisman, live); return; }

    if (v === "national") {
      const all = [...(nat ? nat.awards : []), ...(!live && d.postseason ? d.postseason.awards.filter((a) => a.kind !== "coach") : [])];
      const filters = [["", "All"], ["offense", "Offense"], ["defense", "Defense"], ["special", "Special teams"], ["poy", "Player of the year"], ["table", "Table view"]];
      box.append(chipRow(filters, st.filter, (f) => { st.filter = f; st.sort = null; renderAwards(); }));
      const kindOf = (a) => (["mvp", "mvp_team", "freshman"].includes(a.kind) ? "poy" : OFFENSE_KINDS.has(a.kind) ? "offense" : DEFENSE_KINDS.has(a.kind) ? "defense" : ST_KINDS.has(a.kind) ? "special" : "poy");
      const items = st.filter && st.filter !== "table" ? all.filter((a) => kindOf(a) === st.filter) : all;
      if (st.filter === "table") box.append(awardSummaryTable(items, live, st));
      else box.append(awardGrid(items, live, items.some((a) => a.kind === "ol_unit") ? null : null));
      return;
    }

    if (v === "coaches") {
      const all = [...(nat ? nat.coach_awards : []), ...(!live && d.postseason ? d.postseason.awards.filter((a) => a.kind === "coach") : [])];
      box.append(chipRow([["", "Cards"], ["table", "Table view"]], st.filter, (f) => { st.filter = f; st.sort = null; renderAwards(); }));
      if (st.filter === "table") box.append(awardSummaryTable(all, live, st));
      else box.append(awardGrid(all, live, "coach"));
      return;
    }

    if (v === "allamerica") {
      const aa = nat.all_america;
      const sels = [["consensus", "Consensus"], ...Object.keys(aa.selectors).map((k) => [k, k])];
      box.append(chipRow(sels, st.selector, (k) => { st.selector = k; st.level = 1; st.sort = null; renderAwards(); }));
      if (st.selector === "consensus") {
        box.append(el("p", { class: "muted small-text", text: `${aa.consensus.length} consensus All-Americans (first team on at least three of the five NCAA-recognized selectors), ${aa.unanimous.length} unanimous.` }));
        teamTableView(box, "Consensus All-America team", aa.consensus.map((c) => ({ ...c, level: 1 })), 1, st);
      } else {
        teamTableView(box, `${st.selector} All-America team`, aa.selectors[st.selector], 2, st);
      }
      return;
    }

    if (v === "conference") {
      const confs = live ? (nat.conference || {}) : (d.conference || {});
      const names = Object.keys(confs).sort((a, b) => (a === d.my_conference ? -1 : b === d.my_conference ? 1 : a.localeCompare(b)));
      if (!names.length) { box.append(el("p", { class: "muted", text: "No conference races yet." })); return; }
      if (!live) box.append(confChips(names, st.conf in confs ? st.conf : "", (c) => { st.conf = c; st.sort = null; st.level = 1; renderAwards(); }));
      const picked = live ? names : (st.conf in confs ? [st.conf] : names);
      if (!live && picked.length > 1) {
        // all conferences: one row per award
        const rows = [];
        for (const conf of names) for (const a of confs[conf].awards || []) if (a.winner) rows.push({ conf, a, w: a.winner });
        const cols = [
          { key: "conf", label: "Conference", left: true, get: (r) => r.conf, sort: (r) => r.conf },
          { key: "award", label: "Award", left: true, get: (r) => el("b", { text: r.a.name }), sort: (r) => r.a.name },
          { key: "who", label: "Winner", left: true, get: (r) => who(r.w, false), sort: (r) => r.w.name || r.w.coach || "" },
          { key: "team", label: "Team", left: true, get: (r) => el("span", {}, [teamPill(r.w.team), r.w.team_name]), sort: (r) => r.w.team_name },
          { key: "line", label: "Season", left: true, get: (r) => el("span", { class: "muted small-text", text: r.w.line || coachLine(r.w) }) },
        ];
        box.append(sortableTable(cols, rows, st, () => renderAwards(), (r) => r.w.team === s.team ? "mine" : ""));
        return;
      }
      for (const conf of picked) {
        const entry = confs[conf];
        box.append(el("h3", { text: live ? `${conf} races` : `${conf} awards` }));
        box.append(awardGrid(entry.awards || [], live, "mixed"));
        if (!live && entry.teams && entry.teams.selectors) {
          for (const [sel, picks] of Object.entries(entry.teams.selectors)) teamTableView(box, `All-${conf} team (${sel})`, picks, entry.teams.levels, st);
        }
      }
      return;
    }

    // "mine": your players in every race (live) or every award and placement (final)
    const rows = [];
    if (live) {
      const h = nat && nat.heisman;
      if (h) h.candidates.forEach((c, i) => { if (c.team === s.team) rows.push({ stage: "Heisman", award: "Heisman straw poll", who: c.name, position: c.position, place: `${ORD(i)} · ${c.points} points`, rank: i + 1, line: c.line }); });
      for (const a of (nat ? nat.awards : [])) (a.race || []).forEach((c, i) => { if (c.team === s.team) rows.push({ stage: "National awards", award: a.name, who: c.name, position: c.position, place: `${ORD(i)} of 5`, rank: i + 1, line: c.line }); });
      for (const a of (nat ? nat.coach_awards : [])) (a.finalists || []).forEach((c, i) => { if (c.team === s.team) rows.push({ stage: "Coach awards", award: a.name, who: c.coach, position: c.role || "Head coach", place: ORD(i), rank: i + 1, line: coachLine(c) }); });
      for (const [conf, entry] of Object.entries(nat && nat.conference ? nat.conference : {})) for (const a of entry.awards || []) (a.finalists || []).forEach((c, i) => { if (c.team === s.team) rows.push({ stage: `${conf} awards`, award: a.name, who: c.name || c.coach, position: c.position || "Head coach", place: ORD(i), rank: i + 1, line: c.line || coachLine(c) }); });
    } else {
      for (const m of d.mine || []) rows.push({ ...m, rank: /winner|unanimous/i.test(m.place) ? 0 : /first/i.test(m.place) ? 1 : /second/i.test(m.place) ? 2 : /finalist|third/i.test(m.place) ? 3 : 9 });
    }
    box.append(el("h3", { text: live ? `${s.team_name} in the races` : `${s.team_name} awards and honors` }));
    if (!rows.length) { box.append(el("p", { class: "muted", text: live ? "Nobody from your team is in a top five yet." : "No awards or placements this season." })); return; }
    const stages = [...new Set(rows.map((r) => r.stage))];
    box.append(chipRow([["", "All"], ...stages.map((x) => [x, x])], st.mineFilter, (f) => { st.mineFilter = f; renderAwards(); }));
    const shown = st.mineFilter ? rows.filter((r) => r.stage === st.mineFilter) : rows;
    const wins = shown.filter((r) => r.rank === 0).length;
    box.append(el("div", { class: "review-tiles" }, [[String(shown.length), "honors"], [String(wins), live ? "races led" : "awards won"], [String(new Set(shown.map((r) => r.who)).size), "players and coaches"]].map(([v, k]) => el("div", { class: "review-tile" }, [el("div", { class: "review-leader-big", text: v }), el("div", { class: "review-label", text: k })]))));
    if (!st.sort) { st.sort = "result"; st.desc = false; }
    const cols = [
      { key: "stage", label: "Stage", left: true, ph: true, get: (r) => r.stage, sort: (r) => r.stage },
      { key: "award", label: "Award", left: true, get: (r) => el("b", { text: r.award }), sort: (r) => r.award },
      { key: "who", label: "Who", left: true, get: (r) => el("span", { class: "name" }, [el("span", { text: r.who, ...(r.position && r.position !== "Head coach" && !/coordinator/i.test(r.position) ? playerAttrs(state.season.team, r.who, r.position) : {}) }), r.position ? el("span", { class: "pos", text: r.position }) : null]), sort: (r) => r.who || "" },
      { key: "result", label: "Result", left: true, get: (r) => el("span", { class: r.rank === 0 ? "win" : "", text: r.place }), sort: (r) => r.rank },
      { key: "line", label: "Season", left: true, ph: true, get: (r) => el("span", { class: "muted small-text", text: r.line || "" }) },
    ];
    box.append(sortableTable(cols, shown, st, () => renderAwards()));
  }

  async function renderSummary() {
    const s = state.season;
    const box = $("#tab-summary");
    box.innerHTML = "";
    let r;
    try { r = await api(`/api/season/${s.id}/review`); } catch (err) { box.append(el("p", { class: "muted", text: err.message })); return; }
    const m = r.mine;
    const pill = (slug) => teamPill(slug);
    const team = (slug, text, cls = "") => el("span", { class: `review-team ${cls}` }, [pill(slug), text]);
    const weekName = (w) => s.week_labels[w] || `Week ${w}`;
    if (s.heisman && s.heisman.winner) {
      const w = s.heisman.winner;
      const card = el("div", { class: `review-card heisman ${w.team === s.team ? "mine" : ""}` }, [
        el("div", { class: "review-label", text: "Heisman Trophy" }),
        el("div", { class: "review-big" }, [teamPill(w.team), w.name, el("span", { class: "pos", text: `${w.position} · ${w.team_name}` })]),
        el("div", { class: "muted small-text", text: `${w.line} · ${w.points} points, ${s.heisman.share}% of the possible points` }),
        el("div", { class: "muted small-text", text: `Finalists: ${s.heisman.finalists.map((f) => `${f.name} (${f.team_name}, ${f.points})`).join(", ")}` }),
      ]);
      card.classList.add("clickable");
      card.addEventListener("click", () => { state.tab = "awards"; awardsState.view = "heisman"; renderTab(); });
      box.append(card);
    }

    renderRivalriesCard(box);

    // one playoff / title game as "winner score – loser score · bowl"
    const gameRow = (g, note) => {
      const row = el("div", { class: "review-game" });
      if (!g || !g.played) {
        row.append(el("span", { class: "muted", text: g ? `${g.away_name} vs ${g.home_name}` : "TBD" }), el("span", { class: "review-note muted", text: "not yet played" }));
        return row;
      }
      const hw = g.home_score > g.away_score;
      const [ws, wn, wsc] = hw ? [g.home, g.home_name, g.home_score] : [g.away, g.away_name, g.away_score];
      const [ls, ln, lsc] = hw ? [g.away, g.away_name, g.away_score] : [g.home, g.home_name, g.home_score];
      const ot = g.overtime ? `${g.overtime > 1 ? g.overtime : ""}OT` : "";
      const noteText = [note, ot].filter(Boolean).join(" · ");
      row.append(...[
        el("span", { class: "review-side win" }, [team(ws, wn), el("b", { text: String(wsc) })]),
        el("span", { class: "review-side" }, [team(ls, ln), el("span", { text: String(lsc) })]),
        noteText ? el("span", { class: "review-note muted", text: noteText }) : null,
      ].filter(Boolean));
      if (s.schedule.some((x) => x.event_id === g.event_id && x.has_box)) { row.classList.add("clickable"); row.addEventListener("click", () => openBox(g.event_id)); }
      return row;
    };
    const bowlOf = (g) => g.title ? g.title.replace(/ \((Quarterfinal|Semifinal)\)/, "").replace("College Football Playoff National Championship", "") : "";

    // ---- hero: champion and your season ----
    const hero = el("div", { class: "review-hero" });
    const champ = el("div", { class: "review-card" }, [el("div", { class: "review-label", text: r.done ? "National champion" : "National championship" })]);
    if (r.champion_name) {
      champ.append(el("div", { class: "review-big" }, [pill(r.champion), r.champion_name]));
      if (r.title_game) champ.append(...[gameRow(r.title_game), r.title_game.site ? el("div", { class: "muted small-text", text: r.title_game.site }) : null].filter(Boolean));
    } else {
      champ.append(el("div", { class: "review-big muted", text: "Not decided yet" }), el("div", { class: "muted small-text", text: r.title_game && r.title_game.site ? `${r.title_game.site} · January 25` : "January 25, 2027" }));
    }
    hero.append(champ);

    const mineCard = el("div", { class: "review-card mine" }, [el("div", { class: "review-label", text: "Your season" })]);
    mineCard.append(el("div", { class: "review-big" }, [pill(m.team), `${m.name} ${m.wins}-${m.losses}`]));
    const bits = [`${m.conf_wins}-${m.conf_losses} in the ${m.conference}`];
    if (m.conf_rank) bits.push(`${ordinal(m.conf_rank)} in the ${m.division ? m.conference + " " + m.division : m.conference}`);
    if (m.conf_champion) bits.push(`${m.conference} champion`);
    if (m.finish) bits.push(m.finish);
    mineCard.append(el("div", { class: "small-text", text: bits.join(" · ") }));
    const tile = (label, value) => el("div", { class: "review-tile" }, [el("div", { class: "review-tile-value", text: String(value) }), el("div", { class: "review-tile-label", text: label })]);
    mineCard.append(el("div", { class: "review-tiles" }, [
      tile("Points / game", m.points_per_game), tile("Allowed / game", m.allowed_per_game), tile("Longest streak", m.longest_streak),
      m.final_cfp ? tile(r.done ? "Final CFP" : "CFP rank", `#${m.final_cfp}`) : null, m.final_ap ? tile(r.done ? "Final AP" : "AP rank", `#${m.final_ap}`) : null,
    ]));
    hero.append(mineCard);
    box.append(el("h3", { text: r.done ? "Season in review" : `Season so far · through ${weekName(r.current_week)}` }), hero);

    // ---- playoff rounds ----
    if (r.rounds.length) {
      box.append(el("h3", { text: "Playoff" }));
      const rounds = el("div", { class: "review-rounds" });
      for (const rd of r.rounds) {
        const col = el("div", { class: "review-round" }, [el("div", { class: "review-label", text: rd.round })]);
        for (const g of rd.games) col.append(gameRow(g, rd.round === "First round" ? "" : bowlOf(g)));
        rounds.append(col);
      }
      box.append(rounds);
    }

    // ---- conference champions and rankings, side by side ----
    const two = el("div", { class: "review-two" });
    if (r.champions.length) {
      const sec = el("div", {}, [el("h3", { text: "Conference champions" })]);
      const t = el("table", { class: "stats review-table" });
      t.append(el("tr", {}, [el("th", { text: "Conference", style: "text-align:left" }), el("th", { text: "Champion", style: "text-align:left" }), el("th", { text: "Title game", style: "text-align:left" })]));
      for (const c of r.champions) {
        const g = c.game;
        const line = g && g.played ? `${g.winner === g.home ? g.home_name : g.away_name} ${Math.max(g.home_score, g.away_score)}, ${g.winner === g.home ? g.away_name : g.home_name} ${Math.min(g.home_score, g.away_score)}` : "";
        t.append(el("tr", { class: c.team === m.team ? "mine" : "" }, [el("td", { class: "muted", text: c.conference }), el("td", {}, [team(c.team, c.name)]), el("td", { class: "muted", text: line })]));
      }
      sec.append(t);
      two.append(sec);
    }
    if (r.final_cfp.length || r.final_ap.length) {
      const sec = el("div", {}, [el("h3", { text: r.done ? "Final rankings" : "Rankings" })]);
      const polls = el("div", { class: "review-polls" });
      const list = (title, rows) => {
        const t = el("table", { class: "stats review-table" });
        t.append(el("tr", {}, [el("th", { text: "#" }), el("th", { text: title, style: "text-align:left" }), el("th", { text: "Record" })]));
        for (const e of rows) t.append(el("tr", { class: e.team === m.team ? "mine" : "" }, [el("td", { text: String(e.rank) }), el("td", {}, [team(e.team, e.name)]), el("td", { text: e.record })]));
        return t;
      };
      if (r.final_cfp.length) polls.append(list("CFP ranking", r.final_cfp));
      if (r.final_ap.length) polls.append(list("AP poll", r.final_ap));
      sec.append(polls);
      two.append(sec);
    }
    if (two.children.length) box.append(two);

    // ---- your results ----
    const resultRow = (l, label, note) => {
      if (!l) return null;
      const vs = l.venue === "away" ? "at" : "vs";
      if (note === undefined) note = l.title && l.title !== label ? l.title : l.title ? "" : weekName(l.week);
      const row = el("div", { class: `review-result ${l.has_box ? "clickable" : ""}` }, [
        el("span", { class: "review-result-label muted", text: label }),
        el("span", { class: `review-result-score ${l.won ? "win" : "loss"}`, text: `${l.won ? "W" : "L"} ${l.points_for}-${l.points_against}${l.overtime ? " OT" : ""}` }),
        el("span", { class: "review-result-opp" }, [`${vs} `, l.opponent_rank ? el("span", { class: "rank", text: `#${l.opponent_rank} ` }) : null, team(l.opponent, l.opponent_name), el("span", { class: "muted", text: l.opponent_record ? ` (${l.opponent_record})` : "" })]),
        el("span", { class: "review-note muted", text: note }),
      ]);
      if (l.has_box) row.addEventListener("click", () => openBox(l.event_id));
      return row;
    };
    const results = el("div", { class: "review-two results" });
    const high = el("div", {}, [el("h3", { text: "Highlights" })]);
    for (const x of [resultRow(m.best_win, "Best win"), resultRow(m.worst_loss, "Worst loss"), resultRow(m.biggest_win, "Biggest win"), resultRow(m.closest_loss, "Closest loss")]) if (x) high.append(x);
    if (high.children.length > 1) results.append(high);
    if (m.postseason.length) {
      const ps = el("div", {}, [el("h3", { text: "Postseason" })]);
      const roundLabel = { 17: "First round", 18: "Quarterfinal", 19: "Semifinal", 20: "Final" };
      for (const l of m.postseason) {
        const label = l.kind === "ccg" ? "Conf. title" : l.kind === "bowl" ? "Bowl" : roundLabel[l.week] || "Playoff";
        const note = l.kind === "playoff" && l.week === 19 ? "" : l.kind === "playoff" ? bowlOf(l) : l.title || "";
        ps.append(resultRow(l, label, note));
      }
      results.append(ps);
    }
    if (results.children.length) box.append(results);

    // ---- surprise and disappointment ----
    if (r.surprises.length || r.disappointments.length) {
      // one sentence on the team's AP path: where it started, its peak, where it ended
      const wk = (w) => (w <= 14 ? `Week ${w}` : (s.week_labels[w] || `week ${w}`).toLowerCase().replace("championship week", "championship week").replace("selection", "selection day"));
      const expl = (x, cls) => {
        const endWord = r.done ? "finished" : "sits";
        const start = x.preseason_rank ? `Started the season #${x.preseason_rank}` : "Started the season unranked";
        if (x.peak_rank == null) return cls === "surprise" ? `${start} and ${r.done ? "went" : "is"} ${x.record} without the poll noticing.` : `${start} and ${r.done ? "stumbled to" : "is a disappointing"} ${x.record}.`;
        if (x.final_rank != null && x.final_rank === x.peak_rank) {
          if (x.preseason_rank === x.final_rank) return `Started and ${endWord} the season at #${x.final_rank}.`;
          const climbed = !x.preseason_rank || x.final_rank < x.preseason_rank;
          return `${start}, ${climbed ? "climbed" : "slipped"} to #${x.final_rank} and ${endWord} there.`;
        }
        // mention the peak only when it was a real climb that lasted past the week it happened
        const improved = (!x.preseason_rank || x.peak_rank <= x.preseason_rank - 2) && x.peak_week < x.last_ranked_week;
        const end = x.final_rank != null
          ? `slid to #${x.final_rank}`
          : `dropped out of the poll after ${wk(x.last_ranked_week)} and ${endWord} unranked`;
        return improved ? `${start}, reached #${x.peak_rank} by ${wk(x.peak_week)}, then ${end}.` : `${start}, ${end}.`;
      };
      const storyCard = (title, rows, cls) => {
        if (!rows.length) return null;
        const [first, ...rest] = rows;
        const card = el("div", { class: `review-card ${cls}` }, [
          el("div", { class: "review-label", text: title }),
          el("div", { class: "review-big" }, [pill(first.team), `${first.name} ${first.record}`]),
          el("div", { class: "small-text", text: `${first.conference}. ${expl(first, cls)}` }),
        ]);
        if (rest.length) card.append(el("div", { class: "review-runners muted small-text" }, rest.map((x) => el("div", {}, [team(x.team, `${x.name} ${x.record}`), el("span", { text: ` — ${expl(x, cls)}` })]))));
        return card;
      };
      box.append(el("h3", { text: r.done ? "Surprise and disappointment" : "Surprise and disappointment so far" }));
      box.append(el("div", { class: "review-hero" }, [storyCard("Biggest surprise", r.surprises, "surprise"), storyCard("Biggest disappointment", r.disappointments, "letdown")].filter(Boolean)));
    }

    // ---- statistical leaders ----
    const L = m.leaders;
    const st = (p, k) => (p && p.stats[k]) || 0;
    const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "–");
    const leader = (title, p, big, line) => p ? el("div", { class: "review-leader" }, [
      el("div", { class: "review-label", text: title }),
      el("div", { class: "review-leader-name" }, [p.name, el("span", { class: "pos", text: p.position })]),
      el("div", { class: "review-leader-big", text: big(p) }),
      el("div", { class: "muted small-text", text: line(p) }),
    ]) : null;
    const leaders = [
      leader("Passing", L.passer, (p) => `${st(p, "pass_yards").toLocaleString()} yds`, (p) => `${st(p, "completions")}/${st(p, "pass_attempts")} (${pct(st(p, "completions"), st(p, "pass_attempts"))}) · ${st(p, "passing_touchdowns")} TD · ${st(p, "interceptions_thrown")} INT`),
      leader("Rushing", L.rusher, (p) => `${st(p, "rush_yards").toLocaleString()} yds`, (p) => `${st(p, "carries")} carries · ${(st(p, "rush_yards") / Math.max(1, st(p, "carries"))).toFixed(1)} avg · ${st(p, "rushing_touchdowns")} TD`),
      leader("Receiving", L.receiver, (p) => `${st(p, "receiving_yards").toLocaleString()} yds`, (p) => `${st(p, "receptions")} catches · ${(st(p, "receiving_yards") / Math.max(1, st(p, "receptions"))).toFixed(1)} avg · ${st(p, "receiving_touchdowns")} TD`),
      leader("Tackles", L.tackler, (p) => `${st(p, "solo_tackles") + st(p, "assisted_tackles")} tackles`, (p) => `${st(p, "solo_tackles")} solo · ${st(p, "assisted_tackles")} assisted · ${st(p, "sacks")} sacks`),
      leader("Sacks", L.sacks, (p) => `${st(p, "sacks")} sacks`, (p) => `${st(p, "solo_tackles") + st(p, "assisted_tackles")} tackles · ${st(p, "forced_fumbles")} forced fumbles`),
      leader("Interceptions", L.interceptions, (p) => `${st(p, "interceptions")} INT`, (p) => `${st(p, "interception_return_yards")} return yds · ${st(p, "defensive_touchdowns")} TD`),
      leader("Kicking", L.kicker, (p) => `${st(p, "fg_made") * 3 + st(p, "pat_made")} points`, (p) => `${st(p, "fg_made")}/${st(p, "fg_attempted")} FG · ${st(p, "pat_made")}/${st(p, "pat_attempts")} PAT`),
      leader("Returns", L.returner, (p) => `${st(p, "kickoff_return_yards") + st(p, "punt_return_yards")} yds`, (p) => `${st(p, "kickoff_returns")} kickoffs for ${st(p, "kickoff_return_yards")} · ${st(p, "punt_returns")} punts for ${st(p, "punt_return_yards")}`),
    ].filter(Boolean);
    if (leaders.length) {
      box.append(el("h3", { text: `${m.name} leaders${L.games_with_stats < (m.wins + m.losses) ? ` · ${L.games_with_stats} simulated games` : ""}` }));
      box.append(el("div", { class: "review-leaders" }, leaders));
    }

    // ---- national leaders ----
    const N = r.national_leaders || {};
    const nat = (title, p, big, line) => p ? el("div", { class: "review-leader" }, [
      el("div", { class: "review-label", text: title }),
      el("div", { class: "review-leader-name" }, [p.name, el("span", { class: "pos", text: p.position })]),
      el("div", { class: "small-text" }, [team(p.team, p.team_name)]),
      el("div", { class: "review-leader-big", text: big(p) }),
      el("div", { class: "muted small-text", text: line(p) }),
    ]) : null;
    const national = [
      nat("Passing yards", N.passing, (p) => `${st(p, "pass_yards").toLocaleString()} yds`, (p) => `${st(p, "completions")}/${st(p, "pass_attempts")} (${pct(st(p, "completions"), st(p, "pass_attempts"))}) · ${st(p, "passing_touchdowns")} TD · ${st(p, "interceptions_thrown")} INT · ${p.games} g`),
      nat("Rushing yards", N.rushing, (p) => `${st(p, "rush_yards").toLocaleString()} yds`, (p) => `${st(p, "carries")} carries · ${(st(p, "rush_yards") / Math.max(1, st(p, "carries"))).toFixed(1)} avg · ${st(p, "rushing_touchdowns")} TD · ${p.games} g`),
      nat("Receiving yards", N.receiving, (p) => `${st(p, "receiving_yards").toLocaleString()} yds`, (p) => `${st(p, "receptions")} catches · ${(st(p, "receiving_yards") / Math.max(1, st(p, "receptions"))).toFixed(1)} avg · ${st(p, "receiving_touchdowns")} TD · ${p.games} g`),
      nat("Tackles", N.tackles, (p) => `${st(p, "tackles")} tackles`, (p) => `${st(p, "solo_tackles")} solo · ${st(p, "assisted_tackles")} assisted · ${p.games} g`),
      nat("Sacks", N.sacks, (p) => `${st(p, "sacks")} sacks`, (p) => `${st(p, "solo_tackles") + st(p, "assisted_tackles")} tackles · ${st(p, "forced_fumbles")} forced fumbles · ${p.games} g`),
      nat("Interceptions", N.interceptions, (p) => `${st(p, "interceptions")} INT`, (p) => `${st(p, "interception_return_yards")} return yds · ${st(p, "defensive_touchdowns")} TD · ${p.games} g`),
      nat("Scoring (kickers)", N.kicking, (p) => `${st(p, "points")} points`, (p) => `${st(p, "fg_made")}/${st(p, "fg_attempted")} FG · ${st(p, "pat_made")}/${st(p, "pat_attempts")} PAT · ${p.games} g`),
    ].filter(Boolean);
    if (national.length) {
      box.append(el("h3", { text: r.done ? "National leaders" : "National leaders so far" }));
      box.append(el("div", { class: "review-leaders" }, national));
    } else if (r.done || r.current_week > 0) {
      box.append(el("h3", { text: "National leaders" }), el("p", { class: "muted small-text", text: "This season was simulated before league-wide stats were kept; start a new season to see national leaders." }));
    }
  }

  function ordinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  const bowlsState = { sort: "date", conf: "", mine: false };

  function renderBowls() {
    const s = state.season;
    const box = $("#tab-bowls");
    box.innerHTML = "";
    const projection = !s.bowls || !s.bowls.length ? s.bowl_projection : null;
    const rows = (s.bowls && s.bowls.length) ? s.bowls : (projection ? projection.bowls : []);
    box.append(el("h3", { text: projection ? "Projected bowl lineup" : "Bowl season 2026-27" }));
    if (!rows.length) {
      box.append(el("p", { class: "muted", text: "Bowl projections start with the committee's first ranking (after week 9). The matchups are set on selection day, after championship week, once the playoff field is known: teams with six wins are eligible, and bowls pick from their tie-in conferences in payout order." }));
      return;
    }
    if (projection) {
      box.append(el("p", { class: "muted small-text", text: `As of the ${s.week_labels[projection.week] || "week " + projection.week} committee ranking: records carried to the end of the regular season on rating-based win odds, the current conference leaders as champions, the projected playoff field left out, then each bowl picks from its tie-ins. Projected final records in parentheses.` }));
    }
    // controls: sort, conference filter, my team
    const confs = [...new Set(rows.flatMap((b) => [b.home_conference, b.away_conference]).filter(Boolean))].sort();
    const controls = el("div", { class: "stats-controls" });
    const sortSel = el("select", { "aria-label": "Sort bowls" }, [
      el("option", { value: "date", text: "By date" }), el("option", { value: "bowl", text: "By bowl name" }),
      el("option", { value: "team", text: "By team" }), el("option", { value: "conference", text: "By conference" }),
    ]);
    sortSel.value = bowlsState.sort;
    sortSel.addEventListener("change", () => { bowlsState.sort = sortSel.value; renderBowls(); });
    const confSel = el("select", { "aria-label": "Conference" }, [el("option", { value: "", text: "All conferences" }), ...confs.map((c) => el("option", { value: c, text: c }))]);
    confSel.value = bowlsState.conf;
    confSel.addEventListener("change", () => { bowlsState.conf = confSel.value; renderBowls(); });
    const mineBtn = el("button", { type: "button", class: `ghost small ${bowlsState.mine ? "active" : ""}`, text: `${s.team_name} only` });
    mineBtn.addEventListener("click", () => { bowlsState.mine = !bowlsState.mine; renderBowls(); });
    controls.append(sortSel, confSel);
    if (s.team) controls.append(mineBtn);
    box.append(controls);

    let list = rows.filter((b) => (!bowlsState.conf || b.home_conference === bowlsState.conf || b.away_conference === bowlsState.conf) && (!bowlsState.mine || b.mine));
    const key = {
      date: (b) => [b.week, b.date || "", b.time || ""],
      bowl: (b) => [b.name],
      team: (b) => [[b.away_name, b.home_name].filter(Boolean).sort()[0] || "zz"],
      conference: (b) => [[b.away_conference, b.home_conference].filter(Boolean).sort()[0] || "zz", b.name],
    }[bowlsState.sort];
    list = list.slice().sort((a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < ka.length; i++) { if (ka[i] < kb[i]) return -1; if (ka[i] > kb[i]) return 1; } return 0; });
    if (!list.length) { box.append(el("p", { class: "muted", text: "No bowls match that filter." })); return; }

    const groups = { 17: "Early bowls (Dec 15-24)", 18: "Holiday week (Dec 26-31)", 19: "New Year's bowls (Jan 2)" };
    const rankWeek = (b) => (b.projected ? (s.current_week || 15) : 15);
    const side = (slug, name, record, won, b) => el("span", { class: won ? "win" : "" }, [teamPill(slug), rankTag(slug, rankWeek(b)), name, record ? el("span", { class: "muted small-text", text: ` (${record})` }) : null]);
    const card = (b) => {
      const played = b.played;
      const aw = played && b.away_score > b.home_score, hw = played && b.home_score > b.away_score;
      const c = el("div", { class: `bowl-card ${b.mine && s.team ? "mine" : ""} ${b.has_box ? "clickable" : ""}` });
      c.append(el("div", { class: "bowl-head" }, [
        el("b", { text: b.name }), el("span", { class: "muted small-text", text: ` ${b.date}${b.time ? " · " + b.time : ""} · ${b.site || ""}` }),
      ]));
      if (b.unfilled) {
        c.append(el("div", { class: "muted", text: "No eligible teams left for this bowl." }));
      } else {
        if (played) {
          // a played bowl reads like a bracket card: one row per team, the winner bold with a check, the loser faded
          const row = (slug, nm, rec, score, won) => el("div", { class: `bmatch-row ${won ? "win" : "lost"}` }, [
            teamPill(slug),
            el("span", { class: "bmatch-name" }, [rankTag(slug, rankWeek(b)), nm, rec ? el("span", { class: "muted small-text", text: ` (${rec})` }) : null, won ? el("span", { class: "won-tag", text: " ✓" }) : null]),
            el("b", { class: "bmatch-score", text: String(score) }),
          ]);
          c.append(el("div", { class: "bowl-result" }, [
            row(b.away, b.away_name, b.away_record, b.away_score, aw),
            row(b.home, b.home_name, b.home_record, b.home_score, hw),
            el("div", { class: "muted small-text", text: `Final${b.overtime ? ` · ${b.overtime > 1 ? b.overtime : ""}OT` : ""}` }),
          ]));
        } else {
          c.append(el("div", { class: "bowl-match" }, [
            side(b.away, b.away_name, b.away_record, false, b),
            el("span", { class: "muted", text: " vs " }),
            side(b.home, b.home_name, b.home_record, false, b),
          ]));
        }
      }
      // the tie-ins explain a projection; once the matchups are set the card is just the game
      if (b.projected && b.tie_ins && b.tie_ins.length) c.append(el("div", { class: "muted small-text", text: `Tie-ins: ${b.tie_ins.join(" vs ")}` }));
      if (b.has_box) c.addEventListener("click", () => openBox(b.event_id));
      return c;
    };
    if (bowlsState.sort === "date") {
      for (const w of [17, 18, 19]) {
        const wk = list.filter((b) => b.week === w);
        if (!wk.length) continue;
        box.append(el("h3", { text: groups[w] }));
        for (const b of wk) box.append(card(b));
      }
    } else {
      for (const b of list) box.append(card(b));
    }
  }

  function pollWeekFor(view) {
    // the poll shown for a week is the one released after that week's games
    const s = state.season;
    let w = Math.min(view, s.current_week);
    while (w > 0 && !s.polls[String(w)]) w--;
    return w;
  }

  const gamesState = { conf: "", view: "" };

  async function renderGames(container) {
    const s = state.season, w = state.viewWeek;
    if (container) gamesState.container = container;
    const box = gamesState.container && gamesState.container.isConnected ? gamesState.container : $("#tab-games");
    box.innerHTML = "";
    if (w === 0) { box.append(el("p", { class: "muted", text: "Preseason. Advance a week to play games." })); return; }
    let data;
    try { data = await api(`/api/season/${s.id}/week/${w}`); } catch (err) { box.append(el("p", { class: "muted", text: err.message })); return; }
    const label = s.week_labels[w] || `Week ${w}`;
    if (!data.games.length) { box.append(el("h3", { text: `${label} · 0 games` })); box.append(el("p", { class: "muted", text: w > s.current_week ? "Not played yet." : "No games this week." })); return; }
    // filters: conference chips, then a view chip (ranked, top-25 matchups, upsets, close games, overtime, conference games, my team)
    const gs = gamesState;
    const confOf = (slug) => { const t = window.CFP.teamsBySlug[slug]; return t && !t.fictional ? (t.conference || "") : ""; };
    const confs = [...new Set(data.games.flatMap((g) => [confOf(g.home), confOf(g.away)]).filter(Boolean))].sort();
    const controls = el("div", { class: "stats-controls" });
    controls.append(confChips(confs, confs.includes(gs.conf) ? gs.conf : "", (v) => { gs.conf = v; renderGames(); }));
    const views = [["", "All"], ["ranked", "Ranked"], ["top25", "Top-25 matchups"], ["upsets", "Upsets"], ["close", "Close games"], ["ot", "Overtime"], ["conf", "Conference games"], ...(s.team ? [["mine", "My team"]] : [])];
    const playedAny = data.games.some((g) => g.played);
    controls.append(chipRow(views.filter(([v]) => playedAny || !["upsets", "close", "ot"].includes(v)), gs.view, (v) => { gs.view = v; renderGames(); }));
    box.append(controls);
    const margin = (g) => Math.abs(g.home_score - g.away_score);
    const upset = (g) => {
      if (!g.played) return false;
      const hw = g.home_score > g.away_score;
      const wr = hw ? g.home_rank : g.away_rank, lr = hw ? g.away_rank : g.home_rank;
      return !!lr && (!wr || wr > lr);
    };
    const keep = (g) => {
      if (gs.conf && confOf(g.home) !== gs.conf && confOf(g.away) !== gs.conf) return false;
      switch (gs.view) {
        case "ranked": return !!(g.home_rank || g.away_rank);
        case "top25": return !!(g.home_rank && g.away_rank);
        case "upsets": return upset(g);
        case "close": return g.played && margin(g) <= 7;
        case "ot": return !!g.overtime;
        case "conf": return !!g.conference_game;
        case "mine": return !!g.mine;
        default: return true;
      }
    };
    const shown = data.games.filter(keep);
    box.append(el("h3", { text: `${label} · ${shown.length === data.games.length ? `${data.games.length} games` : `${shown.length} of ${data.games.length} games`}` }));
    if (!shown.length) { box.append(el("p", { class: "muted", text: "No games match that filter." })); return; }
    const table = el("table", { class: "stats games-table" });
    table.append(el("tr", {}, ["Away", "", "", "Home", "", "Game"].map((h, i) => el("th", { class: `${[0, 3, 5].includes(i) ? "left" : ""} ${i === 5 ? "ph" : ""}`, text: h }))));
    const fictional = (slug) => !!((window.CFP.teamsBySlug[slug] || {}).fictional);   // FCS stand-ins play many schedules: no record
    const teamCell = (slug, display, rank, record, won, lost) => el("td", { class: `left name team-cell ${won ? "win" : ""} ${lost ? "lost" : ""}` }, [
      teamPill(slug), rank ? el("span", { class: "rank", text: `#${rank} ` }) : null, display,
      record && !fictional(slug) ? el("span", { class: "pos", text: record }) : null,
    ]);
    for (const g of shown) {
      const played = g.played;
      const hw = played && g.home_score > g.away_score, aw = played && g.away_score > g.home_score;
      const note = [g.title, g.site, played ? (g.overtime ? `OT${g.overtime > 1 ? g.overtime : ""}` : g.real ? "real result" : "") : (g.neutral ? "neutral site" : "")].filter(Boolean).join(" · ");
      const tr = el("tr", { class: `${g.mine && s.team ? "mine" : ""} ${g.has_box ? "clickable" : ""}` }, [
        teamCell(g.away, g.away_display, g.away_rank, g.away_record, aw, played && !aw),
        el("td", { class: `score ${aw ? "win" : ""}`, text: played ? String(g.away_score) : "" }),
        el("td", { class: "muted", text: g.neutral ? "vs" : "at" }),
        teamCell(g.home, g.home_display, g.home_rank, g.home_record, hw, played && !hw),
        el("td", { class: `score ${hw ? "win" : ""}`, text: played ? String(g.home_score) : "" }),
        el("td", { class: "left muted small-text ph", text: note }),
      ]);
      if (g.has_box) tr.addEventListener("click", () => openBox(g.event_id));
      table.appendChild(tr);
    }
    box.append(el("div", { class: "table-scroll" }, [table]));
    if (shown.some((g) => g.has_box)) box.append(el("p", { class: "muted small-text", text: "Click any played game for its box score." }));
  }

  function injuryTable(rows, withTeam) {
    const table = el("table", { class: "stats" });
    table.append(el("tr", {}, [withTeam ? "Team" : null, "Player", "Injury", "Out", "Returns"].filter(Boolean).map((t) => el("th", { class: `left ${t === "Out" ? "ph" : ""}`, text: t }))));
    for (const i of rows) {
      const s = state.season;
      table.append(el("tr", { class: i.team === s.team ? "mine" : "" }, [
        withTeam ? el("td", { class: "left" }, [teamPill(i.team), i.team_name]) : null,
        el("td", { class: "name" }, [i.name, el("span", { class: "pos", text: i.position })]),
        el("td", { class: "left", text: i.type }),
        el("td", { class: "left ph", text: `${i.weeks_left} ${i.weeks_left === 1 ? "week" : "weeks"} (${i.weeks} total, since ${s.week_labels[i.since_week] || "week " + i.since_week})` }),
        el("td", { class: "left", text: i.returns_week > 19 ? "next season" : (s.week_labels[i.returns_week] || `week ${i.returns_week}`) }),
      ].filter(Boolean)));
    }
    return el("div", { class: "table-scroll" }, [table]);
  }

  async function renderInjuries(box) {
    const s = state.season;
    const mine = s.injuries || [];
    box.append(el("h3", { text: `Injury report · ${s.team_name}` }));
    if (!mine.length) box.append(el("p", { class: "muted small-text", text: "Nobody out this week." }));
    else box.append(injuryTable(mine, false));
    const head = el("div", { class: "leader-head" }, [el("h4", { text: `Around the league · ${s.injury_count || 0} players out` }), el("span", { class: "muted small-text", text: "show" })]);
    const holder = el("div", { hidden: true });
    head.addEventListener("click", async () => {
      holder.hidden = !holder.hidden;
      head.querySelector(".small-text").textContent = holder.hidden ? "show" : "hide";
      if (!holder.hidden && !holder.children.length) {
        try { const j = await api(`/api/season/${s.id}/injuries`); holder.append(j.injuries.length ? injuryTable(j.injuries, true) : el("p", { class: "muted", text: "No injuries anywhere." })); }
        catch (err) { holder.append(el("p", { class: "muted", text: err.message })); }
      }
    });
    box.append(el("div", { class: "injury-league" }, [head, holder]));
  }

  // ----- this week: the next game, a prediction, the injury report ----------------
  const thisWeekState = { key: null, data: null };
  async function renderThisWeek(box, d) {
    const s = state.season;
    const card = el("div", { class: "review-card this-week" });
    box.append(card);
    const key = `${s.id}|${s.current_week}|${(s.schedule || []).filter((g) => g.played).length}|${d.team}`;
    let data = thisWeekState.key === key ? thisWeekState.data : null;
    if (!data) {
      card.append(el("div", { class: "review-label", text: "This week" }), el("p", { class: "muted small-text", text: "Simulating the matchup…" }));
      try { data = await api(`/api/season/${s.id}/preview?team=${d.team}`); } catch (err) { card.innerHTML = ""; card.append(el("div", { class: "review-label", text: "This week" }), el("p", { class: "muted small-text", text: err.message })); return; }
      thisWeekState.key = key; thisWeekState.data = data;
    }
    if (!card.isConnected) return;
    card.innerHTML = "";
    const g = data.game;
    const injuryReport = () => {
      if (s.mode === "real") return;      // no real injury data
      const inj = data.injuries || [];
      const injBox = el("div", { class: "this-week-injuries" }, [el("h4", { text: `Injury report · ${inj.length ? `${inj.length} out` : "nobody out"}` })]);
      if (inj.length) injBox.append(injuryTable(inj, false));
      card.append(injBox);
    };
    if (!g) {
      const wkLabel = data.week ? (s.week_labels[data.week] || `Week ${data.week}`) : "";
      card.append(el("div", { class: "review-label", text: data.reason === "bye" ? `Bye this week${wkLabel ? " · " + wkLabel : ""}` : "This week" }),
        el("p", { class: "muted", text: data.reason === "done" ? "Season complete." : data.reason === "bye" ? "No game this week." : "No game left on the schedule." }));
      if (data.reason === "bye") injuryReport();
      return;
    }
    const p = data.prediction;
    const wk = s.week_labels[g.week] || `Week ${g.week}`;
    const dateText = g.date && /^\d{4}-\d{2}-\d{2}/.test(g.date) ? fmtDay(g.date.slice(0, 10), true) : (g.date || ((s.week_dates || {})[g.week] || {}).main ? fmtDay(s.week_dates[g.week].main, true) : "");
    const where = g.venue === "home" ? "Home" : g.venue === "away" ? "Away" : "Neutral site";
    card.append(el("div", { class: "review-label", text: g.played ? `This week · ${wk} · Final` : `This week · ${wk}` }));
    const oppLine = el("div", { class: "review-big" }, [
      el("span", { class: "muted", text: `${g.venue === "away" ? "at" : "vs"} ` }), g.opponent_rank ? el("span", { class: "rank", text: `#${g.opponent_rank} ` }) : null, teamPill(g.opponent), g.opponent_name,
      el("span", { class: "pos", text: `${g.opponent_record ? g.opponent_record + " · " : ""}${where}${g.title ? " · " + g.title : ""}` }),
    ]);
    card.append(oppLine);
    const bits = [dateText, g.site, g.rivalry ? `${g.rivalry.trophy ? "🏆 " + g.rivalry.trophy : "🔥 " + g.rivalry.name} · ${g.rivalry.headline ? g.rivalry.headline + " · " : ""}${g.rivalry.series}` : null].filter(Boolean);
    if (bits.length) card.append(el("div", { class: "muted small-text", text: bits.join(" · ") }));
    if (g.played) {
      // game day is done: the result, and the box score a click away
      card.append(el("div", { class: "review-tiles" }, [
        el("div", { class: "review-tile" }, [el("div", { class: `review-leader-big ${g.won ? "win" : "loss"}`, text: `${g.won ? "W" : "L"} ${g.points_for}–${g.points_against}${g.overtime ? " OT" : ""}` }), el("div", { class: "review-label", text: "Final" })]),
        el("div", { class: "review-tile" }, [el("div", { class: "review-leader-big", text: g.my_record || "" }), el("div", { class: "review-label", text: "Record" })]),
      ]));
      if (g.has_box) { const b = el("button", { type: "button", class: "ghost small", text: "Box score" }); b.addEventListener("click", () => openBox(g.event_id)); card.append(b); }
      card.append(el("div", { class: "muted small-text", text: "Advance to Next Week plays the rest of the week." }));
      injuryReport();
      return;
    }
    // the prediction: the likely score, the odds, who to watch
    // whole points, unless rounding would call it a tie
    const tie = Math.round(p.points_for) === Math.round(p.points_against);
    const pf = tie ? p.points_for.toFixed(1) : Math.round(p.points_for), pa = tie ? p.points_against.toFixed(1) : Math.round(p.points_against);
    const fav = p.win_prob >= 0.5;
    const line = fav ? `${data.team_name} by ${Math.abs(p.margin).toFixed(1)}` : `${g.opponent_name} by ${Math.abs(p.margin).toFixed(1)}`;
    card.append(el("div", { class: "review-tiles" }, [
      el("div", { class: "review-tile" }, [el("div", { class: "review-leader-big", text: `${pf}–${pa}` }), el("div", { class: "review-label", text: "Predicted score" })]),
      el("div", { class: "review-tile" }, [el("div", { class: `review-leader-big ${fav ? "win" : "loss"}`, text: `${Math.round(p.win_prob * 100)}%` }), el("div", { class: "review-label", text: "Win odds" })]),
      el("div", { class: "review-tile" }, [el("div", { class: "review-leader-big", text: line }), el("div", { class: "review-label", text: "Line" })]),
      el("div", { class: "review-tile" }, [el("div", { class: "review-leader-big", text: p.total.toFixed(1) }), el("div", { class: "review-label", text: "Total" })]),
    ]));
    const w = p.watch || {};
    const watchBits = [
      w.passer ? `${w.passer.name}: ${Math.round(w.passer.completions)}/${Math.round(w.passer.pass_attempts)}, ${Math.round(w.passer.pass_yards)} yds, ${w.passer.passing_touchdowns.toFixed(1)} TD` : null,
      w.rusher ? `${w.rusher.name}: ${Math.round(w.rusher.carries)} car, ${Math.round(w.rusher.rush_yards)} yds` : null,
      w.receiver ? `${w.receiver.name}: ${Math.round(w.receiver.receptions)} rec, ${Math.round(w.receiver.receiving_yards)} yds` : null,
    ].filter(Boolean);
    card.append(el("div", { class: "muted small-text", text: `From ${p.sims} simulations of the matchup with the current depth charts and injuries.${watchBits.length ? " Projected: " + watchBits.join(" · ") : ""}` }));
    injuryReport();
  }

  // a small "you" tag after your team's name wherever teams are listed
  const youTag = (slug) => (state.season && slug === state.season.team ? el("span", { class: "you-tag", text: "you", title: "Your team" }) : null);

  const scheduleState = { team: null, conf: "", data: null, key: null };

  async function openGamesModal() {
    const s = state.season;
    const node = el("div", { class: "games-modal" });
    const label = state.viewWeek === 0 ? "Preseason" : (s.week_labels[state.viewWeek] || `Week ${state.viewWeek}`);
    const nav = el("div", { class: "stats-controls" });
    const weeks = [0, ...s.weeks].filter((w) => w <= Math.min(s.done ? s.current_week : s.current_week + 1, 20));
    nav.append(chipRow(weeks.map((w) => [w, w === 0 ? "Pre" : w <= 14 ? `W${w}` : (s.week_labels[w] || `W${w}`).replace("Championship week", "CCG").replace("National championship", "Title").replace("Quarterfinals", "QF").replace("Semifinals", "SF").replace("First round", "R1").replace("Selection", "Sel")]),
      state.viewWeek, (w) => { state.viewWeek = w; renderWeekStrip(); renderGames(body); $("#modal-title").textContent = `All games · ${w === 0 ? "Preseason" : (s.week_labels[w] || `Week ${w}`)}`; }));
    const body = el("div");
    node.append(nav, body);
    openModal(`All games · ${label}`, node);
    await renderGames(body);
  }

  async function renderSchedule() {
    const s = state.season;
    const box = $("#tab-schedule");
    box.innerHTML = "";
    const st = scheduleState;
    if (st.team === null || !window.CFP.teamsBySlug[st.team]) st.team = s.team || topTeam(s);
    // pick any team: conference chips narrow the team list; a button opens every game of the week
    const controls = el("div", { class: "stats-controls" });
    const confs = [...new Set(state.teams.filter((t) => !t.fictional).map((t) => t.conference))].sort();
    controls.append(confChips(confs, st.conf, (v) => { st.conf = v; renderSchedule(); }));
    const row = el("div", { class: "schedule-pick" });
    const sel = el("select", { "aria-label": "Team" }, state.teams.filter((t) => !t.fictional && (!st.conf || t.conference === st.conf)).map((t) => el("option", { value: t.slug, text: t.slug === s.team ? `${t.name} (your team)` : t.name })));
    if (![...sel.options].some((o) => o.value === st.team)) st.team = sel.options.length ? sel.options[0].value : s.team;
    sel.value = st.team;
    sel.addEventListener("change", () => { st.team = sel.value; renderSchedule(); });
    const mineBtn = el("button", { type: "button", class: "ghost small", text: "My team" });
    mineBtn.addEventListener("click", () => { st.team = s.team; st.conf = ""; renderSchedule(); });
    const allBtn = el("button", { type: "button", class: "ghost small", text: "View all games" });
    allBtn.addEventListener("click", openGamesModal);
    row.append(sel);
    if (s.team && st.team !== s.team) row.append(mineBtn);
    if (s.mode !== "real") row.append(allBtn);       // the real page has its own Games tab
    controls.append(row);
    box.append(controls);
    const key = `${s.id}|${s.current_week}|${(s.schedule || []).filter((g) => g.played).length}|${st.team}`;
    if (!st.data || st.key !== key) {
      try { st.data = await api(`/api/season/${s.id}/schedule/${st.team}`); st.key = key; } catch (err) { box.append(el("p", { class: "muted", text: err.message })); return; }
    }
    const d = st.data;
    const mine = !!s.team && st.team === s.team;
    box.append(el("h3", {}, [teamPill(d.team), d.team_name, el("span", { class: "pos", text: `${d.rank ? `#${d.rank} · ` : ""}${d.record.wins}-${d.record.losses} · ${d.record.conf_wins}-${d.record.conf_losses} ${d.conference}` })]));
    if (mine && !s.done) renderThisWeek(box, d);
    const table = el("table", { class: "stats schedule-table" });
    table.appendChild(el("tr", {}, ["Week", "Date", "Rank", "Opponent", "Where", "Result", "Score", ""].map((h) => el("th", { class: `${["Date", "Opponent"].includes(h) ? "left" : ""} ${["Rank", "Where", ""].includes(h) ? "ph" : ""}`, text: h }))));
    const wk = (w, g) => {
      if (w <= 14) return String(w);
      if (g && g.kind === "bowl") return "Bowl";
      return (s.week_labels[w] || `W${w}`).replace("Championship week", "CCG").replace("Selection", "Sel").replace(" & bowls", "").replace(" & New Year bowls", "");
    };
    // game dates are ISO for the regular season and bowl-style text ("Dec 30", "January 1") after it
    const gameDate = (g) => (g.date && /^\d{4}-\d{2}-\d{2}/.test(g.date) ? shortDay(g.date.slice(0, 10)) : (g.date || ""));
    for (const g of d.schedule) {
      const upNext = !s.done && g.week === s.current_week + 1;
      if (g.kind === "bye") {
        const wd = s.week_dates && s.week_dates[g.week];
        table.appendChild(el("tr", { class: `bye ${upNext ? "upnext" : ""}` }, [
          el("td", {}, [wk(g.week), upNext ? el("span", { class: "upnext-tag", text: "this week" }) : null]), el("td", { class: "left muted small-text nowrap", text: wd && wd.main ? shortDay(wd.main) : "" }),
          el("td", { class: "muted ph", text: g.my_rank ? `#${g.my_rank}` : "" }),
          el("td", { class: "left muted", text: "Bye" }), el("td", { class: "ph" }), el("td", { class: "muted", text: "–" }), el("td", {}), el("td", { class: "ph" }),
        ]));
        continue;
      }
      const prefix = g.venue === "away" ? "at" : "vs";
      const when = g.date ? gameDate(g) : ((s.week_dates || {})[g.week] || {}).main ? shortDay(s.week_dates[g.week].main) : "";
      const tr = el("tr", { class: `${g.has_box ? "clickable" : ""} ${g.played ? (g.won ? "won" : "lost") : ""} ${upNext ? "upnext" : ""}` }, [
        el("td", {}, [wk(g.week, g), upNext ? el("span", { class: "upnext-tag", text: "this week" }) : null]),
        el("td", { class: "left muted small-text nowrap", text: when }),
        el("td", { class: "muted ph", text: g.my_rank ? `#${g.my_rank}` : "", title: "Rank entering the game" }),
        el("td", { class: "left name" }, [el("span", { class: "nowrap" }, [el("span", { class: "muted", text: `${prefix} ` }), teamPill(g.opponent)]), g.opponent_rank ? el("span", { class: "rank", text: `#${g.opponent_rank} ` }) : null, g.opponent_name,
          g.opponent_record && !((window.CFP.teamsBySlug[g.opponent] || {}).fictional) ? el("span", { class: "pos", text: g.opponent_record }) : null,
          g.title ? el("div", { class: "muted small-text", text: `${g.title}${g.site ? " · " + g.site : ""}` }) : (g.site ? el("div", { class: "muted small-text", text: g.site }) : null),
          g.rivalry ? el("div", { class: "rivalry-line small-text", title: g.rivalry.name }, [el("span", { class: "trophy", text: g.rivalry.trophy ? `🏆 ${g.rivalry.trophy}` : `🔥 ${g.rivalry.name}` }), el("span", { class: "muted", text: ` · ${g.rivalry.series}` })]) : null]),
        el("td", { class: "ph", text: g.venue === "home" ? "Home" : g.venue === "away" ? "Away" : "Neutral" }),
        el("td", { class: g.played ? (g.won ? "win" : "loss") : "muted", text: g.played ? (g.won ? "W" : "L") : "—" }),
        el("td", { class: "score", text: g.played ? `${g.points_for}–${g.points_against}${g.overtime ? " OT" : ""}` : "" }),
        el("td", { class: "muted small-text ph", text: g.has_box ? "box score" : g.real ? "real result" : "" }),
      ]);
      if (g.has_box) tr.addEventListener("click", () => openBox(g.event_id));
      table.appendChild(tr);
    }
    box.append(el("div", { class: "table-scroll" }, [table]));
    if (mine && s.current_week > 0) renderInjuries(box);
  }

  // ----- season stats ------------------------------------------------------

  const TEAM_COLS = [
    ["G", "games", 0], ["W-L", null, null], ["PPG", "ppg", 1], ["Opp PPG", "opp_ppg", 1], ["Margin", "margin", 1],
    ["Yds/G", "ypg", 1], ["Pass/G", "pass_ypg", 1], ["Rush/G", "rush_ypg", 1], ["Yds/Play", "ypp", 2], ["Plays/G", "plays_pg", 1],
    ["Cmp%", "comp_pct", 1], ["Y/A", "ypa", 1], ["Y/C", "ypc", 1], ["3rd%", "third_pct", 1], ["RZ%", "red_zone_pct", 1], ["1st/G", "first_downs_pg", 1],
    ["TOP", "top", "time"], ["TO", "turnovers", 0], ["Sacks all.", "sacks_allowed", 0], ["Pen/G", "penalties_pg", 1],
    ["Opp Yds/G", "opp_ypg", 1], ["Opp Pass/G", "opp_pass_ypg", 1], ["Opp Rush/G", "opp_rush_ypg", 1], ["Opp Y/Play", "opp_ypp", 2],
    ["Opp 3rd%", "opp_third_pct", 1], ["Sacks", "sacks", 0], ["TFL", "tfl", 0], ["Hurries", "hurries", 0], ["PBU", "pbu", 0], ["Takeaways", "takeaways", 0],
    ["20+ plays", "explosives", 0], ["Press. all.", "pressures_allowed", 0],
  ];
  const LOWER_BETTER = new Set(["opp_ppg", "turnovers", "sacks_allowed", "penalties_pg", "opp_ypg", "opp_pass_ypg", "opp_rush_ypg", "opp_ypp", "opp_third_pct", "pressures_allowed"]);
  const teamStatsState = { rows: null, sort: "margin", desc: true, conf: "", fbs: true };

  function fmtStat(v, digits) {
    if (digits === "time") return window.CFP.fmtTime(Math.round(v));
    return Number(v).toFixed(digits);
  }

  function statsNote(partial) {
    return partial ? "This season was started before season-long stats were kept, so only your own games are counted. " : "";
  }

  // Conference picker as a row of chips (short names), shared by the stats tabs.
  const CONF_SHORT = { "American Athletic Conference": "American", "Conference USA": "CUSA", "Mountain West": "MW",
                       "FBS Independent": "Ind.", "FBS Independents": "Ind.", "Independent": "Ind." };
  function confChips(confs, current, onPick) {
    const row = el("div", { class: "view-chips conf-chips", role: "group", "aria-label": "Conference" });
    for (const [value, label] of [["", "All"], ...confs.map((c) => [c, CONF_SHORT[c] || c])]) {
      const b = el("button", { type: "button", class: `chip ${current === value ? "active" : ""}`, text: label, title: value || "All conferences" });
      b.addEventListener("click", () => { markChip(row, b); onPick(value); });
      row.append(b);
    }
    return row;
  }

  async function renderSeasonTeamStats() {
    const s = state.season;
    const box = $("#tab-teamstats");
    box.innerHTML = "";
    if (!teamStatsState.rows || teamStatsState.seasonId !== s.id || teamStatsState.week !== s.current_week) {
      try {
        const j = await api(`/api/season/${s.id}/stats/teams`);
        teamStatsState.rows = j.teams; teamStatsState.partial = j.partial; teamStatsState.seasonId = s.id; teamStatsState.week = s.current_week;
      } catch (err) { box.append(el("p", { class: "muted", text: err.message })); return; }
    }
    const rows = teamStatsState.rows;
    if (!rows.length) { box.append(el("p", { class: "muted", text: "No games simulated yet. Advance a week to start collecting stats." })); return; }
    const confs = [...new Set(rows.filter((r) => !r.fictional).map((r) => r.conference))].sort();
    const controls = el("div", { class: "stats-controls" });
    controls.append(confChips(confs, teamStatsState.conf, (v) => { teamStatsState.conf = v; renderSeasonTeamStats(); }));
    box.append(controls);
    box.append(el("p", { class: "muted small-text", text: `${statsNote(teamStatsState.partial)}Per-game averages over simulated games through ${s.week_labels[s.current_week] || "week " + s.current_week}. Click a column to sort.` }));

    let list = rows.filter((r) => !r.fictional && (!teamStatsState.conf || r.conference === teamStatsState.conf));
    const k = teamStatsState.sort;
    list.sort((a, b) => {
      const av = k === "name" ? a.name : a[k], bv = k === "name" ? b.name : b[k];
      const c = typeof av === "string" ? av.localeCompare(bv) : av - bv;
      return teamStatsState.desc ? -c : c;
    });
    const table = el("table", { class: "stats team-season" });
    const head = el("tr", {}, [el("th", { text: "#" }), el("th", { class: "sortable left", text: "Team", "data-key": "name" }),
      ...TEAM_COLS.map((c) => el("th", { class: c[1] ? "sortable" : "", text: c[0], "data-key": c[1] || "", title: c[0] }))]);
    head.addEventListener("click", (e) => {
      const th = e.target.closest("th[data-key]");
      if (!th || !th.dataset.key) return;
      if (teamStatsState.sort === th.dataset.key) teamStatsState.desc = !teamStatsState.desc;
      else { teamStatsState.sort = th.dataset.key; teamStatsState.desc = th.dataset.key !== "name" && !LOWER_BETTER.has(th.dataset.key); }
      renderSeasonTeamStats();
    });
    for (const th of head.querySelectorAll("th[data-key]")) if (th.dataset.key === k) th.classList.add(teamStatsState.desc ? "sorted-desc" : "sorted-asc");
    table.append(head);
    list.forEach((r, i) => {
      table.append(el("tr", { class: r.team === s.team ? "mine" : "" }, [
        el("td", { class: "muted", text: String(i + 1) }),
        el("td", { class: "name" }, [teamPill(r.team), r.name, el("span", { class: "pos", text: r.conference })]),
        ...TEAM_COLS.map((c) => el("td", { text: c[1] === null ? `${r.wins}-${r.losses}` : fmtStat(r[c[1]], c[2]) })),
      ]));
    });
    box.append(el("div", { class: "table-scroll" }, [table]));
  }

  // Column = [header, value(p), sort key or null, title]. Sortable columns carry a key.
  const PLAYER_COLS = {
    passing: [["C/ATT", (p) => `${p.stats.completions}/${p.stats.pass_attempts}`], ["Pct", (p) => p.stats.pass_attempts ? Math.round(100 * p.stats.completions / p.stats.pass_attempts) : "–", "pct"],
      ["Yds", (p) => p.stats.pass_yards, "pass_yards"], ["Yds/G", (p) => (p.stats.pass_yards / p.games).toFixed(1), "ypg"], ["Y/A", (p) => p.stats.pass_attempts ? (p.stats.pass_yards / p.stats.pass_attempts).toFixed(1) : "–", "ypa"],
      ["TD", (p) => p.stats.passing_touchdowns, "passing_touchdowns"], ["INT", (p) => p.stats.interceptions_thrown, "interceptions_thrown"],
      ["Rtg", (p) => p.stats.pass_attempts ? ((8.4 * p.stats.pass_yards + 330 * p.stats.passing_touchdowns + 100 * p.stats.completions - 200 * p.stats.interceptions_thrown) / p.stats.pass_attempts).toFixed(1) : "–", "rating", "NCAA passer rating"],
      ["Sacked", (p) => p.stats.sacks_taken, "sacks_taken"], ["1st D", (p) => p.stats.passing_first_downs || 0, "passing_first_downs", "First downs by pass"],
      ["3rd conv", (p) => p.stats.passing_conversions || 0, "passing_conversions", "Third-down conversions by pass"], ["Long", (p) => p.stats.long_pass || 0, "long_pass"]],
    rushing: [["Car", (p) => p.stats.carries, "carries"], ["Yds", (p) => p.stats.rush_yards, "rush_yards"], ["Yds/G", (p) => (p.stats.rush_yards / p.games).toFixed(1), "ypg"],
      ["Avg", (p) => p.stats.carries ? (p.stats.rush_yards / p.stats.carries).toFixed(1) : "–", "avg"], ["TD", (p) => p.stats.rushing_touchdowns, "rushing_touchdowns"],
      ["20+", (p) => p.stats.explosive_runs || 0, "explosive_runs", "Runs of 20 yards or more"], ["1st D", (p) => p.stats.rushing_first_downs || 0, "rushing_first_downs"],
      ["3rd conv", (p) => p.stats.rushing_conversions || 0, "rushing_conversions", "Third-down conversions by run"], ["Long", (p) => p.stats.long_rush || 0, "long_rush"], ["Fum", (p) => p.stats.fumbles, "fumbles"]],
    receiving: [["Tgt", (p) => p.stats.targets, "targets"], ["Rec", (p) => p.stats.receptions, "receptions"], ["Yds", (p) => p.stats.receiving_yards, "receiving_yards"], ["Yds/G", (p) => (p.stats.receiving_yards / p.games).toFixed(1), "ypg"],
      ["Avg", (p) => p.stats.receptions ? (p.stats.receiving_yards / p.stats.receptions).toFixed(1) : "–", "avg"], ["TD", (p) => p.stats.receiving_touchdowns, "receiving_touchdowns"],
      ["25+", (p) => p.stats.explosive_catches || 0, "explosive_catches", "Catches of 25 yards or more"], ["1st D", (p) => p.stats.receiving_first_downs || 0, "receiving_first_downs"], ["Long", (p) => p.stats.long_reception || 0, "long_reception"]],
    defense: [["Solo", (p) => p.stats.solo_tackles, "solo_tackles"], ["Ast", (p) => p.stats.assisted_tackles, "assisted_tackles"], ["Tot", (p) => p.stats.solo_tackles + p.stats.assisted_tackles, "total"],
      ["TFL", (p) => p.stats.tackles_for_loss || 0, "tackles_for_loss", "Tackles for loss, sacks included"], ["Sacks", (p) => p.stats.sacks, "sacks"], ["Hur", (p) => p.stats.hurries || 0, "hurries", "Quarterback hurries"],
      ["INT", (p) => p.stats.interceptions, "interceptions"], ["INT Yds", (p) => p.stats.interception_return_yards, "interception_return_yards"], ["PBU", (p) => p.stats.passes_defended || 0, "passes_defended", "Passes defended, interceptions included"],
      ["FF", (p) => p.stats.forced_fumbles, "forced_fumbles"], ["FR", (p) => p.stats.fumble_recoveries, "fumble_recoveries"], ["TD", (p) => p.stats.defensive_touchdowns, "defensive_touchdowns"]],
    kicking: [["FG", (p) => `${p.stats.fg_made}/${p.stats.fg_attempted}`, "fg_made"], ["FG%", (p) => p.stats.fg_attempted ? Math.round(100 * p.stats.fg_made / p.stats.fg_attempted) : "–", "fg_pct"],
      ["40-49", (p) => `${p.stats.fg_40_made || 0}/${p.stats.fg_40_att || 0}`, "fg_40_made"], ["50+", (p) => `${p.stats.fg_50_made || 0}/${p.stats.fg_50_att || 0}`, "fg_50_made"], ["Long", (p) => p.stats.long_fg || 0, "long_fg"],
      ["PAT", (p) => `${p.stats.pat_made}/${p.stats.pat_attempts}`, "pat_made"], ["Pts", (p) => p.stats.fg_made * 3 + p.stats.pat_made, "points"]],
    punting: [["Punts", (p) => p.stats.punts, "punts"], ["Yds", (p) => p.stats.punt_yards, "punt_yards"], ["Avg", (p) => p.stats.punts ? (p.stats.punt_yards / p.stats.punts).toFixed(1) : "–", "avg"],
      ["Net", (p) => p.stats.punts ? ((p.stats.punt_net_yards || 0) / p.stats.punts).toFixed(1) : "–", "net", "Net average after returns"], ["In 20", (p) => p.stats.punts_inside_20 || 0, "punts_inside_20"],
      ["TB", (p) => p.stats.punt_touchbacks || 0, "punt_touchbacks"], ["Long", (p) => p.stats.long_punt || 0, "long_punt"]],
    returns: [["KR", (p) => p.stats.kickoff_returns, "kickoff_returns"], ["KR Yds", (p) => p.stats.kickoff_return_yards, "kickoff_return_yards"], ["KR Avg", (p) => p.stats.kickoff_returns ? (p.stats.kickoff_return_yards / p.stats.kickoff_returns).toFixed(1) : "–", "kr_avg"],
      ["KR Long", (p) => p.stats.long_kickoff_return || 0, "long_kickoff_return"], ["PR", (p) => p.stats.punt_returns, "punt_returns"], ["PR Yds", (p) => p.stats.punt_return_yards, "punt_return_yards"],
      ["PR Avg", (p) => p.stats.punt_returns ? (p.stats.punt_return_yards / p.stats.punt_returns).toFixed(1) : "–", "pr_avg"], ["PR Long", (p) => p.stats.long_punt_return || 0, "long_punt_return"],
      ["TD", (p) => p.stats.kickoff_return_touchdowns + p.stats.punt_return_touchdowns, "td"]],
    blocking: [["Snaps", (p) => p.stats.snaps || 0, "snaps"], ["GS", (p) => p.stats.games_started || 0, "games_started", "Games started"],
      ["Sacks all.", (p) => p.stats.sacks_allowed || 0, "sacks_allowed", "Sacks allowed"], ["Press.", (p) => p.stats.pressures_allowed || 0, "pressures_allowed", "Pressures allowed"],
      ["Stuffs", (p) => p.stats.stuffs_allowed || 0, "stuffs_allowed", "Runs stopped for no gain on this blocker"], ["Key blk", (p) => p.stats.key_blocks || 0, "key_blocks", "Blocks that sprang a 20-yard run"],
      ["Per 100", (p) => p.stats.snaps ? (100 * ((p.stats.sacks_allowed || 0) + 0.5 * (p.stats.pressures_allowed || 0) + (p.stats.stuffs_allowed || 0)) / p.stats.snaps).toFixed(1) : "–", "per100", "Sacks, half-pressures and stuffs allowed per 100 snaps (lower is better)"]],
  };
  const LOWER_BETTER_PLAYER = new Set(["interceptions_thrown", "sacks_taken", "fumbles", "sacks_allowed", "pressures_allowed", "stuffs_allowed", "per100", "punt_touchbacks"]);
  const playerStatsState = { team: null, conf: "", view: "leaders", sort: null, data: null, leaders: null, roster: null };
  const LEADER_CARDS = [
    ["passing", "Passing yards", (p) => `${p.stats.pass_yards.toLocaleString()} yds`, (p) => `${p.stats.completions}/${p.stats.pass_attempts} · ${p.stats.passing_touchdowns} TD · ${p.stats.interceptions_thrown} INT`],
    ["rushing", "Rushing yards", (p) => `${p.stats.rush_yards.toLocaleString()} yds`, (p) => `${p.stats.carries} car · ${p.stats.carries ? (p.stats.rush_yards / p.stats.carries).toFixed(1) : "–"} avg · ${p.stats.rushing_touchdowns} TD`],
    ["receiving", "Receiving yards", (p) => `${p.stats.receiving_yards.toLocaleString()} yds`, (p) => `${p.stats.receptions} rec · ${p.stats.receptions ? (p.stats.receiving_yards / p.stats.receptions).toFixed(1) : "–"} avg · ${p.stats.receiving_touchdowns} TD`],
    ["tackles", "Tackles", (p) => `${p.stats.solo_tackles + p.stats.assisted_tackles}`, (p) => `${p.stats.solo_tackles} solo · ${p.stats.assisted_tackles} ast · ${p.stats.sacks} sacks`],
    ["sacks", "Sacks", (p) => `${p.stats.sacks}`, (p) => `${p.stats.solo_tackles + p.stats.assisted_tackles} tkl · ${p.stats.forced_fumbles} FF`],
    ["interceptions", "Interceptions", (p) => `${p.stats.interceptions}`, (p) => `${p.stats.interception_return_yards} ret yds · ${p.stats.defensive_touchdowns} TD`],
    ["touchdowns", "Touchdowns", (p) => `${p.stats.rushing_touchdowns + p.stats.receiving_touchdowns}`, (p) => `${p.stats.rushing_touchdowns} rush · ${p.stats.receiving_touchdowns} rec`],
    ["kicking", "Kicking points", (p) => `${p.stats.fg_made * 3 + p.stats.pat_made} pts`, (p) => `FG ${p.stats.fg_made}/${p.stats.fg_attempted} · PAT ${p.stats.pat_made}/${p.stats.pat_attempts}`],
    ["tfl", "Tackles for loss", (p) => `${p.stats.tackles_for_loss || 0}`, (p) => `${p.stats.sacks} sacks · ${p.stats.hurries || 0} hurries`],
    ["pbu", "Passes defended", (p) => `${p.stats.passes_defended || 0}`, (p) => `${p.stats.interceptions} INT · ${p.stats.solo_tackles + p.stats.assisted_tackles} tkl`],
    ["explosives", "Explosive plays", (p) => `${(p.stats.explosive_runs || 0) + (p.stats.explosive_catches || 0)}`, (p) => `${p.stats.explosive_runs || 0} runs of 20+ · ${p.stats.explosive_catches || 0} catches of 25+`],
    ["punting", "Net punting", (p) => `${p.value.toFixed(1)} net`, (p) => `${p.stats.punts} punts · ${p.stats.punts ? (p.stats.punt_yards / p.stats.punts).toFixed(1) : "–"} gross · ${p.stats.punts_inside_20 || 0} inside 20`],
  ];
  const LEADER_TO_TABLE = { tackles: "defense", sacks: "defense", interceptions: "defense", touchdowns: "rushing", tfl: "defense", pbu: "defense", explosives: "rushing" };
  const ROSTER_ORDER = ["QB", "RB", "WR", "TE", "OL", "DL", "LOLB", "MLB", "ROLB", "CB", "S", "K", "P"];
  const ROSTER_LABELS = { LOLB: "OLB", ROLB: "OLB", MLB: "MLB" };

  // The Player Stats tab: a leaders board for the picked team (or the whole league) that
  // is there as soon as a game has been played, the full category tables behind it, and
  // the roster with ratings before any game has been played.
  async function renderSeasonPlayerStats() {
    const s = state.season;
    if (!s) return;
    const box = $("#tab-playerstats");
    box.innerHTML = "";
    const ps = playerStatsState;
    if (ps.team === null) ps.team = s.team || "";
    const played = s.current_week > 0;

    const controls = el("div", { class: "stats-controls" });
    // conference picker narrows the team picker and the league views to that conference
    const confs = [...new Set(state.teams.filter((t) => !t.fictional).map((t) => t.conference))].sort();
    const confRow = confChips(confs, ps.conf, (v) => {
      // picking a conference (or All) shows everyone in it, not a single team
      ps.conf = v;
      ps.team = "";
      if (ps.view === "roster") ps.view = "leaders";
      ps.data = ps.leaders = ps.roster = null; ps.sort = null;
      renderSeasonPlayerStats();
    });
    const teamSel = el("select", { "aria-label": "Team" }, [el("option", { value: "", text: ps.conf ? `All ${ps.conf} teams` : "All teams (league leaders)" }),
      ...state.teams.filter((t) => !t.fictional && (!ps.conf || t.conference === ps.conf)).map((t) => el("option", { value: t.slug, text: t.name }))]);
    teamSel.value = ps.team;
    teamSel.addEventListener("change", () => { ps.team = teamSel.value; ps.data = ps.leaders = ps.roster = null; ps.sort = null; if (ps.view === "roster" && !ps.team) ps.view = "leaders"; renderSeasonPlayerStats(); });
    controls.append(confRow, teamSel);
    const views = [["leaders", "Leaders"], ...Object.keys(PLAYER_COLS).map((c) => [c, c[0].toUpperCase() + c.slice(1)]), ["roster", "Roster"]];
    const chips = el("div", { class: "view-chips" }, views.filter(([v]) => v !== "roster" || ps.team).map(([v, label]) => {
      const b = el("button", { type: "button", class: `chip ${ps.view === v ? "active" : ""}`, text: label });
      b.addEventListener("click", () => { ps.view = v; ps.sort = null; renderSeasonPlayerStats(); });
      return b;
    }));
    controls.append(chips);
    box.append(controls);

    const info = ps.team ? window.CFP.teamsBySlug[ps.team] : null;
    const through = s.week_labels[s.current_week] || `week ${s.current_week}`;
    if (!played && ps.view !== "roster") {
      if (!ps.team) { box.append(el("p", { class: "muted", text: "No games played yet. Pick a team to see its roster, or advance a week." })); return; }
      box.append(el("p", { class: "muted small-text", text: `No games played yet, so here is the ${info ? info.name : ""} roster. Stats appear after the first week.` }));
      return renderRoster(box, ps.team);
    }
    if (ps.view === "roster") return renderRoster(box, ps.team);
    if (ps.view === "leaders") return renderLeaders(box, ps, through);
    return renderCategoryTable(box, ps, through);
  }

  async function renderLeaders(box, ps, through) {
    const s = state.season;
    const key = `${s.id}|${s.current_week}|${ps.team}|${ps.conf}`;
    if (!ps.leaders || ps.leaders.key !== key) {
      try {
        const j = await api(`/api/season/${s.id}/stats/leaders?n=5${ps.team ? `&team=${ps.team}` : ""}${!ps.team && ps.conf ? `&conference=${encodeURIComponent(ps.conf)}` : ""}`);
        ps.leaders = { key, ...j };
      } catch (err) { box.append(el("p", { class: "muted", text: err.message })); return; }
    }
    const L = ps.leaders.leaders;
    if (!Object.values(L).some((rows) => rows.length)) { box.append(el("p", { class: "muted", text: "No stats yet." })); return; }
    box.append(el("p", { class: "muted small-text", text: `${statsNote(ps.leaders.partial)}${ps.team ? "Team" : ps.conf ? ps.conf : "National"} leaders through ${through}. Click a card for the full table.` }));
    const grid = el("div", { class: "leaders-grid" });
    for (const [cat, title, value, line] of LEADER_CARDS) {
      const rows = L[cat] || [];
      if (!rows.length) continue;
      const card = el("div", { class: "leader-card panel-2" });
      const head = el("div", { class: "leader-head" }, [el("h4", { text: title }), el("span", { class: "muted small-text", text: "full table ›" })]);
      head.addEventListener("click", () => { ps.view = LEADER_TO_TABLE[cat] || cat; ps.sort = null; renderSeasonPlayerStats(); });
      card.append(head);
      rows.forEach((p, i) => {
        card.append(el("div", { class: `leader-row ${i === 0 ? "top" : ""}` }, [
          el("span", { class: "rank", text: String(i + 1) }),
          el("span", { class: "who" }, [
            el("span", { class: "name" }, [el("span", { text: p.name, ...playerAttrs(p.team || ps.team, p.name, p.position) }), el("span", { class: "pos", text: p.position })]),
            el("span", { class: "muted small-text", text: `${ps.team ? "" : p.team_name + " · "}${line(p)}` }),
          ]),
          el("span", { class: "value", text: value(p) }),
        ]));
      });
      grid.append(card);
    }
    box.append(grid);
  }

  async function renderCategoryTable(box, ps, through) {
    const s = state.season;
    const key = `${s.id}|${s.current_week}|${ps.team}|${ps.conf}|${ps.view}`;
    if (!ps.data || ps.data.key !== key) {
      try {
        const j = await api(`/api/season/${s.id}/stats/players?cat=${ps.view}${ps.team ? `&team=${ps.team}` : ""}${!ps.team && ps.conf ? `&conference=${encodeURIComponent(ps.conf)}` : ""}`);
        ps.data = { key, players: j.players, partial: j.partial };
      } catch (err) { box.append(el("p", { class: "muted", text: err.message })); return; }
    }
    const cols = PLAYER_COLS[ps.view];
    const players = ps.data.players.slice();
    if (!players.length) { box.append(el("p", { class: "muted", text: "No stats in this category yet." })); return; }
    box.append(el("p", { class: "muted small-text", text: `${statsNote(ps.data.partial)}${!ps.team && ps.conf ? ps.conf + " · " : ""}Season totals through ${through}${ps.team ? "" : " · top 100"}. Click a column to sort.` }));
    const sortKey = ps.sort || cols.find((c) => c[2])[2];
    const val = (p, c) => { const v = c[1](p); return typeof v === "number" ? v : parseFloat(v) || 0; };
    const sortCol = cols.find((c) => c[2] === sortKey) || cols.find((c) => c[2]);
    const asc = LOWER_BETTER_PLAYER.has(sortKey);
    players.sort((a, b) => (asc ? val(a, sortCol) - val(b, sortCol) : val(b, sortCol) - val(a, sortCol)) || a.name.localeCompare(b.name));
    const table = el("table", { class: "stats player-season" });
    const head = el("tr", {}, [el("th", { text: "#" }), el("th", { class: "left", text: "Player" }), ps.team ? null : el("th", { class: "left ph", text: "Team" }), el("th", { text: "G" }),
      ...cols.map((c) => el("th", { class: c[2] ? `sortable ${c[2] === sortKey ? (asc ? "sorted-asc" : "sorted-desc") : ""}` : "", text: c[0], "data-key": c[2] || "", title: c[3] || c[0] }))]);
    head.addEventListener("click", (e) => { const th = e.target.closest("th[data-key]"); if (th && th.dataset.key) { ps.sort = th.dataset.key; renderSeasonPlayerStats(); } });
    table.append(head);
    players.forEach((p, i) => {
      table.append(el("tr", {}, [
        el("td", { class: "muted", text: String(i + 1) }),
        el("td", { class: "name" }, [el("span", { text: p.name, ...playerAttrs(p.team || ps.team, p.name, p.position) }), el("span", { class: "pos", text: p.position })]),
        ps.team ? null : el("td", { class: "left ph" }, [teamPill(p.team), p.team_name]),
        el("td", { text: String(p.games) }),
        ...cols.map((c) => el("td", { text: String(c[1](p)) })),
      ]));
    });
    box.append(el("div", { class: "table-scroll" }, [table]));
  }

  async function renderRoster(box, slug) {
    const ps = playerStatsState;
    if (!ps.roster || ps.roster.slug !== slug) {
      try { ps.roster = { slug, ...(await api(`/api/teams/${slug}`)) }; } catch (err) { box.append(el("p", { class: "muted", text: err.message })); return; }
    }
    const t = ps.roster;
    const r = t.ratings || {};
    box.append(el("div", { class: "roster-head" }, [
      teamPill(slug), el("b", { text: t.name }),
      el("span", { class: "muted", text: ` · ${t.conference} · ${t.head_coach} · overall ${Math.round(r.overall)} (off ${Math.round(r.offense)}, def ${Math.round(r.defense)}, ST ${Math.round(r.special_teams)})` }),
    ]));
    const groups = new Map();
    for (const p of t.players) {
      const label = ROSTER_LABELS[p.position] || p.position;
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(p);
    }
    const order = [...new Set(ROSTER_ORDER.map((p) => ROSTER_LABELS[p] || p))];
    const grid = el("div", { class: "roster-grid" });
    for (const label of order) {
      const players = (groups.get(label) || []).slice().sort((a, b) => b.starter - a.starter || b.overall - a.overall);
      if (!players.length) continue;
      const card = el("div", { class: "leader-card panel-2" });
      card.append(el("div", { class: "leader-head" }, [el("h4", { text: label }), el("span", { class: "muted small-text", text: `${players.length} players` })]));
      players.forEach((p, i) => {
        card.append(el("div", { class: `leader-row ${p.starter ? "top" : ""}` }, [
          el("span", { class: "rank", text: p.starter ? "★" : String(i + 1) }),
          el("span", { class: "who" }, [
            el("span", { class: "name" }, [el("span", { text: p.name, ...playerAttrs(slug, p.name, p.position) }), p.class ? el("span", { class: "pos", text: p.class }) : null]),
            el("span", { class: "muted small-text", text: [p.starter ? (p.role && p.role !== p.position ? `starter · ${p.role}` : "starter") : (p.role && p.role !== p.position ? p.role : ""), p.height && p.weight ? `${p.height} ${p.weight}` : ""].filter(Boolean).join(" · ") }),
          ]),
          el("span", { class: "value", text: String(p.overall) }),
        ]));
      });
      grid.append(card);
    }
    box.append(grid);
  }

  // Every player on the roster rated at one role, so anyone can be moved into that spot
  // (a safety to corner, a tight end to receiver, the fastest back to kick returner).
  async function renderDepthByPosition(box, ds, s) {
    const key = `${s.id}|${s.current_week}|${ds.team}|${ds.role}`;
    if (!ds.pos || ds.posKey !== key) {
      try { ds.pos = await api(`/api/season/${s.id}/depth/${ds.team}/position/${ds.role}`); ds.posKey = key; } catch (err) { box.append(el("p", { class: "muted", text: err.message })); return; }
    }
    const d = ds.pos;
    const change = async (body) => {
      try {
        await api(`/api/season/${s.id}/depth/${ds.team}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        ds.pos = null; ds.data = null; renderDepthChart();
      } catch (err) { toast(`Could not change the depth chart: ${err.message}`, 4000); }
    };
    const label = { QB: "quarterback", HB: "running back", FB: "fullback", WR: "receiver", TE: "tight end", LT: "left tackle", LG: "left guard", C: "center", RG: "right guard", RT: "right tackle", LEDG: "left edge", DT: "defensive tackle", REDG: "right edge", SAM: "strongside linebacker", MIKE: "middle linebacker", WILL: "weakside linebacker", CB: "cornerback", FS: "free safety", SS: "strong safety", K: "kicker", P: "punter", KR: "kick returner", PR: "punt returner" }[ds.role] || ds.role;
    box.append(el("p", { class: "muted small-text", text: `Every ${d.name || ""}player rated as a ${label}. Rating is what he would be at this spot; Natural is his rating at his own position. ★ makes him the starter here${["KR", "PR"].includes(ds.role) ? "" : ", + adds him to the rotation at the bottom"}. Changes save with this season.` }));
    const cols = [
      { key: "rank", label: "#", get: (p) => String(p.i + 1), sort: (p) => p.i },
      { key: "player", label: "Player", left: true, get: (p) => el("span", { class: "name" }, [p.jersey ? el("span", { class: "muted", text: `#${p.jersey} ` }) : null, p.name, el("span", { class: "pos", text: `${p.class || ""}` })]), sort: (p) => p.name },
      { key: "rating", label: "Rating here", get: (p) => el("b", { text: String(p.rating) }), sort: (p) => p.rating },
      { key: "natural", label: "Natural", get: (p) => `${p.natural} ${p.role || p.position}`, sort: (p) => p.natural },
      { key: "now", label: "Now", left: true, get: (p) => (p.in_role ? el("span", { class: p.spot === 1 ? "win" : "", text: p.spot === 1 ? "Starter here" : `${ORD(p.spot - 1)} here` }) : `${p.role || p.position}${p.depth ? " " + p.depth : ""}${p.starter ? " (starter)" : ""}`), sort: (p) => (p.in_role ? p.spot : 99) },
      { key: "size", label: "Size", get: (p) => (p.height && p.weight ? `${p.height} ${p.weight}` : ""), sort: (p) => p.weight || 0 },
      { key: "line", label: "Season", left: true, get: (p) => el("span", { class: "muted small-text", text: p.headline || (p.games ? `${p.games} games` : "") }) },
      { key: "act", label: "", get: (p) => (s.done ? "" : el("span", { class: "depth-ctl" }, [
          p.spot === 1 ? null : (() => { const b = el("button", { type: "button", class: "ghost tiny", text: "★", title: "Make starter here" }); b.addEventListener("click", () => change({ role: ds.role, player: p.slug, move: "top" })); return b; })(),
          p.in_role || ["KR", "PR"].includes(ds.role) ? null : (() => { const b = el("button", { type: "button", class: "ghost tiny", text: "+", title: "Add to this spot's rotation" }); b.addEventListener("click", () => change({ role: ds.role, player: p.slug, move: "add" })); return b; })(),
        ])) },
    ];
    if (!ds.posSort) { ds.posSort = { sort: "rating", desc: true }; }
    box.append(sortableTable(cols, d.players.map((p, i) => ({ ...p, i })), ds.posSort, () => renderDepthChart(), (p) => (p.in_role ? "mine" : "")));
  }

  const standingsState = { conf: null };

  // Standings: a chip row of conferences. One conference shows a full table (home and
  // away records, points, margin, streak, last game, poll rank); All shows the compact
  // grid of every conference.
  async function renderStandings() {
    const s = state.season;
    if (!s) return;
    const box = $("#tab-standings");
    box.innerHTML = "";
    if (!state.standings) {
      try { state.standings = (await api(`/api/season/${s.id}/standings`)).standings; } catch (err) { box.append(el("p", { class: "muted", text: err.message })); return; }
    }
    const st = standingsState;
    if (st.conf === null) st.conf = state.standings[s.conference] ? s.conference : "";
    const confs = Object.keys(state.standings).sort();
    box.append(el("div", { class: "stats-controls" }, [confChips(confs, st.conf, (v) => { st.conf = v; renderStandings(); })]));

    const crownOf = (t) => [
      t.champion ? el("span", { class: "crown", text: "👑", title: "Conference champion", "aria-label": "Conference champion" }) : null,
      t.runner_up ? el("span", { class: "crown", text: "🥈", title: "Lost the conference championship game", "aria-label": "Conference runner-up" }) : null,
    ];
    const rankBadge = (t) => (t.cfp_rank ? el("span", { class: "rank-badge cfp", text: `CFP ${t.cfp_rank}`, title: "CFP ranking" })
      : t.ap_rank ? el("span", { class: "rank-badge", text: `#${t.ap_rank}`, title: "AP rank" }) : null);
    const diff = (t) => { const d = t.points_for - t.points_against; return d > 0 ? `+${d}` : String(d); };

    const compactTable = (rows, division) => {
      const table = el("table", { class: "stats" });
      table.appendChild(el("tr", {}, ["#", division || "Team", "Conf", "Overall", "PF", "PA"].map((h) => el("th", { text: h, class: `${h === (division || "Team") ? "left" : ""} ${["PF", "PA"].includes(h) ? "ph" : ""}` }))));
      for (const t of rows) {
        table.appendChild(el("tr", { class: t.slug === s.team ? "mine" : "" }, [
          el("td", { text: String(t.conf_rank), title: t.tiebreak ? `Tied on conference record; placed by ${t.tiebreak}` : "" }),
          el("td", { class: "name left" }, [teamPill(t.slug), t.name, youTag(t.slug), ...crownOf(t), rankBadge(t)]),
          el("td", { text: `${t.conf_wins}-${t.conf_losses}` }), el("td", { text: `${t.wins}-${t.losses}` }),
          el("td", { class: "ph", text: String(t.points_for) }), el("td", { class: "ph", text: String(t.points_against) }),
        ]));
      }
      return table;
    };

    const fullTable = (rows, division) => {
      const table = el("table", { class: "stats standings-full" });
      const heads = ["#", division || "Team", "Conf", "Overall", "Home", "Away", "PF", "PA", "Diff", "Streak", "Last game"];
      const phone = new Set(["Home", "Away", "PF", "PA", "Diff", "Streak", "Last game"]);   // a phone shows #, team, conference and overall
      table.appendChild(el("tr", {}, heads.map((h) => el("th", { text: h, class: `${[division || "Team", "Last game"].includes(h) ? "left" : ""} ${phone.has(h) ? "ph" : ""}` }))));
      for (const t of rows) {
        const last = t.last ? `${t.last.won ? "W" : "L"} ${t.last.score} ${t.last.venue === "home" ? "vs" : t.last.venue === "away" ? "at" : "vs"} ${t.last.opponent_name}` : "–";
        table.appendChild(el("tr", { class: t.slug === s.team ? "mine" : "" }, [
          el("td", { text: String(t.conf_rank), title: t.tiebreak ? `Tied on conference record; placed by ${t.tiebreak}` : "" }),
          el("td", { class: "name left" }, [teamPill(t.slug), t.name, youTag(t.slug), ...crownOf(t), rankBadge(t)]),
          el("td", { text: `${t.conf_wins}-${t.conf_losses}` }), el("td", { text: `${t.wins}-${t.losses}` }),
          el("td", { class: "ph", text: `${t.home_wins}-${t.home_losses}` }), el("td", { class: "ph", text: `${t.away_wins}-${t.away_losses}` }),
          el("td", { class: "ph", text: String(t.points_for) }), el("td", { class: "ph", text: String(t.points_against) }),
          el("td", { class: `ph ${t.points_for > t.points_against ? "win" : t.points_for < t.points_against ? "loss" : ""}`, text: diff(t) }),
          el("td", { class: `ph ${t.streak > 0 ? "win" : t.streak < 0 ? "loss" : "muted"}`, text: t.streak > 0 ? `W${t.streak}` : t.streak < 0 ? `L${-t.streak}` : "–" }),
          el("td", { class: `left ph ${t.last ? (t.last.won ? "" : "muted") : "muted"}`, text: last }),
        ]));
      }
      return table;
    };

    const blockFor = (conf, full) => {
      const rows = state.standings[conf];
      const divisions = [...new Set(rows.map((t) => t.division).filter(Boolean))];
      const make = full ? fullTable : compactTable;
      const tables = divisions.length ? divisions.map((d) => make(rows.filter((t) => t.division === d), d)) : [make(rows, null)];
      return el("div", { class: "conf-block" }, [el("h3", { text: conf }), ...tables]);
    };

    if (st.conf && state.standings[st.conf]) {
      const rows = state.standings[st.conf];
      const champ = rows.find((t) => t.champion);
      box.append(el("p", { class: "muted small-text", text: `${st.conf} · ${rows.length} teams · ${champ ? `champion ${champ.name}` : s.current_week >= 14 ? "title game played" : "through " + (s.week_labels[s.current_week] || "week " + s.current_week)} · conference record decides the order, then the tiebreak ladder.` }));
      box.append(el("div", { class: "table-scroll" }, [blockFor(st.conf, true)]));
    } else {
      const ordered = confs.slice().sort((a, b) => (a === s.conference ? -1 : b === s.conference ? 1 : a.localeCompare(b)));
      const grid = el("div", { class: "conf-grid" });
      for (const conf of ordered) grid.appendChild(blockFor(conf, false));
      box.appendChild(grid);
    }
  }

  // One Rankings tab; pills switch between the AP poll, the Coaches Poll and the CFP rankings.
  function renderRankings() {
    for (const b of $("#poll-pills").querySelectorAll("button[data-poll]")) b.classList.toggle("active", b.dataset.poll === state.poll);
    renderPoll(state.poll);
  }

  function renderPoll(kind) {
    const s = state.season;
    const box = $("#poll-body");
    box.innerHTML = "";
    const w = pollWeekFor(state.viewWeek);
    if (kind === "resume") { renderResume(box, w); return; }
    const entry = s.polls[String(w)] || {};
    const list = entry[kind];
    const title = kind === "ap" ? "AP Top 25" : kind === "coaches" ? "Coaches Poll (AFCA / USA Today)" : "College Football Playoff rankings";
    if (!list) {
      const note = kind === "cfp"
        ? `The committee's first ranking comes out after week ${s.cfp_weeks[0]} (Nov 3, 2026), then weekly through selection day.`
        : "No poll for this week.";
      box.append(el("h3", { text: title }), el("p", { class: "muted", text: note }));
      return;
    }
    box.append(el("h3", { text: `${title} · ${w === 0 ? "preseason" : `after ${s.week_labels[w] || "week " + w}`}` }));
    if (kind === "cfp" && w >= 14) box.append(el("p", { class: "muted small-text", text: "Final ranking: this is the one the bracket is built from." }));
    const voted = (kind === "ap" || kind === "coaches") && list.some((e) => e.points != null);
    const table = el("table", { class: "stats" });
    const heads = voted ? ["#", "Team", "Record", "Pts", "Conference", "Prev", ""] : ["#", "Team", "Record", "Conference", "Prev", ""];
    table.appendChild(el("tr", {}, heads.map((h) => el("th", { text: h, class: ["Pts", "Conference", "Prev"].includes(h) ? "ph" : "", style: ["Team", "Conference"].includes(h) ? "text-align:left" : "", title: h === "Pts" ? "Poll points: 25 for a first-place vote down to 1 for 25th" : "" }))));
    for (const e of list) {
      const move = e.previous == null ? "new" : e.previous === e.rank ? "–" : e.previous > e.rank ? `▲${e.previous - e.rank}` : `▼${e.rank - e.previous}`;
      const nameCell = el("td", { style: "text-align:left", class: "name" }, [teamPill(e.team), e.name, youTag(e.team)]);
      if (voted && e.first_place) nameCell.append(el("span", { class: "fpv", text: ` (${e.first_place})`, title: `${e.first_place} first-place vote${e.first_place === 1 ? "" : "s"}` }));
      table.appendChild(el("tr", { class: e.team === s.team ? "mine" : "" }, [
        el("td", { text: String(e.rank) }),
        nameCell,
        el("td", { text: e.record }),
        voted ? el("td", { class: "ph", text: String(e.points) }) : null,
        el("td", { style: "text-align:left", class: "muted ph", text: e.conference }),
        el("td", { class: "muted ph", text: e.previous == null ? "NR" : String(e.previous) }),
        el("td", { class: move.startsWith("▲") ? "win" : move.startsWith("▼") ? "loss" : "muted", text: move }),
      ]));
    }
    box.appendChild(table);
    const others = kind === "ap" || kind === "coaches" ? (entry[`${kind}_others`] || []).filter((e) => e.points == null || e.points > 0) : null;
    if (others && others.length) {
      const parts = others.map((e, i) => {
        const span = el("span", { class: e.team === s.team ? "win" : "" }, [e.points != null ? `${e.name} ${e.points}` : `${e.name} (${e.record})`]);
        return i < others.length - 1 ? [span, ", "] : [span];
      }).flat();
      box.appendChild(el("div", { class: "others-votes" }, [el("b", { text: "Others receiving votes: " }), ...parts]));
    }
    // "Dropped from rankings": last poll's top 25 that are out this week, with the spot they held
    let pw = w - 1;
    while (pw >= 0 && !(s.polls[String(pw)] || {})[kind]) pw--;
    const prevList = pw >= 0 ? s.polls[String(pw)][kind] : null;
    if (prevList) {
      const now = new Set(list.map((e) => e.team));
      const dropped = prevList.filter((e) => !now.has(e.team));
      if (dropped.length) {
        const parts = dropped.map((e, i) => {
          const span = el("span", { class: e.team === s.team ? "loss" : "" }, [`${e.name} No. ${e.rank}`]);
          return i < dropped.length - 1 ? [span, ", "] : [span];
        }).flat();
        box.appendChild(el("div", { class: "others-votes" }, [el("b", { text: "Dropped from rankings: " }), ...parts]));
      }
    }
    if (voted) {
      const voters = Math.round(list.reduce((a, e) => a + (e.first_place || 0), 0));
      box.appendChild(el("p", { class: "muted small-text", text: `${voters} ballots · first-place votes in parentheses · points: 25 for first down to 1 for 25th` }));
    }
    // by conference, the way the AP prints it
    const byConf = {};
    for (const e of list) byConf[e.conference] = (byConf[e.conference] || 0) + 1;
    const confLine = Object.entries(byConf).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c, n]) => `${c} ${n}`).join(", ");
    box.appendChild(el("div", { class: "others-votes" }, [el("b", { text: "By conference: " }), confLine]));
    // ranked games in the coming week
    if ((kind === "ap" || kind === "coaches") && !entry.final) renderRankedGames(box, list, w + 1);
  }

  async function renderRankedGames(box, list, week) {
    const s = state.season;
    if (week > 19 || !s.weeks.includes(week)) return;
    const rankOf = {};
    for (const e of list) rankOf[e.team] = e.rank;
    let data;
    try { data = await api(`/api/season/${s.id}/week/${week}`); } catch (err) { return; }
    // only games between two ranked teams
    const games = data.games.filter((g) => rankOf[g.home] && rankOf[g.away]);
    const label0 = s.week_labels[week] || `Week ${week}`;
    if (!games.length) {
      box.appendChild(el("div", { class: "others-votes" }, [el("b", { text: `Ranked matchups in ${label0}: ` }), "none"]));
      return;
    }
    games.sort((a, b) => Math.min(rankOf[a.home] || 99, rankOf[a.away] || 99) - Math.min(rankOf[b.home] || 99, rankOf[b.away] || 99));
    const label = s.week_labels[week] || `Week ${week}`;
    const nm = (slug) => `${rankOf[slug] ? `No. ${rankOf[slug]} ` : ""}${name(slug)}`;
    const parts = games.map((g, i) => {
      const text = g.played
        ? `${nm(g.away)} ${g.away_score}${g.away_score > g.home_score ? "" : ""} at ${nm(g.home)} ${g.home_score}`
        : `${nm(g.away)} ${g.neutral ? "vs" : "at"} ${nm(g.home)}`;
      const span = el("span", { class: (g.home === s.team || g.away === s.team) ? "win" : "" }, [text]);
      return i < games.length - 1 ? [span, "; "] : [span];
    }).flat();
    box.appendChild(el("div", { class: "others-votes" }, [el("b", { text: `Ranked matchups in ${label}: ` }), ...parts]));
  }

  // ----- bracket -----------------------------------------------------------
  // Drawn like the real 12-team bracket: first round (5-12, 6-11, 7-10, 8-9 at the higher
  // seed), quarterfinals (1 vs 8/9, 4 vs 5/12, 2 vs 7/10, 3 vs 6/11 in the New Year's Six
  // bowls), semifinals (QF1 vs QF4, QF2 vs QF3), national championship.

  function rankAt(slug, week) {
    const s = state.season;
    if (!s || !s.polls) return null;
    for (let w = Math.min(week, s.current_week); w >= 0; w--) {
      const p = s.polls[String(w)];
      if (!p) continue;
      if (p.cfp_full) { const i = p.cfp_full.indexOf(slug); return i >= 0 && i < 25 ? i + 1 : null; }
      if (p.cfp) { const e = p.cfp.find((x) => x.team === slug); return e ? e.rank : null; }
      if (p.ap) { const e = p.ap.find((x) => x.team === slug); return e ? e.rank : null; }
    }
    return null;
  }
  const rankTag = (slug, week) => { const r = rankAt(slug, week); return r ? el("span", { class: "rank", text: `#${r} ` }) : null; };

  const BRACKET_ROUNDS = [
    { name: "First round", week: 17, games: [["cfp-r1-8", 8, 9], ["cfp-r1-5", 5, 12], ["cfp-r1-7", 7, 10], ["cfp-r1-6", 6, 11]] },
    { name: "Quarterfinals", week: 18, games: [["cfp-qf-1", 1, "8/9"], ["cfp-qf-4", 4, "5/12"], ["cfp-qf-2", 2, "7/10"], ["cfp-qf-3", 3, "6/11"]] },
    { name: "Semifinals", week: 19, games: [["cfp-sf-1", "QF1", "QF4"], ["cfp-sf-2", "QF2", "QF3"]] },
    { name: "National championship", week: 20, games: [["cfp-final", "SF1", "SF2"]] },
  ];
  const bracketState = { games: null, key: null };

  async function renderBracket() {
    const s = state.season;
    const box = $("#tab-bracket");
    box.innerHTML = "";
    if (!s.bracket) {
      box.append(el("h3", { text: "Projected bracket" }));
      const w = pollWeekFor(state.viewWeek);
      const cfp = (s.polls[String(w)] || {}).cfp;
      if (!cfp) { box.append(el("p", { class: "muted", text: "The projection starts with the committee's first ranking after week 9. Until then, the AP poll is the only ranking." })); return; }
      const proj = projectField(cfp);
      if (!proj) return;
      box.append(el("p", { class: "muted small-text", text: `Projection from the committee ranking after ${s.week_labels[w] || "week " + w} and the current conference leaders: ACC, Big Ten, Big 12 and SEC champions plus the highest-ranked Group of Six team get in; seeds 1-4 are the four highest-ranked teams and get byes. First-round games are at the higher seed.` }));
      box.append(bracketTree(proj.seeds, {}, true));
      box.append(seedTable(proj.seeds, proj.reason, proj.pos));
      return;
    }
    const b = s.bracket;
    box.append(el("h3", { text: s.done ? "College Football Playoff" : "College Football Playoff bracket" }));
    const key = `${s.id}|${s.current_week}`;
    if (!bracketState.games || bracketState.key !== key) {
      bracketState.games = {};
      bracketState.key = key;
      const weeks = BRACKET_ROUNDS.filter((r) => s.current_week >= r.week).map((r) => r.week);
      try {
        const views = await Promise.all(weeks.map((w) => api(`/api/season/${s.id}/week/${w}`)));
        for (const v of views) for (const g of v.games) if (g.kind === "playoff") bracketState.games[g.event_id] = g;
      } catch (err) { box.append(el("p", { class: "muted", text: err.message })); }
    }
    const seeds = {};
    for (const x of b.seeds) seeds[x.seed] = x;
    const sites = s.playoff_sites || {};
    box.append(bracketTree(seeds, bracketState.games, false, sites));
    if (s.done) box.append(champBanner(s.champion, s.champion_name));
    box.append(el("p", { class: "muted small-text", text: "Click a game you were in for the box score. Seeds, ranks and bids:" }));
    box.append(seedTable(seeds, Object.fromEntries(b.seeds.map((x) => [x.team, x.bid])), Object.fromEntries(b.seeds.map((x) => [x.team, x.rank]))));
    if (b.first_four_out && b.first_four_out.length) {
      box.append(el("p", { class: "muted small-text", text: "First four out: " + b.first_four_out.map((x) => `${x.name} (#${x.rank})`).join(", ") }));
    }
  }

  function projectField(cfp) {
    // Mirror the bracket rules on the client for the mid-season projection.
    const s = state.season;
    const P4 = ["ACC", "Big Ten", "Big 12", "SEC"];
    const G6 = new Set(["American Athletic Conference", "Conference USA", "MAC", "Mountain West", "Pac-12", "Sun Belt"]);
    const order = cfp.map((e) => e.team);
    const pos = {}; cfp.forEach((e) => { pos[e.team] = e.rank; });
    const leaders = {};
    if (state.standings) for (const [conf, rows] of Object.entries(state.standings)) if (rows.length) leaders[conf] = rows[0].slug;
    else api(`/api/season/${s.id}/standings`).then((d) => { state.standings = d.standings; if (state.tab === "bracket") renderBracket(); }).catch(() => {});
    const autos = [];
    for (const conf of P4) if (leaders[conf]) autos.push([leaders[conf], `${conf} leader`]);
    const g6 = cfp.find((e) => G6.has(e.conference));
    if (g6) autos.push([g6.team, "highest-ranked Group of Six"]);
    if (pos["notre-dame"] && pos["notre-dame"] <= 12 && !autos.some((a) => a[0] === "notre-dame")) autos.push(["notre-dame", "Notre Dame (top 12)"]);
    const autoSet = new Set(autos.map((a) => a[0]));
    const field = autos.map((a) => a[0]);
    for (const t of order) { if (field.length >= 12) break; if (!autoSet.has(t)) field.push(t); }
    const inside = field.filter((t) => (pos[t] || 99) <= 12).sort((a, b) => pos[a] - pos[b]);
    const outside = field.filter((t) => (pos[t] || 99) > 12).sort((a, b) => (pos[a] || 99) - (pos[b] || 99));
    const seeded = inside.concat(outside);
    const seeds = {};
    seeded.forEach((t, i) => { seeds[i + 1] = { seed: i + 1, team: t, name: name(t), rank: pos[t] || null, bid: Object.fromEntries(autos)[t] || "at-large", bye: i < 4 }; });
    return { seeds, reason: Object.fromEntries(autos), pos };
  }

  function seedTable(seeds, reason, pos) {
    const s = state.season;
    const table = el("table", { class: "stats seed-table" });
    table.appendChild(el("tr", {}, ["Seed", "Team", "Rank", "Bid", ""].map((h) => el("th", { class: `${["Team", "Bid"].includes(h) ? "left" : ""} ${h === "Rank" ? "ph" : ""}`, text: h }))));
    for (let i = 1; i <= 12; i++) {
      const x = seeds[i];
      if (!x) continue;
      table.appendChild(el("tr", { class: x.team === s.team ? "mine" : "" }, [
        el("td", { text: String(i) }),
        el("td", { class: "left name" }, [teamPill(x.team), x.name]),
        el("td", { class: "ph", text: pos[x.team] ? String(pos[x.team]) : "NR" }),
        el("td", { class: "left muted", text: (reason && reason[x.team]) || x.bid || "at-large" }),
        el("td", { class: "muted", text: i <= 4 ? "bye" : "" }),
      ]));
    }
    return el("div", { class: "table-scroll" }, [table]);
  }

  function bracketTree(seeds, games, projected, sites) {
    const s = state.season;
    const tree = el("div", { class: "bracket-tree" });
    const label = (ref) => {
      // a seed number -> that team; "8/9" -> winner of the first-round game; "QF1" -> winner of that quarterfinal
      if (typeof ref === "number") return seeds[ref] ? { seed: ref, team: seeds[ref].team, name: seeds[ref].name } : { name: "TBD" };
      if (/^\d+\/\d+$/.test(ref)) { const g = games[`cfp-r1-${ref.split("/")[0]}`]; return winnerOf(g) || { name: `${ref} winner` }; }
      if (/^QF\d$/.test(ref)) { const g = games[`cfp-qf-${ref[2]}`]; return winnerOf(g) || { name: `${ref} winner` }; }
      if (/^SF\d$/.test(ref)) { const g = games[`cfp-sf-${ref[2]}`]; return winnerOf(g) || { name: `${ref} winner` }; }
      return { name: "TBD" };
    };
    BRACKET_ROUNDS.forEach((round, ri) => {
      const col = el("div", { class: "bracket-round" }, [el("div", { class: "bracket-round-name", text: round.name })]);
      const games = el("div", { class: "bracket-games" });
      col.append(games);
      for (const [eid, top, bottom] of round.games) {
        const g = games[eid];
        const a = label(top), b = label(bottom);
        let note = "";
        if (g) note = g.bowl ? `${g.bowl}${g.site ? " · " + g.site : ""}` : (g.neutral ? "neutral site" : `at ${g.home_name}`);
        else if (ri === 0 && a.name !== "TBD") note = `at ${a.name}`;
        else if (sites) { const key = { "cfp-qf-1": "qf-1", "cfp-qf-4": "qf-4", "cfp-qf-2": "qf-2", "cfp-qf-3": "qf-3", "cfp-sf-1": "sf-1", "cfp-sf-2": "sf-2", "cfp-final": "final" }[eid]; const site = key && sites[key]; note = site ? `${site.bowl || site.name || ""}${site.site ? " · " + site.site : ""}` : "neutral site"; }
        else note = ri === 0 ? "" : "neutral site";
        // rows: the game's home side is the higher seed; show it first
        let rows;
        if (g) {
          const hw = g.played && g.home_score > g.away_score, aw = g.played && g.away_score > g.home_score;
          rows = [[g.home, g.home_display, g.home_score, hw, g.played && !hw], [g.away, g.away_display, g.away_score, aw, g.played && !aw]];
        } else {
          rows = [[a.team, a.seed ? `(${a.seed}) ${a.name}` : a.name, null, false, false], [b.team, b.seed ? `(${b.seed}) ${b.name}` : b.name, null, false, false]];
        }
        const mine = rows.some((r) => r[0] === s.team);
        const card = el("div", { class: `bmatch ${mine ? "mine" : ""} ${g && g.has_box ? "clickable" : ""} ${projected ? "projected" : ""}` }, [
          ...rows.map(([team, text, score, won, lost]) => el("div", { class: `bmatch-row ${won ? "win" : ""} ${lost ? "lost" : ""}` }, [
            team ? teamPill(team) : el("span", { class: "pill-inline empty" }),
            el("span", { class: "bmatch-name" }, [text, team && rankAt(team, 15) ? el("span", { class: "rank muted", text: ` #${rankAt(team, projected ? (s.current_week || 15) : 15)}` }) : null]),
            el("b", { class: "bmatch-score", text: score == null ? "" : String(score) }),
          ])),
          el("div", { class: "muted small-text bmatch-note", text: note + (g && g.overtime ? ` · ${g.overtime > 1 ? g.overtime : ""}OT` : "") }),
        ]);
        if (g && g.has_box) card.addEventListener("click", () => openBox(g.event_id));
        games.append(card);
      }
      tree.append(col);
    });
    return tree;
  }

  function champBanner(slug, name) {
    // the national champion in the winner's own colors: primary background, the lighter
    // of secondary/white for the text, the diagonal team square beside the name
    const t = window.CFP.teamsBySlug[slug];
    const col = (t && t.colors) || {};
    const bg = col.primary || "var(--accent)";
    const banner = el("div", { class: "champ-banner team-colors" }, [teamPill(slug), el("span", { text: `National champion: ${name}` })]);
    banner.style.background = bg;
    banner.style.color = readableOn(bg, col.secondary);
    return banner;
  }

  function readableOn(bg, preferred) {
    // white or near-black, whichever reads on the background; a light secondary color wins
    const rgb = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
    const lum = (c) => c ? (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 : 0.5;
    const b = rgb(bg), pref = rgb(preferred);
    if (pref && Math.abs(lum(pref) - lum(b)) > 0.45) return preferred;
    return lum(b) > 0.55 ? "#111" : "#fff";
  }

  function winnerOf(g) {
    if (!g || !g.played) return null;
    const hw = g.home_score > g.away_score;
    const disp = hw ? g.home_display : g.away_display;
    const m = /^\((\d+)\)\s*(.*)$/.exec(disp || "");
    return { team: hw ? g.home : g.away, seed: m ? Number(m[1]) : null, name: m ? m[2] : disp };
  }

  async function openBox(eventId) {
    const s = state.season;
    try {
      const g = await api(`/api/season/${s.id}/game/${eventId}`);
      if (g.real_box) { renderRealBox(g); return; }
      window.CFP.currentBoxSlugs = { home: g.home_slug, away: g.away_slug };
      // the box score lives in #tab-box; it is rendered in place, then moved into the shared modal
      const node = state.boxNode || (state.boxNode = $("#tab-box"));
      if (!node.isConnected) document.body.append(node);
      node.hidden = false;
      renderScoreboard(g, SBOX_IDS); renderScoring(g, SBOX_IDS); renderTeamStats(g, SBOX_IDS);
      if (g.rivalry) $("#sbox-meta").prepend(el("div", { class: "rivalry-line" }, [el("b", { text: `${g.rivalry.trophy ? "🏆 " + g.rivalry.trophy : "🔥 " + g.rivalry.name}: ` }), `${g.rivalry.headline ? g.rivalry.headline + ". " : ""}${g.rivalry.series}.`]));
      renderPlayers(g.home, $("#sbox-home")); renderPlayers(g.away, $("#sbox-away")); renderDrives(g, SBOX_IDS);
      $("#sbox-tabs button[data-btab=home]").textContent = `${g.home.name} players`;
      $("#sbox-tabs button[data-btab=away]").textContent = `${g.away.name} players`;
      selectBoxTab("scoring");
      const title = el("span", {}, [teamPill(g.away_slug), `${g.away.name} ${g.away.score}`, el("span", { class: "muted", text: " at " }), teamPill(g.home_slug), `${g.home.name} ${g.home.score}`,
        el("span", { class: "muted small-text", text: g.overtime_periods ? ` · Final / ${g.overtime_periods}OT` : " · Final" })]);
      openModal(title, node);
    } catch (err) { toast(`Could not load that game: ${err.message}`, 3000); }
  }
  function selectBoxTab(name) {
    for (const b of $("#sbox-tabs").querySelectorAll("button")) b.classList.toggle("active", b.dataset.btab === name);
    for (const t of ["scoring", "team", "home", "away", "drives"]) $(`#sbox-${t}`).hidden = t !== name;
  }

  // ----- settings and god mode ------------------------------------------------------
  const godMode = () => !!((state.season && state.season.settings) || {}).god_mode;
  async function saveSettings(changes) {
    const s = state.season;
    const j = await api(`/api/season/${s.id}/settings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
    s.settings = j.settings;
    playerState.cache.clear();
    return j.settings;
  }
  function openSettings() {
    const s = state.season;
    if (!s) return;
    const node = el("div", { class: "settings" });
    const row = (title, desc, control) => el("div", { class: "settings-row" }, [el("div", { class: "settings-text" }, [el("b", { text: title }), el("div", { class: "muted small-text", text: desc })]), control]);
    const toggle = (on, onChange) => {
      const b = el("button", { type: "button", class: `switch ${on ? "on" : ""}`, role: "switch", "aria-checked": on ? "true" : "false" }, [el("span", { class: "knob" })]);
      b.addEventListener("click", async () => { const next = !b.classList.contains("on"); b.disabled = true; try { await onChange(next); b.classList.toggle("on", next); b.setAttribute("aria-checked", next ? "true" : "false"); } catch (err) { toast(err.message, 4000); } b.disabled = false; });
      return b;
    };
    node.append(
      row("God mode", "Edit every player's ratings, class, size, jersey and development trait from his player card, and every team's depth chart. Changes are saved with this season and used by every game from the next sim on.",
        toggle(godMode(), async (on) => { await saveSettings({ god_mode: on }); toast(on ? "God mode on: open any player or depth chart to edit it." : "God mode off.", 3000); renderTab(); })),
      row("Momentum and morale", "Big plays swing momentum inside a game and nudge ratings play by play; wins, losses and each player's own games set a mood that carries into the next game and fades week by week. Player cards show the boosts as green and red arrows.",
        toggle(!!(s.settings || {}).morale, async (on) => { await saveSettings({ morale: on }); toast(on ? "Momentum and morale on from the next sim." : "Momentum and morale off.", 3000); })),
      row("Game day pace", "How fast the plays come during a game day replay.",
        chipRow([["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"]], gdSpeed(), (v) => { try { localStorage.setItem("cfp.gameday.speed", v); } catch (e) {} })),
    );
    openModal("Settings", node);
  }

  // every rating the player carries, with the boosts and the god-mode marks, and his rating at other positions
  function openAllRatings(p) {
    const edited = new Set(p.edited || []);
    const keySet = new Set(p.key_ratings || []);
    const node = el("div", { class: "all-ratings" });
    node.append(el("p", { class: "muted small-text", text: `1-99: 50 is an average Power 4 starter at the position, 65 a good one, 80 elite, 95 generational, 25 an average FBS roster player. The ${p.position} ratings the card shows are marked; the rest still matter when he lines up somewhere else, returns kicks or tires.` }));
    const table = el("table", { class: "stats ratings-table" });
    table.append(el("tr", {}, ["Rating", "", "Value"].map((h, i) => el("th", { class: i === 0 ? "left" : "", text: h }))));
    for (const r of p.ratings) {
      const pct = Math.max(2, Math.min(100, r.value));
      const tone = r.value >= 75 ? "hi" : r.value >= 55 ? "mid" : "lo";
      table.append(el("tr", { class: keySet.has(r.key) ? "key" : "" }, [
        el("td", { class: "left" }, [el("span", { class: `rating-label ${edited.has(r.key) ? "edited" : ""}`, text: r.label }), keySet.has(r.key) ? el("span", { class: "pos", text: p.position }) : null, edited.has(r.key) ? el("span", { class: "pos", text: "edited" }) : null]),
        el("td", {}, [el("div", { class: "rating-bar" }, [el("div", { class: `rating-fill ${tone}`, style: `width:${pct}%` })])]),
        el("td", { class: "rating-num" }, [el("b", { text: String(r.value) }), r.boost ? el("span", { class: `boost ${r.boost > 0 ? "up" : "down"}`, text: `${r.boost > 0 ? "▲" : "▼"}${Math.abs(r.boost)}` }) : null]),
      ]));
    }
    node.append(el("div", { class: "table-scroll" }, [table]));
    const others = Object.entries(p.ratings_at || {}).filter(([pos]) => !(pos === "MLB" && /LB$/.test(p.position))).sort((a, b) => b[1] - a[1]);
    if (others.length) {
      node.append(el("h4", { text: "Rated at every position" }), el("p", { class: "muted small-text", text: "On the same scale: 50 is an average Power 4 starter at that position. The depth chart's By position view uses these when you move someone." }));
      node.append(el("div", { class: "ratings-at" }, others.map(([pos, v]) => el("div", { class: `review-tile ${pos === p.position ? "mine" : ""}` }, [el("div", { class: "review-leader-big", text: String(v) }), el("div", { class: "review-label", text: pos === p.position ? `${pos} (his spot)` : pos })]))));
    }
    openModal(el("span", {}, [`${p.name} · all ratings`, el("span", { class: "muted small-text", text: ` · ${p.overall} overall at ${p.position}` })]), node);
  }

  const CLASS_FULL = { FR: "Freshman", FRRS: "Redshirt freshman", SO: "Sophomore", SORS: "Redshirt sophomore", JR: "Junior", JRRS: "Redshirt junior", SR: "Senior", SRRS: "Redshirt senior" };
  // the player card's edit form (god mode): ratings as numbers, then the identity fields
  function playerEditForm(p, card) {
    const s = state.season;
    const form = el("div", { class: "player-edit" });
    const inputs = {};
    const num = (key, value) => { const i = el("input", { type: "number", min: "0", max: "99", step: "1", value: String(value), "aria-label": key }); inputs[key] = i; return i; };
    for (const r of p.ratings) form.append(el("div", { class: "rating-row edit" }, [el("span", { class: "rating-label", text: r.label }), el("div", {}), num(r.key, r.value)]));
    const text = (key, value, attrs = {}) => { const i = el("input", { type: "text", value: value == null ? "" : String(value), "aria-label": key, ...attrs }); inputs[key] = i; return i; };
    const select = (key, value, options) => { const sel = el("select", { "aria-label": key }, options.map(([v, label]) => el("option", { value: v, text: label }))); sel.value = value || options[0][0]; inputs[key] = sel; return sel; };
    const grid = el("div", { class: "player-edit-grid" }, [
      el("label", {}, ["Jersey", text("jersey", p.jersey, { maxlength: "3" })]),
      el("label", {}, ["Class", select("class", p.class, (p.editable_classes || []).map((c) => [c, CLASS_FULL[c] || c]))]),
      el("label", {}, ["Height", text("height", p.height, { placeholder: "6'2\"" })]),
      el("label", {}, ["Weight", (() => { const i = el("input", { type: "number", min: "150", max: "400", value: String(p.weight || ""), "aria-label": "weight" }); inputs.weight = i; return i; })()]),
      el("label", {}, ["Development", select("dev_trait", p.dev_trait, (p.dev_traits || ["Normal", "Impact", "Star", "Elite"]).map((d) => [d, d]))]),
    ]);
    form.append(el("h4", { text: "Identity" }), grid);
    const actions = el("div", { class: "player-edit-actions" });
    const save = el("button", { type: "button", class: "primary small", text: "Save changes" });
    const cancel = el("button", { type: "button", class: "ghost small", text: "Cancel" });
    cancel.addEventListener("click", () => { form.remove(); card.querySelector(".player-edit-open").hidden = false; });
    save.addEventListener("click", async () => {
      const changes = {};
      for (const r of p.ratings) { const v = Number(inputs[r.key].value); if (Number.isFinite(v) && v !== r.value) changes[r.key] = Math.round(v); }
      for (const k of ["jersey", "class", "height", "dev_trait"]) if (inputs[k].value !== String(p[k] == null ? "" : p[k])) changes[k] = inputs[k].value;
      if (inputs.weight.value && Number(inputs.weight.value) !== p.weight) changes.weight = Number(inputs.weight.value);
      if (!Object.keys(changes).length) { toast("Nothing changed.", 2000); return; }
      save.disabled = true;
      try {
        const j = await api(`/api/season/${s.id}/player/edit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ team: p.team.slug, player: p.slug, changes }) });
        playerState.cache.clear();
        toast(`${p.name} updated.`, 2500);
        const box = card.closest(".player-page");
        if (box && j.player) renderPlayer(j.player, box);
        if (state.tab === "depth") renderDepthChart();
      } catch (err) { toast(`Could not save: ${err.message}`, 4000); save.disabled = false; }
    });
    actions.append(save, cancel);
    form.append(actions);
    return form;
  }

  // ----- rivalries ---------------------------------------------------------------
  async function renderRivalriesCard(box) {
    const s = state.season;
    let data;
    try { data = await api(`/api/season/${s.id}/rivalries`); } catch (err) { return; }
    if (!data.rivalries.length || !box.isConnected) return;
    const card = el("div", { class: "review-card rivalries" }, [el("div", { class: "review-label", text: "Rivalries" })]);
    const table = el("table", { class: "stats rivalry-table" });
    table.append(el("tr", {}, ["Rival", "Trophy", "This season", "Series"].map((h, i) => el("th", { class: `left ${i === 1 ? "ph" : ""}`, text: h }))));
    for (const r of data.rivalries) {
      const g = r.game;
      const result = !g ? el("span", { class: "muted", text: "not scheduled" })
        : !g.played ? el("span", { class: "muted", text: `${s.week_labels[g.week] || "Week " + g.week} · ${g.venue === "away" ? "at" : "vs"} ${r.opponent_name}` })
        : el("span", { class: g.won ? "win" : "loss", text: `${g.won ? "W" : "L"} ${g.points_for}–${g.points_against} ${g.venue === "away" ? "at" : "vs"} ${r.opponent_name}` });
      const tr = el("tr", { class: g && g.has_box ? "clickable" : "" }, [
        el("td", { class: "left name" }, [teamPill(r.opponent), r.opponent_name, el("div", { class: "muted small-text", text: r.name })]),
        el("td", { class: "left ph", text: r.trophy || "–" }),
        el("td", { class: "left" }, [result]),
        el("td", { class: "left" }, [el("span", { class: r.leader === s.team ? "win" : r.leader ? "loss" : "muted", text: r.series }), r.holder && r.trophy ? el("div", { class: "muted small-text", text: `${r.holder === s.team ? "You hold" : r.opponent_name + " holds"} the ${r.trophy}` }) : null]),
      ]);
      if (g && g.has_box) tr.addEventListener("click", () => openBox(g.event_id));
      table.append(tr);
    }
    card.append(el("div", { class: "table-scroll" }, [table]), el("div", { class: "muted small-text", text: `All-time series as of the ${data.as_of}, plus this season's games.` }));
    box.append(card);
  }

  // ----- the committee's resume -------------------------------------------------
  const resumeState = { sort: "rank", desc: false, cache: {} };
  async function renderResume(box, w) {
    const s = state.season;
    box.append(el("h3", { text: `Committee resume · ${w === 0 ? "preseason" : `through ${s.week_labels[w] || "week " + w}`}` }));
    const note = el("p", { class: "muted small-text", text: "Loading…" });
    box.append(note);
    let data = resumeState.cache[`${s.id}|${w}`];
    if (!data) {
      try { data = await api(`/api/season/${s.id}/resume?week=${w}`); } catch (err) { note.textContent = `Could not load the resume: ${err.message}`; return; }
      resumeState.cache[`${s.id}|${w}`] = data;
    }
    if (!box.isConnected) return;
    note.textContent = `The way the committee explains its rankings: wins over teams ranked today (${data.kind === "cfp" ? "CFP ranking" : "AP poll"}), strength of schedule (two thirds the opponents' record, one third their opponents'; rank of ${data.rows.length}), the record against teams over .500, the best win and the worst loss. Click a team for its full resume.`;
    const top = data.rows.filter((r) => r.rank).length ? data.rows : data.rows.slice(0, 25);
    const rows = top.filter((r) => r.rank || r.team === s.team).length >= 10 ? top.filter((r) => r.rank || r.team === s.team) : top.slice(0, 25);
    const gameTag = (x, win) => (x ? el("span", { class: "resume-game" }, [x.rank_now ? el("span", { class: "rank", text: `#${x.rank_now} ` }) : null, teamPill(x.opp), x.opp_name, el("span", { class: "muted small-text", text: ` ${x.venue === "away" ? "(A)" : x.venue === "neutral" ? "(N)" : "(H)"} ${x.pf}–${x.pa}` })]) : el("span", { class: "muted", text: "–" }));
    const st = resumeState;
    const cols = [
      { key: "rank", label: "#", get: (r) => (r.rank ? String(r.rank) : "NR"), sort: (r) => r.rank || 99 },
      { key: "team", label: "Team", left: true, get: (r) => el("span", { "data-team": r.team }, [teamPill(r.team), r.name, youTag(r.team)]), sort: (r) => r.name },
      { key: "record", label: "Record", get: (r) => r.record, sort: (r) => r.wins - r.losses / 100 },
      { key: "conf", label: "Conf", ph: true, get: (r) => r.conf_record, sort: (r) => Number(r.conf_record.split("-")[0]) },
      { key: "sos", label: "SOS", get: (r) => String(r.sos_rank), sort: (r) => r.sos_rank },
      { key: "top25", label: "vs Top 25", get: (r) => r.top25, sort: (r) => r.top25_wins - Number(r.top25.split("-")[1]) / 100 },
      { key: "winning", label: "vs .500+", ph: true, get: (r) => r.vs_winning, sort: (r) => Number(r.vs_winning.split("-")[0]) - Number(r.vs_winning.split("-")[1]) / 100 },
      { key: "best", label: "Best win", left: true, get: (r) => gameTag(r.best_win, true) },
      { key: "worst", label: "Worst loss", left: true, ph: true, get: (r) => gameTag(r.worst_loss, false) },
    ];
    const table = sortableTable(cols, rows, st, () => renderPoll("resume"), (r) => `clickable ${r.team === s.team ? "mine" : ""}`);
    table.addEventListener("click", (e) => { const tr = e.target.closest("tr"); const t = tr && tr.querySelector("[data-team]"); if (t) openResume(t.dataset.team, w); });
    box.append(table);
    if (rows.length < data.rows.length) box.append(el("p", { class: "muted small-text", text: `${rows.length} of ${data.rows.length} teams shown; every team's resume opens from its schedule.` }));
  }

  async function openResume(slug, w) {
    const s = state.season;
    let data;
    try { data = await api(`/api/season/${s.id}/resume?week=${w}&team=${slug}`); } catch (err) { toast(`Could not load the resume: ${err.message}`, 3000); return; }
    const r = data.rows[0];
    if (!r) return;
    const node = el("div", { class: "resume" });
    const tile = (label, value, sub) => el("div", { class: "review-tile" }, [el("div", { class: "review-leader-big", text: value }), el("div", { class: "review-label", text: label }), sub ? el("div", { class: "muted small-text", text: sub }) : null]);
    node.append(
      el("div", { class: "muted small-text", text: `${r.conference} · ${w === 0 ? "preseason" : `through ${s.week_labels[w] || "week " + w}`} · ranks are today's ${data.kind === "cfp" ? "CFP ranking" : "AP poll"}` }),
      el("div", { class: "review-tiles" }, [
        tile("Record", r.record, `${r.conf_record} ${r.conference}`),
        tile("Strength of schedule", `#${r.sos_rank}`, `opponents ${(r.opp_pct * 100).toFixed(1)}% · theirs ${(r.oo_pct * 100).toFixed(1)}%`),
        tile("vs Top 25", r.top25, `${r.road_wins} win${r.road_wins === 1 ? "" : "s"} away from home`),
        tile("vs teams over .500", r.vs_winning, `${r.margin > 0 ? "+" : ""}${r.margin} points per game`),
      ]),
    );
    const gameLine = (x) => el("span", {}, [x.venue === "away" ? "at " : x.venue === "neutral" ? "vs " : "vs ", x.rank_now ? el("span", { class: "rank", text: `#${x.rank_now} ` }) : null, teamPill(x.opp), x.opp_name, el("span", { class: "muted small-text", text: ` (${x.opp_record}) ${x.pf}–${x.pa}${x.rank_then && x.rank_then !== x.rank_now ? ` · #${x.rank_then} at the time` : ""}` })]);
    node.append(el("div", { class: "leaders-grid resume-grid" }, [
      el("div", { class: "leader-card" }, [el("div", { class: "leader-head" }, [el("h4", { text: "Best win" })]), r.best_win ? gameLine(r.best_win) : el("span", { class: "muted", text: "No wins yet." })]),
      el("div", { class: "leader-card" }, [el("div", { class: "leader-head" }, [el("h4", { text: "Worst loss" })]), r.worst_loss ? gameLine(r.worst_loss) : el("span", { class: "muted", text: "Unbeaten." })]),
    ]));
    const table = el("table", { class: "stats resume-games" });
    table.append(el("tr", {}, ["Wk", "Opponent", "Rank then", "Rank now", "Their record", "Result", ""].map((h, i) => el("th", { class: `${i === 1 ? "left" : ""} ${[2, 4].includes(i) ? "ph" : ""}`, text: h }))));
    for (const x of r.games || []) {
      const tr = el("tr", { class: `${x.event_id ? "clickable" : ""} ${x.won ? "won" : "lost"}` }, [
        el("td", { class: "muted", text: x.week > 14 ? (s.week_labels[x.week] || "").replace("Championship week", "CCG").replace(" & bowls", "").replace(" & New Year bowls", "") : String(x.week) }),
        el("td", { class: "left name" }, [el("span", { class: "muted", text: `${x.venue === "away" ? "at" : "vs"} ` }), teamPill(x.opp), x.opp_name, x.fcs ? el("span", { class: "pos", text: "FCS" }) : null, x.title ? el("div", { class: "muted small-text", text: x.title }) : null]),
        el("td", { class: "muted ph", text: x.rank_then ? `#${x.rank_then}` : "–" }),
        el("td", { class: x.rank_now ? "win" : "muted", text: x.rank_now ? `#${x.rank_now}` : "–" }),
        el("td", { class: "muted ph", text: x.fcs ? "" : x.opp_record }),
        el("td", { class: x.won ? "win" : "loss", text: `${x.won ? "W" : "L"} ${x.pf}–${x.pa}` }),
        el("td", { class: "muted small-text", text: x.event_id ? "box" : "" }),
      ]);
      if (x.event_id) tr.addEventListener("click", () => openBox(x.event_id));
      table.append(tr);
    }
    node.append(el("h4", { text: "Games" }), el("div", { class: "table-scroll" }, [table]));
    openModal(el("span", {}, [teamPill(slug), `${r.name} resume`, el("span", { class: "muted small-text", text: ` · ${r.rank ? `#${r.rank} · ` : ""}${r.record}` })]), node);
  }

  // ----- game day: your game, drive by drive ----------------------------------
  // The Game day button simulates this week as usual, then replays your game from its
  // play log: one play at a time, the score and clock moving, a Skip to the final box
  // score. "Sim to next week" and the multi-week sims go straight to the results.

  const gameday = { timer: null, speed: "normal", moments: [], i: 0, g: null, eventId: null, node: null };
  const GD_PACE = { slow: 1600, normal: 900, fast: 320 };
  const gdSpeed = () => { try { return localStorage.getItem("cfp.gameday.speed") || "normal"; } catch (e) { return "normal"; } };

  const gdAbbr = (g, side) => { const t = window.CFP.teamsBySlug[g[`${side}_slug`]]; return (t && t.abbreviation) || g[side].name; };
  // a yardline is the offense's distance from its own goal line
  const gdSpot = (g, off, yl) => (yl === 50 ? "the 50" : yl < 50 ? `the ${gdAbbr(g, off)} ${yl}` : `the ${gdAbbr(g, off === "home" ? "away" : "home")} ${100 - yl}`);
  const gdGain = (n) => (n > 0 ? `${n} yard gain` : n === 0 ? "no gain" : `loss of ${-n}`);
  const gdDown = (e) => (e.down ? `${ordinal(e.down)} & ${e.yl + e.dist >= 100 ? "Goal" : e.dist}` : "");

  function gdDescribe(g, d, e) {
    const off = d.offense, def = off === "home" ? "away" : "home";
    const td = e.after === 6 || e.result === "defensive_touchdown" || e.result === "return_td";
    if (e.type === "kickoff") {
      if (e.result === "onside_recovered") return `${e.kicking} tries an onside kick and recovers it at ${gdSpot(g, off, e.to)}.`;
      if (e.result === "onside_failed") return `${e.kicking} tries an onside kick; ${g[off].name} recovers at ${gdSpot(g, off, e.to)}.`;
      if (e.result === "return_td") return `${e.kicking} kicks off; ${e.returner || "the returner"} takes it all the way back for a TOUCHDOWN.`;
      if (e.returner && e.return_yards) return `${e.kicking} kicks off; ${e.returner} returns it ${e.return_yards} yards to ${gdSpot(g, off, e.to)}.`;
      return `${e.kicking} kicks off; touchback, ${g[off].name} starts at ${gdSpot(g, off, e.to)}.`;
    }
    if (e.type === "penalty") {
      const on = e.result === "offensive penalty" ? g[off].name : g[def].name;
      return `Penalty on ${on}: ${e.penalty || "penalty"}, ${Math.abs(e.yards || 0)} yards.`;
    }
    if (e.type === "field_goal") {
      const who = e.kicker ? `${e.kicker}'s ` : "";
      return `${who}${e.distance} yard field goal is ${e.result === "good" ? "GOOD" : e.result === "blocked" ? "BLOCKED" : "NO GOOD"}.`;
    }
    if (e.type === "punt") {
      const who = e.punter || g[off].name;
      if (e.result === "blocked") return `${who}'s punt is BLOCKED.`;
      if (e.result === "return_td") return `${who} punts ${e.yards} yards; ${e.returner || "the returner"} takes it back for a TOUCHDOWN.`;
      if (e.returner && e.return_yards) return `${who} punts ${e.yards} yards; ${e.returner} returns it ${e.return_yards} yards to ${gdSpot(g, def, 100 - e.to)}.`;
      return `${who} punts ${e.yards} yards; ${g[def].name} takes over at ${gdSpot(g, def, 100 - e.to)}.`;
    }
    const first = e.after === 1 && !td ? " for a first down" : "";
    const fumble = (base) => {
      if (!e.fumble) return base;
      if (e.fumble_kept) return `${base}, fumbles and ${g[off].name} recovers`;
      if (e.result === "defensive_touchdown") return `${base}, FUMBLES, ${e.recovered_by || g[def].name} picks it up and returns it for a TOUCHDOWN`;
      return `${base}, FUMBLES, recovered by ${e.recovered_by || g[def].name}`;
    };
    if (e.type === "run") {
      if (e.kneel) return `${g[off].name} takes a knee.`;
      const who = e.who || g[off].name;
      if (td && !e.fumble) return `${who} ${e.yards} yard run for a TOUCHDOWN.`;
      return fumble(`${who} runs for a ${gdGain(e.yards)}`) + first + (e.safety ? ". SAFETY" : "") + ".";
    }
    // passes
    const qb = e.qb || "The quarterback";
    if (e.spike) return `${qb} spikes the ball to stop the clock.`;
    if (e.throwaway) return `${qb} throws it away.`;
    if (e.result === "sack") return fumble(`${qb} sacked${e.sacked_by ? ` by ${e.sacked_by}` : ""} for a ${gdGain(e.yards)}`) + (e.safety ? ". SAFETY" : "") + ".";
    if (e.result === "interception") return `${qb} INTERCEPTED by ${e.picked_by || "the defense"}; ${g[def].name} takes over at ${gdSpot(g, def, 100 - e.to)}.`;
    if (e.result === "defensive_touchdown" && e.picked_by) return `${qb} INTERCEPTED by ${e.picked_by}, returned for a TOUCHDOWN.`;
    if (e.result === "run") return `${qb} scrambles for a ${gdGain(e.yards)}${td ? " and a TOUCHDOWN" : first}.`;
    if (e.result === "incomplete") return `${qb} incomplete${e.target ? `, intended for ${e.target}` : ""}${e.hail_mary ? " on the Hail Mary" : ""}.`;
    const to = e.target ? ` to ${e.target}` : "";
    if (td && !e.fumble) return `${qb} complete${to} for ${e.yards} yards and a TOUCHDOWN${e.hail_mary ? " on the Hail Mary" : ""}.`;
    return fumble(`${qb} complete${to} for a ${gdGain(e.yards)}`) + first + ".";
  }

  function gdMoments(g) {
    const sp = g.scoring_plays || [];
    let si = 0, home = 0, away = 0;
    const take = () => { if (si < sp.length) { const s = sp[si++]; home = s.home_score; away = s.away_score; return s; } return null; };
    const out = [];
    g.drives.forEach((d, di) => {
      const off = d.offense;
      let scored = false;
      for (const e of d.log || []) {
        const m = { drive: di, off, quarter: e.quarter, clock: e.clock, kind: e.type, text: gdDescribe(g, d, e), situation: "", big: false,
          yl: e.yl, to: e.to, dist: e.dist, down: e.down, result: e.result };
        if (e.type === "run" || e.type === "pass") {
          m.situation = e.down ? `${gdDown(e)} at ${gdSpot(g, off, e.yl)}` : `At ${gdSpot(g, off, e.yl)}`;
          if (Math.abs(e.yards || 0) >= 20 || ["interception", "fumble", "defensive_touchdown"].includes(e.result) || e.fumble) m.big = true;
        } else if (e.type === "field_goal" || e.type === "punt") m.situation = `4th${e.dist != null ? ` & ${e.dist}` : ""} at ${gdSpot(g, off, e.yl)}`;
        const scores = e.after === 6 || e.result === "defensive_touchdown" || e.result === "return_td" || (e.type === "field_goal" && e.result === "good") || e.safety;
        if (scores) { m.score = take(); m.big = true; scored = true; }
        m.home = home; m.away = away;
        out.push(m);
      }
      if (!scored && ["touchdown", "field goal", "safety", "defensive_touchdown", "punt_return_td"].includes(d.result)) {
        const s = take();
        if (s) { const last = out[out.length - 1]; if (last && last.drive === di) { last.score = s; last.big = true; last.home = home; last.away = away; } else out.push({ drive: di, off, quarter: d.quarter, clock: "", kind: "score", text: `${s.team_name}: ${s.description}`, score: s, big: true, home, away, situation: "" }); }
      }
      out.push({ drive: di, off, quarter: d.quarter, clock: "", kind: "drive-end", text: gdDriveResult(g, d), home, away, situation: "", end: true });
    });
    while (si < sp.length) { const s = take(); out.push({ drive: g.drives.length, off: s.team, quarter: s.quarter, clock: s.clock, kind: "score", text: `${s.team_name}: ${s.description}${s.try ? ` (${s.try})` : ""}`, score: s, big: true, home, away, situation: "" }); }
    return out;
  }
  // The field: the home team drives left to right (toward the away end zone), the away
  // team right to left. A yardline in the log is the offense's distance from its own goal.
  const gdX = (side, yl) => Math.max(0, Math.min(100, side === "home" ? yl : 100 - yl));
  function gdFieldNode(g) {
    const ez = (side) => {
      const t = window.CFP.teamsBySlug[g[`${side}_slug`]] || {};
      const col = t.colors || {};
      return el("div", { class: `gd-ez ${side}`, style: `background:${col.primary || "#444"};color:${col.accent || "#fff"}`, text: t.abbreviation || g[side].name.slice(0, 4).toUpperCase() });
    };
    const grass = el("div", { class: "gd-grass" });
    for (let y = 10; y <= 90; y += 10) {
      grass.append(el("div", { class: "gd-yard", style: `left:${y}%` }));
      grass.append(el("div", { class: "gd-num", style: `left:${y}%`, text: String(y <= 50 ? y : 100 - y) }));
    }
    grass.append(el("div", { class: "gd-gain", id: "gd-gain" }), el("div", { class: "gd-fd", id: "gd-fd" }), el("div", { class: "gd-ball", id: "gd-ball" }, [el("span", { class: "gd-arrow", id: "gd-arrow" })]));
    // each team attacks the other's end zone: the home team drives toward the away end zone on the right
    return el("div", { class: "gd-field", id: "gd-field" }, [ez("home"), grass, ez("away")]);
  }
  function gdFieldUpdate(g, m, next) {
    const ball = $("#gd-ball"), fd = $("#gd-fd"), gain = $("#gd-gain"), arrow = $("#gd-arrow");
    if (!ball) return;
    const snap = ["run", "pass", "penalty"].includes(m.kind);
    let spot = null, from = null, fdLine = null, side = m.off;
    if (snap && m.to != null) { spot = m.to; from = m.yl; }
    else if (m.kind === "kickoff" && m.to != null) spot = m.to;
    else if (m.kind === "punt" && m.to != null) spot = m.to;
    else if (m.kind === "field_goal" && m.yl != null) spot = m.yl;
    // the next snap in the same drive says where the first-down line is and who has the ball
    if (next && next.drive === m.drive && ["run", "pass", "penalty"].includes(next.kind) && next.yl != null) {
      spot = next.yl; side = next.off;
      if (next.dist != null) fdLine = Math.min(100, next.yl + next.dist);
    } else if (next && next.drive !== m.drive) {
      fdLine = null;
    }
    if (spot == null) return;
    ball.style.left = `${gdX(side, spot)}%`;
    ball.classList.toggle("home", side === "home");
    ball.classList.toggle("away", side !== "home");
    arrow.textContent = side === "home" ? "▶" : "◀";
    if (fdLine != null && fdLine < 100) { fd.hidden = false; fd.style.left = `${gdX(side, fdLine)}%`; } else fd.hidden = true;
    if (from != null && m.to != null && from !== m.to && m.off === side) {
      const a = gdX(m.off, from), b = gdX(m.off, m.to);
      gain.hidden = false; gain.style.left = `${Math.min(a, b)}%`; gain.style.width = `${Math.abs(b - a)}%`;
      gain.classList.toggle("loss", (m.to - from) < 0);
    } else if (from != null && m.to != null && m.off !== side) {
      // a turnover: the gain bar shows the old offense's play, the ball now belongs to the other side
      const a = gdX(m.off, from), b = gdX(m.off, m.to);
      gain.hidden = false; gain.style.left = `${Math.min(a, b)}%`; gain.style.width = `${Math.abs(b - a)}%`; gain.classList.add("loss");
    } else gain.hidden = true;
  }

  function gdDriveResult(g, d) {
    const r = { touchdown: "Touchdown", "field goal": "Field goal", "missed kick": "Missed field goal", punt: "Punt", turnover: "Turnover", safety: "Safety",
      defensive_touchdown: "Defensive touchdown", punt_return_td: "Punt return touchdown", end_of_half: "End of half", first_down: "Drive over" }[d.result] || d.result;
    return `${r} · ${d.plays} play${d.plays === 1 ? "" : "s"}, ${d.end_yardline - d.start_yardline} yards, ${Math.floor(d.seconds / 60)}:${String(d.seconds % 60).padStart(2, "0")}`;
  }

  async function openGameDay(eventId, info) {
    const s = state.season;
    let g;
    try { g = await api(`/api/season/${s.id}/game/${eventId}`); } catch (err) { toast(`Could not load the game: ${err.message}`, 3000); return; }
    if (!g.drives || !g.drives.some((d) => d.log && d.log.length)) { openBox(eventId); return; }
    gameday.g = g; gameday.eventId = eventId; gameday.moments = gdMoments(g); gameday.i = 0; gameday.speed = gdSpeed();
    clearTimeout(gameday.timer);
    const node = el("div", { class: "gameday" });
    gameday.node = node;
    const block = (side) => {
      const t = g[side];
      const mine = g[`${side}_slug`] === s.team;
      const parts = [el("div", { class: "gd-name" }, [teamPill(g[`${side}_slug`]), el("span", { text: t.name }), mine ? el("span", { class: "muted small-text", text: " (you)" }) : null]), el("div", { class: "gd-pts", id: `gd-${side}`, text: "0" })];
      return el("div", { class: `gd-team ${side}` }, side === "home" ? parts : parts.reverse());
    };
    node.append(
      el("div", { class: "gd-score" }, [block("away"), el("div", { class: "gd-clock" }, [el("div", { id: "gd-q", text: "Kickoff" }), el("div", { id: "gd-time", class: "muted small-text", text: "" })]), block("home")]),
      el("div", { id: "gd-situation", class: "gd-situation muted" }),
      gdFieldNode(g),
      el("div", { class: "gd-controls" }, [
        chipRow([["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"]], gameday.speed, (v) => { gameday.speed = v; try { localStorage.setItem("cfp.gameday.speed", v); } catch (e) {} }),
        (() => { const b = el("button", { type: "button", class: "ghost small", id: "gd-skip", text: "Skip to final" }); b.addEventListener("click", () => gdFinish(true)); return b; })(),
      ]),
      el("div", { class: "gd-current" }, [el("h4", { id: "gd-drive-title", text: "" }), el("ol", { id: "gd-plays", class: "gd-plays" })]),
      el("div", { class: "gd-scoring" }, [el("h4", { text: "Scoring" }), el("ul", { id: "gd-scores", class: "scoring-list" })]),
      el("div", { class: "gd-drives" }, [el("h4", { text: "Drives" }), el("ul", { id: "gd-drives", class: "gd-drive-list" })]),
    );
    for (const c of node.querySelectorAll(".gd-controls .chip")) c.dataset.v = c.dataset.v || c.textContent.trim().toLowerCase();
    const title = el("span", {}, [el("span", { class: "gd-live", text: "LIVE" }), ` ${g.away.name} at ${g.home.name}`, info && info.title ? el("span", { class: "muted small-text", text: ` · ${info.title}` }) : null]);
    openModal(title, node);
    gameday.layerNode = node.closest(".modal");
    gdStep();
  }

  function gdStep() {
    const { moments, g, node } = gameday;
    if (!node || !node.isConnected) { clearTimeout(gameday.timer); return; }
    if (gameday.i >= moments.length) { gdFinish(false); return; }
    const m = moments[gameday.i++];
    $("#gd-home").textContent = String(m.home); $("#gd-away").textContent = String(m.away);
    const qn = (q) => (q <= 4 ? `${ordinal(q)} quarter` : `Overtime${q > 5 ? " " + (q - 4) : ""}`);
    $("#gd-q").textContent = qn(m.quarter); $("#gd-time").textContent = m.clock || "";
    // the next snap's down and distance is the situation on the board
    const next = moments[gameday.i];
    $("#gd-situation").textContent = m.end ? "" : m.situation ? `${m.situation} · ${g[m.off].name} ball` : next && next.situation && next.drive === m.drive ? `${next.situation} · ${g[m.off].name} ball` : "";
    const d = g.drives[m.drive];
    if (d) $("#gd-drive-title").textContent = `Drive ${m.drive + 1} · ${d.offense_name}${d.quarter ? ` · ${qn(d.quarter)}` : ""}`;
    const list = $("#gd-plays");
    if (m.kind !== "drive-end") {
      if (list.dataset.drive !== String(m.drive)) { list.innerHTML = ""; list.dataset.drive = String(m.drive); }
      const li = el("li", { class: `gd-play ${m.big ? "big" : ""} ${m.score ? "score" : ""}` }, [
        el("span", { class: "gd-when muted small-text", text: `${m.clock || ""}${m.situation ? ` · ${m.situation}` : ""}` }),
        el("span", { class: "gd-text", text: m.text }),
        m.score && m.score.try ? el("span", { class: "muted small-text", text: ` (${m.score.try})` }) : null,
      ]);
      list.prepend(li);
      list.scrollTop = 0;
    } else {
      const d2 = g.drives[m.drive];
      const drives = $("#gd-drives");
      drives.prepend(el("li", {}, [teamPill(g[`${d2.offense}_slug`]), el("b", { text: d2.offense_name }), el("span", { class: "muted small-text", text: ` · ${m.text}` })]));
      drives.scrollTop = 0;
    }
    gdFieldUpdate(g, m, next);
    if (m.score) {
      const sc = m.score;
      $("#gd-scores").prepend(el("li", {}, [
        el("span", { class: "q", text: `${sc.quarter <= 4 ? `Q${sc.quarter}` : `OT${sc.quarter - 4}`} ${sc.clock}` }),
        el("span", { class: "kind", text: sc.points === 3 ? "FG" : sc.kind === "safety" ? "SAF" : "TD" }),
        el("span", { class: "desc" }, [`${sc.team_name}: ${sc.description || ""}`, sc.try ? el("span", { class: "try", text: ` (${sc.try})` }) : null]),
        el("span", { class: "running", html: `<b>${sc.away_score}</b> – <b>${sc.home_score}</b>` }),
      ]));
    }
    const pace = GD_PACE[gameday.speed] || GD_PACE.normal;
    const delay = m.end ? pace * 0.6 : m.big ? pace * 2 : m.kind === "kickoff" ? pace * 0.8 : pace;
    gameday.timer = setTimeout(gdStep, delay);
  }

  function gdFinish(skipped) {
    clearTimeout(gameday.timer);
    const { g, eventId, node } = gameday;
    if (!g) return;
    if (skipped || !node || !node.isConnected) { closeAllModals(); openBox(eventId); gameday.g = null; return; }
    $("#gd-home").textContent = String(g.home.score); $("#gd-away").textContent = String(g.away.score);
    $("#gd-q").textContent = g.overtime_periods ? `Final / ${g.overtime_periods}OT` : "Final"; $("#gd-time").textContent = "";
    $("#gd-situation").textContent = "";
    for (const id of ["gd-fd", "gd-gain"]) { const e = $(`#${id}`); if (e) e.hidden = true; }
    const skip = $("#gd-skip");
    if (skip) { skip.textContent = "Box score"; skip.classList.remove("ghost"); skip.classList.add("primary"); }
    const live = node.closest(".modal") && node.closest(".modal").querySelector(".gd-live");
    if (live) live.textContent = "FINAL";
  }

  // ----- wiring ------------------------------------------------------------

  $("#btn-new").addEventListener("click", newSeason);
  $("#btn-pause").addEventListener("click", pauseSim);
  $("#btn-seasons").addEventListener("click", () => setSidebar($("#btn-seasons").getAttribute("aria-pressed") !== "true"));
  $("#btn-clear-seasons").addEventListener("click", clearSeasons);
  $("#btn-hide-seasons").addEventListener("click", () => setSidebar(false));
  setSidebar(true, false);
  $("#btn-advance").addEventListener("click", () => advance());
  $("#btn-gameday").addEventListener("click", playGameDay);
  $("#btn-settings").addEventListener("click", openSettings);
  $("#btn-real-refresh").addEventListener("click", refreshReal);
  $("#btn-to-selection").addEventListener("click", () => advance(15));
  $("#btn-to-end").addEventListener("click", () => advance(20));
  $("#season-tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (b) { state.tab = b.dataset.tab; renderTab(); } });
  $("#poll-pills").addEventListener("click", (e) => { const b = e.target.closest("button[data-poll]"); if (b) { state.poll = b.dataset.poll; renderRankings(); } });
  $("#sbox-tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-btab]"); if (b) selectBoxTab(b.dataset.btab); });

  (async () => {
    try { await loadTeams(); } catch (err) { toast(`Teams unavailable: ${err.message}`, 4000); }
    await loadSeasons().catch(() => {});
    const id = REAL ? REAL_ID : new URLSearchParams(location.search).get("id");
    if (REAL) {
      document.body.classList.add("real-mode");
      $("#season-empty").querySelector("p").textContent = "Loading the real 2026 season…";
      const tabs = $("#season-tabs");
      for (const t of ["games", "schedule", "rankings", "standings", "stats", "awards", "bracket", "bowls"]) tabs.append(tabs.querySelector(`button[data-tab=${t}]`));
      tabs.querySelector("button[data-tab=schedule]").textContent = "Schedules";
      state.tab = "games";
    }
    for (const a of document.querySelectorAll(".site-nav a")) a.classList.toggle("active", a.dataset.nav === (REAL ? "real" : "season"));
    if (id) openSeason(id);
  })();
})();
