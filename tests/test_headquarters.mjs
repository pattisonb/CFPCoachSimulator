// Headquarters' server side (career_js/headquarters.js and its three routes in app_js/api): the widget layout saved
// in the career and read back, an old save reading as an empty layout, bad layouts and plans refused with nothing
// stored, widget ids the server does not know kept, and the reads no other view has: your commits by week, this
// week's movers, last contacts, the roster outlook with replacements, next year's depth chart, What-If, goals, tasks
// and promises. Saving a layout never touches the season. Through the API, as the page calls it.
// `node tests/test_headquarters.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";

const game = await start();
const { recruiting, offseason, api } = game;
recruiting.LOCKOUT_AT = 99;        // nobody shuts the door here: the lockout has its own test (tests/test_standards.mjs)
const { prospects } = game.modules;

const ME = "ohio-state";
const show = (v) => JSON.stringify(v);
const sid = api.call("POST", "/api/season", { team: ME, mode: "full", seed: 11, career: true })["id"];
const GET = (q = "") => api.call("GET", `/api/season/${sid}/headquarters${q}`);
const POST = (body) => api.call("POST", `/api/season/${sid}/headquarters`, body);
const PLAN = (body) => api.call("POST", `/api/season/${sid}/headquarters/plan`, body);
const RV = () => api.call("GET", `/api/season/${sid}/recruiting`);
const card = (i, widget = "top-targets", size = "M") => ({ id: `c${i}`, widget, size });

/** `send` must be refused with a 400 and a message, and `read` must be as it was. */
function refused(send, read, what) {
  const before = read();
  try { send(); } catch (e) {
    if (!(e instanceof api.ApiError)) throw e;
    assert(e.status === 400 && e.message, () => show([e.status, e.message]));
    equal(read(), before, "a refused save stores nothing");
    return;
  }
  throw new Error(`expected a 400 for ${what}`);
}
const bad_layout = (body) => refused(() => POST(body), () => GET()["layout"], show(body).slice(0, 120));

// ----- the layout ------------------------------------------------------------------------------------------------

test("a career with no saved layout reads as an empty one", () => {
  equal(GET(), { layout: { cards: [] } });
});

test("a layout is saved in the career and read back as sent", () => {
  const cards = [card(1), card(2, "class-needs", "S"), card(3, "program-compare", "L")];
  equal(POST({ cards })["layout"]["cards"], cards);
  equal(GET()["layout"]["cards"], cards);
  equal(api.loaded_state()["career"]["headquarters"]["cards"], cards);
});

test("a widget the server does not know is kept (a newer page's widget in an older save)", () => {
  const cards = [card(1), card(9, "future-thing", "S")];
  POST({ cards });
  equal(GET()["layout"]["cards"], cards);
});

test("a bad layout is refused with a 400 and nothing is stored", () => {
  bad_layout({ cards: [card(1, "top-targets", "XL")] });
  bad_layout({ cards: [{ id: "Bad Id", widget: "top-targets", size: "M" }] });
  bad_layout({ cards: [{ id: "c1", widget: "", size: "M" }] });
  bad_layout({ cards: Array.from({ length: 41 }, (_, i) => card(i)) });
  bad_layout({ cards: [card(1), card(1, "flags")] });
  bad_layout({ cards: "top-targets" });
  bad_layout({ cards: [["c1", "top-targets", "M"]] });
});

test("a card's chosen height saves with the layout; none is Auto; a bad height is refused", () => {
  const cards = [{ id: "c1", widget: "top-targets", size: "M", h: 640 }, card(2, "flags", "S")];
  equal(POST({ cards })["layout"]["cards"], cards);
  equal(GET()["layout"]["cards"], cards);
  for (const h of [40, 5000, "tall", true]) bad_layout({ cards: [{ id: "c1", widget: "top-targets", size: "M", h }] });
});

test("saving a layout changes nothing but the layout", () => {
  const season_only = () => {
    const st = JSON.parse(JSON.stringify(api.loaded_state()));
    delete st["career"]["headquarters"];
    delete st["career"]["saved_at"];          // the save's own clock: bookkeeping, not the season
    return JSON.stringify(st);
  };
  const before = season_only();
  POST({ cards: [card(1), card(2, "flags", "S")] });
  assert(season_only() === before);
});

// ----- the reads, four weeks in ------------------------------------------------------------------------------------

let contacted = null;

test("your commits by week add up to your class, and the movers are this week's risers and fallers", () => {
  api.call("POST", `/api/season/${sid}/advance`, { to: 4 });
  while (api.step() !== null) { /* each week */ }
  const out = GET("?want=commits,movers");
  const rv = RV();
  const rows = out["commits"];
  assert(rows.length, () => show(out));
  const weeks = rows.map((r) => r["week"]);
  assert(weeks.every(Number.isInteger) && weeks.every((w, i) => i === 0 || w >= weeks[i - 1]), () => show(weeks));
  assert(rows.at(-1)["total"] === rv["committed"], () => show([rows.at(-1), rv["committed"]]));
  for (const r of rows) assert(r["gained"] >= 0 && r["lost"] >= 0 && r["total"] >= 0, () => show(r));
  const m = out["movers"];
  equal(Object.keys(m).sort(), ["down", "up"]);
  assert(m["up"].length <= 5 && m["down"].length <= 5);
  for (const r of [...m["up"], ...m["down"]]) assert(r["places"] > 0 && r["name"] && r["position"] && r["stars"] >= 1 && r["stars"] <= 5, () => show(r));
  assert(!("commits" in GET()), "the extra reads come only when asked for");
});

test("last contacts are read from the recruiting log: the week you last reached each recruit", () => {
  const rows = api.call("GET", `/api/season/${sid}/prospects?limit=60`)["rows"];
  contacted = rows.find((r) => !r["committed"])["id"];
  api.call("POST", `/api/season/${sid}/board`, { pid: contacted, on: true });
  api.call("POST", `/api/season/${sid}/recruit`, { pid: contacted, action: "message" });
  assert(GET("?want=contacts")["contacts"][contacted] === api.loaded_state()["current_week"]);
});

test("the outlook says in words who is leaving and who might: graduation, the draft, the portal", () => {
  const o = GET("?want=outlook")["outlook"];
  const players = o["players"];
  assert(players.length && players.every((p) => p["name"] && p["position"] && p["class"]));
  for (const p of players) {
    assert(p["leaving"] ? p["transfer"] === null : ["Low", "Some", "High"].includes(p["transfer"]), () => show(p));
    assert([null, "Possible", "Likely"].includes(p["draft"]), () => show(p));
    assert((p["leaving"] === "graduation") === ["SR", "SRRS"].includes(p["class"]), () => show(p));
    assert(p["draft"] === null || ["JR", "JRRS", "SORS"].includes(p["class"]), () => show(p));
  }
  equal(o["counts"]["graduation"], players.filter((p) => p["leaving"] === "graduation").length);
  equal(o["counts"]["draft"], players.filter((p) => p["draft"] !== null).length);
  equal(o["counts"]["transfer_high"], players.filter((p) => p["transfer"] === "High").length);
});

test("each leaving player's replacement is a recruit at his group from your board, and one recruit replaces one player", () => {
  let o = GET("?want=outlook")["outlook"];
  const leaving = o["players"].filter((p) => p["leaving"] && p["group"]);
  assert(leaving.length, "a roster always has seniors");
  const g = leaving[0]["group"];
  const rows = api.call("GET", `/api/season/${sid}/prospects?limit=400`)["rows"];
  const pick = rows.find((r) => r["group"] === g && !r["committed"] && !r["on_board"]);
  api.call("POST", `/api/season/${sid}/board`, { pid: pick["id"], on: true });
  o = GET("?want=outlook")["outlook"];
  const reps = o["players"].filter((p) => p["leaving"] && p["group"] === g && p["replacement"]).map((p) => p["replacement"]);
  assert(reps.length, `a recruit on your board at ${g} replaces a leaving ${g}`);
  assert(reps.every((r) => ["Committed", "Offered", "On Board"].includes(r["status"]) && r["name"] && r["pid"]), () => show(reps));
  assert(reps.some((r) => r["pid"] === pick["id"]), () => show([pick["id"], reps]));
  const every = o["players"].filter((p) => p["replacement"]).map((p) => p["replacement"]["pid"]);
  assert(every.length === new Set(every).size, "one recruit replaces one player");
  assert(o["players"].every((p) => p["leaving"] || p["draft"] || p["transfer"] === "High" || (p["replacement"] ?? null) === null));
});

test("next year's depth chart: returning players a class up, seniors gone, your commits in their group, spots against targets", () => {
  let ny = GET("?want=next_year")["next_year"];
  const groups = Object.fromEntries(ny["groups"].map((g) => [g["group"], g]));
  const detail = RV()["needs_detail"];
  equal(Object.keys(groups).sort(), Object.keys(detail).sort());
  for (const g of Object.values(groups)) {
    assert(g["target"] === detail[g["group"]]["target"] && g["need"] === detail[g["group"]]["need"], g["group"]);
    assert(g["filled"] === g["players"].length + g["commits"].length, () => show(g));
    for (const p of g["players"]) {
      assert(!["SR", "SRRS"].includes(p["class_now"]), `a senior graduates: ${show(p)}`);
      assert(p["class_next"] === (offseason.NEXT_CLASS[p["class_now"]] ?? p["class_now"]), () => show(p));
    }
    const overalls = g["players"].map((p) => p["overall"]);
    assert(overalls.every((o, i) => i === 0 || o <= overalls[i - 1]), "best first");
  }
  // a commit shows in his group at once
  const rc = api.loaded_state()["recruiting"];
  const pid = Object.keys(rc["status"]).find((q) => !rc["status"][q]["committed"] && !rc["status"][q]["signed"]);
  rc["status"][pid]["committed"] = ME;
  try {
    ny = Object.fromEntries(GET("?want=next_year")["next_year"]["groups"].map((x) => [x["group"], x]));
    const g = recruiting.spot_of(rc["prospects"][pid]);
    assert(ny[g]["commits"].some((c) => c["pid"] === pid && c["name"] && c["stars"] >= 1 && c["stars"] <= 5), () => show(ny[g]["commits"]));
  } finally {
    rc["status"][pid]["committed"] = null;
  }
});

test("What-If shows your class rank and need if he commits, changes nothing, and matches a real commit", () => {
  const pid = contacted;
  const st = api.loaded_state();
  const before = JSON.stringify(st["recruiting"]["status"]);
  const w = GET(`?want=whatif&pid=${pid}`)["whatif"];
  assert(w["pid"] === pid && w["rank_if"] <= w["rank_now"] && w["group"] && w["need_if"] === Math.max(0, w["need_now"] - 1), () => show(w));
  assert(JSON.stringify(api.loaded_state()["recruiting"]["status"]) === before, "What-If changes nothing");
  const status = st["recruiting"]["status"][pid];
  const was = status["committed"];
  status["committed"] = ME;
  try {
    assert(prospects.class_rank(st, ME) === w["rank_if"], () => show([prospects.class_rank(st, ME), w]));
  } finally {
    status["committed"] = was;
  }
  // a recruit already yours: nothing moves
  const mine = Object.keys(st["recruiting"]["status"]).find((q) => st["recruiting"]["status"][q]["committed"] === ME);
  if (mine !== undefined) {
    const m = GET(`?want=whatif&pid=${mine}`)["whatif"];
    equal([m["rank_if"], m["need_if"]], [m["rank_now"], m["need_now"]]);
  }
  // an unknown recruit is a 404
  let e = null;
  try { GET("?want=whatif&pid=nobody"); } catch (err) { e = err; }
  assert(e instanceof api.ApiError && e.status === 404);
});

test("the three goals default from your class and program, and a target you set is kept", () => {
  let g = Object.fromEntries(GET("?want=goals")["goals"].map((x) => [x["id"], x]));
  equal(Object.keys(g).sort(), ["commits", "rank", "top100"]);
  const rv = RV();
  equal([g["commits"]["target"], g["commits"]["now"]], [rv["committed"] + rv["open_spots"], rv["committed"]]);
  if (rv["committed"]) assert(g["rank"]["now"] === rv["class_rank"] && typeof g["rank"]["met"] === "boolean");
  else equal([g["rank"]["now"], g["rank"]["met"]], [null, false], "no commits: unranked, never met");
  PLAN({ goals: { commits: 12 } });
  g = Object.fromEntries(GET("?want=goals")["goals"].map((x) => [x["id"], x]));
  assert(g["commits"]["target"] === 12 && g["rank"]["target"] > 0);
});

test("tasks are saved and read back, and saving them leaves the layout alone", () => {
  equal(GET("?want=tasks")["tasks"], []);
  const layout = GET()["layout"];
  const tasks = [{ id: "t1", text: "Call the top corner.", done: false }, { id: "t2", text: "Book a visit.", done: true }];
  PLAN({ tasks });
  equal(GET("?want=tasks")["tasks"], tasks);
  equal(GET()["layout"], layout);
});

test("a bad plan is refused with a 400 and nothing is stored", () => {
  const task = (over) => ({ id: "t1", text: "x", done: false, ...over });
  const bodies = [{ tasks: [task({ text: "" })] }, { tasks: [task({ id: "T 1" })] }, { tasks: [task({ text: "x".repeat(121) })] },
    { tasks: [task({ done: "no" })] }, { tasks: Array.from({ length: 61 }, (_, i) => task({ id: `t${i}` })) },
    { tasks: [task({ do: { kind: "teleport", pid: "x" } })] },
    { goals: { commits: 0 } }, { goals: { rank: 500 } }, { goals: { wins: 9 } }, { goals: "all" }];
  for (const body of bodies) refused(() => PLAN(body), () => GET("?want=tasks,goals"), show(body).slice(0, 80));
});

test("the promises you have open are listed in words: a starting role, and NIL that is due", () => {
  equal(GET("?want=promises")["promises"], { players: [], recruits: [] });
  const st = api.loaded_state();
  const rc = st["recruiting"];
  rc["hours"][ME] = 500;
  const pids = recruiting.prospect_list(st).filter((q) => !rc["prospects"][q]["hidden"] && !(ME in (rc["contacts"][q] || {}))
    && !rc["status"][q]["committed"] && !recruiting.would_pester(st, ME, q)).slice(0, 2);
  recruiting.act(st, ME, pids[0], "offer", null, 0, null, "promise");
  const c = recruiting._contact(st, ME, pids[1]);
  (c["promises"] ??= []).push({ kind: "money", about: { ask: 60 }, week: st["current_week"], broken: null, kept: null });
  const rows = Object.fromEntries(GET("?want=promises")["promises"]["recruits"].map((r) => [r["pid"], r]));
  equal([rows[pids[0]]["what"], rows[pids[0]]["status"]], ["Starting Role", "Open"]);
  assert(rows[pids[1]]["what"].startsWith("NIL ") && rows[pids[1]]["status"].startsWith("Due Week "), () => show(rows[pids[1]]));
});

await run();
