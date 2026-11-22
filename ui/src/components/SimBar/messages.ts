export const messages = {
  simming: "Simming",
  working: "Working…",
  games: (done: number, total: number) => `${done} of ${total} Games`,
  pct: (n: number) => `${n}%`,
  stop: "Stop After This Week",
} as const;
