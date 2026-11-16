import { useMemo, useRef, useState } from "react";
import { ArrowLeft } from "@phosphor-icons/react";
import Chip from "../Chip/index.tsx";
import Matchup, { type MatchupSide } from "../Matchup/index.tsx";
import SectionTabs, { SampleNote, SectionStatus } from "../SectionTabs/index.tsx";
import Swatch from "../Swatch/index.tsx";
import { sampleFor } from "./sample.ts";
import type { Bowl, SeasonSummary, TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  season: SeasonSummary;
  teams: Map<string, TeamCard>;
}

/** The bowl weeks, in order: each one a window of the bowl season. */
const WINDOWS = [17, 18, 19];

const sideOf = (b: Bowl, which: "away" | "home", teams: Map<string, TeamCard>, me: string): MatchupSide => {
  const slug = b[which];
  return {
    team: slug ? teams.get(slug) : undefined,
    name: (which === "away" ? b.away_name : b.home_name) ?? m.tbd,
    record: (which === "away" ? b.away_record : b.home_record) ?? "",
    mine: !!slug && slug === me,
  };
};

/**
 * Bowls: the bowl season. Up top, the picked bowl as a matchup banner in both teams' colors (yours to start, when
 * you're in one), with the bowl's facts underneath: when and where, its history, its tie-ins. Below, every bowl by
 * window (Early, Holiday Week, New Year's) as cards; pick one to put it up top. Before selection day it's the
 * projected lineup from the committee's latest ranking; before the first ranking, a sample.
 */
export default function Bowls({ season, teams }: Props) {
  const set = season.bowls?.length ? season.bowls : null;
  const projection = set ? null : (season.bowl_projection ?? null);
  const sample = !set && !projection;
  const sampled = useMemo(() => sampleFor(season.team, season.team_name), [season.team, season.team_name]);
  const bowls = set ?? projection?.bowls ?? sampled.bowls;
  const playoff = set ? (season.bracket?.seeds ?? []).map((s) => s.team) : (projection ?? sampled).playoff;
  const me = season.team;
  const mine = bowls.find((b) => b.mine) ?? null;

  const [picked, setPicked] = useState<string | null>(null);
  const [conf, setConf] = useState<string | null>(null);
  const current = bowls.find((b) => b.bowl === picked) ?? mine ?? bowls.find((b) => !b.unfilled) ?? null;

  const shown = useMemo(
    () => bowls.filter((b) => !conf || b.home_conference === conf || b.away_conference === conf),
    [bowls, conf],
  );
  const confCount = useMemo(
    () =>
      bowls.filter((b) => b.home_conference === season.conference || b.away_conference === season.conference).length,
    [bowls, season.conference],
  );

  // the page scrolls as one; picking a bowl glides back up to the banner
  const page = useRef<HTMLDivElement>(null);
  const pick = (bowl: string | null) => {
    setPicked(bowl);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    page.current?.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" });
  };

  const weekName = season.week_labels[projection?.week ?? 0] ?? `Week ${projection?.week ?? 0}`;
  const status = sample ? (
    <SectionStatus sample tip={m.sampleTip}>
      {m.sample}
    </SectionStatus>
  ) : (
    <SectionStatus tip={projection ? m.projectedTip : undefined}>
      {projection ? m.projected(weekName) : m.set}
    </SectionStatus>
  );

  // where you stand: your bowl, the playoff, or neither
  const projected = !set;
  const standing = mine
    ? projected
      ? m.yourProjected
      : m.yourBowl
    : playoff.includes(me)
      ? (projected ? m.inPlayoffProjected : m.inPlayoff)(season.team_name)
      : (projected ? m.noBowlProjected : m.noBowl)(season.team_name);

  return (
    <div className="section-tabs__wrap">
      <SectionTabs title={m.title} value="all" onChange={() => {}} tabs={[]} aside={status} />
      <div className="bowls" ref={page}>
        {sample && <SampleNote>{m.sampleTip}</SampleNote>}
        {current && (
          <Banner key={current.bowl} b={current} teams={teams} me={me} yours={current === mine ? standing : null} />
        )}

        {/* stays at the top as the list scrolls: the filter, then where you stand (or the way back to your bowl) */}
        <div className="bowls__bar">
          <div className="bowls__filters" role="group" aria-label={m.filterLabel}>
            <Chip on={!conf} count={bowls.length} onClick={() => setConf(null)}>
              {m.all}
            </Chip>
            {confCount > 0 && (
              <Chip on={conf === season.conference} count={confCount} onClick={() => setConf(season.conference)}>
                {season.conference}
              </Chip>
            )}
          </div>
          {mine && current && current.bowl !== mine.bowl ? (
            <button type="button" className="bowls__back" onClick={() => pick(null)}>
              <ArrowLeft size={14} weight="bold" aria-hidden="true" />
              {projected ? m.yourProjected : m.yourBowl}
            </button>
          ) : (
            !mine && <span className="bowls__soft">{standing}</span>
          )}
        </div>
        <div className="bowls__list" aria-label={m.listLabel}>
          {shown.length === 0 && <p className="bowls__soft">{m.none}</p>}
          {WINDOWS.map((w) => {
            const here = shown.filter((b) => b.week === w);
            if (!here.length) return null;
            return (
              <section key={w} className="bowls__window" aria-label={m.windows[w]}>
                <h2 className="label bowls__kicker">
                  {m.windows[w]} <span className="bowls__soft">{m.count(here.length)}</span>
                </h2>
                <div className="bowls__cards">
                  {here.map((b) => (
                    <Card
                      key={b.bowl}
                      b={b}
                      teams={teams}
                      me={me}
                      picked={b.bowl === current?.bowl}
                      onPick={() => pick(b.bowl)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** The picked bowl: the matchup as art, then when and where and the bowl's own story. */
function Banner({ b, teams, me, yours }: { b: Bowl; teams: Map<string, TeamCard>; me: string; yours: string | null }) {
  const played = b.played && b.away_score != null && b.home_score != null;
  const mineWon =
    played && b.mine ? (b.away === me ? b.away_score! > b.home_score! : b.home_score! > b.away_score!) : null;
  const kicker = played ? (b.overtime ? m.finalOt(b.overtime) : m.final) : b.projected ? m.projectedKicker : m.upcoming;
  const facts = [
    b.first_played ? m.firstPlayed(b.first_played) : null,
    b.games_played ? m.edition(b.games_played + (played ? 0 : 1)) : null,
    b.payout ? m.payout(b.payout) : null,
  ].filter(Boolean);
  return (
    <section className="bowls-banner" aria-label={b.name}>
      {b.unfilled ? (
        <div className="bowls-banner__unfilled">{m.unfilled}</div>
      ) : (
        <Matchup
          left={sideOf(b, "away", teams, me)}
          right={sideOf(b, "home", teams, me)}
          result={mineWon === null ? null : mineWon ? "won" : "lost"}
          mid={
            played ? (
              <b className="matchup__score">
                {b.away_score}
                <i>–</i>
                {b.home_score}
              </b>
            ) : (
              <b className="matchup__vs">{m.vs}</b>
            )
          }
        />
      )}
      <div className="bowls-banner__info">
        <div className="bowls-banner__when">
          <span className="label bowls__kicker">{yours ? (played ? `${yours} · ${kicker}` : yours) : kicker}</span>
          <b className="bowls-banner__name">{b.name}</b>
          <span>{[b.date, b.time].filter(Boolean).join(" · ")}</span>
          {b.site && <span className="bowls-banner__chip">{b.site}</span>}
        </div>
        <div className="bowls-banner__facts">
          {facts.length > 0 && (
            <div className="bowls-banner__cell">
              <span className="label bowls__kicker">{m.facts}</span>
              {facts.map((f) => (
                <span key={f}>{f}</span>
              ))}
            </div>
          )}
          {b.tie_ins.length > 0 && (
            <div className="bowls-banner__cell">
              <span className="label bowls__kicker">{m.tieIns}</span>
              <span>{b.tie_ins.join(` ${m.vs} `)}</span>
            </div>
          )}
          {b.recent && b.recent.length > 0 && (
            <div className="bowls-banner__cell">
              <span className="label bowls__kicker">{m.recent}</span>
              {b.recent.map((r) => (
                <span key={r.year}>{m.recentLine(r.year, r.winner, r.winner_score, r.loser, r.loser_score)}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** One bowl in the list: its name and day, then the two teams (the winner bold once it's played). */
function Card({
  b,
  teams,
  me,
  picked,
  onPick,
}: {
  b: Bowl;
  teams: Map<string, TeamCard>;
  me: string;
  picked: boolean;
  onPick: () => void;
}) {
  const played = b.played && b.away_score != null && b.home_score != null;
  const row = (which: "away" | "home") => {
    const slug = b[which];
    const score = which === "away" ? b.away_score : b.home_score;
    const other = which === "away" ? b.home_score : b.away_score;
    const won = played && score! > other!;
    return (
      <span className={`bowl-card__team${played ? (won ? " is-won" : " is-lost") : ""}`}>
        <Swatch team={slug ? teams.get(slug) : undefined} size={16} />
        <span className="bowl-card__name">{(which === "away" ? b.away_name : b.home_name) ?? m.tbd}</span>
        {slug === me && <span className="bowl-card__you">{m.you}</span>}
        <span className="bowl-card__rec">{(which === "away" ? b.away_record : b.home_record) ?? ""}</span>
        {played && <b className="bowl-card__score">{score}</b>}
      </span>
    );
  };
  return (
    <button
      type="button"
      className={["bowl-card", picked && "is-picked", b.mine && "is-mine"].filter(Boolean).join(" ")}
      aria-pressed={picked}
      onClick={onPick}
    >
      <span className="bowl-card__head">
        <b>{b.name}</b>
        <span>{b.date}</span>
      </span>
      {b.unfilled ? (
        <span className="bowl-card__note">{m.unfilled}</span>
      ) : (
        <>
          {row("away")}
          {row("home")}
        </>
      )}
      {b.projected && b.tie_ins.length > 0 && (
        <span className="bowl-card__note">
          {m.tieIns}: {b.tie_ins.join(` ${m.vs} `)}
        </span>
      )}
    </button>
  );
}
