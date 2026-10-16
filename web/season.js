/* Season page: play a season week by week with polls, standings, the bracket and the playoff. */
(function () {
  "use strict";
  const { $, el, SBOX_IDS, teamPill, renderScoreboard, renderScoring, renderTeamStats, renderPlayers, renderDrives } = window.CFP;

  const state = { teams: [], season: null, viewWeek: null, tab: "games", poll: "ap", timer: null, standings: null };

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
    let group = null, groupName = null;
    for (const t of data.teams) {
      window.CFP.teamsBySlug[t.slug] = t;
      const g = t.fictional ? `${t.conference} (FCS)` : t.conference;
      if (g !== groupName) { groupName = g; group = el("optgroup", { label: g }); sel.appendChild(group); }
      if (!t.fictional) group.appendChild(el("option", { value: t.slug, text: `${t.name} (${t.ratings.overall.toFixed(0)})` }));
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
      history.replaceState(null, "", `/season?id=${s.id}`);
      showSeason(s);
      loadSeasons();
    } catch (err) { toast(`Could not open the season: ${err.message}`, 4000); }
  }

  // ----- advancing ---------------------------------------------------------

  async function advance(to) {
    const s = state.season;
    if (!s || s.done) return;
    // the highlighted week is the one Advance plays: a week further ahead sims through to it
    if (!to && state.viewWeek > s.current_week + 1) to = state.viewWeek;
    state.advanceFrom = s.current_week;
    setBusy(true);
    showProgress({ status: "running", done: s.current_week, total: to || s.current_week + 1, stage: "Starting", week: s.current_week + 1 });
    try {
      await api(`/api/season/${s.id}/advance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(to ? { to } : {}) });
      poll();
    } catch (err) { toast(`Could not advance: ${err.message}`, 4000); setBusy(false); }
  }

  function poll() {
    clearTimeout(state.timer);
    state.timer = setTimeout(async () => {
      try {
        const j = await api(`/api/season/${state.season.id}/status`);
        if (j.status === "running") {
          showProgress(j);
          poll();
        } else {
          if (j.status === "error") toast(`Simulation error: ${j.error}`, 6000);
          const s = await api(`/api/season/${state.season.id}`);
          state.viewWeek = s.current_week;
          showSeason(s);
          loadSeasons();
          setBusy(false);
        }
      } catch (err) { toast(err.message, 4000); setBusy(false); }
    }, 500);
  }

  function setBusy(b) {
    for (const id of ["btn-advance", "btn-to-selection", "btn-to-end"]) $(`#${id}`).disabled = b || (state.season && state.season.done);
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
    const opening = !state.season || state.season.id !== s.id;
    state.season = s;
    // no more games once the season is complete: the Summary tab takes the Games tab's place
    $("#season-tabs button[data-tab=games]").hidden = !!s.done;
    $("#season-tabs button[data-tab=summary]").hidden = !s.done;
    if (s.done && state.tab === "games") state.tab = "summary";
    if (!s.done && state.tab === "summary") state.tab = "games";
    if (opening) { depthState.team = null; depthState.data = null; }
    if (opening) applyTeamTheme(s.team);
    state.standings = null;
    if (opening && sidebarPreferred() !== "1") setSidebar(false, false);
    if (state.viewWeek == null || state.viewWeek > s.current_week) state.viewWeek = s.current_week;
    $("#season-empty").hidden = true;
    $("#season").hidden = false;
    const r = s.record;
    $("#season-title").innerHTML = "";
    $("#season-title").append(
      teamPill(s.team),
      s.team_name, el("span", { class: "rec", text: `${r.wins}-${r.losses}` }),
      el("span", { class: "muted", style: "font-size:14px;margin-left:8px", text: `${r.conf_wins}-${r.conf_losses} ${s.conference}` }),
    );
    const phase = s.done ? `Season complete · national champion: ${s.champion_name}` : s.current_week === 0 ? "Preseason" : `Through ${s.week_labels[s.current_week] || "week " + s.current_week}`;
    const simDate = simDateText(s);
    $("#season-meta").textContent = `${phase}${simDate ? ` · ${simDate}` : ""} · ${s.mode === "full" ? "full season simulated" : "real results through today"} · ${when(s.created_at)}`;
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
      const label = w === 0 ? "Pre" : w <= 13 ? `W${w}` : (s.week_labels[w] || `W${w}`).replace("Championship week", "CCG").replace("National championship", "Title").replace("Quarterfinals", "QF").replace("Semifinals", "SF").replace("First round", "R1").replace("Selection", "Sel");
      const next = !s.done && w === s.current_week + 1;
      const b = el("button", { type: "button", class: `week-chip ${w === state.viewWeek ? "active" : ""} ${w > s.current_week ? "future" : ""} ${w === s.current_week ? "current" : ""} ${next ? "next" : ""}`, text: label, title: `${s.week_labels[w] || (w === 0 ? "Preseason" : "")} · ${weekDateText(s, w)}` });
      b.addEventListener("click", () => { state.viewWeek = w; renderWeekStrip(); renderTab(); });
      strip.appendChild(b);
    }
    renderWeekDate();
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function parseDay(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
  function fmtDay(iso, withDay = true) { const d = parseDay(iso); return `${withDay ? DAYS[d.getDay()] + ", " : ""}${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; }

  function weekDateText(s, w) {
    const wd = s.week_dates && s.week_dates[w];
    if (!wd) return "";
    if (w === 0) return wd.end ? `preseason, through ${fmtDay(wd.end)}` : "preseason";
    if (wd.start === wd.end) return fmtDay(wd.end);
    const a = parseDay(wd.start), b = parseDay(wd.end);
    const span = a.getMonth() === b.getMonth() ? `${MONTHS[a.getMonth()]} ${a.getDate()}–${b.getDate()}, ${b.getFullYear()}` : `${MONTHS[a.getMonth()]} ${a.getDate()} – ${MONTHS[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
    return w <= 13 && wd.main ? `${fmtDay(wd.main)} (${span})` : span;
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
    if (s.done) btn.textContent = "Season complete";
    else if (w > s.current_week + 1) btn.textContent = `Sim to ${label}`;
    else btn.textContent = "Advance to next week";
  }

  function selectTab(name) {
    state.tab = name;
    for (const b of $("#season-tabs").querySelectorAll("button")) b.classList.toggle("active", b.dataset.tab === name);
    for (const t of ["games", "schedule", "standings", "rankings", "bracket", "bowls", "summary", "awards", "stats", "depth", "box"]) $(`#tab-${t}`).hidden = t !== name;
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
  const depthState = { team: null, data: null, key: null, unit: "" };

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
    const box = $("#tab-depth");
    box.innerHTML = "";
    const ds = depthState;
    if (ds.team === null) ds.team = s.team;
    const controls = el("div", { class: "stats-controls" });
    const confs = [...new Set(state.teams.filter((t) => !t.fictional).map((t) => t.conference))].sort();
    const teamSel = el("select", { "aria-label": "Team" }, state.teams.filter((t) => !t.fictional).map((t) => el("option", { value: t.slug, text: `${t.name} (${CONF_SHORT[t.conference] || t.conference})` })));
    teamSel.value = ds.team;
    teamSel.addEventListener("change", () => { ds.team = teamSel.value; renderDepthChart(); });
    const unitChips = el("div", { class: "view-chips" }, [["", "All"], ["Offense", "Offense"], ["Defense", "Defense"], ["Special teams", "Special teams"]].map(([v, label]) => {
      const b = el("button", { type: "button", class: `chip ${ds.unit === v ? "active" : ""}`, text: label });
      b.addEventListener("click", () => { ds.unit = v; renderDepthChart(); });
      return b;
    }));
    controls.append(teamSel, unitChips);
    box.append(controls);
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
    const note = el("div", { class: "stats-controls depth-note" }, [
      el("span", { class: "muted small-text", text: s.done ? "Season complete; the depth chart is read-only." : "▲ ▼ move a player one spot, ★ makes him the starter. Changes are saved with this season and used by every game from the next sim on." }),
      d.overridden && !s.done ? (() => { const b = el("button", { type: "button", class: "ghost small", text: "Reset to the original depth chart" }); b.addEventListener("click", () => { if (confirm(`Reset the ${d.name} depth chart to the original?`)) change({ reset: true }); }); return b; })() : null,
    ]);
    box.append(note);
    const r = d.ratings || {};
    box.append(el("div", { class: "roster-head" }, [
      teamPill(ds.team), el("b", { text: d.name }),
      el("span", { class: "muted", text: ` · ${d.conference} · ${d.head_coach || ""} · overall ${r.overall} (off ${r.offense}, def ${r.defense}, ST ${r.special_teams}) · ${d.roster_size} players` }),
    ]));
    for (const unit of d.units) {
      if (ds.unit && unit.name !== ds.unit) continue;
      box.append(el("h3", { text: unit.name }));
      const width = Math.max(2, ...unit.rows.map((row) => Math.min(row.players.length, unit.name === "Offense" && row.role === "WR" ? 5 : 3)));
      const table = el("table", { class: "stats depth-table" });
      table.append(el("tr", {}, [el("th", { text: "" }), ...Array.from({ length: width }, (_, i) => el("th", { class: "left", text: i === 0 ? "Starter" : ORD(i) }))]));
      for (const row of unit.rows) {
        const cells = [el("td", { class: "depth-role" }, [el("b", { text: row.role }), el("div", { class: "muted small-text", text: row.label })])];
        for (let i = 0; i < width; i++) {
          const p = row.players[i];
          if (!p) { cells.push(el("td", { class: "left muted", text: "" })); continue; }
          const ctl = s.done ? null : el("span", { class: "depth-ctl" }, [
            i > 0 ? (() => { const b = el("button", { type: "button", class: "ghost tiny", text: "★", title: "Make starter" }); b.addEventListener("click", () => change({ role: row.role, player: p.slug, move: "top" })); return b; })() : null,
            i > 0 ? (() => { const b = el("button", { type: "button", class: "ghost tiny", text: "▲", title: "Move up" }); b.addEventListener("click", () => change({ role: row.role, player: p.slug, move: "up" })); return b; })() : null,
            i < row.players.length - 1 && !["KR", "PR"].includes(row.role) ? (() => { const b = el("button", { type: "button", class: "ghost tiny", text: "▼", title: "Move down" }); b.addEventListener("click", () => change({ role: row.role, player: p.slug, move: "down" })); return b; })() : null,
          ]);
          cells.push(el("td", { class: `left depth-cell ${i === 0 ? "starter" : ""}` }, [
            el("div", { class: "name" }, [p.jersey ? el("span", { class: "muted", text: `#${p.jersey} ` }) : null, p.name, el("span", { class: "pos", text: `${p.class || ""}${p.position !== row.role ? " · " + p.position : ""}` }), ctl]),
            el("div", { class: "muted small-text", text: [`${p.overall} ovr`, p.height && p.weight ? `${p.height} ${p.weight}` : "", p.headline || (p.games ? `${p.games} games` : "")].filter(Boolean).join(" · ") }),
          ]));
        }
        table.append(el("tr", {}, cells));
      }
      box.append(el("div", { class: "table-scroll" }, [table]));
    }
  }



  // ----- season summary ------------------------------------------------------

  // ----- awards ------------------------------------------------------------

  const awardsState = { data: null, key: null, view: "mine", filter: "", sort: null, desc: true, conf: null, selector: "consensus",
                        level: 1, mineFilter: "" };
  const ORD = (i) => `${i + 1}${["st", "nd", "rd"][i] || "th"}`;
  // roster class codes (FR, FRRS, SO, ...) as "Fr.", "RS Fr.", ...
  const CLASS_LABEL = { FR: "Fr.", FRRS: "RS Fr.", SO: "So.", SORS: "RS So.", JR: "Jr.", JRRS: "RS Jr.", SR: "Sr.", SRRS: "RS Sr." };
  const classLabel = (cls) => (cls ? ` · ${CLASS_LABEL[cls] || cls}` : "");
  const OFFENSE_KINDS = new Set(["qb", "qb_upper", "rb", "wr", "te", "interior", "c", "ol", "ol_unit", "blocker", "opoy", "off_freshman"]);
  const DEFENSE_KINDS = new Set(["dpoy", "dpoy_alt", "lb", "db", "edge", "dl", "front", "def_freshman"]);
  const ST_KINDS = new Set(["k", "p", "rs", "stpoy", "versatile"]);

  function chipRow(items, current, onPick, cls = "") {
    const row = el("div", { class: `view-chips ${cls}` });
    for (const [value, label, title] of items) {
      const b = el("button", { type: "button", class: `chip ${current === value ? "active" : ""}`, text: label, title: title || label });
      b.addEventListener("click", () => onPick(value));
      row.append(b);
    }
    return row;
  }

  function who(c, withTeam = true) {
    // name, position/class, team pill
    const bits = [el("span", { class: "pill-inline", style: `background:${color(c.team)}` }), el("b", { text: c.name || c.coach || c.team_name })];
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
    const head = el("tr", {}, cols.map((c) => el("th", { class: `${c.sort ? "sortable" : ""} ${c.left ? "left" : ""} ${st.sort === c.key ? (st.desc ? "sorted-desc" : "sorted-asc") : ""}`, text: c.label, "data-key": c.sort ? c.key : "" })));
    head.addEventListener("click", (e) => { const th = e.target.closest("th[data-key]"); if (th && th.dataset.key) { if (st.sort === th.dataset.key) st.desc = !st.desc; else { st.sort = th.dataset.key; st.desc = true; } onSort(); } });
    table.append(head);
    let list = rows.slice();
    const sc = cols.find((c) => c.key === st.sort && c.sort);
    if (sc) list.sort((a, b) => { const av = sc.sort(a), bv = sc.sort(b); const r = typeof av === "string" ? av.localeCompare(bv) : av - bv; return st.desc ? -r : r; });
    for (const r of list) {
      table.append(el("tr", { class: rowClass ? rowClass(r) : "" }, cols.map((c) => { const v = c.get(r); return el("td", { class: c.left ? "left" : "" }, [v == null ? "" : v]); })));
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
      el("div", { class: "review-big" }, [el("span", { class: "pill-inline", style: `background:${color(w.team)}` }), w.name, el("span", { class: "pos", text: `${w.position}${classLabel(w.class)} · ${w.team_name}` })]),
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
      { key: "team", label: "Team", left: true, get: (c) => el("span", {}, [el("span", { class: "pill-inline", style: `background:${color(c.team)}` }), c.team_name]), sort: (c) => c.team_name },
      { key: "record", label: "Rec", get: (c) => c.record, sort: (c) => Number(c.record.split("-")[0]) - Number(c.record.split("-")[1]) / 100 },
      { key: "cfp", label: "Rank", get: (c) => (c.rank ? `#${c.rank}` : "–"), sort: (c) => -(c.rank || 99) },
      { key: "region", label: "Region", get: (c) => c.region, sort: (c) => c.region },
      { key: "first", label: "1st", get: (c) => String(c.first), sort: (c) => c.first },
      { key: "second", label: "2nd", get: (c) => String(c.second), sort: (c) => c.second },
      { key: "third", label: "3rd", get: (c) => String(c.third), sort: (c) => c.third },
      { key: "points", label: "Pts", get: (c) => el("b", { text: String(c.points) }), sort: (c) => c.points },
      { key: "line", label: "Season", left: true, get: (c) => el("span", { class: "muted small-text", text: c.line }) },
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
        el("span", { class: "who" }, [el("span", { class: "name" }, [el("span", { class: "pill-inline", style: `background:${color(c.team)}` }), c.name || c.coach || c.team_name, el("span", { class: "pos", text: c.position ? `${c.position}${classLabel(c.class)}` : (c.role || "") })]),
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
      { key: "team", label: "Team", left: true, get: (r) => el("span", {}, [el("span", { class: "pill-inline", style: `background:${color(r.w.team)}` }), r.w.team_name]), sort: (r) => r.w.team_name },
      { key: "conf", label: "Conference", left: true, get: (r) => r.w.conference || "", sort: (r) => r.w.conference || "" },
      { key: "line", label: "Season", left: true, get: (r) => el("span", { class: "muted small-text", text: r.w.line || coachLine(r.w) }) },
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
      { key: "team", label: "Team", left: true, get: (c) => el("span", {}, [el("span", { class: "pill-inline", style: `background:${color(c.team)}` }), c.team_name]), sort: (c) => c.team_name },
      { key: "conf", label: "Conference", left: true, get: (c) => c.conference, sort: (c) => c.conference },
      { key: "sel", label: "Selectors", get: (c) => (c.unanimous ? el("span", { class: "award-extra", text: "unanimous" }) : c.selectors ? `${c.selectors} of 5` : ""), sort: (c) => c.selectors || 0 },
      { key: "line", label: "Season", left: true, get: (c) => el("span", { class: "muted small-text", text: c.line }) },
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
                   ["allamerica", "All-America"], ["conference", "Conference awards"]].filter(([v]) => !(live && v === "allamerica"));
    if (live && st.view === "allamerica") st.view = "mine";
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
          { key: "team", label: "Team", left: true, get: (r) => el("span", {}, [el("span", { class: "pill-inline", style: `background:${color(r.w.team)}` }), r.w.team_name]), sort: (r) => r.w.team_name },
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
      { key: "stage", label: "Stage", left: true, get: (r) => r.stage, sort: (r) => r.stage },
      { key: "award", label: "Award", left: true, get: (r) => el("b", { text: r.award }), sort: (r) => r.award },
      { key: "who", label: "Who", left: true, get: (r) => el("span", { class: "name" }, [r.who, r.position ? el("span", { class: "pos", text: r.position }) : null]), sort: (r) => r.who || "" },
      { key: "result", label: "Result", left: true, get: (r) => el("span", { class: r.rank === 0 ? "win" : "", text: r.place }), sort: (r) => r.rank },
      { key: "line", label: "Season", left: true, get: (r) => el("span", { class: "muted small-text", text: r.line || "" }) },
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
        el("div", { class: "review-big" }, [el("span", { class: "pill-inline", style: `background:${color(w.team)}` }), w.name, el("span", { class: "pos", text: `${w.position} · ${w.team_name}` })]),
        el("div", { class: "muted small-text", text: `${w.line} · ${w.points} points, ${s.heisman.share}% of the possible points` }),
        el("div", { class: "muted small-text", text: `Finalists: ${s.heisman.finalists.map((f) => `${f.name} (${f.team_name}, ${f.points})`).join(", ")}` }),
      ]);
      card.classList.add("clickable");
      card.addEventListener("click", () => { state.tab = "awards"; awardsState.view = "heisman"; renderTab(); });
      box.append(card);
    }

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
      const roundLabel = { 16: "First round", 17: "Quarterfinal", 18: "Semifinal", 19: "Final" };
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
      const wk = (w) => (w <= 13 ? `Week ${w}` : (s.week_labels[w] || `week ${w}`).toLowerCase().replace("championship week", "championship week").replace("selection", "selection day"));
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
    controls.append(sortSel, confSel, mineBtn);
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

    const groups = { 16: "Early bowls (Dec 15-24)", 17: "Holiday week (Dec 26-31)", 18: "New Year's bowls (Jan 2)" };
    const rankWeek = (b) => (b.projected ? (s.current_week || 14) : 14);
    const side = (slug, name, record, won, b) => el("span", { class: won ? "win" : "" }, [teamPill(slug), rankTag(slug, rankWeek(b)), name, record ? el("span", { class: "muted small-text", text: ` (${record})` }) : null]);
    const card = (b) => {
      const played = b.played;
      const aw = played && b.away_score > b.home_score, hw = played && b.home_score > b.away_score;
      const c = el("div", { class: `bowl-card ${b.mine ? "mine" : ""} ${b.has_box ? "clickable" : ""}` });
      c.append(el("div", { class: "bowl-head" }, [
        el("b", { text: b.name }), el("span", { class: "muted small-text", text: ` ${b.date}${b.time ? " · " + b.time : ""} · ${b.site || ""}` }),
      ]));
      if (b.unfilled) {
        c.append(el("div", { class: "muted", text: "No eligible teams left for this bowl." }));
      } else {
        c.append(el("div", { class: "bowl-match" }, [
          side(b.away, b.away_name, b.away_record, aw, b), played ? el("b", { text: ` ${b.away_score}` }) : null,
          el("span", { class: "muted", text: " vs " }),
          side(b.home, b.home_name, b.home_record, hw, b), played ? el("b", { text: ` ${b.home_score}` }) : null,
        ]));
      }
      // the tie-ins explain a projection; once the matchups are set the card is just the game
      if (b.projected && b.tie_ins && b.tie_ins.length) c.append(el("div", { class: "muted small-text", text: `Tie-ins: ${b.tie_ins.join(" vs ")}` }));
      if (b.has_box) c.addEventListener("click", () => openBox(b.event_id));
      return c;
    };
    if (bowlsState.sort === "date") {
      for (const w of [16, 17, 18]) {
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

  async function renderGames() {
    const s = state.season, w = state.viewWeek;
    const box = $("#tab-games");
    box.innerHTML = "";
    if (w === 0) { box.append(el("p", { class: "muted", text: "Preseason. Advance a week to play games." })); return; }
    let data;
    try { data = await api(`/api/season/${s.id}/week/${w}`); } catch (err) { box.append(el("p", { class: "muted", text: err.message })); return; }
    const label = s.week_labels[w] || `Week ${w}`;
    box.append(el("h3", { text: `${label} · ${data.games.length} games` }));
    if (!data.games.length) { box.append(el("p", { class: "muted", text: w > s.current_week ? "Not played yet." : "No games this week." })); return; }
    const table = el("table", { class: "stats games-table" });
    for (const g of data.games) {
      const played = g.played;
      const hw = played && g.home_score > g.away_score, aw = played && g.away_score > g.home_score;
      const rk = (r) => (r ? el("span", { class: "rank", text: `#${r} ` }) : null);
      const tr = el("tr", { class: `${g.mine ? "mine" : ""} ${g.has_box ? "clickable" : ""}` }, [
        el("td", { class: "muted small-text" }, [g.title || (g.neutral ? "neutral" : ""), g.site ? el("div", { class: "muted", style: "font-size:10px", text: g.site }) : null]),
        el("td", { style: "text-align:left", class: aw ? "win" : "" }, [rk(g.away_rank), g.away_display]),
        el("td", { text: played ? String(g.away_score) : "" }),
        el("td", { class: "muted", text: g.neutral ? "vs" : "at" }),
        el("td", { style: "text-align:left", class: hw ? "win" : "" }, [rk(g.home_rank), g.home_display]),
        el("td", { text: played ? String(g.home_score) : "" }),
        el("td", { class: "muted small-text", text: played ? (g.overtime ? `OT${g.overtime > 1 ? g.overtime : ""}` : g.real ? "real" : "") : "" }),
      ]);
      if (g.has_box) tr.addEventListener("click", () => openBox(g.event_id));
      table.appendChild(tr);
    }
    box.appendChild(table);
  }

  function renderSchedule() {
    const s = state.season;
    const box = $("#tab-schedule");
    box.innerHTML = "";
    const table = el("table", { class: "stats" });
    table.appendChild(el("tr", {}, ["Week", "Rank", "Opponent", "Where", "Result", "Score", ""].map((h) => el("th", { text: h, style: h === "Opponent" ? "text-align:left" : "" }))));
    for (const g of s.schedule) {
      const prefix = g.venue === "away" ? "at" : g.venue === "neutral" ? "vs" : "vs";
      const oppRank = g.opponent_rank ? el("span", { class: "rank", text: `#${g.opponent_rank} ` }) : null;
      const tr = el("tr", { class: g.has_box ? "clickable" : "" }, [
        el("td", { text: s.week_labels[g.week] && g.week > 13 ? s.week_labels[g.week] : String(g.week) }),
        el("td", { class: "muted", text: g.my_rank ? `#${g.my_rank}` : "" , title: "Your AP rank entering the game" }),
        el("td", { style: "text-align:left" }, [`${prefix} `, oppRank, `${g.opponent_name}${g.title ? ` · ${g.title}` : ""}`, g.site ? el("div", { class: "muted", style: "font-size:11px", text: g.site }) : null]),
        el("td", { text: g.venue === "home" ? "Home" : g.venue === "away" ? "Away" : "Neutral" }),
        el("td", { class: g.played ? (g.won ? "win" : "loss") : "muted", text: g.played ? (g.won ? "W" : "L") : "—" }),
        el("td", { text: g.played ? `${g.points_for}–${g.points_against}${g.overtime ? " OT" : ""}` : "" }),
        el("td", { class: "muted", text: g.real ? "real result" : g.has_box ? "box score" : "" }),
      ]);
      if (g.has_box) tr.addEventListener("click", () => openBox(g.event_id));
      table.appendChild(tr);
    }
    box.appendChild(table);
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
      b.addEventListener("click", () => onPick(value));
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
    if (ps.team === null) ps.team = s.team;
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
            el("span", { class: "name" }, [p.name, el("span", { class: "pos", text: p.position })]),
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
    const table = el("table", { class: "stats" });
    const head = el("tr", {}, [el("th", { text: "#" }), el("th", { class: "left", text: "Player" }), ps.team ? null : el("th", { class: "left", text: "Team" }), el("th", { text: "G" }),
      ...cols.map((c) => el("th", { class: c[2] ? `sortable ${c[2] === sortKey ? (asc ? "sorted-asc" : "sorted-desc") : ""}` : "", text: c[0], "data-key": c[2] || "", title: c[3] || c[0] }))]);
    head.addEventListener("click", (e) => { const th = e.target.closest("th[data-key]"); if (th && th.dataset.key) { ps.sort = th.dataset.key; renderSeasonPlayerStats(); } });
    table.append(head);
    players.forEach((p, i) => {
      table.append(el("tr", {}, [
        el("td", { class: "muted", text: String(i + 1) }),
        el("td", { class: "name" }, [p.name, el("span", { class: "pos", text: p.position })]),
        ps.team ? null : el("td", { class: "left" }, [teamPill(p.team), p.team_name]),
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
      el("span", { class: "muted", text: ` · ${t.conference} · ${t.head_coach} · overall ${r.overall} (off ${r.offense}, def ${r.defense}, ST ${r.special_teams})` }),
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
            el("span", { class: "name" }, [p.name, p.class ? el("span", { class: "pos", text: p.class }) : null]),
            el("span", { class: "muted small-text", text: [p.starter ? (p.role && p.role !== p.position ? `starter · ${p.role}` : "starter") : (p.role && p.role !== p.position ? p.role : ""), p.height && p.weight ? `${p.height} ${p.weight}` : ""].filter(Boolean).join(" · ") }),
          ]),
          el("span", { class: "value", text: String(p.overall) }),
        ]));
      });
      grid.append(card);
    }
    box.append(grid);
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
      table.appendChild(el("tr", {}, ["#", division || "Team", "Conf", "Overall", "PF", "PA"].map((h) => el("th", { text: h, class: h === (division || "Team") ? "left" : "" }))));
      for (const t of rows) {
        table.appendChild(el("tr", { class: t.slug === s.team ? "mine" : "" }, [
          el("td", { text: String(t.conf_rank), title: t.tiebreak ? `Tied on conference record; placed by ${t.tiebreak}` : "" }),
          el("td", { class: "name left" }, [teamPill(t.slug), t.name, ...crownOf(t), t.ap_rank || t.cfp_rank ? el("span", { class: "pos", text: t.cfp_rank ? `CFP ${t.cfp_rank}` : `#${t.ap_rank}` }) : null]),
          el("td", { text: `${t.conf_wins}-${t.conf_losses}` }), el("td", { text: `${t.wins}-${t.losses}` }),
          el("td", { text: String(t.points_for) }), el("td", { text: String(t.points_against) }),
        ]));
      }
      return table;
    };

    const fullTable = (rows, division) => {
      const table = el("table", { class: "stats standings-full" });
      const heads = ["#", division || "Team", "Conf", "Overall", "Home", "Away", "PF", "PA", "Diff", "Streak", "Last game"];
      table.appendChild(el("tr", {}, heads.map((h) => el("th", { text: h, class: [division || "Team", "Last game"].includes(h) ? "left" : "" }))));
      for (const t of rows) {
        const last = t.last ? `${t.last.won ? "W" : "L"} ${t.last.score} ${t.last.venue === "home" ? "vs" : t.last.venue === "away" ? "at" : "vs"} ${t.last.opponent_name}` : "–";
        table.appendChild(el("tr", { class: t.slug === s.team ? "mine" : "" }, [
          el("td", { text: String(t.conf_rank), title: t.tiebreak ? `Tied on conference record; placed by ${t.tiebreak}` : "" }),
          el("td", { class: "name left" }, [teamPill(t.slug), t.name, ...crownOf(t), rankBadge(t)]),
          el("td", { text: `${t.conf_wins}-${t.conf_losses}` }), el("td", { text: `${t.wins}-${t.losses}` }),
          el("td", { text: `${t.home_wins}-${t.home_losses}` }), el("td", { text: `${t.away_wins}-${t.away_losses}` }),
          el("td", { text: String(t.points_for) }), el("td", { text: String(t.points_against) }),
          el("td", { class: t.points_for > t.points_against ? "win" : t.points_for < t.points_against ? "loss" : "", text: diff(t) }),
          el("td", { class: t.streak > 0 ? "win" : t.streak < 0 ? "loss" : "muted", text: t.streak > 0 ? `W${t.streak}` : t.streak < 0 ? `L${-t.streak}` : "–" }),
          el("td", { class: `left ${t.last ? (t.last.won ? "" : "muted") : "muted"}`, text: last }),
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
    table.appendChild(el("tr", {}, heads.map((h) => el("th", { text: h, style: ["Team", "Conference"].includes(h) ? "text-align:left" : "", title: h === "Pts" ? "Poll points: 25 for a first-place vote down to 1 for 25th" : "" }))));
    for (const e of list) {
      const move = e.previous == null ? "new" : e.previous === e.rank ? "–" : e.previous > e.rank ? `▲${e.previous - e.rank}` : `▼${e.rank - e.previous}`;
      const nameCell = el("td", { style: "text-align:left", class: "name" }, [teamPill(e.team), e.name]);
      if (voted && e.first_place) nameCell.append(el("span", { class: "fpv", text: ` (${e.first_place})`, title: `${e.first_place} first-place vote${e.first_place === 1 ? "" : "s"}` }));
      table.appendChild(el("tr", { class: e.team === s.team ? "mine" : "" }, [
        el("td", { text: String(e.rank) }),
        nameCell,
        el("td", { text: e.record }),
        voted ? el("td", { text: String(e.points) }) : null,
        el("td", { style: "text-align:left", class: "muted", text: e.conference }),
        el("td", { class: "muted", text: e.previous == null ? "NR" : String(e.previous) }),
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
    { name: "First round", week: 16, games: [["cfp-r1-8", 8, 9], ["cfp-r1-5", 5, 12], ["cfp-r1-7", 7, 10], ["cfp-r1-6", 6, 11]] },
    { name: "Quarterfinals", week: 17, games: [["cfp-qf-1", 1, "8/9"], ["cfp-qf-4", 4, "5/12"], ["cfp-qf-2", 2, "7/10"], ["cfp-qf-3", 3, "6/11"]] },
    { name: "Semifinals", week: 18, games: [["cfp-sf-1", "QF1", "QF4"], ["cfp-sf-2", "QF2", "QF3"]] },
    { name: "National championship", week: 19, games: [["cfp-final", "SF1", "SF2"]] },
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
    if (s.done) box.append(el("div", { class: "champ-banner", text: `National champion: ${s.champion_name}` }));
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
    table.appendChild(el("tr", {}, ["Seed", "Team", "Rank", "Bid", ""].map((h) => el("th", { class: ["Team", "Bid"].includes(h) ? "left" : "", text: h }))));
    for (let i = 1; i <= 12; i++) {
      const x = seeds[i];
      if (!x) continue;
      table.appendChild(el("tr", { class: x.team === s.team ? "mine" : "" }, [
        el("td", { text: String(i) }),
        el("td", { class: "left name" }, [teamPill(x.team), x.name]),
        el("td", { text: pos[x.team] ? String(pos[x.team]) : "NR" }),
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
            team ? el("span", { class: "pill-inline", style: `background:${color(team)}` }) : el("span", { class: "pill-inline empty" }),
            el("span", { class: "bmatch-name" }, [text, team && rankAt(team, 14) ? el("span", { class: "rank muted", text: ` #${rankAt(team, projected ? (s.current_week || 14) : 14)}` }) : null]),
            el("b", { class: "bmatch-score", text: score == null ? "" : String(score) }),
          ])),
          el("div", { class: "muted small-text bmatch-note", text: note + (g && g.overtime ? ` · ${g.overtime > 1 ? g.overtime : ""}OT` : "") }),
        ]);
        if (g && g.has_box) card.addEventListener("click", () => openBox(g.event_id));
        col.append(card);
      }
      tree.append(col);
    });
    return tree;
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
      renderScoreboard(g, SBOX_IDS); renderScoring(g, SBOX_IDS); renderTeamStats(g, SBOX_IDS);
      renderPlayers(g.home, $("#sbox-home")); renderPlayers(g.away, $("#sbox-away")); renderDrives(g, SBOX_IDS);
      $("#season-tabs button[data-tab='box']").hidden = false;
      selectTab("box");
      selectBoxTab("scoring");
      window.scrollTo({ top: 0 });
    } catch (err) { toast(`Could not load that game: ${err.message}`, 3000); }
  }
  function selectBoxTab(name) {
    for (const b of $("#sbox-tabs").querySelectorAll("button")) b.classList.toggle("active", b.dataset.btab === name);
    for (const t of ["scoring", "team", "home", "away", "drives"]) $(`#sbox-${t}`).hidden = t !== name;
  }

  // ----- wiring ------------------------------------------------------------

  $("#btn-new").addEventListener("click", newSeason);
  $("#btn-seasons").addEventListener("click", () => setSidebar($("#btn-seasons").getAttribute("aria-pressed") !== "true"));
  $("#btn-clear-seasons").addEventListener("click", clearSeasons);
  $("#btn-hide-seasons").addEventListener("click", () => setSidebar(false));
  setSidebar(true, false);
  $("#btn-advance").addEventListener("click", () => advance());
  $("#btn-to-selection").addEventListener("click", () => advance(14));
  $("#btn-to-end").addEventListener("click", () => advance(19));
  $("#season-tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (b) { state.tab = b.dataset.tab; renderTab(); } });
  $("#poll-pills").addEventListener("click", (e) => { const b = e.target.closest("button[data-poll]"); if (b) { state.poll = b.dataset.poll; renderRankings(); } });
  $("#sbox-tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-btab]"); if (b) selectBoxTab(b.dataset.btab); });

  (async () => {
    try { await loadTeams(); } catch (err) { toast(`Teams unavailable: ${err.message}`, 4000); }
    await loadSeasons().catch(() => {});
    const id = new URLSearchParams(location.search).get("id");
    if (id) openSeason(id);
  })();
})();
