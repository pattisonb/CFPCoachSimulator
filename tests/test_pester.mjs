// Pestering a recruit who is not interested costs you (recruiting PESTER_*), and the pitch marks that keep you from
// pitching a dud twice. After PESTER_FREE contacts to a prospect who is not considering your school, each further
// message, call or in-home visit lands negative on his list, costs more than the last and raises his ask; a prospect
// who is considering you never pesters, and Auto-recruit for your school never does it. Through the API, as the page
// calls it. A pitch mark is what he said about each topic you pitched him: He Lit Up, Weak Case, Not His Thing, No Read.
// `node tests/test_pester.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { get } from "../engine_js/pyrt.js";

const game = await start();
const { api, recruiting } = game;
const { prospects } = game.modules;

const ME = "ohio-state";
const J = (v) => () => JSON.stringify(v);
const PLAIN = () => ({ personality: "business", decider: "self", decider_topic: null });   // a plain recruit: three free contacts and the plain rules

const sid = api.call("POST", "/api/season", { team: ME, mode: "full", seed: 11, career: true })["id"];
const G = (p) => api.call("GET", `/api/season/${sid}/${p}`);
const R = (p, body) => api.call("POST", `/api/season/${sid}/${p}`, body);
const board_of = (pid) => G("recruiting")["board"].find((b) => b["id"] === pid);
const st = api.loaded_state(), rc = st["recruiting"];
const by_rank = () => Object.keys(rc["prospects"]).sort((a, b) => rc["prospects"][a]["rank"] - rc["prospects"][b]["rank"]);

/** A four-star far from Ohio, uncommitted and untouched by you, whose leader is far enough ahead that three contacts'
 *  worth of points leave him not considering you. */
function far_prospect() {
  for (const pid of by_rank()) {
    const p = rc["prospects"][pid];
    if (p["stars"] !== 4 || !["CA", "WA", "OR", "AZ"].includes(p["hometown"]["state"]) || p["hidden"]) continue;
    if (ME in rc["lists"][pid] || get(rc["offers"], ME, []).includes(pid) || rc["status"][pid]["committed"] !== null || !Object.keys(rc["lists"][pid]).length) continue;
    if (recruiting.ask_from(st, ME, pid) < 30) continue;
    const lead = Math.max(...Object.keys(rc["lists"][pid]).map((s) => recruiting.interest(st, s, pid)));
    if (recruiting.interest(st, ME, pid) + 12 < recruiting.PESTER_SHARE * lead && recruiting.not_considering(st, ME, pid)) {
      p["persona"] = PLAIN();
      return pid;
    }
  }
  throw new Error("no far prospect fits the test");
}

let pid, name, pester1, landed1;

test("three contacts to a recruit who is not considering you are free, and the board warns that the next one pesters", () => {
  recruiting.weekly_step(st, 0);                          // the other schools' first week fills the lists
  pid = far_prospect();
  name = rc["prospects"][pid]["name"];
  R("board", { pid, on: true });
  const off = recruiting.PITCHES.find((t) => !rc["prospects"][pid]["priorities"].includes(t));   // a pitch off his priorities: small points
  st["current_week"] = 1;
  rc["hours"][ME] = 200;
  R("recruit", { pid, action: "message" });
  R("recruit", { pid, action: "call", pitch: off });
  assert(board_of(pid)["pestering"] === false, "two contacts are not pestering yet");
  R("recruit", { pid, action: "hc_visit", pitch: off });
  assert(rc["contacts"][pid][ME]["n"] === recruiting.PESTER_FREE);
  assert(recruiting.pending(st, ME, pid) > 0, "the free contacts still count for you");
  assert(recruiting.not_considering(st, ME, pid), "the test needs a prospect who is not considering you");
  const b = board_of(pid);
  assert(b["pestering"] === true && b["pesters"] === 0, J([b["pestering"], b["pesters"]]));
  assert(!rc["log"].some((e) => e["kind"] === "pester"), "the free contacts logged a pester");
  recruiting.weekly_step(st, 1);
  landed1 = rc["lists"][pid][ME];
  assert(landed1 > 0);
});

test("the fourth contact pesters: it lands negative, is logged, raises his ask, and the weekly report says so once", () => {
  st["current_week"] = 2;
  const ask0 = recruiting.ask_from(st, ME, pid);
  R("recruit", { pid, action: "message" });
  pester1 = recruiting.pending(st, ME, pid);
  assert(pester1 === -recruiting.PESTER_COST * recruiting.BASE_POINTS["message"], String(pester1));
  const events = rc["log"].filter((e) => e["kind"] === "pester" && e["pid"] === pid);
  assert(events.length === 1 && events[0]["school"] === ME && events[0]["action"] === "message" && events[0]["n"] === 1, J(events));
  assert(rc["contacts"][pid][ME]["pester"] === 1 && recruiting.ask_from(st, ME, pid) > ask0, "his ask from you goes up");
  const b = board_of(pid), prof = G(`prospect/${pid}`);
  assert(b["pestering"] === true && b["pesters"] === 1 && prof["pestering"] === true && prof["pesters"] === 1);
  recruiting.weekly_step(st, 2);
  assert(rc["lists"][pid][ME] < landed1, "the pester did not land negative on his list");
  const row = recruiting.latest_report(st)["rows"].find((r) => r["pid"] === pid);
  const lines = row["events"].filter((e) => e["kind"] === "pester");
  assert(lines.length === 1 && lines[0]["line"].startsWith(`${name} is tuning you out`) && lines[0]["line"].includes("Ohio State"), J(lines));
  assert(G("recruiting")["report"]["rows"].some((r) => r["events"].some((e) => e["kind"] === "pester" && get(e, "line"))));
});

test("each pester costs more than the last, and a pestering call earns nothing: he is tired of you", () => {
  st["current_week"] = 3;
  rc["hours"][ME] = 200;
  R("recruit", { pid, action: "message" });
  const pester2 = recruiting.pending(st, ME, pid);
  assert(pester2 < pester1 && pester1 < 0, J([pester1, pester2]));
  assert(pester2 === -recruiting.PESTER_COST * recruiting.BASE_POINTS["message"] * (1 + recruiting.PESTER_RAMP), String(pester2));
  let sc = R("recruit", { pid, action: "call" })["scene"];
  assert(sc["tired"] === true, "a pestering call opens short");
  const pr = R("recruit", { pid, action: "present", scene: sc["id"], topics: ["winning", "nil", "coach"] });
  assert(pr["points"] === 0.0 && pr["scene"]["present"]["kind"] === "tired", J(pr["scene"]["present"]));
  sc = pr["scene"];
  if (get(sc, "question")) sc = R("recruit", { pid, action: "answer", scene: sc["id"], answer: "deflect" })["scene"];
  const r = R("recruit", { pid, action: "pitch", scene: sc["id"], pitch: "winning" });
  assert(r["reaction"]["kind"] === "tired" && r["reaction"]["text"], J(r["reaction"]));
  assert(recruiting.pending(st, ME, pid) < pester2, "the pestering call cost nothing");
  assert(rc["contacts"][pid][ME]["pester"] === 3);
});

test("a recruit who is considering you never pesters, however often you contact him, and his old pesters are forgotten", () => {
  const near = by_rank().find((q) => {
    const p = rc["prospects"][q];
    return p["hometown"]["state"] === "OH" && p["stars"] === 4 && !p["hidden"] && rc["status"][q]["committed"] === null && !(ME in rc["lists"][q])
      && !get(rc["offers"], ME, []).includes(q) && !recruiting.not_considering(st, ME, q);
  });
  R("board", { pid: near, on: true });
  ((rc["contacts"][near] ||= {})[ME] ||= { n: 0, hc_week: null })["n"] = recruiting.PESTER_FREE + 2;
  rc["lists"][near][ME] = 5.0;                            // as five landed contacts would have left him
  R("recruit", { pid: near, action: "message" });
  assert(!recruiting.not_considering(st, ME, near) && board_of(near)["pestering"] === false);
  assert(recruiting.pending(st, ME, near) > 0 && !rc["log"].some((e) => e["kind"] === "pester" && e["pid"] === near));
  rc["contacts"][near][ME]["pester"] = 2;
  recruiting.weekly_step(st, 3);
  assert(get(rc["contacts"][near][ME], "pester", 0) === 0, "a later slide does not carry the old pesters");
});

test("Auto-recruit for your school never pesters", () => {
  R("settings", { auto_recruit: "season" });
  const start_ = rc["log"].length;
  for (const week of [4, 5, 6]) {
    st["current_week"] = week;
    recruiting.weekly_step(st, week);
  }
  const added = rc["log"].slice(start_);
  assert(added.some((e) => e["kind"] === "contact" && e["school"] === ME), "Auto-recruit made no contact");
  assert(!added.some((e) => e["kind"] === "pester"), J(added.filter((e) => e["kind"] === "pester")));
  R("settings", { auto_recruit: "off" });
});

// ----- pitch marks -----------------------------------------------------------------------------------------------------------

const some = () => Object.keys(rc["prospects"]).filter((q) => !rc["prospects"][q]["hidden"] && !rc["log"].some((e) => e["pid"] === q)).slice(0, 3);
const log = (q, kind, more) => rc["log"].push({ week: st["current_week"], kind, pid: q, school: ME, ...more });

test("a pitch mark is what he said about each topic: lit up, weak case, not his thing, or no read; the latest real read wins", () => {
  const [q] = some();
  equal(recruiting.pitch_marks(st, ME, q), {}, "never pitched: no marks");
  log(q, "pitch", { action: "call", pitch: "nil", reaction: "polite", week: 2 });
  log(q, "pitch", { action: "call", pitch: "coach", reaction: "quiet", week: 3 });
  log(q, "pitch", { action: "call", pitch: "winning", reaction: "guarded", week: 3 });
  log(q, "pitch", { action: "call", pitch: "winning", reaction: "hit", week: 4 });
  log(q, "pitch", { action: "call", pitch: "prestige", reaction: "hit", week: 4 });
  log(q, "pitch", { action: "call", pitch: "prestige", reaction: "tired", week: 5 });      // a No Read never hides a real one
  log(q, "present", { action: "call", topics: ["proximity", "nil", "pro"], week: 5 });
  log(q, "pitch", { action: "call", pitch: "academics", reaction: "polite", school: "michigan" });   // another school's: not yours
  const m = recruiting.pitch_marks(st, ME, q);
  equal(Object.fromEntries(Object.entries(m).map(([t, v]) => [t, v["mark"]])),
    { nil: "not_his", coach: "weak", winning: "hit", prestige: "hit", proximity: "no_read", pro: "no_read" });
  assert(m["nil"]["week"] === 2 && m["coach"]["action"] === "call");
  log(q, "pitch", { action: "hc_visit", pitch: "coach", reaction: "hit", week: 6 });
  assert(recruiting.pitch_marks(st, ME, q)["coach"]["mark"] === "hit");
  assert(prospects.profile(st, q, ME)["public"]["pitch_marks"]["nil"]["mark"] === "not_his", "on his profile");
  assert(prospects.board_row(st, q, ME)["pitch_marks"]["nil"]["mark"] === "not_his", "and on his board row");
});

test("the marks for a whole board read the log once, and a new log line is still seen", () => {
  const pids = some();
  log(pids[0], "pitch", { action: "call", pitch: "nil", reaction: "polite" });
  let calls = 0;
  const real = recruiting._marks_index;
  recruiting._marks_index = (...a) => { calls++; return real(...a); };
  try {
    for (const q of pids) recruiting.pitch_marks(st, ME, q);
  } finally {
    recruiting._marks_index = real;
  }
  assert(calls === 1, `the log was read ${calls} times for one board`);
  log(pids[1], "pitch", { action: "call", pitch: "coach", reaction: "hit" });
  assert(recruiting.pitch_marks(st, ME, pids[1])["coach"]["mark"] === "hit");
});

await run();
