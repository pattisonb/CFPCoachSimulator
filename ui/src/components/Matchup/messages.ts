export const messages = {
  ratings: "Team Ratings",
  ratingShort: { overall: "OVR", offense: "OFF", defense: "DEF" },
  ratingTips: { overall: "Team Overall", offense: "Offense", defense: "Defense" },
  conference: (record: string, conference: string) => `(${record} ${conference})`,
} as const;
