import type { BoxScore, BoxSide } from "./types.ts";
import { titleCase } from "./format.ts";

// A played game in full (GET /api/season/{id}/game/{event_id}): the two sides with their players, the scoring plays
// and every drive with its play log. The box score reads it as tables; Game Day replays it a play at a time, so the
// log is turned into "moments" here: each with its sentence, the situation and the score after it.
// Ported from the old UI (web/season.js gdDescribe, gdMoments; web/gameview.js teamTotals).

export type SideKey = "home" | "away";

export interface BoxPlayer {
  name: string;
  position: string;
  unit: string;
  starter: boolean;
  stats: Record<string, number>;
  injury: { type: string } | null;
}

export interface GameSide extends BoxSide {
  team_events?: Record<string, number>;
  players: BoxPlayer[];
}

export interface ScoringPlay {
  quarter: number;
  clock: string;
  team: SideKey;
  team_name: string;
  kind: string;
  points: number;
  description: string;
  home_score: number;
  away_score: number;
  try?: string;
}

/** One line of a drive's log: a kickoff, a snap, a penalty, a kick. Which fields it has depends on its type. */
export interface Play {
  type: string;
  result: string;
  quarter: number;
  clock: string;
  down?: number;
  dist?: number;
  /** where the ball is snapped: the offense's distance from its own goal line */
  yl?: number;
  yards?: number;
  to?: number;
  /** the down after the play: 1 is a first down, 6 a touchdown */
  after?: number;
  safety?: boolean;
  who?: string;
  qb?: string;
  target?: string;
  kicking?: string;
  returner?: string;
  return_yards?: number;
  penalty?: string;
  kicker?: string;
  distance?: number;
  punter?: string;
  how?: string;
  fumble?: boolean;
  fumble_kept?: boolean;
  recovered_by?: string;
  kneel?: boolean;
  spike?: boolean;
  throwaway?: boolean;
  sacked_by?: string;
  picked_by?: string;
  hail_mary?: boolean;
}

export interface Drive {
  quarter: number;
  offense: SideKey;
  offense_name: string;
  start_yardline: number;
  end_yardline: number;
  result: string;
  plays: number;
  seconds: number;
  log?: Play[];
}

export interface GameBox extends BoxScore {
  home: GameSide;
  away: GameSide;
  winner: SideKey | null;
  overtime_periods: number;
  /** each side's team overall, as the page shows a team rating; null for an FCS stand-in */
  overalls?: { home: number | null; away: number | null };
  scoring_plays: ScoringPlay[];
  drives: Drive[];
}

/** One step of the replay. */
export interface Moment {
  drive: number;
  off: SideKey;
  quarter: number;
  clock: string;
  /** the log line's type, or "score" (a score with no play of its own) or "drive-end" */
  kind: string;
  text: string;
  /** "2nd & 7 at the AF 34" */
  situation: string;
  /** a long gain, a turnover or a score: held on screen longer */
  big: boolean;
  score?: ScoringPlay;
  /** the score once this moment has happened */
  home: number;
  away: number;
  yl?: number;
  to?: number;
  dist?: number;
  end?: boolean;
}

export const other = (side: SideKey): SideKey => (side === "home" ? "away" : "home");
export const clockOf = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
export const ordinal = (n: number) =>
  `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? "th"}`;
export const quarterName = (q: number) =>
  q <= 4 ? `${ordinal(q)} Quarter` : q === 5 ? "Overtime" : `Overtime ${q - 4}`;
export const quarterShort = (q: number) => (q <= 4 ? `Q${q}` : `OT${q - 4}`);
/** A yard line as its side of the field: "Own 26", "Opp 16". */
export const fieldPos = (y: number) => (y === 50 ? "50" : y < 50 ? `Own ${y}` : `Opp ${100 - y}`);

/** How a drive ended, as a label. */
export const DRIVE_RESULTS: Record<string, string> = {
  touchdown: "Touchdown",
  "field goal": "Field Goal",
  "missed kick": "Missed Field Goal",
  punt: "Punt",
  turnover: "Turnover",
  safety: "Safety",
  defensive_touchdown: "Defensive Touchdown",
  punt_return_td: "Punt Return Touchdown",
  end_of_half: "End of Half",
  first_down: "Drive Over",
};
/** What a scoring play was, as a short tag. */
export const SCORE_KINDS: Record<string, string> = {
  pass: "TD",
  run: "TD",
  kickoff_return: "KR TD",
  punt_return: "PR TD",
  defensive: "DEF TD",
  field_goal: "FG",
  safety: "SAF",
  two_point: "2PT",
};
export const driveResult = (r: string) => DRIVE_RESULTS[r] ?? r;
export const scoreKind = (k: string) => SCORE_KINDS[k] ?? k.toUpperCase();
/** A drive in a line: "Touchdown · 8 Plays, 74 Yards, 3:12". */
export const driveLine = (d: Drive) =>
  `${driveResult(d.result)} · ${d.plays} ${d.plays === 1 ? "Play" : "Plays"}, ${d.end_yardline - d.start_yardline} Yards, ${clockOf(d.seconds)}`;

/** Whether a drive ended in points. */
const SCORING_RESULTS = ["touchdown", "field goal", "safety", "defensive_touchdown", "punt_return_td"];
const SNAPS = ["run", "pass", "penalty"];
export const isSnap = (kind: string) => SNAPS.includes(kind);

const gain = (n = 0) => (n > 0 ? `${n} yard gain` : n === 0 ? "no gain" : `loss of ${-n}`);

/**
 * The replay of a game: every line of every drive's log as a moment, with the running score. `abbr` names a side for
 * yard lines ("the AF 34").
 */
export function momentsOf(g: GameBox, abbr: Record<SideKey, string>): Moment[] {
  const spot = (off: SideKey, yl = 0) =>
    yl === 50 ? "the 50" : yl < 50 ? `the ${abbr[off]} ${yl}` : `the ${abbr[other(off)]} ${100 - yl}`;
  const down = (e: Play) =>
    e.down ? `${ordinal(e.down)} & ${(e.yl ?? 0) + (e.dist ?? 0) >= 100 ? "Goal" : e.dist}` : "";

  const describe = (d: Drive, e: Play): string => {
    const off = d.offense;
    const def = other(off);
    const td = e.after === 6 || e.result === "defensive_touchdown" || e.result === "return_td";
    if (e.type === "kickoff") {
      if (e.result === "onside_recovered")
        return `${e.kicking} tries an onside kick and recovers it at ${spot(off, e.to)}.`;
      if (e.result === "onside_failed")
        return `${e.kicking} tries an onside kick; ${g[off].name} recovers at ${spot(off, e.to)}.`;
      if (e.result === "return_td")
        return `${e.kicking} kicks off; ${e.returner || "the returner"} takes it all the way back for a TOUCHDOWN.`;
      if (e.returner && e.return_yards)
        return `${e.kicking} kicks off; ${e.returner} returns it ${e.return_yards} yards to ${spot(off, e.to)}.`;
      return `${e.kicking} kicks off; touchback, ${g[off].name} starts at ${spot(off, e.to)}.`;
    }
    if (e.type === "penalty") {
      const on = e.result === "offensive penalty" ? g[off].name : g[def].name;
      return `Penalty on ${on}: ${e.penalty || "penalty"}, ${Math.abs(e.yards ?? 0)} yards.`;
    }
    if (e.type === "field_goal") {
      const who = e.kicker ? `${e.kicker}'s ` : "A ";
      const how = e.result === "good" ? "GOOD" : e.result === "blocked" ? "BLOCKED" : "NO GOOD";
      return `${who}${e.distance} yard field goal is ${how}.`;
    }
    if (e.type === "punt") {
      const who = e.punter || g[off].name;
      const at = spot(def, 100 - (e.to ?? 0));
      if (e.result === "blocked") return `${who}'s punt is BLOCKED.`;
      if (e.result === "return_td")
        return `${who} punts ${e.yards} yards; ${e.returner || "the returner"} takes it back for a TOUCHDOWN.`;
      if (e.returner && e.return_yards)
        return `${who} punts ${e.yards} yards; ${e.returner} returns it ${e.return_yards} yards to ${at}.`;
      if (e.how === "touchback") return `${who} punts ${e.yards} yards into the end zone for a touchback.`;
      const how = { fair_catch: "fair catch", downed: "downed", out_of_bounds: "out of bounds" }[e.how ?? ""];
      return `${who} punts ${e.yards} yards${how ? `, ${how}` : ""}; ${g[def].name} takes over at ${at}.`;
    }
    const first = e.after === 1 && !td ? " for a first down" : "";
    const fumble = (base: string) => {
      if (!e.fumble) return base;
      if (e.fumble_kept) return `${base}, fumbles and ${g[off].name} recovers`;
      if (e.result === "defensive_touchdown")
        return `${base}, FUMBLES, ${e.recovered_by || g[def].name} picks it up and returns it for a TOUCHDOWN`;
      return `${base}, FUMBLES, recovered by ${e.recovered_by || g[def].name}`;
    };
    if (e.type === "run") {
      if (e.kneel) return `${g[off].name} takes a knee.`;
      const who = e.who || g[off].name;
      if (td && !e.fumble) return `${who} ${e.yards} yard run for a TOUCHDOWN.`;
      return `${fumble(`${who} runs for a ${gain(e.yards)}`)}${first}${e.safety ? ". SAFETY" : ""}.`;
    }
    // passes
    const qb = e.qb || "The quarterback";
    if (e.spike) return `${qb} spikes the ball to stop the clock.`;
    if (e.throwaway) return `${qb} throws it away.`;
    if (e.result === "sack")
      return `${fumble(`${qb} sacked${e.sacked_by ? ` by ${e.sacked_by}` : ""} for a ${gain(e.yards)}`)}${e.safety ? ". SAFETY" : ""}.`;
    if (e.result === "interception")
      return `${qb} INTERCEPTED by ${e.picked_by || "the defense"}; ${g[def].name} takes over at ${spot(def, 100 - (e.to ?? 0))}.`;
    if (e.result === "defensive_touchdown" && e.picked_by)
      return `${qb} INTERCEPTED by ${e.picked_by}, returned for a TOUCHDOWN.`;
    if (e.result === "run") return `${qb} scrambles for a ${gain(e.yards)}${td ? " and a TOUCHDOWN" : first}.`;
    if (e.result === "incomplete")
      return `${qb} incomplete${e.target ? `, intended for ${e.target}` : ""}${e.hail_mary ? " on the Hail Mary" : ""}.`;
    const to = e.target ? ` to ${e.target}` : "";
    if (td && !e.fumble)
      return `${qb} complete${to} for ${e.yards} yards and a TOUCHDOWN${e.hail_mary ? " on the Hail Mary" : ""}.`;
    return `${fumble(`${qb} complete${to} for a ${gain(e.yards)}`)}${first}.`;
  };

  const sp = g.scoring_plays ?? [];
  let si = 0;
  let home = 0;
  let away = 0;
  const take = () => {
    if (si >= sp.length) return undefined;
    const s = sp[si++];
    home = s.home_score;
    away = s.away_score;
    return s;
  };
  const scoreText = (s: ScoringPlay) =>
    `${s.team_name}: ${titleCase(s.description)}${s.try ? ` (${titleCase(s.try)})` : ""}`;

  const out: Moment[] = [];
  g.drives.forEach((d, di) => {
    const off = d.offense;
    let scored = false;
    for (const e of d.log ?? []) {
      const m: Moment = {
        drive: di,
        off,
        quarter: e.quarter,
        clock: e.clock,
        kind: e.type,
        text: describe(d, e),
        situation: "",
        big: false,
        home,
        away,
        yl: e.yl,
        to: e.to,
        dist: e.dist,
      };
      if (e.type === "run" || e.type === "pass") {
        m.situation = e.down ? `${down(e)} at ${spot(off, e.yl)}` : `At ${spot(off, e.yl)}`;
        const turnover = ["interception", "fumble", "defensive_touchdown"].includes(e.result) || !!e.fumble;
        if (Math.abs(e.yards ?? 0) >= 20 || turnover) m.big = true;
      } else if (e.type === "field_goal" || e.type === "punt") {
        m.situation = `4th${e.dist != null ? ` & ${e.dist}` : ""} at ${spot(off, e.yl)}`;
      }
      const scores =
        e.after === 6 ||
        e.result === "defensive_touchdown" ||
        e.result === "return_td" ||
        (e.type === "field_goal" && e.result === "good") ||
        !!e.safety;
      if (scores) {
        m.score = take();
        m.big = true;
        scored = true;
      }
      m.home = home;
      m.away = away;
      out.push(m);
    }
    // a scoring drive whose log has no scoring line: the score rides on its last play, or stands alone
    if (!scored && SCORING_RESULTS.includes(d.result)) {
      const s = take();
      const last = out[out.length - 1];
      if (s && last && last.drive === di) Object.assign(last, { score: s, big: true, home, away });
      else if (s)
        out.push({
          drive: di,
          off,
          quarter: d.quarter,
          clock: "",
          kind: "score",
          text: scoreText(s),
          score: s,
          big: true,
          home,
          away,
          situation: "",
        });
    }
    out.push({
      drive: di,
      off,
      quarter: d.quarter,
      clock: "",
      kind: "drive-end",
      text: driveLine(d),
      home,
      away,
      situation: "",
      big: false,
      end: true,
    });
  });
  // scores the drives never accounted for (overtime tries)
  for (let s = take(); s; s = take())
    out.push({
      drive: g.drives.length,
      off: s.team,
      quarter: s.quarter,
      clock: s.clock,
      kind: "score",
      text: scoreText(s),
      score: s,
      big: true,
      home,
      away,
      situation: "",
    });
  return out;
}

/** Whether a game kept its play log (an imported real result has only its totals). */
export const hasLog = (g: GameBox) => (g.drives ?? []).some((d) => (d.log?.length ?? 0) > 0);
