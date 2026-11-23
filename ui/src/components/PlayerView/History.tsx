import type { ReactNode } from "react";
import {
  ArrowsLeftRight,
  Handshake,
  House,
  Medal,
  Scissors,
  Star,
  TrendDown,
  TrendUp,
  type Icon,
} from "@phosphor-icons/react";
import Panel, { PanelRow, PanelRows } from "../Panel/index.tsx";
import { RecruitTimeline, timelineItems } from "../RecruitFile/index.tsx";
import Swatch from "../Swatch/index.tsx";
import { cachedTeams } from "../../teams.ts";
import { formatClass } from "../../format.ts";
import { PITCH_NAMES } from "../../standing.ts";
import type { PlayerProfile } from "../../types.ts";
import { messages as m } from "./messages.ts";

type Life = NonNullable<PlayerProfile["story"]>[number];
type Season = NonNullable<PlayerProfile["history"]>[number];

const teamOf = (slug: string | null | undefined) => cachedTeams()?.find((t) => t.slug === slug);

/** One number of his recruitment on a tile: a small label over a big value. */
function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="player-view__tile">
      <dt className="label">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Recruitment: how he came out of high school. Tiles for his stars and where he ranked (the nation, his position, his
 * state) and what he was when he arrived, then the facts in rows: his hometown, when he signed, who else was in it,
 * what he cared about, what you promised. A player who was on the roster before your first class has only his stars
 * and his home state.
 */
export function Recruitment({ pr }: { pr: PlayerProfile }) {
  const rec = pr.recruitment;
  if (!rec)
    return (
      <Panel title={m.h.recruitment}>
        <p className="player-view__soft player-view__note">{m.h.before}</p>
        <PanelRows>
          {pr.stars ? <PanelRow label={m.h.stars} value={<Stars n={pr.stars} />} tip={m.starsTip} /> : null}
          {pr.hometown && <PanelRow label={m.h.homeState} value={pr.hometown} />}
        </PanelRows>
      </Panel>
    );
  const home = [rec.city, rec.state].filter(Boolean).join(", ");
  const signed = rec.week == null ? null : rec.early ? m.h.early : m.h.late;
  return (
    <Panel title={m.h.recruitment} aside={rec.year ? m.h.classOf(rec.year) : undefined}>
      <dl className="player-view__tiles">
        <Tile label={m.h.stars}>{rec.stars ? <Stars n={rec.stars} /> : m.none}</Tile>
        {rec.rank != null && <Tile label={m.h.national}>{m.h.place(rec.rank)}</Tile>}
        {rec.pos_rank != null && (
          <Tile label={rec.pos ? m.h.atPos(rec.pos) : m.h.position}>{m.h.place(rec.pos_rank)}</Tile>
        )}
        {rec.state_rank != null && rec.state && <Tile label={m.h.inState(rec.state)}>{m.h.place(rec.state_rank)}</Tile>}
        {rec.overall != null && <Tile label={m.h.arrived}>{rec.overall}</Tile>}
      </dl>
      <PanelRows>
        {home && <PanelRow label={m.h.hometown} value={home} />}
        <PanelRow
          label={m.h.signedWith}
          value={
            <span className="player-view__school">
              <Swatch team={teamOf(rec.school)} size={12} />
              {rec.school_name}
            </span>
          }
          hint={signed}
        />
        {rec.offers > 0 && <PanelRow label={m.h.offers} value={m.h.schools(rec.offers)} />}
        {rec.others.length > 0 && (
          <PanelRow
            label={m.h.others}
            value={
              <span className="player-view__schools">
                {rec.others.map((s) => (
                  <span key={s.slug} className="player-view__school">
                    <Swatch team={teamOf(s.slug)} size={12} />
                    {s.name}
                  </span>
                ))}
              </span>
            }
          />
        )}
        {rec.flips > 0 && <PanelRow label={m.h.flips} value={m.h.flipped(rec.flips)} />}
        {rec.nil != null && rec.nil > 0 && <PanelRow label={m.h.nil} value={rec.nil} tip={m.h.nilTip} />}
        {rec.priorities?.length ? (
          <PanelRow label={m.h.cared} value={rec.priorities.map((t) => PITCH_NAMES[t] ?? t).join(", ")} />
        ) : null}
        {rec.promised && <PanelRow label={m.promise} value={m.h.promisedStart} />}
      </PanelRows>
    </Panel>
  );
}

/** His stars in gold. */
function Stars({ n }: { n: number }) {
  return (
    <span className="player-view__gold" role="img" aria-label={m.stars(n)}>
      {Array.from({ length: n }, (_, k) => (
        <Star key={k} size={14} weight="fill" aria-hidden="true" />
      ))}
    </span>
  );
}

/** The timeline of how you recruited him (your players only): the recruiting page's History, kept. */
export function RecruitedHow({ pr }: { pr: PlayerProfile }) {
  const rec = pr.recruitment;
  const portal = [...(pr.story ?? [])].reverse().find((e) => e.kind === "transfer" && e.log?.length);
  const log = portal?.log ?? rec?.log;
  const school = portal?.to ?? rec?.school;
  if (!log?.length || !school) return null;
  return (
    <Panel title={portal ? m.h.portalTimeline : m.h.timeline} aside={m.h.entries(timelineItems(log, school).length)}>
      <RecruitTimeline events={log} team={school} />
    </Panel>
  );
}

/** One thing that happened to him, as a marked line: an icon, a bold sentence, soft detail under it. */
function Line({
  icon: Mark,
  tone,
  text,
  detail,
}: {
  icon: Icon;
  tone?: "good" | "bad" | "gold";
  text: string;
  detail?: string[];
}) {
  return (
    <li className="player-view__event">
      <Mark
        className={`player-view__mark${tone ? ` player-view__mark--${tone}` : ""}`}
        size={16}
        weight="bold"
        aria-hidden="true"
      />
      <span>
        <b>{text}</b>
        {detail?.map((d) => (
          <span key={d} className="player-view__soft">
            {d}
          </span>
        ))}
      </span>
    </li>
  );
}

function lineOf(e: Life, i: number) {
  if (e.kind === "progress") {
    const gain = e.gain ?? 0;
    return (
      <Line
        key={i}
        icon={gain < 0 ? TrendDown : TrendUp}
        tone={gain < 0 ? "bad" : gain > 0 ? "good" : undefined}
        text={gain === 0 ? m.h.held(e.overall) : m.h.progress(gain, e.overall)}
        detail={e.why?.map((w) => (/[.!?]$/.test(w) ? w : `${w}.`))}
      />
    );
  }
  if (e.kind === "promise")
    return (
      <Line
        key={i}
        icon={Handshake}
        tone={e.band === "kept" ? "good" : e.band === "broken" ? "bad" : "gold"}
        text={m.h.promise[e.band ?? ""] ?? m.h.stayedPromise}
        detail={e.benched_big ? [m.h.benchedBig] : undefined}
      />
    );
  if (e.kind === "stayed")
    return (
      <Line
        key={i}
        icon={House}
        text={e.intent === "draft" ? m.h.stayedDraft : m.h.stayedPortal}
        detail={[
          e.met ? m.h.met : null,
          e.nil ? m.h.stayedNil(e.nil) : null,
          e.promised ? m.h.stayedPromise : null,
        ].filter((x): x is string => !!x)}
      />
    );
  if (e.kind === "transfer")
    return (
      <Line
        key={i}
        icon={ArrowsLeftRight}
        text={m.h.transfer(e.from_name ?? "", e.to_name ?? "")}
        detail={[
          e.walk_on ? m.h.walkOn : null,
          e.promised ? m.h.stayedPromise : null,
          e.overall != null ? m.h.arrivedAt(e.overall) : null,
        ].filter((x): x is string => !!x)}
      />
    );
  // Roster Cuts: the school that let him go, and where he walked on
  if (e.kind === "cut")
    return (
      <Line
        key={i}
        icon={Scissors}
        tone="bad"
        text={m.h.cut(e.from_name ?? "", e.to_name ?? "")}
        detail={[m.h.walkOn]}
      />
    );
  return null;
}

/**
 * Career: his seasons, newest first. Each is a block: the year, where he played and as what, his games and honors,
 * then what came after it (the offseason): a promise judged, a stay-or-go at Keep Them Home, a transfer, and how he
 * progressed, with the reasons. A year with events and no games (he sat) still has its block.
 */
export function Career({ pr }: { pr: PlayerProfile }) {
  const seasons = new Map<number, Season>((pr.history ?? []).map((h) => [h.year, h]));
  const events = new Map<number, Life[]>();
  (pr.story ?? []).forEach((e) => events.set(e.year, [...(events.get(e.year) ?? []), e]));
  const years = [...new Set([...seasons.keys(), ...events.keys()])].sort((a, b) => b - a);
  return (
    <Panel title={m.career} aside={years.length ? m.h.seasons(years.length) : undefined}>
      {years.length ? (
        <ol className="player-view__years">
          {years.map((y) => {
            const s = seasons.get(y);
            return (
              <li key={y}>
                <header className="player-view__year">
                  <b>{y}</b>
                  {s ? (
                    <span>
                      {[
                        s.team_name,
                        [s.position, formatClass(s.class)].filter(Boolean).join(" · "),
                        m.games(s.games),
                      ].join(" · ")}
                    </span>
                  ) : (
                    <span className="player-view__soft">{m.h.noGames}</span>
                  )}
                </header>
                {s?.honors.length || events.get(y)?.length ? (
                  <ul className="player-view__events">
                    {s?.honors.map((h) => <Line key={h.name} icon={Medal} tone="gold" text={h.name} />)}
                    {events.get(y)?.map(lineOf)}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="player-view__soft">{m.noCareer}</p>
      )}
    </Panel>
  );
}
