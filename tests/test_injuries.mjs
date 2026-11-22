// Sim a few weeks and print the injury list, personnel usage and line rotation.
// `node tests/test_injuries.mjs [weeks]`
import { start, test, run } from "./harness.mjs";
import { cmp, fmt, get } from "../engine_js/pyrt.js";

const game = await start();
const { season } = game;

const pad = (s, n) => String(s).padEnd(n);                       // Python's f"{s:<n}"
// Python's repr of a small value, as print() shows a list or tuple of them
function repr(v) {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "string") return v.includes("'") && !v.includes('"') ? `"${v}"` : `'${v.replace(/'/g, "\\'")}'`;
  if (Array.isArray(v)) return `[${v.map(repr).join(", ")}]`;
  if (typeof v === "object") return `{${Object.entries(v).map(([k, x]) => `${repr(k)}: ${repr(x)}`).join(", ")}}`;
  return String(v);
}
const tuple = (xs) => `(${xs.map(repr).join(", ")})`;

test("injuries", () => {
  const weeks = process.argv.length > 2 ? parseInt(process.argv[2], 10) : 4;
  const t0 = performance.now();
  const st = season.new_season("ohio-state", "full", 7);
  season.advance_to(st, weeks);
  console.log(`${weeks} weeks in ${fmt((performance.now() - t0) / 1000, 1)}s`);
  const rep = season.injury_report(st);
  console.log(`league injuries now: ${rep.length} players out on ${Object.keys(st["injuries"]).length} teams`);
  for (const i of rep.slice(0, 8)) {
    console.log(`  ${pad(i["team_name"], 16)} ${pad(i["name"], 22)} ${pad(i["position"], 4)} ${pad(i["type"], 18)} ${i["weeks_left"]} wks left (of ${i["weeks"]}), since wk ${i["since_week"]}`);
  }
  const mine = season.injury_report(st, "ohio-state");
  console.log("my team:", `[${mine.map((i) => tuple([i["name"], i["position"], i["weeks_left"]])).join(", ")}]`);
  const ss = st["season_stats"]["ohio-state"];
  console.log("personnel:", repr(get(ss, "personnel")), repr(get(ss, "schemes")));
  const ol = Object.values(ss["players"]).filter((p) => ["OL", "TE", "DL"].includes(p["position"]))
    .map((p) => [p["name"], p["position"], get(p["stats"], "snaps", 0), get(p["stats"], "games_started", 0)])
    .sort((a, b) => cmp([a[1], -a[2]], [b[1], -b[2]]));
  for (const row of ol) console.log("  ", tuple(row));
  const tm = st["season_stats"]["texas-tech"];
  console.log("texas tech:", repr(get(tm, "schemes")), repr(get(tm, "personnel")));
});

await run();
