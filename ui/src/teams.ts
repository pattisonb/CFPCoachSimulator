import { api } from "./api.ts";
import { setPresetFaces } from "./faces.ts";
import type { TeamCard, TeamsResponse } from "./types.ts";

// The game's real teams, fetched once and shared by every page, so a page drawn after another has them at once
// (no "loading" flash at the end of a page transition).

let cache: TeamCard[] | null = null;
let standIns: TeamCard[] = [];
let pending: Promise<TeamCard[]> | null = null;

/** The teams if they have loaded already, else null. */
export const cachedTeams = (): TeamCard[] | null => cache;

/**
 * The FCS stand-ins (the New England Lobsters, ...), once the teams have loaded: opponents on a schedule, each with
 * a name, an abbreviation and colors, so a game against one draws like any other. They are no program to pick, browse
 * or recruit against: every list of teams (loadTeams, cachedTeams) leaves them out.
 */
export const cachedStandIns = (): TeamCard[] => standIns;

/** A team's name inside a sentence: "Iowa State", but "the Plains Thunderheads" (a stand-in's name ends in its mascot). */
export const nameInLine = (name: string, team: TeamCard | undefined): string =>
  team?.fictional && !/^the /i.test(name) ? `the ${name}` : name;

/** The teams (the FCS stand-ins left out); a failed load can be tried again. */
export function loadTeams(): Promise<TeamCard[]> {
  if (cache) return Promise.resolve(cache);
  pending ??= api<TeamsResponse>("/api/teams")
    .then((d) => {
      setPresetFaces(d.faces?.players ?? {}, d.faces?.coaches ?? {});
      standIns = d.teams.filter((t) => t.fictional);
      return (cache = d.teams.filter((t) => !t.fictional));
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
