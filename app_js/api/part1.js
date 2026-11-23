// The API, part 1: errors and params, routing, conference names, the season
// in memory with its job (plan, progress, step), the teams, the league file's pages, a career's start, export and
// import, and the status, news, pause, advance and game day routes.
//
// Every name of the API is reached through the `api` namespace, whichever part defines it (engine_js/PORTING.md,
// "Big Files in Parts").
//
// Notes:
//  - A handler is registered with `api.route(method, pattern, handler)` right after it; the table keeps that order.
//  - A handler's bytes (a save file, an uploaded league) are a Uint8Array.
import { round, sum, cmp, sorted, get, truthy, is_odict, odict, int as _pyrt_int } from "../../engine_js/pyrt.js";
import { read_text, write_text, exists } from "../../engine_js/files.js";
import { modules } from "../../engine_js/modules.js";
import { shown } from "../../teamdata_js/shown.js";
import { career } from "../../career_js/career.js";
import { carousel } from "../../career_js/carousel.js";
import { league } from "../../career_js/league.js";
import { league_file } from "../../career_js/league_file.js";
import { league_fill } from "../../career_js/league_fill.js";
import { prospects } from "../../career_js/prospects.js";
import { office } from "../../career_js/office.js";
import { programs } from "../../career_js/programs.js";
import { recruits } from "../../career_js/recruits.js";
import { coaches } from "../../sim_js/coaches.js";
import { news } from "../../sim_js/news.js";
import { polls } from "../../sim_js/polls.js";
import { api } from "../api_ns.js";

// ----- small helpers (local to this part) --------------------------------------------------------------------

const has = (d, k) => Object.prototype.hasOwnProperty.call(d, k);
const is_dict = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && !ArrayBuffer.isView(v) && !(v instanceof ArrayBuffer);
const is_bytes = (v) => v instanceof Uint8Array;

/** str.casefold() for the names sorted here: lower case, with the few letters whose fold is not their lower case. */
const casefold = (s) => s.toLowerCase().replace(/ß/g, "ss").replace(/ς/g, "σ").replace(/ſ/g, "s");

/** s.strip("/") */
const strip_slashes = (s) => s.replace(/^\/+|\/+$/g, "");

/** xs.index(x): a ValueError when it is not there. */
function index_of(xs, x) {
  const i = xs.indexOf(x);
  if (i === -1) throw new coaches.ValueError(`${JSON.stringify(x)} is not in list`);
  return i;
}

/** int(text) for a query value: white space around, a sign, digits (an underscore between two digits is allowed). */
function py_int(text) {
  if (typeof text === "number") return Math.trunc(text);
  const s = String(text).trim();
  if (!/^[+-]?[0-9]+(_[0-9]+)*$/.test(s)) throw new coaches.ValueError(`invalid literal for int() with base 10: '${text}'`);
  return Number(s.replace(/_/g, ""));
}

/**
 * urllib.parse.unquote(text): every %XX as its byte, the runs of bytes read as UTF-8 (a bad one is U+FFFD, as
 * Python's errors="replace"); a % that is not followed by two hex digits stays.
 */
function unquote(text) {
  if (!text.includes("%")) return text;
  const decoder = new TextDecoder("utf-8");
  return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    const bytes = new Uint8Array(run.length / 3);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(run.substr(i * 3 + 1, 2), 16);
    return decoder.decode(bytes);
  });
}

/** urllib.parse.urlsplit(path) for what the page sends (a path, maybe a query, maybe a fragment): [path, query]. */
function split_url(url) {
  const hash = url.indexOf("#");
  if (hash !== -1) url = url.slice(0, hash);
  const q = url.indexOf("?");
  return q === -1 ? [url, ""] : [url.slice(0, q), url.slice(q + 1)];
}

/** dict(urllib.parse.parse_qsl(query, keep_blank_values=True)): the last of a repeated name wins. */
function parse_query(query) {
  const out = {};
  if (!query) return out;
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const name = eq === -1 ? pair : pair.slice(0, eq), value = eq === -1 ? "" : pair.slice(eq + 1);
    out[unquote(name.replace(/\+/g, " "))] = unquote(value.replace(/\+/g, " "));
  }
  return out;
}

/** re.escape for a pattern with the `u` flag: only the characters that mean something are escaped. */
const re_escape = (s) => s.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

/** A float as Python writes it in the "not JSON compliant" message. */
const py_special = (v) => (Number.isNaN(v) ? "nan" : v > 0 ? "inf" : "-inf");

/** The first NaN or infinity in a reply (json.dumps(allow_nan=False) refuses it), or undefined. */
function non_finite(x) {
  if (typeof x === "number") return Number.isFinite(x) ? undefined : x;
  if (x === null || typeof x !== "object" || ArrayBuffer.isView(x)) return undefined;
  if (Array.isArray(x)) {
    for (let i = 0; i < x.length; i++) {
      const bad = non_finite(x[i]);
      if (bad !== undefined) return bad;
    }
    return undefined;
  }
  for (const v of Object.values(x)) {
    const bad = non_finite(v);
    if (bad !== undefined) return bad;
  }
  return undefined;
}

/**
 * The type a caller names (Params.q's `cast`, _field's `kind`) as its name ("str", "int", "bool", "list", "dict"). A caller may pass
 * `api.str`, `api.int`, `api.bool`, `api.list`, `api.dict` (below), the name itself ("str", "int", ...), JavaScript's
 * own (String, Number, Boolean, Array, Object), pyrt's `int`, or a function such as `api.boolean`; Number counts as
 * int (no caller asks for a float).
 */
function type_name(kind) {
  if (typeof kind === "string") return kind;
  if (kind === String) return "str";
  if (kind === Number || kind === _pyrt_int || kind === parseInt || kind === py_int) return "int";
  if (kind === Boolean) return "bool";
  if (kind === Array) return "list";
  if (kind === Object) return "dict";
  if (kind && typeof kind.__name__ === "string") return kind.__name__;
  return kind && kind.name ? kind.name : String(kind);
}

/** isinstance(value, kind) for the kinds a JSON body can hold (`kind` as type_name gives it). */
function is_kind(value, name) {
  if (name === "str") return typeof value === "string";
  if (name === "int") return typeof value === "number" && Number.isInteger(value);     // (a JSON 3.0 is 3 here: it passes; Python refuses it)
  if (name === "float") return typeof value === "number";
  if (name === "bool") return typeof value === "boolean";
  if (name === "list") return Array.isArray(value);
  if (name === "dict") return is_dict(value);
  return false;
}

// The types, as a caller names them for Params.q's `cast` and _field's `kind` (part 2 reads these at load)
api.str = { __name__: "str" };
api.int = { __name__: "int" };
api.float = { __name__: "float" };
api.bool = { __name__: "bool" };
api.list = { __name__: "list" };
api.dict = { __name__: "dict" };

api.MAX_SAVE_BYTES = 40 * 1024 * 1024;    // an uploaded career (gzip); a career with its recruiting class is about 5 MB compressed


// ----- errors and params -----------------------------------------------------

class ApiError extends Error {
  // A refused call: `status` is the HTTP code a server would answer with.
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.message = message;
  }
}


class Params {
  // What a handler gets: the `{name}` parts of the path, the query string and the body
  // (a JSON object as a dict, raw bytes for an upload, or null).
  constructor(path = {}, query = {}, body = null) {
    this.path = path;
    this.query = query;
    this.body = body === undefined ? null : body;
  }

  q(name, cast = String, default_ = null) {
    // The query value `name` passed through `cast`, or `default` when it is not given.
    if (!has(this.query, name)) return default_;
    const kind = type_name(cast);
    try {
      if (kind === "str") return this.query[name];
      if (kind === "int") return py_int(this.query[name]);
      return cast(this.query[name]);
    } catch (e) {
      if (e instanceof coaches.ValueError || e instanceof TypeError) throw new ApiError(422, `${name} must be a ${kind}`);
      throw e;
    }
  }
}


function boolean(text) {
  // A query flag: true/false (also 1/0, yes/no).
  const v = text.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  throw new coaches.ValueError(text);
}


api._MISSING = Symbol("missing");


function _field(p, name, kind, default_ = api._MISSING) {
  // A field of the JSON body. Without a default it is required: missing or of the wrong
  // type is a 422 "<name> is required". With one, a missing or null field gives the default and a
  // wrongly typed one is a 422.
  const body = is_dict(p.body) ? p.body : {};
  const value = has(body, name) ? body[name] : null;
  const kind_name = type_name(kind);
  if (value === null || value === undefined) {
    if (default_ === api._MISSING) throw new ApiError(422, `${name} is required`);
    return default_;
  }
  if (!is_kind(value, kind_name)) {                    // (Python's bool is an int: `kind is int` refuses it; a boolean is no number here)
    if (default_ === api._MISSING) throw new ApiError(422, `${name} is required`);
    throw new ApiError(422, `${name} must be a ${kind_name}`);
  }
  return value;
}


// ----- routing -----------------------------------------------------------------

api.ROUTES = [];        // [method, pattern, handler], in the order they were registered


function route(method, pattern, fn) {
  // Register `fn` as the handler for `method` on `pattern` (`{name}` matches one path segment).
  // (`api.route("GET", "/api/teams", list_teams)` after the handler; given no handler it returns the function that
  // takes one.)
  const add = (handler) => {
    api.ROUTES.push([method.toUpperCase(), pattern, handler]);
    return handler;
  };
  return fn === undefined ? add : add(fn);
}
api.route = route;       // the handlers below register as they are defined


function routes() {
  // Every registered [method, pattern] (an array, each pair once, in the table's order).
  const seen = new Set(), out = [];
  for (const [m, pattern] of api.ROUTES) {
    const key = `${m} ${pattern}`;
    if (!seen.has(key)) { seen.add(key); out.push([m, pattern]); }
  }
  return out;
}


function _match(pattern, parts) {
  // The path's `{name}` values if `parts` fits `pattern`, else null.
  const want = strip_slashes(pattern).split("/");
  if (want.length !== parts.length) return null;
  const out = {};
  for (let i = 0; i < want.length; i++) {
    const w = want[i], part = parts[i];
    if (w.startsWith("{") && w.endsWith("}")) {
      const value = unquote(part);
      if (value === "" || value === "." || value === ".." || value.includes("/") || value.includes("\\")) return null;   // an id never names a path outside its folder
      out[w.slice(1, -1)] = value;
    } else if (w !== part) {
      return null;
    }
  }
  return out;
}


function call(method, path, body = null) {
  // Answer one API call the way the server did: the handler's dict (or bytes), or ApiError.
  const season = modules.season;
  method = method.toUpperCase();
  const [url_path, url_query] = split_url(path);
  const parts = strip_slashes(url_path).split("/");
  // a light action's save is put off a moment (DEFER_SAVES, _save_loaded): this call may leave it waiting only when it
  // is a read of that same season from memory or another light action on it; anything else writes it out first
  const mine = api._loaded !== null && parts.length >= 3 && parts[0] === "api" && parts[1] === "season" && parts[2] === api._loaded["id"];
  api._light = Boolean(mine && method !== "GET" && api.LIGHT_PATH.test(url_path));
  if (api._dirty && !(mine && (api._light || (method === "GET" && parts[parts.length - 1] !== "export")))) {
    api.flush();
  }
  const query = parse_query(url_query);
  let known_path = false;
  for (const [m, pattern, fn] of api.ROUTES) {
    const values = api._match(pattern, parts);
    if (values === null) continue;
    known_path = true;
    if (m === method) {
      let out;
      try {
        out = fn(new api.Params(values, query, body));
      } catch (e) {
        if (e instanceof season.StandInError) throw new api.ApiError(404, e.message);     // a team page asked for an FCS stand-in: it has none
        if (e instanceof api.ApiError) throw e;
        // an action that broke partway (a bug) must leave no half-done change behind: a change is saved only
        // when its handler returns, so the season in memory is dropped and the next call reads the saved file
        // (the player's report: a visit that crashed still counted as this month's visit)
        const sid = get(values, "season_id");
        if (method !== "GET" && sid && api._loaded !== null && api._loaded["id"] === sid && get(api._job, "status") !== "running") {
          api._drop(sid);
        }
        throw e;
      }

      if (has(values, "season_id") && api._loaded !== null && is_dict(out)) {
        out = api._show_conferences(out, api._conference_names(api._loaded));
      }
      return out;
    }
  }
  if (known_path) throw new api.ApiError(405, "method not allowed");
  throw new api.ApiError(404, "not found");
}


// ----- conference names -------------------------------------------------------
// The engine (schedules, standings, polls, bowls, the AD's goals) keeps a built-in conference's built-in name
// even when a career's league file renames it; the page shows the file's name (lgd["conference_names"]).
// Every season route's answer passes through _show_conferences, and a conference the page sends back comes in
// through _engine_conference.

function _conference_names(state) {
  // {engine name: display name} for the conferences a career's league renamed (none for the built-in league).
  const names = get(get(state, "league") || {}, "conference_names") || {};
  const out = {};
  for (const [k, v] of Object.entries(names)) if (k !== v) out[k] = v;
  return out;
}


const _pattern_cache = new Map();      // functools.lru_cache(maxsize=8)

function _conference_pattern(engine_names) {
  // One whole-word pattern for a career's renamed conferences, longest name first, compiled once per set.
  // (Python's \w is every letter and digit of any alphabet and "_": \p{L}\p{N}_ here. The pattern is global, for
  // String.replace; its lastIndex is never relied on.)
  const key = engine_names.join("\u0000");
  let pattern = _pattern_cache.get(key);
  if (pattern !== undefined) {
    _pattern_cache.delete(key);          // the most lately used goes last
    _pattern_cache.set(key, pattern);
    return pattern;
  }
  const longest_first = sorted(engine_names, (k) => Array.from(k).length, true);
  pattern = new RegExp(`(?<![\\p{L}\\p{N}_-])(${longest_first.map(re_escape).join("|")})(?![\\p{L}\\p{N}_-])`, "gu");
  _pattern_cache.set(key, pattern);
  if (_pattern_cache.size > 8) _pattern_cache.delete(_pattern_cache.keys().next().value);
  return pattern;
}


function _show_conferences(out, names) {
  // `out` with every renamed conference shown by its display name. The whole-word rewrite reaches every string
  // in the answer: dict keys, values, and free text (news, scene lines, reasons), so a team or player name that
  // holds a renamed conference's built-in name as a whole word is rewritten too. The built-in league (no renames)
  // passes through untouched. league_file.validate keeps every display name its conference's own, so no two keys
  // can meet.
  if (!Object.keys(names).length) return out;
  const pattern = api._conference_pattern(Object.keys(names).sort((a, b) => cmp(a, b)));

  const show = (x) => {
    if (typeof x === "string") return x.replace(pattern, (m, name) => names[name]);
    if (Array.isArray(x)) return x.map(show);       // (any array, a pair included)
    if (is_dict(x)) {
      const d = is_odict(x) ? odict() : {};          // a dict walked in its own order keeps it
      for (const [k, v] of Object.entries(x)) d[show(k)] = show(v);
      return d;
    }
    return x;
  };
  return show(out);
}


function _engine_conference(state, name) {
  // A conference name the page sent (its display name) as the engine knows it.
  if (!name) return name;
  for (const [k, v] of Object.entries(api._conference_names(state))) if (v === name) return k;   // (display names are each one conference's own)
  return name;
}


function call_js(method, path, body_json, body_bytes = null) {
  // The browser worker's entry point (web/worker.js): `call()` with the body as the page sent
  // it, a JSON string or a `Uint8Array` (which wins when both are given), and
  // the answer as JSON for the worker to parse: `{"ok": true, "result", "changed"}`, an ApiError
  // as `{"ok": false, "status", "message", "changed"}` (another exception: status 500); a bytes
  // result (a save file) comes back as the bytes themselves.
  let out;
  try {
    let body;
    if (body_bytes !== null && body_bytes !== undefined) {
      body = body_bytes instanceof Uint8Array ? body_bytes
        : ArrayBuffer.isView(body_bytes) ? new Uint8Array(body_bytes.buffer, body_bytes.byteOffset, body_bytes.byteLength)
          : new Uint8Array(body_bytes);
    } else if (body_json !== null && body_json !== undefined) {
      try {
        body = JSON.parse(body_json);
      } catch (exc) {
        throw new api.ApiError(400, "invalid JSON");
      }
    } else {
      body = null;
    }
    out = api.call(method, path, body);
  } catch (exc) {
    if (exc instanceof api.ApiError) {
      return JSON.stringify({ ok: false, status: exc.status, message: exc.message, changed: api.changed() });
    }
    // the page shows the error; the worker stays up
    return JSON.stringify({ ok: false, status: 500, message: String(exc && exc.message !== undefined ? exc.message : exc), changed: api.changed() });
  }
  if (is_bytes(out)) return out;
  const did_change = api.changed();
  const bad = non_finite(out);     // a NaN or infinity in the result: JSON.parse would reject the whole reply (here JSON.stringify would write null)
  if (bad !== undefined) {
    return JSON.stringify({ ok: false, status: 500,
      message: `the reply is not valid JSON: Out of range float values are not JSON compliant: ${py_special(bad)}`, changed: did_change });
  }
  return JSON.stringify({ ok: true, result: out, changed: did_change });
}


// ----- season state ------------------------------------------------------------

api._loaded = null;          // the one season in memory
api._job = {};               // its job record (an advance or game day in progress, or idle)
api._changed = false;        // a season or coach file was written or deleted since changed() was last read
api._cards = {};             // season id -> [file mtime, card] for the seasons list
api._teams = {};             // the 2026 teams (data/engine_teams.json), read on first use
api._pending_league = null;  // the league file last checked (/api/league/check), until a career starts from it


// A light action (a quick action ticked, a recruit put on the board, a favorite, a depth chart move) used to wait on the
// whole season being written out, most of a second for a 20 MB save, and every read behind it waited too. With
// DEFER_SAVES on (the dev server sets it and calls flush() a moment after the last such action), its change stays in
// memory and the file is written once the clicking stops; any other action, a sim, another season or the server
// closing writes it first. Off (the tests, and the game in the browser, whose store is written a call at a time),
// every action saves before it answers, as before.
api.DEFER_SAVES = false;
api.LIGHT_PATH = /\/(recruit(\/plan)?|favorite|board|depth\/[^/]+)$/;   // *tune* the actions whose save may wait
api._light = false;                      // this call is one of them
api._dirty = false;                      // the season in memory holds a change its file does not


function dirty() {
  // A light action's change is waiting to be written (flush() writes it).
  return api._dirty;
}


function flush() {
  // Write the season in memory to its file if a light action left it waiting.
  if (api._dirty && api._loaded !== null) {
    api._dirty = false;
    modules.season.save_season(api._loaded);
    delete api._cards[api._loaded["id"]];
    api._mark_changed();
  }
  api._dirty = false;
}


function changed() {
  // True once after a call that saved or deleted a season or coach file; reading clears it.
  const out = api._changed;
  api._changed = false;
  return out;
}


function _mark_changed() {
  api._changed = true;
}


function loaded_state() {
  // The season in memory, or null.
  return api._loaded;
}


function job() {
  // The job record of the season in memory (empty when none is loaded).
  return api._job;
}


function _idle_job(state) {
  // A season's job record when nothing is simulating.
  const week = state["current_week"];
  return { id: state["id"], status: "idle", done: week, total: week, stage: null, week: null,
    games_done: null, games_total: null, week_frac: null, progress: null, paused: false, gameday_event: null,
    error: null, stop: false, target: null, kind: null };
}


function _activate(state) {
  // Put the season's league in play (a career's later seasons, or one from a league file, have their own, league.js).
  modules.season.activate(state);
}


function _hold(state) {
  // Make `state` the season in memory, with an idle job, and put its league in play. Every
  // handler saves what it changes before returning, so the season it replaces has nothing
  // left to write.
  api._loaded = state;
  api._job = api._idle_job(state);
  api._activate(state);
}


function _drop(season_id) {
  // Forget the season in memory if it is `season_id` (its file was deleted).
  if (api._loaded !== null && api._loaded["id"] === season_id) {
    api._loaded = null;
    api._job = {};
  }
}


function running() {
  // True while an advance or game day is in progress: the caller then calls step().
  return get(api._job, "status") === "running";
}


function _check_not_running() {
  // 409 while the season in memory is simulating: nothing may change or replace it then.
  if (api.running()) throw new api.ApiError(409, "wait for the sim to finish");
}


function _season_state(season_id) {
  // The season, from memory or its file (which then replaces the one in memory; refused
  // while the one in memory is simulating).
  if (api._loaded !== null && api._loaded["id"] === season_id) {
    api._activate(api._loaded);
    return api._loaded;
  }
  api._check_not_running();
  const state = modules.season.load_season(season_id);
  if (state === null || state === undefined) throw new api.ApiError(404, "season not found");
  api._hold(state);
  return state;
}


function _plan(state, first, last, only_mine = false) {
  // Set the job's work plan: weeks `first`..`last`, each by part, estimated up front from the
  // schedule (season.week_work). `progress` is then the work done over the plan's total.
  const season = modules.season;
  const plan = {};                           // (keyed by week: whole numbers added in rising order, the order an object lists them in)
  for (let w = first; w <= last; w++) plan[w] = season.week_work(state, w, only_mine);
  api._job["_plan"] = plan;
  api._job["_before"] = 0.0;                     // the work of the weeks already finished
  api._job["_part"] = 0;                         // the part of the week reached (an index into PROGRESS_PARTS)
  api._job["progress"] = 0.0;
  api._job["week_frac"] = null;
}


function _replan_week(state, week, games_total = null) {
  // The week about to run, planned again from the schedule as it stands now (its postseason
  // games are set by then), and its games from the sim's own count once it reports one.
  const season = modules.season;
  const plan = get(api._job, "_plan");
  if (!truthy(plan) || !has(plan, week)) return;
  if (games_total === null || games_total === undefined) {
    if (get(api._job, "kind") !== "gameday") plan[week] = season.week_work(state, week);
  } else {
    plan[week]["games"] = games_total * season.PROGRESS_GAME;
  }
}


function _set_progress(week, done_in_week) {
  // Write `progress` (the job's work done over its total) and `week_frac` (the week's share
  // done), each clamped so it never goes back within a job or a week, and short of 1 until the
  // job is over.
  const plan = get(api._job, "_plan") || {};
  const week_total = sum(Object.values(get(plan, week) || {})) || 1.0;
  const total = sum(Object.values(plan).map((p) => sum(Object.values(p)))) || 1.0;
  const frac = Math.min(1.0, done_in_week / week_total);
  api._job["week_frac"] = Math.max(get(api._job, "week_frac") || 0.0, frac);
  const prog = Math.min(0.995, (get(api._job, "_before", 0.0) + done_in_week) / total);
  api._job["progress"] = round(Math.max(get(api._job, "progress") || 0.0, prog), 4);
}


function _reporter(state, report) {
  // The callback a sim calls with its stage and game count: the stage, the games and the
  // progress (work done, by the job's plan) are written onto the job for the status, then, when
  // `report` is given, the status passed on as JSON (in-week progress).
  const on_progress = (stage, games_done, games_total) => {
    const season = modules.season;
    const _job = api._job;
    if (games_total === undefined) games_total = null;
    if (games_done === undefined) games_done = null;
    _job["stage"] = stage;
    const week = _job["done"] + 1;                    // the week being simmed (`done` moves once all of it is over)
    if (get(_job, "week") !== week) {
      _job["week"] = week; _job["_part"] = 0; _job["week_frac"] = 0.0;
    }
    const part = season.progress_part(stage, games_total);
    let idx = index_of(season.PROGRESS_PARTS, part);
    if (part === "setup" && get(_job, "_part", 0) >= index_of(season.PROGRESS_PARTS, "games")) {
      idx = index_of(season.PROGRESS_PARTS, "ahead");     // next week's games set after this week's
    }
    idx = Math.max(idx, get(_job, "_part", 0));               // a week's parts run in order
    _job["_part"] = idx;
    if (games_total !== null) {
      _job["games_done"] = games_done; _job["games_total"] = games_total;
      if (games_done === 0) api._replan_week(state, week, games_total);
    } else {
      _job["games_done"] = _job["games_total"] = null;
    }
    const parts = get(get(_job, "_plan") || {}, week) || {};
    let done = sum(season.PROGRESS_PARTS.slice(0, idx).map((p) => get(parts, p, 0.0)));
    if (season.PROGRESS_PARTS[idx] === "games" && games_total) {
      done += get(parts, "games", 0.0) * games_done / games_total;
    }
    api._set_progress(week, done);
    if (report !== null && report !== undefined) report(JSON.stringify(api._status(state, get(_job, "since"))));
  };
  return on_progress;
}


function _finish_week(week) {
  // The week is over: its work counts as done.
  const work = sum(Object.values(get(get(api._job, "_plan") || {}, week) || {}));
  api._set_progress(week, work);
  api._job["_before"] = get(api._job, "_before", 0.0) + work;
}


function _status(state, since) {
  // Job progress plus your record and rank, and your results after week `since` when given.
  const season = modules.season;
  const out = {};
  for (const k of ["id", "status", "done", "total", "error", "stage", "week", "games_done",
    "games_total", "week_frac", "progress", "paused", "gameday_event"]) out[k] = get(api._job, k);
  out["current_week"] = state["current_week"];
  const rec = season._records(state, undefined, true)[state["team"]];
  out["record"] = { wins: rec["wins"], losses: rec["losses"], conf_wins: rec["conf_wins"], conf_losses: rec["conf_losses"] };
  out["my_rank"] = season.current_rank(state);      // the header's rank follows the sim week by week
  if (since !== null && since !== undefined) out["results"] = season.my_results(state, since);
  if (truthy(get(api._job, "feed"))) out["feed"] = api._job["feed"];
  return out;
}


function _feed(state) {
  // What the page shows as a sim passes a week, sent with the sim's own progress (the player's ask: news and notices
  // follow a long sim): your Program News, who on your board is committed or signed where, and your injury report. On
  // the published site a read of these waits behind the sim itself, so they ran a week or two late, or not at all.
  // Never fails a sim: null when it cannot be built.
  try {
    const season = modules.season;
    const rc = get(state, "recruiting") || {};
    if (!truthy(get(state, "career")) || !truthy(rc)) return null;
    const teams = season.load_teams();
    const board = [];
    for (const pid of get(rc, "board") || []) {
      const p = get(get(rc, "prospects") || {}, pid), st = get(get(rc, "status") || {}, pid) || {};
      if (!truthy(p)) continue;
      const school = get(st, "signed") || get(st, "committed");
      board.push({ id: pid, name: p["name"], display_pos: prospects.display_pos(p["ea_position"]), stars: p["stars"],
        committed: get(st, "committed"), signed: get(st, "signed"),
        school_name: truthy(school) ? office._school_name(school, teams) : null });
    }
    // where you stand in your conference, for the Office's board while a sim runs (null for an independent)
    const me = state["team"];
    const tables = Object.values(season.standings(state));
    let row = null;
    for (const rows of tables) {
      row = rows.find((r) => r["slug"] === me);
      if (row !== undefined) break;
    }
    if (row === undefined) row = null;
    let place = null;
    if (row !== null && truthy(get(row, "conf_rank"))) {
      const conf = tables.find((rows) => rows.includes(row));
      place = { conf_rank: row["conf_rank"], of: conf.filter((r) => get(r, "division") === get(row, "division")).length };
    }
    return { week: state["current_week"], news: office.program_news(state), board,
      injuries: season.injury_report(state, state["team"]), place };
  } catch (e) {           // a view only
    return null;
  }
}


function _where(exc) {
  // The error with where it broke, for the page's toast: the innermost frame of our own code
  // ("x is not a function (nil_move, programs.js:218)"). (It is read from the error's stack: its first line
  // that is a file of ours.)
  const message = String(exc && exc.message !== undefined ? exc.message : exc);
  const lines = String((exc && exc.stack) || "").split("\n").filter((l) => /^\s*at /.test(l) && !l.includes("node_modules") && !l.includes("node:"));
  for (const line of lines) {
    const m = /^\s*at (?:async )?(?:(.+?) \()?(?:.*[/\\])?([^/\\():]+):(\d+):\d+\)?$/.exec(line);
    if (m) return `${message} (${m[1] || "<module>"}, ${m[2]}:${m[3]})`;
  }
  return message;
}


api.NEXT_GAME_STAGE = "Reading the news";
api.WARM_NEWS_WEEKS = 2;    // *tune* how many finished weeks of league news the crawl asks for (ui Ticker NEWS_WEEKS)


function _warm_next_game(state, report) {
  // The run is over: what the page asks for the moment it ends is worked out here, as the run's last stage, so it
  // answers at once: the league's news for the weeks the crawl shows (it reads every box score of a week). In the
  // browser the page's other reads queued behind it for seconds after every week. Reads only: a failure here is the
  // page's to meet when it asks. (Your next game's Win Chance was read here too, twenty sims of the game: the player
  // had it taken out.)
  if (truthy(state["done"])) return;
  api._job["stage"] = api.NEXT_GAME_STAGE; api._job["games_done"] = null; api._job["games_total"] = null;
  if (report !== null && report !== undefined) report(JSON.stringify(api._status(state, get(api._job, "since"))));
  try {
    news.league_news(state, state["current_week"] - api.WARM_NEWS_WEEKS);
  } catch (e) {
    // the page's to meet
  }
  modules.season.forget_fresh_boxes();          // the news has read the week's boxes: they are on disk
}


function step(report = null) {
  // Play the running job's next unit: one week of an advance, or your game on game day.
  // Saves the season, moves the job on (back to idle when the run is over, paused or done)
  // and returns the status with your results since the week the run started from. `report`,
  // when given, gets that status as JSON once before the sim starts (the page sees the run at
  // once), after every progress callback and once at the end. null when nothing is running. A
  // failure sets the job to "error" instead of throwing and reloads the season from its last
  // save, so nothing half-played stays in memory.
  if (api._loaded === null || !api.running()) return null;
  const season = modules.season;
  if (report === undefined) report = null;
  let state = api._loaded;
  const on_progress = api._reporter(state, report);
  const week = state["current_week"] + 1;
  api._replan_week(state, week);
  if (get(api._job, "week") !== week) {
    api._job["week"] = week; api._job["_part"] = 0; api._job["week_frac"] = 0.0;
  }
  if (report !== null) {
    api._job["stage"] = `Getting ${season.week_label(week)} ready`; api._job["games_done"] = null; api._job["games_total"] = null;
    report(JSON.stringify(api._status(state, get(api._job, "since"))));
  }
  try {
    const _job = api._job;
    let over;
    if (_job["kind"] === "gameday") {
      _job["gameday_event"] = season.play_my_game(state, null, on_progress);
      on_progress(season.SAVING_STAGE, null, null);
      season.save_season(state);
      api._mark_changed();
      over = true;
    } else {
      if (!truthy(_job["stop"]) && !truthy(state["done"])) {   // a pause lands between weeks, as advance_to checked it
        // every week after the run's first runs your recruiting week too, as one advance_to call did
        season.advance(state, season.shared_pool(), on_progress, state["current_week"] > _job["since"]);
        _job["feed"] = api._feed(state);              // the week's news goes out with the next progress report
        on_progress(season.SAVING_STAGE, null, null);
        season.save_season(state);
        api._mark_changed();
      }
      api._finish_week(week);
      _job["done"] = state["current_week"];
      over = _job["done"] >= _job["target"] || truthy(state["done"]) || truthy(_job["stop"]);
      if (over) {
        _job["paused"] = truthy(_job["stop"]) && _job["done"] < _job["target"] && !truthy(state["done"]);
      }
    }
    if (over) {
      api._warm_next_game(state, report);
      Object.assign(_job, { status: "idle", stage: null, stop: false, progress: 1.0, week_frac: 1.0 });
    }
  } catch (exc) {  // the page shows the error; the dispatcher stays up
    // the half-played week is dropped: the season in memory is the last save again, so the
    // next handler that saves cannot write it
    const since = get(api._job, "since");
    const saved = season.load_season(state["id"]);
    if (saved !== null && saved !== undefined) {
      api._hold(saved);
      state = api._loaded;
    }
    Object.assign(api._job, { status: "error", error: api._where(exc), stage: null, stop: false, since });
  }
  const out = api._status(state, get(api._job, "since"));
  if (report !== null) report(JSON.stringify(out));
  return out;
}


function _all_teams() {
  // The 2026 teams by slug (every team drop-down and the team pages read these).
  if (!Object.keys(api._teams).length) {
    const season = modules.season;
    api._teams = season.stand_in_names(JSON.parse(read_text(season.TEAMS_FILE))["teams"]);     // (its own copy: the stand-ins are renamed in it)
  }
  return api._teams;
}


function _team(slug) {
  const t = get(api._all_teams(), slug);
  if (t === null) throw new api.ApiError(404, `unknown team ${slug}`);
  return t;
}


// ----- teams -------------------------------------------------------------------

function _card_stars(t) {
  // A team's stars before any career: from its program's rating, or, for a program with no history on file (one a
  // league file made), from the prestige it was given (1 to 6).
  const p = api._programs();
  if (truthy(get(p._history()["teams"], t["slug"]))) return p.stars_of(p.base(t["slug"])["rating"]);
  return Math.max(0.5, Math.min(5, round(Number(get(t, "prestige") || 1) * 5 / 6 * 2) / 2));
}


function _team_card(t) {
  // What the team picker needs.
  const season = modules.season;
  return {
    slug: t["slug"], name: t["name"], school: t["school"], abbreviation: t["abbreviation"],
    mascot: t["mascot"], conference: t["conference"], subdivision: t["subdivision"],
    city: get(t, "city"), state: get(t, "state"),
    // the bracket's conference groups by the engine's names (a league file may rename a conference on the page)
    group: polls.P4.has(t["conference"]) ? "P4" : polls.G6.has(t["conference"]) ? "G6" : "",
    fictional: t["fictional"], colors: t["colors"], stadium: t["stadium"],
    home_field_advantage: t["home_field_advantage"], prestige: t["prestige"],
    stars: _card_stars(t),      // the program's standing, 0.5 to 5 by halves
    ratings: { ...shown.team_ratings(t["team_ratings"]), ...season.page_ratings(t) },   // the page's own: an average of the players' overalls
    head_coach: t["coaches"]["head_coach"]["name"],
    // his age as the career's first season starts (Your Coach opens on it); a copy, so the team is not marked
    head_coach_age: carousel._age({ ...t["coaches"]["head_coach"] }, league.FIRST_YEAR),
    head_coach_hometown: carousel.hometown(t["coaches"]["head_coach"]["name"]),     // "" when we do not know it
    staff: coaches.staff(null, t),
    tendencies: get(t, "tendencies", {}),
  };
}


function list_teams(p) {
  // alphabetical (FBS first, then the FCS stand-ins): every team drop-down follows this order
  const cards = sorted(Object.values(api._all_teams()).map((t) => api._team_card(t)), (c) => [c["fictional"], casefold(c["name"])]);
  return { teams: cards, faces: modules.season.all_preset_faces() };       // the players and coaches with a preset face
}
api.route("GET", "/api/teams", list_teams);


function get_team(p) {
  const season = modules.season;
  const t = api._team(p.path["slug"]);
  const card = api._team_card(t);
  card["coaches"] = t["coaches"];
  card["kick_returner"] = get(t, "kick_returner");
  card["punt_returner"] = get(t, "punt_returner");
  card["players"] = [];
  for (const unit of ["offense", "defense"]) {
    for (const pl of t[unit]) {
      card["players"].push({ name: pl["name"], slug: get(pl, "slug"), position: pl["position"], unit,
        starter: truthy(get(pl, "in_game")), overall: season.page_overall(pl),     // his card's overall, as the page shows a rating
        return_rating: get(pl, "return_rating"), class: get(pl, "class"), height: get(pl, "height"),
        weight: get(pl, "weight"), jersey: get(pl, "jersey"), role: get(pl, "role") });
    }
  }
  return card;
}
api.route("GET", "/api/teams/{slug}", get_team);


// ----- seasons -----------------------------------------------------------------

function _fbs_cards(teams) {
  // The team picker's cards for a league's FBS teams, by name. For an imported league these are its engine
  // teams (league.build, a career league's build: no real 2026 adjustments, as every career plays from its first
  // offseason on), so a team the file leaves alone can read an overall a point or two off its built-in card.
  return sorted(Object.values(teams).filter((t) => !truthy(t["fictional"])).map((t) => api._team_card(t)), (c) => casefold(c["name"]));
}


function _pend(blob, seed) {
  // league_file.check on `blob`; the result replaces the pending league (a file that cannot start a
  // career, or one that collapses to the built-in league, leaves none). The checked league is final:
  // its fill seed is fixed here, and Start plays exactly it.
  api._pending_league = null;                      // the last check's league goes before this one is built
  const r = league_file.check(blob, seed);
  if (truthy(r["ok"]) && !truthy(r["builtin"])) {
    // not its engine teams file: Start builds it again from the league (league.build gives the same bytes),
    // so the pending league holds only the league itself until then
    api._pending_league = { key: league_fill._sha256_hex(blob), seed: r["seed"],
      lgd: r["league"], games: r["games"], real_polls: !truthy(r["structural"]) };
  }
  return r;
}


api._PROGRAMS = {};


function _programs() {
  return programs;
}


function _scheme(t) {
  const sc = get(get(get(t, "coaches") || {}, "head_coach") || {}, "scheme") || {};
  return [get(sc, "offensive_philosophy"), get(sc, "defensive_philosophy")];
}


function league_programs(p) {
  // The game's own programs for the Custom Programs page, names only (slug, names, conference, level), with every
  // conference (id, name, games) and the playbooks the game's teams run. Quick: it never builds the league file. A real
  // team's full details come one at a time (GET /api/league/programs/{slug}) when you edit it.
  if (!has(api._PROGRAMS, "out")) {
    const b = league_file._builtin();
    const teams = [];
    for (const slug of b["slugs"]) {       // (a Set, walked in the order added; the list is sorted below)
      const m = league.base_meta(slug);
      teams.push({ slug, name: get(m, "school_name") || get(m, "short_name") || slug, short_name: get(m, "short_name") || slug,
        abbreviation: get(m, "abbreviation") || "", conference: get(b["team_conf"], slug), level: get(m, "subdivision") || "FBS" });
    }
    teams.sort((x, y) => cmp(casefold(x["short_name"]), casefold(y["short_name"])));
    const engine = modules.season.load_teams();
    const schemes = [];
    for (const s of b["slugs"]) if (has(engine, s)) schemes.push(api._scheme(engine[s]));
    api._PROGRAMS["out"] = {
      teams,
      conferences: sorted(Object.entries(b["conf_names"]), (x) => casefold(x[1]))
        .map(([cid, name]) => ({ id: cid, name, games: get(b["games"], cid, 8), level: "FBS" })),
      playbooks: { offense: [...new Set(schemes.map(([o]) => o).filter((o) => truthy(o)))].sort((x, y) => cmp(x, y)),
        defense: [...new Set(schemes.map(([, d]) => d).filter((d) => truthy(d)))].sort((x, y) => cmp(x, y)) } };
  }
  return api._PROGRAMS["out"];
}
api.route("GET", "/api/league/programs", league_programs);


function league_program(p) {
  // One real team's full details for Edit a Real Program: names, mascot, home (city, state and its campus lat/lon),
  // conference, colors, prestige, rivals and playbooks (no roster).
  const slug = p.path["slug"];
  const b = league_file._builtin();
  if (!b["slugs"].has(slug)) throw new api.ApiError(404, "unknown team");
  const m = league.base_meta(slug);
  const [off, de] = api._scheme(get(modules.season.load_teams(), slug) || {});
  const loc = get(get(modules.recruiting.model()["teams"], slug) || {}, "location") || [null, null];   // its campus, for the map
  return { lat: loc[0], lon: loc[1], slug, name: get(m, "school_name") || get(m, "short_name"), short_name: get(m, "short_name"), abbreviation: get(m, "abbreviation"),
    mascot: get(m, "mascot"), city: get(m, "city"), state: get(m, "state"), conference: get(b["team_conf"], slug),
    level: get(m, "subdivision") || "FBS", colors: get(m, "colors") || {}, prestige: round(api._programs().base(slug)["prestige"], 1),
    rivals: (get(m, "rivals") || []).filter((r) => b["slugs"].has(r)), offense: off, defense: de };
}
api.route("GET", "/api/league/programs/{slug}", league_program);


function league_towns(p) {
  // A state's towns for the Custom Programs campus map: its major cities first (data/major_cities.json, `major`: always
  // drawn and named, the player's ask), then the game's own town list (the recruits' hometowns, the same one Close to
  // Home looks a city up in), biggest first: [{name, lat, lon, weight, major}]. Unknown state: an empty list.
  const code = String(p.path["state"]).toUpperCase();
  if (!has(api._PROGRAMS, "majors")) api._PROGRAMS["majors"] = JSON.parse(read_text("data/major_cities.json"));
  const majors = (get(api._PROGRAMS["majors"], code) || []).map(([n, la, lo]) => ({ name: n, lat: la, lon: lo, weight: null, major: true }));
  const seen = new Set(majors.map((m) => casefold(m["name"])));
  const rows = get(recruits.model()["generation"]["towns"] || {}, code) || [];
  const towns = sorted(rows.filter((r) => typeof r[0] === "string" && !seen.has(casefold(r[0])) && r[2] !== null && r[2] !== undefined)
    .map((r) => ({ name: r[0], weight: r[1], lat: r[2], lon: r[3], major: false })), (t) => -t["weight"]);
  return { state: code, towns: majors.concat(towns) };
}
api.route("GET", "/api/league/towns/{state}", league_towns);


function league_check(p) {
  // A league file (the body is its bytes) checked for New Career: its errors as sentences, or its
  // summary and the teams a career can start with; `key` names it for POST /api/season ("builtin" when
  // it changes nothing). `?seed=` fills it with that seed (otherwise one read from the file). `errors_total`: how
  // many problems the file has in all (the list stops at league_file.MAX_ERRORS and "And N more.").
  const blob = p.body;
  if (!is_bytes(blob)) throw new api.ApiError(422, "body is required");
  api._check_not_running();
  const r = api._pend(blob, p.q("seed", "int", null));
  if (!truthy(r["ok"])) {
    return { ok: false, errors: r["errors"], errors_total: r["errors_total"], summary: null, key: null, teams: [] };
  }
  if (truthy(r["builtin"])) {
    return { ok: true, errors: [], errors_total: 0, summary: r["summary"], key: "builtin", teams: api._fbs_cards(api._all_teams()) };
  }
  const copies = {};
  for (const [s, t] of Object.entries(r["engine"]["teams"])) copies[s] = { ...t };
  const teams = modules.season.stand_in_names(copies);
  const cards = api._show_conferences(api._fbs_cards(teams), api._conference_names({ league: r["league"] }));  // renamed conferences by their new names
  return { ok: true, errors: [], errors_total: 0, summary: r["summary"], key: api._pending_league["key"], teams: cards };
}
api.route("POST", "/api/league/check", league_check);


function _undo_start(cid) {
  // A Start that failed: its league file and save gone, the built-in league back in play (the
  // pending league stays, so Start can be tried again).
  const season = modules.season;
  league.forget(cid);
  if (exists(`${season.SEASONS_DIR}/${cid}.json`) || exists(`${season.SEASONS_DIR}/${cid}`)) {
    api._delete_season_file(cid);
  }
  modules.recruiting.use_league_models({});
  season.use_league(season.TEAMS_FILE);
}


function _start_from_league(key, team, seed, coach) {
  // A new career from the pending league file, saved: its teams file written as the career's 2026
  // league, then the season with the file's league in its state (and its schedule when the file made
  // one). `seed` is the season's own seed; the league is exactly the one checked.
  const season = modules.season;
  const pending = api._pending_league;
  if (pending === null || pending["key"] !== key) {
    throw new api.ApiError(409, "That league file is no longer loaded; import it again.");
  }
  const engine = league.build(pending["lgd"]);      // the checked league's teams file again: the bytes the check built
  const t = get(engine["teams"], team);
  if (t === null) throw new api.ApiError(404, `unknown team ${team}`);
  if (truthy(t["fictional"])) throw new api.ApiError(404, "That team is an FCS stand-in: pick an FBS team.");
  const cid = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const lgd = pending["lgd"];
  let state;
  try {
    const out = league.path(cid, league.FIRST_YEAR);
    write_text(out, JSON.stringify(engine));
    season.use_league(out);
    modules.recruiting.use_league_models(get(lgd, "recruiting_models") || {});
    // new_season(team, "full", seed, coach=coach, career=True, schedule=pending["games"], league=lgd, career_id=cid, real_polls=...)
    state = season.new_season(team, "full", seed, undefined, coach, true, undefined, pending["games"],
      lgd, cid, pending["real_polls"]);
    season.save_season(state);
  } catch (e) {
    api._undo_start(cid);
    throw e;
  }
  api._pending_league = null;
  return state;
}


function create_season(p) {
  // A new Coach Career (the only mode; a `career` field in the body is ignored). `league`: the key
  // /api/league/check gave for a league file ("builtin" or absent: the game's own league).
  const season = modules.season;
  const team = api._field(p, "team", "str");
  const mode = api._field(p, "mode", "str", "full");
  const seed = api._field(p, "seed", "int", null);
  const coach_id = api._field(p, "coach", "str", null);
  const key = api._field(p, "league", "str", "builtin");
  if (key === "builtin" && truthy(api._team(team)["fictional"])) {
    throw new api.ApiError(404, `${api._team(team)["name"]} is an FCS stand-in: pick an FBS team`);
  }
  let coach = null;
  if (coach_id) {
    coach = coaches.load(coach_id);
    if (coach === null || coach === undefined) throw new api.ApiError(404, "unknown coach");
  }
  if (mode !== "full") throw new api.ApiError(400, "Coach Career starts from Week 0.");
  api._check_not_running();
  let state;
  if (key !== "builtin") {
    state = api._start_from_league(key, team, seed, coach);       // saved
  } else {
    modules.recruiting.use_league_models({});
    season.use_league(season.TEAMS_FILE);          // a new career starts in the 2026 league
    state = season.new_season(team, mode, seed, undefined, coach, true);
    season.save_season(state);
  }
  api._mark_changed();
  api._hold(state);
  return api._show_conferences(season.summary(state), api._conference_names(state));   // no season id in the path: call() does not rename these
}
api.route("POST", "/api/season", create_season);


function export_career(p) {
  // The career as one gzip file (`full` adds every game's box score, for the Download career button).
  const state = api._season_state(p.path["season_id"]);
  if (!career.is_career(state)) throw new api.ApiError(404, "not a Coach Career");
  return career.export_save(state, p.q("full", api.boolean, false));
}
api.route("GET", "/api/season/{season_id}/export", export_career);


function import_career(p) {
  // A career from a file. Whichever copy is newer is kept, so a stale file never replaces a
  // career that has moved on.
  const season = modules.season;
  const blob = p.body;
  if (!is_bytes(blob)) throw new api.ApiError(422, "body is required");
  if (blob.length > api.MAX_SAVE_BYTES) throw new api.ApiError(413, "that file is too large to be a Coach Career save");
  let sid;
  try {
    sid = career.read_save(blob)[0]["id"];
  } catch (exc) {
    if (exc instanceof coaches.ValueError) throw new api.ApiError(400, exc.message);
    throw exc;
  }
  if (api.running() && api._loaded["id"] === sid) {
    throw new api.ApiError(409, "that career is simulating; try again when the week is done");
  }
  api._check_not_running();
  let current = api._loaded !== null && api._loaded["id"] === sid ? api._loaded : season.load_season(sid);
  if (current === undefined) current = null;
  let state;
  try {
    state = career.restore(blob, current);
  } catch (exc) {
    if (exc instanceof coaches.ValueError) throw new api.ApiError(409, exc.message);
    throw exc;
  }
  if (state !== current) {                  // the file won: it was written
    api._mark_changed();
    delete api._cards[sid];
    state = season.load_season(sid);
  }
  api._hold(state);
  return api._show_conferences(season.summary(state), api._conference_names(state));   // no season id in the path: call() does not rename these
}
api.route("POST", "/api/season/import", import_career);


function season_status(p) {
  // Job progress plus your record and, with `since`, your results after that week.
  return api._status(api._season_state(p.path["season_id"]), p.q("since", "int", null));
}
api.route("GET", "/api/season/{season_id}/status", season_status);


function season_news(p) {
  // Around-the-league news for the finished weeks after `since_week` (sim_js/news.js), oldest week first.
  const state = api._season_state(p.path["season_id"]);
  return { items: news.league_news(state, p.q("since_week", "int", 0)), current_week: state["current_week"] };
}
api.route("GET", "/api/season/{season_id}/news", season_news);


function pause_season(p) {
  // Stop a running advance once the week in progress is over.
  api._season_state(p.path["season_id"]);
  if (!api.running()) return { status: get(api._job, "status"), stopping: false };
  api._job["stop"] = true;
  return { status: "running", stopping: true };
}
api.route("POST", "/api/season/{season_id}/pause", pause_season);


function advance_season(p) {
  // Set an advance running to week `to` (default: the next week); step() plays it.
  const season = modules.season;
  const state = api._season_state(p.path["season_id"]);
  const to = api._field(p, "to", "int", null);
  if (api.running()) throw new api.ApiError(409, "already simulating");
  const week = state["current_week"];
  if (truthy(state["done"])) return { status: "idle", done: week, total: week };
  const target = Math.max(week + 1, Math.min(season.FINAL_WEEK, to !== null ? to : week + 1));
  Object.assign(api._job, { status: "running", kind: "advance", target, done: week, total: target, since: week,
    stop: false, paused: false, gameday_event: null, error: null, feed: null });   // last run's news is not this run's
  api._plan(state, week + 1, target);
  return { status: "running", done: week, total: target };
}
api.route("POST", "/api/season/{season_id}/advance", advance_season);


function gameday_season(p) {
  // Game day: set only your game this week running (the week's matchups are set first if
  // they are not yet); step() plays it. Advance then plays the rest of the week.
  const season = modules.season;
  const state = api._season_state(p.path["season_id"]);
  if (api.running()) throw new api.ApiError(409, "already simulating");
  const week = state["current_week"];
  if (truthy(state["done"])) return { status: "idle", done: week, total: week };
  if (season.my_game_id(state) === null) throw new api.ApiError(409, "no game this week: a bye, or your game is already played");
  Object.assign(api._job, { status: "running", kind: "gameday", target: week + 1, done: week, total: week + 1, since: week,
    stop: false, paused: false, gameday_event: null, error: null, stage: "Playing your game", week: week + 1 });
  api._plan(state, week + 1, week + 1, true);
  return { status: "running", done: week, total: week + 1 };
}
api.route("POST", "/api/season/{season_id}/gameday", gameday_season);


function _card_record(st) {
  // A saved season's won-lost record from its own games (playoffs in), for its card. Never season._records, which
  // builds its table from the league in play: a career at a Custom Programs team is not in the built-in league, and its
  // card failed, so the career dropped out of the list (the player's report).
  const me = st["team"];
  let w = 0, l = 0;
  for (const g of Object.values(get(st, "games") || {})) {
    if (!truthy(get(g, "played")) || (me !== get(g, "home") && me !== get(g, "away"))) continue;
    const [mine, theirs] = g["home"] === me ? [g["home_score"], g["away_score"]] : [g["away_score"], g["home_score"]];
    if (mine === null || theirs === null || mine === undefined || theirs === undefined || mine === theirs) continue;
    if (mine > theirs) w += 1; else l += 1;
  }
  return { wins: w, losses: l };
}


Object.assign(api, {
  ApiError, Params, boolean, _field, route, routes, _match, call, _conference_names, _conference_pattern,
  _show_conferences, _engine_conference, call_js, dirty, flush, changed, _mark_changed, loaded_state, job, _idle_job,
  _activate, _hold, _drop, running, _check_not_running, _season_state, _plan, _replan_week, _set_progress, _reporter,
  _finish_week, _status, _feed, _where, _warm_next_game, step, _all_teams, _team, _team_card, list_teams, get_team,
  _fbs_cards, _pend, _programs, _scheme, league_programs, league_program, league_towns, league_check, _undo_start,
  _start_from_league, create_season, export_career, import_career, season_status, season_news, pause_season,
  advance_season, gameday_season, _card_record,
});
