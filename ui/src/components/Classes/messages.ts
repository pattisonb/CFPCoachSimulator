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
    "The class's score, and what the rankings are ordered by. Each commit adds his recruiting grade, the best commit in full and each one after him worth a little less, so a few top recruits beat a pile of average ones.",
  aClass: "The Class",
  classOf: (school: string) => `${school}'s Class`,
  classLine: (rank: number, count: number) => `#${rank} · ${count} ${count === 1 ? "Commit" : "Commits"}`,
  rank: (n: number) => `#${n} Nat.`,
  committed: "Committed",
  signed: "Signed",
  empty: "Nobody has committed yet.",
} as const;
