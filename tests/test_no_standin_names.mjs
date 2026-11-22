// The FCS stand-ins are named only for their regions ("FCS Mid-Atlantic", slug fcs-mid-atlantic). The made-up school
// names, slugs, towns, mascots, stadiums and conference they once had appear in no tracked file of the repository
// (the forbidden words are kept rot13-encoded here, so this file does not hold them either), and a save from before
// the rename (its state, its box scores, a downloaded save file) is rewritten when it is read: it loads with today's
// slugs and labels everywhere, keeps playing, and exports clean.
// `node tests/test_no_standin_names.mjs`
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { start, test, run, assert, equal, ROOT } from "./harness.mjs";

const game = await start({ env: { SIM_WORKERS: "1", CFP_SEASONS_DIR: "data/seasons-standin-test" } });
const { api, season, career, files } = game;
const fcs_names = game.modules.fcs_names;
const show = (v) => JSON.stringify(v);

// rot13: the old slugs, school names, towns, mascots, stadiums, conference and abbreviations. One old mascot is also
// a real FBS team's and is left out (it is checked on the stand-ins' own records below).
const ENCODED = [
  "pnyqre-fcevatf", "cbeg-eraavpx", "erq-cenvevr-fgngr", "nyqre-evqtr", "jraqg-ynxr", "gnyhf-crnx", "prqne-fbhaq",
  "xrfgery-onl", "pnyqre fcevatf", "cbeg eraavpx", "erq cenvevr", "nyqre evqtr", "jraqg ynxr", "gnyhf crnx",
  "prqne fbhaq", "xrfgery onl", "sbetref", "pbggbazbhguf", "znevaref", "cynvafzra", "servtugref", "bepnf",
  "frn jbyirf", "rvtug eviref", "sheanpr uvyy", "yvir bnx objy", "frnjnyy fgnqvhz", "jvaqoernx fgnqvhz", "ber qbpx",
  "fjvgpuonpx fgnqvhz", "qevsgjbbq svryq", "uneobeivrj svryq", "nefh", "cefh", "pfqh", "resp",
];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
const pattern = () => new RegExp(`\\b(${ENCODED.map((s) => escape(fcs_names._r(s))).join("|")})\\b`, "gi");

test("no tracked file of the repository holds one of the stand-ins' old names", () => {
  const listed = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  equal(listed.status, 0, "git ls-files failed");
  const names = listed.stdout.toString("utf8").split("\0").filter((f) => f);
  const hits = {};
  let read = 0;
  for (const f of names) {
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(path.join(ROOT, f))); } catch { continue; }   // binary (fonts, icons, archives), or deleted
    read++;
    const found = new Set((text.match(pattern()) || []).map((m) => m.toLowerCase()));
    if (pattern().test(path.basename(f))) found.add("(the file name)");
    if (found.size) hits[f] = [...found].slice(0, 3);
  }
  equal(hits, {});
  assert(read > 300, `only ${read} files were read`);
});

test("each stand-in's slug, names and abbreviation are its region's, with no mascot and no town", () => {
  const dir = path.join(ROOT, "cfb_sim_data", "teams");
  const fict = fs.readdirSync(dir).filter((n) => n.endsWith(".json")).map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8"))).filter((t) => t["fictional"]);
  equal(fict.length, 8);
  for (const t of fict) {
    const lab = `FCS ${t["region"]}`;
    equal(t["slug"], `fcs-${t["region"].toLowerCase().replaceAll(" ", "-")}`);
    assert(t["school_name"] === lab && t["short_name"] === lab && t["abbreviation"] === "FCS", t["slug"]);
    assert(!t["mascot"] && !t["city"], t["slug"]);
    assert(t["roster"].every((p) => p["team"] === lab && p["slug"].endsWith(t["slug"])), t["slug"]);
  }
  const teams = season.load_teams();
  for (const [slug, t] of Object.entries(teams)) {
    if (!t["fictional"]) continue;
    const lab = season.fcs_label(slug);
    assert(t["name"] === lab && t["school"] === lab && season.team_display(slug, teams) === lab, show([slug, t["name"]]));
    assert(t["mascot"] === "" && t["abbreviation"] === "FCS" && !t["city"], slug);
  }
});

// ----- a save from before the rename ----------------------------------------------------------

/** Today's save text as it read before the rename: each stand-in's slug and label back to its old slug and short name. */
function old_style(text) {
  const back = {};
  for (const [region, [slug, names]] of Object.entries(fcs_names._OLD)) {
    back[fcs_names.new_slug(region)] = fcs_names._r(slug);
    back[fcs_names.label(region)] = fcs_names._r(names[1]);
  }
  const keys = Object.keys(back).sort((a, b) => b.length - a.length);
  return text.replace(new RegExp(keys.map(escape).join("|"), "g"), (m) => back[m]);
}
const fictional = (g) => (season.state_fictional(g["home"]) ? g["home"] : season.state_fictional(g["away"]) ? g["away"] : null);

let ST = null, LOADED = null, PLAYED = null, BLOB_OLD = null;
test("an old save and its box scores are rewritten when the save is loaded, and nothing else about it changes", () => {
  ST = season.new_season("smu", "full", 11, undefined, undefined, true);
  season.advance_to(ST, 2);                      // this team's FCS game is in the first two weeks
  season.save_season(ST);
  PLAYED = Object.values(ST["games"]).filter((g) => fictional(g) && g["played"]);
  assert(PLAYED.length, "no FCS game played in two weeks");
  const file = `${season.SEASONS_DIR}/${ST["id"]}.json`;
  files.write_text(file, old_style(files.read_text(file)));
  const dir = season.box_dir(ST);
  const boxes = files.list_dir(dir).filter((n) => n.endsWith(".json")).map((n) => `${dir}/${n}`);
  for (const b of boxes) files.write_text(b, old_style(files.read_text(b)));
  const old_text = files.read_text(file);
  assert(fcs_names.has_old(old_text), "the old-style save holds no old slug");
  assert(boxes.some((b) => fcs_names.has_old(files.read_text(b))));
  BLOB_OLD = new Uint8Array(zlib.gzipSync(JSON.stringify({ state: JSON.parse(old_text),
    boxes: Object.fromEntries(boxes.map((b) => [b.split("/").pop(), files.read_text(b)])) })));

  LOADED = season.load_season(ST["id"]);
  assert(!fcs_names.has_old(JSON.stringify(LOADED)), "the loaded save still holds old names");
  assert(!fcs_names.has_old(files.read_text(file)), "the save file was not rewritten");
  assert(!boxes.some((b) => fcs_names.has_old(files.read_text(b))), "a box score file was not rewritten");
  equal(JSON.parse(JSON.stringify(LOADED["games"])), JSON.parse(JSON.stringify(ST["games"])), "the schedule did not map back");
  equal(JSON.parse(JSON.stringify(LOADED["season_stats"])), JSON.parse(JSON.stringify(ST["season_stats"])), "the season stats did not map back");
});

test("the migrated save's box scores name the stand-in by its region, and the season plays on", () => {
  const teams = season.load_teams();
  for (const g of PLAYED) {
    const box = season.load_box(LOADED, g["event_id"]);
    for (const side of ["home", "away"]) {
      const slug = box[`${side}_slug`];
      assert(slug in teams, slug);
      if (!teams[slug]["fictional"]) continue;
      equal(box[side]["name"], season.fcs_label(slug));
      assert(box["scoring_plays"].filter((s) => s["team"] === side).every((s) => s["team_name"] === season.fcs_label(slug)));
    }
  }
  season.advance_to(LOADED, 3);
  equal(LOADED["current_week"], 3);
});

test("a downloaded save from before the rename reads clean, and today's export holds no old name", () => {
  const [state, boxes] = career.read_save(BLOB_OLD);
  assert(!fcs_names.has_old(JSON.stringify(state)) && !Object.values(boxes).some((t) => fcs_names.has_old(t)));
  const out = career.export_save(LOADED, true);
  assert(!fcs_names.has_old(zlib.gunzipSync(out).toString("utf8")));
});

test("through the API a stand-in's side of a box score and its team card read only its region", () => {
  season.save_season(LOADED);
  const g = PLAYED[0], fslug = fictional(PLAYED[0]);
  const box = api.call("GET", `/api/season/${LOADED["id"]}/game/${g["event_id"]}`);
  equal(box[box["home_slug"] === fslug ? "home" : "away"]["name"], season.fcs_label(fslug));
  const card = api.call("GET", "/api/teams")["teams"].find((c) => c["slug"] === fslug);
  assert(card["name"] === season.fcs_label(fslug) && card["mascot"] === "", show(card));
});

await run();
