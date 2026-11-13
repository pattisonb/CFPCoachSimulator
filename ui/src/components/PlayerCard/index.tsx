import { useId, useState, type FocusEvent, type MouseEvent } from "react";
import Face from "../Face/index.tsx";
import { playerFace } from "../../faces.ts";
import { formatClass } from "../../format.ts";
import type { RosterPlayer } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  id: string;
  player: RosterPlayer;
  /** where to show it, in window pixels; it flips left or up to stay on screen */
  x: number;
  y: number;
}

const WIDTH = 320; // keep in step with .player-card's width
const HEIGHT = 260; // about the card's height, to flip it up near the bottom of the window

/** A floating card with one player's details, shown while a roster row is hovered or focused. */
export default function PlayerCard({ id, player: p, x, y }: Props) {
  const left = Math.max(8, x + 16 + WIDTH > window.innerWidth ? x - 16 - WIDTH : x + 16);
  const top = Math.max(8, y + 16 + HEIGHT > window.innerHeight ? y - 16 - HEIGHT : y + 16);
  return (
    <div id={id} className="player-card" role="tooltip" style={{ left, top }}>
      <div className="player-card__head">
        <span className="player-card__face">
          <Face face={playerFace(p.slug ?? `${p.name}-${p.jersey ?? ""}`, p.position)} scale={2} label="" />
        </span>
        <div className="player-card__who">
          <span className="player-card__name">{p.name}</span>
          <span className="player-card__pos">
            {[p.jersey && `#${p.jersey}`, p.position, p.starter ? m.starter : m.backup].filter(Boolean).join(" · ")}
          </span>
        </div>
        <span className="player-card__ovr" aria-label={`${m.overall} ${p.overall}`}>
          {p.overall}
        </span>
      </div>
      <div className="player-card__bar" aria-hidden="true">
        <span style={{ width: `${Math.min(100, p.overall)}%` }} />
      </div>
      <dl className="player-card__facts">
        <div>
          <dt>{m.cls}</dt>
          <dd>{formatClass(p.class)}</dd>
        </div>
        <div>
          <dt>{m.unit}</dt>
          <dd>{p.unit === "offense" ? m.offense : m.defense}</dd>
        </div>
        <div>
          <dt>{m.height}</dt>
          <dd>{p.height ?? "–"}</dd>
        </div>
        <div>
          <dt>{m.weight}</dt>
          <dd>{p.weight ? m.pounds(p.weight) : "–"}</dd>
        </div>
        <div>
          <dt>{m.role}</dt>
          <dd>{p.role ?? p.position}</dd>
        </div>
      </dl>
    </div>
  );
}

interface Hover {
  player: RosterPlayer;
  x: number;
  y: number;
}

/**
 * Hover (or keyboard focus) on any element shows a player's card. Spread `bind(player)` on the element and
 * render `card` once, anywhere in the component.
 */
export function usePlayerHover() {
  const id = useId();
  const [hover, setHover] = useState<Hover | null>(null);
  const bind = (player: RosterPlayer) => ({
    tabIndex: 0,
    "aria-describedby": hover?.player === player ? id : undefined,
    // placed once where the pointer comes in, so moving within a row does not re-render the list
    onMouseEnter: (e: MouseEvent) => setHover({ player, x: e.clientX, y: e.clientY }),
    onMouseLeave: () => setHover(null),
    onFocus: (e: FocusEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      setHover({ player, x: r.left + r.width * 0.6, y: r.bottom - 8 });
    },
    onBlur: () => setHover(null),
  });
  const card = hover ? <PlayerCard id={id} player={hover.player} x={hover.x} y={hover.y} /> : null;
  return { hovered: hover?.player ?? null, bind, card, clear: () => setHover(null) };
}
