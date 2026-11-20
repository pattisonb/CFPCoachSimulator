import type { CSSProperties } from "react";
import { inkOn } from "../../colors.ts";
import type { TeamCard } from "../../types.ts";
import "./index.css";

interface Props {
  team: TeamCard;
  /** small: for a tile that holds two of them side by side (the season strip's title week) */
  small?: boolean;
  /** framed in the ink of what it sits on, so a team's mark shows on a band of its own color */
  framed?: boolean;
}

/** A team's letters on its own color (TEX, IND): a game told in two of them with the score between. */
export default function Wordmark({ team, small, framed }: Props) {
  return (
    <span
      className={`wordmark${small ? " wordmark--small" : ""}${framed ? " wordmark--framed" : ""}`}
      title={team.name}
      style={{ "--c": team.colors.primary, "--on": inkOn(team.colors.primary) } as CSSProperties}
    >
      {team.abbreviation}
    </span>
  );
}
