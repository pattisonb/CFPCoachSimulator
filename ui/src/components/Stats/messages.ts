type S = Record<string, number>;
/** One stat column of the players table: its header, what it means, and its number from a player's line. */
export interface StatCol {
  key: string;
  label: string;
  tip: string;
  /** an average or a percentage: shown with one decimal */
  dec?: boolean;
  /** from his season line and the games he has played */
  get: (s: S, games: number) => number;
}
const col = (key: string, label: string, tip: string, get: (s: S, games: number) => number, dec = false): StatCol => ({
  key,
  label,
  tip,
  get,
  dec,
});
const v = (x: number | undefined) => x ?? 0;
/** a over b (times `scale`), 0 when there is no b */
const rate = (a: number | undefined, b: number | undefined, scale = 1) => (b ? ((a ?? 0) / b) * scale : 0);
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
  conference: "Conference",
  allConferences: "All Conferences",
  teamLabel: "Team",
  allTeams: "All Teams",
  yours: "Your Team",
  loading: "Loading the leaders…",
  loadError: (msg: string) => `Couldn't load the stats: ${msg}.`,
  noGames: "No Games Played Yet",
  noGamesText: "The leaders fill in as the season is played. Sim the week from the Office to get it started.",
  teamStats: "Team Stats",

  /** each category: its name, what its number is, and the line beside each player */
  // a category of player stats: its name, and every number the game keeps for it, in order (the first is what the
  // table starts sorted by). Each column sorts. `dec`: shown with one decimal (an average, a percentage).
  cats: {
    passing: {
      title: "Passing",
      cols: [
        col("yds", "Yds", "Passing yards.", (s) => v(s.pass_yards)),
        col("ypg", "Yds/G", "Passing yards a game.", (s, g) => rate(s.pass_yards, g), true),
        col("cmp", "Cmp", "Completions.", (s) => v(s.completions)),
        col("att", "Att", "Attempts.", (s) => v(s.pass_attempts)),
        col("pct", "Cmp %", "Completion percentage.", (s) => rate(s.completions, s.pass_attempts, 100), true),
        col("ypa", "Y/A", "Yards an attempt.", (s) => rate(s.pass_yards, s.pass_attempts), true),
        col("td", "TD", "Touchdown passes.", (s) => v(s.passing_touchdowns)),
        col("int", "Int", "Interceptions thrown.", (s) => v(s.interceptions_thrown)),
        col("sck", "Sacked", "Times sacked.", (s) => v(s.sacks_taken)),
        col("fd", "1st Dn", "Passing first downs.", (s) => v(s.passing_first_downs)),
        col("conv", "3rd Dn", "Third and fourth downs converted by a pass.", (s) => v(s.passing_conversions)),
        col("long", "Long", "Longest completion.", (s) => v(s.long_pass)),
      ],
    },
    rushing: {
      title: "Rushing",
      cols: [
        col("yds", "Yds", "Rushing yards.", (s) => v(s.rush_yards)),
        col("ypg", "Yds/G", "Rushing yards a game.", (s, g) => rate(s.rush_yards, g), true),
        col("car", "Car", "Carries.", (s) => v(s.carries)),
        col("avg", "Avg", "Yards a carry.", (s) => rate(s.rush_yards, s.carries), true),
        col("td", "TD", "Rushing touchdowns.", (s) => v(s.rushing_touchdowns)),
        col("long", "Long", "Longest run.", (s) => v(s.long_rush)),
        col("exp", "20+", "Runs of 20 yards or more.", (s) => v(s.explosive_runs)),
        col("fd", "1st Dn", "Rushing first downs.", (s) => v(s.rushing_first_downs)),
        col("conv", "3rd Dn", "Third and fourth downs converted by a run.", (s) => v(s.rushing_conversions)),
        col("fum", "Fum", "Fumbles.", (s) => v(s.fumbles)),
      ],
    },
    receiving: {
      title: "Receiving",
      cols: [
        col("yds", "Yds", "Receiving yards.", (s) => v(s.receiving_yards)),
        col("ypg", "Yds/G", "Receiving yards a game.", (s, g) => rate(s.receiving_yards, g), true),
        col("rec", "Rec", "Receptions.", (s) => v(s.receptions)),
        col("tgt", "Tgt", "Targets.", (s) => v(s.targets)),
        col("pct", "Catch %", "Catches for every target.", (s) => rate(s.receptions, s.targets, 100), true),
        col("avg", "Avg", "Yards a catch.", (s) => rate(s.receiving_yards, s.receptions), true),
        col("td", "TD", "Receiving touchdowns.", (s) => v(s.receiving_touchdowns)),
        col("long", "Long", "Longest catch.", (s) => v(s.long_reception)),
        col("exp", "25+", "Catches of 25 yards or more.", (s) => v(s.explosive_catches)),
        col("fd", "1st Dn", "Receiving first downs.", (s) => v(s.receiving_first_downs)),
      ],
    },
    defense: {
      title: "Defense",
      cols: [
        col("tkl", "Tkl", "Total tackles.", (s) => v(s.solo_tackles) + v(s.assisted_tackles)),
        col("solo", "Solo", "Solo tackles.", (s) => v(s.solo_tackles)),
        col("ast", "Ast", "Assisted tackles.", (s) => v(s.assisted_tackles)),
        col("tfl", "TFL", "Tackles for loss.", (s) => v(s.tackles_for_loss)),
        col("sacks", "Sacks", "Sacks.", (s) => v(s.sacks)),
        col("hur", "Hur", "Quarterback hurries.", (s) => v(s.hurries)),
        col("int", "Int", "Interceptions.", (s) => v(s.interceptions)),
        col("iyd", "Int Yds", "Interception return yards.", (s) => v(s.interception_return_yards)),
        col("pd", "PD", "Passes defended.", (s) => v(s.passes_defended)),
        col("ff", "FF", "Forced fumbles.", (s) => v(s.forced_fumbles)),
        col("fr", "FR", "Fumble recoveries.", (s) => v(s.fumble_recoveries)),
        col("td", "TD", "Defensive touchdowns.", (s) => v(s.defensive_touchdowns)),
      ],
    },
    kicking: {
      title: "Kicking",
      cols: [
        col("pts", "Pts", "Points.", (s) => 3 * v(s.fg_made) + v(s.pat_made)),
        col("fgm", "FGM", "Field goals made.", (s) => v(s.fg_made)),
        col("fga", "FGA", "Field goals attempted.", (s) => v(s.fg_attempted)),
        col("pct", "FG %", "Field goal percentage.", (s) => rate(s.fg_made, s.fg_attempted, 100), true),
        col("m40", "40+ M", "Made from 40 yards or more.", (s) => v(s.fg_40_made)),
        col("a40", "40+ A", "Tried from 40 yards or more.", (s) => v(s.fg_40_att)),
        col("m50", "50+ M", "Made from 50 yards or more.", (s) => v(s.fg_50_made)),
        col("a50", "50+ A", "Tried from 50 yards or more.", (s) => v(s.fg_50_att)),
        col("long", "Long", "Longest field goal.", (s) => v(s.long_fg)),
        col("xpm", "XPM", "Extra points made.", (s) => v(s.pat_made)),
        col("xpa", "XPA", "Extra points attempted.", (s) => v(s.pat_attempts)),
      ],
    },
    punting: {
      title: "Punting",
      cols: [
        col("avg", "Avg", "Yards a punt.", (s) => rate(s.punt_yards, s.punts), true),
        col("net", "Net", "Net yards a punt.", (s) => rate(s.punt_net_yards, s.punts), true),
        col("punts", "Punts", "Punts.", (s) => v(s.punts)),
        col("yds", "Yds", "Punt yards.", (s) => v(s.punt_yards)),
        col("in20", "In 20", "Punts downed inside the 20.", (s) => v(s.punts_inside_20)),
        col("tb", "TB", "Touchbacks.", (s) => v(s.punt_touchbacks)),
        col("long", "Long", "Longest punt.", (s) => v(s.long_punt)),
      ],
    },
    returns: {
      title: "Returns",
      cols: [
        col("kyd", "KR Yds", "Kickoff return yards.", (s) => v(s.kickoff_return_yards)),
        col("kr", "KR", "Kickoff returns.", (s) => v(s.kickoff_returns)),
        col("kavg", "KR Avg", "Yards a kickoff return.", (s) => rate(s.kickoff_return_yards, s.kickoff_returns), true),
        col("ktd", "KR TD", "Kickoff return touchdowns.", (s) => v(s.kickoff_return_touchdowns)),
        col("klong", "KR Long", "Longest kickoff return.", (s) => v(s.long_kickoff_return)),
        col("pyd", "PR Yds", "Punt return yards.", (s) => v(s.punt_return_yards)),
        col("pr", "PR", "Punt returns.", (s) => v(s.punt_returns)),
        col("pavg", "PR Avg", "Yards a punt return.", (s) => rate(s.punt_return_yards, s.punt_returns), true),
        col("ptd", "PR TD", "Punt return touchdowns.", (s) => v(s.punt_return_touchdowns)),
        col("plong", "PR Long", "Longest punt return.", (s) => v(s.long_punt_return)),
      ],
    },
    blocking: {
      title: "Blocking",
      cols: [
        col("snaps", "Snaps", "Snaps played.", (s) => v(s.snaps)),
        col("gs", "Starts", "Games started.", (s) => v(s.games_started)),
        col("kb", "Key Blocks", "Blocks that sprang a run.", (s) => v(s.key_blocks)),
        col("sa", "Sacks Allowed", "Sacks allowed.", (s) => v(s.sacks_allowed)),
        col("pa", "Pressures", "Pressures allowed.", (s) => v(s.pressures_allowed)),
        col("st", "Stuffs", "Runs stuffed at his block.", (s) => v(s.stuffs_allowed)),
      ],
    },
  } as Record<string, { title: string; cols: StatCol[] }>,
  category: "Category",
  games: "G",
  gamesTip: "Games played",
  playersShown: (shown: number, all: number) =>
    shown < all
      ? `${shown.toLocaleString("en-US")} of ${all.toLocaleString("en-US")} Players`
      : `${all.toLocaleString("en-US")} ${all === 1 ? "Player" : "Players"}`,
  showAll: (n: number) => `Show All ${n.toLocaleString("en-US")}`,
  noPlayers: "Nobody here has a number in this category yet.",
  player: "Player",
  place: "#",
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
