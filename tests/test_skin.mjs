// Skins (ui/public/skin.js; tools/skin.mjs, tools/make_skin.mjs): a file the player loads on the published site to
// give the game other names and rosters, in his browser only.
//
//   1. A skin cannot run code: whatever its names hold, they are written into the site's scripts as text, and only
//      at the spots the site lists.
//   2. The generic build takes a skin and holds none: it publishes the lists of where a name stands (which hold no
//      name), and no skin file; the skin's own script is published as it is in the repository.
//   3. The round trip: the skin made from the repository, applied to the generic build's data and script the way the
//      browser applies it, gives the data of a build with the source names, file for file (the files the game makes
//      itself included, made by the published script with the skin's names in it), and a career played on each
//      answers the same.
//
// `node tests/test_skin.mjs` (some three minutes: it builds the generic site); tools/skin_compare.mjs is the same
// question asked of two built sites in a browser.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.CFP_PACK_QUALITY ??= "5";        // a quick pack: its size is not what is tested
const build = await import("../tools/build_site.mjs");
const { check } = await import("../tools/generic/check.mjs");
const { scrub } = await import("../tools/generic/scrub.mjs");
const { Skin, make, unpack } = await import("../tools/skin.mjs");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(ok, message) {
  if (!ok) throw new Error(typeof message === "function" ? message() : String(message ?? "assertion failed"));
}

// ---- 1. a skin cannot run code ------------------------------------------------------------------------------------

function hostile() {
  const script = "var hit=0,a=\"Big Eighteen\",b='Rat\\'s Mouth Bowl',c={Press:1,\"Heat Belt\":2},d=c.Press,e=c?.Press,f=`${a} Stiff-Arm ${b}`;";
  const spot = (text, kind, name, nth = 0) => {
    let at = -1;
    for (let i = 0; i <= nth; i++) at = script.indexOf(text, at + 1);
    assert(at >= 0, text);
    return [at, text.length, Skin.tag(name), kind];
  };
  const run = (words, spots) => {
    const names = { format: Skin.FORMAT, length: script.length, hash: Skin.hash(script), spots, imports: [] };
    const made = Skin.apply(script, names, Skin.lookup(words), null);
    const box = { hit: 0 };
    vm.runInNewContext(made.text + ";out={a,b,c,d,e,f,hit};", box);       // it is still a program, and it runs
    return { ...made, out: box.out };
  };

  // honest names, quotes and all
  let r = run({ "Big Eighteen": ["Big Ten"], "Rat\\'s Mouth Bowl": ["x"], "Rat's Mouth Bowl": ["Boca \"Raton\" Bowl's"], Press: ["A P"], "Stiff-Arm": ["Heisman"] },
    [spot("Big Eighteen", "s", "Big Ten"), spot("Rat\\'s Mouth Bowl", "s", "Boca \"Raton\" Bowl's"), spot("Press", "k", "A P"), spot(".Press", "b", "A P"),
      spot("Press", "b", "A P", 2), spot("Stiff-Arm", "s", "Heisman")]);
  assert(r.missed === 0 && r.done === 6, () => JSON.stringify(r));
  assert(r.out.a === "Big Ten" && r.out.b === "Boca \"Raton\" Bowl's" && r.out.c["A P"] === 1 && r.out.d === 1 && r.out.e === 1, () => JSON.stringify(r.out));
  assert(r.out.f === "Big Ten Heisman Boca \"Raton\" Bowl's", r.out.f);

  // names that try to leave the string: each is refused (the site's own name stays), or written as text
  const attacks = ["\";hit=1;//", "';hit=1;//", "`;hit=1;//", "${hit=1}", "x\\", "\\u0022;hit=1;//", "a\nhit=1", "a\u2028hit=1", "</script><script>hit=1", "x".repeat(121),
    "\"+(hit=1)+\"", "'+(hit=1)+'", "1:1,[hit=1]:1,x", "x];hit=1;[", "constructor"];
  for (const bad of attacks) {
    for (const [text, kind, nth] of [["Big Eighteen", "s", 0], ["Rat\\'s Mouth Bowl", "s", 0], ["Stiff-Arm", "s", 0], ["Press", "k", 0], [".Press", "b", 0], ["Press", "b", 2]]) {
      const shown = text.replace(/^\./, "").replace(/\\(['"])/g, "$1");
      r = run({ [shown]: [bad] }, [spot(text, kind, bad, nth)]);
      assert(r.out.hit === 0, () => `a skin's name ran as code: ${JSON.stringify(bad)} in a ${kind} spot`);
      assert(r.done + r.missed === 1);
      if (!Skin.plain(bad)) assert(r.missed === 1 && r.text === script, () => `a name that is not plain text was written: ${JSON.stringify(bad)}`);
    }
  }
  // a list for another script, or a damaged one, is refused whole
  const names = { format: Skin.FORMAT, length: script.length, hash: Skin.hash(script), spots: [], imports: [] };
  for (const wrong of [{ ...names, hash: 1 }, { ...names, length: 3 }, { ...names, format: 99 }, { ...names, spots: [[5, 4, 0, "s"], [6, 4, 0, "s"]] },
    { ...names, spots: [[script.length - 1, 5, 0, "s"]] }]) {
    let refused = false;
    try { Skin.apply(script, wrong, Skin.lookup({}), null); } catch { refused = true; }
    assert(refused, () => `a wrong list of names was used: ${JSON.stringify(wrong).slice(0, 120)}`);
  }
  // a module's own imports are written out in full, and nothing else is
  const mod = "import{a}from\"./faces-x.js\";export const b=a;";
  const at = mod.indexOf("./faces-x.js");
  r = Skin.apply(mod, { format: Skin.FORMAT, length: mod.length, hash: Skin.hash(mod), spots: [], imports: [[at, 12]] }, Skin.lookup({}), "https://example.test/assets/index-1.js");
  assert(r.text === "import{a}from\"https://example.test/assets/faces-x.js\";export const b=a;", r.text);
}

// ---- 2 and 3 ------------------------------------------------------------------------------------------------------

// One step of the game on Node over a folder's files, with the game as one script (`game`): base | play
// (the rosters are never made: a skin carries its own)
const STEP = `
import { createRequire } from "node:module";
import { fileStore } from ${JSON.stringify(pathToFileURL(path.join(ROOT, "tools", "game_host.mjs")).href)};
const [game, root, step] = process.argv.slice(2);
const Game = createRequire(import.meta.url)(game);
const store = fileStore(root);
Game.files.set_reader(store.read);
Game.files.set_store(store);
Game.career.zip = Game.zip;
if (step === "base") Game.modules.league.write_base_files();
else {
  const api = Game.api, said = [];
  const say = (v) => said.push(v);
  const teams = api.call("GET", "/api/teams");
  say(teams);
  const team = teams.teams.find((t) => t.short_name === "Notre Dame") || teams.teams[0];
  say(api.call("GET", "/api/teams/" + team.slug));
  const s = api.call("POST", "/api/season", { team: team.slug, seed: 11 });
  say({ ...s, id: null, created_at: null });
  api.call("POST", "/api/season/" + s.id + "/advance", { to: 2 });
  while (api.running()) api.step(null);
  for (const view of ["week/1", "week/2", "standings", "polls", "awards", "recruiting", "news"]) {
    let got; try { got = api.call("GET", "/api/season/" + s.id + "/" + view); } catch (e) { got = String(e.message); }
    say([view, got]);
  }
  // (the save's id and the clock are the two things that are not the seed's)
  console.log(JSON.stringify(said).replaceAll(s.id, "ID").replace(/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}(?:[.][0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?/g, "WHEN"));
}
`;

async function round_trip() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cfp-skin-test-"));
  try {
    // the generic site, as Vercel builds it
    const site = path.join(tmp, "site");
    const info = await build.build({ out: site, generic: true });
    assert(info.skins && Object.values(info.skins).every((v) => v.complete && v.spots > 50), () => `the build's lists of names: ${JSON.stringify(info.skins)}`);
    const page = fs.readFileSync(path.join(site, "index.html"), "utf8");
    assert(page.includes("Skin.boot(") && page.includes('<script src="./skin.js">') && !/<script type="module"/.test(page), "index.html does not start the app through Skin.boot");
    assert(fs.readFileSync(path.join(site, "skin.js"), "utf8") === fs.readFileSync(path.join(ROOT, "ui", "public", "skin.js"), "utf8"), "the swap changed skin.js");
    // no skin in the build, and no real name in what lets it take one
    const all = [];
    const walk = (dir, rel = "") => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) e.isDirectory() ? walk(path.join(dir, e.name), `${rel}${e.name}/`) : all.push(`${rel}${e.name}`); };
    walk(site);
    for (const f of all) {
      assert(!/\.skin\.json(\.gz)?$/.test(f), `a skin is in the build: ${f}`);
      if (/\.(json|js|html)$/.test(f) && !f.startsWith("boot/")) {
        const text = fs.readFileSync(path.join(site, f), "utf8");
        assert(!text.includes("pocket-college-football\",\"format\"") && !/"sources"\s*:\s*\{/.test(text), `a skin is in the build: ${f}`);
      }
    }
    const terms = scrub.terms(ROOT);
    const found = check.leaks(site, terms, [build.GAME_NAMES, build.APP_NAMES, "skin.js", "worker.js", "sim-worker.js", "index.html"]);
    assert(!Object.keys(found).length, () => `real names in what takes a skin: ${JSON.stringify(found).slice(0, 600)}`);
    for (const f of [build.GAME_NAMES, build.APP_NAMES]) {
      const names = JSON.parse(fs.readFileSync(path.join(site, f), "utf8"));
      assert(names.spots.every((s) => s.length === 4 && s.slice(0, 3).every(Number.isInteger) && ["s", "k", "b"].includes(s[3])), `${f} holds more than places and marks`);
    }

    // the skin, made from the repository beside this build's data
    const real = await build.stage(path.join(tmp, "real"), false);
    const generic = unpack(zlib.gunzipSync(fs.readFileSync(path.join(site, build.PACK_GZIP))));
    const maps = new scrub.Maps(ROOT);
    const skin = JSON.parse(JSON.stringify(make(build, generic, real, maps, { id: "test-names", name: "Test Names", commit: "test" })));
    // what the browser makes under a skin: the base league alone. The rosters come in the skin itself, as files
    assert(skin.format === Skin.FORMAT && skin.generated.length === build.GENERATED.length - build.ROSTERS.length, () => JSON.stringify(skin.generated));
    assert(build.ROSTERS.every((f) => !skin.generated.includes(f) && typeof skin.files[f] === "string"), "the skin does not carry its rosters");
    const unplain = Object.values(skin.words).flat().filter((n) => !Skin.plain(n));
    assert(!unplain.length, () => `names the browser would not write: ${JSON.stringify(unplain.slice(0, 8))}`);

    // ... applied as the browser applies it: the script
    const script = fs.readFileSync(path.join(site, build.GAME_SCRIPT), "utf8");
    const names = JSON.parse(fs.readFileSync(path.join(site, build.GAME_NAMES), "utf8"));
    const made = Skin.apply(script, names, Skin.lookup(skin.words), null);
    assert(made.missed === 0 && made.done === names.spots.length, () => `${made.missed} names of game.js are not in the skin`);
    const app_names = JSON.parse(fs.readFileSync(path.join(site, build.APP_NAMES), "utf8"));
    const app = /Skin\.boot\("([^"]+)"/.exec(page)[1];
    const made_app = Skin.apply(fs.readFileSync(path.join(site, app), "utf8"), app_names, Skin.lookup(skin.words), "https://example.test/assets/x.js");
    assert(made_app.missed === 0 && made_app.done === app_names.spots.length, () => `${made_app.missed} names of the app are not in the skin`);

    // ... and the data: the site's own files dressed, then the files the game makes, made by the dressed script
    const mem = new Map(generic.texts);
    const dressed = Skin.dress(generic.files, { get: (f) => mem.get(f), put: (f, t) => mem.set(f, t), drop: (f) => mem.delete(f) }, skin, skin.files, names.hash);
    assert(dressed.stale === false, "a skin made beside this build's data is called out of date");
    const work = path.join(tmp, "work"), played = path.join(tmp, "played"), truth = path.join(tmp, "truth");
    const put = (root, f, text) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), text); };
    for (const [f, text] of mem) put(work, f, text);
    for (const [f, text] of Object.entries(skin.sources)) put(work, f, text);
    const game = path.join(tmp, "skinned-game.cjs"), step = path.join(tmp, "step.mjs");
    fs.writeFileSync(game, made.text + "\nmodule.exports = Game;\n");
    fs.writeFileSync(step, STEP);
    const run = (script_file, root, what) => {
      const r = spawnSync(process.execPath, [step, script_file, root, what], { cwd: root, encoding: "utf8", maxBuffer: 1 << 30 });
      assert(r.status === 0, () => `${what}: ${String(r.stderr || r.error).slice(-2000)}`);
      return r.stdout;
    };
    run(game, work, "base");
    const real_text = (f) => fs.readFileSync(path.join(real, f), "utf8");
    const differ = skin.pack.filter((f) => !fs.existsSync(path.join(work, f)) || fs.readFileSync(path.join(work, f), "utf8") !== real_text(f));
    assert(!differ.length, () => `under the skin these files are not the source build's: ${differ.slice(0, 10).join(", ")} (${differ.length} of ${skin.pack.length})`);
    const real_pack = build.game_files(real_text, (dir) => fs.readdirSync(path.join(real, dir)));
    assert(JSON.stringify(real_pack) === JSON.stringify(skin.pack) && [...mem.keys()].every((f) => skin.pack.includes(f)), "the skin's list of files is not the source build's");

    // a career on each: the dressed script over the dressed data, and the source script over the source data
    for (const f of skin.pack) { put(played, f, fs.readFileSync(path.join(work, f), "utf8")); put(truth, f, real_text(f)); }
    const real_ui = path.join(real, "ui");
    fs.symlinkSync(path.join(ROOT, "ui", "node_modules"), path.join(real_ui, "node_modules"), "junction");
    const real_game = path.join(tmp, "real-game.cjs");
    build.bundle_game(real_ui, real_game);
    fs.appendFileSync(real_game, "\nmodule.exports = Game;\n");
    const ours = run(game, played, "play"), theirs = run(real_game, truth, "play");
    assert(ours.length > 100000 && ours === theirs, () => {
      let i = 0;
      while (ours[i] === theirs[i]) i++;
      return `a career under the skin differs from one on the source names, at ${i} of ${theirs.length}: ${JSON.stringify(ours.slice(i - 80, i + 80))} / ${JSON.stringify(theirs.slice(i - 80, i + 80))}`;
    });
    console.log(`test_skin: the round trip: ${skin.pack.length} files the same, ${names.spots.length} + ${app_names.spots.length} names written, a career of ${(ours.length / 1e6).toFixed(1)} MB of answers the same`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  hostile();
  await round_trip();
  console.log("test_skin: ok");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
