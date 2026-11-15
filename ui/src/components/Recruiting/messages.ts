export const messages = {
  title: "Recruiting Board",
  classLine: (year: number, n: number) => `Class of ${year} · ${n} on Your Board`,
  nil: "NIL Left",
  offers: "Offers",
  commits: "Commits",
  auto: "Auto-Recruit",
  autoModes: { off: "Off", week: "This Week", season: "All Season" } as Record<string, string>,

  stages: "Stage",
  stageNames: {
    all: "All",
    committed: "Committed",
    visited: "Visited",
    top: "Top 8",
    contact: "In Touch",
    cold: "Cold",
    gone: "Elsewhere",
  } as Record<string, string>,
  sort: "Sort",
  sortChance: "Your Chance",
  sortRank: "National Rank",

  empty: "Your Board Is Empty",
  emptyText: "Start with the prospects who fit your needs, or find your own and star them.",
  findProspects: "Find Prospects",
  addRecommended: (n: number) => `Add ${n} Recommended`,
  adding: "Adding…",
  pickOne: "Pick a recruit to work him.",

  // the recruit's panel
  ranks: (nat: number, pos: number, posName: string) => `#${nat} Nationally · #${pos} ${posName}`,
  chance: "Your Chance",
  hisList: "His List",
  noList: "No school has his attention yet.",
  offered: "Offered",
  visit: (label: string) => `Visit ${label}`,
  visited: "Visited",
  you: "You",
  aSchool: "A school",
  offer: "Your Offer",
  noOffer: "No Offer Yet",
  nilAmount: (n: number) => `${n} NIL`,
  ask: (lo?: number, hi?: number, exact?: number) =>
    exact != null
      ? `His Ask: ${exact} NIL`
      : lo != null && hi != null
        ? `His Ask: ${lo}–${hi} NIL`
        : "His Ask: Unknown",
  wants: "What He Wants",
  unknown: "Not Known Yet",
  wantsTip: "His three priorities. Calls and visits reveal them; pitch what he cares about.",
  cooled: (why: string | null) => `He's cooled on you${why ? `: ${why}` : ""}.`,
  pestering: "He feels pestered. Ease off until a visit or an offer changes things.",

  work: "Work Him",
  pitch: "Pitch",
  pitchFit: (word: string) => `Your Pull: ${word}`,
  pulls: { strong: "Strong", fair: "Fair", weak: "Weak" },
  message: "Message",
  call: "Call",
  hcVisit: "HC Visit",
  hours: (n: number) => `${n} hrs`,
  doneThisWeek: "Done this week.",
  openTalk: { call: "Your call with him is still open.", hc_visit: "Your visit with him is still open." } as Record<
    string,
    string
  >,
  finishTalk: { call: "Finish the Call", hc_visit: "Finish the Visit" } as Record<string, string>,
  done: "Done",
  notEnough: "Not enough hours left this week.",
  makeOffer: (n: number) => `Offer · ${n} NIL`,
  raise: "Raise NIL",
  pull: "Pull Offer",
  pullConfirm: (name: string) => `Pull your offer to ${name}?`,
  officialVisit: "Official Visit",
  pickWeekend: "Pick a home weekend",
  invite: (n: number) => `Invite · ${n} hrs`,
  offBoard: "Off My Board",
  offBoardConfirm: (name: string) => `${name} holds your offer. Taking him off your board pulls it. Go ahead?`,

  // what an action says when it lands (web/recruiting.js SAID): `n` is its hours, or its NIL for an offer
  said: {
    message: (name: string, n: number) => `Message sent to ${name} · ${n} hours.`,
    official_visit: (name: string, n: number) => `Official visit invite to ${name} · ${n} hours.`,
    offer: (name: string, n: number) => `Offer sent to ${name} · ${n} NIL.`,
    raise_nil: (name: string, n: number) => `Offer to ${name} raised to ${n} NIL.`,
    pull_offer: (name: string) => `Offer to ${name} pulled.`,
  } as Record<string, (name: string, n: number) => string>,
  revealed: (topic: string) => `He told you he cares about ${topic}.`,
  failed: (msg: string) => `Couldn't do that: ${msg}.`,

  recent: "Recent",
  week: (n: number) => `Week ${n}`,
  hist: {
    offer: (school: string, nil?: number) => `${school} offered${nil ? ` (${nil} NIL)` : ""}.`,
    contact: (school: string, action?: string) =>
      `${school}: ${action ? (ACTION_NAMES[action] ?? action) : "contact"}.`,
    hung_up: (school: string) => `${school} left a call unfinished.`,
    commit: (school: string) => `Committed to ${school}.`,
    decommit: (school: string) => `Decommitted from ${school}.`,
  },
} as const;

const ACTION_NAMES: Record<string, string> = {
  message: "a message",
  call: "a call",
  hc_visit: "a head coach visit",
  official_visit: "an official visit",
};
