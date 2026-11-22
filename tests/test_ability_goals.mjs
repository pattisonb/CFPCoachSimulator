// Ability goals (career_js/ability_goals.js): every player works toward an ability that suits his position; reaching
// it in games earns it (or its next tier) mid-season, your program's news says so, his page shows the goal and his
// progress, and the offseason writes what he earned into the league's rosters. Recruits arrive with abilities by
// their stars.
// `node tests/test_ability_goals.mjs`
import { start, test, run, assert, equal } from "./harness.mjs";

const game = await start();
const { season } = game;
const { ability_goals: ag, league } = game.modules;

const show = (v) => JSON.stringify(v);
const GAME = { home: "ohio-state", away: "michigan", week: 3, event_id: "e1" };

test("goals spread over the abilities that suit a position, and a player with every one at Platinum has none", () => {
  const qb = new Set(Array.from({ length: 40 }, (_, i) => ag.next_goal("QB", {}, `P${i}|QB`)[0]));
  assert(qb.size >= 3, () => show([...qb]));
  for (const t of qb) assert(ag.FITS["QB"].includes(t), t);
  equal(ag.next_goal("QB", {}, "P1|QB"), ag.next_goal("QB", {}, "P1|QB"), "the same player draws the same goal");
  assert(ag.next_goal("QB", Object.fromEntries(ag.FITS["QB"].map((t) => [t, 4])), "x|QB") === null);
  // a goal on an ability he holds is its next tier
  const [trait, tier] = ag.next_goal("QB", { [ag.FITS["QB"][0]]: 2 }, "y|QB");
  assert(tier === (trait === ag.FITS["QB"][0] ? 3 : 1), () => show([trait, tier]));
});

test("reaching a goal in a game earns the ability, logged with what it took", () => {
  const need = ag.GOALS["route_jumper"][2][0];                    // interceptions for Bronze
  const st = { year: 2026, ability_goals: { "ohio-state": { "A B|S": { trait: "route_jumper", tier: 1, have: need - 1, since: [2026, 1] } } } };
  const lines = { home: { players: [{ name: "A B", position: "S", stats: { interceptions: 1 } }] }, away: { players: [] } };
  const made = ag.after_game(st, GAME, lines, {}, {});
  assert(made.length === 1, () => show(made));
  const e = made[0];
  equal([e["team"], e["player"], e["position"], e["trait"], e["tier"], e["tier_name"], e["week"], e["event_id"]],
    ["ohio-state", "A B", "S", "route_jumper", 1, "Bronze", 3, "e1"]);
  assert(e["how"] === `${need} interception${need === 1 ? "" : "s"}`, e["how"]);
  assert(st["abilities_earned"]["ohio-state"]["A B|S"]["route_jumper"] === 1);
  equal(st["ability_events"], made);
  assert(!("A B|S" in st["ability_goals"]["ohio-state"]), "his next goal starts with his next game");
  // short of it: progress kept, nothing earned
  const far = { year: 2026, ability_goals: { "ohio-state": { "A B|S": { trait: "route_jumper", tier: 4, have: 0, since: [2026, 1] } } } };
  equal(ag.after_game(far, GAME, lines, {}, {}), []);
  assert(far["ability_goals"]["ohio-state"]["A B|S"]["have"] === 1);
});

test("a goal counted in moments (a clutch kick) is earned from the game's moments, and shows on his page as earned", () => {
  const st = { year: 2026, ability_goals: { "ohio-state": { "K K|K": { trait: "ice_water", tier: 1, have: 0, since: [2026, 1] } } } };
  const made = ag.after_game(st, GAME, { home: { players: [{ name: "K K", position: "K", stats: {} }] } }, { home: { "K K|K": { clutch_kick: 1 } } }, {});
  assert(made.length === 1 && made[0]["how"] === "1 clutch kick made", () => show(made));
  const merged = ag.merged_traits(st, "ohio-state", "K K|K", [{ key: "cannon_leg", tier: 2 }]);
  equal(merged.map((t) => [t["key"], t["earned"] ?? false]).sort(), [["cannon_leg", false], ["ice_water", true]]);
});

test("every goal has four rising tiers and words that read with a number", () => {
  for (const [trait, [kind, metric, needs, , words]] of Object.entries(ag.GOALS)) {
    assert(["season", "game", "moment"].includes(kind) && typeof metric === "string", trait);
    assert(needs.length === 4 && needs.every((n, i) => n > 0 && (i === 0 || n >= needs[i - 1])), () => show([trait, needs]));
    assert(words, trait);
  }
  for (const [group, fits] of Object.entries(ag.FITS)) assert(fits.some((t) => t in ag.GOALS), `${group} has no goal`);
  equal(ag.TIER_NAMES, { 1: "Bronze", 2: "Silver", 3: "Gold", 4: "Platinum" });
});

test("a recruit's abilities come by his stars, fit his position and are the same every time he is read", () => {
  const share = (stars) => Array.from({ length: 600 }, (_, i) => ag.recruit_abilities({ id: `r${i}`, stars, ea_position: "WR" })).filter((r) => r.length).length / 600;
  const [three, five] = [share(3), share(5)];
  assert(three > 0.15 && three < 0.35 && five > 0.6 && five < 0.9, () => show([three, five]));
  const p = { id: "r1", stars: 5, ea_position: "WR" };
  equal(ag.recruit_abilities(p), ag.recruit_abilities(p));
  for (let i = 0; i < 600; i++) {
    for (const a of ag.recruit_abilities({ id: `r${i}`, stars: 5, ea_position: "WR" })) {
      assert([1, 2, 3].includes(a["tier"]) && a["name"] && ag.FITS["WR"].includes(a["key"]) && a["tier_name"] === ag.TIER_NAMES[a["tier"]], () => show(a));
    }
  }
  assert(ag.recruit_ab_field({ id: "r3", stars: 5, ea_position: "WR" }).every((x) => x.includes("|")));
});

// ----- a season's first weeks ------------------------------------------------------------------------------------

const WEEKS = 4;
const st = season.new_season("ohio-state", "full", 9, undefined, undefined, true);
season.advance_to(st, WEEKS);

test("abilities are earned in the season's first weeks, a few a team, each with what it took", () => {
  const ev = st["ability_events"] || [];
  assert(ev.length, `no abilities earned in ${WEEKS} weeks`);
  for (const e of ev) assert(e["how"] && ["Bronze", "Silver", "Gold", "Platinum"].includes(e["tier_name"]) && e["name"], () => show(e));
  const per_team = ev.length / new Set(ev.map((e) => e["team"])).size;
  assert(per_team < 8, `too many abilities a team in ${WEEKS} weeks: ${per_team.toFixed(1)}`);
});

test("your program's news has a sentence for each ability your players earned", () => {
  const mine = st["ability_events"].filter((e) => e["team"] === "ohio-state");
  const items = ag.news(st);
  assert(items.length === mine.length);
  for (const n of items) {
    assert(/^(Earned|Moved up to) .+ \((Bronze|Silver|Gold|Platinum)\): .+\.$/.test(n["line"]) && !/None|null|undefined/.test(n["line"]), n["line"]);
    assert(n["kind"] === "ability" && n["name"] && n["position"]);
  }
});

test("a player's page shows his goal and progress, and an ability he earned", () => {
  const teams = season.load_teams();
  const p = teams["ohio-state"]["offense"][0];
  const goal = season.player_profile(st, "ohio-state", p["name"], p["position"])["ability_goal"];
  assert(goal && goal["have"] >= 0 && goal["have"] <= goal["need"] && goal["text"] && goal["name"] && goal["tier_name"], () => show(goal));
  const e = st["ability_events"].find((x) => x["team"] === "ohio-state") || st["ability_events"][0];
  const prof = season.player_profile(st, e["team"], e["player"], e["position"]);
  assert(prof["traits"].some((t) => t["key"] === e["trait"] && t["tier"] >= e["tier"]), () => show(prof["traits"]));
});

test("the offseason writes what was earned into the league's rosters and clears the season's goals", () => {
  const lgd = league.from_base(2027);
  const earned = Object.values(st["abilities_earned"]).reduce((a, t) => a + Object.values(t).reduce((b, v) => b + Object.keys(v).length, 0), 0);
  const copy = { ...st, abilities_earned: structuredClone(st["abilities_earned"]), ability_goals: structuredClone(st["ability_goals"]) };
  const rows = Object.values(lgd["teams"]).flatMap((t) => t["roster"]);
  const before = new Map(rows.map((c) => [c, JSON.stringify(c["ab"] || [])]));
  const n = ag.carry_over(copy, lgd);
  assert(n > 0 && n <= earned, () => show([n, earned]));
  assert(!("abilities_earned" in copy) && !("ability_goals" in copy) && !("ability_upgrades" in copy));
  // the players who earned one hold it on their roster rows now, as "source name|Tier"
  const changed = rows.filter((c) => JSON.stringify(c["ab"] || []) !== before.get(c));
  assert(changed.length > 0 && changed.length <= n, () => show([changed.length, n]));
  const tiers = Object.values(ag.TIER_NAMES);
  for (const c of changed) {
    const was = JSON.parse(before.get(c));
    const gained = c["ab"].filter((a) => !was.includes(a));
    assert(gained.length && gained.every((a) => tiers.includes(a.split("|").at(-1))), () => show([was, c["ab"]]));
  }
  assert(ag.carry_over({}, lgd) === 0, "nothing earned: nothing written");
});

await run();
