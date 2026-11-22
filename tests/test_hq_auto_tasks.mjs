// Recruiting tasks that tick themselves off (career_js/headquarters.js: tasks, set_plan). A task added from a
// suggestion carries what it asks (`do`); Headquarters checks it against what you did since and ticks it done
// (`auto`). One that no longer applies (he committed elsewhere) keeps its place with a note. A task never drops off
// your list, and a tick you took off yourself stays off.
// `node tests/test_hq_auto_tasks.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";

const game = await start();
const { season, recruiting } = game;
const hq = game.modules.headquarters;

const ME = "iowa";
const show = (v) => JSON.stringify(v);
const st = season.new_season(ME, "full", 5, undefined, undefined, true);
const rc = st["recruiting"];
const taken = new Set();

/** Each test starts in Week 1 with an empty task list and energy to spend, on recruits no earlier test touched. */
function fresh(n = 1, want = () => true) {
  st["current_week"] = 1;
  rc["hours"][ME] = 1000;
  rc["scout_points"] = { [ME]: 100 };
  hq._hq(st)["tasks"] = [];
  const by_rank = Object.keys(rc["prospects"]).sort((a, b) => rc["prospects"][a]["rank"] - rc["prospects"][b]["rank"]).slice(40);
  const out = by_rank.filter((q) => !taken.has(q) && !rc["prospects"][q]["hidden"] && !rc["status"][q]["committed"] && want(q)).slice(0, n);
  for (const q of out) taken.add(q);
  return out;
}

function add(tid, kind, pid, extra = {}) {
  const t = { id: tid, text: `Do ${kind} for ${pid}.`, done: false, do: { kind, pid, ...extra }, since: st["current_week"] };
  hq.set_plan(st, { tasks: [...hq.tasks(st), t] });
}
const task = (tid) => hq.tasks(st).find((t) => t["id"] === tid);

/** A whole call: the conversation opened, your three things, his question answered, your pitch. */
function call(pid) {
  let sc = recruiting.act(st, ME, pid, "call")["scene"];
  sc = recruiting.act(st, ME, pid, "present", null, 0, sc["id"], null, recruiting.PITCHES.slice(0, 3))["scene"];
  if (sc["question"]) recruiting.act(st, ME, pid, "answer", null, 0, sc["id"], "straight");
  recruiting.act(st, ME, pid, "pitch", "winning", 0, sc["id"]);
}

test("a task to call him ticks itself once you call", () => {
  const [pid] = fresh();
  add("t1", "call", pid);
  assert(!task("t1")["done"]);
  call(pid);
  const t = task("t1");
  assert(t["done"] && t["auto"], () => show(t));
});

test("a task to put NIL on him ticks once your offer holds that much, not before", () => {
  const [pid] = fresh(1, (q) => recruiting.ask_from(st, ME, q) >= 15);
  add("t1", "nil", pid, { nil: 10 });
  recruiting.act(st, ME, pid, "offer", null, 5);
  assert(!task("t1")["done"], "5 of 10 is not done");
  recruiting.act(st, ME, pid, "raise_nil", null, 10);
  assert(task("t1")["done"]);
});

test("a task to scout him ticks once you send a scout", () => {
  const [pid] = fresh();
  add("t1", "scout", pid);
  assert(!task("t1")["done"]);
  recruiting.act(st, ME, pid, "scout");
  assert(task("t1")["done"]);
});

test("a task to pull your offer ticks once the offer is gone", () => {
  const [pid] = fresh();
  recruiting.act(st, ME, pid, "offer");
  add("t1", "pull", pid);
  assert(!task("t1")["done"]);
  recruiting.act(st, ME, pid, "pull_offer");
  assert(task("t1")["done"]);
});

test("a task to leave him alone ticks after a week with no contact, and not if you called", () => {
  const [a, b] = fresh(2);
  add("t1", "leave", a);
  add("t2", "leave", b);
  call(b);                                             // you did not leave him alone
  assert(!task("t1")["done"], "not before the week has passed");
  st["current_week"] += 1;
  assert(task("t1")["done"] && !task("t2")["done"], () => show([task("t1"), task("t2")]));
});

test("leaving him alone counts from when the task was added, and a scouting trip is not contact", () => {
  const [a] = fresh();
  call(a);                                             // the contact that made him tune you out, earlier the same week
  add("t1", "leave", a);
  recruiting.act(st, ME, a, "scout");
  st["current_week"] += 1;
  assert(task("t1")["done"], () => show(task("t1")));
});

test("in the portal the portal's own week is the clock: wait and leave tick when it moves", () => {
  const [a, b] = fresh(2);
  const open_spots = recruiting.open_spots;
  recruiting.open_spots = () => 10;                    // a faked portal has no next-year league to count spots from
  rc["portal"] = true; rc["week"] = 1;                 // the season's week stands still, the portal's moves
  try {
    add("t1", "wait", a);
    add("t2", "leave", b);
    assert(!task("t1")["done"] && !task("t2")["done"]);
    rc["week"] = 2;
    assert(task("t1")["done"] && task("t2")["done"], () => show([task("t1"), task("t2")]));
  } finally {
    recruiting.open_spots = open_spots;
    delete rc["portal"]; delete rc["week"];
  }
});

test("a task that no longer applies keeps its place with a note, which goes if he decommits", () => {
  const [pid] = fresh();
  add("t1", "call", pid);
  rc["status"][pid]["committed"] = "ohio-state";
  const t = task("t1");
  assert(!t["done"] && t["note"] === "No longer needed: he committed to Ohio State.", () => show(t));
  assert(hq.tasks(st).some((x) => x["id"] === "t1"), "your task never vanishes");
  hq.set_plan(st, { tasks: hq.tasks(st) });           // the page saves the list back, note and all
  assert(task("t1")["note"]);
  rc["status"][pid]["committed"] = null;
  assert(!task("t1")["note"], () => show(task("t1")));
});

test("a tick you took off yourself stays off", () => {
  const [pid] = fresh();
  add("t1", "scout", pid);
  recruiting.act(st, ME, pid, "scout");
  const ts = hq.tasks(st);
  assert(ts[0]["done"]);
  Object.assign(ts[0], { done: false, manual: true });
  hq.set_plan(st, { tasks: ts });
  assert(!task("t1")["done"], "your untick holds");
});

test("a task you wrote yourself is never ticked for you", () => {
  fresh(0);
  hq.set_plan(st, { tasks: [{ id: "t1", text: "Watch film.", done: false }] });
  st["current_week"] += 3;
  equal(task("t1"), { id: "t1", text: "Watch film.", done: false });
});

test("a suggested task asking for something the game does not know is refused, and nothing is stored", () => {
  fresh(0);
  let e = null;
  try { hq.set_plan(st, { tasks: [{ id: "t1", text: "x", done: false, do: { kind: "teleport", pid: "x" } }] }); } catch (err) { e = err; }
  assert(e instanceof hq.LayoutError);
  equal(hq.tasks(st), []);
});

await run();
