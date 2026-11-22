// Play Coach Career seasons and hold their recruiting to the real classes it was learned from
// (recruiting_model.json): class sizes by tier, how far from home prospects sign, where the blue
// chips go, which programs land the best classes, and when prospects commit, sign and decommit.
//
// Usage:  node tools/check_recruiting.mjs            # 1 season
//         node tools/check_recruiting.mjs 3          # more seasons, steadier numbers
import path from "node:path";
import * as st from "../engine_js/pystat.js";
import { sorted, sum, round, odict } from "../engine_js/pyrt.js";
import { boot, is_main, f, pct, left, right, repr } from "./pytext.mjs";

// (metric, low, high, real) — the tolerances tests/test_recruiting_realism.mjs holds
// (the numbers as Python wrote them, since a line prints them that way: "want 0.75-1.0")
export const TOLERANCES = [
  ["p4_class", "19.5", "24.5", "21.7"],
  ["g5_class", "16.5", "21.5", "18.9"],
  ["in_state", "0.3", "0.42", "0.36"],
  ["median_miles", "220", "340", "280"],
  ["blue_chip_schools", "12", "24", "18"],
  ["max_five_stars", "0", "8", "6"],         // the most five-stars one school signs (real 2026: 6; Georgia and Alabama have signed 7 and 8)
  ["strength_rank_r", "0.75", "1.0", "1.0"],
  ["committed_by_12", "0.5", "1.0", null],
  ["signed_early", "0.8", "0.9", null],
  ["top300_decommits", "0.07", "0.22", null],   // real: about 8-15% of the top 300 decommit; a seed can land just under
  ["pos_mae", "0.0", "0.5", null],          // the league's signed positions a class against the real mix, mean absolute error a group
  ["over_need", "0", "2", null],            // the most one school signs at a group past its room there (target minus returning)
  ["no_qb_share", "0.0", "0.1", null],     // schools signing no quarterback
  ["max_qb", "0", "3", null],               // the most quarterbacks one school signs
  ["top100_top25", "0.65", "0.95", "0.8"],   // the top 100 prospects signing with the 25 strongest programs (real: about 80%)
];
export const GROUP_247 = { OT: "OL", IOL: "OL", EDGE: "DL" };   // the real classes' positions to roster groups (ATH and LS are left out)
export const GROUPS = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S"];

let game = null;
/** The game the seasons are played with (a caller that already has one: tests/test_recruiting_realism.mjs). */
export function use(g) { game = g; }

export function play(seed, team = "georgia") {
  const { season, files } = game;
  const state = season.new_season(team, "full", seed, undefined, undefined, true);
  season.advance_to(state, season.FINAL_WEEK);
  files.remove_dir(path.posix.dirname(season.box_dir(state)));   // the sim's box scores: not needed here
  return state;
}

function _spearman(a, b) {
  const ranks = (v) => {
    const order = sorted(v.map((_, i) => i), (i) => v[i]);
    const r = v.map(() => 0.0);
    order.forEach((i, k) => { r[i] = k; });
    return r;
  };
  const ra = ranks(a), rb = ranks(b);
  const ma = st.mean(ra), mb = st.mean(rb);
  const num = sum(ra.map((x, i) => (x - ma) * (rb[i] - mb)));
  return num / (sum(ra.map((x) => (x - ma) ** 2)) * sum(rb.map((y) => (y - mb) ** 2))) ** 0.5;
}

export function measure(state) {
  const { season, recruiting } = game;
  const rc = state["recruiting"];
  const teams = season.load_teams(), model = recruiting.model()["teams"];
  const schools = [...recruiting.fbs_schools(state)];
  const classes = Object.fromEntries(schools.map((s) => [s, [...recruiting.signed_class(state, s)]]));
  const fbs = Object.entries(classes).flatMap(([s, pids]) => pids.map((pid) => [pid, s]));
  const pros = rc["prospects"];
  const tier = (t) => schools.filter((s) => (model[s]["tier"] ?? null) === t).map((s) => classes[s].length);
  const miles = fbs.filter(([, s]) => model[s]["location"]).map(([pid, s]) => recruiting._miles([...pros[pid]["home"]], [...model[s]["location"]]));
  const blue = (s) => classes[s].filter((pid) => pros[pid]["stars"] >= 4).length / Math.max(1, classes[s].length);
  const strength = Object.fromEntries(schools.map((s) => [s, classes[s].length ? st.mean(classes[s].map((pid) => pros[pid]["composite"])) : 0.0]));
  const first_commit = {}, early = new Set(), decommitted = new Set();
  for (const e of rc["log"]) {
    if ((e["kind"] === "commit" || e["kind"] === "flip") && !(e["pid"] in first_commit)) first_commit[e["pid"]] = e["week"];
    if (e["kind"] === "signed" && e["school"] !== "FCS" && e["week"] === recruiting.early_signing_week()) early.add(e["pid"]);
    if (e["kind"] === "decommit") decommitted.add(e["pid"]);
  }
  const top300 = Object.entries(pros).filter(([, p]) => p["rank"] <= 300).map(([pid]) => pid);
  const real_sum = Object.fromEntries(GROUPS.map((g) => [g, 0.0])), got_sum = Object.fromEntries(GROUPS.map((g) => [g, 0]));
  const qbs = [];
  let over = 0;
  for (const s_ of schools) {
    const room = recruiting.needs(state, s_);
    for (const [g, n] of Object.entries(recruiting.commits_by_group(state, s_))) room[g] += n;
    for (const [pos, n] of Object.entries(model[s_]["positions_per_class"] || {})) {
      const g = GROUP_247[pos] ?? pos;
      if (g in real_sum) real_sum[g] += n;
    }
    const got = Object.fromEntries(GROUPS.map((g) => [g, 0]));
    for (const pid of classes[s_]) {
      const g = recruiting._group_of(pros[pid]);
      if (g in got) got[g] += 1;
    }
    for (const g of GROUPS) got_sum[g] += got[g];
    qbs.push(got["QB"]);
    over = Math.max(over, Math.max(...GROUPS.map((g) => got[g] - Math.max(0, room[g]))));
  }
  const top25 = new Set(sorted(Object.keys(model), (s_) => -model[s_]["strength"]["baseline"]).slice(0, 25));
  const top100 = fbs.filter(([pid]) => pros[pid]["rank"] <= 100);
  const actions = Object.fromEntries(Object.entries(rc["action_points"] || {}).filter(([, v]) => v[0]).map(([a, v]) => [a, round(v[1] / v[0], 2)]));
  const leader_changes = Object.values(rc["leader_changes"] || {});
  const generational = rc["generational"] || [];
  return {
    "actions": actions, "leader_changes_per_week": leader_changes.length ? round(st.mean(leader_changes), 1) : 0.0,
    "pos_mae": st.mean(GROUPS.map((g) => Math.abs(got_sum[g] - real_sum[g]) / schools.length)),
    "no_qb_share": qbs.filter((q) => q === 0).length / qbs.length, "max_qb": Math.max(...qbs), "over_need": over,
    "p4_class": st.mean(tier("Power 4")),
    "g5_class": st.mean(tier("Group of 5")),
    "in_state": fbs.filter(([pid, s]) => pros[pid]["hometown"]["state"] === teams[s]["state"]).length / fbs.length,
    "median_miles": st.median(miles),
    "blue_chip_schools": schools.filter((s) => classes[s].length && blue(s) >= 0.5).length,
    "max_five_stars": Math.max(...schools.map((s) => classes[s].filter((pid) => pros[pid]["stars"] === 5).length)),
    "strength_rank_r": _spearman(schools.map((s) => strength[s]), schools.map((s) => model[s]["strength"]["baseline"])),
    "committed_by_12": fbs.filter(([pid]) => (first_commit[pid] ?? 99) < 12).length / fbs.length,
    "signed_early": early.size / fbs.length,
    "top300_decommits": top300.filter((pid) => decommitted.has(pid)).length / top300.length,
    "top100_top25": top100.filter(([, s_]) => top25.has(s_)).length / Math.max(1, top100.length),
    "fcs_share": Object.values(rc["status"]).filter((s) => s["signed"] === "FCS").length / Object.keys(rc["status"]).length,
    "generational": generational.length,
    "generational_top25": generational.filter((pid) => top25.has(rc["status"][pid]["signed"])).length,
    "looks": looks_distribution(state),
  };
}


export const LOOK_BINS = [["0", (n) => n === 0], ["0.5-1.5", (n) => 0 < n && n < 2], ["2", (n) => n === 2], ["2.5", (n) => n === 2.5], ["3", (n) => n >= 3]];

/** The share of the class at each look count on signing day (looks in trip units: an area week is half a
 * look up to two, a Send one, a report complete at three): the bins 0 / 0.5-1.5 / 2 / 2.5 / 3. */
export function looks_distribution(state) {
  const rc = state["recruiting"];
  const looks = Object.keys(rc["prospects"]).map((pid) => game.recruiting.report_looks(rc["reads"][pid] ?? null));
  // (an odict: the bins named "0", "2" and "3" would otherwise come first, ahead of "0.5-1.5")
  return odict(LOOK_BINS.map(([name, test]) => [name, looks.filter((n) => test(n)).length / Math.max(1, looks.length)]));
}

/** Lines comparing a season with the real numbers; a failing metric is marked. */
export function report(m) {
  const out = [];
  for (const [key, lo, hi, real] of TOLERANCES) {
    const ok = Number(lo) <= m[key] && m[key] <= Number(hi);
    out.push(`${ok ? "  " : "! "}${left(key, 18)} ${right(f(m[key], 3), 8)}   want ${lo}-${hi}` + (real !== null ? ` (real ${real})` : ""));
  }
  out.push(`  ${left("fcs_share", 18)} ${right(f(m["fcs_share"], 3), 8)}`);
  out.push(`  generational ${m["generational"]} (signed with top-25 classes: ${m["generational_top25"]} of ${m["generational"]})`);
  out.push("  looks at signing day (share of the class): " + Object.entries(m["looks"]).map(([k, v]) => `${k} looks ${pct(v)}`).join(", ")
    + "  (an area week is half a look up to two; your Sends finish the reports)");
  // the weight of each action: mean interest points one earns (pitches, strengths, cooling and diminishing returns in)
  out.push("  interest a go by action: " + sorted(Object.entries(m["actions"] || {}), (kv) => -kv[1]).map(([a, v]) => `${a} ${repr(v, { floats: true })}`).join(", ")
    + `; a week's leader changes ${repr(m["leader_changes_per_week"] ?? 0, { floats: true })} prospects`);
  return out;
}


export const PRESENT_WITH = ["winning", "playing_time", "coach"];      // the scripted calls' opening: three things, the same every call

// recruiting.act(state, slug, pid, action, pitch, nil, scene, answer, topics): Python's keywords, in its order
const act = (state, team, pid, action, { pitch, scene, answer, topics } = {}) => game.recruiting.act(state, team, pid, action, pitch, undefined, scene, answer, topics);

/** How often your call scene's cue leads you to one of his priorities: a fresh career, the first
 * 100 prospects you can see, each a call, presenting PRESENT_WITH and pitching the first topic the
 * cue names (the band: 0.55-0.75, set by scenes.CUE_TWO_SIDED). Also what a player's call is worth a
 * go: the opening's points and the pitch's, against the one-shot call the AI makes (BASE_POINTS). */
export function reveal_rate(seed, team = "georgia") {
  const { season, recruiting } = game;
  const state = season.new_season(team, "full", seed, undefined, undefined, true);
  const rc = state["recruiting"];
  const pids = [...recruiting.prospect_list(state)].filter((q) => !rc["prospects"][q]["hidden"]).slice(0, 100);
  let found = 0, present = 0.0, pitch = 0.0, told = 0;
  for (const pid of pids) {
    rc["hours"][team] = 100;
    let sc = act(state, team, pid, "call")["scene"];
    const before = recruiting.pending(state, team, pid);
    sc = act(state, team, pid, "present", { scene: sc["id"], topics: [...PRESENT_WITH] })["scene"];
    const mid = recruiting.pending(state, team, pid);
    if (sc["question"]) act(state, team, pid, "answer", { scene: sc["id"], answer: "deflect" });   // he asked about a named player: the pitch waits on an answer
    if (!sc["cue"]["topics"].length) continue;   // a Guarded or first-call Shy recruit keeps it to himself: no cue to follow
    told += 1;
    const r = act(state, team, pid, "pitch", { pitch: sc["cue"]["topics"][0], scene: sc["id"] });
    found += r["reaction"]["kind"] === "hit" || r["reaction"]["kind"] === "quiet" ? 1 : 0;
    present += mid - before;
    pitch += recruiting.pending(state, team, pid) - mid;
  }
  told = Math.max(1, told);
  return { rate: found / told, present: present / told, pitch: pitch / told, quiet: pids.length - told, calls: pids.length };
}

/** How often a call brings a question about a named player (scenes.QUESTION_RATE of the calls to
 * recruits who care about playing time), the roster/recruit split, and how often a promise would be
 * hollow (roster questions; PROMISE_MARGIN sets it, the band 30-60% truthful): a fresh career, the first
 * 300 prospects you can see, each a call, every question promised. */
export function question_mix(seed, team = "georgia") {
  const { season, recruiting } = game;
  const scenes = game.modules.scenes;
  const state = season.new_season(team, "full", seed, undefined, undefined, true);
  const rc = state["recruiting"];
  const pids = [...recruiting.prospect_list(state)].filter((q) => !rc["prospects"][q]["hidden"]).slice(0, 300);
  const out = { calls: pids.length, playing_time: 0, questions: 0, roster: 0, recruit: 0, promises: 0, hollow: 0 };
  for (const pid of pids) {
    rc["hours"][team] = 100;
    const pri = rc["prospects"][pid]["priorities"];
    out["playing_time"] += (Array.isArray(pri) ? pri.includes("playing_time") : "playing_time" in pri) ? 1 : 0;
    let sc = act(state, team, pid, "call")["scene"];
    sc = act(state, team, pid, "present", { scene: sc["id"], topics: [...PRESENT_WITH] })["scene"];   // his question follows the opening
    const q = sc["question"];
    if (!q) continue;
    out["questions"] += 1;
    out[q["kind"]] = (out[q["kind"]] ?? 0) + 1;     // a Package Deal question counts beside roster and recruit
    const r = act(state, team, pid, "answer", { scene: sc["id"], answer: "promise" });
    if (q["kind"] === "roster") {
      out["promises"] += 1;
      out["hollow"] += r["truthful"] === false ? 1 : 0;
    }
  }
  out["rate"] = scenes.QUESTION_RATE;
  return out;
}

export function main(argv) {
  const { recruiting } = game;
  const n = argv.length > 0 ? Number.parseInt(argv[0], 10) : 1;
  if (Number.isNaN(n)) throw new Error(`ValueError: invalid literal for int() with base 10: '${argv[0]}'`);
  const rr = reveal_rate(1);
  console.log(`  player reveal rate ${f(rr["rate"], 3)}   want 0.55-0.75  (${rr["quiet"]} of ${rr["calls"]} first calls kept it to himself: Guarded or Shy)`);
  console.log(`  a player's call a go: opening ${f(rr["present"], 2)} + pitch on the cue ${f(rr["pitch"], 2)} = ${f(rr["present"] + rr["pitch"], 2)} `
    + `(a one-shot call ${repr(recruiting.BASE_POINTS["call"], { floats: true })}; want the opening about a quarter of the call: PRESENT_HIT ${repr(recruiting.PRESENT_HIT, { floats: true })})`);
  const qm = question_mix(1);
  console.log(`  recruit questions: ${qm["questions"]} on ${qm["calls"]} calls (${qm["playing_time"]} care about playing time; `
    + `want about ${f(qm["rate"], 2)} of those), roster ${qm["roster"]} / recruit ${qm["recruit"]}; `
    + `roster promises truthful ${qm["promises"] - qm["hollow"]} of ${qm["promises"]}   want 30-60%`);
  for (let seed = 1; seed <= n; seed++) {
    console.log(`season seed ${seed}`);
    console.log(report(measure(play(seed))).join("\n"));
  }
}

if (is_main(import.meta.url)) {
  use(await boot());
  main(process.argv.slice(2));
  process.exit(0);
}
