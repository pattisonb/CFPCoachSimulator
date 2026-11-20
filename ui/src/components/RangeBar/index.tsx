import "./index.css";

interface Props {
  /** the range's ends, 0 to 100 */
  lo: number;
  hi: number;
  /** the best guess inside it, 0 to 100: a mark on the range */
  mid?: number;
  /** soft: a read you can't lean on yet */
  soft?: boolean;
  /** the fill in a color of its own (a team's), in place of ink */
  color?: string;
  /** what a screen reader says in its place */
  label?: string;
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));
/** *tune* The narrowest a range draws, in points of the track: a tight read still shows as a range with its mark. */
const MIN_RANGE = 6;

/**
 * A read as a range on a track: the filled part runs from the low end to the high end, a mark sits on the best guess.
 * A single value (lo and hi the same) fills from the start, like a meter.
 */
export default function RangeBar({ lo, hi, mid, soft, color, label }: Props) {
  const a = clamp(Math.min(lo, hi));
  const b = clamp(Math.max(lo, hi));
  // a single value fills from the start, like a meter; a read with a best guess always draws as a range around it,
  // however tight (a sliver wide enough to see, with its mark)
  const meter = mid == null && b - a < 1;
  const tight = mid != null && b - a < MIN_RANGE;
  const lo2 = tight ? clamp(Math.min(a, clamp(mid) - MIN_RANGE / 2)) : a;
  const hi2 = tight ? clamp(Math.max(b, clamp(mid) + MIN_RANGE / 2)) : b;
  return (
    <span
      className={`range-bar${soft ? " range-bar--soft" : ""}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <i
        className={`range-bar__fill${color ? " is-colored" : ""}`}
        style={{
          ...(meter ? { left: 0, width: `${b}%` } : { left: `${lo2}%`, width: `${hi2 - lo2}%` }),
          background: color,
        }}
      />
      {/* the best guess: a tooltip around the bar points here (Tooltip's `data-tip-at`) */}
      {mid != null && !meter && <i className="range-bar__mid" data-tip-at="" style={{ left: `${clamp(mid)}%` }} />}
    </span>
  );
}
