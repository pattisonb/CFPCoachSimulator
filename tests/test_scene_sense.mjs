// A call that makes sense (the player's November 11 ask): his answer to "where's your head at" starts from what you
// already know; decoys (a topic that is not his) only while he is sizing you up, never once he trusts you (CUE_TRUST_CONTACTS
// contacts, or your offer); his personality's line still names what landed; a lead you already made in your opening is
// noticed.
// `node tests/test_scene_sense.mjs`
import { start, test, run, assert } from "./harness.mjs";
import { get, sorted, truthy } from "../engine_js/pyrt.js";

// a word-mode test: the conversations it reads are the ones Clear Mode replaces (career_js/clear.js)
const game = await start({ env: { CFP_CLEAR: "0" } });
const { recruiting, season } = game;
const scenes = game.modules.scenes;

const ME = "iowa";

function fresh() {
  const st = season.new_season(ME, "full", 5, undefined, undefined, true);
  st["current_week"] = 1;
  return st;
}

function pid_of(st, n = 40) {
  const rc = st["recruiting"];
  return sorted(Object.keys(rc["prospects"]), (q) => rc["prospects"][q]["rank"]).filter((q) => !truthy(get(rc["prospects"][q], "hidden")))[n];
}

function fields(st, pid) {
  return scenes._fields(st, ME, st["recruiting"]["prospects"][pid]);
}

function cues(st, pid) {
  const out = [];
  for (let w = 1; w < 41; w++) out.push(scenes.cue(st, ME, pid, w, fields(st, pid)));
  return out;
}

const show = (v) => () => JSON.stringify(v);

test("test_decoys_early", () => {
  const st = fresh();
  const pid = pid_of(st);
  recruiting._contact(st, ME, pid)["n"] = 1;
  const pri = st["recruiting"]["prospects"][pid]["priorities"];
  assert(cues(st, pid).some((c) => c["topics"].some((t) => !pri.includes(t))), "early on he may toss in a topic that isn't his");
});

test("test_no_decoys_once_trusted", () => {
  let st = fresh();
  const pid = pid_of(st);
  const pri = st["recruiting"]["prospects"][pid]["priorities"];
  recruiting._contact(st, ME, pid)["n"] = scenes.CUE_TRUST_CONTACTS;
  assert(cues(st, pid).every((c) => c["topics"].every((t) => pri.includes(t))), "after enough contacts he's straight with you");
  st = fresh();
  recruiting._contact(st, ME, pid)["n"] = 1;
  (st["recruiting"]["offers"][ME] ??= []).push(pid);
  assert(cues(st, pid).every((c) => c["topics"].every((t) => pri.includes(t))), "your offer earns a straight answer");
});

test("test_cue_starts_from_known", () => {
  const st = fresh();
  const pid = pid_of(st);
  const pri = st["recruiting"]["prospects"][pid]["priorities"];
  (st["recruiting"]["revealed"][ME] ??= {})[pid] = [pri[0]];
  let c = scenes.cue(st, ME, pid, 3, fields(st, pid));
  assert(c["text"].includes(scenes.PHRASES[pri[0]]) && c["text"].indexOf(scenes.PHRASES[pri[0]]) < 40, show(c));
  assert(!c["topics"].includes(pri[0]), "the new part names something you haven't heard");
  st["recruiting"]["revealed"][ME][pid] = [...pri];
  c = scenes.cue(st, ME, pid, 3, fields(st, pid));
  assert(pri.every((t) => c["text"].includes(scenes.PHRASES[t])), "all three known: he sums them up");
});

test("test_persona_hit_names_what_landed", () => {
  const st = fresh();
  const pid = pid_of(st);
  const p = st["recruiting"]["prospects"][pid];
  const top = p["priorities"][0];
  const saved = scenes.PERSONA_LINE;
  scenes.PERSONA_LINE = 1.0;
  let r;
  try {
    const forced = new recruiting.forced_strength(st, ME, pid, top, 0.95);      // Python's `with`
    forced.__enter__();
    try {
      r = scenes.reaction(st, ME, pid, "hc_visit", top, p);
    } finally {
      forced.__exit__();
    }
  } finally {
    scenes.PERSONA_LINE = saved;
  }
  const phrase = scenes.PHRASES[top];
  assert(r["kind"] === "hit" && r["text"].toLowerCase().startsWith(phrase.toLowerCase()), show(r));
});

test("test_repeat_noticed", () => {
  const st = fresh();
  const pid = pid_of(st);
  const p = st["recruiting"]["prospects"][pid];
  const r = scenes.reaction(st, ME, pid, "hc_visit", p["priorities"][0], p, undefined, undefined, true);
  assert(r["text"].startsWith(scenes.REPEAT_LINE), show(r));
});

test("scene sense ok", () => {
  console.log("scene sense ok: decoys only early; the cue starts from what you know; a persona hit names what landed; a repeat is noticed");
});

await run();
