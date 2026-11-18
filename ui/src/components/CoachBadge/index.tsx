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
}

/** *tune* How many blocks the energy bar is drawn in. */
const SEGMENTS = 10;

/** You, at the game's top right: your face, name and team, and the week's energy as a bar of blocks. */
export default function CoachBadge({ name, team, face, energy, corner }: Props) {
  const filled = energy && energy.total > 0 ? Math.ceil((energy.left / energy.total) * SEGMENTS) : 0;
  return (
    <div className="coach-badge">
      {corner && <div className="coach-badge__corner">{corner}</div>}
      <span className="coach-badge__face">
        <Face face={face} scale={2} label={name} />
      </span>
      <span className="coach-badge__who">
        <span className="coach-badge__name">{name}</span>
        <span className="coach-badge__role">{m.role(team)}</span>
        <span
          className="coach-badge__energy"
          role="meter"
          aria-label={m.energy}
          aria-valuemin={0}
          aria-valuemax={energy?.total ?? 0}
          aria-valuenow={energy?.left ?? 0}
          title={energy ? m.energyHint(Math.round(energy.left), energy.total) : undefined}
        >
          <span className="coach-badge__energy-label label">{m.energy}</span>
          <span className="coach-badge__bar" aria-hidden="true">
            {Array.from({ length: SEGMENTS }, (_, i) => (
              <span key={i} className={i < filled ? "is-on" : undefined} />
            ))}
          </span>
          <span className="coach-badge__value">
            {energy ? m.energyValue(Math.round(energy.left), energy.total) : ""}
          </span>
        </span>
      </span>
    </div>
  );
}
