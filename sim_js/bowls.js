// Bowl season: the 2026-27 lineup (data/bowls.json, built by fetch_bowls.py), bowl
// selection by conference tie-ins, and the names and sites of the playoff games.
//
// Selection follows how the real process works in practice: once the 12-team playoff field
// is set, every remaining team with six wins is bowl-eligible (five-win teams fill empty
// spots, as the NCAA allows, and only once no six-win team is left for a slot). Bowls pick in order of payout; each bowl fills its two slots
// from its contracted conferences, taking the best remaining team there (by the committee's
// final order, then record and rating), and falls back to the best remaining team from
// anywhere when a conference's pool is empty. Two teams from the same conference are not
// paired. Sites are the real ones; dates place each bowl in the playoff weeks.
//
// Ported from sim/bowls.py by engine_js/PORTING.md's rules.
import { int, sorted, get, truthy } from "../engine_js/pyrt.js";
import { read_json } from "../engine_js/files.js";
import { modules } from "../engine_js/modules.js";

const BOWLS_FILE = "data/bowls.json";

// Selection order when the article's payout is missing (roughly by payout and prestige).
const PRIORITY = ["Citrus Bowl", "ReliaQuest Bowl", "Alamo Bowl", "Holiday Bowl", "Pop-Tarts Bowl", "Gator Bowl", "Music City Bowl",
  "Texas Bowl", "Las Vegas Bowl", "Sun Bowl", "Liberty Bowl", "Duke's Mayo Bowl", "Pinstripe Bowl", "Military Bowl",
  "Fenway Bowl", "Independence Bowl", "Birmingham Bowl", "Armed Forces Bowl", "First Responder Bowl", "Cactus Bowl",
  "Arizona Bowl", "Hawaii Bowl", "New Mexico Bowl", "Frisco Bowl", "Boca Raton Bowl", "Gasparilla Bowl", "Cure Bowl",
  "Myrtle Beach Bowl", "Famous Idaho Potato Bowl", "New Orleans Bowl", "68 Ventures Bowl", "Poinsettia Bowl",
  "Puerto Rico Bowl", "Frisco Football Classic", "Salute to Veterans Bowl"];
// Fallback tie-ins when the article has none (2026-27 contracts as reported on each bowl's page or the conference's).
const DEFAULT_TIE_INS = {
  "Citrus Bowl": ["SEC", "Big Ten"], "ReliaQuest Bowl": ["SEC", "Big Ten"], "Alamo Bowl": ["Big 12", "Pac-12"],
  "Holiday Bowl": ["ACC", "Pac-12"], "Pop-Tarts Bowl": ["ACC", "Big 12"], "Gator Bowl": ["ACC", "SEC"],
  "Music City Bowl": ["SEC", "Big Ten"], "Texas Bowl": ["Big 12", "SEC"], "Las Vegas Bowl": ["Big Ten", "Pac-12"],
  "Sun Bowl": ["ACC", "Pac-12"], "Liberty Bowl": ["Big 12", "SEC"], "Duke's Mayo Bowl": ["ACC", "SEC"],
  "Pinstripe Bowl": ["ACC", "Big Ten"], "Military Bowl": ["ACC", "American Athletic Conference"], "Fenway Bowl": ["ACC", "American Athletic Conference"],
  "Independence Bowl": ["Pac-12", "American Athletic Conference"], "Birmingham Bowl": ["SEC", "American Athletic Conference"],
  "Armed Forces Bowl": ["Big 12", "American Athletic Conference"], "First Responder Bowl": ["Big 12", "American Athletic Conference"],
  "Cactus Bowl": ["Big 12", "Big Ten"], "Arizona Bowl": ["Mountain West", "MAC"], "Hawaii Bowl": ["Mountain West", "American Athletic Conference"],
  "New Mexico Bowl": ["Mountain West", "Conference USA"], "Frisco Bowl": ["American Athletic Conference", "Mountain West"],
  "Boca Raton Bowl": ["American Athletic Conference", "MAC"], "Gasparilla Bowl": ["ACC", "American Athletic Conference"],
  "Cure Bowl": ["Sun Belt", "American Athletic Conference"], "Myrtle Beach Bowl": ["Sun Belt", "MAC"],
  "Famous Idaho Potato Bowl": ["Mountain West", "MAC"], "New Orleans Bowl": ["Sun Belt", "Conference USA"],
  "68 Ventures Bowl": ["Sun Belt", "MAC"], "Poinsettia Bowl": ["Mountain West", "Pac-12"], "Puerto Rico Bowl": ["Conference USA", "MAC"],
  "Frisco Football Classic": ["Conference USA", "Mountain West"], "Salute to Veterans Bowl": ["Conference USA", "Sun Belt"],
};
const G5 = new Set(["American Athletic Conference", "Conference USA", "MAC", "Mountain West", "Pac-12", "Sun Belt"]);
const INDEPENDENT = new Set(["FBS Independents", "FBS Independent", "Independent", "Independents"]);   // the team file says "FBS Independent" (UConn)

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// Python's \s (its str.isspace): JavaScript's \s has U+FEFF and lacks U+001C-U+001F and U+0085
const WS = "[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const DATE_RE = new RegExp(`^(Dec|Jan)[\\p{L}\\p{N}_]*${WS}+([0-9]+)`, "u");
const PAYOUT_RE = new RegExp(`\\$([0-9,.]+)${WS}*(million|M)?`, "i");

export function load_bowls() {
  // (Python parses the file at every call: a caller gets a copy of its own here too)
  let data;
  try {
    data = read_json(bowls.BOWLS_FILE);
  } catch (e) {
    return { playoff: [], bowls: [] };
  }
  return structuredClone(data);
}

export function bowl_week(date) {
  // Place a bowl date in the season's playoff weeks: 17 (through Dec 24, with the first
  // round), 18 (Dec 26-31, with the quarterfinals), 19 (January bowls, with the semifinals).
  if (!truthy(date)) return 18;
  const m = DATE_RE.exec(date);
  if (!m) return 18;
  const month = m[1], day = int(Number(m[2]));
  if (month === "Jan") return 19;
  return day <= 24 ? 17 : 18;
}

export function _payout(b) {
  const m = PAYOUT_RE.exec(get(b, "payout") || "");
  if (!m) return 0.0;
  const text = m[1].replaceAll(",", "");
  // float(text): digits with at most one point ("5." and ".5" are numbers, "." and "1.2.3" are not)
  if (!/^([0-9]+\.?[0-9]*|\.[0-9]+)$/.test(text)) throw new Error(`could not convert string to float: '${text}'`);
  const v = Number(text);
  return m[2] !== undefined ? v * 1e6 : v;
}

export function ordered_bowls(data) {
  // The bowls in selection order: PRIORITY first, then by payout.
  const pri = new Map(bowls.PRIORITY.map((name, i) => [name, i]));
  return sorted(data["bowls"], (b) => [pri.has(b["bowl"]) ? pri.get(b["bowl"]) : 99, -bowls._payout(b)]);
}

export function tie_ins_for(b) {
  // The two conference slots used for selection: the curated current-cycle table
  // (Wikipedia's infobox mixes in historical tie-ins), else whatever the article gave.
  let ties = own(bowls.DEFAULT_TIE_INS, b["bowl"]) ? [...bowls.DEFAULT_TIE_INS[b["bowl"]]] : [];
  if (ties.length < 2) {
    const more = [];
    for (const t of get(b, "tie_ins") || []) if (truthy(t) && !ties.includes(t)) more.push(t);   // (against the table's, as Python's does)
    ties = ties.concat(more);
  }
  return ties.length >= 2 ? ties.slice(0, 2) : ties.concat(Array(2 - ties.length).fill("At-large"));
}

export function select_bowls(records, teams, playoff_field, order, ratings) {
  // Return bowl matchups: [{"bowl", "name", "date", "time", "site", "week", "home", "away", "tie_ins"}].
  // (`playoff_field` is Python's set: a Set here, or a list of the same slugs)
  const data = bowls.load_bowls();
  const field = playoff_field instanceof Set ? playoff_field : new Set(playoff_field);
  const pos = new Map(order.map((t, i) => [t, i]));

  function quality(slug) {
    // Sort key, best first: the committee's order, then win share, then rating.
    const r = records[slug];
    const g = r["wins"] + r["losses"];
    return [pos.has(slug) ? pos.get(slug) : 999, -(g ? r["wins"] / g : 0), -get(ratings, slug, 0)];
  }

  const eligible = new Map();
  for (const [slug, t] of Object.entries(teams)) {
    if (truthy(t["fictional"]) || field.has(slug)) continue;
    const r = records[slug];
    if (r["wins"] >= 6) eligible.set(slug, 6);
    else if (r["wins"] === 5) eligible.set(slug, 5);
  }
  const pools = new Map();
  for (const slug of sorted(eligible.keys(), quality)) {
    const conf = teams[slug]["conference"];
    if (!pools.has(conf)) pools.set(conf, []);
    pools.get(conf).push(slug);
  }
  const taken = new Set();

  function best_from(conf, exclude_conf, min_wins) {
    let candidates;
    if (conf === "At-large" || conf === "Group of Five") {
      const confs = [...pools.keys()].filter((c) => (conf === "At-large" || bowls.G5.has(c)) && c !== exclude_conf);
      candidates = sorted(confs.flatMap((c) => pools.get(c)), quality);
    } else if (conf === "Notre Dame" || conf === "Army" || conf === "Navy" || conf === "BYU") {
      const slug = conf.toLowerCase().replaceAll(" ", "-");
      candidates = eligible.has(slug) ? [slug] : [];
    } else if (conf === "Independent") {
      candidates = [...pools.keys()].filter((c) => bowls.INDEPENDENT.has(c)).flatMap((c) => pools.get(c));
    } else {
      candidates = [...(pools.has(conf) ? pools.get(conf) : [])];
    }
    for (const s of candidates) {
      if (!taken.has(s) && eligible.get(s) >= min_wins && teams[s]["conference"] !== exclude_conf) return s;
    }
    return null;
  }

  const out = [];
  for (const b of bowls.ordered_bowls(data)) {
    const ties = bowls.tie_ins_for(b);
    const picks = [];
    for (const conf of ties) {
      const other_conf = picks.length ? teams[picks[0]]["conference"] : null;
      // a missing tie-in is filled from the same tier first (a Group of Five bowl takes
      // another Group of Five team before a leftover power-conference team); every slot takes a six-win team from
      // anywhere before a five-win one (a five-win tie-in team never goes ahead of a six-win team left out)
      const fallback = bowls.G5.has(conf) ? "Group of Five" : "At-large";
      let s = null;
      for (const min_wins of [6, 5]) {
        s = best_from(conf, other_conf, min_wins) || best_from(fallback, other_conf, min_wins)
          || best_from("At-large", other_conf, min_wins);
        if (s) break;
      }
      if (s) {
        picks.push(s);
        taken.add(s);
      }
    }
    if (picks.length < 2) for (const s of picks) taken.delete(s);
    const filled = picks.length === 2;
    out.push({ bowl: b["bowl"], name: b["name"], date: get(b, "date"), time: get(b, "time"), site: get(b, "site"),
      week: bowls.bowl_week(get(b, "date")), home: filled ? picks[0] : null, away: filled ? picks[1] : null,
      tie_ins: ties, unfilled: !filled });
  }
  return out;
}

export function playoff_sites(seeds, conference_of) {
  // Which New Year's Six bowl hosts each quarterfinal, the semifinal bowls, and the
  // championship site, from data/bowls.json. Quarterfinal bowls go to the top four seeds
  // by traditional affinity (Rose: Big Ten/Pac-12, Peach: SEC/ACC, Cotton: Big 12/SEC,
  // Fiesta: the rest), seed 1 choosing first.
  // (`seeds` is Python's {seed number: team}: an object keyed 1..12 or a Map of the same)
  const data = bowls.load_bowls();
  const qf = data["playoff"].filter((p) => get(p, "round") === "quarterfinal");
  const sf = data["playoff"].filter((p) => get(p, "round") === "semifinal");
  const champ = data["playoff"].find((p) => get(p, "round") === "championship") ?? null;
  const affinity = { "Rose Bowl": ["Big Ten", "Pac-12"], "Peach Bowl": ["SEC", "ACC"], "Cotton Bowl": ["Big 12", "SEC"],
    "Fiesta Bowl": ["Big 12", "Mountain West"], "Sugar Bowl": ["SEC", "Big 12"], "Orange Bowl": ["ACC", "SEC"] };
  const remaining = [...qf];
  const sites = {};
  for (const seed of [1, 2, 3, 4]) {
    const team = seeds instanceof Map ? (seeds.has(seed) ? seeds.get(seed) : null) : get(seeds, seed);
    const conf = team === null ? null : get(conference_of, team);
    const pick = remaining.find((p) => (own(affinity, p["bowl"]) ? affinity[p["bowl"]] : []).includes(conf))
      || (remaining.length ? remaining[0] : null);
    if (pick) {
      remaining.splice(remaining.indexOf(pick), 1);
      sites[`qf-${seed}`] = pick;
    }
  }
  ["sf-1", "sf-2"].forEach((key, i) => {
    if (i < sf.length) sites[key] = sf[i];
  });
  if (champ) sites["final"] = champ;
  return sites;
}

export const bowls = {
  BOWLS_FILE, PRIORITY, DEFAULT_TIE_INS, G5, INDEPENDENT,
  load_bowls, bowl_week, _payout, ordered_bowls, tie_ins_for, select_bowls, playoff_sites,
};

modules.bowls = bowls;
