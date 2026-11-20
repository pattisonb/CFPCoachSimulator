import type { ReactNode } from "react";
import Face from "../Face/index.tsx";
import type { Face as FaceSpec } from "../../faces.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

/** Your reputation for keeping promises (GET /api/season/{id}/office → word; coach_career/word.py). */
export interface CoachWord {
  text: string;
  weakest: { name: string; text: string } | null;
  recent: string[];
}

interface Props {
  name: string;
  team: string;
  face: FaceSpec;
  /** your word: how well you keep promises, in a word, with the position it is weakest at and the latest lines */
  word?: CoachWord | null;
  /** a small control inside the card's top right corner (a Dropdown, say) */
  corner?: ReactNode;
  /** floating in the window's bottom right corner as your face alone; pointing at it (or tabbing to it) opens the card */
  floating?: boolean;
  /** hangs from under the card's right edge (over it when floating): the notices that have just landed */
  below?: ReactNode;
  /** floating: a count on your face's corner (the notices not looked at yet) */
  alert?: number;
}

/** *tune* How many blocks the energy bar is drawn in. */
const SEGMENTS = 10;

/**
 * The week's energy on its own: the label, a bar of blocks and what is left ("ENERGY ▮▮▮▮▮▮▮▯▯▯ 105/150"). With a
 * `label` and a `hint` of its own it is the same bar for another of the week's budgets (scouting points).
 */
export function Energy({
  energy,
  label,
  hint,
}: {
  energy: { left: number; total: number } | null;
  label?: string;
  hint?: string;
}) {
  const filled = energy && energy.total > 0 ? Math.ceil((energy.left / energy.total) * SEGMENTS) : 0;
  return (
    <span
      className="coach-badge__energy"
      role="meter"
      aria-label={label ?? m.energy}
      aria-valuemin={0}
      aria-valuemax={energy?.total ?? 0}
      aria-valuenow={energy?.left ?? 0}
      title={hint ?? (energy ? m.energyHint(Math.round(energy.left), energy.total) : undefined)}
    >
      <span className="coach-badge__energy-label label">{label ?? m.energy}</span>
      <span className="coach-badge__bar" aria-hidden="true">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span key={i} className={i < filled ? "is-on" : undefined} />
        ))}
      </span>
      <span className="coach-badge__value">{energy ? m.energyValue(Math.round(energy.left), energy.total) : ""}</span>
    </span>
  );
}

/** The game's grade words, weakest first (coach_career/programs.py WORD_FLOORS): a word's place fills the bar. */
const WORDS = ["Weak", "Thin", "Fair", "Solid", "Good", "Strong", "Excellent", "Elite"];

/**
 * Your word on its own: the label, a bar of blocks filled by where the word sits from Weak to Elite, and the word
 * ("YOUR WORD ▮▮▮▮▮▮▯▯ Strong"). Its tooltip says what it is for, where it is weakest and what moved it lately.
 */
export function Word({ word }: { word: CoachWord | null | undefined }) {
  const at = word ? WORDS.indexOf(word.text) + 1 : 0;
  const tip = word
    ? [m.wordHint(word.text), word.weakest ? m.wordWeakest(word.weakest.name, word.weakest.text) : null, ...word.recent]
        .filter(Boolean)
        .join(" ")
    : undefined;
  return (
    <span className="coach-badge__energy" title={tip}>
      <span className="coach-badge__energy-label label">{m.word}</span>
      <span className="coach-badge__bar" aria-hidden="true">
        {WORDS.map((w, i) => (
          <span key={w} className={i < at ? "is-on" : undefined} />
        ))}
      </span>
      <span className="coach-badge__value">{word?.text ?? ""}</span>
    </span>
  );
}

/** You, at the game's top right: your face, name and team, and your word as a bar of blocks. */
export default function CoachBadge({ name, team, face, word, corner, floating, below, alert }: Props) {
  return (
    <div
      className={`coach-badge${floating ? " coach-badge--float" : ""}`}
      tabIndex={floating ? 0 : undefined}
      aria-label={floating ? name : undefined}
    >
      {corner && <div className="coach-badge__corner">{corner}</div>}
      <span className="coach-badge__face">
        <Face face={face} scale={2} label={name} />
      </span>
      {floating && !!alert && <span className="coach-badge__alert">{alert > 9 ? "9+" : alert}</span>}
      <span className="coach-badge__who">
        <span className="coach-badge__name">{name}</span>
        <span className="coach-badge__role">{m.role(team)}</span>
        <Word word={word} />
      </span>
      {below}
    </div>
  );
}
