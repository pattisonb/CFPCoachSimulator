import type { ReactNode } from "react";
import Face from "../Face/index.tsx";
import type { Face as FaceSpec } from "../../faces.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

/** Your reputation for keeping promises (GET /api/season/{id}/office → word; career_js/word.js). */
export interface CoachWord {
  text: string;
  weakest: { name: string; text: string } | null;
  recent: string[];
}

/** Your head coach's ratings by key (GET /api/season/{id}/office → coach.ratings): overall, offense, recruiting… */
export type CoachRatings = Record<string, number>;

interface Props {
  name: string;
  team: string;
  face: FaceSpec;
  /** your word: how well you keep promises, in a word, with the position it is weakest at and the latest lines */
  word?: CoachWord | null;
  /** the week's budgets as bars (`Energy`), in the part that drops under the card; left out when there are none */
  budgets?: ReactNode;
  /** your NIL: what is left of the year's budget */
  nil?: { left: number; total: number } | null;
  /** your ratings as a head coach, in the part that drops under the card */
  ratings?: CoachRatings | null;
  /** a small control inside the card's top right corner (a Dropdown, say) */
  corner?: ReactNode;
  /** hangs from under the card's right edge: the notices that have just landed */
  below?: ReactNode;
  /** a count on your face's corner while the card is shut (the notices not looked at yet) */
  alert?: number;
}

/** *tune* How many blocks the energy bar is drawn in (twenty: a week's energy runs to 480 now, and ten blocks read
 *  as full with 190 of 210 left). */
const SEGMENTS = 20;

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

/** The game's grade words, weakest first (career_js/programs.js WORD_FLOORS): a word's place fills the bar. */
const WORDS = ["Weak", "Thin", "Fair", "Solid", "Good", "Strong", "Excellent", "Elite"];
/** *tune* How many words under your overall word a position group must be before the tooltip names it. */
const WEAKEST_GAP = 2;

/**
 * Your word on its own: the label, a bar of blocks filled by where the word sits from Weak to Elite, and the word
 * ("YOUR WORD ▮▮▮▮▮▮▯▯ Strong"). Its tooltip says what it is for, where it is weakest and what moved it lately.
 */
export function Word({ word }: { word: CoachWord | null | undefined }) {
  const at = word ? WORDS.indexOf(word.text) + 1 : 0;
  // a position group is named only when your word there is well under the rest (WEAKEST_GAP words or more): one word
  // off ("Elite", but "Excellent" with one group) is no weakness, and read as a mistake
  const low = word?.weakest && at - (WORDS.indexOf(word.weakest.text) + 1) >= WEAKEST_GAP ? word.weakest : null;
  const tip = word
    ? [m.wordHint(word.text), low ? m.wordWeakest(low.name, low.text) : null, ...word.recent].filter(Boolean).join(" ")
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

/** The ratings the card lists, in this order (the overall has the head's tile). */
const RATED = ["offense", "defense", "recruiting", "player_development", "game_management", "motivation", "discipline"];

/**
 * You, at the game's top right on every screen: your face alone until you point at it (or tab to it, or open its
 * menu), then the card slides out to the left with your name, team and your word, and the rest drops under it: the
 * week's Energy and Scouting, and your ratings as a head coach, each a bar and its number. Nothing else on the page
 * moves: the card lies over what is beside and below it.
 */
export default function CoachBadge({ name, team, face, word, budgets, nil, ratings, corner, below, alert }: Props) {
  const rated = ratings ? RATED.filter((k) => typeof ratings[k] === "number") : [];
  return (
    <div className="coach-badge" tabIndex={0} aria-label={name}>
      {corner && <div className="coach-badge__corner">{corner}</div>}
      <span className="coach-badge__face">
        <Face face={face} scale={2} label={name} />
      </span>
      {!!alert && <span className="coach-badge__alert">{alert > 9 ? "9+" : alert}</span>}
      <span className="coach-badge__who">
        <span className="coach-badge__name">{name}</span>
        <span className="coach-badge__role">{m.role(team)}</span>
        <Word word={word} />
      </span>
      {(budgets || nil || rated.length > 0) && (
        <div className="coach-badge__more">
          <div className="coach-badge__more-in">
            {(budgets || nil) && (
              <section className="coach-badge__part" aria-label={m.thisWeek}>
                {budgets && <h4 className="label">{m.thisWeek}</h4>}
                {budgets}
                {nil && <Energy energy={nil} label={m.bank} hint={m.bankHint(Math.round(nil.left), nil.total)} />}
              </section>
            )}
            {ratings && rated.length > 0 && (
              <section className="coach-badge__part" aria-label={m.ratings}>
                <h4 className="label">
                  {m.ratings}
                  {typeof ratings.overall === "number" && (
                    <span className="coach-badge__overall">
                      {m.overall} <b>{ratings.overall}</b>
                    </span>
                  )}
                </h4>
                <dl className="coach-badge__ratings">
                  {rated.map((k) => (
                    <div key={k}>
                      <dt>{m.rated[k] ?? k}</dt>
                      <dd>
                        <span className="coach-badge__meter" aria-hidden="true">
                          <span style={{ width: `${Math.max(0, Math.min(100, ratings[k]))}%` }} />
                        </span>
                        <b>{ratings[k]}</b>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </div>
        </div>
      )}
      {below}
    </div>
  );
}
