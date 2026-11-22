// Coach Career over many seasons, every step on Auto: does the league stay realistic?
// (docs/superpowers/specs/2026-10-23-career-offseason-design.md, section 8)
//
// Plays one career season after season (the games, recruiting on Auto, the offseason on Auto) and
// records each season: the league's talent (starters' EA overall by position group, team ratings
// and their spread), the balance of power (champions, how much the final top ten turns over),
// rosters (sizes, class make-up), departures (draft, early entrants, portal, quitting), the
// portal, development, coaching changes, recruiting, and the season's stats against real seasons
// (tools/realism.mjs's scores). The 2026 season is the baseline.
//
// Usage (from the project root):
//     node tools/long_run.mjs --seasons 30 --seed 1 --out data/long_run/seed1.json
//     node tools/long_run.mjs --report data/long_run/*.json      # the summary over finished runs
import fs from "node:fs";
import path from "node:path";
import * as st from "../engine_js/pystat.js";
import { json_dumps, sorted, round } from "../engine_js/pyrt.js";
import * as realism from "./realism.mjs";
import { ROOT, boot, is_main, f, left, right, repr, parse_args, glob } from "./pytext.mjs";

let game = null;
/** The game the career is played with. */
export function use(g) { game = g; realism.use(g); TOP25 = null; }

// the 25 strongest programs by recruiting baseline (fixed: the tiers the long run follows). Not the
// 2026 top 25 by team rating: a team at its peak in 2026 (Indiana) regresses to its program over
// the years, which read as "the top getting weaker" when the tier followed the 2026 teams.
let TOP25 = null;
function _top25() {
  if (TOP25 === null) {
    const model = game.recruiting.model()["teams"];
    TOP25 = new Set(sorted(Object.keys(model), (s) => -model[s]["strength"]["baseline"]).slice(0, 25));
  }
  return TOP25;
}

export const GROUP = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", OL: "OL", DL: "DL", MLB: "LB", ROLB: "LB", LOLB: "LB",
  CB: "CB", S: "S", K: "K", P: "P" };

// collections.Counter(items) as a plain object, in the order each was first met
function counter(items) {
  const out = {};
  for (const k of items) out[k] = (out[k] ?? 0) + 1;
  return out;
}
// statistics.mean, and Python's answer when a value is missing (nan)
const mean = (xs) => (xs.some((x) => Number.isNaN(x)) ? NaN : st.mean(xs));
const NAN = NaN;

export function season_metrics(state) {
  const { season } = game;
  const top25 = _top25();
  const teams = season.load_teams();
  const fbs = Object.entries(teams).filter(([, t]) => !t["fictional"]);
  const ovr = fbs.map(([, t]) => t["team_ratings"]["overall"]);
  const p4 = fbs.filter(([s, t]) => season._is_p4(s, t)).map(([, t]) => t["team_ratings"]["overall"]);
  const g5 = fbs.filter(([s, t]) => !season._is_p4(s, t)).map(([, t]) => t["team_ratings"]["overall"]);
  const lineup = (t) => [...t["offense"], ...t["defense"]];
  const have = (p, k) => p[k] !== undefined && p[k] !== null;
  const starters = {}, everyone = [];
  for (const [, t] of fbs) {
    for (const p of lineup(t)) {
      if (have(p, "ovr")) {
        everyone.push(p["ovr"]);
        if (p["in_game"]) (starters[GROUP[p["position"]] ?? p["position"]] ??= []).push(p["ovr"]);
      }
    }
  }
  // by tier: the 25 best programs by 2026 team rating, the rest of the Power 4, the Group of 5
  const tier_of = (s_, t) => (top25.has(s_) ? "top25" : season._is_p4(s_, t) ? "p4" : "g5");
  const tiers = {};
  for (const [s_, t] of fbs) {
    const tier = tier_of(s_, t);
    const st_ = lineup(t).filter((p) => p["in_game"] && have(p, "ovr")).map((p) => p["ovr"]);
    tiers[tier] ??= { starters: [], rating: [], recruits: [] };
    tiers[tier]["starters"].push(st.mean(st_));
    tiers[tier]["rating"].push(t["team_ratings"]["overall"]);
  }
  // who starts, by tier: young players, transfers, players from FCS or junior college (the league's own records)
  const lg = state["league"] || {};
  const info = {};
  for (const t of Object.values(lg["teams"] || {})) for (const c of t["roster"]) info[c["id"]] = c;
  for (const [s_, t] of fbs) {
    const tier = tier_of(s_, t);
    for (const p of lineup(t)) {
      if (p["in_game"]) {
        const c = info[p["slug"]] ?? {};
        (tiers[tier]["young"] ??= []).push(["FR", "SO"].includes((p["class"] || "").slice(0, 2)) ? 1 : 0);
        (tiers[tier]["transfer"] ??= []).push(c["transfer"] && c["transfer"] !== "FCS" ? 1 : 0);
        (tiers[tier]["lower"] ??= []).push(c["transfer"] === "FCS" ? 1 : 0);
        (tiers[tier]["walkon"] ??= []).push(c["walk_on"] ? 1 : 0);
      }
    }
  }
  const rc = state["recruiting"] || {};
  const fbs_by = Object.fromEntries(fbs);
  for (const [pid, s_] of Object.entries(rc["status"] || {})) {
    const school = s_["signed"] ?? null;
    if (school !== null && Object.hasOwn(fbs_by, school)) {
      tiers[tier_of(school, fbs_by[school])]["recruits"].push(rc["prospects"][pid]["composite"]);
    }
  }
  const tier_out = {};
  for (const [k, v] of Object.entries(tiers)) {
    tier_out[k] = { starters: round(st.mean(v["starters"]), 2), rating: round(st.mean(v["rating"]), 2),
      recruit_composite: v["recruits"].length ? round(st.mean(v["recruits"]), 4) : null,
      signed_per_team: round(v["recruits"].length / v["rating"].length, 1) };
    for (const k2 of ["young", "transfer", "lower", "walkon"]) if (v[k2] && v[k2].length) tier_out[k][k2] = round(st.mean(v[k2]), 3);
  }
  const final = state["polls"][String(Math.max(...Object.entries(state["polls"]).filter(([, v]) => v["ap"] && v["ap"].length).map(([w]) => Number.parseInt(w, 10))))];   // the final poll
  const rec = season._records(state, null, true)[state["team"]];
  const data = {};
  realism.report([state["season_stats"]], [], teams, data);
  return {
    "year": season.season_year(state), "record": [rec["wins"], rec["losses"]], "champion": state["champion"] ?? null,
    "top10": (final["ap"] || []).slice(0, 10).map((e) => e["team"]),
    "team_rating": { mean: round(st.mean(ovr), 2), sd: round(st.pstdev(ovr), 2), max: Math.max(...ovr), min: Math.min(...ovr),
      p4: round(st.mean(p4), 2), g5: round(st.mean(g5), 2) },
    "starters_ovr": Object.fromEntries(sorted(Object.entries(starters), (kv) => kv[0]).map(([g, v]) => [g, round(st.mean(v), 2)])),
    "players_ovr": round(st.mean(everyone), 2),
    "stats_off": Object.fromEntries(Object.entries(data["area_off"]).map(([k, v]) => [k, round(v, 4)])), "tiers": tier_out,
    "ppg": round(data["teams"]["ppg"]["sim_mean"], 2), "ypg": round(data["teams"]["ypg"]["sim_mean"], 1),
    "team_spots": Object.fromEntries(Object.entries(data["teams"]).map(([k, v]) => [k, { sim: v["sim"].map((x) => round(x, 1)), real: v["real"].map((x) => round(x, 1)) }])),
    "leaders": Object.fromEntries(Object.entries(data["leaders"]).map(([k, v]) => [k, { sim: v["sim"].map((x) => round(x)), real: v["real"].map((x) => round(x)) }])),
  };
}

/** The living ratings against the start: how many of the starting top 25 are still there, the tiers. */
function _program_drift(state) {
  const { programs } = game.modules;
  const d = JSON.parse(game.files.read_text(programs.HISTORY))["teams"];
  const start_top = new Set(sorted(Object.keys(d), (s) => -d[s]["rating"]).slice(0, 25));
  const now = {};
  for (const [s, t] of Object.entries(state["league"]["teams"])) if (t["program"]) now[s] = t["program"];
  const top = sorted(Object.keys(now), (s) => -now[s]["rating"]).slice(0, 25);
  return { top25_kept: top.filter((s) => start_top.has(s)).length,
    tiers: Object.fromEntries([1, 2, 3, 4, 5].map((k) => [k, Object.values(now).filter((p) => p["tier"] === k).length])),
    top5: top.slice(0, 5) };
}

export function offseason_metrics(state) {
  const { season, offseason } = game;
  const off = state["offseason"];
  const lg = state["league"];
  const kinds = counter(off["departures"].map((d) => d["kind"]));
  const portal = Object.values(off["portal"]["players"]);
  const rosters = Object.values(lg["teams"]);
  const sizes = rosters.map((t) => t["roster"].length);
  const classes = counter(rosters.flatMap((t) => t["roster"].map((p) => p["cls"])));
  const total = Object.values(classes).reduce((a, b) => a + b, 0);
  const teams = season.load_teams();
  const draft = off["departures"].filter((d) => d["kind"] === "draft");
  const p4_picks = draft.filter((d) => season._is_p4(d["team"], teams[d["team"]])).length;
  const signed = Object.values(off["signed"] ?? {});
  // why they entered (offseason.portal_odds): the role, a NIL shortfall, a slipping program, a weak coach;
  // and the starters lost a school by the program's tier (the bottom tiers should lose more)
  const drivers = counter(portal.map((e) => e["driver"] || "role"));
  const tier_of = Object.fromEntries(Object.entries(lg["teams"]).map(([s, t]) => [s, (t["program"] || {})["tier"] ?? 0]));
  const schools = counter(Object.values(tier_of));
  const starters = counter(portal.filter((e) => (e["usage"] ?? null) === "starter").map((e) => tier_of[e["from"]] ?? 0));
  const nil = off["portal_nil"] || {};
  const changes = off["coaching_changes"] ?? [];
  const you = (off["carousel"] || {})["you"] || {};
  return {
    "departures": { ...kinds }, "early_entrants": off["departures"].filter((d) => d["early"]).length,
    "portal_drivers": { ...drivers },
    "portal_starters_by_tier": Object.fromEntries(sorted(Object.keys(schools).map(Number)).filter((k) => k).map((k) => [k, round((starters[k] ?? 0) / schools[k], 2)])),
    "draft_p4_share": round(p4_picks / Math.max(1, draft.length), 3),
    "portal_entrants": portal.length, "portal_signed": portal.filter((e) => e["signed"]).length,
    "portal_nil_spent": nil["spent"] ?? 0, "portal_nil_ai_spent": nil["ai_spent"] ?? 0,
    "portal_nil_carry": nil["carry"] ?? 0,
    "walk_ons": off["report"]["walk_ons"], "released": off["report"]["released"],
    "dev_gain_ea": off["report"]["development"]["mean_gain_ea"],
    "class_sizes": { mean: signed.length ? round(st.mean(signed), 1) : 0, min: signed.length ? Math.min(...signed) : 0,
      max: signed.length ? Math.max(...signed) : 0 },
    "roster": { min: Math.min(...sizes), max: Math.max(...sizes) },
    "classes": Object.fromEntries(sorted(Object.entries(classes), (kv) => kv[0]).map(([k, v]) => [k, round(v / total, 3)])),
    "coaching_changes": counter(changes.filter((c) => (c["reason"] ?? null) !== "hired").map((c) => c["role"])),
    "programs": _program_drift(state),
    "hc_departures": counter(changes.filter((c) => c["role"] === "head_coach" && (c["reason"] ?? null) !== "hired")
      .map((c) => (!c["reason"].startsWith("left for ") || c["reason"].includes("NFL") ? c["reason"] : "left for another job"))),
    "you": Object.fromEntries(Object.entries(you).filter(([k]) => ["security", "met", "fired"].includes(k))),
    "moved_to": off["move_to"] ?? null,
    "staff_changes": ((off["staff"] || {})["changes"] ?? []).length,
    // rosters with no one at a role (offseason.empty_roles: a center, a SAM where the scheme has one): 0 after fill_roles
    "roles_missing": counter(rosters.flatMap((t) => [...offseason.empty_roles(t)])),
    "roles_filled": (off["roles_filled"] || []).length,
  };
}

export function run(seasons, seed, team, out) {
  const { season, offseason } = game;
  const rows = [];
  const now = () => performance.now() / 1000;
  let st_ = season.new_season(team, "full", seed, undefined, undefined, true);
  st_["career"]["settings"]["auto_recruit"] = "season";
  for (let i = 0; i < seasons; i++) {
    const t0 = now();
    season.advance_to(st_, season.FINAL_WEEK);
    const t1 = now();
    const row = season_metrics(st_);
    offseason.run_all(st_);
    row["offseason"] = offseason_metrics(st_);
    row["seconds"] = { season: round(t1 - t0), offseason: round(now() - t1) };
    st_ = offseason.next_season(st_);
    row["seconds"]["rollover"] = round(now() - t1) - row["seconds"]["offseason"];
    rows.push(row);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, json_dumps({ seed, team, seasons: rows }, { indent: 1 }));
    fs.writeFileSync(path.join(path.dirname(out), path.basename(out, path.extname(out)) + ".league.json"), json_dumps(st_["league"]));   // the latest league, to study
    const o = row["offseason"];
    const tr = row["tiers"];
    console.log(`      carousel ${repr(o["hc_departures"] ?? {})}  you ${repr(o["you"] ?? null)}  moved ${repr(o["moved_to"] ?? null)}  programs ${repr(o["programs"] ?? null, { int_keys: true })}`);
    console.log(`      portal drivers ${repr(o["portal_drivers"] ?? null)}  starters lost a school by tier ${repr(o["portal_starters_by_tier"] ?? null, { floats: true, int_keys: true })}`);
    console.log("      tiers " + sorted(Object.entries(tr), (kv) => kv[0]).map(([k, v]) => `${k} st ${f(v["starters"], 1)} rtg ${f(v["rating"], 1)} rec ${f(v["recruit_composite"] || 0, 3)} x${repr(v["signed_per_team"], { floats: true })}`
      + ` young ${f(v["young"] ?? 0, 2)} tr ${f(v["transfer"] ?? 0, 2)} low ${f(v["lower"] ?? 0, 2)} wo ${f(v["walkon"] ?? 0, 2)}`).join("  "));
    console.log(`${row["year"]} champ ${left(row["champion"], 14)} ${team} ${row["record"][0]}-${row["record"][1]}  `
      + `team rtg ${f(row["team_rating"]["mean"], 1)}±${f(row["team_rating"]["sd"], 1)}  QB ${f(row["starters_ovr"]["QB"] ?? 0, 1)} `
      + `OL ${f(row["starters_ovr"]["OL"] ?? 0, 1)}  ppg ${f(row["ppg"], 1)}  stats off `
      + `${f(100 * st.mean(Object.values(row["stats_off"])), 1)}%  draft early ${o["early_entrants"]}  portal ${o["portal_entrants"]}/`
      + `${o["portal_signed"]}  portal NIL ${o["portal_nil_spent"]} (AI ${o["portal_nil_ai_spent"]}, carried ${o["portal_nil_carry"]})  `
      + `walk-ons ${o["walk_ons"]}  (${row["seconds"]["season"]}s + ${row["seconds"]["offseason"]}s)`);
  }
  game.modules.league.forget(st_["id"]);
  season.close_pool();
}

export function report(paths) {
  const runs = paths.map((p) => JSON.parse(fs.readFileSync(p, "utf8")));
  const lines = [`${runs.length} run(s), ${runs.reduce((n, r) => n + r["seasons"].length, 0)} seasons`];
  const base = runs.map((r) => r["seasons"][0]);
  const later = runs.flatMap((r) => r["seasons"].slice(1));
  if (!later.length) return [...lines, "no seasons past 2026 yet"].join("\n");

  const m = (rows, fn) => {
    const vals = rows.map(fn);
    return vals.length ? mean(vals) : NAN;
  };

  lines.push("                         2026     later (mean; first five / last five later seasons)");
  const row = (label, fn, n = 2) => {
    const first = runs.flatMap((r) => r["seasons"].slice(1, 6));
    const last = runs.every((r) => r["seasons"].length > 6) ? runs.flatMap((r) => r["seasons"].slice(-5)) : [];
    lines.push(`  ${left(label, 22)} ${right(f(m(base, fn), n), 8)} ${right(f(m(later, fn), n), 8)}   `
      + `${f(m(first, fn), n)} / ${last.length ? f(m(last, fn), n) : "-"}`);
  };
  row("team rating mean", (s) => s["team_rating"]["mean"]);
  row("team rating sd", (s) => s["team_rating"]["sd"]);
  row("P4 - G5", (s) => s["team_rating"]["p4"] - s["team_rating"]["g5"]);
  row("players overall", (s) => s["players_ovr"]);
  for (const g of ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"]) row(`starters overall ${g}`, (s) => s["starters_ovr"][g] ?? NAN);
  row("points a game", (s) => s["ppg"]);
  row("yards a game", (s) => s["ypg"], 1);
  row("stats off (mean %)", (s) => 100 * st.mean(Object.values(s["stats_off"])), 1);
  for (const k of ["pass_yards", "rush_yards", "rec_yards", "tackles", "sacks", "interceptions", "team_ppg", "team_ypp"]) row(`  ${k} off %`, (s) => 100 * (s["stats_off"][k] ?? NAN), 1);
  const off = [...base, ...later].map((s) => s["offseason"]);
  lines.push("  offseason (every season):");
  const at = (o, a, b) => (o[a] ?? {})[b] ?? 0;
  for (const [label, fn] of [["graduated", (o) => at(o, "departures", "graduated")], ["drafted", (o) => at(o, "departures", "draft")],
    ["early entrants", (o) => o["early_entrants"]], ["draft P4 share", (o) => o["draft_p4_share"]],
    ["portal entrants", (o) => o["portal_entrants"]], ["portal signed", (o) => o["portal_signed"]],
    ["portal NIL spent", (o) => o["portal_nil_spent"] ?? 0], ["portal NIL AI spent", (o) => o["portal_nil_ai_spent"] ?? 0],
    ["portal NIL carried", (o) => o["portal_nil_carry"] ?? 0],
    ["portal for NIL", (o) => at(o, "portal_drivers", "deal")],
    ["portal, program slipping", (o) => at(o, "portal_drivers", "slipping")],
    ["portal, better coach", (o) => at(o, "portal_drivers", "better_coach")],
    ["starters lost, tier 1", (o) => at(o, "portal_starters_by_tier", "1")],
    ["starters lost, tier 3", (o) => at(o, "portal_starters_by_tier", "3")],
    ["starters lost, tier 5", (o) => at(o, "portal_starters_by_tier", "5")],
    ["quit", (o) => at(o, "departures", "quit")], ["walk-ons", (o) => o["walk_ons"]],
    ["roles filled", (o) => o["roles_filled"] ?? 0],
    ["teams without a C", (o) => at(o, "roles_missing", "C")],
    ["teams without a SAM", (o) => at(o, "roles_missing", "SAM")],
    ["class size mean", (o) => o["class_sizes"]["mean"]], ["dev gain EA", (o) => o["dev_gain_ea"]],
    ["HC changes", (o) => at(o, "coaching_changes", "head_coach")],
    ["HC fired", (o) => at(o, "hc_departures", "fired")],
    ["HC retired", (o) => at(o, "hc_departures", "retired")],
    ["HC to NFL", (o) => at(o, "hc_departures", "left for the NFL")],
    ["HC to other jobs", (o) => at(o, "hc_departures", "left for another job")]]) {
    const vals = off.map(fn);
    lines.push(`    ${left(label, 20)} mean ${right(f(st.mean(vals), 2), 8)}  min ${right(f(Math.min(...vals), 2), 8)}  max ${right(f(Math.max(...vals), 2), 8)}`);
  }
  // balance of power: champions and top-ten turnover
  const champs = counter([...base, ...later].map((s) => s["champion"]));
  const turnover = [];
  for (const r of runs) {
    r["seasons"].slice(1).forEach((b, i) => {
      const a = new Set(r["seasons"][i]["top10"]);
      turnover.push(new Set(b["top10"].filter((t) => !a.has(t))).size);
    });
  }
  lines.push(`  champions: ${Object.keys(champs).length} different in ${Object.values(champs).reduce((a, b) => a + b, 0)} seasons; most: `
    + sorted(Object.entries(champs), (kv) => -kv[1]).slice(0, 5).map(([k, v]) => `${k === "null" ? "None" : k} ${v}`).join(", "));
  lines.push(`  new teams in the final top ten a year: mean ${f(st.mean(turnover), 1)} (real 2015-2025: about 4)`);
  const cls = {};
  for (const s of later) for (const [k, v] of Object.entries(s["offseason"]["classes"])) (cls[k] ??= []).push(v);
  lines.push("  roster class make-up (later): " + sorted(Object.entries(cls), (kv) => kv[0]).map(([k, v]) => `${k} ${f(st.mean(v), 3)}`).join(", ")
    + "   (2026 real: FR .151 FRRS .122 SO .086 SORS .149 JR .086 JRRS .153 SR .069 SRRS .185)");
  return lines.join("\n");
}

if (is_main(import.meta.url)) {
  const a = parse_args(process.argv.slice(2), { seasons: "int", seed: "int", team: "str", out: "str", report: "list" },
    { seasons: 10, seed: 1, team: "ohio-state", out: null, report: null },
    "usage: node tools/long_run.mjs [--seasons SEASONS] [--seed SEED] [--team TEAM] [--out OUT] [--report [REPORT ...]]\n\nCoach Career over many seasons, every step on Auto: does the league stay realistic?");
  if (a["report"] !== null) {
    console.log(report(sorted(new Set(a["report"].flatMap((pat) => glob(pat))))));
  } else {
    use(await boot());
    run(a["seasons"], a["seed"], a["team"], a["out"] ? a["out"] : path.join(ROOT, "data", "long_run", `seed${a["seed"]}.json`));
  }
  process.exit(0);
}
