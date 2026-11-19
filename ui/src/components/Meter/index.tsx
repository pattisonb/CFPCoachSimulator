import "./index.css";

interface Props {
  /** how full it is, from 0 to 1 */
  value: number;
  /** what a screen reader says it measures ("Scouted") */
  label: string;
}

/** Progress as one bar with its percentage at the end: an empty gray track that fills in green. */
export default function Meter({ value, label }: Props) {
  const pct = Math.round(Math.min(1, Math.max(0, value || 0)) * 100);
  return (
    <span className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <span className="meter__track">
        <i style={{ width: `${pct}%` }} />
      </span>
      <b className="meter__pct">{pct}%</b>
    </span>
  );
}
