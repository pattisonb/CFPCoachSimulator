// Quick check of the bowl season: run one full season and print the bowls and playoff sites.
// `node tests/test_bowls.mjs [team]`
import { start, test, run, assert } from "./harness.mjs";
import { Random, range, sorted } from "../engine_js/pyrt.js";

const game = await start();
const { season } = game;
const _bowls = game.modules.bowls;

test("bowl season", () => {
  const slug = process.argv.length > 2 ? process.argv[2] : "michigan";
  const t0 = performance.now();
  const st = season.new_season(slug, "full", 3);
  season.advance_to(st, 20);
  const s = season.summary(st);
  console.log(`${s["team_name"]} ${s["record"]["wins"]}-${s["record"]["losses"]} in ${((performance.now() - t0) / 1000).toFixed(1)}s; champion ${s["champion_name"]}`);
  for (const g of s["schedule"]) {
    if (g["week"] >= 14) {
      console.log(`  wk${g["week"]} ${g["title"] || ""}: ${g["won"] ? "W" : "L"} ${g["points_for"]}-${g["points_against"]} vs ${g["opponent_name"]} @ ${g["site"] ?? null}`);
    }
  }
  const bowls = s["bowls"];
  console.log(`bowls: ${bowls.length}, filled ${bowls.filter((b) => !b["unfilled"]).length}, unfilled ${JSON.stringify(bowls.filter((b) => b["unfilled"]).map((b) => b["bowl"]))}`);
  for (const b of [...bowls.slice(0, 5), ...bowls.slice(-3)]) {
    console.log(`  wk${b["week"]} ${String(b["date"]).padEnd(7)} ${String(b["name"]).padEnd(26)} ${JSON.stringify(b["tie_ins"])}  ${b["away_name"]} ${b["away_score"]} - ${b["home_name"]} ${b["home_score"]}`);
  }
  console.log("playoff games:");
  for (const g of Object.values(st["games"])) {
    if (g["kind"] === "playoff") {
      console.log(`  wk${g["week"]} ${g["title"]} @ ${g["site"] ?? null}: ${g["away_display"]} ${g["away_score"]} - ${g["home_display"]} ${g["home_score"]}`);
    }
  }
  const weeks = {};
  for (const b of bowls) weeks[b["week"]] = (weeks[b["week"]] || 0) + 1;
  console.log("bowl weeks:", JSON.stringify(weeks));

  // a six-win team is never left home while a five-win team plays, unless the no-same-conference rule forced it (the
  // player's report: a 6-win UConn sat while a 5-win Missouri State played); UConn's "FBS Independent" is independent
  const teams = season.load_teams();
  const real = Object.keys(teams).filter((x) => !teams[x]["fictional"]);
  assert(_bowls.INDEPENDENT.has(teams["uconn"]["conference"]));
  const ratings = Object.fromEntries(Object.entries(teams).map(([x, t]) => [x, t["team_ratings"]["overall"]]));
  for (let seed = 0; seed < 30; seed++) {
    const rng = new Random(seed);
    const rec = Object.fromEntries(Object.keys(teams).map((x) => [x, { wins: 0, losses: 0 }]));
    for (const x of real) {
      const w = rng.choice(range(3, 12));
      rec[x] = { wins: w, losses: 12 - w };
    }
    const field = new Set(sorted(real, (x) => -rec[x]["wins"]).slice(0, 12));
    const out = _bowls.select_bowls(rec, teams, field, [], ratings);
    const picked = new Set(out.filter((b) => !b["unfilled"]).flatMap((b) => [b["home"], b["away"]]));
    const six_out = new Set(real.filter((x) => !field.has(x) && !picked.has(x) && rec[x]["wins"] >= 6));
    for (const b of out) {
      if (b["unfilled"]) continue;
      for (const [x, partner] of [[b["home"], b["away"]], [b["away"], b["home"]]]) {
        if (rec[x]["wins"] === 5) {
          const left = new Set([...six_out].map((y) => teams[y]["conference"]));
          assert([...left].every((c) => c === teams[partner]["conference"]), () => JSON.stringify([seed, b["bowl"], x, [...six_out].sort()]));
        }
      }
    }
  }
  console.log("bowl selection ok: no six-win team sits while a five-win team plays, but for the same-conference rule");
});

await run();
