export const messages = {
  grade: (g: string) => `Grade ${g.replace("+", " plus").replace("-", " minus")}`,
  range: (lo: string, hi: string) =>
    `Grade ${lo.replace("+", " plus").replace("-", " minus")} to ${hi.replace("+", " plus").replace("-", " minus")}`,
  to: "to",
  plain: (lo: string, hi: string) => `${lo}–${hi}`,
} as const;
