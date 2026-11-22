// Where a portal entrant you recruited went, and why not you (the player's report: "I offered a guy in the transfer
// portal and was his clear favorite, but then I guess I didn't get him and I don't know where he went"). An entrant
// picks among the offering schools with room. With portal spots showing on the page he has room with you, and as his
// clear favorite he signs with you. With your roster full the board and his profile say "No Room on Your Roster";
// he signs elsewhere and his History, the week's news, the What Changed report and the recap's Who Got Away say
// where and why. A transfer's call and visit are the same plain conversation a recruit's are.
// Through the API, as the page calls it. `node tests/test_portal_outcome.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { Random, sorted } from "../engine_js/pyrt.js";

const game = await start();
const { season, recruiting, api } = game;
const { persona, scenes } = game.modules;

const ME = "ohio-state";
const show = (v) => JSON.stringify(v);
const G = (sid, p) => api.call("GET", `/api/season/${sid}/${p}`);
const P = (sid, p, body = {}) => api.call("POST", `/api/season/${sid}/${p}`, body);

/** tests/test_offseason's `finished`: every game played (the better team usually wins), every school's class signed, season over. */
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

/** A new career with its season over and the transfer portal's first week open. */
function at_the_portal() {
  const sid = api.call("POST", "/api/season", { team: ME, mode: "full", seed: 11, career: true })["id"];
  finished(api.loaded_state()); api._save_loaded();
  G(sid, "offseason");
  while (api.loaded_state()["offseason"]["stage"] !== "portal_w1") P(sid, "offseason/advance");
  return sid;
}

const by_rank = (rc, dir = 1) => Object.keys(rc["prospects"]).sort((a, b) => dir * (rc["prospects"][a]["rank"] - rc["prospects"][b]["rank"]));
/** The best entrant not from your school. */
const target = () => { const rc = api.loaded_state()["recruiting"]; return by_rank(rc).find((q) => rc["prospects"][q]["from"] !== ME); };
const board_row = (sid, pid) => G(sid, "recruiting")["board"].find((b) => b["id"] === pid);

/** On your board, offered, and his clear favorite: far ahead of every school on his list. */
function recruit(sid, pid) {
  P(sid, "board", { pid, on: true });
  P(sid, "recruit", { pid, action: "offer", pitch: "playing_time", nil: 0 });
  api.loaded_state()["recruiting"]["lists"][pid][ME] = 1000.0;
  api._save_loaded();
}

/** Fill n of your portal spots with entrants nobody is chasing (signed with you outright). */
function sign_to_me(n, skip) {
  const rc = api.loaded_state()["recruiting"];
  const free = by_rank(rc, -1).filter((q) => !skip.includes(q) && !rc["status"][q]["signed"] && rc["prospects"][q]["from"] !== ME);
  for (const q of free.slice(0, n)) Object.assign(rc["status"][q], { committed: ME, signed: ME });
  rc["commits_v"] = (rc["commits_v"] ?? 0) + 1;
  api._save_loaded();
}

/** Advance portal weeks until he signs: [school, the portal week he decided at]. */
function until_signed(sid, pid) {
  for (let i = 0; i < 4; i++) {
    const week = api.loaded_state()["recruiting"]["week"];
    const v = P(sid, "offseason/advance");
    if (v["stage"] === "development") return [api.loaded_state()["offseason"]["portal"]["players"][pid]["signed"], week];
    const signed = api.loaded_state()["recruiting"]["status"][pid]["signed"];
    if (signed) return [signed, week];
  }
  throw new Error("the portal never closed");
}

const first = at_the_portal();

test("a transfer's call and visit are the same plain conversation, and his decider is never a grandmother or a high school coach", () => {
  const st = api.loaded_state(), rc = st["recruiting"];
  rc["hours"][ME] = 100000;
  const pids = by_rank(rc).filter((q) => rc["prospects"][q]["from"] !== ME).slice(5, 25);     // (the best entrant is the next test's)
  let played = 0;
  pids.forEach((pid, i) => {
    const action = i % 3 === 0 ? "hc_visit" : "call";
    let sc;
    try { sc = recruiting.act(st, ME, pid, action)["scene"]; } catch (e) { if (e instanceof recruiting.RecruitingError) return; throw e; }
    assert(sc["turns"][0]["text"] === `${action === "hc_visit" ? "In-home visit" : "Call"} with ${rc["prospects"][pid]["name"]}.`);
    const d = persona.of(st, pid)["decider"];
    assert(persona.PORTAL_DECIDERS.includes(d), d);
    const topics = [...new Set([...rc["prospects"][pid]["priorities"], ...recruiting.PITCHES])].slice(0, 3);
    sc = recruiting.act(st, ME, pid, "present", null, 0, sc["id"], null, topics)["scene"];
    if (sc["question"]) recruiting.act(st, ME, pid, "answer", null, 0, sc["id"], "straight");
    const r = recruiting.act(st, ME, pid, "pitch", topics[0], 0, sc["id"])["reaction"];
    const text = [...sc["turns"].map((t) => t["text"]), r["you"], r["text"]].join(" ");
    assert(!/\{|\b(None|null|undefined|NaN)\b/.test(text), text);
    if (action === "hc_visit") assert(sc["turns"].some((t) => t["text"].startsWith(`${scenes.ASK_WHO[d]} `)), "the one who decides speaks to the money");
    played += 1;
  });
  assert(played >= 10, () => String(played));
  api._save_loaded();
});

test("with portal spots showing he has room with you, and as his clear favorite he signs with you", () => {
  const sid = first;
  const pid = target();
  recruit(sid, pid);
  const room = G(sid, "recruiting")["open_spots"];          // nothing signed yet: all your portal room
  sign_to_me(Math.floor((room + 1) / 2), [pid]);
  const v = G(sid, "recruiting");
  assert(v["open_spots"] > 0, () => String(v["open_spots"]));
  // (the bug: your room counted each transfer you signed twice, so half your spots filled left him none)
  assert(recruiting._Room(api.loaded_state())(ME, pid), "the page shows spots left: he must have room with you");
  assert(board_row(sid, pid)["no_room"] === null && G(sid, `prospect/${pid}`)["public"]["no_room"] === null);
  const [school, week] = until_signed(sid, pid);
  assert(school === ME, `his clear favorite with ${v["open_spots"]} spots showing, he signed with ${school} in week ${week}`);
});

test("with your roster full the page says so, he signs elsewhere, and everything that reports it says where and why", () => {
  const sid = at_the_portal();
  const pid = target();
  recruit(sid, pid);
  // an entrant nobody else offered, offered by you too: he goes unsigned (or walks on) at the close
  let rc = api.loaded_state()["recruiting"];
  const offered = new Set(Object.values(rc["offers"]).flat());
  const lone = by_rank(rc, -1).find((q) => !offered.has(q) && rc["prospects"][q]["from"] !== ME);
  P(sid, "board", { pid: lone, on: true });
  P(sid, "recruit", { pid: lone, action: "offer", pitch: "playing_time", nil: 0 });
  sign_to_me(G(sid, "recruiting")["open_spots"], [pid, lone]);
  assert(G(sid, "recruiting")["open_spots"] === 0);
  // before: the board row and his profile say there is no room, in a Title Case chip with a sentence
  let b = board_row(sid, pid);
  assert(b["no_room"] && b["no_room"]["label"] === "No Room on Your Roster", () => show(b["no_room"]));
  assert(/^[A-Z].*\.$/.test(b["no_room"]["tip"]), b["no_room"]["tip"]);
  equal(G(sid, `prospect/${pid}`)["public"]["no_room"], b["no_room"]);
  const [school, week] = until_signed(sid, pid);
  assert(school && school !== ME, String(school));
  const name = recruiting.school_name(school);
  const want = `He signed with ${name}: you had no roster spot left for him.`;
  if (api.loaded_state()["recruiting"]["portal"]) {
    // the week's step: his History, the news and the What Changed report say where he went and why
    b = board_row(sid, pid);
    assert(b["history"].some((h) => h["line"] === want && h["portal_week"] === week), () => show(b["history"].slice(0, 3)));
    const news = G(sid, "recruiting")["recap"].filter((e) => e["pid"] === pid && e["kind"] === "signed");
    assert(news.length && news.at(-1)["school"] === school && news.at(-1)["reason"] === "You had no roster spot left for him.", () => show(news));
    const rep = G(sid, "recruiting/report")["reports"].at(-1);
    assert(rep["week"] === week);
    const ev = rep["rows"].find((r) => r["pid"] === pid)["events"].find((e) => e["kind"] === "signed");
    equal([ev["school_name"], ev["reason"]], [name, "You had no roster spot left for him."]);
    const away = G(sid, "offseason")["portal"]["away"];
    assert(away.some((r) => r["id"] === pid && r["week"] === week && r["line"] === want), () => show(away));
    while (api.loaded_state()["offseason"]["stage"] !== "development") P(sid, "offseason/advance");
  }
  // after the portal closes: the recap's Who Got Away keeps where he went and why
  const away = Object.fromEntries(G(sid, "offseason")["portal_recap"]["away"].map((r) => [r["id"], r]));
  assert(away[pid] && away[pid]["to"] === school && away[pid]["line"] === want, () => show(away[pid]));
  const e = api.loaded_state()["offseason"]["portal"]["players"][lone];
  const r = away[lone];
  assert(e["signed"] !== ME, "your roster was full");
  assert(r, "an entrant you offered who went elsewhere is in Who Got Away");
  if (!e["signed"]) equal([r["to"], r["to_name"], r["line"]], [null, "out of FBS", "He went unsigned and is leaving FBS."]);
  else if (r["walk_on"]) equal(r["line"], `He went unsigned and took a walk-on spot at ${recruiting.school_name(e["signed"])}.`);
  else assert(r["line"].startsWith(`He signed with ${recruiting.school_name(e["signed"])}`), r["line"]);
  for (const x of Object.values(away)) {
    assert(/^[A-Z].*\.$/.test(x["line"]) && !/\b(None|null|undefined|NaN)\b/.test(x["line"]), () => show(x));
  }
});

await run();
