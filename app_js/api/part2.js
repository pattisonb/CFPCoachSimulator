// app/api.py, part 2 (the Python file's lines 946 to the end): the saved seasons' list and their deleting, the
// coaches, the helpers every season route uses, and the season routes themselves: schedule, views and settings,
// recruiting, the offseason, and the roster and stats pages.
//
// Ported by engine_js/PORTING.md's rules ("A big file ported in parts"): every name of the api file is reached
// through the `api` namespace, whichever part defines it. A handler's `@route(method, pattern)` is the call
// `api.route(method, pattern, handler)` right after its definition, in the Python file's order.
import { get, truthy } from "../../engine_js/pyrt.js";
import { read_text, exists, remove, remove_dir, list_dir, mtime } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";
import { coaches, ValueError } from "../../sim_js/coaches.js";
import { league } from "../../career_js/league.js";
import { prospects } from "../../career_js/prospects.js";
import { api } from "../api_ns.js";

// ----- what Python has built in and JavaScript does not (local to this part) ----------------------------------

const has = (d, k) => Object.prototype.hasOwnProperty.call(d, k);

/** isinstance(v, dict): a JSON object (not a list, not an upload's bytes). */
const is_dict = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && !ArrayBuffer.isView(v) && !(v instanceof ArrayBuffer);

/** d[k] where Python raises KeyError for a missing key (list_seasons lists such a save plainly). */
function need_key(d, k) {
  if (!has(d, k)) throw new Error(`KeyError: ${JSON.stringify(k)}`);
  return d[k];
}

/** A ported `except KeyError`: the offseason's own class, or the plain Error a port throws for Python's d[k]. */
const is_key_error = (e) => e instanceof modules.offseason.KeyError || (e instanceof Error && String(e.message).startsWith("KeyError"));

/** The Python types a query value or a body field is asked for by, by name, as `Params.q` and `api._field` take them (part 1). */
const str = "str", int = "int", bool = "bool", dict = "dict", list = "list";


function _champion_name(st) {
  // A saved season's champion by name, from its own league (a league file's new team) or the built-in teams.
  const slug = get(st, "champion");
  if (!truthy(slug)) return null;
  const meta = get(get(get(get(st, "league") || {}, "teams") || {}, slug) || {}, "meta");
  if (meta !== null) return get(meta, "short_name") || get(meta, "name");
  return get(get(api._all_teams(), slug, {}), "name");
}


function list_seasons(p) {
  // The saved seasons, newest first. A season file can be several megabytes, so each
  // card is cached by the file's modification time instead of re-read on every call.
  const season = modules.season;
  const out = [];
  // (port) a folder that is not there lists no files: Python's SEASONS_DIR.exists() test
  const files = list_dir(season.SEASONS_DIR).filter((n) => n.endsWith(".json"))
    .map((n) => ({ stem: n.slice(0, -5), path: `${season.SEASONS_DIR}/${n}` }));
  const when = new Map(files.map((f) => [f, mtime(f.path)]));
  const newest = files.slice().sort((a, b) => when.get(b) - when.get(a)).slice(0, 30);
  for (const f of newest) {
    const mt = mtime(f.path);
    const cached = get(api._cards, f.stem);
    if (truthy(cached) && cached[0] === mt) {
      out.push(cached[1]);
      continue;
    }
    let st = null, card;
    try {
      st = JSON.parse(read_text(f.path));
      if (!is_dict(st)) continue;                 // (Python: its `in` or its `.get` fails on anything but a dict, and it is skipped)
      if (!has(st, "current_week") || get(st, "mode") === "real") continue;   // the old server's real 2026 season
      const rec = api._card_record(st);          // from the save's own games: a custom program is not in whatever league is loaded
      card = {
        "id": need_key(st, "id"), "team": need_key(st, "team"), "team_name": need_key(st, "team_name"), "mode": need_key(st, "mode"),
        "created_at": need_key(st, "created_at"), "current_week": st["current_week"], "done": need_key(st, "done"),
        "wins": rec["wins"], "losses": rec["losses"], "champion_name": api._champion_name(st),
        "year": get(st, "year") || 2026, "career": truthy(get(st, "career")), "offseason": get(get(st, "offseason") || {}, "stage"),
      };
    } catch (e) {  // one unreadable file must not break the list
      if (!(is_dict(st) && truthy(get(st, "id")) && truthy(get(st, "team")))) continue;
      // a save that reads but whose card trips: listed plainly (never hidden; it is the player's career)
      card = {
        "id": st["id"], "team": st["team"], "team_name": get(st, "team_name") || st["team"], "mode": get(st, "mode", "full"),
        "created_at": get(st, "created_at"), "current_week": get(st, "current_week", 0), "done": truthy(get(st, "done")),
        "wins": 0, "losses": 0, "champion_name": null, "year": get(st, "year") || 2026, "career": truthy(get(st, "career")),
        "offseason": get(get(st, "offseason") || {}, "stage"),
      };
    }
    api._cards[f.stem] = [mt, card];
    out.push(card);
  }
  return { "seasons": out };
}
api.route("GET", "/api/seasons", list_seasons);


function get_season(p) {
  return modules.season.summary(api._season_state(p.path["season_id"]));
}
api.route("GET", "/api/season/{season_id}", get_season);


function season_teams(p) {
  // The team cards of the league this season plays (a career from a league file has its own teams).
  api._season_state(p.path["season_id"]);          // puts its league in play
  return { "teams": Object.values(modules.season.load_teams()).map((t) => api._team_card(t)) };
}
api.route("GET", "/api/season/{season_id}/teams", season_teams);


function _delete_season_file(season_id) {
  // Remove one saved season; False if it is simulating right now.
  const season = modules.season;
  if (api._loaded !== null && api._loaded["id"] === season_id && get(api._job, "status") === "running") return false;
  api._drop(season_id);
  delete api._cards[season_id];
  remove_dir(`${season.SEASONS_DIR}/${season_id}`);          // (nothing happens when it is not there)
  remove(`${season.SEASONS_DIR}/${season_id}.json`);
  league.forget(season_id);
  api._mark_changed();
  return true;
}


function delete_season(p) {
  const season_id = p.path["season_id"];
  const in_memory = api._loaded !== null && api._loaded["id"] === season_id;
  if (!exists(`${modules.season.SEASONS_DIR}/${season_id}.json`) && !in_memory) throw new api.ApiError(404, "season not found");
  if (!api._delete_season_file(season_id)) throw new api.ApiError(409, "that season is simulating; wait for it to finish");
  return { "ok": true, "deleted": true };
}
api.route("DELETE", "/api/season/{season_id}", delete_season);


function delete_all_seasons(p) {
  // Delete every saved season except any that is simulating.
  let removed = 0, kept = 0;
  for (const n of list_dir(modules.season.SEASONS_DIR).filter((name) => name.endsWith(".json"))) {
    if (api._delete_season_file(n.slice(0, -5))) removed += 1;
    else kept += 1;
  }
  return { "ok": true, "removed": removed, "kept": kept };
}
api.route("DELETE", "/api/seasons", delete_all_seasons);


// ----- coaches -----------------------------------------------------------------

function coach_options(p) {
  return coaches.options();
}
api.route("GET", "/api/coach-options", coach_options);


function coach_list(p) {
  return { "coaches": coaches.list_all() };
}
api.route("GET", "/api/coaches", coach_list);


function coach_get(p) {
  const c = coaches.load(p.path["coach_id"]);
  if (c === null) throw new api.ApiError(404, "unknown coach");
  return c;
}
api.route("GET", "/api/coaches/{coach_id}", coach_get);


function coach_save(p) {
  api._check_not_running();
  let c;
  try {
    c = coaches.save(api._field(p, "coach", dict));
  } catch (exc) {
    if (exc instanceof ValueError) throw new api.ApiError(400, exc.message);
    throw exc;
  }
  api._mark_changed();
  return c;
}
api.route("POST", "/api/coaches", coach_save);


function coach_delete(p) {
  api._check_not_running();
  let deleted;
  try {
    deleted = coaches.delete(p.path["coach_id"]);
  } catch (exc) {
    if (exc instanceof ValueError) throw new api.ApiError(404, exc.message);
    throw exc;
  }
  if (deleted) api._mark_changed();
  return { "deleted": deleted };
}
api.route("DELETE", "/api/coaches/{coach_id}", coach_delete);


// ----- helpers for the season routes -------------------------------------------

function _save_loaded() {
  // Write the season in memory to its file (a handler that changed it calls this before returning). A light action
  // under DEFER_SAVES only marks it waiting (flush).
  if (api.DEFER_SAVES && api._light) {
    api._dirty = true;
    return;
  }
  api._dirty = false;
  modules.season.save_season(api._loaded);
  delete api._cards[api._loaded["id"]];
  api._mark_changed();
}


function _check_team(slug) {
  // 404 for a slug that is not a team, or is an FCS stand-in (those show only in the box
  // scores of their games, so no season view is about one). Every caller has put its season's league in play
  // (_season_state), so a team of a career's own league (a league file's new team) is one, and a removed one is not.
  const season = modules.season;
  if (typeof slug !== "string" || !has(season.load_teams(), slug)) throw new api.ApiError(404, "unknown team");
  try {
    season.check_fbs(slug);
  } catch (e) {
    if (e instanceof season.StandInError) throw new api.ApiError(404, e.message);
    throw e;
  }
}


function _need(p, name) {
  // A required query parameter: 422 when it is missing.
  const value = p.q(name);
  if (value === null || value === undefined) throw new api.ApiError(422, `${name} is required`);
  return value;
}


function _career_state(season_id, change = false) {
  // The season, which must be a Coach Career; with `change`, refused while it simulates.
  const state = api._season_state(season_id);
  if (!truthy(get(state, "recruiting"))) throw new api.ApiError(404, "not a Coach Career");
  if (change) api._check_not_running();
  return state;
}


function _recruiting_call(fn, ...args) {
  try {
    return fn(...args);
  } catch (e) {
    if (e instanceof modules.recruiting.RecruitingError) throw new api.ApiError(e.message === "unknown prospect" ? 404 : e.code, e.message);
    throw e;
  }
}


function _offseason_state(season_id, p = null) {
  // A career whose season is over, with its offseason open (opened on first ask). Given the
  // call's params, an optional body field `stage` (the stage the page drew) must still be the
  // offseason's stage: a click queued behind an advance is refused (409) instead of landing on a
  // later stage or on the next season. Callers that omit it are not checked.
  const offseason = modules.offseason;
  const st = api._career_state(season_id, true);
  if (truthy(get(st, "offseason")) && !has(st["offseason"], "draft")) {      // a save from the older order (Departures first)
    offseason.migrate(st);
    api._save_loaded();
  }
  const drawn = p !== null ? api._field(p, "stage", str, null) : null;
  if (drawn !== null) {
    const off = truthy(get(st, "done")) ? get(st, "offseason") : null;
    if (!truthy(off) || get(off, "stage") !== drawn) {
      const name = get(offseason.STAGE_NAMES, drawn, "an earlier stage");
      throw new api.ApiError(409, `The offseason has moved on: this was for ${name}.`);
    }
  }
  if (!truthy(get(st, "done"))) throw new api.ApiError(409, "the season is not over");
  if (!truthy(get(st, "offseason"))) {
    offseason.start(st);
    api._save_loaded();
  }
  return st;
}


// ----- schedule, views and settings --------------------------------------------

function season_week(p) {
  const season = modules.season;
  const text = p.path["week"];
  // int(text): a whole number's text as Python reads one (anything else is its ValueError)
  if (!/^\s*[+-]?\d+(?:_\d+)*\s*$/.test(text)) throw new api.ApiError(422, "week must be an int");
  const week = Number(text.replace(/_/g, ""));
  const state = api._season_state(p.path["season_id"]);
  const table = week >= state["current_week"] ? season.standings(state) : null;
  return { "week": week, "games": season.week_view(state, week), "standings": table };
}
api.route("GET", "/api/season/{season_id}/week/{week}", season_week);


function season_team_schedule(p) {
  // Any team's schedule with results, byes, ranks and opponent records.
  const state = api._season_state(p.path["season_id"]);
  api._check_team(p.path["slug"]);
  return modules.season.team_schedule_view(state, p.path["slug"]);
}
api.route("GET", "/api/season/{season_id}/schedule/{slug}", season_team_schedule);


function schedule_edit_view(p) {
  // Your non-conference games you can still trade (a career, before week 1), with the options for each.
  const season = modules.season;
  const state = api._season_state(p.path["season_id"]);
  const games = season.schedule_editable(state);
  return {
    "games": games.map((g) => ({ ...g, "options": season.schedule_options(state, g["event_id"]) })),
    "changes": get(state, "schedule_changes") || [],
  };
}
api.route("GET", "/api/season/{season_id}/schedule_edit", schedule_edit_view);


function schedule_edit_swap(p) {
  // Trade one of your non-conference games for another school's that week.
  const season = modules.season;
  const state = api._season_state(p.path["season_id"]);
  const event_id = api._field(p, "event_id", str), slug = api._field(p, "slug", str);
  api._check_not_running();
  try {
    season.schedule_swap(state, event_id, slug);
  } catch (e) {
    if (e instanceof season.ScheduleError) throw new api.ApiError(e.code, e.message);
    throw e;
  }
  api._save_loaded();
  return { "changes": get(state, "schedule_changes") || [] };
}
api.route("POST", "/api/season/{season_id}/schedule_edit", schedule_edit_swap);


function season_redshirt(p) {
  // Redshirt one of your players for the rest of the season, or take him off it (four games or fewer).
  const season = modules.season;
  const state = api._career_state(p.path["season_id"]);
  const team = api._field(p, "team", str), player = api._field(p, "player", str), on = api._field(p, "on", bool, true);
  api._check_team(team);
  if (team !== state["team"]) throw new api.ApiError(403, "only your own players");
  api._check_not_running();
  let out;
  try {
    out = season.redshirt_toggle(state, team, player, on);
  } catch (e) {
    if (e instanceof season.RedshirtError) throw new api.ApiError(e.code, e.message);
    throw e;
  }
  api._save_loaded();
  return out;
}
api.route("POST", "/api/season/{season_id}/redshirt", season_redshirt);


function season_position_options(p) {
  // What one of your players would be at every position, where he is now first.
  const season = modules.season;
  const state = api._career_state(p.path["season_id"]);
  const team = p.path["slug"], player = p.path["player"];
  api._check_team(team);
  if (team !== state["team"]) throw new api.ApiError(403, "only your own players");
  try {
    return { "options": season.position_options(state, team, player) };
  } catch (e) {
    if (e instanceof season.PositionError) throw new api.ApiError(e.code, e.message);
    throw e;
  }
}
api.route("GET", "/api/season/{season_id}/position_options/{slug}/{player}", season_position_options);


function season_position(p) {
  // Move one of your players to another position now: he plays and shows there from the next game.
  const season = modules.season;
  const state = api._career_state(p.path["season_id"]);
  const team = api._field(p, "team", str), player = api._field(p, "player", str), pos = api._field(p, "pos", str);
  api._check_team(team);
  if (team !== state["team"]) throw new api.ApiError(403, "only your own players");
  api._check_not_running();
  let out;
  try {
    out = season.change_position(state, team, player, pos);
  } catch (e) {
    if (e instanceof season.PositionError) throw new api.ApiError(e.code, e.message);
    throw e;
  }
  api._save_loaded();
  return out;
}
api.route("POST", "/api/season/{season_id}/position", season_position);


function season_standings(p) {
  return { "standings": modules.season.standings(api._season_state(p.path["season_id"])) };
}
api.route("GET", "/api/season/{season_id}/standings", season_standings);


function season_review(p) {
  return modules.season.season_review(api._season_state(p.path["season_id"]));
}
api.route("GET", "/api/season/{season_id}/review", season_review);


function season_resume(p) {
  // The committee's resume for every FBS team through `week` (default: now); with
  // `team`, that one team with its full game list.
  return modules.season.resume(api._season_state(p.path["season_id"]), p.q("week", int), p.q("team"));
}
api.route("GET", "/api/season/{season_id}/resume", season_resume);


function season_game(p) {
  const season = modules.season;
  const state = api._season_state(p.path["season_id"]);
  const event_id = p.path["event_id"];
  let box = season.load_box(state, event_id);
  if (box === null) throw new api.ApiError(404, "no box score for that game");
  const g = get(state["games"], event_id);
  if (g !== null) {
    const riv = season.game_rivalry(state, g, true);
    if (riv !== null) box = { ...box, "rivalry": riv };
  }
  // each side's overall for the scoreboard, as the page shows a team rating (not stored with the box)
  const overalls = {};
  for (const s of ["home", "away"]) overalls[s] = season.team_overall(state, get(box, `${s}_slug`));
  return { ...box, "overalls": overalls };
}
api.route("GET", "/api/season/{season_id}/game/{event_id}", season_game);


function season_settings(p) {
  return { "settings": modules.season.settings(api._season_state(p.path["season_id"])) };
}
api.route("GET", "/api/season/{season_id}/settings", season_settings);


function season_settings_change(p) {
  // Change a season's settings (god mode and the rest; a career's Auto-recruit); saved with the season.
  const season = modules.season, recruiting = modules.recruiting;
  const state = api._season_state(p.path["season_id"]);
  const changes = { "god_mode": api._field(p, "god_mode", bool, null), "morale": api._field(p, "morale", bool, null) };
  const auto = get(is_dict(p.body) ? p.body : {}, "auto_recruit");   // "off", "week" or "season" (true/false still read)
  if (auto !== null && typeof auto !== "boolean" && typeof auto !== "string") throw new api.ApiError(422, "auto_recruit must be a bool or a str");
  const mode = typeof auto === "boolean" ? (auto ? "season" : "off") : auto;
  if (auto !== null && !recruiting.AUTO_MODES.includes(mode)) throw new api.ApiError(400, "Auto-recruit is off, week or season");
  if (auto !== null && !truthy(get(state, "recruiting"))) throw new api.ApiError(404, "not a Coach Career");
  const out = season.update_settings(state, changes);
  if (auto !== null) {
    state["career"]["settings"]["auto_recruit"] = mode;
    if (mode !== "off") recruiting.clear_scenes(state, state["team"]);     // your staff take over: an open call or visit scene is dropped
  }
  api._save_loaded();
  const res = { "settings": out };
  if (truthy(get(state, "career"))) res["auto_recruit"] = recruiting.auto_mode(state);
  return res;
}
api.route("POST", "/api/season/{season_id}/settings", season_settings_change);


// ----- recruiting (reads wait for a running sim too: the week's step changes what they read) -----

function recruiting_view(p) {
  return prospects.recruiting_view(api._career_state(p.path["season_id"], true));
}
api.route("GET", "/api/season/{season_id}/recruiting", recruiting_view);


function scouting_view(p) {
  // The Scouting tab: your scouts, a page of the Prospect Database (q, position, group, offset, limit,
  // scouted, on_board, sort: rank, board, need, potential or looks), this and last week's reports, your flags.
  const st = api._career_state(p.path["season_id"], true);
  const q = p.q("q"), position = p.q("position"), group = p.q("group"), offset = Math.max(0, p.q("offset", int, 0));
  const limit = p.q("limit", int, prospects.QUEUE_LIMIT), scouted = ["1", "true"].includes(p.q("scouted"));
  const sort = p.q("sort") || "rank", on_board = ["1", "true"].includes(p.q("on_board"));
  return prospects.scouting_view(st, q, position, group, offset, limit, scouted, sort, on_board);
}
api.route("GET", "/api/season/{season_id}/scouting", scouting_view);


function programs_view(p) {
  // Every program's living rating (prestige, winning, NIL, market, conference, coach; tier and goal), yours first.
  const programs = modules.programs;
  const st = api._career_state(p.path["season_id"]);
  const rows = programs.rows(st);
  const me = rows.find((r) => r["team"] === st["team"]) ?? null;
  return {
    "you": me, "rows": rows, "tiers": programs.TIER_NAMES, "weights": programs.WEIGHTS,
    "words": Array.from(programs.WORD_FLOORS, (w) => [...w]), "group_order": [...programs.PRO_GROUP_ORDER],
  };
}
api.route("GET", "/api/season/{season_id}/programs", programs_view);


function office_view(p) {
  // The Office's own read: your program's news over the last weeks, your conference's latest results and your place.
  return modules.office.office_view(api._career_state(p.path["season_id"]));
}
api.route("GET", "/api/season/{season_id}/office", office_view);


function headquarters_view(p) {
  // Headquarters: the saved widget layout, and with `want` (commits, movers) the reads no other view has.
  const headquarters = modules.headquarters;
  const st = api._career_state(p.path["season_id"]);
  const want = new Set((p.q("want") || "").split(",").filter((w) => w));
  const out = { "layout": headquarters.layout(st) };
  if (want.has("commits")) out["commits"] = headquarters.commits_by_week(st);
  if (want.has("movers")) out["movers"] = headquarters.movers(st);
  if (want.has("contacts")) out["contacts"] = headquarters.last_contacts(st);
  if (want.has("outlook")) out["outlook"] = headquarters.outlook(st);
  if (want.has("next_year")) out["next_year"] = headquarters.next_year(st);
  if (want.has("goals")) out["goals"] = headquarters.goals(st);
  if (want.has("tasks")) out["tasks"] = headquarters.tasks(st);
  if (want.has("promises")) out["promises"] = headquarters.promises_tracker(st);
  if (want.has("whatif")) {
    try {
      out["whatif"] = headquarters.what_if(st, p.q("pid") || "");
    } catch (e) {
      if (e instanceof headquarters.LayoutError) throw new api.ApiError(404, e.message);
      throw e;
    }
  }
  return out;
}
api.route("GET", "/api/season/{season_id}/headquarters", headquarters_view);


function headquarters_plan(p) {
  // Store Headquarters' tasks and goal targets ({"tasks": [...], "goals": {...}}, either optional); a bad shape is a 400.
  const headquarters = modules.headquarters;
  const st = api._career_state(p.path["season_id"]);
  let out;
  try {
    out = headquarters.set_plan(st, p.body);
  } catch (e) {
    if (e instanceof headquarters.LayoutError) throw new api.ApiError(400, e.message);
    throw e;
  }
  api._save_loaded();
  return out;
}
api.route("POST", "/api/season/{season_id}/headquarters/plan", headquarters_plan);


function headquarters_save(p) {
  // Store the Headquarters layout ({"cards": [{"id", "widget", "size"}]}); a bad shape is a 400, nothing stored.
  const headquarters = modules.headquarters;
  const st = api._career_state(p.path["season_id"]);
  const body = is_dict(p.body) ? p.body : {};
  let out;
  try {
    out = headquarters.set_layout(st, get(body, "cards"));
  } catch (e) {
    if (e instanceof headquarters.LayoutError) throw new api.ApiError(400, e.message);
    throw e;
  }
  api._save_loaded();
  return { "layout": out };
}
api.route("POST", "/api/season/{season_id}/headquarters", headquarters_save);


function recruiting_reports(p) {
  // The weekly reports kept (what changed for the prospects on your board), latest last.
  const st = api._career_state(p.path["season_id"], true);
  return { "reports": get(st["recruiting"], "reports") || [] };
}
api.route("GET", "/api/season/{season_id}/recruiting/report", recruiting_reports);


function prospect_search(p) {
  const st = api._career_state(p.path["season_id"], true);
  const position = p.q("position"), stars = p.q("stars", int), home = p.q("state"), status = p.q("status"), q = p.q("q");
  const offset = Math.max(0, p.q("offset", int, 0)), limit = p.q("limit", int, 50), sort = p.q("sort", str, "rank"), group = p.q("group");
  const cols = {};
  for (const k of ["commit", "interest", "scouted", "pot"]) cols[k] = p.q(k);
  for (const k of ["ht", "wt", "offers", "ask"]) for (const end of ["min", "max"]) cols[`${k}_${end}`] = p.q(`${k}_${end}`, int);
  return prospects.search(st, st["team"], position, stars, home, status, q, offset, limit, sort, group, cols);
}
api.route("GET", "/api/season/{season_id}/prospects", prospect_search);


function national_classes(p) {
  // Every FBS school's class ranked nationally; with `school`, that class's recruits too.
  const st = api._career_state(p.path["season_id"], true);
  const school = p.q("school");
  if (truthy(school)) api._check_team(school);
  const block = new prospects.class_block(st);          // `with prospects.class_block(st):`
  block.__enter__();
  let out;
  try {
    out = prospects.national_classes(st, st["team"]);
    if (truthy(school)) out["class"] = prospects.class_detail(st, school, st["team"]);
  } finally {
    block.__exit__();
  }
  return out;
}
api.route("GET", "/api/season/{season_id}/classes", national_classes);


function prospect_profile(p) {
  const st = api._career_state(p.path["season_id"], true);
  return api._recruiting_call(prospects.profile, st, p.path["pid"], st["team"]);
}
api.route("GET", "/api/season/{season_id}/prospect/{pid}", prospect_profile);


function recruit_action(p) {
  const recruiting = modules.recruiting;
  const st = api._career_state(p.path["season_id"], true);
  const pid = api._field(p, "pid", str), action = api._field(p, "action", str);
  const pitch = api._field(p, "pitch", str, null), nil = api._field(p, "nil", int, 0), scene = api._field(p, "scene", str, null);
  const answer = api._field(p, "answer", str, null), topics = api._field(p, "topics", list, null);
  const week = api._field(p, "week", int, null);                // an official visit's home weekend, when you picked one
  if (!recruiting.visible(st).has(pid)) throw new api.ApiError(404, "unknown prospect");
  const out = api._recruiting_call(recruiting.act, st, st["team"], pid, action, pitch, nil, scene, answer, topics, week);
  api._save_loaded();
  return out;
}
api.route("POST", "/api/season/{season_id}/recruit", recruit_action);


function recruit_plan(p) {
  // Tick or untick a quick action on a recruit's row ({pid, action, on}): it holds its energy and goes out at the week
  // step (coach_career/recruiting.plan).
  const recruiting = modules.recruiting;
  const st = api._career_state(p.path["season_id"], true);
  const pid = api._field(p, "pid", str), action = api._field(p, "action", str), on = api._field(p, "on", bool, true);
  if (!recruiting.visible(st).has(pid)) throw new api.ApiError(404, "unknown prospect");
  const out = api._recruiting_call(recruiting.plan, st, pid, action, on);
  api._save_loaded();
  return out;
}
api.route("POST", "/api/season/{season_id}/recruit/plan", recruit_plan);


function favorite_change(p) {
  // Your favorites (♥): a prospect marked or cleared.
  const recruiting = modules.recruiting;
  const st = api._career_state(p.path["season_id"], true);
  const pid = api._field(p, "pid", str), on = api._field(p, "on", bool, true);
  if (!recruiting.visible(st).has(pid)) throw new api.ApiError(404, "unknown prospect");
  recruiting.set_favorite(st, pid, on);
  api._save_loaded();
  return { "favorites": st["recruiting"]["favorites"] };
}
api.route("POST", "/api/season/{season_id}/favorite", favorite_change);


function board_change(p) {
  const recruiting = modules.recruiting;
  const st = api._career_state(p.path["season_id"], true);
  const pid = api._field(p, "pid", str), on = api._field(p, "on", bool, true);
  if (!recruiting.visible(st).has(pid)) throw new api.ApiError(404, "unknown prospect");
  try {
    recruiting.set_board(st, pid, on);
  } catch (e) {
    if (e instanceof recruiting.RecruitingError) throw new api.ApiError(e.code, e.message);
    throw e;
  }
  api._save_loaded();
  return { "board": st["recruiting"]["board"] };
}
api.route("POST", "/api/season/{season_id}/board", board_change);


function staff_change(p) {
  const st = api._career_state(p.path["season_id"], true);
  const staff_id = api._field(p, "staff_id", str), area = api._field(p, "area", str);
  api._recruiting_call(modules.recruiting.assign, st, staff_id, area);
  api._save_loaded();
  return { "staff": st["career"]["staff"] };
}
api.route("POST", "/api/season/{season_id}/staff", staff_change);


// ----- the offseason (offseason.py): departures, the transfer portal, development, staff -----

function offseason_view(p) {
  const st = api._offseason_state(p.path["season_id"]);
  return modules.offseason.view(st, p.q("position"), p.q("status"));
}
api.route("GET", "/api/season/{season_id}/offseason", offseason_view);


function offseason_advance(p) {
  // The next offseason stage; past the last one (or with to="next_season"), the next season.
  const offseason = modules.offseason;
  const st = api._offseason_state(p.path["season_id"], p);
  const to = api._field(p, "to", str, null);
  if (to === "next_season") {
    offseason.run_all(st);
  } else if (st["offseason"]["stage"] !== "ready") {
    offseason.advance(st);
    api._save_loaded();
    return offseason.view(st);
  }
  const new_ = offseason.next_season(st);
  api._hold(new_);
  api._save_loaded();
  return { "next_season": true, "year": new_["year"], "summary": modules.season.summary(new_) };
}
api.route("POST", "/api/season/{season_id}/offseason/advance", offseason_advance);


function offseason_portal(p) {
  const offseason = modules.offseason;
  const st = api._offseason_state(p.path["season_id"], p);
  const pid = api._field(p, "pid", str), on = api._field(p, "on", bool, true);
  let offers;
  try {
    offers = offseason.portal_offer(st, pid, on);
  } catch (e) {
    if (is_key_error(e)) throw new api.ApiError(404, "unknown portal player");
    if (e instanceof offseason.OverflowError || e instanceof ValueError) throw new api.ApiError(409, e.message);
    throw e;
  }
  api._save_loaded();
  return { "offers": offers };
}
api.route("POST", "/api/season/{season_id}/offseason/portal", offseason_portal);


function offseason_redshirt(p) {
  // Your call on one player's redshirt (the Departures step).
  const offseason = modules.offseason;
  const st = api._offseason_state(p.path["season_id"], p);
  const pid = api._field(p, "pid", str), on = api._field(p, "on", bool, true);
  try {
    offseason.redshirt(st, pid, on);
  } catch (e) {
    if (e instanceof offseason.RosterError) throw new api.ApiError(e.code, e.message);
    throw e;
  }
  api._save_loaded();
  return offseason.view(st);
}
api.route("POST", "/api/season/{season_id}/offseason/redshirt", offseason_redshirt);


function offseason_position_options(p) {
  // What one of your players would be at every position.
  const offseason = modules.offseason;
  const st = api._offseason_state(p.path["season_id"]);
  const pid = api._need(p, "pid");
  try {
    return { "options": offseason.position_options(st, pid) };
  } catch (e) {
    if (e instanceof offseason.RosterError) throw new api.ApiError(e.code, e.message);
    throw e;
  }
}
api.route("GET", "/api/season/{season_id}/offseason/position_options", offseason_position_options);


function offseason_position(p) {
  // Move one of your players to another position for next season.
  const offseason = modules.offseason;
  const st = api._offseason_state(p.path["season_id"], p);
  const pid = api._field(p, "pid", str), pos = api._field(p, "pos", str);
  try {
    offseason.change_position(st, pid, pos);
  } catch (e) {
    if (e instanceof offseason.RosterError) throw new api.ApiError(e.code, e.message);
    throw e;
  }
  api._save_loaded();
  return offseason.view(st);
}
api.route("POST", "/api/season/{season_id}/offseason/position", offseason_position);


function offseason_retain(p) {
  // Keep them home: one move with a leaver (meet, promise a starting role, NIL from next year's budget, let him go).
  const offseason = modules.offseason;
  const st = api._offseason_state(p.path["season_id"], p);
  const pid = api._field(p, "pid", str), action = api._field(p, "action", str), nil = api._field(p, "nil", int, 0);
  try {
    offseason.retain(st, pid, action, nil);
  } catch (e) {
    if (e instanceof offseason.RetentionError) throw new api.ApiError(e.code, e.message);
    throw e;
  }
  api._save_loaded();
  return offseason.view(st);
}
api.route("POST", "/api/season/{season_id}/offseason/retain", offseason_retain);


function offseason_review(p) {
  // Your meeting with the AD: what you say, then his decision (firing happens only here).
  const offseason = modules.offseason;
  const st = api._offseason_state(p.path["season_id"], p);
  const action = api._field(p, "action", str), staff_id = api._field(p, "staff_id", str, null);
  try {
    offseason.review_decide(st, action, staff_id);
  } catch (e) {
    if (e instanceof offseason.ReviewError) throw new api.ApiError(e.code, e.message);
    throw e;
  }
  api._save_loaded();
  return offseason.view(st);
}
api.route("POST", "/api/season/{season_id}/offseason/review", offseason_review);


function offseason_job(p) {
  // Take a job offer (or, fired, an opening); team null stays put.
  const offseason = modules.offseason;
  const st = api._offseason_state(p.path["season_id"], p);
  const team = api._field(p, "team", str, null);
  let car;
  try {
    car = offseason.choose_job(st, team);
  } catch (e) {
    if (e instanceof ValueError) throw new api.ApiError(409, e.message);
    throw e;
  }
  api._save_loaded();
  return { "choice": car["choice"] };
}
api.route("POST", "/api/season/{season_id}/offseason/job", offseason_job);


function offseason_hire(p) {
  const offseason = modules.offseason;
  const st = api._offseason_state(p.path["season_id"], p);
  const staff_id = api._field(p, "staff_id", str), index = api._field(p, "index", int);
  let staff;
  try {
    staff = offseason.hire(st, staff_id, index);
  } catch (e) {
    if (e instanceof ValueError) throw new api.ApiError(400, e.message);
    throw e;
  }
  api._save_loaded();
  return { "hired": staff["hired"] };
}
api.route("POST", "/api/season/{season_id}/offseason/hire", offseason_hire);


function offseason_conferences(p) {
  // Next season's conferences and their members (the Change Conferences step).
  return modules.offseason.conferences_view(api._offseason_state(p.path["season_id"]));
}
api.route("GET", "/api/season/{season_id}/offseason/conferences", offseason_conferences);


function offseason_conference(p) {
  // Move a program to an existing conference for next season.
  const offseason = modules.offseason;
  const st = api._offseason_state(p.path["season_id"], p);
  const team = api._field(p, "team", str), conf = api._engine_conference(st, api._field(p, "conference", str));
  let out;
  try {
    out = offseason.move_conference(st, team, conf);
  } catch (e) {
    if (e instanceof offseason.ConferenceError) throw new api.ApiError(e.code, e.message);
    throw e;
  }
  api._save_loaded();
  return out;
}
api.route("POST", "/api/season/{season_id}/offseason/conference", offseason_conference);


function offseason_schedule(p) {
  // Next season's schedule for your team and the games you can trade (the Edit Schedule step).
  return modules.offseason.schedule_view(api._offseason_state(p.path["season_id"]));
}
api.route("GET", "/api/season/{season_id}/offseason/schedule", offseason_schedule);


function offseason_schedule_trade(p) {
  const st = api._offseason_state(p.path["season_id"], p);
  let out;
  try {
    const event_id = api._field(p, "event_id", str), slug = api._field(p, "slug", str);
    out = modules.offseason.schedule_trade(st, event_id, slug);
  } catch (e) {
    if (e instanceof modules.season.ScheduleError) throw new api.ApiError(e.code, e.message);
    throw e;
  }
  api._save_loaded();
  return out;
}
api.route("POST", "/api/season/{season_id}/offseason/schedule", offseason_schedule_trade);


function offseason_schedule_move(p) {
  // Move one of next season's games to another week: into your bye, or trading weeks with another of your games.
  const st = api._offseason_state(p.path["season_id"], p);
  let out;
  try {
    const event_id = api._field(p, "event_id", str), week = api._field(p, "week", int);
    out = modules.offseason.schedule_move(st, event_id, week);
  } catch (e) {
    if (e instanceof modules.season.ScheduleError) throw new api.ApiError(e.code, e.message);
    throw e;
  }
  api._save_loaded();
  return out;
}
api.route("POST", "/api/season/{season_id}/offseason/schedule/move", offseason_schedule_move);


function offseason_open_role(p) {
  // Let one of your own coaches go at the Staff step: he joins the market, his job gets candidates.
  const offseason = modules.offseason;
  const st = api._offseason_state(p.path["season_id"], p);
  const staff_id = api._field(p, "staff_id", str);
  try {
    offseason.open_role(st, staff_id);
  } catch (e) {
    if (e instanceof ValueError) throw new api.ApiError(409, e.message);
    throw e;
  }
  api._save_loaded();
  return offseason.view(st);
}
api.route("POST", "/api/season/{season_id}/offseason/open_role", offseason_open_role);


// ----- roster and stats: god-mode edits, preview, depth charts, injuries, awards, players, leaders -----

function season_player_edit(p) {
  // God mode: change a player's ratings, class, size, jersey or development trait. The
  // edit is saved with the season and used by every game from the next sim on.
  const season = modules.season;
  const state = api._season_state(p.path["season_id"]);
  const team = api._field(p, "team", str), player = api._field(p, "player", str), changes = api._field(p, "changes", dict);
  if (!truthy(season.settings(state)["god_mode"])) throw new api.ApiError(403, "turn on god mode in Settings to edit players");
  api._check_team(team);
  api._check_not_running();
  let edits;
  try {
    edits = season.edit_player(state, team, player, changes);
  } catch (exc) {
    if (exc instanceof ValueError) throw new api.ApiError(400, exc.message);
    throw exc;
  }
  api._save_loaded();
  return { "edits": edits, "player": season.player_profile(state, team, undefined, undefined, player) };
}
api.route("POST", "/api/season/{season_id}/player/edit", season_player_edit);


function season_player_face(p) {
  // Edit Player Look: give any player a face for this season ({team, player, face}), or `face` null to go
  // back to the one drawn from his id. A look only: games never read it.
  const season = modules.season;
  const state = api._season_state(p.path["season_id"]);
  const team = api._field(p, "team", str), player = api._field(p, "player", str);
  const face = api._field(p, "face", dict, null);
  api._check_team(team);
  api._check_not_running();
  let out;
  try {
    out = season.set_player_face(state, team, player, face);
  } catch (exc) {
    if (exc instanceof ValueError) throw new api.ApiError(400, exc.message);
    throw exc;
  }
  api._save_loaded();
  return { "team": team, "player": player, "face": out };
}
api.route("POST", "/api/season/{season_id}/player/face", season_player_face);


function season_preview(p) {
  // This week for a team (default: yours): the next game, a prediction from simulating
  // it, and the injury report.
  const state = api._season_state(p.path["season_id"]);
  const slug = p.q("team") || state["team"];
  api._check_team(slug);
  return modules.season.game_preview(state, slug);
}
api.route("GET", "/api/season/{season_id}/preview", season_preview);


function season_rivalries(p) {
  // A team's rivalries (default: yours): trophy, series today and this season's meeting.
  const state = api._season_state(p.path["season_id"]);
  return modules.season.rivalries_view(state, p.q("team") || state["team"]);
}
api.route("GET", "/api/season/{season_id}/rivalries", season_rivalries);


function season_team_stats(p) {
  return modules.season.team_stats_view(api._season_state(p.path["season_id"]));
}
api.route("GET", "/api/season/{season_id}/stats/teams", season_team_stats);


function season_depth_chart(p) {
  // One team's depth chart with each player's season headline.
  const state = api._season_state(p.path["season_id"]);
  api._check_team(p.path["slug"]);
  return modules.season.depth_chart_view(state, p.path["slug"]);
}
api.route("GET", "/api/season/{season_id}/depth/{slug}", season_depth_chart);


function season_playlink(p) {
  // One team in a Pocket Franchise roster link's shape (docs/PLAY_ON_THE_FIELD.md): its depth chart and every
  // player's current skills, for Play It on the Field. A read only.
  const season = modules.season;
  const state = api._season_state(p.path["season_id"]);
  if (!has(season.load_teams(), p.path["slug"])) throw new api.ApiError(404, "unknown team");   // (an FCS stand-in is fine here: it has a roster to play against)
  return season.playlink_team(state, p.path["slug"]);
}
api.route("GET", "/api/season/{season_id}/playlink/{slug}", season_playlink);


function season_depth_formations(p) {
  // The formations a team uses most, filled from its depth chart as the next game fills them.
  const state = api._season_state(p.path["season_id"]);
  api._check_team(p.path["slug"]);
  return modules.season.formations_view(state, p.path["slug"]);
}
api.route("GET", "/api/season/{season_id}/depth/{slug}/formations", season_depth_formations);


function season_depth_roster(p) {
  // Every player on the roster as a depth-chart card: injuries and redshirts included; with the team
  // line as this season sees it (name, conference, head coach, ratings) for the Stats tab's roster.
  const season = modules.season;
  const state = api._season_state(p.path["season_id"]);
  api._check_team(p.path["slug"]);
  const out = season.depth_roster_view(state, p.path["slug"]);
  const t = season.team_data(state, p.path["slug"]);
  const hc = get(get(get(t, "coaches") || {}, "head_coach") || {}, "name");
  const ratings = season._unit_overalls(state, p.path["slug"]);
  return { ...out, "name": t["name"], "conference": get(t, "conference"), "head_coach": hc, "ratings": truthy(ratings) ? ratings : {} };
}
api.route("GET", "/api/season/{season_id}/depth/{slug}/roster", season_depth_roster);


function season_depth_position(p) {
  // Every player on the roster rated at one depth-chart role.
  const season = modules.season;
  const state = api._season_state(p.path["season_id"]);
  const slug = p.path["slug"], role = p.path["role"];
  api._check_team(slug);
  if (!has(season.ROLE_POSITION, role) && !["KR", "PR"].includes(role)) throw new api.ApiError(404, "unknown role");
  return season.position_candidates(state, slug, role);
}
api.route("GET", "/api/season/{season_id}/depth/{slug}/position/{role}", season_depth_position);


function season_depth_change(p) {
  // Move a player on a team's depth chart (or reset the team). The change is saved with
  // the season and used by every game from then on.
  const season = modules.season;
  const state = api._season_state(p.path["season_id"]);
  const slug = p.path["slug"];
  const role = api._field(p, "role", str, null), player = api._field(p, "player", str, null);
  const move = api._field(p, "move", str, "up"), reset = api._field(p, "reset", bool, false);
  const order = api._field(p, "order", list, null);
  api._check_team(slug);
  if (slug !== state["team"] && !truthy(season.settings(state)["god_mode"])) {
    throw new api.ApiError(403, "turn on god mode in Settings to edit another team's depth chart");
  }
  api._check_not_running();
  if (reset) {
    season.reset_depth(state, slug);
  } else if (order !== null) {
    if (!truthy(role)) throw new api.ApiError(400, "role is required");
    try {
      season.set_depth_order(state, slug, role, order);
    } catch (exc) {
      if (exc instanceof ValueError) throw new api.ApiError(400, exc.message);
      throw exc;
    }
  } else {
    if (!truthy(role) || !truthy(player)) throw new api.ApiError(400, "role and player are required");
    try {
      season.move_depth(state, slug, role, player, move);
    } catch (exc) {
      if (exc instanceof ValueError) throw new api.ApiError(400, exc.message);
      throw exc;
    }
  }
  api._save_loaded();
  return season.depth_chart_view(state, slug);
}
api.route("POST", "/api/season/{season_id}/depth/{slug}", season_depth_change);


function season_injuries(p) {
  // The injury list: one team or the whole league, with weeks left and the return week.
  const state = api._season_state(p.path["season_id"]);
  return { "injuries": modules.season.injury_report(state, p.q("team") || null), "week": state["current_week"] };
}
api.route("GET", "/api/season/{season_id}/injuries", season_injuries);


function season_awards(p) {
  // Every award: the live race until they are given, then the results.
  return modules.season.awards_view(api._season_state(p.path["season_id"]));
}
api.route("GET", "/api/season/{season_id}/awards", season_awards);


function season_player(p) {
  // One player's page: bio, ratings, season totals, ranks, game log, honors. With a `slug` the team may be
  // left out (found on any team); in a career's offseason `next` says where he is now (offseason.player_next).
  const season = modules.season;
  const state = api._season_state(p.path["season_id"]);
  const slug = p.q("slug") || null;
  const team = slug ? (p.q("team") || null) : api._need(p, "team");
  if (truthy(team)) api._check_team(team);
  const prof = season.player_profile(state, team, p.q("name") || null, p.q("position") || null, slug);
  if (prof === null) throw new api.ApiError(404, "player not found");
  const offseason = modules.offseason;
  return { ...prof, "next": truthy(get(prof, "slug")) ? offseason.player_next(state, prof["slug"]) : null };
}
api.route("GET", "/api/season/{season_id}/player", season_player);


function season_player_leaders(p) {
  const state = api._season_state(p.path["season_id"]);
  const team = p.q("team");
  if (truthy(team)) api._check_team(team);
  return modules.season.player_leaders_view(state, team || null, Math.max(1, Math.min(p.q("n", int, 5), 25)),
    api._engine_conference(state, p.q("conference") || null));
}
api.route("GET", "/api/season/{season_id}/stats/leaders", season_player_leaders);


function season_player_stats(p) {
  const state = api._season_state(p.path["season_id"]);
  const team = p.q("team");
  if (truthy(team)) api._check_team(team);
  try {
    return modules.season.player_stats_view(state, team || null, p.q("cat", str, "passing"), p.q("limit", int, 100),
      api._engine_conference(state, p.q("conference") || null));
  } catch (exc) {
    if (exc instanceof ValueError) throw new api.ApiError(400, exc.message);
    throw exc;
  }
}
api.route("GET", "/api/season/{season_id}/stats/players", season_player_stats);


Object.assign(api, {
  _champion_name, list_seasons, get_season, season_teams, _delete_season_file, delete_season, delete_all_seasons,
  coach_options, coach_list, coach_get, coach_save, coach_delete,
  _save_loaded, _check_team, _need, _career_state, _recruiting_call, _offseason_state,
  season_week, season_team_schedule, schedule_edit_view, schedule_edit_swap, season_redshirt, season_position_options,
  season_position, season_standings, season_review, season_resume, season_game, season_settings, season_settings_change,
  recruiting_view, scouting_view, programs_view, office_view, headquarters_view, headquarters_plan, headquarters_save,
  recruiting_reports, prospect_search, national_classes, prospect_profile, recruit_action, recruit_plan, favorite_change,
  board_change, staff_change,
  offseason_view, offseason_advance, offseason_portal, offseason_redshirt, offseason_position_options, offseason_position,
  offseason_retain, offseason_review, offseason_job, offseason_hire, offseason_conferences, offseason_conference,
  offseason_schedule, offseason_schedule_trade, offseason_schedule_move, offseason_open_role,
  season_player_edit, season_player_face, season_preview, season_rivalries, season_team_stats, season_depth_chart,
  season_playlink, season_depth_formations, season_depth_roster, season_depth_position, season_depth_change,
  season_injuries, season_awards, season_player, season_player_leaders, season_player_stats,
});
