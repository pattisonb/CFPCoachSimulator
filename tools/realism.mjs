// How realistic are a simulated season's stats? Simulated full seasons (bowls and playoff
// included) against real FBS seasons (data/history/fbs_leaders.json: 2023-2025 national top 100s
// and every team's per-game offense), plus the same seasons at week 8 against the real 2026
// box scores through week 8 (the real season page's stats).
//
// Usage (from the project root):
//     node tools/realism.mjs              # 2 simulated seasons
//     node tools/realism.mjs --seeds 3    # more seasons, steadier numbers
//     node tools/realism.mjs --no-2026    # skip the week-8 comparison
//     node tools/realism.mjs --json out.json   # also write the numbers (for charts)
//     node tools/realism.mjs --check      # the realism gate: exit 1 when an area is outside its margin
// Prints the leaders at ranks 1-100 in each category, the players over the usual marks, the
// net punting leaders, team scoring and offense from best to worst with tempo (plays per
// game) and efficiency (yards per play) split out, and a one-line score per area (mean
// |sim/real - 1| over the ranks shown) to tune against.
import fs from "node:fs";
import path from "node:path";
import * as st from "../engine_js/pystat.js";
import { json_dumps, sorted } from "../engine_js/pyrt.js";
import { ROOT, boot, is_main, f, left, parse_args } from "./pytext.mjs";

// the real seasons' files (an object, so a caller can point one elsewhere, as Python's module names could be)
export const FILES = { HISTORY: path.join(ROOT, "data", "history", "fbs_leaders.json"),
  REAL_2026: path.join(ROOT, "data", "seasons", "real-2026.json") };
export const YEARS = ["2023", "2024", "2025"];
export const SACK_LOSS = 7.5;      // engine/game_config.SACK_YARDS mean: official stats count a sack as a run for its loss
export const RANKS = [1, 5, 10, 25, 50, 100];
export const PUNT_QUALIFY = 40;   // punts in a season to rank among the net punting leaders
export const TEAM_RANKS = ["best", "10th", "25%", "median", "75%", "worst"];

const stat = (s, k) => s[k] ?? 0;
// name, label, sim value from a player's season stats, the real table and column
export const CATS = [["pass_yards", "Passing yards", (s) => stat(s, "pass_yards"), "Yards"],
  ["pass_att", "Pass attempts", (s) => stat(s, "pass_attempts"), ["pass_yards", "Att"]],
  ["rush_yards", "Rushing yards", (s) => stat(s, "rush_yards"), "Yards"],
  ["rush_att", "Carries", (s) => stat(s, "carries"), ["rush_yards", "Att"]],
  ["rec_yards", "Receiving yards", (s) => stat(s, "receiving_yards"), "Yards"],
  ["receptions", "Receptions", (s) => stat(s, "receptions"), ["rec_yards", "Rec."]],
  ["tackles", "Tackles", (s) => stat(s, "solo_tackles") + stat(s, "assisted_tackles"), "Total"],
  ["sacks", "Sacks", (s) => stat(s, "sacks"), "Sacks"],
  ["interceptions", "Interceptions", (s) => stat(s, "interceptions"), "Int."]];
export const MARKS = [["pass_yards", 4000], ["pass_yards", 3000], ["rush_yards", 1000], ["rec_yards", 1000],
  ["sacks", 10], ["tackles", 100], ["interceptions", 5]];

// statistics.mean, and Python's answer for a list with a missing rank in it (nan)
const mean = (xs) => (xs.some((x) => Number.isNaN(x)) ? NaN : st.mean(xs));
const desc = (vals) => sorted(vals, (x) => x, true);

let game = null;
/** The game the seasons are played with (a caller that already has one: tools/long_run.mjs). */
export function use(g) { game = g; }

export function real_values(hist, year, cat) {
  const [name, , , col] = cat;
  const [table, column] = typeof col === "string" ? [name, col] : col;
  const t = hist[year][table];
  const i = t["columns"].indexOf(column);
  return desc(t["rows"].map((r) => r[i]));
}

export function real_teams(hist, year) {
  const sc = hist[year]["team_scoring"];
  const to = hist[year]["team_total_offense"];
  const c = to["columns"];
  const [g, pl, ty, ry, py] = ["G", "Plays", "Total Yards", "Rush Yards", "Pass Yards"].map((k) => c.indexOf(k));
  const sg = sc["columns"].indexOf("G"), sp = sc["columns"].indexOf("Points");
  return { ppg: sc["rows"].filter((r) => r[sg]).map((r) => r[sp] / r[sg]),
    ypg: to["rows"].filter((r) => r[g]).map((r) => r[ty] / r[g]),
    plays: to["rows"].filter((r) => r[g]).map((r) => r[pl] / r[g]),
    ypp: to["rows"].filter((r) => r[pl]).map((r) => r[ty] / r[pl]),
    pass_ypg: to["rows"].filter((r) => r[g]).map((r) => r[py] / r[g]),
    rush_ypg: to["rows"].filter((r) => r[g]).map((r) => r[ry] / r[g]) };
}

export function sim_players(season_stats, teams) {
  const out = {};
  for (const [name, , fn] of CATS) {
    const vals = [];
    for (const [slug, t] of Object.entries(season_stats)) {
      if (teams[slug]["fictional"]) continue;
      for (const p of Object.values(t["players"])) vals.push(fn(p["stats"]));
    }
    out[name] = desc(vals);
  }
  return out;
}

/** Per-game team numbers. The sim keeps sacks apart from rushing, so its sack losses come
 * off rushing here; `official` stats (real box scores) already count them that way. */
export function sim_teams(season_stats, teams, official = false) {
  const out = { ppg: [], ypg: [], plays: [], ypp: [], pass_ypg: [], rush_ypg: [] };
  for (const [slug, t] of Object.entries(season_stats)) {
    if (teams[slug]["fictional"] || !t["games"]) continue;
    const g = t["games"], ts = t["team"];
    // counted the official way: a sack is a rushing play for the yards it lost
    const rush = stat(ts, "Rush Yards") - (official ? 0 : SACK_LOSS * stat(ts, "Sacks Taken"));
    const yards = stat(ts, "Pass Yards") + rush;
    const plays = t["plays"] || (stat(ts, "Pass Attempts") + stat(ts, "Carries") + stat(ts, "Sacks Taken"));
    out["ppg"].push(t["points"] / g);
    out["ypg"].push(yards / g);
    out["plays"].push(plays / g);
    out["ypp"].push(plays ? yards / plays : 0);
    out["pass_ypg"].push(stat(ts, "Pass Yards") / g);
    out["rush_ypg"].push(rush / g);
  }
  return out;
}

export const at = (vals, r) => (vals.length >= r ? vals[r - 1] : NaN);

export function spots(vals) {
  const v = desc(vals);
  const n = v.length;
  return { "best": v[0], "10th": v[9], "25%": v[Math.floor(n / 4)], "median": st.median(v), "75%": v[Math.floor((3 * n) / 4)], "worst": v[n - 1] };
}

export function simulate(seeds, snapshot_week) {
  const { season } = game;
  const ends = [], snaps = [];
  for (const seed of seeds) {
    const t0 = performance.now();
    const s = season.new_season("ohio-state", "full", seed);
    if (snapshot_week) {
      season.advance_to(s, snapshot_week);
      snaps.push(structuredClone(s["season_stats"]));
    }
    season.advance_to(s, 20);
    ends.push(s["season_stats"]);
    console.log(`  season seed ${seed}: ${f((performance.now() - t0) / 1000)}s`);
  }
  season.close_pool();
  return [ends, snaps];
}

/** The text report; with `data`, also fills it with the same numbers for charts (--json). */
export function report(ends, snaps, teams, data = null) {
  data = data === null ? {} : data;
  Object.assign(data, { seasons: ends.length, years: [...YEARS], ranks: [...RANKS], team_ranks: [...TEAM_RANKS],
    leaders: {}, marks: [], teams: {}, tackle_shares: {}, area_off: {} });
  const hist = JSON.parse(fs.readFileSync(FILES.HISTORY, "utf8"));
  const sp = ends.map((e) => sim_players(e, teams));
  const stm = ends.map((e) => sim_teams(e, teams));
  const lines = [`END OF SEASON: ${ends.length} simulated season(s) vs real ${YEARS.join(", ")} (sim / real average, gap)`];
  const area_err = {};
  for (const cat of CATS) {
    const [name, label] = cat;
    const reals = Object.fromEntries(YEARS.map((y) => [y, real_values(hist, y, cat)]));
    const cells = [], errs = [];
    for (const r of RANKS) {
      if (r > 50 && typeof cat[3] !== "string") continue;    // a column read off another's table (the top 100 by yards): its 100th row is not the 100th in attempts or catches
      const sim = mean(sp.map((x) => at(x[name], r)));
      const real = mean(YEARS.map((y) => at(reals[y], r)));
      const gap = real !== 0 ? sim / real - 1 : 0.0;
      if (r <= 50) errs.push(Math.abs(gap));
      cells.push(`#${r} ${f(sim)}/${f(real)} ${f(100 * gap, 0, true)}%`);
      const leader = (data["leaders"][name] ??= { label, sim: [], real: [] });
      leader["sim"].push(sim);
      leader["real"].push(real);
    }
    area_err[name] = mean(errs);
    lines.push(`  ${left(label, 16)} ` + cells.join(" | ") + `   [off ${f(100 * area_err[name])}%]`);
  }
  lines.push("  Players over a mark (sim / real 2023, 2024, 2025):");
  for (const [name, mark] of MARKS) {
    const cat = CATS.find((c) => c[0] === name);
    const sim = mean(sp.map((x) => x[name].filter((v) => v >= mark).length));
    const reals = YEARS.map((y) => real_values(hist, y, cat).filter((v) => v >= mark).length);
    lines.push(`    ${name} >= ${mark}: ${f(sim)} / ${reals.join(", ")}`);
    data["marks"].push({ stat: name, mark, sim, real: reals });
  }
  const shares = {};
  for (const e of ends) {
    for (const [slug, t] of Object.entries(e)) {
      if (teams[slug]["fictional"]) continue;
      for (const p of Object.values(t["players"])) {
        const grp = { MLB: "LB", ROLB: "LB", LOLB: "LB" }[p["position"]] ?? p["position"];
        shares[grp] = (shares[grp] ?? 0) + stat(p["stats"], "solo_tackles") + stat(p["stats"], "assisted_tackles");
      }
    }
  }
  const tot = Object.values(shares).reduce((a, b) => a + b, 0) || 1;
  data["tackle_shares"] = Object.fromEntries(Object.entries(shares).filter(([, v]) => v).map(([k, v]) => [k, v / tot]));
  lines.push("  Tackles by position (real 2026, every FBS team: DL and edge 25%, LB 32%, DB 41%): "
    + sorted(Object.entries(shares), (kv) => -kv[1]).filter(([, v]) => v).map(([k, v]) => `${k} ${f((100 * v) / tot)}%`).join(", "));
  const punters = ends.map((e) => {
    const rows = [];
    for (const [slug, t] of Object.entries(e)) {
      if (teams[slug]["fictional"]) continue;
      for (const p of Object.values(t["players"])) {
        if (stat(p["stats"], "punts") >= PUNT_QUALIFY) rows.push([stat(p["stats"], "punt_net_yards") / p["stats"]["punts"], p["stats"]["punt_yards"] / p["stats"]["punts"]]);
      }
    }
    return desc(rows);
  });
  lines.push(`  Net punting leaders, ${PUNT_QUALIFY}+ punts (net / gross; real FBS #1 nets about 44-46): `
    + [1, 5, 10, 25].map((r) => `#${r} ${f(mean(punters.filter((x) => x.length >= r).map((x) => x[r - 1][0])), 1)} / `
      + `${f(mean(punters.filter((x) => x.length >= r).map((x) => x[r - 1][1])), 1)}`).join(" | ")
    + `   (${f(mean(punters.map((x) => x.length)))} qualify)`);
  lines.push("  Teams per game (" + TEAM_RANKS.join(" / ") + "; mean):");
  const rteams = Object.fromEntries(YEARS.map((y) => [y, real_teams(hist, y)]));
  for (const key of ["ppg", "ypg", "plays", "ypp", "pass_ypg", "rush_ypg"]) {
    const sim = Object.fromEntries(TEAM_RANKS.map((k) => [k, mean(stm.map((t) => spots(t[key])[k]))]));
    const real = Object.fromEntries(TEAM_RANKS.map((k) => [k, mean(YEARS.map((y) => spots(rteams[y][key])[k]))]));
    const smean = mean(stm.map((t) => mean(t[key])));
    const rmean = mean(YEARS.map((y) => mean(rteams[y][key])));
    area_err["team_" + key] = mean(TEAM_RANKS.map((k) => Math.abs(sim[k] / real[k] - 1)));
    data["teams"][key] = { sim: TEAM_RANKS.map((k) => sim[k]), real: TEAM_RANKS.map((k) => real[k]), sim_mean: smean, real_mean: rmean };
    const fmt = (x) => f(x, key === "ypp" ? 2 : 1);
    lines.push(`    ${left(key, 9)} sim  ` + TEAM_RANKS.map((k) => fmt(sim[k])).join(" / ") + `; ${fmt(smean)}`);
    lines.push(`    ${left("", 9)} real ` + TEAM_RANKS.map((k) => fmt(real[k])).join(" / ") + `; ${fmt(rmean)}`
      + `   [off ${f(100 * area_err["team_" + key])}%]`);
  }
  data["area_off"] = { ...area_err };
  lines.push("  Score (mean |gap| at ranks 1-50, teams over all spots): "
    + Object.entries(area_err).map(([k, v]) => `${k} ${f(100 * v)}%`).join(", "));
  if (snaps.length && fs.existsSync(FILES.REAL_2026)) {
    const real = JSON.parse(fs.readFileSync(FILES.REAL_2026, "utf8"));
    const rl = sim_players(real["season_stats"], teams), rt = sim_teams(real["season_stats"], teams, true);
    const sl = snaps.map((x) => sim_players(x, teams));
    const stt = snaps.map((x) => sim_teams(x, teams));
    lines.push("");
    lines.push(`THIS YEAR AT WEEK ${real["current_week"]}: simulated vs the real 2026 box scores (real player lines match a roster player 93% of the time, so real totals run a little low)`);
    for (const cat of CATS) {
      const [name, label] = cat;
      const cells = [];
      for (const r of [1, 10, 25, 50, 100]) {
        const sim = mean(sl.map((x) => at(x[name], r)));
        const rv = at(rl[name], r);
        cells.push(`#${r} ${f(sim)}/${f(rv)}` + (rv !== 0 ? ` ${f(100 * (sim / rv - 1), 0, true)}%` : ""));
      }
      lines.push(`  ${left(label, 16)} ` + cells.join(" | "));
    }
    for (const key of ["ppg", "ypg", "plays", "ypp"]) {
      const sim = Object.fromEntries(TEAM_RANKS.map((k) => [k, mean(stt.map((t) => spots(t[key])[k]))]));
      const rr = spots(rt[key]);
      const fmt = (x) => f(x, key === "ypp" ? 2 : 1);
      lines.push(`  team ${left(key, 6)} sim ` + TEAM_RANKS.map((k) => fmt(sim[k])).join(" / ")
        + " | real " + TEAM_RANKS.map((k) => fmt(rr[k])).join(" / "));
    }
  }
  return lines.join("\n");
}


// ----- the realism gate (the player's ask: the sim is "realistic" when every area is inside its margin) -----
// How far an area's score may sit from the real seasons (mean |sim/real - 1| over its ranks). Set from where the real
// seasons sit from one another and what two simulated seasons' own noise is: the leader boards are steady, the counts
// of rare things (interceptions, sacks) less so.
export const MARGIN = 0.08;                    // *tune* any area not named below
export const MARGINS = { interceptions: 0.12, sacks: 0.10, team_rush_ypg: 0.10 };   // *tune* the noisier ones

/** The areas outside their margin, each as a line ("rec_yards 15% (margin 8%)"); none when the sim is inside. */
export function check(area_off) {
  return Object.entries(area_off).filter(([k, v]) => v > (MARGINS[k] ?? MARGIN)).map(([k, v]) => `${k} ${f(100 * v)}% (margin ${f(100 * (MARGINS[k] ?? MARGIN))}%)`);
}

if (is_main(import.meta.url)) {
  const a = parse_args(process.argv.slice(2), { "check": "flag", "seeds": "int", "no-2026": "flag", "json": "str" },
    { "check": false, "seeds": 2, "no-2026": false, "json": null },
    "usage: node tools/realism.mjs [--check] [--seeds SEEDS] [--no-2026] [--json JSON]\n\nHow realistic are a simulated season's stats? Simulated full seasons (bowls and playoff");
  use(await boot());
  const teams = game.season.load_teams();
  const [ends, snaps] = simulate(Array.from({ length: a["seeds"] }, (_, i) => 101 + 101 * i), a["no-2026"] ? null : 8);
  const data = {};
  console.log(report(ends, snaps, teams, data));
  if (a["json"]) fs.writeFileSync(a["json"], json_dumps(data, { indent: 1 }));
  const out = check(data["area_off"] || {});
  console.log("REALISM GATE: " + (!out.length ? "inside every margin" : "outside on " + out.join("; ")));
  process.exit(a["check"] && out.length ? 1 : 0);
}
