// The rosters the game reads are static files in the repository (the player's rule): data/engine_teams.json and
// data/player_potential.json, committed, never made again when the game runs. This holds them to their sources:
// the builder (teamdata_js/build_teams.js) run now, into a scratch folder, writes the same two files byte for byte.
// When it fails, a roster in cfb_sim_data/, the builder or a data file it reads has changed since they were made:
//     node tools/game_host.mjs . teams
// and commit the two files. The dev server and a build with the real names read them as they are (tools/build_site.mjs
// ROSTERS), and git must not ignore them.
// `node tests/test_static_rosters.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test, run, assert, equal } from "./harness.mjs";
import * as build from "../tools/build_site.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = (file) => crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");
const git = (...args) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });

test("the rosters are the two files the builder writes, and both are among the data the game is packed with", () => {
  equal(build.ROSTERS, ["data/engine_teams.json", "data/player_potential.json"]);
  assert(build.ROSTERS.every((f) => build.GENERATED.includes(f) && build.DATA_FILES.includes(f)));
  for (const f of build.ROSTERS) assert(fs.existsSync(path.join(ROOT, f)), `${f} is missing`);
});

test("git keeps them: neither is ignored, and both are tracked", () => {
  for (const f of build.ROSTERS) {
    equal(git("check-ignore", "-q", f).status, 1, `${f} is ignored by git`);
    equal(git("ls-files", "--error-unmatch", f).status, 0, `${f} is not committed`);
  }
});

test("made again from their sources, they come out the same byte for byte", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cfp-rosters-"));
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, "tools", "game_host.mjs"), ROOT, "teams", scratch], { cwd: ROOT, encoding: "utf8" });
    assert(r.status === 0, `the builder failed: ${r.stderr}`);
    for (const f of build.ROSTERS) {
      const made = path.join(scratch, f);
      assert(fs.existsSync(made), `the builder did not write ${f} to the scratch folder`);
      assert(sha(made) === sha(path.join(ROOT, f)),
        `${f} is behind its sources: run \`node tools/game_host.mjs . teams\` and commit it`);
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

await run();
