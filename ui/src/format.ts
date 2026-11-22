// Formatting shared by components. Words a player sees go through these, so they read the same everywhere.

/** A class code from the game ("SRRS", "FR") as the old UI shows it ("RS Sr.", "Fr."). */
export function formatClass(code: string | null): string {
  if (!code) return "–";
  const year = { FR: "Fr.", SO: "So.", JR: "Jr.", SR: "Sr." }[code.slice(0, 2)] ?? code;
  return code.endsWith("RS") ? `RS ${year}` : year;
}

/** The small words that stay lowercase inside a title (CLAUDE.md: Copy and casing). */
const SMALL_WORDS = new Set(["a", "an", "the", "of", "to", "for", "and", "or", "in", "on", "at", "by", "vs"]);

/**
 * A label or a standalone value in Title Case ("Redshirt Junior", "3 Sacks Allowed", "Won the Pinstripe Bowl"): for
 * words the game sends in sentence case because it also writes them into sentences. Every word starts with a capital
 * but the small ones inside it; a word is otherwise left as it is (TD, RS Jr., McCoy), and a number is no word.
 */
export function titleCase(text: string | null | undefined): string {
  if (!text) return "";
  const words = text.split(" ");
  const lettered = words.map((w) => /[A-Za-z]/.test(w));
  const last = words.length - 1; // (a number leading it is its first word: "41 on Your Board")
  return words
    .map((w, i) => {
      if (!lettered[i]) return w;
      const bare = w.replace(/[^A-Za-z]/g, "");
      if (i !== 0 && i !== last && SMALL_WORDS.has(bare) && !/[:;.]$/.test(words[i - 1] ?? "")) return w;
      // each part of a hyphenated word ("Two-Point"), but not what follows an apostrophe ("Iowa's")
      return w.replace(/(^|[-(\/"“])([a-z])/g, (_, lead: string, c: string) => lead + c.toUpperCase());
    })
    .join(" ");
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
/** "Sep 5, 2026" (the year moved on by `years`); "" when there is no date */
const DAY_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: ET });
export const dateYearText = (d: string | null | undefined, years = 0) => {
  const t = dayOf(d);
  if (Number.isNaN(t)) return "";
  // `years` later, the same month and day: every season runs on one calendar, so a later one moves only the year
  const at = new Date(t);
  at.setUTCFullYear(at.getUTCFullYear() + years);
  return DAY_YEAR.format(at);
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

/** "Jalen Smith Jr." → "Smith" */
export const lastName = (name: string) => {
  const parts = name.split(" ").filter((w) => !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(w));
  return parts[parts.length - 1] ?? name;
};

/** Everything but the last name ("Jalen Smith Jr." → "Jalen"). */
export const firstNames = (name: string) => {
  const last = lastName(name);
  const i = name.lastIndexOf(last);
  return i > 0 ? name.slice(0, i).trim() : "";
};
