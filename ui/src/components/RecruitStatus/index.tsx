import type { CSSProperties } from "react";
import { EnvelopeSimple, Megaphone, Lock, PaperPlaneTilt, PenNib, type Icon } from "@phosphor-icons/react";
import Tooltip from "../Tooltip/index.tsx";
import { contrast, inkOn } from "../../colors.ts";
import type { RecruitStatus as Status } from "../../standing.ts";
import type { TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  status: Status;
  /** the icon's size in pixels */
  size?: number;
  /** draw it as a stamp: a tile set a little askew, this many pixels a side (your own signee's is a little larger) */
  stamp?: number;
  /** the school he committed to or signed with: its colors brand the stamp (none on file: a plain stamp) */
  school?: TeamCard;
  /** that school's name, for the tip (the row's own, so a stand-in with no colors is still named) */
  schoolName?: string | null;
  /** no tip of its own: the words beside it already say where he is */
  bare?: boolean;
}

type Shown = Exclude<Status["key"], "none">;
type Held = "verbal" | "hard" | "signed";

const ICONS: Record<Shown, Icon> = {
  sent: PaperPlaneTilt,
  offered: EnvelopeSimple,
  verbal: Megaphone,
  hard: Lock,
  signed: PenNib,
};

/** *tune* How much larger your own signee's stamp is than another school's, in pixels a side. */
const MINE_GROWS = 4;
/** *tune* A school's second color shows on its first when the two stand this far apart (contrast ratio). */
const SECOND_SHOWS = 1.35;
/** *tune* A stamp under this many pixels a side is a small one (in a table's cell): lighter edges, yours no larger. */
const SMALL = 24;

const isHex = (c?: string): c is string => !!c && /^#[0-9a-f]{6}$/i.test(c);

/** The color for a stamp's corner: the school's second, else its third, else black or white, whichever shows on the first. */
function cornerOn(colors: TeamCard["colors"]): string {
  const ok = (c?: string) => isHex(c) && contrast(colors.primary, c) >= SECOND_SHOWS;
  return ok(colors.secondary) ? colors.secondary : ok(colors.accent) ? colors.accent! : inkOn(colors.primary);
}

/**
 * Where a recruit's offer or commitment stands, as one small icon: a paper plane (your offer is on its way), an
 * envelope (offered), a megaphone (verbal commit: he has said it, nothing is locked), a lock (hard commit), a pen (signed). Filled and in ink when it is
 * with you; outlined and soft when it is with another school. Pointing at it says what it means. Not offered shows nothing.
 *
 * As a stamp (`stamp`) it carries the school: a signed one is that school's mark, its first color with its second
 * across the corner and the pen in whichever of black or white reads on it; a commit is the plain stamp with the
 * school's colors as a band along its foot (not inked yet). Yours is larger and double framed.
 */
export default function RecruitStatus({ status, size = 18, stamp, school, schoolName, bare }: Props) {
  if (status.key === "none") return null;
  const Mark = ICONS[status.key];
  const held =
    status.key === "verbal" || status.key === "hard" || status.key === "signed" ? (status.key as Held) : null;
  const away = status.away ? held : null;
  const label = away ? m.away[away] : m.names[status.key];
  const name = schoolName ?? school?.name;
  const text = away ? (name ? m.awayAt[away](name) : m.awayMeans[away]) : m.means[status.key];
  // a tip that names the school (or is your own signee's) is the whole sentence: no title over it
  const named = (!!away && !!name) || status.key === "signed";

  if (stamp == null)
    return (
      <Tooltip title={named ? undefined : label} text={text}>
        <span className={`recruit-status${away ? " recruit-status--soft" : ""}`} role="img" aria-label={label}>
          <Mark size={size} weight={away || status.key === "sent" ? "bold" : "fill"} aria-hidden="true" />
        </span>
      </Tooltip>
    );

  const colors = held && school && isHex(school.colors.primary) ? school.colors : null;
  const mine = !!held && !status.away;
  const signed = status.key === "signed";
  const small = stamp < SMALL;
  const side = stamp + (mine && signed && !small ? MINE_GROWS : 0);
  const style = {
    "--side": `${side}px`,
    ...(colors && { "--c": colors.primary, "--c2": cornerOn(colors), "--on": inkOn(colors.primary) }),
  } as CSSProperties;
  const cls = [
    "recruit-status",
    "recruit-status--stamp",
    small && "is-small",
    held && `is-${signed ? "signed" : "commit"}`,
    colors && "is-branded",
    mine && "is-mine",
    away && !colors && "recruit-status--soft",
  ];
  const mark = (
    <span
      className={cls.filter(Boolean).join(" ")}
      style={style}
      role="img"
      aria-label={bare ? label : `${label}. ${text}`}
    >
      <Mark
        size={size}
        weight={(away && !(signed && colors)) || status.key === "sent" ? "bold" : "fill"}
        aria-hidden="true"
      />
    </span>
  );
  if (bare) return mark;
  return (
    <Tooltip title={named ? undefined : label} text={text}>
      {mark}
    </Tooltip>
  );
}
