export const messages = {
  grade: (grade: string) => `Grade ${grade.replace("+", " Plus").replace("-", " Minus")}`,
  none: "Not Graded",
} as const;
