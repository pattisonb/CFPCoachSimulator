import type { AwardPlayer, CoachAward, HeismanCandidate, NationalAwards, PlayerAward } from "../../types.ts";

// A preseason stand-in: before Week 4 the races have no shape (no Heisman, no awards), so the page shows this sample
// under a Sample tag instead of an empty screen. Real teams, made-up players; nothing here reaches the game.

type Seed = [
  name: string,
  position: string,
  cls: string,
  team: string,
  teamName: string,
  conf: string,
  line: string,
  headline: string,
];

const P = ([name, position, cls, team, team_name, conference, line, headline]: Seed): AwardPlayer => ({
  name,
  position,
  role: position,
  class: cls,
  team,
  team_name,
  conference,
  games: 3,
  line,
  headline,
  score: 0,
  slug: `sample-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`,
});

const QB1: Seed = [
  "Marcus Bell",
  "QB",
  "JR",
  "texas",
  "Texas",
  "SEC",
  "71/98, 1,024 Yds, 11 TD, 1 INT",
  "1,024 Yds · 11 TD",
];
const WR1: Seed = [
  "Dante Rivers",
  "WR",
  "SO",
  "ohio-state",
  "Ohio State",
  "Big Ten",
  "24 Rec, 418 Yds, 6 TD",
  "418 Yds · 6 TD",
];
const RB1: Seed = [
  "Isaiah Monroe",
  "RB",
  "JR",
  "oregon",
  "Oregon",
  "Big Ten",
  "61 Car, 455 Yds, 5 TD",
  "455 Yds · 5 TD",
];
const QB2: Seed = [
  "Cole Whitaker",
  "QB",
  "SRRS",
  "georgia",
  "Georgia",
  "SEC",
  "64/90, 902 Yds, 9 TD, 0 INT",
  "902 Yds · 9 TD",
];
const QB3: Seed = [
  "Jalen Price",
  "QB",
  "SR",
  "miami",
  "Miami",
  "ACC",
  "70/104, 955 Yds, 8 TD, 2 INT",
  "955 Yds · 8 TD",
];
const TE1: Seed = [
  "Brody Hayes",
  "TE",
  "JR",
  "penn-state",
  "Penn State",
  "Big Ten",
  "15 Rec, 201 Yds, 3 TD",
  "201 Yds · 3 TD",
];
const LB1: Seed = [
  "Terrell Vaughn",
  "LB",
  "SR",
  "alabama",
  "Alabama",
  "SEC",
  "31 Tkl, 4.5 TFL, 2 Sacks",
  "31 Tkl · 4.5 TFL",
];
const DE1: Seed = ["Kobe Ellison", "DL", "JR", "lsu", "LSU", "SEC", "12 Tkl, 5 Sacks, 2 FF", "5 Sacks · 2 FF"];
const DB1: Seed = [
  "Andre Simms",
  "CB",
  "SO",
  "notre-dame",
  "Notre Dame",
  "FBS Independents",
  "9 Tkl, 3 INT, 6 PD",
  "3 INT · 6 PD",
];
const DB2: Seed = ["Malik Ford", "S", "JR", "clemson", "Clemson", "ACC", "18 Tkl, 2 INT", "2 INT · 18 Tkl"];
const K1: Seed = ["Will Carter", "K", "SR", "smu", "SMU", "ACC", "8/9 FG, long 52", "8/9 FG"];
const OL1: Seed = [
  "Grant Moody",
  "OL",
  "SR",
  "michigan",
  "Michigan",
  "Big Ten",
  "212 Snaps, 0 Sacks Allowed",
  "0 Sacks Allowed",
];

const heismanRow = (
  s: Seed,
  first: number,
  second: number,
  third: number,
  record: string,
  rank: number | null,
): HeismanCandidate => ({
  ...P(s),
  first,
  second,
  third,
  points: 3 * first + 2 * second + third,
  region: "",
  record,
  rank,
});

const award = (name: string, kind: string, honors: string, seeds: Seed[]): PlayerAward => {
  const race = seeds.map(P);
  return { name, kind, honors, winner: race[0], finalists: race.slice(0, 3), race };
};

const coach = (name: string, c: string, team: string, team_name: string, w: number, l: number): CoachAward => {
  const x = { team, team_name, conference: "", coach: c, wins: w, losses: l, rank: null, preseason_rank: null };
  return { name, winner: x, finalists: [x] };
};

export const SAMPLE: NationalAwards = (() => {
  const candidates = [
    heismanRow(QB1, 41, 22, 14, "3-0", 2),
    heismanRow(WR1, 30, 25, 18, "3-0", 1),
    heismanRow(RB1, 14, 21, 20, "3-0", 5),
    heismanRow(QB2, 9, 15, 22, "2-1", 9),
    heismanRow(QB3, 3, 11, 16, "3-0", 12),
  ];
  return {
    heisman: {
      candidates,
      winner: candidates[0],
      finalists: candidates.slice(0, 4),
      ballots: 97,
      possible: 291,
      share: 60,
    },
    awards: [
      award("Maxwell Award", "mvp", "college player of the year", [QB1, WR1, RB1]),
      award("Davey O'Brien Award", "qb", "best quarterback", [QB1, QB2, QB3]),
      award("Doak Walker Award", "rb", "best running back", [RB1]),
      award("Fred Biletnikoff Award", "wr", "best receiver", [WR1]),
      award("John Mackey Award", "te", "best tight end", [TE1]),
      award("Outland Trophy", "interior", "best interior lineman, offense or defense", [OL1]),
      award("Chuck Bednarik Award", "dpoy", "defensive player of the year", [LB1, DE1, DB1]),
      award("Butkus Award", "lb", "best linebacker", [LB1]),
      award("Ted Hendricks Award", "edge", "best defensive end", [DE1]),
      award("Jim Thorpe Award", "db", "best defensive back", [DB1, DB2]),
      award("Lou Groza Award", "k", "best place-kicker", [K1]),
    ],
    coach_awards: [
      coach("AP Coach of the Year", "Steve Sarkisian", "texas", "Texas", 3, 0),
      coach("Eddie Robinson Coach of the Year", "Rhett Lashlee", "smu", "SMU", 3, 0),
    ],
  };
})();
