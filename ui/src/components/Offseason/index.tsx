import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check } from "@phosphor-icons/react";
import SectionTabs, { SectionStatus } from "../SectionTabs/index.tsx";
import { api } from "../../api.ts";
import { beginBusy } from "../../busy.ts";
import type { SeasonSummary, TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import { Stage } from "./Stages.tsx";
import type { OffView } from "./types.ts";
import "./index.css";

interface Props {
  season: SeasonSummary;
  teams: Map<string, TeamCard>;
  /** open another section (the Recruiting board, where the portal is worked) */
  onSection: (key: string) => void;
  /** open a recruit or transfer on the Recruiting board (his file: scouting, ratings, your offer) */
  onRecruit: (pid: string) => void;
  /** the stage the offseason is at, when it loads and each time it moves on */
  onStage?: (stage: string) => void;
  /** the next season has begun: open it */
  onNextSeason: (seasonId: string) => void;
}

/** What every stage's panels are handed: the offseason, and the two ways to change it. */
export interface StageProps {
  v: OffView;
  season: SeasonSummary;
  teams: Map<string, TeamCard>;
  /** a change is being saved */
  busy: boolean;
  /** only the current stage can be acted on; an earlier one is read back */
  live: boolean;
  /** POST an action under /offseason; the offseason it returns (or a fresh one) is shown */
  act: (path: string, body: object) => Promise<boolean>;
  /** GET something under /offseason */
  get: <T>(path: string) => Promise<T>;
  onSection: (key: string) => void;
  onRecruit: (pid: string) => void;
}

/**
 * The Offseason: what happens between the title game and next season's kickoff, a stage at a time. Across the top,
 * every stage in order (the ones behind you can be opened again and read); under it, the stage's panels; at the end
 * of the bar, the way on. Keep Them Home and the AD's review, Departures and the draft, four weeks of the transfer
 * portal (worked on the Recruiting board), Development, Staff and job offers, Change Conferences, Edit Schedule, and
 * Ready, which starts the next season.
 */
export default function Offseason({ season, teams, onSection, onRecruit, onStage, onNextSeason }: Props) {
  const [v, setV] = useState<OffView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** the stage whose panels are showing: the current one unless you opened an earlier one */
  const [shown, setShown] = useState<string | null>(null);
  /** the stage just finished whose results are still on the page (Roster Cuts: where each cut player went) */
  const [results, setResults] = useState<string | null>(null);
  /** you have moved on from the AD's meeting this offseason (kept by this browser, a career and a year at a time) */
  const metKey = `cfp.off.met.${season.id}.${season.year}`;
  const [met, setMet] = useState(() => {
    try {
      return localStorage.getItem(metKey) === "1";
    } catch {
      return false;
    }
  });
  const leaveMeeting = () => {
    setMet(true);
    try {
      localStorage.setItem(metKey, "1");
    } catch {
      /* a private window: it lasts this visit */
    }
  };
  const base = `/api/season/${season.id}/offseason`;

  const load = useCallback(
    () =>
      api<OffView>(base)
        .then((view) => {
          setV(view);
          setError(null);
        })
        .catch((e: Error) => setError(e.message)),
    [base],
  );
  useEffect(() => {
    if (season.done) void load();
  }, [season.done, load]);

  const stage = v?.stage ?? "";
  useEffect(() => {
    if (stage) onStage?.(stage);
  }, [stage, onStage]);
  /** one action: saved with the stage it was drawn for (a click queued behind an advance is refused, not misapplied) */
  const act = async (path: string, body: object) => {
    setBusy(true);
    setNote(null);
    try {
      const out = await api<Partial<OffView>>(`${base}${path}`, { method: "POST", body: { ...body, stage } });
      if (out.stage && out.stages) setV(out as OffView);
      else await load();
      return true;
    } catch (e) {
      setNote(m.failed((e as Error).message));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const get = <T,>(path: string) => api<T>(`${base}${path}`);

  const advance = async () => {
    setBusy(true);
    setNote(null);
    const done = beginBusy(ready ? m.starting(v?.year ?? season.year + 1) : next ? m.movingTo(next.name) : m.working);
    try {
      const out = await api<Partial<OffView> & { next_season?: boolean; summary?: { id: string } }>(`${base}/advance`, {
        method: "POST",
        body: { stage },
      });
      if (out.next_season && out.summary) {
        // the new season opens in place now (no page load to clear the notice): it is taken down here
        done();
        return onNextSeason(out.summary.id);
      }
      // the cuts are made: where each player went stays on the page until you move on (the player's note: he had
      // to click back to Roster Cuts to see it)
      const told = stage === "cuts" && ((out.cuts?.out?.length ?? 0) > 0 || (out.cuts?.joined?.length ?? 0) > 0);
      setShown(told ? "cuts" : null);
      setResults(told ? "cuts" : null);
      setV(out as OffView);
      done();
    } catch (e) {
      done();
      setNote(m.failed((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  if (!season.done)
    return (
      <div className="section-tabs__wrap">
        <SectionTabs title={m.title} value="all" onChange={() => {}} tabs={[]} />
        <div className="off">
          <div className="off__wait">
            <h2>{m.notYet}</h2>
            <p>{m.notYetText}</p>
          </div>
        </div>
      </div>
    );

  // the AD's meeting is the offseason's first step on this screen (the game holds it inside Keep Them Home): until
  // you move on from it, it is the current one
  const inMeeting = !!v && v.stage === "retention" && !met;
  const steps = v
    ? [
        { key: "review", name: m.meetingName, done: !inMeeting, current: inMeeting },
        ...v.stages.map((s) => (inMeeting ? { ...s, current: false } : s)),
      ]
    : [];
  const at = steps.findIndex((s) => s.current);
  const next = steps[at + 1];
  const showing = v ? (steps.find((s) => s.key === shown && s.done) ?? steps[at]) : null;
  const ready = stage === "ready";

  return (
    <div className="section-tabs__wrap">
      <SectionTabs
        title={m.title}
        value="all"
        onChange={() => {}}
        tabs={[]}
        aside={v && <SectionStatus>{m.building(v.year)}</SectionStatus>}
      />
      <div className="off">
        {!v || !showing ? (
          <p className="off__soft">{error ? m.loadError(error) : m.loading}</p>
        ) : (
          <>
            {/* the stages and the way on stay at the top while the stage's panels scroll under them */}
            <div className="off__top">
              {/* every stage in order: the ones behind you open again to be read */}
              <ol className="off__steps" aria-label={m.stagesLabel}>
                {steps.map((s, i) => (
                  <li key={s.key} className={`${s.current ? "is-current" : ""}${s.done ? " is-done" : ""}`}>
                    <button
                      type="button"
                      className={`off__step${showing.key === s.key ? " is-shown" : ""}`}
                      disabled={!s.done && !s.current}
                      aria-current={s.current ? "step" : undefined}
                      title={s.name}
                      onClick={() => setShown(s.current ? null : s.key)}
                    >
                      <span className="off__step-n">
                        {s.done ? <Check size={12} weight="bold" aria-hidden="true" /> : i + 1}
                      </span>
                      <span className="off__step-name">{m.shortStage[s.key] ?? s.name}</span>
                    </button>
                  </li>
                ))}
              </ol>

              <header className="off__head">
                <div>
                  <h2 title={m.about[showing.key]}>{showing.key === results ? m.cutsResults : showing.name}</h2>
                </div>
                {showing.key === "review" && inMeeting ? (
                  <button type="button" className="off__next" onClick={leaveMeeting}>
                    {m.onTo(next?.name ?? "")}
                    <ArrowRight size={16} weight="bold" aria-hidden="true" />
                  </button>
                ) : showing.key === stage ? (
                  <button type="button" className="off__next" disabled={busy} onClick={advance}>
                    {busy
                      ? m.working
                      : ready
                        ? m.startSeason(v.year)
                        : stage === "cuts"
                          ? m.makeCuts
                          : next
                            ? m.onTo(next.name)
                            : m.advance}
                    <ArrowRight size={16} weight="bold" aria-hidden="true" />
                  </button>
                ) : showing.key === results ? (
                  <button
                    type="button"
                    className="off__next"
                    onClick={() => {
                      setShown(null);
                      setResults(null);
                    }}
                  >
                    {m.onTo(steps[at]?.name ?? v.stage_name)}
                    <ArrowRight size={16} weight="bold" aria-hidden="true" />
                  </button>
                ) : (
                  <button type="button" className="off__next is-quiet" onClick={() => setShown(null)}>
                    {m.backTo(steps[at]?.name ?? v.stage_name)}
                  </button>
                )}
              </header>
            </div>
            {note && (
              <p className="off__note" role="alert">
                {note}
              </p>
            )}
            {v.fired && <p className="off__note">{m.fired}</p>}

            <Stage
              stage={showing.key}
              v={v}
              season={season}
              teams={teams}
              busy={busy}
              live={showing.key === stage || (showing.key === "review" && v.review_open)}
              act={act}
              get={get}
              onSection={onSection}
              onRecruit={onRecruit}
            />
          </>
        )}
      </div>
    </div>
  );
}
