export const messages = {
  portal: "Transfer Portal",
  notBuilt: (section: string) => `${section} Isn't Built Yet`,
  notBuiltText: "This section has its place in the game's menu; its screen comes next.",
  openNav: (shortcut: string) => `Open Sidebar (${shortcut})`,
  noSeason: "No Season Loaded",
  noSeasonText: "Start one from the main menu: pick a team, press Play, then confirm your coach.",
  mainMenu: "Back to Main Menu",
  auto: "Auto-Recruit",
  autoModes: { off: "Off", week: "This Week", season: "All Season" } as Record<string, string>,
  loading: "Loading the season…",
  loadError: (msg: string) => `Couldn't load the season: ${msg}.`,
} as const;
