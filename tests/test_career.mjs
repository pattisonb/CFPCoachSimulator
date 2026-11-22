// Coach Career: a season started as a career carries the career layer; a plain season, a
// "remaining" season and older saves stay exactly as they were.
// `node tests/test_career.mjs`
import zlib from "node:zlib";
import { start, test, run, assert, equal, raises } from "./harness.mjs";
import { json_dumps } from "../engine_js/pyrt.js";

const game = await start();
const { career, season, files } = game;
const ValueError = game.coaches.ValueError;

test("career", () => {
  const t0 = performance.now() / 1000;
  let plain = season.new_season("ohio-state", "full", 3);
  const t1 = performance.now() / 1000;
  const st = season.new_season("ohio-state", "full", 3, undefined, undefined, true);
  const took = performance.now() / 1000 - t1;
  // the career's extra (the class, its names, the staff) over a plain season: under 4 s here,
  // scaled by the machine (a plain season takes about 0.4 s on a fast box, 1 s on a slow one)
  assert(took - (t1 - t0) < Math.max(4.0, 8.0 * (t1 - t0)), `a new career took ${took.toFixed(1)} s to start against ${(t1 - t0).toFixed(1)} s for a plain season`);
  assert(career.is_career(st) && st["career"]["year"] === 2026);
  // a career with its recruiting class stays small enough to keep in the browser every week
  const size = json_dumps(st["recruiting"], { separators: [",", ":"] }).length;
  assert(size < 4_250_000, `the recruiting class is ${(size / 1e6).toFixed(1)} MB`);   // School Grades Phase 2's thirteen topics: about 4.03 MB (main was 3.97)
  assert(career.export_save(st).length < 1_500_000, "a new career's save is over 1.5 MB");
  assert(st["career"]["settings"]["auto_recruit"] === false && st["career"]["saved_week"] === 0);

  plain = season.new_season("ohio-state", "full", 3);
  assert(!career.is_career(plain) && !("recruiting" in plain));
  season.advance(plain);
  assert(plain["current_week"] === 1);                      // older-style seasons play on unchanged

  let started = false;
  try {
    season.new_season("ohio-state", "remaining", undefined, undefined, undefined, true);
    started = true;
  } catch (e) {
    // Python's ValueError; the port throws a plain Error with the same message here (sim_js/season/part1.js new_season)
    if (!(e instanceof ValueError || e.message === "a season starts from week 1")) throw e;
  }
  assert(!started, "a career started from today");
  // saves: saving stamps the career with its week; a download round-trips with its box scores
  season.advance(st);
  season.save_season(st);
  assert(st["career"]["saved_week"] === 1);
  const some_box = files.list_dir(season.box_dir(st)).find((n) => n.endsWith(".json"));
  assert(some_box !== undefined, "StopIteration");
  const blob = career.export_save(st);
  files.remove_dir(`${season.SEASONS_DIR}/${st["id"]}`);
  files.remove(`${season.SEASONS_DIR}/${st["id"]}.json`);
  const back = career.import_save(blob);
  assert(back["id"] === st["id"] && back["current_week"] === 1);
  equal(back["career"], st["career"]);
  assert(files.exists(`${season.box_dir(back)}/${some_box}`), "box scores did not come back");
  // the browser's weekly copy leaves out other games' box scores (your games ride in the state)
  const light = career.export_save(st, false);
  assert(light.length < blob.length);
  equal(career.read_save(light)[1], {});
  equal(career.read_save(light)[0]["my_boxes"], st["my_boxes"]);
  let imported = false;
  try {
    career.import_save(career.export_save(plain));
    imported = true;
  } catch (e) {
    if (!(e instanceof ValueError)) throw e;
  }
  assert(!imported, "a plain season was imported as a career");
  // the newer copy wins, whichever side it is on
  const older = { ...st, career: { ...st["career"], saved_week: 2 } };
  const newer = { ...st, career: { ...st["career"], saved_week: 5 } };
  assert(career.newer(older, newer) === newer && career.newer(newer, older) === newer);
  // a restore never replaces a newer server copy, and fills in a forgotten one
  const stale = career.export_save(older);
  const kept = career.restore(stale, newer);
  assert(kept === newer, "an older upload replaced the newer server copy");
  files.remove(`${season.SEASONS_DIR}/${st["id"]}.json`);
  const restored = career.restore(career.export_save(newer), null);
  assert(restored["career"]["saved_week"] === 5 && season.load_season(st["id"])["career"]["saved_week"] === 5);
  // uploads are checked before anything is written: a gzip bomb, a wrong shape, box names
  // that leave the folder, an id that belongs to a season that is not a career
  const gz = (text) => new Uint8Array(zlib.gzipSync(Buffer.from(text, "utf8")));
  const spaces = Buffer.alloc(300 * 1024 * 1024 + 2, " ");
  spaces[0] = "{".charCodeAt(0);
  spaces[spaces.length - 1] = "}".charCodeAt(0);
  const bomb = new Uint8Array(zlib.gzipSync(spaces));
  for (const bad of [bomb, gz(json_dumps({ state: { id: "abc123", career: { x: 1 } } }))]) {
    let accepted = false;
    try {
      career.read_save(bad);
      accepted = true;
    } catch (e) {
      if (!(e instanceof ValueError)) throw e;
    }
    assert(!accepted, "a bad upload was accepted");
  }
  const sneaky = gz(JSON.stringify({ state: newer, boxes: { "D:evil.json": "{}", "ok-1.json": "{}", "a..json": "{}" } }));
  equal(Object.keys(career.read_save(sneaky)[1]), ["ok-1.json"]);
  const plain_same_id = { ...plain, id: st["id"] };
  let replaced = false;
  try {
    career.restore(career.export_save(newer), plain_same_id);
    replaced = true;
  } catch (e) {
    if (!(e instanceof ValueError)) throw e;
  }
  assert(!replaced, "a career replaced a plain season with the same id");
  console.log("career ok");
});

await run();
