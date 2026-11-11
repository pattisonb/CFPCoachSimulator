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
    if (f.coach) t.coaches = { head: { name: f.coach } };
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
  window.CFP.programs = { STORE, load, save, doc, team, slugOf, roster, POS, STRENGTHS };
})();
