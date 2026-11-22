export const messages = {
  title: "Bracket",
  preseason: "Preseason",
  week: (n: number) => `Week ${n}`,
  dash: "–",

  projected: (source: string, week: string) => `Projected · ${source}, ${week}`,
  projectedLabel: "Projected: Why",
  apPoll: "AP Poll",
  cfpRanking: "CFP Rankings",
  set: "Set on Selection Day",
  final: "Final",
  apTip:
    "The committee's first ranking comes after Week 9. Until then this is the field as it would be seeded from the AP poll today, with each conference's leader as its champion.",
  cfpTip:
    "The field as it would be seeded from the committee's latest ranking, with each conference's leader as its champion. The real bracket is set on selection day.",
  none: "No bracket yet. It shows once the season has its first poll.",

  rounds: { first: "First Round", quarters: "Quarterfinals", semis: "Semifinals", final: "National Championship" },
  winnerOf: (pair: string) => `Winner of ${pair}`,
  // short enough for a bracket slot
  quarterWinner: "QF Winner",
  semiWinner: "SF Winner",

  boxScore: (a: string, b: string) => `Open the box score: ${a} vs ${b}.`,
  championKicker: "National Champions",
  titleScore: (won: number, lost: number, loser: string) => `${won}–${lost} Over ${loser}`,

  field: "The Field",
  fieldNote: "How Each Got In",
  /** the engine's reason, as a label: "SEC champion" → "SEC Champion" */
  bid: (bid: string) =>
    bid === "at-large" ? "At-Large" : bid.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, "of"),
  byeTip: "A bye: the top four seeds skip the first round.",
  firstFourOut: "First Four Out",
} as const;
