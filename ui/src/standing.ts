import { ordinal } from "./format.ts";
import type { BoardRow } from "./types.ts";

// Where you stand with a recruit, in words (web/recruiting.js standingOf, the old board's ladder): Yours, Favorite,
// Offer Sent, In It, Long Shot, Not Offered, Lost; with a line on why and his odds.

export type Tone = "good" | "warn" | "muted" | "bad";

export interface Standing {
  word: string;
  /** a sentence on why */
  text: string;
  /** the odds in words: Clear Favorite, Close Race… */
  odds?: string;
  tone: Tone;
  /** your chance, 0 to 1, when there is one */
  pct?: number | null;
}

export function standingOf(b: BoardRow, me: string): Standing {
  const st = b.standing;
  const school = b.signed || b.committed;
  if (school === me)
    return {
      word: "Yours",
      text: b.signed ? "Signed with you." : b.hard ? "Hard commit to you." : "Verbal commit to you.",
      tone: "good",
    };
  const there = b.school_name ?? "another school";
  if (school && (b.signed || b.hard))
    return { word: "Lost", text: `${b.signed ? "Signed" : "Hard commit"}: ${there}.`, tone: "bad" };
  if (school)
    return {
      word: st.pct != null && st.pct >= 0.3 ? "In It" : "Long Shot",
      text: `Verbal commit to ${there}.`,
      odds: st.pct != null && st.pct >= 0.3 ? "He could still flip to you" : "A flip is a long shot",
      tone: "warn",
      pct: st.pct,
    };
  const rows = b.list.filter((x) => x.bar != null).map((x, i) => ({ ...x, at: x.rank ?? i + 1 }));
  const mine = rows.find((x) => x.you || x.school === me);
  const landing = b.offered && b.offer_landing;
  const offered = b.offered && !landing;
  if (landing) return { word: "Offer Sent", text: "He reads your offer at the week's end.", tone: "warn" };
  if (!mine)
    return offered
      ? { word: "Long Shot", text: "Outside his top five.", odds: "Long Shot", tone: "muted", pct: st.pct }
      : { word: "Not Offered", text: "Not on his list yet.", tone: "muted" };
  const leader = rows.filter((x) => x !== mine).sort((a, c) => a.at - c.at)[0];
  if (!leader || mine.at < leader.at) {
    if (!offered)
      return {
        word: "Not Offered",
        text: "He'd pick you today, but he has no offer from you.",
        odds: "Offer Him",
        tone: "warn",
      };
    const clear = !leader || (mine.bar ?? 0) - (leader.bar ?? 0) >= 0.25;
    return {
      word: "Favorite",
      text: "Leading his list.",
      odds: clear ? "Clear Favorite" : "Narrow Favorite",
      tone: "good",
      pct: st.pct,
    };
  }
  const where = `${ordinal(mine.at)} on his list`;
  if (!offered)
    return { word: "Not Offered", text: `${where}, not offered.`, odds: "Offer to Be in It", tone: "muted" };
  const close = (mine.bar ?? 0) >= (leader.bar ?? 0) - 0.1;
  const odds = close ? "Close Race" : (mine.bar ?? 0) >= 0.15 ? "Behind, in the Picture" : "Long Shot";
  return {
    word: odds === "Long Shot" ? "Long Shot" : "In It",
    text: `${where}; ${leader.name} leads.`,
    odds,
    tone: close ? "warn" : "muted",
    pct: st.pct,
  };
}

/** His offer or commitment, for the board's icon: where it stands, and whether it is with another school. */
export interface RecruitStatus {
  key: "none" | "sent" | "offered" | "verbal" | "hard" | "signed";
  /** committed or signed elsewhere */
  away: boolean;
}

export function statusOf(b: BoardRow, me: string): RecruitStatus {
  const school = b.signed || b.committed;
  if (school) return { key: b.signed ? "signed" : b.hard ? "hard" : "verbal", away: school !== me };
  if (!b.offered) return { key: "none", away: false };
  return { key: b.offer_landing ? "sent" : "offered", away: false };
}

/** The ladder, best first: the board's "Your Chance" order. */
const RUNG: Record<string, number> = {
  Yours: 0,
  Favorite: 1,
  "Offer Sent": 2,
  "In It": 3,
  "Long Shot": 4,
  "Not Offered": 5,
  Lost: 6,
};

export function byChance(me: string) {
  return (a: BoardRow, b: BoardRow) => {
    const sa = standingOf(a, me);
    const sb = standingOf(b, me);
    return (
      (RUNG[sa.word] ?? 5) - (RUNG[sb.word] ?? 5) || (sb.pct ?? 0) - (sa.pct ?? 0) || a.national_rank - b.national_rank
    );
  };
}

/** *tune* Your pull on a topic (its strength, 0 to 1) from which it reads Strong, and Fair: the engine's own case
 *  words (coach_career/scenes.py _case_word, web/recruiting.js caseWord), so the panel and his lines agree. */
const PULL_STRONG = 0.6;
const PULL_FAIR = 0.25;

/** Your program's pull on a topic in a word's key: strong, fair or weak. */
export function pullOf(v: number | undefined): "strong" | "fair" | "weak" {
  const x = v ?? 0;
  return x >= PULL_STRONG ? "strong" : x >= PULL_FAIR ? "fair" : "weak";
}

/** What a pitch is called (web/recruiting.js PITCH_NAMES). */
export const PITCH_NAMES: Record<string, string> = {
  proximity: "Close to Home",
  playing_time: "Playing Time",
  prestige: "Program Prestige",
  winning: "Winning Now",
  nil: "NIL",
  coach: "The Head Coach",
  academics: "Academics",
  pro: "Path to the League",
  facilities: "Facilities",
  location: "Location",
  stability: "Stability",
  game_day: "Game Day",
  exposure: "Exposure",
};
