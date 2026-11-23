import type { CSSProperties } from "react";
import { Lightning, PhoneCall } from "@phosphor-icons/react";
import Tooltip from "../Tooltip/index.tsx";
import { contrast, inkOn } from "../../colors.ts";
import type { TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

/** A school in a race with you for a recruit (career_js/recruiting/part7.js rival_pushes). */
export interface Rival {
  school: string;
  name: string;
  /** he is your commit and the school is still calling him */
  pressing: boolean;
}

/** *tune* A school's second color shows beside its first when the two stand this far apart (contrast ratio). */
const SECOND_SHOWS = 1.35;
const isHex = (c?: string): c is string => !!c && /^#[0-9a-f]{6}$/i.test(c);

/** The school's colors for the pennant: its first, the ink that reads on it, and a trim that shows beside it. */
function pennant(team: TeamCard | undefined): CSSProperties | undefined {
  const c = team?.colors;
  if (!c || !isHex(c.primary)) return undefined;
  const ok = (x?: string) => isHex(x) && contrast(c.primary, x) >= SECOND_SHOWS;
  const trim = ok(c.secondary) ? c.secondary : ok(c.accent) ? c.accent! : inkOn(c.primary);
  return { "--rp": c.primary, "--rp-on": inkOn(c.primary), "--rp-2": trim } as CSSProperties;
}

interface Props {
  rivals: Rival[] | null | undefined;
  /** the school's card for its colors (none on file: a plain pennant) */
  teamOf: (slug: string) => TeamCard | undefined;
  /** "sm" in a list line, "md" in a profile's head */
  size?: "sm" | "md";
  /** how many pennants to draw before the rest fold into a count */
  most?: number;
  /** leave the count out (a head with no room for it, where the schools are listed beside it anyway) */
  bare?: boolean;
}

/**
 * The schools answering your recruiting of him, each as a pennant in THAT school's colors: its mark (its two colors
 * split corner to corner), then "Alabama Pushing Back" on its first color in the ink that reads on it, a tail of its
 * second. Once he is your commit and the school is still on him it reads "Alabama Calling Your Commit", with a
 * ringing phone. Nothing when no school is in the race, so a line it sits in never shifts for most recruits.
 */
export default function RivalPush({ rivals, teamOf, size = "sm", most = 1, bare = false }: Props) {
  if (!rivals?.length) return null;
  const shown = rivals.slice(0, most);
  const rest = rivals.slice(most);
  return (
    <span className={`rival-push rival-push--${size}`}>
      {shown.map((r) => {
        const team = teamOf(r.school);
        const Mark = r.pressing ? PhoneCall : Lightning;
        const label = r.pressing ? m.pressing(r.name) : m.pushing(r.name);
        return (
          <Tooltip key={r.school} text={r.pressing ? m.pressingTip(r.name) : m.pushingTip(r.name)}>
            <span
              className={`rival-push__pennant${r.pressing ? " is-pressing" : ""}${team ? "" : " is-plain"}`}
              style={pennant(team)}
            >
              <span className="rival-push__mark" aria-hidden="true" />
              <span className="rival-push__words">
                <Mark className="rival-push__icon" size={size === "md" ? 14 : 12} weight="fill" aria-hidden="true" />
                <span className="rival-push__label">{label}</span>
              </span>
            </span>
          </Tooltip>
        );
      })}
      {rest.length > 0 && !bare && (
        <Tooltip
          title={m.moreLabel(rest.length)}
          text={rest.map((r) => (r.pressing ? m.pressingTip(r.name) : m.pushingTip(r.name))).join(" ")}
        >
          <span className="rival-push__more" aria-label={m.moreLabel(rest.length)}>
            {m.more(rest.length)}
          </span>
        </Tooltip>
      )}
    </span>
  );
}
