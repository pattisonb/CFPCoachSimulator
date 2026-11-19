import type { ReactNode } from "react";
import Face from "../Face/index.tsx";
import type { Face as FaceSpec } from "../../faces.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  name: string;
  team: string;
  face: FaceSpec;
  /** the week's actions: what's left of the coach's weekly hours; null until they load */
  energy: { left: number; total: number } | null;
  /** a small control inside the card's top right corner (a Dropdown, say) */
  corner?: ReactNode;
  /** floating in the window's bottom right corner as your face alone; pointing at it (or tabbing to it) opens the card */
  floating?: boolean;
}

/** *tune* How many blocks the energy bar is drawn in. */
const SEGMENTS = 10;

/**
 * The week's energy on its own: the label, a bar of blocks and what is left ("ENERGY ▮▮▮▮▮▮▮▯▯▯ 105/150"). With a
 * `label` and a `hint` of its own it is the same bar for another of the week's budgets (scouting points).
 */
export function Energy({ energy, label, hint }: { energy: Props["energy"]; label?: string; hint?: string }) {
  const filled = energy && energy.total > 0 ? Math.ceil((energy.left / energy.total) * SEGMENTS) : 0;
  return (
    <span
      className="coach-badge__energy"
      role="meter"
      aria-label={label ?? m.energy}
      aria-valuemin={0}
      aria-valuemax={energy?.total ?? 0}
      aria-valuenow={energy?.left ?? 0}
      title={hint ?? (energy ? m.energyHint(Math.round(energy.left), energy.total) : undefined)}
    >
      <span className="coach-badge__energy-label label">{label ?? m.energy}</span>
      <span className="coach-badge__bar" aria-hidden="true">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span key={i} className={i < filled ? "is-on" : undefined} />
        ))}
      </span>
      <span className="coach-badge__value">{energy ? m.energyValue(Math.round(energy.left), energy.total) : ""}</span>
    </span>
  );
}

/** You, at the game's top right: your face, name and team, and the week's energy as a bar of blocks. */
export default function CoachBadge({ name, team, face, energy, corner, floating }: Props) {
  return (
    <div
      className={`coach-badge${floating ? " coach-badge--float" : ""}`}
      tabIndex={floating ? 0 : undefined}
      aria-label={floating ? name : undefined}
    >
      {corner && <div className="coach-badge__corner">{corner}</div>}
      <span className="coach-badge__face">
        <Face face={face} scale={2} label={name} />
      </span>
      <span className="coach-badge__who">
        <span className="coach-badge__name">{name}</span>
        <span className="coach-badge__role">{m.role(team)}</span>
        <Energy energy={energy} />
      </span>
    </div>
  );
}
