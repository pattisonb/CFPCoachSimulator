export const messages = {
  role: (team: string) => `Head Coach · ${team}`,
  energy: "Energy",
  energyValue: (left: number, total: number) => `${left}/${total}`,
  energyHint: (left: number, total: number) =>
    `${left} of ${total} recruiting hours left this week. They refill when the week ends.`,
  thisWeek: "This Week",
  ratings: "Your Ratings",
  overall: "Overall",
  rated: {
    offense: "Offense",
    defense: "Defense",
    recruiting: "Recruiting",
    player_development: "Development",
    game_management: "Game Management",
    motivation: "Motivation",
    discipline: "Discipline",
  } as Record<string, string>,
  word: "Your Word",
  wordHint: (text: string) =>
    `How well you keep your promises: ${text}. Recruits weigh it when you promise a starting role, and a poor one makes them doubt you.`,
  wordWeakest: (group: string, text: string) => `It is weaker with ${group}: ${text}.`,
} as const;
