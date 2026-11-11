/* Custom Programs, shared (docs/superpowers/specs/2026-11-11-custom-programs-design.md): the programs saved in this
   browser and the league file (cfp-league/1) they make. The Custom Programs page edits them; the New Career screen
   (leaguefile.js) ticks them into a career. window.CFP.programs = { load(), save(list), doc(list, real), team(p, real),
   slugOf(name, taken), STORE }. A program: { id, kind: "new"|"edit", base: real slug|null, f: {fields}, updated }. */
(function () {
  "use strict";
  const STORE = "cfp-custom-programs";
  let memory = null;                 // storage unavailable: the visit keeps them here

  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      const d = raw ? JSON.parse(raw) : null;
      return Array.isArray(d && d.programs) ? d.programs : [];
    } catch (e) { return memory || []; }
  }
  function save(list) {
    memory = list;
    try { localStorage.setItem(STORE, JSON.stringify({ version: 1, programs: list })); return true; }
    catch (e) { return false; }
  }

  const slugify = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "program";
  function slugOf(name, taken) {
    const base = slugify(name);
    let s = base, n = 2;
    while (taken.has(s)) s = `${base}-${n++}`;
    taken.add(s);
    return s;
  }
  const POS = new Set("QB RB WR TE LT LG C RG RT LEDG DT REDG SAM MIKE WILL CB FS SS K P".split(" "));
  // "Name, POS, CLASS[, overall]" one a line -> roster rows (a bad line is kept so the game's check names it)
  function roster(text) {
    return String(text || "").split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const [name, pos, cls, ovr] = l.split(",").map((x) => (x || "").trim());
      const row = { name, pos: (pos || "").toUpperCase(), class: (cls || "").toUpperCase() };
      if (ovr && Number.isFinite(Number(ovr))) row.overall = Number(ovr);
      return row;
    });
  }
  const color = (hex) => (hex ? { name: hex.toUpperCase(), hex } : undefined);
  const STRENGTHS = ["Elite", "Strong", "Average", "Weak"];
  const MAX_RIVALS = 3;              // a rival outside the conference takes a non-conference week: three is what a schedule always fits
  const CLASSES = new Set(["FR", "SO", "JR", "SR", "FRRS", "SORS", "JRRS", "SRRS"]);
  // what a program still needs before the game can use it: [{key, msg}] (the page marks each field; Check waits for none)
  function problems(p) {
    const f = p.f || {}, out = [];
    if (p.kind === "new" && !(f.name || "").trim()) out.push({ key: "name", msg: "Give the program a name." });
    if (p.kind === "new" && !f.conference) out.push({ key: "conference", msg: "Pick a conference." });
    if (f.conference === "__new" && !(f.new_conf_name || "").trim()) out.push({ key: "new_conf_name", msg: "Name the new conference." });
    if (f.abbreviation && !/^[A-Za-z0-9&]{2,4}$/.test(f.abbreviation.trim())) out.push({ key: "abbreviation", msg: "An abbreviation is 2 to 4 letters or numbers." });
    if (f.prestige !== undefined && f.prestige !== "" && !(Number(f.prestige) >= 0 && Number(f.prestige) <= 100)) out.push({ key: "prestige", msg: "Prestige runs from 0 to 100." });
    roster(f.roster).forEach((r, i) => {
      if (!r.name) out.push({ key: "roster", msg: `Player ${i + 1} needs a name.` });
      else if (!POS.has(r.pos)) out.push({ key: "roster", msg: `${r.name}: '${r.pos || "?"}' is not a position.` });
      else if (!CLASSES.has(r.class)) out.push({ key: "roster", msg: `${r.name}: '${r.class || "?"}' is not a class (FR, SO, JR, SR, or with RS).` });
      else if (r.overall != null && !(r.overall >= 1 && r.overall <= 99)) out.push({ key: "roster", msg: `${r.name}: an overall runs from 1 to 99.` });
    });
    if ((f.rivals || []).length > MAX_RIVALS) out.push({ key: "rivals", msg: `At most ${MAX_RIVALS} rivals.` });
    return out;
  }

  // one program as a league file team; `real` is {slug: the game's team} (an edit writes only what changed)
  function team(p, real, slug) {
    const f = p.f || {};
    const base = p.kind === "edit" ? real[p.base] || {} : {};
    const t = { slug };
    const put = (k, v, was) => { if (v !== undefined && v !== null && v !== "" && v !== was) t[k] = v; };
    put("name", f.name, base.name);
    put("short_name", f.short_name, base.short_name);
    put("abbreviation", f.abbreviation, base.abbreviation);
    put("mascot", f.mascot, base.mascot);
    put("city", f.city, base.city);
    put("state", f.state, base.state);
    const conf = f.conference === "__new" ? slugify(f.new_conf_name) : f.conference;
    put("conference", conf, base.conference);
    const bc = base.colors || {};
    const cols = {};
    for (const k of ["primary", "secondary", "accent"]) if (f[k] && f[k] !== (bc[k] || {}).hex) cols[k] = color(f[k]);
    if (Object.keys(cols).length) t.colors = p.kind === "edit" ? { ...bc, ...cols } : cols;
    if (f.strength) t.strength = STRENGTHS.includes(f.strength) ? f.strength : Number(f.strength);
    if (f.prestige !== undefined && f.prestige !== "" && Number(f.prestige) !== base.prestige) t.prestige = Number(f.prestige);
    const co = {};
    if (f.coach) co.head = { name: f.coach };
    if (f.oc) co.oc = { name: f.oc };
    if (f.dc) co.dc = { name: f.dc };
    if (f.offense && f.offense !== base.offense) co.offense = f.offense;
    if (f.defense && f.defense !== base.defense) co.defense = f.defense;
    if (Object.keys(co).length) t.coaches = co;
    const rv = Array.isArray(f.rivals) ? f.rivals.filter(Boolean).slice(0, MAX_RIVALS) : [];
    const names = f.rivalry_names || {};
    const named = rv.some((x) => (names[x] || "").trim());
    if (rv.length && (named || JSON.stringify([...rv].sort()) !== JSON.stringify([...(base.rivals || [])].sort())))
      t.rivals = rv.map((x) => ((names[x] || "").trim() ? { slug: x, name: names[x].trim() } : x));
    const r = roster(f.roster);
    if (r.length) t.roster = r;
    if (p.kind === "new") t.level = "FBS";
    return t;
  }

  // the league file for these programs: new conferences, then each program's team (an edit by its real slug)
  function doc(list, real, name) {
    const taken = new Set(Object.keys(real || {}));
    const confs = [];
    const teams = list.map((p) => {
      const f = p.f || {};
      if (f.conference === "__new" && f.new_conf_name) {
        const id = slugify(f.new_conf_name);
        if (!confs.some((c) => c.id === id)) confs.push({ id, name: f.new_conf_name, level: "FBS", games: Number(f.new_conf_games) || 8 });
      }
      return team(p, real || {}, p.kind === "edit" ? p.base : slugOf(f.name, taken));
    });
    return { format: "cfp-league/1", name: name || "Custom Programs", year: 2026, conferences: confs, teams };
  }

  window.CFP = window.CFP || {};
  window.CFP.programs = { STORE, load, save, doc, team, slugOf, roster, POS, STRENGTHS, MAX_RIVALS, CLASSES, problems };
})();
