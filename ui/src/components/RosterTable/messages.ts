export const messages = {
  filtersLabel: "Filter by Position",
  all: "All",
  summary: (players: number, starters: number) => `${players} Players · ${starters} Starters`,
  loading: "Loading the roster…",
  offense: "Offense",
  defense: "Defense",
  starter: "Starter",
  cols: { jersey: "#", player: "Player", pos: "Pos", cls: "Class", ht: "Ht", wt: "Wt", ovr: "OVR" },
} as const;
