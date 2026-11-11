/* Coach Career on the season page, styled as a game (the Office is web/office.js): the
   Recruiting board (stage tabs, a list, one pane with the Recruit menu), Prospects (the
   class, filtered) and the Prospect Profile; the Scouting tab is web/scouting.js.
   window.Recruiting.render(tab, season, helpers); helpers from season.js: { api, postJSON, toast,
   openModal, closeModal, errText, onChange(tab), play(what) }. Colors come from the site's theme variables,
   so the screens read in the light and the dark theme. */
(function () {
  "use strict";
  // a regular-season week as the real calendar names it: the opening week (a handful of games before Labor Day
  // weekend) is Week 0, so engine week N reads Week N-1 (sim/season.py week_name); the portal's weeks are their own
  const seasonWeek = (w) => `Week ${w - 1}`;
  const { el } = window.CFP;
  const PITCH_NAMES = { proximity: "Close to Home", playing_time: "Playing Time", prestige: "Program Prestige", winning: "Winning Now",
                        nil: "NIL", coach: "The Head Coach", academics: "Academics", pro: "Path to the League",
                        facilities: "Facilities", location: "Location", stability: "Stability", game_day: "Game Day", exposure: "Exposure" };
  const GROUP_NAMES = { athleticism: "Athleticism", size_strength: "Size & Strength", technique: "Technique", football_iq: "Football IQ",
                        potential: "Potential", coachability: "Coachability" };
  // the Prospects table's sorts (prospects._sort_key): a column header's key, and the Sort menu's words
  const PR_SORT_OPTS = [["rank", "National Rank"], ["interest", "Interest in You"], ["name", "Name"], ["pos", "Position"], ["ht", "Height"], ["wt", "Weight"],
    ["stars", "Stars"], ["status", "Status"], ["sc", "Scouted"], ["pot", "Potential"]];
  const PR_SORTS = new Set(PR_SORT_OPTS.map(([v]) => v));
  const SORT_WORD = Object.fromEntries(PR_SORT_OPTS);
  const DESC_FIRST = new Set(["interest", "ht", "wt", "stars", "sc", "pot"]);   // their first click shows the most first (values descending)
  const HEAD_SORT = { rank: "rank", who: "name", pos: "pos", ht: "ht", wt: "wt", stars: "stars", status: "status", int: "interest", sc: "sc", pot: "pot" };
  const STATUS = [["", "Any Status"], ["interested", "Interested in You"], ["open", "Uncommitted"], ["committed", "Committed"], ["signed", "Signed"], ["leaning_fcs", "Leaning FCS"],
                  ["offered", "Offered by You"], ["board", "On Your Board"]];
  const POSITIONS = ["QB", "RB", "WR", "TE", "OT", "IOL", "EDGE", "DL", "LB", "CB", "S", "ATH", "K", "P"];
  const STATES = ["AK", "AL", "AR", "AZ", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "IA", "ID", "IL", "IN", "KS", "KY", "LA", "MA", "MD", "ME",
                  "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI", "SC", "SD",
                  "TN", "TX", "UT", "VA", "VT", "WA", "WI", "WV", "WY"];
  const view = { filters: { q: "", position: "", stars: "", state: "", status: "", sort: "rank", group: "" }, offset: 0, openClass: null, sort: "chance", selected: null, sheet: false, pitch: {}, group: null, state: null,
                // scene: the recruit whose call or visit window is open
                heard: {}, scene: null,
                // the board: the stage tab, the search, the position (group) and state filters (all per career: view.stage.sid), the pane's sub-tab, the inline step, the needs disclosure, a Finish awaiting the re-fetch
                stage: null, search: "", sub: "overview", step: null, needsOpen: false, expectScene: null, reveal: null };
  let H = null;

  // window.CFP.ui (web/ui.js, loaded before this file): the toast stack, the pulse, the fades, a keyed reconcile and the busy state
  const ui = () => window.CFP.ui;

  const stars = (n) => "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
  const height = (inches) => `${Math.floor(inches / 12)}'${inches % 12}"`;
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
  const teamLabel = (slug) => (slug === "FCS" ? "an FCS Program" : teamName(slug));   // the same name in a label or chip (Title Case)
  const loading = (text) => el("p", { class: "muted go-loading", text });
  const WORDS = { commit: "verbally committed to", hard: "is now a hard commit to", flip: "flipped to", decommit: "decommitted from", signed: "signed with", offer: "was offered by",
                  asked_more: "wants more from", not_buying: "isn't buying the pitch from", hung_up: "has an unfinished call from" };
  // events that carry their own sentence (his story's, a twist, a hat ceremony, a commitment going soft)
  const LINE_KINDS = new Set(["bloomed", "pro", "twist", "hat", "softened", "promise_kept", "promise_strained"]);
  const eventWord = (e) => (e.kind === "hung_up" && e.action === "hc_visit" ? "has an unfinished visit from" : WORDS[e.kind] || e.kind);
  const WHY = { message: "Message", call: "Call", hc_visit: "HC Visit", official_visit: "Official Visit", offer: "Offer", raise_nil: "NIL Raised" };
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
    card.append(el("div", { class: "card-bar" }, [el("div", { class: "go-kicker", text: `What Changed · After ${report.week === 0 ? "the Preseason" : report.portal ? `Week ${report.week}` : seasonWeek(report.week)}` })]));
    // the week in a glance: only prospects where something happened to you (your place moved, a
    // decision, an ask), the biggest first, one line each; his list on the card has the rest
    const BIG = new Set(["commit", "flip", "decommit", "signed", "asked_more", "not_buying", "hung_up", "bloomed", "pro", "twist", "hat", "softened", "promise_kept"]);
    const weight = (r) => (r.rank !== r.prev_rank ? 2 : 0) + r.events.filter((e) => BIG.has(e.kind)).length * 3 + (r.moves.some((m) => m.you) ? 1 : 0);
    const rows = report.rows.filter((r) => weight(r) > 0).sort((a, b) => weight(b) - weight(a));
    if (!rows.length) return null;
    card.append(el("ul", { class: "go-news go-report-rows" }, rows.slice(0, 6).map((r) => {
      const bits = [];
      if (r.rank == null) bits.push("Not on his list");
      else if (r.prev_rank != null && r.prev_rank !== r.rank) bits.push(`${r.prev_rank > r.rank ? "Up" : "Down"} to #${r.rank} of ${r.of}${r.rank === 1 ? "" : r.leader ? ` · ${r.leader.name} leads` : ""}`);
      else bits.push(r.rank === 1 ? "You lead" : `#${r.rank} of ${r.of}${r.leader ? ` · ${r.leader.name} leads` : ""}`);
      // his ask from you went up because a rival's NIL beat yours: say so once, naming the rival; another school's ask is not yours
      const seen = new Set();
      for (const e of r.events.filter((e) => BIG.has(e.kind) && (e.kind !== "asked_more" || e.school === s.team))) {
        const bit = e.kind === "asked_more" ? `Wants more NIL from you: ${e.rival_name || "a rival"} offered more`
          : LINE_KINDS.has(e.kind) && e.line ? e.line.replace(/\.$/, "") : `${eventWord(e)} ${e.school_name || ""}`.trim();
        if (seen.has(bit) || seen.size >= 2) continue;
        seen.add(bit);
        bits.push(bit);
        if (e.reason) bits.push(e.reason);
      }
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
    if (r.pro) return "Went Pro in Baseball";
    if (r.quiet) return "Quiet";
    if (r.signed) return r.signed === "FCS" ? "Signed With an FCS Program" : `Signed · ${teamLabel(r.signed)}`;
    if (r.committed) return `${r.hard ? "Hard Commit" : "Verbal Commit"} · ${teamLabel(r.committed)}`;
    if (r.leaning_fcs) return "Leaning FCS";
    return "Uncommitted";
  }

  // ----- the one ladder: your standing with a prospect, read from his list -----------------------------
  // standingOf(b, me) -> { word, text, odds, tone, fill, lo, hi, certainty }. The word is one of six
  // (Yours, Lost, Favorite, In It, Long Shot, Not Offered); the sentence and the odds word go with it.
  // His list (b.list: rank, bar, offered) and your offer decide it; the offer race's place is never used,
  // so the words and the race he draws agree. b.standing's pct/lo/hi only size the bar and the flip odds.
  // In the portal, a school without room is no school for him (b.no_room): the odds say "No Room", whatever his list says.
  function standingOf(b, me) {
    const sd = standingCore(b, me);
    return b.no_room && !(b.signed || b.committed) ? { ...sd, odds: "No Room", tone: "bad" } : sd;
  }
  function standingCore(b, me) {
    const st = b.standing || {};
    const school = b.signed || b.committed;
    if (school === me) return { word: "Yours", text: b.signed ? "Signed with you" : b.hard ? "Hard commit to you" : "Verbal commit to you", tone: "good", fill: 1 };
    if (school && (b.signed || b.hard)) return { word: "Lost", text: `${b.signed ? "Signed" : "Hard commit"} · ${teamLabel(school)}`, odds: b.signed ? "Signed Elsewhere" : "Locked In Elsewhere", tone: "bad", fill: 0 };
    if (school) {
      if (st.pct == null) return { word: "Long Shot", text: `Verbal commit · ${teamLabel(school)}`, odds: "Offer him to try for a flip", tone: "warn", fill: 0 };
      return { word: st.pct >= 0.3 ? "In It" : "Long Shot", text: `Verbal commit · ${teamLabel(school)}`,
               odds: st.hi != null && st.hi < 0.1 ? "A flip looks unlikely" : st.pct >= 0.3 ? "He could still flip to you" : "A flip is a long shot",
               certainty: st.certainty, tone: "warn", fill: st.pct, lo: st.lo, hi: st.hi };
    }
    const rows = (b.list || []).filter((x) => x.bar != null).map((x, i) => ({ ...x, at: x.rank != null ? x.rank : i + 1 }));
    const mine = rows.find((x) => x.you || x.school === me);
    const landing = !!(b.offered && b.offer_landing);   // he reads your offer at the week step: no Favorite before then
    const offered = !!b.offered && !landing;
    const fill = st.pct != null ? st.pct : 0;
    const sent = (text) => ({ word: "Offer Sent", text, odds: "He Reads It This Week", tone: "warn", fill: 0 });
    if (landing && !mine) return sent("Not on his list yet · your offer lands at the week step");
    if (!mine) return offered ? { word: "Long Shot", text: "Outside his top 5", odds: "Long Shot", certainty: st.certainty, tone: "muted", fill, lo: st.lo, hi: st.hi }
      : { word: "Not Offered", text: "Not on his list yet", tone: "muted", fill: 0 };
    const leader = rows.filter((x) => x !== mine).sort((a, c) => a.at - c.at)[0];
    if (landing) return sent(`${!leader || mine.at < leader.at ? "Leading his list" : `${ordinal(mine.at)} on his list`} · your offer lands at the week step`);
    if (!leader || mine.at < leader.at) {
      if (!offered) return { word: "Not Offered", text: "He would pick you today: he has no offer from you", odds: "Offer him", tone: "warn", fill: 0 };
      const clear = !leader || mine.bar - leader.bar >= 0.25;
      return { word: "Favorite", text: "Leading his list, offered", odds: clear ? "Clear Favorite" : "Narrow Favorite", certainty: st.certainty, tone: "good", fill, lo: st.lo, hi: st.hi };
    }
    const where = `${ordinal(mine.at)} on his list`;
    if (!offered) return { word: "Not Offered", text: `${where} · not offered`, odds: "Offer to be in it", tone: "muted", fill: 0 };
    const close = mine.bar >= leader.bar - 0.1;
    const odds = close ? "Close Race" : mine.bar >= 0.15 ? "Behind, in the picture" : "Long Shot";
    return { word: odds === "Long Shot" ? "Long Shot" : "In It", text: `${where} · ${teamLabel(leader.school)} leads`, odds, certainty: st.certainty,
             tone: close ? "warn" : "muted", fill, lo: st.lo, hi: st.hi };
  }
  const standing = standingOf;
  // "Sort: your chance" climbs the ladder: yours, favorite, not offered while leading his list (one offer makes him
  // your favorite), in it, long shot, not offered (behind or off his list), lost; within a rung the fuller bar
  // first, then national rank
  function ladderRung(sd) {
    if (sd.word === "Not Offered") return sd.tone === "warn" ? 2 : 5;
    return { Yours: 0, Favorite: 1, "Offer Sent": 2, "In It": 3, "Long Shot": 4, Lost: 6 }[sd.word] ?? 5;
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
  // his History, one line an entry, newest first: "Week 3 · Message · Playing Time", "Week 4 · Call · Program Prestige · He lit up",
  // "Week 5 · Offer · 120 NIL", "Week 6 · Committed to Georgia". A call's or visit's pitch folds into that call's line.
  const HISTORY_WORDS = { commit: "Committed to", hard: "Hard commit to", flip: "Flipped to", decommit: "Decommitted from", signed: "Signed with", leaning_fcs: "Leaning toward" };
  // as items: { week, text (the line without its week), kind (a contact's or pitch's action, else the log's kind) }
  function historyItems(events, me) {
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
    const lowerName = (t) => { const n = PITCH_NAMES[t] || t; return n === n.toUpperCase() ? n : n.toLowerCase(); };
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
      else if (e.kind === "present") bits = [`Presented ${(e.topics || []).map((t) => lowerName(t)).join(", ")}`, e.hit == null ? "He gave nothing away" : LANDED[e.hit] || `${e.hit} landed`];
      else if (e.kind === "answer" && e.question === "package") bits = [e.answer === "promise" ? `Promised an offer to ${e.about}`      // his Package Deal: about his mate
        : e.answer === "deflect" ? `Sidestepped his question about ${e.about}` : e.offered ? `Told him ${e.about} already has an offer` : `Told him straight about ${e.about}`];
      else if (e.kind === "answer") bits = [e.answer === "promise" ? `Promised him the job${e.about ? ` over ${e.about}` : ""}${e.truthful === false || e.crowded ? " (he did not buy it)" : ""}`
        : e.answer === "deflect" ? `Sidestepped his question about ${e.about}` : `Told him straight about ${e.about}`];
      else if (e.kind === "learned" || (LINE_KINDS.has(e.kind) && e.line)) bits = [e.line];     // what your staff learned; a bloomer's jump; a twist; a hat ceremony
      else if ((e.kind === "signed" || e.kind === "unsigned") && e.line) bits = [e.line];     // a recruit of yours went elsewhere: where, and why not you
      else if (e.kind === "promise_broken") bits = [e.why === "money" && e.line ? e.line : e.why === "package" ? `${e.about} never got the offer you promised` : `He heard you promised the same spot to ${e.about}`];
      else if (e.kind === "leaning_fcs") bits = ["Leaning toward an FCS program"];
      else if (HISTORY_WORDS[e.kind]) bits = [`${HISTORY_WORDS[e.kind]} ${e.school ? teamName(e.school) : "an FCS program"}`];
      else bits = [`${eventWord(e)} ${e.school ? teamName(e.school) : ""}`.trim()];
      return { week: e.portal_week ?? e.week, portal: e.portal_week != null, text: bits.filter(Boolean).join(" · "), kind: e.kind === "contact" || e.kind === "pitch" ? e.action || actionOf.get(i) || "pitch" : e.kind };
    };
    return evs.map((e, i) => (folded.has(i) ? null : line(e, i))).filter(Boolean);
  }
  // the History as text lines ("Week 4 · Call · Program Prestige · He lit up")
  function historyLines(events, me) { return historyItems(events, me).map((x) => [x.portal ? `Week ${x.week}` : seasonWeek(x.week), x.text].filter(Boolean).join(" · ")); }
  // the Office (web/office.js) shares the ladder, the portraits, the week's What Changed card and the event words
  window.CFP.recruiting = { standingOf, byChance, historyLines, avatar, reportCard, eventWord, pitchName: (t) => PITCH_NAMES[t] || t };

  // a topic in a sentence: "playing time", "NIL"
  const topicWord = (t) => (t === "nil" ? "NIL" : (PITCH_NAMES[t] || t).toLowerCase());
  const REACTION_TOAST = { hit: (t) => `He lit up: ${topicWord(t)} matters to him`, polite: () => "He was polite and moved on",
                           quiet: (t) => `He went quiet: he isn't buying ${topicWord(t)} from you`, tired: () => "He is tired of this: the call wore on him",
                           guarded: () => "He gave nothing away" };
  // "guarded": a call that keeps his priority to himself (a Guarded recruit, a Shy one's first call) says nothing of how the pitch landed
  const REACTION_WORDS = { hit: "He lit up", polite: "Polite", quiet: "He went quiet", tired: "He is tired of this", guarded: "He gave nothing away" };
  // your answers to his question about a named player: the button's label, and your line by the question's kind (the same copy as coach_career/scenes.py ANSWER_LABELS and ANSWER_COPY)
  const ANSWERS = ["straight", "promise", "deflect"];
  const HOLLOW_REPLY = "I've heard that one before.";      // his reply to a promise he has heard before (scenes.py REPLY_LINES.hollow)
  const ANSWER_LABELS = { straight: "Tell Him Straight", promise: "Make Him a Promise", deflect: "Sidestep It" };
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
    if (opts.week != null) body.week = opts.week;     // an official visit's home weekend, picked in the Recruit menu
    const names = { message: "Message", call: "Call", hc_visit: "Head Coach Visit", official_visit: "Official Visit Invite", offer: "Offer", pull_offer: "Offer Pulled", raise_nil: "NIL Raised", scout: "Scouting Trip" };
    let r;
    try { r = await H.api(`/api/season/${s.id}/recruit`, H.postJSON(body)); }
    catch (err) {
      H.toast(`Could not do that: ${H.errText(err)}`, 4000);
      return null;
    }
    if (action === "scout") scouted(pid, r);
    if (r.scene) { if (opts.onScene) opts.onScene(r.scene); else if (!opts.silent) H.toast(`${names[action]} open · finish it from his pane`, 3000); }
    else if (r.reaction) {
      // talking money is a promise: say so plainly, over the reaction's toast
      if (r.money_owed) H.toast(`You talked money: put ${r.money_owed.nil} NIL on your offer by ${seasonWeek(r.money_owed.by_week)}.`, 6000);
      else if (!opts.silent) H.toast((REACTION_TOAST[r.reaction.kind] || REACTION_TOAST.polite)(pitch), 4000);
      if (opts.onReaction) opts.onReaction(r.reaction);
    }
    else if (opts.silent) { /* the board says what happened, in its own words */ }
    else if (action === "scout") H.toast("Scouting trip done · his grades are updated", 3000);
    else H.toast(`${names[action]} done · ${r.hours_left} hours left${r.revealed ? ` · he cares about ${PITCH_NAMES[r.revealed].toLowerCase()}` : action === "call" ? " · he kept his cards close" : ""} · it lands at the week step`, 3000);
    return r;
  }
  // a scouting trip landed (here or in the Scouting Center): the lists on screen patch his looks and his read in place
  const scouted = (pid, r) => document.dispatchEvent(new CustomEvent("cfp:scouted", { detail: { pid, looks: r.looks, potential: r.potential || null } }));
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

  // ----- the Office ------------------------------------------------------------------------------

  // the eight grade words, by floor (the server's programs.WORD_FLOORS rides in pv.words; this is the fallback)
  const WORD_FLOORS = [["Elite", 90], ["Excellent", 80], ["Strong", 70], ["Good", 60], ["Solid", 50], ["Fair", 40], ["Thin", 30], ["Weak", 0]];
  const GROUP_ORDER_PRO = ["QB", "RB", "WR", "TE", "OT", "IOL", "EDGE", "DL", "LB", "CB", "S", "K", "P"];
  const METRIC_WORDS = (v, pv) => { const fl = (pv && pv.words && pv.words.length ? pv.words : WORD_FLOORS); return (fl.find(([, f]) => v >= f) || fl[fl.length - 1])[0]; };
  const PROGRAM_METRICS = [["prestige", "Prestige", "History and a decade of results"], ["winning", "Winning", "The last three seasons"],
    ["nil", "NIL", "The collective's tier, set by your AD"], ["market", "Market", "Crowds and TV"], ["conference", "Conference", "Your league's strength"],
    ["coach", "Coach", "Your rating and tenure"], ["pro", "Pro Pipeline", "The last ten drafts, by position"]];

  // your program's living rating (the League's Programs tab, with every program's table under it): the bar holds the kicker
  // and the standing; a hero row with the team's pill, its name and conference and three headline readings (prestige,
  // market, pro pipeline); then two columns, the seven metrics as bars under School Grades and the draft groups as chips
  // under Position Pro Potential; the AD's goal in a footer (renderPrograms)
  const HEADLINE = [["prestige", "Prestige"], ["market", "Market"], ["pro", "Pro Pipeline"]];
  // School Grades in two groups (docs/superpowers/plans/2026-11-11-school-grades-phase-1.md): the rating's own measures and
  // the six from the research (r.grades, fixed for now; null for a program the research has no row for: Not Graded)
  const GRADE_TIPS = {
    academics: "U.S. News rank, and the football team's graduation and progress rates.",
    facilities: "How recently the stadium, the football building and the indoor practice facility were built or renovated.",
    location: "The size of the metro and the winter weather.",
    stability: "How few head coaches the program has had since 2010.",
    game_day: "The home crowd and how full the stadium is.",
    exposure: "TV audiences and the football team's Instagram following.",
  };
  const metricTip = (k) => GRADE_TIPS[k] || ((PROGRAM_METRICS.find(([m]) => m === k) || [])[2] || "");
  const GRADE_GROUPS = [["Football", [["prestige", "Prestige"], ["winning", "Winning"], ["coach", "Coach"], ["stability", "Stability"], ["conference", "Conference"], ["pro", "Pro Pipeline"]]],
    ["Campus", [["academics", "Academics"], ["facilities", "Facilities"], ["location", "Location"], ["game_day", "Game Day"], ["exposure", "Exposure"], ["nil", "NIL"]]]];
  const NEW_GRADES = ["academics", "facilities", "location", "stability", "game_day", "exposure"];
  // a row's value for a measure: the rating's own on the row, a new grade in r.grades; null when not graded
  const gradeOf = (r, k) => (NEW_GRADES.includes(k) ? (r.grades ? r.grades[k] : null) : r[k] || 0);
  // School Grades Phase 3: a grade that moved this offseason by half a point or more: data-moved (the stylesheet draws
  // ▲ or ▼ after the word, so the word's text stays the word) and a title saying how much
  const movedMark = (r, k) => {
    const d = (r.grades_moved || {})[k];
    if (d == null || Math.abs(d) < 0.5) return {};
    return { "data-moved": d > 0 ? "up" : "down", title: `${d > 0 ? "Up" : "Down"} ${Math.round(Math.abs(d))} since last season.` };
  };
  function programCard(pv) {
    const you = pv.you;
    if (!you) return el("div");
    const word = (k) => METRIC_WORDS(you[k] || 0, pv);
    const stat = ([k, label]) => el("div", { class: `go-program-stat ${word(k).toLowerCase()}` }, [
      el("span", { class: "go-program-stat-l", text: label }), el("b", { class: "go-program-stat-v", text: word(k) })]);
    return el("section", { class: "go-card rcp-card lg-card edge go-program", "aria-label": "Your Program" }, [
      el("div", { class: "card-bar go-program-head lg-head" }, [el("span", { class: "go-kicker muted" }, ["Your Program ",
        ui().tip("Prestige and the market move slowly with results; your AD raises NIL after a year that meets his goal.", "Your Program")]),
        el("span", { class: "go-tag", text: you.tier_name, title: "Where your program stands: its name, results, NIL, market, league, coach and pro pipeline, moving slowly with what you do" })]),
      el("div", { class: "go-program-hero" }, [
        el("div", { class: "go-program-who" }, [window.CFP.teamPill ? window.CFP.teamPill(you.team) : null,
          el("div", { class: "go-program-names" }, [el("h2", { class: "rcp-h1 lg-h2", text: you.name || "" }), el("span", { class: "muted go-program-conf", text: ((window.CFP.teamsBySlug || {})[you.team] || {}).conference || "" })])]),
        el("div", { class: "go-program-stats" }, HEADLINE.map(stat))]),
      el("div", { class: "go-program-body" }, [
        el("div", { class: "go-program-col" }, [el("div", { class: "go-kicker muted go-program-h" }, ["School Grades ",
          ui().tip("Your program in twelve measures, each in one of eight words: Elite, Excellent, Strong, Good, Solid, Fair, Thin, Weak. Football's six and NIL move with results; the campus grades come from the record.", "School Grades")]),
          ...GRADE_GROUPS.map(([title, list]) => el("div", { class: "go-program-group" }, [el("div", { class: "go-program-group-h", text: title }),
            el("div", { class: "go-program-bars" }, list.map(([k, label]) => {
              const v = gradeOf(you, k);
              const tags = k === "location" && you.tags ? [you.tags.setting, you.tags.climate, you.tags.region].filter(Boolean) : [];
              return el("div", { class: "go-program-bar", "data-metric": k, title: metricTip(k) }, [
                el("span", { class: "go-program-label", text: label }), el("i", {}, [el("b", { style: `width:${v == null ? 0 : Math.max(2, Math.min(100, v))}%` })]),
                el("span", { class: "go-program-val", text: v == null ? "Not Graded" : METRIC_WORDS(v, pv), ...movedMark(you, k) }),
                tags.length ? el("span", { class: "go-place-tags" }, tags.map((t) => el("span", { class: "go-tag go-place-tag", text: t }))) : null]);
            }))]))]),
        el("div", { class: "go-program-col" }, [el("div", { class: "go-kicker muted go-program-h" }, ["Position Pro Potential ",
          ui().tip("Where your program's last ten drafts came from, by draft position, best first; a position it never sent reads Weak.", "Position Pro Potential")]),
          proGroups(pv, you)])]),
    ]);
  }

  // the draft groups with a grade, best first: a chip "WR Elite" (a group the program never sent reads Weak)
  function proGroups(pv, you) {
    const order = pv.group_order && pv.group_order.length ? pv.group_order : GROUP_ORDER_PRO;
    const pg = you.pro_groups || {};
    const list = order.map((g, i) => ({ g, v: pg[g] || 0, i })).sort((a, b) => b.v - a.v || a.i - b.i);
    return el("div", { class: "go-program-groups", title: "The Pro Pipeline by draft position, best first" },
      list.map((x) => { const w = METRIC_WORDS(x.v, pv); return el("span", { class: `go-tag ${w.toLowerCase()}` }, [el("b", { text: x.g }), " ", el("span", { text: w })]); }));
  }

  // the League's Programs tab: your program's card (with the AD's goal), then every program, open
  async function renderPrograms(s, box) {
    box.innerHTML = "";
    box.append(loading("Loading the programs…"));
    let pv;
    try { pv = await H.api(`/api/season/${s.id}/programs`); }
    catch (err) { box.innerHTML = ""; box.append(el("p", { class: "muted", text: `Could not load the programs: ${H.errText(err)}` })); return; }
    box.innerHTML = "";
    const t = (window.CFP.teamsBySlug || {})[s.team] || {};
    const root = el("div", { class: "lg", style: window.CFP.teamVars(s.team) });
    box.append(root);
    const card = programCard(pv);
    if (s.job) card.append(el("div", { class: `go-job ${s.job.security < 40 ? "bad" : s.job.security < 65 ? "warn" : "good"}` }, [
      el("span", { class: "go-kicker muted", text: "Your AD's Goal" }), el("b", { text: ` ${s.job.goal}` }),
      el("span", { class: "go-tag", text: `${s.job.mood}${s.job.ultimatum ? " · Ultimatum Year" : ""}` })]));
    root.append(card, el("section", { class: "go-card rcp-card lg-card go-programs-card", "aria-label": "Every Program" }, [
      el("div", { class: "card-bar" }, [el("div", { class: "go-kicker muted" }, ["Every Program ", ui().tip("Every FBS program's standing on the same measures, and what its AD expects this season.", "Every Program")])]),
      programsTable(pv)]));
    if (H.carryLine) H.carryLine(s, card);
  }

  function programsTable(pv) {
    const cols = [["prestige", "Prestige"], ["winning", "Winning"], ["nil", "NIL"], ["market", "Market"], ["conference", "Conf"], ["coach", "Coach"], ["pro", "Pro Pipeline"],
      ["academics", "Academics"], ["facilities", "Facilities"], ["location", "Location"], ["stability", "Stability"], ["game_day", "Game Day"], ["exposure", "Exposure"]];
    const t = el("table", { class: "stats go-programs" }, [el("thead", {}, [el("tr", {}, [el("th", { text: "Program" }), el("th", { text: "Standing" }),
      ...cols.map(([k, h]) => el("th", { text: h, title: metricTip(k) })), el("th", { text: "The AD Expects" })])])]);
    const body = el("tbody");
    for (const r of pv.rows) {
      body.append(el("tr", { class: r.team === pv.you.team ? "mine" : "" }, [
        el("td", {}, [window.CFP.teamPill(r.team), ` ${r.name}`]), el("td", {}, [el("span", { class: "go-tag", text: r.tier_name })]),
        ...cols.map(([k]) => { const v = gradeOf(r, k); if (v == null) return el("td", { class: "muted small", text: "Not Graded" }); const w = METRIC_WORDS(v, pv); return el("td", { class: `word ${w.toLowerCase()}`, text: w, ...movedMark(r, k) }); }),
        el("td", { class: "small", text: r.goal })]));
    }
    t.append(body);
    return el("div", { class: "go-scroll" }, [t]);
  }

  // ----- the Recruiting board ----------------------------------------------------------------------

  const ACT_TIPS = { scout: "Send your best evaluator to see him: a look costs scouting points (5 close to home: his state or within 150 miles of campus, 10 in a scout's area, 15 elsewhere; a portal entrant 5; half that when half a look finishes his report), any week, until his report is complete at three looks; a week in a scout's area is half a look, up to two" };
  // looks come in trip units (a Send one, an area week half, a full report three): a count shows its half only when it has one
  const fmtLooks = (n) => (Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(1));

  // ----- what the roster needs, by group: one strip on the board and the class, with a way of counting -----
  const NEED_MODES = [["need", "What's Left", "A healthy 85-man roster's make-up minus the players coming back minus your commits"],
    ["commits", "Committed / Need", "Your commits at each position against the spots this class needs to fill"],
    ["firm", "Hard Commits / Need", "Hard commits (locked in, cannot flip) against the spots to fill"],
    ["board", "On Board / Need", "Uncommitted prospects on your board at each position against the spots to fill"],
    ["offers", "Offers Out / Need", "Your open offers at each position against the spots to fill"],
    ["left", "Only What's Short", "Just the positions still short, by how many"]];
  const GROUP_ORDER = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"];
  // a scouted prospect's grades in one line (his card and the top of his profile)
  const clsWord = (c) => (c && c.endsWith("RS") ? `RS ${c.slice(0, -2)}` : c);   // FRRS -> "RS FR"
  // a scouting word as a colored pill; the class is the word lower-cased ("All-American" -> all-american)
  const wordTag = (word) => el("span", { class: `go-word ${String(word).toLowerCase()}`, text: word });
  // a [low, high] pair of words: one tag when both ends match, else "low to high"
  const wordRange = (r) => (r[0] === r[1] ? [wordTag(r[0])] : [wordTag(r[0]), " to ", wordTag(r[1])]);
  const wordText = (r) => (r[0] === r[1] ? r[0] : `${r[0]} to ${r[1]}`);
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
    wrap.append(el("b", { class: "go-needs-label", text: "Need" }));
    let any = false;
    for (const g of GROUP_ORDER) {
      const r = detail[g];
      if (!r) continue;
      if (mode === "left" && r.need <= 0) continue;
      any = true;
      const short = r.need > 0, covered = mode === "board" || mode === "offers" ? (short && (mode === "board" ? r.board : r.offers) >= r.need) : mode !== "need" && mode !== "left" && !short;
      const b = el("button", { type: "button", class: `go-chip small ${picked === g ? "on" : ""} ${short && !covered ? "short" : "full"}`, "aria-pressed": String(picked === g),
        text: needText(mode, g, r), title: needTitle(g, r, r.need > 0) });
      b.addEventListener("click", () => onPick(picked === g ? null : g));
      wrap.append(b);
    }
    if (!any) wrap.append(el("span", { class: "muted small", text: "Every position is covered." }));
    wrap.append(sel);
    return wrap;
  }
  // ----- the stages: his stage with you decides his tab; a commitment or a signature anywhere ends the race -----
  const COLUMNS = [["cold", "Cold"], ["contact", "In Touch"], ["top", "Top 8"], ["visited", "Visited"], ["committed", "Committed"]];
  const COLUMN_TIPS = { cold: "No contact yet: an offer now counts half", contact: "You have reached out; get into his top 8 for a visit",
    top: "He is seriously considering you: invite him on a visit", visited: "He has been on campus", committed: "His recruitment is decided: committed or signed, to you or elsewhere" };
  const PHONE = "(max-width: 759px)";
  const phone = () => window.matchMedia(PHONE).matches;
  // the tab he sits under
  const columnOf = (b) => (b.committed || b.signed ? "committed" : COLUMN_TIPS[b.stage] ? b.stage : "cold");

  // an official visit's pill: "Visit Wk 5" (the calendar's week, seasonWeek) until he goes, then "Visited". It is tied to the visited school's game that
  // week (visit.game, coach_career/prospects.visit_view): hovering, focusing or tapping the pill shows that game, the
  // week and opponent before it is played and its result after, in the game's result line ("Week 6: L 36–41 vs Ohio
  // State", as the Rivalries card and the Office read a result). No game that week (a bye, a portal campus visit): no tip.
  const visitLabel = (v) => (v.done ? "Visited" : `Visit Wk ${v.week - 1}`);   // the calendar's week (seasonWeek)
  function visitTipText(v, school) {
    const g = v && v.game;
    if (!g || g.week == null || !g.opponent_name) return null;
    const vs = g.venue === "away" ? "at" : "vs";
    if (g.played && g.points_for != null && g.points_against != null)
      return `${school ? `${school}, ` : ""}${seasonWeek(g.week)}: ${g.won ? "W" : "L"} ${g.points_for}–${g.points_against}${g.overtime ? " OT" : ""} ${vs} ${g.opponent_name}`;
    return `His official visit${school ? ` to ${school}` : ""} is ${seasonWeek(g.week)}, ${vs} ${g.opponent_name}.`;
  }
  // the pill, wrapped as a [data-gtip] cell (the grade tooltips' document listeners show it) when there is a game to
  // show; `school` names another school's visit (null: yours)
  function visitPill(pill, v, pid, slug, school, attrs = {}) {
    const text = visitTipText(v, school);
    if (!text) { for (const [k, val] of Object.entries(attrs)) pill.setAttribute(k, val); return pill; }
    const tipId = `tip-visit-${pid}-${slug}`;
    return el("span", { class: "go-tip go-visit-tip", "data-gtip": "", tabindex: "0", "aria-describedby": tipId, ...attrs }, [pill,
      el("span", { class: "go-tip-box", role: "tooltip", id: tipId, text })]);
  }
  // what stands out about him, as small tags: the staff's finds, then today's need, offer, mood and commitment
  const genBadge = () => el("span", { class: "go-badge generational", text: "Generational", title: "Your staff's find after three looks: a once-in-a-generation talent every program in the country wants" });
  // "OC likes him": with his report complete, the read says he would start on your returning roster; the tag's title carries the sentence
  const likesText = (l) => `${l.who} Likes Him`;
  const likesLine = (l) => (l.name ? `Your ${l.who}, ${l.name}, thinks he starts for you next year.` : `${l.text}.`);
  // why he cooled on you (the payload's cooled_why): the tag's title and the Official Visit's reason
  const COOLED_TITLE = {
    lowball: "He read your offer as a lowball: contacts count half and he will not visit until you raise it to what he wants",
    promise: "He doubts a promise you made: contacts count half and he will not visit until he cools off",
    quiet: "He felt ignored: call or visit to warm him back up. Contacts count half and he will not visit until then",
  };
  // his story in a sentence: what it means for recruiting him (the chip's title, and a line under the Profile's rows)
  // his story in plain words; `detail` is what the story names (the legacy school, the hero's state, the mate)
  const STORY_TIPS = {
    legacy: (d, yours) => yours ? `His family played at ${d || "your school"}, so you start with a head start on everyone else. If you lowball him or break a promise, it stings twice as much.`
      : `His family played at ${d || "one school"}, so ${d ? "they start" : "it starts"} with a head start on everyone else. If ${d ? "they lowball" : "it lowballs"} him or ${d ? "break" : "breaks"} a promise, it stings twice as much.`,
    hero: () => "His home state wants him to stay. Schools in his state have the edge, and pitches from out of state land softer unless they sell playing time or NIL.",
    package: () => "He comes with a teammate. He only commits where his teammate has an offer too, and they commit together.",
    two_sport: () => "He could sign a pro baseball contract instead. Playing time pitches and NIL over his ask make that less likely.",
    comeback: () => "He's coming back from an injury, so his rating sells him short. Schools that reached out early keep an edge with him.",
    bloomer: () => "He's still growing into his game. His rating will jump during the season.",
  };
  const storyTip = (tr) => (STORY_TIPS[tr.story_key] ? STORY_TIPS[tr.story_key](tr.story_detail, tr.story_yours) : null);
  const COOLED_WHY = { lowball: "Cooled: raise your offer first", promise: "Cooled: give him time", quiet: "Cooled: he wants to hear from you", game: "Cooled: he saw you lose" };
  // his commit style in a sentence: what it means for recruiting him (the chip's title, and a line under the Profile's rows)
  const STYLE_TIPS = {
    early_bird: "He wants to commit early: his odds jump in Weeks 4 to 8, and he starts close to a hard commit.",
    signing_day: "He will not commit before signing day: then he signs with the school leading his list.",
    hat: "He will name three finalists and a date two weeks out: only they can win.",
    quiet: "He commits without telling anyone: other schools only see that he went quiet.",
    needs_attention: "He needs to hear from you every week, even once committed: three quiet weeks and he can flip.",
  };
  const TWIST_TIP = "What happened to him this season, and how long it lasts.";
  const weeksLeft = (n) => (n > 1 ? `${n} Weeks Left` : n === 1 ? "This Week" : null);
  function badges(b, me) {
    const out = el("div", { class: "go-tags go-badges" });
    if (b.generational) out.append(genBadge());
    if (b.find === "gem") out.append(el("span", { class: "go-badge gem", text: "Gem", title: "Your staff's find: even the low end of his potential read beats all but a few prospects at his star level, and few programs rate him that high" }));
    if (b.find === "bust") out.append(el("span", { class: "go-badge bust", text: "Bust Risk", title: "Your staff's find: his ranking is high but even the top of their read sits under nearly every prospect at his star level" }));
    if (b.need != null && !b.signed && b.committed !== me) out.append(el("span", { class: `go-tag ${b.need > 0 ? "good" : "muted"}`, text: b.need > 0 ? `Need ${b.need}` : "Full",
      title: b.need > 0 ? `Your roster needs ${b.need} at his position this class` : "Your roster is covered at his position this class" }));
    if (b.offered && !b.signed && b.committed !== me) out.append(el("span", { class: "go-tag good", text: b.nil ? `Offered · ${b.nil} NIL` : "Offered" }));
    if (b.money_owed) out.append(el("span", { class: "go-tag warn go-money-owed", "data-key": "money-owed", text: `Money Owed · ${b.money_owed.nil} NIL by ${seasonWeek(b.money_owed.by_week)}`,
      title: `You talked money with him: put at least ${b.money_owed.nil} NIL on your offer by ${seasonWeek(b.money_owed.by_week)}, or he cools on you. Take him off your board to walk away.` }));
    if (b.cooled) out.append(el("span", { class: "go-tag bad", text: "Cooled", title: COOLED_TITLE[b.cooled_why] || COOLED_TITLE.lowball }));
    if (b.pestering) out.append(el("span", { class: "go-tag bad", text: "Tuning You Out", title: "He is not considering you; more contact pushes him away" }));
    // the portal: he picks only among offering schools with room, so a lead without room is no lead
    if (b.no_room) out.append(el("span", { class: "go-tag bad", "data-key": "no-room", text: b.no_room.label, title: b.no_room.tip }));
    if (b.committed === me && !b.signed) out.append(b.hard ? el("span", { class: "go-tag good", text: "Hard Commit", title: "Locked in: he cannot flip and his offer stands until he signs" })
      : el("span", { class: `go-tag ${b.firmness >= 70 ? "good" : b.firmness < 40 ? "warn" : ""}`, text: `Verbal · ${b.firmness}`, title: "A verbal commit (0-100): he warms to you on his own each week, faster with a message, call or visit; rivals offering more playing time cool him. At 90 he is a hard commit and cannot flip." }));
    return out.childElementCount ? out : null;
  }

  // ----- his profile, one view in three places: the board's pane, the Prospect Profile popup and the Scouting Center ---------
  // b: his board line (prospects.board_row; a profile carries it as `row`); p: his profile (prospects.profile), null while it
  // loads. The pieces are web/profileview.js's (window.CFP.pv); these fill them from the board's data.
  const PV = () => window.CFP.pv;
  const TONES = { good: "good", warn: "warn", bad: "bad" };
  const attr = (cond, attrs) => (cond ? attrs : {});
  // the header: his status chip, his name (nameNode: the pane's button or the popup's heading), stars, Pos · Archetype |
  // Height | Weight, Hometown · Class of 2027 (the portal: From School); Nat. Rank and Pos. Rank in one strip (the portal:
  // Portal Rank, Pos. Rank, Class); Your Chance in words, its bar only once you have a chance to measure (an offer, or his
  // commitment elsewhere). opts.stats / opts.badge replace those (the Scouting Center: Team Need, Potential); opts.chip
  // replaces the status chip; opts.back: the phone sheet's Back.
  function heroOf(b, me, opts = {}) {
    const portal = !!b.portal;
    const chip = opts.chip || chipOf(b, me, portal);
    const tag = el("span", { class: `go-chip pv-tag ${chip.tone || ""}`.trim(), "data-key": "chip", text: chip.text });
    const sd = standingOf(b, me);
    const pos = b.display_pos || b.position;
    const measured = sd.word !== "Not Offered" && sd.word !== "Lost";
    const badge = opts.badge || { kicker: "Your Chance", value: sd.odds || sd.word, tone: TONES[sd.tone] || "", fill: measured ? sd.fill || 0 : null };
    const stats = opts.stats || [
      portal ? { key: "portal", label: "Portal Rank", value: b.portal_rank ? `#${b.portal_rank}` : "—" } : { key: "nat", label: "Nat. Rank", value: b.national_rank ? `#${b.national_rank}` : "—" },
      { key: "pos", label: "Pos. Rank", value: b.pos_rank ? `#${b.pos_rank}` : "—" },
      portal ? { key: "class", label: "Class", value: clsWord(b.cls) || "—" } : null];
    const where = portal ? `From ${b.from_name}` : `${place(b.hometown)}${b.class_of ? ` · Class of ${b.class_of}` : ""}`;
    return PV().hero({ avatar: avatar(b.id, "lg"), tag, nameNode: opts.nameNode, back: opts.back, stars: b.stars ? stars(b.stars) : null, starsLabel: b.stars ? `${b.stars} stars` : null,
      pos, arch: opts.arch !== undefined ? opts.arch : b.archetype || null, height: b.height_display, weight: b.weight_display, place: where, stats, badge });
  }
  // a label and its value as one row (the snapshot's His Ask, the Background card)
  const kvRow = (key, label, value, hint) => el("div", { class: "pv-row", "data-key": key }, [el("span", { class: "pv-row-k", text: label }),
    el("span", { class: "pv-row-v" }, [el("b", { class: value ? "" : "muted", text: value || PV().NOT_KNOWN }), hint ? el("span", { class: "pv-hint muted", text: hint }) : null])]);
  const compText = (c) => `${c.name}, ${c.school} (${c.position}${c.overall ? `, ${c.overall} OVR` : ""})`;
  // the comp, once: ours once his report is complete; before that, what the third look brings
  function compLine(p, looks) {
    if (p && p.our_comp) return el("p", { class: "pv-foot go-comp", "data-key": "comp" }, [el("b", { text: "Comp: " }), compText(p.our_comp)]);
    return el("p", { class: "pv-foot muted go-comp", "data-key": "comp", text: looks >= 3 ? "Comp: nobody close enough among the starters." : "Comp after his third look." });
  }

  // ----- Overview: the Recruiting Battle, the Recruit Snapshot, the Scout's Summary -----
  // a school's place in his race, in words: the leader is the Favorite; then Contender, In the Mix, Long Shot; a committed
  // recruit's other schools read their chance to flip him (p.flip), never a number
  function battleWord(x, i, rows, b, flip) {
    const holder = b.signed || b.committed;
    if (holder) return x.school === holder ? (b.signed ? "Signed" : b.hard ? "Hard Commit" : "Committed") : b.signed ? "Missed Out" : `Flip: ${flip[x.school] || "None"}`;
    if (x.offered === false) return "No Offer";
    if (i === 0) return "Favorite";
    return x.bar >= rows[0].bar - 0.1 ? "Contender" : x.bar >= 0.15 ? "In the Mix" : "Long Shot";
  }
  const ARROWS = (x) => (x.new ? ["★", "New on his list"] : x.move > 0 ? ["↑", `Up ${x.move}`] : x.move < 0 ? ["↓", `Down ${-x.move}`] : ["—", "No change"]);
  // a committed or signed recruit with his profile in hand: the banner, then every other school on his list with its chance
  // to flip him in words (p.flip), your own row marked, sorted by that chance; a commit to you nobody is close to says so in a line
  function rivalsCard(b, me, p) {
    const holder = b.signed || b.committed;
    const flip = Object.fromEntries((((p.flip || {}).rivals) || []).map((r) => [r.school, r.word]));
    const listed = (p.public.schools || []).filter((x) => x.school !== holder).sort((a, c) => (c.pct ?? -1) - (a.pct ?? -1));
    const committed = !b.signed;
    const quiet = committed && holder === me && listed.every((x) => (flip[x.school] || "None") === "None");
    const title = b.signed ? "His Final List" : holder === me ? "Who Else Is Calling" : "His Chance to Flip to Each";
    const parts = [commitBanner(b, me, p)];
    if (quiet) parts.push(el("p", { class: "muted go-nobody-close", "data-key": "quiet", text: "Nobody is close to pulling him away." }));
    else if (!listed.length) parts.push(el("p", { class: "muted pv-battle-empty", "data-key": "empty", text: "No other school recruited him." }));
    else parts.push(el("div", { class: "pv-battle pv-rivals", role: "list", "data-key": "rivals" }, listed.map((x) => {
      const you = x.school === me;
      const word = b.signed ? "" : x.pct == null ? "No Offer" : flip[x.school] || "None";
      return el("div", { class: `pv-battle-row pv-rival ${you ? "you" : ""}`.trim(), role: "listitem", "data-key": x.school, "data-school": x.school }, [
        window.CFP.teamPill(x.school), el("span", { class: "pv-battle-name" }, [el("b", { text: x.name }), you ? el("span", { class: "muted small", text: " (Your School)" }) : null]),
        el("span", { class: "pv-battle-w", text: word }),
        el("span", { class: "muted small pv-battle-marks" }, [x.offered ? "Offer" : "", x.offered && x.visit ? " · " : "",
          x.visit ? visitPill(el("span", { class: "pv-visit", text: visitLabel(x.visit) }), x.visit, b.id, x.school, you ? null : x.name) : ""])]);
    })));
    return PV().card(title, parts, { key: "battle", cls: "pv-battle-card" });
  }
  function battleCard(b, me, p, opts = {}) {
    if ((b.signed || b.committed) && p && p.public && !opts.arrows) return rivalsCard(b, me, p);
    const rows = (b.list || []).filter((x) => x.bar != null);
    const flip = Object.fromEntries((((p && p.flip) || {}).rivals || []).map((r) => [r.school, r.word]));
    const holder = b.signed || b.committed;
    const parts = [];
    if (holder) parts.push(commitBanner(b, me, p));
    if (!rows.length) parts.push(el("p", { class: "muted pv-battle-empty", text: holder ? "His race is over." : "No school is on his list yet." }));
    else parts.push(el("div", { class: "pv-battle", role: "list", "aria-label": "His list: each school's pull", "data-key": "battle" }, rows.map((x, i) => {
      const you = x.you || x.school === me;
      const word = battleWord(x, i, rows, b, flip);
      const [arrow, moved] = ARROWS(x);
      return el("div", { class: `pv-battle-row ${you ? "you" : ""}`.trim(), role: "listitem", "data-key": x.school, "data-school": x.school,
        title: `${x.name}${x.offered === false ? " · no offer" : ""}${opts.arrows ? "" : ` · ${moved} since last week`}${x.why ? ` · ${WHY[x.why] || x.why}` : ""}` }, [
        el("b", { class: "pv-battle-n", text: String(x.rank != null ? x.rank : i + 1) }), window.CFP.teamPill(x.school),
        el("span", { class: "pv-battle-name" }, [el("b", { text: x.name }), you ? el("span", { class: "muted small", text: " (Your School)" }) : null]),
        opts.arrows ? null : PV().bar({ lo: 0, hi: 0, mid: Math.round(100 * Math.max(0, Math.min(1, x.bar))), tone: you ? "good" : "blue", words: [word, word] }),
        el("span", { class: `pv-battle-w ${word === "Favorite" || word === "Committed" || word === "Signed" || word === "Hard Commit" ? "good" : ""}`.trim() },
          [word, opts.arrows ? el("span", { class: `pv-arrow ${x.move > 0 || x.new ? "up" : x.move < 0 ? "down" : ""}`.trim(), title: moved, "aria-label": moved, text: ` (${arrow})` }) : null])]);
    })));
    return PV().card(opts.title || "Recruiting Battle", parts, { key: opts.key || "battle", cls: "pv-battle-card", wide: opts.wide });
  }
  // a committed or signed recruit: the school in its colors and his chance to flip, in words
  function commitBanner(b, me, p) {
    const holder = b.signed || b.committed;
    const t = window.CFP.teamsBySlug[holder] || {};
    const col = t.colors || {};
    const bg = holder === "FCS" ? "var(--panel)" : col.primary || "var(--panel)";
    const flip = (p && p.flip) || { word: "None", rivals: [] };
    const leader = flip.rivals.length ? flip.rivals[0].name : null;
    const sub = b.pro ? "He took the baseball money." : b.signed ? "Signed: his recruitment is over."
      : b.hard ? "Hard commit: he is not taking calls."
      : flip.word === "None" || !leader ? "Solid: nobody is close to pulling him away."
      : flip.word === "Slim" ? `Hearing out ${leader}: a slim chance he flips before signing day.`
      : flip.word === "Real" ? `${leader} is working him hard: a real chance he flips.`
      : `${leader} is close to flipping him.`;
    return el("div", { class: "go-commit rc-status", "data-key": "commit", style: holder === "FCS" ? "" : `background:${bg};color:${inkOn(col.primary)};border-color:${col.secondary || bg}` }, [
      el("div", { class: "go-display m", text: `${b.signed ? "Signed With" : b.hard ? "Hard Commit to" : "Verbal Commit to"} ${teamLabel(holder)}` }), el("div", { class: "small", text: sub })]);
  }
  function snapshotCard(s, b, me) {
    const sd = standingOf(b, me);
    const rowsOf = (b.list || []).filter((x) => x.bar != null);
    const mineRow = rowsOf.find((x) => x.you || x.school === me);
    const at = mineRow ? (mineRow.rank != null ? mineRow.rank : rowsOf.indexOf(mineRow) + 1) : null;
    const ask = askWord(b);
    const looks = Math.min(3, b.looks || 0);
    const cell = (k, label, val) => el("div", { class: "go-stat pv-kv", "data-key": `cell-${k}`, "data-cell": k }, [el("div", { class: "go-kicker muted", text: label }), el("div", { class: "go-stat-val", text: val })]);
    const cells = el("div", { class: "go-strip pv-kv3", "data-key": "cells" }, [
      cell("offer", "Your Offer", b.offered ? `${b.nil || 0} NIL` : "None Yet"),
      cell("list", "His List", at ? `#${at} of ${Math.max(b.schools || 0, rowsOf.length)}` : b.offered && !(b.signed || b.committed) ? "Outside His Top 5" : "Not on It"),
      cell("looks", "Scouted", looks ? `${fmtLooks(looks)} of 3 Looks` : "Not Yet")]);
    // his priorities: a known one shows your program's case on it as a bar and a word; one not known yet says so
    const known = b.priorities_known || [];
    const ORD = ["First", "Second", "Third"];
    const pri = el("div", { class: "pv-pri", "data-key": "priorities" }, [0, 1, 2].map((i) => {
      const t = known[i];
      if (!t) return el("div", { class: "pv-pri-row", "data-key": `pri-${i}` }, [el("span", { class: "pv-pri-k", text: `${ORD[i]} Priority` }),
        el("span", { class: "pv-pri-v" }, [el("b", { class: "muted", text: PV().NOT_KNOWN }), el("span", { class: "pv-hint muted", text: "A call may reveal it." })])]);
      const sv = b.strength ? b.strength[t] : null, w = caseWord(b, t);
      return el("div", { class: "pv-pri-row", "data-key": `pri-${i}`, ...attr(w, { title: `Your program's case on ${PITCH_NAMES[t] || t}: ${w}` }) }, [el("span", { class: "pv-pri-k", text: PITCH_NAMES[t] || t }),
        PV().bar(sv == null ? null : { lo: 0, hi: 0, mid: Math.round(100 * Math.max(0, Math.min(1, sv))), tone: w === "Strong" ? "good" : w === "Weak" ? "bad" : "warn", words: [w, w] }),
        el("span", { class: "muted small pv-pri-w", text: w || "" })]);
    }));
    const tags = tagList(s, b, me);
    return PV().card("Recruit Snapshot", [cells,
      el("div", { class: `go-standing-text ${sd.tone}`, "data-key": "standing", text: sd.text }),
      b.no_room ? el("p", { class: "go-warn small rc-no-room", role: "note", "data-key": "no-room", text: b.no_room.tip }) : null,
      sd.odds ? el("div", { class: "muted small", "data-key": "odds", text: `${sd.odds}${sd.certainty ? ` · ${sd.certainty}${sd.certainty !== "Solid Read" ? ": the range narrows as signing day nears" : ""}` : ""}` }) : null,
      el("h4", { class: "pv-kick", "data-key": "pri-kick", text: "Priorities" }), pri,
      kvRow("ask", "His Ask", ask ? `He Wants ${ask.replace(/^about/, "About")}` : null),
      tagGroups(tags)], { key: "snapshot", cls: "pv-snapshot" });
  }
  function overviewCards(s, b, me, p) {
    const summary = p ? PV().summaryCard(p.report) : PV().card("Scout's Summary", [el("p", { class: "muted go-loading", text: "Loading his report…" })], { wide: true, key: "summary" });
    return PV().grid([battleCard(b, me, p), snapshotCard(s, b, me), summary]);
  }
  // what stands out about him, as small tags: the staff's finds, need, offer, mood, commitment, his known priorities and
  // this week's cue, his known traits, a coordinator's word, his visit and (a transfer) his role
  function cueOf(s, b) {
    const hw = view.heard[`${s.id}:${b.id}`];
    const c = b.scene ? { topics: b.scene.cue ? b.scene.cue.topics : [], action: b.scene.action } : hw && hw.week === s.current_week ? hw : { topics: [] };
    return { topics: c.topics, title: cueTitle(c.action) };
  }
  // the tags in three labeled rows: Status (need, offer, mood, commitment), His Topics (with a key to ★ and ☆) and Who He
  // Is (personality, who decides, his story, a coordinator's word, his visit); an empty row is left off
  const TAG_GROUPS = [["status", "Status"], ["topics", "His Topics"], ["who", "Who He Is"]];
  function tagGroups(tags) {
    const rows = TAG_GROUPS.map(([g, label]) => {
      const mine = tags.filter((n) => n.dataset.group === g);
      if (!mine.length) return null;
      const syms = [["★", "★ He told you he cares"], ["☆", "☆ He hinted at it this week"]].filter(([c]) => mine.some((n) => n.textContent.startsWith(c)));
      const key = g === "topics" && syms.length ? el("div", { class: "muted small pv-tag-key", "data-key": "tag-key", text: syms.map(([, w]) => w).join(" · ") }) : null;
      return el("div", { class: "pv-tag-group", "data-key": `tags-${g}` }, [el("span", { class: "pv-tag-label", text: label }),
        el("div", { class: "go-tags go-badges" }, mine), key]);
    }).filter(Boolean);
    return el("div", { class: "pv-tag-groups", "data-key": "tags", ...attr(!rows.length, { hidden: "" }) }, rows);
  }
  function tagList(s, b, me) {
    const out = [...(badges(b, me) || { children: [] }).children];
    for (const n of out) n.dataset.group = "status";
    // his topics, one chip each (the player's report: the row was confusing, a topic twice with opposite signals): ★ he
    // told you he cares, ☆ he hinted at it this week, or what he said when you pitched it (a Weak Case or Not His Thing
    // stands in for the star: the last word wins)
    const cue = cueOf(s, b), known = b.priorities_known || [];
    const marked = Object.keys(PITCH_NAMES).filter((t) => { const m = markOf(b, t); return m && (m.mark === "weak" || m.mark === "not_his"); });
    // in the order you learned them: what he told you, then what he said to a pitch, then this week's hints as he gave them
    const order = [...new Set([...known, ...marked, ...cue.topics])].filter((t) => PITCH_NAMES[t]);
    for (const t of order) {
      const m = markOf(b, t), bad = m && (m.mark === "weak" || m.mark === "not_his") ? m : null;
      const k = known.includes(t), hint = !k && cue.topics.includes(t);
      if (bad && !(k && bad.mark === "not_his")) {
        out.push(el("span", { class: `go-tag go-mark ${MARKS[bad.mark][1]}`, "data-key": `mark:${t}`, "data-group": "topics",
          text: `${k ? "★ " : ""}${PITCH_NAMES[t]} · ${MARKS[bad.mark][0]}`, title: markWhy(bad) }));
      } else if (k) {
        out.push(el("span", { class: "go-tag", "data-key": `pri:${t}`, "data-group": "topics", text: `★ ${PITCH_NAMES[t]}`, title: "He told you he cares about this." }));
      } else if (hint) {
        out.push(el("span", { class: "go-tag cue", "data-key": `pri:${t}`, "data-group": "topics", text: `☆ ${PITCH_NAMES[t] || t}`, title: cue.title }));
      }
    }
    const tr = b.traits || {};
    if (tr.personality) out.push(el("span", { class: "go-tag", "data-key": "trait:personality", text: tr.personality, title: "His personality: how he sounds on a call and how he reacts to you" }));
    if (tr.decider) out.push(el("span", { class: "go-tag", "data-key": "trait:decider", text: `Decides: ${tr.decider}`, title: "Who makes the final call on where he goes" }));
    if (tr.story_key) out.push(el("span", { class: `go-tag ${tr.story_key === "two_sport" && /High$/.test(tr.story_detail || "") ? "warn" : ""}`.trim(), "data-key": "trait:story",
      text: tr.story_detail ? `${tr.story} · ${tr.story_detail}` : tr.story, title: storyTip(tr) || "His story" }));
    if (tr.style_key) out.push(el("span", { class: "go-tag", "data-key": "trait:style", text: tr.commit_style, title: STYLE_TIPS[tr.style_key] || "How he commits" }));
    if (b.twist) out.push(el("span", { class: "go-tag warn", "data-key": "twist", text: b.twist.label, title: b.twist.line || TWIST_TIP }));
    if (b.likes) out.push(el("span", { class: "go-tag good go-likes", "data-key": "likes", text: likesText(b.likes), title: likesLine(b.likes) }));
    if (b.visit) out.push(visitPill(el("span", { class: "go-tag", text: visitLabel(b.visit) }), b.visit, b.id, me, null, { "data-key": "visit" }));
    if (b.portal && b.role) out.push(el("span", { class: `go-tag ${b.role === "Would Start" ? "good" : b.role === "Next in Line" ? "warn" : "muted"}`, "data-key": "role", text: b.role, title: "Where he would sit on your depth chart next season" }));
    for (const n of out) { if (!n.dataset.key) n.dataset.key = tagKey(n.textContent); if (!n.dataset.group) n.dataset.group = "who"; }
    return out;
  }
  // a tag's identity for a keyed patch: the kind, so a changed number ("Offered · 150 NIL") patches in place
  function tagKey(text) {
    const t = text.trim();
    if (/^(Offered)/.test(t)) return "offered";
    if (/^(Need \d+|Full)$/.test(t)) return "need";
    if (/^(Verbal|Hard Commit)/.test(t)) return "commit";
    return t;
  }

  // ----- Scouting: the Scouting Report and Attributes side by side, Looks & Uncertainty across under them -----
  // opts.send: a Send button for the report card's foot; opts.link: "Reports on the Scouting Tab"; opts.reads: report lines
  // (the Scouting Center's this and last week); opts.extra: more nodes for the Looks card (the popup's staff button)
  // the report's ⓘ: what the grades are (final once his report is complete), and that a grade shows what it looks like
  function scoutTip(looks) {
    const hover = "Tap or hover a grade to see what it looks like in ratings.", trips = "A trip is one look; a week in a scout's area is half a look, up to two.";
    if (looks >= 3) return `${fmtLooks(looks)} of 3 looks: his report is complete: these are your staff's final grades. ${hover} A read can still be wrong; the truth shows once he is on your roster. ${trips}`;
    return `${fmtLooks(looks)} of 3 looks${3 - looks <= 1 ? ": one trip finishes his report" : ""}. ${hover} Ranges narrow with every look, but a read can be wrong; the truth shows once he is on your roster. ${trips}`;
  }
  function looksLine(looks) {
    if (looks >= 3) return null;
    const left = 3 - looks;
    return el("p", { class: "muted small pv-looks-line", "data-key": "looks-line", text: looks <= 0 ? "No look yet: send a scout, or put a staff member on his area."
      : left <= 1 ? "One more look finishes his report." : `${fmtLooks(left)} more looks finish his report.` });
  }
  function scoutCards(s, b, p, opts = {}) {
    const looks = Math.min(3, p && p.looks != null ? p.looks : b.looks || 0);
    const rep = p ? p.report : null;
    const tips = (node) => { if (p && p.our_grades && p.grade_details) gradeTips(node, b.id, p.our_grades, p.grade_details); };
    const potTone = (rep && rep.potential_tone) || "good";
    const report = PV().reportCard(rep, { looks, tip: scoutTip(looks), foot: p && !p.ratings ? compLine(p, looks) : null, extra: opts.send ? [el("div", { class: "pv-card-acts", "data-key": "send" }, [].concat(opts.send))] : null, potentialTone: potTone });
    tips(report);
    const attrs = PV().attributesCard(rep, { tips });
    return [report, attrs, looksCard(s, b, p, looks, opts)];
  }
  function looksCard(s, b, p, looks, opts = {}) {
    const likes = (p && p.likes) || b.likes;
    const flags = [...new Set([...(b.generational || (p && p.public.generational) ? ["generational"] : []), ...(b.find ? [b.find] : p && p.public.find ? [p.public.find] : [])])];
    const extra = [looksLine(looks)].filter(Boolean);
    if (flags.length || likes) extra.push(el("div", { class: "go-tags pv-flags", "data-key": "flags" }, [...flags.map((f) => f === "generational" ? genBadge() : badges({ find: f }, null).firstChild), likes ? el("span", { class: "go-tag good go-likes", text: likesText(likes), title: likesLine(likes) }) : null]));
    if (!flags.length && !likes) extra.push(el("p", { class: "muted small sc-no-flags", "data-key": "no-flags", text: "No flags on him: your staff flags gems, bust risks and generational talents once his report is complete." }));
    if (opts.reads) extra.push(...[].concat(opts.reads));
    if (opts.link) extra.push(el("div", { class: "go-scout-foot", "data-key": "foot" }, [el("button", { type: "button", class: "go-link sc-reports-link", text: "Reports on the Scouting Tab",
      onclick: () => { if (window.CFP.scouting) window.CFP.scouting.want("reports"); H.onChange("scouting"); } })]));
    if (opts.extra) extra.push(...[].concat(opts.extra).filter(Boolean));
    return PV().uncertaintyCard(p ? p.report : null, extra);
  }

  // ----- Profile: his traits (Not Known Yet with how each shows) and the background, with the comp once complete -----
  function profileCards(s, b, me, p) {
    const tr = (p && p.traits) || b.traits || {};
    // what happened to him this season (his twist): a row under the traits, its weeks left beside it and its line under
    const twist = (p && p.twist) || b.twist;
    const happened = twist ? el("div", { class: "pv-row go-twist", "data-key": `twist:${twist.key}:${twist.weeks_left}` }, [el("span", { class: "pv-row-k go-trait-label", text: "What Happened" }),
      el("span", { class: "pv-row-v" }, [el("span", {}, [el("b", { class: "go-twist-val", text: twist.label }),
        weeksLeft(twist.weeks_left) ? el("span", { class: "go-trait-more muted small", text: ` · ${weeksLeft(twist.weeks_left)}` }) : null]),
        twist.line ? el("span", { class: "pv-hint muted go-twist-line", text: twist.line }) : null])]) : null;
    const notes = {};
    if (storyTip(tr)) notes.story = storyTip(tr);
    if (tr.style_key && STYLE_TIPS[tr.style_key]) notes.commit_style = STYLE_TIPS[tr.style_key];
    const traits = PV().traitsCard(tr, (p && p.trait_hints) || {}, { pitchNames: PITCH_NAMES, priorities: b.priorities_known, caseWord: (t) => caseWord(b, t), notes, extra: happened ? [happened] : null });
    if (!p) return PV().grid([traits, PV().card("Background", [el("p", { class: "muted go-loading", text: "Loading his profile…" })], { key: "background" })]);
    const pub = p.public;
    const looks = Math.min(3, p.looks || 0);
    const st = pub.hometown.state === "DC" ? "D.C." : pub.hometown.state;
    const bg = el("div", { class: "pv-rows" }, [
      kvRow("school", "High School", pub.high_school),
      kvRow("type", "Archetype", pub.archetype),
      kvRow("ranks", "Rankings", pub.portal ? null : `#${pub.national_rank} Overall · #${pub.pos_rank} ${pub.display_pos} · #${pub.state_rank} in ${st}`),
      pub.composite != null ? kvRow("composite", "Composite", pub.composite.toFixed(4)) : null,
      kvRow("status", "Status", status(pub)),
      p.likes ? el("div", { class: "pv-row", "data-key": "likes" }, [el("span", { class: "pv-row-k", text: "Your Staff" }),
        el("span", { class: "pv-row-v" }, [el("span", { class: "go-tag good go-likes", text: likesText(p.likes), title: likesLine(p.likes) })])]) : null,
      kvRow("comp", "Comp", p.our_comp ? compText(p.our_comp) : looks >= 3 ? "Nobody Close Enough" : null, p.our_comp || looks >= 3 ? null : "His third look brings it.")]);
    return PV().grid([traits, PV().card("Background", [bg], { key: "background", cls: "pv-background" })]);
  }

  // ----- History: the Recruiting Timeline, Recruiting Notes from what you know, Recent Interest Changes -----
  const KIND_CHIP = { message: "Message", call: "Call", hc_visit: "Visit", official_visit: "Visit", pitch: "Pitch", offer: "Offer", raise_nil: "NIL", pull_offer: "Offer",
    learned: "Scout", present: "Call", answer: "Call", hung_up: "Call", asked_more: "NIL", not_buying: "Pitch", pester: "Contact", commit: "Commit", hard: "Commit",
    flip: "Commit", decommit: "Commit", signed: "Signed", leaning_fcs: "Commit", bloomed: "News", pro: "News", promise_broken: "Promise", promise_kept: "Promise" };
  const KIND_ICON = { message: "✉", call: "☎", hc_visit: "⌂", official_visit: "⌂", pitch: "☎", offer: "✎", raise_nil: "$", pull_offer: "✕", learned: "◉",
    present: "☎", answer: "☎", hung_up: "☎", asked_more: "$", commit: "⚑", hard: "⚑", flip: "⚑", decommit: "⚑", signed: "✔", leaning_fcs: "⚑", bloomed: "★", pro: "★" };
  const PERSONALITY_NOTE = { Cocky: "He is cocky: he wants to hear how good he is.", Shy: "He is shy: he opens up slowly.", Guarded: "He is guarded: he keeps what he wants to himself.",
    "Loves the Attention": "He loves the attention: every contact counts with him.", "All Business": "He is all business: he wants the facts and the offer." };
  function notesOf(b, me) {
    const out = [];
    const tr = b.traits || {};
    if (tr.personality) out.push(PERSONALITY_NOTE[tr.personality] || `His personality: ${tr.personality}.`);
    if (tr.decider) out.push(tr.decider === "Himself" ? "He makes the call himself." : `His ${tr.decider === "High School Coach" ? "high school coach" : tr.decider.toLowerCase()} makes the call.`);
    const known = (b.priorities_known || []).map((t) => topicWord(t));
    if (known.length) out.push(`He told you he cares about ${known.length > 1 ? `${known.slice(0, -1).join(", ")} and ${known[known.length - 1]}` : known[0]}.`);
    const rows = (b.list || []).filter((x) => x.bar != null);
    const mine = rows.find((x) => x.you || x.school === me);
    if (b.signed === me || b.committed === me) out.push(b.signed ? "He signed with you." : "He is committed to you.");
    else if (!mine) out.push("You are not on his list yet.");
    else if (mine.new) out.push("You joined his list this week.");
    else if (mine.move > 0) out.push("His interest in you rose this week.");
    else if (mine.move < 0) out.push("His interest in you slipped this week.");
    else out.push("His interest in you held steady this week.");
    if (!tr.personality && !known.length) out.push("A call tells you more about him.");
    return out;
  }
  function historyCards(s, b, me) {
    const items = historyItems(b.history || [], me);
    const timeline = items.length ? el("ul", { class: "pv-timeline go-news go-history-rows", "data-key": "timeline", tabindex: "0", "aria-label": "Recruiting Timeline" }, items.map((x, i) => el("li", { class: "pv-tl-row", "data-key": `h-${items.length - i}`, "data-line": `Week ${x.week} · ${x.text}` }, [
      el("span", { class: "pv-tl-icon", "aria-hidden": "true", text: KIND_ICON[x.kind] || "•" }), el("span", { class: "pv-tl-text" }, [el("b", { class: "pv-tl-week", text: x.portal ? `Week ${x.week}` : seasonWeek(x.week) }), ` · ${x.text}`]),
      el("span", { class: "go-tag pv-tl-chip", text: KIND_CHIP[x.kind] || "News" })])))
      : el("p", { class: "muted small", "data-key": "timeline", text: "Nothing with him yet: no contact, no offer." });
    const notes = el("div", { class: "pv-notes", "data-key": "notes" }, notesOf(b, me).map((t) => el("p", { text: t })));
    return PV().grid([PV().card("Recruiting Timeline", [timeline], { key: "timeline", cls: "pv-timeline-card" }),
      PV().card("Recruiting Notes", [notes], { key: "notes" }),
      battleCard(b, me, null, { title: "Recent Interest Changes", key: "interest", arrows: true })]);
  }

  // the board redraws when the screen crosses the phone line (the pane and the menu change shape)
  let boardAt = null;
  // his profile per career and recruit ({ key, pr }): the pane draws it at once when nothing it reads has changed
  const profiles = new Map();
  // the board's place in the address (web/route.js): the stage tab, the sort, the recruit in the pane and its
  // sub-tab; a replace, never a redraw. Only while the board is the view on screen.
  function syncBoard() {
    const R = window.CFP.route;
    if (!R || !boardAt || !boardAt.box.isConnected || boardAt.box.closest("[hidden]") || !view.stage) return;
    R.set({ stage: view.stage.key !== "all" ? view.stage.key : null, sort: view.sort !== "chance" ? view.sort : null,
      pid: phone() && !view.sheet ? null : view.selected || null, pane: view.sub !== "overview" ? view.sub : null });
  }
  // a route onto the board's, the Prospects' views (load, refresh, Back): what does not check out is the default
  function applyRoute(r, s) {
    if (r.tab === "prospects") return applyProspects(r);
    if (r.tab !== "recruiting" && r.tab !== "offseason") return;
    const stages = ["all", ...COLUMNS.map(([k]) => k)];
    if (!view.stage || view.stage.sid !== s.id) { view.group = null; view.state = null; view.search = ""; }
    view.stage = { sid: s.id, key: stages.includes(r.stage) ? r.stage : "all" };
    view.sort = r.sort === "rank" ? "rank" : "chance";
    view.sub = SUBS.some(([k]) => k === r.pane) ? r.pane : "overview";
    if (r.pid) { if (view.selected !== r.pid) { view.step = null; view.scene = null; } view.selected = r.pid; view.sheet = phone(); }
    else if (phone()) view.sheet = false;
  }
  function applyProspects(r) {
    const f = view.filters;
    f.position = POSITIONS.includes(r.ppos) ? r.ppos : "";
    f.stars = ["5", "4", "3", "2"].includes(r.pstars) ? r.pstars : "";
    f.state = STATES.includes(r.pstate) ? r.pstate : "";
    f.status = r.pstatus === "recommended" || STATUS.some(([k]) => k && k === r.pstatus) ? r.pstatus : "";
    f.sort = PR_SORTS.has(String(r.psort || "").replace(/^-/, "")) ? r.psort : "rank";
    f.group = /^[A-Z]{1,4}$/.test(r.pgroup || "") ? r.pgroup : "";
    const pg = Number(r.ppage);
    view.offset = Number.isInteger(pg) && pg > 1 ? (pg - 1) * 50 : 0;
  }
  window.matchMedia("(max-width: 359px)").addEventListener("change", () => { if (boardAt && boardAt.box.isConnected && boardAt.box.offsetParent) renderRecruiting(boardAt.s, boardAt.box); });
  window.matchMedia(PHONE).addEventListener("change", () => { if (boardAt && boardAt.box.isConnected && boardAt.box.offsetParent) renderRecruiting(boardAt.s, boardAt.box); });

  // ----- The footprint map -------------------------------------------------------------------------

  // the map is a disclosure: closed unless you opened it, and your choice is kept on this device
  function mapOpen() { try { return localStorage.getItem("cfp-map-open") === "1"; } catch (e) { return false; } }
  const MAP_TOGGLE = (open, small) => (open ? "▾ Hide the Map" : `▸ Show ${small ? "the Map" : "Your Footprint Map"}`);
  const TONE_RANK = { good: 0, warn: 1, muted: 2, bad: 3 };
  // The map card: your nine areas (shaded when staffed), every board prospect as a dot by your standing,
  // a tap on a dot or a state, and a table of the states for anyone who cannot use the picture.
  // opts: {small, open (drawn open whatever was kept: the Prospects' View Map window), selectedState, onState(code), onDot(id)}
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
      dots.push({ id: b.id, xy, tone: sd.tone, ring: b.committed === me || b.signed === me, big: !!b.generational, label: `${b.name} · ${b.display_pos || b.position} · ${sd.text}`, name: b.name });
    }
    const open = !!opts.open || mapOpen();
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
    const wholeBtn = el("button", { type: "button", class: "go-btn go-map-reset", text: "Whole Country" });
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
    const tBtn = el("button", { type: "button", class: "go-btn", "aria-expanded": "false", text: "List the States" });
    tBtn.addEventListener("click", () => {
      const showing = table.firstChild;
      table.innerHTML = "";
      tBtn.setAttribute("aria-expanded", String(!showing));
      tBtn.textContent = showing ? "List the States" : "Hide the List";
      if (showing) return;
      const codes = Object.keys(byState).sort();
      table.append(el("table", { class: "go-map-table" }, [
        el("thead", {}, [el("tr", {}, ["State", "Prospects on Your Board", "Your Best Standing"].map((h) => el("th", { scope: "col", text: h })))]),
        el("tbody", {}, codes.length ? codes.map((c) => el("tr", {}, [el("th", { scope: "row", text: c }), el("td", { text: String(byState[c].n) }), el("td", { text: byState[c].best.text })]))
          : [el("tr", {}, [el("td", { colspan: "3", text: "Nobody on your board yet." })])])]));
    });
    // under 360px the picture is left out (CSS hides it too; the table below says the same in words)
    const tiny = window.matchMedia("(max-width: 359px)").matches;
    body.append(tiny ? "" : regions, tiny ? "" : el("div", { class: "go-map-svg" }, [svg]), legend, key,
      dots.length ? "" : el("p", { class: "muted small", text: "Nobody on your board yet: add prospects and they appear here." }), el("div", { class: "go-row" }, [tBtn]), table);
    card.append(el("div", { class: "card-bar go-map-head" }, [el("div", { class: "go-display l", text: "Your Footprint" }), hint, toggle]), body);
    return card;
  }

  // ----- the board: stage tabs with counts, a plain list, one pane where every action lives behind the Recruit menu ---
  // Sections: the list; the pane (head, the Recruit menu, the inline step, the stat strip, the tags, the sub-tabs);
  // the phone (the pane as a full-screen dialog, the menu as a bottom sheet). The ladder is standingOf above.
  const STAGE_NAMES = Object.fromEntries(COLUMNS);
  const ACTION_NAMES = { message: "Message", call: "Call", hc_visit: "HC Visit", official_visit: "Official Visit", offer: "Offer", raise_nil: "NIL Raised", pull_offer: "Offer Pulled", scout: "Scout", pitch: "Pitch" };
  const SUBS = [["overview", "Overview"], ["scouting", "Scouting"], ["profile", "Profile"], ["history", "History"]];
  function needsOpen() { try { return localStorage.getItem("cfp-needs-open") === "1"; } catch (e) { return false; } }
  // his status in one chip: his stage with you, or where his recruitment ended
  function chipOf(b, me, portal) {
    if (b.signed === me) return { text: "Signed With You", tone: "good" };
    if (b.committed === me) return { text: "Committed to You", tone: "good" };
    if (b.pro) return { text: "Went Pro in Baseball", tone: "bad" };
    if (b.quiet) return { text: "Quiet", tone: "warn" };
    if (b.signed) return { text: `Signed · ${teamLabel(b.signed)}`, tone: "bad" };
    if (b.committed) return { text: `${b.hard ? "Hard Commit" : "Verbal Commit"} · ${teamLabel(b.committed)}`, tone: b.hard ? "bad" : "warn" };
    const k = STAGE_NAMES[b.stage] ? b.stage : "cold";
    return { text: k === "visited" && portal ? "Campus Visit" : STAGE_NAMES[k], tone: "" };
  }
  // his ask in a few words: "120", "about 90–150"
  const askWord = (b) => (b.ask ? (b.ask.exact != null ? String(b.ask.exact) : `about ${b.ask.lo}–${b.ask.hi}`) : "");
  // your program's case on a pitch, as a word
  const caseWord = (b, t) => { const sv = b.strength ? b.strength[t] : null; return sv == null ? "" : sv >= 0.6 ? "Strong" : sv < 0.25 ? "Weak" : "Fair"; };
  // what he said about each topic you pitched him (recruiting.pitch_marks): a mark on the topic in every picker and on his
  // card, so you don't keep pitching a dud; no mark: you never pitched it to him
  const MARKS = { hit: ["He Lit Up", "hit"], weak: ["Weak Case", "weak"], not_his: ["Not His Thing", "not"], no_read: ["No Read", "none"] };
  const MARK_OF = { hit: "hit", quiet: "weak", polite: "not_his", guarded: "no_read", tired: "no_read" };   // his reaction -> the mark
  const ACTION_WORD = { call: "call", hc_visit: "in-home visit", official_visit: "official visit" };
  const markOf = (b, t) => { const m = (b.pitch_marks || {})[t]; return m && MARKS[m.mark] ? m : null; };
  function markWhy(m) {
    const when = `${m.week && m.week <= 14 ? `${seasonWeek(m.week)} ` : ""}${ACTION_WORD[m.action] || "call"}`;
    return { hit: `He lit up when you pitched this on your ${when}.`, weak: `He went quiet on this on your ${when}: he cares, and your case is weak.`,
      not_his: `He was polite about this on your ${when}: it is not one of his priorities.`,
      no_read: `You pitched this on your ${when} and got no read on it.` }[m.mark];
  }
  function markTag(b, t) {
    const m = markOf(b, t);
    return m ? el("span", { class: `go-mark ${MARKS[m.mark][1]}`, text: MARKS[m.mark][0], title: markWhy(m) }) : null;
  }
  // he just told you something: the mark lands now, not at the re-fetch (a No Read never hides a real read)
  function noteMark(b, t, mark, action, week) {
    if (!b || !t || !mark) return;
    b.pitch_marks = b.pitch_marks || {};
    const was = b.pitch_marks[t];
    if (mark === "no_read" && was && was.mark !== "no_read") return;
    b.pitch_marks[t] = { mark, week, action };
  }

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
  // the board's latest render, for a call's window reopened from the address: settles once it drew (or failed)
  let drawn = null;
  async function renderRecruiting(s, box) {
    let settled;
    drawn = { sid: s.id, p: new Promise((r) => { settled = r; }) };
    try {
      if (!box.firstChild) box.append(loading("Loading your board…"));
      const n = ++fetchSeq;
      let v;
      try { v = await loadBoard(s); }
      catch (err) { if (n !== fetchSeq) return; box.innerHTML = ""; box.append(loading(`Could not load recruiting: ${H.errText(err)}`)); return; }
      if (n !== fetchSeq) return;
      drawBoard(s, box, v);
    } finally { settled(); }
  }
  // the address names an open call or visit (scene:<pid>): once the board has drawn, its window opens again when
  // the conversation is still unfinished; a finished one (or one the week step dropped) is gone, so false
  async function openSceneRoute(s, pid, opts) {
    const w = drawn;
    if (!w || w.sid !== s.id) return false;
    await w.p;
    return !!(boardAt && boardAt.s.id === s.id && boardAt.box.isConnected && boardAt.openScene && boardAt.openScene(pid, opts || {}));
  }
  // the open call or visit window ({ pid, done, node }): one at a time
  let sceneWin = null;
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
  const boardTitle = (v) => (v.portal ? `Transfer Portal · Week ${v.portal.week} of ${v.portal.weeks}${v.nil.pool != null ? ` · ${v.nil.pool} NIL` : ""}` : "Recruiting Board");

  // the board from a view already fetched: the first draw, and the redraws a needs or map filter asks for.
  // patchBoard(v) (an action's re-fetch) and refill() (a stage tab, the search, the sort) update it in place.
  function drawBoard(s, box, v0) {
    let v = v0;
    const me = s.team;
    const searchHadFocus = document.activeElement && document.activeElement.id === "rc-search";
    // a stage tab or the sort that redrew the board keeps the focus, as the search does
    const stageHadFocus = document.activeElement && box.contains(document.activeElement) && (document.activeElement.dataset.stage || document.activeElement.classList.contains("go-stage-pick"));
    const sortHadFocus = document.activeElement && box.contains(document.activeElement) && document.activeElement.id === "rc-sort";
    closeMenu();
    // the stage tab, the position and state filters and the search belong to one career: another career starts clear
    if (!view.stage || view.stage.sid !== s.id) { view.stage = { sid: s.id, key: "all" }; view.group = null; view.state = null; view.search = ""; }
    box.innerHTML = "";
    box.dataset.draw = String((Number(box.dataset.draw) || 0) + 1);      // a draw counter, bumped by every draw and patch: tests wait on it after an action lands
    document.body.classList.remove("go-sheet-open");
    boardAt = { s, box, patch: patchBoard, openScene: (pid, o) => {
      const b = v.board.find((x) => x.id === pid);
      if (!(b && b.scene) || b.signed || b.committed === me) return false;
      if (view.selected !== pid) choose(b);
      return openSceneWindow(b, o);
    } };
    let boardEl = null;
    // Auto-recruit: off, for the coming week only, or all season
    const AUTO = [["off", "Off"], ["week", "This Week"], ["season", "All Season"]];
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
    // the budgets: hours, NIL, offers, commits (of the class's spots) and the week's scouting points, each a value and a thin bar
    const meters = { hours: meter("Recruiting Hours", v.hours_left, v.hours), nil: meter("NIL Points", v.nil.left, nilTotal(v), false, nilTitle(v)),
      offers: meter("Offers", v.offers, v.offers + v.offers_left, true), commits: meter("Commits", v.committed, v.open_spots, true),
      points: meter("Scouting Points", v.points_left != null ? v.points_left : 0, v.points_week != null ? v.points_week : 0, true, "What is left of this week's scouting points for trips") };
    box.append(el("div", { class: "go-board-head rc-head" }, [
      el("h2", { class: "go-display l go-board-title", text: boardTitle(v) }),
      el("div", { class: "go-meters" }, [meters.hours, meters.nil, meters.offers, meters.commits, meters.points]),
      el("div", { class: "go-auto" }, [el("span", { class: "pv-kick", text: "Auto-Recruit" }), auto]),
    ]));
    if (!v.board.length) {
      box.append(el("div", { class: "go-card go-empty" }, [el("div", { class: "go-display l", text: "Your Board Is Empty" }),
        el("p", { class: "muted", text: "Add prospects from the class, then recruit them here. Every action costs hours; only an offer lets him commit to you." }),
        el("button", { type: "button", class: "go-btn primary", text: "Find Prospects", onclick: () => H.onChange("prospects") })]));
      return;
    }

    // ----- the stage row: tabs with counts, the search and the sort; the needs as a disclosure; the map -----
    const label = (k, name) => (k === "visited" && v.portal ? "Campus Visit" : name);
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
    // the stages: one pill (the stage you are on, its count, ▾) that opens the rest as the same pills
    const stageNames = Object.fromEntries([["all", "All"], ...COLUMNS]);
    const pickName = el("span"), pickCount = el("b", { text: "0" });
    const stagePick = el("button", { type: "button", class: "go-stage-pick", "aria-haspopup": "true", "aria-expanded": "false", "aria-label": "Stage" },
      [pickName, pickCount, el("span", { class: "go-stage-caret", "aria-hidden": "true", text: "▾" })]);
    const stages = el("div", { class: "go-stage-menu", role: "group", "aria-label": "Stages", hidden: "" }, [["all", "All"], ...COLUMNS].map(([k, name]) => {
      const b = el("button", { type: "button", "data-stage": k, "aria-pressed": String(view.stage.key === k), title: COLUMN_TIPS[k] || "Everyone on your board" },
        [el("span", { text: label(k, name) }), el("b", { text: "0" })]);
      b.addEventListener("click", () => { view.stage.key = k; closeStages(); refill({}); stagePick.focus({ preventScroll: true }); });
      return b;
    }));
    const outside = (e) => { if (!stageWrap.contains(e.target)) closeStages(); };
    function closeStages() {
      if (stages.hidden) return;
      stages.hidden = true;
      stagePick.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", outside, true);
    }
    stagePick.addEventListener("click", () => {
      if (!stages.hidden) { closeStages(); return; }
      stages.hidden = false;
      stagePick.setAttribute("aria-expanded", "true");
      document.addEventListener("click", outside, true);
      const on = stages.querySelector('button[aria-pressed="true"]');
      if (on) on.focus({ preventScroll: true });
    });
    const stageWrap = el("div", { class: "go-stages" }, [stagePick, stages]);
    stageWrap.addEventListener("keydown", (e) => { if (e.key === "Escape" && !stages.hidden) { e.stopPropagation(); closeStages(); stagePick.focus({ preventScroll: true }); } });
    const search = el("input", { type: "search", id: "rc-search", value: view.search, placeholder: "Search name, position, state", "aria-label": "Search your board" });
    let qTimer = null;
    search.addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(() => { view.search = search.value; refill({}); }, 150); });
    if (!["chance", "rank"].includes(view.sort)) view.sort = "chance";
    const sort = el("select", { id: "rc-sort", class: "go-sel", "aria-label": "Sort" }, [["chance", "Sort: Your Chance"], ["rank", "Sort: National Rank"]].map(([k, t]) => el("option", { value: k, text: t })));
    sort.value = view.sort;
    sort.addEventListener("change", () => { view.sort = sort.value; refill({}); });
    const stagebar = el("div", { class: "go-stagebar" }, [stageWrap, el("div", { class: "go-tools" }, [search, sort])]);
    // what the roster needs this class, by position, behind a disclosure; a position picked there filters the list to it
    const open = (view.needsOpen = needsOpen());
    const needsBox = el("div", { id: "rc-needs", class: "go-needs-box" }, [needsStrip(v.needs_detail, view.group, (g) => { view.group = g; drawBoard(s, box, v); }, () => drawBoard(s, box, v))]);
    needsBox.hidden = !open;
    const needsBtn = el("button", { type: "button", class: "go-needs-toggle", "aria-expanded": String(open), "aria-controls": "rc-needs" },
      [el("span", { text: `Needs ${open ? "▾" : "▸"}` }), view.group ? el("span", { class: "go-tag", text: `${view.group} Only` }) : null]);
    needsBtn.addEventListener("click", () => {
      const now = needsBox.hidden;
      needsBox.hidden = !now;
      view.needsOpen = now;
      needsBtn.setAttribute("aria-expanded", String(now));
      needsBtn.firstChild.textContent = `Needs ${now ? "▾" : "▸"}`;
      try { localStorage.setItem("cfp-needs-open", now ? "1" : "0"); } catch (e) { /* no storage */ }
    });
    const needsDis = el("div", { class: "go-needs-disclosure" }, [needsBtn, needsBox]);
    const mapEl = (mapCard(v, s, me, { selectedState: view.state, onState: (c) => { view.state = view.state === c ? null : c; drawBoard(s, box, v); } }));

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
    list.append(empty, el("div", { class: "go-list-foot" }, [footCount, el("button", { type: "button", class: "go-link", text: "+ Find Prospects", onclick: () => H.onChange("prospects") })]));
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
      else { choose(b); btns[j].focus({ preventScroll: true }); ui().keepInView(btns[j]); }
    });
    boardEl = el("div", { class: "go-board" }, [el("section", { class: "go-card go-list-col", "aria-label": "Your board" }, [stagebar, needsDis, list])]);
    box.append(boardEl, mapEl);
    settleExpect();
    refill({});
    if (searchHadFocus) { search.focus({ preventScroll: true }); const n = search.value.length; search.setSelectionRange(n, n); }
    else if (stageHadFocus) stagePick.focus({ preventScroll: true });          // the menu closed with the redraw: back to its pill
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
      patchMeter(meters.points, v.points_left != null ? v.points_left : 0, v.points_week != null ? v.points_week : 0, "What is left of this week's scouting points for trips");
      for (const b of auto.children) { const on = v.auto_recruit === b.dataset.auto; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }
      settleExpect();
      refill({ keep: true, pulse: true });
    }
    // a Finish pressed: the re-read board still has the call open, so its window opens again; a call the week
    // step has closed is gone: the board says so and the menu works again
    function settleExpect() {
      if (!view.expectScene) return;
      const { pid: waited, what } = view.expectScene;
      const b = v.board.find((x) => x.id === waited);
      view.expectScene = null;
      if (b && b.scene) openSceneWindow(b);
      else { view.scene = null; H.toast(`That ${what} lapsed: the week moved on. The hours stayed spent.`, 4000); }
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
      pickName.textContent = label(view.stage.key, stageNames[view.stage.key] || "All");
      if (pickCount.textContent !== String(counts[view.stage.key])) { pickCount.textContent = String(counts[view.stage.key]); if (opts.pulse) ui().pulse(pickCount); }
      rows = pool.filter(inTab).sort(order[view.sort]);
      const onBoard = v.board.some((b) => b.id === view.selected);
      const inList = rows.some((b) => b.id === view.selected);
      const left = view.leave && view.leave.id === view.selected && !inList ? view.leave : null;   // a pulled offer took him out of this tab
      view.leave = null;
      if (left) { view.selected = rows.length ? rows[Math.max(0, Math.min(left.at, rows.length - 1))].id : null; view.step = null; }
      else if (!onBoard || (!opts.keep && rows.length && !inList)) { view.selected = rows.length ? rows[0].id : null; view.step = null; }
      sel = ((opts.keep && !left) || inList || rows.some((b) => b.id === view.selected)) ? v.board.find((b) => b.id === view.selected) || null : null;
      empty.textContent = view.search.trim() ? "Nobody matches that search." : "Nobody here yet.";
      empty.hidden = rows.length > 0;
      footCount.textContent = `${v.board.length} on your board`;
      const focused = document.activeElement && list.contains(document.activeElement) ? document.activeElement.dataset.pid : null;
      const was = list.querySelector(".go-row-recruit.selected"), seen = !was || ui().inView(was);   // the list scrolls in its card on a wide screen
      ui().reconcile(list, rows, (b) => b.id, row, patchRow);
      markRows();
      if (seen && !phone()) ui().keepInView(list.querySelector(".go-row-recruit.selected"));        // a patch that moved his row keeps it in view
      if (focused) { const f = list.querySelector(`.go-row-recruit[data-pid="${focused}"]`); if (f && document.activeElement !== f) f.focus({ preventScroll: true }); }
      // the pane: patched for the same recruit, swapped (a cross-fade) for another, gone with the last row
      const cur = box.querySelector(".go-pane");
      if (!sel) dropPane();
      else if (cur && cur._pid === sel.id) cur._patch(sel);
      else if (!phone()) swapPane(pane(sel));
      else if (view.sheet) openSheet(sel);
      else dropPane();
      syncBoard();
    }
    function dropPane() {
      for (const old of box.querySelectorAll(".go-pane")) old.remove();
      side = null;
      document.body.classList.remove("go-sheet-open");
    }
    function rowLine(b) { return b.portal ? `${b.position} · ${clsWord(b.cls)} · from ${b.from_name}` : ` ${b.display_pos || b.position} · ${(b.hometown && b.hometown.state) || ""}`; }
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
      dot.textContent = moved === "up" ? "▲" : moved === "down" ? "▼" : "";     // his standing moved this week: an arrow says which way
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
      const shown = sd.odds === "No Room" ? "No Room" : sd.word;
      word.textContent = shown;
      if (sd.odds === "No Room") word.title = b.no_room.tip; else word.removeAttribute("title");
      word.className = `go-standing-word ${sd.tone}`;
      if (!first && was !== shown) ui().pulse(word);
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
      if (phone()) view.sheet = true;
      syncBoard();
      if (phone()) { view.sheet = true; openSheet(b); }
      else {
        const cur = box.querySelector(".go-pane");
        if (cur && cur._pid === b.id) cur._patch(b); else swapPane(pane(b));
        // the first pick brings the list and the pane up together: the board's top meets the pane's sticky line
        const gap = boardEl.getBoundingClientRect().top - (parseFloat(getComputedStyle(side).top) || 0);
        if (gap > 1) window.scrollBy({ top: gap, behavior: "smooth" });
        else {                               // a short window scrolled past the pane's top: bring his pane (its tabs) back into view
          const above = side.getBoundingClientRect().top;
          if (above < 0) window.scrollBy({ top: above - 8, behavior: "smooth" });
        }
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
    }
    function openSheet(b) {
      for (const old of box.querySelectorAll(".go-pane.sheet")) old.remove();
      const p = pane(b);
      box.append(p);
      document.body.classList.add("go-sheet-open");
      const back = p.querySelector(".go-pane-back");
      if (back && !sceneWin) back.focus();
    }
    function closeSheet() {
      view.sheet = false;
      closeMenu();
      dropPane();
      syncBoard();
      const r = list.querySelector(".go-row-recruit.selected");
      if (r) r.focus({ preventScroll: true });
    }
    // ----- actions: one network path; a call or in-home visit opens its conversation in a window -----
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
    function run(b, action, pitch, nil, control, opts = {}) {
      const job = (async () => {
        const r = await act(s, b.id, action, pitch || null, nil, { ...opts, silent: true, onScene: (sc) => openScene(b, sc) });
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
      openSceneWindow(b);
    }
    // ----- the call or in-home visit: its own window over the board (the shared modal, token scene:<pid>) -----
    // The whole conversation plays there. Closing it before your pitch (Hang Up, the close button, Escape, Back) keeps
    // the call open: the pane's Finish the Call brings the window back this week. Once he has reacted to your pitch
    // the window says Done, and closing it ends the conversation for good: the pane never shows it (History keeps a line).
    function openSceneWindow(b, opts = {}) {
      if (sceneWin) return sceneWin.pid === b.id;
      if (!b || !b.scene) return false;
      const visit = b.scene.action === "hc_visit";
      const win = { pid: b.id, done: false, node: null, scene: b.scene };
      sceneWin = win;
      view.scene = b.id;
      view.step = null;
      win.node = sceneView(b, win);
      H.openModal(`${visit ? (b.portal ? "Head Coach Visit" : "In-Home Visit") : "Call"} · ${b.name}`, win.node, `scene:${b.id}`,
        { restore: !!opts.restore, cls: "modal-scene", onClose: () => sceneClosed(win, b) });
      patchShown(b);
      win.node.focus({ preventScroll: true });
      return true;
    }
    function sceneClosed(win, b) {
      if (sceneWin === win) sceneWin = null;
      if (view.scene === win.pid) view.scene = null;
      win.node.remove();         // the closed window keeps nothing of it (Finish draws it again from the board's scene)
      // the window's scene is the live one (your opening, his answer): a re-fetch taken before them keeps an older copy
      const row = v.board.find((x) => x.id === win.pid) || b;
      if (!win.done && row.scene && row.scene !== win.scene && row.scene.id === win.scene.id) row.scene = win.scene;
      patchShown(row);
      // unfinished: Finish brings it back; finished: the Recruit button is next
      const f = (!win.done && box.querySelector("#rc-finish")) || box.querySelector("#rc-recruit");
      if (f && f.offsetParent !== null) f.focus({ preventScroll: true });
    }
    // the pane, when it is his, brought up to date in place (never swapped in for him from here)
    function patchShown(b) {
      const cur = box.querySelector(".go-pane");
      if (cur && cur._pid === b.id) cur._patch(b);
    }
    // after a menu action: the window it opened keeps the focus; a pane that switched (Off the Board) hands it to the new
    // pane's Recruit button, also when busy() settled on a row because the control left with the old pane; else a row
    function refocus(b) {
      if (sceneWin) { const a = document.activeElement; if (!(a && a.closest && a.closest(".modal-scene"))) sceneWin.node.focus({ preventScroll: true }); return; }
      const active = document.activeElement, onBody = !active || active === document.body;
      const recruit = box.querySelector("#rc-recruit");
      if (recruit && (onBody || active.classList.contains("go-row-recruit"))) { recruit.focus({ preventScroll: true }); return; }
      if (!onBody) return;
      const f = list.querySelector(".go-row-recruit[aria-pressed=\"true\"]") || list.querySelector(".go-row-recruit");
      if (f) f.focus({ preventScroll: true });
    }
    function pick(b, action, control, opts = {}) {
      const btn = control || box.querySelector("#rc-recruit");
      if (action === "message" || action === "offer" || action === "raise_nil") {
        view.step = { pid: b.id, kind: action };
        patchPane(b);
        const f = box.querySelector(".go-step .go-lead-chip.on, .go-step .go-lead-chip, .go-step input");
        if (f) f.focus({ preventScroll: true });
      } else if (action === "off_board") {
        // taking him off pulls your offer too (the engine does it): one misclick should not cost you a recruit
        if (b.offered && !window.confirm(`Take ${b.name} off your board? Your offer to him is pulled too: the NIL points come back to you${b.committed === me && !b.signed ? ", and he decommits from you" : ""}.`)) return;
        const hadOffer = b.offered;
        ui().busy(btn, (async () => {
          if (!(await setBoard(s, b.id, false))) return;
          ui().toast(hadOffer ? `${b.name} is off your board · offer pulled` : `${b.name} is off your board`);
          view.sheet = false;
          await refresh(s, box);
        })()).then(() => refocus(b));
      } else if (action === "pull_offer") {       // one misclick in a menu should not cost you a recruit
        if (window.confirm(`Pull your offer to ${b.name}? The NIL points come back to you${b.committed === me && !b.signed ? ", and he decommits from you" : ""}.`)) {
          view.leave = { id: b.id, at: rows.findIndex((r) => r.id === b.id) };   // he may leave the tab (Top 8 needs an offer): the next row takes the pane
          run(b, action, null, null, btn).then(() => refocus(b));
        }
      } else if (action === "official_visit" && opts.week != null) {   // the weekend picked in the menu's second step
        run(b, action, null, null, btn, { week: opts.week }).then(() => refocus(b));
      } else run(b, action, null, null, btn).then(() => refocus(b));
    }
    // the Official Visit's second step: one row a home weekend you have left ("Wk 6 · vs #4 USC"), the first
    // free one marked, a weekend he has at another school grayed with the reason, and Back at the top
    function visitItems(b) {
      const weeks = b.visit_weeks || [];
      const rows = weeks.map((w) => ({ action: "visit_week", week: w.week, name: `Wk ${w.week - 1} · vs ${w.opponent_rank ? `#${w.opponent_rank} ` : ""}${w.opponent_name}`,
        cost: w.first ? "First Free Weekend" : "", why: w.taken_by ? `He's at ${w.taken_by} that weekend` : null }));
      if (!rows.length) rows.push({ action: "visit_none", name: "No Home Games Left", cost: "", why: "No home game left for a visit" });
      return [{ action: "back", name: "‹ Back", cost: "", why: null, back: true }, ...rows];
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
        ["hc_visit", "HC Visit", "30h", hcWait ? "Monthly" : short(30)],
        ["scout", "Scout", `${b.scout_cost} Points · ${fmtLooks(looks)} of 3 Looks${looks < 3 && 3 - looks <= 1 ? " · Finishes His Report" : ""}`,
          looks >= 3 ? "His report is complete: 3 of 3 looks" : v.points_left < b.scout_cost ? "Not enough scouting points left this week." : null],
        ["official_visit", v.portal ? "Campus Visit" : "Official Visit", "10h", !b.offered ? "Offer him first" : b.visit ? (b.visit.done ? "Visited" : `Booked for ${seasonWeek(b.visit.week)}`)
          : !["top", "visited"].includes(b.stage) ? "Not yet: get into his top group" : b.cooled ? (COOLED_WHY[b.cooled_why] || COOLED_WHY.lowball) : short(10)],
        ["offer", "Offer…", "No Hours", b.signed ? "Signed" : b.offered ? "Already offered" : b.hard ? "Hard commit elsewhere" : v.offers_left <= 0 ? "Offer limit reached" : null],
        ["raise_nil", "Raise NIL…", "No Hours", !b.offered ? "Not offered" : null],
        ["pull_offer", "Pull Offer", "", !b.offered ? "Not offered" : null],
        ["off_board", "Off the Board", "", b.offered && b.hard && b.committed === me ? "Hard commit: his offer stands until he signs" : null],
      ];
      const tip = (action) => (b.pestering && ["message", "call", "hc_visit"].includes(action) ? "Costs you interest while he is tuning you out" : null);
      return items.map(([action, name, cost, why]) => ({ action, name, cost, why: busy ? `Finish your ${busy} first` : why, title: tip(action) }));
    }
    function openMenu(b, btn) {
      if (menuState) { closeMenu(true); return; }
      const sheet = phone();
      const menu = el("div", { class: `go-menu ${sheet ? "sheet" : ""}`, role: "menu", tabindex: "-1", "aria-label": `Recruit ${b.name}` });
      // the menu's rows, drawn in place: the actions, or the Official Visit's weekends (its second step: Back returns)
      const fill = (items, label) => {
        menu.innerHTML = "";
        menu.setAttribute("aria-label", label);
        menu.append(...items.map((it) => {
          const item = el("button", { type: "button", class: `go-menu-item${it.back ? " go-menu-back" : ""}`, role: "menuitem", "data-action": it.action, tabindex: "-1",
            ...(it.week != null ? { "data-week": String(it.week) } : {}), ...(it.title ? { title: it.title } : {}) }, [
            el("span", { class: "go-menu-main" }, [el("b", { text: it.name }), it.cost ? el("span", { class: "muted small go-menu-cost", text: it.cost }) : null]),
            it.why ? el("span", { class: "go-menu-why", text: it.why }) : null]);
          if (it.why) item.setAttribute("aria-disabled", "true");     // grayed, but reachable: the reason is read out
          item.addEventListener("click", () => {
            if (it.why) return;
            if (it.back) { fill(menuItems(b), `Recruit ${b.name}`); focusFirst(); return; }
            if (it.action === "official_visit" && !v.portal) { fill(visitItems(b), `Official Visit Weekend for ${b.name}`); focusFirst(".go-menu-item[data-action=visit_week]"); return; }   // step two: pick the weekend
            closeMenu(true);                                             // the Recruit button holds the focus while the action is busy
            if (it.action === "visit_week") pick(b, "official_visit", null, { week: it.week });
            else pick(b, it.action);
          });
          return item;
        }));
        if (menuState && !sheet) menuState.onMove();                    // the list changed height: keep it inside the screen
      };
      // focus goes to the first live item (`among`: the weekends, past Back), or to the first item when every item waits (its reason is read out)
      const focusFirst = (among = ".go-menu-item") => {
        const first = menu.querySelector(`${among}:not([aria-disabled="true"])`) || menu.querySelector(".go-menu-item");
        (first || menu).focus();
      };
      fill(menuItems(b), `Recruit ${b.name}`);
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
        menu.style.left = `${Math.max(pad, Math.min(r.right - m.width, document.documentElement.clientWidth - m.width - pad))}px`;
      };
      if (!sheet) place();
      const onDoc = (e) => { if (!menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closeMenu(); };
      const onMove = () => { if (!sheet) place(); };
      document.addEventListener("pointerdown", onDoc, true);
      window.addEventListener("scroll", onMove, true);
      window.addEventListener("resize", onMove);
      btn.setAttribute("aria-expanded", "true");
      menuState = { el: menu, backdrop, btn, onDoc, onMove };
      focusFirst();
    }

    // ----- the pane: everything about him, every action on him -----
    // One element for as long as he is the one on screen: p._patch(b) brings it up to date in place (the hero, the
    // buttons on the tab row, the step, the tab's cards), pulsing what changed; only another recruit swaps the element.
    // The hero and the cards are drawn fresh and morphed onto the live ones (web/ui.js): nothing is emptied. His profile
    // (the report, the hints, the comps, the flip words) is fetched when what it reads changed, and kept per recruit.
    function pane(b0) {
      let b = b0;
      const sheet = phone();
      const p = el("aside", { class: `go-card go-pane ${sheet ? "sheet" : ""}`, "aria-label": `${b.name}: recruit him`, ...(sheet ? { role: "dialog", "aria-modal": "true" } : {}) });
      p._pid = b.id;
      if (sheet) p.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (menuState) closeMenu(true); else closeSheet(); } });
      // the name and the phone's Back are drawn fresh with the hero: the morph keeps the live buttons (and their listeners) by data-key
      const nameBtn = () => el("button", { type: "button", class: "go-link go-pane-name pv-name", "data-key": "name", text: b.name, title: "His traits and background", onclick: () => showSub("profile") });
      const back = () => (sheet ? el("button", { type: "button", class: "go-btn go-pane-back", "data-key": "back", "aria-label": "Back to the list", text: "‹ Back", onclick: closeSheet }) : null);
      const head = el("div", { class: "go-pane-head" });
      // the tab row: the sub-tabs, then the buttons (Finish, Recruit ▾, Off the Board, the ☆ watch star)
      const acts = el("div", { class: "go-pane-act pv-acts" });
      const star = el("button", { type: "button", class: "go-btn pv-star", "aria-pressed": "true", text: "★" });
      star.addEventListener("click", () => pick(b, "off_board", star));
      acts.append(star);
      const strip = el("div", { class: "go-subtabs", role: "tablist", "aria-label": "About him" }, SUBS.map(([k, name]) => {
        const t = el("button", { type: "button", role: "tab", "data-sub": k, "aria-selected": "false", text: name });
        t.addEventListener("click", () => showSub(k));
        return t;
      }));
      const tabRow = el("div", { class: "pv-tabrow" }, [strip, acts]);
      const warnSlot = el("div", { class: "go-pane-warn" });        // above the tab row: the warning sits over the Recruit button
      const body = el("div", { class: "go-sub-body pv-host", role: "tabpanel" });
      p.append(head, warnSlot, tabRow, body);
      // on a phone the head is pinned to the top of the sheet: the tab row pins just under it, at its height
      if (sheet && window.ResizeObserver) new ResizeObserver(() => p.style.setProperty("--go-head-h", `${head.offsetHeight}px`)).observe(head);
      let finishBtn = null, recruitBtn = null, offBtn = null, warnEl = null, stepEl = null, bodyKey = null;
      let prof = (profiles.get(`${s.id}:${b.id}`) || {}).pr || null, profKey = (profiles.get(`${s.id}:${b.id}`) || {}).key || null, profSeq = 0, profN = 0;
      p._patch = (nb) => { b = nb; fill(false); };
      fill(true);
      return p;

      function fill(first) {
        const sd = standingOf(b, me);
        const open = !b.signed && b.committed !== me;           // the race is still on for you
        const busy = open && b.scene ? (b.scene.action === "hc_visit" ? "visit" : "call") : null;
        const shown = !!(open && b.scene && view.scene === b.id);
        p.setAttribute("aria-label", `${b.name}: recruit him`);
        // the hero: his chip, his line, the ranks and Your Chance, patched in place
        ui().morph(head, el("div", {}, [heroOf(b, me, { nameNode: nameBtn(), back: back() })]), { pulse: !first });
        // his call or visit is open but not on screen: Finish brings it back (it re-reads the board first: the week may have moved on)
        const wantFinish = !!(busy && !shown);
        if (wantFinish && !finishBtn) {
          finishBtn = el("button", { type: "button", id: "rc-finish", class: "go-btn primary", "aria-haspopup": "dialog" });
          finishBtn.addEventListener("click", () => {
            view.expectScene = { pid: b.id, what: b.scene && b.scene.action === "hc_visit" ? "visit" : "call" };
            ui().busy(finishBtn, refresh(s, box)).then(() => refocus(b));
          });
          acts.prepend(finishBtn);
        } else if (!wantFinish && finishBtn) { finishBtn.remove(); finishBtn = null; }
        if (finishBtn) { finishBtn.textContent = busy === "visit" ? "Finish the Visit" : "Finish the Call"; finishBtn.setAttribute("aria-label", `Finish your ${busy} with ${b.name}`); }
        if (open && !recruitBtn) {
          recruitBtn = el("button", { type: "button", id: "rc-recruit", class: "go-btn", "aria-haspopup": "menu", "aria-expanded": "false", text: "Recruit ▾" });
          recruitBtn.addEventListener("click", () => openMenu(b, recruitBtn));
          acts.insertBefore(recruitBtn, star);
        } else if (!open && recruitBtn) { recruitBtn.remove(); recruitBtn = null; }
        if (recruitBtn) recruitBtn.classList.toggle("primary", !busy);
        // he is tuning you out: a warning under the tab row (the menu's contacts stay open, their titles carry the cost)
        const wantWarn = !!(open && b.pestering);
        if (wantWarn && !warnEl) {
          warnEl = el("p", { class: "go-warn", role: "note", text: "He is tuning you out: another contact costs you interest." });
          warnSlot.append(warnEl);
          if (!first) ui().fadeIn(warnEl);
        } else if (!wantWarn && warnEl) { const old = warnEl; warnEl = null; if (first) old.remove(); else ui().fadeOut(old); }
        const wantOff = !open && !!b.signed && b.signed !== me;
        if (wantOff && !offBtn) { offBtn = el("button", { type: "button", class: "go-btn", text: "Off the Board", onclick: () => pick(b, "off_board", offBtn) }); acts.insertBefore(offBtn, star); }
        else if (!wantOff && offBtn) { offBtn.remove(); offBtn = null; }
        // the watch star: he is on your board; it takes him off (as the menu's Off the Board), except a hard commit to you
        const locked = b.offered && b.hard && b.committed === me;
        star.hidden = wantOff;
        star.disabled = !!locked;
        star.title = locked ? "Hard commit: his offer stands until he signs" : "On your board: take him off";
        star.setAttribute("aria-label", locked ? `${b.name} stays on your board until he signs` : `Take ${b.name} off your board`);
        // the inline step (Message, Offer…, Raise NIL…): kept while it is the same step (what you typed stays)
        const stepKind = open && !busy && view.step && view.step.pid === b.id ? view.step.kind : null;
        // a part that leaves while it holds the focus hands it to the Recruit button (never to the page body)
        const catchFocus = () => { if (!document.activeElement || document.activeElement === document.body) (recruitBtn || finishBtn || p).focus({ preventScroll: true }); };
        const leave = (old) => {
          if (old.contains(document.activeElement)) catchFocus();
          if (first) old.remove(); else ui().fadeOut(old).then(catchFocus);
        };
        if (stepEl && (!stepKind || stepEl._kind !== stepKind)) { const old = stepEl; stepEl = null; leave(old); }
        if (stepKind && !stepEl) { stepEl = stepView(b, stepKind); stepEl._kind = stepKind; tabRow.after(stepEl); if (!first) ui().fadeIn(stepEl); }
        // the call or visit itself plays in its window (openSceneWindow): the pane shows none of it
        if (!SUBS.some(([k]) => k === view.sub)) view.sub = "overview";
        for (const t of strip.children) t.setAttribute("aria-selected", String(t.dataset.sub === view.sub));
        // his profile: re-read when what it is built from changed (a look, a trait, his list, an offer)
        const pk = JSON.stringify([b.looks, b.our_grades, b.traits, b.list, b.committed, b.signed, b.hard, b.offered, b.priorities_known, b.likes, b.find, b.generational]);
        if (pk !== profKey) {
          profKey = pk;
          const n = ++profSeq;
          H.api(`/api/season/${s.id}/prospect/${encodeURIComponent(b.id)}`).then((pr) => {
            if (n !== profSeq || !pr || !pr.public) return;
            prof = pr;
            profiles.set(`${s.id}:${b.id}`, { key: pk, pr });
            profN++;
            drawBody(profN === 1 && !prof.__seen);    // his first profile on this pane draws quietly (a recruit switch never pulses)
            prof.__seen = true;
          }).catch(() => { /* the cards stand with what the board knows */ });
        }
        drawBody(first);
      }
      // the tab's cards: drawn fresh, morphed onto the live ones when the tab is the same (what changed pulses),
      // swapped at once for another tab (no motion on navigation)
      function drawBody(quiet) {
        const k = view.sub;
        const key = `${k}:${JSON.stringify([b, cueOf(s, b), prof ? profKey : null, prof ? prof.report : null])}`;
        if (key === bodyKey) return;
        const same = bodyKey != null && bodyKey.startsWith(`${k}:`);
        bodyKey = key;
        const fresh = el("div", {}, [tabBody(k)]);
        if (same) ui().morph(body, fresh, { pulse: !quiet });
        else { body.innerHTML = ""; body.append(...fresh.childNodes); }
        body.className = `go-sub-body pv-host ${k === "profile" ? "go-profile" : ""}`.trim();
        const tags = body.querySelector(".go-tags[data-key=tags]");
        if (tags) tags.hidden = !tags.children.length;
      }
      function tabBody(k) {
        if (k === "scouting") {
          const looks = Math.min(3, b.looks || 0);
          const send = el("button", { type: "button", class: "go-btn pv-send", text: looks >= 3 ? "Report Complete" : `Send a Scout · ${b.scout_cost} Points${3 - looks <= 1 ? " · Finishes His Report" : ""}`,
            title: looks >= 3 ? "His report is complete: 3 of 3 looks" : v.points_left < b.scout_cost ? "Not enough scouting points left this week." : ACT_TIPS.scout });
          if (looks >= 3 || !b.can_scout || v.points_left < b.scout_cost || b.scene) send.disabled = true;
          send.addEventListener("click", () => pick(b, "scout", send));
          // until his profile arrives the cards say so (a scouted recruit never reads "Not Scouted" while it loads)
          if (!prof && b.looks) return PV().grid(["Scouting Report", "Attributes"].map((t) => PV().card(t, [el("p", { class: "muted go-loading", text: "Loading his report…" })], { key: t === "Attributes" ? "attributes" : "report", cls: "pv-loading" })));
          return PV().grid(scoutCards(s, b, prof, { send: b.signed || b.committed === me ? null : send, link: true }));
        }
        if (k === "profile") return profileCards(s, b, me, prof);
        if (k === "history") return historyCards(s, b, me);
        return overviewCards(s, b, me, prof);
      }
      function showSub(k) {
        view.sub = k;
        bodyKey = null;
        fill(false);                 // a sub-tab switch swaps the body at once: no fade (the player's ask: no motion on navigation)
        syncBoard();
      }
    }
    // the pitch on the step (Message, Offer): the lead-with pill (leadPicker), his known priorities first, then a topic he
    // brought up this week, then the rest; the pick lasts the visit (view.pitch)
    function pitchSelect(b) {
      const cued = cueOf(s, b).topics;
      const order = [...b.priorities_known, ...cued.filter((t) => !b.priorities_known.includes(t)), ...Object.keys(PITCH_NAMES).filter((t) => !b.priorities_known.includes(t) && !cued.includes(t))];
      const first = view.pitch[b.id] && order.includes(view.pitch[b.id]) ? view.pitch[b.id] : order[0];
      return leadPicker(b, { id: "rc-pitch", order, current: first, cueTopics: cued, cueTip: cueOf(s, b).title, onPick: (t) => { view.pitch[b.id] = t; } });
    }
    // Message, Offer… and Raise NIL… happen here, under the head: the pitch (not for a raise), the NIL points (not for a message)
    function stepView(b, kind) {
      const st = el("div", { class: "go-step", role: "group", "aria-label": kind === "message" ? `Message ${b.name}` : kind === "offer" ? `Offer ${b.name}` : `Raise your NIL offer to ${b.name}` });
      st.append(el("div", { class: "card-bar" }, [el("div", { class: "go-kicker", text: kind === "message" ? "Message · 5 Hours" : kind === "offer" ? "Offer · No Hours" : "Raise NIL · No Hours" })]));
      const pitch = kind === "raise_nil" ? null : pitchSelect(b);
      if (pitch) st.append(el("div", { class: "go-lead-field" }, [el("span", { class: "small", text: "Your Pitch" }), pitch]));
      let nil = null;
      if (kind !== "message") {
        const ask = askWord(b);
        const start = kind === "offer" ? (b.ask ? (b.ask.exact != null ? b.ask.exact : b.ask.lo) : 0) : Math.max((b.nil || 0) + 5, b.ask && b.ask.exact != null ? b.ask.exact : 0);
        nil = el("input", { type: "number", id: "rc-nil", class: "go-nil", min: String(kind === "offer" ? 0 : (b.nil || 0) + 5), step: "5", value: String(start) });
        st.append(el("label", { for: "rc-nil" }, [el("span", { class: "small", text: `NIL Points · ${kind === "offer" ? (ask ? `He wants ${ask}` : "No ask known yet") : `Your offer is ${b.nil || 0}${ask ? ` · he wants ${ask}` : ""}`}` }), nil]));
        if (kind === "offer") st.append(el("p", { class: "muted small", text: "Well under what he wants reads as a lowball, and some recruits take offense sooner." }));
      }
      const go = el("button", { type: "button", class: "go-btn primary go-step-go", text: kind === "message" ? "Send" : kind === "offer" ? "Offer" : "Raise" });
      const cancel = el("button", { type: "button", class: "go-btn go-step-cancel", text: "Cancel" });
      go.addEventListener("click", async () => {
        const r = await run(b, kind, pitch ? pitch.value : null, nil ? Number(nil.value) || 0 : null, go);
        // the step closed with the action: the Recruit button takes the focus (unless a call's window opened meanwhile and holds it)
        if (r && !view.step && !sceneWin) { const btn = box.querySelector("#rc-recruit"); if (btn) btn.focus({ preventScroll: true }); }
      });
      // Cancel is the player's own dismissal: the step leaves at once (an action's close fades it)
      cancel.addEventListener("click", () => { view.step = null; st.remove(); patchPane(b); const btn = box.querySelector("#rc-recruit"); if (btn) btn.focus({ preventScroll: true }); });
      st.append(el("div", { class: "go-step-acts" }, [go, cancel]));
      return st;
    }
    // a call or in-home visit as a conversation in its window (coach_career/scenes.py): the turns so far (you, him, the
    // room), then your opening (three things, Present), which brings his reaction, your question and his cue in place;
    // then his question when he has one, what you lead with, Pitch. His reaction to the pitch joins the conversation
    // and Done closes the window for good. The other actions wait until you pitch; hanging up only closes the window
    // (Finish in the pane's head reopens it). `win`: the window's record (openSceneWindow).
    const MAX_PRESENT = 3;
    function sceneView(b, win) {
      const scene = b.scene, visit = scene.action === "hc_visit", what = visit ? "visit" : "call";
      // the cue's topics he has not ruled out (a Not His Thing never leads, and loses its hint star)
      const liveCue = (sc) => ((sc.cue && sc.cue.topics) || []).filter((t) => (markOf(b, t) || {}).mark !== "not_his");
      let chosen = liveCue(scene)[0] || b.priorities_known[0] || "";   // he summed up all three: lead with what he told you first
      const sc = el("section", { class: "go-scene", tabindex: "-1", "aria-label": `${visit ? "In-home visit" : "Call"} with ${b.name}` });
      sc.append(el("div", { class: "card-bar go-scene-head" }, [el("div", { class: "go-scene-who" }, [avatar(b.id), el("div", { class: "go-kicker", text: `${visit ? (b.portal ? "Face to Face" : "In His Home") : "On the Phone"} · ${b.name}` })])]));
      // the turns: yours right in a muted bubble, his left, a note (who decides, his NIL ask, pestering) centered and plain; the cue keeps its frame
      const convo = el("div", { class: "go-scene-lines go-convo", role: "log", "aria-label": `The ${what}` });
      const turnEl = (t) => {
        const cue = !!(scene.cue && t.who === "him" && t.text === scene.cue.text);
        const p = el("p", { class: `go-scene-line go-turn ${t.who} ${cue ? "cue" : ""} ${t.who === "note" ? "room" : ""}`,
          ...(cue ? { title: "The cue: what he is telling you he cares about" } : {}) });
        if (t.who === "you") p.append(el("span", { class: "go-turn-who", text: "You:" }), " ");
        else if (t.who === "family" && t.label) p.append(el("span", { class: "go-turn-who", text: `${t.label}:` }), " ");   // the one who decides speaks, under their label
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
      // the window's body scrolls: what just came in is brought into view (its top first when it is taller than the window)
      const reveal = (from, to) => {
        const bx = sc.closest(".modal-body");
        if (!bx || !from) return;
        const r0 = from.getBoundingClientRect(), r1 = (to || from).getBoundingClientRect(), br = bx.getBoundingClientRect();
        const down = Math.min(r1.bottom - br.bottom + 12, r0.top - br.top - 12);
        if (down > 0) bx.scrollTo({ top: bx.scrollTop + down, behavior: still() ? "auto" : "smooth" });
      };
      // the stale case: the week moved on under the open window; it closes and the board shows where things stand
      const lapsed = () => {
        view.scene = null;
        if (sceneWin === win) H.closeTop();
        refresh(s, box);
      };
      const HANG_HINT = `Hanging up keeps the ${what} open: Finish the ${visit ? "Visit" : "Call"} in his pane brings it back this week. One you never finish counts for nothing.`;
      const PITCH_TIP = "Sell him on this: it costs nothing more, the hours went when you picked up";
      // ----- after your opening: his question, what you lead with, Pitch and Hang Up -----
      function drawFinish(animate) {
        const q = scene.question;
        const pending = () => !!(q && !q.answer);
        const parts = [];
        if (q) parts.push(questionView(b, scene));
        parts.push(el("div", { class: "go-kicker muted", text: "What You Lead With" }),
          leadPicker(b, { current: chosen, onPick: (t) => { chosen = t; view.pitch[b.id] = t; }, cueTopics: scene.cue.topics, cueTip: cueTitle(scene.action), locked: pending() }));
        const go = el("button", { type: "button", class: "go-btn primary", text: "Pitch", title: pending() ? "Answer him first" : PITCH_TIP });
        go.disabled = pending();
        // his question answered: the pitch and its radios open up in place
        sc._unlock = () => {
          go.disabled = false;
          go.title = PITCH_TIP;
          const jb = sc.querySelector(".go-promise-job");
          if (jb && !(q && q.answer === "promise")) jb.hidden = false;   // answered with a promise: that was the promise
          for (const r of sc.querySelectorAll(".go-lead-chip")) r.disabled = false;
        };
        go.addEventListener("click", async () => {
          if (pending()) { H.toast("Answer him first.", 3000); return; }
          if (!chosen) { H.toast("Pick what you lead with first: what you are selling him.", 3000); return; }
          const r = await ui().busy(go, act(s, b.id, "pitch", chosen, null, { silent: true, scene: scene.id, onReaction: (re) => {
            view.heard[`${s.id}:${b.id}`] = { week: s.current_week, topics: scene.cue.topics, action: scene.action };
            b.scene = null;
            win.done = true;
            H.retoken(sc, null);         // finished: a refresh never reopens it
            if (re.revealed && !b.priorities_known.includes(re.revealed)) b.priorities_known.push(re.revealed);   // he told you: known now, not at the re-fetch
            noteMark(b, chosen, MARK_OF[re.kind], scene.action, s.current_week);
            // the board's current row for him (a re-fetch may have replaced b) learns the same, and the pane behind the
            // window shows it at once: the call is over, what he told you is known
            const row = v.board.find((x) => x.id === b.id);
            if (row && row !== b) { row.scene = null; if (re.revealed && !row.priorities_known.includes(re.revealed)) row.priorities_known.push(re.revealed); noteMark(row, chosen, MARK_OF[re.kind], scene.action, s.current_week); }
            patchShown(row || b);
            ui().toast(`Pitch: ${PITCH_NAMES[chosen] || chosen} · ${REACTION_WORDS[re.kind] || re.kind}`);
            // the conversation ends in the window: your line and his reaction join it, the buttons give way to Done;
            // closing the window ends it for good (the pane never shows it)
            scene.turns.push({ who: "you", text: re.you || PITCH_NAMES[chosen] });
            scene.turns.push({ who: re.kind === "tired" ? "note" : "him", text: re.text });
            const added = addTurns(true);
            const last = added[added.length - 1];
            last.classList.add("go-reaction", re.kind);
            last.dataset.kind = re.kind;
            last.setAttribute("role", "status");
            last.tabIndex = -1;
            // what you led with stays on record (the pill locked); Pitch and Hang Up give way to Done
            for (const r of fin.querySelectorAll(".go-lead-chip")) r.disabled = true;
            const done = el("button", { type: "button", class: "go-btn primary go-scene-close", text: "Done", onclick: () => { if (sceneWin === win) H.closeTop(); } });
            acts.replaceChildren(done, el("span", { class: "muted small go-scene-done", text: "It counts at the week step." }));
            hint.textContent = `The ${what} is over. Closing this window ends it; his History keeps a line.`;
            if (sceneWin === win) { done.focus({ preventScroll: true }); reveal(added[0], hint); }
            // the board behind the window catches up in place (unless it has moved on: another career, a new week, another tab)
            if (boardAt && boardAt.box === box && boardAt.s.id === s.id && boardAt.s.current_week === s.current_week && box.isConnected) refresh(s, box);
          } }));
          if (!r) lapsed();     // a stale call (the week moved on)
        });
        const hang = el("button", { type: "button", class: "go-link go-hangup", text: "Hang Up", onclick: hangUp });
        // Promise Him the Job (the player's ask): asked or not, once per recruit; hidden while his question about a
        // named player waits (answering it is the promise)
        const asking = q && !q.answer && (q.kind === "roster" || q.kind === "recruit");
        const job = !b.job_promised && !scene.job ? el("button", { type: "button", class: "go-btn go-promise-job", text: "Promise Him the Job",
          title: "Tell him the starting job is his: it helps land him, and it's a promise he'll hold you to all season" }) : null;
        if (job && asking) job.hidden = true;              // his question first: answered, it shows (sc._unlock)
        if (job) job.addEventListener("click", async () => {
          let r;
          try { r = await ui().busy(job, H.api(`/api/season/${s.id}/recruit`, H.postJSON({ pid: b.id, action: "promise_job", scene: scene.id }))); }
          catch (err) { H.toast(`Could not promise: ${H.errText(err)}`, 4000); return; }
          if (!(r && r.scene)) { lapsed(); return; }
          Object.assign(scene, r.scene);
          b.job_promised = true;
          const row = v.board.find((x) => x.id === b.id);
          if (row) row.job_promised = true;
          const added = addTurns(true);
          await ui().fadeOut(job);
          job.remove();
          ui().toast(r.points > 0 ? "Promise: the job is his. He bought it." : r.doubted ? "Promise: he doesn't believe you." : "Promise: he isn't buying it.");
          if (sceneWin === win && added[0]) reveal(added[0]);
        });
        const acts = el("div", { class: "go-row wrap go-scene-acts" }, [go, job, hang]);
        const hint = el("p", { class: "muted small", text: HANG_HINT });
        parts.push(acts, hint);
        const fin = el("div", { class: "go-scene-finish" }, parts);
        tail.append(fin);
        if (animate) ui().fadeIn(fin);
        return fin;
      }
      // hanging up closes the window and keeps the call open (sceneClosed puts Finish in the pane and focuses it)
      function hangUp() {
        if (sceneWin === win) H.closeTop();
      }
      // ----- your opening: three things about your program, then Present -----
      function drawOpening() {
        const picked = new Set();
        const wrap = el("div", { class: "go-opening", role: "group", "aria-label": "Your opening" });
        const count = el("span", { class: "go-present-count muted small", role: "status", text: `0 of ${MAX_PRESENT}` });
        const go = el("button", { type: "button", class: "go-btn primary go-present", text: "Present", title: `Pick ${MAX_PRESENT} things first` });
        go.disabled = true;
        // your pitch (the player's ask): every topic as a card in one row that scrolls sideways, as the lead-with does, so
        // it never grows the window; pick three (each outlined), then Present
        const chips = el("div", { class: "go-lead go-opening-strip go-present-chips", role: "group", "aria-label": "Three things about your program" });
        const byTopic = {};
        const sync = () => {
          for (const [t, chip] of Object.entries(byTopic)) { chip.classList.toggle("on", picked.has(t)); chip.setAttribute("aria-pressed", String(picked.has(t))); }
          count.textContent = `${picked.size} of ${MAX_PRESENT}`;
          go.disabled = picked.size !== MAX_PRESENT;
          go.title = go.disabled ? `Pick ${MAX_PRESENT} things first` : "Tell him what your program is about, then ask him what he is looking for";
        };
        for (const t of Object.keys(PITCH_NAMES)) {
          const sv = b.strength ? b.strength[t] : null, word = caseWord(b, t);
          const tone = sv == null ? "" : sv >= 0.6 ? "good" : sv < 0.25 ? "bad" : "";
          const chip = el("button", { type: "button", class: "go-lead-chip go-present-chip", "data-topic": t, "aria-pressed": "false",
            title: word ? `Your program's case on ${PITCH_NAMES[t].toLowerCase()}: ${word.toLowerCase()}.` : "" },
            [el("b", { class: "go-lead-topic", text: PITCH_NAMES[t] }), el("span", { class: "go-chip-tags" }, [word ? el("span", { class: `go-tag ${tone}`, text: word }) : null, markTag(b, t)])]);
          byTopic[t] = chip;
          chip.addEventListener("click", () => {
            if (picked.has(t)) picked.delete(t);
            else if (picked.size >= MAX_PRESENT) { H.toast(`Three things. Drop one first.`, 3000); return; }
            else picked.add(t);
            sync();
            if (picked.size === MAX_PRESENT) go.focus({ preventScroll: true });
          });
          chips.append(chip);
        }
        go.addEventListener("click", async () => {
          if (picked.size !== MAX_PRESENT) { H.toast(`Pick ${MAX_PRESENT} things first.`, 3000); return; }
          let r;
          try { r = await ui().busy(go, H.api(`/api/season/${s.id}/recruit`, H.postJSON({ pid: b.id, action: "present", scene: scene.id, topics: [...picked] }))); }
          catch (err) { H.toast(`Could not present: ${H.errText(err)}`, 4000); return; }
          if (!(r && r.scene)) { lapsed(); return; }     // a stale call (the week moved on)
          Object.assign(scene, r.scene);               // the same scene object: the board row and the view share it
          chosen = liveCue(scene)[0] || b.priorities_known[0] || "";
          for (const t of picked) noteMark(b, t, "no_read", scene.action, s.current_week);   // your opening's three: pitched, no read on any one
          // the opening leaves, the new turns come in, then his question and the lead-with: all in place
          await ui().fadeOut(wrap);
          const added = addTurns(true);
          drawFinish(true);
          const first = added[0];
          if (first && sceneWin === win) { first.tabIndex = -1; first.focus({ preventScroll: true }); reveal(first); }
        });
        wrap.append(el("div", { class: "go-kicker muted", text: "Your Opening" }),
          el("p", { class: "muted small", text: "Three things you lead your program with. Then you ask him what he is looking for." }),
          chips,
          el("div", { class: "go-row wrap go-scene-acts" }, [go, count, el("button", { type: "button", class: "go-link go-hangup", text: "Hang Up", onclick: hangUp })]),
          el("p", { class: "muted small", text: HANG_HINT }));
        tail.append(wrap);
      }
      if (scene.presented) drawFinish(false); else drawOpening();
      return sc;
    }
    // his question in the scene (docs/superpowers/specs/2026-10-29-recruit-questions-design.md, section 3): his line, three answers
    // while it waits (straight, a promise, a sidestep: a Title Case label over the line you say), his reply once you answered; the reply is the feedback, there is no toast
    function questionView(b, scene) {
      const q = scene.question;
      const wrap = el("div", { class: "go-question", role: "group", "aria-label": `${b.name} asks` });
      wrap.append(el("div", { class: "card-bar" }, [el("div", { class: "go-kicker", text: "He Asks" })]),
        el("p", { class: "go-question-line" }, [el("q", { text: q.text }), el("span", { class: "muted small", text: ` — ${b.name}` })]));
      // his reply's tone: a straight answer or a promise he believes reads good, a promise he has heard before bad, a sidestep muted
      const replyTone = (qq) => (qq.answer === "deflect" ? "muted" : qq.answer === "promise" && (qq.truthful === false || qq.reply === HOLLOW_REPLY) ? "bad" : "good");
      const replyView = (qq) => el("p", { class: `go-question-reply ${replyTone(qq)}`, role: "status", tabindex: "-1", text: qq.reply || "" });
      if (q.answer) { wrap.append(replyView(q)); return wrap; }
      // a Package Deal's question carries its own three answers (about his mate: by whether you have offered him); the rest use the tables
      const copy = ANSWER_COPY[q.kind] || ANSWER_COPY.roster, own = q.answers || {};
      const acts = el("div", { class: "go-row wrap go-answers" }, ANSWERS.map((k) => {
        const btn = el("button", { type: "button", class: "go-btn go-answer", "data-answer": k }, [el("b", { class: "go-answer-label", text: (own[k] || {}).label || ANSWER_LABELS[k] }), el("q", { class: "muted small go-answer-line", text: (own[k] || {}).text || copy[k] })]);
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
    // what you lead with, as a strip that scrolls sideways (the player's ask: it never grows the window): one card per
    // topic, its name over its tags: ★ (a known priority) or ☆ (what he brought up: `cueTopics`, titled `cueTip`), your
    // program's case in a word and the mark of what he said when you pitched it (markTag). The picked card is outlined.
    // `locked`: his question waits, the cards are disabled until you answer. The strip carries the pick as `.value` and
    // data-value.
    function leadPicker(b, opts) {
      const { order = Object.keys(PITCH_NAMES), cueTopics = [], cueTip = "", locked = false, onPick = () => {}, id } = opts;
      let value = opts.current || "";
      const drop = el("div", { class: "go-lead", role: "radiogroup", "aria-label": `Pitch to ${b.name}`, ...(id ? { id } : {}) });
      const set = (t) => {
        value = t;
        drop.value = t;
        drop.dataset.value = t;
        for (const c of drop.children) { const yes = c.dataset.topic === t; c.classList.toggle("on", yes); c.setAttribute("aria-checked", String(yes)); c.tabIndex = yes || (!t && c === drop.firstElementChild) ? 0 : -1; }
      };
      for (const t of order) {
        const ruled = (markOf(b, t) || {}).mark === "not_his";         // he said it's not his thing: no hint star on it
        const known = b.priorities_known.includes(t), cue = !known && !ruled && cueTopics.includes(t);
        const sv = b.strength ? b.strength[t] : null, word = caseWord(b, t);
        const tone = sv == null ? "" : sv >= 0.6 ? "good" : sv < 0.25 ? "bad" : "";
        const tag = [known ? "★" : cue ? "☆" : null, word || null].filter(Boolean).join(" ");
        const chip = el("button", { type: "button", role: "radio", "aria-checked": "false", class: `go-lead-chip${known ? " known" : ""}${cue ? " cue" : ""}`, "data-topic": t,
          title: sv == null ? "" : known && sv < 0.25 ? "He cares about this and you are weak here: pitching it backfires." : `Your program's case on ${PITCH_NAMES[t].toLowerCase()}: ${word.toLowerCase()}.` },
          [el("b", { class: "go-lead-topic", text: PITCH_NAMES[t] }), el("span", { class: "go-chip-tags" }, [
            tag ? el("span", { class: `go-tag ${tone}`, text: tag, ...(cue ? { title: cueTip } : known ? { title: "He told you he cares about this." } : {}) }) : null, markTag(b, t)])]);
        chip.addEventListener("click", () => { set(t); onPick(t); chip.scrollIntoView({ block: "nearest", inline: "nearest" }); });
        drop.append(chip);
      }
      // arrows move the pick along the strip, as a radio group does
      ui().on(drop, "keydown", (e) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!step) return;
        const cs = [...drop.children], at = Math.max(0, cs.findIndex((c) => c.dataset.topic === value));
        const next = cs[(at + step + cs.length) % cs.length];
        if (!next || next.disabled) return;
        e.preventDefault();
        next.click();
        next.focus({ preventScroll: true });
      });
      set(value);
      for (const c of drop.children) c.disabled = !!locked;
      const on = drop.querySelector(".go-lead-chip.on");
      if (on) requestAnimationFrame(() => { drop.scrollLeft = Math.max(0, on.offsetLeft - drop.offsetLeft - 8); });
      return drop;
    }
  }

  // a need's hover: in the portal, your signed high school class is on next year's roster, so it is named apart from
  // the players returning and the commits are transfers (never "0 committed" with a class signed)
  function needTitle(g, r, short) {
    const who = r.portal
      ? `${r.back - (r.signees || 0)} returning · ${r.signees || 0} signed from high school · ${r.commits} transfer commit${r.commits === 1 ? "" : "s"}`
      : `${r.back} coming back · ${r.commits} committed (${r.firm} hard)`;
    return `${g}: ${r.target} on a healthy roster · ${who} · ${r.board} on your board · ${r.offers} offers out · ${short ? `${r.need} still to fill` : "covered"}`;
  }

  // ----- Prospects ---------------------------------------------------------------------------------
  // The class as a database (web/prospects.css), built from the player's mockup: the header (Prospects · Class of YYYY, a
  // count line, the class by star level), then the list card (Your Needs chips, the filters, the table) beside a side column
  // (Your Footprint with the game's map, Class Outlook: your commits of the spots and by star level as plain counts, never a
  // target; Top Uncommitted). A filter, the page or a board toggle patches in place: the rows are reconciled by id and the
  // side cards morphed; only opening the tab draws it whole. The address keeps the filters and the page (applyProspects).
  const INTEREST_TONE = { High: "good", Medium: "warn", Low: "bad" };
  const POT_TONE = { "All-American": "good", Elite: "good", Strong: "", Solid: "", Fair: "muted", Weak: "muted" };
  const num = (n) => Number(n || 0).toLocaleString("en-US");
  const PER_PAGE = 50;
  // his status in a few words: Uncommitted, Verbal: School, Hard Commit: School, Signed: School (the server's name for the school)
  function statusShort(r, me) {
    const school = r.school_name || (r.signed || r.committed ? teamName(r.signed || r.committed) : "");
    if (r.pro) return ["Went Pro", "muted"];
    if (r.quiet) return ["Quiet", "muted"];
    if (r.signed) return [r.signed === "FCS" ? "Signed: FCS Program" : `Signed: ${school}`, r.signed === me ? "good" : ""];
    if (r.committed) return [`${r.hard ? "Hard Commit" : "Verbal"}: ${school}`, r.committed === me ? "good" : "warn"];
    if (r.leaning_fcs) return ["Leaning FCS", "muted"];
    return ["Uncommitted", ""];
  }
  const potText = (p) => (!p ? "Not Read" : p[0] === p[1] ? p[0] : `${p[0]} – ${p[1]}`);
  // his looks in the Scouting Center's words: Not Yet, 1 of 3 Looks, Fully Scouted
  const looksText = (n) => (n >= 3 ? ["Fully Scouted", "good"] : n > 0 ? [`${fmtLooks(n)} of 3 Looks`, "warn"] : ["Not Yet", "muted"]);
  const boardLabel = (r) => `${r.on_board ? "Remove" : "Add"} ${r.name} ${r.on_board ? "from" : "to"} your board`;

  async function renderProspects(s, box) {
    const f = view.filters;
    const me = s.team;
    box.innerHTML = "";
    box.classList.add("pr-page");
    const year = (s.year || 2026) + 1;
    const inPortal = !!(s.offseason_stage && /^portal/.test(s.offseason_stage)) || !!view.portal;
    // what the side column and the map read; kept between patches
    const ctx = { summary: null, board: null, rows: [], total: 0, portal: inPortal };

    // the header: the title, one count line, the class by star level
    const title = el("h2", { class: "go-display l pr-title", text: inPortal ? `Transfer Portal · ${year}` : `Prospects · Class of ${year}` });
    const countLine = el("p", { class: "muted pr-count", text: "Loading the class…" });
    const meters = el("div", { class: "pr-meters", role: "group", "aria-label": "The class by star level" });
    box.append(el("header", { class: "pr-head" }, [el("div", { class: "pr-head-text" }, [title, countLine]), meters]));

    // the list card: Your Needs, the filters, the table, the pager
    const needsBox = el("div", { class: "pr-needs", role: "group", "aria-label": "Your needs" });
    const q = el("input", { type: "search", class: "pr-search", placeholder: "Search by name", value: f.q, "aria-label": "Search by name" });
    let qTimer = null;
    q.addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(() => { f.q = q.value; view.offset = 0; load(); }, 250); });
    const sels = {};
    const mk = (key, opts, label) => {
      const sel = el("select", { class: "go-sel pr-sel", "aria-label": label }, opts.map(([v, t]) => el("option", { value: v, text: t })));
      sel.value = key === "status" && f.status === "recommended" ? "" : f[key];
      sel.addEventListener("change", () => { f[key] = sel.value; view.offset = 0; syncFilters(); load(); });
      sels[key] = sel;
      return sel;
    };
    const recBtn = el("button", { type: "button", class: "go-chip pr-rec", text: "Recommended for You",
      title: "The prospects the Auto-recruit rules would put on your board this week: your states, your star level, the positions you need. A base to build a board from." });
    recBtn.addEventListener("click", () => { f.status = f.status === "recommended" ? "" : "recommended"; view.offset = 0; syncFilters(); load(); });
    const filters = el("div", { class: "go-filters rc-filters pr-filters" }, [q, recBtn,
      mk("position", [["", "Any Position"], ...POSITIONS.map((p) => [p, p])], "Position"),
      mk("stars", [["", "Any Stars"], ["5", "5 Stars"], ["4", "4 Stars"], ["3", "3 Stars"], ["2", "2 Stars"]], "Stars"),
      mk("state", [["", "Any State"], ...STATES.map((c) => [c, c])], "Home state"),
      mk("status", STATUS, "Status"),
      mk("sort", PR_SORT_OPTS.map(([v, t]) => [v, `Sort: ${t}`]), "Sort")]);
    // the filters' look follows the view (a chip, a state tapped on the map, View All): no redraw
    function syncFilters(withSearch) {
      const rec = f.status === "recommended";
      recBtn.classList.toggle("on", rec);
      recBtn.setAttribute("aria-pressed", String(rec));
      for (const [k, sel] of Object.entries(sels)) { const want = k === "status" && rec ? "" : k === "sort" ? f.sort.replace(/^-/, "") : f[k]; if (sel.value !== want) sel.value = want; }
      syncSortHeads();
      if (withSearch && q.value !== f.q) q.value = f.q;      // only View All clears the search box; a pending search is folded in by load()
    }
    const listHead = el("div", { class: "go-row wrap go-list-head pr-list-head" });
    const HEADS = [["rank", "#"], ["who", "Prospect"], ["pos", "Pos"], ["ht", "Ht"], ["wt", "Wt"], ["stars", inPortal ? "Class" : "Stars"],
      ["status", "Status"], ["int", "Interest in You"], ["sc", "Scouted"], ["pot", "Potential"], ["act", "Board"]];
    // a column's header sorts by it (the player's ask); again, the other way. The Sort menu follows.
    const sortHead = (k, t) => {
      const key = HEAD_SORT[k];
      if (!key) return el("th", { scope: "col", class: `pr-c-${k}`, text: t, ...(k === "act" ? { "aria-label": "Your Board" } : {}) });
      const btn = el("button", { type: "button", class: "pr-sort", "data-sort": key, title: `Sort by ${SORT_WORD[key].toLowerCase()}` },
        [el("span", { text: t }), el("span", { class: "pr-sort-mark", "aria-hidden": "true" })]);
      btn.addEventListener("click", () => {
        f.sort = f.sort === key ? `-${key}` : key;
        view.offset = 0; syncFilters(); load();
      });
      return el("th", { scope: "col", class: `pr-c-${k}`, "data-sort": key }, [btn]);
    };
    const starsHead = sortHead("stars", inPortal ? "Class" : "Stars");
    const thead = el("thead", {}, [el("tr", {}, HEADS.map(([k, t]) => (k === "stars" ? starsHead : sortHead(k, t))))]);
    function syncSortHeads() {
      const base = f.sort.replace(/^-/, ""), down = DESC_FIRST.has(base) !== f.sort.startsWith("-");
      for (const th of thead.querySelectorAll("th[data-sort]")) {
        const on = th.dataset.sort === base;
        th.setAttribute("aria-sort", on ? (down ? "descending" : "ascending") : "none");
        th.querySelector(".pr-sort-mark").textContent = on ? (down ? "▼" : "▲") : "";
        th.classList.toggle("on", on);
      }
    }
    syncFilters();
    const tbody = el("tbody", { class: "rc-list" });
    const table = el("table", { class: "pr-table" }, [thead, tbody]);
    const tableWrap = el("div", { class: "pr-table-wrap" }, [table]);
    // the columns give way when the words do not fit the card (a wide font, a long school name): Ht and Wt, then Scouted and the potential, then
    // the status (the CSS drops them by the card's width too); measured again whenever the card changes width
    function fitTable() {
      const FIT = ["pr-fit-1", "pr-fit-2", "pr-fit-3"];
      table.classList.remove(...FIT);
      for (const c of FIT) { if (!tableWrap.clientWidth || tableWrap.scrollWidth <= tableWrap.clientWidth + 1) break; table.classList.add(c); }
    }
    let fitW = 0;
    if (window.ResizeObserver) new ResizeObserver(() => { if (tableWrap.clientWidth !== fitW) { fitW = tableWrap.clientWidth; fitTable(); } }).observe(tableWrap);
    const empty = el("p", { class: "muted pr-empty", text: "No prospect matches these filters." });
    empty.hidden = true;
    const prev = el("button", { type: "button", class: "go-btn", text: "← Previous" });
    const next = el("button", { type: "button", class: "go-btn", text: "Next →" });
    const pageText = el("span", { class: "muted pr-page-text", text: "" });
    prev.addEventListener("click", () => { view.offset = Math.max(0, view.offset - PER_PAGE); load({ top: true }); });
    next.addEventListener("click", () => { view.offset += PER_PAGE; load({ top: true }); });
    const pager = el("div", { class: "go-pager pr-pager" }, [prev, pageText, next]);
    const main = el("section", { class: "go-card pr-main", "aria-label": "The class" }, [needsBox, filters, listHead, tableWrap, empty, pager]);

    // the side column: Your Footprint, Class Outlook, Top Uncommitted
    const side = el("aside", { class: "pr-side", "aria-label": "Your class at a glance" });
    box.append(el("div", { class: "pr-lay" }, [main, side]));

    function card(kicker, key, right, body) {
      return el("section", { class: "go-card pr-card", "data-key": key, "aria-label": kicker }, [
        el("div", { class: "card-bar pr-card-head" }, [el("h3", { class: "pv-kick pr-kick", text: kicker }), right || null]), ...body]);
    }
    // the map in the footprint card: your areas (shaded where a scout works), your board as dots; a state tap filters
    function drawMap() {
      const v = ctx.board, mapHold = side.querySelector(".pr-map");
      if (!v || !mapHold || !window.USMap || !window.US_STATES) return;
      const team = (window.CFP.teamsBySlug[s.team] || {}).colors;
      const color = (team && team.primary) || "#888";
      const staffed = {};
      for (const m of v.staff || []) if (m.area) staffed[m.area] = staffed[m.area] ? `${staffed[m.area]}, ${m.name}` : m.name;
      const counts = {};
      const dots = [];
      for (const b of v.board || []) {
        const code = b.hometown && b.hometown.state;
        if (code) counts[code] = (counts[code] || 0) + 1;
        const xy = window.USMap.project(b.home) || (code ? window.USMap.centroid(code) : null);
        const sd = standing(b, me);
        if (xy) dots.push({ id: b.id, xy, tone: sd.tone, ring: b.committed === me || b.signed === me, big: !!b.generational, label: `${b.name} · ${b.display_pos || b.position} · ${sd.text}`, name: b.name });
      }
      const svg = window.USMap.render({ areas: v.areas || {}, staffed, dots, counts, selectedState: f.state || null, teamColor: color, zoomKey: `prospects:${s.id}`,
        onDot: (id) => openProfile(s, id), onState: (c) => { f.state = f.state === c ? "" : c; view.offset = 0; syncFilters(); load(); },
        onReset: () => { if (f.state) { f.state = ""; view.offset = 0; syncFilters(); load(); } } });
      svg.style.setProperty("--us-team", color);
      svg.setAttribute("aria-label", "Your footprint: your scouts' areas and your board. Tap a state to filter the list to it");
      mapHold.replaceChildren(svg);
    }
    // the cards' links: drawn with each card (a morph moves their handlers onto the live ones)
    function viewMap() {
      return ui().on(el("button", { type: "button", class: "pr-more", text: "View Map →" }), "click", () => {
        if (!ctx.board) return;
        H.openModal("Your Footprint", mapCard(ctx.board, s, me, { open: true, selectedState: f.state || null,
          onState: (c) => { f.state = f.state === c ? "" : c; view.offset = 0; syncFilters(); H.closeModal(); load(); },
          onDot: (id) => { H.closeModal(); openProfile(s, id); } }));
      });
    }
    function viewAll() {
      return ui().on(el("button", { type: "button", class: "pr-more", text: "View All →" }), "click", () => {
        clearTimeout(qTimer); qTimer = null;
        Object.assign(f, { q: "", position: "", stars: "", state: "", status: "open", sort: "rank", group: "" });
        view.offset = 0; syncFilters(true); load({ top: true });
      });
    }
    const fpStat = (key, label, n) => el("div", { class: "pr-fp-stat", "data-key": key }, [el("b", { text: num(n) }), el("span", { class: "muted", text: label })]);
    function footprintCard(sm) {
      const fp = sm.footprint;
      return card("Your Footprint", "footprint", viewMap(), [el("div", { class: "pr-fp" }, [el("div", { class: "pr-map", "data-keep": "" }),
        el("div", { class: "pr-fp-stats" }, [fpStat("board", "On Board", fp.board), fpStat("contact", "In Contact", fp.contact), fpStat("evaluated", "Evaluated", fp.evaluated)])])]);
    }
    function outlookCard(sm) {
      const o = sm.outlook;
      const fill = o.spots ? Math.max(0, Math.min(1, o.commits / o.spots)) : 0;
      const rows = ctx.portal ? [] : ["5", "4", "3", "2"].map((k) => el("div", { class: "pr-co-row", "data-key": `s${k}` }, [
        el("span", { class: "go-stars", text: stars(Number(k)), "aria-hidden": "true" }), el("span", { class: "pr-co-label", text: `${k}-Star` }),
        el("b", { class: "pr-co-n", text: num(o.by_stars[k]), "aria-label": `${o.by_stars[k]} ${k}-star ${o.by_stars[k] === 1 ? "commit" : "commits"}` })]));
      return card("Class Outlook", "outlook", el("span", { class: "pr-co-total" }, [el("b", { text: `${num(o.commits)} / ${num(o.spots)}` }), el("span", { class: "muted", text: " Commits" })]), [
        el("div", { class: "pv-thin pr-co-bar", role: "img", "aria-label": `${o.commits} of ${o.spots} spots filled` }, [el("i", { style: `width:${Math.round(100 * fill)}%` })]),
        rows.length ? el("div", { class: "pr-co-rows" }, rows) : null,
        el("p", { class: "muted small pr-co-note", text: ctx.portal ? "Your commits against the spots this class still fills." : "Your commits so far, by star level." })]);
    }
    function topCard(sm) {
      const list = el("ol", { class: "pr-top" }, sm.top.map((t) => {
        const b = el("button", { type: "button", class: "pr-top-row", "data-key": t.id, "aria-label": `${t.name}, ${t.display_pos || t.position}, number ${t.national_rank}` }, [
          el("span", { class: "muted pr-top-rank", text: `#${t.national_rank}` }), avatar(t.id, "sm"),
          el("span", { class: "pr-top-id" }, [el("b", { text: t.name }), el("span", { class: "muted small", text: t.display_pos || t.position })]),
          t.portal ? null : el("span", { class: "go-stars", text: stars(t.stars) })]);
        ui().on(b, "click", () => openProfile(s, t.id));
        return el("li", { "data-key": t.id }, [b]);
      }));
      return card("Top Uncommitted", "top", viewAll(), [sm.top.length ? list : el("p", { class: "muted small", text: "Every prospect in the class has committed." })]);
    }
    function drawSide() {
      const sm = ctx.summary;
      if (!sm) return;
      const fresh = el("aside", {}, [footprintCard(sm), outlookCard(sm), topCard(sm)]);
      if (!side.firstChild) { side.append(...fresh.childNodes); drawMap(); }
      else ui().morph(side, fresh);
    }
    function drawHead(d) {
      const sm = d.summary;
      if (!sm) return;
      countLine.textContent = ctx.portal ? `The transfer portal: ${num(sm.total)} ${sm.total === 1 ? "entrant" : "entrants"}.`
        : `The national recruiting database: ${num(sm.total)} ${sm.total === 1 ? "prospect" : "prospects"}.`;
      const m = (key, v, label) => el("div", { class: "pr-meter", "data-key": key }, [el("b", { text: num(v) }), el("span", { class: "muted", text: label })]);
      const fresh = el("div", {}, ctx.portal ? [m("total", sm.total, "Total Entrants")]
        : [m("total", sm.total, "Total Prospects"), ...["5", "4", "3", "2"].map((k) => m(`s${k}`, sm.stars[k], `${k}-Star`))]);
      ui().morph(meters, fresh);
    }
    // Your Needs: a chip per position, the count still to fill or ✓ when it is covered; a tap filters the list to it
    function drawNeeds(detail) {
      const chips = [];
      for (const g of GROUP_ORDER) {
        const r = (detail || {})[g];
        if (!r) continue;
        const short = r.need > 0;
        const b = el("button", { type: "button", class: `go-chip small pr-need ${short ? "short" : "full"} ${f.group === g ? "on" : ""}`, "data-key": g, "aria-pressed": String(f.group === g),
          text: short ? `${g} ${r.need}` : `${g} ✓`, "aria-label": short ? `${g}: ${r.need} still to fill` : `${g}: covered`,
          title: needTitle(g, r, short) });
        ui().on(b, "click", () => { f.group = f.group === g ? "" : g; view.offset = 0; load(); });
        chips.push(b);
      }
      const fresh = el("div", {}, [el("span", { class: "pv-kick pr-needs-label", text: "Your Needs" }), ...chips]);
      ui().morph(needsBox, fresh);
    }

    // a row of the table; a tap anywhere on it (but the board button) opens his Prospect Profile
    function drawRow(r) {
      const [stText, stTone] = statusShort(r, me);
      const pot = r.our_potential;
      const potTone = pot ? (POT_TONE[pot[1]] ?? "") : "muted";
      const [scText, scTone] = looksText(Math.min(3, Number(r.looks) || 0));
      const hw = typeof r.height === "number" ? height(r.height) : (r.height || "—");
      const sub = r.portal ? `${clsWord(r.cls)} · ${r.from_name || ""}`.replace(/ · $/, "") : place(r.hometown);
      const who = el("button", { type: "button", class: "go-list-main pr-who" }, [avatar(r.id, "sm"),
        el("span", { class: "go-list-id" }, [el("b", { text: r.name }), el("span", { class: "muted small", text: sub }),
          badges({ generational: r.generational, find: r.find }, me)])]);
      ui().on(who, "click", () => openProfile(s, r.id));
      const add = el("button", { type: "button", class: `go-btn pr-board ${r.on_board ? "on" : "primary"}`, text: r.on_board ? "✓ On Board" : "+ Board",
        "aria-pressed": String(!!r.on_board), "aria-label": boardLabel(r) });
      // the button patched is the live one the player clicked (e.currentTarget): a reconcile morphs this row onto the
      // row on screen and hands it this handler, so `add` here may be a fresh node that never reached the page
      ui().on(add, "click", (e) => { e.stopPropagation(); toggleBoard(r, e.currentTarget); });
      const tr = el("tr", { class: "go-list-row rc-row pr-row", "data-key": r.id }, [
        el("td", { class: "pr-c-rank muted", text: `#${r.portal && r.portal_rank ? r.portal_rank : r.national_rank}` }),
        el("td", { class: "pr-c-who" }, [who]),
        el("td", { class: "pr-c-pos" }, [el("b", { text: r.display_pos || r.position })]),
        el("td", { class: "pr-c-ht", text: hw }),
        el("td", { class: "pr-c-wt", text: r.weight != null ? String(r.weight) : "—" }),
        el("td", { class: "pr-c-stars" }, [r.portal ? el("span", { text: clsWord(r.cls) || "—" }) : el("span", { class: "go-stars", text: stars(r.stars), "aria-label": `${r.stars} stars` })]),
        el("td", { class: "pr-c-status" }, [el("span", { class: `go-tag ${stTone}`, text: stText, title: stText })]),
        el("td", { class: "pr-c-int" }, [el("span", { class: `go-tag ${INTEREST_TONE[r.interest_level] || ""}`, title: "How much your school appeals to him now, next to other recruits of his star rating", text: r.interest_level || "Low" })]),
        el("td", { class: "pr-c-sc" }, [el("span", { class: `pr-sc ${scTone}`, title: r.looks >= 3 ? "His report is complete: 3 of 3 looks" : r.looks > 0 ? `${fmtLooks(r.looks)} of 3 looks: each look narrows your staff's read` : "No look at him yet: send a scout", text: scText })]),
        el("td", { class: "pr-c-pot" }, [el("span", { class: `go-tag ${potTone}`, title: pot ? `Your staff's read of his potential after ${fmtLooks(r.looks)} of 3 looks` : "Your staff has no read on him yet", text: potText(pot) })]),
        el("td", { class: "pr-c-act" }, [add])]);
      ui().on(tr, "click", (e) => { if (!e.target.closest("button, a, input, select")) openProfile(s, r.id); });
      return tr;
    }
    // + Board / ✓ On Board: the button, the footprint's count and the map follow in place
    async function toggleBoard(r, btn) {
      const want = !r.on_board;
      if (!want && r.offered && !window.confirm(`Take ${r.name} off your board? Your offer to him is pulled too: the NIL points come back to you${r.committed === me && !r.signed ? ", and he decommits from you" : ""}.`)) return;
      const ok = await ui().busy(btn, setBoard(s, r.id, want));
      if (!ok) return;
      r.on_board = want;
      if (!want) r.offered = false;
      btn.textContent = want ? "✓ On Board" : "+ Board";          // the button itself, patched (a morph patches only what is under a node)
      btn.classList.toggle("on", want); btn.classList.toggle("primary", !want);
      btn.setAttribute("aria-pressed", String(want)); btn.setAttribute("aria-label", boardLabel(r));
      ui().pulse(btn);
      ui().toast(want ? `${r.name} is on your board.` : `${r.name} is off your board.`);
      if (ctx.summary) {
        ctx.summary.footprint.board = Math.max(0, ctx.summary.footprint.board + (want ? 1 : -1));
        const changed = ui().morph(side, el("aside", {}, [footprintCard(ctx.summary), outlookCard(ctx.summary), topCard(ctx.summary)]));
        const n = side.querySelector('[data-key="board"] b');
        if (n && !changed.includes(n)) ui().pulse(n);
      }
      fetchBoard();
    }
    function fetchBoard() {
      return H.api(`/api/season/${s.id}/recruiting`).then((v) => { if (!box.isConnected) return; ctx.board = v; drawMap(); }).catch(() => { /* the list works without the map */ });
    }

    // a scouting trip (the Prospect Profile's Send a Scout, the board's Recruit menu, the Scouting Center) lands on his row in
    // place: Scouted and Potential patched and pulsed, nothing else redrawn; the listener goes with the list
    const onScouted = (e) => {
      if (!tbody.isConnected) { document.removeEventListener("cfp:scouted", onScouted); return; }
      const d = e.detail || {}, r = ctx.rows.find((x) => x.id === d.pid);
      if (!r) return;
      const first = !(Number(r.looks) > 0);
      if (d.looks != null) r.looks = d.looks;
      if ("potential" in d) r.our_potential = d.potential;
      r.scouted = r.looks >= 3;
      const tr = tbody.querySelector(`tr.pr-row[data-key="${CSS.escape(r.id)}"]`);
      if (tr) { ui().morph(tr, drawRow(r)); for (const c of [".pr-c-sc .pr-sc", ".pr-c-pot .go-tag"]) { const n = tr.querySelector(c); if (n) ui().pulse(n); } }
      if (first && r.looks > 0 && ctx.summary) { ctx.summary.footprint.evaluated += 1; drawSide(); }     // his first look: Your Footprint's Evaluated count
    };
    document.addEventListener("cfp:scouted", onScouted);

    let seq = 0;
    async function load(opts = {}) {
      if (qTimer) { clearTimeout(qTimer); qTimer = null; if (f.q !== q.value) { f.q = q.value; view.offset = 0; } }   // a search still typing joins this load
      // the filters and the page in the address (a replace), while the Prospects tab is the view on screen
      if (box.isConnected && !box.closest("[hidden]") && window.CFP.route) window.CFP.route.set({ ppos: f.position, pstars: f.stars, pstate: f.state, pstatus: f.status,
        psort: f.sort !== "rank" ? f.sort : null, pgroup: f.group, ppage: view.offset ? Math.floor(view.offset / PER_PAGE) + 1 : null });
      const params = new URLSearchParams({ offset: view.offset, limit: PER_PAGE });
      for (const [k, v] of Object.entries(f)) if (v) params.set(k, v);
      const mine = ++seq;
      main.setAttribute("aria-busy", "true");
      let d;
      try { d = await H.api(`/api/season/${s.id}/prospects?${params}`); }
      catch (err) { if (mine === seq) { main.removeAttribute("aria-busy"); ui().toast(`Could not load the class: ${H.errText(err)}`, { ms: 4000, kind: "error" }); } return; }
      if (mine !== seq || !box.isConnected) return;
      main.removeAttribute("aria-busy");
      const portalRows = d.rows.some((r) => r.portal);
      if (portalRows && !ctx.portal) {                          // the summary may predate the portal
        ctx.portal = view.portal = true;
        title.textContent = `Transfer Portal · ${year}`;
        starsHead.textContent = "Class";
      }
      ctx.summary = d.summary || null;
      ctx.rows = d.rows;
      ctx.total = d.total;
      drawHead(d);
      drawNeeds(d.needs);
      drawSide();
      const rec = f.status === "recommended";
      const bits = [el("p", { class: "muted small", text: rec ? `${num(d.total)} recommended · the prospects the Auto-recruit rules would chase for a program like yours, best fit first`
        : ctx.portal ? `${num(d.total)} entrants · portal rankings · no stars on a transfer: his film is his rating`
        : `${num(d.total)} prospects · national rankings · hidden prospects appear once your staff scout their area` })];
      const off = d.rows.filter((r) => !r.on_board);
      if (rec && off.length) {
        const all = el("button", { type: "button", class: "go-btn", "data-key": "add-all", text: `Add These ${off.length} to Your Board` });
        ui().on(all, "click", async (e) => {
          const added = await ui().busy(e.currentTarget, (async () => { let n = 0; for (const r of off) if (await setBoard(s, r.id, true)) { r.on_board = true; n++; } return n; })());
          ui().toast(added === 1 ? "He is on your board." : "They are on your board.");
          fetchBoard();
          load();
        });
        bits.push(all);
      }
      ui().morph(listHead, el("div", {}, bits));
      ui().reconcile(tbody, d.rows, "id", drawRow, (n, r) => ui().morph(n, drawRow(r)));
      fitTable();
      empty.hidden = d.rows.length > 0;
      table.hidden = !d.rows.length;
      prev.disabled = view.offset <= 0;
      next.disabled = view.offset + PER_PAGE >= d.total;
      pageText.textContent = `${d.total ? num(view.offset + 1) : 0}–${num(Math.min(d.total, view.offset + PER_PAGE))} of ${num(d.total)}`;
      if (opts.top) { tableWrap.scrollTop = 0; if (main.getBoundingClientRect().top < 0) main.scrollIntoView({ block: "start", behavior: "auto" }); }
    }
    fetchBoard();
    load();
  }

  // A grade's tooltip floats over the page (fixed to the screen), below the grade when there is
  // room and above it when not, kept inside the screen, so the profile window never clips or scrolls it.
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".go-tip")) document.querySelectorAll(".go-tip-box.show").forEach((t) => t.classList.remove("show")); });
  // "What it looks like" tooltips on the staff's reads (the Attributes rows and the Potential headline): on each
  // [data-group] cell, opened on hover, focus or tap. The listeners sit on the container and find the cell under the
  // event, so cells morphed or patched later keep working.
  function gradeTips(grid, pid, grades, details) {
    for (const cell of grid.querySelectorAll("[data-group]:not(.go-tip)")) {
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
      cell.setAttribute("data-gtip", "");
      cell.setAttribute("tabindex", "0");
      cell.setAttribute("aria-describedby", tipId);
      cell.append(tip);
    }
  }
  // the grade tooltips' listeners, once, on the document: a card drawn fresh and morphed onto a live one (the pane's cards)
  // keeps the live element, so listeners on the fresh one would be lost; any [data-gtip] cell under the event is the one
  {
    const cellOf = (e) => (e.target && e.target.closest ? e.target.closest("[data-gtip]") : null);
    const tipOf = (c) => c.querySelector(":scope > .go-tip-box");
    const show = (c) => { if (c && tipOf(c)) placeTip(c, tipOf(c)); };
    const hide = (c) => { if (c && tipOf(c)) tipOf(c).classList.remove("show"); };
    const left = (e) => { const c = cellOf(e); if (c && !(e.relatedTarget && c.contains(e.relatedTarget))) hide(c); };
    document.addEventListener("mouseover", (e) => { const c = cellOf(e); if (c && !(e.relatedTarget && c.contains(e.relatedTarget))) show(c); });
    // a cell with focus (tapped on a phone, or reached by the keyboard) keeps its tip when the pointer leaves: a tap's
    // synthetic mouseout would otherwise close it at once; blur, Escape or a tap elsewhere close it
    document.addEventListener("mouseout", (e) => { const c = cellOf(e); if (c && c.contains(document.activeElement)) return; left(e); });
    document.addEventListener("focusin", (e) => show(cellOf(e)));
    document.addEventListener("focusout", left);
    document.addEventListener("click", (e) => show(cellOf(e)));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(cellOf(e)); });
  }
  const placeTip = (cell, tip) => ui().placeTip(cell, tip);     // web/ui.js: clamped to the window and its scrolling box

  // a floating tooltip follows its grade while the page or the profile scrolls, and closes once
  // the grade has scrolled out of sight
  window.addEventListener("scroll", () => {
    for (const t of document.querySelectorAll(".go-tip-box.show:not(.go-info-box)")) {
      const cell = t.closest(".go-tip");
      const r = cell && cell.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) t.classList.remove("show");
      else placeTip(cell, t);
    }
  }, true);

  // ----- the Prospect Profile ----------------------------------------------------------------------

  async function openProfile(s, pid, into, opts = {}) {
    // the window opens at once, saying it is loading, and fills in when his profile arrives: the board pane's view of him
    // (heroOf and the four tabs), without the Recruit menu. The ☆ star puts him on your board or takes him off; once he
    // is on it, Recruit Him on Your Board goes there. With `into` (a profile already open) it refreshes in place.
    // opts.restore: reopened from the address (a refresh): it opens only once he loads, and a prospect who is
    // gone (a bad id) is passed over quietly (false), the view under it standing. opts.sub: the tab to show.
    const fetched = H.api(`/api/season/${s.id}/prospect/${encodeURIComponent(pid)}`);
    if (!into && opts.restore) { try { const x = await fetched; if (!x || !x.public) return false; } catch (err) { return false; } }
    const node = into || el("div", { class: "rc-profile go-profile pv-popup" }, [el("p", { class: "muted rc-loading go-loading", text: "Loading his profile…" })]);
    if (!into) H.openModal("Prospect Profile", node, `profile:${pid}`, { restore: !!opts.restore });
    let p;
    try { p = await fetched; }
    catch (err) { node.innerHTML = ""; node.append(el("p", { class: "muted", text: `Could not open his profile: ${H.errText(err)}` })); return false; }
    const pub = p.public;
    const me = s.team;
    const b = p.row || { ...pub, list: [], looks: p.looks, our_grades: p.our_grades, traits: p.traits, priorities_known: pub.priorities_known };
    let sub = SUBS.some(([k]) => k === opts.sub) ? opts.sub : "overview";
    const name = el("h2", { class: "rc-profile-name pv-name", "data-key": "name", text: pub.name });
    // the board star and, once he is on your board, the way there; signed with you or a hard commit to you, he stays on it
    let on = !!pub.on_board;
    const locked = pub.signed === s.team ? "He signed with you: he stays on your board" : pub.hard && pub.committed === s.team ? "Hard commit: he stays on your board until he signs" : null;
    const star = el("button", { type: "button", class: "go-btn pv-star rc-board-star" });
    const toBoard = el("button", { type: "button", class: "go-btn primary", text: "Recruit Him on Your Board →",
      onclick: () => { view.selected = pid; view.reveal = pid; view.sheet = true; view.group = null; view.state = null; H.closeModal(); H.onChange("recruiting"); } });
    const label = () => {
      star.textContent = on ? "★" : "☆";
      star.setAttribute("aria-pressed", String(on));
      star.setAttribute("aria-label", locked && on ? locked : on ? `Take ${pub.name} off your board` : `Add ${pub.name} to your board`);
      star.title = locked && on ? locked : on ? "On your board: take him off" : "Add him to your board";
      star.disabled = !!(locked && on);
      toBoard.hidden = !on || !!pub.signed;
    };
    label();
    star.addEventListener("click", async () => {
      if (locked && on) return;
      if (on && pub.offered_by_you && !window.confirm(`Take ${pub.name} off your board? Your offer to him is pulled too: the NIL points come back to you${pub.committed === me && !pub.signed ? ", and he decommits from you" : ""}.`)) return;
      star.disabled = true;
      if (await setBoard(s, pid, !on)) { on = !on; H.toast(on ? `${pub.name} is on your board.` : `${pub.name} is off your board.`, 2500); }
      label();
    });
    // the scout button: Send a Scout from here (the board's pane has it in the Recruit menu too)
    const looks = Math.min(3, p.looks || 0), left = 3 - looks;
    const mine = pub.committed === me && !pub.signed;
    const scoutBtn = mine ? el("span", { class: "muted small rc-no-scout", text: "Committed to you: no more looks" })
      : el("button", { type: "button", class: "go-btn", text: left <= 0 ? "Report Complete · 3 of 3 Looks" : `Send a Scout${p.scout_cost != null ? ` · ${p.scout_cost} Points` : ""}${left <= 1 ? " · Finishes His Report" : ""} →`, title: ACT_TIPS.scout });
    const short = !mine && left > 0 && p.points_left != null && p.scout_cost != null && p.points_left < p.scout_cost;
    if (!mine && (left <= 0 || short)) scoutBtn.disabled = true;
    if (short) scoutBtn.title = "Not enough scouting points left this week.";
    if (!mine) scoutBtn.addEventListener("click", async () => { scoutBtn.disabled = true; if (await act(s, pid, "scout")) openProfile(s, pid, node, { sub }); else scoutBtn.disabled = false; });
    const staffBtn = el("button", { type: "button", class: "go-btn", text: "Assign Your Staff →", onclick: () => { H.closeModal(); if (window.CFP.scouting) window.CFP.scouting.want("scouts"); H.onChange("scouting"); } });
    const strip = el("div", { class: "go-subtabs", role: "tablist", "aria-label": "About him" }, SUBS.map(([k, t]) => {
      const btn = el("button", { type: "button", role: "tab", "data-sub": k, "aria-selected": String(k === sub), text: t });
      btn.addEventListener("click", () => { sub = k; draw(); });
      return btn;
    }));
    const body = el("div", { class: "go-sub-body pv-host", role: "tabpanel" });
    function draw() {
      for (const t of strip.children) t.setAttribute("aria-selected", String(t.dataset.sub === sub));
      body.innerHTML = "";
      if (sub === "scouting") {
        const cards = scoutCards(s, b, p, { send: p.ratings ? null : [scoutBtn, p.our_grades ? null : staffBtn] });
        if (p.ratings) cards.push(ratingsCard(p.ratings));
        body.append(PV().grid(cards));
      } else if (sub === "profile") body.append(profileCards(s, b, me, p));
      else if (sub === "history") body.append(historyCards(s, b, me));
      else body.append(overviewCards(s, b, me, p));
    }
    node.innerHTML = "";
    node.append(el("div", { class: "rc-profile-head go-profile-head" }, [heroOf(b, me, { nameNode: name })]),
      el("div", { class: "pv-tabrow" }, [strip, el("div", { class: "pv-acts rc-profile-actions" }, [toBoard, star])]), body);
    draw();
    return true;
  }
  // signed with you: what you got, every attribute now (and at his potential in the title)
  function ratingsCard(r) {
    return PV().card("His Ratings", [el("p", { class: "muted small", text: `${r.overall} overall now, ${r.potential_overall} at his potential · 50 is an average Power 4 starter.` }),
      el("div", { class: "rc-ratings" }, r.attributes.map((a) => el("div", { class: "rating-row" }, [
        el("span", { class: "rating-label", text: a.label }),
        el("div", { class: "rating-bar" }, [el("div", { class: `rating-fill ${a.value >= 75 ? "hi" : a.value >= 55 ? "mid" : ""}`, style: `width:${Math.max(2, Math.min(100, a.value))}%` })]),
        el("b", { class: "rating-num", text: String(a.value), title: `${a.potential} at his potential` })])))], { wide: true, key: "ratings" });
  }

  // ----- every school's class ------------------------------------------------------------------------

  async function renderClasses(s, box) {
    if (!box.firstChild) box.append(loading("Loading every class…"));
    let d;
    try { d = await H.api(`/api/season/${s.id}/classes${view.openClass ? `?school=${view.openClass}` : ""}`); }
    catch (err) { box.innerHTML = ""; box.append(loading(`Could not load the classes: ${H.errText(err)}`)); return; }
    box.innerHTML = "";
    const mine = d.schools.find((c) => c.yours);
    box.append(el("div", { class: "go-filterbar" }, [el("div", { class: "go-display l", text: `Class Rankings · ${(s.year || 2026) + 1}` }),
      el("span", { class: "go-pill", text: d.phase === "Signed" ? `Signed · ${d.fcs} Went to FCS Programs` : d.phase === "Recruiting" ? "Commitments So Far" : "Early Signing Period Done" })]));
    if (mine) box.append(el("div", { class: "go-card go-myclass" }, [el("div", { class: "card-bar" }, [el("div", { class: "go-kicker", text: "Your Class" })]),
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
        el("span", { class: "muted small", text: ` ${"★".repeat(r.stars)} ${r.display_pos || r.position} · #${r.national_rank} · ${place(r.hometown)}${r.signed ? " · signed" : ""}` }),
        r.generational ? genBadge() : null,
        r.find_held === true && r.find === "bust" ? el("span", { class: "go-badge bust-held", text: "Bust Risk: The Read Held", title: "Your staff called him a bust risk and he is one" })
          : r.find_held === true ? el("span", { class: "go-badge gem-held", text: "Gem: The Read Held", title: "Your staff called him a gem and he is one" })
          : r.find_held === false ? el("span", { class: "go-badge gem-missed", text: "The Read Was Off", title: "Your staff's read on him did not hold up" }) : null]))));
      list.append(li);
    }
    box.append(list);
    if (!d.schools.some((x) => x.count)) box.append(el("p", { class: "muted", text: "No school has a commitment yet. They come over the fall; advance a few weeks and check back." }));
    function starLine(st) { return ["5", "4", "3", "2"].filter((k) => st[k]).map((k) => `${st[k]}×${k}★`).join(" · ") || "—"; }
  }

  function render(tab, season, helpers) {
    H = helpers;
    const box = document.getElementById(`tab-${tab}`);
    if (tab === "programs") renderPrograms(season, box);
    else if (tab === "recruiting") renderRecruiting(season, box);
    else if (tab === "prospects") renderProspects(season, box);
    else if (tab === "scouting") window.CFP.scouting.render(season, box, H);
    else if (tab === "classes") renderClasses(season, box);
  }

  window.Recruiting = { wordTag, parts: { heroOf, scoutCards, looksCard, profileCards, compLine, gradeTips, historyLines }, render, applyRoute, openScene: openSceneRoute, init: (helpers) => { H = H || helpers; }, openProfile: (s, pid, opts) => openProfile(s, pid, null, opts || {}), reveal: (pid) => { view.selected = pid; view.reveal = pid; view.sheet = true; view.group = null; view.state = null; }, board: (s, box, helpers) => { H = helpers; renderRecruiting(s, box); } };
})();
