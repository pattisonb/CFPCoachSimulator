// A recruit's question on a call or in-home visit (career_js/scenes.js `question`, recruiting `_answer`, `_promises`),
// through the API as the page asks. A recruit who cares about playing time asks about a named player: the one ahead
// of him on your roster, or another recruit you offered at his position. You answer Straight, Promise or Deflect.
// A promise is remembered: a hollow one costs you, one broken by a later commitment costs his firmness or cools him,
// and a roster promise follows him onto your roster when he signs. A Package Deal recruit asks about his mate instead.
// `node tests/test_recruit_questions.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, get, sorted } from "../engine_js/pyrt.js";

const game = await start({ env: { CFP_QUESTION_RATE: "1" } });      // he always asks when he has something to ask
const { api, season, recruiting, offseason } = game;
const { persona, word, scenes } = game.modules;

recruiting.LOCKOUT_AT = 99;        // nobody shuts the door here: the lockout has its own test (tests/test_standards.mjs)
const ME = "smu";
const J = (v) => () => JSON.stringify(v);

function refused(fn, code, message) {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof api.ApiError)) throw e;
    assert(e.status === code && e.message === message, `${e.status} ${e.message}`);
    return;
  }
  throw new Error(`expected ${code} ${message}`);
}

const sid = api.call("POST", "/api/season", { team: ME, mode: "full", seed: 11, career: true })["id"];
const G = (p) => api.call("GET", `/api/season/${sid}/${p}`);
const R = (p, body) => api.call("POST", `/api/season/${sid}/${p}`, body);
let st = api.loaded_state(), rc = st["recruiting"];
const week = st["current_week"];
const used = new Set();
const misses = (pid) => recruiting.PITCHES.filter((t) => !persona.counts_as_priority(st, pid, t)).slice(0, 3);   // his decider's topic counts as his

/** A call or visit, presented with three topics that are not his: the opening earns nothing, so the points under test
 *  are the answer's alone. His question comes after your opening. */
function talk(pid, action = "call") {
  rc["hours"][ME] = 100;                                  // hours are not the point here
  const sc = R("recruit", { pid, action })["scene"];
  assert(sc["question"] === null, "his question waits on your opening");
  const r = R("recruit", { pid, action: "present", scene: sc["id"], topics: misses(pid) });
  assert(r["points"] === 0.0, J(r["points"]));
  return r["scene"];
}
const answer = (pid, sc, how) => R("recruit", { pid, action: "answer", scene: sc["id"], answer: how });
/** A visible prospect nobody has touched, with (or without) playing time among his priorities. */
function cold(want_pt, group = null, also = () => true) {
  const pid = recruiting.prospect_list(st).find((q) => !used.has(q) && !(q in rc["contacts"]) && !rc["status"][q]["committed"]
    && rc["prospects"][q]["priorities"].includes("playing_time") === want_pt && (!group || recruiting._group_of(rc["prospects"][q]) === group)
    && persona.of(st, q)["story"] !== "package" && also(q));
  assert(pid !== undefined, "no such prospect");
  used.add(pid);
  return pid;
}
const events = (pid, kind) => rc["log"].filter((e) => e["pid"] === pid && e["kind"] === kind);
const promises = (pid) => get(rc["contacts"][pid][ME], "promises") || [];
const group_of = (pid) => recruiting._group_of(rc["prospects"][pid]);

/** The test's own read of the roster: the best returning player at his group rated at least as high. */
function best_ahead(pid) {
  const p = rc["prospects"][pid], group = group_of(pid), t = season.load_teams()[ME];
  const cands = [...t["offense"], ...t["defense"]].filter((q) => (["MLB", "ROLB", "LOLB"].includes(q["position"]) ? "LB" : q["position"]) === group
    && !recruiting.LEAVING.has(get(q, "class")) && (get(q, "ovr") || 0) >= p["ovr"]);
  return cands.length ? cands.reduce((a, b) => ((get(b, "ovr") || 0) > (get(a, "ovr") || 0) ? b : a)) : null;
}

test("the answers' worth is set: straight 1, a believed promise 3, a hollow one costs 2, a broken one 20 firmness", () => {
  equal([recruiting.ANSWER_STRAIGHT, recruiting.ANSWER_PROMISE, recruiting.ANSWER_HOLLOW, recruiting.PROMISE_RIVAL], [1.0, 3.0, 2.0, 20]);
  equal([recruiting.PACKAGE_OFFERED, recruiting.PACKAGE_PROMISE_WEEKS, recruiting.PACKAGE_KEPT], [1.0, 2, 2.0]);
  assert(recruiting.REPORT_KINDS.includes("promise_broken") && recruiting.REPORT_KINDS.includes("promise_kept") && recruiting.CONTACT_KINDS.includes("answer"));
});

let straight_pid;

test("a recruit who cares about playing time asks about the best returning player ahead of him, and the pitch waits on your answer", () => {
  const pid = cold(true, null, (q) => best_ahead(q) !== null);
  straight_pid = pid;
  const want = best_ahead(pid), ahead = recruiting.ahead_of(st, ME, pid);
  equal([ahead["name"], ahead["ovr"], ahead["slug"], ahead["cls"], ahead["position"]], [want["name"], want["ovr"], want["slug"], want["class"], want["position"]]);
  const sc = talk(pid), q = sc["question"];
  assert(q && q["kind"] === "roster" && q["about"]["name"] === want["name"] && q["about"]["id"] === want["slug"], J(q));
  assert(q["answer"] === null && q["reply"] === null && q["text"].includes(want["name"]) && !q["text"].includes("None") && !q["text"].includes("ATH"), q["text"]);
  refused(() => R("recruit", { pid, action: "pitch", scene: sc["id"], pitch: "winning" }), 409, "answer him first");
  refused(() => R("recruit", { pid, action: "answer", scene: "nope", answer: "straight" }), 409, "no call or visit open");
  refused(() => R("recruit", { pid, action: "answer", answer: "straight" }), 409, "no call or visit open");
  refused(() => R("recruit", { pid, action: "answer", scene: sc["id"], answer: "shrug" }), 400, "unknown answer");
  refused(() => R("recruit", { pid, action: "answer", scene: sc["id"] }), 422, "answer is required");
  R("board", { pid, on: true });
  const row = G("recruiting")["board"].find((r) => r["id"] === pid);
  assert(row["scene"]["id"] === sc["id"]);
  equal(row["scene"]["question"], q, "the open question rides on his board row");
});

test("a straight answer earns a little, tells you he cares about playing time, and is no promise", () => {
  const pid = straight_pid, sc = rc["scenes"][ME][pid];
  const known = [...(get(get(rc["revealed"], ME, {}), pid) || [])];
  const r = answer(pid, sc, "straight");
  assert(r["points"] === recruiting.ANSWER_STRAIGHT && r["truthful"] === null);
  equal(r["revealed"], known.includes("playing_time") ? [] : ["playing_time"]);
  assert(rc["revealed"][ME][pid].includes("playing_time"));
  assert(r["scene"]["question"]["answer"] === "straight" && r["scene"]["question"]["reply"], J(r["scene"]["question"]));
  assert(Math.abs(recruiting.pending(st, ME, pid) - recruiting.ANSWER_STRAIGHT) < 1e-9);
  const e = events(pid, "answer").at(-1);
  assert(e["answer"] === "straight" && e["about"] === best_ahead(pid)["name"] && e["truthful"] === null && e["school"] === ME, J(e));
  assert(!promises(pid).length, "straight is not a promise");
  refused(() => answer(pid, sc, "straight"), 409, "you already answered");
  const r2 = R("recruit", { pid, action: "pitch", scene: sc["id"], pitch: "playing_time" });
  assert(["sold", "hit", "fair", "lukewarm", "polite", "quiet", "guarded"].includes(r2["reaction"]["kind"]) && !(pid in (get(get(rc, "scenes") || {}, ME) || {})));
  assert(rc["contacts"][pid][ME]["n"] === 1, "the call is one contact");
  const ans = G("recruiting")["board"].find((x) => x["id"] === pid)["history"].find((h) => h["kind"] === "answer");
  assert(ans["answer"] === "straight" && ans["about"] === best_ahead(pid)["name"], J(ans));
});

test("a deflection does nothing", () => {
  const pid = cold(true, null, (q) => best_ahead(q) !== null);
  const sc = talk(pid);
  assert(sc["question"]["kind"] === "roster");
  const r = answer(pid, sc, "deflect");
  assert(r["points"] === 0.0 && r["truthful"] === null && r["revealed"].length === 0 && r["scene"]["question"]["reply"]);
  assert(recruiting.pending(st, ME, pid) === 0.0 && !promises(pid).length && events(pid, "answer").at(-1)["answer"] === "deflect");
});

let promised_pid;

test("a promise of the job over a roster player is your word: believed, worth a promise, and remembered", () => {
  const pid = cold(true, null, (q) => { const a = recruiting.ahead_of(st, ME, q); return a && a["last_year"]; });
  promised_pid = pid;
  const sc = talk(pid);
  assert(sc["question"]["kind"] === "roster" && recruiting.LAST_YEAR.has(sc["question"]["about"]["cls"]));
  assert(recruiting.promise_holds(st, ME, pid, sc["question"]));
  const r = answer(pid, sc, "promise");
  const worth = recruiting.ANSWER_PROMISE * word.promise_mult(st, pid, group_of(pid));       // Keeps His Word scales it
  assert(Math.abs(r["points"] - worth) < 1e-9 && r["truthful"] === true && Math.abs(recruiting.pending(st, ME, pid) - worth) < 1e-9);
  const c = rc["contacts"][pid][ME];
  assert(!("cooled_until" in c) && c["promises"][0]["kind"] === "roster" && c["promises"][0]["broken"] === null && !events(pid, "not_buying").length);
  // over a player who is not leaving and is well clear of him, it still holds: your word, judged next season
  const q = { ...sc["question"], about: { ...sc["question"]["about"], last_year: false, ovr: rc["prospects"][pid]["ovr"] + 35 } };
  assert(recruiting.promise_holds(st, ME, pid, q));
});

test("no question from a recruit who does not care about playing time, or with nobody to ask about", () => {
  assert(talk(cold(false))["question"] === null);
  const returning = recruiting._returning;
  recruiting._returning = () => [];
  try {
    const pid = cold(true);
    assert(recruiting.ahead_of(st, ME, pid) === null && recruiting.other_offered(st, ME, pid) === null);
    assert(talk(pid)["question"] === null);
  } finally {
    recruiting._returning = returning;
  }
});

test("with nobody ahead on the roster he asks about the best other recruit you offered at his position, and a promise there can be broken", () => {
  const returning = recruiting._returning;
  recruiting._returning = () => [];
  try {
    const pid = cold(true);
    const group = group_of(pid);
    const others = [cold(false, group), cold(false, group)];
    for (const o of others) {
      rc["hours"][ME] = 100;
      R("recruit", { pid: o, action: "offer" });
    }
    const top = others.reduce((a, b) => (rc["prospects"][b]["rank"] < rc["prospects"][a]["rank"] ? b : a));
    equal(recruiting.other_offered(st, ME, pid), { pid: top, name: rc["prospects"][top]["name"], position: rc["prospects"][top]["position"], rank: rc["prospects"][top]["rank"] });
    const sc = talk(pid), q = sc["question"];
    assert(q["kind"] === "recruit" && q["about"]["pid"] === top && q["about"]["name"] === rc["prospects"][top]["name"] && !q["text"].includes("None"), J(q));
    const r = answer(pid, sc, "promise");
    // he believes it when he is at least as good as the other recruit; otherwise it is hollow and costs you
    const truthful = rc["prospects"][pid]["ovr"] >= rc["prospects"][top]["ovr"];
    const worth = truthful ? recruiting.ANSWER_PROMISE * word.promise_mult(st, pid, group) : -recruiting.ANSWER_HOLLOW * persona.hollow_mult(st, pid, ME);
    assert(r["truthful"] === truthful && Math.abs(r["points"] - worth) < 1e-9, J([r["truthful"], r["points"], worth]));
    assert(promises(pid)[0]["kind"] === "recruit");
    // committed to you, he remembers when the other recruit commits too: his firmness drops, once
    recruiting._commit(st, pid, ME);
    const firm0 = rc["status"][pid]["firmness"];
    recruiting._promises(st, week);
    assert(rc["status"][pid]["firmness"] === firm0 && !events(pid, "promise_broken").length, "the other recruit has not committed");
    recruiting._commit(st, top, ME);
    recruiting._promises(st, week);
    assert(rc["status"][pid]["firmness"] === Math.max(0, firm0 - recruiting.PROMISE_RIVAL));
    const pb = events(pid, "promise_broken");
    assert(pb.length === 1 && pb[0]["about"] === rc["prospects"][top]["name"] && pb[0]["school"] === ME && promises(pid)[0]["broken"] === week, J(pb));
    recruiting._promises(st, week + 1);
    assert(rc["status"][pid]["firmness"] === Math.max(0, firm0 - recruiting.PROMISE_RIVAL) && events(pid, "promise_broken").length === 1);
    // not committed to you, he cools on you instead
    const pid2 = cold(true, group);
    const sc2 = talk(pid2);
    assert(sc2["question"]["kind"] === "recruit");
    const about = sc2["question"]["about"]["pid"];
    answer(pid2, sc2, "promise");
    delete rc["contacts"][pid2][ME]["cooled_until"];       // a hollow one cooled him already: the rule's own cooling is the point
    if (rc["status"][about]["committed"] !== ME) recruiting._commit(st, about, ME);
    recruiting._promises(st, week);
    assert(rc["contacts"][pid2][ME]["cooled_until"] === week + recruiting.COOL_WEEKS && events(pid2, "promise_broken").length === 1);
    // a hard commit is past caring
    const pid3 = cold(true, group);
    const sc3 = talk(pid3);
    assert(sc3["question"]["kind"] === "recruit");
    answer(pid3, sc3, "promise");
    recruiting._commit(st, pid3, ME);
    Object.assign(rc["status"][pid3], { hard: true, firmness: recruiting.HARD_AT });
    recruiting._promises(st, week);
    assert(rc["status"][pid3]["firmness"] === recruiting.HARD_AT && !events(pid3, "promise_broken").length);
  } finally {
    recruiting._returning = returning;
  }
});

/** A Package Deal pair, set on both (his persona: the story and who decides at his visit). */
function pair(decider = "mom") {
  const a = cold(false), b = cold(false);
  for (const [x, y, lead] of [[a, b, true], [b, a, false]]) {
    rc["prospects"][x]["persona"] = {
      personality: "cocky", decider: lead ? decider : "self", decider_topic: lead && decider !== "self" ? "proximity" : null,
      story: "package", story_data: { mate: y, lead }, commit_style: "hat",
    };
  }
  return [a, b];
}

test("a Package Deal recruit asks about his mate; a promised offer is kept when the mate gets it within two weeks", () => {
  const [pid, mate] = pair("mom");
  const mname = rc["prospects"][mate]["name"];
  rc["hours"][ME] = 100;
  let sc = R("recruit", { pid, action: "hc_visit" })["scene"];
  equal(sc["package"], { pid: mate, name: mname, offered: false });
  sc = R("recruit", { pid, action: "present", scene: sc["id"], topics: misses(pid) })["scene"];
  const q = sc["question"];
  assert(q["kind"] === "package" && q["text"].includes(mname), J(q));
  equal(q["about"], { pid: mate, name: mname, offered: false });
  equal(Object.keys(q["answers"]).sort(), ["deflect", "promise", "straight"]);
  assert(Object.values(q["answers"]).every((a) => a["label"] && a["text"]) && q["answers"]["promise"]["text"].includes(mname));
  const r = answer(pid, sc, "promise");
  assert(r["points"] === 0 && r["truthful"] === null, "a promised offer earns nothing until the offer is made");
  const pr = promises(pid)[0];
  assert(pr["kind"] === "package" && pr["about"]["pid"] === mate && pr["week"] === week && pr["kept"] === null && pr["broken"] === null, J(pr));
  const again = scenes.question(st, ME, pid, week + 1, { pid: mate, name: mname });
  assert(!again || again["kind"] !== "package", "promised once: he does not ask about his mate again");
  const ev = events(pid, "answer").at(-1);
  assert(ev["question"] === "package" && ev["offered"] === false && ev["answer"] === "promise" && ev["about"] === mname, J(ev));
  recruiting._promises(st, week);
  assert(pr["kept"] === null && pr["broken"] === null && !events(pid, "promise_kept").length);
  const before = get(rc["lists"][pid], ME, 0.0);
  rc["hours"][ME] = 100;
  R("recruit", { pid: mate, action: "offer" });
  recruiting._promises(st, week + 1);
  assert(pr["kept"] === week + 1 && pr["broken"] === null);
  assert(Math.abs(rc["lists"][pid][ME] - before - persona.climbs(st, ME, pid, recruiting.PACKAGE_KEPT)) < 1e-9, "keeping your word lands on his list");
  const pk = events(pid, "promise_kept");
  assert(pk.length === 1 && pk[0]["about"] === mname && pk[0]["school"] === ME && pk[0]["line"].includes(mname), J(pk));
  recruiting._promises(st, week + 5);
  assert(events(pid, "promise_kept").length === 1 && !events(pid, "promise_broken").length, "kept once, never broken");
});

test("a promised offer that never comes is broken after two weeks: he cools on you, or a commit's firmness drops", () => {
  const [pid, mate] = pair("self");
  let sc = talk(pid, "hc_visit");
  assert(sc["question"]["kind"] === "package" && sc["question"]["about"]["pid"] === mate);
  answer(pid, sc, "promise");
  for (let w = week; w < week + recruiting.PACKAGE_PROMISE_WEEKS; w++) {
    recruiting._promises(st, w);
    assert(!events(pid, "promise_broken").length && !("cooled_until" in rc["contacts"][pid][ME]), String(w));
  }
  const broke = week + recruiting.PACKAGE_PROMISE_WEEKS;
  recruiting._promises(st, broke);
  const pb = events(pid, "promise_broken");
  assert(pb.length === 1 && pb[0]["about"] === rc["prospects"][mate]["name"] && pb[0]["why"] === "package" && pb[0]["other"] === mate, J(pb));
  assert(rc["contacts"][pid][ME]["cooled_until"] === broke + recruiting.COOL_WEEKS && promises(pid)[0]["broken"] === broke);
  recruiting._promises(st, broke + 1);
  assert(events(pid, "promise_broken").length === 1);
  const [pc] = pair("dad");
  sc = talk(pc, "hc_visit");
  assert(sc["question"]["kind"] === "package");
  answer(pc, sc, "promise");
  recruiting._commit(st, pc, ME);
  const firm0 = rc["status"][pc]["firmness"];
  recruiting._promises(st, broke);
  assert(rc["status"][pc]["firmness"] === Math.max(0, firm0 - recruiting.PROMISE_RIVAL) && events(pc, "promise_broken").length === 1);
});

test("when his mate already holds your offer a straight answer is worth more; a mate who signed elsewhere is not asked about", () => {
  const [pid, mate] = pair("mom");
  rc["hours"][ME] = 100;
  R("recruit", { pid: mate, action: "offer" });
  rc["hours"][ME] = 100;
  let sc = R("recruit", { pid, action: "hc_visit" })["scene"];
  assert(sc["package"]["offered"] === true);
  sc = R("recruit", { pid, action: "present", scene: sc["id"], topics: misses(pid) })["scene"];
  assert(sc["question"]["kind"] === "package" && sc["question"]["about"]["offered"] === true);
  const known = [...(get(get(rc["revealed"], ME, {}), pid) || [])];
  const r = answer(pid, sc, "straight");
  assert(r["points"] === recruiting.ANSWER_STRAIGHT + recruiting.PACKAGE_OFFERED && r["revealed"].length === 0 && r["truthful"] === null);
  equal(get(get(rc["revealed"], ME, {}), pid) || [], known, "the question was about his mate, not playing time");
  assert(!promises(pid).length);
  const [pe] = pair("mom");                               // not offered: a straight answer earns nothing
  assert(answer(pe, talk(pe, "hc_visit"), "straight")["points"] === 0);
  const [pf, mf] = pair("mom");
  rc["status"][mf]["signed"] = "ohio-state";
  rc["hours"][ME] = 100;
  assert(R("recruit", { pid: pf, action: "hc_visit" })["scene"]["package"] === null);
});

test("a call you hang up on with his question open is no answer and no promise; a broken promise is in the week's recap", () => {
  const pid = cold(true, null, (q) => best_ahead(q) !== null);
  assert(talk(pid)["question"]);
  recruiting._flush(st, week);
  assert(!Object.keys(get(get(rc, "scenes") || {}, ME) || {}).length && events(pid, "hung_up").length);
  assert(!promises(pid).length && !events(pid, "answer").length);
  const recap = G("recruiting")["recap"];
  assert(recap.some((e) => e["kind"] === "promise_broken") && !recap.some((e) => e["kind"] === "answer"));
});

/** Every game played, every school's class signed, the season over (as tests/test_portal_recap.mjs ends one). */
function finished(state) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(state["games"])) {
    const h = teams[g["home"]]["team_ratings"]["overall"], a = teams[g["away"]]["team_ratings"]["overall"];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 7));
    Object.assign(g, { played: true, home_score: win ? hs : Math.max(0, hs - rng.randint(1, 20)), away_score: win ? hs - rng.randint(1, 20) : hs });
    if (g["home_score"] === g["away_score"]) g["home_score"] += 3;
  }
  const schools = Object.keys(teams).filter((s) => !teams[s]["fictional"]);
  sorted(Object.keys(state["recruiting"]["prospects"]), (p) => state["recruiting"]["prospects"][p]["rank"]).slice(0, schools.length * 21)
    .forEach((pid, i) => { state["recruiting"]["status"][pid]["signed"] = schools[i % schools.length]; });
  Object.assign(state, { done: true, current_week: season.FINAL_WEEK, champion: "ohio-state" });
}

test("a roster promise follows him onto your roster when he signs, from high school or the portal; no promise, no mark", () => {
  finished(st);
  for (const s of Object.values(rc["status"])) if (s["signed"] === ME) s["signed"] = null;
  const deflected = [...used].find((q) => events(q, "answer").some((e) => e["answer"] === "deflect"));
  rc["status"][promised_pid]["signed"] = ME;             // the true roster promise
  rc["status"][deflected]["signed"] = ME;                // deflected: no promise
  const off = offseason.start(st);
  let roster = Object.fromEntries(st["league"]["teams"][ME]["roster"].map((c) => [c["id"], c]));
  assert(roster[promised_pid]["promised"] === off["year"] && roster[promised_pid]["cls"] === "FR" && !("promised" in roster[deflected]), J(roster[promised_pid]));
  api._save_loaded();
  while (api.loaded_state()["offseason"]["stage"] !== "portal_w1") R("offseason/advance", {});
  st = api.loaded_state();
  rc = st["recruiting"];
  assert(recruiting.is_portal(st));
  // in the portal he asks about the player ahead of him on the roster as it now stands
  const open = (q) => !rc["status"][q]["committed"] && !rc["status"][q]["signed"];
  const pid = recruiting.prospect_list(st).find((q) => open(q) && rc["prospects"][q]["priorities"].includes("playing_time") && recruiting.ahead_of(st, ME, q)
    && !recruiting.would_pester(st, ME, q));
  const ahead = recruiting.ahead_of(st, ME, pid), group = group_of(pid);
  const want = st["league"]["teams"][ME]["roster"].filter((c) => offseason.GROUP[c["pos"]] === group && c["o"] >= rc["prospects"][pid]["ovr"])
    .reduce((a, b) => (b["o"] > a["o"] ? b : a));
  equal([ahead["name"], ahead["slug"], ahead["ovr"], ahead["cls"]], [want["n"], want["id"], want["o"], want["cls"]]);
  const sc = talk(pid);
  assert(sc["question"]["kind"] === "roster" && sc["question"]["about"]["name"] === want["n"], J(sc["question"]));
  answer(pid, sc, "promise");
  const plain = recruiting.prospect_list(st).find((q) => q !== pid && open(q));       // signs with no promise
  for (const q of [pid, plain]) Object.assign(rc["status"][q], { committed: ME, signed: ME });
  offseason._close_portal(st);
  roster = Object.fromEntries(st["league"]["teams"][ME]["roster"].map((c) => [c["id"], c]));
  assert(roster[pid]["promised"] === st["offseason"]["year"] && roster[pid]["transfer"] && !("promised" in roster[plain]), J(roster[pid]));
});

test("a starting role promised and not given multiplies his chance to enter the portal; a season as the starter costs nothing", () => {
  const YEAR = 2027;
  const ctx = (more = {}) => ({ losing: false, p4: true, year: YEAR, tier: 1, slipping: null, rising: false, ...more });
  const odds = (p, use, more) => offseason.portal_odds(p, use, ctx(more)).reduce((a, [, v]) => a + v, 0);
  const plain = { id: "x", n: "Khalil Telfair", pos: "WR", cls: "SO", o: 60, s: 4, r: [] };
  const promised = { ...plain, promised: YEAR - 1 };
  assert(offseason.PROMISE_BROKEN === 3.0);
  for (const use of ["bench", "rotation"]) {
    assert(Math.abs(odds(promised, use) - offseason.PROMISE_BROKEN * odds(plain, use)) < 1e-9, use);
    assert(Object.fromEntries(offseason.portal_odds(promised, use, ctx({ tier: 5 })))["promised"] > 0, "the promise is its own reason");
  }
  assert(odds(promised, "starter") === odds(plain, "starter"), "he started: the promise was kept");
  assert(!offseason.portal_odds(promised, "starter", ctx()).some(([k]) => k === "promised"));
  assert(odds({ ...plain, promised: YEAR - 2 }, "bench") === odds(plain, "bench"), "an older promise is forgotten");
  assert(Math.abs(odds({ ...promised, kept: YEAR - 1 }, "bench") - offseason.PROMISE_BROKEN * odds(plain, "bench")) < 1e-9, "a keep does not soften a broken promise");
  assert(offseason.REASONS["promised"] === "Was promised a starting role and did not get it");
});

await run();
