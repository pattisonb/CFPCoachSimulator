// Formatting shared by components. Words a player sees go through these, so they read the same everywhere.

/** A class code from the game ("SRRS", "FR") as the old UI shows it ("RS Sr.", "Fr."). */
export function formatClass(code: string | null): string {
  if (!code) return "–";
  const year = { FR: "Fr.", SO: "So.", JR: "Jr.", SR: "Sr." }[code.slice(0, 2)] ?? code;
  return code.endsWith("RS") ? `RS ${year}` : year;
}
