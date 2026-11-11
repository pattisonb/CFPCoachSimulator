/* The Office (a Coach Career's landing tab): your week at a glance, in two columns.
   Left: the Next Game hero (both teams, the Win Chance, Game Day and the sim controls), Last Game (the score,
   four team stats, the score by quarter and the leaders), This Week's Plan (Recruit, Game Day, Advance, the
   current step read from the real state), What Changed, Program News and Around the Conference. Right:
   Program Pulse (record, place, last game, the AD's goal), Recruiting Pulse and Top Targets.
   window.Office.render(season, box, helpers); helpers from season.js (api, play, playCard, onChange, openBox).
   Reads: the season summary, /recruiting, /office (news and the conference), /preview (the Win Chance: the
   game preview's simulated win probability) and /game/{id} (the last box score). Below 900 px one column. */
(function () {
  "use strict";
  const { el } = window.CFP;
  const ui = () => window.CFP.ui;
  const rec = () => window.CFP.recruiting || {};
  let H = null;

  const SIGNING_WEEK = 16, FINAL_WEEK = 20;     // the early signing period (selection week) and national signing day
  // the conference's name where a short one reads better ("Around the American"); the rest keep their own
  const CONF_SHORT = { "American Athletic Conference": "American", "FBS Independent": "Independents", "FBS Independents": "Independents" };
  // the offseason's stages by name (coach_career/offseason.py STAGE_NAMES)
  const STAGE_NAMES = { departures: "Departures", retention: "Keep Them Home", portal_w1: "Transfer Portal, Week 1", portal_w2: "Transfer Portal, Week 2",
    portal_w3: "Transfer Portal, Week 3", portal_w4: "Transfer Portal, Week 4", development: "Development", staff: "Staff", ready: "Ready for Next Season" };

  const stars = (n) => "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
  const ordinal = (n) => { const t = n % 100, u = n % 10; return `${n}${t > 10 && t < 14 ? "th" : u === 1 ? "st" : u === 2 ? "nd" : u === 3 ? "rd" : "th"}`; };
  const team = (slug) => (window.CFP.teamsBySlug || {})[slug] || {};
  const abbr = (slug, name) => team(slug).abbreviation || name || team(slug).name || slug;
  const confShort = (c) => CONF_SHORT[c] || c;
  const weekName = (s, w) => (s.week_labels && s.week_labels[w]) || `Week ${w}`;
  // a game or week date as the kicker shows it; the data holds 2026 dates, so later seasons shift by a year
  // (364 days keeps the weekday, as the Schedule tab does); never "Invalid Date"
  const dateText = (d, s) => {
    if (!d) return "";
    const k = ((s && s.year) || 2026) - 2026;
    const t = new Date(d).getTime() + k * 364 * 86400000;
    return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };
  const recText = (r) => (r ? `${r.wins}-${r.losses}` : "0-0");
  const scoreText = (a, b) => `${a}–${b}`;
  const VENUE = { home: "Home Game", away: "Away Game", neutral: "Neutral Site" };
  // the win probability as the page shows it: a whole percent, never 0 or 100 (upsets happen)
  const winPct = (p) => Math.min(99, Math.max(1, Math.round(100 * Number(p))));
  const loading = (text) => el("p", { class: "muted go-loading", text });
  const kicker = (text, muted) => el("div", { class: `go-kicker${muted ? " muted" : ""}`, text });
  const bar = (text, ...rest) => el("div", { class: "card-bar" }, [kicker(text), ...rest]);   // a card's header: the bar (styles.css .card-bar)
  function pill(slug, size) {
    const p = window.CFP.teamPill(slug);
    if (size) p.classList.add(`ofc-pill-${size}`);
    return p;
  }

  // ----- the week: your games and the plan ---------------------------------------------------------
  // the latest game you played, this week's game (when there is one) and the next you play
  function gamesOf(s) {
    const sched = (s.schedule || []).filter((g) => g.opponent);
    const last = sched.filter((g) => g.played).pop() || null;
    const thisWeek = s.done ? null : sched.find((g) => g.week === s.current_week + 1) || null;
    const next = s.done ? null : sched.find((g) => !g.played && g.week >= s.current_week + 1) || null;
    return { last, thisWeek, next };
  }

  // This Week's Plan from the real state: Recruit is done once you have spent hours this week (or your staff
  // recruit on Auto), Game Day until your game is played, then Advance; a week without your game has no Game Day.
  // -> [{ key, title, sub, state: "done" | "now" | "" }], or null once the season is over.
  const MIN_ACTION_HOURS = 5;       // the cheapest recruiting action (a message): fewer hours left than this and the week's hours are spent
  function planSteps(s, v, game) {
    if (s.done || !v) return null;
    const auto = v.auto_recruit && v.auto_recruit !== "off";
    const used = Number(v.hours_used) || 0;
    // done once the week's hours are spent (too few left for the cheapest action, a message) or your staff recruit on Auto;
    // some hours spent and some left: started ("part"), not ticked, and Game Day comes up next all the same
    const left = v.hours_left != null ? Number(v.hours_left) : Math.max(0, (Number(v.hours) || 0) - used);
    const spent = auto || left < MIN_ACTION_HOURS;
    const steps = [{ key: "recruit", title: "Recruit", done: spent, part: !spent && used > 0,
      sub: auto ? (v.auto_recruit === "week" ? "Auto-recruit runs this week for you." : "Auto-recruit runs all season for you.")
        : spent ? `All ${v.hours} hours used this week.` : used > 0 ? `${used} of ${v.hours} hours used, ${left} left.` : `${v.hours} hours to spend on your board.` }];
    if (game) {
      const where = game.venue === "away" ? "at" : "against";
      steps.push({ key: "gameday", title: "Game Day", done: !!game.played,
        sub: game.played ? `Played: ${game.won ? "a win" : "a loss"}, ${scoreText(game.points_for, game.points_against)}.`
          : `Coach it drive by drive ${where} ${game.opponent_name}.` });
    }
    const w = s.current_week + 1;
    steps.push({ key: "advance", title: "Advance", done: false,
      sub: w < FINAL_WEEK ? `Everyone else plays, then on to ${weekName(s, w + 1)}.` : "Everyone else plays and the season ends." });
    let current = false;
    for (const x of steps) {
      x.state = x.done ? "done" : x.part ? "part" : current ? "" : "now";
      if (!x.done && !x.part) current = true;
    }
    return steps;
  }

  // ----- the hero: the next game, a week without one, or the season over ---------------------------
  function side(slug, name, rank, record, mine) {
    const t = team(slug);
    return el("div", { class: `go-side ofc-team${mine ? " mine" : " theirs"}` }, [pill(slug, "l"),
      el("div", { class: "ofc-team-text" }, [
        el("b", { class: "ofc-team-name go-side-name", text: name }),
        el("span", { class: "ofc-team-sub muted" }, [rank ? el("span", { class: "go-rank", text: `#${rank} ` }) : null,
          [t.mascot, record || "0-0"].filter(Boolean).join(" · ")])])]);
  }

  function playRow(s) {
    // the play card (season.js playCard): Game Day first when your game is ready, then Sim the Week and the rest
    const nodes = H.playCard(s);
    const gd = nodes.find((n) => n.dataset && n.dataset.play === "gameday");
    const rest = nodes.filter((n) => n !== gd);
    if (gd) gd.classList.add("ofc-go");
    return el("div", { class: `go-play ofc-play${gd ? " has-game" : ""}` }, [gd || null, gd ? el("span", { class: "ofc-break", "aria-hidden": "true" }) : null, ...rest]);
  }

  function heroCard(s, games) {
    if (s.done) return doneHero(s, games);
    const g = games.next;
    const thisWeek = !!(g && g.week === s.current_week + 1);
    const tw = games.thisWeek;
    const played = !!(tw && tw.played);       // Game Day is done: your result leads, the next game follows
    const result = played ? `${tw.won ? "Won" : "Lost"} ${scoreText(tw.points_for, tw.points_against)} This Week` : "";
    const color = team(s.team).colors && team(s.team).colors.primary;
    const card = el("section", { class: "go-card ofc-hero go-game-next", "aria-label": "Next Game", ...(color ? { style: `--ofc-team:${color}` } : {}) });
    if (played) {                              // Game Day is done: this week's final leads until you advance (the next game waits)
      const won = !!tw.won;
      card.append(el("div", { class: "card-bar ofc-hero-head" }, [el("div", { class: "ofc-hero-when" }, [kicker(`Final · ${weekName(s, tw.week)}${tw.date ? ` · ${dateText(tw.date, s)}` : ""}`)]),
          el("span", { class: "ofc-chip go-venue", text: VENUE[tw.venue] || "Home Game" })]),
        el("div", { class: "ofc-match go-sides" }, [side(s.team, s.team_name, s.my_rank && s.my_rank.rank, recText(s.record), true),
          el("span", { class: `ofc-final ${won ? "won" : "lost"}`, "aria-label": `${won ? "Won" : "Lost"} ${scoreText(tw.points_for, tw.points_against)}` }, [
            el("span", { class: `go-result ${won ? "good" : "bad"}`, text: won ? "W" : "L" }), el("b", { text: scoreText(tw.points_for, tw.points_against) })]),
          side(tw.opponent, tw.opponent_name, tw.opponent_rank, tw.opponent_record, false)]),
        el("p", { class: "muted ofc-hero-note", text: s.current_week + 1 < FINAL_WEEK ? `Advance the week: everyone else plays, then on to ${weekName(s, s.current_week + 2)}.` : "Advance the week: everyone else plays and the season ends." }),
        playRow(s));
      return card;
    }
    if (!g) {
      const w = s.current_week + 1;
      card.append(el("div", { class: "card-bar ofc-hero-head" }, [kicker(played ? result : `${weekName(s, w)}${((s.week_dates || {})[w] || {}).main ? ` · ${dateText(s.week_dates[w].main, s)}` : ""}`)]),
        el("div", { class: "ofc-title", text: played ? "Next Game Not Set Yet" : "No Game This Week" }),
        el("p", { class: "muted ofc-hero-note", text: played ? "Advance the week: everyone else plays, then what comes next is set." : w > 14 ? "Your games are done for now: the rest of the postseason plays on." : "A week off: recruit, then sim the week." }),
        playRow(s));
      return card;
    }
    const bye = !thisWeek && !played;
    const k = `${played ? `${result} · Next Game · ` : bye ? "Bye This Week · Next Game · " : ""}${weekName(s, g.week)}${g.date ? ` · ${dateText(g.date, s)}` : ""}`;
    const name = g.title || (g.rivalry && g.rivalry.name) || null;
    const head = el("div", { class: "card-bar ofc-hero-head" }, [el("div", { class: "ofc-hero-when" }, [kicker(k)]), el("span", { class: "ofc-chip go-venue", text: VENUE[g.venue] || "Home Game" })]);
    const title = (name || g.site) ? el("div", { class: "ofc-hero-name" }, [name ? el("div", { class: "ofc-title", text: name }) : null, g.site ? el("div", { class: "muted small ofc-site", text: g.site }) : null]) : null;
    const myRank = s.my_rank && s.my_rank.rank;
    const match = el("div", { class: "ofc-match go-sides" }, [side(s.team, s.team_name, myRank, recText(s.record), true),
      el("span", { class: "ofc-vs go-vs", text: g.venue === "away" ? "at" : "vs" }),
      side(g.opponent, g.opponent_name, g.opponent_rank, g.opponent_record, false)]);
    card.append(head, ...(title ? [title] : []), match);
    if (thisWeek) {
      const edge = el("div", { class: "go-edge ofc-edge" }, [el("span", { class: "muted small", text: "Scouting the matchup…" })]);
      card.append(edge);
      H.api(`/api/season/${s.id}/preview?team=${s.team}`).then((pv) => {
        const p = pv && pv.prediction;
        edge.innerHTML = "";
        if (!p || p.win_prob == null) return;
        const mine = winPct(p.win_prob), theirs = 100 - mine;
        edge.append(el("div", { class: "go-kicker muted ofc-odds-label", text: "Win Chance" }),
          el("div", { class: "ofc-odds", role: "img", "aria-label": `Win chance: ${s.team_name} ${mine}%, ${g.opponent_name} ${theirs}%` }, [
            el("b", { class: "ofc-odds-mine", text: `${mine}%` }),
            el("span", { class: "ofc-odds-bar" }, [el("i", { style: `width:${mine}%` })]),
            el("b", { class: "ofc-odds-theirs", text: `${theirs}%` })]),
          el("div", { class: "muted small ofc-projected" }, ["Projected ", el("b", { text: scoreText(Math.round(p.points_for), Math.round(p.points_against)) })]));
        ui().fadeIn(edge);
      }).catch(() => { edge.innerHTML = ""; });
    }
    card.append(playRow(s));
    return card;
  }

  function doneHero(s, games) {
    const color = team(s.team).colors && team(s.team).colors.primary;
    const stage = s.offseason_stage && STAGE_NAMES[s.offseason_stage];
    return el("section", { class: "go-card ofc-hero ofc-done", "aria-label": "Season Complete", ...(color ? { style: `--ofc-team:${color}` } : {}) }, [
      el("div", { class: "card-bar ofc-hero-head" }, [kicker(`Season Complete · ${s.year || ""}`.trim()), el("span", { class: "ofc-chip", text: stage ? `Offseason · ${stage}` : "Offseason" })]),
      el("div", { class: "go-display xl ofc-done-title", text: s.champion_name ? `${s.champion_name} Won It All` : "That's a Wrap" }),
      el("div", { class: "ofc-match ofc-match-one" }, [side(s.team, s.team_name, s.my_rank && s.my_rank.rank, recText(s.record), true)]),
      el("p", { class: "muted ofc-hero-note", text: "The offseason is next: departures, the transfer portal, your staff and your meeting with the AD." }),
      el("div", { class: "go-play ofc-play" }, [el("button", { type: "button", class: "go-btn primary big ofc-go", text: "On to the Offseason →", onclick: () => H.onChange("offseason") })])]);
  }

  // ----- Last Game: the score, four team stats, the score by quarter and the leaders -------------------
  const SIDES = ["away", "home"];     // the box score reads away first
  function lastGameCard(s, g) {
    const full = g.has_box && g.event_id ? el("button", { type: "button", class: "go-btn go-full-box", text: "Full Box Score" }) : null;
    if (full) ui().on(full, "click", () => H.openBox(g.event_id));
    const card = el("section", { class: "go-card go-game go-game-last", "aria-label": "Last Game" }, [
      el("div", { class: "card-bar go-game-head" }, [kicker(`Last Game · ${weekName(s, g.week)}`), full]),
      el("div", { class: "go-final ofc-score" }, [pill(s.team, "m"),
        el("span", { class: "ofc-score-mid" }, [el("span", { class: `go-result ${g.won ? "good" : "bad"}`, text: g.won ? "W" : "L" }),
          el("span", { class: "ofc-big go-final-score", text: scoreText(g.points_for, g.points_against) })]),
        pill(g.opponent, "m")]),
      el("div", { class: "ofc-final-opp muted" }, [g.venue === "away" ? "at " : "vs ", el("b", { class: "ofc-ink", text: g.opponent_name }),
        g.overtime ? ` · ${g.overtime > 1 ? `${g.overtime}OT` : "OT"}` : ""])]);
    if (!full) return card;
    const detail = el("div", { class: "go-box-mini" }, [el("span", { class: "muted small", text: "Loading the box score…" })]);
    card.append(detail);
    H.api(`/api/season/${s.id}/game/${encodeURIComponent(g.event_id)}`).then((b) => {
      detail.innerHTML = "";
      if (!b || !b.home || !b.away) return;
      window.CFP.boxNames(b);
      const mine = b.home_slug === s.team ? "home" : "away";
      const ts = b[mine].team_stats || {};
      const tfl = (b[mine].players || []).reduce((a, p) => a + Number((p.stats && p.stats.tackles_for_loss) || 0), 0);
      const n = (x) => String(Math.round(Number(x) || 0));
      detail.append(el("div", { class: "ofc-stats", "aria-label": `${s.team_name}'s team stats` }, [["Pass Yds", ts["Pass Yards"]], ["Rush Yds", ts["Rush Yards"]], ["TFL", tfl], ["Sacks", ts.Sacks]]
        .map(([k, x]) => el("div", { class: "ofc-stat" }, [el("b", { text: n(x) }), el("span", { text: k })]))),
        quarterTable(b), leadersList(b));
      ui().fadeIn(detail);
    }).catch(() => { detail.innerHTML = ""; });
    return card;
  }
  // the score by quarter, away first (as the box score reads)
  function quarterTable(b) {
    const ot = (b.home.overtime || []).length;
    const cols = ["1", "2", "3", "4", ...(ot ? ["OT"] : []), "T"];
    const row = (sd) => el("tr", { class: b.winner === sd ? "won" : "" }, [el("th", { scope: "row" }, [window.CFP.teamPill(b[`${sd}_slug`]), ` ${abbr(b[`${sd}_slug`], b[sd].name)}`]),
      ...(b[sd].quarters || []).slice(0, 4).map((q) => el("td", { text: String(q) })),
      ...(ot ? [el("td", { text: String((b[sd].overtime || []).reduce((a, x) => a + x, 0)) })] : []),
      el("td", { class: "total", text: String(b[sd].score) })]);
    return el("table", { class: "go-quarters", "aria-label": "Score by quarter" }, [
      el("thead", {}, [el("tr", {}, [el("th", { text: "" }), ...cols.map((c) => el("th", { scope: "col", text: c }))])]),
      el("tbody", {}, SIDES.map(row))]);
  }
  // the game's leaders, both teams: the top passer, rusher, receiver and defender
  function leadersList(b) {
    const all = [];
    for (const sd of SIDES) for (const p of b[sd].players || []) all.push({ p, slug: b[`${sd}_slug`] });
    const st = (x, k) => (x.p.stats && x.p.stats[k]) || 0;
    const best = (score, ok) => all.filter(ok).sort((a, z) => score(z) - score(a))[0];
    const tds = (n, w) => (n ? `, ${n} ${w}` : "");
    const rows = [];
    const pass = best((x) => st(x, "pass_yards"), (x) => st(x, "pass_attempts") > 0);
    if (pass) rows.push(["Passing", pass, `${st(pass, "pass_yards")} yds${tds(st(pass, "passing_touchdowns"), "TD")}${tds(st(pass, "interceptions_thrown"), "INT")}`]);
    const rush = best((x) => st(x, "rush_yards"), (x) => st(x, "carries") > 0);
    if (rush) rows.push(["Rushing", rush, `${st(rush, "rush_yards")} yds${tds(st(rush, "rushing_touchdowns"), "TD")}`]);
    const recv = best((x) => st(x, "receiving_yards"), (x) => st(x, "receptions") > 0);
    if (recv) rows.push(["Receiving", recv, `${st(recv, "receiving_yards")} yds${tds(st(recv, "receiving_touchdowns"), "TD")}`]);
    const tk = (x) => st(x, "solo_tackles") + st(x, "assisted_tackles");
    const def = best((x) => tk(x) + 3 * st(x, "sacks") + 4 * st(x, "interceptions"), (x) => tk(x) + st(x, "sacks") + st(x, "interceptions") > 0);
    if (def) rows.push(["Defense", def, [`${tk(def)} tkl`, st(def, "sacks") ? `${st(def, "sacks")} sk` : "", st(def, "interceptions") ? `${st(def, "interceptions")} INT` : ""].filter(Boolean).join(", ")]);
    const short = (nm) => { const w = String(nm).split(" "); return w.length > 1 ? `${w[0][0]}. ${w.slice(1).join(" ")}` : nm; };
    return el("ul", { class: "go-leaders" }, rows.map(([k, x, line]) => el("li", { title: `${x.p.name}, ${x.p.position}: ${line}` }, [el("span", { class: "go-kicker muted", text: k }),
      el("span", { class: "go-leader-who" }, [window.CFP.teamPill(x.slug), el("b", { text: ` ${short(x.p.name)}` })]),
      el("span", { class: "go-leader-line", text: line })])));
  }

  // ----- This Week's Plan ------------------------------------------------------------------------------
  function planCard(s, steps) {
    const act = { recruit: () => H.onChange("recruiting"), gameday: () => H.play("gameday"), advance: () => H.play("advance") };
    return el("section", { class: "go-card ofc-plan", "aria-label": "This Week's Plan" }, [bar("This Week's Plan"),
      el("ol", { class: "ofc-steps" }, steps.map((x, i) => el("li", {}, [el("button", { type: "button", class: `ofc-step ${x.state}`, "data-step": x.key,
        ...(x.state === "now" ? { "aria-current": "step" } : {}), onclick: act[x.key] }, [
        el("span", { class: "ofc-step-h" }, [el("span", { class: "ofc-dot", "aria-hidden": "true", text: x.done ? "✓" : String(i + 1) }), el("b", { text: x.title }),
          x.part ? el("span", { class: "ofc-step-tag", text: "Hours Left" }) : null]),
        el("span", { class: "ofc-step-sub muted", text: x.sub })])])))]);
  }

  // ----- Program News and Around the Conference --------------------------------------------------------
  function newsLine(s, n) {
    if (n.kind === "game") {
      const where = n.venue === "away" ? " on the road" : n.venue === "neutral" ? " at a neutral site" : "";
      return [el("b", { class: "ofc-ink", text: s.team_name }), ` ${n.won ? "beat" : "lost to"} ${n.opponent_name} ${scoreText(n.points_for, n.points_against)}${where}${n.overtime ? " in overtime" : ""}.`];
    }
    if (n.kind === "promise")                 // a promised start slipping: your player says so (his player page on the name)
      return [el("a", { href: "#", class: "plink ofc-ink", "data-player": `${s.team}|${n.name}|${n.position}|${n.slug}`, title: "Open player page", text: n.name }),
        ` (${n.position}): "${n.line}"`];
    const who = el("button", { type: "button", class: "go-link", text: n.name, onclick: () => window.Recruiting && window.Recruiting.openProfile(s, n.pid) });
    const tag = ` (${n.position}, `;
    const what = n.kind === "asked_more" && n.school === s.team ? `wants more NIL from you: ${n.rival_name || "a rival"} offered more.`
      : ["bloomed", "pro", "twist", "hat", "softened"].includes(n.kind) && n.line ? (/^He /.test(n.line) ? n.line.replace(/^He /, "") : `· ${n.line}`)
      : n.kind === "unsigned" ? "went unsigned."
      : `${(rec().eventWord || ((e) => e.kind))(n)} ${n.school_name || ""}`.trim() + ".";
    return [who, tag, el("span", { class: "ofc-stars", text: stars(n.stars) }), `) ${what}`,
      n.reason ? el("span", { class: "muted small", text: ` ${n.reason}` }) : null];
  }
  function newsCard(s, items) {
    const card = el("section", { class: "go-card ofc-news", "aria-label": "Program News" }, [bar("Program News")]);
    if (!items) { card.append(loading("Loading the news…")); return card; }
    if (!items.length) { card.append(el("p", { class: "muted", text: "No program news yet. Results and recruiting moves show here as the weeks go." })); return card; }
    card.append(el("ul", { class: "ofc-feed" }, items.map((n) => el("li", {}, [el("span", { class: "ofc-feed-text" }, newsLine(s, n)),
      el("span", { class: "ofc-when muted", text: n.week === s.current_week ? "This Week" : weekName(s, n.week) })]))));
    return card;
  }
  // Keeps His Word: your reputation for keeping promises, in a word (coach_career/word.py); the position that has heard
  // the worst, if any; the latest kept and broken promises
  function wordCard(w) {
    const card = el("section", { class: "go-card ofc-word", "aria-label": "Keeps His Word" },
      [bar("Keeps His Word", w ? el("span", { class: "ofc-chip", text: w.text }) : null)]);
    if (!w) { card.append(loading("Loading your word…")); return card; }
    if (w.weakest) card.append(el("p", { class: "ofc-word-weak", text: `${w.weakest.name} have heard: ${w.weakest.text}.` }));
    if (w.recent.length) card.append(el("ul", { class: "ofc-feed" }, w.recent.map((t) => el("li", {}, [el("span", { class: "ofc-feed-text", text: t })]))));
    else card.append(el("p", { class: "muted", text: "No promises judged yet. Recruits and players hear how you keep them." }));
    return card;
  }
  function confCard(s, c) {
    const name = c ? confShort(c.name) : confShort(s.conference);
    const card = el("section", { class: "go-card ofc-conf", "aria-label": `Around the ${name}` }, [bar(`Around the ${name}`)]);
    if (!c) { card.append(loading("Loading the scores…")); return card; }
    if (!c.games.length) card.append(el("p", { class: "muted", text: "No results yet. The scores show here after the first games." }));
    else card.append(el("ul", { class: "ofc-results" }, c.games.map((g) => {
      const aw = g.away_score > g.home_score;
      const team = (slug, nm, won) => el("span", { class: `ofc-res-team${won ? " won" : ""}` }, [pill(slug), el("b", { text: abbr(slug, nm), title: nm })]);
      return el("li", { class: g.mine ? "mine" : "" }, [team(g.away, g.away_name, aw), el("b", { class: "ofc-res-score", text: scoreText(g.away_score, g.home_score) }),
        team(g.home, g.home_name, !aw), el("span", { class: "ofc-when muted", text: g.overtime ? "Final/OT" : "Final" })]);
    })));
    card.append(el("p", { class: "muted ofc-conf-line", text: confLine(s, c) }));
    return card;
  }
  // one sentence on where you stand
  function confLine(s, c) {
    const st = c.standing, name = confShort(c.name);
    if (c.independent || !st) return `${s.team_name} plays as an independent: ${recText(st || s.record)} on the season.`;
    if (!(st.conf_wins + st.conf_losses)) return `${s.team_name} has not played a conference game yet.`;
    const where = `${ordinal(st.conf_rank)} of ${st.of} in the ${name}${st.division ? ` ${st.division}` : ""}`;
    if (s.done) return `${s.team_name} finished ${where}, ${st.conf_wins}-${st.conf_losses} in conference play.`;
    const after = c.week ? ` after ${weekName(s, c.week)}` : "";
    return `${s.team_name} sits ${where}${after}, ${st.conf_wins}-${st.conf_losses} in conference play.`;
  }
  // the standing line under your record: "2nd in the SEC · 3-0 SEC"; before any game "SEC · 0-0"
  function standingText(s, c) {
    const st = c && c.standing;
    if (!st) return "";
    const name = confShort(c.name);
    if (c.independent) return `${name} · ${st.wins}-${st.losses}`;
    if (!(st.wins + st.losses)) return `${name} · 0-0`;
    return `${ordinal(st.conf_rank)} in the ${name}${st.division ? ` ${st.division}` : ""} · ${st.conf_wins}-${st.conf_losses} ${name}`;
  }

  // ----- the right column ------------------------------------------------------------------------------
  function pulseCard(s, games) {
    const g = games.last;
    const job = s.job;
    const kv = [el("span", { class: "go-kicker muted ofc-label", text: "Last Game" }),
      g ? el("span", { class: "ofc-kv-line" }, [el("span", { class: `go-result small ${g.won ? "good" : "bad"}`, text: g.won ? "W" : "L" }),
        el("b", { text: scoreText(g.points_for, g.points_against) }), ` ${g.venue === "away" ? "at" : "vs"} ${g.opponent_name}`])
        : el("span", { class: "muted", text: "No games yet." })];
    if (job) kv.push(el("span", { class: "go-kicker muted ofc-label", text: "AD Goal" }),
      el("span", { class: "ofc-kv-line ofc-goal" }, [el("b", { text: job.goal }),
        el("span", { class: `go-tag ${job.security < 40 ? "bad" : job.security < 65 ? "warn" : "good"}`, text: `${job.mood}${job.ultimatum ? " · Ultimatum Year" : ""}` })]));
    const rank = s.my_rank && s.my_rank.rank;
    return el("section", { class: "go-card ofc-pulse", "aria-label": "Program Pulse" }, [bar("Program Pulse"),
      el("div", { class: "ofc-pulse-grid" }, [
        el("div", { class: "ofc-pulse-main" }, [el("div", { class: "ofc-big", text: recText(s.record) }),
          el("div", { class: "go-standing-line", "aria-label": "Your standing" }),
          rank ? el("div", { class: "muted small", text: `#${rank} in the ${s.my_rank.kind === "cfp" ? "CFP Rankings" : "AP Poll"}` }) : null]),
        el("div", { class: "ofc-kv" }, kv)])]);
  }
  function recruitCard(s, v) {
    const card = el("section", { class: "go-card ofc-recruit", "aria-label": "Recruiting Pulse" }, [bar("Recruiting Pulse")]);
    if (!v) { card.append(loading("Loading recruiting…")); return card; }
    const row = (val, label) => el("span", {}, [el("b", { text: val }), ` ${label}`]);
    card.append(el("div", { class: "ofc-pulse-grid" }, [
      el("div", { class: "ofc-pulse-main" }, [el("div", { class: "ofc-big", text: `${v.committed} / ${v.open_spots}` }), el("div", { class: "muted", text: "Commitments" }),
        el("div", { class: "muted small", text: `Class of ${(s.year || 2026) + 1}${v.committed && v.class_rank ? ` · Rank #${v.class_rank}` : ""}` })]),
      el("div", { class: "ofc-kv ofc-kv-rows" }, [row(`${v.hours_left} / ${v.hours}`, "Recruiting Hours"), row(`${v.nil.left} / ${v.nil.budget}`, "NIL Points"),
        row(`${v.points_left} / ${v.points_week}`, "Scouting Points"), row(`${v.committed} of ${v.open_spots}`, "Spots Filled")])]));
    return card;
  }
  function targetsCard(s, v) {
    const card = el("section", { class: "go-card ofc-targets", "aria-label": "Top Targets" }, [bar("Top Targets", el("button", { type: "button", class: "go-link ofc-board", text: "Board →", onclick: () => H.onChange("recruiting") }))]);
    if (!v) { card.append(loading("Loading your board…")); return card; }
    const list = (v.targets && v.targets.length ? v.targets : (v.board || []).filter((b) => !b.committed && !b.signed)).slice(0, 4);
    if (!list.length) { card.append(el("p", { class: "muted", text: "Add prospects to your board and your top targets show here." })); return card; }
    const R = rec();
    card.append(el("div", { class: "ofc-target-list" }, list.map((b) => {
      const sd = R.standingOf ? R.standingOf(b, s.team) : { word: "Not Offered", tone: "muted" };
      const rank = b.national_rank != null ? b.national_rank : b.portal_rank;
      return el("button", { type: "button", class: "ofc-target", title: sd.odds || sd.text || "", onclick: () => window.Recruiting && window.Recruiting.openProfile(s, b.id) }, [
        R.avatar ? R.avatar(b.id, "sm") : null,
        el("span", { class: "ofc-target-text" }, [el("b", { text: b.name }),
          el("span", { class: "small" }, [el("span", { class: "ofc-stars", text: stars(b.stars) }), el("span", { class: "muted", text: ` ${b.position}${rank != null ? ` · #${rank}` : ""}` })])]),
        el("span", { class: `go-tag ${sd.tone || ""}`, text: sd.word })]);
    })));
    return card;
  }

  // ----- the page ------------------------------------------------------------------------------------
  async function render(s, box, helpers) {
    H = helpers;
    box.innerHTML = "";
    const games = gamesOf(s);
    const page = el("div", { class: "go-office ofc" });
    box.append(page);
    if (s.current_week >= SIGNING_WEEK) {
      const final = s.current_week >= FINAL_WEEK;
      page.append(el("button", { type: "button", class: "go-signing", onclick: () => H.onChange("classes") }, [
        el("span", { class: "go-display m", text: final ? "National Signing Day Is Done" : "The Early Signing Period Is Done" }),
        el("span", { text: final ? "Every class is signed. See how yours ranks →" : "Commitments signed in December. See every school's class →" })]));
    }
    const grid = el("div", { class: "ofc-grid" });
    page.append(grid);
    // row by row: Next Game beside Program Pulse; Last Game and This Week's Plan beside Recruiting Pulse; What Changed
    // across; Program News, Around the Conference and Top Targets as one row (office.css lays the grid out)
    const pulse = pulseCard(s, games);
    grid.append(heroCard(s, games), pulse);
    const row1 = el("div", { class: "ofc-row" });
    if (games.last) row1.append(lastGameCard(s, games.last));
    const planSlot = s.done ? null : el("section", { class: "go-card ofc-plan", "aria-label": "This Week's Plan" }, [bar("This Week's Plan"), loading("Loading your week…")]);
    if (planSlot) row1.append(planSlot);
    let recruit = recruitCard(s, null), targets = targetsCard(s, null);
    if (row1.children.length) grid.append(row1);
    grid.append(recruit);
    const reportSlot = el("div", { class: "ofc-report-slot" });
    grid.append(reportSlot);
    let news = newsCard(s, null), conf = confCard(s, null), wordBox = wordCard(null);
    grid.append(news, conf, targets, wordBox);

    // the reads land in place: each card swaps its loading line for the real one
    // (a card that grows or shrinks as it fills eases to its height: the column under it slides, never jumps)
    const swap = (old, fresh) => { if (old.isConnected) { const h0 = old.getBoundingClientRect().height; old.replaceWith(fresh); ui().fadeIn(fresh); ui().glide(fresh, h0); } return fresh; };
    H.api(`/api/season/${s.id}/office`).then((o) => {
      news = swap(news, newsCard(s, o.news || []));
      conf = swap(conf, confCard(s, o.conference));
      wordBox = swap(wordBox, wordCard(o.word || { text: "Strong", weakest: null, recent: [] }));
      const line = pulse.querySelector(".go-standing-line");
      line.textContent = standingText(s, o.conference);
    }).catch((err) => {
      news = swap(news, el("section", { class: "go-card ofc-news" }, [bar("Program News"), el("p", { class: "muted", text: `Could not load the news: ${H.errText(err)}` })]));
      conf.querySelector(".go-loading")?.remove();
      wordBox.querySelector(".go-loading")?.remove();
    });
    let v;
    try { v = await H.api(`/api/season/${s.id}/recruiting`); }
    catch (err) {
      const msg = `Could not load recruiting: ${H.errText(err)}`;
      for (const c of [recruit, targets, planSlot]) { if (c && c.querySelector(".go-loading")) c.querySelector(".go-loading").textContent = msg; }
      return;
    }
    if (!box.contains(page)) return;
    recruit = swap(recruit, recruitCard(s, v));
    targets = swap(targets, targetsCard(s, v));
    const steps = planSteps(s, v, games.thisWeek);
    if (planSlot && steps) swap(planSlot, planCard(s, steps));
    const report = rec().reportCard ? rec().reportCard(s, v.report) : null;
    if (report) reportSlot.replaceWith(report);
  }

  window.Office = { render, planSteps, winPct };
})();
