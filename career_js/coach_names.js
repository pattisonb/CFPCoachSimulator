// One coach, one name, one job (a career's league). The real 2026 data lists a head coach who
// calls his own plays twice: as the head coach and again as the offensive coordinator, under the
// same name (North Texas: Neal Brown both times). A career keeps people apart:
//
// - **A head coach never doubles as his own coordinator.** The coordinator's slot keeps its
//   ratings, scheme and id but is a different man: a generated name, the same one every time for
//   that program and role (`own_name`), so your staff on day one and the league built after the
//   season agree.
// - **Your name wins.** Whatever you call your coach (or the real head coach you took over as),
//   nobody else in the league has that name.
// - **Any other two coaches with one name:** a real coach (one in the 2026 data) keeps his own
//   record and gains a middle initial ("Tim Beck" -> "Tim R. Beck"); a generated coach is renamed
//   from the generated pool (recruits._name, checked against every name in use).
//
// `distinct(state)` applies all of it to a career (its league, its market and your staff); it is
// deterministic and idempotent, so it runs when the league is built and on every load (an older
// save heals). Its draws are its own seeded streams: nothing in the season or the carousel moves.
//
// Ported from coach_career/coach_names.py by engine_js/PORTING.md's rules. Sets of names are `Set`s that are only
// asked whether they hold a name (never walked), so their order does not matter.
import { Random, sorted, cmp, get, truthy } from "../engine_js/pyrt.js";
import { read_text } from "../engine_js/files.js";
import { modules } from "../engine_js/modules.js";
import { recruits } from "./recruits.js";

export const coach_names = {};

/** str(v) inside an f-string, for what JSON holds: None, True and False are Python's words. */
const pystr = (v) => (v === null || v === undefined ? "None" : v === true ? "True" : v === false ? "False" : String(v));
/** a | b | ...: a new set of everything in them. */
const union = (...sets) => { const out = new Set(); for (const s of sets) for (const x of s) out.add(x); return out; };
const is_dict = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

coach_names.ROLES = ["head_coach", "offensive_coordinator", "defensive_coordinator"];
coach_names.COORDS = { OC: "offensive_coordinator", DC: "defensive_coordinator" };
coach_names.INITIALS = "ABCDEFGHJKLMNPRSTW";      // middle initials a renamed real coach may get *tune*
coach_names.OWN_STAFF_JOB = "Promoted from the staff";   // the previous job of a coordinator split off a play-calling head coach


coach_names._base_names = {};   // the names in a teams file, by path: a few KB, so the file need not stay loaded

// every coach's name in a teams dict, lowercase
function _names_of(teams) {
  const out = new Set();
  for (const t of Object.values(teams)) {
    for (const c of Object.values(get(t, "coaches") || {})) if (truthy(c) && truthy(get(c, "name"))) out.add(c["name"].toLowerCase());
  }
  return out;
}

export function base_names() {
  // Every coach name in the 2026 data (lowercase): the real coaches. Read from the loaded teams when the
  // game has them, else from the file alone (a league file check runs before any career is open, and must
  // not leave the whole built-in league cached behind it).
  const season = modules.season;
  let teams;
  if (truthy(season._teams_cache)) {
    teams = season._teams_cache;
  } else {
    const key = String(season._league_path);
    if (!(key in coach_names._base_names)) {
      teams = JSON.parse(read_text(season._league_path))["teams"];
      coach_names._base_names[key] = _names_of(teams);
    }
    return new Set(coach_names._base_names[key]);
  }
  return _names_of(teams);
}


export function own_name(slug, role, reserved = new Set()) {
  // The coordinator at `slug` in `role` when the data's coordinator is the head coach himself:
  // a generated name, fixed per program and role (`reserved`, lowercase, are names it must avoid
  // besides the real coaches').
  const rng = new Random(`own-staff-${pystr(slug)}-${pystr(role)}`);
  return recruits._name(rng, union(coach_names.base_names(), Array.from(reserved, (n) => n.toLowerCase())));
}


export function with_initial(name, taken, where) {
  // `name` with a middle initial no one else has ("Neal Brown" -> "Neal R. Brown").
  const at = name.indexOf(" ");
  const first = at < 0 ? name : name.slice(0, at), rest = at < 0 ? "" : name.slice(at + 1);
  const letters = Array.from(coach_names.INITIALS);
  new Random(`initial-${name}-${where}`).shuffle(letters);
  for (const letter of letters) {
    const n = rest ? `${first} ${letter}. ${rest}` : `${first} ${letter}.`;
    if (!taken.has(n.toLowerCase())) return n;
  }
  return recruits._name(new Random(`initial-x-${name}-${where}`), new Set(taken));
}


export function _you_slug(state) {
  // The program whose head coaching job is yours in the league: your next school once you have
  // taken a job this offseason, else your team.
  const off = get(state, "offseason") || {};
  return get(off, "move_to") || get(state, "team");
}


export function your_record(state) {
  // Your coach's record in the career's league (marked `you`; an older save: the head coach at
  // your program), or None before the league is built.
  const lgd = get(state, "league") || {};
  const teams = get(lgd, "teams") || {};
  for (const slug of sorted(Object.keys(teams))) {
    const hc = get(get(teams[slug], "coaches") || {}, "head_coach");
    if (truthy(hc) && truthy(get(hc, "you"))) return hc;
  }
  const slug = coach_names._you_slug(state);
  const hc = truthy(slug) ? get(get(get(teams, slug) || {}, "coaches") || {}, "head_coach") : null;
  return truthy(hc) ? hc : null;
}


export function player_name(state) {
  // Your coach's name: the coach you created, else the real head coach you took over as.
  const you = get(get(state, "career") || {}, "coach");
  if (truthy(you) && truthy(get(you, "name"))) return you["name"];
  const rec = coach_names.your_record(state);
  if (truthy(rec) && truthy(get(rec, "name"))) return rec["name"];
  if (!truthy(get(state, "team"))) return null;           // a league alone (a league file check): no one is you yet
  const season = modules.season;
  const t = get(season.load_teams(), get(state, "team")) || {};
  return get(get(get(t, "coaches") || {}, "head_coach") || {}, "name");
}


export function _claim_your_record(state) {
  // Mark your record in the league as yours and give it your created coach's name and age (the
  // league is built from the 2026 data, so until now it held the head coach you replaced).
  const rec = coach_names.your_record(state);
  if (rec === null) return;
  rec["you"] = true;
  const you = get(get(state, "career") || {}, "coach");
  if (truthy(you) && truthy(get(you, "name")) && !pystr(get(rec, "coach_id") || "").endsWith(":you")) {
    const slug = coach_names._you_slug(state);
    rec["name"] = you["name"];
    rec["coach_id"] = `${pystr(slug)}:head_coach:you`;
    for (const k of ["history", "alma_mater", "age_at"]) delete rec[k];          // the replaced coach's, not yours
    const age = get(get(state, "coach") || {}, "age");
    if (truthy(age)) rec["age_at"] = [2026, Math.trunc(Number(age))];
  }
}


export function distinct(state, built = false) {
  // Make every name in a career unique and every role its own person (the rules above). Returns
  // the renames, [{"team", "role", "old", "new"}] (team None: the market). Your staff follows its
  // coordinators' renames. Safe to run any number of times.
  const lgd = get(state, "league");
  const renames = [];
  const year = get(get(state, "offseason") || {}, "year") || get(lgd || {}, "year") || get(state, "year") || 2026;
  const real = coach_names.base_names();
  if (truthy(lgd)) {
    coach_names._claim_your_record(state);
    const you = coach_names.your_record(state);
    const mine = coach_names.player_name(state);
    const reserved = truthy(mine) ? new Set([mine.toLowerCase()]) : new Set();

    const created = truthy(get(get(state, "career") || {}, "coach"));
    // 1. a head coach who is also listed as his own coordinator: the coordinator is a new man
    //    (not under a coach you created: the real coach you replaced stays on as coordinator, step 2)
    for (const slug of sorted(Object.keys(lgd["teams"]))) {
      const cs = lgd["teams"][slug]["coaches"];
      if (created && truthy(get(get(cs, "head_coach") || {}, "you"))) continue;
      const hc = get(get(cs, "head_coach") || {}, "name");
      for (const role of coach_names.ROLES.slice(1)) {
        const c = get(cs, role);
        if (truthy(hc) && truthy(c) && truthy(get(c, "name")) && c["name"].toLowerCase() === hc.toLowerCase()) {
          renames.push({ team: slug, role: role, old: c["name"], new: null });
          c["name"] = coach_names.own_name(slug, role, reserved);
          renames[renames.length - 1]["new"] = c["name"];
          c["previous_job"] = coach_names.OWN_STAFF_JOB;
          delete c["age_at"];
          delete c["plays_called_by_hc"];
        }
      }
    }
    // 2. everyone else: your name first, then the real coaches, then the generated ones
    const entries = [];
    for (const slug of sorted(Object.keys(lgd["teams"]))) {
      for (const role of coach_names.ROLES) {
        const c = get(lgd["teams"][slug]["coaches"], role);
        if (truthy(c) && truthy(get(c, "name"))) entries.push([c !== you, !real.has(c["name"].toLowerCase()), slug, role, c]);
      }
    }
    for (const e of sorted(get(get(lgd, "market") || {}, "coaches", []), (e) => e["id"])) {
      entries.push([true, !real.has(e["name"].toLowerCase()), null, e["id"], e]);
    }
    entries.sort((a, b) => cmp([a[0], a[1]], [b[0], b[1]]));           // stable: within a group, the order above
    const every = new Set(entries.map((x) => x[4]["name"].toLowerCase()));
    const seen = new Set();
    for (const [, generated, slug, role, c] of entries) {
      let key = c["name"].toLowerCase();
      if (seen.has(key)) {
        let name;
        if (generated) {
          name = recruits._name(new Random(`rename-${pystr(slug)}-${pystr(role)}-${c["name"]}`), union(seen, every, real));
        } else {
          if (!truthy(get(c, "age_at")) && slug !== null) modules.carousel._age(c, year);
          name = coach_names.with_initial(c["name"], union(seen, every), `${pystr(slug)}-${pystr(role)}`);
        }
        renames.push({ team: slug, role: truthy(slug) ? role : null, old: c["name"], new: name });
        c["name"] = name;
        if (slug === null && is_dict(get(c, "coach"))) c["coach"]["name"] = name;
        key = name.toLowerCase();
        every.add(key);
      }
      seen.add(key);
    }
    // 3. one record, one id
    const ids = new Set();
    for (const slug of sorted(Object.keys(lgd["teams"]))) {
      for (const role of coach_names.ROLES) {
        const c = get(lgd["teams"][slug]["coaches"], role);
        if (!truthy(c)) continue;
        let cid = get(c, "coach_id") || `${slug}:${role}`;
        let n = 2;
        while (ids.has(cid)) {
          cid = `${get(c, "coach_id") || `${slug}:${role}`}:${n}`;
          n += 1;
        }
        c["coach_id"] = cid;
        ids.add(cid);
      }
    }
  }
  coach_names._staff(state, renames, built);
  return renames;
}


export function coordinator_name(slug, role, name, hc_name, created) {
  // Your coordinator's name on day one (recruiting.make_staff, before the league exists), from
  // the data's `name` for him: the data's head coach doubling as coordinator becomes his own man
  // (`own_name`); a real coordinator who shares the name of the coach you created gains a middle
  // initial. The league built after the season gives him the same name (`distinct`).
  if (!truthy(name) || !truthy(hc_name) || name.toLowerCase() !== hc_name.toLowerCase()) return name;
  if (created) return coach_names.with_initial(name, union(coach_names.base_names(), [hc_name.toLowerCase()]), `${pystr(slug)}-${pystr(role)}`);
  return coach_names.own_name(slug, role, new Set([hc_name]));
}


export function _staff(state, renames, built = false) {
  // Your staff after the league's renames: a coordinator follows his record (`built`: the league
  // was just made from the data your staff was made from, so he takes his record's name outright);
  // no one on it shares your name or a colleague's, no recruiter a coach's elsewhere, and every
  // member has his own id.
  const car = get(state, "career") || {};
  const staff = get(car, "staff");
  if (!truthy(staff)) return;
  const lgd = get(state, "league") || {};
  const me = get(state, "team");
  const mine = coach_names.player_name(state) || "";
  const cs = get(get(get(lgd, "teams") || {}, me) || {}, "coaches") || {};
  for (const s of staff) {
    const key = get(coach_names.COORDS, s["role"]);
    if (!truthy(key)) continue;
    const rec = get(cs, key) || {};
    if (built && truthy(get(rec, "name")) && !truthy(get(rec, "vacant"))) {
      s["name"] = rec["name"];
      continue;
    }
    for (const r of renames) {
      if (r["team"] === me && r["role"] === key && s["name"] === r["old"]) s["name"] = r["new"];
    }
    if (!truthy(lgd)) s["name"] = coach_names.coordinator_name(me, key, s["name"], mine, truthy(get(car, "coach")));
  }
  const names = _names_of(get(lgd, "teams") || {});
  for (const e of get(get(lgd, "market") || {}, "coaches", [])) names.add(e["name"].toLowerCase());
  const seen = truthy(mine) ? new Set([mine.toLowerCase()]) : new Set();
  const ids = new Set();
  for (const s of staff) {
    const key = s["name"].toLowerCase();
    if (seen.has(key) || (!Object.hasOwn(coach_names.COORDS, s["role"]) && names.has(key))) {
      s["name"] = recruits._name(new Random(`staff-name-${pystr(me)}-${pystr(s["id"])}-${s["name"]}`), union(seen, names, coach_names.base_names()));
    }
    seen.add(s["name"].toLowerCase());
    const sid = s["id"];
    let n = 2;
    while (ids.has(s["id"])) {
      s["id"] = `${sid}-${n}`;
      n += 1;
    }
    ids.add(s["id"]);
  }
}

Object.assign(coach_names, {
  base_names, own_name, with_initial, _you_slug, your_record, player_name, _claim_your_record, distinct,
  coordinator_name, _staff,
});

modules.coach_names = coach_names;
