// The coaching carousel of a Coach Career (docs/superpowers/specs/2026-10-23-career-offseason-design.md,
// section 7): every program's athletic director sets a goal from the program's standing and has so
// much patience; each head coach's job security moves with his results against it. After the
// season coaches are fired, retire or leave for the NFL; the openings are filled in order of the
// program's prestige from hot head coaches at smaller programs, top coordinators and generated
// candidates, so one hire opens another job. Coordinators are poached the same way. You get a goal
// and job security too: after a big year better programs with an opening may offer you their job,
// and if your AD runs out of patience you pick a new job from the openings.
//
//     league team["ad"] = {"patience": 2-5, "security": 0-100}
//     state["offseason"]["carousel"] = {"changes": [...], "openings": [...], "you": {...}, "offers": [...], "choice": slug|None}
//
// It was coach_career/carousel.py; engine_js/PORTING.md has the rules it was ported by. Modules reached through
// `modules` (not ported when this was written, or reached there to keep the load free of circles): programs,
// recruiting, offseason, season. What could not be written literally is listed at the end of this file.
import { Random, round, int, sum, sorted, get, truthy } from "../engine_js/pyrt.js";
import { modules } from "../engine_js/modules.js";
import { read_json, exists } from "../engine_js/files.js";
import { ValueError } from "../sim_js/coaches.js";
import { build_teams } from "../teamdata_js/build_teams.js";
import { shown } from "../teamdata_js/shown.js";
import { recruits } from "./recruits.js";

/** Python's str() of a value inside an f-string, for the ones that can be None or a bool ("None", "True"). */
const pystr = (v) => (v === null || v === undefined ? "None" : v === true ? "True" : v === false ? "False" : String(v));
/** `x in coll` for a module's constant that may have been ported as a Set, a list or a dict. */
const contains = (coll, x) => (coll instanceof Set ? coll.has(x) : Array.isArray(coll) ? coll.includes(x) : x in coll);
/** json.loads(json.dumps(o)): a deep copy. */
const deep = (o) => JSON.parse(JSON.stringify(o));

// goals, by the program's recruiting baseline (about -2 to +2): (from, kind, wins, words) *tune*
const GOALS = [[1.2, "playoff", 10, "Make the College Football Playoff"], [0.5, "wins", 9, "Win nine games"],
  [-0.3, "wins", 7, "Win seven games and go bowling"], [-10, "wins", 6, "Reach a bowl game"]];
const G5_TITLE_FROM = 0.0;             // a Group of 5 program this strong expects to win its conference
const START_SECURITY = 70;
const STANDING = [33, 90];             // a sitting coach's unknown standing when the career starts (third season on) *tune*
const MAX_DROP = 45;                   // *tune* the most security one season can cost a coach at a top program (DROP_TIER)
const DROP_TIER = 2;                   // *tune* programs of this tier or better are the ones MAX_DROP protects
const HONEYMOON = 2;                   // a new coach's first seasons count half against him
const WIN_STEP = 8;                    // security per win over or under the goal
const BONUS = { "conference": 10, "playoff": 12, "title": 25 };
const FIRE_BELOW = 25, FIRE_CHANCE = 0.7, MUST_FIRE = 8;    // your own job: at risk under FIRE_BELOW
const LEAGUE_FIRE_BELOW = 40;          // *tune* the other head coaches are at risk under this (higher than yours: about twenty jobs turn over a year, most of them firings)
const RETIRE = 0.06;                   // a year from RETIRE_FROM on, more after 12 seasons in the job and with every year past it (an age drawn when unknown)
const RETIRE_FROM = 60;                // *tune* the age retirement starts at: a younger coach steps away only at RETIRE_YOUNG
const RETIRE_YOUNG = 0.015;            // *tune* a year, for a head coach under RETIRE_FROM
const NFL_CHANCE = 0.05;               // *tune* a 80+ head coach after 10 wins
const STAY_TIER = 1;                   // *tune* a head coach at a program of this tier or better is not hired away by another college; one tier below it leaves only for a better tier
const COORD_MOVE = 0.13;               // coordinators leaving for other jobs on their own
const HC_MOVE_PCT = 0.55;              // a sitting head coach with this winning share over three years is a candidate elsewhere
const MOVE_UP = 3;                     // a sitting head coach takes an opening this much more attractive than his own job
const COORD_UP = -15;                  // a coordinator takes a head coaching job at any program within this of his own
const HC_PROVEN = 8;                   // a sitting head coach's edge over a coordinator or a market coach
const OFFER_FROM = 80;                 // your security this high, and better programs with an opening call
const FIRED_PICKS = 6;                 // openings offered to you after you are fired (the lower ones)
const MARKET_SIZE = 150;               // coaches for hire the market is topped up to each offseason *tune*
const MARKET_STALE = 3;                // years in the market before a coach retires from it
const SUPPLY_LEVEL = -10.0, SUPPLY_SPREAD = 10.0;   // the generated supply's level against the league's coaches: most are bottom-tier material
const OWN_STAFF = 0.5;                 // a new head coach brings his own coordinator this often
const COORD_ROLES = ["offensive_coordinator", "defensive_coordinator"];
const ROLE_WORDS = { "head_coach": "head coach", "offensive_coordinator": "offensive coordinator",
  "defensive_coordinator": "defensive coordinator" };

export function _rng(state, what) {
  return new Random(`carousel-${modules.offseason.seed_key(state)}-${get(state, "year", 2026)}-${what}`);
}

export function baseline(slug) {
  return modules.recruiting._baseline(slug);
}

export function goal(slug, state = null) {
  // What the AD expects every year: by the program's tier (the living rating).
  const programs = modules.programs, season = modules.season;
  const bt = season.load_teams()[slug];
  const p4 = season._is_p4(slug, bt);
  const p = programs.get(truthy(state) ? state : {}, slug);
  return programs.goal_for(p["tier"], p4, p["rating"], contains(programs.INDEPENDENTS, get(bt, "conference")));
}

export function attract(state, slug) {
  return modules.programs.attract(state, slug);
}

export function ad(team, slug, year = null) {
  // The program's AD (patience fixed per program, drawn once) and the head coach's security. A
  // coach already in his third season or later starts with a standing we do not know: drawn
  // between STANDING (some sit on hot seats); a newer coach starts at START_SECURITY.
  if (!("ad" in team)) {
    const r = new Random(`ad-${slug}`);
    const tier = modules.programs.base(slug)["tier"];
    const base = tier === 1 ? 2 : tier === 2 ? 3 : 4;
    const hc = get(get(team, "coaches") || {}, "head_coach") || {};
    const tenure = truthy(year) ? year - (get(hc, "since") || year) : 0;
    const sec = tenure < 2 ? carousel.START_SECURITY
      : new Random(`standing-${slug}-${pystr(get(hc, "name"))}`).randint(carousel.STANDING[0], carousel.STANDING[1]);
    team["ad"] = { "patience": Math.max(2, Math.min(5, base + r.choice([-1, 0, 0, 1]))), "security": sec };
  }
  return team["ad"];
}

export function _results(state) {
  // Each program's season: wins, losses, conference title, playoff, national title.
  const recs = modules.season._records(state, undefined, true);
  const playoff = new Set(), hosts = new Set();
  for (const g of Object.values(state["games"])) {
    if (get(g, "kind") === "playoff") { playoff.add(g["home"]); playoff.add(g["away"]); }
  }
  for (const g of Object.values(state["games"])) {
    if (get(g, "kind") === "playoff" && !truthy(get(g, "neutral"))) hosts.add(g["home"]);   // a first-round game on campus
  }
  const champs = new Set(Object.values(get(state, "champions") || {}));
  const out = {};
  for (const [slug, r] of Object.entries(recs)) {
    out[slug] = { "wins": r["wins"], "losses": r["losses"], "conference": champs.has(slug), "playoff": playoff.has(slug), "host": hosts.has(slug),
      "title": get(state, "champion") === slug };
  }
  return out;
}

export function judge(team, slug, res, year, state = null) {
  // The AD's verdict on a season: security moves with wins against the goal and the honors.
  const a = carousel.ad(team, slug, year);
  const g = carousel.goal(slug, state);
  const hc = team["coaches"]["head_coach"];
  const tenure = year - (get(hc, "since") || 2020);
  let delta = carousel.WIN_STEP * (res["wins"] - g["wins"]);
  if (g["kind"] === "playoff" && !truthy(res["playoff"])) delta -= 6;
  if (g["kind"] === "conference" && !truthy(res["conference"])) delta -= 6;
  for (const [k, v] of Object.entries(carousel.BONUS)) {
    if (truthy(get(res, k))) delta += v;
  }
  if (delta < 0) {
    delta *= 3 / a["patience"];                      // an impatient AD feels a bad year more
    if (tenure <= carousel.HONEYMOON) delta /= 2;
    if (modules.programs.base(slug)["tier"] <= carousel.DROP_TIER) {      // the top jobs: a single bad year puts him on the hot seat, it rarely fires him
      delta = Math.max(delta, -carousel.MAX_DROP);
    }
  }
  a["security"] = int(Math.max(0, Math.min(100, a["security"] + delta)));
  const met = res["wins"] >= g["wins"] && (g["kind"] !== "playoff" || res["playoff"]) && (g["kind"] !== "conference" || res["conference"]);
  return { "goal": g, "met": met, "security": a["security"], "delta": int(round(delta)), "tenure": tenure, "patience": a["patience"] };
}

/** build_teams.OBSERVED: the file of observed styles (the part of build_teams ported so far may not carry it). */
const observed_path = () => get(build_teams, "OBSERVED", null) || "data/observed_tendencies.json";

export function new_style(rng, lgd, slug) {
  // A new head coach brings his own way of playing: the observed 2026 style of a real program
  // (data/observed_tendencies.json), so every team keeps playing like a real one does.
  const path = observed_path();
  const obs = exists(path) ? read_json(path)["teams"] : {};
  const pool = sorted(Object.entries(obs).filter(([s, o]) => get(o, "games", 0) >= 2 && s !== slug).map(([s, _]) => s));
  return pool.length ? rng.choice(pool) : slug;
}

export function _rating(c) {
  const r = get(c, "ratings") || {};
  return get(r, "overall") || (get(r, "play_calling", 60) + get(r, "player_development", 60) + get(r, "recruiting", 60)) / 3;
}

const BIRTH_YEARS = "data/coach_birth_years.json";
const _BIRTHS = {};
const _HOMETOWNS = {};

export function hometown(name) {
  // Where a real head coach is from ("Milbank, SD": the `hometowns` of data/coach_birth_years.json), or "" when
  // we do not know.
  if (!truthy(carousel._HOMETOWNS) && exists(carousel.BIRTH_YEARS)) {
    Object.assign(carousel._HOMETOWNS, get(read_json(carousel.BIRTH_YEARS), "hometowns") || {});
  }
  return get(carousel._HOMETOWNS, name) || "";
}

export function _birth_years() {
  if (!truthy(carousel._BIRTHS) && exists(carousel.BIRTH_YEARS)) {
    Object.assign(carousel._BIRTHS, read_json(carousel.BIRTH_YEARS)["birth_years"]);
  }
  return carousel._BIRTHS;
}

export function _age(c, year) {
  // His age: from his real birth year (data/coach_birth_years.json, the 2026 head coaches)
  // when we know it, else a seeded draw between 38 and 62.
  if (!truthy(get(c, "age_at"))) {
    const born = get(carousel._birth_years(), get(c, "name"));
    c["age_at"] = truthy(born) ? [year, year - born] : [year, new Random(`age-${pystr(get(c, "name"))}`).randint(38, 62)];
  }
  const [y, a] = c["age_at"];
  return a + (year - y);
}

/** [t["coaches"][role] for t in lgd["teams"].values() if t["coaches"].get(role)] */
const holders = (lgd, role) => Object.values(lgd["teams"]).filter((t) => truthy(get(t["coaches"], role))).map((t) => t["coaches"][role]);

export function generated(rng, lgd, role, slug, year, like = null, level = 0.0) {
  // A coach for hire who is not in the league's jobs: ratings drawn like a random coach at that
  // role, shifted by `level` (a candidate for a better job is better), scheme from `like`.
  const model = rng.choice(holders(lgd, role));
  const base = deep(truthy(like) ? like : model);
  const ratings = {};
  for (const [k, v] of Object.entries(model["ratings"])) ratings[k] = int(Math.max(30, Math.min(95, v + rng.gauss(level - 2, 6))));
  const name = recruits._name(rng, carousel._taken_names(lgd));
  const previous_job = rng.choice(["NFL assistant", "Coordinator at an FCS program", "Assistant head coach",
    "Position coach", "Head coach at a lower level"]);
  Object.assign(base, { "name": name, "ratings": ratings, "since": year, "coach_id": `${slug}:${role}:${year}`,
    "previous_job": previous_job, "ratings_generated": true, "age_at": [year, rng.randint(34, 55)] });
  return base;
}

// ----- the coaching market ----------------------------------------------------------------------

export function _taken_names(lgd) {
  // Every name in use (lowercase, as recruits._name checks): the league's coaches, yours among
  // them, and the market's. Every generated coach is drawn against it (coach_names).
  const names = new Set();
  for (const t of Object.values(lgd["teams"])) {
    for (const c of Object.values(t["coaches"])) {
      if (truthy(c) && truthy(get(c, "name"))) names.add(c["name"].toLowerCase());
    }
  }
  for (const c of get(get(lgd, "market") || {}, "coaches", [])) names.add(c["name"].toLowerCase());
  return names;
}

export function _ratings_for(lgd, role, coach, rng, level = 0.0) {
  // A coach's ratings in `role`: his own when he has held it, else drawn like a coach at that
  // role and shifted by `level`, keeping the shared ratings he already has.
  const by_role = get(get(coach, "ratings_by_role") || {}, role);
  const own = truthy(by_role) ? by_role : (get(coach, "role") === role ? get(coach, "ratings") : null);
  if (truthy(own)) return { ...own };
  const model = rng.choice(holders(lgd, role));
  const ratings = {};
  for (const [k, v] of Object.entries(model["ratings"])) ratings[k] = int(Math.max(20, Math.min(95, v + rng.gauss(level - 2, 6))));
  for (const [k, v] of Object.entries(get(coach, "ratings") || {})) {
    if (k in ratings && k !== "overall") ratings[k] = v;
  }
  return ratings;
}

export function _entry(coach, role, team, why, year, roles, rng) {
  // A market entry for a coach who just left `role` at `team`.
  const hist = [...(get(coach, "history") || [])];
  if (truthy(team)) hist.push({ "year": get(coach, "since") || year, "to": year, "team": team, "role": role });
  const not_kept = ["ratings", "history", "ratings_by_role"];
  return { "id": `m-${year}-${get(coach, "name", "x").toLowerCase().replaceAll(" ", "-")}-${rng.randint(0, 9999)}`,
    "name": coach["name"], "roles": roles, "last_role": role, "last_team": team, "why": why, "year": year,
    "age": carousel._age(coach, year), "history": hist, "ratings": { ...(get(coach, "ratings") || {}) },
    "ratings_by_role": { ...(get(coach, "ratings_by_role") || {}), ...(truthy(get(coach, "ratings")) ? { [role]: { ...coach["ratings"] } } : {}) },
    "coach": Object.fromEntries(Object.entries(coach).filter(([k, _]) => !not_kept.includes(k))) };
}

export function market(state) {
  // The coaches for hire: lgd["market"] = {"coaches": [entry], "year"}; built when first asked.
  const lgd = state["league"];
  if (!("market" in lgd)) {
    lgd["market"] = { "coaches": [], "year": get(state, "year", 2026) };
    carousel.market_refresh(state);
  }
  return lgd["market"];
}

// where a generated coach for hire comes from: (roles he would take, previous job words, level shift, age range)
const SUPPLY = [
  [["head_coach", "offensive_coordinator", "defensive_coordinator"], "Head coach at an FCS program", 0, [38, 58], 2],
  [["head_coach", "offensive_coordinator", "defensive_coordinator"], "Head coach at a Division II program", -4, [36, 56], 1],
  [["head_coach", "offensive_coordinator"], "NFL offensive assistant", 2, [34, 52], 2],
  [["head_coach", "defensive_coordinator"], "NFL defensive assistant", 2, [34, 52], 2],
  [["offensive_coordinator"], "Offensive coordinator at an FCS program", -2, [32, 50], 3],
  [["defensive_coordinator"], "Defensive coordinator at an FCS program", -2, [32, 50], 3],
  [["offensive_coordinator"], "Quarterbacks coach at a Power 4 program", 0, [32, 48], 3],
  [["offensive_coordinator"], "Offensive line coach", -1, [34, 54], 2],
  [["defensive_coordinator"], "Linebackers coach at a Power 4 program", 0, [32, 48], 3],
  [["defensive_coordinator"], "Secondary coach", -1, [33, 52], 2],
  [["offensive_coordinator", "defensive_coordinator"], "Assistant head coach at a Group of 5 program", 1, [38, 56], 2],
  [["head_coach"], "Former head coach, out of the game a year", -3, [48, 64], 1],
];

const WHY_GENERATED = { "head_coach": ["Ready for a bigger job", "Wants back into college football", "Looking for his first FBS job",
  "A winner at a lower level, ready to move up"],
"coordinator": ["Ready to call his own plays", "Wants a coordinator's job", "Looking for a step up",
  "Interviewing for coordinator jobs"] };

export function _why_generated(prev, head) {
  // Why a generated coach is looking, among the reasons his own background allows (a former head coach is not
  // "Looking for his first FBS job"; an FCS head coach does not want "back into college football").
  if (prev.startsWith("Former head coach")) return ["Wants back into college football"];
  if (prev.includes("NFL")) {
    return head ? ["Ready for a bigger job", "Wants back into college football"] : ["Ready to call his own plays", "Looking for a step up"];
  }
  if (prev.startsWith("Head coach")) {
    return head ? ["A winner at a lower level, ready to move up", "Looking for his first FBS job"] : ["Looking for a step up"];
  }
  return head ? ["Ready for a bigger job", "Looking for his first FBS job"] : carousel.WHY_GENERATED["coordinator"];
}

export function market_refresh(state) {
  // Each offseason: coaches too long in the market retire from it, and the supply is topped up
  // with generated coaches (FCS and lower-division head coaches, NFL assistants, position coaches).
  const lgd = state["league"];
  const year = truthy(get(state, "offseason")) ? state["offseason"]["year"] : get(state, "year", 2026);
  if (!("market" in lgd)) lgd["market"] = { "coaches": [], "year": year };
  const mk = lgd["market"];
  const rng = new Random(`market-${modules.offseason.seed_key(state)}-${year}`);
  mk["coaches"] = mk["coaches"].filter((c) => year - c["year"] < carousel.MARKET_STALE && c["age"] + (year - c["year"]) < 66);
  const weights = carousel.SUPPLY.map((s) => s[s.length - 1]);
  const taken = carousel._taken_names(lgd);
  while (mk["coaches"].length < carousel.MARKET_SIZE) {
    const [roles, prev, level, ages, _] = rng.choices(carousel.SUPPLY, { weights })[0];
    const name = recruits._name(rng, taken);
    const main = roles[0] !== "head_coach" || roles.length === 1 ? roles[0] : rng.choice(roles);
    const coach = { "name": name, "role": main, "previous_job": prev, "ratings_generated": true,
      "age_at": [year, rng.randint(ages[0], ages[1])], "since": year - rng.randint(1, 4) };
    coach["ratings"] = carousel._ratings_for(lgd, main, coach, rng, level + rng.gauss(carousel.SUPPLY_LEVEL, carousel.SUPPLY_SPREAD));   // the supply runs from bottom-tier to power-tier coaches
    const why = rng.choice(carousel._why_generated(prev, roles.includes("head_coach")));
    mk["coaches"].push(carousel._entry(coach, main, null, why, year, roles, rng));
  }
  mk["year"] = year;
}

export function _seasons(n) {
  // "1 season", "2 seasons".
  return n === 1 ? `${n} season` : `${n} seasons`;
}

export function market_add(state, coach, role, team, why, year, roles = null) {
  // A coach who lost or left his job joins the market (fired coaches sit out this offseason).
  const mk = carousel.market(state);
  const rng = new Random(`mk-${pystr(get(coach, "name"))}-${year}`);
  if (roles === null || roles === undefined) {
    roles = role === "head_coach" ? ["head_coach", ...carousel.COORD_ROLES] : [role];
  }
  const e = carousel._entry(coach, role, team, why, year, roles, rng);
  e["sits_out"] = year;
  mk["coaches"].push(e);
  return e;
}

export function market_candidates(state, slug, role, n, rng = null, year = null) {
  // The market's best `n` coaches for `role` at `slug`, (score, entry): his ratings for the role
  // (drawn when he has not held it) against the program's level, a little noise.
  const programs = modules.programs;
  const mk = carousel.market(state);
  const lgd = state["league"];
  year = truthy(year) ? year : mk["year"];
  rng = rng || new Random(`cands-${modules.offseason.seed_key(state)}-${slug}-${role}-${year}`);
  const b = programs.z(state, slug);
  const out = [];
  const level = programs.coach_level(state, slug), ceiling = programs.coach_ceiling(state, slug);
  for (const e of mk["coaches"]) {
    if (!e["roles"].includes(role) || (get(e, "sits_out") === year && (role === "head_coach" || e["last_role"] === "head_coach"))) {
      continue;                                        // a fired head coach sits out the cycle; a let-go coordinator can land at once
    }
    let r = get(e["ratings_by_role"], role);
    if (r === null) {
      r = e["ratings_by_role"][role] = carousel._ratings_for(lgd, role, { "ratings": e["ratings"], "role": e["last_role"] },
        new Random(`rf-${e["id"]}-${role}`), level);
    }
    if (carousel._rating({ "ratings": r }) > ceiling && role === "head_coach") {
      continue;                                        // a coach that good waits for a bigger job
    }
    const score = carousel._rating({ "ratings": r }) - (e["last_role"] !== role && role === "head_coach" ? 3 : 0) + rng.gauss(0, 3);
    out.push([score, e]);
  }
  return sorted(out, (x) => -x[0]).slice(0, n);
}

export function market_take(state, entry_id, role, slug, year) {
  // A market coach takes `role` at `slug`: out of the pool, a coach dict for the job.
  const mk = carousel.market(state);
  const at = mk["coaches"].findIndex((c) => c["id"] === entry_id);
  if (at === -1) throw new ValueError("that coach is no longer available");
  const e = mk["coaches"][at];
  mk["coaches"].splice(at, 1);
  const lgd = state["league"];
  let ratings = get(e["ratings_by_role"], role);
  if (!truthy(ratings)) {
    const rf = new Random(`rf-${e["id"]}-${role}`);
    ratings = carousel._ratings_for(lgd, role, { "ratings": e["ratings"], "role": e["last_role"] }, rf, 2 * modules.programs.z(state, slug));
  }
  let like = get(lgd["teams"][slug]["coaches"], role);
  if (!truthy(like)) {
    const first = Object.values(lgd["teams"]).find((t) => truthy(get(t["coaches"], role)));
    if (first === undefined) throw new Error("StopIteration");     // no coach in that role anywhere: Python's next() raises
    like = first["coaches"][role];
  }
  const coach = deep(like);
  Object.assign(coach, e["coach"], { "ratings": { ...ratings }, "role": role, "team_slug": slug, "since": year, "coach_id": `${slug}:${role}:${year}`,
    "history": e["history"], "ratings_by_role": Object.fromEntries(Object.entries(e["ratings_by_role"]).filter(([k, _]) => k !== role)),
    "previous_job": carousel._previous_job(e), "is_interim": false });
  if (!truthy(get(e["coach"], "ratings_generated"))) delete coach["ratings_generated"];
  return coach;
}

export function _previous_job(e) {
  // Where a coach on the market last worked, as a line of its own ("Former offensive coordinator at Texas", "NFL
  // offensive assistant"): a job he no longer holds says so, and a generated coach shows his own background, not the
  // reason he is looking (the text sweep's find: "Hired X as head coach, the Wants back into college football.").
  if (truthy(e["last_team"])) {
    return `Former ${get(carousel.ROLE_WORDS, e["last_role"], e["last_role"])} at ${carousel._name(e["last_team"])}`;
  }
  return get(get(e, "coach") || {}, "previous_job") || e["why"];
}

export function market_rows(state, role = null) {
  // The market for the page: every coach for hire with why he is available and where he has been.
  const mk = carousel.market(state);
  const rows = [];
  for (const e of mk["coaches"]) {
    if (truthy(role) && !e["roles"].includes(role)) continue;
    rows.push({ "id": e["id"], "name": e["name"], "roles": e["roles"].map((r) => carousel.ROLE_WORDS[r]), "age": e["age"] + (mk["year"] - e["year"]),
      "why": e["why"], "previous_job": carousel._previous_job(e), "rating": shown.coach(carousel._rating({ "ratings": e["ratings"] })),
      "history": e["history"].map((h) => ({ ...h, "team_name": carousel._name(h["team"]) })),
      "sits_out": get(e, "sits_out") === mk["year"] && e["last_role"] === "head_coach" });
  }
  return sorted(rows, (r) => -r["rating"]);
}

export function _fired_why(slug, res) {
  return `Fired by ${carousel._name(slug)} after a ${get(res, "wins", 0)}-${get(res, "losses", 0)} season`;
}

export function contract_holds(state, role, year) {
  // Your coordinator in `role` is signed for the coming season and honors it this offseason:
  // one seeded draw a year (its own stream, so the carousel's draws stand), he goes through at
  // offseason.UNDER_CONTRACT. A member without a contract (an old save) is free to go.
  const offseason = modules.offseason;
  const staff = get(get(state, "career") || {}, "staff") || [];
  const s = staff.find((x) => get(offseason.STAFF_ROLES, x["role"]) === role);
  if (s === undefined || offseason.expiring(s, year)) return false;
  return new Random(`contract-${offseason.seed_key(state)}-${year}-${role}`).random() >= offseason.UNDER_CONTRACT;
}

export function run(state) {
  // The whole carousel for the offseason: verdicts, departures, the hiring chain, coordinators,
  // your staff and your job. Returns the record shown on the Offseason screen.
  const season = modules.season, programs = modules.programs;
  const lgd = state["league"];
  const year = state["offseason"]["year"];
  const rng = carousel._rng(state, "run");
  const me = state["team"];
  const res = carousel._results(state);
  const teams = season.load_teams();
  carousel.market(state);
  carousel.market_refresh(state);
  carousel.ad(lgd["teams"][me], me);                                    // you start on solid ground
  const rv = get(state["offseason"], "review");
  const verdicts = {};
  for (const [slug, t] of Object.entries(lgd["teams"])) {
    verdicts[slug] = truthy(rv) && slug === me ? rv["verdict"] : carousel.judge(t, slug, get(res, slug, { "wins": 0, "losses": 0 }), year, state);
  }
  const surprise = new Set();                                   // a playoff the AD did not ask for (read before the tiers move)
  for (const slug of Object.keys(lgd["teams"])) {
    if (truthy(get(get(res, slug, {}), "playoff")) && carousel.goal(slug, state)["kind"] !== "playoff") surprise.add(slug);
  }
  programs.update(state, res, programs.final_ranks(state));
  for (const [slug, t] of Object.entries(lgd["teams"])) {                          // the AD's hand on the NIL tier
    const r = get(res, slug, { "wins": 0, "losses": 0 });
    programs.nil_move(t, verdicts[slug]["met"], r["wins"] < r["losses"], surprise.has(slug));
  }
  const changes = [], open_hc = [], left_hc = {};
  const holds = {};                                             // your coordinators under contract who stay put this year
  for (const role of carousel.COORD_ROLES) holds[role] = carousel.contract_holds(state, role, year);
  const your_declined = {};                                     // role -> the school he turned down (None: a bigger job in general)

  const leave = (slug, reason, why = null) => {
    const t = lgd["teams"][slug];
    const hc = t["coaches"]["head_coach"];
    changes.push({ "team": slug, "role": "head_coach", "old": hc["name"], "reason": reason });
    open_hc.push(slug);
    left_hc[slug] = hc["name"];
    if (truthy(why)) carousel.market_add(state, hc, "head_coach", slug, why, year);
  };

  // 1. who goes: fired, retired, NFL
  for (const [slug, t] of Object.entries(lgd["teams"])) {
    if (slug === me) continue;
    const hc = t["coaches"]["head_coach"], v = verdicts[slug];
    const sec = v["security"];
    const r = get(res, slug, {});
    if ((sec < carousel.LEAGUE_FIRE_BELOW && v["tenure"] >= 2 && rng.random() < carousel.FIRE_CHANCE) || sec < carousel.MUST_FIRE) {
      leave(slug, "fired", carousel._fired_why(slug, r));
    } else if (carousel._rating(hc) >= 80 && get(r, "wins", 0) >= 10 && rng.random() < carousel.NFL_CHANCE) {
      leave(slug, "left for the NFL");
    } else {
      const u = rng.random();                                   // (drawn before the odds are worked out, as Python's left side is)
      const odds = carousel._age(hc, year) >= carousel.RETIRE_FROM
        ? carousel.RETIRE * (1 + Math.max(0, v["tenure"] - 12) / 8) * (1 + Math.max(0, carousel._age(hc, year) - carousel.RETIRE_FROM) / 5)
        : carousel.RETIRE_YOUNG;
      if (u < odds) leave(slug, "retired");
    }
  }
  let you = get(verdicts, me, {});
  let fired_you;
  if (truthy(rv)) {                                             // decided in your meeting with the AD
    fired_you = truthy(get(rv, "fired"));
    you = { ...you, "security": rv["security"] };
  } else {
    fired_you = truthy(you) && ((you["security"] < carousel.FIRE_BELOW && you["tenure"] >= 2 && rng.random() < carousel.FIRE_CHANCE) || you["security"] < carousel.MUST_FIRE);
  }
  if (fired_you) {
    changes.push({ "team": me, "role": "head_coach", "old": lgd["teams"][me]["coaches"]["head_coach"]["name"], "reason": "fired" });
  }
  // 2. fill the openings, best programs first; a hire can open another job
  const filled = {};
  let queue = sorted(open_hc, (s) => -carousel.attract(state, s));
  const open_coords = [];                                       // (team, role, reason) coordinator jobs to fill
  const taken = new Set(Object.values(left_hc));                // coaches gone or hired away this offseason
  let guard = 0;
  while (queue.length && guard < 400) {
    guard += 1;
    const slug = queue.shift();
    const declined = [];
    const [hire, src] = carousel._pick_head_coach(state, slug, verdicts, res, filled, rng, year, taken, holds, declined);
    for (const d of declined) your_declined[d["role"]] = teams[slug]["name"];   // your coordinator turned the job down: under contract
    taken.add(hire["name"]);
    lgd["teams"][slug]["coaches"]["head_coach"] = hire;
    lgd["teams"][slug]["style"] = carousel.new_style(rng, lgd, slug);
    const its_ad = carousel.ad(lgd["teams"][slug], slug);
    if (!("ad" in lgd["teams"][slug])) lgd["teams"][slug]["ad"] = its_ad;
    lgd["teams"][slug]["ad"]["security"] = carousel.START_SECURITY;
    filled[slug] = hire;
    changes.push({ "team": slug, "role": "head_coach", "new": hire["name"], "reason": "hired", "from": get(src, "text"),
      "from_market": get(src, "kind") === "market", "tier": programs.get(state, slug)["tier"] });
    if (get(src, "kind") === "head_coach") {
      changes.push({ "team": src["team"], "role": "head_coach", "old": hire["name"], "reason": `left for ${teams[slug]["name"]}` });
      left_hc[src["team"]] = hire["name"];                  // so a coordinator slot he held himself opens as "left", not "let go" into the market
      queue.push(src["team"]);
      queue = sorted(queue, (s) => -carousel.attract(state, s));
    } else if (get(src, "kind") === "coordinator") {
      changes.push({ "team": src["team"], "role": src["role"], "old": hire["name"], "reason": `left for ${teams[slug]["name"]}` });
      open_coords.push([src["team"], src["role"], "poached"]);
    }
  }
  // 3. coordinators: hired away, let go by a new head coach, leaving on their own; filled from the market
  for (const [slug, t] of Object.entries(lgd["teams"])) {
    for (const role of carousel.COORD_ROLES) {
      if (open_coords.some(([s, r, _]) => s === slug && r === role)) continue;
      const c = get(t["coaches"], role);
      if (!(truthy(c) && truthy(get(c, "name")))) continue;
      if (c["name"] === get(left_hc, slug)) {                   // the head coach called his own plays
        open_coords.push([slug, role, "left"]);
      } else if (c["name"] === get(t["coaches"]["head_coach"], "name")) {
        continue;
      } else if (slug in filled && slug !== me && rng.random() < carousel.OWN_STAFF) {
        changes.push({ "team": slug, "role": role, "old": c["name"], "reason": "let go" });
        carousel.market_add(state, c, role, slug, `Let go at ${carousel._name(slug)} when ${filled[slug]["name"]} brought his own staff`, year);
        open_coords.push([slug, role, "let go"]);
      } else if (rng.random() < carousel.COORD_MOVE) {            // yours too: a coordinator looks for a bigger job
        if (slug === me && truthy(get(holds, role))) {            // ... unless he is yours and honors his contract this year
          if (!(role in your_declined)) your_declined[role] = null;
          continue;
        }
        changes.push({ "team": slug, "role": role, "old": c["name"], "reason": "moved on" });
        carousel.market_add(state, c, role, slug, (year - (get(c, "since") || year) >= 1
          ? `Left ${carousel._name(slug)} after ${carousel._seasons(year - c["since"])} to look for a bigger job`
          : `Left ${carousel._name(slug)} to look for a bigger job`), year);
        open_coords.push([slug, role, "moved on"]);
      }
    }
  }
  const your_poached = [], your_poached_why = {};
  for (const [slug, role, reason] of sorted(open_coords, (x) => -carousel.attract(state, x[0]))) {
    if (slug === me) {                                            // your opening waits for you at the Staff step
      your_poached.push(role);
      const c = get(lgd["teams"][me]["coaches"], role);
      if (truthy(c)) {                                            // he is gone: the slot is vacant until you fill it (a new dict: his record may now be another team's head coach)
        lgd["teams"][me]["coaches"][role] = { ...c, "name": "", "vacant": true };
      }
      const went = changes.find((c) => c["team"] === me && c["role"] === role && truthy(get(c, "old")) && c["reason"].startsWith("left for"));
      your_poached_why[role] = (went !== undefined ? `was hired away as the head coach at ${went["reason"].slice("left for ".length)}`
        : reason === "moved on" ? "left to look for a bigger job" : "is moving on");
      continue;
    }
    const [hire, src] = carousel._pick_coordinator(state, slug, role, rng, year);
    lgd["teams"][slug]["coaches"][role] = hire;
    changes.push({ "team": slug, "role": role, "new": hire["name"], "reason": "hired", "from": src, "from_market": true });
  }
  // 4. your job: offers after a great year; a pick of openings if fired
  let offers = [];
  const my_a = carousel.attract(state, me);
  if (truthy(you) && !fired_you && you["security"] >= carousel.OFFER_FROM) {
    const better = [...open_hc, ...Object.keys(filled)].filter((s) => s !== me && carousel.attract(state, s) >= my_a + carousel.MOVE_UP);
    offers = sorted([...new Set(better)], (s) => -carousel.attract(state, s)).slice(0, 3);
  }
  let openings = [];
  if (fired_you) {
    const lower = sorted([...new Set([...open_hc, ...Object.keys(filled)].filter((s) => s !== me))], (s) => -carousel.attract(state, s));
    openings = lower.filter((s) => carousel.attract(state, s) <= my_a).slice(0, carousel.FIRED_PICKS);
    if (!openings.length) openings = lower.slice(-carousel.FIRED_PICKS);
  }
  const shown_verdicts = {};
  for (const [s, v] of Object.entries(verdicts)) shown_verdicts[s] = { "security": v["security"], "met": v["met"], "goal": v["goal"]["text"] };
  return { "changes": changes, "you": truthy(you) ? { ...you, "fired": truthy(fired_you) } : {}, "offers": offers, "openings": openings,
    "choice": null, "poached": your_poached, "poached_why": your_poached_why, "declined": your_declined, "verdicts": shown_verdicts };
}

export function _pick_coordinator(state, slug, role, rng, year) {
  // The market's best coordinator for the job (one is generated when the market has none).
  const cands = carousel.market_candidates(state, slug, role, 3, rng, year);
  if (!cands.length) {
    const lgd = state["league"];
    const like = get(lgd["teams"][slug]["coaches"], role);
    const g = carousel.generated(rng, lgd, role, slug, year, like, modules.programs.coach_level(state, slug));
    return [g, g["previous_job"]];
  }
  const e = cands[0][1];
  return [carousel.market_take(state, e["id"], role, slug, year), carousel._previous_job(e)];
}

export function _pick_head_coach(state, slug, verdicts, res, filled, rng, year, taken = null, holds = null, declined = null) {
  // The best candidate who would take the job: a sitting head coach at a smaller program with a
  // winning run, a coordinator at a strong program, or one of the market's best three. Your
  // coordinator under contract who honors it (`holds[role]`) turns the job down when he is the
  // pick (noted in `declined`) and the next best takes it.
  const programs = modules.programs;
  const lgd = state["league"];
  const me = state["team"];
  const b = programs.z(state, slug);
  const a = carousel.attract(state, slug);
  let hist = get(get(state, "career") || {}, "league_records", {});
  let cands = [];
  taken = taken && taken.size ? taken : new Set();
  const tier = programs.get(state, slug)["tier"];
  for (const [s, t] of Object.entries(lgd["teams"])) {
    if (s === slug || s in filled) continue;
    const hc = t["coaches"]["head_coach"];
    const his = programs.get(state, s)["tier"];
    const stays = his <= carousel.STAY_TIER || (his === carousel.STAY_TIER + 1 && tier >= his);      // the top jobs are not left for another college job
    const recs = [...get(hist, s, []).slice(-2), [get(get(res, s, {}), "wins", 0), get(get(res, s, {}), "losses", 0)]];
    const w = sum(recs.map((r) => r[0]));
    const pct = w / Math.max(1, sum(recs.map((r) => r[0] + r[1])));
    // you are never hired away behind your back (your offers come in step 4); your coordinators are fair game
    if (s !== me && !stays && !taken.has(hc["name"]) && carousel.attract(state, s) + carousel.MOVE_UP <= a && pct >= carousel.HC_MOVE_PCT && verdicts[s]["tenure"] >= 2) {
      cands.push([carousel._rating(hc) + carousel.HC_PROVEN + 20 * (pct - carousel.HC_MOVE_PCT) + rng.gauss(0, 3), hc, { "kind": "head_coach", "team": s,
        "text": `head coach at ${carousel._name(s)}` }]);
    }
    for (const role of carousel.COORD_ROLES) {
      const c = get(t["coaches"], role);
      if (truthy(c) && truthy(get(c, "name")) && !taken.has(c["name"]) && c["name"] !== hc["name"] && carousel.attract(state, s) >= a + carousel.COORD_UP && get(get(res, s, {}), "wins", 0) >= 9) {
        cands.push([carousel._rating(c) - 4 + rng.gauss(0, 3), c, { "kind": "coordinator", "team": s, "role": role,
          "text": `${carousel.ROLE_WORDS[role]} at ${carousel._name(s)}` }]);
      }
    }
  }
  for (const [score, e] of carousel.market_candidates(state, slug, "head_coach", 3, rng, year)) {
    cands.push([score - 2, e, { "kind": "market", "text": carousel._previous_job(e), "id": e["id"] }]);
  }
  if (!cands.length) {
    const g = carousel.generated(rng, lgd, "head_coach", slug, year, undefined, programs.coach_level(state, slug));
    cands.push([0, g, { "kind": "generated", "text": g["previous_job"] }]);
  }
  cands = sorted(cands, (x) => -x[0]);
  let [score, pick, src] = cands[0];
  for ([score, pick, src] of cands) {                   // (when every candidate declines, the last one stands, as in Python)
    if (src["kind"] === "coordinator" && src["team"] === me && truthy(get(holds || {}, src["role"]))) {
      if (declined !== null && declined !== undefined) declined.push({ "role": src["role"], "name": pick["name"] });
      continue;
    }
    break;
  }
  if (src["kind"] === "market") return [carousel.market_take(state, src["id"], "head_coach", slug, year), src];
  let hire = deep(pick);
  if (src["kind"] === "coordinator") {                    // a coordinator becomes a head coach: head coach ratings
    const own = new Random(`${slug}-${pystr(get(pick, "name"))}`);
    const g = carousel.generated(own, lgd, "head_coach", slug, year, undefined, programs.coach_level(state, slug));
    for (const [k, v] of Object.entries(get(pick, "ratings", {}))) {
      if (k in g["ratings"]) g["ratings"][k] = v;
    }
    g["name"] = pick["name"];
    g["age_at"] = get(pick, "age_at");
    g["ratings_by_role"] = { [src["role"]]: { ...pick["ratings"] } };
    hire = g;
  }
  if (!("team" in src)) throw new Error("KeyError: 'team'");     // a generated pick has no team he left: Python raises here too
  hist = [...(get(pick, "history") || []), { "year": get(pick, "since") || year, "to": year, "team": src["team"],
    "role": get(src, "role", "head_coach") }];
  Object.assign(hire, { "since": year, "previous_job": src["text"], "history": hist, "team_slug": slug, "coach_id": `${slug}:head_coach:${year}` });
  return [hire, src];
}

export function _name(slug) {
  return modules.season.load_teams()[slug]["name"];
}

export function mood(sec) {
  return sec >= 90 ? "Untouchable" : sec >= 65 ? "Secure" : sec >= 40 ? "Warm Seat" : "Hot Seat";
}

export function status(state) {
  // Your job for the page: the AD's goal, your security, his patience and any ultimatum.
  const me = state["team"];
  const lgd = get(state, "league") || {};
  const t = get(get(lgd, "teams") || {}, me);
  const a = truthy(t) ? carousel.ad(t, me) : { "patience": null, "security": carousel.START_SECURITY };
  const g = carousel.goal(me, state);
  const sec = a["security"];
  const year = get(state, "year", 2026);
  return { "goal": g["text"], "security": sec, "patience": get(a, "patience"), "mood": carousel.mood(sec),
    "ultimatum": (get(a, "ultimatum") || 0) >= year };
}

export function job_rows(state, slugs) {
  const season = modules.season, programs = modules.programs;
  const teams = season.load_teams();
  return slugs.map((s) => ({ "team": s, "name": teams[s]["name"], "conference": teams[s]["conference"], "goal": carousel.goal(s, state)["text"],
    "tier": programs.get(state, s)["tier"], "program_rating": programs.get(state, s)["rating"],
    "rating": season.page_ratings(teams[s])["overall"] }));
}

export const carousel = {
  GOALS, G5_TITLE_FROM, START_SECURITY, STANDING, MAX_DROP, DROP_TIER, HONEYMOON, WIN_STEP, BONUS, FIRE_BELOW, FIRE_CHANCE, MUST_FIRE,
  LEAGUE_FIRE_BELOW, RETIRE, RETIRE_FROM, RETIRE_YOUNG, NFL_CHANCE, STAY_TIER, COORD_MOVE, HC_MOVE_PCT, MOVE_UP, COORD_UP, HC_PROVEN,
  OFFER_FROM, FIRED_PICKS, MARKET_SIZE, MARKET_STALE, SUPPLY_LEVEL, SUPPLY_SPREAD, OWN_STAFF, COORD_ROLES, ROLE_WORDS,
  _rng, baseline, goal, attract, ad, _results, judge, new_style, _rating, BIRTH_YEARS, _BIRTHS, _HOMETOWNS, hometown, _birth_years, _age,
  generated, _taken_names, _ratings_for, _entry, market, SUPPLY, WHY_GENERATED, _why_generated, market_refresh, _seasons, market_add,
  market_candidates, market_take, _previous_job, market_rows, _fired_why, contract_holds, run, _pick_coordinator, _pick_head_coach,
  _name, mood, status, job_rows,
};

modules.carousel = carousel;

// What is not written as the Python has it (PORTING.md rule 9):
// - run, step 4: `sorted(set(better), ...)` and `sorted({...}, ...)` walk a set, whose order in Python follows the
//   strings' hashes (different every run of Python unless PYTHONHASHSEED is set). Here the set keeps the order the
//   slugs were added in (the openings, then the filled jobs). The two only differ when two programs are exactly as
//   attractive: then Python's own order is not fixed from one run to the next.
// - _pick_head_coach: a "generated" pick (no candidate at all) has no `team`; Python raises KeyError building his
//   history, and this throws there too. The market has always had a candidate.
// - market_take: Python's `mk["coaches"].remove(e)` removes the first entry equal to `e`; here the entry found by its
//   id is the one removed (the same entry: the first with that id).
// - judge: `met` is the last operand of Python's and/or chain (a bool for the results _results gives); the same here.
// - gauss: Math.log/sin/cos can differ from Python's in the last digit (PORTING.md); every draw here is cut to a whole
//   rating with int() or only orders candidates, so a difference shows only for a value exactly on a line.
// - names are lowered with toLowerCase() where Python has str.lower(): the same for every name the game makes.
