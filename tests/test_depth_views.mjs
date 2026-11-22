// Depth chart views: each row says how many players start there, the personnel view rates
// everyone at a role with that role's attribute columns, a role can be put in a new order (Auto
// reorder) only with the players it already holds, and the formations are filled exactly as the
// engine fills them from the chart (an injured starter left out).
// `node tests/test_depth_views.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { personnel } from "../engine_js/personnel.js";

const game = await start();
const { season, coaches, engine } = game;

/** set_depth_order must refuse this with a ValueError; anything else fails with `what`. */
function refused(fn, what) {
  try {
    fn();
  } catch (e) {
    if (e instanceof coaches.ValueError) return;
    throw e;
  }
  throw new Error(what);
}

test("depth views", () => {
  const st = season.new_season("ohio-state", "full", 3);
  const chart = season.depth_chart_view(st, "ohio-state");
  const by_role = (view) => Object.fromEntries(view["units"].flatMap((u) => u["rows"].map((r) => [r["role"], r])));
  const rows = by_role(chart);
  for (const [role, row] of Object.entries(rows)) {
    assert(row["starters"] === row["players"].filter((p) => p["starter"]).length || role === "KR" || role === "PR", () => JSON.stringify([role, row["starters"]]));
  }
  assert(rows["WR"]["starters"] >= 2 && rows["QB"]["starters"] === 1 && rows["KR"]["starters"] === 1);
  // the returner list: one scale for everyone (a linebacker's own scale read any return rating as 99),
  // the league's designated returners at its 50 mark, and no linemen, quarterbacks or kickers
  const kr = season.position_candidates(st, "ohio-state", "KR")["players"];
  assert(!kr.some((r) => ["OL", "DL", "QB", "K", "P"].includes(r["position"])), () => JSON.stringify(kr.map((r) => r["position"])));
  const best = kr.reduce((a, r) => (r["rating"] > a["rating"] ? r : a));      // the first of equals, as Python's max
  assert(["WR", "CB", "RB", "S", "TE"].includes(best["position"]), () => JSON.stringify(best));
  for (const r of kr) {
    if (["MLB", "ROLB", "LOLB"].includes(r["position"])) assert(r["rating"] <= best["rating"], () => JSON.stringify([r, best]));
  }
  const scale = season._house_scale()["KR|return_rating"];      // (the Python's key is the pair ("KR", "return_rating"))
  assert(40 <= scale[0] && scale[0] <= 70, () => JSON.stringify(scale));     // a typical designated returner, in engine units, is the 50 mark

  const wr = season.position_candidates(st, "ohio-state", "WR");
  assert(wr["starters"] === rows["WR"]["starters"]);
  equal(wr["columns"].map((c) => c["key"]), season.DEPTH_COLUMNS["WR"]);
  assert(wr["columns"].every((c) => c["short"] && c["label"]));
  const smith = wr["players"].find((p) => p["in_role"]);
  assert(season.DEPTH_COLUMNS["WR"].every((k) => Number.isInteger(smith["attrs"][k])), () => JSON.stringify(smith["attrs"]));

  // a new order: the same players only
  const order = [...wr["current"]].reverse();
  season.set_depth_order(st, "ohio-state", "WR", order);
  equal(season.depth_order(st, "ohio-state", "WR"), order);
  for (const bad of [order.slice(0, -1), [...order, "nobody"], [...order.slice(0, -1), order[0]]]) {
    refused(() => season.set_depth_order(st, "ohio-state", "WR", bad), `accepted a bad order: ${JSON.stringify(bad)}`);
  }
  refused(() => season.set_depth_order(st, "ohio-state", "KR", wr["current"].slice(0, 1)), "accepted an order for the returner");
  const after = by_role(season.depth_chart_view(st, "ohio-state"));
  assert(after["WR"]["players"][0]["slug"] === order[0] && after["WR"]["starters"] === rows["WR"]["starters"]);
  // formations: the scheme's three most-used groupings, each filled as the engine fills it from the chart
  const forms = season.formations_view(st, "ohio-state");
  const off = forms["offense"]["formations"];
  const mix = personnel.SCHEME_MIX[forms["offense"]["scheme"]] ?? personnel.DEFAULT_MIX;
  // (a mix's names in Python's order are in MIX_NAMES: an object lists number-like keys in numeric order; sort is stable)
  equal(off.map((f) => f["id"]), [...personnel.MIX_NAMES.get(mix)].sort((a, b) => mix[b] - mix[a]).slice(0, 3));
  const lined_up = Object.fromEntries(engine.formations(season._preview_team(st, "ohio-state"))["offense"].map((f) => [f["id"], f["lineup"]]));
  for (const f of off) {
    const want = new Set(lined_up[f["id"]].filter((p) => p["position"] !== "K" && p["position"] !== "P").map((p) => p["slug"]));
    const got = new Set(f["slots"].filter((s) => s["player"]).map((s) => s["player"]["slug"]));
    equal(got, want, f["id"]);
    assert(f["slots"].length === 11, f["id"]);
  }
  assert(off[0]["slots"].find((s) => s["slot"] === "WR1")["player"]["slug"] === order[0]);   // the new WR order is on the field
  const dfn = forms["defense"]["formations"];
  assert(2 <= dfn.length && dfn.length <= 3 && dfn.every((f) => f["slots"].length === 11));
  assert(new Set(dfn.map((f) => f["personnel"])).size === dfn.length, "each package a different shape");
  const labels = dfn[0]["slots"].map((s) => s["label"]);
  assert(labels.length === new Set(labels).size, () => JSON.stringify(labels));                                           // DT1 and DT2, not DT twice
  const st_forms = Object.fromEntries(forms["special"]["formations"].map((f) => [f["id"], f]));
  equal(st_forms["return"]["slots"].map((s) => s["slot"]), ["KR", "PR"]);
  assert(st_forms["fg"]["slots"][0]["player"]["position"] === "K");
  // an injured starter is left out of the formation, his backup takes the spot
  const qb = off[0]["slots"].find((s) => s["slot"] === "QB")["player"];
  st["injuries"] ??= {};
  st["injuries"]["ohio-state"] ??= {};
  st["injuries"]["ohio-state"][`${qb["name"]}|${qb["position"]}`] = { name: qb["name"], position: qb["position"], type: "Ankle", weeks_left: 2 };
  const qb2 = season.formations_view(st, "ohio-state")["offense"]["formations"][0]["slots"].find((s) => s["slot"] === "QB")["player"];
  assert(qb2["slug"] !== qb["slug"], "the injured quarterback still starts");
  const roster = season.depth_roster_view(st, "ohio-state")["players"];
  assert(roster.length === chart["roster_size"] && roster.find((p) => p["slug"] === qb["slug"])["injury"]["weeks_left"] === 2);
  delete st["injuries"]["ohio-state"][`${qb["name"]}|${qb["position"]}`];
  season.advance_to(st, 2);    // the season still sims with the new order
  console.log("depth views ok:", JSON.stringify(Object.fromEntries(["WR", "DT", "CB", "MIKE", "WILL"].filter((r) => r in rows).map((r) => [r, rows[r]["starters"]]))),
    "| formations", JSON.stringify(off.map((f) => f["id"])), JSON.stringify(dfn.map((f) => f["personnel"])));
});

await run();
