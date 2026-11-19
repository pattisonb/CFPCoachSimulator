export const messages = {
  title: "Rankings",
  tabs: { ap: "AP Top 25", coaches: "Coaches Poll", cfp: "CFP Rankings" },
  weekLabel: "Week",
  preseason: "Preseason",
  week: (n: number) => `Week ${n}`,
  yours: (team: string, rank: number) => `${team} · #${rank}`,

  rank: "Rank",
  move: "Move",
  moveTip: "Where the team was in last week's poll.",
  team: "Team",
  record: "Record",
  conference: "Conference",
  points: "Points",
  firstPlace: "1st",
  firstPlaceTip: "First-place votes.",

  newIn: "New",
  noChange: "No change",
  up: (n: number) => `Up ${n}`,
  down: (n: number) => `Down ${n}`,

  last: "Last Result",
  boxScore: "Open the box score",
  openResume: (team: string) => `Open ${team}'s resume`,
  next: "Next Game",
  win: "W",
  loss: "L",
  vs: "vs",
  at: "at",

  others: "Others Receiving Votes",
  dropped: "Dropped Out",
  noPoll: "No poll yet.",

  cfpWaiting: "The Committee Hasn't Ranked Yet",
  cfpWaitingText: (week: number) =>
    `The College Football Playoff committee releases its first ranking after Week ${week}, and a new one every week until selection day. Until then the Bracket shows where the field would stand from the AP poll.`,
  seeBracket: "See the Projected Bracket",
} as const;
