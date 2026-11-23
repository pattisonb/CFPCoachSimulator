import { Door, ListNumbers, PenNib, type Icon } from "@phosphor-icons/react";
import type { Blocked } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

const ICON: Record<string, Icon> = { locked: Door, finalists: ListNumbers, signed: PenNib };

/**
 * A recruit who is closed to you, as a shut door: he will not consider your program, he cut his list without you, or
 * he has signed elsewhere. The door itself (a hatched panel behind a heavy frame, its plate in the risk red), the
 * game's own sentence saying why, and what, if anything, opens it again. Where a recruit's actions would be.
 */
export default function ClosedDoor({ blocked }: { blocked: Blocked }) {
  const I = ICON[blocked.why] ?? Door;
  return (
    <div className={`closed-door closed-door--${blocked.why}`} role="status">
      <span className="closed-door__plate" aria-hidden="true">
        <I size={34} weight="fill" />
      </span>
      <div className="closed-door__text">
        <span className="label closed-door__kicker">{m.kicker}</span>
        <b className="closed-door__title">{m.titles[blocked.why] ?? m.kicker}</b>
        <p>{blocked.text}</p>
        <p className="closed-door__next">{m.next[blocked.why] ?? ""}</p>
      </div>
    </div>
  );
}

/** The same, as a small mark for a row: the door's icon and two words; the game's sentence is its tip. */
export function ClosedMark({ blocked, label = true }: { blocked: Blocked; label?: boolean }) {
  const I = ICON[blocked.why] ?? Door;
  return (
    <span
      className={`closed-mark closed-mark--${blocked.why}`}
      title={blocked.text}
      role={label ? undefined : "img"}
      aria-label={label ? undefined : m.marks[blocked.why]}
    >
      <I size={12} weight="fill" aria-hidden="true" />
      {label && m.marks[blocked.why]}
    </span>
  );
}
