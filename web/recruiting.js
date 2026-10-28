/* Coach Career on the season page, styled as a game: the Office (your week at a glance), the
   Recruiting board (prospect cards with your standing and one-tap actions), Prospects (the
   class, filtered), Staff (who scouts where) and the Prospect Profile.
   window.Recruiting.render(tab, season, helpers); helpers from season.js: { api, postJSON, toast,
   openModal, closeModal, errText, onChange(tab), play(what) }. Colours come from the site's theme variables,
   so the screens read in the light and the dark theme. */
(function () {
  "use strict";
  const { el } = window.CFP;
  const PITCH_NAMES = { proximity: "Close to home", playing_time: "Playing time", prestige: "Program prestige", winning: "Winning now",
                        nil: "NIL", coach: "The head coach", academics: "Academics" };
  const GROUP_NAMES = { athleticism: "Athleticism", size_strength: "Size & strength", technique: "Technique", football_iq: "Football IQ",
                        potential: "Potential", coachability: "Coachability" };
  const STATUS = [["", "Any status"], ["interested", "Interested in you"], ["open", "Uncommitted"], ["committed", "Committed"], ["signed", "Signed"], ["leaning_fcs", "Leaning FCS"],
                  ["offered", "Offered by you"], ["board", "On your board"]];
  const POSITIONS = ["QB", "RB", "WR", "TE", "OT", "IOL", "EDGE", "DL", "LB", "CB", "S", "ATH", "K", "P"];
  const STATES = ["AK", "AL", "AR", "AZ", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "IA", "ID", "IL", "IN", "KS", "KY", "LA", "MA", "MD", "ME",
                  "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI", "SC", "SD",
                  "TN", "TX", "UT", "VA", "VT", "WA", "WI", "WV", "WY"];
  const view = { filters: { q: "", position: "", stars: "", state: "", status: "", sort: "rank", group: "" }, offset: 0, openClass: null, sort: "chance", selected: null, sheet: false, pitch: {}, group: null, state: null };
  let H = null;

  const stars = (n) => "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
  const height = (inches) => `${Math.floor(inches / 12)}'${inches % 12}"`;
  const pct = (x) => `${Math.round(100 * x)}%`;
  const ordinal = (n) => { const t = n % 100, u = n % 10; return `${n}${t > 10 && t < 14 ? "th" : u === 1 ? "st" : u === 2 ? "nd" : u === 3 ? "rd" : "th"}`; };
  // where he is from: "Washington, D.C." rather than "Washington, DC"
  const place = (h) => (h.state === "DC" ? "Washington, D.C." : `${h.city}, ${h.state}`);
  const ATTR_NAMES = { bc_vision: "ball carrier vision", "bc vision": "ball carrier vision" };
  // readable ink on a team colour
  function inkOn(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return "#ffffff";
    const n = parseInt(m[1], 16), lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return L > 0.4 ? "#111111" : "#ffffff";
  }
  const plural = (pos) => ({ OL: "OL", DL: "DL", MLB: "LBs", ROLB: "LBs", LOLB: "LBs", LB: "LBs" }[pos] || `${pos}s`);
  const teamName = (slug) => (slug === "FCS" ? "an FCS program" : (window.CFP.teamsBySlug[slug] || {}).name || slug);
  const loading = (text) => el("p", { class: "muted go-loading", text });
  const SIGNING_WEEK = 16, FINAL_WEEK = 20;       // the early signing period (selection week) and national signing day
  const WORDS = { commit: "verbally committed to", hard: "is now a hard commit to", flip: "flipped to", decommit: "decommitted from", signed: "signed with", offer: "was offered by",
                  asked_more: "wants more from", not_buying: "isn't buying the pitch from" };
  const WHY = { message: "Message", call: "Call", hc_visit: "HC visit", official_visit: "Official visit", offer: "Offer", raise_nil: "NIL raised" };
  const LINE_LABELS = { pass_yards: "pass yds", passing_touchdowns: "TD", interceptions_thrown: "INT", rush_yards: "rush yds", carries: "car", rushing_touchdowns: "TD",
    receptions: "rec", receiving_yards: "rec yds", receiving_touchdowns: "TD", snaps: "snaps", tackles: "tkl", sacks: "sacks", tackles_for_loss: "TFL",
    interceptions: "INT", passes_defended: "PD", field_goals_made: "FGM", field_goals_attempted: "FGA", punts: "punts", punt_yards: "punt yds" };
  function lineText(line) {
    const bits = [`${line.games} G`, line.started ? `${line.started} GS` : null];
    for (const [k, v] of Object.entries(line.stats || {})) bits.push(`${Number(v).toLocaleString()} ${LINE_LABELS[k] || k}`);
    return `Last season: ${bits.filter(Boolean).join(" · ")}`;
  }
  function reportCard(s, report) {
    if (!report || !report.rows.length) return null;
    const card = el("section", { class: "go-card go-report", "aria-label": "What changed" });
    card.append(el("div", { class: "go-kicker", text: `WHAT CHANGED · AFTER ${report.week === 0 ? "THE PRESEASON" : `WEEK ${report.week}`}` }));
    // the week in a glance: only prospects where something happened to you (your place moved, a
    // decision, an ask), the biggest first, one line each; his list on the card has the rest
    const BIG = new Set(["commit", "flip", "decommit", "signed", "asked_more", "not_buying"]);
    const weight = (r) => (r.rank !== r.prev_rank ? 2 : 0) + r.events.filter((e) => BIG.has(e.kind)).length * 3 + (r.moves.some((m) => m.you) ? 1 : 0);
    const rows = report.rows.filter((r) => weight(r) > 0).sort((a, b) => weight(b) - weight(a));
    if (!rows.length) return null;
    card.append(el("ul", { class: "go-news go-report-rows" }, rows.slice(0, 6).map((r) => {
      const bits = [];
      if (r.rank == null) bits.push("Not on his list");
      else if (r.prev_rank != null && r.prev_rank !== r.rank) bits.push(`${r.prev_rank > r.rank ? "Up" : "Down"} to #${r.rank} of ${r.of}${r.rank === 1 ? "" : r.leader ? ` · ${r.leader.name} leads` : ""}`);
      else bits.push(r.rank === 1 ? "You lead" : `#${r.rank} of ${r.of}${r.leader ? ` · ${r.leader.name} leads` : ""}`);
      for (const e of r.events.filter((e) => BIG.has(e.kind)).slice(0, 2)) bits.push(`${WORDS[e.kind] || e.kind} ${e.school_name || ""}`.trim());
      return el("li", {}, [el("button", { type: "button", class: "go-link", text: r.name, onclick: () => openProfile(s, r.pid) }), el("span", { class: "muted small", text: ` ${r.position} ${stars(r.stars)} · ` }), el("span", { text: bits.join(" · ") })]);
    })));
    if (rows.length > 6) card.append(el("p", { class: "muted small", text: `${rows.length - 6} more moved: see his list on the board.` }));
    return card;
  }

  function avatar(seed, size) {
    // a portrait from the coach sprite system, its look picked from his id
    let h = 0;
    for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const pick = (arr) => arr[(h = (h * 1103515245 + 12345) >>> 0) % arr.length];
    const look = { skin: pick(["#f1c9a5", "#e0b48f", "#c68e64", "#a26a42", "#7b4a2c", "#5a3520"]), hair: pick(["short", "buzz", "curly", "side part"]),
                   hair_color: pick(["#1d1410", "#3b2416", "#5a3a22", "#8a5a32", "#c49a5a"]), outfit: "hoodie" };
    const span = el("span", { class: `go-avatar ${size || ""}`, "aria-hidden": "true" });
    if (window.CoachSprite) span.innerHTML = window.CoachSprite(look, null);
    return span;
  }

  function status(r) {
    if (r.signed) return r.signed === "FCS" ? "Signed with an FCS program" : `Signed · ${teamName(r.signed)}`;
    if (r.committed) return `${r.hard ? "Hard commit" : "Verbal commit"} · ${teamName(r.committed)}`;
    if (r.leaning_fcs) return "Leaning FCS";
    return "Uncommitted";
  }

  // Your standing with a prospect: in words, the bar's fill and its range, and its tone.
  function standing(b, me) {
    const st = b.standing || {};
    const school = b.signed || b.committed;
    if (school === me) return { text: b.signed ? "Signed with you" : b.hard ? "Hard commit to you" : "Verbal commit to you", tone: "good", fill: 1 };
    if (school && (b.signed || b.hard || st.pct == null)) return { text: `${b.signed ? "Signed" : b.hard ? "Hard commit" : "Verbal commit"} · ${teamName(school)}`, tone: "bad", fill: 0, odds: b.hard && !b.signed ? "Locked in: he will not flip" : undefined };
    if (school) return { text: `Verbal commit · ${teamName(school)}`, odds: st.hi < 0.1 ? "A flip looks unlikely" : st.pct >= 0.3 ? "He could still flip to you" : "A flip is a long shot",
                         certainty: st.certainty, tone: "warn", fill: st.pct, lo: st.lo, hi: st.hi };
    if (st.place == null) return { text: st.leader ? `Not offered · ${st.leader.name} leads` : "Not offered yet", tone: "muted", fill: 0 };
    const tone = st.place === 1 ? "good" : st.pct >= st.leader.pct - 0.1 ? "warn" : "muted";
    const text = st.of === 1 ? "Only offer so far" : st.place === 1 ? `Leading ${st.of} offers` : `${ordinal(st.place)} of ${st.of} · ${st.leader.name} leads`;
    // his lean in words, never a number: a recruitment is read, not computed
    const odds = st.of === 1 ? "Yours to lose" : st.place === 1 ? (st.pct >= st.leader.pct + 0.25 || st.of === 1 ? "Clear favorite" : "Narrow favorite")
      : st.pct >= st.leader.pct - 0.1 ? "Close race" : st.pct >= 0.15 ? "Behind, in the picture" : "Long shot";
    return { text, odds, certainty: st.certainty, tone, fill: st.pct, lo: st.lo, hi: st.hi };
  }

  function bar(sd) {
    const wrap = el("div", { class: "go-bar", role: "img", "aria-label": sd.odds ? `Chance to land: ${sd.odds}` : sd.text });
    if (sd.lo != null) wrap.append(el("span", { class: "go-bar-range", style: `left:${100 * sd.lo}%;width:${100 * (sd.hi - sd.lo)}%` }));
    wrap.append(el("span", { class: `go-bar-fill ${sd.tone}`, style: `width:${sd.fill ? Math.max(2, 100 * sd.fill) : 0}%` }));
    return wrap;
  }

  async function act(s, pid, action, pitch, nil) {
    const body = { pid, action };
    if (pitch) body.pitch = pitch;
    if (nil) body.nil = nil;
    const names = { message: "Message", call: "Call", hc_visit: "Head coach visit", official_visit: "Official visit invite", offer: "Offer", pull_offer: "Offer pulled", raise_nil: "NIL raised", scout: "Scouting trip" };
    try {
      const r = await H.api(`/api/season/${s.id}/recruit`, H.postJSON(body));
      H.backupSoon();
      if (action === "scout") H.toast(`Scouting trip done · ${r.hours_left} hours left · his grades are updated`, 3000);
      else H.toast(`${names[action]} done · ${r.hours_left} hours left${r.revealed ? ` · he cares about ${PITCH_NAMES[r.revealed].toLowerCase()}` : action === "call" ? " · he kept his cards close" : ""} · it lands at the week step`, 3000);
      return r;
    } catch (err) {
      H.toast(`Could not do that: ${H.errText(err)}`, 4000);
      return null;
    }
  }
  async function setBoard(s, pid, on) {
    try { await H.api(`/api/season/${s.id}/board`, H.postJSON({ pid, on })); H.backupSoon(); return true; }
    catch (err) { H.toast(`Could not change your board: ${H.errText(err)}`, 4000); return false; }
  }

  function meter(label, value, total, alt) {
    const fill = total ? Math.max(0, Math.min(1, value / total)) : 0;
    return el("div", { class: "go-meter" }, [
      el("div", { class: "go-meter-top" }, [el("span", { text: label }), el("b", { text: `${value} / ${total}` })]),
      el("div", { class: "go-meter-track" }, [el("span", { class: `go-meter-fill ${alt ? "alt" : ""}`, style: `width:${100 * fill}%` })]),
    ]);
  }
  function stat(k, val) { return el("div", { class: "go-stat" }, [el("div", { class: "go-kicker muted", text: k }), el("div", { class: "go-stat-val", text: val })]); }
  function newsItem(s, e) {
    return el("li", {}, [el("button", { type: "button", class: "go-link", text: e.name, onclick: () => openProfile(s, e.pid) }), ` ${WORDS[e.kind] || e.kind} ${teamName(e.school)}`]);
  }

  // ----- the Office ------------------------------------------------------------------------------

  const METRIC_WORDS = (v) => (v >= 80 ? "Elite" : v >= 65 ? "Strong" : v >= 50 ? "Solid" : v >= 35 ? "Fair" : "Weak");
  const PROGRAM_METRICS = [["prestige", "Prestige", "History and a decade of results"], ["winning", "Winning", "The last three seasons"],
    ["nil", "NIL", "The collective's tier, set by your AD"], ["market", "Market", "Crowds and TV"], ["conference", "Conference", "Your league's strength"],
    ["coach", "Coach", "Your rating and tenure"]];

  // your program's living rating: the six metrics as bars, the tier and rank, and every program on request
  function programCard(pv) {
    const you = pv.you;
    if (!you) return el("div");
    const card = el("div", { class: "go-program" }, [
      el("div", { class: "go-program-head" }, [el("span", { class: "go-kicker muted", text: "YOUR PROGRAM" }),
        el("span", { class: "go-tag", text: you.tier_name, title: "Where your program stands: its name, results, NIL, market, league and coach, moving slowly with what you do" })]),
      el("div", { class: "go-program-bars" }, PROGRAM_METRICS.map(([k, label, tip]) => el("div", { class: "go-program-bar", title: tip }, [
        el("span", { class: "go-program-label", text: label }), el("i", {}, [el("b", { style: `width:${Math.max(2, Math.min(100, you[k]))}%` })]),
        el("span", { class: "go-program-val", text: METRIC_WORDS(you[k]) })]))),
    ]);
    const more = el("button", { type: "button", class: "go-btn", text: "Every program" });
    const tableBox = el("div", { hidden: true });
    more.addEventListener("click", () => {
      tableBox.hidden = !tableBox.hidden;
      more.textContent = tableBox.hidden ? "Every program" : "Hide the programs";
      if (!tableBox.hidden && !tableBox.childElementCount) tableBox.append(programsTable(pv));
    });
    card.append(el("div", { class: "go-program-foot" }, [el("span", { class: "muted small", text: "Prestige and the market move slowly with results; your AD raises NIL after a year that meets his goal." }), more]), tableBox);
    return card;
  }

  function programsTable(pv) {
    const t = el("table", { class: "stats go-programs" }, [el("thead", {}, [el("tr", {}, ["Program", "Standing", "Prestige", "Winning", "NIL", "Market", "Conf", "Coach", "The AD expects"].map((h) => el("th", { text: h })))])]);
    const body = el("tbody");
    for (const r of pv.rows) {
      body.append(el("tr", { class: r.team === pv.you.team ? "mine" : "" }, [
        el("td", {}, [window.CFP.teamPill(r.team), ` ${r.name}`]), el("td", {}, [el("span", { class: "go-tag", text: r.tier_name })]),
        ...["prestige", "winning", "nil", "market", "conference", "coach"].map((k) => el("td", { class: `word ${METRIC_WORDS(r[k]).toLowerCase()}`, text: METRIC_WORDS(r[k]) })),
        el("td", { class: "small", text: r.goal })]));
    }
    t.append(body);
    return el("div", { class: "go-scroll" }, [t]);
  }

  async function renderOffice(s, box) {
    box.innerHTML = "";
    const me = s.team;
    const next = s.done ? null : (s.schedule || []).find((g) => g.week === s.current_week + 1);
    const week = el("section", { class: "go-card go-week", "aria-label": "This week" });
    const rec = el("section", { class: "go-card go-rec", "aria-label": "Recruiting" }, [loading("Loading recruiting…")]);
    box.append(el("div", { class: "go-office" }, [week, rec]));

    const when = next && next.date ? ` · ${new Date(next.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}` : "";
    week.append(el("div", { class: "go-kicker", text: s.done ? "SEASON COMPLETE" : `THIS WEEK · ${((s.week_labels && s.week_labels[s.current_week + 1]) || `Week ${s.current_week + 1}`).toUpperCase()}${when}` }));
    const head = el("div", { class: "go-week-head" });
    week.append(head);
    if (s.current_week >= SIGNING_WEEK) {
      const final = s.current_week >= FINAL_WEEK;
      box.prepend(el("button", { type: "button", class: "go-signing", onclick: () => H.onChange("classes") }, [
        el("span", { class: "go-display m", text: final ? "NATIONAL SIGNING DAY IS DONE" : "THE EARLY SIGNING PERIOD IS DONE" }),
        el("span", { text: final ? "Every class is signed. See how yours ranks →" : "Commitments signed in December. See every school's class →" })]));
    }
    const boxes = el("div", { class: "go-stats" });
    if (s.job) week.append(el("div", { class: `go-job ${s.job.security < 40 ? "bad" : s.job.security < 65 ? "warn" : "good"}` }, [
      el("span", { class: "go-kicker muted", text: "YOUR AD'S GOAL" }), el("b", { text: ` ${s.job.goal}` }),
      el("span", { class: "go-tag", text: `${s.job.mood}${s.job.ultimatum ? " · ultimatum year" : ""}` })]));
    if (s.job) {
      const progBox = el("div");
      week.append(progBox);
      H.api(`/api/season/${s.id}/programs`).then((pv) => progBox.replaceWith(programCard(pv))).catch(() => progBox.remove());
    }
    if (s.done) {
      head.append(el("div", { class: "go-display xl", text: s.champion_name ? `${s.champion_name.toUpperCase()} WON IT ALL` : "THAT'S A WRAP" }));
      week.append(el("div", { class: "go-play" }, [el("button", { type: "button", class: "go-btn primary big", text: "ON TO THE OFFSEASON →",
        onclick: () => H.onChange("offseason") })]));
    } else if (!next || !next.opponent) {
      head.append(el("div", { class: "go-display xl", text: s.current_week + 1 > 14 ? "NO GAME THIS WEEK" : "BYE WEEK" }), el("span", { class: "go-pill", text: "Recruit, then advance" }));
    } else {
      head.append(el("div", { class: "go-matchup" }, [
        el("div", { class: "go-display xl", text: `${next.venue === "away" ? "AT" : "VS"} ${String(next.opponent_name).toUpperCase()}` }),
        el("span", { class: "go-pill", text: next.played ? `Final: ${next.won ? "W" : "L"} ${next.points_for}–${next.points_against}` : next.venue === "away" ? "Road game" : next.venue === "neutral" ? "Neutral site" : "Home game" }),
      ]));
      if (!next.played) {
        const chanceVal = el("span", { class: "go-display l", text: "…" });
        head.append(el("div", { class: "go-chance" }, [el("span", { class: "go-kicker muted", text: "WIN CHANCE" }), chanceVal]));
        boxes.append(loading("Scouting the matchup…"));
        H.api(`/api/season/${s.id}/preview?team=${me}`).then((pv) => {
          const p = pv.prediction;
          boxes.innerHTML = "";
          if (!p) { chanceVal.textContent = "—"; return; }
          chanceVal.textContent = pct(p.win_prob);
          chanceVal.classList.add(p.win_prob >= 0.5 ? "good" : "bad");
          boxes.append(stat("PROJECTED SCORE", `${Math.round(p.points_for)}–${Math.round(p.points_against)}`),
                       stat("MARGIN", `${p.margin > 0 ? "+" : ""}${p.margin}`), stat("BASED ON", `${p.sims} sims`));
        }).catch(() => { boxes.innerHTML = ""; chanceVal.textContent = "—"; });
      }
    }
    week.append(boxes);
    const steps = el("div", { class: "go-steps" });
    week.append(el("div", { class: "go-kicker muted", text: "YOUR WEEK" }), steps);
    let reportBox = el("div");
    week.append(reportBox);
    if (!s.done) {
      const gameReady = !!(next && next.opponent && !next.played);
      const main = el("button", { type: "button", class: "go-btn primary big", text: gameReady ? "PLAY GAME DAY" : "ADVANCE THE WEEK" });
      main.addEventListener("click", () => H.play(gameReady ? "gameday" : "advance"));
      const sim = el("button", { type: "button", class: "go-btn big2", text: gameReady ? "Sim the week" : "Sim to selection" });
      sim.addEventListener("click", () => H.play(gameReady ? "advance" : "selection"));
      const end = el("button", { type: "button", class: "go-btn big2", text: "Sim to the end" });
      end.addEventListener("click", () => H.play("end"));
      // sim through a week of your choosing (the recruiting weeks in between run on Auto)
      const to = el("select", { class: "go-sel", "aria-label": "Sim to a week" }, [el("option", { value: "", text: "Sim to week…" })]);
      for (let k = s.current_week + 2; k <= 20; k++) to.append(el("option", { value: String(k), text: `Through ${s.week_labels[k] || `Week ${k}`}` }));
      to.addEventListener("change", () => { if (to.value) H.play("advance_to", Number(to.value)); });
      week.append(el("div", { class: "go-play" }, [main, sim, end, to.options.length > 1 ? to : null]));
    }

    let v;
    try { v = await H.api(`/api/season/${s.id}/recruiting`); }
    catch (err) { rec.innerHTML = ""; rec.append(loading(`Could not load recruiting: ${H.errText(err)}`)); return; }
    const auto = v.auto_recruit !== "off";
    const report = reportCard(s, v.report);
    if (report) reportBox.replaceWith(report);
    const recruitDone = auto || v.hours_left < 5;
    const gameDone = !next || !next.opponent || !!next.played;
    if (!s.done) {
      steps.append(
        step(recruitDone ? "✓" : "1", "Recruit", auto ? (v.auto_recruit === "week" ? "Auto-recruit this week" : "Auto-recruit all season") : `${v.hours_used} of ${v.hours} hours used`, recruitDone ? "done" : "now", () => H.onChange("recruiting")),
        step(gameDone ? "✓" : "2", "Game day", !next || !next.opponent ? (s.current_week + 1 > 14 ? "No game this week" : "Bye week") : next.played ? "Played" : "Coach it drive by drive", gameDone ? "done" : recruitDone ? "now" : "", () => H.play("gameday")),
        step("3", "Advance", "Everyone else plays", recruitDone && gameDone ? "now" : "", () => H.play("advance")),
      );
    }
    rec.innerHTML = "";
    rec.append(el("div", { class: "go-card-head" }, [el("div", { class: "go-kicker", text: `RECRUITING · CLASS OF ${(s.year || 2026) + 1}` }),
      el("button", { type: "button", class: "go-link", text: "Board →", onclick: () => H.onChange("recruiting") })]),
      el("div", { class: "go-big-line" }, [el("span", { class: "go-display xl", text: String(v.committed) }),
        el("span", { class: "muted", text: `of ${v.open_spots} spots committed${v.committed ? ` · class rank #${v.class_rank}` : ""}` })]),
      el("div", { class: "go-mini" }, [stat("HOURS LEFT", `${v.hours_left} / ${v.hours}`), stat("NIL POINTS", `${v.nil.left} / ${v.nil.budget}`)]),
      el("div", { class: "go-kicker muted", text: "HOT TARGETS" }));
    rec.append(v.targets.length
      ? el("div", { class: "go-targets" }, v.targets.map((b) => {
          const sd = standing(b, me);
          return el("button", { type: "button", class: "go-target", onclick: () => openProfile(s, b.id) }, [avatar(b.id, "sm"),
            el("span", { class: "go-target-text" }, [el("b", { text: b.name }), el("span", { class: "muted small", text: `${stars(b.stars)} ${b.position} · #${b.national_rank} · ${sd.odds || ""}` })]),
            el("span", { class: `go-tag ${sd.tone}`, text: ordinal(b.standing.place) })]);
        }))
      : el("p", { class: "muted", text: "Offer prospects on your board and your hottest targets show here." }));
    rec.append(el("div", { class: "go-kicker muted", text: s.current_week ? "THIS WEEK'S NEWS" : "NEWS" }));
    rec.append(v.recap.length ? el("ul", { class: "go-news" }, v.recap.slice(-5).reverse().map((e) => newsItem(s, e)))
      : el("p", { class: "muted", text: "No recruiting news yet. Commitments come over the fall." }));

    function step(mark, title, sub, state, onclick) {
      return el("button", { type: "button", class: `go-step ${state}`, onclick }, [el("span", { class: "go-step-mark", text: mark }),
        el("span", { class: "go-step-text" }, [el("b", { text: title }), el("span", { class: "muted small", text: sub })])]);
    }
  }

  // ----- the Recruiting board ----------------------------------------------------------------------

  const ACT_TIPS = { message: "Send a message with your pitch: 5 hours", call: "Call him with your pitch: 15 hours; can reveal one of his priorities",
                    hc_visit: "Head coach in-home visit with your pitch: 30 hours, once every 4 weeks; you learn a priority and his number",
                    offer: "Offer a scholarship with the NIL points set here: no hours. Only an offer lets him commit to you",
                    official_visit: "Invite him on an official visit: 10 hours; the visit reveals all his priorities",
                    scout: "Send your best evaluator to see him: 5 hours a look, up to three looks, any week; each look tightens his grades without waiting on the area scout" };

  // ----- what the roster needs, by group: one strip on the board and the class, with a way of counting -----
  const NEED_MODES = [["need", "What's left", "A healthy 85-man roster's make-up minus the players coming back minus your commits"],
    ["commits", "Committed / need", "Your commits at each position against the spots this class needs to fill"],
    ["firm", "Hard commits / need", "Hard commits (locked in, cannot flip) against the spots to fill"],
    ["board", "On board / need", "Uncommitted prospects on your board at each position against the spots to fill"],
    ["offers", "Offers out / need", "Your open offers at each position against the spots to fill"],
    ["left", "Only what's short", "Just the positions still short, by how many"]];
  const GROUP_ORDER = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"];
  const GRADE_NAMES = { athleticism: "Athleticism", size_strength: "Size", technique: "Technique", football_iq: "IQ", potential: "Potential", coachability: "Coachability" };
  // a scouted prospect's grades in one line (his card and the top of his profile)
  const clsWord = (c) => (c && c.endsWith("RS") ? `RS ${c.slice(0, -2)}` : c);   // FRRS -> "RS FR"
  // a scouting word as a coloured pill; the class is the word lower-cased ("All-American" -> all-american)
  const wordTag = (word) => el("span", { class: `go-word ${String(word).toLowerCase()}`, text: word });
  // a [low, high] pair of words: one tag when both ends match, else "low to high"
  const wordRange = (r) => (r[0] === r[1] ? [wordTag(r[0])] : [wordTag(r[0]), " to ", wordTag(r[1])]);
  const wordText = (r) => (r[0] === r[1] ? r[0] : `${r[0]} to ${r[1]}`);
  function scoutLine(grades, looks) {
    return el("div", { class: "go-scouted", title: `Your staff's read after ${looks} looks: the range each grade could still fall in` }, [el("b", { text: "SCOUTED" }),
      ...["potential", "athleticism", "technique", "football_iq", "size_strength", "coachability"].filter((k) => grades[k]).map((k) => el("span", {}, [el("span", { class: "muted", text: `${GRADE_NAMES[k]} ` }), el("b", {}, wordRange(grades[k]))]))]);
  }
  function needsMode() { try { return localStorage.getItem("cfp-needs-mode") || "need"; } catch (e) { return "need"; } }
  function needText(mode, g, r) {
    const spots = r.need + r.commits;                       // the spots this class fills at the position
    if (mode === "commits") return `${g} ${r.commits}/${spots}`;
    if (mode === "firm") return `${g} ${r.firm}/${spots}`;
    if (mode === "board") return `${g} ${r.board}/${Math.max(0, r.need)}`;
    if (mode === "offers") return `${g} ${r.offers}/${Math.max(0, r.need)}`;
    return r.need > 0 ? `${g} ${r.need}` : g;
  }
  function needsStrip(detail, picked, onPick, onMode) {
    if (!detail) return el("div");
    const mode = needsMode();
    const wrap = el("div", { class: "go-needs", role: "group", "aria-label": "What your roster needs" });
    const sel = el("select", { class: "go-sel go-needs-mode", "aria-label": "How to count needs" }, NEED_MODES.map(([k, label, tip]) => el("option", { value: k, text: label, title: tip })));
    sel.value = mode;
    sel.addEventListener("change", () => { try { localStorage.setItem("cfp-needs-mode", sel.value); } catch (e) { /* no storage */ } onMode(); });
    wrap.append(el("b", { class: "go-needs-label", text: "NEED" }));
    let any = false;
    for (const g of GROUP_ORDER) {
      const r = detail[g];
      if (!r) continue;
      if (mode === "left" && r.need <= 0) continue;
      any = true;
      const short = r.need > 0, covered = mode === "board" || mode === "offers" ? (short && (mode === "board" ? r.board : r.offers) >= r.need) : mode !== "need" && mode !== "left" && !short;
      const b = el("button", { type: "button", class: `go-chip small ${picked === g ? "on" : ""} ${short && !covered ? "short" : "full"}`, "aria-pressed": String(picked === g),
        text: needText(mode, g, r), title: `${g}: ${r.target} on a healthy roster · ${r.back} coming back · ${r.commits} committed (${r.firm} hard) · ${r.board} on your board · ${r.offers} offers out · ${r.need > 0 ? `${r.need} still to fill` : "covered"}` });
      b.addEventListener("click", () => onPick(picked === g ? null : g));
      wrap.append(b);
    }
    if (!any) wrap.append(el("span", { class: "muted small", text: "every position is covered" }));
    wrap.append(sel);
    return wrap;
  }
  // ----- the pipeline: five columns from his stage with you, compact cards, one pane for the one you pick -----
  const COLUMNS = [["cold", "Cold"], ["contact", "In touch"], ["top", "Top 8"], ["visited", "Visited"], ["committed", "Committed"]];
  const COLUMN_TIPS = { cold: "No contact yet: an offer now counts half", contact: "You have reached out; get into his top 8 for a visit",
    top: "He is seriously considering you: invite him on a visit", visited: "He has been on campus", committed: "His recruitment is decided: committed or signed, to you or elsewhere" };
  const PHONE = "(max-width: 759px)";
  const phone = () => window.matchMedia(PHONE).matches;
  // the column he sits in: a commitment or a signature anywhere ends the race; else his stage with you
  const columnOf = (b) => (b.committed || b.signed ? "committed" : COLUMN_TIPS[b.stage] ? b.stage : "cold");

  // what stands out about him, as small tags: the staff's finds, then today's need, offer, mood and commitment
  function badges(b, me) {
    const out = el("div", { class: "go-tags go-badges" });
    if (b.generational) out.append(el("span", { class: "go-badge generational", text: "Generational", title: "A once-in-a-generation talent: every program in the country wants him" }));
    if (b.find === "gem") out.append(el("span", { class: "go-badge gem", text: "Gem", title: "Your staff's find: his potential reads Elite even at the low end, and few programs rate him that high" }));
    if (b.find === "bust") out.append(el("span", { class: "go-badge bust", text: "Bust risk", title: "Your staff's find: his ranking is high but even the top of their read is below Solid" }));
    if (b.need != null && !b.signed && b.committed !== me) out.append(el("span", { class: `go-tag ${b.need > 0 ? "good" : "muted"}`, text: b.need > 0 ? `Need ${b.need}` : "Full",
      title: b.need > 0 ? `Your roster needs ${b.need} at his position this class` : "Your roster is covered at his position this class" }));
    if (b.offered && !b.signed && b.committed !== me) out.append(el("span", { class: "go-tag good", text: b.nil ? `Offered · ${b.nil} NIL` : "Offered" }));
    if (b.cooled) out.append(el("span", { class: "go-tag bad", text: "Cooled", title: "He read your offer as a lowball: contacts count half and he will not visit until you raise it to what he wants" }));
    if (b.committed === me && !b.signed) out.append(b.hard ? el("span", { class: "go-tag good", text: "Hard commit", title: "Locked in: he cannot flip and his offer stands until he signs" })
      : el("span", { class: `go-tag ${b.firmness >= 70 ? "good" : b.firmness < 40 ? "warn" : ""}`, text: `Verbal · ${b.firmness}`, title: "A verbal commit (0-100): he warms to you on his own each week, faster with a message, call or visit; rivals offering more playing time cool him. At 90 he is a hard commit and cannot flip." }));
    return out.childElementCount ? out : null;
  }

  // his list as a race: one lane a school, its pill as far along as its pull (the leader at the right),
  // in the school's colours, yours ringed, with this week's move as an arrow
  function race(b, me) {
    const rows = (b.list || []).filter((x) => x.bar != null);
    if (!rows.length) return el("div", { class: "go-race empty" }, [el("span", { class: "muted small", text: b.signed || b.committed ? "His race is over." : "No school is on his list yet." })]);
    return el("div", { class: "go-race", role: "list", "aria-label": "His list: each school's pull, the leader at the right" }, rows.map((x) => {
      const you = x.you || x.school === me;
      const t = window.CFP.teamsBySlug[x.school] || {};
      const col = (t.colors || {}).primary;
      const at = Math.round(Math.max(0, Math.min(1, x.bar)) * 100);
      const arrow = x.new ? " ★" : x.move > 0 ? " ▲" : x.move < 0 ? " ▼" : "";
      const moved = x.new ? "new on his list" : x.move > 0 ? `up ${x.move}` : x.move < 0 ? `down ${-x.move}` : "no change";
      return el("div", { class: "go-race-lane", role: "listitem" }, [el("span", { class: `go-race-pill ${you ? "you" : ""} ${x.move > 0 || x.new ? "up" : x.move < 0 ? "down" : ""}`,
        style: `left: ${at}%; transform: translateX(-${at}%);${col ? ` background:${col}; color:${inkOn(col)};` : ""}`,
        title: `${x.rank != null ? `#${x.rank} ` : ""}${x.name}${you ? " (you)" : ""} · ${moved} since last week${x.why ? ` · ${WHY[x.why] || x.why}` : ""}`,
        text: `${x.rank != null ? `${x.rank}. ` : ""}${t.abbreviation || x.name}${arrow}` })]);
    }));
  }

  // a re-render of the board keeps the columns where they were scrolled (a phone shows one at a time)
  let boardAt = null;
  window.matchMedia("(max-width: 359px)").addEventListener("change", () => { if (boardAt && boardAt.box.isConnected && boardAt.box.offsetParent) renderRecruiting(boardAt.s, boardAt.box); });
  window.matchMedia(PHONE).addEventListener("change", () => { if (boardAt && boardAt.box.isConnected && boardAt.box.offsetParent) renderRecruiting(boardAt.s, boardAt.box); });

  // ----- The footprint map -------------------------------------------------------------------------

  function mapOpen() { try { return localStorage.getItem("cfp-map-open") !== "0"; } catch (e) { return true; } }
  const TONE_RANK = { good: 0, warn: 1, muted: 2, bad: 3 };
  // The map card: your nine areas (shaded when staffed), every board prospect as a dot by your standing,
  // a tap on a dot or a state, and a table of the states for anyone who cannot use the picture.
  // opts: {small, selectedState, onState(code), onDot(id)}
  function mapCard(v, s, me, opts) {
    opts = opts || {};
    const card = el("div", { class: `go-card go-map ${opts.small ? "small" : ""}` });
    if (!window.USMap || !window.US_STATES) return card;
    const team = (window.CFP.teamsBySlug[s.team] || {}).colors;
    const color = (team && team.primary) || "#888";
    const staffed = {};
    for (const m of v.staff || []) if (m.area) staffed[m.area] = staffed[m.area] ? `${staffed[m.area]}, ${m.name}` : m.name;
    const rows = v.board || [];
    const dots = [];
    const byState = {};
    for (const b of rows) {
      const sd = standing(b, me);
      const code = b.hometown && b.hometown.state;
      let xy = window.USMap.project(b.home);
      if (!xy && code) xy = window.USMap.centroid(code);
      if (code) {
        const e = byState[code] || (byState[code] = { n: 0, best: null });
        e.n++;
        if (!e.best || (TONE_RANK[sd.tone] ?? 9) < (TONE_RANK[e.best.tone] ?? 9) || ((TONE_RANK[sd.tone] ?? 9) === (TONE_RANK[e.best.tone] ?? 9) && (sd.fill || 0) > (e.best.fill || 0))) e.best = sd;
      }
      if (!xy) continue;
      dots.push({ id: b.id, xy, tone: sd.tone, ring: b.committed === me || b.signed === me, big: !!b.generational, label: `${b.name} · ${b.position} · ${sd.text}` });
    }
    const open = mapOpen();
    const body = el("div", { class: "go-map-body" });
    body.hidden = !open;
    const toggle = el("button", { type: "button", class: "go-btn go-map-toggle", "aria-expanded": String(open), "aria-label": "Show or hide the map", text: open ? "Hide" : "Show" });
    toggle.addEventListener("click", () => {
      const now = body.hidden;
      body.hidden = !now;
      toggle.setAttribute("aria-expanded", String(now));
      toggle.textContent = now ? "Hide" : "Show";
      try { localStorage.setItem("cfp-map-open", now ? "1" : "0"); } catch (e) { /* no storage */ }
    });
    const svg = window.USMap.render({ areas: v.areas || {}, staffed, dots, selectedState: opts.selectedState || null, teamColor: color,
      onDot: (id) => { if (opts.onDot) opts.onDot(id); else { view.selected = id; if (phone()) view.sheet = true; if (boardAt) renderRecruiting(boardAt.s, boardAt.box); } },
      onState: opts.onState });
    if (view.selected) { const d = svg.querySelector(`circle.us-dot[data-id="${view.selected}"]`); if (d) d.classList.add("sel"); }
    svg.style.setProperty("--us-team", color);
    const legend = el("ul", { class: "go-map-legend" }, Object.keys(v.areas || {}).map((a) => el("li", { class: staffed[a] ? "staffed" : "" }, [
      el("span", { class: "go-map-swatch" }), el("b", { text: a }), el("span", { class: "muted small", text: staffed[a] ? ` ${staffed[a]}` : " no one yet" })])));
    const key = el("p", { class: "muted small go-map-key" }, [
      el("span", { class: "go-map-chip good" }), " leading or yours  ", el("span", { class: "go-map-chip warn" }), " in the race  ",
      el("span", { class: "go-map-chip muted" }), " not offered or behind  ", el("span", { class: "go-map-chip bad" }), " signed elsewhere. A ring is committed to you; a big dot is generational."]);
    const table = el("div", { class: "go-map-table-wrap" });
    const tBtn = el("button", { type: "button", class: "go-btn", "aria-expanded": "false", text: "List the states" });
    tBtn.addEventListener("click", () => {
      const showing = table.firstChild;
      table.innerHTML = "";
      tBtn.setAttribute("aria-expanded", String(!showing));
      tBtn.textContent = showing ? "List the states" : "Hide the list";
      if (showing) return;
      const codes = Object.keys(byState).sort();
      table.append(el("table", { class: "go-map-table" }, [
        el("thead", {}, [el("tr", {}, ["State", "Prospects on your board", "Your best standing"].map((h) => el("th", { scope: "col", text: h })))]),
        el("tbody", {}, codes.length ? codes.map((c) => el("tr", {}, [el("th", { scope: "row", text: c }), el("td", { text: String(byState[c].n) }), el("td", { text: byState[c].best.text })]))
          : [el("tr", {}, [el("td", { colspan: "3", text: "Nobody on your board yet." })])])]));
    });
    // under 360px the picture is left out (CSS hides it too; the table below says the same in words)
    body.append(window.matchMedia("(max-width: 359px)").matches ? "" : el("div", { class: "go-map-svg" }, [svg]), legend, key, el("div", { class: "go-row" }, [tBtn]), table);
    card.append(el("div", { class: "go-map-head" }, [el("div", { class: "go-display l", text: "YOUR FOOTPRINT" }),
      el("span", { class: "muted small", text: opts.selectedState ? `Showing ${opts.selectedState} · tap it again to clear` : "Tap a state to filter, a dot to pick him" }), toggle]), body);
    return card;
  }

  async function renderRecruiting(s, box) {
    if (!box.firstChild) box.append(loading("Loading your board…"));
    let v;
    try { v = await H.api(`/api/season/${s.id}/recruiting`); }
    catch (err) { box.innerHTML = ""; box.append(loading(`Could not load recruiting: ${H.errText(err)}`)); return; }
    const me = s.team;
    const old = box.querySelector(".go-pipeline");
    const keepScroll = old ? old.scrollLeft : 0;
    boardAt = { s, box };
    box.innerHTML = "";
    // Auto-recruit: off, for the coming week only, or all season
    const AUTO = [["off", "Off"], ["week", "This week"], ["season", "All season"]];
    const AUTO_SAID = { off: "Auto-recruit off: you recruit.", week: "Auto-recruit for this week: your staff spend your hours, then it turns off.", season: "Auto-recruit all season: your staff spend your hours every week." };
    const auto = el("div", { class: "go-seg", role: "group", "aria-label": "Auto-recruit" }, AUTO.map(([k, label]) => {
      const b = el("button", { type: "button", class: `go-seg-btn ${v.auto_recruit === k ? "on" : ""}`, "aria-pressed": String(v.auto_recruit === k), text: label, title: AUTO_SAID[k] });
      b.addEventListener("click", async () => {
        try { await H.api(`/api/season/${s.id}/settings`, H.postJSON({ auto_recruit: k })); H.toast(AUTO_SAID[k], 3500); renderRecruiting(s, box); }
        catch (err) { H.toast(`Could not change Auto-recruit: ${H.errText(err)}`, 4000); }
      });
      return b;
    }));
    box.append(el("div", { class: "go-board-head rc-head" }, [
      el("div", { class: "go-display l", text: v.portal ? `TRANSFER PORTAL · WEEK ${v.portal.week} OF ${v.portal.weeks}` : "RECRUITING BOARD" }),
      el("div", { class: "go-meters" }, [meter("Hours", v.hours_left, v.hours), meter("NIL points", v.nil.left, v.nil.budget),
        meter("Offers", v.offers, v.offers + v.offers_left, true), meter("Commits", v.committed, v.open_spots, true)]),
      el("div", { class: "go-auto" }, [el("span", { class: "small muted", text: "Auto-recruit" }), auto]),
    ]));
    // what the roster needs this class, by position; a position picked here filters the board to it
    box.append(needsStrip(v.needs_detail, view.group, (g) => { view.group = g; renderRecruiting(s, box); }, () => renderRecruiting(s, box)));
    if (v.recap.length) box.append(el("ul", { class: "go-ticker rc-recap" }, [el("li", {}, [el("b", { text: "NEWS" })]), ...v.recap.slice(-4).reverse().map((e) => newsItem(s, e))]));
    if (!["chance", "rank"].includes(view.sort)) view.sort = "chance";
    const sort = el("select", { "aria-label": "Sort each column" }, [["chance", "Sort: your chance"], ["rank", "Sort: national rank"]].map(([k, t]) => el("option", { value: k, text: t })));
    sort.value = view.sort;
    sort.addEventListener("change", () => { view.sort = sort.value; renderRecruiting(s, box); });
    box.append(el("div", { class: "go-filterbar" }, [el("span", { class: "muted small", text: `${v.board.length} on your board` }), el("div", { class: "go-row" }, [sort,
      el("button", { type: "button", class: "go-btn primary", text: "+ Find prospects", onclick: () => H.onChange("prospects") })])]));

    if (!v.board.length) {
      box.append(el("div", { class: "go-card go-empty" }, [el("div", { class: "go-display l", text: "YOUR BOARD IS EMPTY" }),
        el("p", { class: "muted", text: "Add prospects from the class, then recruit them here. Every action costs hours; only an offer lets him commit to you." }),
        el("button", { type: "button", class: "go-btn primary", text: "Find prospects", onclick: () => H.onChange("prospects") })]));
      return;
    }
    const key = { chance: (b) => (b.committed === me || b.signed === me ? -2 : 0) - ((b.standing && b.standing.pct) || 0), rank: (b) => b.national_rank ?? Infinity };
    const rows = v.board.filter((b) => (!view.group || b.group === view.group) && (!view.state || (b.hometown && b.hometown.state) === view.state))
      .sort((a, b) => key[view.sort](a) - key[view.sort](b));
    if (!rows.length && (view.group || view.state)) { view.group = null; view.state = null; renderRecruiting(s, box); return; }
    const byCol = Object.fromEntries(COLUMNS.map(([k]) => [k, rows.filter((b) => columnOf(b) === k)]));
    if (!view.selected || !rows.some((b) => b.id === view.selected)) {
      view.selected = (COLUMNS.slice(0, 4).map(([k]) => byCol[k][0]).find(Boolean) || rows[0]).id;
      view.sheet = false;
    }
    const label = (k, name) => (k === "visited" && v.portal ? "Campus visit" : name);

    const pipeline = el("div", { class: "go-pipeline" }, COLUMNS.map(([k, name]) => el("section", { class: `go-col ${k}`, "data-col": k, "aria-label": `${label(k, name)}: ${byCol[k].length}` }, [
      el("div", { class: "go-col-head", title: COLUMN_TIPS[k] }, [el("b", { text: label(k, name) }), el("span", { class: "muted", text: ` · ${byCol[k].length}` })]),
      el("div", { class: "go-col-body" }, [...byCol[k].map((b) => card(b)),
        byCol[k].length ? null : el("p", { class: "muted small go-col-empty", text: k === "cold" ? "Nobody cold: every prospect here has heard from you." : "Nobody here yet." }),
        k === "cold" ? el("button", { type: "button", class: "go-card go-add", onclick: () => H.onChange("prospects") }, [el("b", { text: "+ Add a prospect" }), el("span", { class: "muted small", text: "From the class, or one your staff scouted" })]) : null]),
    ])));
    // on a phone the columns sit side by side, one a screen: a strip above them jumps to each
    const segBtns = COLUMNS.map(([k, name], i) => el("button", { type: "button", class: `go-seg-btn ${i === 0 ? "on" : ""}`, "aria-pressed": String(i === 0), "aria-label": `Show ${label(k, name)}`,
      onclick: () => { const c = pipeline.children[i]; pipeline.scrollTo({ left: c.offsetLeft, behavior: "smooth" }); } },
      [el("span", { text: label(k, name) }), el("b", { text: String(byCol[k].length) })]));
    const seg = el("div", { class: "go-seg go-col-seg", role: "group", "aria-label": "Columns" }, segBtns);
    pipeline.addEventListener("scroll", () => {
      const i = Math.round(pipeline.scrollLeft / Math.max(1, pipeline.clientWidth));
      segBtns.forEach((btn, j) => { btn.classList.toggle("on", i === j); btn.setAttribute("aria-pressed", String(i === j)); });
    }, { passive: true });
    const sel = v.board.find((b) => b.id === view.selected);
    let side = phone() ? null : pane(sel);
    box.append(mapCard(v, s, me, { selectedState: view.state, onState: (c) => { view.state = view.state === c ? null : c; renderRecruiting(s, box); } }));
    const boardEl = el("div", { class: "go-board" }, [el("div", { class: "go-pipe" }, [seg, pipeline]), side]);
    box.append(boardEl);
    if (keepScroll) pipeline.scrollLeft = keepScroll;
    if (phone() && view.sheet) openSheet(sel);

    // picking a card: the pane changes in place (desktop) or the sheet opens (phone); nothing reloads
    function choose(b) {
      view.selected = b.id;
      for (const c of pipeline.querySelectorAll(".go-pcard")) {
        const on = c.dataset.pid === b.id;
        c.classList.toggle("selected", on);
        c.querySelector(".go-pcard-top").setAttribute("aria-pressed", String(on));
      }
      if (phone()) { view.sheet = true; openSheet(b); }
      else {
        const next = pane(b);
        side.replaceWith(next);
        side = next;
        // the first pick brings the columns and the pane up together: the board's top meets the pane's sticky line
        const gap = boardEl.getBoundingClientRect().top - (parseFloat(getComputedStyle(side).top) || 0);
        if (gap > 1) window.scrollBy({ top: gap, behavior: "smooth" });
      }
    }
    function openSheet(b) {
      for (const old of box.querySelectorAll(".go-pane.sheet")) old.remove();
      const p = pane(b);
      box.append(p);
      p.querySelector(".go-pane-close").focus();
    }
    function closeSheet() {
      view.sheet = false;
      for (const old of box.querySelectorAll(".go-pane.sheet")) old.remove();
      const c = pipeline.querySelector(".go-pcard.selected .go-pcard-top");
      if (c) c.focus({ preventScroll: true });
    }

    function pitchFor(b) { return view.pitch[b.id] !== undefined ? view.pitch[b.id] : (b.priorities_known[0] || ""); }
    async function run(b, action, nil) {
      const pitch = ["message", "call", "hc_visit", "offer"].includes(action) ? pitchFor(b) || null : null;
      if (action === "offer" && !pitch) { H.toast("Pick a pitch first: an offer tells him what you are selling.", 3500); return; }
      const r = await act(s, b.id, action, pitch, nil);
      if (r) renderRecruiting(s, box);
    }
    // a compact card: who he is, what your staff read, what stands out, where you stand
    function card(b) {
      const sd = standing(b, me);
      const holder = b.signed || b.committed;
      const mine = holder === me, lost = !!holder && !mine;
      const moved = b.stage_move === "up" ? "moved-up" : b.stage_move === "down" ? "moved-down" : "";
      const c = el("article", { class: `go-card go-pcard ${b.id === view.selected ? "selected" : ""} ${moved} ${mine ? "mine" : ""} ${lost ? "lost" : ""}`, "data-pid": b.id });
      // the whole top of the card is one tap target that picks him; his profile opens from the pane
      const nameBtn = el("b", { class: "go-pcard-name", text: b.name });
      c.append(el("div", { class: "go-pcard-top", role: "button", tabindex: "0", "aria-label": `Select ${b.name}`, "aria-pressed": String(b.id === view.selected),
        onclick: () => choose(b), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(b); } } }, [avatar(b.id, "sm"),
        el("span", { class: "go-pcard-id" }, [nameBtn,
          el("span", { class: "muted small" }, [b.portal ? `${b.position} · from ${b.from_name}` : `${b.position} `, b.portal ? null : el("span", { class: "go-stars", text: stars(b.stars) })])])]));
      c.append(el("div", { class: "go-pcard-read small" }, b.our_grades && b.our_grades.potential
        ? [el("span", { class: "muted", text: "Potential " }), ...wordRange(b.our_grades.potential)] : [el("span", { class: "muted", text: "Not scouted" })]));
      c.append(badges(b, me) || "");
      if (moved) c.append(el("div", { class: `go-pcard-move ${b.stage_move}`, text: b.stage_move === "up" ? "▲ Moved up this week" : "▼ Slipped back this week" }));
      // one line of standing; a prospect lost to another school says whether he could still flip
      c.append(bar(sd), el("div", { class: `go-standing-text small ${sd.tone}`, text: lost && !b.signed ? `${sd.text} · ${sd.odds || "Offer him to try for a flip"}` : sd.text }));
      return c;
    }
    // the pane: everything for the one you picked; sticky beside the columns, or a bottom sheet on a phone
    function pane(b) {
      const sheet = phone();
      const p = el("aside", { class: `go-card go-pane ${sheet ? "sheet" : ""}`, "aria-label": `${b.name}: recruit him`, ...(sheet ? { role: "dialog", "aria-modal": "true" } : {}) });
      const sd = standing(b, me);
      const open = !b.signed && b.committed !== me;
      if (sheet) p.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
      p.append(el("div", { class: "go-pane-head" }, [avatar(b.id), el("div", { class: "go-pcard-id" }, [
        el("button", { type: "button", class: "go-link go-pcard-name", text: b.name, title: "Open his profile", onclick: () => openProfile(s, b.id) }),
        el("span", { class: "muted small", text: b.portal ? `${b.position} · ${clsWord(b.cls)} · from ${b.from_name} · #${b.portal_rank} in the portal` : `${stars(b.stars)} ${b.position} · ${place(b.hometown)} · #${b.national_rank}` })]),
        sheet ? el("button", { type: "button", class: "go-btn go-pane-close", "aria-label": "Close", text: "✕", onclick: closeSheet }) : null]));
      p.append(el("div", { class: `go-standing-text ${sd.tone}`, text: sd.text }));
      if (sd.odds) p.append(el("div", { class: "muted small", text: `${sd.odds}${sd.certainty ? ` · ${sd.certainty}${sd.certainty !== "Solid read" ? ": the range narrows as signing day nears" : ""}` : ""}` }));
      p.append(bar(sd));
      const tags = badges(b, me) || el("div", { class: "go-tags go-badges" });
      for (const t of b.priorities_known) tags.append(el("span", { class: "go-tag", text: `★ ${PITCH_NAMES[t]}` }));
      if (open && b.priorities_known.length < 3) tags.append(el("span", { class: "go-tag muted", text: b.priorities_known.length ? `${3 - b.priorities_known.length} more to learn` : "Priorities: call or visit to learn" }));
      if (b.portal && b.role) tags.append(el("span", { class: `go-tag ${b.role === "Would start" ? "good" : b.role === "Next in line" ? "warn" : "muted"}`, text: b.role, title: "Where he would sit on your depth chart next season" }));
      if (b.visit) tags.append(el("span", { class: "go-tag", text: b.visit.done ? "Visited" : `Visit wk ${b.visit.week}` }));
      p.append(tags);
      if (b.portal && b.line) p.append(el("div", { class: "muted small", text: lineText(b.line) }));
      if (b.our_grades) p.append(scoutLine(b.our_grades, b.looks));
      p.append(el("div", { class: "go-kicker muted", text: "HIS LIST" }), race(b, me));
      if (open) {
        const hcWait = b.hc_week != null && s.current_week - b.hc_week < 4;
        const done = b.done_this_week || [];
        const trips = b.trips || 0;
        const acts = [["message", "Message", 5, done.includes("message") && "week"], ["call", "Call", 15, done.includes("call") && "week"],
          ["hc_visit", "HC visit", 30, hcWait && "month"], ["scout", trips ? `Scout ${trips}/3` : "Scout", 5, trips >= 3 && "scouted"]];
        if (b.offered && !b.visit) acts.push(["official_visit", v.portal ? "Campus visit" : "Visit", 10, !["top", "visited"].includes(b.stage) && "group", "alt"]);
        p.append(el("div", { class: "go-actions" }, acts.map(([a, name, cost, off, tone]) => {
          const short = cost > v.hours_left;
          const btn = el("button", { type: "button", class: `go-act ${tone || ""}`, "aria-label": `${name} ${b.name}`,
            title: off === "month" ? "The head coach visits once every 4 weeks" : off === "week" ? "Once a week: more contact is not more interest"
              : off === "scouted" ? "Your staff have scouted him three times; his area scout keeps looking"
              : off === "group" ? "He is not considering you yet: get into his top group first" : short ? `Needs ${cost} hours; ${v.hours_left} left this week` : ACT_TIPS[a] },
            [el("b", { text: name }), el("span", { text: off === "month" ? "monthly" : off === "week" ? "done" : off === "scouted" ? "done" : off === "group" ? "not yet" : `${cost}h` })]);
          if (off || short) btn.disabled = true;
          btn.addEventListener("click", () => run(b, a));
          return btn;
        })));
        // the pitch goes with Message, Call, HC visit and the offer
        p.append(el("div", { class: "go-display m", text: "PITCH" }));
        const current = pitchFor(b);
        const pitches = el("div", { class: "go-pitches", role: "radiogroup", "aria-label": `Pitch to ${b.name}` });
        for (const t of Object.keys(PITCH_NAMES)) {
          const known = b.priorities_known.includes(t);
          const id = `pitch-${b.id}-${t}`;
          const r = el("input", { type: "radio", name: `pitch-${b.id}`, id, value: t });
          r.checked = current === t;
          r.addEventListener("change", () => { view.pitch[b.id] = t; });
          const sv = b.strength ? b.strength[t] : null, word = sv == null ? "" : sv >= 0.6 ? "Strong" : sv < 0.25 ? "Weak" : "Fair";
          const tone = sv == null ? "" : sv >= 0.6 ? "good" : sv < 0.25 ? "bad" : "";
          pitches.append(el("label", { class: `go-pitch ${known ? "known" : ""}`, for: id, title: sv == null ? "" : known && sv < 0.25 ? "He cares about this and you are weak here: pitching it backfires" : `Your program's case on ${PITCH_NAMES[t].toLowerCase()}: ${word.toLowerCase()}` }, [r,
            el("span", {}, [el("b", { text: PITCH_NAMES[t] }), el("span", { class: `go-tag ${tone}`, text: known ? `Priority · ${word}` : word })])]));
        }
        p.append(pitches, el("p", { class: "muted small", text: "Message, Call, HC visit and the offer use this pitch. Sell what he cares about where your program is strong; a weak case on one of his priorities backfires. A call sometimes tells you a priority; the in-home visit tells you one and his number; an official visit tells you everything." }));
      }
      const askText = b.ask ? (b.ask.exact != null ? `wants ${b.ask.exact}` : `wants about ${b.ask.lo}–${b.ask.hi} (a visit gets his number)`) : "";
      if (!b.offered && !b.committed && !b.signed) {
        const start = b.ask ? (b.ask.exact != null ? b.ask.exact : b.ask.lo) : 0;
        const nil = el("input", { type: "number", min: "0", step: "5", value: String(start), class: "go-nil", id: `nil-${b.id}` });
        const offer = el("button", { type: "button", class: "go-btn primary", text: "Offer", title: ACT_TIPS.offer });
        offer.addEventListener("click", () => run(b, "offer", Number(nil.value) || 0));
        p.append(el("div", { class: "go-row wrap" }, [el("label", { for: `nil-${b.id}`, class: "small", text: `NIL points · ${askText || "no ask known"}` }), nil, offer]),
          el("p", { class: "muted small", text: "An offer costs no hours. Under half of what he wants reads as a lowball: he cools on you for three weeks. The offer goes out with the pitch above." }));
      } else if (b.offered && open) {
        const nil = el("input", { type: "number", min: String((b.nil || 0) + 5), step: "5", value: String(Math.max((b.nil || 0) + 5, b.ask && b.ask.exact != null ? b.ask.exact : 0)), class: "go-nil", id: `raise-${b.id}` });
        const raise = el("button", { type: "button", class: "go-btn", text: "Raise NIL", title: "Raising costs no hours, only NIL points" });
        raise.addEventListener("click", () => run(b, "raise_nil", Number(nil.value) || 0));
        p.append(el("div", { class: "go-row wrap" }, [el("label", { for: `raise-${b.id}`, class: "small", text: `Your offer: ${b.nil || 0} NIL · ${askText}` }), nil, raise]));
      }
      const tools = el("div", { class: "go-row wrap" }, [el("button", { type: "button", class: "go-btn", text: "Full profile", onclick: () => openProfile(s, b.id) })]);
      if (b.offered && !b.signed) tools.append(el("button", { type: "button", class: "go-btn", text: "Pull offer", onclick: () => run(b, "pull_offer") }));
      tools.append(el("button", { type: "button", class: "go-btn", text: "Off the board", onclick: async () => { if (await setBoard(s, b.id, false)) { view.selected = null; view.sheet = false; renderRecruiting(s, box); } } }));
      p.append(tools);
      return p;
    }
  }

  // ----- Prospects ---------------------------------------------------------------------------------

  async function renderProspects(s, box) {
    const f = view.filters;
    box.innerHTML = "";
    const inPortal = !!(s.offseason_stage && /^portal/.test(s.offseason_stage)) || !!view.portal;
    const title = el("div", { class: "go-display l", text: inPortal ? `TRANSFER PORTAL · ${(s.year || 2026) + 1}` : `PROSPECTS · CLASS OF ${(s.year || 2026) + 1}` });
    box.append(title);
    const q = el("input", { type: "search", placeholder: "Search by name", value: f.q, "aria-label": "Search by name" });
    const mk = (key, opts, label) => {
      const sel = el("select", { "aria-label": label }, opts.map(([v, t]) => el("option", { value: v, text: t })));
      sel.value = f[key];
      sel.addEventListener("change", () => { f[key] = sel.value; view.offset = 0; load(); });
      return sel;
    };
    let qTimer = null;
    q.addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(() => { f.q = q.value; view.offset = 0; load(); }, 250); });
    const mapBox = el("div");
    box.append(mapBox);
    const needsBox = el("div");
    box.append(needsBox);
    const recBtn = el("button", { type: "button", class: `go-chip ${f.status === "recommended" ? "on" : ""}`, text: "Recommended for you", "aria-pressed": String(f.status === "recommended"),
      title: "The prospects the Auto-recruit rules would put on your board this week: your states, your star level, the positions you need. A base to build a board from." });
    recBtn.addEventListener("click", () => { f.status = f.status === "recommended" ? "" : "recommended"; view.offset = 0; render(); });
    const render = () => renderProspects(s, box);
    H.api(`/api/season/${s.id}/recruiting`).then((v) => {
      if (!mapBox.isConnected) return;
      mapBox.replaceChildren(mapCard(v, s, s.team, { small: true, selectedState: f.state || null,
        onState: (c) => { f.state = f.state === c ? "" : c; view.offset = 0; renderProspects(s, box); },
        onDot: (id) => openProfile(s, id) }));
    }).catch(() => { /* the list works without the map */ });
    box.append(el("div", { class: "go-filters rc-filters" }, [q, recBtn,
      mk("position", [["", "Any position"], ...POSITIONS.map((p) => [p, p])], "Position"),
      mk("stars", [["", "Any stars"], ["5", "5 stars"], ["4", "4 stars"], ["3", "3 stars"], ["2", "2 stars"]], "Stars"),
      mk("state", [["", "Any state"], ...STATES.map((c) => [c, c])], "Home state"),
      mk("status", STATUS, "Status"),
      mk("sort", [["rank", "Sort: national rank"], ["interest", "Sort: interest in you"]], "Sort"),
    ]));
    const body = el("div");
    box.append(body);
    async function load() {
      const params = new URLSearchParams({ offset: view.offset, limit: 50 });
      for (const [k, v] of Object.entries(f)) if (v) params.set(k, v);
      body.innerHTML = "";
      body.append(loading("Loading prospects…"));
      let d;
      try { d = await H.api(`/api/season/${s.id}/prospects?${params}`); }
      catch (err) { body.innerHTML = ""; body.append(loading(`Could not load the class: ${H.errText(err)}`)); return; }
      body.innerHTML = "";
      const portalRows = d.rows.some((r) => r.portal);
      view.portal = portalRows;
      if (portalRows) title.textContent = `TRANSFER PORTAL · ${(s.year || 2026) + 1}`;      // the summary may predate the portal
      needsBox.replaceChildren(needsStrip(d.needs, f.group || null, (g) => { f.group = g || ""; view.offset = 0; load(); }, load));
      const rec = f.status === "recommended";
      const head = el("div", { class: "go-row wrap go-list-head" }, [el("p", { class: "muted small", text: rec ? `${d.total} recommended · the prospects the Auto-recruit rules would chase for a program like yours, best fit first`
        : portalRows ? `${d.total} entrants · portal rankings · no stars on a transfer: his film is his rating`
        : `${d.total} prospects · national rankings · hidden prospects appear once your staff scout their area` })]);
      if (rec && d.rows.some((r) => !r.on_board)) {
        const all = el("button", { type: "button", class: "go-btn", text: `Add these ${d.rows.filter((r) => !r.on_board).length} to your board` });
        all.addEventListener("click", async () => {
          all.disabled = true; all.textContent = "Adding…";
          for (const r of d.rows.filter((r) => !r.on_board)) { if (await setBoard(s, r.id, true)) r.on_board = true; }
          H.toast("They are on your board.", 2500); load();
        });
        head.append(all);
      }
      body.append(head);
      body.append(el("ul", { class: "go-list rc-list" }, d.rows.map((r) => {
        const add = el("button", { type: "button", class: `go-btn ${r.on_board ? "" : "primary"}`, text: r.on_board ? "✓ On board" : "+ Board", "aria-label": `${r.on_board ? "Remove" : "Add"} ${r.name} ${r.on_board ? "from" : "to"} your board` });
        add.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (await setBoard(s, r.id, !r.on_board)) { r.on_board = !r.on_board; add.textContent = r.on_board ? "✓ On board" : "+ Board"; add.classList.toggle("primary", !r.on_board); }
        });
        const open = el("button", { type: "button", class: "go-list-main", onclick: () => openProfile(s, r.id) }, [
          el("span", { class: "go-rank", text: `#${r.national_rank}` }), avatar(r.id, "sm"),
          el("span", { class: "go-list-id" }, [el("b", { text: r.name }), el("span", { class: "muted small", text: r.portal
            ? `${r.position} · ${clsWord(r.cls)} · from ${r.from_name}${r.usage ? ` · ${r.usage}` : ""}`
            : `${r.position} · ${typeof r.height === "number" ? height(r.height) : (r.height || "")} ${r.weight} · ${place(r.hometown)}` })]),
          r.portal ? null : el("span", { class: "go-stars", text: stars(r.stars) }),
          el("span", { class: "go-list-tags" }, [
            el("span", { class: `go-tag ${r.signed || r.committed ? "" : r.leaning_fcs ? "muted" : "good"}`, text: status(r) }),
            el("span", { class: "go-list-read" }, [
              el("span", { class: `go-tag ${r.interest_level === "High" ? "good" : r.interest_level === "Medium" ? "warn" : "muted"}`, title: "How much your school appeals to him now", text: `${r.interest_level} interest` }),
              el("span", { class: "muted small", title: "Your staff's read of his potential", ...(r.our_potential ? { text: " Potential " } : { text: " Not scouted" }) }, r.our_potential ? wordRange(r.our_potential) : [])])]),
        ]);
        const li = el("li", { class: "go-list-row rc-row" }, [open, add]);
        return li;
      })));
      const prev = el("button", { type: "button", class: "go-btn", text: "← Previous" });
      const next = el("button", { type: "button", class: "go-btn", text: "Next →" });
      if (view.offset <= 0) prev.disabled = true;
      if (view.offset + 50 >= d.total) next.disabled = true;
      prev.addEventListener("click", () => { view.offset = Math.max(0, view.offset - 50); load(); });
      next.addEventListener("click", () => { view.offset += 50; load(); });
      body.append(el("div", { class: "go-pager" }, [prev, el("span", { class: "muted", text: `${d.total ? view.offset + 1 : 0}–${Math.min(d.total, view.offset + 50)} of ${d.total}` }), next]));
    }
    load();
  }

  // A grade's tooltip floats over the page (fixed to the screen), below the grade when there is
  // room and above it when not, kept inside the screen, so the profile window never clips or scrolls it.
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".go-tip")) document.querySelectorAll(".go-tip-box.show").forEach((t) => t.classList.remove("show")); });
  function placeTip(cell, tip) {
    tip.classList.add("show");
    const r = cell.getBoundingClientRect(), t = tip.getBoundingClientRect(), gap = 6, pad = 8;
    const below = r.bottom + gap + t.height <= window.innerHeight - pad;
    const top = below ? r.bottom + gap : Math.max(pad, r.top - gap - t.height);
    const left = Math.min(Math.max(pad, r.left), window.innerWidth - t.width - pad);
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
  }

  // a floating tooltip follows its grade while the page or the profile scrolls, and closes once
  // the grade has scrolled out of sight
  window.addEventListener("scroll", () => {
    for (const t of document.querySelectorAll(".go-tip-box.show")) {
      const cell = t.closest(".go-tip");
      const r = cell && cell.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) t.classList.remove("show");
      else placeTip(cell, t);
    }
  }, true);

  // ----- the Prospect Profile ----------------------------------------------------------------------

  async function openProfile(s, pid, into) {
    // the window opens at once, saying it is loading, and fills in when his profile arrives; with
    // `into` (a profile already open) it refreshes in place instead of closing and reopening
    const node = into || el("div", { class: "rc-profile go-profile" }, [el("p", { class: "muted rc-loading go-loading", text: "Loading his profile…" })]);
    if (into) { node.innerHTML = ""; node.append(el("p", { class: "muted rc-loading go-loading", text: "Updating his profile…" })); }
    else H.openModal("Prospect Profile", node);
    let p;
    try { p = await H.api(`/api/season/${s.id}/prospect/${encodeURIComponent(pid)}`); }
    catch (err) { node.innerHTML = ""; node.append(el("p", { class: "muted", text: `Could not open his profile: ${H.errText(err)}` })); return; }
    const pub = p.public;
    const me = s.team;
    node.innerHTML = "";
    node.append(el("div", { class: "rc-profile-head go-profile-head" }, [avatar(pub.avatar_seed, "lg"), el("div", {}, [
      el("h2", { class: "rc-profile-name go-display l", text: pub.name.toUpperCase() }),
      el("div", { class: "go-stars big", text: stars(pub.stars) }),
      el("div", { text: `${pub.position}${pub.ea_position && pub.ea_position !== pub.position ? ` · projects at ${pub.ea_position} in the game` : ""} · ${pub.archetype} · ${height(pub.height)}, ${pub.weight} lb` }),
      el("div", { class: "muted", text: `${pub.high_school} · ${place(pub.hometown)}` }),
      el("div", { class: "muted small", text: `National rankings: #${pub.national_rank} overall · #${pub.position_rank} ${pub.position} · #${pub.state_rank} in ${pub.hometown.state === "DC" ? "D.C." : pub.hometown.state} · composite ${pub.composite.toFixed(4)}` }),
      pub.signed || pub.committed ? null : el("div", { class: "rc-status go-standing-text", text: status(pub) }),
    ])]));
    const holder = pub.signed || pub.committed;
    if (holder) {
      const t = window.CFP.teamsBySlug[holder] || {};
      const col = t.colors || {};
      const bg = holder === "FCS" ? "var(--panel-2)" : col.primary || "var(--panel-2)";
      const odds = pub.schools.find((x) => x.school === holder);
      const others = pub.schools.filter((x) => x.school !== holder && x.pct != null);
      const sub = pub.signed ? "Signed: his recruitment is over."
        : pub.hard ? "Hard commit: he cannot flip and signs on signing day."
        : others.length ? `Still considering offers · ${odds && odds.pct != null ? pct(1 - odds.pct) : "some"} chance he flips before signing day`
        : "No other school is in it.";
      const banner = el("div", { class: "go-commit rc-status", style: holder === "FCS" ? "" : `background:${bg};color:${inkOn(col.primary)};border-color:${col.secondary || bg}` }, [
        el("div", { class: "go-display m", text: `${pub.signed ? "SIGNED WITH" : pub.hard ? "HARD COMMIT TO" : "VERBAL COMMIT TO"} ${teamName(holder).toUpperCase()}` }),
        el("div", { class: "small", text: sub }),
      ]);
      node.append(banner);
    }
    let on = !!pub.on_board;
    const onBoard = el("button", { type: "button", class: "go-btn" });
    // recruiting him happens on the board: once he is on it, a button goes straight there
    const toBoard = el("button", { type: "button", class: "go-btn primary", text: "Recruit him on your board →",
      onclick: () => { view.selected = pid; view.sheet = true; view.group = null; view.state = null; H.closeModal(); H.onChange("recruiting"); } });
    const label = () => { onBoard.textContent = on ? "✓ On your board · remove" : "+ Add to your board"; onBoard.classList.toggle("primary", !on); toBoard.hidden = !on || !!pub.signed; };
    label();
    onBoard.addEventListener("click", async () => {
      onBoard.disabled = true;
      if (await setBoard(s, pid, !on)) { on = !on; label(); H.toast(on ? `${pub.name} is on your board.` : `${pub.name} is off your board.`, 2500); }
      onBoard.disabled = false;
    });
    node.append(el("div", { class: "rc-profile-actions go-row wrap" }, [onBoard, toBoard]));
    if (p.looks >= 3 && p.our_grades) {
      node.append(scoutLine(p.our_grades, p.looks));
      if (p.our_comp && !(p.public_comp && p.public_comp.name === p.our_comp.name)) node.append(el("p", { class: "small" }, [el("b", { text: "Our comp: " }), `${p.our_comp.name}, ${p.our_comp.school} (${p.our_comp.position}${p.our_comp.overall ? `, ${p.our_comp.overall} OVR` : ""})`]));
    }
    if (pub.schools.length) {
      const listed = holder ? pub.schools.filter((x) => x.school !== holder) : pub.schools;
      const sorted = listed.slice().sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
      if (sorted.length) node.append(el("h3", { text: holder ? (pub.signed ? "Who else offered" : "Still in it: his chance to flip to each") : "His list" }), el("div", { class: "go-schools" }, sorted.map((x, i) => el("div", { class: "go-school" }, [
        el("span", { class: "go-school-name" }, [el("b", { text: x.name }), x.school === s.team ? el("span", { class: "muted small", text: " (you)" }) : null, i === 0 && !holder && x.pct != null ? el("span", { class: "go-tag good", text: "Leader" }) : null]),
        el("span", { class: "go-school-odds", text: pub.signed ? "" : x.pct == null ? "no offer" : i === 0 ? "leads" : x.pct >= (sorted[0].pct || 0) - 0.1 ? "close" : x.pct >= 0.15 ? "in it" : "long shot" }),
        el("span", { class: "muted small", text: [x.offered ? "Offer" : "", x.visit ? (x.visit.done ? "Visited" : `Visit wk ${x.visit.week}`) : ""].filter(Boolean).join(" · ") }),
      ]))));
    } else node.append(el("p", { class: "muted", text: "No school is recruiting him yet." }));
    if (pub.priorities_known.length) node.append(el("p", {}, [el("b", { text: "What he cares about: " }), pub.priorities_known.map((t) => PITCH_NAMES[t]).join(", ")]));
    if (p.evaluation) {
      node.append(el("h3", { text: "Evaluation" }),
        el("ul", { class: "rc-eval" }, [...p.evaluation.strengths.map((t) => el("li", { class: "rc-good", text: t })), ...(p.evaluation.solid || []).map((t) => el("li", { class: "go-solid", text: t })), ...p.evaluation.weaknesses.map((t) => el("li", { class: "rc-bad", text: t }))]),
        el("p", { text: p.evaluation.outlook }));
    }
    const comp = (c) => `${c.name}, ${c.school} (${c.position}${c.overall ? `, ${c.overall} OVR` : ""})`;
    if (p.public_comp) node.append(el("p", {}, [el("b", { text: "Comp: " }), comp(p.public_comp)]));
    const trips = pub.trips || 0;
    if (p.ratings) {                           // signed with you: what you got, every attribute
      node.append(el("h3", { text: "His ratings" }),
        el("p", { class: "muted small", text: `${p.ratings.overall} overall now, ${p.ratings.potential_overall} at his potential · 50 is an average Power 4 starter.` }),
        el("div", { class: "rc-ratings" }, p.ratings.attributes.map((a) => el("div", { class: "rating-row" }, [
          el("span", { class: "rating-label", text: a.label }),
          el("div", { class: "rating-bar" }, [el("div", { class: `rating-fill ${a.value >= 75 ? "hi" : a.value >= 55 ? "mid" : ""}`, style: `width:${Math.max(2, Math.min(100, a.value))}%` })]),
          el("b", { class: "rating-num", text: String(a.value), title: `${a.potential} at his potential` })]))));
      return;
    }
    const mine = pub.committed === me && !pub.signed;
    const scoutBtn = mine ? el("span", { class: "muted small rc-no-scout", text: "Committed to you: no more looks" })
      : el("button", { type: "button", class: "go-btn", text: trips >= 3 ? "Scouted three times: his area scout keeps looking" : `Send a scout (5 hours, look ${trips + 1} of 3) →`, title: ACT_TIPS.scout });
    if (!mine && trips >= 3) scoutBtn.disabled = true;
    if (!mine) scoutBtn.addEventListener("click", async () => { scoutBtn.disabled = true; if (await act(s, pid, "scout")) openProfile(s, pid, node); else scoutBtn.disabled = false; });
    node.append(el("h3", { text: "Our staff's grades" }));
    if (p.our_grades) {
      // hover (or tab to) a grade: what prospects in this class graded like that look like
      node.append(el("div", { class: "go-grades" }, Object.entries(p.our_grades).map(([g, r]) => {
        const d = (p.grade_details || {})[g] || {};
        const grade = wordText(r);
        const lines = d.labels ? [`Coachability like: ${d.labels.join(", ")}`]
          : Object.entries(d.ratings || {}).map(([k, v]) => {
              const lg = (d.league || {})[k];
              const where = lg ? ` · about #${lg.rank} of ${lg.of} ${plural(lg.group)} today (#${lg.starter_rank} of ${lg.starters} starters)` : "";
              return `${(ATTR_NAMES[k] || k).replace(/^./, (c) => c.toUpperCase())}: ${v[0] === v[1] ? v[0] : `${v[0]}–${v[1]}`}${where}`;
            });
        const tipId = `tip-${pid}-${g}`;
        const tip = el("div", { class: "go-tip-box", role: "tooltip", id: tipId }, [el("b", { text: `${GROUP_NAMES[g] || g} ${grade} looks like` }),
          ...lines.map((t) => el("div", { text: t })),
          d.peers ? el("div", { class: "muted small", text: `Middle half of ${d.peers} prospects at his position graded like this, on the game's scale (50 is the middle Power 4 starter: Solid from 50, Strong from 65, Elite from 80, All-American from 90), ranked against today's players at his position.` }) : null]);
        const cell = el("div", { class: "go-stat go-tip", tabindex: "0", "aria-describedby": tipId }, [el("div", { class: "go-kicker muted", text: (GROUP_NAMES[g] || g).toUpperCase() }),
          el("div", { class: "go-stat-val" }, wordRange(r)), tip]);
        const show = () => placeTip(cell, tip);
        const hide = () => tip.classList.remove("show");
        cell.addEventListener("mouseenter", show); cell.addEventListener("focus", show); cell.addEventListener("click", show);
        cell.addEventListener("mouseleave", hide); cell.addEventListener("blur", hide);
        cell.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
        return cell;
      })),
        el("p", { class: "muted small", text: `${p.looks} look${p.looks === 1 ? "" : "s"}. Tap or hover a grade to see what it looks like in ratings. Ranges narrow with every look, but a read can be wrong; the truth shows once he is on your roster.` }),
        el("div", { class: "go-row wrap rc-profile-actions" }, [scoutBtn]));
      node.append(p.our_comp ? el("p", {}, [el("b", { text: "Our comp: " }), comp(p.our_comp)])
        : el("p", { class: "muted", text: p.looks >= 3 ? "Our comp: nobody close enough among the starters." : `Our comp after 3 looks (${p.looks} so far).` }));
    } else node.append(el("p", { class: "muted", text: "Not scouted yet: send a scout, or put a staff member on his area." }),
      el("div", { class: "go-row wrap rc-profile-actions" }, [scoutBtn, el("button", { type: "button", class: "go-btn", text: "Assign your staff →", onclick: () => { H.closeModal(); H.onChange("staff"); } })]));
  }

  // ----- Staff -------------------------------------------------------------------------------------

  async function renderStaff(s, box) {
    if (!box.firstChild) box.append(loading("Loading your staff…"));
    let v;
    try { v = await H.api(`/api/season/${s.id}/recruiting`); }
    catch (err) { box.innerHTML = ""; box.append(loading(`Could not load your staff: ${H.errText(err)}`)); return; }
    box.innerHTML = "";
    box.append(el("div", { class: "go-display l", text: "STAFF" }),
      el("p", { class: "muted", text: "Every week each prospect in a staff member's area gets a look. Looks add up and never reset; better evaluators read closer to the truth." }));
    const covered = new Set(v.staff.map((m) => m.area));
    const grid = el("div", { class: "go-staff rc-staff" });
    for (const m of v.staff) {
      const sel = el("select", { id: `area-${m.id}`, class: "go-sel" }, Object.keys(v.areas).map((a) => el("option", { value: a, text: `${a} (${v.area_counts[a]})` })));
      sel.value = m.area;
      sel.addEventListener("change", async () => {
        try { await H.api(`/api/season/${s.id}/staff`, H.postJSON({ staff_id: m.id, area: sel.value })); H.toast(`${m.name} now scouts ${sel.value}.`, 2500); renderStaff(s, box); }
        catch (err) { sel.value = m.area; H.toast(`Could not reassign: ${H.errText(err)}`, 4000); }
      });
      const rating = (label, n) => el("div", { class: "go-rating" }, [el("span", { class: "muted small", text: label }),
        el("div", { class: "go-meter-track" }, [el("span", { class: "go-meter-fill", style: `width:${n}%` })]), el("b", { text: String(n) })]);
      grid.append(el("div", { class: "go-card go-coach rc-staff-card" }, [
        el("div", { class: "go-coach-top" }, [avatar(`staff-${m.id}-${m.name}`), el("div", {}, [
          el("div", { class: "go-kicker muted", text: m.role === "Recruiter" ? "RECRUITER" : m.role === "OC" ? "OFFENSIVE COORDINATOR" : "DEFENSIVE COORDINATOR" }),
          el("div", { class: "go-display m", text: m.name.toUpperCase() })])]),
        rating("Evaluation", m.evaluation), rating("Recruiting", m.recruiting),
        el("label", { class: "go-area", for: `area-${m.id}` }, [el("span", { class: "muted small", text: "Scouting area (prospects there)" }), sel]),
      ]));
    }
    box.append(grid);
    const open = Object.keys(v.areas).filter((a) => !covered.has(a));
    if (open.length) box.append(el("p", { class: "muted small", text: `Not covered: ${open.map((a) => `${a} (${v.area_counts[a]})`).join(", ")}. Prospects there show public information only.` }));
  }

  // ----- every school's class ------------------------------------------------------------------------

  async function renderClasses(s, box) {
    if (!box.firstChild) box.append(loading("Loading every class…"));
    let d;
    try { d = await H.api(`/api/season/${s.id}/classes${view.openClass ? `?school=${view.openClass}` : ""}`); }
    catch (err) { box.innerHTML = ""; box.append(loading(`Could not load the classes: ${H.errText(err)}`)); return; }
    box.innerHTML = "";
    const mine = d.schools.find((c) => c.yours);
    box.append(el("div", { class: "go-filterbar" }, [el("div", { class: "go-display l", text: `CLASS RANKINGS · ${(s.year || 2026) + 1}` }),
      el("span", { class: "go-pill", text: d.phase === "Signed" ? `Signed · ${d.fcs} went to FCS programs` : d.phase === "Recruiting" ? "Commitments so far" : "Early signing period done" })]));
    if (mine) box.append(el("div", { class: "go-card go-myclass" }, [el("div", { class: "go-kicker", text: "YOUR CLASS" }),
      el("div", { class: "go-big-line" }, [el("span", { class: "go-display xl", text: mine.count ? `#${mine.rank}` : "—" }),
        el("span", { class: "muted", text: mine.count ? `${mine.count} ${d.phase === "Signed" ? "signed" : "committed"} · ${starLine(mine.stars)}` : "No commitments yet" })])]));
    const list = el("ol", { class: "go-list go-classes" });
    for (const c of d.schools.filter((x) => x.count || x.yours)) {
      const open = view.openClass === c.school;
      const head = el("button", { type: "button", class: "go-list-main go-class-main", "aria-expanded": String(open),
        onclick: () => { view.openClass = open ? null : c.school; renderClasses(s, box); } }, [
        el("span", { class: "go-rank", text: c.count ? `#${c.rank}` : "—" }), window.CFP.teamPill(c.school),
        el("span", { class: "go-list-id" }, [el("b", { text: `${c.name}${c.yours ? " (you)" : ""}` }), el("span", { class: "muted small", text: c.conference })]),
        el("span", { class: "go-class-count", text: `${c.count}` }),
        el("span", { class: "muted small go-class-stars", text: starLine(c.stars) }),
        el("span", { class: "muted small go-class-top", text: c.top.map((t) => `${t.name} ${"★".repeat(t.stars)}`).join(" · ") }),
      ]);
      const li = el("li", { class: `go-list-row go-class ${c.yours ? "yours" : ""}` }, [head]);
      if (open && d.class) li.append(el("ul", { class: "go-class-list" }, d.class.map((r) => el("li", {}, [
        el("button", { type: "button", class: "go-link", text: r.name, onclick: () => openProfile(s, r.id) }),
        el("span", { class: "muted small", text: ` ${"★".repeat(r.stars)} ${r.position} · #${r.national_rank} · ${place(r.hometown)}${r.signed ? " · signed" : ""}` })]))));
      list.append(li);
    }
    box.append(list);
    if (!d.schools.some((x) => x.count)) box.append(el("p", { class: "muted", text: "No school has a commitment yet. They come over the fall; advance a few weeks and check back." }));
    function starLine(st) { return ["5", "4", "3", "2"].filter((k) => st[k]).map((k) => `${st[k]}×${k}★`).join(" · ") || "—"; }
  }

  function render(tab, season, helpers) {
    H = helpers;
    const box = document.getElementById(`tab-${tab}`);
    if (tab === "office") renderOffice(season, box);
    else if (tab === "recruiting") renderRecruiting(season, box);
    else if (tab === "prospects") renderProspects(season, box);
    else if (tab === "staff") renderStaff(season, box);
    else if (tab === "classes") renderClasses(season, box);
  }

  window.Recruiting = { wordTag, render, openProfile: (s, pid) => openProfile(s, pid), board: (s, box, helpers) => { H = helpers; renderRecruiting(s, box); } };
})();
