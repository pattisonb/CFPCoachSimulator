// What every test script starts from: the whole game on Node, writing its saves and built leagues into a temporary
// folder of the run's own (never the repository's data/), and a small runner.
//
//   import { start, test, run, assert, equal, raises } from "./harness.mjs";
//   const game = await start();                 // { api, season, recruiting, offseason, career, coaches, modules, files }
//   test("a new career has a board", () => { ... });
//   await run();                                // runs the tests in order; prints a line each; exit code 1 on a failure
//
// `start({ env: { SIM_WORKERS: "1" } })` sets what the game reads from its environment before it loads (a process has
// one game: a test file that needs two settings runs itself twice, see `again`).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assertStrict from "node:assert/strict";
import { host } from "../tools/game_host.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let scratch = null;

/** The game, its writes kept in a temporary folder that is removed when the process ends. */
export async function start({ env = {} } = {}) {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cfp-test-"));
  process.on("exit", () => fs.rmSync(scratch, { recursive: true, force: true }));
  return host(ROOT, { overlay: scratch, env: { ...process.env, ...env } });
}

/** This test file again in a process of its own with other environment settings; returns its exit code. */
export function again(file, env) {
  return spawnSync(process.execPath, [file], { stdio: "inherit", env: { ...process.env, ...env } }).status;
}

const tests = [];
export function test(name, fn) { tests.push([name, fn]); }

export async function run() {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}\n     ${String((e && e.stack) || e).split("\n").slice(0, 6).join("\n     ")}`);
    }
  }
  console.log(failed ? `${failed} of ${tests.length} failed` : `${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}

export function assert(cond, message = "assertion failed") { if (!cond) throw new Error(typeof message === "function" ? message() : message); }
export const equal = (a, b, message) => assertStrict.deepStrictEqual(a, b, message);
/** `fn` must throw; returns the error (check its class, code or message). */
export function raises(fn, klass = null) {
  try { fn(); } catch (e) { if (klass && !(e instanceof klass)) throw e; return e; }
  throw new Error("expected an error");
}
