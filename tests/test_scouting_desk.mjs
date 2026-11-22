// The scouting desk (GET /api/season/{id}/scouting, career_js/prospects.js scouting_view), through the API as the page
// calls it: the look log `rc["looks"]` (the looks that changed a grade word or gained a flag) and the tally
// `rc["look_counts"]` that a look keeps for this week and last, the scouts' cards and their yield, the queue with its
// paging, filters and the reason a row takes no Send, this week's reports, the flags, and the desk in the portal.
// `node tests/test_scouting_desk.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, get, sorted } from "../engine_js/pyrt.js";

const game = await start();
const { api, season, recruiting } = game;
const { prospects, grades } = game.modules;

const ME = "ohio-state";
const J = (v) => () => JSON.stringify(v);
const HALF = recruiting.AREA_LOOK;        // an area scout's week is half a look: the tallies count looks in trip units
const FLAGS = ["gem", "bust", "generational", "likes"];
const keys = (o) => new Set(Object.keys(o));
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

const sid = api.call("POST", "/api/season", { team: ME, mode: "full", seed: 11, career: true })["id"];
const G = (p) => api.call("GET", `/api/season/${sid}/${p}`);
const R = (p, body) => api.call("POST", `/api/season/${sid}/${p}`, body);
let st = api.loaded_state(), rc = st["recruiting"];
const staff = st["career"]["staff"];
const ids = staff.map((m) => m["id"]);

/** The prospects of a scout's area he could still be asked to look at (not signed, not committed to you). */
function area_pids(member) {
  const codes = recruiting.AREAS[member["area"]] || [];
  return Object.keys(rc["prospects"]).filter((q) => codes.includes(rc["prospects"][q]["hometown"]["state"]) && !rc["status"][q]["signed"]
    && rc["status"][q]["committed"] !== ME);
}
const scoutable = (pid) => !rc["status"][pid]["signed"] && rc["status"][pid]["committed"] !== ME
  && !recruiting.report_complete(get(rc["reads"], pid)) && visible.has(pid);
let visible = new Set(recruiting.visible(st));

/** A logged look: who, whom, when, and only the groups whose grade words changed. */
function check_entry(e) {
  equal(keys(e), new Set(["week", "pid", "by", "before", "after", "flags"]));
  assert(e["pid"] in rc["prospects"] && e["flags"].every((f) => FLAGS.includes(f)));
  assert(Object.keys(e["before"]).every((g) => g in e["after"]) && Object.keys(e["after"]).every((g) => recruiting.GROUPS.includes(g)), J(e));
  for (const [g, after] of Object.entries(e["after"])) assert(JSON.stringify(after) !== JSON.stringify(e["before"][g] ?? null), "a group that did not change was logged");
  for (const r of [...Object.values(e["after"]), ...Object.values(e["before"])]) assert(r.length === 2 && r.every((w) => recruiting.WORDS.includes(w)), J(r));
}

test("before any look the desk shows your scouts, an empty report and the class to send them to; reading it creates nothing", () => {
  for (const k of ["looks", "look_counts", "look_changes"]) delete rc[k];
  const v = G("scouting?sort=board");
  equal(keys(v), new Set(["hours", "hours_left", "points_left", "points_week", "scouts", "queue", "queue_total", "reports", "flags", "full_reports",
    "trips_this_week", "board_size", "board_scouted", "areas"]), "what the page reads from the desk");
  assert(v["board_size"] === rc["board"].length && v["hours"] === v["hours_left"] && v["hours"] > 0);
  equal(v["areas"], Object.fromEntries(Object.entries(recruiting.AREAS).map(([a, codes]) => [a, [...codes]])));
  equal(v["reports"], { this_week: [], last_week: [] });
  equal(v["scouts"].map((s) => s["id"]), ids);
  for (const s of v["scouts"]) {
    equal(keys(s), new Set(["id", "name", "role", "evaluation_word", "area", "looking_at", "yield", "contract_until"]), "a scout's card");
    assert(["Offensive Coordinator", "Defensive Coordinator", "Recruiter"].includes(s["role"]) && recruiting.WORDS.includes(s["evaluation_word"]), J(s));
    assert(s["area"] in recruiting.AREAS && s["looking_at"] > 0);
    equal(s["yield"], { looks: 0, narrowed: 0, flags: 0 });
  }
  assert(v["queue"].length === prospects.QUEUE_LIMIT && v["queue_total"] > 3000);
  const row_keys = new Set(["cost", "pid", "name", "position", "display_pos", "stars", "group", "need", "national_rank", "looks", "trips", "potential",
    "can_send", "why", "state", "likes", "on_board", "flags"]);
  for (const r of v["queue"]) equal(keys(r), row_keys, "a queue row");
  assert(v["queue"].every((r) => r["can_send"] && r["why"] === null && r["looks"] === 0 && r["potential"] === null));
  assert(!("looks" in rc) && !("look_counts" in rc) && !("look_changes" in rc), "a read of the desk created the log");
});

test("a week of area looks: every scout's tally counts half a look a prospect, and the log keeps his most telling looks", () => {
  recruiting.scout_week(st);
  equal(Object.keys(rc["look_counts"]), ["0"]);
  equal(rc["look_counts"]["0"], Object.fromEntries(staff.map((m) => [m["id"], HALF * area_pids(m).length])));
  assert(Object.values(rc["reads"]).every((r) => r["looks"] === HALF && r["area"] === HALF));
  equal(rc["look_changes"]["0"], Object.fromEntries(staff.map((m) => [m["id"], { changed: area_pids(m).length, flags: 0 }])), "a first look changes every grade");
  assert(rc["looks"].length === staff.length * recruiting.LOOK_LOG_KEEP);
  for (const e of rc["looks"]) {
    check_entry(e);
    assert(e["week"] === 0 && ids.includes(e["by"]) && !Object.keys(e["before"]).length);
    equal(keys(e["after"]), new Set(recruiting.GROUPS));
  }
  for (const m of staff) {
    const kept = rc["looks"].filter((e) => e["by"] === m["id"]), area = new Set(area_pids(m));
    assert(kept.length === recruiting.LOOK_LOG_KEEP && kept.every((e) => area.has(e["pid"])));
  }
});

let third, tally, moved;

test("the log and the tallies keep this week and last; a later look is logged only when it changed a grade word or found a flag", () => {
  for (const w of [1, 2]) {
    st["current_week"] = w;
    recruiting.scout_week(st);
    equal(new Set(rc["looks"].map((e) => e["week"])), new Set([w - 1, w]));
    equal(Object.keys(rc["look_counts"]).sort(), [String(w - 1), String(w)]);
    equal(Object.keys(rc["look_changes"]).sort(), [String(w - 1), String(w)]);
  }
  third = rc["looks"].filter((e) => e["week"] === 2);
  [tally, moved] = [rc["look_counts"]["2"], rc["look_changes"]["2"]];
  for (const e of third) {
    check_entry(e);
    assert(Object.keys(e["after"]).length || e["flags"].length, "a look that changed nothing was logged");
  }
  const quiet = sum(Object.values(tally)) / HALF - sum(Object.values(moved).map((c) => c["changed"]));
  assert(quiet > 0 && third.length, "some looks change nothing, and those are counted but not logged");
  for (const [by, c] of Object.entries(moved)) {         // flagged looks are kept first, up to the cap
    const kept = third.filter((e) => e["by"] === by);
    assert(kept.length === Math.min(recruiting.LOOK_LOG_KEEP, c["changed"]));
    assert(kept.filter((e) => e["flags"].length).length === Math.min(recruiting.LOOK_LOG_KEEP, c["flags"]));
  }
  assert(Object.values(rc["reads"]).every((r) => r["looks"] === 1.5 && r["area"] === 1.5), "three weeks in an area: one and a half of three");
});

test("the desk's reports group this week's logged looks by scout, flags first, and each card's yield is his tally", () => {
  const v = G("scouting?sort=board");
  const { this_week, last_week } = v["reports"];
  assert(this_week.length && last_week.length);
  const on_board = new Set(G("recruiting")["board"].map((b) => b["id"]));
  assert(v["queue"].every((r) => r["on_board"] === on_board.has(r["pid"])));
  for (const group of [...this_week, ...last_week]) {
    equal(keys(group), new Set(["scout_id", "scout", "area", "looks", "changed", "items"]), "a report group");
    assert(ids.includes(group["scout_id"]) && group["area"] in recruiting.AREAS);
    for (const it of group["items"]) {
      equal(keys(it), new Set(["pid", "name", "position", "stars", "change", "flags", "likes", "on_board", "complete"]), "a report item");
      assert(it["on_board"] === on_board.has(it["pid"]) && (it["change"] || it["flags"].length), J(it));
    }
  }
  equal(this_week.map((g) => g["scout_id"]), [...staff].reverse().map((m) => m["id"]).filter((id) => third.some((e) => e["by"] === id)), "newest looks first");
  for (const group of this_week) {
    const mine = third.filter((e) => e["by"] === group["scout_id"]);
    assert(group["looks"] === tally[group["scout_id"]] && group["changed"] === moved[group["scout_id"]]["changed"] && group["changed"] >= mine.length);
    assert(group["items"].length === Math.min(prospects.REPORT_ITEMS, mine.length));
    assert(group["items"].every((it) => mine.some((e) => e["pid"] === it["pid"])));
    const kinds = group["items"].map((it) => (it["flags"].length ? 0 : it["change"].startsWith("potential") ? 1 : 2));
    equal(kinds, [...kinds].sort((a, b) => a - b), "flags first, then potential, then the rest");
  }
  for (const card of v["scouts"]) {
    equal(card["yield"], { looks: get(tally, card["id"], 0), narrowed: get(get(moved, card["id"], {}), "changed", 0), flags: get(get(moved, card["id"], {}), "flags", 0) });
  }
  assert(v["scouts"].some((c) => c["yield"]["looks"] / HALF > c["yield"]["narrowed"]), "a scout whose looks all moved a grade: the yield counts looks, not changes");
});

let total, rest, target, yours;

test("the queue: your board first, then the class by need and rank, paged and filtered by state, name, position and group", () => {
  let v = G("scouting?sort=board");
  const queue = v["queue"];
  total = v["queue_total"];
  R("board", { pid: queue[5]["pid"], on: true });
  v = G("scouting?sort=board");
  assert(v["queue"][0]["pid"] === queue[5]["pid"] && v["queue"][1]["pid"] === queue[0]["pid"] && v["queue_total"] === total);
  rest = v["queue"].slice(1);
  const order = rest.map((r) => [-r["need"], r["national_rank"]]);
  equal(order, sorted(order, (k) => k));
  const seen = rest.find((r) => get(rc["reads"], r["pid"]));
  assert(seen["looks"] === rc["reads"][seen["pid"]]["looks"]);
  equal(seen["potential"], recruiting.shown_range(st, seen["pid"], "potential"), "the queue shows the read as the page does: his potential in letter grades");
  assert(seen["potential"].every((x) => grades.ORDER.includes(x)));
  assert(rest.every((r) => r["state"] === rc["prospects"][r["pid"]]["hometown"]["state"]));
  const page2 = G("scouting?sort=board&offset=120&limit=10");
  assert(page2["queue"].length === 10 && page2["queue_total"] === total);
  const whole = G("scouting?sort=board&limit=1000")["queue"];
  assert(whole.length === prospects.QUEUE_MAX, "one ask returns at most the queue's maximum");
  equal(whole.slice(0, 120), v["queue"]);
  equal(whole.slice(120, 130), page2["queue"]);
  const tx = G("scouting?sort=board&q=tx");
  assert(tx["queue_total"] > 0 && tx["queue_total"] < total && tx["queue"].every((r) => r["state"] === "TX"));
  const name = rest[3]["name"].split(" ").at(-1);
  const named = G(`scouting?sort=board&q=${name.toUpperCase()}`)["queue"];
  assert(named.some((r) => r["pid"] === rest[3]["pid"]) && named.every((r) => r["name"].toLowerCase().includes(name.toLowerCase())));
  const qb = G("scouting?sort=board&position=qb&limit=400");
  assert(qb["queue"].length && qb["queue"].every((r) => r["position"] === "QB"));
  const ol = G("scouting?sort=board&group=OL&limit=5")["queue"];
  assert(ol.length === 5 && ol.every((r) => ["OT", "OG", "C"].includes(r["group"])), "a group filter works; rows carry the position the pages count by");
  const none = G("scouting?sort=board&q=zzzzzz");
  assert(none["queue"].length === 0 && none["queue_total"] === 0);
});

test("a Send from the desk spends points, is logged as your trip, and a complete report stays listed with no Send", () => {
  let v = G("scouting?sort=board");
  target = rest.find((r) => r["can_send"]);
  const hours = v["hours_left"], points = v["points_left"];
  assert(Object.values(recruiting.LOOK_COST).includes(target["cost"]) && v["points_week"] === recruiting.scout_points(st, ME));
  const out = R("recruit", { pid: target["pid"], action: "scout" });
  assert(out["hours_left"] === hours, "a Send spends scouting points, not hours");
  assert(G("scouting?sort=board")["points_left"] === points - target["cost"]);
  assert("likes" in out["look"], "a Send also returns the like a completed report earned");
  const { likes, ...look } = out["look"];
  check_entry(look);
  assert(look["by"] === "trip" && look["pid"] === target["pid"] && look["week"] === 2 && rc["look_counts"]["2"]["trip"] === 1);
  const logged = rc["looks"].some((e) => JSON.stringify(e) === JSON.stringify(look));
  const told = Boolean(Object.keys(look["after"]).length || look["flags"].length);
  assert(logged === told && told === ("trip" in rc["look_changes"]["2"]));
  v = G("scouting?sort=board");
  const trips = v["reports"]["this_week"].find((g) => g["scout_id"] === "trip");
  assert(trips["looks"] === 1 && trips["area"] === null && trips["scout"] === "Your trips", J(trips));
  assert(trips["changed"] === trips["items"].length && trips["changed"] === (told ? 1 : 0));
  const row = v["queue"].find((r) => r["pid"] === target["pid"]);
  assert(row["trips"] === 1 && row["can_send"] && row["looks"] === rc["reads"][target["pid"]]["looks"]);
  while (!recruiting.report_complete(rc["reads"][target["pid"]])) R("recruit", { pid: target["pid"], action: "scout" });
  assert(rc["reads"][target["pid"]]["looks"] === 3);
  try {
    R("recruit", { pid: target["pid"], action: "scout" });
    throw new Error("a Send on a complete report");
  } catch (e) {
    assert(e instanceof api.ApiError && e.status === 409 && e.message.includes("his report is complete"), String(e.message));
  }
  // every prospect stays listed: a full report and your own commit take no Send, and the row says why
  yours = rest[1]["pid"];
  recruiting._commit(st, yours, ME);
  v = G("scouting?sort=board&limit=400");
  assert(v["queue_total"] === total);
  equal(Object.fromEntries(v["queue"].filter((r) => !r["can_send"]).map((r) => [r["pid"], r["why"]])),
    { [target["pid"]]: prospects.REPORT_COMPLETE, [yours]: prospects.COMMITTED_TO_YOU });
  // on your board a complete report sorts after the open ones, with one final letter grade range
  R("board", { pid: target["pid"], on: true });
  const rows = G("scouting?sort=board&limit=400")["queue"];
  const i = rows.findIndex((r) => r["pid"] === target["pid"]);
  assert(rows.slice(0, i + 1).every((r) => rc["board"].includes(r["pid"])) && rows.slice(0, i).every((r) => r["looks"] < 3));
  assert(rows[i]["looks"] === 3 && rows[i]["can_send"] === false && rows[i]["why"] === prospects.REPORT_COMPLETE, J(rows[i]));
  equal(rows[i]["potential"], recruiting.shown_range(st, target["pid"], "potential"));
  assert(rows[i]["potential"].every((x) => grades.ORDER.includes(x)), "a complete report's potential is letter grades, never a word or a number");
  assert(rows.slice(i + 1).every((r) => r["pid"] === yours || (r["can_send"] && r["looks"] < 3)));
  R("board", { pid: target["pid"], on: false });
});

test("short of points no row takes a Send, and each says why", () => {
  const least = Math.min(...Object.values(recruiting.LOOK_COST)) - 1;
  rc["scout_points"] = { [ME]: least };
  const v = G("scouting?sort=board");
  assert(v["points_left"] === least);
  for (const r of v["queue"]) {
    const why = r["pid"] === yours ? prospects.COMMITTED_TO_YOU : r["looks"] >= 3 ? prospects.REPORT_COMPLETE : prospects.NOT_ENOUGH_POINTS;
    assert(!r["can_send"] && r["why"] === why, J(r));
  }
  // a scout is looking at the prospects in his area his week still adds to: not your commit
  const home = rc["prospects"][yours]["hometown"]["state"];
  const area = Object.keys(recruiting.AREAS).find((a) => recruiting.AREAS[a].includes(home));
  for (const s of v["scouts"]) {
    if (s["area"] !== area) continue;
    const watching = area_pids({ area }).filter((q) => recruiting.area_open(get(rc["reads"], q))).length;
    assert(s["looking_at"] === watching, J([s["looking_at"], watching]));
  }
  rc["scout_points"] = { [ME]: 100 };
});

test("a flag waits for the complete report, then shows on the desk and on the trip that found it", () => {
  visible = new Set(recruiting.visible(st));
  const threes = Object.keys(rc["prospects"]).filter((q) => rc["prospects"][q]["stars"] === 3 && scoutable(q) && q in rc["reads"]);
  const [gem, before_flag] = threes;
  const cut = recruiting.flag_cuts(rc)[3][0];             // the gem cut is relative to his star tier
  rc["reads"][gem]["g"]["potential"] = [cut + 1.0, 1000.0];
  assert(rc["reads"][gem]["looks"] === 1.5 && !G("scouting?sort=board")["flags"].some((f) => f["pid"] === gem), "no flag before the report is complete");
  rc["reads"][gem]["looks"] = recruiting.FIND_LOOKS;
  const v = G("scouting?sort=board");
  for (const f of v["flags"]) {
    equal(keys(f), new Set(["pid", "name", "position", "stars", "flag", "looks", "standing_word", "likes", "on_board"]), "a flag");
    assert(FLAGS.includes(f["flag"]) && f["looks"] <= 3);
  }
  const found = v["flags"].find((f) => f["pid"] === gem);
  assert(found["flag"] === "gem" && found["looks"] === 3 && found["standing_word"], J(found));
  const named = encodeURIComponent(rc["prospects"][gem]["name"]);
  assert(G(`scouting?sort=board&limit=400&q=${named}`)["queue"].some((r) => r["pid"] === gem && !r["can_send"]), "a complete report stays listed, no Send");
  rc["reads"][gem]["g"]["potential"] = [70.0, 1000.0];
  rc["reads"][before_flag]["g"]["potential"] = [cut + 1.0, 1000.0];
  rc["reads"][before_flag]["looks"] = recruiting.FIND_LOOKS - 1;       // the trip's look completes the report
  const out = R("recruit", { pid: before_flag, action: "scout" });
  equal(out["look"]["flags"], ["gem"]);
  const item = G("scouting?sort=board")["reports"]["this_week"].find((g) => g["scout_id"] === "trip")["items"].find((it) => it["pid"] === before_flag);
  equal(item["flags"], ["gem"]);
});

/** Every game played, every school's class signed, the season over (as tests/test_portal_recap.mjs ends one). */
function finished(state) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(state["games"])) {
    const h = teams[g["home"]]["team_ratings"]["overall"], a = teams[g["away"]]["team_ratings"]["overall"];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 12));
    Object.assign(g, { played: true, home_score: win ? hs : Math.max(0, hs - rng.randint(1, 20)), away_score: win ? hs - rng.randint(1, 20) : hs });
    if (g["home_score"] === g["away_score"]) g["home_score"] += 3;
  }
  const schools = Object.keys(teams).filter((s) => !teams[s]["fictional"]);
  sorted(Object.keys(state["recruiting"]["prospects"]), (p) => state["recruiting"]["prospects"][p]["rank"]).slice(0, schools.length * 21)
    .forEach((pid, i) => { state["recruiting"]["status"][pid]["signed"] = schools[i % schools.length]; });
  Object.assign(state, { done: true, current_week: season.FINAL_WEEK, champion: ME });
}

test("in the portal the desk starts over on the entrants, by the portal's own weeks", () => {
  finished(api.loaded_state());
  api._save_loaded();
  G("offseason");
  while (api.loaded_state()["offseason"]["stage"] !== "portal_w1") R("offseason/advance", {});
  st = api.loaded_state();
  rc = st["recruiting"];
  assert(get(rc, "portal") && !("looks" in rc) && !("look_counts" in rc) && !("look_changes" in rc));
  let v = G("scouting?sort=board");
  assert(v["queue"].length && v["queue"].every((r) => r["pid"] in rc["prospects"] && r["stars"] === null), "a transfer has no stars");
  equal(v["reports"], { this_week: [], last_week: [] });
  equal(v["flags"], []);
  R("offseason/advance", {});                             // portal week 1 steps: the scouts look at the entrants
  st = api.loaded_state();
  rc = st["recruiting"];
  assert(rc["week"] === 2 && rc["looks"].length && rc["looks"].every((e) => e["week"] === 2));
  equal(Object.keys(rc["look_counts"]), ["2"]);
  assert(rc["looks"].length <= st["career"]["staff"].length * recruiting.LOOK_LOG_KEEP);
  for (const e of rc["looks"]) check_entry(e);
  v = G("scouting?sort=board");
  assert(v["reports"]["this_week"].length && v["reports"]["last_week"].length === 0);
  assert(v["reports"]["this_week"].every((g) => g["items"].every((it) => it["pid"] in rc["prospects"])));
  assert(sum(v["reports"]["this_week"].map((g) => g["looks"])) === sum(Object.values(rc["look_counts"]["2"])));
  const entrant = v["queue"].find((r) => r["can_send"]);
  const out = R("recruit", { pid: entrant["pid"], action: "scout" });
  assert(out["look"]["by"] === "trip" && out["look"]["week"] === 2);
  equal(out["look"]["flags"], []);
});

await run();
