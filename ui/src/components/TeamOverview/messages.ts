export const messages = {
  offense: "Offense",
  defense: "Defense",
  rating: "Rating",
  depth: (players: number, starters: number) => `${players} Players · ${starters} Starters`,
  topPlayers: "Top Players",
  loading: "Loading the team…",
} as const;
