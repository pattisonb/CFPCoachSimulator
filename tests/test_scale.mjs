// The one rating scale: on every card, the middle Power 4 starter at a position reads 50, for
// the overall and for each attribute (the starters being today's, after the real depth charts).
// `node tests/test_scale.mjs`
import { start, test, run, assert } from "./harness.mjs";
import { median } from "../engine_js/pystat.js";
import { get } from "../engine_js/pyrt.js";

const game = await start();
const { season } = game;

test("scale", () => {
  const overall = {}, attrs = new Map();           // attrs: "group\tattribute" -> values (Python's (g, k) tuple key)
  for (const [slug, t] of Object.entries(season.load_teams())) {
    if (get(t, "fictional") || !season._is_p4(slug, t)) continue;
    for (const q of [...t["offense"], ...t["defense"]]) {
      if (!get(q, "in_game")) continue;
      const g = get(season.SCALE_GROUP, q["position"], q["position"]);
      (overall[g] ??= []).push(season.shown_overall(q));
      for (const [k, v] of Object.entries(get(q, "attributes") || {})) {
        const key = `${g}\t${k}`;
        if (!attrs.has(key)) attrs.set(key, []);
        attrs.get(key).push(v);
      }
    }
  }
  let off = Object.fromEntries(Object.entries(overall).map(([g, v]) => [g, median(v)]).filter(([, m]) => Math.abs(m - 50) > 1));
  assert(!Object.keys(off).length, () => `the middle Power 4 starter's overall is not 50: ${JSON.stringify(off)}`);
  off = Object.fromEntries([...attrs].filter(([, v]) => v.length >= 20 && Math.abs(median(v) - 50) > 1.5).map(([key, v]) => [key.replace("\t", " "), median(v)]));
  assert(!Object.keys(off).length, () => `the middle Power 4 starter's attribute is not 50: ${JSON.stringify(off)}`);
  console.log(`scale ok: ${Object.keys(overall).length} positions, ${[...attrs.values()].filter((v) => v.length >= 20).length} attributes centered on 50`);
});

await run();
