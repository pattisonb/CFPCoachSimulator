import { useState } from "react";
import { ArrowDown, ArrowUp, Minus, Star } from "@phosphor-icons/react";
import DataTable, { type Column } from "../DataTable/index.tsx";
import Dropdown from "../Dropdown/index.tsx";
import Panel from "../Panel/index.tsx";
import SectionTabs, { SectionPane, SectionStatus } from "../SectionTabs/index.tsx";
import Swatch from "../Swatch/index.tsx";
import type { PollEntry, SeasonSummary, TeamCard, WeekPolls } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  season: SeasonSummary;
  teams: Map<string, TeamCard>;
  /** open the Bracket (the committee's ranking is what it is built from) */
  onBracket: () => void;
}

type Tab = "ap" | "coaches" | "cfp";
const OTHERS: Record<Tab, keyof WeekPolls | null> = { ap: "ap_others", coaches: "coaches_others", cfp: null };

/**
 * Rankings: the AP Top 25, the Coaches Poll and the committee's CFP ranking, any week of the season (the preseason
 * poll is Week 0's). Each team with where it was last week, its record and conference, and its points and first-place
 * votes; beside the table, the others receiving votes and the week's movers. The committee ranks from Week 10: until
 * then its tab says so, and the Bracket shows where the field would stand from the AP poll.
 */
export default function Rankings({ season, teams, onBracket }: Props) {
  const [tab, setTab] = useState<Tab>("ap");
  const [week, setWeek] = useState<number | null>(null);
  const polls = season.polls ?? {};
  const weeks = Object.keys(polls)
    .map(Number)
    .filter((w) => (polls[String(w)]?.[tab]?.length ?? 0) > 0)
    .sort((a, b) => b - a);
  const at = week != null && weeks.includes(week) ? week : (weeks[0] ?? null);
  const weekName = (w: number) => (w === 0 ? m.preseason : (season.week_labels[String(w)] ?? m.week(w)));
  const rows = at != null ? (polls[String(at)]?.[tab] ?? []) : [];
  const othersKey = OTHERS[tab];
  const others = at != null && othersKey ? ((polls[String(at)]?.[othersKey] as PollEntry[] | undefined) ?? []) : [];
  const firstCfp = season.cfp_weeks?.[0];
  const mine = rows.find((r) => r.team === season.team) ?? others.find((r) => r.team === season.team);

  const columns: Column<PollEntry>[] = [
    { key: "rank", label: m.rank, num: true, render: (r) => <b>{r.rank}</b>, sort: (r) => -r.rank },
    { key: "move", label: m.move, tip: m.moveTip, render: (r) => <Move r={r} /> },
    {
      key: "team",
      label: m.team,
      render: (r) => (
        <span className="rankings__team">
          <Swatch team={teams.get(r.team)} size={16} />
          {r.name}
        </span>
      ),
      sort: (r) => r.name,
    },
    { key: "record", label: m.record, render: (r) => r.record },
    { key: "conf", label: m.conference, render: (r) => r.conference, sort: (r) => r.conference },
  ];
  if (tab !== "cfp")
    columns.push(
      {
        key: "points",
        label: m.points,
        num: true,
        render: (r) => (r.points ?? 0).toLocaleString("en-US"),
        sort: (r) => r.points ?? 0,
      },
      {
        key: "first",
        label: m.firstPlace,
        num: true,
        tip: m.firstPlaceTip,
        render: (r) => r.first_place || "",
        sort: (r) => r.first_place ?? 0,
      },
    );

  return (
    <div className="section-tabs__wrap">
      <SectionTabs
        title={m.title}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "ap", label: m.tabs.ap },
          { key: "coaches", label: m.tabs.coaches },
          { key: "cfp", label: m.tabs.cfp },
        ]}
        aside={
          <>
            {mine && <SectionStatus>{m.yours(season.team_name, mine.rank)}</SectionStatus>}
            {weeks.length > 0 && at != null && (
              <Dropdown
                label={m.weekLabel}
                hideLabel
                size="md"
                align="right"
                value={String(at)}
                options={weeks.map((w) => ({ value: String(w), label: weekName(w) }))}
                onChange={(v) => setWeek(Number(v))}
              />
            )}
          </>
        }
      />
      <SectionPane shown>
        <div className="rankings">
          {!rows.length ? (
            tab === "cfp" ? (
              <div className="rankings__empty">
                <h2>{m.cfpWaiting}</h2>
                <p>{m.cfpWaitingText(firstCfp ? firstCfp - 1 : 9)}</p>
                <button type="button" className="rankings__link" onClick={onBracket}>
                  {m.seeBracket}
                </button>
              </div>
            ) : (
              <p className="rankings__soft">{m.noPoll}</p>
            )
          ) : (
            <div className="rankings__cols">
              <Panel title={m.tabs[tab]} aside={at != null ? weekName(at) : undefined} className="rankings__panel">
                <DataTable
                  label={m.tabs[tab]}
                  columns={columns}
                  rows={rows}
                  rowKey={(r) => r.team}
                  mine={(r) => r.team === season.team}
                />
              </Panel>
              <div className="rankings__side">
                {others.length > 0 && (
                  <Panel title={m.others} aside={m.othersNote}>
                    <ol className="rankings__others">
                      {others.map((r) => (
                        <li key={r.team} className={r.team === season.team ? "is-mine" : undefined}>
                          <span className="rankings__place">{r.rank}</span>
                          <Swatch team={teams.get(r.team)} size={14} />
                          <span className="rankings__grow">{r.name}</span>
                          <b>{r.points ?? 0}</b>
                        </li>
                      ))}
                    </ol>
                  </Panel>
                )}
                <Panel title={m.movers}>
                  <Movers rows={rows} teams={teams} />
                </Panel>
              </div>
            </div>
          )}
        </div>
      </SectionPane>
    </div>
  );
}

/** Where a team was last week: up, down, the same, or new to the poll. */
function Move({ r }: { r: PollEntry }) {
  if (r.previous == null)
    return (
      <span className="rankings__move is-new">
        <Star size={11} weight="fill" aria-hidden="true" />
        {m.newIn}
      </span>
    );
  const d = r.previous - r.rank;
  if (!d)
    return (
      <span className="rankings__move is-same" aria-label={m.noChange}>
        <Minus size={11} weight="bold" aria-hidden="true" />
      </span>
    );
  return (
    <span className={`rankings__move ${d > 0 ? "is-up" : "is-down"}`} aria-label={d > 0 ? m.up(d) : m.down(-d)}>
      {d > 0 ? (
        <ArrowUp size={11} weight="bold" aria-hidden="true" />
      ) : (
        <ArrowDown size={11} weight="bold" aria-hidden="true" />
      )}
      {Math.abs(d)}
    </span>
  );
}

/** The week's biggest climbers and fallers, and who is new. */
function Movers({ rows, teams }: { rows: PollEntry[]; teams: Map<string, TeamCard> }) {
  const gain = (r: PollEntry) => (r.previous ?? r.rank) - r.rank;
  const fresh = rows.filter((r) => r.previous == null);
  const up = rows
    .filter((r) => gain(r) > 0)
    .sort((a, b) => gain(b) - gain(a))
    .slice(0, 3);
  const down = rows
    .filter((r) => gain(r) < 0)
    .sort((a, b) => gain(a) - gain(b))
    .slice(0, 3);
  // the preseason poll (and any first poll): everyone is new, so there is nothing to compare
  if (!up.length && !down.length && fresh.length === rows.length)
    return <p className="rankings__soft">{m.firstPoll}</p>;
  if (!up.length && !down.length && !fresh.length) return <p className="rankings__soft">{m.noMoves}</p>;
  return (
    <ol className="rankings__others">
      {[...up, ...down, ...fresh.slice(0, 3)].map((r) => (
        <li key={r.team}>
          <Move r={r} />
          <Swatch team={teams.get(r.team)} size={14} />
          <span className="rankings__grow">{r.name}</span>
          <b>{m.now(r.rank)}</b>
        </li>
      ))}
    </ol>
  );
}
