// The FCS stand-ins are eight made-up teams, one per region, each with a name, a mascot, an abbreviation and two
// colors of its own ("Mid-Atlantic Blue Crabs", CRAB, slug fcs-mid-atlantic), none of them a real college's. They
// have been renamed twice: the made-up school names, slugs, towns, mascots, stadiums and conference they first had
// appear in no tracked file of the repository (the forbidden words are kept rot13-encoded here, so this file does
// not hold them either), and a save from either earlier time (its state, its box scores, a downloaded save file),
// whether it holds those first names or the region labels that followed ("FCS Mid-Atlantic"), is rewritten when it
// is read: it loads with today's slugs and names everywhere, keeps playing, and exports clean.
// `node tests/test_no_standin_names.mjs`
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { start, test, run, assert, equal, ROOT } from "./harness.mjs";
import { tables } from "../tools/generic/tables.mjs";

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

// every team as the repository has it: its identity (data/base_meta.json) and its players (the roster file)
const META = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "base_meta.json"), "utf8"));
const FILED = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "engine_teams.json"), "utf8"))["teams"];
const FILES = Object.entries(META).map(([slug, t]) => ({ ...t, roster: [...FILED[slug]["offense"], ...FILED[slug]["defense"]] }));
const HEX = /^#[0-9A-F]{6}$/;

test("each stand-in has its region's slug and a name, mascot, abbreviation and two colors of its own, in its file and in the game", () => {
  const fict = FILES.filter((t) => t["fictional"]);
  equal(fict.length, 8);
  for (const t of fict) {
    const b = fcs_names.TEAMS[t["region"]];
    assert(b, t["region"]);
    equal(t["slug"], `fcs-${t["region"].toLowerCase().replaceAll(" ", "-")}`);
    equal([t["school_name"], t["short_name"], t["mascot"], t["abbreviation"], t["stadium"]["name"]], [b.name, b.name, b.mascot, b.abbreviation, b.stadium], t["slug"]);
    assert(b.name.endsWith(` ${b.mascot}`) && b.name.length > b.mascot.length + 3, `${b.name}: a stand-in is a place and its mascot`);
    equal(b.slug, t["slug"]);
    assert(/^[A-Z]{3,4}$/.test(b.abbreviation), b.abbreviation);
    equal(Object.fromEntries(Object.entries(t["colors"]).map(([k, v]) => [k, v["hex"]])), fcs_names.hex_colors(t["region"]), t["slug"]);
    const { primary, secondary } = fcs_names.hex_colors(t["region"]);
    assert(HEX.test(primary) && HEX.test(secondary) && primary !== secondary, show([t["slug"], primary, secondary]));
    assert(!t["city"] && t["conference"] === "FCS" && t["subdivision"] === "FCS", t["slug"]);       // still FCS, still no town
    assert(t["roster"].length >= 60 && t["roster"].every((p) => p["slug"].endsWith(t["slug"])), t["slug"]);
    equal([FILED[t["slug"]]["name"], FILED[t["slug"]]["mascot"], FILED[t["slug"]]["abbreviation"]], [b.name, b.mascot, b.abbreviation], t["slug"]);
  }
  for (const key of ["name", "mascot", "abbreviation", "stadium"]) equal(new Set(Object.values(fcs_names.TEAMS).map((b) => b[key])).size, 8, `two stand-ins share a ${key}`);
  equal(new Set(Object.keys(fcs_names.TEAMS).map((r) => fcs_names.hex_colors(r)["primary"])).size, 8, "two stand-ins share a primary color");
  equal(new Set(FILES.map((t) => t["abbreviation"])).size, FILES.length, "two teams share an abbreviation");
  const teams = season.load_teams();
  for (const [slug, t] of Object.entries(teams)) {
    if (!t["fictional"]) continue;
    const b = fcs_names.brand(slug);
    assert(t["name"] === b.name && t["school"] === b.name && season.team_display(slug, teams) === b.name && season.fcs_label(slug) === b.name, show([slug, t["name"]]));
    equal(season.team_in_line(slug, teams), `the ${b.name}`);
    assert(t["mascot"] === b.mascot && t["abbreviation"] === b.abbreviation && !t["city"] && t["conference"] === "FCS", slug);
    equal(t["colors"], fcs_names.hex_colors(season.TEAM_REGION[slug]));
    equal(season.tier_of(t), "FCS");
  }
  equal(season.team_in_line("smu", teams), teams["smu"]["name"]);
});

test("no stand-in's name, mascot or abbreviation is a real team's, and a league that still says the old ones shows today's", () => {
  const real = FILES.filter((t) => !t["fictional"]);
  const words = new Set(real.flatMap((t) => [t["school_name"], t["short_name"], t["mascot"], t["abbreviation"]]).filter((x) => x).map((x) => x.toLowerCase()));
  const mascots = real.map((t) => (t["mascot"] || "").toLowerCase()).filter((x) => x);
  for (const b of Object.values(fcs_names.TEAMS)) {
    for (const x of [b.name, b.mascot, b.abbreviation, b.stadium]) assert(!words.has(x.toLowerCase()), `${x} is a real team's`);
    // nor one word apart ("Blue Crabs" beside a real "Crabs")
    assert(!mascots.some((m) => b.mascot.toLowerCase().split(" ").includes(m) || m.split(" ").includes(b.mascot.toLowerCase())), b.mascot);
    assert(!real.some((t) => (t["stadium"] || {})["name"] === b.stadium), b.stadium);
  }
  // nor a name the published site gives a real team (tools/generic/tables.mjs), nor a real conference's:
  // the published build would swap it, and a stand-in is the same team there as here
  const made = new Set(Object.values(tables.TEAMS).flatMap(([short, abbr, mascot]) => [short, abbr, mascot]).concat(tables.FCS_MASCOTS).map((x) => x.toLowerCase()));
  const swapped = [...Object.keys(tables.CONFERENCES), ...Object.keys(tables.CONFERENCES_EXACT), ...tables.DISTINCT_MASCOTS];
  for (const b of Object.values(fcs_names.TEAMS)) {
    for (const x of [b.name, b.mascot, b.abbreviation]) assert(!made.has(x.toLowerCase()), `${x} is a published lookalike's`);
    for (const x of [b.name, b.stadium]) assert(!swapped.some((w) => new RegExp(`\\b${escape(w)}\\b`).test(x)), `${x} holds a name the published build swaps`);
  }
  // a league cached by an older save: its stand-ins by their region labels, "FCS" and their old colors
  const old = { "fcs-plains": { slug: "fcs-plains", name: "FCS Plains", school: "FCS Plains", abbreviation: "FCS", mascot: "", fictional: true, city: null,
    colors: { primary: "#A3162D", secondary: "#E3C77A", accent: "#141414" }, stadium: { name: "FCS Plains Stadium", capacity: 13500 } } };
  const t = season.stand_in_names(old)["fcs-plains"], b = fcs_names.TEAMS["Plains"];
  equal([t["name"], t["school"], t["abbreviation"], t["mascot"], t["stadium"]], [b.name, b.name, b.abbreviation, b.mascot, { name: b.stadium, capacity: 13500 }]);
  equal(t["colors"], fcs_names.hex_colors("Plains"));
});

// ----- a save from before the rename ----------------------------------------------------------

/** Today's save text as it read before a rename: each stand-in's slug and name back to its first slug and short name
 * (`era` "first"), or its name and stadium back to its region label, "FCS Plains" and "FCS Plains Stadium" (`era` "region"). */
function old_style(text, era) {
  const back = {};
  for (const [region, [slug, names]] of Object.entries(fcs_names._OLD)) {
    const b = fcs_names.TEAMS[region];
    if (era === "first") back[fcs_names.new_slug(region)] = fcs_names._r(slug);
    back[b.name] = era === "first" ? fcs_names._r(names[1]) : fcs_names.old_label(region);
    back[b.stadium] = era === "first" ? fcs_names._r(fcs_names._OLD[region][3]) : `${fcs_names.old_label(region)} Stadium`;
  }
  const keys = Object.keys(back).sort((a, b) => b.length - a.length);
  return text.replace(new RegExp(keys.map(escape).join("|"), "g"), (m) => back[m]);
}
const fictional = (g) => (season.state_fictional(g["home"]) ? g["home"] : season.state_fictional(g["away"]) ? g["away"] : null);
const REGION_LABEL = /FCS (New England|Mid-Atlantic|Southeast|Gulf Coast|Great Lakes|Plains|Mountain West|Pacific Northwest)/;

for (const [era, said] of [["first", "from before the stand-ins were named for their regions"], ["region", 'from when the stand-ins were "FCS <Region>"']]) {
  let ST = null, LOADED = null, PLAYED = null, BLOB_OLD = null;
  test(`a save ${said} and its box scores are rewritten when the save is loaded, and nothing else about it changes`, () => {
    ST = season.new_season("smu", "full", 11, undefined, undefined, true);
    season.advance_to(ST, 2);                      // this team's FCS game is in the first two weeks
    season.save_season(ST);
    PLAYED = Object.values(ST["games"]).filter((g) => fictional(g) && g["played"]);
    assert(PLAYED.length, "no FCS game played in two weeks");
    const file = `${season.SEASONS_DIR}/${ST["id"]}.json`;
    files.write_text(file, old_style(files.read_text(file), era));
    const dir = season.box_dir(ST);
    const boxes = files.list_dir(dir).filter((n) => n.endsWith(".json")).map((n) => `${dir}/${n}`);
    for (const b of boxes) files.write_text(b, old_style(files.read_text(b), era));
    const old_text = files.read_text(file);
    assert(fcs_names.has_old(old_text), "the old-style save holds no old slug or name");
    if (era === "region") {
      const g = JSON.parse(old_text)["games"][PLAYED[0]["event_id"]];
      assert(REGION_LABEL.test(`${g["home_display"]}|${g["away_display"]}`), show([g["home_display"], g["away_display"]]));
    }
    assert(boxes.some((b) => fcs_names.has_old(files.read_text(b))));
    BLOB_OLD = new Uint8Array(zlib.gzipSync(JSON.stringify({ state: JSON.parse(old_text),
      boxes: Object.fromEntries(boxes.map((b) => [b.split("/").pop(), files.read_text(b)])) })));

    LOADED = season.load_season(ST["id"]);
    assert(!fcs_names.has_old(JSON.stringify(LOADED)), "the loaded save still holds old names");
    assert(!REGION_LABEL.test(JSON.stringify(LOADED)), "the loaded save still holds a region label");
    assert(!fcs_names.has_old(files.read_text(file)), "the save file was not rewritten");
    assert(!boxes.some((b) => fcs_names.has_old(files.read_text(b))), "a box score file was not rewritten");
    equal(JSON.parse(JSON.stringify(LOADED["games"])), JSON.parse(JSON.stringify(ST["games"])), "the schedule did not map back");
    equal(JSON.parse(JSON.stringify(LOADED["season_stats"])), JSON.parse(JSON.stringify(ST["season_stats"])), "the season stats did not map back");
    for (const g of PLAYED) {
      const side = fictional(g) === g["home"] ? "home" : "away";
      equal(LOADED["games"][g["event_id"]][`${side}_display`], fcs_names.brand(g[side]).name);
      equal(LOADED["games"][g["event_id"]][side], g[side], "a slug moved");
    }
  });

  test(`that save's box scores name the stand-in as it is named today, and the season plays on (${era})`, () => {
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

  test(`a downloaded save ${said} reads clean, and today's export holds no old name`, () => {
    const [state, boxes] = career.read_save(BLOB_OLD);
    assert(!fcs_names.has_old(JSON.stringify(state)) && !Object.values(boxes).some((t) => fcs_names.has_old(t)));
    const out = career.export_save(LOADED, true);
    assert(!fcs_names.has_old(zlib.gunzipSync(out).toString("utf8")));
  });

  test(`through the API a stand-in's side of a box score and its team card read as the team it is today (${era})`, () => {
    season.save_season(LOADED);
    const g = PLAYED[0], fslug = fictional(PLAYED[0]), b = fcs_names.brand(fslug);
    const box = api.call("GET", `/api/season/${LOADED["id"]}/game/${g["event_id"]}`);
    equal(box[box["home_slug"] === fslug ? "home" : "away"]["name"], b.name);
    const card = api.call("GET", "/api/teams")["teams"].find((c) => c["slug"] === fslug);
    equal([card["name"], card["mascot"], card["abbreviation"], card["conference"], card["fictional"]], [b.name, b.mascot, b.abbreviation, "FCS", true]);
    equal(card["colors"], fcs_names.hex_colors(season.TEAM_REGION[fslug]));
  });
}

test("rewriting leaves alone what is not a stand-in's old name: a slug, a region, the level, a longer word", () => {
  const text = JSON.stringify({ slug: "fcs-plains", region: "Plains", conference: "FCS", note: "FCS Southeastern", away_display: "FCS Plains", where: "FCS Plains Stadium" });
  equal(JSON.parse(fcs_names.rewrite_text(text)), { slug: "fcs-plains", region: "Plains", conference: "FCS", note: "FCS Southeastern",
    away_display: "Plains Thunderheads", where: "Storm Cellar Field" });
  const today = JSON.stringify({ away_display: "Plains Thunderheads", conference: "FCS" });
  equal(fcs_names.rewrite_text(today), today);
});

await run();
