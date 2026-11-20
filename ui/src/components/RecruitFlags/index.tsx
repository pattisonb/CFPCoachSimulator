import { Crown, CurrencyDollar, Diamond, HandPalm, Snowflake, ThumbsUp, Warning } from "@phosphor-icons/react";
import { messages as m } from "./messages.ts";
import "./index.css";

/** Where you stand with him that needs your attention: he has cooled on you, you owe him NIL, he feels pestered. */
export type RecruitAlert = "cooled" | "owed" | "pestered";
const ALERT_ICONS = { cooled: Snowflake, owed: CurrencyDollar, pestered: HandPalm };

interface Props {
  /** what needs your attention with him, each with the sentence its tooltip gives */
  alerts?: { key: RecruitAlert; tip: string }[];
  /** a once-in-a-generation talent, as your staff has found */
  generational?: boolean | null;
  /** a full report's finding: "gem" or "bust" */
  find?: string | null;
  /** your coordinator vouches for him: who (OC, DC) and what he says */
  likes?: { who: string; text?: string } | null;
  /** the icons' size in px: small in a list line, larger in a profile's head */
  size?: number;
  /** each icon in its own small box (a profile's head); bare in a list line */
  boxed?: boolean;
}

/**
 * What your staff has flagged about a recruit, as small icons with the game's tooltip: Generational (a crown), Gem (a
 * diamond), Bust Risk (a warning sign), and a coordinator who likes him (a thumbs-up); then what needs your attention
 * with him (`alerts`: cooled, NIL owed, pestered), each in its own color. Nothing when there is nothing to flag, so a line it sits in never shifts for most recruits.
 */
export default function RecruitFlags({ generational, find, likes, alerts, size = 12, boxed }: Props) {
  const items = [
    generational && { key: "generational", Icon: Crown, name: m.generational, tip: m.generationalTip, strong: true },
    find === "gem" && { key: "gem", Icon: Diamond, name: m.gem, tip: m.gemTip, strong: true },
    find === "bust" && { key: "bust", Icon: Warning, name: m.bust, tip: m.bustTip, strong: false },
    likes && { key: "likes", Icon: ThumbsUp, name: m.likes(likes.who), tip: likes.text || m.likesTip, strong: false },
    ...(alerts ?? []).map((a) => ({
      key: a.key,
      Icon: ALERT_ICONS[a.key],
      name: m.alerts[a.key],
      tip: a.tip,
      strong: false,
    })),
  ].filter((x): x is Exclude<typeof x, false | null | undefined | ""> => !!x);
  if (!items.length) return null;
  return (
    <span className={`recruit-flags${boxed ? " is-boxed" : ""}`}>
      {items.map(({ key, Icon, name, tip, strong }) => (
        <span
          key={key}
          className={`recruit-flags__flag is-${key}`}
          title={`${name}: ${tip}`}
          role="img"
          aria-label={name}
        >
          <Icon size={size} weight={strong ? "fill" : "bold"} aria-hidden="true" />
        </span>
      ))}
    </span>
  );
}
