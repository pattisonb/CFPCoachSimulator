import { api } from "./api.ts";
import { setPresetFaces } from "./faces.ts";
import type { TeamCard, TeamsResponse } from "./types.ts";

// The game's real teams, fetched once and shared by every page, so a page drawn after another has them at once
// (no "loading" flash at the end of a page transition).

let cache: TeamCard[] | null = null;
let pending: Promise<TeamCard[]> | null = null;

/** The teams if they have loaded already, else null. */
export const cachedTeams = (): TeamCard[] | null => cache;

/** The teams (the FCS stand-ins left out); a failed load can be tried again. */
export function loadTeams(): Promise<TeamCard[]> {
  if (cache) return Promise.resolve(cache);
  pending ??= api<TeamsResponse>("/api/teams")
    .then((d) => {
      setPresetFaces(d.faces?.players ?? {}, d.faces?.coaches ?? {});
      return (cache = d.teams.filter((t) => !t.fictional));
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
