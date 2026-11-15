import { api } from "./api.ts";

/**
 * Put prospects on your board or take them off (POST /board, one each: the server saves after every one). Recruiting
 * and Prospects both change the board through here.
 */
export async function setOnBoard(seasonId: string, pids: string[], on: boolean): Promise<void> {
  for (const pid of pids) await api(`/api/season/${seasonId}/board`, { method: "POST", body: { pid, on } });
}
