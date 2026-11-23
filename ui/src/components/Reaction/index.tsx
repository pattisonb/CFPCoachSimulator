import {
  Ear,
  Fire,
  HandPalm,
  MoonStars,
  Question,
  SealCheck,
  ThermometerCold,
  ThumbsUp,
  type Icon,
} from "@phosphor-icons/react";
import { messages as m } from "./messages.ts";
import "./index.css";

/** How he took a pitch (career_js/recruiting/part6.js reaction_kind, plus polite and tired): its icon. */
export const REACTION_ICON: Record<string, Icon> = {
  sold: SealCheck,
  hit: Fire,
  fair: Ear,
  lukewarm: ThermometerCold,
  quiet: HandPalm,
  polite: ThumbsUp,
  tired: MoonStars,
};
/** A pitch mark (recruiting.pitch_marks) as the reaction it came from. */
export const MARK_KIND: Record<string, string> = {
  sold: "sold",
  hit: "hit",
  fair: "fair",
  lukewarm: "lukewarm",
  weak: "quiet",
  not_his: "polite",
  no_read: "none",
};
export const reactionName = (kind: string): string => m.names[kind] ?? kind;
export const reactionMeaning = (kind: string): string => m.meaning[kind] ?? "";
export const markName = (mark: string): string => m.marks[mark] ?? mark;

/**
 * How he took a pitch, as a mark: its icon on a tile in its own tone, then its name. He's Sold wears your team's
 * color (the icon in the ink that reads on it), He Lights Up the fire's orange, He's Listening gold, He's Lukewarm
 * the cold blue, He Isn't Buying It the risk red; a polite nod and a tired recruit stay plain. `kind` is a reaction
 * or, with `mark`, a pitch mark. `size`: "sm" for a list line or a button, "lg" for the conversation's stamp (the
 * tile alone: the caller writes the words).
 */
export default function Reaction({
  kind,
  mark = false,
  size = "sm",
  label = true,
}: {
  kind: string;
  mark?: boolean;
  size?: "sm" | "lg";
  label?: boolean;
}) {
  const k = mark ? (MARK_KIND[kind] ?? "none") : kind;
  const I = REACTION_ICON[k] ?? Question;
  const name = mark ? markName(kind) : reactionName(kind);
  return (
    <span className={`reaction reaction--${k} reaction--${size}`} title={label ? undefined : name}>
      <span className="reaction__tile" role={label ? undefined : "img"} aria-label={label ? undefined : name}>
        <I size={size === "lg" ? 38 : 13} weight="fill" aria-hidden="true" />
      </span>
      {label && <span className="reaction__name">{name}</span>}
    </span>
  );
}
