import type { HqBoard, HqClasses, HqDepth, HqProspects, HqScouting, HqView, Sources } from "./types.ts";

// Canned data for the catalog's previews (web/hq-widgets/*.js SAMPLE_*): a widget drawn from these never asks the
// server for anything. "you" is your school in every sample.

const P = (id: string, name: string, position: string, stars: number, extra: object = {}) => ({
  id,
  name,
  position,
  display_pos: position,
  stars,
  national_rank: 10,
  looks: 1,
  ...extra,
});

export const SAMPLE_BOARD = {
  week: 6,
  committed: 9,
  open_spots: 14,
  class_rank: 6,
  offers: 21,
  offers_left: 14,
  hours: 155,
  hours_left: 95,
  nil: { budget: 275, left: 120 },
  points_left: 140,
  points_week: 230,
  targets: [
    P("s1", "Marcus Williams", "CB", 5, { sample_word: "Clear Favorite", offered: true }),
    P("s2", "Caleb Mitchell", "OT", 4, { sample_word: "Close Race", offered: true, looks: 0 }),
    P("s3", "David Johnson", "WR", 4, { sample_word: "Narrow Favorite" }),
    P("s4", "James Taylor", "DL", 4, { sample_word: "Behind, In the Picture" }),
    P("s5", "Tyler White", "LB", 3, { sample_word: "Long Shot" }),
  ],
  needs_detail: {
    QB: { need: 1, commits: 1, board: 0 },
    WR: { need: 3, commits: 1, board: 5 },
    OL: { need: 4, commits: 2, board: 6 },
    DL: { need: 3, commits: 1, board: 4 },
    CB: { need: 2, commits: 0, board: 3 },
    LB: { need: 1, commits: 1, board: 2 },
  },
  board: [
    P("s1", "Marcus Williams", "CB", 5, {
      offered: true,
      sample_word: "Clear Favorite",
      visit: { week: 8, done: false },
    }),
    P("s2", "Caleb Mitchell", "OT", 4, { offered: true, looks: 0, sample_word: "Close Race" }),
    P("s3", "David Johnson", "WR", 4, {
      offered: true,
      visit: { week: 9, done: false },
      sample_word: "Narrow Favorite",
    }),
    P("s4", "James Taylor", "DL", 4, { offered: true, committed: "georgia", hard: true }),
    P("s5", "Tyler White", "LB", 3, { offered: false, looks: 0, sample_word: "Long Shot" }),
    P("s6", "Terrell Davis", "RB", 5, {
      offered: true,
      committed: "you",
      visit: { week: 5, done: true },
      job_promised: true,
    }),
    P("s7", "Lucas Franklin", "CB", 4, { offered: true, committed: "you", money_owed: { nil: 45, by_week: 9 } }),
  ],
  recap: [
    { week: 4, kind: "commit", pid: "s7", name: "Lucas Franklin", school: "you" },
    { week: 5, kind: "offer", pid: "s2", name: "Caleb Mitchell", school: "georgia" },
    { week: 5, kind: "commit", pid: "s6", name: "Terrell Davis", school: "you" },
  ],
} as unknown as HqBoard;

export const SAMPLE_CONTACTS: Record<string, number> = { s1: 6, s3: 5, s4: 1 };

export const SAMPLE_CLASSES: HqClasses = {
  schools: [
    { school: "s-a", name: "Georgia", count: 18, rank: 1, stars: { "5": 4, "4": 10, "3": 4, "2": 0 } },
    { school: "s-b", name: "Texas", count: 16, rank: 2, stars: { "5": 3, "4": 9, "3": 4, "2": 0 } },
    { school: "you", name: "Your School", count: 9, rank: 3, yours: true, stars: { "5": 2, "4": 5, "3": 2, "2": 0 } },
    { school: "s-c", name: "Alabama", count: 15, rank: 4, stars: { "5": 2, "4": 9, "3": 4, "2": 0 } },
    { school: "s-d", name: "Ohio State", count: 14, rank: 5, stars: { "5": 3, "4": 7, "3": 4, "2": 0 } },
  ],
};

export const SAMPLE_MYCLASS: HqClasses = {
  schools: SAMPLE_CLASSES.schools,
  class: [
    { ...P("s6", "Terrell Davis", "RB", 5), national_rank: 8, signed: "you" },
    { ...P("s7", "Lucas Franklin", "CB", 4), national_rank: 61, committed: "you" },
    { ...P("s8", "Andre Coleman", "OT", 4), national_rank: 97, committed: "you" },
    { ...P("s9", "Jalen Brooks", "WR", 3), national_rank: 340, committed: "you" },
  ],
};

export const SAMPLE_PROSPECTS: HqProspects = {
  rows: [
    { ...P("s8", "Derrick Clark", "LB", 4), on_board: false },
    { ...P("s9", "Ethan Harris", "WR", 4), on_board: true },
    { ...P("s10", "Ryan Edwards", "OT", 3), on_board: false },
  ],
};

export const SAMPLE_SCOUTING: HqScouting = {
  queue: [
    {
      pid: "s1",
      name: "Marques Williams",
      position: "EDGE",
      stars: 5,
      looks: 1,
      can_send: true,
      on_board: true,
      potential: ["Strong", "Elite"],
    },
    { pid: "s2", name: "Aden Neal", position: "OT", stars: 4, looks: 0, can_send: true, on_board: false },
    {
      pid: "s3",
      name: "Davis Hammond",
      position: "QB",
      stars: 4,
      looks: 2,
      can_send: true,
      on_board: true,
      potential: ["Solid", "Strong"],
    },
  ],
  flags: [
    { pid: "s4", name: "Robert Soles", position: "LB", stars: 3, flag: "gem", likes: null, on_board: false },
    { pid: "s5", name: "James Clanton", position: "LB", stars: 4, flag: "likes", likes: { who: "DC" }, on_board: true },
  ],
  scouts: [
    {
      id: "a1",
      name: "Mark Johnson",
      role: "Area Scout",
      area: "Texas",
      evaluation_word: "Strong",
      yield: { looks: 6.5, flags: 1 },
    },
    {
      id: "a2",
      name: "Chris Williams",
      role: "Area Scout",
      area: "Florida",
      evaluation_word: "Solid",
      yield: { looks: 4, flags: 0 },
    },
  ],
};

export const SAMPLE_SCOUTED: HqScouting = {
  queue: [
    {
      pid: "s1",
      name: "Marques Williams",
      position: "EDGE",
      stars: 5,
      looks: 3,
      potential: ["Elite", "Elite"],
      on_board: true,
      flags: ["gem"],
    },
    {
      pid: "s2",
      name: "Aden Neal",
      position: "OT",
      stars: 4,
      looks: 2,
      potential: ["Solid", "Strong"],
      on_board: false,
      flags: [],
    },
    {
      pid: "s3",
      name: "Davis Hammond",
      position: "QB",
      stars: 4,
      looks: 1,
      potential: ["Fair", "Strong"],
      on_board: true,
      flags: [],
    },
    {
      pid: "s4",
      name: "Robert Soles",
      position: "LB",
      stars: 3,
      looks: 3,
      potential: ["Strong", "Strong"],
      on_board: false,
      flags: [],
    },
  ],
};

export const SAMPLE_OUTLOOK: NonNullable<HqView["outlook"]> = {
  players: [
    {
      name: "Marcus Lane",
      position: "CB",
      class: "SR",
      overall: 88,
      starter: true,
      leaving: "graduation",
      draft: null,
      transfer: null,
      replacement: { pid: "s1", name: "Marcus Williams", status: "Offered" },
    },
    {
      name: "Caleb Ford",
      position: "OT",
      class: "JR",
      overall: 91,
      starter: true,
      leaving: null,
      draft: "Likely",
      transfer: "Low",
      replacement: { pid: "s2", name: "Caleb Mitchell", status: "Committed" },
    },
    {
      name: "Drew Hill",
      position: "WR",
      class: "SO",
      overall: 74,
      starter: true,
      leaving: null,
      draft: null,
      transfer: "High",
    },
  ],
  counts: { graduation: 17, draft: 2, draft_likely: 1, transfer_high: 9, transfer_some: 12, roster: 85 },
};

export const SAMPLE_DEPTH: HqDepth = {
  units: [
    {
      name: "Offense",
      rows: [
        {
          role: "QB",
          label: "Quarterback",
          players: [
            { name: "J. Sanders", overall: 88, promise: "On Track" },
            { name: "D. Williams", overall: 80 },
          ],
        },
        {
          role: "RB",
          label: "Running Back",
          players: [
            { name: "C. Cooper", overall: 82 },
            { name: "M. Harris", overall: 80 },
          ],
        },
        {
          role: "WR",
          label: "Receiver",
          players: [
            { name: "D. Thomas", overall: 85, promise: "Slipping" },
            { name: "R. Davis", overall: 85 },
          ],
        },
      ],
    },
  ],
};

export const SAMPLE_SEASON: NonNullable<Sources["season"]> = {
  current_week: 5,
  schedule: [
    { week: 6, opponent: "x", opponent_name: "USC", venue: "home", played: false },
    { week: 7, opponent: "y", opponent_name: "Penn State", venue: "away", played: false },
    { week: 8, opponent: "z", opponent_name: "Iowa", venue: "home", played: false },
  ] as unknown as NonNullable<Sources["season"]>["schedule"],
};

export const SAMPLE_NEXT: NonNullable<HqView["next_year"]> = {
  groups: [
    {
      group: "QB",
      target: 4,
      filled: 3,
      need: 1,
      players: [
        { name: "J. Sanders", position: "QB", class_next: "SR", overall: 88 },
        { name: "D. Williams", position: "QB", class_next: "SO", overall: 74 },
      ],
      commits: [{ pid: "s1", name: "Marcus Williams", stars: 5, position: "QB" }],
      targets: [{ pid: "s3", name: "Tre Jackson", stars: 4, position: "QB", kind: "offered" }],
    },
    {
      group: "WR",
      target: 11,
      filled: 9,
      need: 2,
      players: [
        { name: "D. Thomas", position: "WR", class_next: "JR", overall: 85, draft: "Possible" },
        { name: "R. Davis", position: "WR", class_next: "SO", overall: 79 },
      ],
      commits: [],
    },
  ],
};

const L = (prestige: string, winning: string, nil: string, pro: string) => ({ prestige, winning, nil, pro });
export const SAMPLE_PROGRAMS = {
  you: {
    team: "you",
    name: "Your School",
    tier_name: "Power",
    prestige: 74,
    winning: 68,
    nil: 71,
    pro: 66,
    letters: L("B+", "B", "B", "B-"),
  },
  rows: [
    {
      team: "a",
      name: "Georgia",
      tier_name: "Blue Blood",
      prestige: 95,
      winning: 93,
      nil: 92,
      pro: 96,
      letters: L("A+", "A", "A", "A+"),
    },
    {
      team: "b",
      name: "Texas",
      tier_name: "Blue Blood",
      prestige: 94,
      winning: 88,
      nil: 95,
      pro: 90,
      letters: L("A+", "A", "A+", "A"),
    },
    {
      team: "you",
      name: "Your School",
      tier_name: "Power",
      prestige: 74,
      winning: 68,
      nil: 71,
      pro: 66,
      letters: L("B+", "B", "B", "B-"),
    },
    {
      team: "c",
      name: "Alabama",
      tier_name: "Blue Blood",
      prestige: 97,
      winning: 86,
      nil: 90,
      pro: 97,
      letters: L("A+", "A-", "A", "A+"),
    },
  ],
};
