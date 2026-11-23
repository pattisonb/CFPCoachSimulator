// Twists (persona.js, spec section 3): a weekly roll per uncommitted prospect on any board, its own seeded
// stream, about one a recruit a season (more for the blue chips). Each of the seven is set off on one prospect
// against the engine and its effect checked: Surprise Visit (into his top three, knocked back by a top-three
// school's call), At Your Game (a win, a blowout, a loss), Hot Seat (Coach pitches against the school x2), Late
// Offer (a blue blood near the top, his ask up), Family Move (proximity and a hero's state move), Grades Scare
// (academic AI schools drop him, Academics pitches x2), Wants to See You Beat X (private to the school he told).
// Then the weekly report, the save's size, determinism and the rate over a seeded season.
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted, minBy, get, fmt, json_dumps, is_odict, odict } from "../engine_js/pyrt.js";

const game = await start();
const { season, recruiting } = game;
const { persona, prospects, news } = game.modules;

const ME = "ohio-state";

/** copy.deepcopy of a save (an odict stays one). */
function deepcopy(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(deepcopy);
  const out = is_odict(v) ? odict() : {};
  for (const k of Object.keys(v)) out[k] = deepcopy(v[k]);
  return out;
}
const size = (o) => (o ? Object.keys(o).length : 0);
const same = (a, b) => { try { equal(a, b); return true; } catch { return false; } };
const show = (v) => JSON.stringify(v);

function fresh(seed = 5, week = 3) {
  const st = season.new_season(ME, "full", seed, undefined, undefined, true);
  st["current_week"] = week;
  return st;
}

/** An untouched prospect with no story (near `near` within persona.GAME_MILES, of `stars` real stars). */
function plain(st, used, near = null, stars = null) {
  const rc = st["recruiting"];
  const loc = near ? get(recruiting._team_model(near), "location") : null;
  for (const pid of sorted(Object.keys(rc["prospects"]), (q) => rc["prospects"][q]["rank"])) {
    const p = rc["prospects"][pid];
    if (used.has(pid) || get(p, "hidden") || rc["status"][pid]["committed"] || persona.story(st, pid)[0] || size(rc["lists"][pid])) continue;
    if (Object.values(rc["offers"]).some((pids) => pids.includes(pid))) continue;
    if (stars && p["stars"] !== stars) continue;
    if (loc && recruiting._miles([...p["home"]], [...loc]) > persona.GAME_MILES - 50) continue;
    used.add(pid);
    rc["prospects"][pid]["persona"] = { personality: "guarded", decider: "self", decider_topic: null,
                                        story: null, story_data: {}, commit_style: "hat" };
    return pid;
  }
  throw new Error("no prospect fits");
}

/** His list: the schools in order, a few points apart. */
function listed(st, pid, schools) {
  schools.forEach((s, i) => { st["recruiting"]["lists"][pid][s] = 30.0 - 4 * i; });
}

function setup(st, pid, kind, seed = 1) {
  const got = persona._setup(st, new persona._Week(st, st["current_week"]), pid, kind, new Random(seed));
  assert(got, kind);
  const [tw, line] = got;
  if (st["recruiting"]["twists"] === undefined) st["recruiting"]["twists"] = {};
  st["recruiting"]["twists"][pid] = tw;
  recruiting._event(st, "twist", pid, get(tw, "s"), { twist: kind, line: line, ...(kind === "beat" ? { private: true } : {}) });
  assert(/^[A-Z]/.test(line) && line.endsWith(".") && !line.includes("None") && !line.includes("null"), line);
  return tw;
}

function order(st, pid) {
  const rc = st["recruiting"];
  const schools = new Set([...Object.keys(rc["lists"][pid]), ...Object.entries(rc["offers"]).filter(([, pids]) => pids.includes(pid)).map(([s]) => s)]);
  return sorted([...schools], (s) => -recruiting.interest(st, s, pid));
}

function pts(st, slug, pid, action, pitch) {
  const rc = st["recruiting"];
  if (rc["contacts"][pid] !== undefined) delete rc["contacts"][pid][slug];
  rc["pending"] = {}; rc["why_week"] = {}; rc["scenes"] = {};
  rc["hours"][slug] = 1000;
  recruiting._act(st, slug, pid, action, pitch);
  return recruiting.pending(st, slug, pid);
}

function test_surprise(st, used) {
  const pid = plain(st, used);
  const schools = [ME, "michigan", "texas", "georgia", "oregon", "lsu"];
  listed(st, pid, schools);
  let tw = setup(st, pid, "surprise");
  assert(schools.slice(3).includes(tw["s"]) && same(new Set(tw["r"]), new Set(schools.slice(0, 3))) && tw["w"] === persona.SURPRISE_WEEKS, show(tw));
  assert(order(st, pid).indexOf(tw["s"]) <= 2, "the surprise school jumps into his top three");
  // a top-three school's call knocks it back (yours logs a line); a message does not
  const rc = st["recruiting"];
  rc["hours"][ME] = 500;
  recruiting.act(st, ME, pid, "message", "playing_time");
  assert(pid in rc["twists"]);
  recruiting._act(st, ME, pid, "call", "playing_time");
  assert(!(pid in rc["twists"]) && order(st, pid).indexOf(tw["s"]) >= 3);
  assert(rc["log"].some((e) => e["kind"] === "twist" && get(e, "end") && e["pid"] === pid));
  // an AI school plays by the same rule; the twist runs out in two weeks if nobody calls
  const q = plain(st, used);
  listed(st, q, schools);
  tw = setup(st, q, "surprise", 3);
  recruiting._act(st, tw["r"][1], q, "call", "coach");
  assert(!(q in rc["twists"]));
  const q2 = plain(st, used);
  listed(st, q2, schools);
  setup(st, q2, "surprise", 4);
  persona.twist_week(st, 4);
  assert(q2 in rc["twists"]);
  persona.twist_week(st, 5);
  assert(!(q2 in rc["twists"]));
  console.log("  surprise visit ok");
}

function home_week(st, slug) {
  return Math.min(...Object.values(st["games"]).filter((g) => g["home"] === slug && g["kind"] === "regular" && !g["played"] && g["week"] > 1).map((g) => g["week"]));
}

function play(st, slug, opp_week, margin) {
  const g = Object.values(st["games"]).find((g) => g["week"] === opp_week && [g["home"], g["away"]].includes(slug));
  const home = g["home"] === slug;
  g["played"] = true;
  [g["home_score"], g["away_score"]] = home ? [30 + margin, 30] : [30, 30 + margin];
  return g;
}

function test_at_game(base, used) {
  for (const [margin, want] of [[7, "beat"], [28, "blow out"], [-3, "lose to"]]) {
    const st = deepcopy(base);
    const w = home_week(st, ME);
    st["current_week"] = w - 1;
    const pid = plain(st, new Set(used), ME);
    listed(st, pid, [ME, "michigan", "texas"]);
    const tw = setup(st, pid, "at_game");
    assert(tw["s"] === ME && tw["g"] === w, show(tw));
    const rc = st["recruiting"];
    const before = rc["lists"][pid][ME];
    const interest = recruiting.interest(st, ME, pid);
    play(st, ME, w, margin);
    st["current_week"] = w;
    persona.twist_week(st, w);
    const line = [...rc["log"]].reverse().find((e) => e["kind"] === "twist" && e["pid"] === pid)["line"];
    assert(line.includes(want), line);
    if (margin > 0) {
      const mult = margin >= persona.BLOWOUT ? persona.GAME_BLOWOUT : persona.GAME_WIN;
      const gain = rc["lists"][pid][ME] - before;
      assert(Math.abs(gain - Math.min(persona.GAME_CAP, (mult - 1) * interest)) < 0.01, show([gain, interest]));
    } else {
      assert(recruiting.cooled(st, ME, pid) && persona.cooled_why(st, ME, pid) === "game");
      st["current_week"] = w + 1;
      assert(!recruiting.cooled(st, ME, pid), "a loss cools him one week");
    }
    assert(!(pid in rc["twists"]));
  }
  // nothing to go to: a prospect far from every school on his list has no At Your Game
  const st = deepcopy(base);
  const rc = st["recruiting"];
  const away = (q) => ["HI", "AK"].includes(rc["prospects"][q]["hometown"]["state"]);
  let far = null;
  if (Object.keys(rc["prospects"]).some(away)) {
    far = sorted(Object.keys(rc["prospects"])).find((q) => away(q) && !size(rc["lists"][q]));
    if (far === undefined) throw new Error("StopIteration");
  }
  if (far) {
    listed(st, far, [ME, "michigan"]);
    assert(persona._setup(st, new persona._Week(st, 3), far, "at_game", new Random(1)) === null);
  }
  console.log("  at your game ok");
}

function test_hot_seat(st, used) {
  const pid = plain(st, used);
  listed(st, pid, ["michigan", ME, "texas"]);
  const league = game.modules.league;
  assert(persona.security(st, "michigan") >= persona.HOT_SEAT, "a first season's coaches start off the hot seat (carousel.STANDING)");
  st["league"] = league.from_base(season.season_year(st) + 1);       // a second season: the career's league and its ADs
  recruiting.reset_caches();
  const lg = st["league"]["teams"]["michigan"];
  lg["ad"] = { patience: 3, security: persona.HOT_SEAT + 10 };
  assert(persona._setup(st, new persona._Week(st, 3), pid, "hot_seat", new Random(1)) === null, "a safe coach is no hot seat");
  const base_coach = pts(st, ME, pid, "message", "coach");
  const base_pt = pts(st, ME, pid, "message", "playing_time");
  const base_theirs = pts(st, "michigan", pid, "message", "coach");
  lg["ad"]["security"] = persona.HOT_SEAT - 5;
  const tw = setup(st, pid, "hot_seat");
  assert(tw["s"] === "michigan" && tw["w"] === persona.HOT_SEAT_WEEKS);
  assert(Math.abs(pts(st, ME, pid, "message", "coach") - base_coach * persona.HOT_SEAT_PITCH) < 1e-9);
  assert(Math.abs(pts(st, ME, pid, "message", "playing_time") - base_pt) < 1e-9);
  assert(Math.abs(pts(st, "michigan", pid, "message", "coach") - base_theirs) < 1e-9, "the hot-seat school's own pitch is as usual");
  console.log("  hot seat ok");
}

function test_late_offer(st, used) {
  const programs = game.modules.programs;
  const pid = plain(st, used, null, 4);
  listed(st, pid, ["michigan", "texas", "georgia", "oregon"]);
  const rc = st["recruiting"];
  const ask = rc["prospects"][pid]["nil_ask"];
  const tw = setup(st, pid, "late_offer");
  const school = tw["s"];
  assert(programs.get(st, school)["tier"] === 1 && school !== ME && rc["offers"][school].includes(pid), school);
  assert(order(st, pid).indexOf(school) <= 1, show([order(st, pid), school]));
  assert(rc["prospects"][pid]["nil_ask"] === Math.trunc(pyround(ask * persona.LATE_ASK)));
  assert(rc["log"].some((e) => e["kind"] === "offer" && e["pid"] === pid && e["school"] === school));
  // the news, for a blue chip
  const items = news._recruiting(st, season.load_teams(), st["current_week"]).filter((x) => get(x["link"], "pid") === pid);
  assert(items.length && items[0]["text"].includes("jumps in"), show(items));
  assert(items[0]["text"].includes("late") === (st["current_week"] >= news.LATE_FROM_WEEK), show(items));      // "late" only late in the year
  // a two-star never gets one
  const two = plain(st, used, null, 2);
  assert(persona._setup(st, new persona._Week(st, 3), two, "late_offer", new Random(1)) === null);
  console.log("  late offer ok");
}

function test_family_move(st, used) {
  const pid = plain(st, used);
  const rc = st["recruiting"];
  const p = rc["prospects"][pid];
  const home = p["hometown"]["state"];
  const prox = {};
  for (const s of ["michigan", "texas", "usc", "georgia"]) prox[s] = recruiting.pull(st, s, pid)["proximity"];
  const tw = setup(st, pid, "family_move");
  const m = rc["moved"][pid];
  assert(m["state"] !== home && tw["s"] === null);
  const after = {};
  for (const s of Object.keys(prox)) after[s] = recruiting.pull(st, s, pid)["proximity"];
  assert(!same(after, prox), "his proximity moved with his family");
  const near = minBy(Object.keys(after), (s) => recruiting._miles([...m["home"]], [...recruiting._team_model(s)["location"]]));
  assert(after[near] === Math.max(...Object.values(after)));
  assert(p["hometown"]["state"] === home, "his hometown (his high school) is kept; the move is its own record");
  // a Hometown Hero's state moves too
  p["persona"] = { ...p["persona"], story: "hero", story_data: { state: home } };
  const new_state = recruiting.fbs_schools(st).find((s) => persona.school_state(s) === m["state"]) ?? null;
  const old_state = recruiting.fbs_schools(st).find((s) => persona.school_state(s) === home) ?? null;
  if (new_state) {
    const raw = recruiting.PULL_SCALE * 0 + persona.story_interest(st, new_state, pid, 10.0);
    assert(raw === 10.0 * persona.HERO_STATE, raw);
  }
  if (old_state) assert(persona.story_interest(st, old_state, pid, 10.0) === 10.0);
  console.log("  family move ok");
}

function test_grades(st, used) {
  const rc = st["recruiting"];
  const pid = plain(st, used);
  for (const [k, s] of [["boards", "stanford"], ["offers", "stanford"], ["boards", "duke"]]) {
    if (rc[k][s] === undefined) rc[k][s] = [];
    rc[k][s].push(pid);
  }
  const base_out = pts(st, "texas", pid, "message", "academics");
  const base_in = pts(st, "stanford", pid, "message", "academics");
  const base_other = pts(st, "texas", pid, "message", "coach");
  const tw = setup(st, pid, "grades");
  assert(tw["w"] === persona.GRADES_WEEKS);
  assert(!rc["boards"]["stanford"].includes(pid) && !rc["offers"]["stanford"].includes(pid) && !rc["boards"]["duke"].includes(pid));
  assert(Math.abs(pts(st, "texas", pid, "message", "academics") - base_out * persona.GRADES_PITCH) < 1e-9);
  assert(Math.abs(pts(st, "stanford", pid, "message", "academics") - base_in) < 1e-9, "an academic school's own Academics pitch is as usual");
  assert(Math.abs(pts(st, "texas", pid, "message", "coach") - base_other) < 1e-9);
  // while it lasts the academic AI schools keep him off their boards
  rc["boards"]["stanford"].unshift(pid);
  recruiting.auto_recruit(st, "stanford", new Random(1));
  assert(!rc["boards"]["stanford"].includes(pid) && !rc["offers"]["stanford"].includes(pid));
  // nobody academic after him: no scare
  const q = plain(st, used);
  for (const s of recruiting.ACADEMIC) assert(!(get(rc["boards"], s) || []).includes(q) || s === ME);
  if (![...recruiting.ACADEMIC].some((s) => (get(rc["boards"], s) || []).includes(q))) {
    assert(persona._setup(st, new persona._Week(st, 3), q, "grades", new Random(1)) === null);
  }
  console.log("  grades scare ok");
}

function test_beat(base, used) {
  for (const margin of [10, -10]) {
    const st = deepcopy(base);
    st["current_week"] = 3;
    const pid = plain(st, new Set(used));
    listed(st, pid, [ME, "michigan", "texas"]);
    const rc = st["recruiting"];
    let tw = null, line = null;
    for (let seed = 0; seed < 40; seed++) {
      const got = persona._setup(st, new persona._Week(st, 3), pid, "beat", new Random(seed));
      if (got && got[0]["s"] === ME) {
        [tw, line] = got;
        break;
      }
    }
    assert(tw, "he names one of your next opponents");
    if (rc["twists"] === undefined) rc["twists"] = {};
    rc["twists"][pid] = tw;
    recruiting._event(st, "twist", pid, ME, { twist: "beat", line: line, private: true });
    assert(3 < tw["g"] && tw["g"] <= 3 + persona.BEAT_AHEAD && tw["o"] in season.load_teams());
    const v = persona.twist_view(st, ME, pid);
    assert(v["label"].startsWith("Wants to See You Beat ") && v["line"] === line, show(v));
    assert(persona.twist_view(st, "michigan", pid) === null, "only the school he told");
    assert(!get(prospects.history_index(st, "michigan"), pid, []).filter((h) => h["kind"] === "twist").length);
    const before = rc["lists"][pid][ME];
    play(st, ME, tw["g"], margin);
    for (let w = 4; w < tw["g"] + 1; w++) {
      st["current_week"] = w;
      persona.twist_week(st, w);
    }
    const delta = rc["lists"][pid][ME] - before;
    assert(Math.abs(delta - (margin > 0 ? persona.BEAT_WIN : -persona.BEAT_LOSS)) < 1e-9, delta);
    assert(!(pid in rc["twists"]));
  }
  console.log("  wants to see you beat ok");
}

function test_report_and_save(st, used) {
  const rc = st["recruiting"];
  const pid = plain(st, used);
  listed(st, pid, ["michigan", "texas", "georgia", "oregon", ME]);
  rc["board"].push(pid);
  setup(st, pid, "surprise");
  const report = recruiting._report(st, st["current_week"]);
  const row = report["rows"].find((r) => r["pid"] === pid);
  assert(row["events"].some((e) => e["kind"] === "twist" && e["line"]), show(row["events"]));
  const prof = prospects.profile(st, pid, ME);
  assert(prof["twist"]["label"] === "Surprise Visit" && prof["twist"]["weeks_left"] === persona.SURPRISE_WEEKS && prof["twist"]["line"]);
  const board = prospects.board_row(st, pid, ME);
  assert(board["twist"]["key"] === "surprise");
  const hist = prospects.history_index(st, ME)[pid];
  assert(hist.some((h) => h["kind"] === "twist" && h["line"]));
  const keys = new Set(["k", "s", "w", "b", "r", "g", "o"]);
  for (const tw of Object.values(rc["twists"])) assert(Object.keys(tw).every((k) => keys.has(k)), show(tw));
  const sz = json_dumps(rc["twists"]).length / Math.max(1, size(rc["twists"]));
  assert(sz < 120, sz);
  console.log("  report, profile and save ok");
}

function test_determinism_and_rate() {
  const st = season.new_season("georgia", "full", 2, undefined, undefined, true);
  season.advance_to(st, 5);
  const [a, b] = [deepcopy(st), deepcopy(st)];
  const ea = persona.roll_twists(a, 5);
  const eb = persona.roll_twists(b, 5);
  const key = (es) => es.map((e) => [e["pid"], e["twist"], e["line"]]);
  assert(ea.length && same(key(ea), key(eb)));
  assert(same(a["recruiting"]["twists"], b["recruiting"]["twists"]));
  season.advance_to(st, season.SELECTION_WEEK);
  const rc = st["recruiting"];
  const starts = rc["log"].filter((e) => e["kind"] === "twist" && !get(e, "end"));      // a twist's start (not its game or a knock-back)
  const kinds = {};
  for (const k of Object.keys(persona.TWISTS)) kinds[k] = starts.filter((e) => e["twist"] === k).length;
  assert(Object.keys(persona.TWISTS).every((k) => k === "hot_seat" || kinds[k]), show(kinds));          // a first season has no coach on the hot seat
  const top = new Set(Object.entries(rc["prospects"]).filter(([, p]) => p["rank"] <= 1000).map(([q]) => q));
  const per = starts.filter((e) => top.has(e["pid"])).length / top.size;
  const blue = new Set([...top].filter((q) => (get(rc["prospects"][q], "real") || rc["prospects"][q])["stars"] >= 4));
  const per_blue = starts.filter((e) => blue.has(e["pid"])).length / Math.max(1, blue.size);
  assert(0.5 <= per && per <= 1.5, per);
  assert(per_blue >= per, show([per_blue, per]));
  // an FCS stand-in's old placeholder name never reaches a line: it is only ever its own name ("Gulf Coast Shrimpers"),
  // and no recruit asks a school to beat an FCS team
  const fcs_names = game.modules.fcs_names;
  const texts = [...rc["log"].map((e) => get(e, "line") || ""), ...Object.values(get(rc, "twists") || {}).map((t) => persona.twist_label(t))];
  const leaked = texts.filter((x) => fcs_names.has_old(x));
  assert(!leaked.length, `FCS stand-in placeholder names in twist lines: ${show(leaked.slice(0, 3))}`);
  const labels = new Set(Object.values(season.load_teams()).filter((t) => get(t, "fictional")).map((t) => t["name"]));
  assert(labels.size && [...labels].every((n) => Object.values(fcs_names.TEAMS).some((b) => b.name === n)), show([...labels]));
  const fbs_only = starts.filter((e) => e["twist"] === "beat");
  assert(fbs_only.filter((e) => e["pid"] in (get(rc, "twists") || {}))
    .every((e) => !get(get(season.load_teams(), get(get(rc["twists"], e["pid"], {}), "o")) || {}, "fictional")));
  console.log(`  determinism and rate ok: ${fmt(per, 2)} twists a top-1000 recruit, ${fmt(per_blue, 2)} a blue chip; ${show(kinds)}; no stand-in names`);
}

// Python's round(x) for a float (halves to even)
import { round as pyround } from "../engine_js/pyrt.js";

const base = fresh();
const used = new Set();
test("test_surprise", () => test_surprise(deepcopy(base), used));
test("test_at_game", () => test_at_game(base, used));
test("test_hot_seat", () => test_hot_seat(deepcopy(base), used));
test("test_late_offer", () => test_late_offer(deepcopy(base), used));
test("test_family_move", () => test_family_move(deepcopy(base), used));
test("test_grades", () => test_grades(deepcopy(base), used));
test("test_beat", () => test_beat(base, used));
test("test_report_and_save", () => test_report_and_save(deepcopy(base), used));
test("test_determinism_and_rate", () => test_determinism_and_rate());
test("test_twists: ok", () => {});
await run();
