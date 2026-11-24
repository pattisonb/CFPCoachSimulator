// A call or an in-home visit is a short, plain conversation (career_js/scenes.js; its lifecycle and points are
// recruiting.act's). A note opens it; you present three things and he answers each with a Yes (one of his priorities,
// and now you know it) or a No, with your case on each Yes; he may have a question; you lead with one pitch and get
// a Yes or No to it. The points are the call's or the visit's. Nothing to read between the lines, and nothing on the
// page that is not a sentence.
// `node tests/test_conversations.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";

const game = await start();
const { season, recruiting } = game;
const { persona, scenes, prospects } = game.modules;
persona.DECIDERS_ON = true;   // who decides is switched off in the game for now (persona.DECIDERS_ON): these tests hold what it does when it is on

const ME = "smu";
const show = (v) => JSON.stringify(v);
const st = season.new_season(ME, "full", 11, undefined, undefined, true);
st["current_week"] = 1;
const rc = st["recruiting"];
const used = new Set();
recruiting.LOCKOUT_AT = 99;        // nobody shuts the door here: the lockout has its own test (tests/test_standards.mjs)

/** A visible, uncommitted prospect your school has not touched (and would not pester), passing `want`. */
function cold(want = () => true) {
  for (const pid of recruiting.prospect_list(st)) {
    if (used.has(pid) || ME in (rc["contacts"][pid] || {}) || rc["status"][pid]["committed"] || rc["prospects"][pid]["hidden"]) continue;
    if (persona.story(st, pid)[0] !== null || recruiting.would_pester(st, ME, pid)) continue;
    force(pid);                      // as the plain recruit the tests make him: what he wants leans with his personality
    if (!want(pid)) { delete rc["prospects"][pid]["persona"]; continue; }
    used.add(pid);
    return pid;
  }
  throw new Error("no such prospect");
}

/** A plain recruit unless told otherwise: All Business, decides himself, no story (each changes the points or adds a note). */
function force(pid, personality = "business", decider = "self", topic = null, story = null, data = {}) {
  rc["prospects"][pid]["persona"] = { personality, decider, decider_topic: topic, story, story_data: data, commit_style: "hat" };
}

function act(pid, action, { pitch = null, nil = 0, scene = null, answer = null, topics = null } = {}) {
  rc["hours"][ME] = 1000;
  return recruiting.act(st, ME, pid, action, pitch, nil, scene, answer, topics);
}

function refused(fn, code, message = null) {
  try { fn(); } catch (e) {
    if (!(e instanceof recruiting.RecruitingError)) throw e;
    assert(e.code === code && (message === null || e.message === message), () => show([e.code, e.message]));
    return;
  }
  throw new Error(`expected ${code} ${message}`);
}

const strengths = (pid) => recruiting.strengths(st, ME, pid);
const mine = (pid) => rc["prospects"][pid]["priorities"];
const not_his = (pid, n) => recruiting.PITCHES.filter((t) => !persona.counts_as_priority(st, pid, t)).slice(0, n);
const kind_of = (pid, t) => recruiting.reaction_kind(st, ME, pid, t);       // how he takes a pitch on one of his: your letter against what he wants
const letter = (pid, t) => scenes._case_word(recruiting.strengths(st, ME, pid, true)[t]);    // your case as the page shows it
const strong_one = (pid) => mine(pid).find((t) => kind_of(pid, t) !== "quiet");
const weak_one = (pid) => mine(pid).find((t) => kind_of(pid, t) === "quiet");
const SMALL = ["a", "an", "the", "of", "to", "for", "and", "or", "in", "on", "at", "by"];
const title_case = (text) => text.split(" ").every((w, i, ws) => /^[A-Z]/.test(w) || (SMALL.includes(w) && i > 0 && i < ws.length - 1));
const whos = (sc) => sc["turns"].map((t) => t["who"]);
const name = (t) => scenes._TOPIC_NAME[t];
const last = (pid, kind) => rc["log"].filter((e) => e["kind"] === kind && e["pid"] === pid).at(-1);
/** Every line of a conversation is a sentence, with nothing unfilled. */
function plain(sc) {
  for (const t of sc["turns"]) {
    assert(/^[A-Z]/.test(t["text"]) && !/\{|\}|\b(None|null|undefined|NaN)\b/.test(t["text"]), t["text"]);
  }
}

test("a call opens with a plain note and waits on your opening", () => {
  const pid = cold();
  force(pid);
  const sc = act(pid, "call")["scene"];
  equal(sc["turns"], [{ who: "note", text: `Call with ${rc["prospects"][pid]["name"]}.` }]);
  equal([sc["cue"], sc["question"], sc["presented"], sc["tired"], sc["lines"], sc["action"]], [null, null, null, false, [], "call"]);
  assert(rc["scenes"][ME][pid] === sc, "the open conversation is kept in the career");
  assert(recruiting.pending(st, ME, pid) === 0, "no points until you say something");
  // before the opening there is no pitch; the opening is exactly three different topics the game knows
  refused(() => act(pid, "pitch", { pitch: "winning", scene: sc["id"] }), 409, "present your program first");
  refused(() => act(pid, "present", { scene: sc["id"], topics: ["winning", "nil"] }), 400);
  refused(() => act(pid, "present", { scene: sc["id"], topics: ["winning", "nil", "nil"] }), 400);
  refused(() => act(pid, "present", { scene: sc["id"], topics: ["winning", "nil", "hats"] }), 400);
  refused(() => act(pid, "present", { scene: "nope", topics: ["winning", "nil", "coach"] }), 409, "no call or visit open");
  refused(() => act(pid, "call"), 409);                                 // one call a week, and this one is still open
});

test("an opening on nothing of his gets three Nos and no points, and can be made only once", () => {
  const pid = cold();
  force(pid);
  const sc = act(pid, "call")["scene"];
  const topics = not_his(pid, 3);
  const r = act(pid, "present", { scene: sc["id"], topics });
  assert(r["scene"] === rc["scenes"][ME][pid]);
  equal([r["points"], r["hit"], r["scene"]["presented"], r["scene"]["present"]], [0.0, [], topics, { kind: "polite", hit: [] }]);
  equal(whos(r["scene"]).slice(0, 3), ["note", "you", "him"]);
  equal(r["scene"]["turns"][1]["text"], `You pitched: ${name(topics[0])}, ${name(topics[1])} and ${name(topics[2])}.`);
  equal(r["scene"]["turns"][2]["text"], topics.map((t) => `${name(t)}: No`).join(" · "));
  equal(r["scene"]["cue"], { topics: [], text: r["scene"]["turns"][2]["text"] });
  equal(r["scene"]["lines"], r["scene"]["turns"].filter((t) => t["who"] === "him").map((t) => t["text"]));
  refused(() => act(pid, "present", { scene: sc["id"], topics }), 409, "you already presented");
  const e = last(pid, "present");
  equal([e["topics"], e["hit"], e["action"], e["school"]], [topics, 0, "call", ME]);
  plain(r["scene"]);
});

test("a priority you are strong on is a Yes: it earns the call's points, names your case and is now known", () => {
  const pid = cold((q) => strong_one(q) !== undefined);
  force(pid);
  const strong = strong_one(pid);
  const sc = act(pid, "call")["scene"];
  assert(!((rc["revealed"][ME] || {})[pid] || []).length, "opening the call tells nothing");
  const topics = [strong, ...not_his(pid, 2)];
  const r = act(pid, "present", { scene: sc["id"], topics });
  // its share of the call by how he takes it, scaled by how well your program fits him
  const want = recruiting.PRESENT_HIT * recruiting.BASE_POINTS["call"] * recruiting.PRESENT_WORTH[kind_of(pid, strong)] * recruiting.move_mult(st, ME, pid);
  assert(Math.abs(r["points"] - want) < 1e-9, () => show([r["points"], want]));
  assert(Math.abs(recruiting.pending(st, ME, pid) - want) < 1e-9);
  equal(Object.keys(rc["why_week"][pid][ME]), ["call"], "the points sit on the call");
  equal(r["hit"], [strong]);
  equal(r["scene"]["present"], { kind: scenes.case_kind(st, ME, pid, strong), hit: [strong] });
  assert(["sold", "hit", "fair", "lukewarm"].includes(r["scene"]["present"]["kind"]));
  assert(r["scene"]["turns"][2]["text"].startsWith(`${name(strong)}: Yes · `), r["scene"]["turns"][2]["text"]);
  equal(r["scene"]["turns"][3], { who: "note", text: `Your case on his: ${name(strong)} ${letter(pid, strong)}.` });
  assert(/^(A|B|C|D)[+-]?$|^F$/.test(letter(pid, strong)), "your case is a letter grade");
  equal(rc["revealed"][ME][pid], [strong], "a Yes tells you it is one of his");
  plain(r["scene"]);
});

test("a priority you are weak on is still a Yes, but it costs you and he is not buying", () => {
  const pid = cold((q) => weak_one(q) !== undefined && !strong_one(q));
  force(pid);
  const weak = weak_one(pid);
  const others = not_his(pid, 2);
  const sc = act(pid, "call")["scene"];
  const r = act(pid, "present", { scene: sc["id"], topics: [others[0], weak, others[1]] });
  const want = -recruiting.BACKFIRE_COST * recruiting.PRESENT_HIT * recruiting.BASE_POINTS["call"];
  assert(Math.abs(r["points"] - want) < 1e-9, () => show([r["points"], want]));
  equal([r["hit"], r["scene"]["present"]["kind"], r["scene"]["present"]["hit"]], [[], "quiet", [weak]]);
  assert(r["scene"]["turns"][2]["text"].includes(`${name(weak)}: Yes`) && r["scene"]["turns"][3]["text"] === `Your case on his: ${name(weak)} ${letter(pid, weak)}.`, () => show(r["scene"]["turns"]));
  assert(last(pid, "not_buying")["topic"] === weak);
});

test("three strong priorities never earn more than the call itself is worth", () => {
  assert(recruiting.PRESENT_HIT * 3 * 2 > 1.0, "the cap matters: three strong hits would pass the base");
  const lands = (q, t) => ["sold", "hit"].includes(kind_of(q, t));
  const worth = (q) => mine(q).reduce((a, t) => a + recruiting.PRESENT_HIT * recruiting.BASE_POINTS["call"] * recruiting.PRESENT_WORTH[kind_of(q, t)], 0) * recruiting.move_mult(st, ME, q);
  const pid = cold((q) => mine(q).filter((t) => lands(q, t)).length >= 3 && worth(q) > recruiting.BASE_POINTS["call"]);
  force(pid);
  const topics = mine(pid).slice(0, 3);
  const sc = act(pid, "call")["scene"];
  const r = act(pid, "present", { scene: sc["id"], topics });
  const raw = worth(pid);
  assert(raw > recruiting.BASE_POINTS["call"] && Math.abs(r["points"] - recruiting.BASE_POINTS["call"]) < 1e-9, () => show([raw, r["points"]]));
  equal(r["scene"]["present"]["kind"], recruiting.best_reaction(topics.map((t) => kind_of(pid, t))));
});

test("your lead-with gets a Yes with your case or a No, logs how he took it and ends the call", () => {
  const pid = cold((q) => strong_one(q) !== undefined);
  force(pid);
  const strong = strong_one(pid);
  let sc = act(pid, "call")["scene"];
  sc = act(pid, "present", { scene: sc["id"], topics: not_his(pid, 3) })["scene"];
  if (sc["question"]) act(pid, "answer", { scene: sc["id"], answer: "deflect" });
  refused(() => act(pid, "pitch", { scene: sc["id"] }), 400);
  const before = recruiting.pending(st, ME, pid);
  const r = act(pid, "pitch", { pitch: strong, scene: sc["id"] });
  const word = letter(pid, strong);
  equal(r["reaction"], { kind: scenes.case_kind(st, ME, pid, strong), text: `${name(strong)}: Yes, one of his priorities. Your case there: ${word}.`,
    you: `You led with ${name(strong)}.`, revealed: strong });
  assert(recruiting.pending(st, ME, pid) > before, "the call's points land with the pitch");
  assert(!(pid in rc["scenes"][ME]), "the conversation is over");
  equal([last(pid, "pitch")["pitch"], last(pid, "pitch")["reaction"], last(pid, "pitch")["action"]], [strong, r["reaction"]["kind"], "call"]);
  assert(rc["contacts"][pid][ME]["calls"] === 1, "the call is counted when its pitch lands");
  refused(() => act(pid, "pitch", { pitch: strong, scene: sc["id"] }), 409);
  // a No
  const other = cold();
  force(other);
  sc = act(other, "call")["scene"];
  sc = act(other, "present", { scene: sc["id"], topics: not_his(other, 3) })["scene"];
  if (sc["question"]) act(other, "answer", { scene: sc["id"], answer: "deflect" });
  const miss = not_his(other, 1)[0];
  const no = act(other, "pitch", { pitch: miss, scene: sc["id"] })["reaction"];
  equal([no["kind"], no["text"], no["revealed"]], ["polite", `${name(miss)}: No, not one of his priorities.`, null]);
});

test("what his decider cares about counts as one of his: a Yes in your opening and to your lead-with", () => {
  const fits = (q) => !mine(q).includes("academics") && strengths(q)["academics"] >= recruiting.BACKFIRE;
  // (what he wants on his mom's topic is drawn with it: the recruit is made hers before he is picked)
  const pid = cold((q) => { force(q, "business", "mom", "academics"); return fits(q) && kind_of(q, "academics") !== "quiet"; });
  force(pid, "business", "mom", "academics");
  let sc = act(pid, "call")["scene"];
  const topics = ["academics", ...not_his(pid, 2)];
  const r = act(pid, "present", { scene: sc["id"], topics });
  assert(r["points"] > 0 && r["hit"].length === 1 && r["hit"][0] === "academics" && r["scene"]["present"]["kind"] !== "polite", () => show([r["points"], r["hit"]]));
  assert(!((rc["revealed"][ME] || {})[pid] || []).includes("academics"), "it is his mom's, not one of his own priorities");
  if (r["scene"]["question"]) act(pid, "answer", { scene: sc["id"], answer: "deflect" });
  const said = act(pid, "pitch", { pitch: "academics", scene: sc["id"] })["reaction"];
  assert(said["kind"] !== "polite" && said["text"].startsWith("Academics: Yes"), () => show(said));
  // the same pitch to a recruit who decides himself is a No
  const self = cold(fits);
  force(self);
  sc = act(self, "call")["scene"];
  const r2 = act(self, "present", { scene: sc["id"], topics: ["academics", ...not_his(self, 3).filter((t) => t !== "academics").slice(0, 2)] });
  equal([r2["points"], r2["hit"], r2["scene"]["present"]["kind"]], [0.0, [], "polite"]);
  if (r2["scene"]["question"]) act(self, "answer", { scene: sc["id"], answer: "deflect" });
  assert(act(self, "pitch", { pitch: "academics", scene: sc["id"] })["reaction"]["kind"] === "polite");
});

test("a Shy recruit's in-home visit opening is worth one and a half times a plain recruit's", () => {
  const pid = cold((q) => strong_one(q) !== undefined);
  const points = (personality) => {
    force(pid, personality);
    delete rc["contacts"][pid];
    rc["pending"] = {}; rc["why_week"] = {}; rc["scenes"] = {};
    const sc = act(pid, "hc_visit")["scene"];
    return act(pid, "present", { scene: sc["id"], topics: [strong_one(pid), ...not_his(pid, 2)] })["points"];
  };
  const base = points("business"), shy = points("shy");
  assert(base > 0 && Math.abs(shy - persona.SHY_VISIT * base) < 1e-9, () => show([shy, base]));
  rc["scenes"] = {};
});

test("an in-home visit says who decides, teaches you so, and its note on the money names the one who decides", () => {
  const pid = cold();
  force(pid, "business", "grandma", "proximity");
  let sc = act(pid, "hc_visit")["scene"];
  equal(sc["turns"].slice(0, 2), [{ who: "note", text: `In-home visit with ${rc["prospects"][pid]["name"]}.` }, { who: "note", text: "Decides: Grandmother." }]);
  assert(persona.view(st, ME, pid)["decider"] === "Grandmother");
  const r = act(pid, "present", { scene: sc["id"], topics: recruiting.PITCHES.slice(0, 3) });
  sc = r["scene"];
  const money = sc["turns"].find((t) => t["who"] === "note" && /NIL|money/.test(t["text"]));
  assert(money && money["text"].startsWith("His grandmother ") && !/his (dad|mom)\b/i.test(money["text"]), () => show(sc["turns"]));
  equal(sc["ask"], recruiting.ask_view(st, ME, pid), "the conversation's ask is the profile's");
  if (r["points"]) equal(Object.keys(rc["why_week"][pid][ME]), ["hc_visit"], "a visit's points sit on the visit");
  plain(sc);
  // a call has no such notes
  const other = cold();
  force(other, "business", "dad", "nil");
  assert(!act(other, "call")["scene"]["turns"].some((t) => t["text"].startsWith("Decides")));
  assert(persona.view(st, ME, other)["decider"] === null);
});

test("the visit's note on his NIL ask is in numerals and says where your NIL stands", () => {
  const pid = cold();
  const nil = recruiting._nil(st, ME);
  const keep = nil["budget"];
  nil["budget"] = Object.values(nil["held"]).reduce((a, b) => a + b, 0) + 40;      // 40 NIL left
  try {
    for (const [decider, who] of Object.entries(scenes.ASK_WHO)) {
      force(pid, "business", decider, decider === "self" ? null : persona.DECIDER_TOPICS[decider][0]);
      // his ask is stated as your scouts have it (the profile's His Ask), never as something he said
      equal(scenes.ask_note(st, ME, pid, { exact: 115 }), `${who} wants to know about NIL. Your scouts have his ask at 115, more than you have left (40).`);
      equal(scenes.ask_note(st, ME, pid, { exact: 30 }), `${who} wants to know about NIL. Your scouts have his ask at 30. You have 40 NIL left.`);
      // before a complete report: the range His Ask shows, never a number inside it
      equal(scenes.ask_note(st, ME, pid, { lo: 20, hi: 55 }), `${who} wants to know about NIL. Your scouts have his ask between 20 and 55. You have 40 NIL left.`);
      equal(scenes.ask_note(st, ME, pid, { lo: 90, hi: 140 }), `${who} wants to know about NIL. Your scouts have his ask between 90 and 140, more than you have left (40).`);
      equal(scenes.ask_note(st, ME, pid, { exact: 0 }), `${who} says the money isn't the point.`);
    }
  } finally {
    nil["budget"] = keep;
  }
});

test("a recruit who wants playing time asks about a named player, and you answer before you pitch", () => {
  const rate = scenes.QUESTION_RATE;
  scenes.QUESTION_RATE = 1.0;
  try {
    const asks = (q) => mine(q).includes("playing_time") && (recruiting.ahead_of(st, ME, q) || recruiting.other_offered(st, ME, q));
    const pid = cold(asks);
    force(pid);
    let sc = act(pid, "call")["scene"];
    assert(sc["question"] === null, "he asks after your opening");
    sc = act(pid, "present", { scene: sc["id"], topics: not_his(pid, 3) })["scene"];
    const q = sc["question"];
    assert(q && ["roster", "recruit"].includes(q["kind"]) && q["text"].includes(q["about"]["name"]) && q["answer"] === null, () => show(q));
    equal(sc["turns"].at(-1), { who: "note", text: "He has a question." });
    assert(!sc["lines"].includes(q["text"]), "the question is its own field, not a line");
    assert(/^[A-Z]/.test(q["text"]) && /[.?]$/.test(q["text"]) && !q["text"].includes("{"), q["text"]);
    refused(() => act(pid, "pitch", { pitch: "winning", scene: sc["id"] }), 409, "answer him first");
    refused(() => act(pid, "answer", { scene: sc["id"], answer: "shrug" }), 400);
    const before = recruiting.pending(st, ME, pid);
    const r = act(pid, "answer", { scene: sc["id"], answer: "straight" });
    assert(Math.abs(r["points"] - recruiting.ANSWER_STRAIGHT) < 1e-9 && Math.abs(recruiting.pending(st, ME, pid) - before - r["points"]) < 1e-9, () => show(r["points"]));
    equal([sc["question"]["answer"], sc["question"]["reply"]], ["straight", "Answer noted."]);
    assert(rc["revealed"][ME][pid].includes("playing_time"), "a straight answer tells you he cares about playing time");
    refused(() => act(pid, "answer", { scene: sc["id"], answer: "deflect" }), 409, "you already answered");
    act(pid, "pitch", { pitch: "winning", scene: sc["id"] });
    // a sidestep earns nothing
    const other = cold(asks);
    force(other);
    sc = act(other, "call")["scene"];
    sc = act(other, "present", { scene: sc["id"], topics: not_his(other, 3) })["scene"];
    const d = act(other, "answer", { scene: sc["id"], answer: "deflect" });
    equal([d["points"], sc["question"]["reply"]], [0.0, "Sidestepped."]);
    // a recruit who does not care about playing time asks nothing
    const none = cold((x) => !mine(x).includes("playing_time"));
    force(none);
    sc = act(none, "call")["scene"];
    sc = act(none, "present", { scene: sc["id"], topics: not_his(none, 3) })["scene"];
    assert(sc["question"] === null);
    refused(() => act(none, "answer", { scene: sc["id"], answer: "straight" }), 409, "he asked nothing");
  } finally {
    scenes.QUESTION_RATE = rate;
  }
});

test("a Package Deal asks about his mate, with three answers that name him", () => {
  const a = cold(), b = cold();
  force(a, "business", "self", null, "package", { mate: b, lead: true });
  force(b, "business", "self", null, "package", { mate: a, lead: false });
  const mate = rc["prospects"][b]["name"];
  let sc = act(a, "call")["scene"];
  equal(sc["package"], { pid: b, name: mate, offered: false });
  sc = act(a, "present", { scene: sc["id"], topics: not_his(a, 3) })["scene"];
  const q = sc["question"];
  assert(q["kind"] === "package" && q["text"].includes(mate) && q["about"]["pid"] === b, () => show(q));
  equal(Object.keys(q["answers"]), scenes.ANSWERS);
  equal(Object.values(q["answers"]).map((x) => x["label"]), ["Tell Him Straight", "Promise Him an Offer", "Sidestep It"]);
  for (const x of Object.values(q["answers"])) assert(!x["text"].includes("{") && x["text"].endsWith("."), x["text"]);
  // promising his mate an offer earns nothing now: it waits on the offer, and he does not ask again
  const r = act(a, "answer", { scene: sc["id"], answer: "promise" });
  equal([r["points"], sc["question"]["reply"]], [0.0, "Promise believed."]);
  const pr = rc["contacts"][a][ME]["promises"].at(-1);
  equal([pr["kind"], pr["about"]["pid"], pr["broken"], pr["kept"]], ["package", b, null, null]);
  const again = scenes.question(st, ME, a, st["current_week"] + 1, scenes.package_about(st, ME, a));
  assert(again === null || again["kind"] !== "package", "he does not ask about his mate again");
  // once his mate holds your offer the answers change
  rc["offers"][ME] = [...(rc["offers"][ME] || []), b];
  equal(Object.values(scenes.package_answers(scenes.package_about(st, ME, a))).map((x) => x["label"]), ["Already Offered Him", "Promise His Spot", "Sidestep It"]);
  rc["offers"][ME] = rc["offers"][ME].filter((x) => x !== b);
});

test("a call that pesters him gets no answers and no points", () => {
  const pid = cold((q) => strong_one(q) !== undefined);
  force(pid);
  // four schools well ahead of you on his list, and your free contacts used up: one more is pestering
  rc["lists"][pid] = { michigan: 30.0, alabama: 30.0, georgia: 30.0, texas: 30.0, [ME]: 0.0 };
  rc["contacts"][pid] = { [ME]: { n: persona.pester_free(st, pid), hc_week: null } };
  assert(recruiting.not_considering(st, ME, pid));
  assert(recruiting.would_pester(st, ME, pid));
  let sc = act(pid, "call")["scene"];
  assert(sc["tired"] === true && sc["turns"][1]["text"] === "He is tired of your contact this week: no answers until he has a break.", () => show(sc["turns"]));
  const r = act(pid, "present", { scene: sc["id"], topics: [strong_one(pid), ...not_his(pid, 2)] });
  equal([r["points"], r["scene"]["present"]["kind"]], [0.0, "tired"]);
  equal(r["scene"]["lines"], ["No answer: he is tired of your contact this week."]);
  assert(!((rc["revealed"][ME] || {})[pid] || []).length, "a tired recruit tells you nothing");
});

test("every question line and answer fills with a name and reads as a sentence", () => {
  const fields = { ahead: "X", ahead_cls: "X", position: "X", other: "X", mate: "X" };
  const fill = (line) => line.replace(/\{(\w+)\}/g, (_, k) => { assert(k in fields, `${line}: {${k}}`); return fields[k]; });
  for (const lines of Object.values(scenes.QUESTION_LINES)) {
    assert(lines.length >= 3);
    for (const line of lines) assert(/^[A-Z]/.test(fill(line)) && /[.?]$/.test(line), line);
  }
  for (const table of Object.values(scenes.PACKAGE_ANSWERS)) {
    for (const [label, line] of Object.values(table)) {
      assert(title_case(label) && /^[A-Z]/.test(fill(line)) && line.endsWith("."), () => show([label, line]));
    }
  }
  for (const text of Object.values(scenes._TOPIC_NAME)) {
    assert(title_case(text), `Title Case: ${text}`);
  }
  equal(Object.keys(scenes._TOPIC_NAME).sort(), [...recruiting.PITCHES].sort(), "every pitch has its name");
});

test("his History keeps the conversation: the opening, the pitch and how he took it", () => {
  const pid = cold((q) => strong_one(q) !== undefined);
  force(pid);
  let sc = act(pid, "call")["scene"];
  sc = act(pid, "present", { scene: sc["id"], topics: [strong_one(pid), ...not_his(pid, 2)] })["scene"];
  if (sc["question"]) act(pid, "answer", { scene: sc["id"], answer: "deflect" });
  act(pid, "pitch", { pitch: strong_one(pid), scene: sc["id"] });
  const kinds = prospects.board_row(st, pid, ME)["history"].map((e) => e["kind"]);
  assert(kinds.includes("present") && kinds.includes("pitch"), () => show(kinds));
});

await run();
