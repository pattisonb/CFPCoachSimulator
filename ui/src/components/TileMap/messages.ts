export const messages = {
  label: "Prospects by Home State",
  tile: (state: string, n: number, board: number) =>
    `${state}: ${n} ${n === 1 ? "prospect" : "prospects"}${board ? `, ${board} on your board` : ""}`,
  readout: (state: string, n: number, board: number) =>
    `${state} · ${n} ${n === 1 ? "Prospect" : "Prospects"}${board ? ` · ${board} on Your Board` : ""}`,
  hint: "Pick a state to filter.",
  clear: (state: string) => `Clear ${state}`,
  fewer: "Fewer",
  show: "Show",
  shows: { none: "No Dots", board: "On Your Board", offered: "Offered", scouted: "Scouted", committed: "Committed" },
  more: "More",
} as const;
