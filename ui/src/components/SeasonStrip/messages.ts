export const messages = {
  label: "Your Schedule",
  earlier: "Earlier Games",
  later: "Later Games",
  next: "Next",
  bye: "Bye",
  at: "at",
  vs: "vs",
  week: (n: number) => `Week ${n}`,
  result: (won: boolean, pf: number, pa: number, ot: number) =>
    `${won ? "W" : "L"} ${pf}-${pa}${ot ? (ot > 1 ? ` ${ot}OT` : " OT") : ""}`,
  tbd: "Date TBD",
  /** a postseason week with no game of yours set yet */
  open: (week: number) =>
    week === 16 ? "Field Set" : week === 15 ? "Champ Game" : week === 20 ? "Title Game" : "Bowl / CFP",
  /** the postseason weeks' names, short enough for a tile */
  short: {
    15: "Champ Wk",
    16: "Selection",
    17: "Bowl Wk 1",
    18: "Bowl Wk 2",
    19: "Bowl Wk 3",
    20: "Title Wk",
  } as Record<number, string>,
  toBeSet: "To Be Set",
  titleGame: "Title Game",
  score: (a: number, b: number) => `${a}-${b}`,
  titleTip: (away: string, home: string) => `${away} vs ${home}`,
  /** a postseason week that came and went, or will, with no game of yours */
  noGame: "No Game",
  boxScore: (opponent: string) => `Open the box score: ${opponent}`,
} as const;
