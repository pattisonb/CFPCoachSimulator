import { api } from "./api.ts";

/**
 * Put prospects on your board or take them off (POST /board, one each: the server saves after every one). Recruiting
 * and Prospects both change the board through here.
 */
export async function setOnBoard(seasonId: string, pids: string[], on: boolean, quiet = false): Promise<void> {
  // (`quiet`: no "Working…" over the page: the caller has shown the change already)
  for (const pid of pids) await api(`/api/season/${seasonId}/board`, { method: "POST", quiet, body: { pid, on } });
}

/** Mark a prospect as one of your favorites (♥) or clear the mark: your own list, a filter on the Board and on Prospects. */
export async function setFavorite(seasonId: string, pid: string, on: boolean, quiet = false): Promise<void> {
  await api(`/api/season/${seasonId}/favorite`, { method: "POST", quiet, body: { pid, on } });
}
