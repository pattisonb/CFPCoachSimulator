export const messages = {
  filtersLabel: "Filter by Position",
  all: "All",
  summary: (players: number) => (players === 1 ? "1 Player" : `${players} Players`),
  loading: "Loading the roster…",
  offense: "Offense",
  defense: "Defense",
  starter: "Starter",
  cols: { jersey: "#", player: "Player", pos: "Pos", cls: "Class", ht: "Ht", wt: "Wt", ovr: "OVR" },
} as const;
