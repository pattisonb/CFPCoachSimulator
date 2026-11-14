export const messages = {
  units: "Unit",
  offense: "Offense",
  defense: "Defense",
  special: "Special Teams",
  starters: (n: number) => (n === 0 ? "Not in the Base Formation" : `${n} ${n === 1 ? "Starter" : "Starters"}`),
  out: "Out",
  rs: "RS",
  pickHint: "Pick a player to see his card.",
  loading: "Loading the depth chart…",
  loadError: (msg: string) => `Couldn't load the depth chart: ${msg}.`,
  overall: (n: number) => `Overall ${n}`,
  rowLabel: (spot: number, name: string, ovr: number) => `${spot}. ${name}, overall ${ovr}`,
} as const;
