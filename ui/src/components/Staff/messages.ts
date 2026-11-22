export const messages = {
  title: "Staff",
  tabs: { scouts: "Scouts", reports: "Reports" },
  newFinds: (n: number) => `${n} New`,
  loading: "Loading your staff…",
  loadError: (msg: string) => `Couldn't load your staff: ${msg}.`,

  // the week's numbers across the top
  points: "Scouting Points",
  pointsOf: (left: number, week: number) => `${left} / ${week}`,
  pointsTip: (left: number, week: number) =>
    `${left} of ${week} scouting points left this week for trips to see a prospect yourself.`,
  trips: "Trips This Week",
  fullReports: "Full Reports",
  boardScouted: "Board Scouted",
  ofN: (a: number, b: number) => `${a} of ${b}`,

  // a scout's card
  scoutsLabel: "Your scouts",
  eye: "Eye for Talent",
  eyeTip: "How well he reads a prospect: a sharper eye narrows a read faster.",
  area: "Area",
  noArea: "No Area: Assign One",
  areaFor: (name: string) => `Area ${name} covers`,
  signedThrough: (year: number) => `Signed Through ${year}`,
  finalYear: "Final Year",
  lookingAt: (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "Prospect" : "Prospects"} Left to See`,
  thisWeek: "This Week",
  yieldLine: (looks: number, moved: number, flags: number) =>
    `${fmtLooks(looks)} ${looks === 1 ? "Look" : "Looks"} · ${moved.toLocaleString("en-US")} ${moved === 1 ? "Read" : "Reads"} Moved${flags ? ` · ${flags} ${flags === 1 ? "Flag" : "Flags"}` : ""}`,
  idle: "No looks yet this week.",
  shared: (other: string) => `Shares it with ${other}.`,
  moved: (name: string, area: string) => `${name} now covers ${area}.`,
  failed: (msg: string) => `Couldn't do that: ${msg}.`,

  // the map
  mapLabel: "Where your scouts are",
  covered: (n: number, of: number) => `${n} of ${of} Areas Covered`,
  uncovered: "Uncovered",
  hint: (name: string | null) =>
    name ? `Pick an area on the map to send ${name} there.` : "Pick a scout, then an area.",
  readout: (area: string, who: string) => `${area} · ${who}`,
  states: (codes: string[]) => codes.join(" "),
  howItWorks:
    "Each week a scout gives every prospect in his area half a look, up to two looks. A full report takes three: send a scout yourself for the last one.",

  // reports
  weeks: { this_week: "This Week", last_week: "Last Week", finds: "Finds" } as Record<string, string>,
  weeksLabel: "Which reports",
  reportHead: (looks: number, changed: number) =>
    `${fmtLooks(looks)} ${looks === 1 ? "Look" : "Looks"} · ${changed.toLocaleString("en-US")} ${changed === 1 ? "Read" : "Reads"} Moved`,
  yourTrips: "Your Trips",
  noReports: "No Reports Yet",
  noReportsText: "Your scouts file their first reports after the week is simmed.",
  noFinds: "No Finds Yet",
  noFindsText: "As the looks add up, your scouts flag gems, bust risks and generational prospects.",
  flags: { generational: "Generational", gem: "Gem", bust: "Bust Risk" } as Record<string, string>,
  flagTips: {
    generational: "A once-in-a-generation talent every program in the country wants.",
    gem: "Even the low end of his potential read beats all but a few prospects at his star level.",
    bust: "His ranking is high, but even the top of the read sits under nearly every prospect at his star level.",
  } as Record<string, string>,
  likes: (who: string) => `${who} Likes Him`,
  complete: "Full Report",
  looks: (n: number) => `${fmtLooks(n)} of 3 Looks`,
  addBoard: (name: string) => `Add ${name} to your board.`,
  removeBoard: (name: string) => `Take ${name} off your board.`,
  boardError: (msg: string) => `Couldn't change your board: ${msg}.`,
} as const;

/** looks come in halves: "2", "2.5" */
export function fmtLooks(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
