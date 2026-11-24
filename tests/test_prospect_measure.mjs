// Ranking the Prospects table by one scouted rating (career_js/prospects.js search's `measure`, career_js/clear.js
// measures and measure; GET /api/season/{id}/prospects?measure=top_speed&sort=measure): the menu offers the physical
// traits always and one position's own ratings once the list is one position; each row carries your staff's read of
// the rating (a best guess inside a range) or nothing before a look; the sort puts the best guess first (or last, the
// other way) and the prospects you have not scouted at the foot either way; and the class line counts your board
// against its cap, with In Contact counted on your board alone.
// `node tests/test_prospect_measure.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";

const game = await start();
const { api, recruiting } = game;
const clear = game.modules.clear;
const sid = api.call("POST", "/api/season", { team: "ohio-state", mode: "full", seed: 3, career: true })["id"];
const G = (p) => api.call("GET", `/api/season/${sid}/${p}`);
const show = (v) => JSON.stringify(v);

test("the menu offers the physical traits, and a position's own ratings once the list is one position", () => {
  const all = G("prospects?limit=3")["measures"];
  equal(all.map((x) => x["key"]), clear.PHYSICAL);
  assert(all.every((x) => x["physical"] === true && x["label"]), show(all));
  const rb = G("prospects?group=RB&limit=3")["measures"];
  equal(rb.filter((x) => x["physical"]).map((x) => x["key"]), clear.PHYSICAL);
  const own = rb.filter((x) => !x["physical"]);
  assert(own.length === clear.KEY_SKILLS && own.every((x) => !clear.PHYSICAL.includes(x["key"])), show(own));
  assert(rb.indexOf(own[0]) === 0, "his position's own first");
  assert(G("prospects?limit=3")["rows"].every((r) => !("measure" in r)), "no measure asked for, none sent");
});

test("ranked by a rating: the best guess first, the unscouted at the foot either way, each read a range", () => {
  const st = api.loaded_state(), rc = st["recruiting"];
  const rbs = G("prospects?group=RB&limit=40")["rows"];
  rc["reads"] = {};
  for (const r of rbs.slice(0, 12)) { try { api.call("POST", `/api/season/${sid}/recruit`, { pid: r["id"], action: "scout" }); } catch { /* out of energy */ } }
  const scouted = Object.keys(rc["reads"]).length;
  assert(scouted >= 5, String(scouted));
  const down = G("prospects?group=RB&limit=60&measure=top_speed&sort=measure")["rows"];
  const known = down.filter((r) => r["measure"]);
  equal(known.length, scouted);
  assert(down.slice(0, scouted).every((r) => r["measure"]) && down.slice(scouted).every((r) => r["measure"] === null), "the unscouted are last");
  assert(known.every((r, i) => i === 0 || known[i - 1]["measure"]["est"] >= r["measure"]["est"]), show(known.map((r) => r["measure"]["est"])));
  for (const r of known) {
    const x = r["measure"];
    assert(x["key"] === "top_speed" && x["label"] && x["lo"] <= x["est"] && x["est"] <= x["hi"] && x["lo"] < x["hi"], show(x));
    equal(clear.measure(st, r["id"], "top_speed")["est"], x["est"]);
  }
  const up = G("prospects?group=RB&limit=60&measure=top_speed&sort=-measure")["rows"];
  equal(up.slice(0, scouted).map((r) => r["measure"]["est"]), known.map((r) => r["measure"]["est"]).reverse());
  assert(up.slice(scouted).every((r) => r["measure"] === null), "the unscouted are last the other way too");
  // a rating his position is not read on is no read
  assert(clear.measure(st, known[0]["id"], "kick_power") === null);
});

test("the class line counts your board against its cap, and In Contact is counted on your board alone", () => {
  const st = api.loaded_state(), rc = st["recruiting"];
  const rows = G("prospects?limit=6")["rows"].filter((r) => !r["blocked"]);
  const [on, off] = [rows[0]["id"], rows[1]["id"]];
  rc["board"] = [on];
  for (const pid of [on, off]) { rc["contacts"][pid] = rc["contacts"][pid] || {}; rc["contacts"][pid]["ohio-state"] = { n: 1, week: {} }; }
  const f = G("prospects?limit=1")["summary"]["footprint"];
  equal([f["board"], f["cap"], f["contact"]], [1, recruiting.BOARD_CAP, 1]);
});

test("sorted by Status, the prospects who have shut you out come last: Cut You, then Closed, as the column says them", () => {
  const order = game.modules.prospects.STATUS_ORDER;
  assert(order["cold"] < order["finalists"] && order["finalists"] < order["locked"], show(order));
  const place = (r) => (r["signed"] ? order["signed"] : r["committed"] ? (r["hard"] ? order["hard"] : order["committed"])
    : r["blocked"] && r["blocked"]["why"] in order ? order[r["blocked"]["why"]] : r["leaning_fcs"] ? order["leaning_fcs"] : order[r["stage"]]);
  const rows = G("prospects?limit=5000&sort=status")["rows"];
  const shut = rows.filter((r) => r["blocked"] && !r["signed"] && !r["committed"]);
  assert(shut.length > 0, "nobody has shut you out");
  const places = rows.map(place);
  assert(places.every((v, i) => i === 0 || places[i - 1] <= v), "the list is not in the column's order");
  assert(rows.slice(-shut.length).every((r) => r["blocked"]), "the shut-out are the list's foot");
  const back = G("prospects?limit=5000&sort=-status")["rows"];
  assert(back.slice(0, shut.length).every((r) => r["blocked"]), "and its head the other way");
});

await run();
