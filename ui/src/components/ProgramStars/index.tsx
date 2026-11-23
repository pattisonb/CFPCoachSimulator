import { Star, StarHalf } from "@phosphor-icons/react";
import Tooltip from "../Tooltip/index.tsx";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  /** 0.5 to 5, by halves (career_js/programs.js stars_of) */
  stars: number;
  size?: number;
  /** say what the stars mean on hover */
  tip?: boolean;
}

/**
 * A program's standing as stars: five, filled by halves ("4.5 Star Program"). Wherever a program's standing shows:
 * the team picker's banner, the Programs page.
 */
export default function ProgramStars({ stars, size = 14, tip }: Props) {
  const row = (
    <span className="program-stars" role="img" aria-label={m.label(stars)} title={tip ? undefined : m.label(stars)}>
      {Array.from({ length: 5 }, (_, i) =>
        stars >= i + 1 ? (
          <Star key={i} size={size} weight="fill" aria-hidden="true" />
        ) : stars >= i + 0.5 ? (
          <StarHalf key={i} size={size} weight="fill" aria-hidden="true" />
        ) : (
          <Star key={i} size={size} weight="regular" className="is-off" aria-hidden="true" />
        ),
      )}
    </span>
  );
  return tip ? (
    <Tooltip title={m.label(stars)} text={m.tip(stars)}>
      {row}
    </Tooltip>
  ) : (
    row
  );
}
