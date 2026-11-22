import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowBendUpRight,
  ChatCenteredText,
  Ear,
  Fire,
  Handshake,
  HouseLine,
  MoonStars,
  Phone,
  PhoneDisconnect,
  SmileyMeh,
  Star,
  ThumbsUp,
  type Icon,
} from "@phosphor-icons/react";
import Button from "../Button/index.tsx";
import Face from "../Face/index.tsx";
import Modal from "../Modal/index.tsx";
import { Stars } from "../ProspectCard/index.tsx";
import { api } from "../../api.ts";
import { playerFace, type Face as FaceSpec } from "../../faces.ts";
import { PITCH_NAMES, pullOf, topicPhrase } from "../../standing.ts";
import type { BoardRow, Scene, SceneQuestion, SceneReaction } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

/** *tune* How many things your opening names. */
const OPENING = 3;
/** *tune* How long he types before a line shows: a base, a bit more per letter, and a cap (ms). */
const TYPE_BASE = 520;
const TYPE_PER_CHAR = 11;
const TYPE_MAX = 1500;
/** *tune* The pause before your own line or a note on the room shows (ms). */
const BEAT = 260;
/** the note that brings his question (scenes.js `present`): the question goes in after it, or after the last turn
 *  when it is not there */
const QUESTION_INTRO = "He has a question.";

const REACTION_ICON: Record<string, Icon> = {
  hit: Fire,
  fair: Ear,
  polite: ThumbsUp,
  quiet: SmileyMeh,
  tired: MoonStars,
};
const ANSWER_ICON: Record<string, Icon> = {
  straight: ChatCenteredText,
  promise: Handshake,
  deflect: ArrowBendUpRight,
};
const PULL_BLOCKS = { strong: 3, fair: 2, weak: 1 } as const;

interface Props {
  open: boolean;
  /** closing before the pitch keeps it open on the server (Finish brings it back this week) */
  onClose: () => void;
  seasonId: string;
  r: BoardRow;
  scene: Scene;
  /** the topics you can pitch, in the board's order */
  pitches: string[];
  /** your name, over your lines */
  coach: { name: string; face: FaceSpec } | null;
  /** something landed: the board loads again (hours, his list, what he told you) */
  onChange: () => void;
}

/** A line in the log: a scene's turn, or one the page adds (his question, your answer, his reply, his reaction). */
interface Line {
  who: "you" | "him" | "note";
  text: string;
  /** a tag over the line: His Cue, or how he took your pitch */
  tag?: string;
  tone?: string;
}

const stillMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A call or in-home visit as a conversation (career_js/scenes.js), played like a chat. His lines come in one at a
 * time behind a typing bubble; yours sit on the right in ink. The head shows who you're talking to and the three
 * steps (Open, Listen, Pitch). Under the log, the step you're on: your opening (three topic cards, then Present),
 * his question when he has one (three answer cards), your pitch (one card), and a reaction card that ends it.
 * Hanging up keeps it open (Finish in his panel brings it back this week).
 */
export default function Conversation({ open, onClose, seasonId, r, scene: given, pitches, coach, onChange }: Props) {
  const [scene, setScene] = useState<Scene>(given);
  const [reaction, setReaction] = useState<SceneReaction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [lead, setLead] = useState("");
  const log = useRef<HTMLDivElement | null>(null);
  const face = playerFace(r.id, r.display_pos);

  const q = scene.question;
  const asking = !!(q && !q.answer);
  const step: "opening" | "finish" | "over" = reaction ? "over" : scene.presented ? "finish" : "opening";
  const chosen = lead || (r.priorities_known[0] ?? "");

  // the log as it reads: the scene's turns, his question and its answer after the line that brings it, then your
  // pitch and his reaction
  const lines: Line[] = [];
  const asked = () => {
    if (!q) return;
    lines.push({ who: "him", text: q.text });
    if (q.answer) {
      lines.push({ who: "you", text: answerText(q, q.answer) });
      if (q.reply) lines.push({ who: "him", text: q.reply, tone: replyTone(q) });
    }
  };
  let placed = false;
  for (const t of scene.turns) {
    const cue = !!(scene.cue && t.who === "him" && t.text === scene.cue.text);
    lines.push({ ...t, tag: cue ? m.cueLine : undefined, tone: cue ? "cue" : undefined });
    if (q && !placed && t.text === QUESTION_INTRO) {
      asked();
      placed = true;
    }
  }
  if (q && !placed) asked();
  if (reaction) {
    lines.push({ who: "you", text: reaction.you });
    lines.push({
      who: reaction.kind === "tired" ? "note" : "him",
      text: reaction.text,
      tag: m.reactions[reaction.kind] ?? reaction.kind,
      tone: reaction.kind,
    });
  }

  // the lines come in one at a time: a fresh call plays from its first line, one opened again shows what was said
  const [shown, setShown] = useState(() => (given.presented || stillMotion() ? lines.length : 0));
  const revealing = shown < lines.length;
  const next = revealing ? lines[shown] : null;
  const typing = !!next && next.who === "him";
  const total = lines.length;
  const nextLen = next?.text.length ?? 0;
  useEffect(() => {
    if (shown >= total) return;
    if (stillMotion()) {
      setShown(total);
      return;
    }
    const wait = typing ? Math.min(TYPE_MAX, TYPE_BASE + nextLen * TYPE_PER_CHAR) : BEAT;
    const t = window.setTimeout(() => setShown((n) => n + 1), wait);
    return () => window.clearTimeout(t);
  }, [shown, total, typing, nextLen]);

  // what just came in (or his typing) is brought into view
  useLayoutEffect(() => {
    const el = log.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: stillMotion() ? "auto" : "smooth" });
  }, [shown, typing]);

  // one step of the conversation: your opening, your answer, the job promise or the pitch. Each comes back with the
  // scene as it now stands, or (the pitch) his reaction; the board then loads again (hours, what he told you)
  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ scene?: Scene; reaction?: SceneReaction }>(`/api/season/${seasonId}/recruit`, {
        method: "POST",
        body: { pid: r.id, scene: scene.id, ...body },
      });
      if (out.scene) setScene(out.scene);
      if (out.reaction) setReaction(out.reaction);
      onChange();
    } catch (e) {
      const msg = (e as Error).message;
      setError(/no call or visit open/i.test(msg) ? m.lapsed : m.failed(msg));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (t: string) =>
    setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : p.length < OPENING ? [...p, t] : p));
  const canJob = !asking && !r.job_promised && !scene.job && q?.answer !== "promise";
  const stepAt = step === "opening" ? 0 : step === "finish" && asking ? 1 : 2;
  const wait = revealing || busy;
  const Where = scene.action === "hc_visit" ? HouseLine : Phone;
  const shownLines = lines.slice(0, shown);

  const head = (
    <div className="talk-head">
      <span className="face-tile talk-head__face">
        <Face face={face} scale={2} label="" />
        <span className="talk-head__where" title={m.where[scene.action]}>
          <Where size={14} weight="fill" aria-hidden="true" />
        </span>
      </span>
      <div className="talk-head__who">
        <span className="label talk-head__kicker">
          <span className={`talk-head__live${step === "over" ? " is-off" : ""}`} aria-hidden="true" />
          {m.where[scene.action]}
        </span>
        <h2 className="talk-head__name">{r.name}</h2>
        <span className="talk-head__meta">
          <Stars n={r.stars} />
          <span>
            {r.display_pos} · {r.hometown.city}, {r.hometown.state}
          </span>
        </span>
      </div>
      <ol className="talk-steps" aria-label={m.stepsLabel}>
        {m.steps.map((s, i) => (
          <li
            key={s}
            className={step === "over" || i < stepAt ? "is-done" : i === stepAt ? "is-now" : undefined}
            aria-current={step !== "over" && i === stepAt ? "step" : undefined}
          >
            <span className="talk-steps__box" aria-hidden="true" />
            {s}
          </li>
        ))}
      </ol>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} size="talk" title={m.title[scene.action](r.name)} head={head}>
      <div className="talk">
        <div className="talk__log" ref={log} role="log" aria-label={m.log}>
          {shownLines.map((l, i) => (
            <TalkLine
              key={i}
              line={l}
              face={face}
              you={coach?.name ?? m.you}
              name={r.name}
              last={(shownLines[i + 1]?.who ?? (typing ? next?.who : undefined)) !== l.who}
            />
          ))}
          {typing && next && (
            <div className={`talk__line is-${next.who} is-typing`} role="status" aria-label={m.typing(r.name)}>
              <span className={`face-tile talk__face${next.who === "him" ? "" : " is-blank"}`} aria-hidden="true">
                {next.who === "him" && <Face face={face} scale={1} label="" />}
              </span>
              <div className="talk__bubble talk__dots" aria-hidden="true">
                <span className="talk__dot" />
                <span className="talk__dot" />
                <span className="talk__dot" />
              </div>
            </div>
          )}
        </div>

        <div className={`talk__dock${wait ? " is-waiting" : ""}`} aria-busy={wait}>
          <div className="talk__panel" key={`${step}-${asking}`}>
            {step === "opening" && (
              <>
                <StepHead title={m.opening} help={m.openingHelp} />
                <Topics
                  r={r}
                  topics={pitches}
                  selected={picked}
                  onPick={toggle}
                  multi
                  disabled={wait}
                  label={m.opening}
                />
              </>
            )}

            {step === "finish" && asking && q && (
              <>
                <StepHead title={m.asks} help={m.asksHelp} />
                <div className="talk__answers">
                  {(["straight", "promise", "deflect"] as const).map((a) => {
                    const A = ANSWER_ICON[a];
                    return (
                      <button
                        key={a}
                        type="button"
                        className="talk__answer"
                        disabled={wait}
                        onClick={() => void send({ action: "answer", answer: a })}
                      >
                        <b>
                          <A size={18} weight="bold" aria-hidden="true" />
                          {q.answers?.[a]?.label ?? m.answerLabels[a]}
                        </b>
                        <span>“{answerText(q, a)}”</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {step === "finish" && !asking && (
              <>
                <StepHead title={m.leadWith} help={m.leadHelp} />
                <Topics
                  r={r}
                  topics={pitches}
                  selected={chosen ? [chosen] : []}
                  onPick={setLead}
                  disabled={wait}
                  label={m.leadWith}
                />
              </>
            )}

            {step === "over" && reaction && !revealing && <Result reaction={reaction} pitched={chosen} />}
          </div>

          {error && (
            <p className="talk__error" role="alert">
              {error}
            </p>
          )}

          <div className="talk__acts">
            {step === "over" ? (
              <>
                <Button disabled={revealing} onClick={onClose} title={m.doneNote}>
                  {m.done}
                </Button>
              </>
            ) : (
              <>
                <button type="button" className="talk__hang" title={m.hangUpTip} onClick={onClose}>
                  <PhoneDisconnect size={18} weight="bold" aria-hidden="true" />
                  {m.hangUp[scene.action]}
                </button>
                {step === "opening" ? (
                  <span className="talk__go">
                    <span className="talk__slots" role="img" aria-label={`${picked.length} of ${OPENING}`}>
                      {Array.from({ length: OPENING }, (_, i) => (
                        <i key={i} className={i < picked.length ? "is-on" : undefined} />
                      ))}
                    </span>
                    <Button
                      disabled={wait || picked.length !== OPENING}
                      title={picked.length !== OPENING ? m.presentTip(OPENING) : undefined}
                      onClick={() => void send({ action: "present", topics: picked })}
                    >
                      {m.present}
                    </Button>
                  </span>
                ) : (
                  <span className="talk__go">
                    {canJob && (
                      <Button
                        variant="outline"
                        disabled={wait}
                        title={m.promiseJobTip}
                        onClick={() => void send({ action: "promise_job" })}
                      >
                        <Handshake size={18} weight="bold" aria-hidden="true" />
                        {m.promiseJob}
                      </Button>
                    )}
                    {!asking && (
                      <Button
                        disabled={wait || !chosen}
                        title={!chosen ? m.pickLead : undefined}
                        onClick={() => void send({ action: "pitch", pitch: chosen })}
                      >
                        {m.pitch}
                        {chosen ? `: ${PITCH_NAMES[chosen] ?? chosen}` : ""}
                      </Button>
                    )}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function StepHead({ title, help }: { title: string; help: string }) {
  return (
    <div className="talk__step">
      <h3 className="talk__step-title">{title}</h3>
      <span className="talk__soft">{help}</span>
    </div>
  );
}

/** How the pitch went: a big stamp, what it means, and what he told you. */
function Result({ reaction, pitched }: { reaction: SceneReaction; pitched: string }) {
  const R = REACTION_ICON[reaction.kind] ?? ThumbsUp;
  return (
    <div className={`talk__result is-${reaction.kind}`} role="status">
      <span className="talk__stamp">
        <R size={36} weight="fill" aria-hidden="true" />
      </span>
      <div className="talk__result-text">
        <span className="label">
          {m.pitch}: {PITCH_NAMES[pitched] ?? pitched}
        </span>
        <b className="talk__result-word">{m.reactions[reaction.kind] ?? reaction.kind}</b>
        <span className="talk__soft">
          {reaction.revealed ? m.learned(topicPhrase(reaction.revealed)) : (m.meaning[reaction.kind] ?? "")}
        </span>
      </div>
    </div>
  );
}

/** Your line answering his question: a Package Deal's own, else the table's by his question's kind. */
function answerText(q: SceneQuestion, a: string): string {
  return q.answers?.[a]?.text ?? m.answerCopy[q.kind]?.[a] ?? m.answerCopy.roster[a];
}

/** His reply's tone: a straight answer or a promise he believes reads good, a hollow one bad, a sidestep plain. */
function replyTone(q: SceneQuestion): string {
  if (q.answer === "deflect") return "polite";
  if (q.answer === "promise" && q.truthful === false) return "quiet";
  return "hit";
}

/** One line of the conversation. */
function TalkLine({
  line,
  face,
  you,
  name,
  last,
}: {
  line: Line;
  face: FaceSpec;
  you: string;
  name: string;
  /** the last of a run by the same speaker: it carries his face (a chat's way) */
  last: boolean;
}) {
  if (line.who === "note")
    return (
      <p className={`talk__note${line.tone ? ` is-${line.tone}` : ""}`}>
        {line.tag && <span className="talk__tag">{line.tag}</span>}
        {line.text}
      </p>
    );
  const who = line.who === "you" ? you : name;
  return (
    <div className={`talk__line is-${line.who}${line.tone ? ` is-${line.tone}` : ""}`}>
      {line.who !== "you" && (
        <span className={`face-tile talk__face${last ? "" : " is-blank"}`} aria-hidden="true">
          {last && <Face face={face} scale={1} label="" />}
        </span>
      )}
      <div className="talk__bubble">
        <span className="talk__who">
          {who}
          {line.tag && <span className="talk__tag">{line.tag}</span>}
        </span>
        <p>{line.text}</p>
      </div>
    </div>
  );
}

/** The topics as cards: your pull on each in blocks, and what you know (he cares, how he took it). */
function Topics({
  r,
  topics,
  selected,
  onPick,
  multi = false,
  disabled,
  label,
}: {
  r: BoardRow;
  topics: string[];
  selected: string[];
  onPick: (t: string) => void;
  multi?: boolean;
  disabled: boolean;
  label: string;
}) {
  return (
    <div className="talk__topics" role={multi ? "group" : "radiogroup"} aria-label={label}>
      {topics.map((t) => {
        const at = selected.indexOf(t);
        const on = at >= 0;
        const pull = pullOf(r.strength[t]);
        const known = r.priorities_known.includes(t);
        const mark = r.pitch_marks[t]?.mark;
        const full = multi && !on && selected.length >= OPENING;
        return (
          <button
            key={t}
            type="button"
            role={multi ? undefined : "radio"}
            aria-pressed={multi ? on : undefined}
            aria-checked={multi ? undefined : on}
            className={["talk__topic", on && "is-on", known && "is-known", full && "is-full"].filter(Boolean).join(" ")}
            disabled={disabled}
            title={[
              m.pullTip(topicPhrase(t), m.pull[pull]),
              known ? m.known : mark ? m.markTip(m.marks[mark] ?? mark) : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => !full && onPick(t)}
          >
            {/* its place in your opening sits on the corner, over the frame: picking one never changes its width */}
            {multi && on && <span className="talk__num">{at + 1}</span>}
            {known && <Star className="talk__star" size={14} weight="fill" aria-hidden="true" />}
            <span className="talk__topic-name">{PITCH_NAMES[t] ?? t}</span>
            <span className="talk__pull" aria-label={m.pull[pull]}>
              {[1, 2, 3].map((k) => (
                <i key={k} className={k <= PULL_BLOCKS[pull] ? "is-on" : undefined} />
              ))}
            </span>
            {mark && !known && <span className="talk__mark">{m.marks[mark] ?? mark}</span>}
          </button>
        );
      })}
    </div>
  );
}
