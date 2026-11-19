import { ordinal } from "../../format.ts";

export const messages = {
  title: "Awards",
  tabs: { overview: "Overview", heisman: "Heisman" },
  loading: "Loading the awards…",
  loadError: (msg: string) => `Couldn't load the awards: ${msg}.`,

  // the status at the bar's end
  live: (week: string) => `Live Race · Through ${week}`,
  final: "Final",
  sample: "Sample",
  preseason: "Preseason Favorites",
  preseasonTip:
    "The races take shape in Week 4. Until then these are the preseason favorites: the best-rated starters at each award's positions, helped by where their team is ranked.",
  sampleTip: "The races take shape in Week 4. Until then this is sample data, so you can see how the page works.",
  liveNote:
    "Who would win if the voting were held now. Conference awards are given after championship week, the Heisman and national awards in selection week, the postseason awards after the title game.",

  // the Heisman banner
  heisman: "Heisman Trophy",
  strawPoll: "Heisman Straw Poll",
  leader: "Leader",
  winner: "Winner",
  points: "Points",
  share: (share: number, ballots: number) => `${share}% of Possible · ${ballots} Ballots`,
  pts: (n: number) => `${n.toLocaleString("en-US")} pts`,
  chasing: "Chasing Him",
  openVote: "See the Full Vote",
  noHeisman: "No Heisman Race Yet",
  noHeismanText: "The race starts once a few games are played.",

  // award cards
  national: "National Awards",
  coaches: "Coach Awards",
  groups: {
    all: "All",
    poy: "Player of the Year",
    offense: "Offense",
    defense: "Defense",
    special: "Special Teams",
  } as Record<string, string>,
  groupsLabel: "Which awards",
  noRace: "No eligible players yet.",
  noAwards: "No award races yet.",
  coachLine: (w: number, l: number, rank: number | null | undefined) => `${w}-${l}${rank ? ` · #${rank}` : ""}`,
  headCoach: "Head Coach",

  // your team
  yourHonors: (team: string) => `${team} Honors`,
  honors: "Honors",
  racesLed: "Races Led",
  awardsWon: "Awards Won",
  people: "Players and Coaches",
  noHonorsLive: "Nobody from your team is in a top five yet.",
  noHonors: "No awards or placements this season.",
  place: (n: number) => ordinal(n),
  finalist: "Finalist",
  inVote: (n: number) => `${ordinal(n)} in the Vote`,

  // the Heisman table
  vote: "The Vote",
  cols: {
    rank: "#",
    player: "Player",
    team: "Team",
    record: "Record",
    first: "1st",
    second: "2nd",
    third: "3rd",
    points: "Points",
  },
  colsTip: {
    first: "First-place votes (3 points)",
    second: "Second-place votes (2 points)",
    third: "Third-place votes (1 point)",
  },
  ballotsLine: (ballots: number, possible: number) =>
    `${ballots} ballots, ${possible.toLocaleString("en-US")} points possible. First place is worth 3, second 2, third 1.`,
} as const;
