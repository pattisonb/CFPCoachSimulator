// His NIL ask is your scouts' to learn (career_js/recruiting/ ask_known, ask_view): a wide range before your staff has
// looked at him, a narrower one once his report holds a look, the number at a complete report. Nothing he says tells
// you: not a call, an in-home visit, an official visit or a money talk; a save from before this that holds a number he
// "told" you reads from his report like any other. His number is not the middle of the range you are shown, the money
// you owe after talking money is shown as you know his ask, your staff on Auto offers from what your scouting knows,
// and the transfer portal follows the same rule.
// `node tests/test_ask_scouted.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, get, round, sorted } from "../engine_js/pyrt.js";

const game = await start();
const { season, recruiting, api } = game;
const { prospects, scenes, persona } = game.modules;

const ME = "iowa";
const J = (v) => () => JSON.stringify(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

let base = null;
/** A career in Week 1 with hours to burn (each test gets a copy of its own). */
function fresh() {
  if (!base) {
    base = season.new_season(ME, "full", 5, undefined, undefined, true);
    base["current_week"] = 1;
    base["recruiting"]["hours"][ME] = 1000;
  }
  recruiting.reset_caches();
  return clone(base);
}
function ranked(st) {
  const rc = st["recruiting"];
  return Object.keys(rc["prospects"]).sort((a, b) => rc["prospects"][a]["rank"] - rc["prospects"][b]["rank"])
    .filter((q) => !rc["prospects"][q]["hidden"] && !rc["status"][q]["committed"]);
}
const act = (st, pid, action, o = {}) => recruiting.act(st, ME, pid, action, o.pitch ?? null, o.nil ?? 0, o.scene ?? null, o.answer ?? null, o.topics ?? null);
/** Your staff's looks at him: `n` scouting trips' worth (three complete his report). */
function scout(st, pid, n) {
  for (let i = 0; i < n; i++) recruiting.look(st, pid, 80, new Random(`test-look-${pid}-${i}`));
}
const ask_of = (st, pid) => recruiting.ask_from(st, ME, pid, undefined, true);
const view = (st, pid) => recruiting.ask_view(st, ME, pid, true);
const width = (v) => v["hi"] - v["lo"];
/** An unscouted prospect with a real ask and no quirks that keep a call quiet. */
function target(st, min = 40) {
  const pid = ranked(st).find((q) => ask_of(st, q) >= min && !get(st["recruiting"]["reads"], q));
  assert(pid !== undefined, "no prospect fits");
  st["recruiting"]["prospects"][pid]["persona"] = { ...persona.of(st, pid), personality: "business", decider: "self", decider_topic: null };
  return pid;
}

test("a wide range before scouting, a narrower one once he has a look, the number at a complete report", () => {
  const st = fresh(), pid = target(st), ask = ask_of(st, pid);
  const wide = view(st, pid);
  assert(!("exact" in wide) && wide["lo"] < ask && ask < wide["hi"], J([wide, ask]));
  assert(width(wide) >= 0.5 * ask && width(wide) <= 0.6 * ask + 10, J([wide, ask]));
  equal(recruiting.ask_known(st, ME, pid), "wide");
  scout(st, pid, 1);
  const narrow = view(st, pid);
  assert(!("exact" in narrow) && narrow["lo"] < ask && ask < narrow["hi"], J([narrow, ask]));
  assert(width(narrow) < width(wide) && narrow["lo"] >= wide["lo"] && narrow["hi"] <= wide["hi"], J([wide, narrow]));
  equal(recruiting.ask_known(st, ME, pid), "narrow");
  scout(st, pid, 1);
  assert(!("exact" in view(st, pid)), "two of three looks: still a range");
  scout(st, pid, 1);
  assert(recruiting.report_complete(st["recruiting"]["reads"][pid]));
  equal(view(st, pid), { exact: ask });
  equal(recruiting.known_ask(st, ME, pid), ask);
  // an area scout's half look narrows it too
  const other = target(st);
  recruiting.look(st, other, 80, new Random("test-area"), "staff-1", null, recruiting.AREA_LOOK);
  equal(recruiting.ask_known(st, ME, other), "narrow");
});

test("every page reads the same view: the list row, the board row and the profile", () => {
  const st = fresh(), pid = target(st);
  recruiting.set_board(st, pid, true);
  for (const n of [0, 1, 2]) {
    if (n) scout(st, pid, n === 1 ? 1 : 2);
    const v = view(st, pid);
    equal(prospects.row(st, pid, ME)["ask"], v);
    equal(prospects.board_row(st, pid, ME)["ask"], v);
    const prof = prospects.profile(st, pid, ME);
    equal([prof["ask"], prof["row"]["ask"]], [v, v]);
  }
  assert("exact" in view(st, pid));
});

test("his number is somewhere in the range, not its middle, and the same every time you look", () => {
  const st = fresh();
  const pids = ranked(st).filter((q) => ask_of(st, q) >= 40).slice(0, 200);
  let off = 0;
  const spots = [];
  for (const pid of pids) {
    const v = view(st, pid), ask = ask_of(st, pid);
    assert(v["lo"] < ask && ask < v["hi"] && v["lo"] % 5 === 0 && v["hi"] % 5 === 0, J([v, ask]));
    if (recruiting.known_ask(st, ME, pid) !== ask) off += 1;
    const f = recruiting.ask_spot(st, ME, pid);
    assert(f >= recruiting.ASK_OFF_CENTER[0] && f <= recruiting.ASK_OFF_CENTER[1], String(f));
    spots.push(f);
    equal(view(st, pid), v);
  }
  assert(off >= 0.6 * pids.length, `the middle of the range is his number for ${pids.length - off} of ${pids.length}`);
  const below = spots.filter((f) => f < 0.5).length / spots.length;
  assert(below > 0.35 && below < 0.65, `his number sits low in the range for ${below}`);
  // the draw is its own stream: nothing is stored on the save, and another school's differs
  recruiting.reset_caches();
  recruiting._ASK_SPOTS.clear();
  equal(recruiting.ask_spot(st, ME, pids[0]), spots[0]);
  assert(pids.some((q) => recruiting.ask_spot(st, "texas", q) !== recruiting.ask_spot(st, ME, q)));
  assert(!JSON.stringify(st["recruiting"]["contacts"]).includes("spot"));
});

test("talking to him never tells you the number: a call, a video call, an in-home visit, a money talk", () => {
  const st = fresh(), pid = target(st);
  const before = view(st, pid);
  const others = recruiting.PITCHES.filter((t) => !st["recruiting"]["prospects"][pid]["priorities"].includes(t));
  // the conversations: a call and a head coach's visit, each opened, presented and pitched
  for (const action of ["call", "hc_visit"]) {
    let sc = act(st, pid, action)["scene"];
    equal(sc["ask"], before, "the conversation carries the scouted view");
    sc = act(st, pid, "present", { scene: sc["id"], topics: others.slice(0, 3) })["scene"];
    if (get(sc, "question")) act(st, pid, "answer", { scene: sc["id"], answer: "straight" });
    act(st, pid, "pitch", { pitch: others[0], scene: sc["id"] });
    equal(view(st, pid), before, action);
  }
  // the one-shot forms (Auto-recruit's and the AI's path), and a quick call
  recruiting._act(st, ME, pid, "message", null, 0);
  st["current_week"] += recruiting.HC_VISIT_GAP;
  recruiting._act(st, ME, pid, "call", others[0], 0, undefined, undefined, undefined, true);
  recruiting._act(st, ME, pid, "hc_visit", others[0], 0, undefined, undefined, undefined, true);
  equal(view(st, pid), before);
  assert(!("asked" in st["recruiting"]["contacts"][pid][ME]), J(st["recruiting"]["contacts"][pid][ME]));
  // no line of his History names a number
  const lines = st["recruiting"]["log"].filter((e) => e["pid"] === pid).map((e) => get(e, "line")).filter(Boolean);
  assert(!lines.some((l) => /looking for|\d+ in NIL/.test(l)), J(lines));
});

test("an official visit tells you what he cares about, not his number", () => {
  const st = fresh(), rc = st["recruiting"], pid = target(st);
  const before = view(st, pid);
  const home = Object.values(st["games"]).find((g) => g["home"] === ME && !g["played"]);
  rc["visits"][pid] = { [ME]: { week: home["week"], done: false } };
  Object.assign(home, { played: true, home_score: 31, away_score: 10 });
  recruiting._visits(st, home["week"]);
  assert(rc["visits"][pid][ME]["done"]);
  equal(sorted(rc["revealed"][ME][pid]), sorted(rc["prospects"][pid]["priorities"]), "a weekend on campus shows all he cares about");
  equal(view(st, pid), before);
  assert(!("asked" in rc["contacts"][pid][ME]));
});

/** NIL his first priority, your offer out with nothing on it, then a call that pitches NIL: the money promise opens. */
function money_talk(st, pid) {
  const p = st["recruiting"]["prospects"][pid];
  p["priorities"] = ["nil", ...p["priorities"].filter((t) => t !== "nil")].slice(0, 3);
  act(st, pid, "offer");
  recruiting.set_board(st, pid, true);
  recruiting._contact(st, ME, pid)["calls"] ??= 1;
  let sc = act(st, pid, "call")["scene"];
  sc = act(st, pid, "present", { scene: sc["id"], topics: recruiting.PITCHES.slice(0, 3) })["scene"];
  if (get(sc, "question")) act(st, pid, "answer", { scene: sc["id"], answer: "straight" });
  return act(st, pid, "pitch", { pitch: "nil", scene: sc["id"] });
}

test("the money you owe after talking money is shown as you know his ask: a sure amount before, the number once scouted", () => {
  const st = fresh(), pid = target(st);
  const before = view(st, pid);
  const r = money_talk(st, pid);
  const ask = ask_of(st, pid);
  const pr = st["recruiting"]["contacts"][pid][ME]["promises"].filter((x) => x["kind"] === "money");
  assert(pr.length === 1 && pr[0]["about"]["ask"] === ask, J(pr));
  equal(view(st, pid), before, "the money talk told you no number");
  const by_week = st["current_week"] + recruiting.NIL_PROMISE_WEEKS;
  const seen = view(st, pid);
  const sure = 5 * Math.ceil(recruiting.NIL_PROMISE_SHARE * seen["hi"] / 5);
  equal(r["money_owed"], { nil: null, sure, by_week });
  equal(prospects.board_row(st, pid, ME)["money_owed"], { nil: null, sure, by_week });
  assert(sure >= recruiting.NIL_PROMISE_SHARE * ask, "the sure amount keeps the promise whatever his number is");
  const lines = st["recruiting"]["log"].filter((e) => e["pid"] === pid).map((e) => get(e, "line")).filter(Boolean);
  assert(lines.includes(scenes.MONEY_OWED_LINE) && !lines.some((l) => /\d/.test(l)), J(lines));
  // the sure amount on the offer keeps it
  const kept = clone(st);
  recruiting._nil(kept, ME)["held"][pid] = sure;
  recruiting._promises(kept, kept["current_week"] + 1);
  assert(prospects.board_row(kept, pid, ME)["money_owed"] === null);
  // fully scouted, the number itself
  scout(st, pid, 3);
  equal(prospects.board_row(st, pid, ME)["money_owed"], { nil: 5 * Math.ceil(recruiting.NIL_PROMISE_SHARE * ask / 5), by_week });
});

test("a save from before: a number he told you is ignored, and his old History line is not shown", () => {
  const st = fresh(), rc = st["recruiting"], pid = target(st), ask = ask_of(st, pid);
  recruiting.set_board(st, pid, true);
  Object.assign(recruiting._contact(st, ME, pid), { asked: true, n: 2, last_contact: 1 });
  rc["log"].push({ week: 1, kind: "learned", pid, school: ME, line: `He told you he's looking for ${ask} in NIL.` });
  rc["log"].push({ week: 1, kind: "learned", pid, school: ME, line: scenes.MONEY_OWED_LINE });
  const loaded = clone(st);                               // as a save read back
  const v = view(loaded, pid);
  assert(!("exact" in v) && v["lo"] < ask && ask < v["hi"], J(v));
  const other = ranked(loaded).find((q) => q !== pid && ask_of(loaded, q) >= 40);
  recruiting._contact(loaded, ME, other)["asked"] = "range";
  equal(recruiting.ask_known(loaded, ME, other), "wide");
  const row = prospects.board_row(loaded, pid, ME);
  assert(!("exact" in row["ask"]), J(row["ask"]));
  const lines = row["history"].map((h) => get(h, "line")).filter(Boolean);
  assert(lines.includes(scenes.MONEY_OWED_LINE) && !lines.some((l) => l.includes("looking for")), J(lines));
  scout(loaded, pid, 3);
  equal(view(loaded, pid), { exact: ask });
});

test("another school keeps no report: it reads the wide range, and the AI recruits from his real ask as before", () => {
  const st = fresh(), pid = target(st);
  scout(st, pid, 3);
  equal(recruiting.ask_known(st, "texas", pid), "wide");
  assert(!("exact" in recruiting.ask_view(st, "texas", pid, true)));
});

test("your staff on Auto offers from what your scouting knows, never a number it has not learned", () => {
  const run_auto = (looks) => {
    const st = fresh(), rc = st["recruiting"];
    // a prospect whose range's middle is not his number, at the head of your board
    const pid = ranked(st).slice(0, 150).find((q) => ask_of(st, q) >= 40 && recruiting.known_ask(st, ME, q) !== ask_of(st, q));
    assert(pid !== undefined, "no prospect fits");
    if (looks) scout(st, pid, looks);
    recruiting._nil(st, ME)["budget"] = 100000;            // the budget is not what holds the offer down
    const known = recruiting.known_ask(st, ME, pid), ask = ask_of(st, pid);
    recruiting._auto_week(st, ME, new Random("test-auto"), [pid], 5, st["current_week"]);
    return { pid, known, ask, offered: rc["offers"][ME].includes(pid), held: get(recruiting._nil(st, ME)["held"], pid, null) };
  };
  const blind = run_auto(0);
  assert(blind.offered && blind.known !== blind.ask, J(blind));
  assert(blind.held === round(recruiting.AI_OVER_ASK * blind.known) && blind.held !== round(recruiting.AI_OVER_ASK * blind.ask), J(blind));
  const seen = run_auto(3);
  assert(seen.offered && seen.known === seen.ask && seen.pid === blind.pid && seen.held === round(recruiting.AI_OVER_ASK * seen.ask), J(seen));
  // an AI school's own offer to the same prospect reads his real ask from it, scouted by you or not
  const st = fresh(), other = "texas";
  recruiting._nil(st, other)["budget"] = 100000;
  recruiting._auto_week(st, other, new Random("test-auto"), [blind.pid], 5, st["current_week"]);
  const theirs = get(recruiting._nil(st, other)["held"], blind.pid, null);
  const by_tier = round(100000 * get(recruiting.AI_NIL, recruiting.tier_of(st["recruiting"]["prospects"][blind.pid]), 0));
  equal(theirs, Math.min(by_tier, round(recruiting.AI_OVER_ASK * recruiting.ask_from(st, other, blind.pid))));
});

test("the visit's NIL note states his ask as your scouts have it, never a number they have not learned", () => {
  const st = fresh(), pid = target(st);
  const note = (sc) => sc["turns"].find((t) => t["who"] === "note" && /NIL|money/.test(t["text"]))["text"];
  const visit = (s) => {
    const sc = act(s, pid, "hc_visit")["scene"];
    return note(act(s, pid, "present", { scene: sc["id"], topics: recruiting.PITCHES.slice(0, 3) })["scene"]);
  };
  const ask = ask_of(st, pid), v = view(st, pid);
  const blind = visit(clone(st));
  assert(blind.includes(`between ${v["lo"]} and ${v["hi"]}`) && !new RegExp(`\\b${ask}\\b`).test(blind.replace(`${v["lo"]}`, "").replace(`${v["hi"]}`, "")), blind);
  const known = clone(st);
  scout(known, pid, 3);
  assert(visit(known).includes(`Your scouts have his ask at ${ask_of(known, pid)}`));
});

// ----- the transfer portal ----------------------------------------------------------------------------------------

/** Every game played, every school's class signed, season over (tests/test_portal_profile). */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const h = teams[g["home"]]["team_ratings"]["overall"], a = teams[g["away"]]["team_ratings"]["overall"];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 12));
    g["played"] = true;
    g["home_score"] = win ? hs : Math.max(0, hs - rng.randint(1, 20));
    g["away_score"] = win ? hs - rng.randint(1, 20) : hs;
    if (g["home_score"] === g["away_score"]) g["home_score"] += 3;
  }
  const rc = st["recruiting"];
  const schools = Object.entries(teams).filter(([, t]) => !t["fictional"]).map(([s]) => s);
  const pids = sorted(Object.keys(rc["prospects"]), (p) => rc["prospects"][p]["rank"]);
  pids.slice(0, schools.length * 21).forEach((pid, i) => { rc["status"][pid]["signed"] = schools[i % schools.length]; });
  Object.assign(st, { done: true, current_week: season.FINAL_WEEK, champion: "ohio-state" });
}

test("the transfer portal follows the same rule: a range until his report is complete, a campus visit tells no number", () => {
  const sid = api.call("POST", "/api/season", { team: ME, mode: "full", seed: 11, career: true })["id"];
  try {
    finished(api.loaded_state()); api._save_loaded();
    api.call("GET", `/api/season/${sid}/offseason`);
    while (api.loaded_state()["offseason"]["stage"] !== "portal_w1") api.call("POST", `/api/season/${sid}/offseason/advance`, {});
    const st = api.loaded_state(), rc = st["recruiting"];
    assert(recruiting.is_portal(st));
    const pid = Object.keys(rc["prospects"]).find((q) => !get(rc["reads"], q) && !rc["status"][q]["committed"] && !rc["status"][q]["signed"]
      && get(rc["prospects"][q], "from") !== ME && ask_of(st, q) >= 30);
    assert(pid !== undefined, "no entrant fits");
    const ask = ask_of(st, pid), wide = view(st, pid);
    assert(!("exact" in wide) && wide["lo"] < ask && ask < wide["hi"], J([wide, ask]));
    const row = api.call("GET", `/api/season/${sid}/prospects?limit=400`)["rows"].find((r) => r["id"] === pid);
    if (row) equal(row["ask"], wide);
    // a campus visit (this week, no game): he sees it all, and you learn what he cares about, not his number
    rc["hours"][ME] = 1000;
    recruiting._nil(st, ME)["budget"] += 1000;
    recruiting._act(st, ME, pid, "offer", rc["prospects"][pid]["priorities"][0], ask);
    rc["lists"][pid][ME] = Math.max(...Object.values(rc["lists"][pid])) + 50;
    recruiting.reset_caches();
    recruiting._act(st, ME, pid, "official_visit");
    assert(rc["visits"][pid][ME]["done"] && !("asked" in rc["contacts"][pid][ME]));
    const visited = view(st, pid);
    assert(!("exact" in visited), J(visited));
    scout(st, pid, 1);
    const narrow = view(st, pid);
    assert(!("exact" in narrow) && width(narrow) < width(visited), J([visited, narrow]));
    scout(st, pid, 2);
    equal(view(st, pid), { exact: ask_of(st, pid) });
  } finally {
    api.call("DELETE", `/api/season/${sid}`);
  }
});

await run();
