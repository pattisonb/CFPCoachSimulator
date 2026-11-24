// School grades are letters, and a recruit weighs them against what he wants (career_js/grades.js SCHOOL_LINES,
// career_js/recruiting/part6.js). One scale turns a value into a letter for the game and the page. Each recruit holds
// standards, drawn once from his own seed, typical for his stars and leaning with his personality, and never sent to
// the page. Your letter against his standard decides how he takes a pitch (five ways), his interest before anyone has
// worked him, what a contact is worth, your quick actions' blanket rate, and whether he will consider you at all. A
// recruit who shuts the door, who cut his list without you or who has signed cannot be put on your board, in the
// portal either; one already there stays, with every action off.
// `node tests/test_standards.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted } from "../engine_js/pyrt.js";

const game = await start();
const { api, season, recruiting } = game;
const { grades, persona, prospects, programs, scenes } = game.modules;
const LOCKOUT_GAME = recruiting.LOCKOUT_AT;
assert(LOCKOUT_GAME === 3.5, "the game's line: more recruits shut the door than at the first 5.0");
recruiting.LOCKOUT_AT = 5.0;   // these tests hold the rule at the line they were written at (forced standards a set distance from it); the game's own is LOCKOUT_GAME


const ME = "iowa";
const show = (v) => () => JSON.stringify(v);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

const sid = api.call("POST", "/api/season", { team: ME, mode: "full", seed: 11, career: true })["id"];
const G = (p) => api.call("GET", `/api/season/${sid}/${p}`);
const R = (p, body) => api.call("POST", `/api/season/${sid}/${p}`, body);
const st = api.loaded_state(), rc = st["recruiting"];
const P = rc["prospects"];
const everyone = Object.keys(P);
const top3 = (pid) => P[pid]["priorities"];

function refused(fn, code, words) {
  try { fn(); } catch (e) {
    if (!(e instanceof api.ApiError) && !(e instanceof recruiting.RecruitingError)) throw e;
    assert((e.status ?? e.code) === code && e.message.includes(words), `${e.status ?? e.code} ${e.message}`);
    assert(/^[A-Z].*\.$/.test(e.message) && !/\b(null|undefined|NaN)\b/.test(e.message), `a plain sentence: ${e.message}`);
    return;
  }
  throw new Error(`expected ${code} ${words}`);
}

/** Run `fn` with his standards and your strengths held where the test wants them. */
function held(pid, wants, strengths, fn, slug = ME) {
  const levers = [new recruiting.forced_standards(st, pid, wants), ...Object.entries(strengths).map(([t, v]) => new recruiting.forced_strength(st, slug, pid, t, v))];
  for (const l of levers) l.__enter__();
  try { return fn(); } finally { for (const l of levers.reverse()) l.__exit__(); }
}

/** A visible recruit nobody has touched, with no story, as a plain recruit (All Business, decides himself). */
const used = new Set();
function plain(want = () => true) {
  for (const pid of recruiting.prospect_list(st)) {
    if (used.has(pid) || P[pid]["hidden"] || pid in rc["contacts"] || rc["status"][pid]["committed"] || persona.story(st, pid)[0] !== null || !want(pid)) continue;
    used.add(pid);
    P[pid]["persona"] = { personality: "business", decider: "self", decider_topic: null, story: null, story_data: {}, commit_style: "hat" };
    return pid;
  }
  throw new Error("no such prospect");
}

// ----- A: one scale, value to letter -------------------------------------------------------------------------------

test("a school grade is a letter on one scale, A+ to F, with recruiting's two cut-offs on its lines", () => {
  equal(grades.SCHOOL_LINES.map(([l]) => l), ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"]);
  equal(grades.SCHOOL_LINES.map(([l]) => l).reverse(), grades.ORDER, "the game's own letters, worst first (career_js/grades.js ORDER)");
  const floors = grades.SCHOOL_LINES.map(([, f]) => f);
  assert(floors.every((f, i) => i === 0 || f < floors[i - 1]) && floors.at(-1) === 0, show(floors));
  for (const [l, f] of grades.SCHOOL_LINES) {                // each line: the value on it earns the letter, a hair under it the next one down
    equal([grades.school(f), grades.school_pull(f / 100)], [l, l]);
    if (f > 0) assert(grades.place(grades.school(f - 0.01)) === grades.place(l) - 1 && grades.place(grades.school_pull((f - 0.01) / 100)) === grades.place(l) - 1, l);
  }
  equal([grades.school(100), grades.school(0), grades.school_pull(1), grades.school_pull(0)], ["A+", "F", "A+", "F"]);
  // a strong case starts at the bottom of the B's, and a case that backfires is an F
  equal([grades.school_floor("B-") / 100, grades.school_floor("D-") / 100], [recruiting.STRONG_CASE, recruiting.BACKFIRE]);
  equal([grades.school_pull(recruiting.STRONG_CASE), grades.school_pull(recruiting.STRONG_CASE - 0.001)], ["B-", "C+"]);
  equal([grades.school_pull(recruiting.BACKFIRE), grades.school_pull(recruiting.BACKFIRE - 0.001)], ["D-", "F"]);
  // the Programs page and a pitch topic read the same scale: the page is sent the letter
  equal([programs.word_of(74), scenes._case_word(0.74)], ["B+", "B+"]);
});

test("the letters spread sensibly over every program: A+ and F are the rare ends", () => {
  const all = [];
  for (const r of G("programs")["rows"]) for (const [k, l] of Object.entries(r["letters"])) if (typeof l === "string") all.push(l);
  const share = (test_) => all.filter(test_).length / all.length;
  assert(all.length > 1500 && all.every((l) => grades.ORDER.includes(l)));
  assert(share((l) => l === "A+") < 0.05 && share((l) => l === "F") < 0.15, show([share((l) => l === "A+"), share((l) => l === "F")]));
  for (const band of "BCD") assert(share((l) => l[0] === band) > 0.15, band);        // the middle letters carry the league
  assert(share((l) => l[0] === "A") > 0.05 && share((l) => l[0] === "A") < 0.2);
});

test("the page is sent the letters: a program's row, a recruit's file and his board row", () => {
  const view = G("programs");
  equal(view["lines"], grades.SCHOOL_LINES);
  assert(view["you"]["letters"]["prestige"] === programs.word_of(view["you"]["prestige"]));
  const pid = plain((q) => recruiting.blocked(st, ME, q) === null);
  R("board", { pid, on: true });
  const row = G("recruiting")["board"].find((b) => b["id"] === pid), file = G(`prospect/${pid}`);
  equal(Object.keys(row["case"]).sort(), [...recruiting.PITCHES].sort());
  for (const [t, v] of Object.entries(row["strength"])) equal(row["case"][t], grades.school_pull(v), t);
  equal(file["case"], row["case"]);
});

// ----- B: his standards ----------------------------------------------------------------------------------------------

test("his standards are drawn once from his own seed: the same every time, in a copy of the save, and stored nowhere", () => {
  const first = Object.fromEntries(everyone.slice(0, 300).map((q) => [q, { ...recruiting.standards(st, q) }]));
  recruiting._STANDARDS.clear();
  for (const q of Object.keys(first)) equal(recruiting.standards(st, q), first[q], q);
  // a save holds none of it, so a career saved before this draws the same when it loads
  const text = JSON.stringify(st);
  assert(!/standard|"fit"|"wants"/.test(text), "nothing about his standards is in the save");
  const old = JSON.parse(text);
  for (const q of Object.keys(first)) equal(recruiting.standards(old, q), first[q], q);
  assert(recruiting.locked_out(old, ME, everyone[0]) === recruiting.locked_out(st, ME, everyone[0]));
  // another career's recruits want other things
  const other = season.new_season(ME, "full", 12, undefined, undefined, true);
  const ids = Object.keys(other["recruiting"]["prospects"]).slice(0, 300);
  assert(ids.some((q) => q in first && JSON.stringify(recruiting.standards(other, q)) !== JSON.stringify(first[q])));
  // one topic each for his three priorities (and his decider's when it is not one of them), each a grade's place
  for (const q of Object.keys(first)) {
    const topic = persona.of(st, q)["decider_topic"];
    equal(Object.keys(first[q]).sort(), [...new Set([...top3(q), ...(topic ? [topic] : [])])].sort(), q);
    for (const v of Object.values(first[q])) assert(Number.isInteger(v) && v >= grades.place(recruiting.STANDARD_RANGE[0]) && v <= grades.place(recruiting.STANDARD_RANGE[1]));
  }
});

test("his standards follow his stars, vary from recruit to recruit, and ease down his priorities", () => {
  const by = { 2: [], 3: [], 4: [], 5: [] }, second = { 2: [], 3: [], 4: [], 5: [] }, third = { 2: [], 3: [], 4: [], 5: [] };
  for (const q of everyone) {
    const [a, b, c] = top3(q), s = recruiting.standards(st, q);
    if ([a, b, c].some((t) => t in recruiting.STANDARD_EASE)) continue;      // (Close to Home is eased whatever his stars)
    by[P[q]["stars"]].push(s[a]); second[P[q]["stars"]].push(s[b]); third[P[q]["stars"]].push(s[c]);
  }
  for (const stars of [2, 3, 4, 5]) {
    const want = grades.place(recruiting.STANDARD_TOP[stars]);
    const typical = by[stars].filter((v) => Math.abs(v - want) <= 1).length / by[stars].length;
    assert(typical > 0.4 && typical < (stars === 2 || stars === 5 ? 0.97 : 0.75), show([stars, typical]));   // most sit at their stars' letter, far from all (a two-star's cannot go under the range's floor, nor a five-star's over its top)
    assert(new Set(by[stars]).size >= 4, "they vary");
    assert(mean(by[stars]) > mean(second[stars]) && mean(second[stars]) >= mean(third[stars]), show([stars, mean(by[stars]), mean(second[stars]), mean(third[stars])]));
  }
  assert(mean(by[5]) > mean(by[4]) && mean(by[4]) > mean(by[3]) && mean(by[3]) > mean(by[2]));
  equal([5, 4, 3, 2].map((s) => recruiting.STANDARD_TOP[s]), ["A", "B", "C", "D"]);
  // about one in four is a notch easier and one in five a notch harder (three-stars: the big group, away from the range's ends)
  const want3 = grades.place("C");
  const easier = by[3].filter((v) => v <= want3 - 2).length / by[3].length, harder = by[3].filter((v) => v >= want3 + 2).length / by[3].length;
  assert(easier > 0.17 && easier < 0.33 && harder > 0.13 && harder < 0.29, show([easier, harder]));
  // a five-star holds real standards on all three; a three-star's third is well down
  assert(mean(third[5]) >= grades.place("B-") && mean(second[5]) >= grades.place("B+") && mean(third[3]) < grades.place("C-"), show([mean(second[5]), mean(third[5]), mean(third[3])]));
});

test("his standards lean with his personality: a Cocky recruit wants more, a Shy one less", () => {
  const pids = everyone.filter((q) => P[q]["stars"] === 3).slice(0, 600);
  const as = (k) => mean(pids.map((q) => recruiting._draw_standards(rc["seed"], false, q, 3, top3(q), null, k)[top3(q)[0]]));
  const [cocky, plain_, shy] = [as("cocky"), as("guarded"), as("shy")];
  assert(cocky > plain_ + 0.3 && plain_ > shy + 0.3, show([cocky, plain_, shy]));
  // the same recruit never wants less as a Cocky one than as a Shy one
  for (const q of pids.slice(0, 200)) {
    const c = recruiting._draw_standards(rc["seed"], false, q, 3, top3(q), null, "cocky"), s = recruiting._draw_standards(rc["seed"], false, q, 3, top3(q), null, "shy");
    for (const t of top3(q)) assert(c[t] >= s[t], q);
  }
});

test("no view the page can read carries his standards or how well you fit him", () => {
  const pid = plain((q) => recruiting.blocked(st, ME, q) === null && P[q]["stars"] >= 4);
  R("board", { pid, on: true });
  const views = [G("recruiting"), G(`prospect/${pid}`), G("prospects?limit=200"), G("scouting"), G("programs"), G("headquarters"), G("classes"),
    api.call("GET", `/api/season/${sid}`)];
  const bad = /standard|"fit"|"wants"|"lockout|"move_mult|"quick_mult/i;
  for (const v of views) {
    const text = JSON.stringify(v);
    assert(!bad.test(text), () => text.match(bad)[0] + " in " + text.slice(Math.max(0, text.search(bad) - 80), text.search(bad) + 80));
  }
  // nor does a conversation: his reaction is all he gives away
  held(pid, Object.fromEntries(top3(pid).map((t) => [t, "A+"])), {}, () => {
    rc["hours"][ME] = 1000;
    const sc = R("recruit", { pid, action: "call" })["scene"];
    const r = R("recruit", { pid, action: "present", scene: sc["id"], topics: top3(pid) });
    assert(!bad.test(JSON.stringify(r)) && !/A\+ .*wants/.test(JSON.stringify(r)));
    delete rc["scenes"][ME][pid];
  });
});

// ----- C: what the standards do --------------------------------------------------------------------------------------

test("the fit is your letters on his priorities against what he wants, his first priority weighing most", () => {
  const pid = plain();
  const [a, b, c] = top3(pid);
  const fit = (wants, strengths) => held(pid, wants, strengths, () => recruiting.fit(st, ME, pid, { [ME]: strengths["winning"] ?? 0.5 }));
  const all = (v) => ({ [a]: v, [b]: v, [c]: v });
  assert(Math.abs(fit(all("B"), all(0.7))) < 1e-9, "a B program meets a recruit who wants B's");
  assert(Math.abs(fit(all("B"), all(0.9)) - recruiting.FIT_OVER_CAP) < 1e-9, "well over counts at most a letter");
  assert(Math.abs(fit(all("A"), all(0.0)) + recruiting.FIT_SHORT_CAP) < 1e-9, "far short counts at most three letters");
  // short on his first priority costs more than short on his third
  const first = fit(all("B"), { [a]: 0.45, [b]: 0.7, [c]: 0.7 }), third = fit(all("B"), { [a]: 0.7, [b]: 0.7, [c]: 0.45 });
  assert(first < third && third < 0, show([first, third]));
  const w = recruiting.PRIORITY_WEIGHTS, steps = grades.place("B") - grades.place("C-");
  assert(Math.abs(first + steps * w[0] / (w[0] + w[1] + w[2])) < 1e-9, show(first));
});

test("his interest before any contact follows the fit, for your school and every other", () => {
  const pid = plain();
  const easy = Object.fromEntries(top3(pid).map((t) => [t, "D-"])), hard = Object.fromEntries(top3(pid).map((t) => [t, "A+"]));
  for (const slug of [ME, "toledo", "georgia"]) {
    const loose = held(pid, easy, {}, () => recruiting.interest(st, slug, pid)), tight = held(pid, hard, {}, () => recruiting.interest(st, slug, pid));
    assert(loose > tight, show([slug, loose, tight]));
    const [lo, hi] = recruiting.FIT_INTEREST_RANGE;
    assert(loose - tight <= hi - lo + 1e-9, "the fit moves his interest by a bounded amount");
  }
  assert(!(ME in rc["lists"][pid]), "nobody has worked him: this is his list at week 0");
});

test("a contact is worth less the further the program is from what he wants, between a floor and a ceiling", () => {
  const pid = plain();
  const [a, b, c] = top3(pid);
  const all = (v) => ({ [a]: v, [b]: v, [c]: v });
  const mult = (wants, s) => held(pid, wants, s, () => recruiting.move_mult(st, ME, pid));
  const [far, short, meets, over] = [mult(all("A+"), all(0.0)), mult(all("B"), all(0.5)), mult(all("B"), all(0.7)), mult(all("D-"), all(1.0))];
  assert(far < short && short < meets && meets < over, show([far, short, meets, over]));
  equal([far, over], [recruiting.MOVE_FLOOR, recruiting.MOVE_CEIL]);
  assert(recruiting.MOVE_FLOOR > 0 && recruiting.MOVE_FLOOR < 1 && recruiting.MOVE_CEIL > 1);
  // any school's contact (the path the AI and Auto-recruit take): a call's base, scaled by it
  for (const [wants, s] of [[all("B"), all(0.5)], [all("D-"), all(1.0)]]) {
    held(pid, wants, s, () => {
      rc["pending"] = {}; delete rc["contacts"][pid]; rc["hours"]["texas"] = 1000;
      held(pid, wants, s, () => recruiting._act(st, "texas", pid, "call", null, 0), "texas");
      const got = recruiting.pending(st, "texas", pid);
      const want = held(pid, wants, s, () => recruiting.BASE_POINTS["call"] * recruiting.move_mult(st, "texas", pid) * persona.pitch_mult(st, pid, "call", null, true), "texas");
      assert(Math.abs(got - want) < 1e-9, show([got, want]));
    });
  }
  rc["pending"] = {}; delete rc["contacts"][pid];
});

test("a pitch on one of his priorities is taken five ways: your letter there against what he wants", () => {
  const pid = plain();
  const t = top3(pid)[0];
  const kind = (wants, strength) => held(pid, { [t]: wants }, { [t]: strength }, () => recruiting.reaction_kind(st, ME, pid, t));
  // he wants a B (67 and up)
  equal(kind("B", 0.95), "sold", "a full letter or more over");            // A+
  equal(kind("B", 0.87), "sold");                                          // A: three grades over
  equal(kind("B", 0.82), "hit", "over, but not by a letter");              // A-
  equal(kind("B", 0.67), "hit", "meets it");
  equal(kind("B", 0.62), "fair", "a little short");                        // B-
  equal(kind("B", 0.55), "fair");                                          // C+: two grades short
  equal(kind("B", 0.50), "lukewarm", "a letter short");                    // C
  equal(kind("B", 0.31), "lukewarm");                                      // D: two letters short
  equal(kind("A+", 0.31), "quiet", "far short");
  equal(kind("D-", 0.24), "quiet", "an F, whatever he wants");
  equal(kind("D-", 0.25), "hit");
  equal(recruiting.REACTIONS, ["sold", "hit", "fair", "lukewarm", "quiet"]);
  equal(recruiting.best_reaction(["lukewarm", "hit", "quiet"]), "hit");
  // each is worth a different amount, best first; he isn't buying it costs you
  const worth = recruiting.REACTIONS.slice(0, 4).map((k) => recruiting.REACTION_WORTH[k]);
  assert(worth.every((v, i) => i === 0 || v < worth[i - 1]) && worth.at(-1) > 0, show(worth));
  const opening = recruiting.REACTIONS.slice(0, 4).map((k) => recruiting.PRESENT_WORTH[k]);
  assert(opening.every((v, i) => i === 0 || v < opening[i - 1]));
});

test("each reaction lands end to end: the points, his line with your letter, and your History", () => {
  const cases = [["sold", "C", 0.9, "A"], ["hit", "B", 0.7, "B"], ["fair", "B", 0.62, "B-"], ["lukewarm", "B", 0.45, "C-"], ["quiet", "A", 0.3, "D"]];
  const seen = {};
  for (const [want, wants, strength, letter] of cases) {
    const pid = plain((q) => !top3(q).includes("nil"));
    const t = top3(pid)[0];
    const others = recruiting.PITCHES.filter((x) => !top3(pid).includes(x)).slice(0, 3);
    held(pid, { ...Object.fromEntries(top3(pid).map((x) => [x, "D-"])), [t]: wants }, { [t]: strength }, () => {
      rc["hours"][ME] = 1000;
      let sc = R("recruit", { pid, action: "call" })["scene"];
      sc = R("recruit", { pid, action: "present", scene: sc["id"], topics: others })["scene"];
      if (sc["question"]) R("recruit", { pid, action: "answer", scene: sc["id"], answer: "deflect" });
      const before = recruiting.pending(st, ME, pid);
      const out = R("recruit", { pid, action: "pitch", scene: sc["id"], pitch: t })["reaction"];
      equal([out["kind"], out["text"]], [want, `${scenes._TOPIC_NAME[t]}: Yes, one of his priorities. Your case there: ${letter}.`]);
      const got = recruiting.pending(st, ME, pid) - before;
      const base = recruiting.BASE_POINTS["call"];
      const mult = persona.pitch_mult(st, pid, "call", t, true) * recruiting.move_mult(st, ME, pid);
      const expect = want === "quiet" ? -recruiting.BACKFIRE_COST * base : base * recruiting.REACTION_WORTH[want] * mult;
      assert(Math.abs(got - expect) < 1e-9, show([want, got, expect]));
      seen[want] = got / (want === "quiet" ? 1 : mult);
      const e = rc["log"].filter((x) => x["kind"] === "pitch" && x["pid"] === pid).at(-1);
      equal([e["reaction"], e["pitch"]], [want, t]);
      equal(recruiting.pitch_marks(st, ME, pid)[t]["mark"], recruiting.PITCH_MARK[want]);
      const hist = G("recruiting")["board"].find((b) => b["id"] === pid);
      assert(hist === undefined || hist["history"].some((h) => h["kind"] === "pitch" && h["reaction"] === want), want);
    });
  }
  const order = ["sold", "hit", "fair", "lukewarm", "quiet"].map((k) => seen[k]);
  assert(order.every((v, i) => i === 0 || v < order[i - 1]) && order.at(-1) < 0, show(order));
  equal(Object.keys(recruiting.PITCH_MARK).slice(0, 5), ["sold", "hit", "fair", "lukewarm", "quiet"]);
});

test("your opening is taken the same way: the best of his that you pitched decides it", () => {
  const pid = plain((q) => !top3(q).includes("nil"));
  const [a, b] = top3(pid), other = recruiting.PITCHES.find((x) => !top3(pid).includes(x));
  held(pid, { [a]: "B", [b]: "B", [top3(pid)[2]]: "B" }, { [a]: 0.45, [b]: 0.95 }, () => {
    rc["hours"][ME] = 1000;
    const sc = R("recruit", { pid, action: "call" })["scene"];
    const r = R("recruit", { pid, action: "present", scene: sc["id"], topics: [a, b, other] });
    equal(r["scene"]["present"], { kind: "sold", hit: [a, b] });
    const want = recruiting.PRESENT_HIT * recruiting.BASE_POINTS["call"] * (recruiting.PRESENT_WORTH["lukewarm"] + recruiting.PRESENT_WORTH["sold"]) * recruiting.move_mult(st, ME, pid);
    assert(Math.abs(r["points"] - Math.min(want, recruiting.BASE_POINTS["call"])) < 1e-9, show([r["points"], want]));
    assert(r["scene"]["turns"].some((x) => x["text"] === `Your case on his: ${scenes._TOPIC_NAME[a]} C-, ${scenes._TOPIC_NAME[b]} A+.`), show(r["scene"]["turns"]));
    delete rc["scenes"][ME][pid];
  });
});

test("a quick action is one blanket increase, its base scaled by the fit between a floor and a ceiling", () => {
  const pid = plain();
  const [a, b, c] = top3(pid);
  const all = (v) => ({ [a]: v, [b]: v, [c]: v });
  const quick = (wants, s) => held(pid, wants, s, () => recruiting.quick_mult(st, ME, pid));
  const [far, short, meets, over] = [quick(all("A+"), all(0.0)), quick(all("B"), all(0.5)), quick(all("B"), all(0.7)), quick(all("D-"), all(1.0))];
  assert(far < short && short < meets && meets < over, show([far, short, meets, over]));
  equal([far, over], [recruiting.QUICK_FLOOR, recruiting.QUICK_CEIL]);
  // through the page's own calls: a message by hand, and a call and a video call planned from his row
  const sent = (action, wants, s) => held(pid, wants, s, () => {
    rc["pending"] = {}; delete rc["contacts"][pid]; rc["hours"][ME] = 1000; delete rc["planned"];
    if (action === "message") R("recruit", { pid, action });
    else { R("recruit/plan", { pid, action, on: true }); recruiting._run_planned(st); }
    const got = recruiting.pending(st, ME, pid);
    const want = recruiting.BASE_POINTS[action] * recruiting.QUICK_BASE[action] * recruiting.quick_mult(st, ME, pid)
      * persona.pitch_mult(st, pid, action, null, false) * (action === "call" ? recruiting.QUICK_CALL : 1.0);
    assert(got > 0 && Math.abs(got - want) < 1e-9, show([action, got, want]));
    return got;
  });
  for (const action of recruiting.PLANNABLE) {
    // (the floor is reached well before he shuts the door: four grades short here)
    const [lo, mid, hi] = [sent(action, all("B+"), all(0.5)), sent(action, all("B"), all(0.7)), sent(action, all("D-"), all(1.0))];
    assert(lo < mid && mid < hi, show([action, lo, mid, hi]));
    assert(Math.abs(hi / lo - recruiting.QUICK_CEIL / recruiting.QUICK_FLOOR) < 1e-9, "the same blanket scale for each");
  }
  // a conversation can beat the blanket rate (He's Sold) or fall under it (he isn't buying it)
  assert(recruiting.REACTION_WORTH["sold"] * recruiting.MOVE_CEIL > recruiting.QUICK_BASE["call"] * recruiting.QUICK_CEIL);
  rc["pending"] = {}; delete rc["contacts"][pid]; delete rc["planned"]; delete rc["carry"];
});

// ----- C5 and D: the lockout, his finalists, a signed recruit --------------------------------------------------------

test("a recruit too far from what you offer will not consider you from week 0, and the door can open", () => {
  assert(st["current_week"] === 0);
  const shut = everyone.filter((q) => recruiting.locked_out(st, ME, q));
  const stars = (n) => everyone.filter((q) => P[q]["stars"] === n);
  const rate = (n) => shut.filter((q) => P[q]["stars"] === n).length / stars(n).length;
  assert(shut.length > 0 && rate(5) > rate(4) && rate(4) > rate(3) && rate(2) === 0, show([rate(5), rate(4), rate(3), rate(2)]));
  assert(rate(5) < 0.6 && rate(3) < 0.02, "a mid program is shut out by some of the best, hardly anyone else");
  // a blue blood is shut out by almost nobody; a small program by many of the best
  const n_at = (slug) => everyone.filter((q) => P[q]["stars"] >= 4 && recruiting.locked_out(st, slug, q)).length;
  assert(n_at("georgia") < n_at(ME) && n_at(ME) < n_at("toledo"), show([n_at("georgia"), n_at(ME), n_at("toledo")]));
  const pid = shut.find((q) => !P[q]["hidden"]);
  equal(recruiting.blocked(st, ME, pid), { why: "locked", text: recruiting.LOCKED_TEXT });
  assert(recruiting.not_considering(st, ME, pid), "he is not considering you");
  // near the edge it lifts when your season goes well, and comes back when it goes badly
  const edge = plain();
  const wants = Object.fromEntries(top3(edge).map((t) => [t, "A"])), s = Object.fromEntries(top3(edge).map((t) => [t, 0.5]));    // six grades short...
  held(edge, { ...wants, [top3(edge)[2]]: "C" }, s, () => {                                                                // ... on two of three: near the line
    const f = recruiting.fit(st, ME, edge, { [ME]: 0.5 });
    assert(f > -recruiting.LOCKOUT_AT - recruiting.LOCKOUT_WINNING && f < -recruiting.LOCKOUT_AT + recruiting.LOCKOUT_WINNING, show(f));
    const at = (w) => recruiting.locked_out(st, ME, edge, { [ME]: w });
    equal([at(0.1), at(0.95)], [true, false], "winning opens the door, losing shuts it");
  });
  // and when your case itself improves
  held(edge, wants, s, () => assert(recruiting.locked_out(st, ME, edge, { [ME]: 0.5 })));
  held(edge, wants, Object.fromEntries(top3(edge).map((t) => [t, 0.7])), () => assert(!recruiting.locked_out(st, ME, edge, { [ME]: 0.5 })));
});

test("a recruit who shut the door cannot be put on your board; one already there stays, every action off", () => {
  const pid = plain((q) => recruiting.blocked(st, ME, q) === null);
  const shut = Object.fromEntries(top3(pid).map((t) => [t, "A+"])), none = Object.fromEntries(top3(pid).map((t) => [t, 0.0]));
  held(pid, shut, none, () => {
    const row = G("prospects?limit=5000")["rows"].find((r) => r["id"] === pid);
    equal(row["blocked"], { why: "locked", text: recruiting.LOCKED_TEXT });
    refused(() => R("board", { pid, on: true }), 409, "will not consider your program");
    assert(!rc["board"].includes(pid));
    assert(!recruiting.recommended(st, ME).some((r) => r["pid"] === pid), "never recommended");
  });
  R("board", { pid, on: true });                                         // the door open: on he goes
  held(pid, shut, none, () => {                                           // ... and it shuts later
    const row = G("recruiting")["board"].find((b) => b["id"] === pid);
    assert(row && row["blocked"]["why"] === "locked", "he stays on your board, marked out");
    rc["hours"][ME] = 1000;
    for (const action of ["message", "call", "call_recruit", "hc_visit", "offer", "official_visit"]) {
      refused(() => R("recruit", { pid, action, nil: 0 }), 409, "will not consider your program");
    }
    for (const action of recruiting.PLANNABLE) refused(() => R("recruit/plan", { pid, action, on: true }), 409, "will not consider your program");
    assert(!(pid in rc["contacts"]) || !rc["contacts"][pid][ME]?.["n"], "nothing landed");
    R("board", { pid, on: false });                                       // you can still take him off
  });
  assert(!rc["board"].includes(pid));
});

test("the AI and your Auto-recruit leave a recruit alone who will not consider the school", () => {
  const before = JSON.stringify([rc["offers"], rc["boards"], rc["contacts"], rc["pending"], rc["hours"], rc["nil"], rc["revealed"], rc["visits"]]);
  try {
    for (const slug of ["toledo", ME]) {
      recruiting.auto_recruit(st, slug, new Random(`t-${slug}`), null, slug === ME);
      const shut = everyone.filter((q) => recruiting.locked_out(st, slug, q));
      assert(shut.length > 0);
      for (const q of shut) {
        assert(!rc["boards"][slug].includes(q) && !(rc["offers"][slug] || []).includes(q), `${slug} ${q}`);
        assert(!(rc["pending"][q] || {})[slug], "no contact lands");
      }
      assert((rc["offers"][slug] || []).length > 0, "it recruits the rest as it always did");
    }
  } finally {
    const [offers, boards, contacts, pending, hours, nil, revealed, visits] = JSON.parse(before);
    Object.assign(rc, { offers, boards, contacts, pending, hours, nil, revealed, visits });
    rc["board"].length = 0; delete rc["scenes"];
  }
});

test("once he holds an offer he cuts his list as signing day nears: 5, then 3, and a school not on it cannot add or work him", () => {
  const weeks = recruiting.FINALISTS.map(([w]) => w), sizes = recruiting.FINALISTS.map(([, n]) => n);
  equal(sizes, [5, 3]);
  assert(recruiting.TOP_GROUP === 10);
  assert(weeks.every((w, i) => i === 0 || w > weeks[i - 1]) && weeks.at(-1) < recruiting.close_week(), show(weeks));
  const pid = plain((q) => recruiting.blocked(st, ME, q) === null && P[q]["stars"] === 3);
  const week = st["current_week"], lists = rc["lists"][pid];
  try {
    rc["lists"][pid] = { michigan: 60, "ohio-state": 45, texas: 30, alabama: 2 };             // four schools have worked him
    st["current_week"] = weeks[0] - 1;
    equal([recruiting.finalists_size(st), recruiting.top_size(st), recruiting.cut_out(st, ME, pid)], [null, recruiting.TOP_GROUP, false], "before the first cut he is open to anyone");
    st["current_week"] = weeks[1];
    equal([recruiting.top_size(st, pid), recruiting.cut_out(st, ME, pid)], [recruiting.TOP_GROUP, false], "nobody has offered him: he has not cut his list");
    (rc["offers"]["michigan"] ||= []).push(pid);                                              // his first offer: now he narrows
    st["current_week"] = weeks[0];
    equal([recruiting.top_size(st, pid), recruiting.cut_out(st, ME, pid)], [5, false], "his top 5 has room for one more");
    st["current_week"] = weeks[1];
    equal([recruiting.top_size(st, pid), recruiting.top_group(st, pid), recruiting.cut_out(st, ME, pid)], [3, ["michigan", "ohio-state", "texas"], true]);
    assert(recruiting.cut_out(st, "alabama", pid) && !recruiting.cut_out(st, "texas", pid), "the fourth school is cut, the third is a finalist");
    equal(recruiting.blocked(st, ME, pid), { why: "finalists", text: "He has cut his list to his top 3, and you are not on it." });
    assert(G("prospects?limit=5000")["rows"].find((r) => r["id"] === pid)["top_size"] === 3);
    refused(() => R("board", { pid, on: true }), 409, "cut his list to his top 3");
    rc["hours"][ME] = 1000; rc["hours"]["alabama"] = 1000;
    refused(() => recruiting._act(st, "alabama", pid, "call", null, 0), 409, "cut his list");            // the AI's path too
    assert(recruiting._act(st, "texas", pid, "call", null, 0) !== undefined, "a finalist works him as before");
    // the school he committed to is never cut, whatever his list says
    rc["status"][pid]["committed"] = "alabama";
    assert(!recruiting.cut_out(st, "alabama", pid));
    rc["status"][pid]["committed"] = null;
    // one already on your board who cuts you stays, marked out
    st["current_week"] = weeks[0] - 1;
    R("board", { pid, on: true });
    st["current_week"] = weeks[1];
    const row = G("recruiting")["board"].find((b) => b["id"] === pid);
    assert(row && row["blocked"]["why"] === "finalists" && row["top_size"] === 3);
    refused(() => R("recruit", { pid, action: "message" }), 409, "cut his list");
    R("board", { pid, on: false });
  } finally {
    rc["offers"]["michigan"] = (rc["offers"]["michigan"] || []).filter((q) => q !== pid);
    st["current_week"] = week; rc["lists"][pid] = lists; rc["pending"] = {}; delete rc["contacts"][pid];
    rc["status"][pid]["committed"] = null;
  }
});

test("a signed recruit cannot be put on your board", () => {
  const pid = plain((q) => recruiting.blocked(st, ME, q) === null);
  rc["status"][pid]["signed"] = "michigan";
  try {
    assert(recruiting.blocked(st, ME, pid)["why"] === "signed" && recruiting.blocked(st, ME, pid)["text"] === `He has signed with ${recruiting.school_name("michigan")}.`);
    refused(() => R("board", { pid, on: true }), 409, "He has signed with");
    rc["status"][pid]["signed"] = "FCS";
    refused(() => R("board", { pid, on: true }), 409, "He has signed with an FCS school.");
    rc["status"][pid]["signed"] = ME;
    equal(recruiting.blocked(st, ME, pid), null, "your own signee is yours");
  } finally {
    rc["status"][pid]["signed"] = null;
  }
});

// ----- the portal ------------------------------------------------------------------------------------------------------

test("the portal plays by the same rules: transfers have standards, shut doors, finalists, and no adding a signed one", () => {
  const game_state = api.loaded_state();
  const rng = new Random(1), teams = season.load_teams();
  for (const g of Object.values(game_state["games"])) {             // every game played, every class signed, the season over
    const hs = rng.randint(10, 45);
    Object.assign(g, { played: true, home_score: hs + 3, away_score: hs - rng.randint(0, 9) });
  }
  const schools = Object.entries(teams).filter(([, t]) => !t["fictional"]).map(([s]) => s);
  sorted(everyone, (q) => P[q]["rank"]).slice(0, schools.length * 21).forEach((q, i) => { rc["status"][q]["signed"] = schools[i % schools.length]; });
  Object.assign(game_state, { done: true, current_week: season.FINAL_WEEK, champion: "ohio-state" });
  api._save_loaded();
  G("offseason");
  for (let i = 0; i < 12 && api.loaded_state()["offseason"]["stage"] !== "portal_w1"; i++) api.call("POST", `/api/season/${sid}/offseason/advance`, {});
  const ps = api.loaded_state(), prc = ps["recruiting"];
  assert(prc["portal"] === true && ps["offseason"]["stage"] === "portal_w1");
  const ids = Object.keys(prc["prospects"]);
  // standards: from his own seed, by the standing his overall gives him, stored nowhere
  assert(recruiting.STANDARD_PORTAL_STEP >= 0 && recruiting.PORTAL_FINALISTS.every(([w]) => w <= recruiting.PORTAL_WEEKS));
  for (const q of ids.slice(0, 100)) {
    const s = recruiting.standards(ps, q);
    equal(Object.keys(s).length >= 3 && Object.values(s).every((v) => Number.isInteger(v)), true);
    assert(!("standards" in prc["prospects"][q]));
  }
  const by_tier = (t) => ids.filter((q) => recruiting.tier_of(prc["prospects"][q]) === t && !(prc["prospects"][q]["priorities"][0] in recruiting.STANDARD_EASE))
    .map((q) => recruiting.standards(ps, q)[prc["prospects"][q]["priorities"][0]]);
  assert(by_tier(4).length && by_tier(2).length && mean(by_tier(4)) > mean(by_tier(2)), "a better transfer wants more");
  // the same board rules, through the page's own routes
  const rows = G("prospects?limit=5000")["rows"];
  assert(rows.every((r) => "blocked" in r && r["top_size"] === recruiting.TOP_GROUP));
  const open_ = rows.find((r) => r["blocked"] === null);
  const wants = Object.fromEntries(prc["prospects"][open_["id"]]["priorities"].map((t) => [t, "A+"]));
  const levers = [new recruiting.forced_standards(ps, open_["id"], wants), ...Object.keys(wants).map((t) => new recruiting.forced_strength(ps, ME, open_["id"], t, 0.0))];
  levers.forEach((l) => l.__enter__());
  try {
    refused(() => R("board", { pid: open_["id"], on: true }), 409, "will not consider your program");
  } finally {
    levers.reverse().forEach((l) => l.__exit__());
  }
  const pid = rows.filter((r) => r["blocked"] === null)[1]["id"];
  prc["lists"][pid] = { michigan: 60, "ohio-state": 45, texas: 30, alabama: 20, georgia: 12, oregon: 6 };      // more schools than his cut keeps
  const [from, n] = recruiting.PORTAL_FINALISTS.at(-1);
  prc["week"] = from;
  equal([recruiting.top_size(ps, pid), recruiting.blocked(ps, ME, pid)], [recruiting.TOP_GROUP, null], "nobody has offered him: he has not cut his list");
  (prc["offers"]["michigan"] ||= []).push(pid);
  equal([recruiting.top_size(ps, pid), recruiting.blocked(ps, ME, pid)?.["why"]], [n, "finalists"]);
  refused(() => R("board", { pid, on: true }), 409, `cut his list to his top ${n}`);
  prc["week"] = 1;
  equal(recruiting.blocked(ps, ME, pid), null, "before the portal's cut he is open");
  prc["status"][pid]["signed"] = "michigan";
  refused(() => R("board", { pid, on: true }), 409, "He has signed with");
  prc["status"][pid]["signed"] = null;
  R("board", { pid, on: true });
  assert(prc["board"].includes(pid));
});

await run();
