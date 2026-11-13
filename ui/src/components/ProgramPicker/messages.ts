export const messages = {
  search: "Search programs and teams",
  newProgram: "New Program",
  newProgramHint: "Build Your Own",
  mine: "My Programs",
  real: "Edit a Real Program",
  edited: "Edited",
  noMatch: (q: string) => `No program or team matches "${q}".`,
  loading: "Loading…",
} as const;
