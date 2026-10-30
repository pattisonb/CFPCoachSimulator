/* Your coach: create a head coach (identity, background, ratings, coaching style, look), save
   him, and start a season with him. The style sliders are on the league scale (50 = the FBS
   average) and change how his team plays (sim/coaches.py, apply_coach). */
(function () {
  const { el } = window.CFP;
  const $ = (s) => document.querySelector(s);
  let OPT = null;          // /api/coach-options
  let TEAMS = [];          // FBS teams for the alma mater, colors and the season picker
  let coach = null;        // the coach being edited
  let listSeq = 0;         // the coach list's latest draw (an older fetch landing late is dropped)
  const START_PARAMS = new URLSearchParams(location.search);

  async function api(url, opts) {
    let r;
    try { r = await window.CFP.game.fetch(url, opts); }
    catch (_) { throw new Error("could not reach the server. Check your connection and try again."); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof j.detail === "string" && j.detail ? j.detail : r.status >= 500 ? "the server hit an error. Try again in a moment." : `the server said no (${r.status}).`);
    return j;
  }
  // a thin wrapper over the shared toast stack (web/ui.js)
  function toast(msg, ms = 2500) {
    return window.CFP.ui.toast(msg, { ms, kind: /^Could not/.test(msg) ? "error" : "info" });
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const fullName = (c) => `${c.first_name || "First"} ${c.last_name || "Last"}`.trim();

  const sprite = (look, colors) => window.CoachSprite(look, colors);   // web/coachsprite.js

  // ----- the background story -------------------------------------------------------------
  function story(c) {
    const school = (TEAMS.find((t) => t.slug === c.alma_mater) || {}).name;
    const bits = [];
    bits.push(`${fullName(c)}${c.hometown ? `, from ${c.hometown},` : ""} is ${c.age}.`);
    // written around the coach's last name, as a sportswriter would, so it fits any coach
    const who = (c.last_name || "").trim() || "The coach";
    if (c.played && c.played !== "Did not play") {
      bits.push(`${who} played ${c.played === "K/P" ? "kicker" : c.played}${school ? ` at ${school}` : ""}, ${({ "Walk-on": "walking on and earning a spot", "College starter": "as a multi-year starter", "All-conference": "earning all-conference honors", "All-American": "as an All-American", "NFL": "then spent time in the NFL" })[c.playing_level] || ""}.`);
    } else if (school) {
      bits.push(`${who} studied at ${school} and started coaching as a student assistant.`);
    }
    bits.push(((OPT.archetypes[c.archetype] || {}).about) || "");
    bits.push(`${who}'s offenses run ${c.offense_scheme === "Multiple" ? "a multiple system" : `the ${c.offense_scheme}`}${c.calls_offense ? `, with ${who} calling the plays` : ""}; the defenses line up in ${c.defense_scheme === "Multiple 4-2-5" ? "a multiple 4-2-5" : `a ${c.defense_scheme}`}${c.calls_defense ? `, with ${who} running them too` : ""}.`);
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
    const id = el("section", { class: "panel coach-section" }, [el("h3", { text: "Identity" })]);
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
    // One budget covers all seven ratings, but only some change games today: they come first,
    // and the rest sit under their own heading with the points they take, so the trade is visible.
    const live = new Set(OPT.rating_live || OPT.rating_keys);
    const liveKeys = OPT.rating_keys.filter((k) => live.has(k));
    const laterKeys = OPT.rating_keys.filter((k) => !live.has(k));
    const budget = el("p", { class: "muted small-text coach-budget", "aria-live": "polite" });
    const sum = (keys) => keys.reduce((a, k) => a + c.ratings[k], 0);
    const showBudget = () => {
      const total = sum(OPT.rating_keys);
      const split = laterKeys.length ? ` (${sum(liveKeys)} in the ratings games use now, ${sum(laterKeys)} in the ones still to come)` : "";
      budget.textContent = `Ratings total ${total} of ${OPT.rating_budget}${split}. Raise one and you may need to lower another.`;
      budget.classList.toggle("over", total > OPT.rating_budget);
    };
    const sliderFor = (k) => slider(k, OPT.rating_labels[k], c.ratings[k], OPT.rating_about[k], (v) => { c.ratings[k] = v; showBudget(); changed(); }, 40, 99);
    arch.append(el("div", { class: "coach-sliders" }, liveKeys.map(sliderFor)));
    if (laterKeys.length) {
      arch.append(el("h4", { class: "coach-subhead", text: "Coming later: no effect on games yet" }),
        el("p", { class: "muted small-text", text: "These count toward the same total and start to matter when recruiting, the offseason and coach mode arrive." }),
        el("div", { class: "coach-sliders" }, laterKeys.map(sliderFor)));
    }
    arch.append(budget);
    showBudget();
    f.append(arch);

    // coaching style
    const sty = el("section", { class: "panel coach-section" }, [el("h3", { text: "Coaching style" }),
      el("p", { class: "muted small-text", text: "50 is the FBS average. These change how the team plays on a side of the ball the coach calls. The team's coordinators stay for the season; staff changes come after it." })]);
    const offSel = select(c.offense_scheme, Object.keys(OPT.offense_schemes).map((s) => [s, s]), (v) => { c.offense_scheme = v; renderForm(); });
    const defSel = select(c.defense_scheme, Object.keys(OPT.defense_schemes).map((s) => [s, s]), (v) => { c.defense_scheme = v; renderForm(); });
    const callO = el("input", { type: "checkbox" }); callO.checked = !!c.calls_offense;
    callO.addEventListener("change", () => { c.calls_offense = callO.checked; renderForm(); });
    const callD = el("input", { type: "checkbox" }); callD.checked = !!c.calls_defense;
    callD.addEventListener("change", () => { c.calls_defense = callD.checked; renderForm(); });
    sty.append(el("div", { class: "coach-grid two" }, [
      el("div", {}, [field("Offensive scheme", offSel, OPT.offense_schemes[c.offense_scheme]),
        el("label", { class: "coach-check" }, [callO, " Calls the offense (the coach's own scheme and style; otherwise the team's offensive coordinator calls it)"])]),
      el("div", {}, [field("Defensive scheme", defSel, OPT.defense_schemes[c.defense_scheme]),
        el("label", { class: "coach-check" }, [callD, " Calls the defense (the coach's own scheme and style; otherwise the team's defensive coordinator calls it)"])]),
    ]));
    const sliders = el("div", { class: "coach-sliders" });
    for (const [k, s] of Object.entries(OPT.style)) {
      const off = (s.side === "offense" && !c.calls_offense) || (s.side === "defense" && !c.calls_defense);
      const sl = slider(k, s.label, c.style[k], off ? `${s.about} (used when the coach calls the ${s.side})` : s.about, (v) => { c.style[k] = v; changed(); });
      if (off) sl.classList.add("dim");
      sliders.append(sl);
    }
    sty.append(sliders);
    f.append(sty);

    // look
    const look = el("section", { class: "panel coach-section" }, [el("h3", { text: "Look" })]);
    const lg = el("div", { class: "coach-grid" });
    const names = { skin: "Skin tone", hair: "Hair", hair_color: "Hair color", facial_hair: "Facial hair", glasses: "Glasses", headwear: "Headwear", outfit: "Sideline outfit" };
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
    const ta = el("textarea", { rows: "5", maxlength: "1500", placeholder: "The coach's story. Write your own, or fill it in from the choices above." });
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
    const start = el("button", { type: "button", class: "accent", text: "Start a season with this coach" });
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
  // Save patches in place: the form stays as it is (the saved coach is merged into the one it edits),
  // the button's label turns to "Save changes", the list gains or updates his row; the button is busy meanwhile.
  function saveCoach(ev) {
    const btn = ev && ev.currentTarget;
    const work = (async () => {
      try {
        const saved = await api("/api/coaches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coach }) });
        coach = Object.assign(coach, saved);
        const label = $("#coach-form .coach-final button.primary");
        if (label && label.textContent !== "Save changes") { label.textContent = "Save changes"; window.CFP.ui.pulse(label); }
        await renderList();
        toast(`${fullName(coach)} saved.`);
        return coach;
      } catch (err) { toast(`Could not save: ${err.message}`, 4000); return null; }
    })();
    return btn instanceof HTMLButtonElement ? window.CFP.ui.busy(btn, work) : work;
  }

  async function startSeason(team) {
    const saved = await saveCoach(null);
    if (!saved) return;
    try {
      const s = await api("/api/season", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ team, mode: "full", coach: saved.id }) });
      location.href = `./index.html?id=${encodeURIComponent(s.id)}`;
    } catch (err) { toast(`Could not start the season: ${err.message}`, 4000); }
  }

  async function renderList() {
    const box = $("#coach-list");
    const token = ++listSeq;
    const fresh = el("div");                // drawn off screen, then the list on screen patched to match (web/ui.js morph)
    const done = () => { if (token === listSeq) window.CFP.ui.morph(box, fresh); };
    let list = [];
    try { list = (await api("/api/coaches")).coaches; } catch (err) { fresh.append(el("p", { class: "muted", text: err.message })); done(); return; }
    if (!list.length) { fresh.append(el("p", { class: "muted small-text", text: "No coaches yet. Build one below and save it." })); done(); return; }
    const preview = TEAMS.find((x) => x.slug === $("#preview-team").value) || {};
    for (const c of list) {
      const school = TEAMS.find((t) => t.slug === c.alma_mater) || preview;
      const item = el("div", { class: `coach-item ${coach && coach.id === c.id ? "on" : ""}`, "data-key": c.id });
      const pic = el("div", { class: "coach-item-pic" });
      pic.innerHTML = sprite(c.look, school.colors);
      const edit = el("button", { type: "button", class: "ghost small", text: "Edit" });
      window.CFP.ui.on(edit, "click", () => { coach = clone(c); renderForm(); renderList(); window.scrollTo({ top: 0, behavior: "smooth" }); });
      const del = el("button", { type: "button", class: "ghost small", text: "Delete" });
      window.CFP.ui.on(del, "click", (ev) => {
        if (!confirm(`Delete ${fullName(c)}?`)) return;
        window.CFP.ui.busy(ev.currentTarget, (async () => {
          try { await api(`/api/coaches/${c.id}`, { method: "DELETE" }); }
          catch (err) { toast(`Could not delete: ${err.message}`, 4000); return; }
          if (coach && coach.id === c.id) { coach = clone(OPT.blank); renderForm(); }   // the form was editing him: a blank coach
          await renderList();
          toast(`${fullName(c)} deleted.`);
        })());
      });
      item.append(pic, el("div", { class: "coach-item-text" }, [el("b", { text: fullName(c) }), el("span", { class: "muted small-text", text: `${c.archetype} · ${c.calls_offense ? c.offense_scheme : "team's OC"} / ${c.calls_defense ? c.defense_scheme : "team's DC"}` })]), el("div", { class: "coach-item-actions" }, [edit, del]));
      fresh.append(item);
    }
    done();
  }

  async function init() {
    try {
      [OPT, TEAMS] = await Promise.all([api("/api/coach-options"), api("/api/teams").then((j) => j.teams)]);
    } catch (err) { $("#coach-form").append(el("p", { class: "muted", text: `Could not load: ${err.message}` })); return; }
    const sel = $("#preview-team");
    for (const t of TEAMS.filter((x) => !x.fictional)) sel.append(el("option", { value: t.slug, text: t.name }));
    // the preview team: the one asked for in the URL, else Ohio State, else the first
    const wanted = START_PARAMS.get("team");
    if (TEAMS.some((t) => t.slug === wanted)) sel.value = wanted;
    else if (TEAMS.some((t) => t.slug === "ohio-state")) sel.value = "ohio-state";
    else sel.value = sel.options[0].value;
    sel.addEventListener("change", () => { renderPreview(); renderList(); });
    coach = clone(OPT.blank);
    const id = START_PARAMS.get("id");
    if (id) { try { coach = await api(`/api/coaches/${encodeURIComponent(id)}`); } catch (_) { /* a new coach */ } }
    $("#btn-new-coach").addEventListener("click", () => { coach = clone(OPT.blank); renderForm(); renderList(); });
    renderForm();
    renderList();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
