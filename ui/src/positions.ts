import type { RosterPlayer } from "./types.ts";

// Position order and the filter groups, shared by the roster and the overview.

/** The depth chart's order: the passer first, the specialists last on each side. */
const POSITION_ORDER = ["QB", "RB", "FB", "WR", "TE", "OL", "K", "P", "DL", "LOLB", "MLB", "ROLB", "LB", "CB", "S"];

/** The roster's filter chips: the three linebacker spots read as one LB group. */
export const POSITION_GROUPS: { key: string; positions: string[] }[] = [
  { key: "QB", positions: ["QB"] },
  { key: "RB", positions: ["RB", "FB"] },
  { key: "WR", positions: ["WR"] },
  { key: "TE", positions: ["TE"] },
  { key: "OL", positions: ["OL"] },
  { key: "DL", positions: ["DL"] },
  { key: "LB", positions: ["LOLB", "MLB", "ROLB", "LB"] },
  { key: "CB", positions: ["CB"] },
  { key: "S", positions: ["S"] },
  { key: "K", positions: ["K"] },
  { key: "P", positions: ["P"] },
];

const rank = (pos: string) => (POSITION_ORDER.includes(pos) ? POSITION_ORDER.indexOf(pos) : POSITION_ORDER.length);

/** By position, starters first, then the best. */
export const byPosition = (players: RosterPlayer[]) =>
  [...players].sort(
    (a, b) => rank(a.position) - rank(b.position) || Number(b.starter) - Number(a.starter) || b.overall - a.overall,
  );

/** The best players first. */
export const byOverall = (players: RosterPlayer[]) => [...players].sort((a, b) => b.overall - a.overall);
