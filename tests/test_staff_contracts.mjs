// Staff contracts (career_js/offseason.js, carousel.js, recruiting.make_staff): every member of
// your staff is signed through a year; under contract he rarely leaves, at expiry he shops and the
// stayers re-sign.
// `node tests/test_staff_contracts.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted, odict, is_odict, fmt } from "../engine_js/pyrt.js";

const game = await start();
const { season, offseason } = game;
const { carousel, prospects } = game.modules;

/** Every game played (the better team usually wins), every school's class signed, season over (tests/test_offseason). */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const h = teams[g["home"]]["team_ratings"]["overall"], a = teams[g["away"]]["team_ratings"]["overall"];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 12));
    g["played"] = true;
    g["home_score"] = win ? hs : Math.max(0, hs - rng.randint(1, 20));
    g["away_score"] = win ? hs - rng.randint(1, 20) : hs;
    if (g["home_score"] === g["away_score"]) g["home_score"] += 3;
  }
  const rc = st["recruiting"];
  const schools = Object.entries(teams).filter(([, t]) => !t["fictional"]).map(([s]) => s);
  const pids = sorted(Object.keys(rc["prospects"]), (p) => rc["prospects"][p]["rank"]);
  pids.slice(0, schools.length * 21).forEach((pid, i) => { rc["status"][pid]["signed"] = schools[i % schools.length]; });
  Object.assign(st, { done: true, current_week: season.FINAL_WEEK, champion: "ohio-state" });
}

/** copy.deepcopy of a season's state (a dict that keeps its keys' order, an odict, stays one). */
function deepcopy(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(deepcopy);
  if (v instanceof Set) return new Set([...v].map(deepcopy));
  const out = is_odict(v) ? odict() : {};
  for (const k of Object.keys(v)) out[k] = deepcopy(v[k]);
  return out;
}

// tests/test_coach_market's
function to_stage(st, stage) {
  st["offseason"]["auto"] = true;
  while (st["offseason"]["stage"] !== stage) offseason.advance(st);
}

/** Over n seeded offseasons: how often a recruiter signed through `until` leaves, and the
 *  Staff-step records (for the re-sign checks). The carousel's wants are `poached`. */
function leave_rate(st, until, n = 200, poached = []) {
  let gone = 0;
  const outs = [];
  const base = deepcopy(st["career"]["staff"]);
  for (let i = 0; i < n; i++) {
    st["seed"] = 1000 + i;
    st["career"]["staff"] = deepcopy(base);
    for (const s of st["career"]["staff"]) s["contract_until"] = until;
    const out = offseason._staff_changes(st, [...poached], {});
    outs.push(out);
    gone += st["career"]["staff"].filter((s) => s["role"] === "Recruiter" && out["leaving"].includes(s["id"])).length;
  }
  return [gone / (3 * n), outs];
}

const J = (v) => () => JSON.stringify(v);

test("staff contracts", () => {
  // make_staff: everyone signed through a year 1-3 seasons out from the first season
  let st = season.new_season("ohio-state", "full", 7, undefined, undefined, true);
  const staff = st["career"]["staff"];
  assert(staff.every((s) => 2026 <= s["contract_until"] && s["contract_until"] <= 2028), J(staff.map((s) => [s["role"], s["contract_until"]])));
  // the constants: under contract a third of today's leaving, shopping twice it
  assert(offseason.UNDER_CONTRACT < 0.5 && 0.5 < offseason.SHOPPING && offseason.RECRUITER_LEAVE * offseason.UNDER_CONTRACT < 0.06);
  // a finished season into the Staff step
  st = season.new_season("ohio-state", "full", 5, undefined, undefined, true);
  finished(st);
  offseason.start(st);
  to_stage(st, "staff");
  let off = st["offseason"];
  const year = off["year"];
  // candidates say how long they want; hire signs the candidate for that long from the coming season
  let cands = off["staff"]["candidates"];
  if (!off["staff"]["leaving"].length) {
    Object.assign(off["staff"], offseason.open_role(st, "r1"));
    cands = off["staff"]["candidates"];
  }
  const sid = off["staff"]["leaving"][0];
  for (const c of cands[sid]) {
    const [lo, hi] = ["OC", "DC"].includes(c["role"]) ? [2, 4] : [1, 3];
    assert(lo <= c["years"] && c["years"] <= hi, J([c["role"], c["years"]]));
  }
  offseason.hire(st, sid, 1);
  const snap = deepcopy(st);
  offseason.advance(st);
  const hired = st["career"]["staff"].find((s) => s["id"] === sid);
  assert(hired["contract_until"] === year + cands[sid][1]["years"] - 1, J([hired, cands[sid][1]]));
  st = snap;
  off = st["offseason"];
  // recruiters: under contract about a third of the expiring rate (0.35 vs 2.0 of RECRUITER_LEAVE)
  const [held] = leave_rate(st, year);            // signed through the coming season
  let [shop, outs] = leave_rate(st, year - 1);     // the contract ran out
  assert(0.02 <= held && held <= 0.08 && 0.17 <= shop && shop <= 0.31, J([held, shop]));
  const ratio = held / shop;                       // the constants put it at 0.175 (0.35 / 2.0): well under half
  assert(0.1 <= ratio && ratio <= 0.3, J([held, shop, ratio]));
  // whoever stays at expiry re-signs 1-3 years (recruiters) or 2-4 (coordinators) and the step says so
  for (const out of outs) {
    for (const r of out["renewed"]) {
      const [lo, hi] = ["OC", "DC"].includes(r["role"]) ? [2, 4] : [1, 3];
      assert(year + lo - 1 <= r["through"] && r["through"] <= year + hi - 1 && !out["leaving"].includes(r["id"]), J(r));
    }
  }
  for (const r of outs[outs.length - 1]["renewed"]) {             // the staff holds the last run's state
    assert(st["career"]["staff"].find((s) => s["id"] === r["id"])["contract_until"] === r["through"]);
  }
  assert(st["career"]["staff"].filter((s) => !outs[outs.length - 1]["leaving"].includes(s["id"])).every((s) => s["contract_until"] >= year));
  assert(outs.some((out) => out["renewed"].length));
  // an expiring coordinator the carousel wanted always leaves; one it did not want shops at COORD_SHOP
  [, outs] = leave_rate(st, year - 1, 100, ["offensive_coordinator"]);
  assert(outs.every((out) => out["leaving"].includes("oc")));
  const dc_shop = outs.filter((out) => out["leaving"].includes("dc")).length / outs.length;
  assert(0.12 <= dc_shop && dc_shop <= 0.4, J(dc_shop));
  assert(outs.filter((out) => out["leaving"].includes("dc")).every((out) => out["reasons"]["dc"] === "took a coordinator job elsewhere"));
  // a coordinator under contract turns a head coaching job down about two thirds of the time
  for (const s of st["career"]["staff"]) s["contract_until"] = year + 1;
  let went = 0;
  for (let i = 0; i < 200; i++) if (!carousel.contract_holds({ ...st, seed: 2000 + i }, "offensive_coordinator", year)) went++;
  assert(0.2 <= went / 200 && went / 200 <= 0.5, J(went / 200));
  for (const s of st["career"]["staff"]) s["contract_until"] = year - 1;
  for (let i = 0; i < 50; i++) assert(!carousel.contract_holds({ ...st, seed: 2000 + i }, "offensive_coordinator", year));
  // the Staff step view: the contract on every member, expiring flagged, renewals and the candidates' asks
  st["career"]["staff"] = deepcopy(snap["career"]["staff"]);
  for (const s of st["career"]["staff"]) s["contract_until"] = year + 1;
  st["career"]["staff"][1]["contract_until"] = year - 1;
  off["staff"] = offseason._staff_changes(st, [], {});
  const v = offseason.view(st);
  const rows = Object.fromEntries(v["your_staff"].map((r) => [r["id"], r]));
  assert(Object.values(rows).every((r) => "contract_until" in r));
  equal(v["staff"]["renewed"], off["staff"]["renewed"]);
  assert("expiring" in v["staff"] && "contract" in v["staff"]);
  // the DC's contract was up: he left shopping (still expiring) or re-signed (a new term, no longer expiring)
  if (off["staff"]["leaving"].includes("dc")) {
    assert(v["staff"]["contract"]["dc"]["expiring"] && v["staff"]["expiring"].includes("dc"));
  } else {
    assert(v["staff"]["renewed"].some((r) => r["id"] === "dc") && v["staff"]["contract"]["dc"]["until"] >= year + 1);
  }
  assert(!v["staff"]["contract"]["oc"]["expiring"] && v["staff"]["contract"]["oc"]["until"] === year + 1);
  if (off["staff"]["leaving"].length) {
    assert(off["staff"]["candidates"][off["staff"]["leaving"][0]].every((c) => "years" in c));
  }
  // the Scouting tab's scout rows carry the through year
  const sv = prospects.scouting_view(snap);
  assert(sv["scouts"].every((m) => m["contract_until"]), J(sv["scouts"][0]));
  // an old save without contracts: the Staff step runs, every member ends with a contract
  for (const s of st["career"]["staff"]) delete s["contract_until"];
  const out = offseason._staff_changes(st, [], {});
  assert(st["career"]["staff"].filter((s) => !out["leaving"].includes(s["id"])).every((s) => s["contract_until"]));
  assert(!carousel.contract_holds(st, "offensive_coordinator", year));
  season.close_pool();
  console.log(`staff contracts ok: recruiters leave ${fmt(held, 2)} under contract vs ${fmt(shop, 2)} shopping (ratio ${fmt(ratio, 2)}); `
    + `a coordinator under contract takes a head job ${fmt(went / 200, 2)} of the time; expiring DC shops ${fmt(dc_shop, 2)}`);
});

await run();
