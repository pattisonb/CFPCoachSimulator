export const messages = {
  title: "Programs",
  loading: "Loading the programs…",
  loadError: (msg: string) => `Couldn't load the programs: ${msg}.`,
  yours: (team: string, tier: string) => `${team} · ${tier}`,

  yourProgram: "Your Program",
  hide: "Hide Details",
  show: "Show Details",
  everyProgram: "Every Program",
  schoolGrades: "School Grades",
  schoolGradesTip:
    "Your program in twelve measures, each in one of eight words: Elite, Excellent, Strong, Good, Solid, Fair, Thin, Weak. Football's six and NIL move with results; the campus grades come from the record.",
  football: "Football",
  campus: "Campus",
  proPotential: "Position Pro Potential",
  proPotentialTip:
    "Where your program's last ten drafts came from, by draft position, best first. A position it never sent reads Weak.",
  adGoal: "Your AD's Goal",
  ultimatum: "Ultimatum Year",
  notGraded: "Not Graded",
  moved: (up: boolean, n: number) => `${up ? "Up" : "Down"} ${n} since last season.`,

  tierLabel: "Which tier",
  allTiers: "All",
  sortHint: "Click a Column to Sort",
  openResume: (team: string) => `Open ${team}'s resume`,
  cols: { program: "Program", standing: "Standing" },

  /** the twelve measures, and the market (a headline reading and a column) */
  measures: {
    prestige: "Prestige",
    winning: "Winning",
    coach: "Coach",
    stability: "Stability",
    conference: "Conference",
    pro: "Pro Pipeline",
    academics: "Academics",
    facilities: "Facilities",
    location: "Location",
    game_day: "Game Day",
    exposure: "Exposure",
    nil: "NIL",
    market: "Market",
  },
  /** a shorter name for a table's header */
  short: { conference: "Conf" } as Record<string, string>,
  tips: {
    standing:
      "Where the program stands: its name, results, NIL, market, league, coach and pro pipeline, moving slowly with what it does.",
    prestige: "History and a decade of results.",
    winning: "The last three seasons.",
    nil: "The collective's tier, set by the AD.",
    market: "Crowds and TV.",
    conference: "The league's strength.",
    coach: "The head coach's rating and tenure.",
    pro: "The last ten drafts, by position.",
    academics: "U.S. News rank, and the football team's graduation and progress rates.",
    facilities:
      "How recently the stadium, the football building and the indoor practice facility were built or renovated.",
    location: "The size of the metro and the winter weather.",
    stability: "How few head coaches the program has had since 2010.",
    game_day: "The home crowd and how full the stadium is.",
    exposure: "TV audiences and the football team's Instagram following.",
  } as Record<string, string>,
} as const;
