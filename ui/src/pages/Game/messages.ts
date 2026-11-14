export const messages = {
  notBuilt: (section: string) => `${section} Isn't Built Yet`,
  notBuiltText: "This section has its place in the game's menu; its screen comes next.",
  openNav: (shortcut: string) => `Open Sidebar (${shortcut})`,
  noSeason: "No Season Loaded",
  noSeasonText: "Start one from the main menu: pick a team, press Play, then confirm your coach.",
  mainMenu: "Back to Main Menu",
  loading: "Loading the season…",
  loadError: (msg: string) => `Couldn't load the season: ${msg}.`,
} as const;
