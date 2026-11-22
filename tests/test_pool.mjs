// The season's worker pool starts clean: its workers hold none of the server's sockets. (A forked worker
// once kept the browser's keep-alive connections open after the server closed them, so the page's next requests went to a
// socket nobody read and the page hung on Advance.)
// The JavaScript game has no worker processes of its own (sim_js/season/part2.js `_make_pool`: always null, the games
// played in this process; a host that shares a week out replaces `season.play_jobs`), so nothing can inherit a
// socket: what is left to hold is that asking for two workers still starts no process.
// `node tests/test_pool.mjs`
import net from "node:net";
import { start, assert } from "./harness.mjs";

const game = await start({ env: { SIM_WORKERS: "2" } });
const { season } = game;

const held = net.createServer();                 // stands in for a browser's keep-alive connection
await new Promise((done) => held.listen(0, "127.0.0.1", done));
let failed = false;
try {
  const pool = season._make_pool();
  assert(pool === null, "a pool of worker processes was made: check that its workers hold none of the server's sockets");
  assert(season.sim_workers() === 1, "more than this one process simulates games");
  assert(season.shared_pool() === null, "the shared pool is a pool of processes");
} catch (e) {
  failed = true;
  console.log(`FAIL ${e.message}`);
} finally {
  season.close_pool();
  held.close();
}
if (failed) process.exit(1);
console.log("pool ok: no worker processes, so none holds the server's sockets");
