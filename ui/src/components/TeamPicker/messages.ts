export const messages = {
  search: "Search teams, conferences or states…",
  newProgram: "Play as a New Program",
  newProgramHint: "Build Your Own Program",
  noMatch: (q: string) => `No teams match "${q}".`,
  loading: "Loading teams…",
} as const;
