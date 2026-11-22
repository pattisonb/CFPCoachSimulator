// Sim a season and print the awards: `node tests/test_awards.mjs [team] [seed] [file to write the season to]`.
import fs from "node:fs";
import { start, test, run } from "./harness.mjs";
import { get, json_dumps, round } from "../engine_js/pyrt.js";

const game = await start();
const season = game.season;

const secs = (t0) => round((performance.now() - t0) / 1000);
const l = (v, n) => String(v).padEnd(n);                  // Python's {v:<n}

test("awards", () => {
  const slug = process.argv.length > 2 ? process.argv[2] : "ohio-state";
  const seed = process.argv.length > 3 ? parseInt(process.argv[3], 10) : 11;
  const t0 = performance.now();
  const st = season.new_season(slug, "full", seed);
  season.advance_to(st, 10);
  const race = season.awards_view(st)["race"];
  console.log(`--- week 10 race (${secs(t0)}s)`);
  for (const c of race["heisman"]["candidates"].slice(0, 6)) {
    console.log(`  ${l(c["name"], 22)} ${l(c["position"], 3)} ${l(c["team_name"], 16)} ${l(c["record"], 5)} #${c["rank"]} pts ${c["points"]} | ${c["line"]}`);
  }
  season.advance_to(st, 20);
  const aw = st["awards"];
  const h = aw["national"]["heisman"];
  console.log(`--- Heisman (${secs(t0)}s): share ${h["share"]}% of ${h["possible"]}`);
  for (const c of h["candidates"].slice(0, 8)) {
    console.log(`  ${l(c["name"], 22)} ${l(c["position"], 3)} ${l(c["team_name"], 16)} ${l(c["record"], 5)} #${c["rank"]} ${c["first"]}/${c["second"]}/${c["third"]} = ${c["points"]} | ${c["line"]}`);
  }
  console.log("--- national awards");
  for (const a of aw["national"]["awards"]) {
    const w = a["winner"];
    console.log(w ? `  ${l(a["name"], 38)} ${l(w["name"], 22)} ${l(w["position"], 3)} ${l(w["team_name"], 16)} | ${w["line"]}` : `  ${a["name"]}: none`);
  }
  console.log("--- coach awards");
  for (const a of [...aw["national"]["coach_awards"], ...aw["postseason"]["awards"].slice(1, 2)]) {
    const w = a["winner"];
    console.log(`  ${l(a["name"], 34)} ${l(get(w, "coach") || get(w, "name"), 22)} ${l(w["team_name"], 16)} ` + ("surprise" in w ? `${w["wins"]}-${w["losses"]} exp ${w["expected"]} surprise ${w["surprise"]}` : `${get(w, "role", "")} unit rank ${get(w, "unit_rank")} (rating rank ${get(w, "rating_rank")})`));
  }
  const aa = aw["national"]["all_america"];
  console.log(`--- All-America: ${aa["consensus"].length} consensus, ${aa["unanimous"].length} unanimous`);
  for (const c of aa["consensus"]) {
    console.log(`  ${l(c["slot"], 4)} ${l(c["name"], 22)} ${l(c["team_name"], 16)} ${c["selectors"]}/5${c["unanimous"] ? " *" : ""}`);
  }
  const conf = st["conference"];
  console.log(`--- ${conf} awards`);
  for (const a of aw["conference"][conf]["awards"]) {
    const w = a["winner"];
    console.log(`  ${l(a["name"], 44)} ${l(w ? (get(w, "name") || get(w, "coach")) : "none", 22)} ${w ? w["team_name"] : ""}`);
  }
  const teams = aw["conference"][conf]["teams"]["selectors"];
  const first = Object.values(teams)[0];
  console.log(`--- All-${conf} first team (${Object.keys(teams)[0]}):`, first.filter((c) => c["level"] === 1).map((c) => `${c["slot"]} ${c["name"]} (${c["team_name"]})`).join(", "));
  const winner_name = (w) => {
    w = w || {};
    return get(w, "name") || get(w, "coach") || get(w, "team_name");
  };

  console.log("--- postseason:", JSON.stringify(aw["postseason"]["awards"].map((a) => [a["name"], winner_name(a["winner"])])));
  const mine = season.awards_view(st)["mine"];
  console.log(`--- my team (${st["team_name"]}): ${mine.length} entries`);
  for (const m of mine.slice(0, 12)) {
    console.log(`  ${l(m["stage"], 22)} ${l(m["award"], 44)} ${l(m["who"], 22)} ${m["place"]}`);
  }
  console.log("state size", round(json_dumps(st).length / 1e6, 2), "MB");
  if (process.argv.length > 4) fs.writeFileSync(process.argv[4], json_dumps(st));
});

await run();
