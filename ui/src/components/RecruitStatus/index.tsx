import { EnvelopeSimple, Handshake, Lock, PaperPlaneTilt, PenNib, type Icon } from "@phosphor-icons/react";
import Tooltip from "../Tooltip/index.tsx";
import type { RecruitStatus as Status } from "../../standing.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  status: Status;
  /** the icon's size in pixels */
  size?: number;
}

type Shown = Exclude<Status["key"], "none">;

const ICONS: Record<Shown, Icon> = {
  sent: PaperPlaneTilt,
  offered: EnvelopeSimple,
  verbal: Handshake,
  hard: Lock,
  signed: PenNib,
};

/**
 * Where a recruit's offer or commitment stands, as one small icon: a paper plane (your offer is on its way), an
 * envelope (offered), a handshake (verbal commit), a lock (hard commit), a pen (signed). Filled and in ink when it is
 * with you; outlined and soft when it is with another school. Pointing at it says what it means. Not offered shows nothing.
 */
export default function RecruitStatus({ status, size = 18 }: Props) {
  if (status.key === "none") return null;
  const Mark = ICONS[status.key];
  const away = status.away ? (status.key as keyof typeof m.away) : null;
  const label = away ? m.away[away] : m.names[status.key];
  return (
    <Tooltip title={label} text={away ? m.awayMeans[away] : m.means[status.key]}>
      <span className={`recruit-status${away ? " recruit-status--soft" : ""}`} role="img" aria-label={label}>
        <Mark size={size} weight={away || status.key === "sent" ? "bold" : "fill"} aria-hidden="true" />
      </span>
    </Tooltip>
  );
}
