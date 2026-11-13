import type { SeasonCard } from "../../types.ts";

export const messages = {
  titleMark: "Pocket College Football",
  tagline: "Recruit. Coach. Build a dynasty.",
  newSeason: "New Season",
  loadSeason: "Load Season",

  seasonsTitle: "Your Seasons",
  loadingSeasons: "Loading seasons…",
  noSeasonsTitle: "No Saved Seasons",
  noSeasonsText: "Start a new season and it will show up here.",
  seasonKind: (s: SeasonCard) => (s.career ? `Coach Career · ${s.year}` : `Season · ${s.year}`),
  record: (s: SeasonCard) => `${s.wins}-${s.losses}`,
  status: (s: SeasonCard) =>
    s.offseason
      ? "Offseason"
      : s.done
        ? s.champion_name
          ? `Done · ${s.champion_name} Won`
          : "Done"
        : `Week ${s.current_week}`,

  play: "Play",
  playAs: (team: string) => `Play as ${team}`,
  windowNew: (team: string) => `New Season · ${team}`,
  windowLoad: "Load Season",
  yourTeam: "Your Team",
  overall: "Overall",
  teamLine: (mascot: string, conference: string) => `${mascot} · ${conference}`,
  conference: "Conference",
  headCoach: "Head Coach",
  stadium: "Stadium",
  capacity: "Capacity",
  seats: (n: number) => n.toLocaleString("en-US"),
  ratings: "Ratings",
  teamTabs: "Team",
  overview: "Overview",
  roster: "Roster",
  offense: "Offense",
  defense: "Defense",
  specialTeams: "Special Teams",

  tryAgain: "Try Again",
  loadError: (msg: string) => `Can't reach the game: ${msg}. Is the dev server running?`,
} as const;
