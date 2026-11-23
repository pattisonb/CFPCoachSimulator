import { useLayoutEffect, useRef, type ReactNode } from "react";
import Tooltip from "../Tooltip/index.tsx";
import "./index.css";

interface Props {
  /** his face, drawn at 6x (the head shows it at 3x, or 2x on a narrow card) */
  face: ReactNode;
  /** a small control on the corner of his face (Edit Look) */
  corner?: ReactNode;
  name: string;
  /** beside his name, in the soft color: "#14 WR" */
  beside?: string | null;
  /** under his name: "Sr. · 5'11" · 180 lbs" */
  line?: string | null;
  /** the row under that: `HeadTag`s, stars, a word */
  tags?: ReactNode;
  /** three facts between his name and the tile; always three, so the head never changes size */
  cells: { label: string; value: string; /** said on hover in place of the value alone */ tip?: string }[];
  /** the square at the head's other end, the size of his face: a label over a big value */
  tile: {
    label: string;
    value: ReactNode;
    /** what a screen reader says for the whole tile */
    aria: string;
    /** a word instead of a number: set smaller, so it fits */
    word?: boolean;
    /** the value reads soft (a low rating) */
    soft?: boolean;
    /** said on hover */
    tip?: { title?: string; text: string };
  };
}

/**
 * The head of a profile, a player's or a recruit's: his face at one end and a square tile the same size at the other
 * (the overall, your chance), mirroring it; between them his name, a line of facts and his tags, then three cells.
 * The cells sit each in its own column on a very wide card, stack in one column beside the tile on most, and drop to a
 * row under his name on a narrow one. A name too long for its line is set smaller until it fits. Every part keeps one line and one place, so nothing moves from one profile to the next.
 */
/** *tune* A name too long for its line is set smaller, a step at a time, down to this share of its full size. */
const NAME_MIN = 0.6;
const NAME_STEP = 0.04;

/** Sets a long name smaller until it fits its one line (then, at the least size, it is cut short as before). */
function useFitName(name: string) {
  const ref = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = "";
      const full = parseFloat(getComputedStyle(el).fontSize);
      let k = 1;
      while (el.scrollWidth > el.clientWidth + 1 && k > NAME_MIN) {
        k -= NAME_STEP;
        el.style.fontSize = `${(full * k).toFixed(1)}px`;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el.parentElement ?? el);
    return () => ro.disconnect();
  }, [name]);
  return ref;
}

export default function ProfileHead({ face, corner, name, beside, line, tags, cells, tile }: Props) {
  const nameRef = useFitName(name);
  const square = (
    <div className={`profile-head__tile${tile.word ? " is-word" : ""}`} role="img" aria-label={tile.aria}>
      <span className="label" aria-hidden="true">
        {tile.label}
      </span>
      <b className={`profile-head__tile-value${tile.soft ? " is-soft" : ""}`} aria-hidden="true">
        {tile.value}
      </b>
    </div>
  );
  return (
    <header className="profile-head">
      <div className="profile-head__card">
        <span className="profile-head__face">
          {face}
          {corner && <span className="profile-head__corner">{corner}</span>}
        </span>
        <div className="profile-head__who">
          <div className="profile-head__title">
            <h2 className="profile-head__name" ref={nameRef} title={name}>
              {name}
            </h2>
            {beside && <p className="profile-head__beside">{beside}</p>}
          </div>
          {line && <p className="profile-head__line">{line}</p>}
          <div className="profile-head__tags">{tags}</div>
        </div>
        {tile.tip ? (
          <Tooltip title={tile.tip.title} text={tile.tip.text} className="profile-head__tile-slot">
            {square}
          </Tooltip>
        ) : (
          <span className="profile-head__tile-slot">{square}</span>
        )}
        <dl className="profile-head__cells">
          {cells.map((c) => (
            <div key={c.label}>
              <dt>{c.label}</dt>
              <dd>
                {/* a value keeps one line: the whole of it is its tooltip */}
                <Tooltip text={c.tip ?? c.value} title={c.label} block className="profile-head__clip">
                  {c.value}
                </Tooltip>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </header>
  );
}

/** A small boxed tag for the head's tag row ("WR2", "Impact Dev", "Top 8"); `solid` fills it with ink. */
export function HeadTag({
  solid,
  tip,
  children,
}: {
  solid?: boolean;
  tip?: { title?: string; text: string };
  children: ReactNode;
}) {
  const tag = <span className={`profile-head__tag${solid ? " is-solid" : ""}`}>{children}</span>;
  return tip ? (
    <Tooltip title={tip.title} text={tip.text}>
      {tag}
    </Tooltip>
  ) : (
    tag
  );
}
