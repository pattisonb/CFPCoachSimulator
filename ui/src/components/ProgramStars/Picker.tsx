import { Star, StarHalf } from "@phosphor-icons/react";
import { messages as m } from "./messages.ts";

interface Props {
  /** the stars picked (0.5 to 5 by halves), or null for none */
  value: number | null;
  /** pick a level; the level already picked again clears it (null) */
  onPick: (stars: number | null) => void;
  /** how many programs each level holds, said on hover */
  count?: (stars: number) => number;
  size?: number;
  label: string;
}

/**
 * Five empty stars you fill to pick a level: point at a star's left half for the half, its right half for the whole,
 * and press. Pressing the level already picked empties them again. A filter (Programs' list by its stars).
 */
export default function StarPicker({ value, onPick, count, size = 20, label }: Props) {
  return (
    <span className="star-picker" role="group" aria-label={label}>
      {Array.from({ length: 5 }, (_, i) => {
        const shown = value ?? 0;
        return (
          <span key={i} className="star-picker__star">
            {shown >= i + 1 ? (
              <Star size={size} weight="fill" aria-hidden="true" />
            ) : shown >= i + 0.5 ? (
              <StarHalf size={size} weight="fill" aria-hidden="true" />
            ) : (
              <Star size={size} weight="regular" className="is-off" aria-hidden="true" />
            )}
            {[i + 0.5, i + 1].map((s) => (
              <button
                key={s}
                type="button"
                className="star-picker__half"
                aria-pressed={value === s}
                aria-label={m.pick(s)}
                title={count ? m.pickCount(s, count(s)) : m.pick(s)}
                onClick={() => onPick(value === s ? null : s)}
              />
            ))}
          </span>
        );
      })}
    </span>
  );
}
