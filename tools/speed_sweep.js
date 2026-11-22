/* Where the published game loses time: play a career in the built site (ui/dist, the game running in the
   browser) with an automated browser, open every page and tab at set points of every season, and record every call
   the app makes to the game.

     node tools/build_site.mjs --generic
     node tools/speed_sweep.js --years 10 --out sweep.json      # serves ui/dist itself; --url to sweep a site instead
     node tools/speed_sweep.js --report sweep.json              # the tables again, from a finished run

   Each call is timed where it is spent (the worker's own `ms`, ui/public/worker.js): `run` the game's work (`parse`
   is no longer the worker's: the page reads the answer's text), `save` writing the career to the browser's store, and `wait` the rest of the
   time the page waited (standing in line behind other calls: the game answers one at a time). Each click is timed
   from the click until the page has no call in flight and has painted, with the main thread's long tasks in between.
   Seasons past the first are advanced through the game's own calls (the weeks one sim, the offseason stage by stage). */
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i === -1 ? fallback : args[i + 1]; };
const PORT = Number(arg("port", 4173));
const DIST = path.resolve(arg("dist", path.join(__dirname, "..", "ui", "dist")));
const URL_ = arg("url", `http://localhost:${PORT}/`);
const YEARS = Number(arg("years", 10));
const OUT = arg("out", "sweep.json");
const FULL_YEARS = new Set(String(arg("full", "1,2,5,10")).split(",").map(Number));   // the seasons whose every page is opened
const FINAL_WEEK = 20;
const SKIP_NAV = /^(Dark Mode|Light Mode|Back to Main Menu|Settings.*|Minimize Sidebar|Hide Sidebar.*|Expand Sidebar|Keep Sidebar Open|League)$/;

// ---- in the page: every message to and from the game's worker is logged -------------------------------------------
function instrument() {
  const W = window.Worker;
  const S = (window.__sweep = { calls: [], open: new Map(), steps: [], loading: [], long: [], worker: null, next: 1e6, waiters: new Map(), t0: performance.now() });
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) S.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ entryTypes: ["longtask"] });
  } catch (e) { /* no long task timing in this browser */ }
  window.Worker = function (url, opts) {
    const w = new W(url, opts);
    S.worker = w;
    w.addEventListener("message", (e) => {
      const m = e.data, now = performance.now();
      if (m.kind === "loading") { if (!S.loading.length || S.loading[S.loading.length - 1][1] !== m.stage) S.loading.push([Math.round(now), m.stage]); }
      else if (m.kind === "ready") S.loading.push([Math.round(now), "ready"]);
      else if (m.kind === "status" || m.kind === "step") { if (m.ms) S.steps.push({ at: Math.round(now), week: m.status && m.status.done, ...m.ms }); }
      else if (S.open.has(m.id)) {
        const c = S.open.get(m.id);
        S.open.delete(m.id);
        const ms = m.ms || {};
        c.total = Math.round(now - c.sent);
        c.run = ms.run || 0; c.parse = ms.parse || 0; c.save = ms.save || 0; c.bytes = ms.bytes || 0;
        c.wait = Math.max(0, c.total - c.run - c.parse - c.save);
        c.ok = m.ok; c.status = m.status;
        S.calls.push(c);
        const waiter = S.waiters.get(m.id);
        if (waiter) { S.waiters.delete(m.id); waiter({ ...m, result: m.json === undefined ? undefined : JSON.parse(m.json) }); }
      }
    });
    const post = w.postMessage.bind(w);
    w.postMessage = (m, transfer) => {
      if (m && m.path) S.open.set(m.id, { id: m.id, method: m.method, path: m.path, background: !!m.background, sent: performance.now(), at: Math.round(performance.now()) });
      return post(m, transfer || []);
    };
    return w;
  };
  // a call of the sweep's own, straight to the worker (the app never sees its answer)
  window.__call = (method, path, body) => new Promise((resolve) => {
    const id = S.next++;
    S.waiters.set(id, resolve);
    S.worker.postMessage({ id, method, path, bodyJson: body == null ? null : JSON.stringify(body), bodyBytes: null, background: false });
  });
}

const log = { url: URL_, started: new Date().toISOString(), boots: [], actions: [], sims: [], stages: [], errors: [] };
let page, mark = { year: 1, point: "" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until the page has no call in flight for a moment and has painted twice. */
async function settle(max = 90000) {
  const end = Date.now() + max;
  let quiet = 0;
  while (Date.now() < end) {
    const open = await page.evaluate(() => window.__sweep.open.size);
    quiet = open ? 0 : quiet + 1;
    if (quiet >= 3) break;
    await sleep(100);
  }
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Take what the page logged since the last take. */
async function take() {
  return page.evaluate(() => {
    const S = window.__sweep;
    const out = { calls: S.calls, steps: S.steps, long: S.long, now: Math.round(performance.now()) };
    S.calls = []; S.steps = []; S.long = [];
    return out;
  });
}

/** One thing the player does: `label`, the work, then how long until the page was quiet and what it called. */
async function action(label, work) {
  await take();
  const start = await page.evaluate(() => Math.round(performance.now()));
  try { await work(); } catch (e) { log.errors.push({ ...mark, label, error: String(e).slice(0, 200) }); return; }
  await settle();
  const got = await take();
  const lastReply = got.calls.reduce((m, c) => Math.max(m, c.at + c.total), start);
  log.actions.push({
    ...mark, label, ms: lastReply - start, calls: got.calls,
    long: got.long.filter(([at]) => at >= start).reduce((s, [, d]) => s + d, 0),
  });
}

const texts = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent !== null && !e.disabled).map((e) => (e.textContent || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ")), sel);

/** Every tab on the page, and the tabs each one shows (two levels down). */
async function tabs(pageName, seen = new Set(), depth = 0, trail = "") {
  for (const name of await texts('[role="tab"]')) {
    const key = `${depth}:${name}`;
    if (seen.has(key) || !name) continue;
    seen.add(key);
    const tab = page.locator('[role="tab"]:visible').filter({ hasText: name }).first();
    if (!(await tab.count())) continue;
    await action(`${pageName} › ${trail}${name}`, () => tab.click({ timeout: 5000 }));
    if (depth < 1) await tabs(pageName, seen, depth + 1, `${trail}${name} › `);
  }
}

/** The first of a kind of thing on the page opened and closed again (a player, a game, a recruit). */
async function openFirst(pageName, what, selector) {
  const el = page.locator(selector).first();
  if (!(await el.count()) || !(await el.isVisible().catch(() => false))) return;
  await action(`${pageName} › open ${what}`, () => el.click({ timeout: 5000 }));
  await tabs(`${pageName} › ${what}`, new Set(), 1);
  await page.keyboard.press("Escape");
  await settle();
}

/** Every page in the sidebar, every tab on each, and the first player, game and recruit each shows. */
async function visitAll(point) {
  mark = { ...mark, point };
  console.log(`  pages at ${mark.year} ${point}`);
  const names = (await texts(".game-nav__item")).filter((n) => !SKIP_NAV.test(n));
  for (const name of names) {
    const item = page.locator(".game-nav__item").filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).first();
    if (!(await item.count())) continue;
    await action(name, () => item.click({ timeout: 5000 }));
    await tabs(name);
    await openFirst(name, "player", ".player-link");
    await openFirst(name, "recruit", ".prospect-card, .recruiting__row, [data-prospect]");
    await openFirst(name, "game", ".scores__game, .schedule__game, [data-event]");
  }
}

async function boot(label) {
  const t = Date.now();
  await page.goto(page.url() === "about:blank" ? URL_ : page.url());
  await page.waitForFunction(() => window.__sweep && window.__sweep.loading.some((x) => x[1] === "ready"), null, { timeout: 180000 });
  await settle();
  const got = await page.evaluate(() => window.__sweep.loading);
  log.boots.push({ ...mark, label, ms: Date.now() - t, stages: got });
  await take();
}

const call = (method, path, body) => page.evaluate(([m, p, b]) => window.__call(m, p, b), [method, path, body]);

/** Sim to `week` through the game's own advance, each week's step timed. */
async function simTo(id, week, label) {
  await take();
  const t = Date.now();
  const r = await call("POST", `/api/season/${id}/advance`, { to: week });
  if (!r.ok) { log.errors.push({ ...mark, label, error: r.message }); return; }
  for (;;) {
    await sleep(400);
    const s = await call("GET", `/api/season/${id}/status`);
    if (!s.ok || s.result.status !== "running") break;
  }
  const got = await take();
  log.sims.push({ ...mark, label, ms: Date.now() - t, steps: got.steps });
  console.log(`  ${label}: ${((Date.now() - t) / 1000).toFixed(1)} s, ${got.steps.length} steps`);
}

/** The offseason, a stage at a time, to the next season; `each` runs between stages. Returns false when it is stuck. */
async function offseason(id, each) {
  for (let n = 0; n < 40; n++) {
    const view = await call("GET", `/api/season/${id}/offseason`);
    const stage = view.ok ? (view.result.stage || (view.result.offseason || {}).stage || "?") : "?";
    await take();
    const t = Date.now();
    const r = await call("POST", `/api/season/${id}/offseason/advance`, {});
    const got = await take();
    const own = got.calls.find((c) => c.method === "POST") || {};
    log.stages.push({ ...mark, stage, ms: Date.now() - t, run: own.run, save: own.save, parse: own.parse, bytes: own.bytes, ok: r.ok, error: r.ok ? undefined : r.message });
    console.log(`  offseason ${stage}: ${((Date.now() - t) / 1000).toFixed(1)} s${r.ok ? "" : ` FAILED ${r.message}`}`);
    if (!r.ok) return false;
    if (r.result && r.result.next_season) return true;
    if (each) await each(stage);
  }
  return false;
}

/** ui/dist served the way the site is: a path that is no file is the app's own page. */
function serve() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".ico": "image/x-icon" };
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, URL_).pathname);
      let file = path.join(DIST, rel);
      if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
      // the two headers vercel.json sends: with them the game may share memory with its helper workers
      // ... and the data pack as vercel.json sends it: brotli, which the browser unpacks (--no-brotli: as a server
      // that does not say so sends it, and the game falls back on the gzip one)
      const packed = path.extname(file) === ".br" && !args.includes("--no-brotli") ? { "Content-Encoding": "br" } : {};
      res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Content-Length": fs.statSync(file).size, ...packed,
        "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": args.includes("--no-isolation") ? "unsafe-none" : "require-corp" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function run() {
  const server = args.includes("--url") ? null : await serve();
  const browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => log.errors.push({ ...mark, label: "pageerror", error: String(e).slice(0, 300) }));
  await page.addInitScript(instrument);
  const save = () => fs.writeFileSync(OUT, JSON.stringify(log));

  mark = { year: 1, point: "open" };
  await boot("cold open");
  await action("Play as (team picker)", () => page.getByRole("button", { name: /^Play as/ }).click());
  await action("Confirm and Play (new career)", async () => {
    await page.getByRole("button", { name: "Confirm and Play" }).click();
    await page.waitForSelector(".game-nav", { timeout: 180000 });
  });
  const seasons = await call("GET", "/api/seasons");
  const id = seasons.result.seasons[0].id;
  console.log("career", id);

  for (let year = 1; year <= YEARS; year++) {
    mark = { year, point: "preseason" };
    const full = FULL_YEARS.has(year);
    console.log(`year ${year}${full ? " (every page)" : ""}`);
    if (year > 1) await boot("reload into the new season");
    if (full) await visitAll("preseason");
    if (year === 1) {
      // the first week by the button the player presses
      mark.point = "week 1";
      await action("Office › Sim the Week", async () => {
        await page.locator(".game-nav__item").filter({ hasText: /^Office$/ }).first().click();
        await page.getByRole("button", { name: "Sim the Week" }).click();
        await page.waitForFunction(() => window.__sweep.steps.length > 0, null, { timeout: 300000 });
      });
      await visitAll("week 1");
    }
    await simTo(id, 7, "sim to week 7");
    if (full) { await boot("reload mid-season"); await visitAll("week 7"); }
    await simTo(id, FINAL_WEEK, "sim to the end");
    if (full) { await boot("reload at season's end"); await visitAll("season over"); }
    save();
    mark.point = "offseason";
    const through = await offseason(id, full ? async (stage) => { await boot(`reload at offseason ${stage}`); await visitAll(`offseason after ${stage}`); mark.point = "offseason"; } : null);
    save();
    if (!through) { console.log("the offseason did not reach the next season: stopping"); break; }
  }
  save();
  await browser.close();
  if (server) server.close();
}

// ---- the report ----------------------------------------------------------------------------------------------------
const shape = (path) => {
  const [p, q] = path.split("?");
  const parts = p.split("/").map((x, i, all) => {
    if (all[i - 1] === "season" && i === 3) return "{id}";
    if (["teams", "depth", "schedule", "playlink", "prospect", "game", "week", "position_options", "programs", "towns", "coaches"].includes(all[i - 1]) && i > 3) return "{x}";
    if (all[i - 2] === "position_options") return "{x}";
    if (all[i - 1] === "position" && all[i - 3] === "depth") return "{x}";
    return x;
  });
  const keys = q ? "?" + q.split("&").map((kv) => kv.split("=")[0]).sort().join("&") : "";
  return parts.join("/") + keys;
};
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const pad = (v, n) => String(v).padStart(n);

function report(file) {
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  const calls = d.actions.flatMap((a) => a.calls.map((c) => ({ ...c, year: a.year, point: a.point, label: a.label })));
  console.log(`\n${d.actions.length} clicks, ${calls.length} calls, ${d.sims.length} sims, ${d.stages.length} offseason stages, ${d.errors.length} errors\n`);

  console.log("OPENING THE GAME (ms)");
  for (const b of d.boots.slice(0, 3)) console.log(`  ${b.label} (year ${b.year}): ${b.ms}  ${b.stages.map(([t, s]) => `${s} @${t}`).join(", ")}`);
  const later = d.boots.slice(1).map((b) => b.ms);
  if (later.length) console.log(`  reloads: median ${pct(later, 0.5)}, slowest ${Math.max(...later)}`);

  console.log("\nCALLS BY ENDPOINT, by the time they cost in all (ms: median / 95th / worst of the whole call; then where the median goes)");
  console.log("  " + "n".padStart(4) + "  total".padStart(8) + "   med   p95   max |  run parse  save  wait |    KB  endpoint");
  const groups = new Map();
  for (const c of calls) { const k = `${c.method} ${shape(c.path)}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
  const rows = [...groups].map(([k, cs]) => ({ k, cs, total: sum(cs.map((c) => c.total)) })).sort((a, b) => b.total - a.total);
  for (const { k, cs, total } of rows.slice(0, 45)) {
    const f = (key) => pad(pct(cs.map((c) => c[key]), 0.5), 5);
    console.log(`  ${pad(cs.length, 4)} ${pad(total, 8)} ${f("total")} ${pad(pct(cs.map((c) => c.total), 0.95), 5)} ${pad(Math.max(...cs.map((c) => c.total)), 5)} |${f("run")} ${f("parse")} ${f("save")} ${f("wait")} |${pad(Math.round(pct(cs.map((c) => c.bytes), 0.5) / 1024), 6)}  ${k}`);
  }
  const all = { run: sum(calls.map((c) => c.run)), parse: sum(calls.map((c) => c.parse)), save: sum(calls.map((c) => c.save)), wait: sum(calls.map((c) => c.wait)) };
  const whole = sum(Object.values(all)) || 1;
  console.log(`\n  all calls: ${Object.entries(all).map(([k, v]) => `${k} ${Math.round((100 * v) / whole)}%`).join(", ")}`);

  console.log("\nSLOWEST CLICKS (ms from the click until the page was quiet; calls; main-thread long tasks)");
  for (const a of [...d.actions].sort((x, y) => y.ms - x.ms).slice(0, 30)) console.log(`  ${pad(a.ms, 6)}  ${pad(a.calls.length, 3)} calls ${pad(a.long, 5)} long  y${a.year} ${a.point}: ${a.label}`);
  const clicks = d.actions.map((a) => a.ms);
  console.log(`\n  clicks: median ${pct(clicks, 0.5)}, 90th ${pct(clicks, 0.9)}, over 1 s: ${clicks.filter((x) => x > 1000).length} of ${clicks.length}`);

  console.log("\nCLICKS BY YEAR (median / 90th ms)   and the same page, year by year");
  const years = [...new Set(d.actions.map((a) => a.year))];
  for (const y of years) { const xs = d.actions.filter((a) => a.year === y && a.point === "preseason").map((a) => a.ms); if (xs.length) console.log(`  year ${y} preseason: ${pct(xs, 0.5)} / ${pct(xs, 0.9)}  (${xs.length} clicks)`); }

  console.log("\nSIMS (a week's step: the game's work and the save, ms)");
  for (const s of d.sims) {
    const run = s.steps.map((x) => x.run), sv = s.steps.map((x) => x.save);
    console.log(`  y${pad(s.year, 2)} ${s.label.padEnd(16)} ${pad((s.ms / 1000).toFixed(1), 6)} s  ${pad(s.steps.length, 2)} steps  run med ${pad(pct(run, 0.5), 5)} max ${pad(Math.max(0, ...run), 5)}  save med ${pad(pct(sv, 0.5), 5)} max ${pad(Math.max(0, ...sv), 5)}`);
  }
  console.log("\nOFFSEASON STAGES (ms: whole / the game's work / the save)");
  const byStage = new Map();
  for (const s of d.stages) { if (!byStage.has(s.stage)) byStage.set(s.stage, []); byStage.get(s.stage).push(s); }
  for (const [stage, xs] of byStage) console.log(`  ${stage.padEnd(22)} ${xs.map((s) => `y${s.year}: ${s.ms}/${s.run ?? "?"}/${s.save ?? "?"}`).join("  ")}`);
  if (d.errors.length) { console.log("\nERRORS"); for (const e of d.errors.slice(0, 20)) console.log(`  y${e.year} ${e.point}: ${e.label}: ${e.error}`); }
}

if (args.includes("--report")) report(arg("report"));
else run().then(() => report(OUT)).catch((e) => { console.error(e); fs.writeFileSync(OUT, JSON.stringify(log)); process.exit(1); });
