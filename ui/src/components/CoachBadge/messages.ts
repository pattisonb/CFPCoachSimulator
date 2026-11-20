export const messages = {
  role: (team: string) => `Head Coach · ${team}`,
  energy: "Energy",
  energyValue: (left: number, total: number) => `${left}/${total}`,
  energyHint: (left: number, total: number) =>
    `${left} of ${total} recruiting hours left this week. They refill when the week ends.`,
  word: "Your Word",
  wordHint: (text: string) =>
    `How well you keep your promises: ${text}. Recruits weigh it when you promise a starting role, and a poor one makes them doubt you.`,
  wordWeakest: (group: string, text: string) => `It is weaker with ${group}: ${text}.`,
} as const;
