export const messages = {
  title: (away: string, home: string) => `${away} at ${home}`,
  gameDay: "Game Day",
  loading: "Loading the game…",
  loadError: (msg: string) => `Couldn't load the game: ${msg}.`,
} as const;
