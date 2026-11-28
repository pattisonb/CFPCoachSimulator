// A hard commit stays one (the player: a hard commit in Week 9 was "committed to you" again in Week 11 and read as a
// verbal commit). The week's commitment draws left a hard commit to fall through to the uncommitted ones and committed
// him again, which made him verbal. And a save that was damaged so is put right as it loads (recruiting.heal_contacts).
// `node tests/test_hard_commit.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";

const game = await start({ env: { SIM_WORKERS: "1" } });
const { season, recruiting } = game;
const ME = "baylor";
const st = season.new_season(ME, "full", 9, undefined, undefined, true);
st["career"]["settings"]["auto_recruit"] = "off";
const rc = st["recruiting"];
const pids = Object.keys(rc["prospects"]).sort((a, b) => rc["prospects"][a]["rank"] - rc["prospects"][b]["rank"]).slice(0, 40);
const mine = pids.slice(0, 5);

test("six weeks of draws never commit a hard commit again", () => {
  for (const pid of pids) {
    const school = mine.includes(pid) ? ME : "georgia";
    if (!(rc["offers"][school] ||= []).includes(pid)) rc["offers"][school].push(pid);
    Object.assign(rc["status"][pid], { committed: school, hard: true, firmness: recruiting.HARD_AT });
    recruiting._event(st, "hard", pid, school);
  }
  const n0 = rc["log"].length;
  season.advance_to(st, 6);
  // (a hard commit can soften, by design, when his school goes quiet: then he is a verbal commit that may firm up again)
  const again = pids.filter((pid) => rc["log"].slice(n0).some((e) => e["pid"] === pid && ["commit", "flip"].includes(e["kind"])
    && !rc["log"].slice(n0).some((d) => d["pid"] === pid && ["softened", "decommit"].includes(d["kind"]))));
  assert(!again.length, () => `committed again: ${JSON.stringify(again.map((p) => rc["log"].slice(n0).filter((e) => e["pid"] === p).map((e) => [e["week"], e["kind"]])))}`);
});

test("a save with a hard commit made verbal again is put right as it loads, the stray line gone from his History", () => {
  const pid = mine.find((p) => rc["status"][p]["hard"]) ?? mine[0];
  Object.assign(rc["status"][pid], { committed: ME, hard: true });
  recruiting._event(st, "hard", pid, ME);
  Object.assign(rc["status"][pid], { hard: false, firmness: 50 });
  recruiting._event(st, "commit", pid, ME);
  assert(recruiting.heal_contacts(st));
  equal([rc["status"][pid]["hard"], rc["status"][pid]["firmness"] >= recruiting.HARD_AT], [true, true]);
  const last_hard = rc["log"].map((e, i) => [e, i]).filter(([e]) => e["pid"] === pid && e["kind"] === "hard").pop()[1];
  assert(!rc["log"].slice(last_hard).some((e) => e["pid"] === pid && e["kind"] === "commit"), "the stray commit line is still there");
});

await run();
