// The recruiting routes, called through `api.call` as the page's requests are: the Recruiting tab, the class with its
// filters and paging, a prospect's profile, an action (saved before the call returns), the board, staff areas,
// the Auto-recruit setting, the conversation a call opens, the Official Visit picker, his History, and each route's
// refusals (a bad value 400 or 422, an unknown or hidden prospect 404, no hours or a running sim 409).
// `node tests/test_recruiting_api.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { get } from "../engine_js/pyrt.js";

const game = await start();
const { api, season, recruiting } = game;
recruiting.LOCKOUT_AT = 5.0;   // the line these tests were written at: the game's own shuts more doors (test_standards holds it), and these pick recruits a mid program could then not work

const ME = "ohio-state";
const J = (v) => () => JSON.stringify(v);
const PLAIN = () => ({ personality: "business", decider: "self", decider_topic: null });   // a Guarded or Shy recruit names no topic on a call

function refused(fn, code, words = "") {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof api.ApiError)) throw e;
    assert(e.status === code && e.message.includes(words), `${e.status} ${e.message}`);
    return;
  }
  throw new Error(`expected ${code} ${words}`);
}

const sid = api.call("POST", "/api/season", { team: ME, mode: "full", seed: 11, career: true })["id"];
const G = (p) => api.call("GET", `/api/season/${sid}/${p}`);
const R = (p, body) => api.call("POST", `/api/season/${sid}/${p}`, body);
const search = (query = {}) => G(`prospects${Object.keys(query).length ? "?" : ""}${Object.entries(query).map(([k, v]) => `${k}=${v}`).join("&")}`);
const board = () => G("recruiting")["board"];
const row = (pid) => board().find((b) => b["id"] === pid);
const state = () => api.loaded_state();
const view0 = G("recruiting");
const everyone = search({ limit: 5000 })["rows"];
const top = everyone[0]["id"];

test("a new career's Recruiting tab: the first week, all hours left, an empty board, Auto-recruit off", () => {
  assert(view0["week"] === 0 && view0["hours_left"] === view0["hours"] && view0["auto_recruit"] === "off", J([view0["week"], view0["hours"]]));
  equal(view0["board"], []);
  assert(view0["open_spots"] > 0 && view0["offers_left"] > 0 && view0["nil"]["budget"] > 0);
});

test("one career is in memory: an action is saved at once, and the other career comes back from its file", () => {
  const other = api.call("POST", "/api/season", { team: "smu", mode: "full", seed: 12, career: true })["id"];
  const first = api.call("GET", `/api/season/${other}/prospects?limit=1`)["rows"][0]["id"];
  api.call("POST", `/api/season/${other}/recruit`, { pid: first, action: "message" });
  assert(state()["id"] === other);
  assert(api.call("GET", `/api/season/${sid}`)["id"] === sid && state()["id"] === sid, "the other career left memory");
  assert(Object.keys(season.load_season(other)["recruiting"]["contacts"]).length, "the message was saved before the state was dropped");
  assert(api.call("GET", `/api/season/${other}`)["id"] === other && state()["id"] === other);
  assert(api.call("GET", `/api/season/${sid}`)["id"] === sid);
  api.call("DELETE", `/api/season/${other}`);
});

test("the class: paged by national rank, filtered by state and stars, searched by name, hidden prospects left out", () => {
  const page = search({ limit: 25 });
  assert(page["total"] > 3000 && page["rows"].length === 25 && page["rows"][0]["national_rank"] === 1);
  const tx = search({ state: "TX", stars: 4, limit: 200 })["rows"];
  assert(tx.length && tx.every((r) => r["hometown"]["state"] === "TX" && r["stars"] === 4));
  refused(() => search({ stars: "four" }), 422);
  const rc = state()["recruiting"];
  const hidden = Object.keys(rc["prospects"]).find((q) => rc["prospects"][q]["hidden"] && !(q in rc["reads"]));
  assert(!everyone.some((r) => r["id"] === hidden), "a hidden prospect is listed");
  const named = search({ q: everyone[3]["name"].split(" ").at(-1).toLowerCase(), limit: 200 })["rows"];
  assert(named.some((r) => r["id"] === everyone[3]["id"]));
  refused(() => G(`prospect/${hidden}`), 404);
  refused(() => R("recruit", { pid: hidden, action: "message" }), 404);
});

test("On His List keeps the sort you picked: national rank by default, your place on his list when you sort by it", () => {
  const keen = search({ status: "interested", limit: 50 });
  assert(keen["total"] > 20 && keen["total"] < 1200 && keen["rows"].every((r) => r["list_place"] >= 1 && r["list_place"] <= 10), String(keen["total"]));
  const ranks = keen["rows"].map((r) => r["national_rank"]);
  equal(ranks, [...ranks].sort((a, b) => a - b));
  for (const q of [{ status: "interested", sort: "interest", limit: 50 }, { sort: "interest", limit: 20 }]) {
    const rows = search(q)["rows"];
    const listed = rows.filter((r) => r["list_place"] !== null), open = rows.filter((r) => r["list_place"] === null);
    equal(rows, [...listed, ...open], "the recruits whose list you are on come first");
    equal(listed.map((r) => r["list_place"]), listed.map((r) => r["list_place"]).sort((a, b) => a - b));
    equal(open.map((r) => r["interest_in_you"]), open.map((r) => r["interest_in_you"]).sort((a, b) => b - a));
  }
});

test("every school's class is ranked, yours marked; an unknown school is not found", () => {
  const classes = G("classes");
  assert(classes["schools"].length >= 130 && classes["schools"][0]["rank"] === 1 && classes["phase"] === "Recruiting");
  assert(classes["schools"].find((c) => c["school"] === ME)["yours"] === true);
  refused(() => G("classes?school=nope"), 404);
});

test("a profile never carries his true grades; an unknown prospect is not found", () => {
  const prof = G(`prospect/${top}`);
  assert(prof["public"]["id"] === top && !("truth" in prof["public"]) && prof["public"]["on_board"] === false);
  refused(() => G("prospect/r2027-9999"), 404);
});

test("an action is saved before the call returns; a bad action, a missing one and an unknown prospect are refused", () => {
  api.changed();
  const r = R("recruit", { pid: top, action: "call", pitch: "prestige" });
  assert(r["hours_left"] === view0["hours"] - recruiting.HOURS["call"] && api.changed());
  const on_disk = season.load_season(sid)["recruiting"];
  assert(on_disk["hours"][ME] === view0["hours"] - recruiting.HOURS["call"], "the call was not saved");
  assert(on_disk["contacts"][top][ME]["n"] === 1);
  refused(() => R("recruit", { pid: "r2027-9999", action: "call" }), 404);
  refused(() => R("recruit", { pid: top, action: "dance" }), 400);
  refused(() => R("recruit", { pid: top }), 422);
});

test("the board: a prospect goes on and comes off, and an offered row carries your standing with him", () => {
  R("board", { pid: top, on: true });
  equal(board().map((b) => b["id"]), [top]);
  assert(G(`prospect/${top}`)["public"]["on_board"] === true);
  R("recruit", { pid: top, action: "offer" });
  const v = G("recruiting");
  const s = v["board"][0]["standing"];
  assert(s["place"] >= 1 && s["of"] >= s["place"] && 0 <= s["lo"] && s["lo"] <= s["pct"] && s["pct"] <= s["hi"] && s["hi"] <= 1 && s["certainty"], J(s));
  equal(new Set(Object.keys(v["area_counts"])), new Set(Object.keys(v["areas"])));
  assert(v["area_counts"]["Texas"] > 100 && v["class_rank"] >= 1 && v["hours_used"] === v["hours"] - v["hours_left"] && v["targets"][0]["id"] === top);
  assert(G(`prospect/${top}`)["public"]["schools"].some((x) => x["school"] === ME && x["pct"] !== null));
  R("recruit", { pid: top, action: "pull_offer" });
  R("board", { pid: top, on: false });
  equal(board(), []);
});

test("a staff member is assigned an area; an unknown area or none is refused", () => {
  const staff = R("staff", { staff_id: "r1", area: "Texas" });
  assert(staff["staff"].find((s) => s["id"] === "r1")["area"] === "Texas");
  refused(() => R("staff", { staff_id: "r1", area: "Atlantis" }), 400);
  refused(() => R("staff", { staff_id: "r1" }), 422);
});

test("a call without a pitch opens a conversation: present three topics, answer him, pitch one, and it is over", () => {
  const talk = everyone[5]["id"];
  state()["recruiting"]["prospects"][talk]["persona"] = PLAIN();
  let sc = R("recruit", { pid: talk, action: "call" })["scene"];
  assert(sc["id"] && sc["action"] === "call" && "question" in sc && sc["cue"] === null && sc["presented"] === null, J(sc));
  refused(() => R("recruit", { pid: talk, action: "pitch", scene: sc["id"], pitch: "winning" }), 409);
  refused(() => R("recruit", { pid: talk, action: "present", scene: sc["id"], topics: ["winning", "nil"] }), 400);
  refused(() => R("recruit", { pid: talk, action: "present", scene: sc["id"], topics: "winning" }), 422);
  refused(() => R("recruit", { pid: talk, action: "present", scene: "nope", topics: ["winning", "nil", "coach"] }), 409);
  const st = state();
  const pri = st["recruiting"]["prospects"][talk]["priorities"], str = recruiting.strengths(st, ME, talk);
  const strong = pri.filter((t) => str[t] >= recruiting.BACKFIRE), weak = pri.filter((t) => str[t] < recruiting.BACKFIRE);
  const three = [...(strong.length ? strong.slice(0, 1) : weak.slice(0, 1)), ...recruiting.PITCHES.filter((t) => !pri.includes(t)).slice(0, 2)];
  const pr = R("recruit", { pid: talk, action: "present", scene: sc["id"], topics: three });
  sc = pr["scene"];
  equal(sc["presented"], three);
  if (strong.length) assert(pr["points"] > 0 && pr["hit"][0] === strong[0] && sc["present"]["kind"] === "hit", J(pr));
  else assert(pr["points"] < 0 && pr["hit"].length === 0 && sc["present"]["kind"] === "quiet", J(pr));
  assert(Math.abs(recruiting.pending(st, ME, talk) - pr["points"]) < 1e-9);
  refused(() => R("recruit", { pid: talk, action: "present", scene: sc["id"], topics: three }), 409);
  equal(st["recruiting"]["scenes"][ME][talk]["presented"], three, "the scene remembers your opening, so Finish can resume it");
  if (sc["question"]) {                                   // he asked about a named player: the pitch waits on an answer
    refused(() => R("recruit", { pid: talk, action: "pitch", scene: sc["id"], pitch: pri[0] }), 409, "answer him first");
    assert(R("recruit", { pid: talk, action: "answer", scene: sc["id"], answer: "deflect" })["points"] === 0.0);
  }
  const r = R("recruit", { pid: talk, action: "pitch", scene: sc["id"], pitch: pri[0] });
  assert(["hit", "polite", "quiet"].includes(r["reaction"]["kind"]) && r["reaction"]["text"], J(r["reaction"]));
  refused(() => R("recruit", { pid: talk, action: "pitch", scene: sc["id"], pitch: "nil" }), 409);
});

test("an open conversation rides on his board row, and turning Auto-recruit on drops it", () => {
  const held = everyone[6]["id"];
  R("board", { pid: held, on: true });
  const sc = R("recruit", { pid: held, action: "call" })["scene"];
  assert(row(held)["scene"]["id"] === sc["id"]);
  R("settings", { auto_recruit: "week" });
  assert(board().every((b) => b["scene"] === null));
  R("settings", { auto_recruit: "off" });
  R("board", { pid: held, on: false });
});

test("the Auto-recruit setting is off, week or season (true from an older page means season); anything else is refused", () => {
  assert(R("settings", { auto_recruit: "season" })["auto_recruit"] === "season" && G("recruiting")["auto_recruit"] === "season");
  R("settings", { auto_recruit: "off" });
  R("settings", { auto_recruit: true });
  assert(G("recruiting")["auto_recruit"] === "season");
  R("settings", { auto_recruit: "off" });
  refused(() => R("settings", { auto_recruit: "forever" }), 400);
  refused(() => R("settings", { auto_recruit: 3 }), 422);
});

test("Auto-recruit for a week works from your board, logs its contacts as yours, then turns itself off", () => {
  assert(R("settings", { auto_recruit: "week" })["auto_recruit"] === "week");
  const st = state(), rc = st["recruiting"];
  const before = get(rc["offers"], ME, []).length;
  const mine = search({ stars: 4, state: "OH", limit: 5 })["rows"][0]["id"];       // one you picked
  R("board", { pid: mine, on: true });
  recruiting.weekly_step(st, 1);
  assert(G("recruiting")["auto_recruit"] === "off");
  assert(rc["offers"][ME].length > before, "Auto-recruit for the week did nothing");
  assert(rc["log"].some((e) => e["kind"] === "contact" && e["school"] === ME), "Auto-recruit's contacts are not logged");
  const yours = ["contact", "pitch", "raise_nil", "pull_offer"];
  assert(rc["log"].every((e) => !yours.includes(e["kind"]) || e["school"] === ME), "another school's contact was logged");
  const ids = new Set(board().map((b) => b["id"]));
  assert(rc["offers"][ME].includes(mine), "Auto-recruit skipped a prospect on your board");
  assert(rc["offers"][ME].every((q) => ids.has(q)), "Auto-recruit offered prospects you cannot see");
});

test("a prospect you take off your board stays off through Auto-recruit's next week, until you put him back", () => {
  const st = state(), rc = st["recruiting"];
  const gone = rc["offers"][ME].find((q) => !rc["status"][q]["hard"]);
  R("board", { pid: gone, on: false });
  R("settings", { auto_recruit: "week" });
  recruiting.weekly_step(st, 2);
  assert(!board().some((b) => b["id"] === gone), "a removed prospect came back to the board");
  R("board", { pid: gone, on: true });
  assert(board().some((b) => b["id"] === gone));
});

test("an in-home visit tells you one thing he cares about, the official visit all three", () => {
  const st = state(), rc = st["recruiting"];
  const known = (q) => get(get(rc["revealed"], ME, {}), q, []);
  rc["hours"][ME] = 200;
  const pid = search({ stars: 3, state: "CA", limit: 50 })["rows"].map((r) => r["id"]).find((q) => !known(q).length && !(q in rc["visits"]));
  recruiting._act(st, ME, pid, "hc_visit");
  assert(known(pid).length === 1, J(known(pid)));
  recruiting._act(st, ME, pid, "official_visit");
  const week = rc["visits"][pid][ME]["week"];
  const home = Object.values(st["games"]).find((g) => g["week"] === week && g["home"] === ME);
  Object.assign(home, { played: true, home_score: 31, away_score: 10 });     // the visit's home game, as if just played
  recruiting._visits(st, week);
  home["played"] = false;
  assert(known(pid).length === 3, J(known(pid)));
});

test("the Official Visit picker lists your home weekends and books the one you pick; a taken or missing weekend is refused", () => {
  const st = state(), rc = st["recruiting"];
  const pid = search({ stars: 3, state: "TX", limit: 50 })["rows"].map((r) => r["id"]).find((q) => !(q in rc["visits"]) && !rc["status"][q]["committed"]);
  R("board", { pid, on: true });
  rc["hours"][ME] = 100;
  const weeks = row(pid)["visit_weeks"];
  assert(weeks.length && weeks[0]["first"] && weeks.every((w) => w["taken_by"] === null), J(weeks));
  const keys = ["week", "label", "opponent", "opponent_name", "opponent_rank", "taken_by", "first"];
  assert(weeks.every((w) => keys.every((k) => k in w)), J(weeks[0]));
  refused(() => R("recruit", { pid, action: "official_visit", week: "soon" }), 422);
  const top_group = recruiting.top_group;
  recruiting.top_group = () => [ME];                      // he is considering you
  try {
    refused(() => R("recruit", { pid, action: "official_visit", week: 99 }), 409, "not a home weekend");
    if (weeks.length >= 2) {
      rc["visits"][pid] = { michigan: { week: weeks[1]["week"], done: false } };
      assert(row(pid)["visit_weeks"][1]["taken_by"] === "Michigan");
      refused(() => R("recruit", { pid, action: "official_visit", week: weeks[1]["week"] }), 409, "He is visiting");
    }
    R("recruit", { pid, action: "official_visit", week: weeks.at(-1)["week"] });
    equal(rc["visits"][pid][ME], { week: weeks.at(-1)["week"], done: false });
  } finally {
    recruiting.top_group = top_group;
  }
  R("board", { pid, on: false });
});

test("out of hours, the next action is refused", () => {
  state()["recruiting"]["hours"][ME] = recruiting.HOURS["message"] - 1;
  const pid = everyone[30]["id"];
  refused(() => R("recruit", { pid, action: "message" }), 409, "Not enough energy");
  state()["recruiting"]["hours"][ME] = 100;
});

test("while a sim runs, every recruiting change and every recruiting view is refused", () => {
  api.job()["status"] = "running";
  try {
    refused(() => R("recruit", { pid: top, action: "message" }), 409);
    refused(() => R("board", { pid: top, on: true }), 409);
    refused(() => R("staff", { staff_id: "r1", area: "Florida" }), 409);
    refused(() => G("recruiting"), 409);
    refused(() => search(), 409);
    refused(() => G(`prospect/${top}`), 409);
  } finally {
    api.job()["status"] = "idle";
  }
});

test("a malformed season file never breaks the list of seasons", () => {
  const file = `${season.SEASONS_DIR}/zzbadfile0001.json`;
  game.files.write_text(file, '{"current_week": 1, "id": "zzbadfile0001"}');
  try {
    assert(api.call("GET", "/api/seasons")["seasons"].some((x) => x["id"] === sid));
  } finally {
    game.files.remove(file);
  }
});

test("his History is every action you took on him, newest first, with other schools' offers but not their contacts", () => {
  const log = api.call("POST", "/api/season", { team: ME, mode: "full", seed: 13, career: true })["id"];
  const GL = (p) => api.call("GET", `/api/season/${log}/${p}`);
  const RL = (p, body) => api.call("POST", `/api/season/${log}/${p}`, body);
  const [a, b] = GL("prospects?limit=40")["rows"].slice(20, 22).map((r) => r["id"]);
  for (const q of [a, b]) RL("board", { pid: q, on: true });
  const hist = (q) => GL("recruiting")["board"].find((x) => x["id"] === q)["history"];
  equal([hist(a), hist(b)], [[], []], "an untouched recruit has an empty history");
  RL("recruit", { pid: a, action: "message" });
  const st = state();
  st["recruiting"]["prospects"][a]["persona"] = PLAIN();
  let sc = RL("recruit", { pid: a, action: "call" })["scene"];
  sc = RL("recruit", { pid: a, action: "present", scene: sc["id"], topics: ["winning", "nil", "coach"] })["scene"];
  if (sc["question"]) RL("recruit", { pid: a, action: "answer", scene: sc["id"], answer: "deflect" });
  const said = RL("recruit", { pid: a, action: "pitch", scene: sc["id"], pitch: "winning" })["reaction"]["kind"];
  RL("recruit", { pid: a, action: "offer", nil: 120 });
  RL("recruit", { pid: a, action: "raise_nil", nil: 150 });
  // (a backfiring pitch may add a not_buying line, his question an answer, a first call something learned about him)
  let h = hist(a).filter((x) => !["not_buying", "answer", "learned"].includes(x["kind"]));
  equal(h.map((x) => [x["kind"], x["action"] ?? null, x["pitch"] ?? null, x["reaction"] ?? null, x["nil"] ?? null]), [
    ["raise_nil", null, null, null, 150], ["offer", null, null, null, 120], ["pitch", "call", "winning", said, null],
    ["present", "call", null, null, null], ["contact", "call", null, null, null], ["contact", "message", null, null, null],
  ]);
  assert(h.every((x) => x["week"] === 0 && x["school"] === ME), J(h));
  const pres = h.find((x) => x["kind"] === "present");
  equal(pres["topics"], ["winning", "nil", "coach"]);
  assert(Number.isInteger(pres["hit"]));
  equal(hist(b), [], "his history is his alone");
  recruiting._act(st, "michigan", a, "offer", "winning");
  recruiting._act(st, "michigan", a, "message", "winning");
  equal(hist(a).slice(0, 2).map((x) => [x["kind"], x["school"]]), [["offer", "michigan"], ["raise_nil", ME]]);
  // a long career: his last 40 entries, newest first
  const close = recruiting.close_week;
  recruiting.close_week = () => 99;                       // fifty working weeks on end: the dead period is not what this counts
  try {
    for (let w = 1; w <= 50; w++) {
      st["current_week"] = w;
      st["recruiting"]["hours"] = {};
      RL("recruit", { pid: a, action: "message" });
    }
    h = hist(a);
  } finally {
    recruiting.close_week = close;
  }
  assert(h.length === 40 && h[0]["week"] === 50 && h.at(-1)["week"] >= 11, J([h.length, h[0], h.at(-1)]));
  equal(h.map((x) => x["week"]), h.map((x) => x["week"]).sort((x, y) => y - x));
  api.call("DELETE", `/api/season/${log}`);
});

await run();
