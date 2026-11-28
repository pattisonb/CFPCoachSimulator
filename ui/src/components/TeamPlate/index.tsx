import type { CSSProperties, ReactNode } from "react";
import { teamCardVars } from "../../colors.ts";
import type { TeamCard } from "../../types.ts";
import "./index.css";

interface Props {
  /** the team whose colors it wears; none (an FCS stand-in, a team not loaded yet) is a plain ink plate */
  team: TeamCard | undefined | null;
  /** what it says: the team's abbreviation unless given (a full name, a rank and a name) */
  children?: ReactNode;
  /** sm: inside a line of text (a headline, a player's school); md: a row's team (the default); lg: a heading's */
  size?: "sm" | "md" | "lg";
  /** a loser beside its winner (an upset): faded */
  lost?: boolean;
  title?: string;
  className?: string;
}

/**
 * A team as a slanted nameplate in its own colors, like a jersey's: its first color, a band of its second along its foot (its trim:
 * the second color, or its third or its ink when the second is too close to the first) a pixel
 * shadow in the trim, darker, the letters standing up straight (the player: team branding everywhere, cooler and more fun).
 */
export default function TeamPlate({ team, children, size = "md", lost, title, className }: Props) {
  return (
    <span
      className={["team-plate", `team-plate--${size}`, lost && "is-lost", className].filter(Boolean).join(" ")}
      style={teamCardVars(team) as CSSProperties | undefined}
      title={title ?? team?.name}
    >
      <span>{children ?? team?.abbreviation}</span>
    </span>
  );
}
