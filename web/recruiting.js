/* Coach Career on the season page, styled as a game: the Office (your week at a glance), the
   Recruiting board (stage tabs, a list, one pane with the Recruit menu), Prospects (the
   class, filtered) and the Prospect Profile; the Scouting tab is web/scouting.js.
   window.Recruiting.render(tab, season, helpers); helpers from season.js: { api, postJSON, toast,
   openModal, closeModal, errText, onChange(tab), play(what) }. Colors come from the site's theme variables,
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
  const view = { filters: { q: "", position: "", stars: "", state: "", status: "", sort: "rank", group: "" }, offset: 0, openClass: null, sort: "chance", selected: null, sheet: false, pitch: {}, group: null, state: null,
                heard: {}, scene: null, reaction: null, focusScene: false,
                // the board: the stage tab, the search, the position (group) and state filters (all per career: view.stage.sid), the pane's sub-tab, the inline step, the needs disclosure, a Finish awaiting the re-fetch
                stage: null, search: "", sub: "overview", step: null, needsOpen: false, expectScene: null, reveal: null };
  let H = null;

  // window.CFP.ui (web/ui.js, loaded before this file): the toast stack, the pulse, the fades, a keyed reconcile and the busy state
  const ui = () => window.CFP.ui;

  const stars = (n) => "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
  const height = (inches) => `${Math.floor(inches / 12)}'${inches % 12}"`;
  const pct = (x) => `${Math.round(100 * x)}%`;
  const ordinal = (n) => { const t = n % 100, u = n % 10; return `${n}${t > 10 && t < 14 ? "th" : u === 1 ? "st" : u === 2 ? "nd" : u === 3 ? "rd" : "th"}`; };
  // where he is from: "Washington, D.C." rather than "Washington, DC"
  const place = (h) => (h.state === "DC" ? "Washington, D.C." : `${h.city}, ${h.state}`);
  const ATTR_NAMES = { bc_vision: "ball carrier vision", "bc vision": "ball carrier vision" };
  // readable ink on a team color
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
                  asked_more: "wants more from", not_buying: "isn't buying the pitch from", hung_up: "has an unfinished call from" };
  const eventWord = (e) => (e.kind === "hung_up" && e.action === "hc_visit" ? "has an unfinished visit from" : WORDS[e.kind] || e.kind);
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
    const BIG = new Set(["commit", "flip", "decommit", "signed", "asked_more", "not_buying", "hung_up"]);
    const weight = (r) => (r.rank !== r.prev_rank ? 2 : 0) + r.events.filter((e) => BIG.has(e.kind)).length * 3 + (r.moves.some((m) => m.you) ? 1 : 0);
    const rows = report.rows.filter((r) => weight(r) > 0).sort((a, b) => weight(b) - weight(a));
    if (!rows.length) return null;
    card.append(el("ul", { class: "go-news go-report-rows" }, rows.slice(0, 6).map((r) => {
      const bits = [];
      if (r.rank == null) bits.push("Not on his list");
      else if (r.prev_rank != null && r.prev_rank !== r.rank) bits.push(`${r.prev_rank > r.rank ? "Up" : "Down"} to #${r.rank} of ${r.of}${r.rank === 1 ? "" : r.leader ? ` · ${r.leader.name} leads` : ""}`);
      else bits.push(r.rank === 1 ? "You lead" : `#${r.rank} of ${r.of}${r.leader ? ` · ${r.leader.name} leads` : ""}`);
      for (const e of r.events.filter((e) => BIG.has(e.kind)).slice(0, 2)) bits.push(`${eventWord(e)} ${e.school_name || ""}`.trim());
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

  // ----- the one ladder: your standing with a prospect, read from his list -----------------------------
  // standingOf(b, me) -> { word, text, odds, tone, fill, lo, hi, certainty }. The word is one of six
  // (Yours, Lost, Favorite, In it, Long shot, Not offered); the sentence and the odds word go with it.
  // His list (b.list: rank, bar, offered) and your offer decide it; the offer race's place is never used,
  // so the words and the race he draws agree. b.standing's pct/lo/hi only size the bar and the flip odds.
  function standingOf(b, me) {
    const st = b.standing || {};
    const school = b.signed || b.committed;
    if (school === me) return { word: "Yours", text: b.signed ? "Signed with you" : b.hard ? "Hard commit to you" : "Verbal commit to you", tone: "good", fill: 1 };
    if (school && (b.signed || b.hard)) return { word: "Lost", text: `${b.signed ? "Signed" : "Hard commit"} · ${teamName(school)}`, odds: "Locked in", tone: "bad", fill: 0 };
    if (school) {
      if (st.pct == null) return { word: "Long shot", text: `Verbal commit · ${teamName(school)}`, odds: "Offer him to try for a flip", tone: "warn", fill: 0 };
      return { word: st.pct >= 0.3 ? "In it" : "Long shot", text: `Verbal commit · ${teamName(school)}`,
               odds: st.hi != null && st.hi < 0.1 ? "A flip looks unlikely" : st.pct >= 0.3 ? "He could still flip to you" : "A flip is a long shot",
               certainty: st.certainty, tone: "warn", fill: st.pct, lo: st.lo, hi: st.hi };
    }
    const rows = (b.list || []).filter((x) => x.bar != null).map((x, i) => ({ ...x, at: x.rank != null ? x.rank : i + 1 }));
    const mine = rows.find((x) => x.you || x.school === me);
    const offered = !!b.offered;
    const fill = st.pct != null ? st.pct : 0;
    if (!mine) return offered ? { word: "Long shot", text: "Outside his top 5", odds: "Long shot", certainty: st.certainty, tone: "muted", fill, lo: st.lo, hi: st.hi }
      : { word: "Not offered", text: "Not on his list yet", tone: "muted", fill: 0 };
    const leader = rows.filter((x) => x !== mine).sort((a, c) => a.at - c.at)[0];
    if (!leader || mine.at < leader.at) {
      if (!offered) return { word: "Not offered", text: "He would pick you today: he has no offer from you", odds: "Offer him", tone: "warn", fill: 0 };
      const clear = !leader || mine.bar - leader.bar >= 0.25;
      return { word: "Favorite", text: "Leading his list, offered", odds: clear ? "Clear favorite" : "Narrow favorite", certainty: st.certainty, tone: "good", fill, lo: st.lo, hi: st.hi };
    }
    const where = `${ordinal(mine.at)} on his list`;
    if (!offered) return { word: "Not offered", text: `${where} · not offered`, odds: "Offer to be in it", tone: "muted", fill: 0 };
    const close = mine.bar >= leader.bar - 0.1;
    const odds = close ? "Close race" : mine.bar >= 0.15 ? "Behind, in the picture" : "Long shot";
    return { word: odds === "Long shot" ? "Long shot" : "In it", text: `${where} · ${teamName(leader.school)} leads`, odds, certainty: st.certainty,
             tone: close ? "warn" : "muted", fill, lo: st.lo, hi: st.hi };
  }
  const standing = standingOf;
  // "Sort: your chance" climbs the ladder: yours, favorite, not offered while leading his list (one offer makes him
  // your favorite), in it, long shot, not offered (behind or off his list), lost; within a rung the fuller bar
  // first, then national rank
  function ladderRung(sd) {
    if (sd.word === "Not offered") return sd.tone === "warn" ? 2 : 5;
    return { Yours: 0, Favorite: 1, "In it": 3, "Long shot": 4, Lost: 6 }[sd.word] ?? 5;
  }
  function byChance(me) {
    const memo = new Map();
    const keyOf = (b) => {
      if (!memo.has(b)) { const sd = standingOf(b, me); memo.set(b, [ladderRung(sd), -(sd.fill || 0), b.national_rank ?? b.portal_rank ?? Infinity]); }
      return memo.get(b);
    };
    return (a, b) => {
      const x = keyOf(a), y = keyOf(b);
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
      return 0;
    };
  }
  // his History, one line an entry, newest first: "Week 3 · Message · Playing time", "Week 4 · Call · Program prestige · He lit up",
  // "Week 5 · Offer · 120 NIL", "Week 6 · Committed to Georgia". A call's or visit's pitch folds into that call's line.
  const HISTORY_WORDS = { commit: "Committed to", hard: "Hard commit to", flip: "Flipped to", decommit: "Decommitted from", signed: "Signed with", leaning_fcs: "Leaning toward" };
  function historyLines(events, me) {
    const evs = events || [];
    const folded = new Set();
    const actionOf = new Map();
    evs.forEach((e, i) => {
      if (e.kind !== "pitch") return;
      // the call or visit this pitch finished: the same week, the nearest older contact that opened a scene
      const j = evs.findIndex((c, k) => k > i && !folded.has(k) && c.kind === "contact" && c.week === e.week && (c.action === "call" || c.action === "hc_visit") && !c.pitch && (!e.action || c.action === e.action));
      if (j >= 0) { folded.add(j); actionOf.set(i, evs[j].action); }
    });
    const nil = (e) => (e.nil != null ? `${e.nil} NIL` : null);
    const lowerName = (t) => { const n = PITCH_NAMES[t] || t; return n === n.toUpperCase() ? n : n[0].toLowerCase() + n.slice(1); };
    const LANDED = ["none landed", "one landed", "two landed", "three landed"];
    const line = (e, i) => {
      let bits;
      if (e.kind === "contact") bits = [ACTION_NAMES[e.action] || e.action, e.pitch ? PITCH_NAMES[e.pitch] || e.pitch : null];
      else if (e.kind === "pitch") bits = [ACTION_NAMES[e.action || actionOf.get(i)] || "Pitch", PITCH_NAMES[e.pitch] || e.pitch, REACTION_WORDS[e.reaction] || null];
      else if (e.kind === "offer") bits = e.school && e.school !== me ? [`Offered by ${teamName(e.school)}`] : ["Offer", nil(e)];
      else if (e.kind === "raise_nil") bits = ["NIL raised", nil(e)];
      else if (e.kind === "pull_offer") bits = ["Offer pulled"];
      else if (e.kind === "hung_up") bits = [e.action === "hc_visit" ? "Visit left unfinished" : "Call left unfinished"];
      else if (e.kind === "asked_more") bits = ["He asked for more NIL"];
      else if (e.kind === "not_buying") bits = ["He isn't buying your pitch"];
      else if (e.kind === "pester") bits = [`He tuned out your ${e.action === "hc_visit" ? "visit" : e.action === "call" ? "call" : "message"}`];
      else if (e.kind === "present") bits = [`Presented ${(e.topics || []).map((t) => lowerName(t)).join(", ")}`, LANDED[e.hit] || `${e.hit} landed`];
      else if (e.kind === "answer") bits = [e.answer === "promise" ? `Promised him the job over ${e.about}${e.truthful === false ? " (he did not buy it)" : ""}`
        : e.answer === "deflect" ? `Sidestepped his question about ${e.about}` : `Told him straight about ${e.about}`];
      else if (e.kind === "promise_broken") bits = [`He heard you promised the same spot to ${e.about}`];
      else if (HISTORY_WORDS[e.kind]) bits = [`${HISTORY_WORDS[e.kind]} ${teamName(e.school)}`];
      else bits = [`${eventWord(e)} ${e.school ? teamName(e.school) : ""}`.trim()];
      return [`Week ${e.week}`, ...bits].filter(Boolean).join(" · ");
    };
    return evs.map((e, i) => (folded.has(i) ? null : line(e, i))).filter(Boolean);
  }
  window.CFP.recruiting = { standingOf, byChance, historyLines };

  function bar(sd) {
    const wrap = el("div", { class: "go-bar", role: "img", "aria-label": sd.odds ? `Chance to land: ${sd.odds}` : sd.text });
    if (sd.lo != null) wrap.append(el("span", { class: "go-bar-range", style: `left:${100 * sd.lo}%;width:${100 * (sd.hi - sd.lo)}%` }));
    wrap.append(el("span", { class: `go-bar-fill ${sd.tone}`, style: `width:${sd.fill ? Math.max(2, 100 * sd.fill) : 0}%` }));
    return wrap;
  }

  // a topic in a sentence: "playing time", "NIL"
  const topicWord = (t) => (t === "nil" ? "NIL" : (PITCH_NAMES[t] || t).toLowerCase());
  const REACTION_TOAST = { hit: (t) => `He lit up: ${topicWord(t)} matters to him`, polite: () => "He was polite and moved on",
                           quiet: (t) => `He went quiet: he isn't buying ${topicWord(t)} from you`, tired: () => "He is tired of this: the call wore on him" };
  const REACTION_WORDS = { hit: "He lit up", polite: "Polite", quiet: "He went quiet", tired: "He is tired of this" };
  // your answers to his question about a named player, by the question's kind (the same copy as coach_career/scenes.py ANSWER_COPY)
  const ANSWERS = ["straight", "promise", "deflect"];
  const HOLLOW_REPLY = "I've heard that one before.";      // his reply to a promise he has heard before (scenes.py REPLY_LINES.hollow)
  const ANSWER_COPY = {
    roster: { straight: "He's the starter today. You'd compete, and the best man plays.", promise: "The job's yours.", deflect: "Let's talk about what you'd bring." },
    recruit: { straight: "I offered him too. One of you starts; I want it to be you.", promise: "You're the one I want.", deflect: "Let's talk about what you'd bring." },
  };
  // the ☆ tag's title: where he brought the topic up this week
  const cueTitle = (action) => `He brought this up on the ${action === "hc_visit" ? "visit" : "call"} this week`;
  // the one network path for an action. A call or in-home visit without a pitch opens a scene (handed to
  // opts.onScene); a pitch with opts.scene (its id) finishes it, and his reaction goes to opts.onReaction.
  // opts.silent: the caller toasts (the board's actions say what happened in the spec's words); errors always toast here.
  async function act(s, pid, action, pitch, nil, opts = {}) {
    const body = { pid, action };
    if (pitch) body.pitch = pitch;
    if (nil) body.nil = nil;
    if (opts.scene) body.scene = opts.scene;
    const names = { message: "Message", call: "Call", hc_visit: "Head coach visit", official_visit: "Official visit invite", offer: "Offer", pull_offer: "Offer pulled", raise_nil: "NIL raised", scout: "Scouting trip" };
    let r;
    try { r = await H.api(`/api/season/${s.id}/recruit`, H.postJSON(body)); }
    catch (err) {
      H.toast(`Could not do that: ${H.errText(err)}`, 4000);
      return null;
    }
    if (r.scene) { if (opts.onScene) opts.onScene(r.scene); else if (!opts.silent) H.toast(`${names[action]} open · finish it from his pane`, 3000); }
    else if (r.reaction) { if (!opts.silent) H.toast((REACTION_TOAST[r.reaction.kind] || REACTION_TOAST.polite)(pitch), 4000); if (opts.onReaction) opts.onReaction(r.reaction); }
    else if (opts.silent) { /* the board says what happened, in its own words */ }
    else if (action === "scout") H.toast(`Scouting trip done · ${r.hours_left} hours left · his grades are updated`, 3000);
    else H.toast(`${names[action]} done · ${r.hours_left} hours left${r.revealed ? ` · he cares about ${PITCH_NAMES[r.revealed].toLowerCase()}` : action === "call" ? " · he kept his cards close" : ""} · it lands at the week step`, 3000);
    return r;
  }
  // his reaction to your pitch, in his words, in the tone of how it landed
  function reactionView(r) {
    return el("div", { class: `go-reaction ${r.kind}`, "data-kind": r.kind, role: "status", tabindex: "-1" }, [
      el("div", { class: "go-kicker", text: (REACTION_WORDS[r.kind] || r.kind).toUpperCase() }),
      el("p", { class: "go-reaction-line", text: r.text }),
      el("p", { class: "muted small", text: "It counts at the week step." })]);
  }
  async function setBoard(s, pid, on) {
    try { await H.api(`/api/season/${s.id}/board`, H.postJSON({ pid, on })); return true; }
    catch (err) { H.toast(`Could not change your board: ${H.errText(err)}`, 4000); return false; }
  }

  function meter(label, value, total, alt, title) {
    const fill = total ? Math.max(0, Math.min(1, value / total)) : 0;
    return el("div", { class: "go-meter", ...(title ? { title } : {}) }, [
      el("div", { class: "go-meter-top" }, [el("span", { text: label }), el("b", { text: `${value} / ${total}` })]),
      el("div", { class: "go-meter-track" }, [el("span", { class: `go-meter-fill ${alt ? "alt" : ""}`, style: `width:${100 * fill}%` })]),
    ]);
  }
  // a meter's new value in place: the number pulses, the fill slides
  function patchMeter(node, value, total, title) {
    if (title) node.title = title; else node.removeAttribute("title");
    const b = node.querySelector("b"), text = `${value} / ${total}`;
    if (b.textContent === text) return;
    b.textContent = text;
    node.querySelector(".go-meter-fill").style.width = `${100 * (total ? Math.max(0, Math.min(1, value / total)) : 0)}%`;
    ui().pulse(b);
  }
  function stat(k, val) { return el("div", { class: "go-stat" }, [el("div", { class: "go-kicker muted", text: k }), el("div", { class: "go-stat-val", text: val })]); }
  function newsItem(s, e) {
    return el("li", {}, [el("button", { type: "button", class: "go-link", text: e.name, onclick: () => openProfile(s, e.pid) }), ` ${eventWord(e)} ${teamName(e.school)}`]);
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
      // the play card (season.js playCard): Sim the week, Game day, Sim to selection day, Sim to signing day, ▾ the week picker
      week.append(el("div", { class: "go-play" }, H.playCard(s)));
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
            el("span", { class: `go-tag ${sd.tone}`, text: sd.word })]);
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

  const ACT_TIPS = { scout: "Send your best evaluator to see him: 5 hours a look, any week, until his report is complete at three looks; a week in a scout's area is half a look, up to two" };
  // looks come in trip units (a Send one, an area week half, a full report three): a count shows its half only when it has one
  const fmtLooks = (n) => (Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(1));

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
  // a scouting word as a colored pill; the class is the word lower-cased ("All-American" -> all-american)
  const wordTag = (word) => el("span", { class: `go-word ${String(word).toLowerCase()}`, text: word });
  // a [low, high] pair of words: one tag when both ends match, else "low to high"
  const wordRange = (r) => (r[0] === r[1] ? [wordTag(r[0])] : [wordTag(r[0]), " to ", wordTag(r[1])]);
  const wordText = (r) => (r[0] === r[1] ? r[0] : `${r[0]} to ${r[1]}`);
  // the line under the grade cards: a complete report's single final grades, or how far the ranges have narrowed
  // (profile: a colon after the looks; the pane's Scouting sub-tab: a middle dot, and what a look is)
  function gradesNote(looks, profile) {
    const left = 3 - looks, sep = profile ? ": " : " · ";
    const hover = "Tap or hover a grade to see what it looks like in ratings.";
    if (left <= 0) return `${fmtLooks(looks)} of 3 looks${sep}his report is complete: these are your staff's final grades. ${hover} A read can still be wrong; the truth shows once he is on your roster.`;
    const narrowing = profile ? "Ranges narrow with every look, but a read can be wrong; the truth shows once he is on your roster."
      : "A trip is one look, a week in a scout's area half; ranges narrow with every look, but a read can be wrong.";
    return `${fmtLooks(looks)} of 3 looks${left <= 1 ? `${sep}one trip finishes his report` : ""}. ${hover} ${narrowing}`;
  }
  function scoutLine(grades, looks) {
    return el("div", { class: "go-scouted", title: `Your staff's read after ${fmtLooks(looks)} looks: the range each grade could still fall in` }, [el("b", { text: "SCOUTED" }),
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
  // ----- the stages: his stage with you decides his tab; a commitment or a signature anywhere ends the race -----
  const COLUMNS = [["cold", "Cold"], ["contact", "In touch"], ["top", "Top 8"], ["visited", "Visited"], ["committed", "Committed"]];
  const COLUMN_TIPS = { cold: "No contact yet: an offer now counts half", contact: "You have reached out; get into his top 8 for a visit",
    top: "He is seriously considering you: invite him on a visit", visited: "He has been on campus", committed: "His recruitment is decided: committed or signed, to you or elsewhere" };
  const PHONE = "(max-width: 759px)";
  const phone = () => window.matchMedia(PHONE).matches;
  // the tab he sits under
  const columnOf = (b) => (b.committed || b.signed ? "committed" : COLUMN_TIPS[b.stage] ? b.stage : "cold");

  // what stands out about him, as small tags: the staff's finds, then today's need, offer, mood and commitment
  const genBadge = () => el("span", { class: "go-badge generational", text: "Generational", title: "Your staff's find after three looks: a once-in-a-generation talent every program in the country wants" });
  // "OC likes him": with his report complete, the read says he would start on your returning roster; the tag's title carries the sentence
  const likesText = (l) => `${l.who} likes him`;
  const likesLine = (l) => (l.name ? `Your ${l.who}, ${l.name}, thinks he starts for you next year.` : `${l.text}.`);
  function badges(b, me) {
    const out = el("div", { class: "go-tags go-badges" });
    if (b.generational) out.append(genBadge());
    if (b.find === "gem") out.append(el("span", { class: "go-badge gem", text: "Gem", title: "Your staff's find: even the low end of his potential read beats all but a few prospects at his star level, and few programs rate him that high" }));
    if (b.find === "bust") out.append(el("span", { class: "go-badge bust", text: "Bust risk", title: "Your staff's find: his ranking is high but even the top of their read sits under nearly every prospect at his star level" }));
    if (b.need != null && !b.signed && b.committed !== me) out.append(el("span", { class: `go-tag ${b.need > 0 ? "good" : "muted"}`, text: b.need > 0 ? `Need ${b.need}` : "Full",
      title: b.need > 0 ? `Your roster needs ${b.need} at his position this class` : "Your roster is covered at his position this class" }));
    if (b.offered && !b.signed && b.committed !== me) out.append(el("span", { class: "go-tag good", text: b.nil ? `Offered · ${b.nil} NIL` : "Offered" }));
    if (b.cooled) out.append(el("span", { class: "go-tag bad", text: "Cooled", title: "He read your offer as a lowball: contacts count half and he will not visit until you raise it to what he wants" }));
    if (b.pestering) out.append(el("span", { class: "go-tag bad", text: "Tuning you out", title: "He is not considering you; more contact pushes him away" }));
    if (b.committed === me && !b.signed) out.append(b.hard ? el("span", { class: "go-tag good", text: "Hard commit", title: "Locked in: he cannot flip and his offer stands until he signs" })
      : el("span", { class: `go-tag ${b.firmness >= 70 ? "good" : b.firmness < 40 ? "warn" : ""}`, text: `Verbal · ${b.firmness}`, title: "A verbal commit (0-100): he warms to you on his own each week, faster with a message, call or visit; rivals offering more playing time cool him. At 90 he is a hard commit and cannot flip." }));
    return out.childElementCount ? out : null;
  }

  // his list as a race: one lane a school, its pill as far along as its pull (the leader at the right),
  // in the school's colors, yours ringed, with this week's move as an arrow
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
      // a school without an offer in draws hollow: an outline in its color, so the race agrees with the standing words
      const hollow = x.offered === false;
      return el("div", { class: "go-race-lane", role: "listitem" }, [el("span", { class: `go-race-pill ${you ? "you" : ""} ${hollow ? "unoffered" : ""} ${x.move > 0 || x.new ? "up" : x.move < 0 ? "down" : ""}`,
        style: `left: ${at}%; transform: translateX(-${at}%);${col ? (hollow ? ` border-color:${col}; color:${col};` : ` background:${col}; color:${inkOn(col)};`) : ""}`,
        title: `${x.rank != null ? `#${x.rank} ` : ""}${x.name}${you ? " (you)" : ""}${hollow ? " · no offer" : ""} · ${moved} since last week${x.why ? ` · ${WHY[x.why] || x.why}` : ""}`,
        text: `${x.rank != null ? `${x.rank}. ` : ""}${t.abbreviation || x.name}${arrow}` })]);
    }));
  }

  // the board redraws when the screen crosses the phone line (the pane and the menu change shape)
  let boardAt = null;
  window.matchMedia("(max-width: 359px)").addEventListener("change", () => { if (boardAt && boardAt.box.isConnected && boardAt.box.offsetParent) renderRecruiting(boardAt.s, boardAt.box); });
  window.matchMedia(PHONE).addEventListener("change", () => { if (boardAt && boardAt.box.isConnected && boardAt.box.offsetParent) renderRecruiting(boardAt.s, boardAt.box); });

  // ----- The footprint map -------------------------------------------------------------------------

  // the map is a disclosure: closed unless you opened it, and your choice is kept on this device
  function mapOpen() { try { return localStorage.getItem("cfp-map-open") === "1"; } catch (e) { return false; } }
  const MAP_TOGGLE = (open, small) => (open ? "▾ Hide the map" : `▸ Show ${small ? "the map" : "your footprint map"}`);
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
      dots.push({ id: b.id, xy, tone: sd.tone, ring: b.committed === me || b.signed === me, big: !!b.generational, label: `${b.name} · ${b.position} · ${sd.text}`, name: b.name });
    }
    const open = mapOpen();
    const body = el("div", { class: "go-map-body" });
    body.hidden = !open;
    const toggle = el("button", { type: "button", class: "go-btn go-map-toggle", "aria-expanded": String(open), "aria-controls": "go-map-body", text: MAP_TOGGLE(open, opts.small) });
    body.id = "go-map-body";
    card.classList.toggle("closed", !open);
    const hint = el("span", { class: "muted small go-map-hint", text: opts.selectedState ? `Showing ${opts.selectedState} · tap it again to clear` : "Tap a state to zoom in and filter, a dot to pick him" });
    hint.hidden = !open;
    toggle.addEventListener("click", () => {
      const now = body.hidden;
      body.hidden = !now;
      hint.hidden = !now;
      card.classList.toggle("closed", !now);
      toggle.setAttribute("aria-expanded", String(now));
      toggle.textContent = MAP_TOGGLE(now, opts.small);
      try { localStorage.setItem("cfp-map-open", now ? "1" : "0"); } catch (e) { /* no storage */ }
    });
    // the zoom: a state tap zooms and filters (the redrawn map picks up where this one was), a region button only zooms
    const areaNames = Object.keys(v.areas || {});
    const regionBtns = areaNames.map((a) => el("button", { type: "button", class: "go-btn", "data-area": a, "aria-pressed": "false", text: staffed[a] ? `${a} · ${staffed[a]}` : a }));
    const pressRegion = (r) => regionBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.area === r)));
    const home = () => { if (opts.selectedState && opts.onState) opts.onState(opts.selectedState); else svg.zoom.reset(); };
    const svg = window.USMap.render({ areas: v.areas || {}, staffed, dots, selectedState: opts.selectedState || null, teamColor: color,
      counts: Object.fromEntries(Object.entries(byState).map(([c, e]) => [c, e.n])), zoomKey: `${opts.small ? "prospects" : "board"}:${s.id}`,
      onDot: (id) => { if (opts.onDot) opts.onDot(id); else { view.selected = id; view.reveal = id; if (phone()) view.sheet = true; if (boardAt) renderRecruiting(boardAt.s, boardAt.box); } },
      onState: opts.onState, onReset: home, onZoom: (z) => pressRegion(z.region) });
    pressRegion(svg.zoom.region());
    regionBtns.forEach((b) => b.addEventListener("click", () => {
      if (b.getAttribute("aria-pressed") === "true") svg.zoom.reset();
      else svg.zoom.zoomToStates(v.areas[b.dataset.area], b.dataset.area);
    }));
    const wholeBtn = el("button", { type: "button", class: "go-btn go-map-reset", text: "Whole country" });
    wholeBtn.addEventListener("click", home);
    const regions = el("div", { class: "go-map-regions", role: "group", "aria-label": "Zoom to a region" }, [wholeBtn, ...regionBtns]);
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
    const tiny = window.matchMedia("(max-width: 359px)").matches;
    body.append(tiny ? "" : regions, tiny ? "" : el("div", { class: "go-map-svg" }, [svg]), legend, key,
      dots.length ? "" : el("p", { class: "muted small", text: "Nobody on your board yet: add prospects and they appear here." }), el("div", { class: "go-row" }, [tBtn]), table);
    card.append(el("div", { class: "go-map-head" }, [el("div", { class: "go-display l", text: "YOUR FOOTPRINT" }), hint, toggle]), body);
    return card;
  }

  // ----- the board: stage tabs with counts, a plain list, one pane where every action lives behind the Recruit menu ---
  // Sections: the list; the pane (head, the Recruit menu, the inline step, the stat strip, the tags, the sub-tabs);
  // the phone (the pane as a full-screen dialog, the menu as a bottom sheet). The ladder is standingOf above.
  const STAGE_NAMES = Object.fromEntries(COLUMNS);
  const ACTION_NAMES = { message: "Message", call: "Call", hc_visit: "HC visit", official_visit: "Official visit", offer: "Offer", raise_nil: "NIL raised", pull_offer: "Offer pulled", scout: "Scout", pitch: "Pitch" };
  const SUBS = [["overview", "Overview"], ["scouting", "Scouting"], ["profile", "Profile"], ["history", "History"]];
  function needsOpen() { try { return localStorage.getItem("cfp-needs-open") === "1"; } catch (e) { return false; } }
  // his status in one chip: his stage with you, or where his recruitment ended
  function chipOf(b, me, portal) {
    if (b.signed === me) return { text: "Signed with you", tone: "good" };
    if (b.committed === me) return { text: "Committed to you", tone: "good" };
    if (b.signed) return { text: b.signed === "FCS" ? "Signed · an FCS program" : `Signed · ${teamName(b.signed)}`, tone: "bad" };
    if (b.committed) return { text: `${b.hard ? "Hard commit" : "Verbal commit"} · ${teamName(b.committed)}`, tone: b.hard ? "bad" : "warn" };
    const k = STAGE_NAMES[b.stage] ? b.stage : "cold";
    return { text: k === "visited" && portal ? "Campus visit" : STAGE_NAMES[k], tone: "" };
  }
  // his ask in a few words: "120", "about 90–150"
  const askWord = (b) => (b.ask ? (b.ask.exact != null ? String(b.ask.exact) : `about ${b.ask.lo}–${b.ask.hi}`) : "");
  // your program's case on a pitch, as a word
  const caseWord = (b, t) => { const sv = b.strength ? b.strength[t] : null; return sv == null ? "" : sv >= 0.6 ? "Strong" : sv < 0.25 ? "Weak" : "Fair"; };

  // the Recruit menu is one at a time, on the page body (so the pane's scrolling never clips it)
  let menuState = null;
  function closeMenu(refocus) {
    if (!menuState) return;
    const m = menuState;
    menuState = null;
    m.el.remove();
    if (m.backdrop) m.backdrop.remove();
    document.removeEventListener("pointerdown", m.onDoc, true);
    window.removeEventListener("scroll", m.onMove, true);
    window.removeEventListener("resize", m.onMove);
    m.btn.setAttribute("aria-expanded", "false");
    if (refocus && m.btn.isConnected) m.btn.focus();
  }

  // the board's one fetch. The first draw and the full rebuilds (a tab opening, a career change, a new week, the
  // screen crossing the phone line) go through renderRecruiting; every action goes through refresh(): the board
  // re-fetches and patches itself in place. Fetches are numbered: a response that a later request has overtaken is
  // dropped, so two quick actions never leave the board showing the older one's data.
  let fetchSeq = 0;
  const loadBoard = (s) => H.api(`/api/season/${s.id}/recruiting`);
  async function renderRecruiting(s, box) {
    if (!box.firstChild) box.append(loading("Loading your board…"));
    const n = ++fetchSeq;
    let v;
    try { v = await loadBoard(s); }
    catch (err) { if (n !== fetchSeq) return; box.innerHTML = ""; box.append(loading(`Could not load recruiting: ${H.errText(err)}`)); return; }
    if (n !== fetchSeq) return;
    drawBoard(s, box, v);
  }
  // after an action: re-fetch and patch the drawn board (never a rebuild); null when overtaken or the board is gone
  async function refresh(s, box) {
    const n = ++fetchSeq;
    let v;
    try { v = await loadBoard(s); }
    catch (err) { if (n === fetchSeq) H.toast(`Could not refresh the board: ${H.errText(err)}`, 4000); return null; }
    if (n !== fetchSeq) return null;
    if (!(boardAt && boardAt.box === box && boardAt.s.id === s.id && boardAt.patch && box.isConnected)) return null;
    boardAt.patch(v);
    return v;
  }
  const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // the NIL meter: in the portal what is left of the pool (the title says so); in the class what is left of the year's
  // budget, which includes last year's portal carry-over when there was one
  const nilTotal = (v) => (v.portal && v.nil.pool != null ? v.nil.pool : v.nil.budget);
  const nilTitle = (v) => (v.portal ? "What is left of your portal NIL pool this offseason" : v.nil.carry > 0 ? `Includes ${v.nil.carry} NIL carried over from last year's portal` : null);
  const boardTitle = (v) => (v.portal ? `TRANSFER PORTAL · WEEK ${v.portal.week} OF ${v.portal.weeks}${v.nil.pool != null ? ` · ${v.nil.pool} NIL` : ""}` : "RECRUITING BOARD");

  // the board from a view already fetched: the first draw, and the redraws a needs or map filter asks for.
  // patchBoard(v) (an action's re-fetch) and refill() (a stage tab, the search, the sort) update it in place.
  function drawBoard(s, box, v0) {
    let v = v0;
    const me = s.team;
    const searchHadFocus = document.activeElement && document.activeElement.id === "rc-search";
    // a stage tab or the sort that redrew the board keeps the focus, as the search does
    const stageHadFocus = document.activeElement && box.contains(document.activeElement) && document.activeElement.dataset.stage;
    const sortHadFocus = document.activeElement && box.contains(document.activeElement) && document.activeElement.id === "rc-sort";
    closeMenu();
    // the stage tab, the position and state filters and the search belong to one career: another career starts clear
    if (!view.stage || view.stage.sid !== s.id) { view.stage = { sid: s.id, key: "all" }; view.group = null; view.state = null; view.search = ""; }
    box.innerHTML = "";
    box.dataset.draw = String((Number(box.dataset.draw) || 0) + 1);      // a draw counter, bumped by every draw and patch: tests wait on it after an action lands
    document.body.classList.remove("go-sheet-open");
    boardAt = { s, box, patch: patchBoard };
    let boardEl = null;
    // Auto-recruit: off, for the coming week only, or all season
    const AUTO = [["off", "Off"], ["week", "This week"], ["season", "All season"]];
    const AUTO_SAID = { off: "Auto-recruit off", week: "Auto-recruit for this week", season: "Auto-recruit all season" };
    const AUTO_TIPS = { off: "Auto-recruit off: you recruit.", week: "Auto-recruit for this week: your staff spend your hours, then it turns off.", season: "Auto-recruit all season: your staff spend your hours every week." };
    const auto = el("div", { class: "go-seg", role: "group", "aria-label": "Auto-recruit" }, AUTO.map(([k, label]) => {
      const b = el("button", { type: "button", class: `go-seg-btn ${v.auto_recruit === k ? "on" : ""}`, "data-auto": k, "aria-pressed": String(v.auto_recruit === k), text: label, title: AUTO_TIPS[k] });
      b.addEventListener("click", () => ui().busy(b, (async () => {
        try { await H.api(`/api/season/${s.id}/settings`, H.postJSON({ auto_recruit: k })); ui().toast(AUTO_SAID[k]); await refresh(s, box); }
        catch (err) { H.toast(`Could not change Auto-recruit: ${H.errText(err)}`, 4000); }
      })()));
      return b;
    }));
    const meters = { hours: meter("Hours", v.hours_left, v.hours), nil: meter("NIL points", v.nil.left, nilTotal(v), false, nilTitle(v)),
      offers: meter("Offers", v.offers, v.offers + v.offers_left, true), commits: meter("Commits", v.committed, v.open_spots, true) };
    box.append(el("div", { class: "go-board-head rc-head" }, [
      el("div", { class: "go-display l", text: boardTitle(v) }),
      el("div", { class: "go-meters" }, [meters.hours, meters.nil, meters.offers, meters.commits]),
      el("div", { class: "go-auto" }, [el("span", { class: "small muted", text: "Auto-recruit" }), auto]),
    ]));
    if (!v.board.length) {
      box.append(el("div", { class: "go-card go-empty" }, [el("div", { class: "go-display l", text: "YOUR BOARD IS EMPTY" }),
        el("p", { class: "muted", text: "Add prospects from the class, then recruit them here. Every action costs hours; only an offer lets him commit to you." }),
        el("button", { type: "button", class: "go-btn primary", text: "Find prospects", onclick: () => H.onChange("prospects") })]));
      return;
    }

    // ----- the stage row: tabs with counts, the search and the sort; the needs as a disclosure; the map -----
    const label = (k, name) => (k === "visited" && v.portal ? "Campus visit" : name);
    const poolOf = () => {
      const q = view.search.trim().toLowerCase();
      const matches = (b) => !q || b.name.toLowerCase().includes(q) || b.position.toLowerCase() === q || ((b.hometown && b.hometown.state) || "").toLowerCase() === q;
      return v.board.filter((b) => (!view.group || b.group === view.group) && (!view.state || (b.hometown && b.hometown.state) === view.state) && matches(b));
    };
    const countsOf = (pool) => {
      const counts = { all: pool.length };
      for (const [k] of COLUMNS) counts[k] = pool.filter((b) => columnOf(b) === k).length;
      return counts;
    };
    const stages = el("div", { class: "go-stages", role: "group", "aria-label": "Stages" }, [["all", "All"], ...COLUMNS].map(([k, name]) => {
      const b = el("button", { type: "button", "data-stage": k, "aria-pressed": String(view.stage.key === k), title: COLUMN_TIPS[k] || "Everyone on your board" },
        [el("span", { text: label(k, name) }), el("b", { text: "0" })]);
      b.addEventListener("click", () => { view.stage.key = k; refill({}); });
      return b;
    }));
    const search = el("input", { type: "search", id: "rc-search", value: view.search, placeholder: "Search name, position, state", "aria-label": "Search your board" });
    let qTimer = null;
    search.addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(() => { view.search = search.value; refill({}); }, 150); });
    if (!["chance", "rank"].includes(view.sort)) view.sort = "chance";
    const sort = el("select", { id: "rc-sort", class: "go-sel", "aria-label": "Sort" }, [["chance", "Sort: your chance"], ["rank", "Sort: national rank"]].map(([k, t]) => el("option", { value: k, text: t })));
    sort.value = view.sort;
    sort.addEventListener("change", () => { view.sort = sort.value; refill({}); });
    box.append(el("div", { class: "go-stagebar" }, [stages, el("div", { class: "go-tools" }, [search, sort])]));
    // what the roster needs this class, by position, behind a disclosure; a position picked there filters the list to it
    const open = (view.needsOpen = needsOpen());
    const needsBox = el("div", { id: "rc-needs", class: "go-needs-box" }, [needsStrip(v.needs_detail, view.group, (g) => { view.group = g; drawBoard(s, box, v); }, () => drawBoard(s, box, v))]);
    needsBox.hidden = !open;
    const needsBtn = el("button", { type: "button", class: "go-needs-toggle", "aria-expanded": String(open), "aria-controls": "rc-needs" },
      [el("span", { text: `Needs ${open ? "▾" : "▸"}` }), view.group ? el("span", { class: "go-tag", text: `${view.group} only` }) : null]);
    needsBtn.addEventListener("click", () => {
      const now = needsBox.hidden;
      needsBox.hidden = !now;
      view.needsOpen = now;
      needsBtn.setAttribute("aria-expanded", String(now));
      needsBtn.firstChild.textContent = `Needs ${now ? "▾" : "▸"}`;
      try { localStorage.setItem("cfp-needs-open", now ? "1" : "0"); } catch (e) { /* no storage */ }
    });
    box.append(el("div", { class: "go-needs-disclosure" }, [needsBtn, needsBox]));
    box.append(mapCard(v, s, me, { selectedState: view.state, onState: (c) => { view.state = view.state === c ? null : c; drawBoard(s, box, v); } }));

    // ----- the list: one row a recruit in the chosen tab, in sort order -----
    const order = { chance: byChance(me), rank: (a, b) => (a.national_rank ?? Infinity) - (b.national_rank ?? Infinity) };
    const inTab = (b) => view.stage.key === "all" || columnOf(b) === view.stage.key;
    // picked from the map's dot or his profile (view.reveal) while a tab, the search or a filter hides him: show everyone and him
    const want = view.reveal ? v.board.find((b) => b.id === view.reveal) : null;
    view.reveal = null;
    if (want && !(poolOf().includes(want) && inTab(want))) {
      view.stage.key = "all"; view.search = ""; view.group = null; view.state = null;
      view.selected = want.id;
      drawBoard(s, box, v); return;
    }
    let rows = [], sel = null, side = null;
    const list = el("div", { class: "go-list go-list-recruits", role: "group", "aria-label": "Your board" });
    const empty = el("p", { class: "muted go-list-empty" });
    const footCount = el("span", { class: "muted small" });
    list.append(empty, el("div", { class: "go-list-foot" }, [footCount, el("button", { type: "button", class: "go-link", text: "+ Find prospects", onclick: () => H.onChange("prospects") })]));
    // arrow keys move the selection; on a phone they move the focus and Enter opens the pane
    list.addEventListener("keydown", (e) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const btns = [...list.querySelectorAll(".go-row-recruit:not(.go-leaving)")];
      if (!btns.length) return;
      const i = btns.indexOf(document.activeElement);
      const j = e.key === "ArrowDown" ? Math.min(btns.length - 1, i + 1) : e.key === "ArrowUp" ? Math.max(0, i - 1) : e.key === "Home" ? 0 : btns.length - 1;
      e.preventDefault();
      const b = rows.find((r) => r.id === btns[j].dataset.pid);
      if (!b) return;
      if (phone()) { view.selected = b.id; markRows(); btns[j].focus(); }
      else { choose(b); btns[j].focus({ preventScroll: true }); }
    });
    boardEl = el("div", { class: "go-board" }, [list]);
    box.append(boardEl);
    settleExpect();
    refill({});
    view.focusScene = false;
    if (searchHadFocus) { search.focus({ preventScroll: true }); const n = search.value.length; search.setSelectionRange(n, n); }
    else if (stageHadFocus) { const t = stages.querySelector(`button[data-stage="${stageHadFocus}"]`); if (t) t.focus({ preventScroll: true }); }
    else if (sortHadFocus) sort.focus({ preventScroll: true });

    // an action's re-fetch landed: the meters, the counts, the rows and the pane change in place; nothing is emptied
    function patchBoard(v2) {
      v = v2;
      if (!v.board.length || !boardEl || !boardEl.isConnected) { drawBoard(s, box, v); return; }
      box.dataset.draw = String((Number(box.dataset.draw) || 0) + 1);
      patchMeter(meters.hours, v.hours_left, v.hours);
      patchMeter(meters.nil, v.nil.left, nilTotal(v), nilTitle(v));
      patchMeter(meters.offers, v.offers, v.offers + v.offers_left);
      patchMeter(meters.commits, v.committed, v.open_spots);
      for (const b of auto.children) { const on = v.auto_recruit === b.dataset.auto; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }
      settleExpect();
      refill({ keep: true, pulse: true });
      view.focusScene = false;
    }
    // a Finish pressed on a call the week step has closed: the board says so and the menu works again
    function settleExpect() {
      if (!view.expectScene) return;
      const { pid: waited, what } = view.expectScene;
      const b = v.board.find((x) => x.id === waited);
      view.expectScene = null;
      if (!(b && b.scene)) { view.scene = null; H.toast(`That ${what} lapsed: the week moved on. The hours stayed spent.`, 4000); }
    }
    // the counts, the rows (reconciled by id: rows move, appear or go; the rest are reused) and the pane, from the
    // current view and filters. opts.keep: an action keeps the pane on him even when it moved him out of the open
    // tab; without it (a tab, the search, the sort) the first row takes over when he is not in the list.
    function refill(opts) {
      const pool = poolOf(), counts = countsOf(pool);
      for (const t of stages.children) {
        const k = t.dataset.stage, c = t.querySelector("b"), n = String(counts[k]);
        if (c.textContent !== n) { c.textContent = n; if (opts.pulse) ui().pulse(c); }
        t.setAttribute("aria-pressed", String(view.stage.key === k));
      }
      rows = pool.filter(inTab).sort(order[view.sort]);
      const onBoard = v.board.some((b) => b.id === view.selected);
      const inList = rows.some((b) => b.id === view.selected);
      if (!onBoard || (!opts.keep && rows.length && !inList)) { view.selected = rows.length ? rows[0].id : null; view.step = null; }
      sel = (opts.keep || inList || rows.some((b) => b.id === view.selected)) ? v.board.find((b) => b.id === view.selected) || null : null;
      empty.textContent = view.search.trim() ? "Nobody matches that search." : "Nobody here yet.";
      empty.hidden = rows.length > 0;
      footCount.textContent = `${v.board.length} on your board`;
      const focused = document.activeElement && list.contains(document.activeElement) ? document.activeElement.dataset.pid : null;
      ui().reconcile(list, rows, (b) => b.id, row, patchRow);
      markRows();
      if (focused) { const f = list.querySelector(`.go-row-recruit[data-pid="${focused}"]`); if (f && document.activeElement !== f) f.focus({ preventScroll: true }); }
      // the pane: patched for the same recruit, swapped (a cross-fade) for another, gone with the last row
      const cur = box.querySelector(".go-pane");
      if (!sel) dropPane();
      else if (cur && cur._pid === sel.id) cur._patch(sel);
      else if (!phone()) swapPane(pane(sel));
      else if (view.sheet) openSheet(sel);
      else dropPane();
      focusScene();
    }
    function dropPane() {
      for (const old of box.querySelectorAll(".go-pane")) old.remove();
      side = null;
      document.body.classList.remove("go-sheet-open");
    }
    function rowLine(b) { return b.portal ? `${b.position} · ${clsWord(b.cls)} · from ${b.from_name}` : ` ${b.position} · ${(b.hometown && b.hometown.state) || ""}`; }
    function row(b) {
      const on = b.id === view.selected;
      const btn = el("button", { type: "button", class: `go-row-recruit ${on ? "selected" : ""}`, "data-pid": b.id, "aria-pressed": String(on), tabindex: on || (!view.selected && b === rows[0]) ? "0" : "-1" }, [
        el("span", { class: "go-row-dot" }), avatar(b.id, "sm"),
        el("span", { class: "go-row-id" }, [el("b", { text: b.name }),
          el("span", { class: "muted small go-row-line" }, b.portal ? [rowLine(b)] : [el("span", { class: "go-stars", text: stars(b.stars) }), rowLine(b)])]),
        el("span", { class: "go-standing-word" })]);
      btn.addEventListener("click", () => choose(v.board.find((x) => x.id === b.id) || b));
      patchRow(btn, b, true);
      return btn;
    }
    // a row's word, dot and line from his current view; a changed word pulses
    function patchRow(btn, b, first) {
      const sd = standingOf(b, me);
      const moved = b.stage_move === "up" || b.stage_move === "down" ? b.stage_move : null;
      const dot = btn.querySelector(".go-row-dot");
      dot.className = `go-row-dot ${moved || ""}`;
      if (moved) {
        const said = moved === "up" ? "Moved up this week" : "Slipped back this week";
        dot.setAttribute("role", "img"); dot.setAttribute("title", said); dot.setAttribute("aria-label", said); dot.removeAttribute("aria-hidden");
      } else { dot.removeAttribute("role"); dot.removeAttribute("title"); dot.removeAttribute("aria-label"); dot.setAttribute("aria-hidden", "true"); }
      btn.querySelector(".go-row-id b").textContent = b.name;
      const line = btn.querySelector(".go-row-line");
      if (b.portal) line.textContent = rowLine(b);
      else { line.firstChild.textContent = stars(b.stars); line.lastChild.data = rowLine(b); }
      const word = btn.querySelector(".go-standing-word");
      const was = word.textContent;
      word.textContent = sd.word;
      word.className = `go-standing-word ${sd.tone}`;
      if (!first && was !== sd.word) ui().pulse(word);
    }
    function markRows() {
      for (const r of list.querySelectorAll(".go-row-recruit")) {
        const on = r.dataset.pid === view.selected;
        r.classList.toggle("selected", on);
        r.setAttribute("aria-pressed", String(on));
        r.tabIndex = on ? 0 : -1;
      }
    }
    // picking a row: the pane changes in place (desktop) or opens full-screen (phone); nothing reloads
    function choose(b) {
      if (view.selected !== b.id) view.step = null;
      view.selected = b.id;
      sel = b;
      closeMenu();
      markRows();
      if (phone()) { view.sheet = true; openSheet(b); }
      else {
        const cur = box.querySelector(".go-pane");
        if (cur && cur._pid === b.id) cur._patch(b); else swapPane(pane(b));
        // the first pick brings the list and the pane up together: the board's top meets the pane's sticky line
        const gap = boardEl.getBoundingClientRect().top - (parseFloat(getComputedStyle(side).top) || 0);
        if (gap > 1) window.scrollBy({ top: gap, behavior: "smooth" });
      }
    }
    // the pane for him, in place when it is already his, else swapped in with a cross-fade (nothing reloads)
    function patchPane(b) {
      const cur = box.querySelector(".go-pane");
      if (cur && cur._pid === b.id) cur._patch(b); else swapPane(pane(b));
    }
    function swapPane(next) {
      const cur = box.querySelector(".go-pane");
      if (cur) cur.replaceWith(next);
      else if (!phone()) boardEl.append(next);
      else box.append(next);
      if (!phone()) side = next;
      if (!still()) { next.classList.add("go-pane-in"); requestAnimationFrame(() => requestAnimationFrame(() => next.classList.remove("go-pane-in"))); }
      markRows();
      focusScene();
    }
    function openSheet(b) {
      for (const old of box.querySelectorAll(".go-pane.sheet")) old.remove();
      const p = pane(b);
      box.append(p);
      document.body.classList.add("go-sheet-open");
      const back = p.querySelector(".go-pane-back");
      if (back && !view.focusScene) back.focus();
    }
    function closeSheet() {
      view.sheet = false;
      closeMenu();
      dropPane();
      const r = list.querySelector(".go-row-recruit.selected");
      if (r) r.focus({ preventScroll: true });
    }
    function focusScene() {
      if (!view.focusScene) return;
      const sc = box.querySelector(".go-pane .go-scene");
      if (sc) sc.focus({ preventScroll: true });
    }

    // ----- actions: one network path; a call or in-home visit opens a scene in the pane -----
    // what each action says once it lands: one sentence, his name, the cost or the result
    const SAID = {
      message: (b) => `Message sent to ${b.name} · 5 hours`,
      call: (b) => `Called ${b.name} · 15 hours`,
      hc_visit: (b) => `Head coach visit to ${b.name} · 30 hours`,
      official_visit: (b) => `${v.portal ? "Campus" : "Official"} visit invite to ${b.name} · 10 hours`,
      scout: (b) => `Scouted ${b.name} · ${fmtLooks(Math.min(3, (b.looks || 0) + 1))} of 3 looks`,
      offer: (b, nil) => `Offer sent to ${b.name} · ${nil} NIL`,
      raise_nil: (b, nil) => `Offer raised to ${nil} NIL`,
      pull_offer: (b) => `Offer to ${b.name} pulled`,
    };
    // one action on him: the network call, its toast, then the board's re-fetch and patch. `control` is the button
    // that shows busy meanwhile and gets the focus back (the step's Send, or the Recruit button for a menu item).
    function run(b, action, pitch, nil, control) {
      const job = (async () => {
        const r = await act(s, b.id, action, pitch || null, nil, { silent: true, onScene: (sc) => openScene(b, sc) });
        if (!r) return null;
        ui().toast(SAID[action] ? SAID[action](b, nil) : `${action} done`);
        view.step = null;
        await refresh(s, box);
        return r;
      })();
      return ui().busy(control, job);
    }
    function openScene(b, scene) {
      b.scene = scene;
      view.scene = b.id;
      view.reaction = null;
      view.step = null;
      view.focusScene = true;
      patchPane(b);
      focusScene();
      view.focusScene = false;
    }
    // after a menu action: the scene it opened keeps the focus; a pane that switched (Off the board) hands it to the new
    // pane's Recruit button, also when busy() settled on a row because the control left with the old pane; else a row
    function refocus(b) {
      if (view.scene === b.id) { const sc = box.querySelector(".go-pane .go-scene"); if (sc) { sc.focus({ preventScroll: true }); return; } }
      const active = document.activeElement, onBody = !active || active === document.body;
      const recruit = box.querySelector("#rc-recruit");
      if (recruit && (onBody || active.classList.contains("go-row-recruit"))) { recruit.focus({ preventScroll: true }); return; }
      if (!onBody) return;
      const f = list.querySelector(".go-row-recruit[aria-pressed=\"true\"]") || list.querySelector(".go-row-recruit");
      if (f) f.focus({ preventScroll: true });
    }
    function pick(b, action, control) {
      const btn = control || box.querySelector("#rc-recruit");
      if (action === "message" || action === "offer" || action === "raise_nil") {
        view.step = { pid: b.id, kind: action };
        patchPane(b);
        const f = box.querySelector(".go-step select, .go-step input");
        if (f) f.focus({ preventScroll: true });
      } else if (action === "off_board") {
        ui().busy(btn, (async () => {
          if (!(await setBoard(s, b.id, false))) return;
          ui().toast(`${b.name} is off your board`);
          view.sheet = false;
          await refresh(s, box);
        })()).then(() => refocus(b));
      } else if (action === "pull_offer") {       // one misclick in a menu should not cost you a recruit
        if (window.confirm(`Pull your offer to ${b.name}? The NIL points come back to you${b.committed === me && !b.signed ? ", and he decommits from you" : ""}.`)) run(b, action, null, null, btn).then(() => refocus(b));
      } else run(b, action, null, null, btn).then(() => refocus(b));
    }
    // the Recruit menu's items for him: every action with its cost, or the reason it waits
    function menuItems(b) {
      const busy = b.scene ? (b.scene.action === "hc_visit" ? "visit" : "call") : null;
      const done = b.done_this_week || [], looks = Math.min(3, b.looks || 0), hours = v.hours_left;
      const hcWait = b.hc_week != null && s.current_week - b.hc_week < 4;
      const short = (cost) => (cost > hours ? `Not enough hours: ${hours} left` : null);
      const items = [
        ["message", "Message", "5h", done.includes("message") ? "Once a week" : short(5)],
        ["call", "Call", "15h", done.includes("call") ? "Once a week" : short(15)],
        ["hc_visit", "HC visit", "30h", hcWait ? "Monthly" : short(30)],
        ["scout", "Scout", `5h · ${fmtLooks(looks)} of 3 looks${looks < 3 && 3 - looks <= 1 ? " · finishes his report" : ""}`, looks >= 3 ? "His report is complete: 3 of 3 looks" : short(5)],
        ["official_visit", v.portal ? "Campus visit" : "Official visit", "10h", !b.offered ? "Offer him first" : b.visit ? (b.visit.done ? "Visited" : `Booked for week ${b.visit.week}`)
          : !["top", "visited"].includes(b.stage) ? "Not yet: get into his top group" : b.cooled ? "Cooled: raise your offer first" : short(10)],
        ["offer", "Offer…", "No hours", b.signed ? "Signed" : b.offered ? "Already offered" : b.hard ? "Hard commit elsewhere" : v.offers_left <= 0 ? "Offer limit reached" : null],
        ["raise_nil", "Raise NIL…", "No hours", !b.offered ? "Not offered" : null],
        ["pull_offer", "Pull offer", "", !b.offered ? "Not offered" : null],
        ["off_board", "Off the board", "", null],
      ];
      const tip = (action) => (b.pestering && ["message", "call", "hc_visit"].includes(action) ? "Costs you interest while he is tuning you out" : null);
      return items.map(([action, name, cost, why]) => ({ action, name, cost, why: busy ? `Finish your ${busy} first` : why, title: tip(action) }));
    }
    function openMenu(b, btn) {
      if (menuState) { closeMenu(true); return; }
      const sheet = phone();
      const menu = el("div", { class: `go-menu ${sheet ? "sheet" : ""}`, role: "menu", tabindex: "-1", "aria-label": `Recruit ${b.name}` }, menuItems(b).map((it) => {
        const item = el("button", { type: "button", class: "go-menu-item", role: "menuitem", "data-action": it.action, tabindex: "-1", ...(it.title ? { title: it.title } : {}) }, [
          el("span", { class: "go-menu-main" }, [el("b", { text: it.name }), it.cost ? el("span", { class: "muted small go-menu-cost", text: it.cost }) : null]),
          it.why ? el("span", { class: "go-menu-why", text: it.why }) : null]);
        if (it.why) item.setAttribute("aria-disabled", "true");     // grayed, but reachable: the reason is read out
        item.addEventListener("click", () => { if (it.why) return; closeMenu(true); pick(b, it.action); });   // the Recruit button holds the focus while the action is busy
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
      // under the button, right-aligned, kept inside the screen; it follows the button while the page scrolls
      // and goes once the button has scrolled out of sight
      const place = () => {
        const r = btn.getBoundingClientRect(), m = menu.getBoundingClientRect(), pad = 8;
        if (r.bottom < 0 || r.top > window.innerHeight) { closeMenu(); return; }
        let top = r.bottom + 6;
        if (top + m.height > window.innerHeight - pad) top = Math.max(pad, r.top - 6 - m.height);
        menu.style.top = `${top}px`;
        menu.style.left = `${Math.max(pad, Math.min(r.right - m.width, window.innerWidth - m.width - pad))}px`;
      };
      if (!sheet) place();
      const onDoc = (e) => { if (!menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closeMenu(); };
      const onMove = () => { if (!sheet) place(); };
      document.addEventListener("pointerdown", onDoc, true);
      window.addEventListener("scroll", onMove, true);
      window.addEventListener("resize", onMove);
      btn.setAttribute("aria-expanded", "true");
      menuState = { el: menu, backdrop, btn, onDoc, onMove };
      // focus goes to the first live item, or to the first item when every item waits (its reason is read out)
      const first = menu.querySelector(".go-menu-item:not([aria-disabled=\"true\"])") || menu.querySelector(".go-menu-item");
      (first || menu).focus();
    }

    // ----- the pane: everything about him, every action on him -----
    // One element for as long as he is the one on screen: p._patch(b) brings it up to date in place (the head's
    // chip and buttons, the step, the scene or his reaction, the strip's cells, the tags, the sub-tab's body),
    // pulsing what changed; only another recruit swaps the element.
    function pane(b0) {
      let b = b0;
      const sheet = phone();
      const p = el("aside", { class: `go-card go-pane ${sheet ? "sheet" : ""}`, "aria-label": `${b.name}: recruit him`, ...(sheet ? { role: "dialog", "aria-modal": "true" } : {}) });
      p._pid = b.id;
      if (sheet) p.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (menuState) closeMenu(true); else closeSheet(); } });
      // the head: who he is, his status chip, and the one primary button
      const nameBtn = el("button", { type: "button", class: "go-link go-pane-name", text: b.name, title: "Open his profile", onclick: () => showSub("profile") });
      const subLine = el("span", { class: "muted small" });
      const chipEl = el("span", { class: "go-chip" });
      const acts = el("div", { class: "go-pane-act" });
      const head = el("div", { class: "go-pane-head" }, [
        sheet ? el("button", { type: "button", class: "go-btn go-pane-back", "aria-label": "Back to the list", text: "‹ Back", onclick: closeSheet }) : null,
        avatar(b.id), el("div", { class: "go-pane-id" }, [nameBtn, subLine, el("div", { class: "go-pane-chips" }, [chipEl])]), acts]);
      p.append(head);
      // on a phone the head is pinned to the top of the sheet: the sub-tab strip pins just under it, at its height
      if (sheet && window.ResizeObserver) new ResizeObserver(() => p.style.setProperty("--go-head-h", `${head.offsetHeight}px`)).observe(head);
      // the stat strip: four cells; the tags; the sub-tabs and their body
      const cells = ["YOUR CHANCE", "HIS LIST", "YOUR OFFER", "SCOUTED"].map((k) => stat(k, ""));
      const tags = el("div", { class: "go-tags go-badges" });
      const body = el("div", { class: "go-sub-body", role: "tabpanel" });
      const strip = el("div", { class: "go-subtabs", role: "tablist", "aria-label": "About him" }, SUBS.map(([k, name]) => {
        const t = el("button", { type: "button", role: "tab", "data-sub": k, "aria-selected": "false", text: name });
        t.addEventListener("click", () => showSub(k));
        return t;
      }));
      p.append(el("div", { class: "go-strip" }, cells), tags, strip, body);
      let finishBtn = null, recruitBtn = null, offBtn = null, warnEl = null, stepEl = null, sceneEl = null, reactEl = null, chipText = null, bodyKey = null;
      p._patch = (nb) => { b = nb; fill(false); };
      fill(true);
      return p;

      function fill(first) {
        const sd = standingOf(b, me);
        const open = !b.signed && b.committed !== me;           // the race is still on for you
        const busy = open && b.scene ? (b.scene.action === "hc_visit" ? "visit" : "call") : null;
        const shown = !!(open && b.scene && view.scene === b.id);
        p.setAttribute("aria-label", `${b.name}: recruit him`);
        nameBtn.textContent = b.name;
        subLine.textContent = b.portal ? `${b.position} · ${clsWord(b.cls)} · from ${b.from_name} · #${b.portal_rank} in the portal` : `${stars(b.stars)} ${b.position} · ${place(b.hometown)} · #${b.national_rank}`;
        const chip = chipOf(b, me, v.portal);
        if (chip.text !== chipText) { chipText = chip.text; chipEl.textContent = chip.text; chipEl.className = `go-chip ${chip.tone}`; if (!first) ui().pulse(chipEl); }
        // "OC likes him" sits once, among the tags under the strip (tagNodes): the head keeps to his status chip
        // his call or visit is open but not on screen: Finish brings it back (it re-reads the board first: the week may have moved on)
        const wantFinish = !!(busy && !shown);
        if (wantFinish && !finishBtn) {
          finishBtn = el("button", { type: "button", id: "rc-finish", class: "go-btn primary" });
          finishBtn.addEventListener("click", () => {
            view.scene = b.id; view.focusScene = true; view.expectScene = { pid: b.id, what: busy };
            ui().busy(finishBtn, refresh(s, box)).then(() => refocus(b));
          });
          acts.prepend(finishBtn);
        } else if (!wantFinish && finishBtn) { finishBtn.remove(); finishBtn = null; }
        if (finishBtn) { finishBtn.textContent = busy === "visit" ? "Finish the visit" : "Finish the call"; finishBtn.setAttribute("aria-label", `Finish your ${busy} with ${b.name}`); }
        if (open && !recruitBtn) {
          recruitBtn = el("button", { type: "button", id: "rc-recruit", class: "go-btn", "aria-haspopup": "menu", "aria-expanded": "false", text: "Recruit ▾" });
          recruitBtn.addEventListener("click", () => openMenu(b, recruitBtn));
          acts.append(recruitBtn);
        } else if (!open && recruitBtn) { recruitBtn.remove(); recruitBtn = null; }
        if (recruitBtn) recruitBtn.classList.toggle("primary", !busy);
        // he is tuning you out: a warning above the Recruit button (the menu's contacts stay open, their titles carry the cost)
        const wantWarn = !!(open && b.pestering);
        if (wantWarn && !warnEl) {
          warnEl = el("p", { class: "go-warn", role: "note", text: "He is tuning you out: another contact costs you interest." });
          acts.prepend(warnEl);
          if (!first) ui().fadeIn(warnEl);
        } else if (!wantWarn && warnEl) { const old = warnEl; warnEl = null; if (first) old.remove(); else ui().fadeOut(old); }
        const wantOff = !open && !!b.signed && b.signed !== me;
        if (wantOff && !offBtn) { offBtn = el("button", { type: "button", class: "go-btn", text: "Off the board", onclick: () => pick(b, "off_board", offBtn) }); acts.append(offBtn); }
        else if (!wantOff && offBtn) { offBtn.remove(); offBtn = null; }
        // the inline step (Message, Offer…, Raise NIL…): kept while it is the same step (what you typed stays)
        const stepKind = open && !busy && view.step && view.step.pid === b.id ? view.step.kind : null;
        // a part that leaves while it holds the focus hands it to the Recruit button (never to the page body)
        const catchFocus = () => { if (!document.activeElement || document.activeElement === document.body) (recruitBtn || finishBtn || p).focus({ preventScroll: true }); };
        const leave = (old) => {
          if (old.contains(document.activeElement)) catchFocus();
          if (first) old.remove(); else ui().fadeOut(old).then(catchFocus);
        };
        if (stepEl && (!stepKind || stepEl._kind !== stepKind)) { const old = stepEl; stepEl = null; leave(old); }
        if (stepKind && !stepEl) { stepEl = stepView(b, stepKind); stepEl._kind = stepKind; head.after(stepEl); if (!first) ui().fadeIn(stepEl); }
        // the scene, or his reaction to your pitch
        const sceneId = shown ? b.scene.id : null;
        if (sceneEl && sceneEl._sid !== sceneId) { const old = sceneEl; sceneEl = null; leave(old); }
        const reacted = !shown && view.reaction && view.reaction.pid === b.id ? view.reaction.r : null;
        if (reactEl && reactEl._r !== reacted) { const old = reactEl; reactEl = null; leave(old); }
        if (sceneId && !sceneEl) { sceneEl = sceneView(b); sceneEl._sid = sceneId; (stepEl || head).after(sceneEl); if (!first) ui().fadeIn(sceneEl); }
        if (reacted && !reactEl) { reactEl = reactionView(reacted); reactEl._r = reacted; (stepEl || head).after(reactEl); if (!first) ui().fadeIn(reactEl); }
        // the strip's cells
        const rowsOf = (b.list || []).filter((x) => x.bar != null);
        const mineRow = rowsOf.find((x) => x.you || x.school === me);
        const at = mineRow ? (mineRow.rank != null ? mineRow.rank : rowsOf.indexOf(mineRow) + 1) : null;
        const ask = askWord(b);
        // YOUR OFFER: "135 NIL · He wants 105" once you have offered, "He wants about 75–135" (or the number) before, "—" when nothing is known
        const vals = [sd.odds || "—",
          at ? `#${at} of ${Math.max(b.schools || 0, rowsOf.length)}` : b.offered && !(b.signed || b.committed) ? "Outside his top 5" : "Not on it",
          b.offered ? `${b.nil || 0} NIL${ask ? ` · He wants ${ask}` : ""}` : ask ? `He wants ${ask}` : "—",
          b.looks ? `${fmtLooks(Math.min(3, b.looks))} of 3 looks` : "Not yet"].map((t) => t.replace(/^[a-z]/, (c) => c.toUpperCase()));   // no stat value starts lowercase
        vals.forEach((t, i) => { const c = cells[i].querySelector(".go-stat-val"); if (c.textContent !== t) { c.textContent = t; if (!first) ui().pulse(cells[i]); } });
        // the tags: only what is known; a new one fades in and pulses, a gone one fades out, a changed one pulses
        const wanted = tagNodes(b);
        ui().reconcile(tags, wanted, (n) => n.dataset.key, (n) => { if (!first) ui().pulse(n); return n; }, (old, n) => {
          if (old.textContent !== n.textContent) { old.textContent = n.textContent; ui().pulse(old); }
          old.className = n.className;
          if (n.title) old.title = n.title; else old.removeAttribute("title");
        });
        if (wanted.length) tags.hidden = false;
        else if (first || still()) tags.hidden = true;
        else setTimeout(() => { if (!tags.querySelector(":scope > :not(.go-leaving)")) tags.hidden = true; }, 180);
        // the sub-tab's body: rebuilt only when what it shows changed
        if (!SUBS.some(([k]) => k === view.sub)) view.sub = "overview";
        const k = view.sub;
        for (const t of strip.children) t.setAttribute("aria-selected", String(t.dataset.sub === k));
        const key = `${k}:${JSON.stringify(k === "overview" ? [sd, b.list] : k === "scouting" ? [b.our_grades, b.looks, b.trips, b.line] : k === "history" ? [b.history, b.done_this_week, (v.recap || []).filter((e) => e.pid === b.id)] : [b.trips, b.looks])}`;
        if (key !== bodyKey) {
          const changed = bodyKey != null && bodyKey.startsWith(`${k}:`);
          bodyKey = key;
          fillSub(k, sd);
          if (changed) ui().pulse(body.firstElementChild);
        }
      }
      function tagNodes(b) {
        const out = [...(badges(b, me) || { children: [] }).children];
        for (const t of b.priorities_known) out.push(el("span", { class: "go-tag", "data-key": `pri:${t}`, text: `★ ${PITCH_NAMES[t]}`, title: "He told you he cares about this" }));
        const cue = cueOf(b);
        for (const t of cue.topics) if (!b.priorities_known.includes(t)) out.push(el("span", { class: "go-tag cue", "data-key": `pri:${t}`, text: `☆ ${PITCH_NAMES[t] || t}`, title: cue.title }));
        if (b.likes) out.push(el("span", { class: "go-tag good go-likes", "data-key": "likes", text: likesText(b.likes), title: b.likes.text }));
        if (b.visit) out.push(el("span", { class: "go-tag", "data-key": "visit", text: b.visit.done ? "Visited" : `Visit wk ${b.visit.week}` }));
        if (b.portal && b.role) out.push(el("span", { class: `go-tag ${b.role === "Would start" ? "good" : b.role === "Next in line" ? "warn" : "muted"}`, "data-key": "role", text: b.role, title: "Where he would sit on your depth chart next season" }));
        for (const n of out) if (!n.dataset.key) n.dataset.key = tagKey(n.textContent);
        return out;
      }
      function showSub(k) {
        view.sub = k;
        bodyKey = null;
        fill(false);
        ui().fadeIn(body);
      }
      function fillSub(k, sd) {
        body.innerHTML = "";
        body.className = `go-sub-body ${k === "profile" ? "go-profile rc-profile" : ""}`;
        if (k === "overview") {
          body.append(el("div", { class: `go-standing-text ${sd.tone}`, text: sd.text }));
          if (sd.odds) body.append(el("div", { class: "muted small", text: `${sd.odds}${sd.certainty ? ` · ${sd.certainty}${sd.certainty !== "Solid read" ? ": the range narrows as signing day nears" : ""}` : ""}` }));
          body.append(bar(sd), el("div", { class: "go-kicker muted", text: "HIS LIST" }), race(b, me));
        } else if (k === "scouting") body.append(scoutingView(b));
        else if (k === "profile") openProfile(s, b.id, body, { pane: true });
        else body.append(historyView(b));
      }
    }
    // a tag's identity for the reconcile: the kind, so a changed number ("Offered · 150 NIL") patches in place
    function tagKey(text) {
      const t = text.trim();
      if (/^(Offered)/.test(t)) return "offered";
      if (/^(Need \d+|Full)$/.test(t)) return "need";
      if (/^(Verbal|Hard commit)/.test(t)) return "commit";
      return t;
    }
    // what he brought up this week: the cue of an open scene, or of one you finished this week, and the ☆ tag's title
    function cueOf(b) {
      const hw = view.heard[`${s.id}:${b.id}`];
      const c = b.scene ? { topics: b.scene.cue ? b.scene.cue.topics : [], action: b.scene.action } : hw && hw.week === s.current_week ? hw : { topics: [] };
      return { topics: c.topics, title: cueTitle(c.action) };
    }
    // the pitch as a dropdown: his known priorities first, then the rest, each with your program's case;
    // ★ marks a known priority, ☆ a topic he brought up this week (a known one keeps ★)
    function pitchSelect(b) {
      const cued = cueOf(b).topics;
      const order = [...b.priorities_known, ...Object.keys(PITCH_NAMES).filter((t) => !b.priorities_known.includes(t))];
      const selEl = el("select", { id: "rc-pitch", class: "go-sel", "aria-label": `Pitch to ${b.name}` }, order.map((t) => {
        const star = b.priorities_known.includes(t) ? "★ " : cued.includes(t) ? "☆ " : "";
        const parts = [`${star}${PITCH_NAMES[t]}`, caseWord(b, t) || null].filter(Boolean);
        return el("option", { value: t, text: parts.join(" · ") });
      }));
      selEl.value = view.pitch[b.id] && order.includes(view.pitch[b.id]) ? view.pitch[b.id] : b.priorities_known[0] || cued[0] || order[0];
      selEl.addEventListener("change", () => { view.pitch[b.id] = selEl.value; });
      return selEl;
    }
    // Message, Offer… and Raise NIL… happen here, under the head: the pitch (not for a raise), the NIL points (not for a message)
    function stepView(b, kind) {
      const st = el("div", { class: "go-step", role: "group", "aria-label": kind === "message" ? `Message ${b.name}` : kind === "offer" ? `Offer ${b.name}` : `Raise your NIL offer to ${b.name}` });
      st.append(el("div", { class: "go-kicker", text: kind === "message" ? "MESSAGE · 5 HOURS" : kind === "offer" ? "OFFER · NO HOURS" : "RAISE NIL · NO HOURS" }));
      const pitch = kind === "raise_nil" ? null : pitchSelect(b);
      if (pitch) st.append(el("label", { for: "rc-pitch" }, [el("span", { class: "small", text: "Your pitch" }), pitch]));
      let nil = null;
      if (kind !== "message") {
        const ask = askWord(b);
        const start = kind === "offer" ? (b.ask ? (b.ask.exact != null ? b.ask.exact : b.ask.lo) : 0) : Math.max((b.nil || 0) + 5, b.ask && b.ask.exact != null ? b.ask.exact : 0);
        nil = el("input", { type: "number", id: "rc-nil", class: "go-nil", min: String(kind === "offer" ? 0 : (b.nil || 0) + 5), step: "5", value: String(start) });
        st.append(el("label", { for: "rc-nil" }, [el("span", { class: "small", text: `NIL points · ${kind === "offer" ? (ask ? `wants ${ask}` : "no ask known yet") : `your offer is ${b.nil || 0}${ask ? ` · wants ${ask}` : ""}`}` }), nil]));
        if (kind === "offer") st.append(el("p", { class: "muted small", text: "Under half of what he wants reads as a lowball." }));
      }
      const go = el("button", { type: "button", class: "go-btn primary go-step-go", text: kind === "message" ? "Send" : kind === "offer" ? "Offer" : "Raise" });
      const cancel = el("button", { type: "button", class: "go-btn go-step-cancel", text: "Cancel" });
      go.addEventListener("click", async () => {
        const r = await run(b, kind, pitch ? pitch.value : null, nil ? Number(nil.value) || 0 : null, go);
        // the step closed with the action: the Recruit button takes the focus (unless a scene opened meanwhile and holds it)
        const sc = box.querySelector(".go-pane .go-scene");
        if (r && !view.step && !(sc && sc.contains(document.activeElement))) { const btn = box.querySelector("#rc-recruit"); if (btn) btn.focus({ preventScroll: true }); }
      });
      // Cancel is the player's own dismissal: the step leaves at once (an action's close fades it)
      cancel.addEventListener("click", () => { view.step = null; st.remove(); patchPane(b); const btn = box.querySelector("#rc-recruit"); if (btn) btn.focus({ preventScroll: true }); });
      st.append(el("div", { class: "go-step-acts" }, [go, cancel]));
      return st;
    }
    // the Scouting sub-tab: the word grades with their ranges, the looks, the scout line and the comps
    function scoutingView(b) {
      const out = el("div", { class: "go-scouting" });
      if (b.portal && b.line) out.append(el("p", { class: "muted small", text: lineText(b.line) }));
      if (b.our_grades) {
        out.append(scoutLine(b.our_grades, b.looks));
        out.append(gradeGrid(b.id, b.our_grades, null));
        const looks = Math.min(3, b.looks || 0);
        out.append(el("p", { class: "muted small go-grades-note", text: gradesNote(looks, false) }));
      } else out.append(el("p", { class: "muted", text: "Not scouted yet: send a scout from the Recruit menu, or put a staff member on his area." }));
      out.append(el("p", { class: "small" }, [el("button", { type: "button", class: "go-link sc-reports-link", text: "Reports on the Scouting tab", onclick: () => H.onChange("scouting") })]));
      const comps = el("div", { class: "go-comps" });
      out.append(comps);
      const comp = (c) => `${c.name}, ${c.school} (${c.position}${c.overall ? `, ${c.overall} OVR` : ""})`;
      H.api(`/api/season/${s.id}/prospect/${encodeURIComponent(b.id)}`).then((pr) => {
        if (!comps.isConnected) return;
        const grid = out.querySelector(".go-grades");
        if (grid && pr.our_grades && pr.grade_details) gradeTips(grid, b.id, pr.our_grades, pr.grade_details);   // hover a grade here too
        if (pr.public_comp) comps.append(el("p", { class: "small" }, [el("b", { text: "Comp: " }), comp(pr.public_comp)]));
        if (pr.our_comp) comps.append(el("p", { class: "small" }, [el("b", { text: "Our comp: " }), comp(pr.our_comp)]));
        else if (pr.looks >= 3) comps.append(el("p", { class: "muted small", text: "Our comp: nobody close enough among the starters." }));
        else comps.append(el("p", { class: "muted small", text: `Our comp once his report is complete (${fmtLooks(pr.looks)} of 3 looks).` }));
      }).catch(() => { /* the grades stand without the comps */ });
      return out;
    }
    // the History sub-tab: every contact, offer and decision with him, newest first (b.history); a board without the log
    // shows this week's contacts and his season in the news
    function historyView(b) {
      const out = el("div", { class: "go-history" });
      if (Array.isArray(b.history)) {
        const lines = historyLines(b.history, me);
        out.append(lines.length ? el("ul", { class: "go-news go-history-rows" }, lines.map((t) => el("li", { text: t })))
          : el("p", { class: "muted small", text: "Nothing with him yet: no contact, no offer." }));
        return out;
      }
      const done = b.done_this_week || [];
      out.append(el("p", { class: "small" }, [el("b", { text: "Contacts this week: " }), done.length ? done.map((k) => ACTION_NAMES[k] || k).join(", ") : "none yet"]));
      const evs = (v.recap || []).filter((e) => e.pid === b.id).slice().reverse();
      out.append(evs.length ? el("ul", { class: "go-news" }, evs.map((e) => el("li", {}, [el("span", { class: "muted small", text: `Week ${e.week} · ` }), `${eventWord(e)} ${teamName(e.school)}`])))
        : el("p", { class: "muted small", text: "Nothing on him in the news yet this season." }));
      return out;
    }
    // a call or in-home visit as a conversation in the pane (coach_career/scenes.py): the turns so far (you, him, the
    // room), then your opening (three things, Present), which brings his reaction, your question and his cue in place;
    // then his question when he has one, what you lead with, Pitch. His reaction to the pitch joins the conversation.
    // The other actions wait until you pitch; hanging up only closes the view (Finish in the head resumes it).
    const MAX_PRESENT = 3;
    function sceneView(b) {
      const scene = b.scene, visit = scene.action === "hc_visit", what = visit ? "visit" : "call";
      let chosen = (scene.cue && scene.cue.topics[0]) || "";
      const sc = el("section", { class: "go-scene", tabindex: "-1", "aria-label": `${visit ? "In-home visit" : "Call"} with ${b.name}` });
      sc.append(el("div", { class: "go-scene-head" }, [avatar(b.id), el("div", {}, [el("div", { class: "go-kicker", text: visit ? "IN HIS HOME" : "ON THE PHONE" }), el("b", { text: b.name })])]));
      // the turns: yours right in a muted bubble, his left, the room centered in italics; the cue keeps its frame
      const convo = el("div", { class: "go-scene-lines go-convo", role: "log", "aria-label": `The ${what}` });
      const turnEl = (t) => {
        const cue = !!(scene.cue && t.who === "him" && t.text === scene.cue.text);
        const p = el("p", { class: `go-scene-line go-turn ${t.who} ${cue ? "cue" : ""} ${t.who === "note" ? "room" : ""}`,
          ...(cue ? { title: "The cue: what he is telling you he cares about" } : {}) });
        if (t.who === "you") p.append(el("span", { class: "go-turn-who", text: "You:" }), " ");
        p.append(t.text);
        return p;
      };
      let drawn = 0;
      const addTurns = (animate) => {
        const added = scene.turns.slice(drawn).map((t) => turnEl(t));
        drawn = scene.turns.length;
        for (const e of added) { convo.append(e); if (animate) ui().fadeIn(e); }
        return added;
      };
      addTurns(false);
      sc.append(convo);
      const tail = el("div", { class: "go-scene-tail" });
      sc.append(tail);
      const PITCH_TIP = "Sell him on this: it costs nothing more, the hours went when you picked up";
      // ----- after your opening: his question, what you lead with, Pitch and Hang up -----
      function drawFinish(animate) {
        const q = scene.question;
        const pending = () => !!(q && !q.answer);
        const parts = [];
        if (q) parts.push(questionView(b, scene));
        parts.push(el("div", { class: "go-kicker muted", text: "WHAT YOU LEAD WITH" }),
          pitchPicker(b, chosen, (t) => { chosen = t; view.pitch[b.id] = t; }, scene.cue.topics, cueTitle(scene.action), pending()));
        const go = el("button", { type: "button", class: "go-btn primary", text: "Pitch", title: pending() ? "Answer him first" : PITCH_TIP });
        go.disabled = pending();
        // his question answered: the pitch and its radios open up in place
        sc._unlock = () => {
          go.disabled = false;
          go.title = PITCH_TIP;
          for (const r of sc.querySelectorAll(".go-pitches input")) r.disabled = false;
        };
        go.addEventListener("click", async () => {
          if (pending()) { H.toast("Answer him first.", 3000); return; }
          if (!chosen) { H.toast("Pick what you lead with first: what you are selling him.", 3000); return; }
          const r = await ui().busy(go, act(s, b.id, "pitch", chosen, null, { silent: true, scene: scene.id, onReaction: (re) => {
            view.heard[`${s.id}:${b.id}`] = { week: s.current_week, topics: scene.cue.topics, action: scene.action };
            b.scene = null;
            view.scene = null;
            if (re.revealed && !b.priorities_known.includes(re.revealed)) b.priorities_known.push(re.revealed);   // he told you: known now, not at the re-fetch
            ui().toast(`Pitch: ${PITCH_NAMES[chosen] || chosen} · ${REACTION_WORDS[re.kind] || re.kind}`);
            // the conversation ends in place: your line and his reaction join it, the picker leaves; the finished
            // conversation stays on screen (no scene id to match, so the board's patches keep it) until the pane
            // next changes what it shows (another recruit, a new call, the week step); removing it would shrink the
            // pane under the player's scroll
            sc._sid = null;
            scene.turns.push({ who: "you", text: re.you || PITCH_NAMES[chosen] });
            scene.turns.push({ who: re.kind === "tired" ? "note" : "him", text: re.text });
            const added = addTurns(true);
            const last = added[added.length - 1];
            last.classList.add("go-reaction", re.kind);
            last.dataset.kind = re.kind;
            last.setAttribute("role", "status");
            last.tabIndex = -1;
            // what you led with stays on record (the radios locked); the buttons give way to the note, at the same
            // height, so the pane never shrinks under the player's scroll
            for (const r of fin.querySelectorAll(".go-pitches input")) r.disabled = true;
            acts.style.minHeight = `${acts.offsetHeight}px`;
            hint.style.minHeight = `${hint.offsetHeight}px`;
            acts.replaceChildren(el("span", { class: "muted small go-scene-done", text: "It counts at the week step." }));
            hint.textContent = `The ${what} is over. The conversation stays here until you move on.`;
            patchPane(b);
            last.focus({ preventScroll: true });
            // his reaction stays a moment, then the board catches up in place (unless the board has moved on: another career, a new week, another tab)
            setTimeout(() => {
              if (boardAt && boardAt.box === box && boardAt.s.id === s.id && boardAt.s.current_week === s.current_week && box.offsetParent) refresh(s, box);
            }, 4000);
          } }));
          if (!r) { view.scene = null; refresh(s, box); return; }     // a stale call (the week moved on): the board shows where things stand
          const rv = box.querySelector(".go-pane .go-reaction");       // his reply keeps the focus, not the Pitch button in the leaving scene
          if (rv) rv.focus({ preventScroll: true });
        });
        const hang = el("button", { type: "button", class: "go-link go-hangup", text: "Hang up", onclick: hangUp });
        const acts = el("div", { class: "go-row wrap go-scene-acts" }, [go, hang]);
        const hint = el("p", { class: "muted small", text: `Hanging up keeps the ${what} open: finish it from the pane this week. One you never finish counts for nothing.` });
        parts.push(acts, hint);
        const fin = el("div", { class: "go-scene-finish" }, parts);
        tail.append(fin);
        if (animate) ui().fadeIn(fin);
        return fin;
      }
      function hangUp() {
        view.scene = null;
        patchPane(b);
        const f = box.querySelector("#rc-finish");
        if (f) f.focus({ preventScroll: true });
      }
      // ----- your opening: three things about your program, then Present -----
      function drawOpening() {
        const picked = new Set();
        const wrap = el("div", { class: "go-opening", role: "group", "aria-label": "Your opening" });
        const count = el("span", { class: "go-present-count muted small", role: "status", text: `0 of ${MAX_PRESENT}` });
        const go = el("button", { type: "button", class: "go-btn primary go-present", text: "Present", title: `Pick ${MAX_PRESENT} things first` });
        go.disabled = true;
        const chips = el("div", { class: "go-row wrap go-present-chips", role: "group", "aria-label": "Three things about your program" });
        for (const t of Object.keys(PITCH_NAMES)) {
          const sv = b.strength ? b.strength[t] : null, word = caseWord(b, t);
          const tone = sv == null ? "" : sv >= 0.6 ? "good" : sv < 0.25 ? "bad" : "";
          const chip = el("button", { type: "button", class: "go-chip go-present-chip", "data-topic": t, "aria-pressed": "false",
            title: word ? `Your program's case on ${PITCH_NAMES[t].toLowerCase()}: ${word.toLowerCase()}` : "" },
            [el("b", { text: PITCH_NAMES[t] }), word ? el("span", { class: `go-tag ${tone}`, text: word }) : null]);
          chip.addEventListener("click", () => {
            if (picked.has(t)) picked.delete(t);
            else if (picked.size >= MAX_PRESENT) { H.toast(`Three things. Drop one first.`, 3000); return; }
            else picked.add(t);
            chip.classList.toggle("on", picked.has(t));
            chip.setAttribute("aria-pressed", String(picked.has(t)));
            count.textContent = `${picked.size} of ${MAX_PRESENT}`;
            go.disabled = picked.size !== MAX_PRESENT;
            go.title = go.disabled ? `Pick ${MAX_PRESENT} things first` : "Tell him what your program is about, then ask him what he is looking for";
          });
          chips.append(chip);
        }
        go.addEventListener("click", async () => {
          if (picked.size !== MAX_PRESENT) { H.toast(`Pick ${MAX_PRESENT} things first.`, 3000); return; }
          let r;
          try { r = await ui().busy(go, H.api(`/api/season/${s.id}/recruit`, H.postJSON({ pid: b.id, action: "present", scene: scene.id, topics: [...picked] }))); }
          catch (err) { H.toast(`Could not present: ${H.errText(err)}`, 4000); return; }
          if (!(r && r.scene)) { view.scene = null; refresh(s, box); return; }     // a stale call (the week moved on)
          Object.assign(scene, r.scene);               // the same scene object: the board row and the view share it
          chosen = scene.cue.topics[0] || "";
          // the opening leaves, the new turns come in, then his question and the lead-with: all in place
          await ui().fadeOut(wrap);
          const added = addTurns(true);
          drawFinish(true);
          const first = added[0];
          if (first) { first.tabIndex = -1; first.focus({ preventScroll: true }); }
        });
        wrap.append(el("div", { class: "go-kicker muted", text: "YOUR OPENING" }),
          el("p", { class: "muted small", text: "Three things you lead your program with. Then you ask him what he is looking for." }),
          chips,
          el("div", { class: "go-row wrap go-scene-acts" }, [go, count, el("button", { type: "button", class: "go-link go-hangup", text: "Hang up", onclick: hangUp })]),
          el("p", { class: "muted small", text: `Hanging up keeps the ${what} open: finish it from the pane this week. One you never finish counts for nothing.` }));
        tail.append(wrap);
      }
      if (scene.presented) drawFinish(false); else drawOpening();
      return sc;
    }
    // his question in the scene (docs/superpowers/specs/2026-10-29-recruit-questions-design.md, section 3): his line, three answers
    // while it waits (straight, a promise, a sidestep), his reply once you answered; the reply is the feedback, there is no toast
    function questionView(b, scene) {
      const q = scene.question;
      const wrap = el("div", { class: "go-question", role: "group", "aria-label": `${b.name} asks` });
      wrap.append(el("div", { class: "go-kicker", text: "HE ASKS" }),
        el("p", { class: "go-question-line" }, [el("q", { text: q.text }), el("span", { class: "muted small", text: ` — ${b.name}` })]));
      // his reply's tone: a straight answer or a promise he believes reads good, a promise he has heard before bad, a sidestep muted
      const replyTone = (qq) => (qq.answer === "deflect" ? "muted" : qq.answer === "promise" && (qq.truthful === false || qq.reply === HOLLOW_REPLY) ? "bad" : "good");
      const replyView = (qq) => el("p", { class: `go-question-reply ${replyTone(qq)}`, role: "status", tabindex: "-1", text: qq.reply || "" });
      if (q.answer) { wrap.append(replyView(q)); return wrap; }
      const copy = ANSWER_COPY[q.kind] || ANSWER_COPY.roster;
      const acts = el("div", { class: "go-row wrap go-answers" }, ANSWERS.map((k) => {
        const btn = el("button", { type: "button", class: "go-btn go-answer", "data-answer": k, text: copy[k] });
        btn.addEventListener("click", () => ui().busy(btn, (async () => {
          let r;
          try { r = await H.api(`/api/season/${s.id}/recruit`, H.postJSON({ pid: b.id, action: "answer", scene: scene.id, answer: k })); }
          catch (err) { H.toast(`Could not answer him: ${H.errText(err)}`, 4000); return; }
          Object.assign(q, (r.scene && r.scene.question) || { answer: k, reply: "" }, { truthful: r.truthful });
          for (const t of r.revealed || []) if (!b.priorities_known.includes(t)) b.priorities_known.push(t);   // he told you: known now, not at the re-fetch
          // the answers leave, his reply comes in and takes the focus, the pitch opens up: all in place
          const reply = replyView(q), sc = wrap.closest(".go-scene");
          await ui().fadeOut(acts);
          wrap.append(reply);
          ui().fadeIn(reply);
          if (sc && sc._unlock) sc._unlock();
          reply.focus({ preventScroll: true });
        })()));
        return btn;
      }));
      wrap.append(acts);
      return wrap;
    }
    // the topics as radios, each with your program's case: ★ a known priority, ☆ what he just brought up (`cueTopics`, a scene's cue; `cueTip`, the ☆ title);
    // `locked`: his question waits, the radios are disabled until you answer
    function pitchPicker(b, current, onPick, cueTopics, cueTip, locked) {
      cueTopics = cueTopics || [];
      const pitches = el("div", { class: "go-pitches", role: "radiogroup", "aria-label": `Pitch to ${b.name}` });
      for (const t of Object.keys(PITCH_NAMES)) {
        const known = b.priorities_known.includes(t), cue = !known && cueTopics.includes(t);
        const id = `pitch-${b.id}-${t}`;
        const r = el("input", { type: "radio", name: `pitch-${b.id}`, id, value: t });
        r.checked = current === t;
        if (locked) r.disabled = true;
        r.addEventListener("change", () => onPick(t));
        const sv = b.strength ? b.strength[t] : null, word = caseWord(b, t);
        const tone = sv == null ? "" : sv >= 0.6 ? "good" : sv < 0.25 ? "bad" : "";
        const tag = [known ? "★" : cue ? "☆" : null, word || null].filter(Boolean).join(" ");
        pitches.append(el("label", { class: `go-pitch ${known ? "known" : ""} ${cue ? "cue" : ""}`, for: id, title: sv == null ? "" : known && sv < 0.25 ? "He cares about this and you are weak here: pitching it backfires" : `Your program's case on ${PITCH_NAMES[t].toLowerCase()}: ${word.toLowerCase()}` }, [r,
          el("span", {}, [el("b", { text: PITCH_NAMES[t] }), el("span", { class: `go-tag ${tone}`, text: tag, ...(cue ? { title: cueTip } : known ? { title: "He told you he cares about this" } : {}) })])]));
      }
      return pitches;
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
            : `${r.position} · ${typeof r.height === "number" ? height(r.height) : (r.height || "")} ${r.weight} · ${place(r.hometown)}` }),
            badges({ generational: r.generational, find: r.find }, s.team)]),
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
  // The staff's grade cards (the profile and the pane's Scouting sub-tab): one cell per group with the word
  // range (or the single final grade), and with `details` (the profile's grade_details) a "looks like" tooltip
  // on each, opened on hover, focus or tap. The listeners sit on the grid and find the cell under the event,
  // so cells redrawn or patched later keep working; gradeTips adds the tooltips to a grid drawn without them.
  function gradeGrid(pid, grades, details) {
    const grid = el("div", { class: "go-grades" }, Object.entries(grades).map(([g, r]) => el("div", { class: "go-stat", "data-group": g }, [
      el("div", { class: "go-kicker muted", text: (GROUP_NAMES[g] || g).toUpperCase() }), el("div", { class: "go-stat-val" }, wordRange(r))])));
    if (details) gradeTips(grid, pid, grades, details);
    return grid;
  }
  function gradeTips(grid, pid, grades, details) {
    for (const cell of grid.querySelectorAll(".go-stat:not(.go-tip)")) {
      const g = cell.dataset.group, r = grades[g], d = (details || {})[g] || {};
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
      cell.classList.add("go-tip");
      cell.setAttribute("tabindex", "0");
      cell.setAttribute("aria-describedby", tipId);
      cell.append(tip);
    }
    if (grid.__tips) return;
    grid.__tips = true;
    const cellOf = (e) => { const c = e.target.closest(".go-tip"); return c && grid.contains(c) ? c : null; };
    const tipOf = (c) => c.querySelector(":scope > .go-tip-box");
    const show = (c) => { if (c) placeTip(c, tipOf(c)); };
    const hide = (c) => { if (c) tipOf(c).classList.remove("show"); };
    const left = (e) => { const c = cellOf(e); if (c && !(e.relatedTarget && c.contains(e.relatedTarget))) hide(c); };
    grid.addEventListener("mouseover", (e) => { const c = cellOf(e); if (c && !(e.relatedTarget && c.contains(e.relatedTarget))) show(c); });
    grid.addEventListener("mouseout", left);
    grid.addEventListener("focusin", (e) => show(cellOf(e)));
    grid.addEventListener("focusout", left);
    grid.addEventListener("click", (e) => show(cellOf(e)));
    grid.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(cellOf(e)); });
  }
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

  async function openProfile(s, pid, into, opts = {}) {
    // the window opens at once, saying it is loading, and fills in when his profile arrives; with
    // `into` (a profile already open) it refreshes in place instead of closing and reopening. With
    // opts.pane it is the board pane's Profile sub-tab: the pane's head shows who he is and the Recruit menu
    // there holds Scout and Off the board, so the profile draws neither its own head nor buttons for them
    const inPane = !!opts.pane;
    const node = into || el("div", { class: "rc-profile go-profile" }, [el("p", { class: "muted rc-loading go-loading", text: "Loading his profile…" })]);
    if (into) { node.innerHTML = ""; node.append(el("p", { class: "muted rc-loading go-loading", text: "Updating his profile…" })); }
    else H.openModal("Prospect Profile", node);
    let p;
    try { p = await H.api(`/api/season/${s.id}/prospect/${encodeURIComponent(pid)}`); }
    catch (err) { node.innerHTML = ""; node.append(el("p", { class: "muted", text: `Could not open his profile: ${H.errText(err)}` })); return; }
    const pub = p.public;
    const me = s.team;
    node.innerHTML = "";
    // in the pane the pane's own head already carries him (name, avatar, stars, position, hometown, rank, chip):
    // the profile starts below that, at his commitment, the scouting read and his list
    if (!inPane) node.append(el("div", { class: "rc-profile-head go-profile-head" }, [avatar(pub.avatar_seed, "lg"), el("div", {}, [
      el("h2", { class: "rc-profile-name go-display l", text: pub.name.toUpperCase() }),
      el("div", { class: "go-stars big", text: stars(pub.stars) }),
      el("div", { text: `${pub.position}${pub.ea_position && pub.ea_position !== pub.position ? ` · projects at ${pub.ea_position} in the game` : ""} · ${pub.archetype} · ${height(pub.height)}, ${pub.weight} lb` }),
      el("div", { class: "muted", text: `${pub.high_school} · ${place(pub.hometown)}` }),
      el("div", { class: "muted small", text: `National rankings: #${pub.national_rank} overall · #${pub.position_rank} ${pub.position} · #${pub.state_rank} in ${pub.hometown.state === "DC" ? "D.C." : pub.hometown.state} · composite ${pub.composite.toFixed(4)}` }),
      badges({ generational: pub.generational, find: p.find }, me),
      pub.signed || pub.committed ? null : el("div", { class: "rc-status go-standing-text", text: status(pub) }),
    ])]));
    const holder = pub.signed || pub.committed;
    if (holder) {
      const t = window.CFP.teamsBySlug[holder] || {};
      const col = t.colors || {};
      const bg = holder === "FCS" ? "var(--panel-2)" : col.primary || "var(--panel-2)";
      // his chance to flip, in words (p.flip: the rivals' shares and their words), never a number
      const flip = p.flip || { word: "None", rivals: [] };
      const leader = flip.rivals.length ? flip.rivals[0].name : null;
      const sub = pub.signed ? "Signed: his recruitment is over."
        : pub.hard ? "Hard commit: he is not taking calls"
        : flip.word === "None" || !leader ? "Solid: nobody is close to pulling him away"
        : flip.word === "Slim" ? `Hearing out ${leader}: a slim chance he flips before signing day`
        : flip.word === "Real" ? `${leader} is working him hard: a real chance he flips`
        : `${leader} is close to flipping him`;
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
      onclick: () => { view.selected = pid; view.reveal = pid; view.sheet = true; view.group = null; view.state = null; H.closeModal(); H.onChange("recruiting"); } });
    const label = () => { onBoard.textContent = on ? "✓ On your board · remove" : "+ Add to your board"; onBoard.classList.toggle("primary", !on); toBoard.hidden = !on || !!pub.signed || inPane; };
    label();
    onBoard.addEventListener("click", async () => {
      onBoard.disabled = true;
      if (await setBoard(s, pid, !on)) { on = !on; label(); H.toast(on ? `${pub.name} is on your board.` : `${pub.name} is off your board.`, 2500); }
      onBoard.disabled = false;
    });
    if (!inPane) node.append(el("div", { class: "rc-profile-actions go-row wrap" }, [onBoard, toBoard]));
    if (p.looks >= 3 && p.our_grades) {
      node.append(scoutLine(p.our_grades, p.looks));
      if (p.our_comp && !(p.public_comp && p.public_comp.name === p.our_comp.name)) node.append(el("p", { class: "small" }, [el("b", { text: "Our comp: " }), `${p.our_comp.name}, ${p.our_comp.school} (${p.our_comp.position}${p.our_comp.overall ? `, ${p.our_comp.overall} OVR` : ""})`]));
    }
    if (p.likes) node.append(el("p", { class: "small go-likes-line" }, [el("span", { class: "go-tag good go-likes", text: likesText(p.likes), title: p.likes.text }), ` ${likesLine(p.likes)}`]));
    if (pub.schools.length) {
      const listed = holder ? pub.schools.filter((x) => x.school !== holder) : pub.schools;
      const sorted = listed.slice().sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
      // a committed recruit: each rival's chance to flip him as a word (p.flip), your own row marked; a commit to you
      // whose rivals have no chance is one line instead of a table
      const flipWords = Object.fromEntries(((p.flip && p.flip.rivals) || []).map((r) => [r.school, r.word]));
      const committed = holder && !pub.signed;
      const quiet = committed && holder === me && sorted.every((x) => (flipWords[x.school] || "None") === "None");
      if (quiet) node.append(el("h3", { text: "Who Else Is Calling" }), el("p", { class: "muted go-nobody-close", text: "Nobody is close to pulling him away." }));
      else if (sorted.length) node.append(el("h3", { text: holder ? (pub.signed ? "Who Else Offered" : holder === me ? "Who Else Is Calling" : "His Chance to Flip to Each") : "His list" }), el("div", { class: "go-schools" }, sorted.map((x, i) => el("div", { class: `go-school${x.school === me ? " yours" : ""}` }, [
        el("span", { class: "go-school-name" }, [el("b", { text: x.name }), x.school === me ? el("span", { class: "muted small", text: " (you)" }) : null, i === 0 && !holder && x.pct != null ? el("span", { class: "go-tag good", text: "Leader" }) : null]),
        el("span", { class: "go-school-odds", text: pub.signed ? "" : x.pct == null ? "no offer" : committed ? (flipWords[x.school] || "None") : i === 0 ? "leads" : x.pct >= (sorted[0].pct || 0) - 0.1 ? "close" : x.pct >= 0.15 ? "in it" : "long shot" }),
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
    const looks = Math.min(3, p.looks || 0), left = 3 - looks;
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
      : el("button", { type: "button", class: "go-btn", text: left <= 0 ? "His report is complete: 3 of 3 looks" : `Send a scout (5 hours${left <= 1 ? ", finishes his report" : ""}) →`, title: ACT_TIPS.scout });
    if (!mine && left <= 0) scoutBtn.disabled = true;
    if (!mine) scoutBtn.addEventListener("click", async () => { scoutBtn.disabled = true; if (await act(s, pid, "scout")) openProfile(s, pid, node); else scoutBtn.disabled = false; });
    node.append(el("h3", { text: "Our staff's grades" }));
    if (p.our_grades) {
      // hover (or tab to) a grade: what prospects in this class graded like that look like
      node.append(gradeGrid(pid, p.our_grades, p.grade_details || {}),
        el("p", { class: "muted small go-grades-note", text: gradesNote(looks, true) }),
        ...(inPane ? [] : [el("div", { class: "go-row wrap rc-profile-actions" }, [scoutBtn])]));
      node.append(p.our_comp ? el("p", {}, [el("b", { text: "Our comp: " }), comp(p.our_comp)])
        : el("p", { class: "muted", text: looks >= 3 ? "Our comp: nobody close enough among the starters." : `Our comp once his report is complete (${fmtLooks(looks)} of 3 looks).` }));
    } else node.append(el("p", { class: "muted", text: inPane ? "Not scouted yet: Scout from the Recruit menu, or put a staff member on his area." : "Not scouted yet: send a scout, or put a staff member on his area." }),
      el("div", { class: "go-row wrap rc-profile-actions" }, [inPane ? null : scoutBtn, el("button", { type: "button", class: "go-btn", text: "Assign your staff →", onclick: () => { H.closeModal(); H.onChange("scouting"); } })]));
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
        el("span", { class: "muted small go-class-top" }, c.top.flatMap((t, i) => [i ? " · " : "", `${t.name} ${"★".repeat(t.stars)}`,
          t.generational ? genBadge() : null])),
      ]);
      const li = el("li", { class: `go-list-row go-class ${c.yours ? "yours" : ""}` }, [head]);
      if (open && d.class) li.append(el("ul", { class: "go-class-list" }, d.class.map((r) => el("li", {}, [
        el("button", { type: "button", class: "go-link", text: r.name, onclick: () => openProfile(s, r.id) }),
        el("span", { class: "muted small", text: ` ${"★".repeat(r.stars)} ${r.position} · #${r.national_rank} · ${place(r.hometown)}${r.signed ? " · signed" : ""}` }),
        r.generational ? genBadge() : null,
        r.find_held === true && r.find === "bust" ? el("span", { class: "go-badge bust-held", text: "Bust risk: the read held", title: "Your staff called him a bust risk and he is one" })
          : r.find_held === true ? el("span", { class: "go-badge gem-held", text: "Gem: the read held", title: "Your staff called him a gem and he is one" })
          : r.find_held === false ? el("span", { class: "go-badge gem-missed", text: "The read was off", title: "Your staff's read on him did not hold up" }) : null]))));
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
    else if (tab === "scouting") window.CFP.scouting.render(season, box, H);
    else if (tab === "classes") renderClasses(season, box);
  }

  window.Recruiting = { wordTag, render, openProfile: (s, pid) => openProfile(s, pid), reveal: (pid) => { view.selected = pid; view.reveal = pid; view.sheet = true; view.group = null; view.state = null; }, board: (s, box, helpers) => { H = helpers; renderRecruiting(s, box); } };
})();
