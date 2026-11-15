export const messages = {
  title: "Play Game Day",
  lede: (week: string, date: string) => [week, date].filter(Boolean).join(" · "),
  offense: "Your Offense",
  defense: "Their Defense",
  offenseTip: "You play this team's quarterback.",
  defenseTip: "The defense you line up against.",
  swap: "Swap Sides",
  field: "Play It on the Field",
  fieldNote: (offense: string, defense: string) =>
    `Opens Pocket Franchise in a new tab: you're ${offense}'s quarterback against ${defense}'s defense, every player at his current skills.`,
  sim: "Sim Game Day",
  simNote: "Or sim this week's game in the season and see the final.",
  alone: (offense: string) => `Opens Pocket Franchise in a new tab with ${offense} on offense.`,
  opening: "Opening the field…",
  blocked: "Pop-ups are blocked, so allow them for this site and try again.",
  failed: (msg: string) => `Couldn't send the teams: ${msg}.`,
} as const;
