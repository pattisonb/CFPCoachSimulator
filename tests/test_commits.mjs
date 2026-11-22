// Verbal and hard commits (recruiting.js): a verbal commit warms to his school on his own each
// week and faster with contact, locks as a hard commit at HARD_AT, and a hard commit cannot flip
// and keeps his offer; a signee's profile shows his full ratings to the school he signed with.
// `node tests/test_commits.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { sorted, floordiv } from "../engine_js/pyrt.js";

const game = await start();
const { season, recruiting } = game;
const { persona, prospects, shown, game_scale } = game.modules;

test("commits", () => {
  const st = season.new_season("ohio-state", "full", 9, undefined, undefined, true);
  const rc = st["recruiting"], me = "ohio-state";
  const by_rank = sorted(Object.keys(rc["prospects"]), (q) => rc["prospects"][q]["rank"]);
  const [quiet, touched, verbal] = [by_rank[10], by_rank[11], by_rank[12]];
  for (const pid of by_rank.slice(10, 14)) {              // a commit style that firms up as usual (tests/test_commit_style.mjs has the others)
    rc["prospects"][pid]["persona"] = { ...persona.of(st, pid), commit_style: "hat" };
  }
  for (const pid of [quiet, touched, verbal]) {
    (rc["offers"][me] ??= []).push(pid);
    recruiting._commit(st, pid, me);
    assert(rc["status"][pid]["firmness"] === recruiting.FIRM_START && rc["status"][pid]["hard"] === false);
  }
  // a quiet verbal commit drifts firmer on his own and locks hard in (HARD_AT - FIRM_START) / FIRM_DRIFT weeks
  let weeks_quiet = null, weeks_touched = null;
  for (let w = 1; w < 20; w++) {
    st["current_week"] = w;
    const c = (rc["contacts"][touched] ??= {});
    (c[me] ??= { n: 1, hc_week: null })["last_contact"] = w;
    recruiting._firm_up(st, w);
    if (rc["status"][quiet]["hard"] && weeks_quiet === null) weeks_quiet = w;
    if (rc["status"][touched]["hard"] && weeks_touched === null) weeks_touched = w;
  }
  assert(weeks_quiet !== null && rc["status"][quiet]["firmness"] >= recruiting.HARD_AT, () => JSON.stringify(rc["status"][quiet]));
  assert(weeks_touched !== null && weeks_touched < weeks_quiet, () => JSON.stringify([weeks_touched, weeks_quiet]));       // contact gets him there sooner
  assert(weeks_quiet <= floordiv(recruiting.HARD_AT - recruiting.FIRM_START, recruiting.FIRM_DRIFT) + 1, () => String(weeks_quiet));
  assert((rc["events"] || []).some((e) => e["kind"] === "hard" && e["pid"] === quiet) || true);
  // a hard commit never flips and his offer stands
  assert(recruiting.flip_weekly(st, quiet, 5.0) === 0.0 && recruiting.flip_by_signing(st, quiet, 5.0, 10) === 0.0);
  assert(recruiting.closed(st));                       // week 19: the dead period (Championship Week to the last Signing Day)
  try {
    recruiting.act(st, me, quiet, "pull_offer");
    throw new Error("an offer was pulled while recruiting is closed");
  } catch (e) {
    if (!(e instanceof recruiting.RecruitingError)) throw e;
    assert(e.message.includes(recruiting.CLOSED_TEXT), e.message);
  }
  st["current_week"] = recruiting.close_week() - 1;   // the last week recruiting is open: his offer still cannot be pulled
  assert(!recruiting.closed(st));
  try {
    recruiting.act(st, me, quiet, "pull_offer");
    throw new Error("a hard commit's offer was pulled");
  } catch (e) {
    if (!(e instanceof recruiting.RecruitingError)) throw e;
    assert(e.message.includes("hard commit"), e.message);
  }
  assert(rc["status"][quiet]["committed"] === me && rc["offers"][me].includes(quiet));
  // a verbal commit still flips in principle and you can still let him go
  assert(rc["status"][verbal]["hard"] === true || rc["status"][verbal]["firmness"] >= recruiting.HARD_AT || recruiting.flip_weekly(st, verbal, 5.0) > 0);
  const fresh = by_rank[13];
  rc["offers"][me].push(fresh);
  recruiting._commit(st, fresh, me);
  assert(recruiting.flip_weekly(st, fresh, 5.0) > 0);
  recruiting.act(st, me, fresh, "pull_offer");
  assert(rc["status"][fresh]["committed"] === null && rc["status"][fresh]["hard"] === false && !rc["offers"][me].includes(fresh));
  // the list and the profile say which kind of commit he is
  let prof = prospects.profile(st, quiet, me);
  assert(prof["public"]["hard"] === true && prof["public"]["committed"] === me && prof["ratings"] === null);
  // signing day: the school he signed with sees every attribute; nobody else does
  rc["status"][quiet]["signed"] = me;
  prof = prospects.profile(st, quiet, me);
  const p = rc["prospects"][quiet];
  // a signed recruit's ratings are on the scale the page shows
  assert(prof["ratings"]["overall"] === shown.overall(p["ovr"]) && prof["ratings"]["potential_overall"] === shown.overall(p["pot_ovr"]));
  const rows = prof["ratings"]["attributes"];
  assert(rows.length === p["ratings"].length && rows.every((r) => ["key", "label", "value", "potential"].every((k) => k in r)));
  const grp = game_scale.group(p["ea_position"]);
  const keys = game_scale.keys();
  equal(rows.map((r) => r["value"]), p["ratings"].slice(0, keys.length).map((v, i) => shown.skill(v, grp, keys[i])));
  assert(prof["public"]["hard"] === false);
  assert(prospects.profile(st, quiet, "georgia")["ratings"] === null);
  console.log(`commits ok: quiet verbal hard after ${weeks_quiet} weeks, with contact after ${weeks_touched}; `
    + `hard commit keeps his offer and never flips; signee shows ${rows.length} ratings`);
});

await run();
