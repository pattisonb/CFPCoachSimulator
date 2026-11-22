// The offseason, part 4: the jobs you can take, walking the
// stages (advance), Change Conferences and Edit Schedule, saves from the older order (migrate), the step to the next
// season (summary, next_season), and what the Offseason page shows (the portal's rows, board and recap, a player's
// next year, page, view).
//
// Every name of the offseason is reached through the `offseason` namespace, whichever part defines it
// (engine_js/PORTING.md, "Big Files in Parts"). Notes on standing quirks are at the end.
import { Random, round, int, sum, cmp, sorted, range, get, truthy, odict, is_odict } from "../../engine_js/pyrt.js";
import { exists, remove } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";
import { ValueError } from "../../sim_js/coaches.js";
import { polls } from "../../sim_js/polls.js";
import { shown } from "../../teamdata_js/shown.js";
import { ratings as rv2 } from "../../teamdata_js/ratings.js";
import { league as lg } from "../league.js";
import { position_fit } from "../position_fit.js";
import { carousel } from "../carousel.js";
import { career as career_mod } from "../career.js";
import { prospects } from "../prospects.js";
import { offseason } from "../offseason_ns.js";

// ----- small helpers (local to this part) --------------------------------------------------------------------

/** `k in d` for a dict (a save's values are never undefined). */
const has = (d, k) => d[k] !== undefined;

/** `x in coll` for a tuple, list or set. */
const _in = (x, coll) => (coll instanceof Set ? coll.has(x) : Array.from(coll).includes(x));

/** isinstance(v, dict) */
const is_dict = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Set);

/** isinstance(v, (int, float)) and not isinstance(v, bool) */
const is_num = (v) => typeof v === "number";

/** A missing key and a number too big, as portal_offer throws them (the API tells them from a ValueError). */
class KeyError extends Error {
  constructor(message) { super(message); this.name = "KeyError"; }
}
class OverflowError extends Error {
  constructor(message) { super(message); this.name = "OverflowError"; }
}

/** A file removed if it is there; one that cannot be removed stays. */
function _unlink(p) {
  if (exists(p)) {
    try { remove(p); } catch { /* it stays */ }
  }
}


function _your_jobs(off) {
  // The jobs you can take right now (offers, or openings after you were fired), while the Staff step is open; and,
  // after it, the one you took (its earlier hire never happened).
  const car = get(off, "carousel") || {};
  if (get(off, "stage") === "staff") {
    return new Set([...(get(car, "offers") || []), ...(get(car, "openings") || [])]);
  }
  return truthy(get(off, "move_to")) ? new Set([off["move_to"]]) : new Set();
}


function choose_job(state, slug) {
  // Take a job offer (or, fired, an opening); None stays (or lets Auto pick the best opening).
  const off = get(state, "offseason") || {};
  const car = get(off, "carousel");
  if (get(off, "stage") !== "staff" || !truthy(car)) {
    throw new ValueError("no jobs to decide on now");
  }
  if (slug !== null && slug !== undefined && !car["offers"].concat(car["openings"]).includes(slug)) {
    throw new ValueError("that job is not open to you");
  }
  car["choice"] = slug === undefined ? null : slug;
  return car;
}


function _take_job(state, slug) {
  // You leave for `slug` next season: you take its head coaching job (your coordinators and
  // recruiters follow only as far as your recruiters do); your old program hires a new coach.
  const lgd = state["league"];
  const me = state["team"];
  const year = state["offseason"]["year"];
  const rng = offseason._rng(state, "move");
  const mine = lgd["teams"][me]["coaches"]["head_coach"];
  lgd["teams"][slug]["coaches"]["head_coach"] = { ...mine, since: year };
  lgd["teams"][me]["coaches"]["head_coach"] = carousel.generated(rng, lgd, "head_coach", me, year, undefined, 2 * carousel.baseline(me));
  lgd["teams"][slug]["style"] = get(lgd["teams"][me], "style", me);          // you bring your way of playing
  lgd["teams"][me]["style"] = carousel.new_style(rng, lgd, me);
  for (const s of [slug, me]) {
    carousel.ad(lgd["teams"][s], s)["security"] = carousel.START_SECURITY;
  }
  state["offseason"]["move_to"] = slug;
  state["offseason"]["coaching_changes"].push({ team: slug, role: "head_coach", new: "You", reason: "hired",
    from: `head coach at ${lg.team_meta(get(state, "league"), me)["short_name"]}` });
}


// ----- walking the stages -----------------------------------------------------------------------

function advance(state) {
  // Finish the current stage and open the next one.
  offseason.migrate(state);
  const off = state["offseason"];
  const stage = off["stage"];
  const recruiting = modules.recruiting;
  if (_in(stage, offseason.REVIEW_STAGES)) {
    const rv = get(off, "review");
    if (truthy(rv) && !truthy(rv["decided"])) {
      if (!truthy(get(off, "auto"))) {
        throw new offseason.ReviewError(409, "the AD is waiting for your answer");
      }
      offseason.review_decide(state, "nothing");
    }
  }
  if (stage === "retention") {                         // your answers, then the draft on the final pool
    offseason._resolve_retention(state);
    offseason._run_draft(state);
    off["stage"] = "departures";
  } else if (stage === "departures") {
    offseason._apply_redshirts(state);
    offseason._open_portal(state);
    off["stage"] = truthy(recruiting.is_portal(state)) ? "portal_w1" : "portal_1";
  } else if (_in(stage, offseason.PORTAL_STAGES)) {
    const week = Array.from(offseason.PORTAL_STAGES).indexOf(stage) + 1;
    recruiting.weekly_step(state, week, truthy(get(off, "auto")));
    if (week < offseason.PORTAL_STAGES.length) {
      state["recruiting"]["week"] = week + 1;
      off["stage"] = offseason.PORTAL_STAGES[week];
    } else {
      offseason._close_portal(state);                     // the portal is shut: its recap has the screen before anyone develops
      off["stage"] = "portal_recap";
    }
  } else if (stage === "portal_recap") {
    const development = offseason._develop_all(state);
    off["report"] = { development, ...offseason._fill_rosters(state) };
    off["report"]["coaches"] = offseason._develop_coaches(state);
    off["stage"] = "development";
  } else if (stage === "portal_1") {
    offseason.resolve_round(state);
    off["portal"]["round"] = 2;
    off["stage"] = "portal_2";
  } else if (stage === "portal_2") {
    offseason.resolve_round(state);
    offseason._close_portal_rounds(state);
    const development = offseason._develop_all(state);
    off["report"] = { development, ...offseason._fill_rosters(state) };
    off["report"]["coaches"] = offseason._develop_coaches(state);
    off["stage"] = "development";
  } else if (stage === "development") {
    const car = carousel.run(state);
    off["carousel"] = car;
    off["coaching_changes"] = car["changes"];
    const staff_open = get(off, "staff_open") || {};
    off["staff"] = offseason._staff_changes(state,
      car["poached"].concat(state["career"]["staff"]
        .filter((x) => has(staff_open, x["id"]) && has(offseason.STAFF_ROLES, x["role"]))
        .map((x) => offseason.STAFF_ROLES[x["role"]])),
      get(car, "poached_why"), get(car, "declined"));
    off["stage"] = "staff";
  } else if (stage === "staff") {
    off["staff"]["changes"] = offseason._apply_staff(state);
    const car = get(off, "carousel") || {};
    const choice = get(car, "choice") || (truthy(get(get(car, "you") || {}, "fired")) ? (truthy(get(car, "openings")) ? car["openings"] : [null])[0] : null);
    if (truthy(choice)) {
      offseason._take_job(state, choice);
    }
    off["roles_filled"] = offseason.fill_roles(state);      // the schemes are set: every staff fills a role no one plays
    off["stage"] = "conferences";
  } else if (stage === "conferences") {                     // the conferences are set: next season's schedule is drawn
    offseason._draw_schedule(state);
    off["stage"] = "schedule";
  } else if (stage === "schedule") {
    off["stage"] = "ready";
  }
  return off;
}


// ----- Change Conferences and Edit Schedule: the last two steps -------------------------------------
// Change Conferences moves a program to another conference that already exists (no new ones); the move
// is the league's (lgd["conference_moves"], read by league.team_meta) and lasts. A move is checked by
// drawing a schedule with it: one the conferences cannot schedule is refused. Edit Schedule draws next
// season's schedule (from the same stream next_season drew it from) and trades your non-conference
// games the way the Week 0 editor does (season.schedule_options and schedule_swap on next year's teams).

class ConferenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ConferenceError";
    this.code = code;
  }
}
offseason.ConferenceError = ConferenceError;


function next_teams(state) {
  // Next season's teams as the schedule needs them: each one's identity with its conference as moved.
  const lgd = state["league"];
  const out = {};
  for (const s of lg.league_slugs(lgd)) {
    const m = lg.team_meta(lgd, s);
    out[s] = { ...m, name: get(m, "name") || m["short_name"] };          // the engine's teams name a school by its short name
  }
  return out;
}


function conferences_view(state) {
  // Every conference next season (the ones that exist; none can be made) and its members.
  const teams = offseason.next_teams(state);
  const confs = {};
  const base = new Set(lg.base_slugs());
  for (const [s, t] of Object.entries(teams)) {
    if (truthy(get(t, "fictional"))) continue;
    const orig = base.has(s) ? lg.base_meta(s)["conference"] : t["conference"];
    if (!has(confs, t["conference"])) confs[t["conference"]] = [];
    confs[t["conference"]].push({ team: s, name: t["name"], moved_from: orig !== t["conference"] ? orig : null });
  }
  for (const s of lg.base_slugs()) {                                     // a conference every member left still exists
    const m = lg.base_meta(s);
    if (!truthy(get(m, "fictional"))) {
      if (!has(confs, m["conference"])) confs[m["conference"]] = [];
    }
  }
  const out = Object.entries(confs).map(([c, v]) => ({ name: c, independent: _in(c, polls.INDEPENDENT) || c === "FBS Independent",
    power: _in(c, polls.P4), teams: sorted(v, (r) => r["name"]) }));
  out.sort((a, b) => cmp([a["independent"], !a["power"], a["name"]], [b["independent"], !b["power"], b["name"]]));
  const off = state["offseason"];
  return { conferences: out, moves: Array.from(get(off, "conference_moves") || []), open: off["stage"] === "conferences" };
}


function move_conference(state, slug, conference) {
  // Move one program to an existing conference for next season (back to where it was undoes a move).
  const schedule_gen = modules.schedule_gen;
  const off = state["offseason"];
  if (off["stage"] !== "conferences") {
    throw new offseason.ConferenceError(409, "Conferences can be changed only at the Change Conferences step.");
  }
  const teams = offseason.next_teams(state);
  const t = get(teams, slug);
  if (t === null || truthy(get(t, "fictional"))) {
    throw new offseason.ConferenceError(404, "No such program.");
  }
  const names = new Set(offseason.conferences_view(state)["conferences"].map((c) => c["name"]));
  if (!names.has(conference)) {
    throw new offseason.ConferenceError(409, "Only a conference that already exists can take a program.");
  }
  const was = t["conference"];
  if (conference === was) {
    return offseason.conferences_view(state);
  }
  teams[slug] = { ...t, conference };
  const lgd = state["league"];
  try {
    schedule_gen.generate(off["year"], teams, get(lgd, "schedule_history"), new Random(`conference-check-${off["year"]}-${slug}-${conference}`),
      get(lgd, "schedule_rules"));
  } catch (e) {
    if (!(e instanceof schedule_gen.ScheduleError)) throw e;
    throw new offseason.ConferenceError(409, `The ${conference} cannot make a schedule with ${t["name"]} in it.`);
  }
  if (!has(lgd, "conference_moves")) lgd["conference_moves"] = {};
  const moves = lgd["conference_moves"];
  const home = lg.team_meta({ ...lgd, conference_moves: {} }, slug)["conference"];
  if (conference === home) {
    delete moves[slug];
  } else {
    moves[slug] = conference;
  }
  if (!has(off, "conference_moves")) off["conference_moves"] = [];
  const log = off["conference_moves"];
  log.splice(0, log.length, ...log.filter((m) => m["team"] !== slug));
  if (conference !== home) {
    log.push({ team: slug, name: t["name"], from: home, to: conference });
  }
  const nxt = lg.path(state["id"], off["year"]);                // a teams file built for next year before the move is stale
  _unlink(nxt);
  return offseason.conferences_view(state);
}


function _draw_schedule(state) {
  const schedule_gen = modules.schedule_gen;
  const off = state["offseason"], lgd = state["league"];
  const [games, hist] = schedule_gen.generate(off["year"], offseason.next_teams(state), get(lgd, "schedule_history"), offseason._rng(state, "schedule"),
    get(lgd, "schedule_rules"));
  off["next_schedule"] = { games, history: hist, changes: [] };
}


function _schedule_shim(state) {
  // The state the Week 0 editor reads, with next season's games, your next team and nothing played.
  const off = state["offseason"];
  const ns = off["next_schedule"];
  const shim = { ...state };
  shim["games"] = ns["games"];
  shim["current_week"] = 0;
  shim["team"] = get(off, "move_to") || state["team"];
  shim["schedule_changes"] = ns["changes"];
  shim["career"] = truthy(get(state, "career")) ? state["career"] : true;
  return shim;
}


function schedule_view(state) {
  // Next season's schedule for your team, with the non-conference games you can trade and who would take each.
  const season = modules.season;
  const off = state["offseason"];
  if (!truthy(get(off, "next_schedule"))) {
    return { games: [], editable: [], changes: [], open: false };
  }
  const shim = offseason._schedule_shim(state), teams = offseason.next_teams(state);
  const me = shim["team"];
  const mine = sorted(Object.values(shim["games"]).filter((g) => me === g["home"] || me === g["away"]), (g) => g["week"]);
  const open_ = off["stage"] === "schedule";
  const editable = open_ ? season.schedule_editable(shim).map((g) => ({ ...g, options: season.schedule_options(shim, g["event_id"], teams) })) : [];
  const schedule_gen = modules.schedule_gen;
  return { team: me, games: mine, editable, changes: shim["schedule_changes"], open: open_,
    // the regular season's weeks (a week without a game of yours is a bye), and where each game could move
    weeks: range(1, schedule_gen.LAST_WEEK + 1), moves: open_ ? season.schedule_moves(shim, teams) : {} };
}


function schedule_move(state, event_id, week) {
  // Move one of next season's games to another week (into your bye, or trading weeks with another of your games).
  const season = modules.season;
  if (state["offseason"]["stage"] !== "schedule" || !truthy(get(state["offseason"], "next_schedule"))) {
    throw new season.ScheduleError(409, "The schedule can be edited only at the Edit Schedule step.");
  }
  season.schedule_move(offseason._schedule_shim(state), event_id, _int(week), offseason.next_teams(state));
  return offseason.schedule_view(state);
}

/** int(week): a whole number, or the text of one (anything else is a ValueError). */
function _int(v) {
  if (typeof v === "number") return int(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  const text = String(v).trim().replace(/_/g, "");
  if (!/^[+-]?\d+$/.test(text)) throw new ValueError(`invalid literal for int() with base 10: '${v}'`);
  return Number(text);
}


function schedule_trade(state, event_id, slug) {
  const season = modules.season;
  if (state["offseason"]["stage"] !== "schedule" || !truthy(get(state["offseason"], "next_schedule"))) {
    throw new season.ScheduleError(409, "The schedule can be edited only at the Edit Schedule step.");
  }
  season.schedule_swap(offseason._schedule_shim(state), event_id, slug, offseason.next_teams(state));
  return offseason.schedule_view(state);
}


function migrate(state) {
  // A save from the older order (Departures first, the draft run at the start; no "draft" block)
  // carries on in this one. At Departures or Keep Them Home its draft results become a pool again,
  // in the order they were picked (the undrafted after, in their order): leaving seniors back to
  // "graduated", early entrants back to "declared" with the pick as their projection. At Departures
  // the stage becomes Keep Them Home (the AD's meeting and the redshirts are still open there and
  // at Departures); then the draft reruns after your answers. A save past both keeps its draft as
  // it was. Idempotent.
  const off = get(state, "offseason");
  if (!truthy(off) || has(off, "draft")) return;
  const stage = get(off, "stage");
  if (!(stage === "departures" || stage === "retention") || (stage === "departures" && get(off, "retention") === null)) {
    off["draft"] = { scores: {}, done: true, legacy: true, ai_kept: [] };
    return;
  }
  const scores = odict();
  let undrafted = 0;
  for (const d of get(off, "departures") || []) {
    if (d["kind"] === "draft") {
      scores[d["id"]] = -d["pick"];
      d["kind"] = truthy(get(d, "early")) ? "declared" : "graduated";
      if (truthy(get(d, "early"))) {
        d["proj"] = d["pick"];
      }
      delete d["pick"];
      delete d["round"];
    } else if (d["kind"] === "undrafted") {
      undrafted += 1;
      scores[d["id"]] = -10000.0 - undrafted;
      d["kind"] = "declared";
      d["proj"] = null;
    }
  }
  for (const e of get(get(off, "retention") || {}, "players") || []) {
    if (e["intent"] === "draft") {
      undrafted += 1;
      scores[e["id"]] = truthy(get(e, "draft_pick")) ? -e["draft_pick"] : -10000.0 - undrafted;
    }
  }
  off["draft"] = { scores, done: false, legacy: true, ai_kept: [] };
  if (stage === "departures") {
    off["stage"] = "retention";
  }
}


function run_all(state) {
  // Every remaining stage on Auto (the portal weeks recruited by your staff).
  offseason.start(state);
  state["offseason"]["auto"] = true;
  while (state["offseason"]["stage"] !== "ready") {
    offseason.advance(state);
  }
}


// ----- the next season --------------------------------------------------------------------------

function summary(state) {
  // The season just finished, for the career's history.
  const season = modules.season;
  const me = state["team"];
  const [wins, losses] = offseason._record(state, me);
  let final = get(state["polls"], String(season.FINAL_WEEK));
  if (!truthy(final)) {
    const weeks = Object.keys(state["polls"]).map((w) => _int(w));
    if (!weeks.length) throw new ValueError("max() iterable argument is empty");
    final = get(state["polls"], String(Math.max(...weeks)), {});
  }
  let rank = null;
  for (const e of get(final, "ap", [])) {
    if (e["team"] === me) { rank = e["rank"]; break; }
  }
  const aw = get(state, "awards") || {};
  const candidates = get(get(get(aw, "national") || {}, "heisman") || {}, "candidates");
  const top = (truthy(candidates) ? candidates : [null])[0] || {};
  const out = { year: season.season_year(state), wins, losses, ap_rank: rank,
    champion: get(state, "champion"), won_title: get(state, "champion") === me,
    conference_champion: get(get(state, "champions", {}), state["conference"]) === me,
    heisman: truthy(get(top, "name")) ? { name: get(top, "name"), team: get(top, "team") } : null };
  const rc = get(state, "recruiting");
  if (truthy(rc)) {
    out["class_rank"] = prospects.class_rank(state, me);
    out["signed"] = sum(Object.values(rc["status"]).map((s) => (get(s, "signed") === me ? 1 : 0)));
  }
  const off = get(state, "offseason") || {};
  out["drafted"] = sum(get(off, "departures", []).map((d) => (d["team"] === me && get(d, "kind") === "draft" ? 1 : 0)));
  return out;
}


function next_season(state) {
  // The next season's state for this career: same id, the league as the offseason left it,
  // the career (staff, settings, history) carried over, a new class of high school seniors.
  const recruiting = modules.recruiting;
  const season = modules.season;
  const off = state["offseason"];
  if (off["stage"] !== "ready") {
    throw new ValueError("the offseason is not finished");
  }
  const year = off["year"];
  const lgd = state["league"];
  lgd["year"] = year;
  offseason.fill_roles(state, sorted(Object.keys(lgd["teams"])).filter((s) => s !== state["team"]));   // a save from before fill_roles ran at "ready" (yours: Undo is yours)
  for (const t of Object.values(lgd["teams"])) {
    position_fit.settle(t["roster"]);          // this year's position changes are theirs now
  }
  const team = get(off, "move_to") || state["team"];
  // your team's default depth chart is by overall (league.lineup); the season's depth-chart
  // overrides and redshirts are this season's and are not carried (new_season starts clean)
  recruiting.use_league_models(get(lgd, "recruiting_models") || {});
  season.use_league(lg.ensure_built({ id: state["id"], league: lgd, year, team }));
  let teams = season.load_teams();
  // every program's last three records, for the coaching carousel
  if (!has(state["career"], "league_records")) state["career"]["league_records"] = {};
  const records = state["career"]["league_records"];
  for (const slug of Object.keys(lgd["teams"])) {
    if (!has(records, slug)) records[slug] = [];
    records[slug].push(Array.from(offseason._record(state, slug)));
    records[slug] = records[slug].slice(-3);
  }
  if (!has(state["career"], "history")) state["career"]["history"] = [];
  const history = state["career"]["history"];
  history.push(offseason.summary(state));
  // the year's schedule, built the way the conferences build theirs; the league carries the history it needs
  const schedule_gen = modules.schedule_gen;
  teams = season.load_teams();
  let games;
  if (truthy(get(off, "next_schedule"))) {                 // drawn (and maybe edited) at the Edit Schedule step
    games = off["next_schedule"]["games"];
    lgd["schedule_history"] = off["next_schedule"]["history"];
  } else {
    const drawn = schedule_gen.generate(year, teams, get(lgd, "schedule_history"), offseason._rng(state, "schedule"),
      get(lgd, "schedule_rules"));
    games = drawn[0];
    lgd["schedule_history"] = drawn[1];
  }
  const new_ = season.new_season(team, "full", offseason._rng(state, "seed").randrange(2 ** 30), undefined, get(state, "coach"), undefined, year, games);
  new_["id"] = state["id"];
  new_["created_at"] = state["created_at"];
  new_["league"] = lgd;
  new_["settings"] = get(state, "settings", new_["settings"]);
  const car = state["career"];
  car["year"] = year;
  car["saved_week"] = 0;
  car["saved_at"] = career_mod._now();
  if (!has(car, "settings")) car["settings"] = {};
  const settings = car["settings"];
  if (get(settings, "auto_recruit") === "week") {
    settings["auto_recruit"] = "off";
  }
  new_["career"] = car;
  if (truthy(get(off, "move_to"))) {                 // a new school: its coordinators join your staff, your recruiters come along
    const coaches = lgd["teams"][team]["coaches"];
    for (const s of car["staff"]) {
      const key = get({ OC: "offensive_coordinator", DC: "defensive_coordinator" }, s["role"]);
      const c = truthy(key) ? get(coaches, key) : null;
      if (truthy(c)) {
        const r = get(c, "ratings") || {};
        s["name"] = get(c, "name") || s["name"];
        s["evaluation"] = int(get(r, "player_development", 60));
        s["recruiting"] = int(get(r, "recruiting", 60));
        const term = offseason.term_of(s["role"]);
        s["contract_until"] = year + new Random(`contract-${offseason.seed_key(state)}-${year}-${s["id"]}`).randint(term[0], term[1]) - 1;
        delete s["pot"];
      }
    }
    history[history.length - 1]["moved_to"] = team;
    if (!has(car, "schools")) car["schools"] = [];
    car["schools"].push({ team, from: year });
  }
  delete new_["recruiting_last"];
  if (truthy(get(state, "nil_carry"))) {                 // the portal NIL left over carries into the new class's budget (recruiting._nil)
    new_["nil_carry"] = { ...state["nil_carry"] };
  }
  recruiting.start(new_, year + 1);
  prospects.reset_caches();
  const old = lg.path(state["id"], year - 1);
  _unlink(old);
  return new_;
}


// ----- what the page shows ----------------------------------------------------------------------

offseason.KIND_NAMES = { draft: "Drafted", undrafted: "Declared, Undrafted", graduated: "Graduated", portal: "Transfer Portal",
  quit: "Left the Team", declared: "Declared for the Draft", stayed: "Stayed: You Kept Him Home" };
offseason.PT_NAMES = { 1.0: "Would Start", 0.5: "Next in Line", 0.15: "Depth" };


function portal_offer(state, pid, on) {
  // Offer a portal player a spot (or take it back) for the round being played.
  const off = get(state, "offseason") || {};
  const recruiting = modules.recruiting;
  if (_in(get(off, "stage"), offseason.PORTAL_STAGES)) {            // the portal is recruited on the board: an offer with a pitch
    const p = state["recruiting"]["prospects"][pid];
    if (p === undefined) throw new KeyError(pid);                    // (an unknown player)
    const pitch = truthy(on) ? p["priorities"][0] : null;
    recruiting.act(state, state["team"], pid, truthy(on) ? "offer" : "pull_offer", pitch,
      truthy(on) ? recruiting.ask_from(state, state["team"], pid) : 0);
    return Array.from(get(state["recruiting"]["offers"], state["team"], []));
  }
  if (!(get(off, "stage") === "portal_1" || get(off, "stage") === "portal_2")) {
    throw new ValueError("the portal is not open");
  }
  const e = get(off["portal"]["players"], pid);
  if (e === null) {
    throw new KeyError(pid);
  }
  const me = state["team"];
  if (!has(off["portal"]["offers"], me)) off["portal"]["offers"][me] = [];
  const mine = off["portal"]["offers"][me];
  if (truthy(on)) {
    if (truthy(e["signed"])) {
      throw new ValueError("he has already picked a school");
    }
    if (!mine.includes(pid)) {
      if (mine.length >= Math.max(1, Math.ceil(offseason.PORTAL_OFFER_FACTOR * offseason.my_spots(state["league"], me, off["portal"])))) {
        throw new OverflowError("no offers left this round");
      }
      mine.push(pid);
    }
  } else if (mine.includes(pid)) {
    mine.splice(mine.indexOf(pid), 1);
  }
  return mine;
}


function recruiting_spots(state, slug) {
  return modules.recruiting.portal_spots(state, slug);
}


function player_next(state, slug) {
  // _player_next, with his overall as the page shows a rating (page): the number in his sentence is that one too.
  const raw = offseason._player_next(state, slug);
  const stored = raw === null ? null : get(raw, "overall");
  const out = offseason.page(raw);
  if (out !== null && typeof get(out, "sentence") === "string" && stored !== null && stored !== undefined) {
    out["sentence"] = out["sentence"].replace(`, ${stored} overall.`, `, ${get(out, "overall")} overall.`);
  }
  return out;
}


function _player_next(state, slug) {
  // Where a player is now, for his player page in a career's offseason: next year's team, position,
  // class and overall from the league (`status` returning / transfer_in / signee), or where he went
  // (`status` the departure's kind: graduated, portal, quit, declared, draft, undrafted; team None).
  // None outside a career offseason, or for a player the offseason does not know.
  if (!truthy(get(state, "offseason")) || !truthy(get(state, "league"))) {
    return null;
  }
  const season = modules.season;
  const lgd = state["league"];
  const off = state["offseason"];
  const season_year = get(off, "year", get(lgd, "year", 0)) - 1;     // the season his ratings and stats on the page are from
  if (get(off, "stage") === "retention") {           // Keep Them Home: he wants out and nobody has decided yet
    const e = (get(get(off, "retention") || {}, "players") || []).find((x) => x["id"] === slug);
    if (e !== undefined) {
      const draft = get(e, "intent") === "draft";
      return { team: null, team_name: null, position: get(e, "pos"), class: get(e, "cls"), class_name: null,
        overall: get(e, "overall"), status: "leaving", season: season_year,
        status_name: draft ? "Wants to Leave: NFL Draft" : "Wants to Leave: Transfer Portal",
        sentence: draft ? "Wants to leave for the NFL Draft." : "Wants to leave for the transfer portal." };
    }
  }
  let before = null;
  for (const [s, t] of Object.entries(season.load_teams())) {
    if (t["offense"].some((p) => get(p, "slug") === slug) || t["defense"].some((p) => get(p, "slug") === slug)) { before = s; break; }
  }
  for (const [team, t] of Object.entries(lgd["teams"])) {
    const c = t["roster"].find((x) => x["id"] === slug);
    if (c !== undefined) {
      const status = before === team ? "returning" : truthy(before) ? "transfer_in" : "signee";
      let cls = c["cls"];
      const rs = get(state["offseason"], "redshirts") || {};
      const pend = !truthy(get(rs, "decided")) ? ((get(rs, "players") || []).find((r) => r["id"] === slug) ?? null) : null;
      if (truthy(pend) && pend["cls"] === cls) {                // the redshirt call lands leaving Departures: the class he will have
        cls = truthy(pend["redshirt"]) ? cls + "RS" : get(offseason.NEXT_CLASS, cls, cls);
      }
      const words = get(season.CLASS_NAMES, cls, cls);
      const name = lg.team_meta(lgd, team)["short_name"];
      const low = words.toLowerCase();
      const sentence = (status === "returning" ? `Returning to ${name} as a ${low}, ${c["o"]} overall.`
        : status === "transfer_in" ? `Transferred from ${lg.team_meta(lgd, before)["short_name"]} to ${name}, ${c["o"]} overall.`
          : `Signed with ${name} as a ${low}, ${c["o"]} overall.`);
      return { team, team_name: name, position: c["pos"], class: cls,
        class_name: words.split(/\s+/).filter((w) => w).map((w) => w.slice(0, 1).toUpperCase() + w.slice(1)).join(" "), overall: c["o"], status,
        status_name: { returning: "Returning", transfer_in: "Transferred In", signee: "Signed" }[status],
        sentence, season: season_year };
    }
  }
  let ev = null;
  const deps = get(state["offseason"], "departures") || [];
  for (let i = deps.length - 1; i >= 0; i--) {
    if (deps[i]["id"] === slug) { ev = deps[i]; break; }
  }
  if (ev === null) {
    return null;
  }
  const k = ev["kind"];
  // the portal has shut and he is on no roster: he is not "in the transfer portal" any more
  const STAGES = Array.from(offseason.STAGES);
  const shut = k === "portal" && _index(STAGES, get(state["offseason"], "stage") || STAGES[0]) >= _index(STAGES, "portal_recap");
  const sentence = get({ graduated: "Graduated.", portal: shut ? "Went unsigned in the portal and left FBS." : "In the transfer portal.", quit: "Left the team.",
    declared: "Declared for the NFL Draft.", undrafted: "Declared for the NFL Draft and went undrafted.",
    draft: truthy(get(ev, "round")) && truthy(get(ev, "pick")) ? `Drafted in round ${ev["round"]}, pick ${ev["pick"]}.` : "Drafted.",
  }, k, "Left the program.");
  return { team: null, team_name: null, position: get(ev, "pos"), class: get(ev, "cls"), class_name: null,
    overall: get(ev, "overall"), status: k, status_name: shut ? "Left FBS" : get(offseason.KIND_NAMES, k, "Left the Program"),
    sentence, season: season_year };
}

/** xs.index(x): where it is, or a ValueError. */
function _index(xs, x) {
  const i = xs.indexOf(x);
  if (i === -1) throw new ValueError(`tuple.index(x): x not in tuple`);
  return i;
}


function recruiting_offer_cap(state, slug) {
  return modules.recruiting.offer_cap(state, slug);
}


function portal_rows(state, position = null, status = null, limit = 100) {
  const off = state["offseason"];
  const lgd = state["league"], portal = off["portal"], me = state["team"];
  const mine = new Set(get(portal["offers"], me, []));
  const rows = [];
  for (const [pid, e] of Object.entries(portal["players"])) {
    const p = e["player"];
    if (truthy(position) && offseason.GROUP[p["pos"]] !== position && p["pos"] !== position) continue;
    if (status === "offered" && !mine.has(pid)) continue;
    if (status === "available" && truthy(e["signed"])) continue;
    if (status === "signed" && !truthy(e["signed"])) continue;
    const pt = offseason.playing_time(lgd, me, p);
    rows.push({ id: pid, name: p["n"], pos: p["pos"], group: offseason.GROUP[p["pos"]], cls: p["cls"],
      overall: offseason.house(p["pos"], p["o"]), stars: get(p, "s"), from: e["from"], from_name: e["from_name"],
      last_year: get(e, "usage"), home: get(p, "home"), fit: offseason.PT_NAMES[pt], offered: mine.has(pid),
      signed: e["signed"], signed_name: truthy(e["signed"]) ? lg.team_meta(get(state, "league"), e["signed"])["short_name"] : null,
      offers: e["offers"].length });
  }
  rows.sort((a, b) => cmp([truthy(a["signed"]), -a["overall"]], [truthy(b["signed"]), -b["overall"]]));
  return rows.slice(0, limit === null ? undefined : limit);
}


offseason.RECAP_MOVES = 12;          // *tune* the Portal Recap lists this many of the league's biggest moves
offseason.RECAP_STAGES = ["portal_recap", "development", "staff", "conferences", "schedule", "ready"];


function _school_name(state, slug) {
  // A school's short name for the recap; a player who left FBS has none.
  if (!truthy(slug)) {
    return "out of FBS";
  }
  try {
    const name = lg.team_meta(get(state, "league"), slug)["short_name"];
    if (name === undefined) throw new KeyError("short_name");
    return name;
  } catch {
    return slug;                 // (a school the league and the files do not know)
  }
}


function portal_away(state) {
  // The entrants you recruited (your offer, or on your board) who signed elsewhere or went
  // unsigned: where each went and why not you (recruiting.lost_line), the latest portal week first.
  // Read from the portal's log while it is open, from the log kept at its close after.
  const recruiting = modules.recruiting;
  const off = get(state, "offseason") || {};
  const rc = get(state, "recruiting") || {};
  const log = truthy(get(rc, "portal")) ? get(rc, "log") : get(get(off, "portal_recruiting") || {}, "log");
  const players = get(get(off, "portal") || {}, "players") || {};
  const out = odict();
  for (const e of log || []) {
    if (!truthy(get(e, "lost")) || !has(players, e["pid"])) continue;
    const p = players[e["pid"]]["player"];
    const to = get(e, "school");
    out[e["pid"]] = { id: e["pid"], name: p["n"], pos: p["pos"], overall: offseason.house(p["pos"], p["o"]),
      to, to_name: offseason._school_name(state, to), walk_on: truthy(get(e, "walk_on")), week: get(e, "portal_week"),
      why: e["lost"], line: recruiting.lost_line(e, recruiting.school_name),
      reason: recruiting.lost_reason(e, recruiting.school_name) };
  }
  return sorted(Object.values(out), (r) => [-(r["week"] || 0), -r["overall"]]);
}


function portal_board(state) {
  // Your portal board for the offseason page's compact card: how many entrants are on it and each
  // one as a short line with what the board's standing ladder reads (his list, your offer, where he
  // stands, whether you have room), so the page's chip agrees with the Recruiting tab. The week he
  // signed (`signed_week`) comes from the log; an unsigned entrant has no known decision week.
  const recruiting = modules.recruiting;
  const rc = get(state, "recruiting") || {};
  const me = state["team"];
  const portal = state["offseason"]["portal"];
  const offers = get(get(rc, "offers", {}), me, []);
  const signed_week = new Map();
  for (const e of get(rc, "log", [])) {
    if (e["kind"] === "signed") signed_week.set(e["pid"], get(e, "portal_week"));
  }
  const rows = [];
  for (const pid of get(rc, "board") || []) {
    const e = get(portal["players"], pid);
    const st = get(rc["status"], pid);
    if (!truthy(e) || !truthy(st)) continue;
    const p = e["player"];
    const seen = prospects.seen_status(state, pid, me);
    rows.push({ id: pid, name: p["n"], pos: p["pos"], overall: offseason.house(p["pos"], p["o"]), portal_rank: get(rc["prospects"][pid], "portal_rank"),
      // what your scouts read of him, as the Prospects list shows it (the card shows this, never his true overall)
      our_potential: truthy(get(rc["reads"], pid)) ? recruiting.shown_range(state, pid, "potential") : null,
      offered: offers.includes(pid), signed: seen["signed"], committed: seen["committed"],
      hard: truthy(get(seen, "hard")) && !truthy(seen["signed"]),
      list: prospects._schools(state, pid, me).slice(0, 5).map((x) => ({ ...x, you: x["school"] === me })),
      standing: prospects.standing(state, pid, me), no_room: recruiting.no_room(state, me, pid),
      signed_week: truthy(seen["signed"]) ? (signed_week.has(pid) ? signed_week.get(pid) : null) : null });
  }
  return { count: rows.length, rows };
}


function _portal_recap(state) {
  // After the portal closes: who you got out of it (and where from), who you lost to it (where he
  // went and why he left, from the retention step), against the whole portal's numbers. None before
  // Development and for a save with no portal.
  const off = get(state, "offseason") || {};
  if (!_in(get(off, "stage"), offseason.RECAP_STAGES)) {
    return null;
  }
  const players = get(get(off, "portal") || {}, "players");
  if (!is_dict(players)) {
    return null;
  }
  const me = get(state, "team");
  const lgd = get(state, "league") || {};
  const roster = get(get(get(lgd, "teams") || {}, me, {}), "roster") || [];
  const by_id = new Map(roster.map((p) => [p["id"], p]));
  const walk_ons = new Set((get(get(off, "portal") || {}, "moves") || []).filter((m) => truthy(get(m, "walk_on"))).map((m) => m["id"]));
  const reasons = new Map((get(get(off, "retention") || {}, "players") || []).map((e) => [e["id"], get(e, "reason")]));
  const left = new Map((get(off, "departures") || []).filter((d) => get(d, "team") === me && get(d, "kind") === "portal").map((d) => [d["id"], d]));
  const signed = [], lost = [];
  for (const [pid, e] of Object.entries(players)) {
    const to = get(e, "signed");
    if (to === me) {
      const p = by_id.get(pid) || e["player"];
      signed.push({ id: pid, name: p["n"], pos: p["pos"], cls: p["cls"], overall: offseason.house(p["pos"], p["o"]),
        from: e["from"], from_name: get(e, "from_name") || offseason._school_name(state, e["from"]),
        walk_on: truthy(get(p, "walk_on")) || walk_ons.has(pid) });
    } else if (get(e, "from") === me) {
      const p = e["player"];
      const d = left.get(pid) || {};
      lost.push({ id: pid, name: p["n"], pos: p["pos"], cls: get(d, "cls") || p["cls"],
        overall: get(d, "overall") || offseason.house(p["pos"], p["o"]), to, to_name: offseason._school_name(state, to),
        reason: reasons.has(pid) ? reasons.get(pid) : null });
    }
  }
  signed.sort((a, b) => cmp(-a["overall"], -b["overall"]));
  lost.sort((a, b) => cmp(-a["overall"], -b["overall"]));
  // the portal's biggest moves, the best players who changed schools (yours among them)
  const moves = sorted(Object.entries(players).filter(([, e]) => truthy(get(e, "signed"))).map(([pid, e]) => ({
    id: pid, name: e["player"]["n"], pos: e["player"]["pos"], overall: offseason.house(e["player"]["pos"], e["player"]["o"]),
    from: e["from"], from_name: get(e, "from_name") || offseason._school_name(state, e["from"]),
    to: e["signed"], to_name: offseason._school_name(state, e["signed"]) })), (r) => [-r["overall"], r["name"]]).slice(0, offseason.RECAP_MOVES);
  // where your roster is still under a healthy make-up (walk-ons fill the floor at Progression)
  // by position, as your pages name them (the player's ask): OL, DL, LB and S are shared out to their positions by
  // their starters (recruiting.SPOTS). A view only: walk-ons still fill the floor by group
  const _rec = modules.recruiting;
  const target = {};
  for (const [g, n] of Object.entries(offseason.TARGET)) {
    const parts = truthy(get(_rec.SPOTS, g)) ? _rec.SPOTS[g] : [[g, 1]];
    let left_n = n;
    const total = sum(parts.map(([, k]) => k));
    parts.forEach(([name, k], i) => {
      target[name] = i === parts.length - 1 ? left_n : round(n * k / total);
      left_n -= target[name];
    });
  }
  const have = {};
  for (const c of roster) {
    const g = get(_rec.SPOT_OF, c["pos"]) || get(offseason.GROUP, c["pos"]);
    if (truthy(g)) {
      have[g] = get(have, g, 0) + 1;
    }
  }
  const short = Array.from(_rec.SPOT_ORDER).filter((g) => has(target, g) && get(have, g, 0) < target[g])
    .map((g) => ({ group: g, have: get(have, g, 0), target: target[g] }));
  return { signed, lost, away: offseason.portal_away(state), entrants: Object.keys(players).length,
    signed_league: sum(Object.values(players).map((e) => (truthy(get(e, "signed")) ? 1 : 0))), moves, short };
}


function _stayed(off, roster) {
  // Your players kept home at Keep Them Home, for Departures ("Stayed: You Kept Him Home").
  const by_id = new Map(roster.map((c) => [c["id"], c]));
  const out = [];
  for (const r of get(get(off, "retention") || {}, "results") || []) {
    if (r["status"] !== "stayed") continue;
    const c = by_id.get(r["id"]) || {};
    out.push({ id: r["id"], name: r["name"], pos: r["pos"], intent: r["intent"], kind: "stayed", kind_name: offseason.KIND_NAMES["stayed"],
      overall: get(r, "overall") || (truthy(c) ? offseason.house(c["pos"], c["o"]) : 0), cls: get(r, "cls") || get(c, "cls") });
  }
  return out;
}


function _new_transfer(off, c, me) {
  // Whether a roster player transferred in this offseason (the Transfers group): his stamp says so, or, on a save
  // from before the stamp, this offseason's portal moves bring him to you. Last year's transfer is everyone else.
  if (!truthy(get(c, "transfer"))) {
    return false;
  }
  if (has(c, "transfer_year")) {
    return c["transfer_year"] === get(off, "year");
  }
  return (get(get(off, "portal") || {}, "moves") || []).some((m) => get(m, "id") === c["id"] && get(m, "to") === me);
}


function page(obj) {
  // A view's players as the page shows a rating (teamdata_js/shown.js): a copy of `obj` in which every player row (a
  // dict with an `overall` and a position) has its overall on the shown scale, its `gain` as the difference of the
  // shown overalls before and after, and its `grew` attributes at his card's group. The stored rows keep the game's
  // own scale (an event written last year reads the same as one written today).
  if (Array.isArray(obj)) {
    return obj.map((x) => offseason.page(x));
  }
  if (!is_dict(obj)) {
    return obj === undefined ? null : obj;
  }
  const out = is_odict(obj) ? odict() : {};
  for (const [k, v] of Object.entries(obj)) out[k] = offseason.page(v);
  const pos = get(obj, "pos") || get(obj, "position");
  if (!truthy(pos)) {                     // a staff member's ratings go on the coaches' line (shown.coach)
    if (has(obj, "evaluation")) {                                        // a staff member or a candidate for his job
      for (const k of ["evaluation", "recruiting"]) {
        out[k] = shown.coach(get(obj, k));
      }
    }
    if (typeof get(obj, "rating") === "string" && has(obj, "from") && has(obj, "to")) {     // a staff rating that moved
      out["from"] = shown.coach(obj["from"]);
      out["to"] = shown.coach(obj["to"]);
    }
  }
  const o = get(obj, "overall");
  if (truthy(pos) && is_num(o)) {
    out["overall"] = shown.overall(o);
    const g = get(obj, "gain");
    if (is_num(g)) {
      out["gain"] = shown.gain(o - g, o);
    }
    if (Array.isArray(get(obj, "grew"))) {
      const grp = rv2.card_group(pos, pos);
      out["grew"] = obj["grew"].map((x) => (is_dict(x) && has(x, "key")
        ? { ...x, from: shown.attribute(x["from"], grp, x["key"]), to: shown.attribute(x["to"], grp, x["key"]) } : x));
    }
  }
  return out;
}


function view(state, position = null, status = null) {
  // The Offseason screen, with every player's rating as the page shows it (page).
  return offseason.page(offseason._view(state, position, status));
}


function _view(state, position = null, status = null) {
  // The Offseason screen: where the offseason stands and what it means for your program.
  const recruiting = modules.recruiting;
  offseason.migrate(state);
  const off = state["offseason"];
  const me = state["team"];
  const lgd = state["league"];
  const deps = off["departures"];
  const drafted = get(get(off, "draft") || {}, "done", true);
  const kinds = {};
  for (const d of deps) {
    kinds[d["kind"]] = get(kinds, d["kind"], 0) + 1;
  }
  const portal = off["portal"];
  const rc = get(state, "recruiting") || {};
  const new_portal = truthy(get(rc, "portal"));
  const my_moves = portal["moves"].filter((m) => m["to"] === me || m["from"] === me);
  if (new_portal) {
    for (const [pid, st_] of Object.entries(rc["status"])) {
      const e = portal["players"][pid];
      if (e === undefined) throw new KeyError(pid);
      if (truthy(st_["signed"]) && (st_["signed"] === me || e["from"] === me)) {
        const p = e["player"];
        my_moves.push({ id: pid, name: p["n"], pos: p["pos"], from: e["from"], to: st_["signed"],
          overall: offseason.house(p["pos"], p["o"]), round: get(rc, "week") });
      }
    }
  }
  const staff = get(off, "staff");
  const cur = get(offseason.OLD_PORTAL, off["stage"], off["stage"]);
  const STAGES = Array.from(offseason.STAGES);
  const report = get(off, "report");
  const review = {};
  for (const [k, v] of Object.entries(get(off, "review") || {})) if (k !== "verdict") review[k] = v;
  const jobs = offseason._your_jobs(off);
  const out = {
    stage: off["stage"], stage_name: offseason.STAGE_NAMES[off["stage"]], year: off["year"],
    stages: STAGES.map((s) => ({ key: s, name: offseason.STAGE_NAMES[s], done: _index(STAGES, s) < _index(STAGES, cur),
      current: s === cur })),
    // what happened: shown once the draft has run (after Keep Them Home); your players you kept are "stayed"
    departures: { mine: deps.filter((d) => d["team"] === me).map((d) => ({ ...d, kind_name: offseason.KIND_NAMES[d["kind"]] })),
      league: kinds, first_round: sorted(deps.filter((d) => d["kind"] === "draft"), (d) => d["pick"]).slice(0, 32),
      early_entrants: sum(deps.map((d) => (truthy(get(d, "early")) ? 1 : 0))), drafted,
      stayed: offseason._stayed(off, lgd["teams"][me]["roster"]) },
    review_open: _in(off["stage"], offseason.REVIEW_STAGES),
    signed: get(get(off, "signed", {}), me, 0),
    retention: offseason._retention_view(state),
    redshirts: get(off, "redshirts"),
    position_changes: truthy(get(off, "position_changes")) ? off["position_changes"] : [],
    my_roster: sorted(lgd["teams"][me]["roster"].map((c) => ({ id: c["id"], name: c["n"], pos: c["pos"], cls: c["cls"], overall: offseason.house(c["pos"], c["o"]),
      moved_from: get(c, "moved_from"), transfer: offseason._new_transfer(off, c, me) ? get(c, "transfer") : null })),
    (r) => [get(offseason.GROUP, r["pos"], "Z"), -r["overall"]]),
    roster: lgd["teams"][me]["roster"].length, roster_limit: offseason.ROSTER_LIMIT,
    open_spots: new_portal ? offseason.recruiting_spots(state, me) : offseason.open_spots(lgd, me, portal),
    release_spots: new_portal ? 0 : offseason.churn_left(portal, me),
    portal: { round: new_portal ? get(rc, "week") : portal["round"], week: new_portal ? get(rc, "week") : null,
      weeks: offseason.PORTAL_STAGES.length, entrants: Object.keys(portal["players"]).length,
      signed: new_portal ? sum(Object.values(rc["status"]).map((st_) => (truthy(st_["signed"]) ? 1 : 0)))
        : sum(Object.values(portal["players"]).map((e) => (truthy(e["signed"]) ? 1 : 0))),
      offers: new_portal ? Array.from(get(rc["offers"], me, [])) : Array.from(get(portal["offers"], me, [])),
      offers_left: (new_portal ? Math.max(0, offseason.recruiting_offer_cap(state, me) - get(rc["offers"], me, []).length)
        : Math.max(0, Math.ceil(offseason.PORTAL_OFFER_FACTOR * offseason.my_spots(lgd, me, portal)) - get(portal["offers"], me, []).length)),
      moves_mine: my_moves,
      away: new_portal ? offseason.portal_away(state) : [],
      board: new_portal && _in(off["stage"], offseason.PORTAL_STAGES) ? offseason.portal_board(state) : null,
      rows: off["stage"] === "portal_1" || off["stage"] === "portal_2" ? offseason.portal_rows(state, position, status) : [] },
    portal_recap: offseason._portal_recap(state),
    // the 25 biggest gains, and everyone who went backward (regress): a step back is news whatever the rest did
    report: truthy(report) ? { mine: report["development"]["mine"].slice(0, 25)
      .concat(report["development"]["mine"].slice(25).filter((r) => r["gain"] < 0)),
    transfers: (truthy(get(report["development"], "transfers")) ? report["development"]["transfers"]
      : report["development"]["mine"].filter((r) => truthy(get(r, "transfer")))),
    mean_gain_ea: report["development"]["mean_gain_ea"],
    walk_ons: report["walk_ons"] } : report,
    staff: null,
    review: Object.keys(review).length ? review : null,
    fired: truthy(get(off, "fired")),
    your_staff: get(get(state, "career") || {}, "staff", []).map((x) => ({ id: x["id"], role: x["role"], name: x["name"], contract_until: get(x, "contract_until"),
      evaluation: get(x, "evaluation"), recruiting: get(x, "recruiting"), area: get(x, "area") })),     // his card on the Staff step
    // a job that is yours to take is not shown as filled while you decide (the league's pick steps in only if you pass)
    coaching_changes: get(off, "coaching_changes", []).filter((c) => c["role"] === "head_coach"
      && !(truthy(get(c, "new")) && c["new"] !== "You" && jobs.has(c["team"]))).slice(0, 60),
    history: get(get(state, "career") || {}, "history", []),
  };
  if (out["review"] !== null) {            // the pool's math for your school: left + reward (+ fund) = pool
    out["review"]["nil_portal"] = recruiting.pool_record(state, me);
  }
  if (off["stage"] === "ready") {              // the AD's goal for the coming season, at the school you coach then
    out["goal_next"] = carousel.goal(get(off, "move_to") || me, state)["text"];
  }
  const car = get(off, "carousel");
  if (truthy(car)) {
    out["job"] = { you: get(car, "you") || {}, offers: carousel.job_rows(state, car["offers"]),
      openings: carousel.job_rows(state, car["openings"]), choice: get(car, "choice"),
      moving_to: get(off, "move_to") };
  }
  if (truthy(staff)) {
    const by_id = odict(state["career"]["staff"].map((s) => [s["id"], s]));
    const opened = get(off, "staff_open") || {};
    const reasons = odict();
    for (const i of staff["leaving"]) {
      if (!has(by_id, i)) continue;
      reasons[i] = get(opened, i) || get(get(staff, "reasons", {}), i) || (by_id[i]["role"] === "Recruiter" ? "is moving on" : "was hired away as a head coach");
    }
    const year = off["year"];
    const contract = odict();
    for (const [i, s] of Object.entries(by_id)) contract[i] = { until: get(s, "contract_until"), expiring: offseason.expiring(s, year) };
    out["staff"] = { leaving: staff["leaving"].filter((i) => has(by_id, i)).map((i) => by_id[i]), candidates: staff["candidates"],
      hired: staff["hired"], changes: get(staff, "changes", []), reasons,
      // contracts: each member's through year and whether it ran out before the coming season (a leaver at
      // expiry shopped; a stayer at expiry is in `renewed` with his new term); the coordinators who turned a job down
      contract,
      expiring: Object.entries(by_id).filter(([, s]) => offseason.expiring(s, year)).map(([i]) => i),
      renewed: get(staff, "renewed", []), turned_down: get(staff, "turned_down", {}),
      developed: get(get(get(off, "report") || {}, "coaches") || {}, "mine", []),
      market: off["stage"] === "staff" ? carousel.market_rows(state).slice(0, 40) : [] };
  }
  if (off["stage"] === "conferences") {
    out["conferences"] = offseason.conferences_view(state);
  } else if (off["stage"] === "schedule") {
    out["schedule"] = offseason.schedule_view(state);
  }
  return out;
}


Object.assign(offseason, {
  _your_jobs, choose_job, _take_job, advance, next_teams, conferences_view, move_conference, _draw_schedule, _schedule_shim,
  schedule_view, schedule_move, schedule_trade, migrate, run_all, summary, next_season, portal_offer, recruiting_spots,
  player_next, _player_next, recruiting_offer_cap, portal_rows, _school_name, portal_away, portal_board, _portal_recap,
  _stayed, _new_transfer, page, view, _view,
  KeyError, OverflowError,          // (as portal_offer throws them: for the caller that tells them apart)
});

// ----- Notes ----------------------------------------------------------------------------------------------------
// - Errors: KeyError and OverflowError are local classes, put on the namespace as offseason.KeyError and
//   offseason.OverflowError. _school_name answers the slug on any error from league.team_meta.
// - migrate: its `scores` is an odict (keyed by player ids, in the order they were added).
// - PT_NAMES: the keys are the texts "1", "0.5" and "0.15", which is what looking one up by the number playing_time
//   answers reads.
// - _your_jobs answers a Set (only asked whether a slug is in it).
// - page: a dict is any object that is not an array (an odict stays an odict, so a dict keyed by event ids keeps its
//   order); a plain object with number-like keys (none is known in a view) would list them first.
// - _view: the dicts keyed by staff ids (`reasons`, `contract`) are odicts; `kinds`, `target` and `have` are keyed
//   by names. _player_next writes a player's stored overall into its sentence as JavaScript prints a number (the
//   league's overalls are whole numbers).
// - advance and the two reports: _develop_all runs before _fill_rosters (the order of their draws).
