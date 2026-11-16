// Formatting shared by components. Words a player sees go through these, so they read the same everywhere.

/** A class code from the game ("SRRS", "FR") as the old UI shows it ("RS Sr.", "Fr."). */
export function formatClass(code: string | null): string {
  if (!code) return "–";
  const year = { FR: "Fr.", SO: "So.", JR: "Jr.", SR: "Sr." }[code.slice(0, 2)] ?? code;
  return code.endsWith("RS") ? `RS ${year}` : year;
}

/** 1st, 2nd, 3rd, 4th, 11th, 22nd */
export function ordinal(n: number): string {
  const v = n % 100;
  const s = ["th", "st", "nd", "rd"];
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

// game days and kickoffs, in Eastern time (where the schedule's dates are set)
const ET = "America/New_York";
const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: ET });
const KICKOFF = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: ET,
});
const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET });

/** A date ("2026-09-05") or a kickoff ("2026-09-05T23:30Z") as its day, as a ms timestamp; NaN for none. */
const dayOf = (d: string | null | undefined) => (d ? Date.parse(d.length === 10 ? `${d}T17:00Z` : d) : NaN);
const timeOf = (d: string | null | undefined) => (d && d.includes("T") ? Date.parse(d) : NaN);

/** "Sat, Sep 5"; never "Invalid Date" */
export const dateText = (d: string | null | undefined) => {
  const t = dayOf(d);
  return Number.isNaN(t) ? "" : DAY.format(t);
};
/** "Sat 12:30 PM" with a kickoff, else the day */
export const kickoffText = (d: string | null | undefined) => {
  const t = timeOf(d);
  return Number.isNaN(t) ? dateText(d) : KICKOFF.format(t);
};
/** "12:30 PM", or "" when only the day is set */
export const timeText = (d: string | null | undefined) => {
  const t = timeOf(d);
  return Number.isNaN(t) ? "" : TIME.format(t);
};
