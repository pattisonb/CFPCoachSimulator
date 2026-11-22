// teamdata/build_teams.py, as far as it is ported: only the table the card's formulas need. The rest of that file
// comes later and is added to this namespace.

// EA position -> the engine's position
const POSITION_MAP = {
  QB: "QB", HB: "RB", FB: "RB", WR: "WR", TE: "TE",
  LT: "OL", LG: "OL", C: "OL", RG: "OL", RT: "OL",
  LEDG: "DL", REDG: "DL", DT: "DL",
  MIKE: "MLB", WILL: "ROLB", SAM: "LOLB",
  CB: "CB", FS: "S", SS: "S", K: "K", P: "P",
};

export const build_teams = { POSITION_MAP };
