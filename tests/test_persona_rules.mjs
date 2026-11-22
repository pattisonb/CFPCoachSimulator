// What a recruit's personality and decider change on the engine side (persona.js rules): Cocky, Shy,
// Guarded, Loves the Attention, All Business, and the decider's topic and the Trainer's NIL. Each test forces
// the persona on one prospect in a fresh career and compares it to a neutral baseline on the same prospect.
// `node tests/test_persona_rules.mjs`
import { start, test, run, assert } from "./harness.mjs";

const game = await start();
const { season, recruiting } = game;
const { persona } = game.modules;

const ME = "ohio-state";

function fresh(seed = 5) {
  const st = season.new_season(ME, "full", seed, undefined, undefined, true);
  st["current_week"] = 1;
  return st;
}

function force(st, pid, personality, decider = "self", topic = null) {
  st["recruiting"]["prospects"][pid]["persona"] = { personality, decider, decider_topic: topic };
}

function reset(st, pid) {
  const rc = st["recruiting"];
  delete rc["contacts"][pid];
  rc["pending"] = {}; rc["why_week"] = {}; rc["scenes"] = {};
  rc["hours"][ME] = 1000;
  delete rc["revealed"][ME];
  if ((rc["offers"][ME] || []).length) rc["offers"][ME].length = 0;
}

/** An untouched prospect and a pitch you are strong enough on not to backfire. */
function prospect(st, pitch_in_priorities = true, want = null) {
  const rc = st["recruiting"];
  const by_rank = Object.keys(rc["prospects"]).sort((a, b) => rc["prospects"][a]["rank"] - rc["prospects"][b]["rank"]);
  for (const pid of by_rank) {
    const p = rc["prospects"][pid];
    if (p["hidden"] || rc["status"][pid]["committed"] || ME in rc["lists"][pid]) continue;
    const s = recruiting.strengths(st, ME, pid);
    for (const t of (want || recruiting.PITCHES)) {
      if (p["priorities"].includes(t) === pitch_in_priorities && s[t] >= recruiting.BACKFIRE) return [pid, t];
    }
  }
  throw new Error("no prospect fits");
}

/** The points one pitched contact lands. A message goes through `_act`, the one-pitch path Auto-recruit and the AI
 * schools use: your own message by hand carries no pitch (`act` drops it and counts your grades, see `by_hand`). */
function pts(st, pid, action, pitch, personality, decider = "self", topic = null) {
  force(st, pid, personality, decider, topic);
  reset(st, pid);
  (action === "message" ? recruiting._act : recruiting.act)(st, ME, pid, action, pitch);
  return recruiting.pending(st, ME, pid);
}

/** The points your own message lands: no pitch, worth your grades on what he cares about (recruiting._grade_points). */
function by_hand(st, pid, personality, decider = "self", topic = null) {
  force(st, pid, personality, decider, topic);
  reset(st, pid);
  recruiting.act(st, ME, pid, "message", "prestige");     // the pitch is dropped
  return recruiting.pending(st, ME, pid);
}

function approx(a, b) {
  return Math.abs(a - b) < 1e-9;
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

test("persona rules", () => {
  let st = fresh();
  let rc = st["recruiting"];
  let pid, t, _;

  // test_cocky_pitch: x1.3 on playing time and prestige, not on academics
  [pid, t] = prospect(st, true, ["playing_time", "prestige"]);
  assert(approx(pts(st, pid, "message", t, "cocky"), 1.3 * pts(st, pid, "message", t, "shy")));
  let [pid2, t2] = prospect(st, true, ["academics"]);
  assert(approx(pts(st, pid2, "message", t2, "cocky"), pts(st, pid2, "message", t2, "shy")));
  // ... and your own message carries no pitch, so nothing for Cocky to like more: it is worth your grades on what he cares about
  const hand = by_hand(st, pid, "cocky");
  const s = recruiting.strengths(st, ME, pid);
  const tops = rc["prospects"][pid]["priorities"];
  assert(approx(hand, by_hand(st, pid, "shy")) && approx(hand, recruiting.BASE_POINTS["message"] * (recruiting.PITCH_PRIORITY[0] + recruiting.PITCH_PRIORITY[1] * sum(tops.map((x) => s[x])) / tops.length)), () => String(hand));
  const last = rc["log"][rc["log"].length - 1];
  assert(last["kind"] === "contact" && last["pid"] === pid && last["action"] === "message" && !("pitch" in last), () => JSON.stringify(last));

  // test_cocky_lowball_at_70: 0.6 x ask is a lowball for Cocky, not for Shy
  [pid, _] = prospect(st);
  let ask = recruiting.ask_from(st, ME, pid);
  assert(ask >= 20, () => String(ask));
  const nil = Math.trunc(0.6 * ask) + 1;
  force(st, pid, "cocky");
  assert(recruiting.is_lowball(nil, ask, persona.lowball_share(st, pid)));
  force(st, pid, "shy");
  assert(!recruiting.is_lowball(nil, ask, persona.lowball_share(st, pid)));
  assert(persona.lowball_share(st, pid) === recruiting.LOWBALL);

  // test_zero_ask_never_lowball
  assert(!recruiting.is_lowball(0, 0) && !recruiting.is_lowball(0, 0, 0.8));

  // test_shy_first_call_half_and_no_reveal
  [pid, t] = prospect(st);
  const full = pts(st, pid, "call", t, "business");
  const half = pts(st, pid, "call", t, "shy");
  assert(approx(half, 0.5 * full), () => JSON.stringify([half, full]));
  assert(!((rc["revealed"][ME] || {})[pid] || []).length, "a first call reveals nothing to a Shy recruit");
  force(st, pid, "shy");
  reset(st, pid);
  (rc["contacts"][pid] ??= {})[ME] = { n: 1, hc_week: null, calls: 1 };
  assert(persona.call_reveals(st, ME, pid, false), "a second call may reveal");
  rc["contacts"][pid][ME]["calls"] = 0;
  assert(!persona.call_reveals(st, ME, pid, false));

  // test_shy_visit_1_5
  [pid, t] = prospect(st);
  assert(approx(pts(st, pid, "hc_visit", t, "shy"), 1.5 * pts(st, pid, "hc_visit", t, "business")));

  // test_guarded_call_never_reveals_visit_does
  [pid, t] = prospect(st);
  for (let wk = 1; wk < 40; wk++) {                       // never, however the roll falls
    st["current_week"] = wk;
    force(st, pid, "guarded");
    reset(st, pid);
    assert(!persona.call_reveals(st, ME, pid), String(wk));      // the week's roll itself, every week of the year
    if (recruiting.closed(st)) {                 // the dead period (Championship Week to the last Signing Day): no call at all
      let e = null;
      try {
        recruiting.act(st, ME, pid, "call", t);
      } catch (err) {
        if (!(err instanceof recruiting.RecruitingError)) throw err;
        e = err;
      }
      assert(e !== null, `a call went through in the dead period (week ${wk})`);
      assert(e.code === 409 && e.message.includes(recruiting.CLOSED_TEXT), () => JSON.stringify([wk, e.message]));
      assert(!(rc["contacts"][pid] || {})[ME] && rc["hours"][ME] === 1000, String(wk));
    } else {
      recruiting.act(st, ME, pid, "call", t);
      assert(rc["contacts"][pid][ME]["calls"] === 1, String(wk));
    }
    assert(!((rc["revealed"][ME] || {})[pid] || []).length, String(wk));
    assert(recruiting.closed(st) === (wk >= recruiting.close_week()), String(wk));
  }
  st["current_week"] = 1;
  force(st, pid, "guarded");
  reset(st, pid);
  recruiting.act(st, ME, pid, "hc_visit", t);
  assert(rc["revealed"][ME][pid].length, "an in-home visit always tells");
  // ... but a conversation is plain: your opening gets a Yes or No to each topic, a Guarded recruit's call too, and a
  // Yes tells you it is one of his
  const [pid3, t3] = prospect(st, true);
  force(st, pid3, "guarded");
  reset(st, pid3);
  let sc = recruiting.act(st, ME, pid3, "call")["scene"];
  assert(!((rc["revealed"][ME] || {})[pid3] || []).length, "opening the call tells nothing yet");
  const opening = [t3, ...recruiting.PITCHES.filter((x) => x !== t3 && !rc["prospects"][pid3]["priorities"].includes(x)).slice(0, 2)];
  const shown = recruiting.act(st, ME, pid3, "present", undefined, undefined, sc["id"], undefined, opening);
  sc = rc["scenes"][ME][pid3];
  assert(shown["hit"].length === 1 && shown["hit"][0] === t3 && sc["present"]["hit"].includes(t3), () => JSON.stringify(shown["hit"]));
  assert(sc["cue"]["text"].split(" · ").filter((x) => x.endsWith(": Yes")).length === 1, sc["cue"]["text"]);
  assert(rc["revealed"][ME][pid3].length === 1 && rc["revealed"][ME][pid3][0] === t3, "a Yes tells you it is one of his");
  if (sc["question"] && !sc["question"]["answer"]) recruiting.act(st, ME, pid3, "answer", undefined, undefined, sc["id"], "deflect");
  const said = recruiting.act(st, ME, pid3, "pitch", t3, undefined, sc["id"])["reaction"];
  assert(["hit", "fair"].includes(said["kind"]) && said["text"].includes("Yes, one of his priorities"), () => JSON.stringify(said));

  // test_guarded_decommit_half
  [pid, _] = prospect(st);
  force(st, pid, "guarded");
  const g = recruiting.flip_weekly(st, pid, 10.0, 20);
  force(st, pid, "cocky");
  const n = recruiting.flip_weekly(st, pid, 10.0, 20);
  assert(g > 0 && approx(g, 0.5 * n), () => JSON.stringify([g, n]));

  // test_attention_pester_free_5
  [pid, _] = prospect(st);
  force(st, pid, "attention");
  assert(persona.pester_free(st, pid) === 5);
  force(st, pid, "shy");
  assert(persona.pester_free(st, pid) === recruiting.PESTER_FREE && recruiting.PESTER_FREE === 3);
  force(st, pid, "attention");
  reset(st, pid);
  (rc["contacts"][pid] ??= {})[ME] = { n: 3, hc_week: null };
  rc["lists"][pid] = { michigan: 30.0, alabama: 30.0, georgia: 30.0, texas: 30.0, [ME]: 0.0 };
  assert(recruiting.not_considering(st, ME, pid));
  assert(!recruiting.would_pester(st, ME, pid), "three contacts are still free to a recruit who loves the attention");
  rc["contacts"][pid][ME]["n"] = 5;
  assert(recruiting.would_pester(st, ME, pid));
  force(st, pid, "shy");
  rc["contacts"][pid][ME]["n"] = 3;
  assert(recruiting.would_pester(st, ME, pid));

  // test_attention_cools_after_two_quiet_weeks
  st = fresh(6);
  rc = st["recruiting"];
  [pid, t] = prospect(st);
  force(st, pid, "attention");
  reset(st, pid);
  recruiting.act(st, ME, pid, "message", t);
  assert(rc["contacts"][pid][ME]["last_contact"] === 1);
  persona.cool_quiet(st, 2);
  assert(!recruiting.cooled(st, ME, pid) && !rc["contacts"][pid][ME]["cooled_until"]);
  persona.cool_quiet(st, 3);
  assert(rc["contacts"][pid][ME]["cooled_until"] === 4);
  force(st, pid, "shy");
  delete rc["contacts"][pid][ME]["cooled_until"];
  persona.cool_quiet(st, 3);
  assert(!rc["contacts"][pid][ME]["cooled_until"], "only Attention recruits cool");

  // test_attention_skips_committed_school
  pid2 = Object.keys(rc["prospects"]).find((q) => q !== pid && !rc["status"][q]["committed"] && !rc["status"][q]["signed"]);
  force(st, pid2, "attention");
  rc["contacts"][pid2] = { [ME]: { n: 1, hc_week: null, last_contact: 1 }, michigan: { n: 1, hc_week: null, last_contact: 1 } };
  rc["status"][pid2]["committed"] = ME;
  persona.cool_quiet(st, 4);
  assert(!rc["contacts"][pid2][ME]["cooled_until"], "the school he committed to is not cooled");
  assert(rc["contacts"][pid2]["michigan"]["cooled_until"] === 5);
  rc["status"][pid2]["committed"] = null;

  // test_business_message_0_3
  st = fresh();
  rc = st["recruiting"];
  [pid, t] = prospect(st);
  assert(approx(pts(st, pid, "message", t, "business"), 0.3 * pts(st, pid, "message", t, "shy")));
  assert(approx(by_hand(st, pid, "business"), 0.3 * by_hand(st, pid, "shy")), "a message by hand counts 0.3 too");

  // test_decider_topic_counts_as_priority: a pitch on Mom's topic scores like a priority
  [pid, t] = prospect(st, false, ["proximity", "academics"]);
  const other = pts(st, pid, "message", t, "shy");
  const as_topic = pts(st, pid, "message", t, "shy", "mom", t);
  assert(as_topic > other && approx(as_topic, recruiting.BASE_POINTS["message"] * (recruiting.PITCH_PRIORITY[0] + recruiting.PITCH_PRIORITY[1] * recruiting.strengths(st, ME, pid)[t])));
  assert(persona.counts_as_priority(st, pid, t));
  force(st, pid, "shy", "dad", "nil");
  assert(!persona.counts_as_priority(st, pid, t));
  const visit_plain = pts(st, pid, "hc_visit", t, "shy", "mom", t);
  const visit_other = pts(st, pid, "hc_visit", t, "shy", "dad", "nil");
  assert(visit_plain > visit_other);

  // test_trainer_lowball_at_80_and_nil_to_1_2x
  [pid, _] = prospect(st);
  const p = rc["prospects"][pid];
  force(st, pid, "shy", "trainer", "nil");
  assert(persona.lowball_share(st, pid) === 0.8);
  ask = 100;
  assert(recruiting.is_lowball(75, ask, persona.lowball_share(st, pid)) && !recruiting.is_lowball(85, ask, persona.lowball_share(st, pid)));
  const k = recruiting.NIL_VALUE[recruiting.tier_of(p)] ?? 0.1;
  assert(approx(recruiting.nil_value(p, 120, ask, st), k * 120));
  assert(approx(recruiting.nil_value(p, 150, ask, st), k * (120 + recruiting.NIL_OVER * 30)));
  force(st, pid, "shy");
  assert(approx(recruiting.nil_value(p, 120, ask, st), k * (100 + recruiting.NIL_OVER * 20)));
  assert(approx(recruiting.nil_value(p, 120, ask), recruiting.nil_value(p, 120, ask, st)));
  force(st, pid, "business");
  assert(approx(recruiting.nil_value(p, 100, ask, st), 1.3 * k * 100));
  console.log("test_persona_rules: ok");
});

await run();
