import type { CSSProperties, ReactNode } from "react";
import { inkOn } from "../../colors.ts";
import type { TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

/** One side of a matchup: the team's card, or for an FCS stand-in (or a slot not filled yet) just a name. */
export interface MatchupSide {
  team: TeamCard | undefined;
  name: string;
  rank?: number | null;
  record?: string;
  /** your team: a You tag */
  mine?: boolean;
  /** under the name: a button (Their Schedule) */
  action?: ReactNode;
}

interface Props {
  left: MatchupSide;
  right: MatchupSide;
  /** the tile on the seam: vs, at, or the score */
  mid: ReactNode;
  /** a final: the tile inverts for a win */
  result?: "won" | "lost" | null;
}

/**
 * A matchup as art: each team's half in its colors with its letters oversized behind it, the two meeting on a slanted
 * white seam, and a paper tile on the seam. The page around it (Schedule, Bowls) adds what to know underneath.
 */
export default function Matchup({ left, right, mid, result }: Props) {
  return (
    <div className="matchup">
      <Side side={left} align="left" />
      <div className={`matchup__mid${result ? ` is-${result}` : ""}`}>{mid}</div>
      <Side side={right} align="right" />
    </div>
  );
}

function Side({ side, align }: { side: MatchupSide; align: "left" | "right" }) {
  const t = side.team;
  const real = t && !t.fictional;
  const style = {
    "--c": t?.colors.primary ?? "var(--tile)",
    "--c2": t?.colors.secondary ?? "var(--line-soft)",
    "--on": t ? inkOn(t.colors.primary) : "var(--ink)",
  } as CSSProperties;
  return (
    <div className={`matchup__side matchup__side--${align}`} style={style}>
      <span className="matchup__mark" aria-hidden="true">
        {real ? t.abbreviation : side.name.slice(0, 3).toUpperCase()}
      </span>
      <div className="matchup__text">
        <span className="matchup__tags">
          {side.mine && <span className="matchup__tag">{m.you}</span>}
          {side.rank ? <span className="matchup__rank">{m.rank(side.rank)}</span> : null}
          {side.record && <span>{side.record}</span>}
        </span>
        <span className="matchup__school">{side.name}</span>
        {real && t.mascot && <b className="matchup__mascot">{t.mascot}</b>}
        {side.action}
      </div>
    </div>
  );
}
