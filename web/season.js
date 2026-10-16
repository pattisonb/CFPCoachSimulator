/* Season page: play a season week by week with polls, standings, the bracket and the playoff. */
(function () {
  "use strict";
  const { $, el, SBOX_IDS, teamPill, renderScoreboard, renderScoring, renderTeamStats, renderPlayers, renderDrives } = window.CFP;

  const state = { teams: [], season: null, viewWeek: null, tab: "games", timer: null, standings: null };

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

  function showSeason(s) {
    const opening = !state.season || state.season.id !== s.id;
    state.season = s;
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
    for (const t of ["games", "schedule", "standings", "ap", "cfp", "bracket", "bowls", "summary", "teamstats", "playerstats", "box"]) $(`#tab-${t}`).hidden = t !== name;
  }

  function renderTab() {
    selectTab(state.tab);
    const t = state.tab;
    if (t === "games") renderGames();
    else if (t === "schedule") renderSchedule();
    else if (t === "standings") renderStandings();
    else if (t === "ap") renderPoll("ap");
    else if (t === "cfp") renderPoll("cfp");
    else if (t === "bracket") renderBracket();
    else if (t === "bowls") renderBowls();
    else if (t === "summary") renderSummary();
    else if (t === "teamstats") renderSeasonTeamStats();
    else if (t === "playerstats") renderSeasonPlayerStats();
  }

  // ----- season summary ------------------------------------------------------

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

  function renderBowls() {
    const s = state.season;
    const box = $("#tab-bowls");
    box.innerHTML = "";
    box.append(el("h3", { text: "Bowl season 2026-27" }));
    if (!s.bowls || !s.bowls.length) {
      box.append(el("p", { class: "muted", text: "Bowl matchups are set on selection day (after championship week), once the playoff field is known. Teams with six wins are eligible; bowls pick from their tie-in conferences in payout order." }));
      return;
    }
    const groups = { 16: "Early bowls (Dec 15-24)", 17: "Holiday week (Dec 26-31)", 18: "New Year's bowls (Jan 2)" };
    for (const w of [16, 17, 18]) {
      const rows = s.bowls.filter((b) => b.week === w);
      if (!rows.length) continue;
      box.append(el("h3", { text: groups[w] }));
      for (const b of rows) {
        const played = b.played;
        const aw = played && b.away_score > b.home_score, hw = played && b.home_score > b.away_score;
        const card = el("div", { class: `bowl-card ${b.mine ? "mine" : ""} ${b.has_box ? "clickable" : ""}` });
        card.append(el("div", { class: "bowl-head" }, [
          el("b", { text: b.name }), el("span", { class: "muted small-text", text: ` ${b.date}${b.time ? " · " + b.time : ""} · ${b.site || ""}` }),
        ]));
        if (b.unfilled) {
          card.append(el("div", { class: "muted", text: "No eligible teams left for this bowl." }));
        } else {
          card.append(el("div", { class: "bowl-match" }, [
            el("span", { class: aw ? "win" : "" }, [teamPill(b.away), b.away_name, played ? el("b", { text: ` ${b.away_score}` }) : null]),
            el("span", { class: "muted", text: " vs " }),
            el("span", { class: hw ? "win" : "" }, [teamPill(b.home), b.home_name, played ? el("b", { text: ` ${b.home_score}` }) : null]),
          ]));
        }
        const bits = [];
        if (b.tie_ins && b.tie_ins.length) bits.push(`Tie-ins: ${b.tie_ins.join(" vs ")}`);
        if (b.games_played) bits.push(`${b.games_played} editions${b.first_played ? ` since ${b.first_played}` : ""}`);
        else if (b.first_played) bits.push(`First played ${b.first_played}`);
        if (b.most_appearances && b.most_appearances.length) bits.push("Most appearances: " + b.most_appearances.map((a) => `${a.team} (${a.games}, ${a.wins}-${a.games - a.wins})`).join(", "));
        if (b.recent && b.recent.length) bits.push("Recent: " + b.recent.map((r) => `${r.season || r.year} ${r.winner}${r.winner_score != null ? " " + r.winner_score : ""} over ${r.loser}${r.loser_score != null ? " " + r.loser_score : ""}`).join("; "));
        if (b.previous_tie_ins && b.previous_tie_ins.length) bits.push(`Previous tie-ins: ${b.previous_tie_ins.join(", ")}`);
        card.append(el("div", { class: "muted small-text", text: bits.join(" · ") }));
        if (b.has_box) card.addEventListener("click", () => openBox(b.event_id));
        box.append(card);
      }
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
    ["Opp 3rd%", "opp_third_pct", 1], ["Sacks", "sacks", 0], ["Takeaways", "takeaways", 0],
  ];
  const LOWER_BETTER = new Set(["opp_ppg", "turnovers", "sacks_allowed", "penalties_pg", "opp_ypg", "opp_pass_ypg", "opp_rush_ypg", "opp_ypp", "opp_third_pct"]);
  const teamStatsState = { rows: null, sort: "margin", desc: true, conf: "", fbs: true };

  function fmtStat(v, digits) {
    if (digits === "time") return window.CFP.fmtTime(Math.round(v));
    return Number(v).toFixed(digits);
  }

  function statsNote(partial) {
    return partial ? "This season was started before season-long stats were kept, so only your own games are counted. " : "";
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
    const confSel = el("select", { "aria-label": "Conference" }, [el("option", { value: "", text: "All conferences" }), ...confs.map((c) => el("option", { value: c, text: c }))]);
    confSel.value = teamStatsState.conf;
    confSel.addEventListener("change", () => { teamStatsState.conf = confSel.value; renderSeasonTeamStats(); });
    controls.append(confSel);
    const note = el("span", { class: "muted small-text", text: `${statsNote(teamStatsState.partial)}Per-game averages over simulated games through ${s.week_labels[s.current_week] || "week " + s.current_week}. Click a column to sort.` });
    controls.append(note);
    box.append(controls);

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

  const PLAYER_COLS = {
    passing: [["C/ATT", (p) => `${p.stats.completions}/${p.stats.pass_attempts}`], ["Pct", (p) => p.stats.pass_attempts ? Math.round(100 * p.stats.completions / p.stats.pass_attempts) : "–"],
      ["Yds", (p) => p.stats.pass_yards, "pass_yards"], ["Yds/G", (p) => (p.stats.pass_yards / p.games).toFixed(1)], ["Y/A", (p) => p.stats.pass_attempts ? (p.stats.pass_yards / p.stats.pass_attempts).toFixed(1) : "–"],
      ["TD", (p) => p.stats.passing_touchdowns, "passing_touchdowns"], ["INT", (p) => p.stats.interceptions_thrown, "interceptions_thrown"], ["Sacked", (p) => p.stats.sacks_taken]],
    rushing: [["Car", (p) => p.stats.carries, "carries"], ["Yds", (p) => p.stats.rush_yards, "rush_yards"], ["Yds/G", (p) => (p.stats.rush_yards / p.games).toFixed(1)],
      ["Avg", (p) => p.stats.carries ? (p.stats.rush_yards / p.stats.carries).toFixed(1) : "–"], ["TD", (p) => p.stats.rushing_touchdowns, "rushing_touchdowns"], ["Fum", (p) => p.stats.fumbles]],
    receiving: [["Tgt", (p) => p.stats.targets], ["Rec", (p) => p.stats.receptions, "receptions"], ["Yds", (p) => p.stats.receiving_yards, "receiving_yards"], ["Yds/G", (p) => (p.stats.receiving_yards / p.games).toFixed(1)],
      ["Avg", (p) => p.stats.receptions ? (p.stats.receiving_yards / p.stats.receptions).toFixed(1) : "–"], ["TD", (p) => p.stats.receiving_touchdowns, "receiving_touchdowns"]],
    defense: [["Solo", (p) => p.stats.solo_tackles, "solo_tackles"], ["Ast", (p) => p.stats.assisted_tackles], ["Tot", (p) => p.stats.solo_tackles + p.stats.assisted_tackles, "total"],
      ["Sacks", (p) => p.stats.sacks, "sacks"], ["INT", (p) => p.stats.interceptions, "interceptions"], ["INT Yds", (p) => p.stats.interception_return_yards],
      ["FF", (p) => p.stats.forced_fumbles, "forced_fumbles"], ["FR", (p) => p.stats.fumble_recoveries], ["TD", (p) => p.stats.defensive_touchdowns]],
    kicking: [["FG", (p) => `${p.stats.fg_made}/${p.stats.fg_attempted}`, "fg_made"], ["FG%", (p) => p.stats.fg_attempted ? Math.round(100 * p.stats.fg_made / p.stats.fg_attempted) : "–"],
      ["PAT", (p) => `${p.stats.pat_made}/${p.stats.pat_attempts}`], ["Pts", (p) => p.stats.fg_made * 3 + p.stats.pat_made, "points"]],
    punting: [["Punts", (p) => p.stats.punts, "punts"], ["Yds", (p) => p.stats.punt_yards], ["Avg", (p) => p.stats.punts ? (p.stats.punt_yards / p.stats.punts).toFixed(1) : "–"]],
    returns: [["KR", (p) => p.stats.kickoff_returns], ["KR Yds", (p) => p.stats.kickoff_return_yards, "kickoff_return_yards"], ["KR Avg", (p) => p.stats.kickoff_returns ? (p.stats.kickoff_return_yards / p.stats.kickoff_returns).toFixed(1) : "–"],
      ["PR", (p) => p.stats.punt_returns], ["PR Yds", (p) => p.stats.punt_return_yards, "punt_return_yards"], ["TD", (p) => p.stats.kickoff_return_touchdowns + p.stats.punt_return_touchdowns]],
  };
  const playerStatsState = { team: null, cat: "passing", sort: null, data: null };

  async function renderSeasonPlayerStats() {
    const s = state.season;
    const box = $("#tab-playerstats");
    box.innerHTML = "";
    if (playerStatsState.team === null) playerStatsState.team = s.team;
    const ps = playerStatsState;
    const controls = el("div", { class: "stats-controls" });
    const teamSel = el("select", { "aria-label": "Team" }, [el("option", { value: "", text: "All teams (leaders)" }),
      ...state.teams.filter((t) => !t.fictional).map((t) => el("option", { value: t.slug, text: t.name }))]);
    teamSel.value = ps.team;
    teamSel.addEventListener("change", () => { ps.team = teamSel.value; ps.data = null; ps.sort = null; renderSeasonPlayerStats(); });
    const catSel = el("select", { "aria-label": "Category" }, Object.keys(PLAYER_COLS).map((c) => el("option", { value: c, text: c[0].toUpperCase() + c.slice(1) })));
    catSel.value = ps.cat;
    catSel.addEventListener("change", () => { ps.cat = catSel.value; ps.data = null; ps.sort = null; renderSeasonPlayerStats(); });
    controls.append(teamSel, catSel);
    box.append(controls);
    const key = `${s.id}|${s.current_week}|${ps.team}|${ps.cat}`;
    if (!ps.data || ps.data.key !== key) {
      try {
        const j = await api(`/api/season/${s.id}/stats/players?cat=${ps.cat}${ps.team ? `&team=${ps.team}` : ""}`);
        ps.data = { key, players: j.players, partial: j.partial };
      } catch (err) { box.append(el("p", { class: "muted", text: err.message })); return; }
    }
    const cols = PLAYER_COLS[ps.cat];
    const players = ps.data.players.slice();
    if (!players.length) { box.append(el("p", { class: "muted", text: "No stats in this category yet." })); return; }
    box.append(el("p", { class: "muted small-text", text: `${statsNote(ps.data.partial)}Season totals over simulated games through ${s.week_labels[s.current_week] || "week " + s.current_week}${ps.team ? "" : " · top 100"}. Click a column to sort.` }));
    const sortKey = ps.sort || cols.find((c) => c[2])[2];
    const val = (p, c) => { const v = c[1](p); return typeof v === "number" ? v : parseFloat(v) || 0; };
    const sortCol = cols.find((c) => c[2] === sortKey) || cols.find((c) => c[2]);
    players.sort((a, b) => val(b, sortCol) - val(a, sortCol) || a.name.localeCompare(b.name));
    const table = el("table", { class: "stats" });
    const head = el("tr", {}, [el("th", { text: "#" }), el("th", { class: "left", text: "Player" }), ps.team ? null : el("th", { class: "left", text: "Team" }), el("th", { text: "G" }),
      ...cols.map((c) => el("th", { class: c[2] ? `sortable ${c[2] === sortKey ? "sorted-desc" : ""}` : "", text: c[0], "data-key": c[2] || "" }))]);
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

  async function renderStandings() {
    const s = state.season;
    const box = $("#tab-standings");
    box.innerHTML = "";
    if (!state.standings) {
      try { state.standings = (await api(`/api/season/${s.id}/standings`)).standings; } catch (err) { box.append(el("p", { class: "muted", text: err.message })); return; }
    }
    const confs = Object.keys(state.standings).sort((a, b) => (a === s.conference ? -1 : b === s.conference ? 1 : a.localeCompare(b)));
    const grid = el("div", { class: "conf-grid" });
    const standingsTable = (rows, division) => {
      const table = el("table", { class: "stats" });
      table.appendChild(el("tr", {}, ["#", division || "Team", "Conf", "Overall", "PF", "PA"].map((h) => el("th", { text: h, style: h === (division || "Team") ? "text-align:left" : "" }))));
      for (const t of rows) {
        table.appendChild(el("tr", { class: t.slug === s.team ? "mine" : "" }, [
          el("td", { text: String(t.conf_rank), title: t.tiebreak ? `Tied on conference record; placed by ${t.tiebreak}` : "" }),
          el("td", { style: "text-align:left", class: "name" }, [t.name,
            t.champion ? el("span", { class: "crown", text: "👑", title: "Conference champion", "aria-label": "Conference champion" }) : null,
            t.runner_up ? el("span", { class: "crown", text: "🥈", title: "Lost the conference championship game", "aria-label": "Conference runner-up" }) : null]),
          el("td", { text: `${t.conf_wins}-${t.conf_losses}` }), el("td", { text: `${t.wins}-${t.losses}` }),
          el("td", { text: String(t.points_for) }), el("td", { text: String(t.points_against) }),
        ]));
      }
      return table;
    };
    for (const conf of confs) {
      const rows = state.standings[conf];
      const divisions = [...new Set(rows.map((t) => t.division).filter(Boolean))];
      const tables = divisions.length ? divisions.map((d) => standingsTable(rows.filter((t) => t.division === d), d)) : [standingsTable(rows, null)];
      grid.appendChild(el("div", { class: "conf-block" }, [el("h3", { text: conf }), ...tables]));
    }
    box.appendChild(grid);
  }

  function renderPoll(kind) {
    const s = state.season;
    const box = $(`#tab-${kind}`);
    box.innerHTML = "";
    const w = pollWeekFor(state.viewWeek);
    const entry = s.polls[String(w)] || {};
    const list = entry[kind];
    const title = kind === "ap" ? "AP Top 25" : "College Football Playoff rankings";
    if (!list) {
      const note = kind === "cfp"
        ? `The committee's first ranking comes out after week ${s.cfp_weeks[0]} (Nov 3, 2026), then weekly through selection day.`
        : "No poll for this week.";
      box.append(el("h3", { text: title }), el("p", { class: "muted", text: note }));
      return;
    }
    box.append(el("h3", { text: `${title} · ${w === 0 ? "preseason" : `after ${s.week_labels[w] || "week " + w}`}` }));
    if (kind === "cfp" && w >= 14) box.append(el("p", { class: "muted small-text", text: "Final ranking: this is the one the bracket is built from." }));
    const table = el("table", { class: "stats" });
    table.appendChild(el("tr", {}, ["#", "Team", "Record", "Conference", "Prev", ""].map((h) => el("th", { text: h, style: ["Team", "Conference"].includes(h) ? "text-align:left" : "" }))));
    for (const e of list) {
      const move = e.previous == null ? "new" : e.previous === e.rank ? "–" : e.previous > e.rank ? `▲${e.previous - e.rank}` : `▼${e.rank - e.previous}`;
      table.appendChild(el("tr", { class: e.team === s.team ? "mine" : "" }, [
        el("td", { text: String(e.rank) }),
        el("td", { style: "text-align:left", class: "name" }, [teamPill(e.team), e.name]),
        el("td", { text: e.record }), el("td", { style: "text-align:left", class: "muted", text: e.conference }),
        el("td", { class: "muted", text: e.previous == null ? "NR" : String(e.previous) }),
        el("td", { class: move.startsWith("▲") ? "win" : move.startsWith("▼") ? "loss" : "muted", text: move }),
      ]));
    }
    box.appendChild(table);
    const others = kind === "ap" ? entry.ap_others : null;
    if (others && others.length) {
      const parts = others.map((e, i) => {
        const span = el("span", { class: e.team === s.team ? "win" : "" }, [`${e.name} (${e.record})`]);
        return i < others.length - 1 ? [span, ", "] : [span];
      }).flat();
      box.appendChild(el("div", { class: "others-votes" }, [el("b", { text: "Also receiving votes: " }), ...parts]));
    }
  }

  function renderBracket() {
    const s = state.season;
    const box = $("#tab-bracket");
    box.innerHTML = "";
    if (!s.bracket) {
      box.append(el("h3", { text: "Projected bracket" }));
      const w = pollWeekFor(state.viewWeek);
      const cfp = (s.polls[String(w)] || {}).cfp;
      if (!cfp) { box.append(el("p", { class: "muted", text: "The projection starts with the committee's first ranking after week 9. Until then, the AP poll is the only ranking." })); return; }
      box.append(el("p", { class: "muted small-text", text: "Projection from the current committee ranking and current conference leaders: ACC, Big Ten, Big 12 and SEC champions plus the highest-ranked Group of Six team get in; seeds 1-4 are the four highest-ranked teams and get byes." }));
      box.append(projectionTable(cfp));
      return;
    }
    const b = s.bracket;
    box.append(el("h3", { text: s.done ? "College Football Playoff" : "College Football Playoff bracket" }));
    const seeds = el("table", { class: "stats" });
    seeds.appendChild(el("tr", {}, ["Seed", "Team", "Rank", "Bid", ""].map((h) => el("th", { text: h, style: ["Team", "Bid"].includes(h) ? "text-align:left" : "" }))));
    for (const x of b.seeds) {
      seeds.appendChild(el("tr", { class: x.team === s.team ? "mine" : "" }, [
        el("td", { text: String(x.seed) }),
        el("td", { style: "text-align:left", class: "name" }, [teamPill(x.team), x.name]),
        el("td", { text: String(x.rank) }), el("td", { style: "text-align:left", class: "muted", text: x.bid }),
        el("td", { class: "muted", text: x.bye ? "bye" : "" }),
      ]));
    }
    box.append(seeds);
    if (b.first_four_out && b.first_four_out.length) {
      box.append(el("p", { class: "muted small-text", text: "First four out: " + b.first_four_out.map((x) => `${x.name} (#${x.rank})`).join(", ") }));
    }
    // rounds
    const rounds = ["First round", "Quarterfinals", "Semifinals", "National championship"];
    const played = s.playoff || {};
    const grid = el("div", { class: "bracket-grid" });
    for (const rname of rounds) {
      const col = el("div", { class: "bracket-col" }, [el("h3", { text: rname })]);
      const ids = played[rname];
      if (ids && ids.length) {
        col.appendChild(el("p", { class: "muted small-text", text: "Click a game you were in for the box score." }));
        col.dataset.pending = "1";
        loadRoundGames(rname, col);
      } else if (rname === "First round") {
        for (const g of b.first_round) col.appendChild(matchCard(`(${g.away.seed}) ${g.away.name}`, `(${g.home.seed}) ${g.home.name}`, null, null, `at ${g.home.name}`));
      } else if (rname === "Quarterfinals") {
        for (const q of b.quarterfinals) col.appendChild(matchCard(`winner of ${q.winner_of}`, `(${q.bye.seed}) ${q.bye.name}`, null, null, "neutral site"));
      } else {
        col.appendChild(el("p", { class: "muted small-text", text: "To be determined." }));
      }
      grid.appendChild(col);
    }
    box.append(grid);
    if (s.done) box.append(el("div", { class: "champ-banner", text: `National champion: ${s.champion_name}` }));
  }

  async function loadRoundGames(rname, col) {
    const s = state.season;
    const week = { "First round": 16, "Quarterfinals": 17, "Semifinals": 18, "National championship": 19 }[rname];
    try {
      const data = await api(`/api/season/${s.id}/week/${week}`);
      // bowls share these weeks; the bracket shows only the playoff games
      for (const g of data.games.filter((x) => x.kind === "playoff")) {
        const where = g.bowl ? `${g.bowl}${g.site ? " · " + g.site : ""}` : g.neutral ? "neutral site" : `at ${g.home_name}`;
        const card = matchCard(g.away_display, g.home_display, g.away_score, g.home_score, where, g.mine, g.has_box ? () => openBox(g.event_id) : null);
        col.appendChild(card);
      }
    } catch (err) { col.appendChild(el("p", { class: "muted", text: err.message })); }
  }

  function matchCard(awayLabel, homeLabel, awayScore, homeScore, note, mine, onClick) {
    const played = awayScore != null;
    const card = el("div", { class: `match-card ${mine ? "mine" : ""} ${onClick ? "clickable" : ""}` }, [
      el("div", { class: `match-row ${played && awayScore > homeScore ? "win" : ""}` }, [el("span", { text: awayLabel }), el("b", { text: played ? String(awayScore) : "" })]),
      el("div", { class: `match-row ${played && homeScore > awayScore ? "win" : ""}` }, [el("span", { text: homeLabel }), el("b", { text: played ? String(homeScore) : "" })]),
      el("div", { class: "muted small-text", text: note }),
    ]);
    if (onClick) card.addEventListener("click", onClick);
    return card;
  }

  function projectionTable(cfp) {
    // Mirror the bracket rules on the client for the mid-season projection.
    const s = state.season;
    const P4 = ["ACC", "Big Ten", "Big 12", "SEC"];
    const G6 = new Set(["American Athletic Conference", "Conference USA", "MAC", "Mountain West", "Pac-12", "Sun Belt"]);
    const order = cfp.map((e) => e.team);
    const pos = {}; cfp.forEach((e) => { pos[e.team] = e.rank; });
    const leaders = {};
    if (state.standings) for (const [conf, rows] of Object.entries(state.standings)) if (rows.length) leaders[conf] = rows[0].slug;
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
    const reason = Object.fromEntries(autos);
    const table = el("table", { class: "stats" });
    table.appendChild(el("tr", {}, ["Seed", "Team", "Rank", "Bid", ""].map((h) => el("th", { text: h, style: ["Team", "Bid"].includes(h) ? "text-align:left" : "" }))));
    seeded.forEach((t, i) => {
      table.appendChild(el("tr", { class: t === s.team ? "mine" : "" }, [
        el("td", { text: String(i + 1) }),
        el("td", { style: "text-align:left", class: "name" }, [teamPill(t), name(t)]),
        el("td", { text: pos[t] ? String(pos[t]) : "NR" }), el("td", { style: "text-align:left", class: "muted", text: reason[t] || "at-large" }),
        el("td", { class: "muted", text: i < 4 ? "bye" : "" }),
      ]));
    });
    if (!state.standings) api(`/api/season/${s.id}/standings`).then((d) => { state.standings = d.standings; if (state.tab === "bracket") renderBracket(); }).catch(() => {});
    return table;
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
  setSidebar(true, false);
  $("#btn-advance").addEventListener("click", () => advance());
  $("#btn-to-selection").addEventListener("click", () => advance(14));
  $("#btn-to-end").addEventListener("click", () => advance(19));
  $("#season-tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (b) { state.tab = b.dataset.tab; renderTab(); } });
  $("#sbox-tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-btab]"); if (b) selectBoxTab(b.dataset.btab); });

  (async () => {
    try { await loadTeams(); } catch (err) { toast(`Teams unavailable: ${err.message}`, 4000); }
    await loadSeasons().catch(() => {});
    const id = new URLSearchParams(location.search).get("id");
    if (id) openSeason(id);
  })();
})();
