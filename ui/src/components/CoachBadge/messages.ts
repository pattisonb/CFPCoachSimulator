export const messages = {
  role: (team: string) => `Head Coach · ${team}`,
  energy: "Energy",
  energyValue: (left: number, total: number) => `${left}/${total}`,
  energyHint: (left: number, total: number) =>
    `${left} of ${total} recruiting hours left this week. They refill when the week ends.`,
} as const;
