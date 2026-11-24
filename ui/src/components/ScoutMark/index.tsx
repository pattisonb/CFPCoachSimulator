import { Binoculars } from "@phosphor-icons/react";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  /** your staff's looks at him so far (halves count) */
  looks: number;
  /** how many looks make a full report */
  need?: number;
  /** the ring's width across, in pixels */
  size?: number;
}

/**
 * How far a prospect has been scouted: a pair of binoculars inside a ring that closes as the looks come in (the
 * player's ask: a loading circle around the mark, clearer than binoculars filling from the left), the ring whole and
 * the binoculars inked green once his report is complete. Nothing at all for a prospect nobody has looked at.
 */
export default function ScoutMark({ looks, need = 3, size = 24 }: Props) {
  if (!(looks > 0)) return null;
  const share = Math.min(1, looks / need);
  const pct = Math.round(share * 100);
  const stroke = Math.max(2, Math.round(size / 9));
  const r = (size - stroke) / 2;
  const around = 2 * Math.PI * r;
  return (
    <span
      className={`scout-mark${pct >= 100 ? " is-full" : ""}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={m.scouted(pct)}
      title={m.scouted(pct)}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="scout-mark__track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className="scout-mark__ring"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={`${around * share} ${around}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <Binoculars
        className="scout-mark__icon"
        size={Math.round(size * 0.54)}
        weight={pct >= 100 ? "fill" : "bold"}
        aria-hidden="true"
      />
    </span>
  );
}
