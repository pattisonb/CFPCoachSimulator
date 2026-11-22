// Customizing your schedule before the season (sim_js/season schedule_options, schedule_swap):
// in a career, before week 1, each of your non-conference games can be traded for another FBS
// team's non-conference game the same week (the two displaced opponents play each other), the
// other school agreeing when it gets the home game or you are the bigger draw; an FCS opponent can
// be swapped for another FCS team. Conference games and played weeks stay as they are.
// `node tests/test_schedule_edit.mjs`
import { start, test, run, assert } from "./harness.mjs";

const game = await start();
const { season } = game;

/** collections.Counter: add one to a key. */
const count = (c, k) => c.set(k, (c.get(k) || 0) + 1);

test("schedule edit", () => {
  const st = season.new_season("smu", "full", 1, undefined, undefined, true);
  const me = st["team"];
  const teams = season.load_teams();
  const before = new Map();
  for (const g of Object.values(st["games"])) {
    if (g["kind"] === "regular") {
      count(before, g["home"]);
      count(before, g["away"]);
    }
  }
  const mine = season.schedule_editable(st);
  assert(mine.length && mine.every((g) => !g["conference_game"] && g["kind"] === "regular" && [g["home"], g["away"]].includes(me)));
  const fbs_game = mine.find((g) => !teams[g["away"] === me ? g["home"] : g["away"]]["fictional"]);
  const old_opp = fbs_game["away"] === me ? fbs_game["home"] : fbs_game["away"];
  const opts = season.schedule_options(st, fbs_game["event_id"]);
  assert(opts.length >= 10 && opts.every((o) => ["slug", "name", "accepts", "why", "venue", "standing"].every((k) => k in o)), () => JSON.stringify(opts.slice(0, 1)));
  assert(opts.every((o) => !teams[o["slug"]]["fictional"]), "an FCS team offered for an FBS game");
  assert(opts.every((o) => o["slug"] !== me && o["slug"] !== old_opp));
  const pick = opts.find((o) => o["accepts"]);
  season.schedule_swap(st, fbs_game["event_id"], pick["slug"]);
  const g = st["games"][fbs_game["event_id"]];
  assert([g["home"], g["away"]].includes(pick["slug"]) && [g["home"], g["away"]].includes(me) && g["week"] === fbs_game["week"]);
  assert((g["home"] === me) === (pick["venue"] === "home"));
  // the displaced opponents play each other that week; every team keeps its game count; nobody plays twice
  const after = new Map();
  const weeks = new Map();
  for (const x of Object.values(st["games"])) {
    if (x["kind"] === "regular") {
      count(after, x["home"]);
      count(after, x["away"]);
      for (const side of [x["home"], x["away"]]) {
        if (!teams[side]["fictional"]) count(weeks, `${x["week"]}|${side}`);              // an FCS team can host several dates a week
      }
    }
  }
  const differ = [...new Set([...before.keys(), ...after.keys()])].filter((s) => (before.get(s) || 0) !== (after.get(s) || 0));
  assert(!differ.length, () => JSON.stringify(differ.map((s) => [s, before.get(s) || 0, after.get(s) || 0])));
  assert(Math.max(...weeks.values()) === 1, () => JSON.stringify([...weeks].filter(([, v]) => v > 1).map(([k]) => k).slice(0, 3)));
  const other = Object.values(st["games"]).find((x) => x["kind"] === "regular" && x["week"] === g["week"] && [x["home"], x["away"]].includes(old_opp));
  assert(![other["home"], other["away"]].includes(pick["slug"]) && ![other["home"], other["away"]].includes(me));
  const last = st["schedule_changes"][st["schedule_changes"].length - 1];
  assert(last["to"] === pick["slug"] && last["from"] === old_opp);
  // a refusal, a conference game and a played week are refused
  /** `fn` must be refused with a ScheduleError; any other outcome fails with `what`. */
  const refused = (fn, what) => {
    try { fn(); } catch (e) { if (e instanceof season.ScheduleError) return; throw e; }
    throw new Error(what);
  };
  const said_no = opts.find((o) => !o["accepts"]) ?? null;
  if (said_no) refused(() => season.schedule_swap(st, fbs_game["event_id"], said_no["slug"]), "a school that said no");
  const conf = Object.values(st["games"]).find((x) => x["kind"] === "regular" && x["conference_game"] && [x["home"], x["away"]].includes(me));
  refused(() => season.schedule_swap(st, conf["event_id"], pick["slug"]), "a conference game swapped");
  // an FCS opponent can only be traded for another FCS team
  const fcs_game = mine.find((x) => teams[x["away"] === me ? x["home"] : x["away"]]["fictional"]) ?? null;
  if (fcs_game) {
    const fopts = season.schedule_options(st, fcs_game["event_id"]);
    assert(fopts.length && fopts.every((o) => teams[o["slug"]]["fictional"] && o["accepts"] && o["venue"] === "home"));
    season.schedule_swap(st, fcs_game["event_id"], fopts[0]["slug"]);
    assert(st["games"][fcs_game["event_id"]]["away"] === fopts[0]["slug"]);
  }
  season.advance_to(st, 1);
  refused(() => season.schedule_swap(st, fbs_game["event_id"], pick["slug"]), "swapped after the season began");
  season.close_pool();
  console.log(`schedule edit ok: ${mine.length} non-conference games, ${opts.length} options for week ${fbs_game["week"]}, swapped ${old_opp} for ${pick["slug"]} (${pick["why"]})`);
});

await run();
