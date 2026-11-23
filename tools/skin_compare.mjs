// Proof, in a real browser, that the published site with a skin loaded is the site built with the source names.
//
//     node tools/build_site.mjs --generic --out /tmp/site-generic
//     node tools/build_site.mjs --out /tmp/site-real
//     node tools/make_skin.mjs --out /tmp/real-names.skin.json
//     node tools/skin_compare.mjs --generic /tmp/site-generic --real /tmp/site-real --skin /tmp/real-names.skin.json.gz
//         [--shots DIR]   screenshots of the control, a file that is refused and the loaded skin
//         [--out FILE]    the whole result as JSON        [--weeks N] stop the season after week N (a quick look)
//
// It serves both folders as the site is served (the two cross-origin isolation headers, the data pack as brotli),
// opens the generic one in Chromium (Playwright), loads the skin through the page as a player does (Load a Skin, the
// file picker), and then on each site:
//   - plays the same seeded career through the game's own calls, straight to the page's worker: a new career with
//     Auto-recruit, a game day, a week, a month, the season, three offseason stages, with every view asked at each
//     stop (status, office, headquarters, recruiting, prospects and their profiles, schedule, depth chart, players,
//     scores and box scores, standings, stats, awards, news, ...). Every answer must be the same text, but for the
//     career's id and the clock;
//   - opens every section of the career and every tab on it, and reads the page. The text must be the same, and no
//     lookalike name (every one the swap makes: schools, mascots, stadiums, conferences, bowls, trophies, awards, the
//     drawn players and coaches) may stand on a page of the skinned site more often than on the other's.
// It also loads files that are not skins (each must be refused with a sentence), takes the skin off and puts it back
// (the careers of each are kept apart), and exits with 1 when anything differs.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(import.meta.url)("playwright");
const { Maps } = await import("./generic/scrub.mjs");
const { tables } = await import("./generic/tables.mjs");

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i === -1 ? fallback : args[i + 1]; };
const SITES = { generic: path.resolve(arg("generic", "")), real: path.resolve(arg("real", "")) };
const SKIN = path.resolve(arg("skin", ""));
const SHOTS = arg("shots", null);
const OUT = arg("out", null);
const WEEKS = Number(arg("weeks", 20));
const PORTS = { generic: Number(arg("port", 4181)), real: Number(arg("port", 4181)) + 1 };
const TEAM = arg("team", "Notre Dame"), SEED = Number(arg("seed", 11));
const SECTIONS = [...fs.readFileSync(path.join(ROOT, "ui", "src", "sections.ts"), "utf8").matchAll(/key: "([a-z]+)"/g)].map((m) => m[1]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (...a) => console.log(...a);

function serve(dir, port) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".ico": "image/x-icon" };
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      let file = path.join(dir, rel);
      if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, "index.html");
      res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Content-Length": fs.statSync(file).size,
        ...(path.extname(file) === ".br" ? { "Content-Encoding": "br" } : {}), "Cache-Control": "no-cache",
        "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(port, () => resolve(server));
  });
}

// in the page: the game's worker is kept, so a call can go straight to it, and its calls in flight are counted
function instrument() {
  const W = window.Worker;
  const S = (window.__skin = { worker: null, ready: false, failed: null, stages: [], next: 1e6, waiters: new Map(), open: new Set() });
  window.Worker = function (url, opts) {
    const w = new W(url, opts);
    S.worker = w;
    w.addEventListener("message", (e) => {
      const m = e.data;
      if (m.kind === "loading") { if (S.stages[S.stages.length - 1] !== m.stage) S.stages.push(m.stage); }
      else if (m.kind === "ready") { S.ready = true; S.skin = m.skin; }
      else if (m.kind === "fatal" || m.kind === "skin-failed") S.failed = m.message;
      else if (m.id !== undefined) {
        S.open.delete(m.id);
        const waiter = S.waiters.get(m.id);
        if (waiter) { S.waiters.delete(m.id); waiter({ ok: m.ok, status: m.status, json: m.json, message: m.message }); }
      }
    });
    const post = w.postMessage.bind(w);
    w.postMessage = (m, transfer) => { if (m && m.path) S.open.add(m.id); return post(m, transfer || []); };
    return w;
  };
  window.__call = (method, path, body) => new Promise((resolve) => {
    const id = S.next++;
    S.waiters.set(id, resolve);
    S.worker.postMessage({ id, method, path, bodyJson: body == null ? null : JSON.stringify(body), bodyBytes: null, background: false });
  });
}

const ready = (page, ms = 600000) => page.waitForFunction(() => window.__skin && (window.__skin.ready || window.__skin.failed), null, { timeout: ms, polling: 250 });

async function settle(page, max = 60000) {
  const end = Date.now() + max;
  let quiet = 0;
  while (Date.now() < end && quiet < 4) {
    quiet = (await page.evaluate(() => window.__skin.open.size)) ? 0 : quiet + 1;
    await sleep(120);
  }
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Everything of a kind inside an answer: the values under the keys named, that `ok` accepts. */
function dig(node, keys, ok, out = []) {
  if (Array.isArray(node)) for (const v of node) dig(v, keys, ok, out);
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (keys.includes(k) && typeof v === "string" && ok(v) && !out.includes(v)) out.push(v);
      dig(v, keys, ok, out);
    }
  }
  return out;
}

/** The pages of the career as the player sees them: every section and every tab on it, as text. */
async function pages(page, base, id, tag) {
  const seen = {};
  await page.goto(`${base}dynasty/${id}/office`);
  await ready(page);
  await page.waitForSelector(".game-nav", { timeout: 120000 });
  await settle(page);
  const read = () => page.evaluate(() => document.body.innerText.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim());
  for (const key of SECTIONS) {
    await page.goto(`${base}dynasty/${id}/${key}`);
    await ready(page);
    await page.waitForSelector(".game-nav", { timeout: 120000 }).catch(() => {});
    await settle(page);
    seen[`${tag} / ${key}`] = await read();
    const tabs = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].filter((e) => e.offsetParent !== null && !e.disabled).length);
    for (let i = 0; i < Math.min(tabs, 14); i++) {
      const tab = page.locator('[role="tab"]:visible').nth(i);
      const name = ((await tab.textContent().catch(() => "")) || "").trim().replace(/\s+/g, " ").replace(/\d+$/, "");
      try { await tab.click({ timeout: 4000 }); } catch { continue; }
      await settle(page);
      seen[`${tag} / ${key} / tab ${i} ${name}`] = await read();
    }
  }
  return seen;
}

/** The seeded career on one site: every answer, as [what, text], and the pages at three stops. */
async function career(page, base) {
  const answers = [], seen = {};
  let id = "";
  const call = (method, p, body) => page.evaluate(([m, q, b]) => window.__call(m, q, b), [method, p, body]);
  const plain = (text) => text.replaceAll(id || "\u0000", "ID").replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?/g, "WHEN");
  const ask = async (what, method, p, body) => {
    const r = await call(method, p, body);
    answers.push([what, plain(r.ok ? r.json ?? "(bytes)" : `ERROR ${r.status}: ${r.message}`)]);
    try { return r.ok && r.json ? JSON.parse(r.json) : null; } catch { return null; }
  };
  const until_idle = async () => {
    for (;;) {
      await sleep(300);
      const r = await call("GET", `/api/season/${id}/status`);
      if (!r.ok || JSON.parse(r.json).status !== "running") return;
    }
  };

  const teams = await ask("teams", "GET", "/api/teams");
  const mine = teams.teams.find((t) => t.short_name === TEAM) || teams.teams[0];
  const slugs = teams.teams.map((t) => t.slug);
  for (const t of [mine, ...teams.teams.slice(0, 8)]) await ask(`team ${t.short_name}`, "GET", `/api/teams/${t.slug}`);
  await ask("coach options", "GET", "/api/coach-options");
  await ask("programs", "GET", "/api/league/programs");
  await ask("a program", "GET", `/api/league/programs/${mine.slug}`);
  const made = await ask("new career", "POST", "/api/season", { team: mine.slug, seed: SEED });
  id = made.id;
  answers[answers.length - 1][1] = plain(answers[answers.length - 1][1]);
  const at = (p) => `/api/season/${id}${p}`;
  await ask("auto-recruit", "POST", at("/settings"), { auto_recruit: "season" });

  const views = async (tag, week) => {
    for (const v of ["", "/status", "/office", "/headquarters", "/recruiting", "/scouting", "/programs", "/news", "/settings", "/standings", "/review", "/resume",
      "/preview", "/rivalries", "/injuries", "/awards", "/classes", "/teams", "/stats/teams", "/stats/leaders", "/stats/players", "/recruiting/report", "/offseason",
      `/schedule/${mine.slug}`, `/depth/${mine.slug}`, `/depth/${mine.slug}/formations`, "/schedule_edit", "/offseason/conferences", "/offseason/schedule"]) {
      await ask(`${tag}: ${v || "/"}`, "GET", at(v));
    }
    for (const w of [...new Set([Math.max(1, week - 1), Math.max(1, week), week + 1])]) {
      const got = await ask(`${tag}: /week/${w}`, "GET", at(`/week/${w}`));
      for (const event of dig(got, ["id", "event_id", "event"], (v) => /^\d{5,}$/.test(v)).slice(0, 3)) await ask(`${tag}: a game of week ${w}`, "GET", at(`/game/${event}`));
    }
    const found = await ask(`${tag}: /prospects`, "GET", at("/prospects?limit=40"));
    for (const pid of dig(found, ["pid", "id"], (v) => v.length > 2 && !slugs.includes(v)).slice(0, 6)) await ask(`${tag}: a prospect`, "GET", at(`/prospect/${encodeURIComponent(pid)}`));
    await ask(`${tag}: /prospects, the fives`, "GET", at("/prospects?stars=5&sort=rank&limit=20"));
    const roster = await ask(`${tag}: /depth roster`, "GET", at(`/depth/${mine.slug}/roster`));
    for (const player of dig(roster, ["slug"], (v) => !slugs.includes(v)).slice(0, 6)) await ask(`${tag}: a player`, "GET", at(`/player?slug=${encodeURIComponent(player)}&team=${mine.slug}`));
    const other = slugs[(slugs.indexOf(mine.slug) + 17) % slugs.length];
    await ask(`${tag}: another team's schedule`, "GET", at(`/schedule/${other}`));
    await ask(`${tag}: another team's depth chart`, "GET", at(`/depth/${other}`));
    seen[tag] = true;
    Object.assign(seen, await pages(page, base, id, tag));
  };

  await views("week 0", 0);
  await ask("game day", "POST", at("/gameday"), {});
  await until_idle();
  await ask("after my game: /status", "GET", at("/status"));
  await ask("after my game: /office", "GET", at("/office"));
  await ask("the rest of the week", "POST", at("/advance"), {});
  await until_idle();
  await ask("to week 5", "POST", at("/advance"), { to: Math.min(5, WEEKS) });
  await until_idle();
  await views("week 5", 5);
  if (WEEKS > 5) {
    await ask("to the end", "POST", at("/advance"), { to: WEEKS });
    await until_idle();
    await views("season over", WEEKS);
    for (let n = 1; n <= 3; n++) {
      await ask(`offseason stage ${n}`, "POST", at("/offseason/advance"), {});
      await ask(`offseason stage ${n}: /offseason`, "GET", at("/offseason"));
    }
    await views("offseason", WEEKS);
  }
  const listed = await ask("saved careers", "GET", "/api/seasons");
  return { answers, pages: Object.fromEntries(Object.entries(seen).filter(([, v]) => v !== true)), id, careers: listed.seasons.length };
}

/** Every lookalike name the swap makes, longest first. */
function lookalikes() {
  const m = new Maps(ROOT);
  const names = new Set();
  for (const v of Object.values(m.team)) for (const k of ["short", "school", "mascot", "stadium", "abbr"]) names.add(v[k]);
  for (const t of [m.person, m.phrases, m.fcs_places, m.fcs_state_places, tables.CONFERENCES_EXACT]) for (const v of Object.values(t)) names.add(v);
  for (const v of Object.values(m.fcs)) { names.add(v.name); names.add(v.location); }
  const real = new Set();
  for (const t of Object.values(m.real_teams)) for (const v of [t.short_name, t.school_name, t.mascot, t.abbreviation, t.stadium.name, t.city]) real.add(v);
  for (const n of m.real_people) real.add(n);
  return [...names].filter((n) => typeof n === "string" && n.length >= 3 && !real.has(n)).sort((a, b) => b.length - a.length);
}

function count_all(text, words) {
  const out = new Map();
  for (const w of words) {
    let at = text.indexOf(w), n = 0;
    while (at !== -1) {
      const before = text[at - 1] || " ", after = text[at + w.length] || " ";
      if (!/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after)) n++;
      at = text.indexOf(w, at + w.length);
    }
    if (n) out.set(w, n);
  }
  return out;
}

async function main() {
  for (const [k, dir] of Object.entries(SITES)) if (!fs.existsSync(path.join(dir, "index.html"))) throw new Error(`--${k}: no built site at ${dir}`);
  if (!fs.existsSync(SKIN)) throw new Error(`--skin: no file at ${SKIN}`);
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const servers = await Promise.all(Object.entries(SITES).map(([k, dir]) => serve(dir, PORTS[k])));
  const browser = await chromium.launch();
  const result = { problems: [], refused: {}, sites: {} };
  const problem = (text) => { result.problems.push(text); say(`  DIFFERENT: ${text}`); };
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }); };
  try {
    const open = async (kind) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      page.on("pageerror", (e) => problem(`${kind}: the page threw: ${String(e).slice(0, 300)}`));
      await page.addInitScript(instrument);
      const base = `http://localhost:${PORTS[kind]}/`;
      await page.goto(base);
      await ready(page);
      return { page, base };
    };

    // ---- the generic site: the control, files that are not skins, then the skin ----
    const g = await open("generic");
    await g.page.waitForSelector(".team-select, .window", { timeout: 60000 });
    await settle(g.page);
    await g.page.getByRole("button", { name: "Load a Skin" }).waitFor({ timeout: 20000 });
    const stock = await g.page.evaluate(() => document.querySelector(".window").innerText);
    await shot(g.page, "1-load-a-skin.png");
    const good = fs.readFileSync(SKIN);
    const json = good[0] === 0x1f ? (await import("node:zlib")).gunzipSync(good).toString("utf8") : good.toString("utf8");
    const small = JSON.parse(json);
    const cut = { ...small, files: {}, sources: {}, words: {}, pack: [], generated: [] };
    const not_skins = {
      "not JSON": "this is not a skin",
      "another file": JSON.stringify({ hello: 1 }),
      "another format": JSON.stringify({ ...cut, format: 99 }),
      "no name": JSON.stringify({ ...cut, name: "" }),
      "a name that is code": JSON.stringify({ ...cut, name: "<img src=x onerror=alert(1)>" }),
      "a file outside the game's data": JSON.stringify({ ...cut, pack: ["data/seasons/x.json"], files: { "data/seasons/x.json": "{}" } }),
      "a path that climbs out": JSON.stringify({ ...cut, pack: ["data/../worker.json"], files: { "data/../worker.json": "{}" } }),
      "a file that is not data": JSON.stringify({ ...cut, pack: ["data/bowls.json"], files: { "data/bowls.json": "alert(1)" } }),
      "a cut-off file": json.slice(0, 5000),
    };
    for (const [what, text] of Object.entries(not_skins)) {
      await g.page.locator(".skin-control__file").setInputFiles({ name: "skin.json", mimeType: "application/json", buffer: Buffer.from(text) });
      await g.page.waitForSelector(".skin-control__note", { timeout: 20000 });
      const said = (await g.page.locator(".skin-control__note").innerText()).replace(/\s*Dismiss\s*$/, "").trim();
      result.refused[what] = said;
      say(`  refused (${what}): ${said}`);
      if (!/\.$/.test(said) || /undefined|null|NaN|Error/.test(said)) problem(`the refusal of "${what}" is not a plain sentence: ${said}`);
      if (await g.page.evaluate(() => !!window.Skin.flag())) problem(`"${what}" was taken as a skin`);
      if (what === "another format") await shot(g.page, "3-a-file-that-is-refused.png");
      await g.page.getByRole("button", { name: "Dismiss" }).click();
    }

    say(`loading ${path.basename(SKIN)} (${(good.length / 1e6).toFixed(1)} MB) through the page`);
    const t0 = Date.now();
    await Promise.all([
      g.page.waitForEvent("load", { timeout: 300000 }),
      g.page.locator(".skin-control__file").setInputFiles(SKIN),
    ]);
    await ready(g.page);
    const state = await g.page.evaluate(() => ({ failed: window.__skin.failed, skin: window.__skin.skin, stages: window.__skin.stages, app: window.__skinApp, flag: window.Skin.flag() }));
    say(`  up in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${JSON.stringify(state)}`);
    result.loaded = { seconds: Math.round((Date.now() - t0) / 1000), ...state };
    if (state.failed || !state.skin) throw new Error(`the skin did not load: ${state.failed}`);
    if (state.skin.missed || state.skin.stale || !state.app || state.app.missed) problem(`the skin does not fit this build: ${JSON.stringify(state)}`);
    await g.page.waitForSelector(".skin-control__on", { timeout: 60000 });
    await settle(g.page);
    await shot(g.page, "2-the-skin-loaded.png");
    // a second start: nothing is made again
    const t1 = Date.now();
    await g.page.reload();
    await ready(g.page);
    result.loaded.again_seconds = Math.round((Date.now() - t1) / 100) / 10;
    result.loaded.again_stages = await g.page.evaluate(() => window.__skin.stages);
    if (result.loaded.again_stages.some((s) => /Making/.test(s))) problem("the skin's teams were made again on the second start");
    say(`  a second start: ${result.loaded.again_seconds} s`);

    const r = await open("real");

    // ---- the same career on each ----
    for (const [kind, site] of [["generic", g], ["real", r]]) {
      say(`the career on the ${kind === "generic" ? "generic site with the skin" : "site built with the source names"}`);
      const t = Date.now();
      result.sites[kind] = await career(site.page, site.base);
      say(`  ${result.sites[kind].answers.length} answers, ${Object.keys(result.sites[kind].pages).length} pages read, ${((Date.now() - t) / 1000).toFixed(0)} s`);
    }
    const a = result.sites.generic, b = result.sites.real;
    let same = 0;
    if (a.answers.length !== b.answers.length) problem(`${a.answers.length} answers on one site and ${b.answers.length} on the other`);
    for (let i = 0; i < Math.min(a.answers.length, b.answers.length); i++) {
      const [what, x] = a.answers[i], y = b.answers[i][1];
      if (x === y) { same++; continue; }
      let k = 0;
      while (x[k] === y[k]) k++;
      problem(`answer ${i} (${what}) differs at ${k}: ${JSON.stringify(x.slice(Math.max(0, k - 60), k + 60))} / ${JSON.stringify(y.slice(Math.max(0, k - 60), k + 60))}`);
    }
    result.answers = { asked: a.answers.length, same, bytes: a.answers.reduce((n, [, t]) => n + t.length, 0), errors: a.answers.filter(([, t]) => t.startsWith("ERROR ")).length };
    say(`answers: ${same} of ${a.answers.length} the same (${(result.answers.bytes / 1e6).toFixed(1)} MB; ${result.answers.errors} of them refusals, the same on both)`);

    // ---- the pages ----
    const words = lookalikes();
    let same_pages = 0, leftovers = 0;
    const plain_page = (text, id) => text.replaceAll(id, "ID").replaceAll(id.slice(0, 6), "ID");
    for (const [where, text] of Object.entries(a.pages)) {
      const x = plain_page(text, a.id), y = plain_page(b.pages[where] ?? "", b.id);
      if (x === y) same_pages++;
      else {
        const xs = x.split("\n"), ys = new Set(y.split("\n"));
        const only = xs.filter((line) => !ys.has(line)).slice(0, 4);
        problem(`the page "${where}" reads differently: ${JSON.stringify(only)}`);
      }
      const here = count_all(x, words), there = count_all(y, words);
      for (const [w, n] of here) if (n > (there.get(w) || 0)) { leftovers++; problem(`a lookalike name is left on "${where}": ${w} (${n} times, ${there.get(w) || 0} on the other site)`); }
    }
    result.pages = { read: Object.keys(a.pages).length, same: same_pages, lookalikes_checked: words.length, leftovers, characters: Object.values(a.pages).reduce((n, t) => n + t.length, 0) };
    say(`pages: ${same_pages} of ${result.pages.read} read the same; ${words.length} lookalike names looked for, ${leftovers} left over`);

    // the team picker, read on each
    await g.page.goto(g.base); await ready(g.page); await g.page.waitForSelector(".team-select"); await settle(g.page);
    await r.page.goto(r.base); await ready(r.page); await r.page.waitForSelector(".team-select"); await settle(r.page);
    const picker = [await g.page.evaluate(() => document.querySelector(".window").innerText), await r.page.evaluate(() => document.querySelector(".window").innerText)];
    if (picker[0] !== picker[1]) problem("the team picker reads differently");
    if (picker[0] === stock) problem("the team picker did not change with the skin");
    const left = count_all(picker[0], words), base_left = count_all(picker[1], words);
    for (const [w, n] of left) if (n > (base_left.get(w) || 0)) problem(`a lookalike name is left on the team picker: ${w}`);

    // ---- the careers of each are kept apart ----
    await g.page.getByRole("button", { name: "Remove Skin" }).click();
    await g.page.waitForEvent("load", { timeout: 60000 });
    await ready(g.page);
    await g.page.waitForSelector(".team-select");
    await settle(g.page);
    const after = await g.page.evaluate(async () => ({ flag: window.Skin.flag(), skin: window.__skin.skin, seasons: JSON.parse((await window.__call("GET", "/api/seasons")).json).seasons.length, text: document.querySelector(".window").innerText }));
    result.removed = { careers_listed: after.seasons, stock_names_back: after.text === stock };
    if (after.flag || after.skin || after.seasons !== 0 || after.text !== stock) problem(`after Remove Skin the site is not as it was: ${JSON.stringify({ ...after, text: undefined })}`);
    await Promise.all([g.page.waitForEvent("load", { timeout: 300000 }), g.page.locator(".skin-control__file").setInputFiles(SKIN)]);
    await ready(g.page);
    const back = await g.page.evaluate(async () => JSON.parse((await window.__call("GET", "/api/seasons")).json).seasons.length);
    result.removed.careers_back = back;
    if (back !== a.careers) problem(`the skin's careers did not come back with it: ${back} of ${a.careers}`);
    say(`careers: ${a.careers} under the skin, ${after.seasons} listed with it off, ${back} back when it is loaded again`);
  } finally {
    await browser.close();
    for (const s of servers) s.close();
    if (OUT) fs.writeFileSync(OUT, JSON.stringify({ ...result, sites: undefined }, null, 1));
  }
  say(result.problems.length ? `skin_compare: ${result.problems.length} differences` : "skin_compare: the same");
  process.exit(result.problems.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
