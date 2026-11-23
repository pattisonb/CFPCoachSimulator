import type { CSSProperties, ReactNode } from "react";
import Tooltip from "../Tooltip/index.tsx";
import { contrast, inkOn } from "../../colors.ts";
import type { TeamCard } from "../../types.ts";
import "./index.css";

interface Props {
  /** the mark in its middle (an icon) */
  children: ReactNode;
  /** what it means: said to a screen reader, and on hover with `tip` */
  label: string;
  /** a sentence more, on hover */
  tip?: string;
  /** pixels a side */
  side?: number;
  /** a school: the stamp wears its colors (its first, its second across the corner) */
  team?: TeamCard;
  /** a warning: red */
  warn?: boolean;
}

/** *tune* A school's second color shows on its first when the two stand this far apart (contrast ratio). */
const SECOND_SHOWS = 1.35;
const isHex = (c?: string): c is string => !!c && /^#[0-9a-f]{6}$/i.test(c);

/**
 * A stamp for the corner of a picture: a small tile set a little askew with one mark in it, as a recruit's status
 * wears (RecruitStatus draws those; this is the same tile for anything else stamped on a player). Plain, in a
 * school's colors (`team`), or a warning (`warn`).
 */
export default function Stamp({ children, label, tip, side = 30, team, warn }: Props) {
  const c = team?.colors;
  const branded = !warn && !!c && isHex(c.primary);
  const second =
    branded && c
      ? isHex(c.secondary) && contrast(c.primary, c.secondary) >= SECOND_SHOWS
        ? c.secondary
        : inkOn(c.primary)
      : undefined;
  const style = {
    "--side": `${side}px`,
    ...(branded && c && { "--c": c.primary, "--c2": second, "--on": inkOn(c.primary) }),
  } as CSSProperties;
  const mark = (
    <span
      className={["stamp", branded && "is-branded", warn && "is-warn"].filter(Boolean).join(" ")}
      style={style}
      role="img"
      aria-label={label}
    >
      {children}
    </span>
  );
  return tip ? (
    <Tooltip title={label} text={tip}>
      {mark}
    </Tooltip>
  ) : (
    mark
  );
}
