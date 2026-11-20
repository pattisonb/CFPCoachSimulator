export const messages = {
  title: "Class Rankings",
  loading: "Loading the classes…",
  loadError: (msg: string) => `Couldn't load the classes: ${msg}.`,
  phase: (phase: string) => phase,
  cols: {
    rank: "Rank",
    school: "School",
    conference: "Conference",
    commits: "Commits",
    signed: "Signed",
    points: "Points",
  },
  stars: (k: string) => `${k}★`,
  pointsTip:
    "The class's score, counted the way 247Sports counts a class: each commit adds his rating over 70, the best commit in full and each one after him worth less down a bell curve. A top class lands a little over 300.",
  aClass: "The Class",
  classOf: (school: string) => `${school}'s Class`,
  classLine: (rank: number, count: number) => `#${rank} · ${count} ${count === 1 ? "Commit" : "Commits"}`,
  rank: (n: number) => `#${n} Nat.`,
  committed: "Committed",
  signed: "Signed",
  empty: "Nobody has committed yet.",
} as const;
