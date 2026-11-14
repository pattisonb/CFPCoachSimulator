export const messages = {
  label: "Your Schedule",
  earlier: "Earlier Games",
  later: "Later Games",
  next: "Next",
  bye: "Bye",
  at: "@",
  vs: "vs",
  week: (n: number) => `Week ${n}`,
  result: (won: boolean, pf: number, pa: number, ot: number) =>
    `${won ? "W" : "L"} ${pf}-${pa}${ot ? (ot > 1 ? ` ${ot}OT` : " OT") : ""}`,
  tbd: "Date TBD",
} as const;
