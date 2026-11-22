// Holds sim_js/bowls.js, teamnames.js, fcs_names.js and coaches.js to Python's answers
// (small_modules_reference.py writes them): node sim_js/test/small_modules_compare.mjs out.json
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { set_reader, read_json } from "../../engine_js/files.js";
import { modules, has } from "../../engine_js/modules.js";
import { bowls } from "../bowls.js";
import { teamnames } from "../teamnames.js";
import { fcs_names } from "../fcs_names.js";
import { coaches } from "../coaches.js";
import { apply_coach } from "../game_job.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const node_reader = (p) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), "utf8");
set_reader(node_reader);

const ref = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

// exactly the same: every number the same double, every key, and the keys in the same order
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && same(a[k], b[k]));
}
const pairs = (o) => Object.entries(o);
const short = (v) => (JSON.stringify(v) ?? String(v)).slice(0, 300);

const counts = {};
const wrong = [];
function check(what, got, want, where = "") {
  const c = (counts[what] ??= { n: 0, bad: 0 });
  c.n++;
  if (!same(got, want)) {
    c.bad++;
    if (wrong.length < 20) wrong.push(`${what} ${where}: got ${short(got)} want ${short(want)}`);
  }
}
// what a call gave, as the reference has it: its value, a ValueError's message, or that it stopped some other way
function attempt(fn, ValueError) {
  try {
    return { ok: fn() };
  } catch (e) {
    return ValueError && e instanceof ValueError ? { error: e.message } : { raises: true };
  }
}
const expected = (want) => ("raises" in want ? { raises: true } : want);

// ---- the four are registered under their Python names ----
for (const [name, ns] of [["bowls", bowls], ["teamnames", teamnames], ["fcs_names", fcs_names], ["coaches", coaches]]) {
  check("registered in modules", has(name) && modules[name] === ns, true, name);
}

// ---- bowls ----
{
  const b = ref.bowls;
  check("bowls constants", [bowls.PRIORITY, pairs(bowls.DEFAULT_TIE_INS), [...bowls.G5].sort(), [...bowls.INDEPENDENT].sort(), bowls.BOWLS_FILE],
    [b.PRIORITY, b.DEFAULT_TIE_INS, b.G5, b.INDEPENDENT, b.BOWLS_FILE]);
  check("load_bowls", bowls.load_bowls(), b.load_bowls);
  check("load_bowls (a copy of its own at every call, as Python's)", bowls.load_bowls() !== bowls.load_bowls(), true);
  for (const [d, want] of b.bowl_week) check("bowl_week", bowls.bowl_week(d), want, short(d));
  for (const [g, want] of b._payout) {
    const got = attempt(() => bowls._payout(g));
    check("_payout", "error" in want ? "raises" in got : got, "error" in want ? true : want, short(g));
  }
  const data = bowls.load_bowls();
  check("ordered_bowls", bowls.ordered_bowls(data).map((x) => x.bowl), b.ordered_bowls);
  check("ordered_bowls (off the priority list, payouts tied)", bowls.ordered_bowls(b.ordered_bowls_mixed.data), b.ordered_bowls_mixed.want);
  for (const [g, want] of b.tie_ins_for) check("tie_ins_for", bowls.tie_ins_for(g), want, short(g));
  b.select_bowls.forEach((c, i) => {
    const [records, teams, field, order, ratings] = c.args;
    check("select_bowls (made-up standings)", bowls.select_bowls(records, teams, new Set(field), order, ratings), c.result, `case ${i}`);
    if (i < 5) check("select_bowls (the field as a list)", bowls.select_bowls(records, teams, field, order, ratings), c.result, `case ${i}`);
  });
  b.playoff_sites.cases.forEach((c, i) => {
    check("playoff_sites (made-up seedings)", bowls.playoff_sites(Object.fromEntries(c.seeds), b.playoff_sites.conference_of), c.result, `case ${i}`);
    check("playoff_sites (seeds as a Map)", bowls.playoff_sites(new Map(c.seeds), b.playoff_sites.conference_of), c.result, `case ${i}`);
  });
  for (const season of b.seasons) {
    for (const c of season.calls) {
      const what = `season ${season.seed}: ${c.fn}`;
      if (c.fn === "select_bowls") {
        const [records, teams, field, order, ratings] = c.args;
        check(what, bowls.select_bowls(records, teams, new Set(field), order, ratings), c.result);
      } else {
        check(what, bowls[c.fn](...c.args), c.result, short(c.args));
      }
    }
  }
  // no data file on this host: the empty lineup, as Python without the file
  set_reader((p) => { throw new Error(`${p} is not here`); });
  check("load_bowls (no file)", bowls.load_bowls(), { playoff: [], bowls: [] });
  check("playoff_sites (no file)", bowls.playoff_sites({ 1: "smu" }, { smu: "ACC" }), {});
  set_reader(node_reader);
}

// ---- teamnames ----
{
  const t = ref.teamnames;
  check("teamnames.ALIASES", pairs(teamnames.ALIASES), t.ALIASES);
  t.names.forEach((n, i) => check("norm", teamnames.norm(n), t.norm[i], short(n)));
  for (const [which, teams] of Object.entries(t.teams)) {
    const lookup = teamnames.build_matcher(teams);
    check("build_matcher", pairs(lookup), t.build_matcher[which], which);
    t.names.forEach((n, i) => check(`match (${which})`, teamnames.match(n, lookup), t.match[which][i], short(n)));
  }
  // straight from the data files, as the season will hand them over
  const engine = read_json("data/engine_teams.json")["teams"];
  check("build_matcher (data/engine_teams.json itself)", pairs(teamnames.build_matcher(engine)), t.build_matcher.engine);
}

// ---- fcs_names ----
{
  const f = ref.fcs_names;
  check("fcs_names constants", [pairs(fcs_names._OLD), fcs_names._OLD_CONFERENCE, pairs(fcs_names.NEW_SLUGS)], [f._OLD, f._OLD_CONFERENCE, f.NEW_SLUGS]);
  for (const [region, slug, label] of f.regions) check("new_slug, label", [fcs_names.new_slug(region), fcs_names.label(region)], [slug, label], region);
  for (const [s, want] of f._r) check("_r (rot13)", fcs_names._r(s), want, s);
  const [pat, to] = fcs_names._table();
  check("_table (the pattern's text, the table)", [pat.source, pairs(to)], [f.pattern, f.table]);
  check("_table (made once)", fcs_names._table() === fcs_names._table(), true);
  f.texts.forEach((c, i) => {
    const where = `text ${i}: ${short(c.text).slice(0, 80)}`;
    check("has_old", fcs_names.has_old(c.text), c.has_old, where);
    check(c.has_old ? "rewrite_text (old names in it)" : "rewrite_text (none: the same text)", fcs_names.rewrite_text(c.text), c.out, where);
  });
  const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
  f.files.forEach((c) => {
    const raw = node_reader(c.path);
    check("has_old (a real file)", fcs_names.has_old(raw), c.has_old, c.path);
    check("rewrite_text (a real file: the same text)", fcs_names.rewrite_text(raw) === raw, c.same, c.path);
    const res = fcs_names.rewrite_text(`{"old": ${JSON.stringify(c.old)}, "file": ${raw}}`);
    check("rewrite_text (a real file inside an old save, by its hash)", [Array.from(res).length, sha(res)], [c.len, c.sha], c.path);
  });
  for (const [o, want] of f._fix_records) check("_fix_records", fcs_names._fix_records(structuredClone(o)), want, short(o));
}

// ---- coaches ----
{
  const c = ref.coaches;
  const consts = {};
  for (const name of Object.keys(c.consts)) consts[name] = coaches[name] instanceof RegExp ? coaches[name].source : coaches[name];
  check("coaches constants", consts, c.consts);
  for (const name of Object.keys(c.consts)) check("coaches constants (one by one)", consts[name], c.consts[name], name);
  check("blank", coaches.blank(), c.blank);
  check("blank (a new one each time)", coaches.blank() !== coaches.blank() && coaches.blank().ratings !== coaches.ARCHETYPES["Program Builder"].ratings, true);
  check("options", coaches.options(), c.options);
  for (const [face, want] of c._clean_face) check("_clean_face", coaches._clean_face(face), want, short(face));
  c.clean.forEach(([data, want], i) => {
    const before = JSON.stringify(data);
    check("clean", attempt(() => coaches.clean(data), coaches.ValueError), expected(want), `case ${i}: ${short(data)}`);
    check("clean (what it was given is not changed)", JSON.stringify(data), before, `case ${i}`);
  });
  for (const [id, want] of c._path) check("_path", attempt(() => coaches._path(id), coaches.ValueError), expected(want), short(id));

  const teams = read_json("data/engine_teams.json")["teams"];
  for (const [slug, want] of c.staff.teams) {
    const t = teams[slug];
    check("_coordinator, staff", [coaches._coordinator(t, "offense"), coaches._coordinator(t, "defense"), coaches.staff(null, t),
      ...c.made.map((coach) => coaches.staff(coach, t))], want, slug);
  }
  for (const [t, want] of c.staff.odd) {
    check("_coordinator, staff (teams with pieces missing)", [coaches._coordinator(t, "offense"), coaches._coordinator(t, "defense"),
      coaches.staff(null, t), coaches.staff({}, t), ...c.made.map((coach) => coaches.staff(coach, t))], want, short(t));
  }
  check("apply_coach (the one in game_job.js)", coaches.apply_coach === apply_coach, true);
  for (const [slug, rows, same_none, same_empty] of c.apply_coach) {
    const team = teams[slug];
    const before = JSON.stringify(team);
    rows.forEach((want, i) => {
      const t = coaches.apply_coach(team, c.made[i]);
      const shown = Object.fromEntries(Object.entries(t).filter(([k]) => k !== "offense" && k !== "defense"));
      check("apply_coach", { team: shown, keys: Object.keys(t), players: t.offense === team.offense && t.defense === team.defense }, want, `${slug} coach ${i}`);
    });
    check("apply_coach (no coach: the same team)", [coaches.apply_coach(team, null) === team, coaches.apply_coach(team, {}) === team], [same_none, same_empty], slug);
    check("apply_coach (the team given is not changed)", JSON.stringify(team) === before, true, slug);
  }
  for (const [t, want] of c.apply_coach_bare) {
    check("apply_coach (teams with pieces missing)", c.made.map((coach) => coaches.apply_coach(structuredClone(t), coach)), want, short(t));
  }

  // the saved coaches: Python's directory is a Map here
  const s = c.store;
  check("store unset: load, list_all, save and delete of a real id stop", [
    attempt(() => coaches.load("0123456789ab")), attempt(() => coaches.list_all()), attempt(() => coaches.save(c.made[0])),
    attempt(() => coaches.delete("0123456789ab"))].every((r) => "raises" in r), true);
  check("store unset: an id that is no id is still no coach", coaches.load("nope"), null);
  let files = new Map();
  coaches.store = {
    read: (id) => (files.has(id) ? files.get(id) : null),
    write: (id, text) => { files.set(id, text); },
    remove: (id) => { files.delete(id); },
    list: () => [...files.keys()],
  };
  check("list_all (nothing saved)", coaches.list_all(), s.list_empty);
  check("load (nothing saved)", coaches.load("0123456789ab"), s.load_empty);
  const AT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/;
  for (const step of s.steps) {
    if (step.do === "load") {
      const got = coaches.load(step.arg);
      check("load", got && { ...got, updated_at: "<AT>" }, step.result, short(step.arg));
    } else if ("text" in step) {
      const n = files.size;
      const got = coaches.save(structuredClone(step.arg));
      const id = got.id, at = got.updated_at;
      const fresh = step.result.id === "<ID>";
      check("save (the id: 12 hex characters when new, kept when given; the time)", [/^[a-f0-9]{12}$/.test(id), fresh || id === step.arg.id, AT.test(at),
        files.size], [true, true, true, n + 1], id);
      check("save (the coach it returns)", { ...got, id: fresh ? "<ID>" : id, updated_at: "<AT>" }, step.result);
      const text = files.get(id).replace(at, "<AT>");
      check("save (the file's text)", fresh ? text.replace(id, "<ID>") : text, step.text);
    } else {
      check("save (refused)", attempt(() => coaches.save(structuredClone(step.arg)), coaches.ValueError), expected(step.result), short(step.arg.id));
    }
  }
  files = new Map(Object.entries(s.files));
  check("list_all", coaches.list_all(), s.list_all);
  for (const [id, want] of s.loads) check("load (older files, one from before the stand-ins' rename)", coaches.load(id), want, id);
  for (const [id, want] of s.deletes) check("delete", attempt(() => coaches.delete(id), coaches.ValueError), expected(want), short(id));
  check("list_all (after the deletes)", coaches.list_all(), s.list_after);
  coaches.store = null;
}

let bad = 0;
for (const [what, c] of Object.entries(counts)) {
  bad += c.bad;
  console.log(`${c.bad ? "MISMATCH" : "ok      "} ${what}: ${c.n} compared, ${c.n - c.bad} identical${c.bad ? `, ${c.bad} different` : ""}`);
}
for (const w of wrong) console.log(w);
console.log(bad ? `${bad} DIFFERENT` : "all identical");
process.exit(bad ? 1 : 0);
