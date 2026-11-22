// Class rank (career_js/prospects.js class_table): the Recruiting tab's `class_rank` (also the Office's and
// Headquarters' Class at a Glance) is your row's `rank` on the Classes tab (Headquarters' Recruiting Rankings).
// Both rank the classes as you see them: another school's Quiet Commit is left out, your own counts. Checked
// through the API on an Ohio State career, seed 9, six weeks in with Auto-recruit on. Saves go to a temporary
// folder (the harness's).
// `node tests/test_class_rank.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";

const game = await start();
const { api, season } = game;
const { persona, prospects } = game.modules;

const ME = "ohio-state";
const J = (v) => () => JSON.stringify(v);

const G = (sid, path) => api.call("GET", `/api/season/${sid}/${path}`);

test("class rank", () => {
  const sid = api.call("POST", "/api/season", { team: ME, mode: "full", seed: 9, career: true })["id"];
  api.call("POST", `/api/season/${sid}/settings`, { auto_recruit: "season" });
  const st = api.loaded_state();
  season.advance_to(st, 6);
  assert(st["current_week"] === 6, J(st["current_week"]));
  const rc = st["recruiting"];
  const quiet = Object.keys(rc["status"]).filter((pid) => persona.hidden_from(st, ME, pid));
  assert(quiet.length, "the career has other schools' Quiet Commits to leave out");
  // the two views of the same moment agree
  const view = G(sid, "recruiting");
  const classes = G(sid, "classes");
  const mine = classes["schools"].find((r) => r["school"] === ME);
  assert(mine["yours"] && view["class_rank"] === mine["rank"], J([view["class_rank"], mine["rank"]]));
  assert(prospects.class_rank(st, ME) === mine["rank"]);
  // no row counts a commit hidden from you
  const hidden_schools = new Set(quiet.map((pid) => rc["status"][pid]["committed"]));
  const seen = prospects.class_table(st, ME);
  const everyone = prospects.class_table(st);
  const comp = (pid) => rc["prospects"][pid]["composite"];
  const worth = (pid) => comp(pid) * 100 > prospects.CLASS_FLOOR;      // class_points: a commit rated at or under the floor adds nothing
  let lower = 0;
  for (const s of hidden_schools) {
    if (s in seen) {
      const theirs = quiet.filter((pid) => rc["status"][pid]["committed"] === s);
      assert(theirs.length && !seen[s]["pids"].some((pid) => quiet.includes(pid)), s);
      equal([...seen[s]["pids"], ...theirs].sort(), [...everyone[s]["pids"]].sort(), s);      // the row is the class less its hidden commits, no one else
      assert(seen[s]["points"] === prospects.class_points(seen[s]["pids"].map(comp)), s);
      // the points drop exactly when a hidden commit was worth points (one rated under the floor was worth none)
      assert((seen[s]["points"] < everyone[s]["points"]) === theirs.some(worth), s);
      assert(seen[s]["points"] <= everyone[s]["points"], s);
      lower += seen[s]["points"] < everyone[s]["points"] ? 1 : 0;
    }
  }
  assert(lower, "some school's row loses points to a commit hidden from you");
  // a school ranks its own Quiet Commits: each school's rank is its own row on its own Classes tab
  for (const s of [...hidden_schools].sort().slice(0, 3)) {
    const own = prospects.national_classes(st, s)["schools"].find((r) => r["school"] === s);
    assert(prospects.class_rank(st, s) === own["rank"] && own["count"] === everyone[s]["pids"].length, s);
  }
  console.log(`  class rank ok (#${mine["rank"]}, ${quiet.length} Quiet Commits hidden from you)`);
});

await run();
