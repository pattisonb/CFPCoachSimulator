// What a player would be at another position (career_js/position_fit.js). A 197-pound free safety must not project
// 67 at guard: his ratings go onto the new group's scale, the skills he has never used are discounted, his build is
// charged against the spot's, and his own position stays exact. Both places a position changes (in season and in the
// offseason) use it: the change writes the transferred ratings, and moving back the same season restores them.
// `node tests/test_position_fit.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted } from "../engine_js/pyrt.js";

const game = await start({ env: { SIM_WORKERS: "1" } });
const { season, offseason, files } = game;
const { league, position_fit: pf, game_scale: gs } = game.modules;

const show = (v) => JSON.stringify(v);
const OL = ["LT", "LG", "C", "RG", "RT"], EDGE = ["LEDG", "REDG"];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Every game played (the better team usually wins), every school's class signed, the season over. */
function finished(st) {
  const rng = new Random(1);
  const teams = season.load_teams();
  for (const g of Object.values(st["games"])) {
    const [h, a] = [teams[g["home"]]["team_ratings"]["overall"], teams[g["away"]]["team_ratings"]["overall"]];
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

const TEAMS = game.modules.rosters.read(pf.ENGINE_FILE)["teams"];      // the rosters as the game reads them (each player worked out from his ratings)
/** The player of the game's rosters nearest a build at a position, rated in a band. */
function nearest(role, height_in, weight, lo, hi) {
  const pool = Object.values(TEAMS).flatMap((t) => [...t["offense"], ...t["defense"]])
    .filter((p) => p["role"] === role && p["skills"] && lo <= p["ovr"] && p["ovr"] <= hi && p["height_in"] && p["weight"]);
  return sorted(pool, (p) => Math.abs(p["height_in"] - height_in) * 5 + Math.abs(p["weight"] - weight))[0];
}
const attrs_of = (p) => Object.fromEntries(gs.keys().map((k, i) => [k, p["skills"][i]]));
/** His projected overall at every position but kicker and punter. */
function table(p) {
  const out = {};
  for (const pos of Object.keys(league.GROUP_OF)) if (pos !== "K" && pos !== "P") out[pos] = pf.project(attrs_of(p), p["height_in"], p["weight"], p["role"], pos);
  return out;
}
const pick = (t, keys) => keys.map((k) => t[k]);

test("a 197-pound safety projects far below himself on the line, and close to himself at the other secondary spots", () => {
  const sizes = pf.sizes();
  assert(sizes["LG"][1][0] > 300 && sizes["LG"][1][0] < 320 && sizes["FS"][1][0] > 185 && sizes["FS"][1][0] < 200, "the real builds were not read");
  const fs = nearest("FS", 73, 197, 45, 52);
  const t = table(fs), own = fs["ovr"];
  assert(t["FS"] === own && own === gs.overall(attrs_of(fs), "FS"), "his own position is exact");
  assert(OL.every((pos) => t[pos] >= 20 && t[pos] <= 39), show(pick(t, OL)));
  assert(t["TE"] >= 25 && t["TE"] <= 49 && t["QB"] >= 25 && t["QB"] <= 39, show([t["TE"], t["QB"]]));
  assert(Math.abs(t["SS"] - own) <= 8 && Math.abs(t["CB"] - own) <= 14, show([t["SS"], t["CB"], own]));
  assert(t["LG"] < t["SS"] && t["LG"] < t["CB"], "a safety is a better corner than a guard");
});

test("a 300-pound defensive tackle is a fair lineman or edge and no corner; a linebacker is close to himself on the edge", () => {
  const dt = nearest("DT", 77, 300, 50, 65);
  let t = table(dt), own = dt["ovr"];
  assert(OL.every((pos) => t[pos] >= own - 28 && t[pos] <= own - 8), show([pick(t, OL), own]));      // his skills discounted, his size fine
  assert(EDGE.every((pos) => t[pos] >= own - 18 && t[pos] <= own), show([pick(t, EDGE), own]));
  assert(t["CB"] <= 25 && t["WR"] <= 30, "a 300-pound tackle is no corner");
  const lb = nearest("MIKE", 75, 240, 48, 60);
  t = table(lb); own = lb["ovr"];
  assert(EDGE.every((pos) => Math.abs(t[pos] - own) <= 6), show([pick(t, EDGE), own]));
  assert(["SAM", "WILL"].every((pos) => Math.abs(t[pos] - own) <= 3), "the other linebacker spots share his skills");
  const wr = nearest("WR", 73, 190, 52, 60);
  t = table(wr); own = wr["ovr"];
  assert(t["CB"] >= own - 22 && t["CB"] <= own - 6, show([t["CB"], own]));                           // a receiver to corner: a middling discount
  assert(OL.every((pos) => t[pos] <= 30), "a 190-pound receiver is no lineman");
});

test("build is charged against the spot: too light costs more than too heavy on the line, and no build costs nothing", () => {
  const hb = nearest("HB", 71, 215, 50, 60);
  const attrs = attrs_of(hb);
  assert(pf.size_penalty(71, 230, "HB") > 0 && pf.size_penalty(71, 230, "HB") <= pf.SIZE_PENALTY && pf.size_penalty(71, 150, "HB") > 12);
  assert(pf.size_penalty(76, 340, "LG") < pf.size_penalty(76, 280, "LG"), "heavy costs a lineman less than light");
  assert(pf.project(attrs, 71, 230, "HB", "FB") >= pf.project(attrs, 71, 190, "HB", "FB") + 5);
  assert(pf.size_penalty(null, null, "LG") === 0 && pf.project(attrs, 71, 215, "HB", "HB") === hb["ovr"]);
});

test("within his group every skill carries over whole; across units unused skills start from a floor and speed is re-read", () => {
  const attrs = attrs_of(nearest("HB", 71, 215, 50, 60));
  assert(same(pf.transfer(attrs, "HB", "FB"), attrs), "a back's skills go whole to fullback");
  const near = pf.transfer(attrs, "HB", "LG"), far = pf.transfer(attrs, "HB", "DT");
  const athletic = (k) => (pf.ATHLETIC instanceof Set ? pf.ATHLETIC.has(k) : pf.ATHLETIC.includes(k));
  assert(Object.keys(near).every((k) => athletic(k) || near[k] >= pf.POSITION_FLOOR["LG"]), "a back's blocking at guard starts from the floor");
  assert(Object.keys(far).every((k) => athletic(k) || far[k] >= pf.POSITION_FLOOR["DT"]));
  equal(near["speed"], gs.to_ours(gs.to_base(attrs["speed"], "RB", "speed"), "OL", "speed"));         // speed is read against the new group
});

const st = season.new_season("ohio-state", "full", 4, undefined, undefined, true);
const me = st["team"];

test("in season: the options show the projection, the change writes his transferred skills, moving back restores him", () => {
  season.advance(st); season.advance(st);
  const team = season.load_teams()[me];
  const fs = team["defense"].find((p) => p["role"] === "FS" && p["skills"] && p["weight"]);
  const bare_guard = gs.overall(season._skills(fs), "LG");                   // the bare formula, which the projection must not exceed
  const want = pf.project(season._skills(fs), fs["height_in"], fs["weight"], "FS", "LG");
  assert(want <= 40 && want <= bare_guard, show([want, bare_guard]));
  const r = season.change_position(st, me, fs["slug"], "LG");
  assert(r["position"] === "LG" && r["moved_from"] === "FS", show(r));
  const moved = season.team_data(st, me)["offense"].find((p) => p["slug"] === fs["slug"]);
  const [ovr, skills] = pf.season_move(fs, "FS", "LG");
  assert(moved["ovr"] === ovr && ovr === want && same(moved["skills"], skills) && !same(moved["skills"], fs["skills"]));
  // the options still project from where he began, and both his spots read the same on the page's scale
  const again = Object.fromEntries(season.position_options(st, me, fs["slug"]).map((o) => [o["pos"], o]));
  assert(again["LG"]["current"] && again["LG"]["overall"] === r["overall"], show([again["LG"], r]));
  const back = season.change_position(st, me, fs["slug"], "FS");
  const restored = season.team_data(st, me)["defense"].find((p) => p["slug"] === fs["slug"]);
  assert(back["moved_from"] === null && same(restored["skills"], fs["skills"]) && restored["ovr"] === fs["ovr"]);
  equal(back["overall"], again["FS"]["overall"]);
});

test("in the offseason: the same projection, a second move starts from where he began, and moving back restores him", () => {
  finished(st);
  offseason.start(st);
  const roster = st["league"]["teams"][me]["roster"];
  const c = roster.find((x) => x["pos"] === "FS" && x["wt"]);
  const attrs = st["league"]["attrs"];
  const r0 = [...c["r"]], o0 = c["o"];
  const want = (pos) => pf.project(league.ratings(c, attrs), c["ht"], c["wt"], "FS", pos);
  const [guard, tight_end] = [want("LG"), want("TE")];
  assert(guard <= 40 && guard <= gs.overall(league.ratings(c, attrs), "LG"));
  const opts = Object.fromEntries(offseason.position_options(st, c["id"]).map((o) => [o["pos"], o]));
  assert(opts["FS"]["current"] && opts["LG"]["overall"] < opts["FS"]["overall"]);
  offseason.change_position(st, c["id"], "LG");
  assert(c["pos"] === "LG" && c["o"] === guard && c["moved_from"] === "FS" && same(c["moved_attrs"], r0));
  const transferred = pf.transfer(Object.fromEntries(attrs.map((k, i) => [k, r0[i]])), "FS", "LG");
  assert(!same(c["r"], r0) && league.overall(c, attrs) === gs.overall(transferred, "LG"), "his ratings are the transferred ones");
  assert(c["r"][attrs.indexOf("run_block")] >= pf.POSITION_FLOOR["LG"]);
  offseason.change_position(st, c["id"], "TE");
  assert(c["pos"] === "TE" && c["moved_from"] === "FS" && c["o"] === tight_end);
  offseason.change_position(st, c["id"], "FS");
  assert(c["pos"] === "FS" && same(c["r"], r0) && c["o"] === o0 && !("moved_from" in c) && !("moved_attrs" in c));
  // once the offseason is over the change is his: no way back to the old ratings
  offseason.change_position(st, c["id"], "SS");
  pf.settle(roster);
  assert(c["pos"] === "SS" && !("moved_attrs" in c) && c["moved_from"] === "FS");
});

await run();
