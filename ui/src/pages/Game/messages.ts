export const messages = {
  notBuilt: (section: string) => `${section} Isn't Built Yet`,
  notBuiltText: "This section has its place in the game's menu; its screen comes next.",
  openNav: (shortcut: string) => `Open Sidebar (${shortcut})`,
  noSeason: "No Season Loaded",
  noSeasonText: "Start one from the main menu: pick a team, press Play, then confirm your coach.",
  mainMenu: "Back to Main Menu",
  scouting: "Scouting",
  scoutingHint: "This week's scouting points. Sending a scout spends them; they refill when the week ends.",
  auto: "Auto-Recruit",
  autoModes: { off: "Off", week: "This Week", season: "All Season" } as Record<string, string>,
  loading: "Loading the season…",
  loadError: (msg: string) => `Couldn't load the season: ${msg}.`,
} as const;
