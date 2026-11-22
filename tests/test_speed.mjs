// Time a season advance: `node tests/test_speed.mjs [weeks]`. (Every game is played in this
// process: `season.sim_workers()` is always 1.)
import { start } from "./harness.mjs";

const game = await start();
const { season } = game;

const weeks = process.argv.length > 2 ? parseInt(process.argv[2], 10) : 2;
const t0 = performance.now();
const st = season.new_season("ohio-state", "full", 9);
const t1 = performance.now();
season.advance_to(st, weeks);
const t2 = performance.now();
const games = Object.values(st["games"]).filter((g) => g["played"] && !g["real"]).length;
const s = (ms) => (ms / 1000).toFixed(2);
console.log(`workers ${season.sim_workers()}: new_season ${s(t1 - t0)}s, ${weeks} weeks (${games} games) in ${s(t2 - t1)}s = ${s((t2 - t1) / weeks)}s per week`);
