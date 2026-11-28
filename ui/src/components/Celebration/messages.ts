export const messages = {
  /** a regular-season win at the end of Game Day */
  win: "Victory",
  /** a bowl or conference title game: "Fiesta Bowl Champions" */
  champions: (title: string) => `${title} Champions`,
  /** a playoff game short of the final */
  playoffWin: "Playoff Win",
  /** the national championship */
  national: "National Champions",
  /** the score under the headline */
  score: (pf: number, pa: number, opponent: string) => `${pf}-${pa} over ${opponent}`,
  dismiss: "Click anywhere to keep going.",
} as const;
