import type { TeamCard } from "../../types.ts";
import "./index.css";

/** A team's colors as a corner-split square, as the sidebar and strip draw them; plain tile before the team loads. */
export default function Swatch({
  team,
  size,
  className,
}: {
  team: TeamCard | undefined;
  /** its side, in px */
  size: number;
  className?: string;
}) {
  return (
    <span
      className={["swatch", className].filter(Boolean).join(" ")}
      style={{
        width: size,
        height: size,
        ...(team && {
          background: `linear-gradient(135deg, ${team.colors.primary} 50%, ${team.colors.secondary} 50%)`,
        }),
      }}
      aria-hidden="true"
    />
  );
}
