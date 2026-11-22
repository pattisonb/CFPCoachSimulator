// Scouting (career_js/recruiting/part5.js, career_js/prospects.js): your staff and their areas, reads that narrow
// with looks but can be wrong, looks counted in trip units (a full report is three looks and never more: a Send adds
// one, an area scout's week half a look up to two from his area), scouting points (a Send spends points, not hours;
// what you leave unspent your staff spends on your board), and the badges that wait for a complete report (a gem, a
// bust risk, your staff's own comp).
// `node tests/test_scouting.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, get } from "../engine_js/pyrt.js";

const game = await start();
const { season, recruiting } = game;
const { prospects } = game.modules;

const ME = "ohio-state";
const J = (v) => () => JSON.stringify(v);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const clone = (v) => JSON.parse(JSON.stringify(v));
const REPORT = recruiting.REPORT_LOOKS;

function refused(fn, code, words = "") {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof recruiting.RecruitingError)) throw e;
    assert(e.code === code && e.message.includes(words), `${e.code} ${e.message}`);
    return e;
  }
  throw new Error(`not refused (${code} ${words})`);
}

const COACH = { id: "c1", first_name: "Pat", last_name: "Test", ratings: { recruiting: 50, evaluation: 60, offense: 70, defense: 70 } };
const base = season.new_season(ME, "full", 7, undefined, clone(COACH), true);
const fresh = () => clone(base);
const area_of = (st, pid) => {
  const home = st["recruiting"]["prospects"][pid]["hometown"]["state"];
  return Object.keys(recruiting.AREAS).find((a) => recruiting.AREAS[a].includes(home)) ?? null;
};
const live = (rc, pid) => !rc["status"][pid]["signed"] && rc["status"][pid]["committed"] !== ME;
const looks_of = (st, pid) => get(get(st["recruiting"]["reads"], pid) || {}, "looks", 0) || 0;
function send(st, pid) {
  st["recruiting"]["hours"][ME] = 100;
  st["recruiting"]["scout_points"] = { [ME]: 100 };
  return recruiting.act(st, ME, pid, "scout");
}
const full_read = (mean_, looks = REPORT) => ({ looks, by: { 95: looks }, g: Object.fromEntries(recruiting.GROUPS.map((g) => [g, [mean_, 100.0]])) });

// ----- the staff ----------------------------------------------------------------------------------------------------------

test("your staff is two coordinators and three recruiters, each in an area of his own", () => {
  const staff = base["career"]["staff"];
  equal(staff.map((s) => s["role"]), ["OC", "DC", "Recruiter", "Recruiter", "Recruiter"]);
  assert(staff.every((s) => s["area"] in recruiting.AREAS) && new Set(staff.map((s) => s["area"])).size === 5);
  assert(staff.every((s) => s["evaluation"] >= 40 && s["evaluation"] <= 99));
});

test("moving a scout to another area keeps the looks his old area earned; an unknown area is refused", () => {
  const st = fresh(), rc = st["recruiting"], staff = st["career"]["staff"];
  rc["reads"] = {};
  const tx = Object.keys(rc["prospects"]).find((q) => rc["prospects"][q]["hometown"]["state"] === "TX");
  if (!staff.some((s) => s["area"] === "Texas")) recruiting.assign(st, staff.find((s) => s["role"] === "Recruiter")["id"], "Texas");
  const texan = staff.find((s) => s["area"] === "Texas");
  recruiting.scout_week(st);
  assert(rc["reads"][tx]["looks"] === recruiting.AREA_LOOK && recruiting.AREA_LOOK === 0.5);
  recruiting.assign(st, texan["id"], "Florida");
  assert(rc["reads"][tx]["looks"] === 0.5 && texan["area"] === "Florida");
  refused(() => recruiting.assign(st, texan["id"], "Atlantis"), 400);
});

// ----- how good a read is ---------------------------------------------------------------------------------------------------

/** A complete report on each prospect by one evaluator, judged on the read's own spread (what the player saw narrowing
 *  before the report was complete): the share of ranges holding the true grade word, the mean width, each [width, held],
 *  and the final grade's mean error against the mean half-width the range spanned. */
function coverage(st, rating, pids) {
  const rc = st["recruiting"];
  rc["reads"] = {};
  const rng = new Random(`cov-${rating}`);
  for (const pid of pids) for (let i = 0; i < REPORT; i++) recruiting.look(st, pid, rating, rng);
  const rows = [], errs = [], halves = [];
  const W = recruiting.WORDS;
  for (const pid of pids) {
    const truth = rc["prospects"][pid]["truth"];
    assert(recruiting.report_complete(rc["reads"][pid]));
    for (const g of recruiting.GROUPS) {
      const [m, half] = recruiting.read_spread(st, pid, g);
      const t = W.indexOf(recruiting.word(truth[g]));
      rows.push([2 * half, W.indexOf(recruiting.word(m + half)) <= t && t <= W.indexOf(recruiting.word(m - half))]);
      const [lo, hi] = recruiting.read_interval(st, pid, g);
      assert(lo === hi && hi === m, "a complete report's read is one point: the staff's final grade");
      equal(recruiting.grade_range(st, pid, g), [recruiting.word(m), recruiting.word(m)]);
      errs.push(Math.abs(m - truth[g]));
      halves.push(half + recruiting.WORD_SLACK);
    }
  }
  return { held: rows.filter((r) => r[1]).length / rows.length, width: mean(rows.map((r) => r[0])), rows, err: mean(errs), half: mean(halves) };
}

test("a better evaluator's ranges hold the truth more often and his final grade is closer; a weak one is wider and still misses more", () => {
  const st = fresh();
  const pids = Object.keys(st["recruiting"]["prospects"]).slice(0, 500);
  const avg = coverage(st, 60, pids), elite = coverage(st, 95, pids), weak = coverage(st, 40, pids);
  for (const c of [avg, elite, weak]) assert(c.err <= c.half, J([c.err, c.half]));      // the final grade lands inside the range it had
  assert(elite.err < avg.err && avg.err < weak.err, J([elite.err, avg.err, weak.err]));
  assert(avg.held >= 0.72 && avg.held <= 0.88, String(avg.held));
  assert(elite.held >= 0.85 && elite.held <= 0.95, String(elite.held));
  assert(weak.held < avg.held && weak.width > avg.width, J([weak.held, avg.held, weak.width, avg.width]));
  const mid = median(avg.rows.map((r) => r[0]));
  assert(weak.rows.some(([w, held]) => w < mid && !held), "a weak evaluator is never tight and wrong");
  // an incomplete report keeps its range
  const rc = st["recruiting"];
  rc["reads"][pids[0]]["looks"] = 2.5;
  const [lo, hi] = recruiting.read_interval(st, pids[0], "potential");
  assert(lo < hi, J([lo, hi]));
});

test("a half look moves the read half as far as a full one", () => {
  const st = fresh(), rc = st["recruiting"];
  const pid = Object.keys(rc["prospects"])[10];
  recruiting.look(st, pid, 80, new Random(1), undefined, undefined, recruiting.AREA_LOOK);
  const before = [...rc["reads"][pid]["g"]["potential"]];
  const full = clone(st), half = clone(st);
  recruiting.look(full, pid, 80, new Random(5));
  recruiting.look(half, pid, 80, new Random(5), undefined, undefined, recruiting.AREA_LOOK);
  const gf = full["recruiting"]["reads"][pid]["g"]["potential"], gh = half["recruiting"]["reads"][pid]["g"]["potential"];
  assert(Math.abs((gh[1] - before[1]) * 2 - (gf[1] - before[1])) < 1e-3, J([before, gf, gh]));     // half the precision gained
  assert(Math.abs(gh[0] - before[0]) < Math.abs(gf[0] - before[0]), J([before, gf, gh]));
  assert(full["recruiting"]["reads"][pid]["looks"] === 1.5 && half["recruiting"]["reads"][pid]["looks"] === 1.0);
});

test("grade words are cut on the game's scale: 50 is Solid, 65 Strong, 80 Elite", () => {
  equal([95, 90, 85, 80, 70, 65, 55, 50, 45, 40, 30].map((v) => recruiting.word(v)),
    ["All-American", "All-American", "Elite", "Elite", "Strong", "Strong", "Solid", "Solid", "Fair", "Fair", "Weak"]);
  assert(!recruiting.WORDS.includes("Generational"));
  const band = recruiting.word_band(72);
  assert(band[0] <= 72 && 72 <= band[1] && recruiting.word(band[0]) === recruiting.word(band[1]));
});

test("a true grade is the average of the card ratings behind it", () => {
  const rc = base["recruiting"];
  const sample = Object.values(rc["prospects"]).filter((_, i) => i % 40 === 0);
  for (const q of sample) {
    const cards = prospects.game_attributes(base, q);
    for (const g of ["athleticism", "size_strength", "technique", "football_iq"]) {
      const keys = prospects.group_keys(q, g);
      assert(keys.length, `${q["ea_position"]} ${g}`);
      assert(Math.abs(q["truth"][g] - mean(keys.map((k) => cards[k]))) < 0.6, J([q["ea_position"], g, q["truth"][g]]));
    }
  }
  const eighties = Object.values(rc["prospects"]).filter((q) => q["truth"]["athleticism"] >= 80);
  assert(eighties.length && eighties.every((q) => ["All-American", "Elite"].includes(recruiting.word(q["truth"]["athleticism"]))));
});

// ----- looks in trip units -----------------------------------------------------------------------------------------------

test("every scouting badge waits for a complete report of three looks", () => {
  assert(REPORT === 3 && recruiting.AREA_LOOK === 0.5 && recruiting.AREA_CAP === 2.0 && recruiting.SEND_LOOK === 1.0);
  assert(recruiting.FIND_LOOKS === REPORT && prospects.OUR_COMP_LOOKS === REPORT);
});

test("a week in a scout's area is half a look, capped at two from the area; one Send then finishes the report", () => {
  const st = fresh(), rc = st["recruiting"], staff = st["career"]["staff"];
  for (const p of Object.values(rc["prospects"])) p["hidden"] = false;
  const staffed = new Set(staff.map((m) => m["area"]));
  const pids = Object.keys(rc["prospects"]);
  const inside = pids.find((q) => live(rc, q) && staffed.has(area_of(st, q)));
  const outside = pids.find((q) => live(rc, q) && !staffed.has(area_of(st, q)));
  const scout = staff.find((m) => m["area"] === area_of(st, inside));
  const week = (w) => { st["current_week"] = w; recruiting.scout_week(st); };
  week(0);
  const read = rc["reads"][inside];
  assert(read["looks"] === 0.5 && read["area"] === 0.5 && !(outside in rc["reads"]), J(read));
  assert(rc["look_counts"]["0"][scout["id"]] === 0.5 * pids.filter((q) => live(rc, q) && area_of(st, q) === scout["area"]).length);
  assert(prospects.row(st, inside, ME)["looks"] === 0.5 && prospects.profile(st, inside, ME)["looks"] === 0.5);
  for (const w of [1, 2, 3]) week(w);
  assert(read["looks"] === 2.0 && read["area"] === 2.0, J(read));
  assert(!prospects.row(st, inside, ME)["scouted"] && prospects.find(st, inside) === null, "two of three is not scouted");
  week(4);                                                // a fifth week adds nothing and is not counted
  assert(read["looks"] === 2.0 && read["area"] === 2.0);
  assert(get(get(rc["look_counts"], "4", {}), scout["id"], 0) === 0 && !(scout["id"] in get(rc["look_changes"], "4", {})));
  assert(prospects.can_scout(st, ME, inside) === true);
  const out = send(st, inside);
  assert(out["look"]["by"] === "trip" && read["looks"] === 3.0 && read["area"] === 2.0, J(read));
  assert(prospects.row(st, inside, ME)["scouted"] === true && prospects.can_scout(st, ME, inside) === false);
  const prof = prospects.profile(st, inside, ME);
  assert(prof["can_scout"] === false && prof["looks"] === 3);
  assert(recruiting.GROUPS.every((g) => { const [lo, hi] = recruiting.read_interval(st, inside, g); return lo === hi; }), "one final grade per group");
  const e = refused(() => send(st, inside), 409);
  assert(e.message.includes("his report is complete") && e.message.includes("3 of 3 looks"), e.message);
  // outside every area: three Sends make the report, and a fourth is refused
  for (const n of [1, 2, 3]) {
    send(st, outside);
    assert(rc["reads"][outside]["looks"] === n && get(rc["reads"][outside], "area", 0) === 0);
  }
  assert(prospects.row(st, outside, ME)["scouted"] === true);
  refused(() => send(st, outside), 409, "complete");
  // a Send adds only what his report still needs
  const half_done = pids.find((q) => live(rc, q) && area_of(st, q) === scout["area"] && q !== inside && q in rc["reads"]);
  rc["reads"][half_done]["looks"] = 2.5;
  send(st, half_done);
  assert(rc["reads"][half_done]["looks"] === 3.0);
  // weeks of area looks with trips along the way: nothing anywhere past three looks, or two from an area, and looks come in halves
  for (let w = 5; w < 11; w++) {
    week(w);
    Object.keys(rc["reads"]).filter((_, i) => i >= w && (i - w) % 40 === 0).forEach((q) => { if (prospects.can_scout(st, ME, q)) send(st, q); });
  }
  const reads = Object.values(rc["reads"]);
  assert(reads.every((r) => r["looks"] > 0 && r["looks"] <= 3.0 && get(r, "area", 0) >= 0 && get(r, "area", 0) <= 2.0));
  assert(reads.some((r) => r["looks"] === 3.0) && reads.every((r) => Number.isInteger(r["looks"] * 2)));
});

test("an old save's read past three looks counts as complete, costs nothing and is never looked at again", () => {
  const st = fresh(), rc = st["recruiting"], staff = st["career"]["staff"];
  const old = Object.keys(rc["prospects"]).find((q) => live(rc, q) && !rc["prospects"][q]["hidden"] && staff.some((m) => m["area"] === area_of(st, q)));
  rc["reads"][old] = { looks: 7, by: { 60: 7 }, g: Object.fromEntries(recruiting.GROUPS.map((g) => [g, [70.0, 0.5]])) };
  assert(prospects.row(st, old, ME)["scouted"] === true && prospects.row(st, old, ME)["looks"] === 3);
  assert(prospects.profile(st, old, ME)["looks"] === 3 && prospects.can_scout(st, ME, old) === false);
  assert([null, "gem", "bust"].includes(prospects.find(st, old)));
  st["current_week"] = recruiting.close_week() - 1;        // the last working week
  recruiting.scout_week(st);
  equal(rc["reads"][old]["g"]["potential"], [70.0, 0.5], "no second look at a complete report");
  refused(() => send(st, old), 409, "complete");
  st["current_week"] = recruiting.close_week();            // the dead period: nobody can be worked, complete report or not
  const e = refused(() => send(st, old), 409);
  assert(recruiting.closed(st) && e.message === recruiting.CLOSED_TEXT, e.message);
});

// ----- scouting points ------------------------------------------------------------------------------------------------------

test("scouting points come in fives from your best evaluator: 150 for an average one, 250 for the best", () => {
  const st = fresh();
  const set = (rating) => {
    st["coach"]["ratings"]["evaluation"] = rating;
    for (const m of st["career"]["staff"]) m["evaluation"] = Math.min(get(m, "evaluation", 50), rating);
  };
  set(50);
  assert(recruiting.best_evaluator(st) === 50 && recruiting.scout_points(st, ME) === 150);
  st["coach"]["ratings"]["evaluation"] = 100;
  assert(recruiting.best_evaluator(st) === 100 && recruiting.scout_points(st, ME) === 250);
  for (const [rating, want] of [[63, 175], [77, 205]]) {
    set(rating);
    assert(recruiting.best_evaluator(st) === rating && recruiting.scout_points(st, ME) === want, J([rating, recruiting.scout_points(st, ME)]));
  }
});

/** An unscouted, unsigned prospect: in your state (`home`), else in or out of a staffed area and not close to home. */
function pick(st, in_area, home = false) {
  const rc = st["recruiting"];
  const codes = new Set(st["career"]["staff"].flatMap((m) => recruiting.AREAS[m["area"]] || []));
  return Object.keys(rc["prospects"]).find((q) => {
    const state_ = rc["prospects"][q]["hometown"]["state"];
    return !(q in rc["reads"]) && !rc["status"][q]["signed"] && !rc["prospects"][q]["hidden"] && (state_ === "OH") === home
      && (home || (codes.has(state_) === in_area && !recruiting.near_home(st, ME, q)));
  });
}

test("a Send costs 5 points close to home, 10 in a staffed area, 15 away, 5 in the portal; half a look to go costs half", () => {
  const st = fresh(), rc = st["recruiting"];
  st["career"]["staff"][0]["area"] = "Midwest";
  const home = pick(st, true, true), near = pick(st, true), far = pick(st, false);
  equal(recruiting.LOOK_COST, { home: 5, area: 10, away: 15, portal: 5 });
  equal([home, near, far].map((q) => recruiting.look_cost(st, ME, q)), [5, 10, 15]);
  const close = Object.keys(rc["prospects"]).find((q) => rc["prospects"][q]["hometown"]["state"] !== "OH" && recruiting.near_home(st, ME, q));
  assert(recruiting.look_cost(st, ME, close) === 5, "within driving distance of the campus is home too");
  assert(recruiting.look_cost({ ...st, recruiting: { ...rc, portal: true } }, ME, near) === 5);
  for (const [q, full, half] of [[home, 5, 5], [near, 10, 5], [far, 15, 10]]) {
    rc["reads"][q] = { looks: REPORT - 1, by: {}, g: Object.fromEntries(recruiting.GROUPS.map((g) => [g, [40.0, 60.0]])) };
    assert(recruiting.look_cost(st, ME, q) === full, "a whole look still needed: the full price");
    rc["reads"][q]["looks"] = REPORT - 0.5;
    assert(recruiting.look_cost(st, ME, q) === half, "half a look: half the price, rounded up to a five");
    delete rc["reads"][q];
  }
});

test("a Send spends scouting points, not hours; short of points it is refused; the points refill at the week step", () => {
  const st = fresh(), rc = st["recruiting"];
  st["career"]["staff"][0]["area"] = "Midwest";
  const pid = pick(st, false), other = Object.keys(rc["prospects"]).find((q) => q !== pid && !rc["prospects"][q]["hidden"] && recruiting.look_cost(st, ME, q) === 15);
  const h0 = recruiting._hours(st, ME), p0 = recruiting.scout_points_left(st, ME);
  recruiting.act(st, ME, pid, "scout");
  assert(recruiting._hours(st, ME) === h0 && recruiting.scout_points_left(st, ME) === p0 - 15);
  rc["scout_points"] = { [ME]: 14 };
  const e = refused(() => recruiting.act(st, ME, other, "scout"), 409);
  assert(e.message === "Not enough scouting points left this week.", e.message);
  rc["scout_points"] = { [ME]: 15 };
  recruiting.act(st, ME, other, "scout");
  assert(recruiting.scout_points_left(st, ME) === 0);
  delete rc["scout_points"];                              // a save from before scouting points: a full week's
  assert(recruiting.scout_points_left(st, ME) === recruiting.scout_points(st, ME));
});

// ----- leftover points ---------------------------------------------------------------------------------------------------------

function board_of(n = 3) {
  const st = fresh(), rc = st["recruiting"];
  st["current_week"] = 1;
  const pids = Object.keys(rc["prospects"]).sort((a, b) => rc["prospects"][a]["rank"] - rc["prospects"][b]["rank"]).slice(60)
    .filter((q) => !rc["prospects"][q]["hidden"]).slice(0, n);
  rc["board"] = [...pids];
  rc["reads"] = {};
  return [st, pids];
}

test("points you leave unspent buy half looks on your board at a Send's price, one a prospect a week", () => {
  let [st, pids] = board_of();
  const cost = pids.reduce((a, q) => a + recruiting.look_cost(st, ME, q), 0);
  st["recruiting"]["scout_points"][ME] = cost;
  assert(recruiting.LEFTOVER_LOOK === 0.5);
  assert(recruiting.spend_leftover(st, 2) === cost && pids.every((q) => looks_of(st, q) === 0.5), J(pids.map((q) => looks_of(st, q))));
  [st, pids] = board_of();
  st["recruiting"]["scout_points"][ME] = 0;
  assert(recruiting.spend_leftover(st, 2) === 0 && pids.every((q) => looks_of(st, q) === 0), "nothing left, nothing done");
  // a week you never opened the board (Sim to Signing Day, Auto-recruit): all the week's points were left over
  [st, pids] = board_of();
  st["recruiting"]["scout_points"] = {};
  assert(recruiting.spend_leftover(st, 2) > 0 && pids.every((q) => looks_of(st, q) === 0.5));
});

test("short of points the least-scouted goes first, and a complete report gets none", () => {
  let [st, [a, b, c]] = board_of();
  st["recruiting"]["reads"][a] = { looks: 1.0, area: 0.0, by: {}, g: {} };
  st["recruiting"]["scout_points"][ME] = recruiting.look_cost(st, ME, b);
  recruiting.spend_leftover(st, 2);
  equal([a, b, c].map((q) => looks_of(st, q)), [1.0, 0.5, 0], "one Send's worth goes to the least-scouted, by rank");
  [st, [a, b, c]] = board_of();
  st["recruiting"]["reads"][a] = { looks: REPORT, area: 0.0, by: {}, g: {} };
  st["recruiting"]["scout_points"][ME] = 1000;
  recruiting.spend_leftover(st, 2);
  equal([a, b, c].map((q) => looks_of(st, q)), [REPORT, 0.5, 0.5]);
});

// ----- hidden prospects, profiles and comps ---------------------------------------------------------------------------------

test("about one in seven lower-ranked prospects is hidden from the public list until your staff look at him", () => {
  const st = fresh(), rc = st["recruiting"];
  const hidden = Object.keys(rc["prospects"]).filter((q) => rc["prospects"][q]["hidden"]);
  const low = Object.values(rc["prospects"]).filter((p) => p["stars"] === 2 || (p["stars"] === 3 && p["composite"] < 0.82)).length;
  assert(hidden.length / low > 0.10 && hidden.length / low < 0.20, String(hidden.length / low));
  const h = hidden.find((q) => !(q in rc["reads"]));
  assert(!recruiting.prospect_list(st).includes(h));
  const e = refused(() => prospects.profile(st, h, ME), 404);
  assert(e.code === 404);
  recruiting.look(st, h, 60, new Random(1));
  assert(recruiting.prospect_list(st).includes(h));
});

test("the top of the class gets a public evaluation and a comp to a real starter at his position; the middle gets neither", () => {
  const rc = base["recruiting"];
  const by_rank = Object.fromEntries(Object.entries(rc["prospects"]).map(([q, p]) => [p["rank"], q]));
  const top = prospects.profile(base, by_rank[1], ME);
  assert(top["evaluation"] && top["public_comp"], J(top["public_comp"]));
  const pool = prospects.starter_pool();
  assert(pool.some((c) => c["name"] === top["public_comp"]["name"] && prospects.display_pos(c["position"]) === top["public_comp"]["position"]));
  assert(top["public_comp"]["position"] === prospects.display_pos(rc["prospects"][by_rank[1]]["ea_position"]), "the comp shows his position as the header does");
  const truth = rc["prospects"][by_rank[1]]["truth"];
  const best = [...prospects.EVAL_GROUPS].sort((a, b) => truth[b] - truth[a])[0];
  assert(top["evaluation"]["strengths"].join(" ").includes(prospects.GROUP_NAMES[best]), J(top["evaluation"]));
  assert(top["public"]["national_rank"] === 1 && top["public"]["position_rank"] === 1 && !("truth" in top["public"]));
  const mid = prospects.profile(base, by_rank[900], ME);
  assert(mid["evaluation"] === null && mid["public_comp"] === null);
});

test("your staff's own comp and grades wait for his complete report", () => {
  const st = fresh(), rc = st["recruiting"];
  const by_rank = Object.fromEntries(Object.entries(rc["prospects"]).map(([q, p]) => [p["rank"], q]));
  const pool = prospects.starter_pool();
  let pid = null;                                         // a top prospect a starter compares to (an elite ceiling can have none)
  for (let r = 2; r < 60 && pid === null; r++) {
    const p = rc["prospects"][by_rank[r]];
    if (prospects.comp(prospects.ceiling(st, p), p["ea_position"], pool) !== null) pid = by_rank[r];
  }
  delete rc["reads"][pid];
  let prof = prospects.profile(st, pid, ME);
  assert(prof["our_comp"] === null && prof["our_grades"] === null);
  for (let i = 0; i < 3; i++) recruiting.look(st, pid, 90, new Random(i));
  prof = prospects.profile(st, pid, ME);
  assert(prof["our_comp"] !== null && !("overall_ea" in prof["our_comp"]) && prof["our_comp"]["overall"] !== undefined, J(prof["our_comp"]));
  equal(new Set(Object.keys(prof["our_grades"])), new Set(recruiting.GROUPS));
  assert(!("truth" in prof["public"]));
});

test("hovering a grade shows what prospects graded like that look like, on the game's own ratings, placed among today's players", () => {
  const st = fresh(), rc = st["recruiting"];
  const pid = Object.keys(rc["prospects"]).find((q) => rc["prospects"][q]["rank"] === 5);
  for (let i = 0; i < 3; i++) recruiting.look(st, pid, 90, new Random(i));
  const prof = prospects.profile(st, pid, ME), det = prof["grade_details"];
  assert(Object.values(prof["our_grades"]).every(([lo, hi]) => lo === hi), "a complete report is one grade a group");
  equal(new Set(Object.keys(det)), new Set(recruiting.GROUPS));
  assert(det["athleticism"]["peers"] >= 4 && "Top Speed" in det["athleticism"]["ratings"] && "Projected overall" in det["potential"]["ratings"]);
  const ranges = Object.values(det).flatMap((g) => Object.values(g["ratings"] || {}));
  assert(ranges.every(([lo, hi]) => 0 <= lo && lo <= hi && hi <= 99), J(ranges));
  // one scale, the player cards': never the other game's attribute names
  assert(!Object.values(det).some((g) => ["speed", "acceleration", "change of direction"].some((k) => k in (g["ratings"] || {}))));
  const lg = det["athleticism"]["league"]["Top Speed"];
  assert(lg["rank"] >= 1 && lg["rank"] <= lg["of"] && lg["starter_rank"] >= 1 && lg["starter_rank"] <= lg["starters"] + 1 && lg["of"] > lg["starters"] && lg["starters"] > 20, J(lg));
  assert(det["coachability"]["labels"]);
  const lb = Object.keys(rc["prospects"]).find((q) => rc["prospects"][q]["ea_position"] === "MIKE" && !rc["prospects"][q]["hidden"]);
  for (let i = 0; i < 3; i++) recruiting.look(st, lb, 90, new Random(i));
  assert(Object.keys(prospects.profile(st, lb, ME)["grade_details"]["technique"]["ratings"]).length, "a linebacker's technique showed no ratings");
});

test("the Send queue puts your board first: one Send from complete, then the rest of the board, a complete report last", () => {
  const st = fresh(), rc = st["recruiting"];
  for (const p of Object.values(rc["prospects"])) p["hidden"] = false;
  const [far, near, done] = Object.keys(rc["prospects"]).slice(300, 303);
  delete rc["reads"][far];
  rc["reads"][near] = { ...full_read(60.0, 2.0), area: 2.0 };
  rc["reads"][done] = { ...full_read(60.0, 3.0), area: 2.0 };
  rc["board"] = [far, near, done];
  const queue = prospects.scouting_view(st, null, null, null, 0, prospects.QUEUE_LIMIT, false, "board")["queue"];
  equal(queue.slice(0, 3).map((r) => [r["pid"], r["looks"], r["can_send"]]), [[near, 2.0, true], [far, 0, true], [done, 3, false]]);
  assert(queue[2]["why"] === prospects.REPORT_COMPLETE && prospects.REPORT_COMPLETE === "His report is complete: 3 of 3 looks");
  assert(queue[2]["potential"][0] === queue[2]["potential"][1], "a complete report settles on one letter grade");
  assert(queue.slice(3).every((r) => r["can_send"] === (r["looks"] < 3)));
});

// ----- he is yours, or signed -----------------------------------------------------------------------------------------------

test("scouting stops once he is committed to you: no Send, and your area scout spends no look on him", () => {
  const st = fresh(), rc = st["recruiting"], staff = st["career"]["staff"];
  st["current_week"] = 1;
  for (const p of Object.values(rc["prospects"])) p["hidden"] = false;
  const by_rank = Object.fromEntries(Object.entries(rc["prospects"]).map(([q, p]) => [p["rank"], q]));
  const [scouted, unscouted, open] = [by_rank[20], by_rank[21], by_rank[22]];
  rc["reads"] = {};
  for (let i = 0; i < 3; i++) send(st, scouted);
  let prof = prospects.profile(st, scouted, ME);
  assert(rc["reads"][scouted]["looks"] === 3.0 && prof["our_grades"] !== null && prof["public"]["trips"] === 3 && prof["looks"] === 3);
  recruiting._commit(st, scouted, ME);
  refused(() => send(st, scouted), 409, "committed to you");
  prof = prospects.profile(st, scouted, ME);
  assert(prof["can_scout"] === false && prof["our_grades"] !== null && "coachability" in prof["our_grades"] && prof["looks"] === 3);
  recruiting._commit(st, unscouted, ME);
  const home = rc["prospects"][unscouted]["hometown"]["state"];
  const area = Object.keys(recruiting.AREAS).find((a) => recruiting.AREAS[a].includes(home));
  staff[2]["area"] = area;
  const neighbor = Object.keys(rc["prospects"]).find((q) => rc["prospects"][q]["hometown"]["state"] === home && rc["status"][q]["committed"] === null
    && recruiting.area_open(get(rc["reads"], q)));
  const before = looks_of(st, neighbor);
  recruiting.scout_week(st);
  assert(!(unscouted in rc["reads"]), "your area scout looked at your own commit");
  prof = prospects.profile(st, unscouted, ME);
  assert(prof["can_scout"] === false && prof["our_grades"] === null && prof["looks"] === 0);
  const covering = staff.filter((m) => m["area"] === area).length;
  assert(looks_of(st, neighbor) === before + recruiting.AREA_LOOK * covering, "an uncommitted prospect in the area still gets his half look");
  // an uncommitted prospect gets his three looks from you and no more
  assert(prospects.profile(st, open, ME)["can_scout"] === true);
  let sends = 0;
  while (prospects.can_scout(st, ME, open)) { send(st, open); sends++; }
  assert(rc["reads"][open]["looks"] === 3.0 && sends >= 1 && sends <= 3 && prospects.profile(st, open, ME)["public"]["trips"] === sends);
  const rows = Object.fromEntries(prospects.search(st, ME)["rows"].map((r) => [r["id"], r]));
  assert(rows[scouted]["can_scout"] === false && rows[open]["can_scout"] === false);
});

test("a gem or a bust risk is your staff's read against his star tier, never the truth, and is judged when he signs with you", () => {
  const st = fresh(), rc = st["recruiting"];
  const cuts = recruiting.flag_cuts(rc);
  const two = Object.keys(rc["prospects"]).find((q) => rc["prospects"][q]["stars"] === 2 && !rc["prospects"][q]["hidden"]);
  rc["reads"][two] = full_read(cuts[2][0] + 1.0);
  assert(prospects.find(st, two) === "gem" && prospects.row(st, two, ME)["find"] === "gem");
  rc["reads"][two]["g"]["potential"] = [88.0, 100.0];
  assert(prospects.find(st, two) === null, "a read far above the cut is not a gem: the cut is a band relative to his star tier");
  rc["reads"][two]["g"]["potential"] = [cuts[2][0] + 1.0, 100.0];
  for (const looks of [1, 2, 2.5]) {
    rc["reads"][two]["looks"] = looks;
    assert(prospects.find(st, two) === null, `${looks} looks: a find waits for the complete report`);
  }
  rc["reads"][two]["looks"] = 3;
  const five = Object.keys(rc["prospects"]).find((q) => rc["prospects"][q]["stars"] === 5);
  rc["reads"][five] = full_read(cuts[5][1] - 1.0);
  assert(prospects.find(st, five) === "bust");
  rc["reads"][five]["g"]["potential"] = [88.0, 100.0];
  assert(prospects.find(st, five) === null, "a five-star reading Elite is just a five-star");
  Object.assign(rc["status"][two], { signed: ME, committed: ME });
  const held = prospects.class_detail(st, ME, ME).find((r) => r["id"] === two)["find_held"];
  assert(held === (rc["prospects"][two]["truth"]["potential"] >= 80), "the gem call is held to the truth");
  const four = Object.keys(rc["prospects"]).find((q) => rc["prospects"][q]["stars"] === 4 && !rc["prospects"][q]["hidden"]);
  rc["reads"][four] = full_read(cuts[4][1] - 1.0);
  assert(prospects.find(st, four) === "bust");
  Object.assign(rc["status"][four], { signed: ME, committed: ME });
  const row4 = prospects.class_detail(st, ME, ME).find((r) => r["id"] === four);
  assert(row4["find"] === "bust" && row4["find_held"] === (rc["prospects"][four]["truth"]["potential"] < 50));
});

// ----- old saves ----------------------------------------------------------------------------------------------------------------

test("a save from before grades moved to the game's scale converts on load: true grades recomputed, each read as far off as it was", () => {
  const st = fresh(), rc = st["recruiting"];
  assert(rc["grades"] === "game");
  const pid = Object.keys(rc["prospects"])[5];
  for (let i = 0; i < 3; i++) recruiting.look(st, pid, 90, new Random(i));
  const now = { ...rc["prospects"][pid]["truth"] };
  const off = Object.fromEntries(recruiting.GROUPS.map((g) => [g, rc["reads"][pid]["g"][g][0] - now[g]]));
  for (const g of recruiting.GROUPS) {                    // as an old save held them
    rc["prospects"][pid]["truth"][g] = 70.0;
    rc["reads"][pid]["g"][g][0] = 70.0 + off[g];
  }
  delete rc["grades"];
  st["id"] = "oldgradesave01";
  season.save_season(st);
  const orc = season.load_season(st["id"])["recruiting"];
  assert(orc["grades"] === "game");
  equal(orc["prospects"][pid]["truth"], now);
  assert(recruiting.GROUPS.every((g) => Math.abs(orc["reads"][pid]["g"][g][0] - (now[g] + off[g])) < 0.01));
  assert(orc["reads"][pid]["looks"] === 3);
});

await run();
