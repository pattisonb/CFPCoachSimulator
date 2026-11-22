// The published site carries no real names (tools/build_site.mjs --generic, tools/generic): a staged copy of the
// game and the app's source with the names swapped holds none of the real schools that change (one named for its
// state or city goes by that place), mascots, stadiums,
// bowls, conferences, awards, players or coaches; every real team has a lookalike; the swap is the same every time;
// and a career at a renamed school starts and plays a week on the swapped data. The repository itself is untouched.
// `node tests/test_generic_names.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import * as build_site from "../tools/build_site.mjs";
import { check } from "../tools/generic/check.mjs";
import { scrub } from "../tools/generic/scrub.mjs";
import { tables } from "../tools/generic/tables.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// what the swapped game says: a career at the team given, one week played, and the team picker's list
const PLAY = `
import { host } from ${JSON.stringify(path.join(ROOT, "tools", "game_host.mjs"))};
const [root, team, seasons] = process.argv.slice(2);
const { api } = await host(root, { env: { CFP_SEASONS_DIR: seasons, SIM_WORKERS: "1" } });
const s = api.call("POST", "/api/season", { team, seed: 11 });
api.call("POST", \`/api/season/\${s.id}/advance\`, { to: 1 });
while (api.running()) api.step(null);
const teams = api.call("GET", "/api/teams");
console.log(JSON.stringify({ season: s, week: api.call("GET", \`/api/season/\${s.id}/week/1\`), teams }));
`;

function assert(ok, message) {
  if (!ok) throw new Error(typeof message === "function" ? message() : String(message ?? "assertion failed"));
}

function initial(word) {
  for (const ch of word) if (/\p{L}/u.test(ch)) return ch.toUpperCase();
  return "A";
}

const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** The first dozen names of each kind found, for a failure's message. */
const some = (found) => JSON.stringify(Object.fromEntries(Object.entries(found).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).slice(0, 12))])));

async function main() {
  const before = fs.statSync(path.join(ROOT, "cfb_sim_data", "teams", "notre-dame.json")).mtimeMs;
  const terms = scrub.terms(ROOT);
  assert(terms.people.size > 10000 && terms.phrases.size > 500, () => JSON.stringify(Object.fromEntries(Object.entries(terms).map(([k, v]) => [k, v.size]))));

  // the tables: every lookalike differs from the real name, and no two schools share one
  const maps = new scrub.Maps(ROOT);
  for (const [slug, t] of Object.entries(maps.real_teams)) {
    const made = maps.team[slug];
    assert(made.mascot !== t["mascot"], `${slug} keeps its real mascot`);
    assert(made.slug !== slug, `${slug} keeps its real slug`);
    assert(made.school !== t["school_name"], `${slug} keeps its real full name`);
    if (tables.PLACES.has(slug)) {                 // named for its state or city: it goes by the place
      assert(made.short === t["short_name"], `${slug} is listed as a place but does not go by it`);
    } else {
      assert(made.short !== t["short_name"], `${slug} keeps its real name`);
      assert(made.abbr !== t["abbreviation"], `${slug} keeps its real abbreviation`);
    }
    assert(made.stadium !== t["stadium"]["name"], `${slug} keeps its real stadium`);
  }
  for (const field of ["short", "abbr", "slug"]) {
    const values = Object.values(maps.team).map((v) => v[field]);
    assert(new Set(values).size === values.length, `two schools share a lookalike ${field}`);
  }
  for (const [slug, made] of Object.entries(maps.team)) {
    const others = new Set(Object.entries(maps.real_teams).filter(([s]) => s !== slug).flatMap(([, t]) => [t["short_name"], t["abbreviation"]]));
    assert(!others.has(made.short) && !others.has(made.abbr), `${slug}'s lookalike is another school's real name`);
  }
  assert(same(Object.keys(tables.SLUGS).sort(), [...tables.PLACES].sort()), "every place-named school keeps the slug it had");
  for (const [real, made] of Object.entries(maps.person)) {
    const [first_real, last_real] = scrub.Names._parts(real);
    const words = made.split(/\s+/).filter(Boolean);
    assert(made !== real && initial(words[0]) === initial(first_real), () => JSON.stringify([real, made]));
    assert(!last_real || initial(words[1]) === initial(last_real), () => JSON.stringify([real, made]));      // "Van Dyke" is a V
  }
  assert(same(new scrub.Maps(ROOT).person, maps.person), "the drawn names changed between two runs");
  assert(Object.keys(tables.TEAMS).every((s) => s in maps.real_teams), "tables.TEAMS names a school the league does not have");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cfp-generic-"));
  try {
    const root = await build_site.stage(tmp, true);
    const files = build_site.game_files((f) => fs.readFileSync(path.join(root, f), "utf8"), (dir) => fs.readdirSync(path.join(root, dir)));
    let found = check.leaks(root, terms, files);
    assert(!Object.keys(found).length, () => "real names in the generic build: " + some(found));
    assert(!fs.existsSync(path.join(root, "cfb_sim_data", "teams", "notre-dame.json")));
    const team = json(path.join(root, "cfb_sim_data", "teams", "north-dome.json"));
    assert(team["short_name"] === "North Dome" && team["abbreviation"] === "NDM", team["short_name"]);
    const real = json(path.join(ROOT, "cfb_sim_data", "teams", "notre-dame.json"));
    assert(team["colors"]["primary"]["hex"] !== real["colors"]["primary"]["hex"]);          // a protected shade: moved a hair
    assert(Math.abs(parseInt(team["colors"]["primary"]["hex"].slice(1, 3), 16) - parseInt(real["colors"]["primary"]["hex"].slice(1, 3), 16)) <= tables.COLOR_NUDGE);
    const kept = json(path.join(root, "cfb_sim_data", "teams", "iowa-city.json"));     // its old slug
    assert(kept["short_name"] === "Iowa" && kept["state"] === "IA" && kept["mascot"] === "Kernels", kept["short_name"]);
    assert(kept["school_name"] === "Iowa University" && kept["abbreviation"] === "IOWA");
    const states = fs.readFileSync(path.join(root, "ui", "src", "states.ts"), "utf8");      // the app's list of states
    assert(states.includes('TX: "Texas"') && states.includes('MT: "Montana"') && states.includes('RI: "Rhode Island"'), "a state lost its name to a school's swap");
    assert(!fs.readFileSync(path.join(root, "sim_js", "season", "part1.js"), "utf8").includes('"Montana": "MT"'), "an FCS school kept its state's name");
    assert(same(kept["colors"], json(path.join(ROOT, "cfb_sim_data", "teams", "iowa.json"))["colors"]));
    assert(team["roster"].length === real["roster"].length);
    assert(same(team["roster"].map((p) => p["overall"]), real["roster"].map((p) => p["overall"])));   // only the names change

    // the swapped game plays: a career at a renamed school, one week
    const play = path.join(tmp, "play.mjs");
    fs.writeFileSync(play, PLAY);
    const r = spawnSync(process.execPath, [play, root, "north-dome", path.join(tmp, "seasons")], { cwd: root, encoding: "utf8", maxBuffer: 1 << 30 });
    assert(r.status === 0, () => String(r.stderr || r.error).slice(-2000));
    const out = JSON.parse(r.stdout.trim().split("\n").pop());
    assert(out["season"]["team_name"] === "North Dome", () => JSON.stringify(out["season"]));
    const said = path.join(tmp, "said");
    fs.mkdirSync(said);
    fs.writeFileSync(path.join(said, "said.html"), r.stdout);      // (a suffix check.mjs reads whole, comments and all)
    found = check.leaks(said, { ...terms, people: new Set() }, ["said.html"]);     // people: a drawn recruit may share a common real name
    assert(!Object.keys(found).length, () => "real names in what the game says: " + some(found));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  assert(fs.statSync(path.join(ROOT, "cfb_sim_data", "teams", "notre-dame.json")).mtimeMs === before, "the repository's data was touched");
  console.log("test_generic_names: ok");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
