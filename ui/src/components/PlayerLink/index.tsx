import { createContext, useContext, useState, type ReactNode } from "react";
import PlayerWindow, { type PlayerRef } from "../PlayerWindow/index.tsx";
import { messages as m } from "./messages.ts";
import "./index.css";

/** Opens a player's card: set by PlayerLinks, read by every PlayerLink under it. */
const Open = createContext<((who: PlayerRef) => void) | null>(null);

/**
 * The one player window for a career, and the way to open it from anywhere under it. Wrap the game's page in this;
 * a PlayerLink anywhere inside then opens the named player's card (read-only: his ratings, abilities and history,
 * with none of the Depth Chart's actions).
 */
export function PlayerLinks({
  seasonId,
  weekLabels,
  children,
}: {
  /** the career whose players these are; without one the links are plain names */
  seasonId: string | null | undefined;
  weekLabels?: Record<string, string>;
  children: ReactNode;
}) {
  const [who, setWho] = useState<PlayerRef | null>(null);
  return (
    <Open.Provider value={seasonId ? setWho : null}>
      {children}
      {seasonId && <PlayerWindow seasonId={seasonId} who={who} weekLabels={weekLabels} onClose={() => setWho(null)} />}
    </Open.Provider>
  );
}

interface Props {
  /** his team's slug: without it (or outside a career) the name is plain text */
  team: string | null | undefined;
  name: string;
  /** tells two players of one name on a team apart */
  position?: string;
  /** what to show in place of his name (his name set in the page's own way) */
  children?: ReactNode;
  className?: string;
}

/**
 * A player's name that opens his card. Looks like the text around it (it takes its font, weight and color from where
 * it sits) and underlines on hover. Use it wherever a player on a team in the league is named.
 */
export default function PlayerLink({ team, name, position, children, className }: Props) {
  const open = useContext(Open);
  if (!open || !team) return <>{children ?? name}</>;
  return (
    <button
      type="button"
      className={["player-link", className].filter(Boolean).join(" ")}
      title={m.open(name)}
      onClick={(e) => {
        e.stopPropagation(); // a name inside a row or a card that is itself clickable
        open({ team, name, position });
      }}
    >
      {children ?? name}
    </button>
  );
}
