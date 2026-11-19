export const messages = {
  title: "Bracket",
  preseason: "Preseason",
  week: (n: number) => `Week ${n}`,
  dash: "–",

  projected: (source: string, week: string) => `Projected · ${source}, ${week}`,
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
  quarterWinner: "Quarterfinal Winner",
  semiWinner: "Semifinal Winner",

  youIn: (team: string, seed: number) => `${team} is in the playoff as the ${seed} seed.`,
  youInProjected: (team: string, seed: number) => `${team} would be in the playoff as the ${seed} seed.`,
  youJustOut: (team: string) => `${team} is among the first four out.`,
  youOut: (team: string) => `${team} is not in the playoff.`,
  youOutProjected: (team: string) => `${team} is outside the projected field for now.`,
  champion: (team: string) => `${team} are the national champions.`,

  field: "The Field",
  fieldNote: "How Each Got In",
  /** the engine's reason, as a label: "SEC champion" → "SEC Champion" */
  bid: (bid: string) =>
    bid === "at-large" ? "At-Large" : bid.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, "of"),
  bye: "Bye",
  byeTip: "The top four seeds skip the first round.",
  firstFourOut: "First Four Out",
} as const;
