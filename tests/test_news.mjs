// League news while simming (sim_js/news.js, GET /api/season/{id}/news): a seeded career simmed four weeks answers
// with items of the known kinds, at most six a week, oldest week first, FBS teams only, each a sentence that links
// something real; an upset of a top-10 team and a change in the top 5 make their items; your own team shows only in
// upsets (the rest of your news is on your own pages); reading the news never changes the season.
// `node tests/test_news.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";
import { json_dumps, parse_ordered } from "../engine_js/pyrt.js";

const game = await start({ env: { SIM_WORKERS: "1", CFP_SEASONS_DIR: "data/seasons-news-test" } });
const { api, season } = game;
const news = game.modules.news;
const show = (v) => JSON.stringify(v);
const copy = (st) => parse_ordered(JSON.stringify(st), [["games"], ["my_boxes"]]);
const WEEKS = 4;

const sid = api.call("POST", "/api/season", { team: "smu", seed: 23, career: true })["id"];
api.call("POST", `/api/season/${sid}/advance`, { to: WEEKS });
while (api.step() !== null) { /* the next week */ }
const st = api.loaded_state();
const fbs = season.fbs_only(season.load_teams());          // the FBS teams' slugs

const STAND_INS = Object.values(season.load_teams()).filter((t) => t["fictional"]).flatMap((t) => [t["name"], t["mascot"]]);

function check_items(state, items) {
  const weeks = items.map((i) => i["week"]);
  assert(weeks.every((w, k) => k === 0 || weeks[k - 1] <= w), show(weeks));
  for (const w of new Set(weeks)) assert(weeks.filter((x) => x === w).length <= news.NEWS_PER_WEEK, `week ${w} has too many items`);
  for (const i of items) {
    assert(news.KINDS.includes(i["kind"]), show(i));
    assert(i["week"] >= 1 && i["week"] <= state["current_week"], show(i));
    const t = i["text"];
    assert(t && /^[A-Z]/.test(t) && t.endsWith("."), t);
    assert(!/\b(None|null|undefined|NaN)\b/.test(t) && !t.includes("FCS") && !STAND_INS.some((n) => t.includes(n)), t);     // no stand-in makes the news
    if ("team" in i) assert(fbs.has(i["team"]), show(i));
    const link = i["link"];
    if (link) {
      assert(["game", "team", "recruit"].includes(link["type"]), show(link));
      if (link["type"] === "game") assert(link["event_id"] in state["games"], show(link));
      else if (link["type"] === "team") assert(fbs.has(link["slug"]), show(link));
      else assert(link["pid"] in state["recruiting"]["prospects"], show(link));
    }
    if (i["kind"] !== "upset") assert(i["team"] !== state["team"], show(i));
  }
}

test("four weeks make news: known kinds, sentences, real links, at most six a week, and the season is unchanged", () => {
  equal(st["current_week"], WEEKS);
  const before = json_dumps(st, { sort_keys: true });
  const items = api.call("GET", `/api/season/${sid}/news?since_week=0`)["items"];
  assert(items.length, "four weeks of a season made no news at all");
  check_items(st, items);
  assert(json_dumps(st, { sort_keys: true }) === before, "reading the news changed the season");
  equal(api.call("GET", `/api/season/${sid}/news?since_week=${WEEKS - 1}`)["items"], items.filter((i) => i["week"] === WEEKS));
  equal(api.call("GET", `/api/season/${sid}/news?since_week=${WEEKS}`)["items"], []);
  let status = null;
  try { api.call("GET", `/api/season/${sid}/news?since_week=x`); } catch (e) { status = e.status; }
  equal(status, 422);
});

test("an unranked team beating a top-10 team is an upset item that links the game", () => {
  const rank = news._ap_rank(st, WEEKS - 1);
  const top10 = (s) => (rank[s] ?? 99) <= 10;
  const g = Object.values(st["games"]).find((x) => x["week"] === WEEKS && x["played"] && fbs.has(x["home"]) && fbs.has(x["away"])
    && top10(x["home"]) !== top10(x["away"]) && (rank[x["home"]] == null || rank[x["away"]] == null));
  assert(g, "no top-10 team played an unranked team this week on this seed");
  const cp = copy(st);
  const cg = cp["games"][g["event_id"]];
  [cg["home_score"], cg["away_score"]] = top10(g["home"]) ? [24, 27] : [27, 24];
  news._cache.clear();
  const items = news.week_news(cp, WEEKS);
  const up = items.find((i) => i["kind"] === "upset" && (i["link"] || {})["event_id"] === g["event_id"]);
  assert(up, show(items));
  assert(up["text"].startsWith("Unranked ") && (up["text"].includes(" stuns No. ") || up["text"].includes(" knocks off No. ")) && up["text"].includes("27-24"), up["text"]);
  check_items(cp, items);
  news._cache.clear();
});

test("a team climbing into the top 5 and a new No. 1 make rankings items", () => {
  const cp = copy(st);
  const ap = cp["polls"][String(WEEKS)]["ap"];
  const before = news._ap_rank(cp, WEEKS - 1);
  const five = ap.find((e) => e["rank"] === 5);
  const climber = ap.find((e) => e["rank"] > 7 && (before[e["team"]] ?? 99) > 5 && e["team"] !== cp["team"]);
  assert(five["team"] !== cp["team"], "your team is No. 5 on this seed");
  [five["team"], climber["team"]] = [climber["team"], five["team"]];
  news._cache.clear();
  let found = news._rankings(cp, season.load_teams(), WEEKS);
  assert(found.some((i) => i["team"] === five["team"] && i["text"].includes("into the top 5 at No. 5")), show(found));
  if ((before[climber["team"]] ?? 99) <= 5) assert(found.some((i) => i["team"] === climber["team"] && i["text"].includes("drops out of the top 5")), show(found));
  const cp2 = copy(st);
  const ap2 = cp2["polls"][String(WEEKS)]["ap"];
  const [one, two] = [ap2.find((e) => e["rank"] === 1), ap2.find((e) => e["rank"] === 2)];
  if (before[two["team"]] !== 1) {
    [one["team"], two["team"]] = [two["team"], one["team"]];
    found = news._rankings(cp2, season.load_teams(), WEEKS);
    assert(found.some((i) => i["text"].includes("takes over at No. 1")), show(found));
  }
  news._cache.clear();
});

test("your own team is in the league's news only when it is part of an upset", () => {
  news._cache.clear();
  for (let w = 1; w <= WEEKS; w++) for (const i of news.week_news(st, w)) assert(i["kind"] === "upset" || i["team"] !== st["team"], show(i));
});

await run();
