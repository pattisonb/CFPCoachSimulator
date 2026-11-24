// What a recruit's profile shows (career_js/prospects.js) and the school grades he reads (career_js/programs.js).
// - The profile's fields: his position as the game displays it, his rank at that position, height and weight as text,
//   and a Scouting Report written from your staff's reads only, never his true grades.
// - "OC Likes Him" / "DC Likes Him" (staff_likes): once his report is complete, your coordinator vouches for a recruit
//   whose read says he would start on your returning roster. Never on the truth, never short of three looks.
// - School grades: six grades and Location's tags for every program, read on demand; the rating, tier and market
//   are untouched by them.
// `node tests/test_recruit_profile.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, get, floordiv, mod } from "../engine_js/pyrt.js";

const game = await start();
const { api, season, recruiting, offseason } = game;
const { prospects, programs, persona } = game.modules;

const ME = "ohio-state";
const J = (v) => () => JSON.stringify(v);
const LABELS = ["Athleticism", "Football IQ", "Technique", "Size / Strength", "Coachability", "Upside"];

const sid = api.call("POST", "/api/season", { team: ME, mode: "full", seed: 13, career: true })["id"];
const G = (p) => api.call("GET", `/api/season/${sid}/${p}`);
const R = (p, body) => api.call("POST", `/api/season/${sid}/${p}`, body);
const st = api.loaded_state(), rc = st["recruiting"];
const order = Object.keys(rc["prospects"]).sort((a, b) => rc["prospects"][a]["rank"] - rc["prospects"][b]["rank"]);
const tight = (p, looks) => ({ looks, area: 0.0, by: { 80: looks }, g: Object.fromEntries(recruiting.GROUPS.map((g) => [g, [p["truth"][g], 2.0]])) });

// ----- the profile's fields ----------------------------------------------------------------------------------------------------

test("positions are shown the game's way: both ends EDGE, both tackles OT, both guards OG, a fullback RB", () => {
  const want = { LEDG: "EDGE", REDG: "EDGE", DT: "DT", LT: "OT", RT: "OT", LG: "OG", RG: "OG", C: "C", HB: "RB", FB: "RB", SAM: "WILL", MIKE: "MIKE",
    WILL: "WILL", FS: "FS", SS: "SS", QB: "QB", CB: "CB", WR: "WR", TE: "TE", K: "K", P: "P" };
  for (const [ea, shown] of Object.entries(want)) assert(prospects.display_pos(ea) === shown, `${ea} shows as ${prospects.display_pos(ea)}`);
});

test("a row carries his shown position, his rank at it by national order, height and weight as text, and his class", () => {
  const seen = {};
  for (const pid of order.slice(0, 400)) {
    const p = rc["prospects"][pid], shown = prospects.display_pos(p["ea_position"]);
    seen[shown] = (seen[shown] || 0) + 1;
    const r = prospects.row(st, pid, ME);
    assert(r["display_pos"] === shown && r["pos_rank"] === seen[shown], J([pid, r["display_pos"], r["pos_rank"], seen[shown]]));
    assert(r["height_display"] === `${floordiv(p["height"], 12)}'${mod(p["height"], 12)}"` && r["weight_display"] === `${p["weight"]} lbs`);
    assert(r["class_of"] === p["class_of"]);
  }
  assert(prospects.height_text("6'2\"") === "6'2\"" && prospects.weight_text(null) === null);
});

test("the Scouting Report is written from your staff's reads, never his true grades", () => {
  const pid = order[5], p = rc["prospects"][pid];
  delete rc["reads"][pid];
  let pr = prospects.profile(st, pid, ME);
  assert(pr["report"] === null, "no report before a look");
  const hints = pr["trait_hints"];
  assert(["personality", "story"].every((k) => k in hints) && !("decider" in hints) && Object.values(hints).every((h) => h.endsWith(".") && /^[A-Z]/.test(h)), J(hints));
  rc["reads"][pid] = tight(p, 2);
  let rep = prospects.profile(st, pid, ME)["report"];
  assert(rep["headline"] && rep["verdict"], J(rep));
  assert(rep["strengths"].length <= 3 && rep["develop"].length <= 3 && [...rep["strengths"], ...rep["develop"]].every((l) => LABELS.includes(l)));
  assert(!rep["strengths"].some((l) => rep["develop"].includes(l)), "a strength is not also an area to develop");
  equal(rep["attributes"].map((a) => a["label"]), ["Athleticism", "Football IQ", "Technique", "Size / Strength", "Coachability"]);
  const shown = prospects.display_pos(p["ea_position"]);
  assert(rep["verdict"].includes(shown) || rep["verdict"].includes(prospects.POS_NOUNS[shown]), `the verdict does not say what he plays: ${rep["verdict"]}`);
  for (const a of rep["attributes"]) equal(a["words"], recruiting.grade_range(st, pid, a["group"]), "a bar's words are the read's");
  for (const a of rep["attributes"]) assert(0 <= a["lo"] && a["lo"] <= a["mid"] && a["mid"] <= a["hi"] && a["hi"] <= 100 && ["good", "warn", "bad"].includes(a["tone"]), J(a));
  const before = JSON.stringify(rep), saved = { ...p["truth"] };
  for (const g of recruiting.GROUPS) p["truth"][g] = p["truth"][g] < 50 ? 99.0 : 5.0;
  const after = JSON.stringify(prospects.profile(st, pid, ME)["report"]);
  Object.assign(p["truth"], saved);
  assert(after === before, "the report changed with the truth");
  // a weak read is an area to develop, a strong one a strength; with nothing weak there is nothing to develop
  rc["reads"][pid]["g"] = Object.fromEntries(recruiting.GROUPS.map((g) => [g, [g === "technique" ? 30.0 : 85.0, 2.0]]));
  rep = prospects.profile(st, pid, ME)["report"];
  assert(rep["develop"].includes("Technique") && !rep["strengths"].includes("Technique"), J(rep));
  assert(rep["attributes"].find((a) => a["group"] === "technique")["tone"] === "bad" && rep["attributes"].find((a) => a["group"] === "athleticism")["tone"] === "good");
  rc["reads"][pid]["g"] = Object.fromEntries(recruiting.GROUPS.map((g) => [g, [70.0, 2.0]]));
  equal(prospects.profile(st, pid, ME)["report"]["develop"], []);
  delete rc["reads"][pid];
});

test("an evaluation's lines do not repeat their own label", () => {
  for (const pid of order.slice(0, 60)) {
    const ev = prospects.profile(st, pid, ME)["evaluation"];
    for (const t of [...ev["strengths"], ...ev["solid"], ...ev["weaknesses"]]) {
      const i = t.indexOf(": "), head = i < 0 ? t : t.slice(0, i), rest = i < 0 ? "" : t.slice(i + 2);
      assert(!(rest && rest.toLowerCase().startsWith(head.toLowerCase().split(" ")[0])) && !t.startsWith("Upside: Big upside"), `a doubled label: ${t}`);
    }
  }
});

test("with a complete report and his personality learned, only his commit style can still be waiting on a hint", () => {
  const pid = order[7];
  rc["reads"][pid] = tight(rc["prospects"][pid], 3);
  persona.learn(st, ME, pid, "personality");
  const pr = prospects.profile(st, pid, ME);
  const want = get(pr["traits"], "has_style") && !get(pr["traits"], "commit_style") ? { commit_style: prospects.TRAIT_HINTS["commit_style"] } : {};
  equal(pr["trait_hints"], want);
  assert(pr["need"] !== null && Array.isArray(pr["row"]["history"]) && pr["row"]["id"] === pid);
});

// ----- your coordinators' likes ----------------------------------------------------------------------------------------------------

const TEXT = { OC: "Your offensive coordinator thinks he starts for you next year.", DC: "Your defensive coordinator thinks he starts for you next year." };
const staff = Object.fromEntries(st["career"]["staff"].map((m) => [m["role"], m["name"]]));
/** A read this sure has no width: every group's grade `off` points from his truth, `looks` looks in. */
function force_read(state, pid, off, looks = recruiting.FIND_LOOKS) {
  const p = state["recruiting"]["prospects"][pid];
  state["recruiting"]["reads"][pid] = { looks, area: 0.0, by: { 95: looks },
    g: Object.fromEntries(recruiting.GROUPS.map((g) => [g, [Math.max(0.0, Math.min(99.0, p["truth"][g] + off)), 1000.0]])) };
}
const group_of = (pid) => recruiting._group_of(rc["prospects"][pid]);
const ahead_by_truth = (pid) => recruiting._returning(ME, group_of(pid)).filter((o) => o >= rc["prospects"][pid]["ovr"]).length;
/** An open, visible recruit at one of these groups who would (or would not) start by his true overall. */
function pick(groups, starts, skip = []) {
  const pid = order.find((q) => groups.includes(group_of(q)) && !skip.includes(q) && !rc["prospects"][q]["hidden"] && !rc["status"][q]["signed"]
    && !rc["status"][q]["committed"] && (ahead_by_truth(q) < offseason.STARTERS[group_of(q)]) === starts);
  assert(pid !== undefined, `no recruit at ${groups} who ${starts ? "would" : "would not"} start`);
  return pid;
}
let qb, d, k, who;

test("a coordinator likes a recruit whose complete report says he would start for you: the OC on offense, the DC on defense", () => {
  qb = pick(["QB"], false);                               // by the truth he would not start: the read says he does
  force_read(st, qb, +40.0);
  assert(prospects.read_overall(st, qb) > Math.max(...recruiting._returning(ME, "QB")));
  equal(prospects.staff_likes(st, qb, ME), { who: "OC", name: staff["OC"], text: TEXT["OC"] });
  for (const looks of [2.0, 2.5]) {
    force_read(st, qb, +40.0, looks);
    assert(prospects.staff_likes(st, qb, ME) === null, "no like short of a complete report");
  }
  force_read(st, qb, +40.0);
  d = pick(["DL", "LB", "CB", "S"], false);
  force_read(st, d, +40.0);
  equal(prospects.staff_likes(st, d, ME), { who: "DC", name: staff["DC"], text: TEXT["DC"] });
  k = pick(["K", "P"], false);                            // a kicker or punter: one of the two, fixed by the seed
  force_read(st, k, +40.0);
  who = new Random(`likes-${rc["seed"]}-${k}`).choice(["OC", "DC"]);
  equal(prospects.staff_likes(st, k, ME), { who, name: staff[who], text: TEXT[who] });
});

test("the like goes by the read, never the truth, and is gone once he signs elsewhere", () => {
  const t = pick(["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S"], true);
  force_read(st, t, -40.0);
  assert(prospects.read_overall(st, t) < rc["prospects"][t]["ovr"]);
  assert(prospects.staff_likes(st, t, ME) === null && G(`prospect/${t}`)["likes"] === null, "the truth would start him; the read does not");
  rc["status"][d]["signed"] = "michigan";
  assert(prospects.staff_likes(st, d, ME) === null);
  rc["status"][d]["signed"] = null;
  assert(prospects.staff_likes(st, d, ME) !== null);
});

test("the like rides on the board row, the profile, the scouting queue and the Flags list, and a Send that completes a report returns it", () => {
  for (const pid of [qb, d, k]) R("board", { pid, on: true });
  const rows = Object.fromEntries(G("recruiting")["board"].map((b) => [b["id"], b]));
  equal([rows[qb]["likes"]["who"], rows[d]["likes"]["who"], rows[k]["likes"]["who"]], ["OC", "DC", who]);
  equal(G(`prospect/${qb}`)["likes"], { who: "OC", name: staff["OC"], text: TEXT["OC"] });
  const v = G("scouting?sort=board");
  assert(v["queue"].every((r) => "likes" in r && (r["looks"] >= 3 || r["likes"] === null)), "an open report has no like yet");
  const kept = Object.fromEntries(v["queue"].filter((r) => r["looks"] >= 3).map((r) => [r["pid"], r]));
  assert([qb, d, k].every((pid) => kept[pid] && kept[pid]["likes"]["who"] && !kept[pid]["can_send"]), "the board's complete reports stay in the queue with the like");
  const liked = Object.fromEntries(v["flags"].filter((f) => f["flag"] === "likes").map((f) => [f["pid"], f]));
  assert([qb, d, k].every((pid) => pid in liked) && liked[qb]["likes"]["who"] === "OC" && liked[qb]["looks"] === 3);
  const kinds = v["flags"].map((f) => f["flag"]);
  assert(kinds.indexOf("likes") > kinds.lastIndexOf("gem") && kinds.every((f, i) => f !== "bust" || i > kinds.indexOf("likes")), `gems, then likes, then bust risks: ${kinds}`);
  const two = pick(["QB"], false, [qb]);
  force_read(st, two, +40.0, 2.0);
  const res = R("recruit", { pid: two, action: "scout" });
  assert(res["look"]["likes"] && res["look"]["likes"]["who"] === "OC" && rc["reads"][two]["looks"] === 3, J(res["look"]));
});

// ----- school grades --------------------------------------------------------------------------------------------------------------

const SIX = ["academics", "facilities", "location", "stability", "game_day", "exposure"];

test("all 138 programs have six grades from 0 to 100", () => {
  const slugs = Object.keys(programs.profile_rows());
  assert(slugs.length === 138, String(slugs.length));
  for (const s of slugs) {
    const g = programs.grades(s);
    equal(new Set(Object.keys(g)), new Set(SIX));
    for (const [key, v] of Object.entries(g)) assert(typeof v === "number" && !Number.isNaN(v) && v >= 0 && v <= 100, J([s, key, v]));
  }
});

test("the grades land where the schools do: a great school, a big brand, a warm island, a coach who never left", () => {
  const g = programs.grades;
  assert(g("stanford")["academics"] > 85 && g("akron")["exposure"] < g("ohio-state")["exposure"]);
  assert(programs.warmth(73.6) > programs.warmth(16.2) && g("hawai-i")["location"] > g("minnesota")["location"]);
  assert(g("clemson")["stability"] === 100.0);
  for (const s of ["army", "navy", "air-force"]) assert(g(s)["academics"] >= 70, J([s, g(s)]));
  equal(programs.tags("texas-state"), { setting: "Big City", climate: "Warm", region: "South" });
  equal(programs.tags("akron"), { setting: "Mid-Size City", climate: "Cold", region: "Midwest" });
});

test("the inputs are forgiving: a crowd over capacity is full, a missing capacity is no crash, a year as text still counts", () => {
  assert(programs.fill_score(110000, 100000) === 100.0 && programs.fill_score(50000, 100000) === 20.0 && programs.fill_score(50000, null) !== null);
  assert(programs.facilities_score({ stadium_renovated: 2026, football_building_year: "2026", indoor_practice: "none" }) === 0.35 * 100 + 0.40 * 100 + 0.25 * 10);
});

test("a program the research has no row for is Not Graded, and the grades leave the rating, tier and market alone", () => {
  assert(programs.grades("no-such") === null && programs.tags("no-such") === null);
  const rows = programs.rows(st);
  assert(rows.every((r) => "grades" in r && "tags" in r));
  equal(new Set(rows.filter((r) => r["grades"] === null).map((r) => r["team"])), new Set(rows.map((r) => r["team"]).filter((t) => !(t in programs.profile_rows()))));
  for (const r of rows) {
    const b = programs.base(r["team"]);
    assert(r["rating"] === b["rating"] && r["tier"] === b["tier"] && r["market"] === b["market"], J([r["team"], r["rating"], b["rating"]]));
  }
});

test("nobody is liked in the portal: a transfer is who he is", () => {
  const rng = new Random(1), teams = season.load_teams();         // every game played (the better team usually wins), every class signed
  for (const g of Object.values(st["games"])) {
    const h = teams[g["home"]]["team_ratings"]["overall"], a = teams[g["away"]]["team_ratings"]["overall"];
    const hs = rng.randint(10, 45);
    const win = rng.random() < 1 / (1 + Math.pow(10, (a - h) / 12));
    Object.assign(g, { played: true, home_score: win ? hs : Math.max(0, hs - rng.randint(1, 20)), away_score: win ? hs - rng.randint(1, 20) : hs });
    if (g["home_score"] === g["away_score"]) g["home_score"] += 3;
  }
  const schools = Object.keys(teams).filter((s) => !teams[s]["fictional"]);
  order.slice(0, schools.length * 21).forEach((pid, i) => { rc["status"][pid]["signed"] = schools[i % schools.length]; });
  Object.assign(st, { done: true, current_week: season.FINAL_WEEK, champion: ME });
  api._save_loaded();
  G("offseason");
  while (api.loaded_state()["offseason"]["stage"] !== "portal_w1") R("offseason/advance", {});
  const pst = api.loaded_state(), prc = pst["recruiting"];
  assert(recruiting.is_portal(pst));
  const entrant = Object.keys(prc["prospects"]).find((q) => prc["prospects"][q]["portal"]);
  force_read(pst, entrant, +40.0);
  assert(prospects.staff_likes(pst, entrant, ME) === null);
  assert(G("scouting?sort=board")["flags"].every((f) => f["flag"] !== "likes"));
});

await run();
