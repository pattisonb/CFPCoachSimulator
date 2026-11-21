export const messages = {
  loading: "Loading the player…",
  loadError: (msg: string) => `Couldn't load the player: ${msg}.`,
  notFound: (name: string) => `${name} is not on the roster anymore.`,
} as const;
