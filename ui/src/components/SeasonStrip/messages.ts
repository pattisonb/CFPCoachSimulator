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
    week === 15 ? "Conf. Title" : week === 16 ? "Field Is Set" : week === 20 ? "Natl. Title" : "Bowl or CFP",
  toBeSet: "To Be Set",
  boxScore: (opponent: string) => `Open the box score: ${opponent}`,
} as const;
