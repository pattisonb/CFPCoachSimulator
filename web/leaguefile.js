/* The New Career screen's League panel: "League: Built-in" or a league file. Import League File… checks the file
   (POST /api/league/check, its bytes) and shows its errors as sentences, or the summary (four stat chips and the
   lines) and Start Career; Export League downloads the built-in league.json next to the page. Everything patches
   in place (window.CFP.ui: busy, morph, toast). The game checks in its worker (or the dev server), so the page
   stays live through a long check; a running clock shows it.
   window.LeagueFile = { key(), teams(), onChange(fn), onStart(fn), reset() }: key() is "builtin" until a checked
   import succeeds, then the check's key; teams() the import's FBS team cards (null for the built-in league).
   season.js listens with onChange (the team picker and the team cards) and onStart (Start Career). Loaded before
   season.js, after ui.js and game-client.js. */
(function () {
  "use strict";
  const { $, el } = window.CFP;
  const MB = 1024 * 1024;
  const MAX_LEAGUE_BYTES = 64 * MB;   // the game's own limit (coach_career/league_file.py MAX_LEAGUE_BYTES): refused before reading
  const MAX_ERRORS_SHOWN = 60;        // *tune* error sentences listed before "and N more"
  const MAX_LINES_SHOWN = 12;         // *tune* summary lines shown before Show All (a summary at most 3 longer shows whole)
  const HELP = "Start from the game's own 2026 league, or import a league file (.json) to add, change or remove teams and conferences. Export League downloads the game's league as a file to edit.";

  // mode: "builtin" or "file"; key: the check's key ("builtin" for a file that changes nothing); view: what #league-result shows
  const st = { mode: "builtin", key: "builtin", teams: null, name: null, view: null, allLines: false };
  const changeFns = [], startFns = [];
  const ui = () => window.CFP.ui;

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  // a server's detail as a sentence of its own: a capital first letter and a closing period
  const sentence = (t) => { const x = String(t || "").trim() || "Something went wrong"; return x[0].toUpperCase() + x.slice(1) + (/[.!?…]$/.test(x) ? "" : "."); };
  const num = (v) => (Number.isFinite(v) ? v : 0);
  function mbText(bytes) { return `${(bytes / MB).toFixed(1)} MB`; }

  // An API error as a sentence (the server's detail when it sent one)
  function errText(err) {
    const msg = (err && err.message) || "";
    const m = /^(\d{3}) (.*)$/s.exec(msg);
    if (!m) return msg || "Something went wrong.";
    let detail = "";
    try { detail = JSON.parse(m[2]).detail; } catch (e) { /* not JSON */ }
    if (typeof detail === "string" && detail) return detail;
    return Number(m[1]) >= 500 ? "The game hit an error. Try again in a moment." : `The game said no (${m[1]}).`;
  }

  // ----- drawing ---------------------------------------------------------------------------------
  function freshSelect() {
    const opts = [el("option", { value: "builtin", "data-key": "builtin", text: "League: Built-in" })];
    if (st.name) opts.push(el("option", { value: "file", "data-key": "file", text: `League: ${st.name}` }));
    opts.push(el("option", { value: "import", "data-key": "import", text: "Import League File…" }));
    return el("select", {}, opts);
  }
  function drawSelect() {
    const sel = $("#pick-league");
    ui().morph(sel, freshSelect());
    sel.value = st.mode;
  }

  function busyView(v) {
    const secs = Math.max(0, Math.floor((Date.now() - v.since) / 1000));
    const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    return [el("div", { class: "league-busy", "data-key": "busy" }, [
      el("span", { class: "league-spinner", "aria-hidden": "true" }),
      el("p", { text: `Checking ${v.file}: reading the teams, filling the rosters and building the schedule. A file that rewrites every roster can take a minute or more.` }),
      el("span", { class: "league-clock", "aria-hidden": "true", text: clock }),
    ])];
  }
  function errorsView(v) {
    const shown = v.errors.slice(0, MAX_ERRORS_SHOWN), more = v.errors.length - shown.length;
    return [
      el("p", { class: "league-error-head", "data-key": "error-head", text: `The file ${v.file} has ${plural(v.errors.length, "problem", "problems")}, so it cannot start a career. Fix ${v.errors.length === 1 ? "it" : "them"} and import it again.` }),
      el("ul", { class: "league-errors", "data-key": "errors" }, shown.map((e) => el("li", { text: e }))),
      more > 0 ? el("p", { class: "muted", "data-key": "more", text: `${plural(more, "more problem is", "more problems are")} not shown.` }) : null,
    ].filter(Boolean);
  }
  function summaryView(v) {
    const s = v.summary;
    const chip = (k, n) => el("span", { class: "go-chip league-stat", "data-key": k }, [el("span", { class: "league-stat-k", text: k }), " ", el("b", { text: String(num(n)) })]);
    const lines = (s.lines || []).filter((x) => typeof x === "string" && x);
    // a summary over MAX_LINES_SHOWN + 3 lines shows its first MAX_LINES_SHOWN - 2 lines and its last two (the totals and
    // the schedule); the team lines between fold behind Show All
    const show = st.allLines || lines.length <= MAX_LINES_SHOWN + 3 ? lines
      : [...lines.slice(0, MAX_LINES_SHOWN - 2), ...lines.slice(-2)];
    const out = [
      el("div", { class: "league-stats", "data-key": "stats" }, [chip("Teams Added", s.added), chip("Teams Changed", s.changed), chip("Teams Removed", s.removed), chip("Players Generated", s.generated)]),
      el("div", { class: "league-lines", "data-key": "lines" }, show.map((x) => el("p", { class: "league-line", text: x }))),
    ];
    const actions = [];
    if (show.length < lines.length) {
      const more = el("button", { type: "button", class: "ghost", "data-key": "more", text: `Show All ${lines.length} Lines` });
      ui().on(more, "click", () => { st.allLines = true; drawResult(true); });
      actions.push(more);
    }
    const start = el("button", { type: "button", class: "accent", id: "btn-league-start", "data-key": "start", text: "Start Career" });
    ui().on(start, "click", startCareer);
    actions.push(start);
    out.push(el("div", { class: "league-actions", "data-key": "actions" }, actions));
    out.push(el("p", { class: "muted league-hint", "data-key": "hint", text: "Pick your team in the team list at the top, then choose Start Career." }));
    return out;
  }
  function drawResult(pulse) {
    const live = $("#league-result"), v = st.view;
    const kids = !v ? [] : v.kind === "busy" ? busyView(v) : v.kind === "errors" ? errorsView(v) : summaryView(v);
    // a different state is a different list: keyed by state, so the old one leaves and the new one fades in
    for (const k of kids) k.setAttribute("data-key", `${v.kind}-${k.getAttribute("data-key")}`);
    ui().morph(live, el("div", {}, kids), pulse ? { pulse: true } : undefined);
  }

  function notify() {
    const info = { key: st.key, teams: st.teams, name: st.name };
    for (const fn of changeFns) { try { fn(info); } catch (e) { console.error(e); } }
  }

  // ----- the actions -----------------------------------------------------------------------------
  function toBuiltin() {
    const was = st.mode !== "builtin" || st.name;
    Object.assign(st, { mode: "builtin", key: "builtin", teams: null, name: null, allLines: false });
    if (st.view && st.view.kind !== "busy") st.view = null;
    drawSelect();
    drawResult(false);
    if (was) notify();
  }

  async function checkFile(file) {
    if (file.size > MAX_LEAGUE_BYTES) {
      ui().toast(`The file is ${mbText(file.size)}; the game reads league files up to ${MAX_LEAGUE_BYTES / MB} MB.`, { ms: 6000, kind: "error" });
      return;
    }
    const sel = $("#pick-league"), exp = $("#btn-export-league");
    const fileName = file.name || "the file";
    st.view = { kind: "busy", file: fileName, since: Date.now() };
    drawResult(true);
    const tick = setInterval(() => { if (st.view && st.view.kind === "busy") drawResult(false); }, 1000);
    exp.disabled = true;
    const work = (async () => {
      const bytes = await file.arrayBuffer();
      const res = await window.CFP.game.fetch("/api/league/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: bytes });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      return res.json();
    })();
    let r = null;
    try { r = await ui().busy(sel, work); }
    catch (err) {
      st.view = null;
      ui().toast(`Could not check ${fileName}: ${sentence(errText(err))}`, { ms: 6000, kind: "error" });
    } finally {
      clearInterval(tick);
      exp.disabled = false;
    }
    if (!r) { toBuiltin(); return; }      // the check failed: no league is pending, so the select, the picker and New Season agree on the built-in one
    if (!r.ok) {
      const errors = (r.errors || []).filter((e) => typeof e === "string" && e);
      st.view = { kind: "errors", file: fileName, errors: errors.length ? errors : ["The file could not be read."] };
      const was = st.mode !== "builtin" || st.name;
      Object.assign(st, { mode: "builtin", key: "builtin", teams: null, name: null });
      drawSelect();
      drawResult(true);
      if (was) notify();
      return;
    }
    const s = r.summary || {};
    Object.assign(st, { mode: "file", key: r.key || "builtin", teams: Array.isArray(r.teams) ? r.teams : [], name: (typeof s.name === "string" && s.name.trim()) || "Imported League", allLines: false });
    st.view = { kind: "summary", summary: s };
    drawSelect();
    drawResult(true);
    notify();
    ui().toast(`${st.name} is ready: pick your team, then Start Career.`);
  }

  async function exportLeague() {
    const res = await fetch("league.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const blob = new Blob([await res.arrayBuffer()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: "league.json", hidden: "" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function startCareer() {
    if (startFns.length) { for (const fn of startFns) fn(); return; }
    const b = $("#btn-new");
    if (b) b.click();
  }

  // ----- wiring ----------------------------------------------------------------------------------
  function mount() {
    const panel = $("#league-panel");
    if (!panel) return;
    const head = panel.querySelector(".league-head");
    if (head && ui().tip) head.append(ui().tip(HELP, "League"));
    const sel = $("#pick-league"), input = $("#league-file");
    sel.addEventListener("change", () => {
      const v = sel.value;
      if (v === "import") { sel.value = st.mode; input.click(); return; }
      if (v === "builtin") toBuiltin();
    });
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      input.value = "";
      if (file) checkFile(file);
    });
    const exp = $("#btn-export-league");
    exp.addEventListener("click", () => {
      ui().busy(exp, exportLeague())
        .then(() => ui().toast("Exported the game's league as league.json."))
        .catch((err) => ui().toast(`Could not export the league: ${sentence(errText(err))}`, { ms: 6000, kind: "error" }));
    });
    drawSelect();
  }

  window.LeagueFile = {
    key: () => st.key,
    teams: () => st.teams,
    onChange(fn) { if (typeof fn === "function") changeFns.push(fn); },
    onStart(fn) { if (typeof fn === "function") startFns.push(fn); },
    // the career started (the pending league is used up): back to the built-in league
    reset() { if (st.mode !== "builtin" || st.name || (st.view && st.view.kind !== "busy")) toBuiltin(); },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
