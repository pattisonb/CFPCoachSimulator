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

  windowNew: "New Season",
  windowLoad: "Load Season",
  loadingTeams: "Loading teams…",

  tryAgain: "Try Again",
  dismiss: "Dismiss",
  // (the game's own sentence, its period dropped so there is one)
  loadError: (msg: string) => `Can't reach the game: ${msg.replace(/\.$/, "")}.`,
} as const;
