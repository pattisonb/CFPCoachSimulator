// One coach, one name, one job (career_js/coach_names.js). The 2026 data lists a head coach who calls his own plays
// twice, as head coach and as offensive coordinator, so a career there once showed the same man as your HC and your
// OC. Now the coordinator is his own man, your coach's name is yours alone, every generated hire avoids every name in
// use, and an older save heals when it is loaded.
// `node tests/test_coach_names.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted, json_dumps, parse_ordered } from "../engine_js/pyrt.js";

const game = await start({ env: { SIM_WORKERS: "1", CFP_SEASONS_DIR: "data/seasons-coach-names-test" } });
const { season, offseason, coaches, career } = game;
const { carousel, coach_names } = game.modules;
const show = (v) => JSON.stringify(v);
const dumps = (v) => json_dumps(v, { sort_keys: true });
const copy = (st) => parse_ordered(JSON.stringify(st), [["games"], ["my_boxes"]]);

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

// A program whose head coach is also listed as its offensive coordinator, and that coach's name (read from the data,
// which must still have such a program for this test to mean anything).
const TEAM = "north-texas";
const DATA = season.load_teams();
const HC = DATA[TEAM]["coaches"]["head_coach"]["name"];
const [FIRST, LAST] = [HC.slice(0, HC.indexOf(" ")), HC.slice(HC.lastIndexOf(" ") + 1)];
/** A name two FBS programs' coaches share in the data: [name, [slug, role], [slug, role]]. */
const SHARED = (() => {
  const seen = {};
  for (const [slug, t] of Object.entries(DATA)) {
    if (t["fictional"]) continue;
    for (const [role, c] of Object.entries(t["coaches"] || {})) {
      if (!c || !c["name"]) continue;
      if (seen[c["name"]] && seen[c["name"]][0] !== slug) return [c["name"], seen[c["name"]], [slug, role]];
      seen[c["name"]] = [slug, role];
    }
  }
  return null;
})();

const created = (first, last) => ({ ...coaches.blank(), first_name: first, last_name: last, id: "0123456789ab", age: 44 });
function league_names(st) {
  const lgd = st["league"];
  const names = Object.values(lgd["teams"]).flatMap((t) => Object.values(t["coaches"]).filter((c) => c && c["name"]).map((c) => c["name"]));
  return [...names, ...((lgd["market"] || {})["coaches"] || []).map((e) => e["name"])];
}
function dupes(names) {
  const n = {};
  for (const x of names) n[x.toLowerCase()] = (n[x.toLowerCase()] || 0) + 1;
  return Object.keys(n).filter((k) => n[k] > 1);
}
/** Nobody on your staff shares a name with you or with each other, and no two share an id. */
function check_staff(st) {
  const staff = st["career"]["staff"];
  const names = [...staff.map((s) => s["name"]), coach_names.player_name(st)];
  equal(dupes(names), [], show(names));
  equal(new Set(staff.map((s) => s["id"])).size, staff.length);
}
const oc_of = (st) => st["career"]["staff"].find((s) => s["role"] === "OC");

test("the data still has what this test is about: a head coach listed as his own coordinator, and a name at two programs", () => {
  equal(DATA[TEAM]["coaches"]["offensive_coordinator"]["name"], HC);
  assert(SHARED, "no name is shared by two programs' coaches");
});

// Your created coach carries the name of the program's real head coach: you are that name, and the real man stays on
// as your OC under his own record, told apart by a middle initial.
test("your coach named like the program's real coach: you keep the name, he gets a middle initial, all ids differ", () => {
  const st = season.new_season(TEAM, "full", 3, undefined, created(FIRST, LAST), true);
  const oc = oc_of(st);
  assert(oc["name"] !== HC && oc["name"].startsWith(`${FIRST} `) && oc["name"].endsWith(` ${LAST}`), show(oc["name"]));
  check_staff(st);
  finished(st);
  offseason.start(st);
  const cs = st["league"]["teams"][TEAM]["coaches"];
  const [hc, lg_oc] = [cs["head_coach"], cs["offensive_coordinator"]];
  assert(hc["name"] === HC && hc["you"] && hc["coach_id"].endsWith(":you"), show([hc["name"], hc["you"], hc["coach_id"]]));
  assert(lg_oc["name"] === oc["name"] && lg_oc["coach_id"] !== hc["coach_id"] && lg_oc !== hc);
  assert(dumps(lg_oc["ratings"]) !== dumps(hc["ratings"]), "the OC keeps his own record");
  equal(dupes(league_names(st)), []);
  const ids = Object.values(st["league"]["teams"]).flatMap((t) => Object.values(t["coaches"]).filter((c) => c).map((c) => c["coach_id"]));
  equal(new Set(ids).size, ids.length);
  check_staff(st);
});

// As the program's own head coach the data's OC slot (the head coach again) is a different man: a generated name,
// the same one in season one and in every season after.
test("as the real head coach, your coordinator is a different man with one fixed name", () => {
  const st = season.new_season(TEAM, "full", 3, undefined, undefined, true);
  const oc1 = oc_of(st)["name"];
  assert(oc1.toLowerCase() !== HC.toLowerCase() && oc1 === coach_names.own_name(TEAM, "offensive_coordinator", new Set([HC])), oc1);
  const line = season._coach_line(st, season.load_teams()[TEAM]);
  assert(line["name"] === HC && !JSON.stringify(line["staff"]["offense"]).includes(HC), show(line));
  finished(st);
  offseason.start(st);
  const cs = st["league"]["teams"][TEAM]["coaches"];
  assert(cs["head_coach"]["name"] === HC && cs["offensive_coordinator"]["name"] === oc1, cs["offensive_coordinator"]["name"]);
  equal(cs["offensive_coordinator"]["previous_job"], coach_names.OWN_STAFF_JOB);
  equal(dupes(league_names(st)), []);
  // the two programs' coaches with one name: one keeps it, the other is told apart
  const [name] = SHARED;
  const [first, last] = [name.slice(0, name.indexOf(" ")), name.slice(name.lastIndexOf(" ") + 1)];
  const both = sorted(league_names(st).filter((n) => n.startsWith(first) && n.endsWith(last)));
  assert(both.length === 2 && both.includes(name) && both[0] !== both[1], show(both));
  check_staff(st);
});

// A whole offseason with every coordinator on the move (the carousel, the coach market, your staff's openings)
test("after an offseason of heavy movement no two coaches share a name, and your staff are the league's coordinators", () => {
  const saved = carousel.COORD_MOVE;
  carousel.COORD_MOVE = 0.6;
  try {
    const st = season.new_season(TEAM, "full", 8, undefined, created(FIRST, LAST), true);
    finished(st);
    offseason.start(st);
    for (const s of st["career"]["staff"]) s["contract_until"] = st["offseason"]["year"] - 1;
    st["offseason"]["auto"] = true;
    while (st["offseason"]["stage"] !== "ready") offseason.advance(st);
    equal(dupes(league_names(st)), []);
    const hires = st["offseason"]["carousel"]["changes"].filter((c) => c["reason"] === "hired");
    assert(hires.length >= 20, String(hires.length));
    check_staff(st);
    const mine = st["league"]["teams"][TEAM]["coaches"];
    for (const s of st["career"]["staff"]) {
      const key = offseason.STAFF_ROLES[s["role"]];
      if (key) equal(mine[key]["name"], s["name"]);
    }
  } finally {
    carousel.COORD_MOVE = saved;
  }
});

// A save from before the fix: the league's OC and your staff's OC both carry the head coach's name, two recruiters
// share an id, a recruiter is named like a coach, one name is at two programs and twice in the market.
test("an older save with doubled names and ids heals on load, the same way every time, and an uploaded save too", () => {
  const st = season.new_season(TEAM, "full", 3, undefined, undefined, true);
  finished(st);
  offseason.start(st);
  const lgd = st["league"];
  const cs = lgd["teams"][TEAM]["coaches"];
  cs["offensive_coordinator"]["name"] = HC;                  // as the data has it, and as older careers kept it
  delete cs["head_coach"]["you"];
  const staff = st["career"]["staff"];
  oc_of(st)["name"] = HC;
  staff[3]["id"] = staff[2]["id"];
  staff[4]["name"] = lgd["teams"]["texas"]["coaches"]["head_coach"]["name"];
  const [name, [s1, r1], [s2, r2]] = SHARED;
  lgd["teams"][s1]["coaches"][r1]["name"] = name;
  lgd["teams"][s2]["coaches"][r2]["name"] = name;
  carousel.market(st);
  const mk = lgd["market"]["coaches"];
  mk[0]["name"] = mk[1]["name"];
  const old = copy(st);
  season.save_season(st);
  const back = season.load_season(st["id"]);
  const again = season.load_season(st["id"]);
  const bcs = back["league"]["teams"][TEAM]["coaches"];
  assert(bcs["head_coach"]["name"] === HC && bcs["offensive_coordinator"]["name"] !== HC);
  equal(oc_of(back)["name"], bcs["offensive_coordinator"]["name"]);
  equal(dupes(league_names(back)), []);
  check_staff(back);
  assert(dumps(back["league"]) === dumps(again["league"]) && dumps(back["career"]["staff"]) === dumps(again["career"]["staff"]), "two loads healed differently");
  const before = dumps(back);
  coach_names.distinct(back);
  assert(dumps(back) === before, "healing twice changed something");
  const [up] = career.read_save(career.export_save(old, false));
  assert(dumps(up["league"]) === dumps(back["league"]), "an uploaded save healed differently");
  assert(dumps(up["career"]["staff"]) === dumps(back["career"]["staff"]));
});

test("a first-season save (no league yet) with the head coach's name on your coordinator heals too", () => {
  const st = season.new_season(TEAM, "full", 3, undefined, undefined, true);
  const want = oc_of(st)["name"];
  oc_of(st)["name"] = HC;
  coach_names.distinct(st);
  equal(oc_of(st)["name"], want);
});

await run();
