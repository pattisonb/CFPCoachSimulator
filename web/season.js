/* Season page: play a season week by week with polls, standings, the bracket and the playoff. */
(function () {
  "use strict";
  const { $, el, SBOX_IDS, teamPill, renderScoreboard, renderScoring, renderTeamStats, renderPlayers, renderDrives } = window.CFP;

  const state = { teams: [], season: null, viewWeek: null, tab: "schedule", poll: "ap", timer: null, standings: null };

  async function api(path, options) {
    const res = await window.CFP.game.fetch(path, options);
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  }
  // fetch options for a POST with a JSON body
  function postJSON(body) {
    return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  }
  // toast(msg, ms): a thin wrapper over the shared stack (web/ui.js). Without ms it stays up until the
  // next toast replaces it (a "working on it" line); hideToast() takes that one down.
  let stickyToast = null;
  const ERROR_TOAST = /^(Could not|Simulation error|Teams unavailable)/;
  function toast(msg, ms) {
    if (stickyToast) { stickyToast.dismiss(); stickyToast = null; }
    const node = window.CFP.ui.toast(msg, { ms: ms || 0, kind: ERROR_TOAST.test(msg) ? "error" : "info" });
    if (!ms) stickyToast = node;
    return node;
  }
  function hideToast() { if (stickyToast) { stickyToast.dismiss(); stickyToast = null; } }
  function when(iso) { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  function name(slug) { const t = window.CFP.teamsBySlug[slug]; return t ? t.name : slug; }

  // ----- setup -------------------------------------------------------------

  async function loadTeams() {
    const data = await api("/api/teams");
    state.teams = data.teams;
    const sel = $("#pick-team");
    // one alphabetical list (the API sorts by name); the conference rides in the label
    for (const t of data.teams) {
      window.CFP.teamsBySlug[t.slug] = t;
      if (!t.fictional) sel.appendChild(el("option", { value: t.slug, text: `${t.name} (${t.ratings.overall.toFixed(0)} OVR) · ${CONF_SHORT[t.conference] || t.conference}` }));
    }
    const params = new URLSearchParams(location.search);
    if (params.get("team") && window.CFP.teamsBySlug[params.get("team")]) sel.value = params.get("team");
    else sel.value = "ohio-state";
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
        el("span", { class: "teams", text: `${s.team_name} · ${s.career ? `Coach Career · ${s.year}` : "full"}` }),
        el("span", { class: "score", text: `${s.wins}-${s.losses}` }),
        el("span", { class: "when", text: `${s.offseason ? "Offseason" : s.done ? `Done · champion ${s.champion_name}` : `Through week ${s.current_week}`} · ${when(s.created_at)}` }),
        del,
      ]);
      if (state.season && state.season.id === s.id) li.classList.add("active");
      list.appendChild(li);
    }
    const count = data.seasons.length;
    state.seasons = data.seasons;
    $("#btn-seasons").textContent = count ? `Seasons (${count})` : "Seasons";
    $("#btn-seasons-menu").textContent = count ? `Seasons (${count}) ▾` : "Seasons ▾";
    $("#btn-clear-seasons").hidden = !count;
  }

  // ----- the Seasons menu (a season open: the toolbar folds into one button) ------------------
  // With a season open the team picker, New season, Seasons and Load career fold into "Seasons ▾",
  // a popover with the saved seasons, New season, Load career and Clear all; the side panel is for
  // the empty state only. With no season open the full toolbar shows as before.
  function toolbarMode(open) {
    for (const id of ["pick-team", "btn-new", "btn-seasons", "btn-load-career"]) $(`#${id}`).hidden = open;
    $("#btn-seasons-menu").hidden = !open;
    document.body.classList.toggle("season-open", open);
    if (!open) setTopbarHidden(false);
  }
  const phone = () => window.matchMedia("(max-width: 759px)").matches;

  // A popover menu under a button (the Recruit menu's look and keys: Escape, Tab and an outside click
  // close it, arrows move, focus returns to the button); a bottom sheet on a phone. items: {heading} rows
  // and {name, cost, why, onPick, current} rows; a row with a why is grayed but reachable.
  let menuState = null;
  function closeMenu(refocus) {
    const m = menuState;
    if (!m) return;
    menuState = null;
    m.el.remove();
    if (m.backdrop) m.backdrop.remove();
    document.removeEventListener("pointerdown", m.onDoc, true);
    window.removeEventListener("scroll", m.onMove, true);
    window.removeEventListener("resize", m.onMove);
    m.btn.setAttribute("aria-expanded", "false");
    if (refocus && m.btn.isConnected) m.btn.focus({ preventScroll: true });
  }
  function openMenu(btn, items, label) {
    if (menuState) { const same = menuState.btn === btn; closeMenu(true); if (same) return; }
    const sheet = phone();
    const menu = el("div", { class: `go-menu season-menu ${sheet ? "sheet" : ""}`, role: "menu", tabindex: "-1", "aria-label": label }, items.map((it) => {
      if (it.heading) return el("div", { class: "go-menu-head muted small-text", role: "presentation", text: it.heading });
      const item = el("button", { type: "button", class: `go-menu-item ${it.current ? "current" : ""}`, role: "menuitem", tabindex: "-1" }, [
        el("span", { class: "go-menu-main" }, [el("b", { text: it.name }), it.cost ? el("span", { class: "muted small go-menu-cost", text: it.cost }) : null]),
        it.why ? el("span", { class: "go-menu-why", text: it.why }) : null]);
      if (it.current) item.setAttribute("aria-current", "true");
      if (it.disabled) item.setAttribute("aria-disabled", "true");
      item.addEventListener("click", () => { if (it.disabled) return; closeMenu(true); it.onPick(); });
      return item;
    }));
    menu.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(true); return; }
      if (e.key === "Tab") { e.preventDefault(); closeMenu(true); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const live = [...menu.querySelectorAll(".go-menu-item")];
      if (!live.length) return;
      const i = live.indexOf(document.activeElement);
      const j = e.key === "ArrowDown" ? (i + 1) % live.length : e.key === "ArrowUp" ? (i - 1 + live.length) % live.length : e.key === "Home" ? 0 : live.length - 1;
      live[j].focus();
    });
    const backdrop = sheet ? el("div", { class: "go-menu-backdrop" }) : null;
    if (backdrop) { backdrop.addEventListener("click", () => closeMenu(true)); document.body.append(backdrop); }
    document.body.append(menu);
    const place = () => {
      const r = btn.getBoundingClientRect(), m = menu.getBoundingClientRect(), pad = 8;
      if (r.bottom < 0 || r.top > window.innerHeight) { closeMenu(); return; }
      let top = r.bottom + 6;
      if (top + m.height > window.innerHeight - pad) top = Math.max(pad, r.top - 6 - m.height);
      menu.style.top = `${top}px`;
      menu.style.left = `${Math.max(pad, Math.min(r.left, document.documentElement.clientWidth - m.width - pad))}px`;
    };
    if (!sheet) place();
    const onDoc = (e) => { if (!menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closeMenu(); };
    const onMove = () => { if (!sheet) place(); };
    document.addEventListener("pointerdown", onDoc, true);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    btn.setAttribute("aria-expanded", "true");
    menuState = { el: menu, backdrop, btn, onDoc, onMove };
    const first = menu.querySelector(".go-menu-item:not([aria-disabled=\"true\"])") || menu.querySelector(".go-menu-item");
    (first || menu).focus();
    return menu;
  }

  function seasonsMenu(anchor) {
    const btn = anchor instanceof Element ? anchor : $("#btn-seasons-menu");
    if (btn === $("#btn-seasons-menu")) setTopbarHidden(false);   // the menu hangs from the bar: keep it on screen
    const items = [];
    const list = state.seasons || [];
    items.push({ heading: list.length ? "Saved seasons" : "No saved seasons" });
    for (const x of list) {
      const status = x.offseason ? "Offseason" : x.done ? `Done · champion ${x.champion_name}` : `Through week ${x.current_week}`;
      items.push({ name: `${x.team_name} · ${x.career ? `Coach Career · ${x.year}` : "full"}`, cost: `${x.wins}-${x.losses}`, why: `${status} · ${when(x.created_at)}`,
                   current: !!(state.season && state.season.id === x.id), onPick: () => { if (!state.season || state.season.id !== x.id) openSeason(x.id); } });
    }
    items.push({ heading: "" });
    items.push({ name: "New Season", why: "Pick a team and who coaches it", onPick: newSeasonFlow, disabled: !!state.simming });
    items.push({ name: "Load Career", why: "Open a Coach Career saved as a file", onPick: () => $("#career-file").click() });
    if (list.length) items.push({ name: "Clear All", why: "Delete every saved season", onPick: clearSeasons });
    openMenu(btn, items, "Seasons");
  }

  // New season from the menu: pick the team, then who coaches (chooseCoach, in the same dialog)
  function newSeasonFlow() {
    const pick = $("#pick-team");
    const sel = el("select", { "aria-label": "Your team", class: "start-team" }, [...pick.options].map((o) => el("option", { value: o.value, text: o.textContent })));
    sel.value = pick.value;
    const go = el("button", { type: "button", class: "accent", text: "Who Coaches? →" });
    go.addEventListener("click", () => { pick.value = sel.value; chooseCoach("full", true); });
    openModal("New Season", el("div", { class: "start-pick" }, [el("p", { class: "muted small-text", text: "Pick the program. The 2026 season starts from week 1, with the real schedule and roster." }), sel, go]));
    sel.focus({ preventScroll: true });
  }

  // An API error as a sentence: FastAPI sends {"detail": "..."} after the status code.
  function errText(err) {
    const msg = (err && err.message) || "";
    const m = /^(\d{3}) (.*)$/s.exec(msg);
    if (!m) return /failed to fetch|networkerror|load failed/i.test(msg) ? "could not reach the server. Check your connection and try again." : msg;
    let detail = "";
    try { detail = JSON.parse(m[2]).detail; } catch (e) { /* not JSON */ }
    if (typeof detail === "string" && detail) return detail;
    return Number(m[1]) >= 500 ? "the server hit an error. Try again in a moment." : `the server said no (${m[1]}).`;
  }
  const isGone = (err) => /^404\b/.test(err.message || "");

  // The game no longer has this season (deleted from another tab): close it and say so
  // instead of leaving the page waiting.
  async function seasonGone() {
    closeSeason();
    loadSeasons().catch(() => {});
    toast("This season is no longer saved, so start a new one.", 9000);
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

  // the empty state shows the start-a-season instructions, or a note in their place (loading, or why loading failed)
  function startNote(text) {
    $("#season-intro").hidden = !!text;
    $("#season-loading").hidden = !text;
    $("#season-loading").textContent = text || "";
  }

  function closeSeason() {
    clearTimeout(state.timer);
    state.season = null;
    applyTeamTheme(null);
    state.viewWeek = null;
    state.poll = "ap"; state.pollChosen = false;
    $("#season").hidden = true;
    $("#season-empty").hidden = false;
    startNote(null);
    history.replaceState(null, "", location.pathname);
    toolbarMode(false);
    setCompact(false);
    closeHeadSheet();
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
    } catch (err) { toast(`Could not delete: ${errText(err)}`, 4000); }
  }

  async function clearSeasons() {
    if (!confirm("Delete every saved season? This cannot be undone.")) return;
    try {
      const r = await api("/api/seasons", { method: "DELETE" });
      closeSeason();
      await loadSeasons();
      toast(r.kept ? `Deleted ${r.removed} seasons; ${r.kept} still simulating` : `Deleted ${r.removed} seasons`);
    } catch (err) { toast(`Could not clear: ${errText(err)}`, 4000); }
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

  // Who coaches: take over the team's own head coach, or one of your created coaches (the Your
  // coach page). The team's coordinators stay for the season either way.
  async function chooseCoach(mode, inPlace) {
    const slug = $("#pick-team").value;
    const t = window.CFP.teamsBySlug[slug] || {};
    const staff = t.staff || {};
    const box = el("div", { class: "start-choice" });
    const own = el("div", { class: "start-card" }, [
      el("div", { class: "start-card-head" }, [el("b", { text: `Take Over As ${t.head_coach || "the Head Coach"}` })]),
      el("p", { class: "muted small-text", text: `${t.name}'s own head coach, with his scheme and tendencies.` }),
    ]);
    const go = el("button", { type: "button", class: "accent", text: `Start As ${t.head_coach || "him"}` });
    go.addEventListener("click", () => { closeModal(); newSeason(mode, null); });
    own.append(go);
    const mine = el("div", { class: "start-card" }, [
      el("div", { class: "start-card-head" }, [el("b", { text: "Your Own Coach" })]),
      el("p", { class: "muted small-text", text: "A head coach you created: his ratings, scheme and style on the sides he calls." }),
    ]);
    const list = el("div", { class: "start-coaches" }, [el("span", { class: "muted small-text", text: "Loading your coaches…" })]);
    mine.append(list);
    const create = el("a", { class: "ghost small", href: `./coach.html?team=${encodeURIComponent(slug)}`, text: "Create a New Coach" });
    mine.append(el("div", { class: "coach-actions" }, [create]));
    box.append(own, mine,
      el("p", { class: "muted small-text", text: `Either way the staff stays for the season: ${staff.offense || "the offensive coordinator"} and ${staff.defense || "the defensive coordinator"}. Staff changes come after the season.` }));
    if (inPlace && modalStack.length) swapModal(`Who coaches ${t.name || "your team"}?`, box);
    else openModal(`Who Coaches ${t.name || "your team"}?`, box);
    try {
      const coaches = (await api("/api/coaches")).coaches;
      list.innerHTML = "";
      if (!coaches.length) list.append(el("span", { class: "muted small-text", text: "No coaches yet." }));
      for (const c of coaches) {
        const row = el("button", { type: "button", class: "start-coach" });
        const pic = el("span", { class: "coach-line-pic", "aria-hidden": "true" });
        if (window.CoachSprite) pic.innerHTML = window.CoachSprite(c.look, t.colors);
        row.append(pic, el("span", {}, [el("b", { text: `${c.first_name} ${c.last_name}` }), el("span", { class: "muted small-text", text: ` ${c.archetype}` })]));
        row.addEventListener("click", () => { closeModal(); newSeason(mode, c.id); });
        list.append(row);
      }
    } catch (err) { list.textContent = `Could not load your coaches: ${errText(err)}`; }
  }

  async function newSeason(mode, coach) {
    const team = $("#pick-team").value;
    $("#btn-new").disabled = true;
    // building a season takes a few seconds (schedules, rosters, preseason polls): say so
    const teamName = (window.CFP.teamsBySlug[team] || {}).name || "your team";
    toast(`Setting up the ${teamName} season: schedule, rosters and preseason polls…`);
    try {
      const s = await api("/api/season", postJSON({ team, mode, coach: coach || null, career: mode === "full" }));
      history.replaceState(null, "", `?id=${s.id}`);
      showSeason(s);
      loadSeasons();
      hideToast();
    } catch (err) { toast(`Could not start the season: ${errText(err)}`, 4000); }
    finally { $("#btn-new").disabled = false; }
  }

  async function openSeason(id) {
    try {
      const s = await api(`/api/season/${id}`);
      history.replaceState(null, "", `?id=${s.id}`);
      showSeason(s);
      loadSeasons();
    } catch (err) {
      toast(`Could not open the season: ${errText(err)}`, 4000);
      if (!state.season) startNote(`Could not load the season: ${errText(err)}`);
    }
  }

  // The next season of a career opens in place (the save keeps its id): everything the page
  // remembered about the season just played is dropped first, as a fresh open would.
  async function reopenSeason(id) {
    clearTimeout(state.timer);
    state.season = null;
    state.viewWeek = null; state.standings = null; state.summaryShown = false; state.simLastDone = null;
    if (window.CFPDepth) window.CFPDepth.refresh();
    await openSeason(id);
  }

  // ----- advancing ---------------------------------------------------------

  // A sim is starting: note the week it starts from and the week it runs to, whether game
  // day follows it, and lock the page until it is done.
  function beginSim(s, target, gamedayWanted) {
    state.gamedayWanted = gamedayWanted;
    state.advanceFrom = s.current_week;
    state.simming = true;
    barReset();
    state.simResults = [];
    state.simTarget = target;
    state.headWeek = s.current_week;
    setBusy(true);
  }

  // Game day: only your game is simulated, then it replays drive by drive. Advance then
  // plays the rest of the week (or the whole week, if you skipped game day).
  async function playGameDay() {
    const s = state.season;
    if (!s || s.done) return;
    beginSim(s, s.current_week + 1, true);
    showProgress({ status: "running", done: s.current_week, total: s.current_week + 1, stage: "Playing your game", week: s.current_week + 1 });
    try {
      await api(`/api/season/${s.id}/gameday`, { method: "POST" });
      poll();
    } catch (err) { simFailed(err, "Could not play the game"); }
  }

  async function advance(to) {
    const s = state.season;
    if (!s || s.done) return;
    beginSim(s, to || s.current_week + 1, false);
    showProgress({ status: "running", done: s.current_week, total: to || s.current_week + 1, stage: "Getting ready", week: s.current_week + 1 });
    try {
      await api(`/api/season/${s.id}/advance`, postJSON(to ? { to } : {}));
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
          barDone(j.status !== "error");
          hideSimOverlay();
          if (j.status === "error") toast(`Simulation error: ${j.error}`, 6000);
          const s = await api(`/api/season/${state.season.id}`);
          state.viewWeek = s.done ? s.current_week : Math.min(s.current_week + 1, 20);
          const gdEvent = state.gamedayWanted && j.status !== "error" ? j.gameday_event : null;
          const mine = gdEvent ? (j.results || []).find((r) => r.event_id === gdEvent) : null;
          state.gamedayWanted = false;
          if (gdEvent) {
            // the page behind the live game would give the score away (record, "your game is
            // played"), so it updates when the game is over, skipped or closed
            state.afterGameday = s;
            // the buttons stay locked until the game is open: until then the page still shows the week before
            openGameDay(gdEvent, mine).finally(() => setBusy(false));
          } else {
            showSeason(s);
            loadSeasons();
            setBusy(false);
          }
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
    for (const n of document.querySelectorAll("#tab-office .go-play button, #tab-office .go-play select")) n.disabled = b;
    $("#btn-settings").disabled = b;
    $("#btn-compact-office").disabled = b;
    for (const chip of document.querySelectorAll("#week-strip .week-chip")) chip.disabled = b;
    $("#btn-new").disabled = b;
    $("#season-list").classList.toggle("locked", b);
    document.body.classList.toggle("simming", b);   // tabs, chips, pills and the toolbar ignore clicks
    if (!b) { $("#season-progress").hidden = true; $("#season-progress-text").hidden = true; $("#season-progress-bar").style.width = "0%"; }
  }

  // Your team's rank in the season header ("#7", or "CFP #5" once the committee ranks), or null.
  function headerRank(myRank) {
    if (!myRank || !myRank.rank) return null;
    const cfp = myRank.kind === "cfp";
    return el("span", { class: "hdr-rank", text: cfp ? `CFP #${myRank.rank}` : `#${myRank.rank}`, title: cfp ? "College Football Playoff ranking" : "AP poll" });
  }

  // While a sim runs the header follows it week by week: rank, record, and where the
  // season is; Game day waits until the sim is done.
  function liveHead(j) {
    const s = state.season;
    if (!s) return;
    if (j.record) {
      const rec = $("#season-title .rec");
      if (rec) rec.textContent = `${j.record.wins}-${j.record.losses}`;
      $("#sc-rec").textContent = `${j.record.wins}-${j.record.losses}`;
      const conf = $("#season-title .conf-rec");
      if (conf) conf.textContent = `${j.record.conf_wins}-${j.record.conf_losses} ${s.conference}`;
    }
    if (j.done === state.headWeek) return;
    state.headWeek = j.done;
    s.current_week = j.done;
    if ("my_rank" in j) {
      s.my_rank = j.my_rank;
      const old = $("#season-title .hdr-rank");
      const r = headerRank(j.my_rank);
      if (old && r) old.replaceWith(r);
      else if (old) old.remove();
      else if (r && $("#season-title .rec")) $("#season-title .rec").before(r);
    }
    const simDate = simDateText(s);
    $("#season-meta").textContent = `Simming · through ${j.done === 0 ? "the preseason" : s.week_labels[j.done] || "week " + j.done}${simDate ? ` · ${simDate}` : ""}`;
    $("#sc-next").textContent = `Simming · through ${j.done === 0 ? "the preseason" : s.week_labels[j.done] || "week " + j.done}`;
  }

  // Progress while simming: the engine's `progress` (the job's work done over its plan, which
  // weighs every week by its games, polls, awards and recruiting), drawn by the sim bar below,
  // and a line saying what the sim is doing right now.
  function showProgress(j) {
    liveHead(j);
    const from = state.advanceFrom != null ? state.advanceFrom : Math.max(0, j.done - 1);
    const span = Math.max(1, j.total - from);
    let p = j.progress;
    if (p == null) {   // an older status (or the page's own first one): whole weeks plus the week's share
      const frac = j.week_frac != null ? j.week_frac : (j.games_total ? j.games_done / j.games_total : 0);
      p = (j.done - from + frac) / span;
    }
    // one bar at a time: the header's for a single week, the overlay's for a longer sim
    $("#season-progress").hidden = span > 1;
    const text = $("#season-progress-text");
    text.innerHTML = "";
    text.append(el("b", { text: stageLine(j) }), el("span", { id: "season-progress-pct" }));
    text.hidden = span > 1;
    const simBtn = $("#tab-office .go-play .go-btn.primary");
    if (simBtn) simBtn.textContent = "Simming…";
    if (span > 1) showSimOverlay(j);
    barReport(p);
  }

  // What the sim is doing, from the engine's stage: "Playing Week 6 games · 34 of 61", "Recruiting week", "Saving".
  function stageLine(j) {
    const stage = j.stage || "Getting ready";
    return j.games_total ? `${stage} · ${j.games_done} of ${j.games_total}` : stage;
  }

  // ----- the sim bar ------------------------------------------------------------------------------
  // Each status moves the bar to its progress (a short CSS width transition). Between statuses
  // it creeps on at the pace of the last ones, but never past BAR_CREEP_SHARE of the way to
  // where the next status is expected, so it does not run ahead of the sim. It never goes back,
  // the percentage follows the drawn bar, and 100% shows only once the job is over. Reduced
  // motion: no creep, and the width jumps (styles.css).
  const BAR_TICK_MS = 100, BAR_POLL_MS = 500, BAR_CREEP_SHARE = 0.5;
  const reducedMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  function barReset() {
    if (state.bar && state.bar.timer) clearInterval(state.bar.timer);
    state.bar = { target: 0, drawn: 0, at: performance.now(), rate: 0, timer: null };
    barDraw(0);
  }
  function barReport(p) {
    if (!state.bar) barReset();
    const b = state.bar, now = performance.now();
    p = Math.max(0, Math.min(1, Number(p) || 0));
    if (p > b.target) {
      const dt = (now - b.at) / 1000, r = (p - b.target) / Math.max(dt, 0.05);
      b.rate = b.rate ? 0.6 * b.rate + 0.4 * r : r;   // the pace of the last few statuses
      b.target = p;
      b.at = now;
    }
    barDraw(b.target);
    if (!b.timer && !reducedMotion()) b.timer = setInterval(barTick, BAR_TICK_MS);
  }
  function barTick() {
    const b = state.bar;
    if (!b || !state.simming) { if (b && b.timer) { clearInterval(b.timer); b.timer = null; } return; }
    const dt = (performance.now() - b.at) / 1000;
    const ahead = b.rate * BAR_CREEP_SHARE * Math.min(dt, BAR_POLL_MS / 1000);
    barDraw(b.target + ahead);
  }
  function barDone(ok) {
    const b = state.bar;
    if (!b) return;
    if (b.timer) { clearInterval(b.timer); b.timer = null; }
    if (ok) barDraw(1, true);
  }
  function barDraw(p, done) {
    const b = state.bar;
    b.drawn = done ? 1 : Math.min(0.99, Math.max(b.drawn, p));
    const pct = done ? 100 : Math.min(99, Math.round(b.drawn * 100));
    const width = `${(b.drawn * 100).toFixed(1)}%`;
    for (const id of ["sim-bar", "season-progress-bar"]) { const n = document.getElementById(id); if (n && n.style.width !== width) n.style.width = width; }
    const sub = document.getElementById("sim-sub");
    if (sub) sub.textContent = `${pct}%`;
    const head = document.getElementById("season-progress-pct");
    if (head) head.textContent = ` · ${pct}%`;
  }

  // A multi-week sim covers the tab (the tabs stay, dimmed) and shows what is happening: the stage, the bar, your
  // record ticking up in the header, each of your results as it lands, and a Pause button.
  function showSimOverlay(j) {
    const s = state.season;
    const ov = $("#sim-overlay");
    if (ov.hidden) {
      ov.hidden = false;
      for (const t of document.querySelectorAll(".season-main .tab-body, #tab-box")) t.hidden = true;
      $("#sim-results").innerHTML = "";
      state.simShown = new Set();
      $("#btn-pause").disabled = false;
      $("#btn-pause").textContent = "Pause after this week";
    }
    $("#sim-stage").textContent = stageLine(j);
    $("#sim-overlay .review-label").textContent = `Simming through ${s.week_labels[j.total] || "week " + j.total}`;
    // the week strip follows the sim
    if (j.done !== state.simLastDone) { state.simLastDone = j.done; state.viewWeek = j.done; state.season.current_week = j.done; renderWeekStrip(); }
    for (const r of j.results || []) {
      const key = `${r.week}|${r.opponent}`;
      if (state.simShown.has(key)) continue;
      state.simShown.add(key);
      const vs = r.venue === "away" ? "at" : "vs";
      const row = el("div", { class: `sim-result new ${r.won ? "win" : "loss"}` }, [
        el("span", { class: "muted", text: s.week_labels[r.week] && r.week > 14 ? postseasonLabel(s, r.week) : `Week ${r.week}` }),
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
    selectTab(state.tab === "box" ? "games" : state.tab);
  }

  async function pauseSim() {
    const s = state.season;
    if (!s) return;
    try {
      const r = await api(`/api/season/${s.id}/pause`, { method: "POST" });
      if (r.stopping) { $("#btn-pause").disabled = true; $("#btn-pause").textContent = "Pausing after this week…"; }
    } catch (err) { toast(`Could not pause: ${errText(err)}`, 3000); }
  }

  // ----- rendering ---------------------------------------------------------

  // ----- team colors --------------------------------------------------------
  // While a season is open the page takes the team's colors: the accent (buttons, chips,
  // progress, highlights) is the first of the team's colors that reads against the page
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
    // the accent as text (kickers, links, headings) needs 4.5:1, more than a fill does
    let accentText = accent;
    for (let t = 0.1; t <= 1 && Math.min(contrast(accentText, bg), contrast(accentText, panel)) < 4.5; t += 0.1) accentText = mix(accent, light ? [0, 0, 0] : [255, 255, 255], t);
    const inkFor = (rgb) => (contrast(rgb, [0, 0, 0]) >= contrast(rgb, [255, 255, 255]) ? "#1a1200" : "#ffffff");
    const primary = candidates[0];
    const secondary = candidates[1] || accent;
    // the color for buttons that sit on the primary band: the first other team color that
    // reads against the primary, else white or black
    const onPrimary = candidates.slice(1).find((c) => contrast(c, primary) >= 3) || hexToRgb(inkFor(primary) === "#ffffff" ? "#ffffff" : "#1a1200");
    return { accent: rgbToHex(accent), accentText: rgbToHex(accentText), ink: inkFor(accent), primary: rgbToHex(primary), primaryInk: inkFor(primary),
             secondary: rgbToHex(secondary), onPrimary: rgbToHex(onPrimary), onPrimaryInk: inkFor(onPrimary) };
  }

  function applyTeamTheme(slug) {
    const root = document.documentElement.style;
    const meta = document.querySelector('meta[name="theme-color"]');
    const t = slug && window.CFP.teamsBySlug[slug];
    const theme = t && t.colors ? teamTheme(t.colors) : null;
    if (!theme) {
      for (const v of ["--accent", "--accent-text", "--accent-ink", "--team-primary", "--team-primary-ink", "--team-secondary", "--team-on-primary", "--team-on-primary-ink"]) root.removeProperty(v);
      document.body.classList.remove("team-theme");
      if (meta) meta.content = document.documentElement.dataset.theme === "light" ? "#ffffff" : "#131a2e";
      return;
    }
    root.setProperty("--accent", theme.accent);
    root.setProperty("--accent-text", theme.accentText);
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
    $("#btn-download-career").hidden = !s.career;
    const opening = !state.season || state.season.id !== s.id;
    state.season = s;
    // no more games once the season is complete: the Summary tab takes the Games tab's place
    $("#season-tabs button[data-tab=games]").hidden = !!s.done;
    $("#season-tabs button[data-tab=summary]").hidden = !s.done;
    if (s.done && state.tab === "games") state.tab = "summary";
    if (s.done && state.tab === "schedule" && !state.summaryShown) { state.tab = "summary"; state.summaryShown = true; }
    if (!s.done && state.tab === "summary") state.tab = "schedule";
    if (opening) { if (window.CFPDepth && window.CFPDepth.isOpen()) closeDepth(false); applyTeamTheme(s.team); }
    // the team picker (for a new season) starts on the open season's team
    if (opening && $("#pick-team").querySelector(`option[value="${s.team}"]`)) $("#pick-team").value = s.team;
    state.standings = null;
    if (opening) { setSidebar(false, false); toolbarMode(true); }
    const upNext = s.done ? s.current_week : Math.min(s.current_week + 1, 20);
    // a season opens on the week up next
    if (state.viewWeek == null) state.viewWeek = upNext;
    if (state.viewWeek > upNext) state.viewWeek = upNext;
    $("#season-empty").hidden = true;
    $("#season").hidden = false;
    const r = s.record;
    $("#season-title").innerHTML = "";
    $("#season-title").append(
      teamPill(s.team),
      s.team_name,
      ...[headerRank(s.my_rank)].filter(Boolean),   // append() would print a null as text
      el("span", { class: "rec", text: `${r.wins}-${r.losses}` }),
      el("span", { class: "muted conf-rec", style: "font-size:14px;margin-left:8px", text: `${r.conf_wins}-${r.conf_losses} ${s.conference}` }),
    );
    const myNext = (s.schedule || []).find((g) => g.week === s.current_week + 1 && g.opponent);
    const played = myNext && myNext.played ? ` · your game is played (${myNext.won ? "W" : "L"} ${myNext.points_for}–${myNext.points_against}); Advance plays the rest of the week` : "";
    const phase = s.done ? `Season complete · national champion: ${s.champion_name}` : s.current_week === 0 ? `Preseason · ${s.week_labels[1] || "Week 1"} up next${played}` : `${s.week_labels[s.current_week + 1] || "Week " + (s.current_week + 1)} up next · through ${s.week_labels[s.current_week] || "week " + s.current_week}${played}`;
    const simDate = simDateText(s);
    $("#season-meta").textContent = `${phase}${simDate ? ` · ${simDate}` : ""} · full season from week 1 · created ${when(s.created_at)}`;
    // the next game leads the line (the staff live on the Office and the coach page)
    if (myNext && !s.done && !myNext.played) {
      const where = myNext.venue === "away" ? "at" : "vs";
      $("#season-meta").prepend(el("span", { class: "coach-line" }, [el("b", { text: `${where} ${myNext.opponent_name}${myNext.opponent_rank ? ` (#${myNext.opponent_rank})` : ""}` }), " · "]));
    }
    document.title = "Coach Career · CFP Coach Simulator";
    for (const a of document.querySelectorAll(".site-nav a")) a.classList.toggle("active", a.dataset.nav === "season");
    renderCareerSteps(s);
    setBusy(false);
    renderWeekStrip();
    renderCompact(s);
    renderTab();
  }

  // ----- the compact header -------------------------------------------------------------------
  // Once the page scrolls past the header card a one-line bar sticks under the top bar: the team,
  // the record and rank, what is up next, an Office button (a career) and ▾ (settings, the career
  // file; on a phone the full header row as a sheet). On a phone the bar is the default and the
  // header row stays folded. An IntersectionObserver on the sentinel after the card drives it.
  const compact = { on: false, past: false, io: null, margin: null };
  const STAGE_NAMES = { departures: "Offseason · Departures", retention: "Offseason · Keep Them Home", portal_1: "Offseason · Transfer Portal", portal_2: "Offseason · Transfer Portal",
    portal_w1: "Offseason · Portal Week 1", portal_w2: "Offseason · Portal Week 2", portal_w3: "Offseason · Portal Week 3", portal_w4: "Offseason · Portal Week 4",
    development: "Offseason · Development", staff: "Offseason · Staff Changes", ready: "Offseason · Ready for Next Season" };
  function renderCompact(s) {
    const t = window.CFP.teamsBySlug[s.team] || {};
    const pill = $("#sc-pill");
    pill.innerHTML = "";
    pill.append(teamPill(s.team));
    $("#sc-abbr").textContent = t.abbreviation || s.team_name;
    $("#sc-rec").textContent = `${s.record.wins}-${s.record.losses}`;
    const rank = s.my_rank && s.my_rank.rank ? (s.my_rank.kind === "cfp" ? `CFP #${s.my_rank.rank}` : `#${s.my_rank.rank}`) : "";
    $("#sc-rank").textContent = rank;
    $("#sc-rank").hidden = !rank;
    $("#sc-next").textContent = s.done ? (s.career && s.offseason_stage ? STAGE_NAMES[s.offseason_stage] || "Offseason" : "Season complete")
      : `${s.week_labels[s.current_week + 1] || "Week " + (s.current_week + 1)} up next`;
    $("#btn-compact-office").hidden = !s.career;
    watchHeader();
  }
  function stickyH() {
    const h = (n) => (n && getComputedStyle(n).position === "sticky" ? n.getBoundingClientRect().height : 0);
    return Math.round(topbarH() + (document.body.classList.contains("career-mode") ? h($("#season-tabs")) : 0));
  }
  function watchHeader() {
    const margin = `-${stickyH()}px 0px 0px 0px`;
    if (compact.io && compact.margin === margin) { applyCompact(); return; }
    if (compact.io) compact.io.disconnect();
    compact.margin = margin;
    compact.io = new IntersectionObserver((entries) => {
      for (const e of entries) compact.past = !e.isIntersecting && e.boundingClientRect.top < 0 + stickyH();
      applyCompact();
    }, { rootMargin: margin, threshold: 0 });
    compact.io.observe($("#season-head-end"));
  }
  function applyCompact() {
    const ph = phone();
    document.body.classList.toggle("phone-compact", ph);
    setCompact(!!state.season && (ph || compact.past));
  }
  function setCompact(on) {
    if (compact.on === on) return;
    compact.on = on;
    const bar = $("#season-compact");
    bar.hidden = !on;
    document.body.classList.toggle("head-compact", on);
    if (!on) closeHeadSheet();
    stickyTop();
  }
  // the phone's ▾: the header row (title, record, settings, the career file) as a sheet
  function openHeadSheet() {
    if (document.body.classList.contains("head-sheet")) return;
    const back = el("div", { class: "go-menu-backdrop sc-backdrop" });
    back.addEventListener("click", closeHeadSheet);
    document.body.append(back);
    document.body.classList.add("head-sheet");
    $("#btn-compact-more").setAttribute("aria-expanded", "true");
    $("#btn-settings").focus({ preventScroll: true });
  }
  function closeHeadSheet() {
    if (!document.body.classList.contains("head-sheet")) return;
    document.body.classList.remove("head-sheet");
    for (const b of document.querySelectorAll(".sc-backdrop")) b.remove();
    const more = $("#btn-compact-more");
    more.setAttribute("aria-expanded", "false");
    if (more.isConnected && !more.hidden) more.focus({ preventScroll: true });
  }
  function compactMore() {
    if (phone()) { if (document.body.classList.contains("head-sheet")) closeHeadSheet(); else openHeadSheet(); return; }
    const items = [{ name: "⚙ Settings", why: "God mode and more", onPick: () => $("#btn-settings").click() }];
    if (state.season && state.season.career) items.push({ name: "Download Career", why: "Save this career as a file", onPick: () => $("#btn-download-career").click() });
    // the top bar hides while the page scrolls: its essentials live here too
    items.push({ heading: "" });
    items.push({ name: "Seasons", why: "Your saved seasons, a new season, a career file", onPick: () => seasonsMenu($("#btn-compact-more")) });
    items.push({ name: "Your Coach", why: "Your record, your look, your résumé", onPick: () => { location.href = "./coach.html"; } });
    items.push({ name: themeLabel(), why: `Switch from the ${currentTheme()} theme`, onPick: toggleTheme });
    items.push({ heading: "" });
    items.push({ name: "Back to the Top", why: "The full header", onPick: () => window.scrollTo({ top: 0 }) });
    openMenu($("#btn-compact-more"), items, "More");
  }
  // the theme, through the top bar's own button (gameview.js owns it); the entries read as the switch they make
  const currentTheme = () => document.documentElement.dataset.theme || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  const themeLabel = () => (currentTheme() === "light" ? "Dark theme" : "Light theme");
  function toggleTheme() { const b = $(".topbar .btn-theme"); if (b) b.click(); }
  function syncThemeLabels() { const b = $("#btn-sheet-theme"); if (b) b.textContent = themeLabel(); }
  new MutationObserver(syncThemeLabels).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  syncThemeLabels();
  // the Office is where the week moves: open it and put the focus on Sim the week
  function goOffice() {
    if (!state.season || !state.season.career) { state.tab = "schedule"; renderTab(); return; }
    state.tab = "office";
    renderTab();
    window.scrollTo({ top: 0 });
    const b = $("#tab-office .go-play .go-btn.primary");
    if (b) b.focus({ preventScroll: true });
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("head-sheet") && !modalOpen()) closeHeadSheet(); });
  window.matchMedia("(max-width: 759px)").addEventListener("change", () => { if (state.season) { watchHeader(); applyCompact(); } });

  function renderWeekStrip() {
    const s = state.season;
    const strip = $("#week-strip");
    strip.innerHTML = "";
    const weeks = [0, ...s.weeks];
    for (const w of weeks) {
      const label = weekChipLabel(s, w);
      const next = !s.done && w === s.current_week + 1;
      const b = el("button", { type: "button", class: `week-chip ${w === state.viewWeek ? "active" : ""} ${w > s.current_week ? "future" : ""} ${w === s.current_week ? "current" : ""} ${next ? "next" : ""}`, text: label, title: `${s.week_labels[w] || (w === 0 ? "Preseason" : "")} · ${weekDateText(s, w)}`, "aria-label": s.week_labels[w] || (w === 0 ? "Preseason" : `Week ${w}`) });
      b.addEventListener("click", () => { if (state.simming) return; state.viewWeek = w; renderWeekStrip(); renderTab(); });
      if (state.simming) b.disabled = true;   // the strip only follows the sim while it runs
      strip.appendChild(b);
    }
    renderWeekDate();
  }

  // Short week names for the week chips: "Pre", "W5", "CCG", "Sel", "R1", "QF", "SF", "Title"
  function weekChipLabel(s, w) {
    if (w === 0) return "Pre";
    if (w <= 14) return `W${w}`;
    return (s.week_labels[w] || `W${w}`).replace("Championship Week", "CCG").replace("National Championship", "Title").replace("Quarterfinals", "QF").replace("Semifinals", "SF").replace("First Round", "R1").replace("Selection", "Sel");
  }

  // A postseason week's label without the bowl wording, for narrow week columns ("CCG", "Quarterfinals")
  function postseasonLabel(s, w) {
    return (s.week_labels[w] || "").replace("Championship Week", "CCG").replace(" & Bowls", "").replace(" & New Year Bowls", "");
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function parseDay(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
  function shortDay(iso) { const d = parseDay(iso); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; }
  // a career's later seasons replay the 2026 calendar: shown a year on per season, 52 weeks to keep the weekdays
  function fmtDay(iso, withDay = true) { const k = ((state.season && state.season.year) || 2026) - 2026; const d = new Date(parseDay(iso).getTime() + k * 364 * 86400000); return `${withDay ? DAYS[d.getDay()] + ", " : ""}${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; }

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
    else status = "ahead";
    box.append(el("b", { text: label }), el("span", { text: ` · ${weekDateText(s, w)}` }));
    if (status) box.append(el("span", { text: ` · ${status}` }));
  }

  function selectTab(name) {
    state.tab = name;
    for (const b of $("#season-tabs").querySelectorAll("button")) b.classList.toggle("active", b.dataset.tab === name);
    const active = $("#season-tabs button.active");   // one scrolling row: the open tab stays in view
    if (active && !active.hidden && active.scrollIntoView) active.scrollIntoView({ block: "nearest", inline: "nearest" });
    for (const t of ["games", "schedule", "standings", "rankings", "bracket", "bowls", "summary", "awards", "stats", "office", "offseason", "recruiting", "prospects", "scouting", "classes"]) $(`#tab-${t}`).hidden = t !== name;
    document.body.classList.toggle("on-office", name === "office");
    document.body.classList.toggle("on-career-tab", CAREER_TABS.includes(name));
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
    else if (t === "offseason" && window.Offseason) window.Offseason.render(state.season, $("#tab-offseason"), recruitingHelpers);
    else if (t === "office" && window.Recruiting) { window.Recruiting.render(t, state.season, { ...recruitingHelpers, api: officeApi }); officeCarryLine(state.season); }
    else if (CAREER_TABS.includes(t) && window.Recruiting) window.Recruiting.render(t, state.season, recruitingHelpers);
  }

  // Coach Career: the recruiting tabs (recruiting.js) and the week's steps under the header
  const CAREER_TABS = ["offseason", "office", "recruiting", "prospects", "scouting", "classes"];
  // the League row follows the calendar in a career: the bracket and bowls once the field is set
  // (selection week), the awards once the races have a shape, the classes once signing opens,
  // the summary when the season is done; a plain season keeps every tab
  const SELECTION_WEEK = 16, AWARDS_FROM = 4;
  function tabsForTheCalendar(s, career) {
    const show = { bracket: true, bowls: true, awards: true, classes: career };
    if (career) {
      const w = s.current_week || 0;
      show.bracket = show.bowls = s.done || w >= SELECTION_WEEK;
      show.awards = s.done || w >= AWARDS_FROM;
      show.classes = s.done || w >= SELECTION_WEEK;
    }
    for (const [t, on] of Object.entries(show)) $(`#season-tabs button[data-tab=${t}]`).hidden = !on;
    if (state.tab in show && !show[state.tab]) state.tab = career ? "office" : "schedule";
  }
  // what sticks to the top of the screen (the top bar, and a career's tab bar on a wide
  // screen) as --sticky-top, so the board's side panel stops below it rather than under it
  function stickyTop() {
    const h = (n) => (n && getComputedStyle(n).position === "sticky" ? n.getBoundingClientRect().height : 0);
    const top = topbarH(), nav = document.body.classList.contains("career-mode") ? h($("#season-tabs")) : 0;
    const bar = $("#season-compact"), barH = bar && !bar.hidden ? bar.getBoundingClientRect().height : 0;
    document.documentElement.style.setProperty("--topbar-h", `${Math.round(top)}px`);
    document.documentElement.style.setProperty("--compact-h", `${Math.round(barH)}px`);
    document.documentElement.style.setProperty("--sticky-top", `${Math.round(top + nav + barH)}px`);
    if (state.season && compact.io) watchHeader();
  }
  if (window.ResizeObserver) { const ro = new ResizeObserver(stickyTop); ro.observe($(".topbar")); ro.observe($("#season-tabs")); ro.observe($("#season-compact")); }

  // ----- the top bar hides while a season scrolls ---------------------------------------------
  // With a season open the sticky top bar slides up (transform, 160 ms; none under reduced motion)
  // once the page has scrolled past the bar's own height, and --topbar-h goes to 0 with it so the
  // compact bar and the tab row ride up flush at the top. It comes back when the player scrolls up
  // 24 px, reaches the top, puts the pointer in the top 8 px (a mouse), focuses anything in it or
  // opens its Seasons menu; it never hides while that menu is open. No season
  // open, or the bar not sticky (a phone, where it scrolls away itself), and it never hides. The
  // compact ▾ (and the phone's sheet) carry Seasons, Your coach and Theme, so nothing is unreachable.
  const topbar = { hidden: false, lastY: window.scrollY, up: 0 };
  function topbarH() {
    const bar = $(".topbar");
    if (!bar || topbar.hidden || getComputedStyle(bar).position !== "sticky") return 0;
    return bar.getBoundingClientRect().height;
  }
  const topbarCanHide = () => !!state.season && getComputedStyle($(".topbar")).position === "sticky";
  const topbarPinned = () => !!(menuState && $(".topbar").contains(menuState.btn));
  function setTopbarHidden(on) {
    if (topbar.hidden === on) return;
    topbar.hidden = on;
    $(".topbar").classList.toggle("topbar-hidden", on);
    stickyTop();
  }
  function onTopbarScroll() {
    const y = window.scrollY, dy = y - topbar.lastY;
    topbar.lastY = y;
    if (!topbarCanHide()) { setTopbarHidden(false); return; }
    const bar = $(".topbar");
    if (y <= bar.getBoundingClientRect().height) { topbar.up = 0; setTopbarHidden(false); return; }
    if (dy > 0) { topbar.up = 0; if (!topbarPinned()) setTopbarHidden(true); }
    else if (dy < 0) { topbar.up += -dy; if (topbar.up >= 24) setTopbarHidden(false); }
  }
  window.addEventListener("scroll", onTopbarScroll, { passive: true });
  document.addEventListener("pointermove", (e) => { if (topbar.hidden && e.pointerType === "mouse" && e.clientY <= 8) setTopbarHidden(false); }, { passive: true });
  $(".topbar").addEventListener("focusin", () => setTopbarHidden(false));
  // The Office is the only place time moves. play(what, to): "gameday" plays your game drive by
  // drive, "advance" sims the next week (always the next one: the schedule's highlighted week is
  // not in view, so it cannot be the target), "advance_to" sims through week `to`, "selection" to
  // selection day (week 15), "end" to national signing day (week 20, with the title game).
  function play(what, to) {
    const s = state.season;
    if (!s || s.done || state.simming) return;
    const next = (s.schedule || []).find((g) => g.week === s.current_week + 1 && g.opponent);
    if (what === "gameday") {
      if (next && !next.played) playGameDay();
      else toast("No game to play this week: a bye, or it is already played. Sim the week plays the rest of it.", 4000);
    } else if (what === "advance") advance(s.current_week + 1);
    else if (what === "advance_to") { if (to > s.current_week) advance(to); }
    else if (what === "selection") { if (s.current_week < 15) advance(15); }
    else if (what === "end") advance(20);
  }
  // The Office's play card (recruiting.js hands its .go-play to this): Sim the week, Game day while
  // your game is unplayed, Sim to selection day until selection, Sim to signing day, and ▾ with the
  // week picker (sim through a week of your choosing; the recruiting weeks between run on Auto).
  function playCard(s) {
    const next = (s.schedule || []).find((g) => g.week === s.current_week + 1 && g.opponent);
    const gameReady = !!(next && !next.played);
    const btn = (cls, text, title, what) => {
      const b = el("button", { type: "button", class: `go-btn ${cls}`, text, title, "data-play": what });
      window.CFP.ui.on(b, "click", () => play(what));
      return b;
    };
    const week = btn("primary big", "Sim the Week", gameReady ? "Plays every game this week, yours included; the recruiting week runs with it"
      : next && next.played ? "Your game is in the books: this plays the rest of the week" : "Plays every game this week", "advance");
    const game = gameReady ? btn("big2", `Game Day · ${next.venue === "away" ? "at" : "vs"} ${next.opponent_name}`, "Play your game this week, drive by drive; Sim the week then plays the rest of it", "gameday") : null;
    const selection = s.current_week < 15 ? btn("big2", "Sim to Selection Day", `Sim through ${s.week_labels[15] || "selection day"}; the recruiting weeks between run on Auto`, "selection") : null;
    const end = btn("big2", "Sim to Signing Day", "Sim through the title game and national signing day; the recruiting weeks between run on Auto", "end");
    const more = el("button", { type: "button", class: "go-btn big2 go-play-more", text: "▾", "aria-label": "Sim to a week", title: "Sim through a week of your choosing", "aria-haspopup": "menu", "aria-expanded": "false" });
    window.CFP.ui.on(more, "click", () => {
      const items = [{ heading: "Sim Through" }];
      for (let k = s.current_week + 2; k <= 20; k++) items.push({ name: s.week_labels[k] || `Week ${k}`, why: k === 15 ? "Selection day" : k === 20 ? "The title game and national signing day" : "", onPick: () => play("advance_to", k) });
      openMenu(more, items, "Sim to a week");
    });
    return [week, game, selection, end, s.current_week + 2 <= 20 ? more : null].filter(Boolean);
  }
  // the Office's recruiting view, fetched once for the Office and the NIL line (a short memo)
  const officeMemo = { path: null, at: 0, p: null };
  function officeApi(path, options) {
    if (options || !/\/recruiting$/.test(path)) return api(path, options);
    if (officeMemo.p && officeMemo.path === path && Date.now() - officeMemo.at < 3000) return officeMemo.p;
    officeMemo.path = path; officeMemo.at = Date.now(); officeMemo.p = api(path);
    return officeMemo.p;
  }
  // a career's new season: "NIL carried over: 25 (of 135 this year)" in the Office's program card
  async function officeCarryLine(s) {
    if (!s.career || s.done) return;
    let v;
    try { v = await officeApi(`/api/season/${s.id}/recruiting`); } catch (e) { return; }
    const carry = v && v.nil ? Number(v.nil.carry || 0) : 0;
    if (!(carry > 0) || state.season !== s || state.tab !== "office") return;
    for (let i = 0; i < 40 && !$("#tab-office .go-program"); i++) await new Promise((r) => setTimeout(r, 250));   // the program card lands after its own fetch
    const card = $("#tab-office .go-program");
    if (!card || card.querySelector(".go-nil-carry") || state.season !== s) return;
    const head = card.querySelector(".go-program-head");
    const line = el("p", { class: "muted small go-nil-carry", text: `NIL carried over: ${carry} (of ${v.nil.budget} this year)` });
    if (head) head.after(line); else card.prepend(line);
  }
  const recruitingHelpers = { api, postJSON, toast, openModal, closeModal: closeAllModals, errText, play, playCard, openSeason: reopenSeason, onChange: (tab) => { state.tab = tab; renderTab(); window.scrollTo({ top: 0 }); } };
  function renderCareerSteps(s) {
    const box = $("#career-steps");
    const career = !!s.career;
    document.body.classList.toggle("career-mode", career);
    for (const t of CAREER_TABS) $(`#season-tabs button[data-tab=${t}]`).hidden = !career;
    $("#season-tabs button[data-tab=offseason]").hidden = !(career && s.done);   // the offseason opens after national signing day
    // a career's tabs sit above the header, in the same place on every screen (the header
    // changes with the tab); a plain season keeps them under the header
    const nav = $("#season-tabs");
    if (career && nav.previousElementSibling !== $("#season-compact")) $("#season-compact").after(nav);
    else if (!career && nav.previousElementSibling !== $("#season-head-end")) $("#season-head-end").after(nav);
    stickyTop();
    if (!career && CAREER_TABS.includes(state.tab)) state.tab = "schedule";
    // a career opens on the Office
    if (career && state.officeFor !== `${s.id}-${s.year}`) { state.officeFor = `${s.id}-${s.year}`; state.tab = s.done ? "offseason" : "office"; }
    if (state.tab === "offseason" && !(career && s.done)) state.tab = career ? "office" : "schedule";
    tabsForTheCalendar(s, career);
    box.hidden = true;               // the Office shows the week's steps now
    if (box.hidden) return;
    box.innerHTML = "";
    const step = (n, label, onclick) => el("button", { type: "button", class: "ghost career-step", onclick }, [el("b", { text: `${n}` }), ` ${label}`]);
    box.append(step(1, "Recruit", () => { state.tab = "recruiting"; renderTab(); }), el("span", { class: "muted", text: "→" }),
      step(2, "Your Game", () => play("gameday")),
      el("span", { class: "muted", text: "→" }),
      step(3, "Advance", goOffice));   // the Office is where the week moves: open it, the focus on Sim the week
  }

  // ----- stats tab: team stats, player stats and the depth chart under one tab --------

  const statsState = { view: "players" };

  function renderStats() {
    const s = state.season;
    if (!s) return;
    const st = statsState;
    const chips = $("#stats-chips");
    chips.innerHTML = "";
    for (const [v, label] of [["team", "Team Stats"], ["players", "Player Stats"]]) {
      const b = el("button", { type: "button", class: `chip ${st.view === v ? "active" : ""}`, text: label });
      b.addEventListener("click", () => { st.view = v; renderStats(); });
      chips.append(b);
    }
    for (const v of ["teamstats", "playerstats"]) $(`#tab-${v}`).hidden = v !== (st.view === "team" ? "teamstats" : "playerstats");
    if (st.view === "team") renderSeasonTeamStats();
    else renderSeasonPlayerStats();
  }

  // ----- the depth chart: its own screen (web/depth/depth.js) at ?id=…&screen=depth -------
  // Opening it pushes a history entry, so Back returns to the season; its own moves (unit,
  // screen, formation, position) replace that entry, so the URL can be kept or shared as it stands.
  function setDepthParams(params) {
    const q = new URLSearchParams({ id: state.season.id });
    for (const [k, v] of Object.entries(params)) if (v != null) q.set(k, v);
    history.replaceState(history.state, "", `?${q}`);
  }
  function openDepth(params, push = true) {
    if (!state.season || !window.CFPDepth) return;
    if (push) history.pushState({ cfpDepth: true }, "", `?id=${encodeURIComponent(state.season.id)}&screen=depth`);
    window.CFPDepth.open({
      host: $("#depth-screen"), season: () => state.season, teams: () => state.teams, api, postJSON, toast, errText, godMode, openPlayer, openSettings,
      setParams: setDepthParams, close: () => closeDepth(true),
    }, params || new URLSearchParams());
  }

  // back to the season: the history entry the screen pushed is popped (or, opened from a link, replaced)
  function closeDepth(fromScreen) {
    if (!window.CFPDepth || !window.CFPDepth.isOpen()) return;
    window.CFPDepth.close();
    if (fromScreen) {
      if (history.state && history.state.cfpDepth) history.back();
      else history.replaceState(null, "", `?id=${encodeURIComponent(state.season.id)}`);
    }
    renderTab();
  }

  window.addEventListener("popstate", () => {
    if (!window.CFPDepth || !state.season) return;
    const params = new URLSearchParams(location.search);
    const want = params.get("screen") === "depth";
    if (want && !window.CFPDepth.isOpen()) openDepth(params, false);
    else if (!want && window.CFPDepth.isOpen()) closeDepth(false);
  });

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
    // remember what opened it, so focus goes back there when it closes
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    modalStack.push({ layer, pushed, opener });
    layer.querySelector(".modal-close").focus({ preventScroll: true });
  }

  function swapModal(title, node) {
    const top = modalStack[modalStack.length - 1];
    if (!top) { openModal(title, node); return; }
    const t = top.layer.querySelector(".modal-title");
    t.innerHTML = "";
    t.append(typeof title === "string" ? document.createTextNode(title) : title);
    const body = top.layer.querySelector(".modal-body");
    body.innerHTML = "";
    body.append(node);
    body.scrollTop = 0;
    top.layer.querySelector(".modal-close").focus({ preventScroll: true });
  }

  function closeModal(fromHistory = false) {
    const top = modalStack.pop();
    if (!top) return;
    if (top.layer.id === "modal") top.layer.hidden = true;
    else top.layer.remove();
    if (!modalStack.length) document.body.classList.remove("modal-open");
    if (state.afterGameday && gameday.layerNode === top.layer) showAfterGameday();
    // back to what opened it; if that is gone or hidden now (Game day, once played), the next step
    const under = modalStack.length ? modalStack[modalStack.length - 1].layer.querySelector(".modal-close") : ($("#tab-office .go-play .go-btn.primary") || $("#btn-settings"));
    const back = [top.opener, under].find((n) => n && n.isConnected && n.offsetParent !== null && !n.disabled);
    if (back) back.focus({ preventScroll: true });
    // going back in history fires popstate, which must not close a second layer
    if (!fromHistory && top.pushed) { modalSkipPop = true; history.back(); }
  }
  let modalSkipPop = false;

  function closeAllModals() {
    while (modalStack.length) closeModal();
  }

  const modalOpen = () => modalStack.length > 0;
  window.addEventListener("popstate", () => { if (modalSkipPop) { modalSkipPop = false; return; } if (modalOpen()) closeModal(true); });
  document.addEventListener("keydown", (e) => {
    if (!modalOpen()) return;
    if (e.key === "Escape") { closeModal(); return; }
    if (e.key !== "Tab") return;
    // keep Tab inside the top dialog: the page behind it is covered
    const panel = modalStack[modalStack.length - 1].layer.querySelector(".modal-panel") || modalStack[modalStack.length - 1].layer;
    const items = [...panel.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  });
  $("#modal-backdrop").addEventListener("click", () => closeModal());
  $("#modal-close").addEventListener("click", () => closeModal());

  // ----- player profiles ------------------------------------------------------
  // Any element with data-player="team|name|position" opens the player's page. The page
  // is its own tab (like the box score) with a Back button to the tab you came from.

  const playerState = { back: null, cache: new Map() };
  const STAT_GROUPS = [
    ["Passing", [["pass_attempts", "Att"], ["completions", "Cmp"], ["pass_yards", "Yds"], ["passing_touchdowns", "TD"], ["interceptions_thrown", "INT"], ["sacks_taken", "Sacked"], ["passing_first_downs", "1st Downs"], ["long_pass", "Long"]]],
    ["Rushing", [["carries", "Car"], ["rush_yards", "Yds"], ["rushing_touchdowns", "TD"], ["explosive_runs", "20+"], ["rushing_first_downs", "1st Downs"], ["long_rush", "Long"], ["fumbles", "Fum"]]],
    ["Receiving", [["targets", "Tgt"], ["receptions", "Rec"], ["receiving_yards", "Yds"], ["receiving_touchdowns", "TD"], ["explosive_catches", "25+"], ["receiving_first_downs", "1st Downs"], ["long_reception", "Long"]]],
    ["Defense", [["solo_tackles", "Solo"], ["assisted_tackles", "Ast"], ["tackles_for_loss", "TFL"], ["sacks", "Sacks"], ["hurries", "Hurries"], ["interceptions", "INT"], ["interception_return_yards", "INT Yds"], ["passes_defended", "PBU"], ["forced_fumbles", "FF"], ["fumble_recoveries", "FR"], ["defensive_touchdowns", "TD"]]],
    ["Blocking", [["snaps", "Snaps"], ["games_started", "Starts"], ["key_blocks", "Key Blocks"], ["sacks_allowed", "Sacks Allowed"], ["pressures_allowed", "Pressures"], ["stuffs_allowed", "Stuffs"]]],
    ["Kicking", [["fg_made", "FGM"], ["fg_attempted", "FGA"], ["fg_40_made", "40-49 Made"], ["fg_50_made", "50+ Made"], ["long_fg", "Long"], ["pat_made", "PAT"], ["pat_attempts", "PAT Att"]]],
    ["Punting", [["punts", "Punts"], ["punt_yards", "Yds"], ["punt_net_yards", "Net Yds"], ["punts_inside_20", "Inside 20"], ["punt_touchbacks", "TB"], ["long_punt", "Long"]]],
    ["Returns", [["kickoff_returns", "KR"], ["kickoff_return_yards", "KR Yds"], ["kickoff_return_touchdowns", "KR TD"], ["long_kickoff_return", "KR Long"], ["punt_returns", "PR"], ["punt_return_yards", "PR Yds"], ["punt_return_touchdowns", "PR TD"], ["long_punt_return", "PR Long"]]],
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
      catch (err) { toast(`Could not load that player: ${errText(err)}`, 3000); return; }
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
    else if (pos === "OL") tiles = [["Snaps", `${n("snaps")}`], ["Starts", `${n("games_started")}`], ["Sacks Allowed", `${n("sacks_allowed")}`], ["Pressures", `${n("pressures_allowed")}`], ["Key Blocks", `${n("key_blocks")}`], ["Stuffs", `${n("stuffs_allowed")}`]];
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

    // header: back link, hero in team colors
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
    const bigPill = teamPill(team.slug);
    bigPill.classList.add("big");
    hero.append(
      el("div", { class: "player-hero-main" }, [
        bigPill,
        el("div", {}, [
          el("div", { class: "player-name" }, [p.jersey ? el("span", { class: "player-jersey", text: `#${p.jersey} ` }) : null, p.name, recruit]),
          el("div", { class: "muted player-facts", text: facts.join(" · ") }),
          el("div", { class: "player-tags" }, [
            p.starter ? el("span", { class: "tag good", text: "Starter" }) : el("span", { class: "tag", text: p.depth ? `${p.role || p.position} #${p.depth}` : "Reserve" }),
            p.injured && !(p.redshirt && p.redshirt.on) ? el("span", { class: "tag bad", text: "Injured" }) : null,
            p.redshirt && p.redshirt.on ? el("span", { class: "tag", text: "Redshirting", title: "Sitting out the rest of the season; keeps his year" }) : null,
            p.morale && p.morale.enabled && p.morale.label !== "Steady" ? el("span", { class: `tag ${p.morale.label === "Hot streak" ? "good hot" : "bad cold"}`, text: `${p.morale.label === "Hot streak" ? "🔥" : "❄"} ${p.morale.label}`, title: `Form ${p.morale.form > 0 ? "+" : ""}${p.morale.form}: his recent games against his season so far` }) : null,
            p.morale && p.morale.enabled && p.morale.team_label ? el("span", { class: `tag ${p.morale.team > 0 ? "good" : "bad"}`, text: p.morale.team_label, title: `Team mood ${p.morale.team > 0 ? "+" : ""}${p.morale.team}` }) : null,
            // rest-of-season seasons: what the real 2026 box scores say about him against his rating
            p.form ? el("span", { class: `tag ${p.form.shift > 0 ? "good" : "bad"}`, text: `${p.form.shift > 0 ? "📈" : "📉"} Box scores ${p.form.shift > 0 ? "+" : ""}${Math.round(p.form.shift)}`, title: `Real 2026 box scores: ${p.form.note}. The rating shift is informational unless player form is switched on.` }) : null,
            p.games ? el("span", { class: "tag", text: `${p.games} of ${p.team_games} games` }) : el("span", { class: "tag", text: "No Games Yet" }),
          ]),
          devTag ? el("div", { class: "player-dev" }, [devTag]) : null,
          (p.archetype || (p.traits || []).length) ? el("div", { class: "player-traits" }, [
            p.archetype ? el("span", { class: "tag style", text: p.archetype, title: "Play style" }) : null,
            ...(p.traits || []).map((tr) => el("span", { class: `trait tier-${tr.tier}`, text: tr.name, title: traitHover(tr) })),
          ]) : null,
        ]),
      ]),
      el("div", { class: "player-ovr" }, [el("div", { class: "player-ovr-num", text: String(p.overall) }), el("div", { class: "review-label", text: "Overall" })]),
    );
    box.append(hero);

    // headline tiles
    const tiles = headlineTiles(p);
    if (tiles.length && p.games) box.append(el("div", { class: "review-tiles player-tiles" }, tiles.map(([k, v]) => bigTile(k, v))));

    const grid = el("div", { class: "player-grid" });
    // ratings
    const edited = new Set(p.edited || []);
    const editBtn = godMode() && !s.done ? el("button", { type: "button", class: "ghost small player-edit-open", text: "Edit", title: "God mode: change the ratings and identity" }) : null;
    const keySet = new Set(p.key_ratings || []);
    const shown = keySet.size ? p.ratings.filter((r) => keySet.has(r.key)).sort((a, b) => p.key_ratings.indexOf(a.key) - p.key_ratings.indexOf(b.key)) : p.ratings;
    const attrs = p.attributes || [];
    const allBtn = el("button", { type: "button", class: "ghost small", text: attrs.length ? "What they do" : `All ratings (${p.ratings.length})`,
      title: attrs.length ? "What each attribute does, his traits, and how he rates at other positions" : "Every rating he carries, and how he rates at other positions" });
    allBtn.addEventListener("click", () => openAllRatings(p));
    const editedAttrs = new Set(p.edited_attributes || []);
    const nEdited = attrs.length ? editedAttrs.size : edited.size;
    const rat = el("div", { class: "leader-card player-card" }, [el("div", { class: "leader-head" }, [el("h4", { text: attrs.length ? `${p.position} attributes (${attrs.length})` : `${p.position} ratings` }), el("span", { class: "muted small-text", text: nEdited ? `edited in god mode (${nEdited})` : "50 = average Power 4 starter · green 75+, red under 55" }), el("span", { class: "card-actions" }, [allBtn, editBtn])])]);
    if (editBtn) editBtn.addEventListener("click", () => { editBtn.hidden = true; rat.append(playerEditForm(p, rat)); });
    if (attrs.length) {
      // ratings v2: grouped, physical first, each with what it does on hover
      for (const g of [...new Set(attrs.map((a) => a.group))]) {
        rat.append(el("div", { class: "attr-group", text: g }));
        for (const a of attrs.filter((x) => x.group === g)) {
          const boost = a.boost ? el("span", { class: `boost ${a.boost > 0 ? "up" : "down"}`, text: `${a.boost > 0 ? "▲" : "▼"}${Math.abs(a.boost)}` }) : null;
          rat.append(el("div", { class: `rating-row ${editedAttrs.has(a.key) ? "edited" : ""} ${a.boost ? "boosted" : ""}` }, [
            el("span", { class: "rating-label", text: a.label, title: `${a.about}${editedAttrs.has(a.key) ? " (edited in god mode)" : ""}` }),
            ratingBar(a.value),
            el("b", { class: "rating-num" }, [String(a.value), boost])]));
        }
      }
    }
    for (const r of attrs.length ? [] : shown) {
      const boost = r.boost ? el("span", { class: `boost ${r.boost > 0 ? "up" : "down"}`, text: `${r.boost > 0 ? "▲" : "▼"}${Math.abs(r.boost)}`, title: `${r.boost > 0 ? "+" : ""}${r.boost} from ${p.morale && p.morale.label !== "Steady" ? p.morale.label.toLowerCase() : "morale"}${p.morale && p.morale.team_label ? " and the team's mood" : ""}` }) : null;
      rat.append(el("div", { class: `rating-row ${edited.has(r.key) ? "edited" : ""} ${r.boost ? "boosted" : ""}` }, [el("span", { class: "rating-label", text: r.label, title: edited.has(r.key) ? "Edited in god mode" : "" }), ratingBar(r.value), el("b", { class: "rating-num" }, [String(r.value), boost])]));
    }
    if (p.morale && p.morale.enabled && (attrs.length ? attrs : p.ratings).some((r) => r.boost)) rat.append(el("div", { class: "muted small-text", style: "margin-top:6px", text: `Arrows: how his ratings enter the next game (${p.morale.label.toLowerCase()}${p.morale.team_label ? ", " + p.morale.team_label.toLowerCase() : ""}).` }));
    const others = Object.entries(p.ratings_at || {}).filter(([pos]) => pos !== p.position && !(pos === "MLB" && /LB$/.test(p.position))).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (others.length) rat.append(el("div", { class: "muted small-text", style: "margin-top:8px", text: `Rated at other spots: ${others.map(([pos, v]) => `${pos} ${v}`).join(" · ")}` }));
    grid.append(rat);

    // ranks
    const rk = el("div", { class: "leader-card player-card" }, [el("div", { class: "leader-head" }, [el("h4", { text: "Where He Ranks" }), el("span", { class: "muted small-text", text: p.ranks.length ? "FBS · conference" : "" })])]);
    if (!p.ranks.length) rk.append(el("p", { class: "muted small-text", text: p.games ? "Not enough games to rank yet." : "No games played yet." }));
    for (const r of p.ranks) {
      rk.append(el("div", { class: "leader-row" }, [
        el("span", { class: "rank", text: "" }),
        el("span", { class: "who" }, [el("span", { class: "name", text: r.label }), el("span", { class: "muted small-text", text: `${ordinal(r.fbs_rank)} of ${r.fbs_n} in FBS · ${ordinal(r.conf_rank)} of ${r.conf_n} in the ${team.conference}` })]),
        el("span", { class: `value ${r.fbs_rank <= 10 ? "top" : ""}`, text: String(r.value) }),
      ]));
    }
    grid.append(rk);
    box.append(grid);

    // season totals by group
    const used = STAT_GROUPS.filter(([, cols]) => cols.some(([k]) => p.stats[k]));
    if (used.length) {
      box.append(el("h3", { text: "Season Totals" }));
      const wrap = el("div", { class: "player-grid" });
      for (const [title, cols] of used) {
        const shown = cols.filter(([k]) => p.stats[k] != null && p.stats[k] !== 0);
        const table = el("table", { class: "stats" });
        table.append(el("tr", {}, [el("th", { class: "left", text: title === "Blocking" && p.position !== "OL" ? "Playing Time" : title }), ...shown.map(([, lbl]) => el("th", { text: lbl }))]));
        table.append(el("tr", {}, [el("td", { class: "left muted", text: "Total" }), ...shown.map(([k]) => el("td", { text: fmtStatValue(p.stats[k]) }))]));
        if (p.games > 1) table.append(el("tr", {}, [el("td", { class: "left muted", text: "Per Game" }), ...shown.map(([k]) => el("td", { class: "muted", text: /^long_/.test(k) ? "" : (p.stats[k] / p.games).toFixed(1) }))]));
        wrap.append(el("div", { class: "table-scroll" }, [table]));
      }
      box.append(wrap);
    }

    // a career: redshirt him for the rest of the season (four games or fewer), or take him off it
    if (p.redshirt && (p.redshirt.on || p.redshirt.can)) {
      const rsBtn = el("button", { type: "button", class: "ghost small", text: p.redshirt.on ? "Take him off the redshirt" : `Redshirt him (${p.redshirt.games} of ${p.redshirt.limit} games played)`,
        title: p.redshirt.on ? "He plays again; the year is still his if he stays at four games or fewer" : "He sits out every remaining game and keeps his year of eligibility" });
      rsBtn.addEventListener("click", async () => {
        rsBtn.disabled = true;
        try {
          await api(`/api/season/${s.id}/redshirt`, postJSON({ team: p.team.slug, player: p.slug, on: !p.redshirt.on }));
          toast(p.redshirt.on ? `${p.name} is back in the lineup.` : `${p.name} is redshirting.`, 3000);
          playerState.cache.clear(); if (window.CFPDepth) window.CFPDepth.refresh(); closeAllModals(); openPlayer(p.team.slug, p.name, p.position);
        } catch (err) { toast(`Could not do that: ${errText(err)}`, 4000); rsBtn.disabled = false; }
      });
      box.append(el("div", { class: "player-redshirt" }, [rsBtn, p.redshirt.on ? null : el("span", { class: "muted small-text", text: " Four games or fewer keeps the year." })]));
    }

    // past seasons (a career keeps every player's lines on his league entry)
    const hist = p.history || [];
    if (hist.length) {
      box.append(el("h3", { text: "Season by Season" }));
      const wrap = el("div", { class: "player-grid" });
      const rows = [...hist.map((h) => ({ label: `${h.year} · ${h.team_name}${h.class ? ` · ${CLASS_LABEL[h.class] || h.class}` : ""}`, games: h.games, stats: h.stats, past: true })),
                    { label: `${(state.season && state.season.year) || ""} · ${(p.team && p.team.name) || ""} · Now`, games: p.games, stats: p.stats, past: false }];
      for (const [title, cols] of STAT_GROUPS) {
        const shown = cols.filter(([k]) => rows.some((r) => r.stats && r.stats[k]));
        if (!shown.length) continue;
        const table = el("table", { class: "stats" });
        table.append(el("tr", {}, [el("th", { class: "left", text: title === "Blocking" && p.position !== "OL" ? "Playing Time" : title }), el("th", { text: "G" }), ...shown.map(([, lbl]) => el("th", { text: lbl }))]));
        const used = rows.filter((r) => shown.some(([k]) => r.stats && r.stats[k]));
        for (const r of used) {
          table.append(el("tr", { class: r.past ? "" : "now" }, [el("td", { class: `left ${r.past ? "muted" : ""}`, text: r.label }), el("td", { text: String(r.games || 0) }), ...shown.map(([k]) => el("td", { text: r.stats && r.stats[k] != null ? fmtStatValue(r.stats[k]) : "" }))]));
        }
        if (used.length > 1) {                              // career: totals, longs as the best
          const tot = {};
          for (const r of used) for (const [k] of shown) { const v = (r.stats || {})[k] || 0; tot[k] = /^long_/.test(k) ? Math.max(tot[k] || 0, v) : (tot[k] || 0) + v; }
          table.append(el("tr", { class: "career" }, [el("td", { class: "left", text: "Career" }), el("td", { text: String(used.reduce((a, r) => a + (r.games || 0), 0)) }), ...shown.map(([k]) => el("td", { text: fmtStatValue(tot[k]) }))]));
        }
        wrap.append(el("div", { class: "table-scroll" }, [table]));
      }
      box.append(wrap);
      const past = hist.filter((h) => h.honors && h.honors.length);
      if (past.length) box.append(el("p", { class: "small-text" }, [el("b", { text: "Past honors: " }), past.map((h) => `${h.year}: ${h.honors.map((x) => x.name).join(", ")}`).join(" · ")]));
    }

    // game log
    box.append(el("h3", { text: "Game Log" }));
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

  // A 1-99 rating as a bar: the fill is the value out of 100 (at least a sliver), colored by tier.
  function ratingBar(value) {
    const pct = Math.max(2, Math.min(100, value));
    let tone = "lo";
    if (value >= 75) tone = "hi";
    else if (value >= 55) tone = "mid";
    return el("div", { class: "rating-bar" }, [el("div", { class: `rating-fill ${tone}`, style: `width:${pct}%` })]);
  }

  // A headline number with its label underneath (and an optional note), for rows of review tiles.
  function bigTile(label, value, sub) {
    return el("div", { class: "review-tile" }, [el("div", { class: "review-leader-big", text: value }), el("div", { class: "review-label", text: label }), sub ? el("div", { class: "muted small-text", text: sub }) : null]);
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
    else if (pos === "OL") cols = [["Snaps", (st) => n(st, "snaps")], ["Sacks All.", (st) => n(st, "sacks_allowed")], ["Pressures", (st) => n(st, "pressures_allowed")], ["Key Blocks", (st) => n(st, "key_blocks")]];
    else if (DEF_POS.has(pos)) cols = [["Tkl", (st) => n(st, "solo_tackles") + n(st, "assisted_tackles")], ["TFL", (st) => n(st, "tackles_for_loss")], ["Sacks", (st) => n(st, "sacks")], ["INT", (st) => n(st, "interceptions")], ["PBU", (st) => n(st, "passes_defended")], ["FF", (st) => n(st, "forced_fumbles")]];
    else if (pos === "K") cols = [["FG", (st) => `${n(st, "fg_made")}/${n(st, "fg_attempted")}`], ["Long", (st) => n(st, "long_fg")], ["PAT", (st) => `${n(st, "pat_made")}/${n(st, "pat_attempts")}`]];
    else if (pos === "P") cols = [["Punts", (st) => n(st, "punts")], ["Avg", (st) => n(st, "punts") ? (n(st, "punt_yards") / n(st, "punts")).toFixed(1) : "–"], ["In 20", (st) => n(st, "punts_inside_20")]];
    else cols = [["Snaps", (st) => n(st, "snaps")]];
    const table = el("table", { class: "stats" });
    table.append(el("tr", {}, [el("th", { text: "Wk" }), el("th", { class: "left", text: "Opponent" }), el("th", { text: "Result" }), ...cols.map(([lbl]) => el("th", { text: lbl }))]));
    for (const g of p.game_log) {
      const row = el("tr", { class: "clickable" }, [
        el("td", { class: "muted", text: g.week > 14 ? postseasonLabel(s, g.week) : String(g.week) }),
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

  // depth-chart roles worth showing after the position (an OT as LT, a linebacker as MIKE)
  const ROLE_SHOWN = new Set(["LT", "LG", "C", "RG", "RT", "LEDG", "REDG", "DT", "SAM", "MIKE", "WILL", "FS", "SS"]);

  function who(c, withTeam = true) {
    // name, position/class, team pill
    const bits = [teamPill(c.team), el("b", { text: c.name || c.coach || c.team_name, ...(c.name ? playerAttrs(c.team, c.name, c.position) : {}) })];
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
      el("div", { class: "muted small-text", text: live || !w.final_line ? w.line : `At the vote: ${w.line}` }),
      !live && w.final_line ? el("div", { class: "muted small-text", text: `Final season, with the bowls and playoff: ${w.final_line}` }) : null,
      el("div", { class: "review-tiles" }, tiles.map(([k, v]) => bigTile(k, String(v)))),
      live ? null : el("div", { class: "muted small-text", text: `Finalists in New York: ${h.finalists.map((f) => `${f.name} (${f.team_name}, ${f.points})`).join(", ")}` }),
    ]);
  }

  function heismanView(box, h, live) {
    if (!h || !h.candidates || !h.candidates.length) { box.append(el("p", { class: "muted", text: "No Heisman race yet. Advance a week." })); return; }
    box.append(heismanHero(h, live));
    box.append(el("p", { class: "muted small-text", text: live
      ? `Straw poll of the Heisman electorate on the season so far: ${h.ballots} ballots, three names each, 3-2-1 points. Click a column to sort.`
      : `${h.ballots} ballots (870 media voters in six regions, the past winners and the fan vote), three names each, 3-2-1 points. The vote is in selection week, so the lines voters saw stop at championship week; bowl and playoff games come after it. Click a column to sort.` }));
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
      { key: "line", label: live ? "Season" : "At the Vote", left: true, ph: true, get: (c) => el("span", { class: "muted small-text", text: c.line }) },
    ];
    // after the playoff starts: the line the voters saw (through championship week) and the season as it ended
    if (!live && h.candidates.some((c) => c.final_line)) {
      cols.push({ key: "final", label: "Final Season", left: true, ph: true, get: (c) => el("span", { class: "muted small-text", text: c.final_line || c.line }) });
    }
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
    if ((levels || 1) > 1) box.append(chipRow([[1, "First Team"], [2, "Second Team"], [3, "Third Team"]].slice(0, levels), level, (v) => { st.level = v; renderAwards(); }));
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
      try { awardsState.data = await api(`/api/season/${s.id}/awards`); awardsState.key = key; awardsState.sort = null; } catch (err) { box.append(el("p", { class: "muted", text: `Could not load this: ${errText(err)}` })); return; }
    }
    const d = awardsState.data;
    const st = awardsState;
    const live = !d.national;
    const nat = live ? d.race : d.national;
    if (st.conf === null) st.conf = d.my_conference;
    const views = [["mine", "My Team"], ["heisman", "Heisman"], ["national", "National Awards"], ["coaches", "Coach Awards"],
                   ["allamerica", "All-America"], ["conference", "Conference Awards"]].filter(([v]) => !(live && v === "allamerica") && (v !== "mine" || s.team));
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
      const filters = [["", "All"], ["offense", "Offense"], ["defense", "Defense"], ["special", "Special Teams"], ["poy", "Player of the Year"], ["table", "Table View"]];
      box.append(chipRow(filters, st.filter, (f) => { st.filter = f; st.sort = null; renderAwards(); }));
      const kindOf = (a) => (["mvp", "mvp_team", "freshman"].includes(a.kind) ? "poy" : OFFENSE_KINDS.has(a.kind) ? "offense" : DEFENSE_KINDS.has(a.kind) ? "defense" : ST_KINDS.has(a.kind) ? "special" : "poy");
      const items = st.filter && st.filter !== "table" ? all.filter((a) => kindOf(a) === st.filter) : all;
      if (st.filter === "table") box.append(awardSummaryTable(items, live, st));
      else box.append(awardGrid(items, live, null));
      return;
    }

    if (v === "coaches") {
      const all = [...(nat ? nat.coach_awards : []), ...(!live && d.postseason ? d.postseason.awards.filter((a) => a.kind === "coach") : [])];
      box.append(chipRow([["", "Cards"], ["table", "Table View"]], st.filter, (f) => { st.filter = f; st.sort = null; renderAwards(); }));
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
      for (const a of (nat ? nat.awards : [])) (a.race || []).forEach((c, i) => { if (c.team === s.team) rows.push({ stage: "National Awards", award: a.name, who: c.name, position: c.position, place: `${ORD(i)} of 5`, rank: i + 1, line: c.line }); });
      for (const a of (nat ? nat.coach_awards : [])) (a.finalists || []).forEach((c, i) => { if (c.team === s.team) rows.push({ stage: "Coach Awards", award: a.name, who: c.coach, position: c.role || "Head coach", place: ORD(i), rank: i + 1, line: coachLine(c) }); });
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
    box.append(el("div", { class: "review-tiles" }, [[String(shown.length), "honors"], [String(wins), live ? "races led" : "awards won"], [String(new Set(shown.map((r) => r.who)).size), "players and coaches"]].map(([v, k]) => bigTile(k, v))));
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
    try { r = await api(`/api/season/${s.id}/review`); } catch (err) { box.append(el("p", { class: "muted", text: `Could not load this: ${errText(err)}` })); return; }
    const m = r.mine;
    const pill = (slug) => teamPill(slug);
    const team = (slug, text, cls = "") => el("span", { class: `review-team ${cls}` }, [pill(slug), text]);
    const weekName = (w) => s.week_labels[w] || `Week ${w}`;
    if (s.heisman && s.heisman.winner) {
      const w = s.heisman.winner;
      const card = el("div", { class: `review-card heisman ${w.team === s.team ? "mine" : ""}` }, [
        el("div", { class: "review-label", text: "Heisman Trophy" }),
        el("div", { class: "review-big" }, [teamPill(w.team), w.name, el("span", { class: "pos", text: `${w.position} · ${w.team_name}` })]),
        el("div", { class: "muted small-text", text: `${w.line} at the vote · ${w.points} points, ${s.heisman.share}% of the possible points` }),
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
      if (g.has_box) { row.classList.add("clickable"); row.addEventListener("click", () => openBox(g.event_id)); }
      return row;
    };
    const bowlOf = (g) => g.title ? g.title.replace(/ \((Quarterfinal|Semifinal)\)/, "").replace("College Football Playoff National Championship", "") : "";

    // ---- hero: champion and your season ----
    const hero = el("div", { class: "review-hero" });
    const champ = el("div", { class: "review-card" }, [el("div", { class: "review-label", text: r.done ? "National Champion" : "National Championship" })]);
    if (r.champion_name) {
      champ.append(el("div", { class: "review-big" }, [pill(r.champion), r.champion_name]));
      if (r.title_game) champ.append(...[gameRow(r.title_game), r.title_game.site ? el("div", { class: "muted small-text", text: r.title_game.site }) : null].filter(Boolean));
    } else {
      champ.append(el("div", { class: "review-big muted", text: "Not decided yet" }), el("div", { class: "muted small-text", text: r.title_game && r.title_game.site ? `${r.title_game.site} · January 25` : "January 25, 2027" }));
    }
    hero.append(champ);

    const mineCard = el("div", { class: "review-card mine" }, [el("div", { class: "review-label", text: "Your Season" })]);
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
      const sec = el("div", {}, [el("h3", { text: "Conference Champions" })]);
      const t = el("table", { class: "stats review-table" });
      t.append(el("tr", {}, [el("th", { text: "Conference", style: "text-align:left" }), el("th", { text: "Champion", style: "text-align:left" }), el("th", { text: "Title Game", style: "text-align:left" })]));
      for (const c of r.champions) {
        const g = c.game;
        const line = g && g.played ? `${g.winner === g.home ? g.home_name : g.away_name} ${Math.max(g.home_score, g.away_score)}, ${g.winner === g.home ? g.away_name : g.home_name} ${Math.min(g.home_score, g.away_score)}` : "";
        const tr = el("tr", { class: `${c.team === m.team ? "mine" : ""} ${g && g.has_box ? "clickable" : ""}` }, [el("td", { class: "muted", text: c.conference }), el("td", {}, [team(c.team, c.name)]), el("td", { class: "muted", text: line })]);
        if (g && g.has_box) tr.addEventListener("click", () => openBox(g.event_id));
        t.append(tr);
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
      // by default the note names the game (a bowl, a title game) or else the week
      if (note === undefined) {
        if (!l.title) note = weekName(l.week);
        else note = l.title !== label ? l.title : "";
      }
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
    for (const x of [resultRow(m.best_win, "Best Win"), resultRow(m.worst_loss, "Worst Loss"), resultRow(m.biggest_win, "Biggest Win"), resultRow(m.closest_loss, "Closest Loss")]) if (x) high.append(x);
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
      const wk = (w) => (w <= 14 ? `Week ${w}` : (s.week_labels[w] || `week ${w}`).toLowerCase().replace("selection", "selection day"));
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
    // one leader card; national leaders also name the player's team
    const leaderCard = (withTeam) => (title, p, big, line) => p ? el("div", { class: "review-leader" }, [
      el("div", { class: "review-label", text: title }),
      el("div", { class: "review-leader-name" }, [p.name, el("span", { class: "pos", text: p.position })]),
      withTeam ? el("div", { class: "small-text" }, [team(p.team, p.team_name)]) : null,
      el("div", { class: "review-leader-big", text: big(p) }),
      el("div", { class: "muted small-text", text: line(p) }),
    ]) : null;
    const leader = leaderCard(false);
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
      box.append(el("h3", { text: `${m.name} Leaders${L.games_with_stats < (m.wins + m.losses) ? ` · ${L.games_with_stats} simulated games` : ""}` }));
      box.append(el("div", { class: "review-leaders" }, leaders));
    }

    // ---- national leaders ----
    const N = r.national_leaders || {};
    const nat = leaderCard(true);
    const national = [
      nat("Passing Yards", N.passing, (p) => `${st(p, "pass_yards").toLocaleString()} yds`, (p) => `${st(p, "completions")}/${st(p, "pass_attempts")} (${pct(st(p, "completions"), st(p, "pass_attempts"))}) · ${st(p, "passing_touchdowns")} TD · ${st(p, "interceptions_thrown")} INT · ${p.games} g`),
      nat("Rushing Yards", N.rushing, (p) => `${st(p, "rush_yards").toLocaleString()} yds`, (p) => `${st(p, "carries")} carries · ${(st(p, "rush_yards") / Math.max(1, st(p, "carries"))).toFixed(1)} avg · ${st(p, "rushing_touchdowns")} TD · ${p.games} g`),
      nat("Receiving Yards", N.receiving, (p) => `${st(p, "receiving_yards").toLocaleString()} yds`, (p) => `${st(p, "receptions")} catches · ${(st(p, "receiving_yards") / Math.max(1, st(p, "receptions"))).toFixed(1)} avg · ${st(p, "receiving_touchdowns")} TD · ${p.games} g`),
      nat("Tackles", N.tackles, (p) => `${st(p, "tackles")} tackles`, (p) => `${st(p, "solo_tackles")} solo · ${st(p, "assisted_tackles")} assisted · ${p.games} g`),
      nat("Sacks", N.sacks, (p) => `${st(p, "sacks")} sacks`, (p) => `${st(p, "solo_tackles") + st(p, "assisted_tackles")} tackles · ${st(p, "forced_fumbles")} forced fumbles · ${p.games} g`),
      nat("Interceptions", N.interceptions, (p) => `${st(p, "interceptions")} INT`, (p) => `${st(p, "interception_return_yards")} return yds · ${st(p, "defensive_touchdowns")} TD · ${p.games} g`),
      nat("Scoring (kickers)", N.kicking, (p) => `${st(p, "points")} points`, (p) => `${st(p, "fg_made")}/${st(p, "fg_attempted")} FG · ${st(p, "pat_made")}/${st(p, "pat_attempts")} PAT · ${p.games} g`),
    ].filter(Boolean);
    if (national.length) {
      box.append(el("h3", { text: r.done ? "National leaders" : "National leaders so far" }));
      box.append(el("div", { class: "review-leaders" }, national));
    } else if (r.done || r.current_week > 0) {
      box.append(el("h3", { text: "National Leaders" }), el("p", { class: "muted small-text", text: "This season was simulated before league-wide stats were kept; start a new season to see national leaders." }));
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
      el("option", { value: "date", text: "By Date" }), el("option", { value: "bowl", text: "By Bowl Name" }),
      el("option", { value: "team", text: "By Team" }), el("option", { value: "conference", text: "By Conference" }),
    ]);
    sortSel.value = bowlsState.sort;
    sortSel.addEventListener("change", () => { bowlsState.sort = sortSel.value; renderBowls(); });
    const confSel = el("select", { "aria-label": "Conference" }, [el("option", { value: "", text: "All Conferences" }), ...confs.map((c) => el("option", { value: c, text: c }))]);
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

  function pollWeekFor(view, kind) {
    // the poll shown for a week is the one released after that week's games: the latest of that
    // kind (the committee's last ranking is selection day's; it stays through the bowls and the offseason)
    const s = state.season;
    const has = (w) => s.polls[String(w)] && (!kind || kind === "resume" || s.polls[String(w)][kind]);
    let w = Math.min(view, s.current_week);
    while (w > 0 && !has(w)) w--;
    return w;
  }

  const gamesState = { conf: "", view: "" };

  async function renderGames(container) {
    const s = state.season, w = state.viewWeek;
    if (container) gamesState.container = container;
    const box = gamesState.container && gamesState.container.isConnected ? gamesState.container : $("#tab-games");
    box.innerHTML = "";
    const token = gamesState.token = (gamesState.token || 0) + 1;   // a newer render wins if the weeks change mid-load (Preseason too)
    if (w === 0) { box.append(el("p", { class: "muted", text: "Preseason. Advance a week to play games." })); return; }
    const label = s.week_labels[w] || `Week ${w}`;
    box.append(el("p", { class: "muted loading-note", text: `Loading ${label} games…` }));
    let data;
    try { data = await api(`/api/season/${s.id}/week/${w}`); }
    catch (err) { if (token === gamesState.token) { box.innerHTML = ""; box.append(el("p", { class: "muted", text: `Could not load ${label}: ${errText(err)}` })); } return; }
    if (token !== gamesState.token) return;
    box.innerHTML = "";
    if (!data.games.length) { box.append(el("h3", { text: `${label} · 0 Games` })); box.append(el("p", { class: "muted", text: w > s.current_week ? "Not played yet." : "No games this week." })); return; }
    // filters: conference chips, then a view chip (ranked, top-25 matchups, upsets, close games, overtime, conference games, my team)
    const gs = gamesState;
    const confOf = (slug) => { const t = window.CFP.teamsBySlug[slug]; return t && !t.fictional ? (t.conference || "") : ""; };
    const confs = [...new Set(data.games.flatMap((g) => [confOf(g.home), confOf(g.away)]).filter(Boolean))].sort();
    const controls = el("div", { class: "stats-controls" });
    controls.append(confChips(confs, confs.includes(gs.conf) ? gs.conf : "", (v) => { gs.conf = v; renderGames(); }));
    const views = [["", "All"], ["ranked", "Ranked"], ["top25", "Top-25 Matchups"], ["upsets", "Upsets"], ["close", "Close Games"], ["ot", "Overtime"], ["conf", "Conference Games"], ...(s.team ? [["mine", "My Team"]] : [])];
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
    box.append(el("h3", { text: `${label} · ${shown.length === data.games.length ? `${data.games.length} Games` : `${shown.length} of ${data.games.length} Games`}` }));
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
    box.append(el("h3", { text: `Injury Report · ${s.team_name}` }));
    if (!mine.length) box.append(el("p", { class: "muted small-text", text: "Nobody out this week." }));
    else box.append(injuryTable(mine, false));
    const head = el("div", { class: "leader-head" }, [el("h4", { text: `Around the League · ${s.injury_count || 0} Players Out` }), el("span", { class: "muted small-text", text: "Show" })]);
    const holder = el("div", { hidden: true });
    head.addEventListener("click", async () => {
      holder.hidden = !holder.hidden;
      head.querySelector(".small-text").textContent = holder.hidden ? "show" : "hide";
      if (!holder.hidden && !holder.children.length) {
        try { const j = await api(`/api/season/${s.id}/injuries`); holder.append(j.injuries.length ? injuryTable(j.injuries, true) : el("p", { class: "muted", text: "No injuries anywhere." })); }
        catch (err) { holder.append(el("p", { class: "muted", text: `Could not load this: ${errText(err)}` })); }
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
      card.append(el("div", { class: "review-label", text: "This Week" }), el("p", { class: "muted small-text", text: "Simulating the matchup…" }));
      try { data = await api(`/api/season/${s.id}/preview?team=${d.team}`); } catch (err) { card.innerHTML = ""; card.append(el("div", { class: "review-label", text: "This Week" }), el("p", { class: "muted small-text", text: `Could not load this: ${errText(err)}` })); return; }
      thisWeekState.key = key; thisWeekState.data = data;
    }
    if (!card.isConnected) return;
    card.innerHTML = "";
    const g = data.game;
    const injuryReport = () => {
      const inj = data.injuries || [];
      const injBox = el("div", { class: "this-week-injuries" }, [el("h4", { text: `Injury Report · ${inj.length ? `${inj.length} out` : "nobody out"}` })]);
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
        bigTile("Record", g.my_record || ""),
      ]));
      if (g.has_box) { const b = el("button", { type: "button", class: "ghost small", text: "Box Score" }); b.addEventListener("click", () => openBox(g.event_id)); card.append(b); }
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
      bigTile("Predicted score", `${pf}–${pa}`),
      el("div", { class: "review-tile" }, [el("div", { class: `review-leader-big ${fav ? "win" : "loss"}`, text: `${Math.round(p.win_prob * 100)}%` }), el("div", { class: "review-label", text: "Win Odds" })]),
      bigTile("Line", line),
      bigTile("Total", p.total.toFixed(1)),
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
  const youTag = (slug) => (state.season && slug === state.season.team ? el("span", { class: "you-tag", text: "You", title: "Your team" }) : null);

  const scheduleState = { team: null, conf: "", data: null, key: null };

  async function openGamesModal() {
    const s = state.season;
    const node = el("div", { class: "games-modal" });
    const label = state.viewWeek === 0 ? "Preseason" : (s.week_labels[state.viewWeek] || `Week ${state.viewWeek}`);
    const nav = el("div", { class: "stats-controls" });
    const weeks = [0, ...s.weeks].filter((w) => w <= Math.min(s.done ? s.current_week : s.current_week + 1, 20));
    nav.append(chipRow(weeks.map((w) => [w, weekChipLabel(s, w)]),
      state.viewWeek, (w) => { state.viewWeek = w; renderWeekStrip(); renderGames(body); $("#modal-title").textContent = `All games · ${w === 0 ? "Preseason" : (s.week_labels[w] || `Week ${w}`)}`; }));
    const body = el("div");
    node.append(nav, body);
    openModal(`All Games · ${label}`, node);
    await renderGames(body);
  }

  // before week 1 of a career: trade a non-conference game for another school's the same week
  async function openScheduleEditor() {
    const s = state.season;
    const teamName = (slug) => (window.CFP.teamsBySlug[slug] || {}).name || slug;
    const node = el("div", { class: "sched-edit" }, [el("p", { class: "muted small-text", text: "Loading your non-conference games…" })]);
    openModal("Trade a Non-Conference Game", node);
    let d;
    try { d = await api(`/api/season/${s.id}/schedule_edit`); } catch (err) { node.innerHTML = ""; node.append(el("p", { class: "muted", text: errText(err) })); return; }
    node.innerHTML = "";
    node.append(el("p", { class: "muted small-text", text: "Before week 1 you can trade a non-conference date for another school's game that week: the two displaced opponents play each other. A school agrees when it gets the home game or you are the bigger draw. An FCS date can go to another FCS team." }));
    if (!d.games.length) node.append(el("p", { class: "muted", text: "Nothing to trade: the season has begun or you have no non-conference games." }));
    for (const g of d.games) {
      const oppName = g.home === s.team ? g.away_display : g.home_display;        // the schedule's own label (an FCS date reads "FCS <region>")
      const venue = g.neutral ? "neutral site" : g.home === s.team ? "home" : "away";
      const row = el("div", { class: "sched-edit-row" }, [
        el("div", {}, [el("b", { text: `${s.week_labels[g.week] || `Week ${g.week}`}: ${venue === "away" ? "at " : "vs "}${oppName}` }), el("span", { class: "muted small-text", text: ` · ${venue}` })])]);
      const sel = el("select", { "aria-label": `Trade the Week ${g.week} Game` }, [el("option", { value: "", text: "Trade For…" }),
        ...g.options.map((o) => el("option", { value: o.slug, text: `${o.name} · ${o.standing} · ${o.venue === "home" ? "you host" : o.venue === "away" ? "you travel" : "neutral"} · ${o.accepts ? o.why : `no: ${o.why}`}`, ...(o.accepts ? {} : { disabled: "true" }) }))]);
      const go = el("button", { type: "button", class: "ghost small", text: `Trade the Week ${g.week} Game` });
      go.addEventListener("click", async () => {
        if (!sel.value) return;
        go.disabled = true;
        try {
          await api(`/api/season/${s.id}/schedule_edit`, postJSON({ event_id: g.event_id, slug: sel.value }));
          toast(`Done: you play ${(g.options.find((o) => o.slug === sel.value) || {}).name || sel.value} in week ${g.week}.`, 3000);
          scheduleState.data = null; state.season = await api(`/api/season/${s.id}`); closeAllModals(); renderSchedule();
        } catch (err) { toast(`Could not trade: ${errText(err)}`, 4000); go.disabled = false; }
      });
      row.append(el("div", { class: "go-row wrap" }, [sel, go]));
      node.append(row);
    }
    if (d.changes.length) node.append(el("p", { class: "small-text" }, [el("b", { text: "Traded: " }), d.changes.map((c) => `week ${c.week} ${teamName(c.from)} → ${teamName(c.to)}`).join(" · ")]));
  }

  async function renderSchedule() {
    const s = state.season;
    const box = $("#tab-schedule");
    box.innerHTML = "";
    const st = scheduleState;
    if (st.team === null || !window.CFP.teamsBySlug[st.team]) st.team = s.team;
    // pick any team: conference chips narrow the team list; a button opens every game of the week
    const controls = el("div", { class: "stats-controls" });
    const confs = fbsConferences();
    controls.append(confChips(confs, st.conf, (v) => { st.conf = v; renderSchedule(); }));
    const row = el("div", { class: "schedule-pick" });
    const sel = el("select", { "aria-label": "Team" }, state.teams.filter((t) => !t.fictional && (!st.conf || t.conference === st.conf)).map((t) => el("option", { value: t.slug, text: t.slug === s.team ? `${t.name} (your team)` : t.name })));
    if (![...sel.options].some((o) => o.value === st.team)) st.team = sel.options.length ? sel.options[0].value : s.team;
    sel.value = st.team;
    sel.addEventListener("change", () => { st.team = sel.value; renderSchedule(); });
    const mineBtn = el("button", { type: "button", class: "ghost small", text: "My Team" });
    mineBtn.addEventListener("click", () => { st.team = s.team; st.conf = ""; renderSchedule(); });
    const allBtn = el("button", { type: "button", class: "ghost small", text: "View All Games" });
    allBtn.addEventListener("click", openGamesModal);
    row.append(sel);
    if (s.team && st.team !== s.team) row.append(mineBtn);
    row.append(allBtn);
    if (s.career && st.team === s.team && s.current_week === 0 && !s.done) {
      const tradeBtn = el("button", { type: "button", class: "ghost small", text: "Trade a Non-Conference Game" });
      tradeBtn.addEventListener("click", openScheduleEditor);
      row.append(tradeBtn);
    }
    controls.append(row);
    box.append(controls);
    const key = `${s.id}|${s.current_week}|${(s.schedule || []).filter((g) => g.played).length}|${st.team}`;
    if (!st.data || st.key !== key) {
      try { st.data = await api(`/api/season/${s.id}/schedule/${st.team}`); st.key = key; } catch (err) { box.append(el("p", { class: "muted", text: `Could not load this: ${errText(err)}` })); return; }
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
      return (s.week_labels[w] || `W${w}`).replace("Championship Week", "CCG").replace("Selection", "Sel").replace(" & Bowls", "").replace(" & New Year Bowls", "");
    };
    // game dates are ISO for the regular season and bowl-style text ("Dec 30", "January 1") after it
    const gameDate = (g) => (g.date && /^\d{4}-\d{2}-\d{2}/.test(g.date) ? shortDay(g.date.slice(0, 10)) : (g.date || ""));
    for (const g of d.schedule) {
      const upNext = !s.done && g.week === s.current_week + 1;
      if (g.kind === "bye") {
        const wd = s.week_dates && s.week_dates[g.week];
        table.appendChild(el("tr", { class: `bye ${upNext ? "upnext" : ""}` }, [
          el("td", {}, [wk(g.week), upNext ? el("span", { class: "upnext-tag", text: "This Week" }) : null]), el("td", { class: "left muted small-text nowrap", text: wd && wd.main ? shortDay(wd.main) : "" }),
          el("td", { class: "muted ph", text: g.my_rank ? `#${g.my_rank}` : "" }),
          el("td", { class: "left muted", text: "Bye" }), el("td", { class: "ph" }), el("td", { class: "muted", text: "–" }), el("td", {}), el("td", { class: "ph" }),
        ]));
        continue;
      }
      const prefix = g.venue === "away" ? "at" : "vs";
      const when = g.date ? gameDate(g) : ((s.week_dates || {})[g.week] || {}).main ? shortDay(s.week_dates[g.week].main) : "";
      const tr = el("tr", { class: `${g.has_box ? "clickable" : ""} ${g.played ? (g.won ? "won" : "lost") : ""} ${upNext ? "upnext" : ""}` }, [
        el("td", {}, [wk(g.week, g), upNext ? el("span", { class: "upnext-tag", text: "This Week" }) : null]),
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
    ["TOP", "top", "time"], ["TO", "turnovers", 0], ["Sacks All.", "sacks_allowed", 0], ["Pen/G", "penalties_pg", 1],
    ["Opp Yds/G", "opp_ypg", 1], ["Opp Pass/G", "opp_pass_ypg", 1], ["Opp Rush/G", "opp_rush_ypg", 1], ["Opp Y/Play", "opp_ypp", 2],
    ["Opp 3rd%", "opp_third_pct", 1], ["Sacks", "sacks", 0], ["TFL", "tfl", 0], ["Hurries", "hurries", 0], ["PBU", "pbu", 0], ["Takeaways", "takeaways", 0],
    ["20+ Plays", "explosives", 0], ["Press. All.", "pressures_allowed", 0],
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

  // every FBS conference, alphabetically (the FCS stand-in teams are left out)
  function fbsConferences() {
    return [...new Set(state.teams.filter((t) => !t.fictional).map((t) => t.conference))].sort();
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
      } catch (err) { box.append(el("p", { class: "muted", text: `Could not load this: ${errText(err)}` })); return; }
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
      ["3rd Conv", (p) => p.stats.passing_conversions || 0, "passing_conversions", "Third-down conversions by pass"], ["Long", (p) => p.stats.long_pass || 0, "long_pass"]],
    rushing: [["Car", (p) => p.stats.carries, "carries"], ["Yds", (p) => p.stats.rush_yards, "rush_yards"], ["Yds/G", (p) => (p.stats.rush_yards / p.games).toFixed(1), "ypg"],
      ["Avg", (p) => p.stats.carries ? (p.stats.rush_yards / p.stats.carries).toFixed(1) : "–", "avg"], ["TD", (p) => p.stats.rushing_touchdowns, "rushing_touchdowns"],
      ["20+", (p) => p.stats.explosive_runs || 0, "explosive_runs", "Runs of 20 yards or more"], ["1st D", (p) => p.stats.rushing_first_downs || 0, "rushing_first_downs"],
      ["3rd Conv", (p) => p.stats.rushing_conversions || 0, "rushing_conversions", "Third-down conversions by run"], ["Long", (p) => p.stats.long_rush || 0, "long_rush"], ["Fum", (p) => p.stats.fumbles, "fumbles"]],
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
      ["Sacks All.", (p) => p.stats.sacks_allowed || 0, "sacks_allowed", "Sacks Allowed"], ["Press.", (p) => p.stats.pressures_allowed || 0, "pressures_allowed", "Pressures allowed"],
      ["Stuffs", (p) => p.stats.stuffs_allowed || 0, "stuffs_allowed", "Runs stopped for no gain on this blocker"], ["Key Blk", (p) => p.stats.key_blocks || 0, "key_blocks", "Blocks that sprang a 20-yard run"],
      ["Per 100", (p) => p.stats.snaps ? (100 * ((p.stats.sacks_allowed || 0) + 0.5 * (p.stats.pressures_allowed || 0) + (p.stats.stuffs_allowed || 0)) / p.stats.snaps).toFixed(1) : "–", "per100", "Sacks, half-pressures and stuffs allowed per 100 snaps (lower is better)"]],
  };
  const LOWER_BETTER_PLAYER = new Set(["interceptions_thrown", "sacks_taken", "fumbles", "sacks_allowed", "pressures_allowed", "stuffs_allowed", "per100", "punt_touchbacks"]);
  const playerStatsState = { team: null, conf: "", view: "leaders", sort: null, data: null, leaders: null, roster: null };
  const LEADER_CARDS = [
    ["passing", "Passing Yards", (p) => `${p.stats.pass_yards.toLocaleString()} yds`, (p) => `${p.stats.completions}/${p.stats.pass_attempts} · ${p.stats.passing_touchdowns} TD · ${p.stats.interceptions_thrown} INT`],
    ["rushing", "Rushing Yards", (p) => `${p.stats.rush_yards.toLocaleString()} yds`, (p) => `${p.stats.carries} car · ${p.stats.carries ? (p.stats.rush_yards / p.stats.carries).toFixed(1) : "–"} avg · ${p.stats.rushing_touchdowns} TD`],
    ["receiving", "Receiving Yards", (p) => `${p.stats.receiving_yards.toLocaleString()} yds`, (p) => `${p.stats.receptions} rec · ${p.stats.receptions ? (p.stats.receiving_yards / p.stats.receptions).toFixed(1) : "–"} avg · ${p.stats.receiving_touchdowns} TD`],
    ["tackles", "Tackles", (p) => `${p.stats.solo_tackles + p.stats.assisted_tackles}`, (p) => `${p.stats.solo_tackles} solo · ${p.stats.assisted_tackles} ast · ${p.stats.sacks} sacks`],
    ["sacks", "Sacks", (p) => `${p.stats.sacks}`, (p) => `${p.stats.solo_tackles + p.stats.assisted_tackles} tkl · ${p.stats.forced_fumbles} FF`],
    ["interceptions", "Interceptions", (p) => `${p.stats.interceptions}`, (p) => `${p.stats.interception_return_yards} ret yds · ${p.stats.defensive_touchdowns} TD`],
    ["touchdowns", "Touchdowns", (p) => `${p.stats.rushing_touchdowns + p.stats.receiving_touchdowns}`, (p) => `${p.stats.rushing_touchdowns} rush · ${p.stats.receiving_touchdowns} rec`],
    ["kicking", "Kicking Points", (p) => `${p.stats.fg_made * 3 + p.stats.pat_made} pts`, (p) => `FG ${p.stats.fg_made}/${p.stats.fg_attempted} · PAT ${p.stats.pat_made}/${p.stats.pat_attempts}`],
    ["tfl", "Tackles for Loss", (p) => `${p.stats.tackles_for_loss || 0}`, (p) => `${p.stats.sacks} sacks · ${p.stats.hurries || 0} hurries`],
    ["pbu", "Passes Defended", (p) => `${p.stats.passes_defended || 0}`, (p) => `${p.stats.interceptions} INT · ${p.stats.solo_tackles + p.stats.assisted_tackles} tkl`],
    ["explosives", "Explosive Plays", (p) => `${(p.stats.explosive_runs || 0) + (p.stats.explosive_catches || 0)}`, (p) => `${p.stats.explosive_runs || 0} runs of 20+ · ${p.stats.explosive_catches || 0} catches of 25+`],
    ["punting", "Net Punting", (p) => `${p.value.toFixed(1)} net`, (p) => `${p.stats.punts} punts · ${p.stats.punts ? (p.stats.punt_yards / p.stats.punts).toFixed(1) : "–"} gross · ${p.stats.punts_inside_20 || 0} inside 20`],
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
    const confs = fbsConferences();
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
      } catch (err) { box.append(el("p", { class: "muted", text: `Could not load this: ${errText(err)}` })); return; }
    }
    const L = ps.leaders.leaders;
    if (!Object.values(L).some((rows) => rows.length)) { box.append(el("p", { class: "muted", text: "No stats yet." })); return; }
    box.append(el("p", { class: "muted small-text", text: `${statsNote(ps.leaders.partial)}${ps.team ? "Team" : ps.conf ? ps.conf : "National"} leaders through ${through}. Click a card for the full table.` }));
    const grid = el("div", { class: "leaders-grid" });
    for (const [cat, title, value, line] of LEADER_CARDS) {
      const rows = L[cat] || [];
      if (!rows.length) continue;
      const card = el("div", { class: "leader-card panel-2" });
      const head = el("div", { class: "leader-head" }, [el("h4", { text: title }), el("span", { class: "muted small-text", text: "Full Table ›" })]);
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
      } catch (err) { box.append(el("p", { class: "muted", text: `Could not load this: ${errText(err)}` })); return; }
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
      try { ps.roster = { slug, ...(await api(`/api/teams/${slug}`)) }; } catch (err) { box.append(el("p", { class: "muted", text: `Could not load this: ${errText(err)}` })); return; }
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
            el("span", { class: "name" }, [el("span", { text: p.name, ...playerAttrs(slug, p.name, p.position) }), p.class ? el("span", { class: "pos", text: CLASS_LABEL[p.class] || p.class }) : null]),
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
      try { state.standings = (await api(`/api/season/${s.id}/standings`)).standings; } catch (err) { box.append(el("p", { class: "muted", text: `Could not load this: ${errText(err)}` })); return; }
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

  // The nodes with a separator between each pair ("A, B, C"), ready to spread into append().
  function joinNodes(nodes, sep) {
    return nodes.flatMap((n, i) => (i < nodes.length - 1 ? [n, sep] : [n]));
  }

  // One Rankings tab; pills switch between the AP poll, the Coaches Poll and the CFP rankings.
  function renderRankings() {
    // once the committee's first ranking is out it leads: the first pill, and the one shown unless you picked another
    const s = state.season, pills = $("#poll-pills");
    const cfpOut = !!(s.polls[String(pollWeekFor(state.viewWeek, "cfp"))] || {}).cfp;
    const cfpPill = pills.querySelector("button[data-poll=cfp]");
    if (cfpOut && pills.firstElementChild !== cfpPill) pills.prepend(cfpPill);
    else if (!cfpOut && pills.firstElementChild === cfpPill) pills.insertBefore(cfpPill, pills.querySelector("button[data-poll=resume]"));
    if (!state.pollChosen) state.poll = cfpOut ? "cfp" : "ap";
    for (const b of pills.querySelectorAll("button[data-poll]")) b.classList.toggle("active", b.dataset.poll === state.poll);
    renderPoll(state.poll);
  }

  function renderPoll(kind) {
    const s = state.season;
    const box = $("#poll-body");
    box.innerHTML = "";
    const w = pollWeekFor(state.viewWeek, kind);
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
    box.append(el("h3", { text: `${title} · ${w === 0 ? "Preseason" : `After ${s.week_labels[w] || "Week " + w}`}` }));
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
      const parts = joinNodes(others.map((e) => el("span", { class: e.team === s.team ? "win" : "" }, [e.points != null ? `${e.name} ${e.points}` : `${e.name} (${e.record})`])), ", ");
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
        const parts = joinNodes(dropped.map((e) => el("span", { class: e.team === s.team ? "loss" : "" }, [`${e.name} No. ${e.rank}`])), ", ");
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
    const label = s.week_labels[week] || `Week ${week}`;
    if (!games.length) {
      box.appendChild(el("div", { class: "others-votes" }, [el("b", { text: `Ranked matchups in ${label}: ` }), "none"]));
      return;
    }
    games.sort((a, b) => Math.min(rankOf[a.home] || 99, rankOf[a.away] || 99) - Math.min(rankOf[b.home] || 99, rankOf[b.away] || 99));
    const nm = (slug) => `${rankOf[slug] ? `No. ${rankOf[slug]} ` : ""}${name(slug)}`;
    const parts = joinNodes(games.map((g) => {
      const text = g.played
        ? `${nm(g.away)} ${g.away_score} at ${nm(g.home)} ${g.home_score}`
        : `${nm(g.away)} ${g.neutral ? "vs" : "at"} ${nm(g.home)}`;
      return el("span", { class: (g.home === s.team || g.away === s.team) ? "win" : "" }, [text]);
    }), "; ");
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
    { name: "First Round", week: 17, games: [["cfp-r1-8", 8, 9], ["cfp-r1-5", 5, 12], ["cfp-r1-7", 7, 10], ["cfp-r1-6", 6, 11]] },
    { name: "Quarterfinals", week: 18, games: [["cfp-qf-1", 1, "8/9"], ["cfp-qf-4", 4, "5/12"], ["cfp-qf-2", 2, "7/10"], ["cfp-qf-3", 3, "6/11"]] },
    { name: "Semifinals", week: 19, games: [["cfp-sf-1", "QF1", "QF4"], ["cfp-sf-2", "QF2", "QF3"]] },
    { name: "National Championship", week: 20, games: [["cfp-final", "SF1", "SF2"]] },
  ];
  const bracketState = { games: null, key: null };

  async function renderBracket() {
    const s = state.season;
    const box = $("#tab-bracket");
    box.innerHTML = "";
    if (!s.bracket) {
      box.append(el("h3", { text: "Projected Bracket" }));
      const w = pollWeekFor(state.viewWeek, "cfp");
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
      const note = el("p", { class: "muted loading-note", text: "Loading the playoff games…" });
      box.append(note);
      try {
        const views = await Promise.all(weeks.map((w) => api(`/api/season/${s.id}/week/${w}`)));
        for (const v of views) for (const g of v.games) if (g.kind === "playoff") bracketState.games[g.event_id] = g;
      } catch (err) { box.append(el("p", { class: "muted", text: `Could not load this: ${errText(err)}` })); }
      note.remove();
    }
    const seeds = {};
    for (const x of b.seeds) seeds[x.seed] = x;
    const sites = s.playoff_sites || {};
    box.append(bracketTree(seeds, bracketState.games, false, sites));
    if (s.done) box.append(champBanner(s.champion, s.champion_name));
    box.append(el("p", { class: "muted small-text", text: "Click any played game for its box score. Seeds, ranks and bids:" }));
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
    if (state.standings) {
      for (const [conf, rows] of Object.entries(state.standings)) if (rows.length) leaders[conf] = rows[0].slug;
    } else {
      // no standings yet: fetch them, then redraw the bracket with the conference leaders
      api(`/api/season/${s.id}/standings`).then((d) => { state.standings = d.standings; if (state.tab === "bracket") renderBracket(); }).catch(() => {});
    }
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
      if (/^\d+\/\d+$/.test(ref)) { const g = games[`cfp-r1-${ref.split("/")[0]}`]; return winnerOf(g) || { name: `${ref} Winner` }; }
      if (/^QF\d$/.test(ref)) { const g = games[`cfp-qf-${ref[2]}`]; return winnerOf(g) || { name: `${ref} Winner` }; }
      if (/^SF\d$/.test(ref)) { const g = games[`cfp-sf-${ref[2]}`]; return winnerOf(g) || { name: `${ref} Winner` }; }
      return { name: "TBD" };
    };
    BRACKET_ROUNDS.forEach((round, ri) => {
      const col = el("div", { class: "bracket-round" }, [el("div", { class: "bracket-round-name", text: round.name })]);
      const list = el("div", { class: "bracket-games" });   // not "games": that name is the played games passed in
      col.append(list);
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
        list.append(card);
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
    } catch (err) { toast(`Could not load that game: ${errText(err)}`, 3000); }
  }
  function selectBoxTab(name) {
    for (const b of $("#sbox-tabs").querySelectorAll("button")) b.classList.toggle("active", b.dataset.btab === name);
    for (const t of ["scoring", "team", "home", "away", "drives"]) $(`#sbox-${t}`).hidden = t !== name;
  }

  // ----- settings and god mode ------------------------------------------------------
  const godMode = () => !!((state.season && state.season.settings) || {}).god_mode;
  async function saveSettings(changes) {
    const s = state.season;
    const j = await api(`/api/season/${s.id}/settings`, postJSON(changes));
    s.settings = j.settings;
    playerState.cache.clear();
    return j.settings;
  }
  function openSettings() {
    const s = state.season;
    if (!s) return;
    const node = el("div", { class: "settings" });
    const row = (title, desc, control) => {
      if (control.getAttribute("role") === "switch") control.setAttribute("aria-label", title);   // the switch is named after its row
      return el("div", { class: "settings-row" }, [el("div", { class: "settings-text" }, [el("b", { text: title }), el("div", { class: "muted small-text", text: desc })]), control]);
    };
    const toggle = (on, onChange) => {
      const b = el("button", { type: "button", class: `switch ${on ? "on" : ""}`, role: "switch", "aria-checked": on ? "true" : "false" }, [el("span", { class: "knob" })]);
      b.addEventListener("click", () => {
        const next = !b.classList.contains("on");
        window.CFP.ui.busy(b, (async () => {
          try { await onChange(next); b.classList.toggle("on", next); b.setAttribute("aria-checked", next ? "true" : "false"); window.CFP.ui.pulse(b.closest(".settings-row")); }
          catch (err) { toast(err.message, 4000); }
        })());
      });
      return b;
    };
    node.append(
      row("God Mode", "Edit every player's ratings, class, size, jersey and development trait from his player card, and every team's depth chart. Changes are saved with this season and used by every game from the next sim on.",
        toggle(godMode(), async (on) => {     // the chart behind the dialog patches (another team's chart turns editable); no other tab shows it
          await saveSettings({ god_mode: on });
          if (window.CFPDepth && window.CFPDepth.isOpen()) await window.CFPDepth.refresh();   // the screen behind the dialog patches in place
          toast(on ? "God mode on: open any player or depth chart to edit it." : "God mode off.", 3000);
        })),
      row("Momentum and Morale", "Big plays swing momentum inside a game and nudge ratings play by play; wins, losses and each player's own games set a mood that carries into the next game and fades week by week. Player cards show the boosts as green and red arrows.",
        toggle(!!(s.settings || {}).morale, async (on) => { await saveSettings({ morale: on }); toast(on ? "Momentum and morale on from the next sim." : "Momentum and morale off.", 3000); })),
      row("Game Day Pace", "How fast the plays come during a game day replay.",
        chipRow([["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"]], gdSpeed(), saveGdSpeed)),
    );
    openModal("Settings", node);
  }

  // every rating the player carries, with the boosts and the god-mode marks, and his rating at other positions
  function openAllRatings(p) {
    if ((p.attributes || []).length) { openAttributes(p); return; }
    const edited = new Set(p.edited || []);
    const keySet = new Set(p.key_ratings || []);
    const node = el("div", { class: "all-ratings" });
    node.append(el("p", { class: "muted small-text", text: `1-99: 50 is an average Power 4 starter at the position, 65 a good one, 80 elite, 95 generational, 25 an average FBS roster player. The ${p.position} ratings the card shows are marked; the rest still matter when he lines up somewhere else, returns kicks or tires.` }));
    const table = el("table", { class: "stats ratings-table" });
    table.append(el("tr", {}, ["Rating", "", "Value"].map((h, i) => el("th", { class: i === 0 ? "left" : "", text: h }))));
    for (const r of p.ratings) {
      table.append(el("tr", { class: keySet.has(r.key) ? "key" : "" }, [
        el("td", { class: "left" }, [el("span", { class: `rating-label ${edited.has(r.key) ? "edited" : ""}`, text: r.label }), keySet.has(r.key) ? el("span", { class: "pos", text: p.position }) : null, edited.has(r.key) ? el("span", { class: "pos", text: "edited" }) : null]),
        el("td", {}, [ratingBar(r.value)]),
        el("td", { class: "rating-num" }, [el("b", { text: String(r.value) }), r.boost ? el("span", { class: `boost ${r.boost > 0 ? "up" : "down"}`, text: `${r.boost > 0 ? "▲" : "▼"}${Math.abs(r.boost)}` }) : null]),
      ]));
    }
    node.append(el("div", { class: "table-scroll" }, [table]));
    appendRatingsAt(node, p);
    openModal(el("span", {}, [`${p.name} · All Ratings`, el("span", { class: "muted small-text", text: ` · ${p.overall} overall at ${p.position}` })]), node);
  }

  // his rating at every position (best first), shared by both rating modals
  function appendRatingsAt(node, p) {
    const others = Object.entries(p.ratings_at || {}).filter(([pos]) => !(pos === "MLB" && /LB$/.test(p.position))).sort((a, b) => b[1] - a[1]);
    if (!others.length) return;
    node.append(el("h4", { text: "Rated at Every Position" }), el("p", { class: "muted small-text", text: "On the same scale: 50 is an average Power 4 starter at that position. The depth chart's By position view uses these when you move someone." }));
    node.append(el("div", { class: "ratings-at" }, others.map(([pos, v]) => el("div", { class: `review-tile ${pos === p.position ? "mine" : ""}` }, [el("div", { class: "review-leader-big", text: String(v) }), el("div", { class: "review-label", text: pos === p.position ? `${pos} (his spot)` : pos })]))));
  }

  // a trait badge's hover: what it does and the attributes it rests on, with his values
  function traitBasis(tr) {
    if (tr.intangible) return "An intangible: no single rating stands behind it.";
    if (!(tr.built_on || []).length) return "";
    return `Built on ${tr.built_on.map((b) => `${b.label} ${b.value}`).join(" · ")}.`;
  }
  function traitHover(tr) {
    return `${tr.tier_name} trait: ${tr.about}.\n${traitBasis(tr)}`.trim();
  }

  // ratings v2: every attribute with what it does, the traits, and the rating at every position
  function openAttributes(p) {
    const edited = new Set(p.edited_attributes || []);
    const node = el("div", { class: "all-ratings" });
    node.append(el("p", { class: "muted small-text", text: "1-99: 50 is an average Power 4 starter at the position, 65 a good one, 80 elite, 95 generational. The sim moves onto these attributes one part of the game at a time; until a part moves, it reads them through the blended ratings it has always used, so an edit here still changes how he plays." }));
    const table = el("table", { class: "stats ratings-table" });
    table.append(el("tr", {}, ["Attribute", "", "Value", "What it does"].map((h, i) => el("th", { class: i === 0 || i === 3 ? "left" : "", text: h }))));
    let group = null;
    for (const a of p.attributes) {
      if (a.group !== group) {
        group = a.group;
        table.append(el("tr", { class: "group-row" }, [el("td", { class: "left", colspan: "4" }, [el("b", { text: group })])]));
      }
      table.append(el("tr", {}, [
        el("td", { class: "left" }, [el("span", { class: `rating-label ${edited.has(a.key) ? "edited" : ""}`, text: a.label }), edited.has(a.key) ? el("span", { class: "pos", text: "edited" }) : null]),
        el("td", {}, [ratingBar(a.value)]),
        el("td", { class: "rating-num" }, [el("b", { text: String(a.value) })]),
        el("td", { class: "left muted small-text", text: a.about }),
      ]));
    }
    node.append(el("div", { class: "table-scroll" }, [table]));
    if (p.height || p.weight) node.append(el("p", { class: "small-text" }, [el("b", { text: "Size: " }), `${p.height || ""}${p.height && p.weight ? ", " : ""}${p.weight ? p.weight + " lbs" : ""}`]));
    if ((p.traits || []).length || p.archetype) {
      node.append(el("h4", { text: "Play Style and Traits" }));
      if (p.archetype) node.append(el("p", { class: "small-text" }, [el("b", { text: p.archetype }), el("span", { class: "muted", text: " · play style" })]));
      for (const tr of p.traits || []) node.append(el("div", { class: "trait-line" }, [el("span", { class: `trait tier-${tr.tier}`, text: tr.name, title: traitHover(tr) }), el("span", { class: "muted small-text", text: ` ${tr.tier_name} · ${tr.about}. ${traitBasis(tr)}` })]));
      node.append(el("p", { class: "muted small-text", text: "Traits come at four tiers (bronze, silver, gold, platinum) and are carried over from the source rosters, which list each player's tiers but not the exact thresholds that earned them. Each one rests on the attributes shown. Their effects in games come in a later phase of the ratings revamp." }));
    }
    appendRatingsAt(node, p);
    openModal(el("span", {}, [`${p.name} · Attributes`, el("span", { class: "muted small-text", text: ` · ${p.overall} overall at ${p.position}` })]), node);
  }

  const CLASS_FULL = { FR: "Freshman", FRRS: "Redshirt freshman", SO: "Sophomore", SORS: "Redshirt sophomore", JR: "Junior", JRRS: "Redshirt junior", SR: "Senior", SRRS: "Redshirt senior" };
  // the player card's edit form (god mode): ratings as numbers, then the identity fields
  function playerEditForm(p, card) {
    const s = state.season;
    const form = el("div", { class: "player-edit" });
    const inputs = {};
    const num = (key, value) => { const i = el("input", { type: "number", min: "0", max: "99", step: "1", value: String(value), "aria-label": key }); inputs[key] = i; return i; };
    const editable = (p.attributes || []).length ? p.attributes.map((a) => ({ ...a, key: `attr:${a.key}` })) : p.ratings;
    let lastGroup = null;
    for (const r of editable) {
      if (r.group && r.group !== lastGroup) { lastGroup = r.group; form.append(el("div", { class: "attr-group", text: r.group })); }
      form.append(el("div", { class: "rating-row edit" }, [el("span", { class: "rating-label", text: r.label, title: r.about || "" }), el("div", {}), num(r.key, r.value)]));
    }
    const text = (key, value, attrs = {}) => { const i = el("input", { type: "text", value: value == null ? "" : String(value), "aria-label": key, ...attrs }); inputs[key] = i; return i; };
    const select = (key, value, options) => { const sel = el("select", { "aria-label": key }, options.map(([v, label]) => el("option", { value: v, text: label }))); sel.value = value || options[0][0]; inputs[key] = sel; return sel; };
    inputs.weight = el("input", { type: "number", min: "150", max: "400", value: String(p.weight || ""), "aria-label": "weight" });
    const grid = el("div", { class: "player-edit-grid" }, [
      el("label", {}, ["Jersey", text("jersey", p.jersey, { maxlength: "3" })]),
      el("label", {}, ["Class", select("class", p.class, (p.editable_classes || []).map((c) => [c, CLASS_FULL[c] || c]))]),
      el("label", {}, ["Height", text("height", p.height, { placeholder: "6'2\"" })]),
      el("label", {}, ["Weight", inputs.weight]),
      el("label", {}, ["Development", select("dev_trait", p.dev_trait, (p.dev_traits || ["Normal", "Impact", "Star", "Elite"]).map((d) => [d, d]))]),
    ]);
    form.append(el("h4", { text: "Identity" }), grid);
    const actions = el("div", { class: "player-edit-actions" });
    const save = el("button", { type: "button", class: "primary small", text: "Save Changes" });
    const cancel = el("button", { type: "button", class: "ghost small", text: "Cancel" });
    cancel.addEventListener("click", () => { form.remove(); card.querySelector(".player-edit-open").hidden = false; });
    save.addEventListener("click", async () => {
      const changes = {};
      for (const r of editable) {
        const v = Number(inputs[r.key].value);
        if (!Number.isFinite(v) || v === r.value) continue;
        if (r.key.startsWith("attr:")) (changes.attributes = changes.attributes || {})[r.key.slice(5)] = Math.round(v);
        else changes[r.key] = Math.round(v);
      }
      for (const k of ["jersey", "class", "height", "dev_trait"]) if (inputs[k].value !== String(p[k] == null ? "" : p[k])) changes[k] = inputs[k].value;
      if (inputs.weight.value && Number(inputs.weight.value) !== p.weight) changes.weight = Number(inputs.weight.value);
      if (!Object.keys(changes).length) { toast("Nothing changed.", 2000); return; }
      save.disabled = true;
      try {
        const j = await api(`/api/season/${s.id}/player/edit`, postJSON({ team: p.team.slug, player: p.slug, changes }));
        playerState.cache.clear();
        toast(`${p.name} updated.`, 2500);
        const box = card.closest(".player-page");
        if (box && j.player) renderPlayer(j.player, box);
        if (window.CFPDepth) window.CFPDepth.refresh();
      } catch (err) { toast(`Could not save: ${errText(err)}`, 4000); save.disabled = false; }
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
    box.append(el("h3", { text: `Committee Resume · ${w === 0 ? "Preseason" : `Through ${s.week_labels[w] || "Week " + w}`}` }));
    const note = el("p", { class: "muted small-text", text: "Loading…" });
    box.append(note);
    let data = resumeState.cache[`${s.id}|${w}`];
    if (!data) {
      try { data = await api(`/api/season/${s.id}/resume?week=${w}`); } catch (err) { note.textContent = `Could not load the resume: ${errText(err)}`; return; }
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
      { key: "best", label: "Best Win", left: true, get: (r) => gameTag(r.best_win, true) },
      { key: "worst", label: "Worst Loss", left: true, ph: true, get: (r) => gameTag(r.worst_loss, false) },
    ];
    const table = sortableTable(cols, rows, st, () => renderPoll("resume"), (r) => `clickable ${r.team === s.team ? "mine" : ""}`);
    table.addEventListener("click", (e) => { const tr = e.target.closest("tr"); const t = tr && tr.querySelector("[data-team]"); if (t) openResume(t.dataset.team, w); });
    box.append(table);
    if (rows.length < data.rows.length) box.append(el("p", { class: "muted small-text", text: `${rows.length} of ${data.rows.length} teams shown; every team's resume opens from its schedule.` }));
  }

  async function openResume(slug, w) {
    const s = state.season;
    let data;
    try { data = await api(`/api/season/${s.id}/resume?week=${w}&team=${slug}`); } catch (err) { toast(`Could not load the resume: ${errText(err)}`, 3000); return; }
    const r = data.rows[0];
    if (!r) return;
    const node = el("div", { class: "resume" });
    node.append(
      el("div", { class: "muted small-text", text: `${r.conference} · ${w === 0 ? "preseason" : `through ${s.week_labels[w] || "week " + w}`} · ranks are today's ${data.kind === "cfp" ? "CFP ranking" : "AP poll"}` }),
      el("div", { class: "review-tiles" }, [
        bigTile("Record", r.record, `${r.conf_record} ${r.conference}`),
        bigTile("Strength of schedule", `#${r.sos_rank}`, `opponents ${(r.opp_pct * 100).toFixed(1)}% · theirs ${(r.oo_pct * 100).toFixed(1)}%`),
        bigTile("vs Top 25", r.top25, `${r.road_wins} win${r.road_wins === 1 ? "" : "s"} away from home`),
        bigTile("vs teams over .500", r.vs_winning, `${r.margin > 0 ? "+" : ""}${r.margin} points per game`),
      ]),
    );
    const gameLine = (x) => el("span", {}, [x.venue === "away" ? "at " : x.venue === "neutral" ? "vs " : "vs ", x.rank_now ? el("span", { class: "rank", text: `#${x.rank_now} ` }) : null, teamPill(x.opp), x.opp_name, el("span", { class: "muted small-text", text: ` (${x.opp_record}) ${x.pf}–${x.pa}${x.rank_then && x.rank_then !== x.rank_now ? ` · #${x.rank_then} at the time` : ""}` })]);
    node.append(el("div", { class: "leaders-grid resume-grid" }, [
      el("div", { class: "leader-card" }, [el("div", { class: "leader-head" }, [el("h4", { text: "Best Win" })]), r.best_win ? gameLine(r.best_win) : el("span", { class: "muted", text: "No wins yet." })]),
      el("div", { class: "leader-card" }, [el("div", { class: "leader-head" }, [el("h4", { text: "Worst Loss" })]), r.worst_loss ? gameLine(r.worst_loss) : el("span", { class: "muted", text: "Unbeaten." })]),
    ]));
    const table = el("table", { class: "stats resume-games" });
    table.append(el("tr", {}, ["Wk", "Opponent", "Rank then", "Rank now", "Their record", "Result", ""].map((h, i) => el("th", { class: `${i === 1 ? "left" : ""} ${[2, 4].includes(i) ? "ph" : ""}`, text: h }))));
    for (const x of r.games || []) {
      const tr = el("tr", { class: `${x.event_id ? "clickable" : ""} ${x.won ? "won" : "lost"}` }, [
        el("td", { class: "muted", text: x.week > 14 ? postseasonLabel(s, x.week) : String(x.week) }),
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
    openModal(el("span", {}, [teamPill(slug), `${r.name} Resume`, el("span", { class: "muted small-text", text: ` · ${r.rank ? `#${r.rank} · ` : ""}${r.record}` })]), node);
  }

  // ----- game day: your game, drive by drive ----------------------------------
  // The Game day button simulates this week as usual, then replays your game from its
  // play log: one play at a time, the score and clock moving, a Skip to the final box
  // score. "Sim to next week" and the multi-week sims go straight to the results.

  const gameday = { timer: null, speed: "normal", moments: [], i: 0, g: null, eventId: null, node: null };
  const GD_PACE = { slow: 1600, normal: 900, fast: 320 };
  const gdSpeed = () => { try { return localStorage.getItem("cfp.gameday.speed") || "normal"; } catch (e) { return "normal"; } };
  const saveGdSpeed = (v) => { try { localStorage.setItem("cfp.gameday.speed", v); } catch (e) { /* private mode */ } };

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
      if (e.how === "touchback") return `${who} punts ${e.yards} yards into the end zone for a touchback.`;
      const how = { fair_catch: "fair catch", downed: "downed", out_of_bounds: "out of bounds" }[e.how];
      return `${who} punts ${e.yards} yards${how ? `, ${how}` : ""}; ${g[def].name} takes over at ${gdSpot(g, def, 100 - e.to)}.`;
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

  // the season as it stands after the live game: shown once the game is over (see poll)
  function showAfterGameday() {
    const s = state.afterGameday;
    if (!s) return;
    state.afterGameday = null;
    showSeason(s);
    loadSeasons();
  }

  async function openGameDay(eventId, info) {
    const s = state.season;
    let g;
    try { g = await api(`/api/season/${s.id}/game/${eventId}`); } catch (err) { showAfterGameday(); toast(`Could not load the game: ${errText(err)}`, 3000); return; }
    if (!g.drives || !g.drives.some((d) => d.log && d.log.length)) { showAfterGameday(); openBox(eventId); return; }
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
        chipRow([["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"]], gameday.speed, (v) => { gameday.speed = v; saveGdSpeed(v); }),
        el("button", { type: "button", class: "ghost small", id: "gd-skip", text: "Skip to Final", onclick: () => gdFinish(true) }),
      ]),
      el("div", { class: "gd-current" }, [el("h4", { id: "gd-drive-title", text: "" }), el("ol", { id: "gd-plays", class: "gd-plays" })]),
      el("div", { class: "gd-scoring" }, [el("h4", { text: "Scoring" }), el("ul", { id: "gd-scores", class: "scoring-list" })]),
      el("div", { class: "gd-drives" }, [el("h4", { text: "Drives" }), el("ul", { id: "gd-drives", class: "gd-drive-list" })]),
    );
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
    showAfterGameday();
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

  $("#btn-new").addEventListener("click", () => chooseCoach("full"));
  $("#btn-pause").addEventListener("click", pauseSim);
  $("#btn-seasons").addEventListener("click", () => setSidebar($("#btn-seasons").getAttribute("aria-pressed") !== "true"));
  $("#btn-download-career").addEventListener("click", () => {
    if (state.season) window.CareerSave.download(state.season.id).catch((err) => toast(`Could not download: ${errText(err)}`, 4000));
  });
  $("#btn-load-career").addEventListener("click", () => $("#career-file").click());
  $("#career-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const s = await window.CareerSave.upload(file);
      history.replaceState(null, "", `?id=${s.id}`);
      showSeason(s);
      loadSeasons().catch(() => {});
      toast(`Loaded the ${s.team_name} career, through week ${s.current_week}.`, 4000);
    } catch (err) { toast(`Could not load that file: ${errText(err)}`, 5000); }
  });
  $("#btn-clear-seasons").addEventListener("click", clearSeasons);
  $("#btn-hide-seasons").addEventListener("click", () => setSidebar(false));
  setSidebar(true, false);
  $("#btn-settings").addEventListener("click", openSettings);
  $("#btn-seasons-menu").addEventListener("click", seasonsMenu);
  $("#btn-compact-office").addEventListener("click", goOffice);
  $("#btn-compact-more").addEventListener("click", compactMore);
  $("#btn-sheet-seasons").addEventListener("click", () => { closeHeadSheet(); seasonsMenu($("#btn-compact-more")); });   // the sheet gives way to the Seasons sheet, anchored to ▾
  $("#btn-sheet-theme").addEventListener("click", toggleTheme);
  $("#season-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (!b) return;
    if (b.dataset.tab === "depth") { openDepth(); return; }     // the depth chart is its own screen
    state.tab = b.dataset.tab;
    renderTab();
  });
  $("#poll-pills").addEventListener("click", (e) => { const b = e.target.closest("button[data-poll]"); if (b) { state.poll = b.dataset.poll; state.pollChosen = true; renderRankings(); } });
  $("#sbox-tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-btab]"); if (b) selectBoxTab(b.dataset.btab); });

  (async () => {
    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    for (const a of document.querySelectorAll(".site-nav a")) a.classList.toggle("active", a.dataset.nav === "season");
    loadSeasons().catch(() => {});   // the sidebar list loads alongside; the season needs only the teams
    try { await loadTeams(); } catch (err) { toast(`Teams unavailable: ${errText(err)}`, 4000); }
    if (id) {
      await openSeason(id);   // it reloads the season list too, marking the open season
      if (params.get("screen") === "depth" && state.season) openDepth(params, false);   // a link straight to the depth chart
    }
  })();
})();
