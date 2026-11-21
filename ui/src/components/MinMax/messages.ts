export const messages = {
  lo: "Min",
  hi: "Max",
  to: "to",
  min: (what: string) => `${what}: Minimum`,
  max: (what: string) => `${what}: Maximum`,
} as const;
