export const messages = {
  label: "Prospects by Home State",
  tile: (state: string, n: number, blue: number, board: number) =>
    `${state}: ${n} ${n === 1 ? "prospect" : "prospects"}, ${blue} blue ${blue === 1 ? "chip" : "chips"}${
      board ? `, ${board} on your board` : ""
    }`,
  readout: (state: string, n: number, blue: number, board: number) =>
    `${state} · ${n} ${n === 1 ? "Prospect" : "Prospects"} · ${blue} Blue ${blue === 1 ? "Chip" : "Chips"}${
      board ? ` · ${board} on Your Board` : ""
    }`,
  hint: "Pick a state to filter.",
  clear: (state: string) => `Clear ${state}`,
  fewer: "Fewer",
  more: "More",
  onBoard: "On Your Board",
} as const;
