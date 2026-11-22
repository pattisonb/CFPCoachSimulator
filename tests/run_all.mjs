// Run the test scripts (tests/test_*.mjs), each in a process of its own, and say which passed.
//
//     node tests/run_all.mjs                     # every test, one at a time
//     node tests/run_all.mjs career stats        # only these (a name with or without "test_" and ".mjs")
//     node tests/run_all.mjs --jobs 4            # four at a time
//     node tests/run_all.mjs --retry 1           # a failing test is run once more before it counts as failed
//     node tests/run_all.mjs --shard 2/4         # the second of four parts, balanced by tests/durations.json
//     node tests/run_all.mjs --record            # write the seconds each test took to tests/durations.json
//     node tests/run_all.mjs --list              # the tests it would run, and stop
//
// A line per test with its seconds; a failing test's output is printed under its line. Exit code 1 when a test
// failed. On GitHub (GITHUB_STEP_SUMMARY set) the table is also written to the run's summary.
//
// A fresh clone has no data/engine_teams.json (the game makes it from the rosters): `node tools/game_host.mjs . teams`
// once before the tests.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const TESTS = path.dirname(fileURLToPath(import.meta.url));
const DURATIONS = path.join(TESTS, "durations.json");
const UNKNOWN_SECONDS = 10;      // *tune* what a test with no recorded time counts as when the parts are balanced
const TIMEOUT_MINUTES = 60;      // *tune* a test still running after this long is stopped and counts as failed
const TAIL_LINES = 60;           // *tune* how much of a failing test's output is printed

// Tests that fail today and are reported without failing the run. Take one off when it passes again.
const KNOWN_FAILURES = {
  // the middle Power 4 starter's overall is not 50 at two positions (WR 51.5, RB 52); it failed before the move to JavaScript too
  test_scale: "the middle Power 4 starter is not a 50 at WR and RB",
  // on its seed 6 of 8 generational prospects sign with a top-25 class, under its mark; it failed before the move to JavaScript too
  test_recruiting_realism: "too few generational prospects sign with a top-25 class on its seed",
  // a suspected game bug: teamdata_js/game_scale.js `upgrade` asks for game_scale.modules.recruiting, which nothing sets (league is set)
};

const stem = (name) => path.basename(name).replace(/\.(mjs|js|py)$/, "");
const fail = (message) => { console.error(message); process.exit(2); };

function parse(argv) {
  const opt = { jobs: 1, retry: 0, shard: null, record: false, list: false, names: [] };
  const number = (flag, text) => {
    if (!/^\d+$/.test(text ?? "")) fail(`${flag} needs a whole number`);
    return Number(text);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--jobs") opt.jobs = Math.max(1, number(a, argv[++i]));
    else if (a === "--retry") opt.retry = number(a, argv[++i]);
    else if (a === "--shard") {
      const m = /^(\d+)\/(\d+)$/.exec(argv[++i] ?? "");
      if (!m || Number(m[1]) < 1 || Number(m[1]) > Number(m[2])) fail("--shard needs I/N with I from 1 to N (2/4)");
      opt.shard = [Number(m[1]), Number(m[2])];
    } else if (a === "--record") opt.record = true;
    else if (a === "--list") opt.list = true;
    else if (a === "--help" || a === "-h") {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 15).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
      process.exit(0);
    } else if (a.startsWith("--")) fail(`unknown option: ${a} (--help lists them)`);
    else opt.names.push(a);
  }
  return opt;
}

/** Recorded seconds by test name, whatever extension the file's keys carry. */
function durations() {
  try {
    return Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(DURATIONS, "utf8"))).map(([k, v]) => [stem(k), Number(v) || 0]));
  } catch {
    return {};
  }
}

/** Part `index` of `count`: the longest tests first, each to the part with the least time so far. */
function shard(tests, seconds, index, count) {
  const cost = (t) => seconds[t] ?? UNKNOWN_SECONDS;
  const parts = Array.from({ length: count }, () => ({ total: 0, tests: [] }));
  for (const t of [...tests].sort((a, b) => cost(b) - cost(a) || (a < b ? -1 : 1))) {
    const least = parts.reduce((best, p) => (p.total < best.total ? p : best));
    least.tests.push(t);
    least.total += Math.max(cost(t), 1);      // (a test of no seconds still takes a place)
  }
  return parts[index - 1].tests.sort();
}

function run_once(test) {
  return new Promise((resolve) => {
    const started = Date.now();
    const out = [];
    const child = spawn(process.execPath, [path.join(TESTS, `${test}.mjs`)], { cwd: path.dirname(TESTS), stdio: ["ignore", "pipe", "pipe"] });
    let timed_out = false;
    const timer = setTimeout(() => { timed_out = true; child.kill("SIGKILL"); }, TIMEOUT_MINUTES * 60000);
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => out.push(d));
    child.on("error", (e) => out.push(Buffer.from(String(e))));
    child.on("close", (code) => {
      clearTimeout(timer);
      let output = Buffer.concat(out).toString("utf8");
      if (timed_out) output += `\nstopped after ${TIMEOUT_MINUTES} minutes`;
      resolve({ ok: code === 0, seconds: (Date.now() - started) / 1000, output });
    });
  });
}

async function run_test(test, retry) {
  let result = null, tries = 0;
  while (tries <= retry) {
    result = await run_once(test);
    tries++;
    if (result.ok) break;
  }
  const known = Object.hasOwn(KNOWN_FAILURES, test);
  // passed | retried (passed on a later try) | known (a listed failure) | fixed (listed, but passes) | failed
  const status = result.ok ? (known ? "fixed" : tries > 1 ? "retried" : "passed") : known ? "known" : "failed";
  return { test, status, tries, ...result };
}

const WORD = { passed: "ok  ", retried: "ok  ", fixed: "ok  ", known: "known", failed: "FAIL" };
const NOTE = {
  retried: (r) => `passed on try ${r.tries}`,
  fixed: () => "listed as a known failure, but it passes: take it off the list in tests/run_all.mjs",
  known: (r) => `fails, as listed: ${KNOWN_FAILURES[r.test]}`,
  failed: (r) => (r.tries > 1 ? `failed ${r.tries} times` : ""),
  passed: () => "",
};

function report(r, width) {
  const note = NOTE[r.status](r);
  console.log(`${WORD[r.status].padEnd(6)}${r.test.padEnd(width)} ${String(Math.round(r.seconds)).padStart(4)}s${note ? `  (${note})` : ""}`);
  if (r.status === "failed") {
    const lines = r.output.trimEnd().split("\n");
    if (lines.length > TAIL_LINES) console.log(`     ... ${lines.length - TAIL_LINES} lines above`);
    for (const line of lines.slice(-TAIL_LINES)) console.log(`     ${line}`);
  }
}

function summary(results, total_seconds, opt) {
  const count = (s) => results.filter((r) => r.status === s).length;
  const failed = count("failed"), known = count("known"), retried = count("retried"), fixed = count("fixed");
  const passed = results.length - failed - known;
  const parts = [`${passed} passed`, `${failed} failed`];
  if (known) parts.push(`${known} known failure${known === 1 ? "" : "s"}`);
  if (retried) parts.push(`${retried} passed on a retry`);
  if (fixed) parts.push(`${fixed} listed as failing but passed`);
  const line = `${parts.join(", ")} in ${Math.round(total_seconds)}s`;
  console.log(`\n${line}`);
  if (failed) console.log(`Failed: ${results.filter((r) => r.status === "failed").map((r) => r.test).join(", ")}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const title = opt.shard ? `Tests, part ${opt.shard[0]} of ${opt.shard[1]}` : "Tests";
    const result = { passed: "Passed", retried: "Passed on a Retry", fixed: "Passed (Listed as a Known Failure)", known: "Known Failure", failed: "Failed" };
    const rows = [...results].sort((a, b) => (a.status === "failed" ? 0 : 1) - (b.status === "failed" ? 0 : 1) || (a.test < b.test ? -1 : 1))
      .map((r) => `| ${r.test} | ${result[r.status]} | ${Math.round(r.seconds)} |`);
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${title}\n\n${line}\n\n| Test | Result | Seconds |\n| --- | --- | --- |\n${rows.join("\n")}\n\n`);
  }
  return failed;
}

async function main() {
  const opt = parse(process.argv.slice(2));
  const all = fs.readdirSync(TESTS).filter((n) => /^test_.*\.mjs$/.test(n)).map(stem).sort();
  for (const k of Object.keys(KNOWN_FAILURES)) if (!all.includes(k)) fail(`KNOWN_FAILURES names ${k}, which is not a test`);
  let tests = all;
  if (opt.names.length) {
    const picked = opt.names.map((n) => (stem(n).startsWith("test_") ? stem(n) : `test_${stem(n)}`));
    const missing = picked.filter((t) => !all.includes(t));
    if (missing.length) fail(`no such test: ${missing.join(", ")}`);
    tests = all.filter((t) => picked.includes(t));
  }
  const seconds = durations();
  if (opt.shard) tests = shard(tests, seconds, opt.shard[0], opt.shard[1]);
  if (opt.list) { for (const t of tests) console.log(t); return; }
  if (!tests.length) { console.log("no tests to run"); return; }

  const width = Math.max(...tests.map((t) => t.length));
  const started = Date.now();
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < tests.length) {
      const r = await run_test(tests[next++], opt.retry);
      results.push(r);
      report(r, width);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opt.jobs, tests.length) }, worker));
  const failed = summary(results, (Date.now() - started) / 1000, opt);

  if (opt.record) {
    // the tests that exist, by file name: the ones just run at their new time, the rest as they were
    for (const r of results) seconds[r.test] = Math.round(r.seconds);
    const kept = Object.fromEntries(all.map((t) => [`${t}.mjs`, seconds[t] ?? UNKNOWN_SECONDS]));
    fs.writeFileSync(DURATIONS, `${JSON.stringify(kept, null, 1)}\n`);
    console.log(`wrote ${path.relative(process.cwd(), DURATIONS)}`);
  }
  process.exit(failed ? 1 : 0);
}

main();
