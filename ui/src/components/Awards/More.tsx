import { useState, type ReactNode } from "react";
import { Star } from "@phosphor-icons/react";
import Chip from "../Chip/index.tsx";
import DataTable, { type Column } from "../DataTable/index.tsx";
import Dropdown from "../Dropdown/index.tsx";
import Panel from "../Panel/index.tsx";
import PlayerLink from "../PlayerLink/index.tsx";
import Swatch from "../Swatch/index.tsx";
import Tooltip from "../Tooltip/index.tsx";
import { formatClass } from "../../format.ts";
import type {
  AllAmerica,
  AwardCoach,
  AwardPlayer,
  CoachAward,
  ConferenceAwards,
  ConsensusPick,
  PlayerAward,
  TeamCard,
  TeamPick,
} from "../../types.ts";
import { messages as m } from "./messages.ts";

// The second pass of the Awards screen: the national awards as one table, the coach awards with every finalist, the
// All-America teams lined up on a field, and each conference's awards and all-conference teams.

interface Shared {
  teams: Map<string, TeamCard>;
  /** your team's slug */
  mine: string;
  /** the awards are a race still (leaders), not results (winners) */
  live: boolean;
  /** a player's face in his team's color (the screen's own) */
  face: (p: AwardPlayer) => ReactNode;
}

const who = (p: AwardPlayer) => [p.position, formatClass(p.class), p.team_name].filter(Boolean).join(" · ");
const listOf = (a: PlayerAward, live: boolean) =>
  live ? (a.race ?? a.finalists) : a.finalists.length ? a.finalists : a.winner ? [a.winner] : [];

/** Every national award in one table: the award, who leads it (or won it), his line, and who is next. */
export function NationalTable({ awards, teams, mine, live }: Shared & { awards: PlayerAward[] }) {
  const rows = awards.map((a) => ({ a, list: listOf(a, live) }));
  type Row = (typeof rows)[number];
  const player = (p: AwardPlayer | undefined) =>
    p ? (
      <span className="aw-table__who">
        <Swatch team={teams.get(p.team)} size={14} />
        <b>
          <PlayerLink team={p.team} name={p.name} position={p.position} />
        </b>
        <span className="aw-table__soft">
          {p.position} · {p.team_name}
        </span>
      </span>
    ) : (
      ""
    );
  const columns: Column<Row>[] = [
    {
      key: "award",
      label: m.table.award,
      render: (r) => (
        <span className="aw-table__award">
          <b>{r.a.name}</b>
          {r.a.honors && <span className="aw-table__soft">{m.whatFor(r.a.honors)}</span>}
        </span>
      ),
      sort: (r) => r.a.name,
    },
    {
      key: "first",
      label: live ? m.leader : m.winner,
      render: (r) => player(r.list[0]),
      sort: (r) => r.list[0]?.name ?? "",
    },
    { key: "line", label: m.table.line, render: (r) => r.list[0]?.headline ?? "" },
    { key: "second", label: m.table.second, render: (r) => player(r.list[1]) },
    { key: "third", label: m.table.third, render: (r) => player(r.list[2]) },
  ];
  if (!rows.length) return <p className="aw__empty">{m.noAwards}</p>;
  return (
    <Panel title={m.national} aside={live ? m.table.raceNote : m.table.finalNote} className="aw-table">
      <DataTable
        label={m.national}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.a.name}
        mine={(r) => r.list[0]?.team === mine}
      />
    </Panel>
  );
}

/** The coach awards: each with its leader (or winner) as a card, and the rest of its finalists in a table beside it. */
export function Coaches({
  awards,
  teams,
  mine,
  live,
  card,
}: Omit<Shared, "face"> & { awards: CoachAward[]; card: (a: CoachAward) => ReactNode }) {
  if (!awards.length) return <p className="aw__empty">{live ? m.noCoachRace : m.noAwards}</p>;
  const columns: Column<AwardCoach & { place: number }>[] = [
    { key: "place", label: m.table.place, num: true, render: (c) => c.place },
    {
      key: "coach",
      label: m.table.coach,
      render: (c) => (
        <span className="aw-table__who">
          <Swatch team={teams.get(c.team)} size={14} />
          <b>{c.coach}</b>
          <span className="aw-table__soft">
            {c.role ?? m.headCoach} · {c.team_name}
          </span>
        </span>
      ),
    },
    { key: "record", label: m.table.record, num: true, render: (c) => m.coachLine(c.wins, c.losses, null) },
    { key: "rank", label: m.table.rank, num: true, render: (c) => (c.rank ? `#${c.rank}` : "") },
    {
      key: "pre",
      label: m.table.preseason,
      num: true,
      tip: m.table.preseasonTip,
      render: (c) => (c.preseason_rank ? `#${c.preseason_rank}` : m.unranked),
    },
  ];
  return (
    <div className="aw-coaches">
      {awards.map((a) => {
        const list = (a.finalists.length ? a.finalists : a.winner ? [a.winner] : []).map((c, i) => ({
          ...c,
          place: i + 1,
        }));
        return (
          <section key={a.name} className="aw-coaches__row">
            {card(a)}
            <Panel title={live ? m.table.inTheRace : m.table.finalists} className="aw-table">
              {list.length ? (
                <DataTable
                  label={a.name}
                  columns={columns}
                  rows={list}
                  rowKey={(c) => `${c.team}-${c.coach}`}
                  mine={(c) => c.team === mine}
                />
              ) : (
                <p className="aw__empty">{m.noRace}</p>
              )}
            </Panel>
          </section>
        );
      })}
    </div>
  );
}

/** Where each slot lines up on the field: three lines of offense, three of defense, then the specialists. */
const LINES: { unit: "offense" | "defense" | "special"; slots: string[] }[] = [
  { unit: "offense", slots: ["WR", "TE", "AP"] },
  { unit: "offense", slots: ["T", "G", "C", "OL"] },
  { unit: "offense", slots: ["QB", "RB"] },
  { unit: "defense", slots: ["EDGE", "DT", "DL"] },
  { unit: "defense", slots: ["LB"] },
  { unit: "defense", slots: ["CB", "S", "DB"] },
  { unit: "special", slots: ["K", "P", "RS"] },
];

/**
 * A team of honorees lined up on a field: the offense in its three lines, the defense in its three, the specialists
 * along the bottom. Each man as a small card in his team's color; a consensus pick shows how many selectors named him.
 */
function HonorField({ picks, teams, mine, face }: Shared & { picks: (TeamPick | ConsensusPick)[] }) {
  if (!picks.length) return <p className="aw__empty">{m.noTeam}</p>;
  let unit = "";
  return (
    <div className="aw-field">
      {LINES.map((line) => {
        const men = line.slots.flatMap((s) => picks.filter((p) => p.slot === s));
        if (!men.length) return null;
        const head = line.unit !== unit;
        unit = line.unit;
        return (
          <div key={line.slots.join()} className={`aw-field__line${head ? " is-first" : ""}`}>
            {head && <span className="aw-field__unit">{m.units[line.unit]}</span>}
            {men.map((p) => {
              const votes = "selectors" in p ? p : null;
              return (
                <article
                  key={`${p.team}-${p.name}-${p.slot}`}
                  className={`aw-man${p.team === mine ? " is-mine" : ""}`}
                  title={`${p.name} · ${who(p)} · ${p.line}`}
                >
                  <span className="aw-man__slot">{m.slots[p.slot] ?? p.slot}</span>
                  {face(p)}
                  <b className="aw-man__name">
                    <PlayerLink team={p.team} name={p.name} position={p.position} />
                  </b>
                  <span className="aw-man__team">
                    <Swatch team={teams.get(p.team)} size={12} />
                    {teams.get(p.team)?.abbreviation ?? p.team_name}
                  </span>
                  {votes && (
                    <span className={`aw-man__votes${votes.unanimous ? " is-all" : ""}`}>
                      {votes.unanimous && <Star size={10} weight="fill" aria-hidden="true" />}
                      {votes.unanimous ? m.unanimous : m.selectors(votes.selectors)}
                    </span>
                  )}
                </article>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** Whose team to show, and which of its teams (first, second…). */
function TeamPicker({
  selectors,
  levels,
  value,
  level,
  consensus,
  onChange,
}: {
  selectors: string[];
  levels: number;
  value: string;
  level: number;
  consensus?: boolean;
  onChange: (selector: string, level: number) => void;
}) {
  const leveled = value !== CONSENSUS && levels > 1;
  return (
    <div className="aw-pick">
      <div className="aw__chips" role="group" aria-label={m.selectorLabel}>
        {consensus && (
          <Tooltip title={m.consensus} text={m.consensusTip}>
            <Chip on={value === CONSENSUS} onClick={() => onChange(CONSENSUS, 1)}>
              {m.consensus}
            </Chip>
          </Tooltip>
        )}
        {selectors.map((s) => (
          <Chip key={s} on={value === s} onClick={() => onChange(s, level)}>
            {s}
          </Chip>
        ))}
      </div>
      {leveled && (
        <div className="aw__chips" role="group" aria-label={m.levelLabel}>
          {Array.from({ length: levels }, (_, i) => (
            <Chip key={i} on={level === i + 1} onClick={() => onChange(value, i + 1)}>
              {m.level(i + 1)}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

const CONSENSUS = "consensus";

/** The All-America teams: the consensus team (first team on three of the five lists), or any one selector's teams. */
export function AllAmericaTeams({ aa, ...shared }: Shared & { aa: AllAmerica | null | undefined }) {
  const [selector, setSelector] = useState(CONSENSUS);
  const [level, setLevel] = useState(1);
  if (!aa) return <Waiting title={m.aaWaiting} text={m.aaWaitingText} />;
  const names = Object.keys(aa.selectors);
  const picks = selector === CONSENSUS ? aa.consensus : (aa.selectors[selector] ?? []).filter((p) => p.level === level);
  const yours = aa.consensus.filter((p) => p.team === shared.mine).length;
  return (
    <div className="aw-teams">
      <div className="aw-teams__head">
        <TeamPicker
          selectors={names}
          levels={2}
          value={selector}
          level={level}
          consensus
          onChange={(s, l) => {
            setSelector(s);
            setLevel(l);
          }}
        />
        <span className="aw-teams__count">
          {selector === CONSENSUS
            ? m.consensusCount(aa.consensus.length, aa.unanimous.length, yours)
            : m.teamCount(picks.length)}
        </span>
      </div>
      <HonorField picks={picks} {...shared} />
    </div>
  );
}

/** One conference at a time: its awards as cards, then its all-conference teams on the field. */
export function Conferences({
  all,
  start,
  award,
  coach,
  ...shared
}: Shared & {
  all: Record<string, ConferenceAwards>;
  /** the conference shown first (yours) */
  start: string;
  award: (a: PlayerAward) => ReactNode;
  coach: (a: CoachAward) => ReactNode;
}) {
  const names = Object.keys(all).sort((a, b) => (a === start ? -1 : b === start ? 1 : a.localeCompare(b)));
  const [conf, setConf] = useState(names.includes(start) ? start : (names[0] ?? ""));
  const [selector, setSelector] = useState<string | null>(null);
  const [level, setLevel] = useState(1);
  const entry = all[conf];
  if (!entry) return <Waiting title={m.confWaiting} text={m.confWaitingText} />;
  const lists = entry.teams?.selectors ?? {};
  const selectors = Object.keys(lists);
  const sel = selector && selectors.includes(selector) ? selector : (selectors[0] ?? "");
  const picks = (lists[sel] ?? []).filter((p) => p.level === level);
  return (
    <div className="aw-teams">
      <div className="aw-teams__head">
        <Dropdown
          label={m.conference}
          value={conf}
          size="md"
          options={names.map((n) => ({ value: n, label: n, hint: n === start ? m.yourConference : undefined }))}
          onChange={(v) => {
            setConf(v);
            setLevel(1);
          }}
        />
      </div>
      <div className="aw__cards">
        {entry.awards.map((a) =>
          a.kind === "coach" ? (
            <div key={a.name}>{coach(a as unknown as CoachAward)}</div>
          ) : (
            <div key={a.name}>{award(a as PlayerAward)}</div>
          ),
        )}
      </div>
      <h2 className="label aw__kicker">{m.allConference(conf)}</h2>
      {selectors.length ? (
        <>
          <TeamPicker
            selectors={selectors}
            levels={entry.teams?.levels ?? 1}
            value={sel}
            level={level}
            onChange={(s, l) => {
              setSelector(s);
              setLevel(l);
            }}
          />
          <HonorField picks={picks} {...shared} />
        </>
      ) : (
        <p className="aw__empty">{shared.live ? m.allConferenceWaiting : m.noTeam}</p>
      )}
    </div>
  );
}

function Waiting({ title, text }: { title: string; text: string }) {
  return (
    <div className="aw-waiting">
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
