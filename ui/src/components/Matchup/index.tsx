import type { CSSProperties, ReactNode } from "react";
import { inkOn } from "../../colors.ts";
import type { TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

/** One side of a matchup: the team's card (an FCS stand-in's has no record or ratings), or for a slot not filled yet just a name. */
export interface MatchupSide {
  team: TeamCard | undefined;
  name: string;
  rank?: number | null;
  record?: string;
  /** his record in conference games ("4-4"), in parentheses after his record with the conference's name */
  confRecord?: string | null;
  /** the team's overall, offense and defense, under its name */
  ratings?: { overall: number; offense: number; defense: number } | null;
  /** his name is a button (the Schedule's: on to that team's season), with what it does as its tip */
  onName?: () => void;
  nameTip?: string;
}

/** a team in no conference has no conference record to show */
const INDEPENDENT = /independent/i;

const RATINGS = ["overall", "offense", "defense"] as const;

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
  // an FCS stand-in's name ends in its mascot ("New England Lobsters"): told in two lines like anyone else
  const mascot = t?.mascot || "";
  const school = t?.fictional && mascot && side.name.endsWith(` ${mascot}`) ? side.name.slice(0, -mascot.length - 1) : side.name;
  const name = (
    <>
      <span className="matchup__school">
        {side.rank ? <span className="matchup__rank">{side.rank}</span> : null}
        {school}
      </span>
      {mascot && <b className="matchup__mascot">{mascot}</b>}
    </>
  );
  return (
    <div className={`matchup__side matchup__side--${align}`} style={style}>
      <span className="matchup__mark" aria-hidden="true">
        {t ? t.abbreviation : side.name.slice(0, 3).toUpperCase()}
      </span>
      <div className="matchup__text">
        {side.record && (
          <span className="matchup__line">
            {side.record}
            {side.confRecord && real && !INDEPENDENT.test(t.conference) && (
              <span className="matchup__conf">{m.conference(side.confRecord, t.conference)}</span>
            )}
          </span>
        )}
        {side.onName ? (
          <button type="button" className="matchup__name" title={side.nameTip} onClick={side.onName}>
            {name}
          </button>
        ) : (
          <span className="matchup__name">{name}</span>
        )}
        {side.ratings && (
          <dl className="matchup__ratings" aria-label={m.ratings}>
            {RATINGS.map((k) => (
              <div key={k} title={m.ratingTips[k]}>
                <dt>{m.ratingShort[k]}</dt>
                <dd>{side.ratings![k]}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
