import { ordinal } from "../../format.ts";

export const messages = {
  title: "Bowls",
  // the status at the bar's end
  projected: (week: string) => `Projected · After ${week}`,
  projectedTip:
    "Built from the committee's latest ranking: records carried to the end of the regular season, the playoff field set aside, then the bowls pick as they will on selection day.",
  set: "Bowl Season",
  sample: "Sample",
  projectedEarly: (poll: string) => `Projected · AP Poll, ${poll}`,
  preseasonPoll: "Preseason",
  earlyTip:
    "The committee's first ranking comes after Week 9. Until then this lineup is projected from the AP poll, with each conference's leader as its champion.",
  sampleTip:
    "Bowl projections start with the committee's first ranking, after Week 9. Until then this is a sample lineup, so you can see how the page works.",

  // what's up top
  yourBowl: "Your Bowl",
  yourProjected: "Your Projected Bowl",
  inPlayoff: (team: string) => `${team} is in the playoff field.`,
  inPlayoffProjected: (team: string) => `${team} is projected into the playoff.`,
  noBowl: (team: string) => `${team} isn't in a bowl.`,
  noBowlProjected: (team: string) => `${team} is on the outside of the bowl picture for now.`,
  vs: "vs",
  final: "Final",
  finalOt: (n: number) => (n > 1 ? `Final/${n}OT` : "Final/OT"),
  upcoming: "Upcoming",
  projectedKicker: "Projected",
  unfilled: "No eligible teams were left for this bowl.",
  tbd: "TBD",

  // its facts
  facts: "The Bowl",
  firstPlayed: (year: number) => `First Played ${year}`,
  edition: (n: number) => `${ordinal(n)} Game`,
  payout: (p: string) => `Payout ${p.replace(/^US\$\s*/, "$").replace(/\s*\(.*\)$/, "")}`,
  tieIns: "Tie-Ins",
  recent: "Recent Winners",
  recentLine: (year: number, winner: string, ws: number, loser: string, ls: number) =>
    `${year} · ${winner} ${ws}, ${loser} ${ls}`,

  // the list
  listLabel: "Every bowl",
  filterLabel: "Which bowls",
  all: "All",
  windows: { 17: "Early Bowls · Dec 15–24", 18: "Holiday Week · Dec 26–31", 19: "New Year's Bowls · Jan 2" } as Record<
    number,
    string
  >,
  count: (n: number) => `${n} ${n === 1 ? "Bowl" : "Bowls"}`,
  none: "No bowls match that filter.",
  you: "You",
} as const;
