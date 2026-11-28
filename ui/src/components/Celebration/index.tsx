import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { Confetti, Trophy } from "@phosphor-icons/react";
import { inkOn } from "../../colors.ts";
import type { TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

/** What is being celebrated: a win (Game Day's regular season), a big win (a bowl, a conference title, a playoff game) or the title. */
export type PartyTier = "win" | "big" | "title";

export interface Party {
  tier: PartyTier;
  /** the headline ("Victory", "Fiesta Bowl Champions", "Playoff Win", "National Champions") */
  headline: string;
  /** a line under it: the game ("Rose Bowl (Quarterfinal)") or the score */
  line?: string | null;
}

/** *tune* How long each tier stays up before it goes on its own, in ms, and how much confetti falls. */
const LENGTH: Record<PartyTier, number> = { win: 2600, big: 5000, title: 8000 };
const PIECES: Record<PartyTier, number> = { win: 40, big: 90, title: 170 };

/** The game's kind and title as a result carries them, made into a party (null: nothing to celebrate). */
export function partyOf(
  r: {
    kind: string;
    title: string | null;
    won: boolean | null;
    points_for?: number | null;
    points_against?: number | null;
    opponent_name?: string;
  },
  regular: boolean,
): Party | null {
  if (!r.won) return null;
  const score =
    r.points_for != null && r.points_against != null && r.opponent_name
      ? m.score(r.points_for, r.points_against, r.opponent_name)
      : null;
  const title = r.title ?? "";
  if (r.kind === "playoff" && /national championship/i.test(title))
    return { tier: "title", headline: m.national, line: score };
  if (r.kind === "playoff")
    return { tier: "big", headline: m.playoffWin, line: [title, score].filter(Boolean).join(" · ") };
  if (r.kind === "bowl" || r.kind === "ccg")
    return { tier: "big", headline: m.champions(title || "Bowl"), line: score };
  return regular ? { tier: "win", headline: m.win, line: score } : null;
}

/**
 * A win, celebrated over the page (the player's ask: a fun winning animation, more for a playoff game, a bowl or a
 * title): confetti in your colors and a card with the headline. A Game Day win gets a short burst; a bowl, a conference
 * title or a playoff game a longer one; the national title the most. A click, or Escape, ends it; it ends on its own
 * after a while. With reduced motion there is no confetti, only the card.
 */
export default function Celebration({ party, team, onDone }: { party: Party; team?: TeamCard; onDone: () => void }) {
  // (the page behind re-renders all through a sim: the timer follows the party, not each new onDone)
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const t = window.setTimeout(() => done.current(), LENGTH[party.tier]);
    const key = (e: KeyboardEvent) => e.key === "Escape" && done.current();
    window.addEventListener("keydown", key);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", key);
    };
  }, [party]);
  const primary = team?.colors.primary ?? "#37352f";
  const secondary = team?.colors.secondary ?? "#e0a800";
  // each piece: where it starts across the screen, how long it falls, how late it starts, its turn and color
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES[party.tier] }, (_, i) => ({
        left: Math.random() * 100,
        fall: 1.6 + Math.random() * (party.tier === "win" ? 1.2 : 2.6),
        delay: Math.random() * (party.tier === "win" ? 0.5 : party.tier === "big" ? 1.6 : 3.2),
        spin: Math.random() * 720 - 360,
        drift: Math.random() * 160 - 80,
        color: [primary, secondary, "#e0a800", "#ffffff"][i % 4],
        wide: i % 3 === 0,
      })),
    [party, primary, secondary],
  );
  const style = { "--c": primary, "--on": inkOn(primary), "--c2": secondary } as CSSProperties;
  const Mark = party.tier === "title" ? Trophy : Confetti;
  return (
    <div className={`party party--${party.tier}`} style={style} role="status" aria-live="polite" onClick={onDone}>
      <div className="party__confetti" aria-hidden="true">
        {pieces.map((p, i) => (
          <span
            key={i}
            className={`party__piece${p.wide ? " is-wide" : ""}`}
            style={
              {
                left: `${p.left}%`,
                background: p.color,
                animationDuration: `${p.fall}s`,
                animationDelay: `${p.delay}s`,
                "--spin": `${p.spin}deg`,
                "--drift": `${p.drift}px`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="party__card">
        <Mark size={party.tier === "title" ? 64 : party.tier === "big" ? 44 : 32} weight="fill" aria-hidden="true" />
        <b className="party__headline">{party.headline}</b>
        {party.line && <span className="party__line">{party.line}</span>}
        {party.tier !== "win" && <span className="party__hint">{m.dismiss}</span>}
      </div>
    </div>
  );
}
