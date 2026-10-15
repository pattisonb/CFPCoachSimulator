/* Season page: play a season week by week with polls, standings, the bracket and the playoff. */
(function () {
  "use strict";
  const { $, el, SBOX_IDS, renderScoreboard, renderScoring, renderTeamStats, renderPlayers, renderDrives } = window.CFP;

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
      const li = el("li", { onclick: () => openSeason(s.id) }, [
        el("span", { class: "teams", text: `${s.team_name} · ${s.mode === "full" ? "full" : "rest of season"}` }),
        el("span", { class: "score", text: `${s.wins}-${s.losses}` }),
        el("span", { class: "when", text: `${s.done ? `done · champion ${s.champion_name}` : `through week ${s.current_week}`} · ${when(s.created_at)}` }),
      ]);
      if (state.season && state.season.id === s.id) li.classList.add("active");
      list.appendChild(li);
    }
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
    setBusy(true);
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
          const pct = j.total ? Math.round((100 * j.done) / j.total) : 0;
          $("#season-progress").hidden = false;
          $("#season-progress-bar").style.width = `${pct}%`;
          poll();
        } else {
          if (j.status === "error") toast(`Simulation error: ${j.error}`, 6000);
          const s = await api(`/api/season/${state.season.id}`);
          state.viewWeek = null;
          showSeason(s);
          loadSeasons();
          setBusy(false);
        }
      } catch (err) { toast(err.message, 4000); setBusy(false); }
    }, 500);
  }

  function setBusy(b) {
    for (const id of ["btn-advance", "btn-to-selection", "btn-to-end"]) $(`#${id}`).disabled = b || (state.season && state.season.done);
    if (!b) { $("#season-progress").hidden = true; $("#season-progress-bar").style.width = "0%"; }
  }

  // ----- rendering ---------------------------------------------------------

  function showSeason(s) {
    state.season = s;
    state.standings = null;
    if (state.viewWeek == null || state.viewWeek > s.current_week) state.viewWeek = s.current_week;
    $("#season-empty").hidden = true;
    $("#season").hidden = false;
    const r = s.record;
    $("#season-title").innerHTML = "";
    $("#season-title").append(
      el("span", { class: "pill-inline", style: `background:${color(s.team)}` }),
      s.team_name, el("span", { class: "rec", text: `${r.wins}-${r.losses}` }),
      el("span", { class: "muted", style: "font-size:14px;margin-left:8px", text: `${r.conf_wins}-${r.conf_losses} ${s.conference}` }),
    );
    const phase = s.done ? `Season complete · national champion: ${s.champion_name}` : s.current_week === 0 ? "Preseason" : `Through ${s.week_labels[s.current_week] || "week " + s.current_week}`;
    $("#season-meta").textContent = `${phase} · ${s.mode === "full" ? "full season simulated" : "real results through today"} · ${when(s.created_at)}`;
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
      const b = el("button", { type: "button", class: `week-chip ${w === state.viewWeek ? "active" : ""} ${w > s.current_week ? "future" : ""} ${w === s.current_week ? "current" : ""}`, text: label, title: s.week_labels[w] || (w === 0 ? "Preseason" : "") });
      b.addEventListener("click", () => { state.viewWeek = w; renderWeekStrip(); renderTab(); });
      strip.appendChild(b);
    }
  }

  function selectTab(name) {
    state.tab = name;
    for (const b of $("#season-tabs").querySelectorAll("button")) b.classList.toggle("active", b.dataset.tab === name);
    for (const t of ["games", "schedule", "standings", "ap", "cfp", "bracket", "bowls", "box"]) $(`#tab-${t}`).hidden = t !== name;
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
  }

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
            el("span", { class: aw ? "win" : "" }, [el("span", { class: "pill-inline", style: `background:${color(b.away)}` }), b.away_name, played ? el("b", { text: ` ${b.away_score}` }) : null]),
            el("span", { class: "muted", text: " vs " }),
            el("span", { class: hw ? "win" : "" }, [el("span", { class: "pill-inline", style: `background:${color(b.home)}` }), b.home_name, played ? el("b", { text: ` ${b.home_score}` }) : null]),
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
          el("td", { text: String(t.conf_rank) }),
          el("td", { style: "text-align:left", class: "name" }, [t.name, t.champion ? el("span", { class: "crown", text: "👑", title: "Conference champion", "aria-label": "Conference champion" }) : null]),
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
        el("td", { style: "text-align:left", class: "name" }, [el("span", { class: "pill-inline", style: `background:${color(e.team)}` }), e.name]),
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
        el("td", { style: "text-align:left", class: "name" }, [el("span", { class: "pill-inline", style: `background:${color(x.team)}` }), x.name]),
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
      for (const g of data.games) {
        const card = matchCard(g.away_display, g.home_display, g.away_score, g.home_score, g.neutral ? "neutral site" : `at ${g.home_name}`, g.mine, g.has_box ? () => openBox(g.event_id) : null);
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
        el("td", { style: "text-align:left", class: "name" }, [el("span", { class: "pill-inline", style: `background:${color(t)}` }), name(t)]),
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
