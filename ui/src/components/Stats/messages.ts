type S = Record<string, number>;
const n = (v: number | undefined) => (v ?? 0).toLocaleString("en-US");

export const messages = {
  title: "Stats",
  tabs: { players: "Players", teams: "Teams", injuries: "Injuries" },
  injuries: "Injury Report",
  injuryCount: (n: number) => `${n} ${n === 1 ? "Player" : "Players"} Out`,
  injuryCols: { player: "Player", team: "Team", injury: "Injury", out: "Out", back: "Back" },
  injuryType: (t: string) => t.replace(/\b[a-z]/g, (c) => c.toUpperCase()),
  weeksOut: (n: number) => (n === 1 ? "1 Week" : `${n} Weeks`),
  nextSeason: "Next Season",
  noInjuries: "Nobody Is Out",
  noInjuriesText: "No injuries on this list right now.",
  through: (week: string) => `Through ${week}`,
  preseason: "Preseason",
  week: (w: number) => `Week ${w}`,
  scopeLabel: "Whose leaders",
  scopes: { all: "All of FBS" },
  loading: "Loading the leaders…",
  loadError: (msg: string) => `Couldn't load the stats: ${msg}.`,
  noGames: "No Games Played Yet",
  noGamesText: "The leaders fill in as the season is played. Sim the week from the Office to get it started.",
  teamStats: "Team Stats",
  sortHint: "Click a Column to Sort",

  /** each category: its name, what its number is, and the line beside each player */
  cats: {
    passing: {
      title: "Passing",
      unit: "Yards",
      line: (s: S) =>
        `${n(s.completions)}/${n(s.pass_attempts)} · ${n(s.passing_touchdowns)} TD · ${n(s.interceptions_thrown)} INT`,
    },
    rushing: {
      title: "Rushing",
      unit: "Yards",
      line: (s: S) => `${n(s.carries)} car · ${n(s.rushing_touchdowns)} TD`,
    },
    receiving: {
      title: "Receiving",
      unit: "Yards",
      line: (s: S) => `${n(s.receptions)} rec · ${n(s.receiving_touchdowns)} TD`,
    },
    touchdowns: {
      title: "Touchdowns",
      unit: "Rushing and Receiving",
      line: (s: S) => `${n(s.rushing_touchdowns)} rush · ${n(s.receiving_touchdowns)} rec`,
    },
    tackles: {
      title: "Tackles",
      unit: "Total",
      line: (s: S) => `${n(s.solo_tackles)} solo · ${n(s.tackles_for_loss)} TFL`,
    },
    sacks: { title: "Sacks", unit: "Sacks", line: (s: S) => `${n(s.hurries)} hurries · ${n(s.forced_fumbles)} FF` },
    tfl: {
      title: "Tackles for Loss",
      unit: "TFL",
      line: (s: S) => `${n(s.sacks)} sacks · ${n(s.solo_tackles)} solo`,
    },
    interceptions: {
      title: "Interceptions",
      unit: "Picks",
      line: (s: S) => `${n(s.passes_defended)} PD · ${n(s.interception_return_yards)} ret yds`,
    },
    pbu: {
      title: "Passes Defended",
      unit: "Broken Up",
      line: (s: S) => `${n(s.interceptions)} INT · ${n(s.solo_tackles)} solo`,
    },
    explosives: {
      title: "Explosive Plays",
      unit: "Runs of 20+ and Catches of 25+",
      line: (s: S) => `${n(s.explosive_runs)} runs · ${n(s.explosive_catches)} catches`,
    },
    kicking: {
      title: "Kicking",
      unit: "Points",
      line: (s: S) => `${n(s.fg_made)}/${n(s.fg_attempted)} FG · long ${n(s.long_fg)}`,
    },
    punting: {
      title: "Punting",
      unit: "Average",
      line: (s: S) => `${n(s.punts)} punts · ${n(s.punts_inside_20)} inside the 20`,
    },
  } as Record<string, { title: string; unit: string; line: (s: S) => string }>,

  cols: {
    team: "Team",
    record: "W-L",
    ppg: "PPG",
    oppPpg: "Opp PPG",
    margin: "Margin",
    ypg: "YPG",
    pass: "Pass",
    rush: "Rush",
    oppYpg: "Opp YPG",
    third: "3rd %",
    turnover: "TO +/-",
    sacks: "Sacks",
  },
  tips: {
    ppg: "Points a game.",
    oppPpg: "Points allowed a game. Sorting puts the stingiest defense first.",
    margin: "Average margin of victory.",
    ypg: "Yards a game.",
    pass: "Passing yards a game.",
    rush: "Rushing yards a game.",
    oppYpg: "Yards allowed a game. Sorting puts the stingiest defense first.",
    third: "Third downs converted.",
    turnover: "Takeaways minus turnovers.",
  },
} as const;
