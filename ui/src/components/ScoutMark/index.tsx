import { Binoculars } from "@phosphor-icons/react";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  /** your staff's looks at him so far (halves count) */
  looks: number;
  /** how many looks make a full report */
  need?: number;
  size?: number;
}

/**
 * How far a prospect has been scouted, as a pair of binoculars that fills like a bar: an outline, filled in green
 * from the left as the looks come in, whole once his report is complete. Nothing at all for a prospect nobody has
 * looked at.
 */
export default function ScoutMark({ looks, need = 3, size = 16 }: Props) {
  if (!(looks > 0)) return null;
  const pct = Math.round(Math.min(1, looks / need) * 100);
  return (
    <span className="scout-mark" role="img" aria-label={m.scouted(pct)} title={m.scouted(pct)}>
      <Binoculars size={size} weight="regular" aria-hidden="true" />
      <span className="scout-mark__fill" style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}>
        <Binoculars size={size} weight="fill" aria-hidden="true" />
      </span>
    </span>
  );
}
