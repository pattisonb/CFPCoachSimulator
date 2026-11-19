import "./index.css";

interface Props {
  /** how many are filled; a half counts as half a block (2.5 looks) */
  have: number;
  /** how many there are in all */
  need: number;
  /** what a screen reader says in its place; without it the blocks are hidden from one */
  label?: string;
}

/** Progress as a row of blocks in a frame, one a step: filled ones in ink, a half step half filled. */
export default function Blocks({ have, need, label }: Props) {
  return (
    <span className="blocks" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {Array.from({ length: Math.max(0, Math.ceil(need)) }, (_, i) => (
        <i key={i} className={have >= i + 1 ? "is-on" : have > i ? "is-half" : undefined} />
      ))}
    </span>
  );
}
