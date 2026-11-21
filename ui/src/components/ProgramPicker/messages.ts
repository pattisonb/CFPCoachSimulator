export const messages = {
  search: "Search Programs and Teams",
  newProgram: "New Program",
  newProgramHint: "Build Your Own",
  mine: "My Programs",
  real: "Edit a Real Program",
  edited: "Edited",
  noMatch: (q: string) => `No program or team matches "${q}".`,
  loading: "Loading…",
} as const;
