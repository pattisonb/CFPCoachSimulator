/* Your coach: create a head coach (identity, background, ratings, coaching style, look), save
   him, and start a season with him. The style sliders are on the league scale (50 = the FBS
   average) and change how his team plays (coaches.py, apply_coach). */
(function () {
  const { el } = window.CFP;
  const $ = (s) => document.querySelector(s);
  let OPT = null;          // /api/coach-options
  let TEAMS = [];          // FBS teams for the alma mater, colors and the season picker
  let coach = null;        // the coach being edited
  const START_PARAMS = new URLSearchParams(location.search);
  const START_MODE = START_PARAMS.get("mode") === "remaining" ? "remaining" : "full";   // from the season page's start choice

  async function api(url, opts) {
    const r = await fetch(url, opts);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || r.statusText);
    return j;
  }
  function toast(msg, ms = 2500) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const fullName = (c) => `${c.first_name || "First"} ${c.last_name || "Last"}`.trim();

  const sprite = (look, colors) => window.CoachSprite(look, colors);   // web/coachsprite.js

  // ----- the background story -------------------------------------------------------------
  function story(c) {
    const school = (TEAMS.find((t) => t.slug === c.alma_mater) || {}).name;
    const bits = [];
    bits.push(`${fullName(c)}${c.hometown ? `, from ${c.hometown},` : ""} is ${c.age}.`);
    if (c.played && c.played !== "Did not play") {
      bits.push(`He played ${c.played === "K/P" ? "kicker" : c.played}${school ? ` at ${school}` : ""}, ${({ "Walk-on": "walking on and earning his spot", "College starter": "as a multi-year starter", "All-conference": "earning all-conference honors", "All-American": "as an All-American", "NFL": "then spent time in the NFL" })[c.playing_level] || ""}.`);
    } else if (school) {
      bits.push(`He studied at ${school} and started coaching as a student assistant.`);
    }
    bits.push(((OPT.archetypes[c.archetype] || {}).about) || "");
    bits.push(`His offenses run ${c.offense_scheme === "Multiple" ? "a multiple system" : `the ${c.offense_scheme}`}${c.calls_offense ? ", and he calls the plays himself" : ""}; his defenses line up in ${c.defense_scheme === "Multiple 4-2-5" ? "a multiple 4-2-5" : `a ${c.defense_scheme}`}${c.calls_defense ? ", which he runs himself" : ""}.`);
    return bits.filter(Boolean).join(" ");
  }

  // ----- the form ---------------------------------------------------------------------------
  function field(label, input, hint) {
    return el("label", { class: "coach-field" }, [el("span", { class: "coach-label", text: label }), input, hint ? el("span", { class: "muted small-text", text: hint }) : null]);
  }
  function select(value, options, onChange) {
    const s = el("select", {}, options.map(([v, t]) => el("option", { value: v, text: t })));
    s.value = value == null ? "" : value;
    s.addEventListener("change", () => onChange(s.value));
    return s;
  }
  function slider(key, label, value, about, onChange, min = 0, max = 100) {
    const out = el("b", { class: "coach-slider-val", text: String(value) });
    const r = el("input", { type: "range", min: String(min), max: String(max), step: "1", value: String(value), "aria-label": label });
    r.addEventListener("input", () => { out.textContent = r.value; onChange(Number(r.value)); });
    return el("div", { class: "coach-slider" }, [el("div", { class: "coach-slider-head" }, [el("span", { text: label }), out]), r, el("span", { class: "muted small-text", text: about })]);
  }

  function renderForm() {
    const f = $("#coach-form");
    f.innerHTML = "";
    const c = coach;
    const changed = () => renderPreview();

    // identity
    const id = el("section", { class: "panel coach-section" }, [el("h3", { text: "Who he is" })]);
    const text = (key, ph, max = 30) => { const i = el("input", { type: "text", value: c[key] || "", placeholder: ph, maxlength: String(max) }); i.addEventListener("input", () => { c[key] = i.value; changed(); }); return i; };
    const age = el("input", { type: "number", min: "28", max: "75", value: String(c.age) });
    age.addEventListener("input", () => { c.age = Number(age.value) || 42; changed(); });
    const fbs = TEAMS.filter((t) => !t.fictional);
    id.append(el("div", { class: "coach-grid" }, [
      field("First name", text("first_name", "First")), field("Last name", text("last_name", "Last")),
      field("Age", age), field("Hometown", text("hometown", "City, State", 60)),
      field("Alma mater", select(c.alma_mater || "", [["", "None"], ...fbs.map((t) => [t.slug, t.name])], (v) => { c.alma_mater = v || null; changed(); })),
      field("Played", select(c.played, OPT.positions_played.map((p) => [p, p]), (v) => { c.played = v; changed(); })),
      field("Playing career", select(c.playing_level, OPT.playing_levels.map((p) => [p, p]), (v) => { c.playing_level = v; changed(); })),
    ]));
    f.append(id);

    // archetype and ratings
    const arch = el("section", { class: "panel coach-section" }, [el("h3", { text: "Archetype and ratings" })]);
    const archSel = select(c.archetype, Object.keys(OPT.archetypes).map((a) => [a, a]), (v) => {
      c.archetype = v; c.ratings = clone(OPT.archetypes[v].ratings); renderForm();
    });
    arch.append(field("Archetype", archSel, (OPT.archetypes[c.archetype] || {}).about));
    const budget = el("p", { class: "muted small-text coach-budget" });
    const showBudget = () => {
      const total = OPT.rating_keys.reduce((a, k) => a + c.ratings[k], 0);
      budget.textContent = `Ratings total ${total} of ${OPT.rating_budget}. Raise one and you may need to lower another.`;
      budget.classList.toggle("over", total > OPT.rating_budget);
    };
    const grid = el("div", { class: "coach-sliders" });
    for (const k of OPT.rating_keys) grid.append(slider(k, OPT.rating_labels[k], c.ratings[k], OPT.rating_about[k], (v) => { c.ratings[k] = v; showBudget(); changed(); }, 40, 99));
    arch.append(grid, budget);
    showBudget();
    f.append(arch);

    // coaching style
    const sty = el("section", { class: "panel coach-section" }, [el("h3", { text: "Coaching style" }),
      el("p", { class: "muted small-text", text: "50 is the FBS average. These change how his team plays when he calls that side of the ball. The team's coordinators stay for the season; staff changes come after it." })]);
    const offSel = select(c.offense_scheme, Object.keys(OPT.offense_schemes).map((s) => [s, s]), (v) => { c.offense_scheme = v; renderForm(); });
    const defSel = select(c.defense_scheme, Object.keys(OPT.defense_schemes).map((s) => [s, s]), (v) => { c.defense_scheme = v; renderForm(); });
    const callO = el("input", { type: "checkbox" }); callO.checked = !!c.calls_offense;
    callO.addEventListener("change", () => { c.calls_offense = callO.checked; renderForm(); });
    const callD = el("input", { type: "checkbox" }); callD.checked = !!c.calls_defense;
    callD.addEventListener("change", () => { c.calls_defense = callD.checked; renderForm(); });
    sty.append(el("div", { class: "coach-grid two" }, [
      el("div", {}, [field("Offensive scheme", offSel, OPT.offense_schemes[c.offense_scheme]),
        el("label", { class: "coach-check" }, [callO, " Calls his own offense (his scheme and style; otherwise the team's offensive coordinator calls it)"])]),
      el("div", {}, [field("Defensive scheme", defSel, OPT.defense_schemes[c.defense_scheme]),
        el("label", { class: "coach-check" }, [callD, " Calls his own defense (his scheme and style; otherwise the team's defensive coordinator calls it)"])]),
    ]));
    const sliders = el("div", { class: "coach-sliders" });
    for (const [k, s] of Object.entries(OPT.style)) {
      const off = (s.side === "offense" && !c.calls_offense) || (s.side === "defense" && !c.calls_defense);
      const sl = slider(k, s.label, c.style[k], off ? `${s.about} (used when he calls the ${s.side})` : s.about, (v) => { c.style[k] = v; changed(); });
      if (off) sl.classList.add("dim");
      sliders.append(sl);
    }
    sty.append(sliders);
    f.append(sty);

    // look
    const look = el("section", { class: "panel coach-section" }, [el("h3", { text: "His look" })]);
    const lg = el("div", { class: "coach-grid" });
    const names = { skin: "Skin tone", hair: "Hair", hair_color: "Hair color", facial_hair: "Facial hair", glasses: "Glasses", headwear: "On his head", outfit: "Sideline outfit" };
    for (const [k, opts] of Object.entries(OPT.look)) {
      if (k === "skin" || k === "hair_color") {
        const row = el("div", { class: "swatches", role: "radiogroup", "aria-label": names[k] });
        for (const v of opts) {
          const b = el("button", { type: "button", class: `swatch ${c.look[k] === v ? "on" : ""}`, style: `background:${v}`, "aria-label": v, "aria-pressed": c.look[k] === v ? "true" : "false" });
          b.addEventListener("click", () => { c.look[k] = v; renderForm(); });
          row.append(b);
        }
        lg.append(field(names[k], row));
      } else {
        lg.append(field(names[k], select(c.look[k], opts.map((o) => [o, o[0].toUpperCase() + o.slice(1)]), (v) => { c.look[k] = v; changed(); })));
      }
    }
    look.append(lg);
    f.append(look);

    // background
    const bg = el("section", { class: "panel coach-section" }, [el("h3", { text: "Background" })]);
    const ta = el("textarea", { rows: "5", maxlength: "1500", placeholder: "His story. Write your own, or fill it in from the choices above." });
    ta.value = c.background || "";
    ta.addEventListener("input", () => { c.background = ta.value; changed(); });
    const gen = el("button", { type: "button", class: "ghost small", text: "Write it from my choices" });
    gen.addEventListener("click", () => { c.background = story(c); ta.value = c.background; changed(); });
    bg.append(ta, el("div", { class: "coach-actions" }, [gen]));
    f.append(bg);

    // save and start
    const actions = el("section", { class: "panel coach-section coach-final" });
    const save = el("button", { type: "button", class: "primary", text: c.id ? "Save changes" : "Save coach" });
    save.addEventListener("click", saveCoach);
    const teamSel = el("select", { "aria-label": "Team to coach" }, fbs.map((t) => el("option", { value: t.slug, text: t.name })));
    teamSel.value = $("#preview-team").value || (fbs[0] || {}).slug;
    const start = el("button", { type: "button", class: "accent", text: START_MODE === "remaining" ? "Start from today with him" : "Start a season with him" });
    start.addEventListener("click", () => startSeason(teamSel.value));
    actions.append(el("div", { class: "coach-actions" }, [save, el("span", { class: "muted small-text", text: "then" }), teamSel, start]));
    f.append(actions);
    renderPreview();
  }

  // Who runs one side of the ball: the coach himself, or the team's own coordinator.
  function sideLine(side) {
    const calls = side === "offense" ? coach.calls_offense : coach.calls_defense;
    const scheme = side === "offense" ? coach.offense_scheme : coach.defense_scheme;
    return calls ? `${scheme} (calls it)` : "the team's coordinator";
  }

  function renderPreview() {
    const t = TEAMS.find((x) => x.slug === $("#preview-team").value) || {};
    $("#coach-sprite").innerHTML = sprite(coach.look, t.colors);
    const card = $("#coach-card");
    card.innerHTML = "";
    const r = coach.ratings;
    const ovr = Math.round(OPT.rating_keys.reduce((a, k) => a + r[k], 0) / OPT.rating_keys.length);
    card.append(
      el("div", { class: "coach-name", text: fullName(coach) }),
      el("div", { class: "muted small-text", text: `${coach.archetype} · ${coach.age}${coach.hometown ? " · " + coach.hometown : ""}` }),
      el("div", { class: "coach-ovr" }, [el("b", { text: String(ovr) }), el("span", { class: "muted small-text", text: " overall" })]),
      el("div", { class: "small-text", text: `Offense: ${sideLine("offense")}` }),
      el("div", { class: "small-text", text: `Defense: ${sideLine("defense")}` }),
    );
  }

  // ----- saving, listing, starting ----------------------------------------------------------
  async function saveCoach() {
    try {
      const saved = await api("/api/coaches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coach }) });
      coach = saved;
      toast(`${fullName(coach)} saved.`);
      renderForm();
      renderList();
      return saved;
    } catch (err) { toast(`Could not save: ${err.message}`, 4000); return null; }
  }

  async function startSeason(team) {
    const saved = await saveCoach();
    if (!saved) return;
    try {
      if (START_MODE === "remaining") toast("Loading the real season so far…");
      const s = await api("/api/season", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ team, mode: START_MODE, coach: saved.id }) });
      location.href = `/season?id=${encodeURIComponent(s.id)}`;
    } catch (err) { toast(`Could not start the season: ${err.message}`, 4000); }
  }

  async function renderList() {
    const box = $("#coach-list");
    box.innerHTML = "";
    let list = [];
    try { list = (await api("/api/coaches")).coaches; } catch (err) { box.append(el("p", { class: "muted", text: err.message })); return; }
    if (!list.length) { box.append(el("p", { class: "muted small-text", text: "No coaches yet. Build one below and save him." })); return; }
    const preview = TEAMS.find((x) => x.slug === $("#preview-team").value) || {};
    for (const c of list) {
      const school = TEAMS.find((t) => t.slug === c.alma_mater) || preview;
      const item = el("div", { class: `coach-item ${coach && coach.id === c.id ? "on" : ""}` });
      const pic = el("div", { class: "coach-item-pic" });
      pic.innerHTML = sprite(c.look, school.colors);
      const edit = el("button", { type: "button", class: "ghost small", text: "Edit" });
      edit.addEventListener("click", () => { coach = clone(c); renderForm(); renderList(); window.scrollTo({ top: 0, behavior: "smooth" }); });
      const del = el("button", { type: "button", class: "ghost small", text: "Delete" });
      del.addEventListener("click", async () => {
        if (!confirm(`Delete ${fullName(c)}?`)) return;
        await api(`/api/coaches/${c.id}`, { method: "DELETE" });
        if (coach && coach.id === c.id) coach = clone(OPT.blank);
        renderForm(); renderList();
      });
      item.append(pic, el("div", { class: "coach-item-text" }, [el("b", { text: fullName(c) }), el("span", { class: "muted small-text", text: `${c.archetype} · ${c.calls_offense ? c.offense_scheme : "team's OC"} / ${c.calls_defense ? c.defense_scheme : "team's DC"}` })]), el("div", { class: "coach-item-actions" }, [edit, del]));
      box.append(item);
    }
  }

  async function init() {
    try {
      [OPT, TEAMS] = await Promise.all([api("/api/coach-options"), api("/api/teams").then((j) => j.teams)]);
    } catch (err) { $("#coach-form").append(el("p", { class: "muted", text: `Could not load: ${err.message}` })); return; }
    const sel = $("#preview-team");
    for (const t of TEAMS.filter((x) => !x.fictional)) sel.append(el("option", { value: t.slug, text: t.name }));
    const wanted = START_PARAMS.get("team");
    sel.value = TEAMS.some((t) => t.slug === wanted) ? wanted : TEAMS.some((t) => t.slug === "ohio-state") ? "ohio-state" : sel.options[0].value;
    sel.addEventListener("change", () => { renderPreview(); renderList(); });
    coach = clone(OPT.blank);
    const params = new URLSearchParams(location.search);
    if (params.get("id")) { try { coach = await api(`/api/coaches/${encodeURIComponent(params.get("id"))}`); } catch (_) { /* a new coach */ } }
    $("#btn-new-coach").addEventListener("click", () => { coach = clone(OPT.blank); renderForm(); renderList(); });
    renderForm();
    renderList();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
