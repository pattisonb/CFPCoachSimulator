// The engine's results are pinned: two weeks of one career from a fixed seed, simulated in
// this process, must score every game and count every stat exactly as the golden file says.
// Any change to the play-by-play code that moves a single random draw or a single rounded
// rating fails this, so a speed-up that passes it has not changed what the game does.
//
// Re-record on purpose (a deliberate realism change) with: node tests/test_sim_golden.mjs --record
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { start, test, run, assert, ROOT } from "./harness.mjs";
import { json_dumps } from "../engine_js/pyrt.js";

const game = await start({ env: { SIM_WORKERS: "1" } });          // in this process: the pool's order does not matter, but one process is simplest
const { season } = game;

const GOLDEN = path.join(ROOT, "tests", "golden", "sim_seed11_two_weeks.json");
const TEAM = "smu", SEED = 11, WEEKS = 2;
const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function digest(state) {
  const scores = {};
  for (const e of Object.keys(state["games"]).sort()) {
    const g = state["games"][e];
    if (g["played"]) scores[e] = [g["home_score"], g["away_score"], g["overtime"] || 0];
  }
  const stats = state["season_stats"] || {};
  // 4.0 sacks and 4 sacks are one result (tests/canon.py): JavaScript has one kind of number, and json_dumps writes a
  // whole one as Python writes an int, so the canon step is nothing here
  const blob = json_dumps(stats, { sort_keys: true });
  const rec = state["recruiting"] || {};
  // the recruiting week's outcome: every school's board, offers, visits, contacts and each prospect's status
  const rec_blob = json_dumps(Object.fromEntries(["status", "lists", "offers", "visits", "contacts", "hours", "nil"].map((k) => [k, rec[k] ?? null])), { sort_keys: true });
  return { games: Object.keys(scores).length, scores, stats_sha256: sha256(blob), recruiting_sha256: sha256(rec_blob) };
}

test("sim golden", () => {
  const st = season.new_season(TEAM, "full", SEED, undefined, undefined, true);
  season.advance_to(st, WEEKS);
  const now = digest(st);
  if (process.argv.includes("--record") || !fs.existsSync(GOLDEN)) {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, json_dumps(now, { indent: 1, sort_keys: true }));
    console.log(`golden recorded: ${now["games"]} games, stats ${now["stats_sha256"].slice(0, 12)}`);
    return;
  }
  const want = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
  const moved = Object.keys(want["scores"]).filter((e) => !same(want["scores"][e], now["scores"][e] ?? null));
  assert(!moved.length, () => `${moved.length} of ${want["games"]} games changed score, e.g. ${JSON.stringify(moved.slice(0, 3))}: ${JSON.stringify(moved.slice(0, 3).map((e) => [want["scores"][e], now["scores"][e] ?? null]))}`);
  assert(now["games"] === want["games"], () => JSON.stringify([now["games"], want["games"]]));
  assert(now["stats_sha256"] === want["stats_sha256"], "every score matches but the season stats differ: a stat line or a rounding moved");
  assert(now["recruiting_sha256"] === (want["recruiting_sha256"] ?? null), "the games match but the recruiting week came out differently: a board, offer, visit or status moved");
  console.log(`sim golden ok: ${now["games"]} games, every stat line and the recruiting week identical to the golden file`);
});

await run();
