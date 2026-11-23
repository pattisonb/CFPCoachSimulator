export const messages = {
  title: "Recruiting Board",
  nil: "NIL Left",
  offers: "Offers",
  commits: "Commits",
  scout: "Scouting",
  scoutTip: "Your scouting points left this week. Sending a scout to look at a recruit spends them.",

  stages: "Stage",
  noneAtStage: "No one on your board is at this stage.",
  stageNames: {
    all: "All",
    favorites: "Favorites",
    offered: "Offered",
    scouted: "Fully Scouted",
    partly: "Partly Scouted",
    unscouted: "Unscouted",
    committed: "Committed",
    visited: "Visited",
    top: "Top 8",
    contact: "In Touch",
    cold: "Cold",
    gone: "Elsewhere",
  } as Record<string, string>,
  /** the top-group stage by its size this week: his top 8, then his finalists (5, 3) */
  topN: (n: number) => `Top ${n}`,
  /** the Committed stage once the class has signed */
  signedStage: "Signed",
  search: "Search Your Board",
  position: "Position",
  allPositions: "Any Pos",
  needs: "Class Needs",
  needsTip:
    "Your commits, board or offers at each position (the menu picks which), of the spots your class set out to fill there. Pick a position to list only those recruits.",
  triage: "Triage",
  triageTip: "Color each position by how pressing its need is.",
  triageLevel: (level: number, leaving: number, starters: number) =>
    level === 0
      ? "Covered: the class needs no one else here."
      : level === 1
        ? "Depth: spots to fill, and every starter is back."
        : level === 3
          ? starters === 1
            ? "Urgent: your starter leaves."
            : `Urgent: all ${starters} starters leave.`
          : `Pressing: ${leaving} of ${starters} starters ${leaving === 1 ? "leaves" : "leave"}.`,
  needShow: "Count",
  needShows: { commits: "Committed / Need", board: "On Board / Need", offers: "Offered / Need" },
  filledShort: (have: number, of: number) => `${have}/${of}`,
  filledOf: (have: number, of: number) => `${have} of ${of} Spots Filled`,
  onBoardN: (n: number) => `${n} on Your Board`,
  sort: "Sort",
  sortChance: "Chance",
  sortChanceHint: "Your best chances first.",
  sortRank: "Rank",
  sortRankHint: "By national rank.",

  empty: "Your Board Is Empty",
  emptyText: "Start with the prospects who fit your needs, or find your own and star them.",
  findProspects: "Find Prospects",
  addRecommended: (n: number) => `Add ${n} Recommended`,
  adding: "Adding…",
  pickOne: "Pick a recruit to work him.",

  // the recruit's panel
  about: "About Him",
  tabs: { overview: "Overview", scouting: "Scouting", profile: "Profile", history: "History" },
  ranks: (nat: number, pos: number, posName: string) => `#${nat} Nat. · #${pos} ${posName}`,
  chance: "Chance",
  noOffer: "None Yet",
  nilAmount: (n: number) => `${n} NIL`,
  hisList: "His List",
  place: (at: number) => `#${at}`,
  onList: (at: number) => `#${at} on His List`,
  listPlace: (at: number, of: number) => `#${at} of ${of}`,
  outside: "Outside His Top 5",
  notOnIt: "Not on It",
  hisAsk: "His Ask",
  ask: (lo?: number, hi?: number, exact?: number) =>
    exact != null ? `${exact} NIL` : lo != null && hi != null ? `${lo}–${hi} NIL` : "Not Known Yet",
  // a range is your scouts' read so far: said on hover wherever one shows
  askTip: (lo: number, hi: number) => `${lo}–${hi} NIL. Scout him fully to learn his number.`,
  askScout: "Scout him fully to learn his number.",
  hoursLeft: (n: number) => `${n} Energy Left`,
  offBoardTip: "Take him off your board. An offer he holds is pulled.",
  offer: "Your Offer",
  cooled: (why: string | null) =>
    COOLED[why ?? ""] ?? "He's cooled on you. Contacts count half until he warms back up.",
  moneyOwed: (owed: { nil: number | null; sure?: number }, by: string) =>
    owed.nil != null
      ? `You talked money: put at least ${owed.nil} NIL on your offer by ${by}, or he cools on you.`
      : `You talked money: put most of his ask on your offer by ${by}, or he cools on you. ${owed.sure ?? 0} NIL is sure to cover it. Scout him fully to learn his number.`,
  jobPromised: "Job Promised",
  jobPromisedTip:
    "You promised him a starting role. It is judged through his first season, and a broken promise costs you.",
  promiseRole: "Promise a Starting Role",
  afterOffer: "After Your Offer",
  promiseRoleHelp:
    "Counts for more if playing time is one of his priorities. It is judged through his first season, and a broken promise costs you.",
  promisedRole: "You promised him a starting role.",
  flipRisk: (word: string, school: string) =>
    word === "Likely"
      ? `${school} is close to flipping him.`
      : `${school} is working him hard: a real chance he flips.`,
  pestering: "He feels pestered. Ease off until a visit or an offer changes things.",
  unpaid: (school: string | null, flip?: boolean) =>
    flip
      ? "He will not flip to you on that offer. Raise it."
      : school
        ? `He will not commit to you on that offer while ${school} is after him. Raise it.`
        : "He will not commit to you on that offer. Raise it.",
  pressed: (school: string) => `${school} is still calling your commit. Keep in touch.`,

  fromSchool: (school: string) => `From ${school}`,
  work: "Work Him",
  deadPeriod: (signing: string) =>
    `Recruiting is closed until Signing Day${signing ? `, after the ${signing}` : ""}. No offers, messages, calls, visits or scouting. He is deciding among the offers he holds, and he can still commit or flip.`,
  message: "Message",
  /** the quick actions on a recruit's row and card */
  quick: { message: "Message", call: "Call", call_recruit: "Video Call" } as Record<string, string>,
  /** the same three, short enough for a box on his row */
  quickShort: { message: "Message", call: "Call", call_recruit: "Video" } as Record<string, string>,
  quickLabel: (name: string) => `Quick actions: ${name}`,
  quickTip: (what: string, n: number) =>
    `${what} · ${n} Energy. Tick it to plan it: it goes out when you sim the week.`,
  quickPlanned: (what: string, n: number) => `${what} is planned (${n} Energy held). Click to take it back.`,
  quickDone: (what: string) => `${what}: done this week.`,
  quickOff: "He is not taking calls.",
  energy: (n: number) => `${n} NRG`,
  offerFirst: "Offer him first.",
  hcWait: (n: number) => (n === 1 ? "In 1 Week" : `In ${n} Weeks`),
  hcMonthly: "Your head coach visits a recruit once a month.",
  promiseFree: "Free",
  promised: "Promised",
  promisedTip:
    "You promised him a starting role. It is judged through his first season, and a broken promise costs you.",
  visited: "Visited",
  favorite: "Favorite",
  favoriteTip: "Mark him as one of your favorites. It is your own list: a filter here and on Prospects.",
  favoriteOnTip: "One of your favorites. Click to take him off the list.",
  addFavorite: (name: string) => `Add ${name} to your favorites.`,
  removeFavorite: (name: string) => `Take ${name} off your favorites.`,
  hcVisit: "HC Visit",
  hours: (n: number) => `${n} NRG`,
  doneThisWeek: "Done this week.",
  openTalk: { call: "Your call with him is still open.", hc_visit: "Your visit with him is still open." } as Record<
    string,
    string
  >,
  finishTalk: { call: "Finish the Call", hc_visit: "Finish the Visit" } as Record<string, string>,
  done: "Done",
  notEnough: "Not enough energy left this week.",
  makeOffer: (n: number) => `Offer · ${n} NIL`,
  raise: "Raise NIL",
  pull: "Pull Offer",
  pullConfirm: (name: string) => `Pull your offer to ${name}?`,
  officialVisit: "Official Campus Visit",
  wk: (n: number) => `Wk ${n}`,
  pickWeekend: "Pick a home weekend",
  invite: (n: number) => `Invite · ${n} NRG`,
  offBoard: "Off My Board",
  offBoardConfirm: (name: string) => `${name} holds your offer. Taking him off your board pulls it. Go ahead?`,

  // what an action says when it lands (web/recruiting.js SAID): `n` is its hours, or its NIL for an offer
  said: {
    message: (name: string, n: number) => `Message sent to ${name} · ${n} Energy.`,
    scout: (name: string, n: number) => `Scout sent to ${name} · ${n} points.`,
    official_visit: (name: string, n: number) => `Official visit invite to ${name} · ${n} Energy.`,
    offer: (name: string, n: number) => `Offer sent to ${name} · ${n} NIL.`,
    raise_nil: (name: string, n: number) => `Offer to ${name} raised to ${n} NIL.`,
    pull_offer: (name: string) => `Offer to ${name} pulled.`,
  } as Record<string, (name: string, n: number) => string>,
  revealed: (topic: string) => `He told you he cares about ${topic}.`,
  failed: (msg: string) => `Couldn't do that: ${msg.replace(/[.\s]+$/, "")}.`,

  week: (n: number) => `Week ${n}`,
} as const;

/** Why he cooled on you (the board's cooled_why), and what warms him back up. */
const COOLED: Record<string, string> = {
  lowball:
    "He read your offer as a lowball. Contacts count half and he won't visit until you raise it to what he wants.",
  promise: "He doubts a promise you made. Contacts count half and he won't visit until he cools off.",
  quiet: "He felt ignored. Call or visit to warm him back up; contacts count half and he won't visit until then.",
  game: "He saw you lose. Contacts count half until he warms back up.",
};
