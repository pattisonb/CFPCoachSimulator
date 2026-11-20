export const messages = {
  label: "Around the League",
  live: "Live",
  /** a news item's kind (sim/news.py KINDS), as its tag */
  kinds: {
    upset: "Upset",
    rankings: "Rankings",
    big_game: "Big Game",
    streak: "Streak",
    recruiting: "Recruiting",
    injury: "Injury",
  } as Record<string, string>,
  news: "News",
  final: "Final",
  finalOt: (n: number) => (n > 1 ? `Final / ${n}OT` : "Final / OT"),
  rout: "Rout",
  thriller: "Thriller",
  rankedLoss: "Upset",
  openGame: (away: string, home: string) => `Open the box score: ${away} at ${home}`,
  face: "The recruit",
  empty: "Scores and news from around the league roll here once games are played.",
} as const;
