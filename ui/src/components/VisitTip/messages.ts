/** VisitTip: the wording. */
export const messages = {
  /** a visit that happened: the week, and how the school's game went with him there */
  visited: (week: string) => `Visited ${week}.`,
  result: (won: boolean, pf: number, pa: number, venue: string, opponent: string) =>
    `Result: ${won ? "W" : "L"} ${pf}-${pa} ${venue} ${opponent}.`,
  /** a visit still to come: the week and the game he will see */
  visiting: (week: string) => `Visiting ${week}.`,
  visitingGame: (week: string, venue: string, opponent: string) => `Visiting ${week} ${venue} ${opponent}.`,
  vs: "vs",
  at: "at",
};
