import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Minus, Star } from "@phosphor-icons/react";
import DataTable, { type Column } from "../DataTable/index.tsx";
import Dropdown from "../Dropdown/index.tsx";
import Panel from "../Panel/index.tsx";
import SectionTabs, { SectionPane, SectionStatus } from "../SectionTabs/index.tsx";
import Swatch from "../Swatch/index.tsx";
import { api } from "../../api.ts";
import type { PollEntry, SeasonSummary, TeamCard, WeekPolls } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  season: SeasonSummary;
  teams: Map<string, TeamCard>;
  /** open the Bracket (the committee's ranking is what it is built from) */
  onBracket: () => void;
  /** open a played game's box score */
  onBox?: (eventId: string) => void;
  /** open a team's resume */
  onTeam?: (slug: string) => void;
}

type Tab = "ap" | "coaches" | "cfp";
const OTHERS: Record<Tab, keyof WeekPolls | null> = { ap: "ap_others", coaches: "coaches_others", cfp: null };

/** A game on a week's slate (GET /week/{n} → games[]). */
interface SlateGame {
  event_id?: string | null;
  has_box?: boolean;
  week: number;
  home: string;
  away: string;
  home_name: string;
  away_name: string;
  home_rank: number | null;
  away_rank: number | null;
  neutral: boolean;
  played: boolean;
  home_score: number | null;
  away_score: number | null;
}
/** One team's side of a game: the opponent, where, and the score once played. */
function gameFor(team: string, g: SlateGame | undefined) {
  if (!g) return null;
  const home = g.home === team;
  const rank = home ? g.away_rank : g.home_rank;
  const foe = `${g.neutral ? m.vs : home ? m.vs : m.at} ${rank ? `#${rank} ` : ""}${home ? g.away_name : g.home_name}`;
  const box = g.played && g.has_box !== false ? (g.event_id ?? null) : null;
  if (!g.played || g.home_score == null || g.away_score == null) return { foe, won: null, score: "", box };
  const pf = home ? g.home_score : g.away_score;
  const pa = home ? g.away_score : g.home_score;
  return { foe, won: pf > pa, score: `${pf}–${pa}`, box };
}

/**
 * Rankings: the AP Top 25, the Coaches Poll and the committee's CFP ranking, any week of the season (the preseason
 * poll is Week 0's). Each team with where it was last week, its record and conference, and its points and first-place
 * votes, its last result and its next game; under the table, the way the AP prints it, the others receiving votes and
 * the teams that dropped out. The committee ranks from Week 10: until
 * then its tab says so, and the Bracket shows where the field would stand from the AP poll.
 */
export default function Rankings({ season, teams, onBracket, onBox, onTeam }: Props) {
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
  // the first poll has nothing before it, so it shows no moves
  const first = rows.length > 0 && rows.every((r) => r.previous == null);
  const before = at != null ? weeks.filter((w) => w < at)[0] : undefined;
  const dropped =
    before != null ? (polls[String(before)]?.[tab] ?? []).filter((p) => !rows.some((r) => r.team === p.team)) : [];

  // the slates around the poll: a poll comes out after its week's games, so the last result is that week's (or the
  // one before, after an open date) and the next game is the week after's
  const [slates, setSlates] = useState<Record<number, SlateGame[]>>({});
  useEffect(() => {
    if (at == null) return;
    let live = true;
    for (const w of [at - 1, at, at + 1, at + 2])
      if (w >= 1)
        api<{ games: SlateGame[] }>(`/api/season/${season.id}/week/${w}`)
          .then((v) => live && setSlates((s) => ({ ...s, [w]: v.games })))
          .catch(() => {});
    return () => {
      live = false;
    };
  }, [at, season.id, season.current_week]);
  const find = (team: string, ws: number[]) => {
    for (const w of ws) {
      const g = slates[w]?.find((x) => x.home === team || x.away === team);
      if (g) return g;
    }
    return undefined;
  };
  const last = (team: string) => {
    const g = at != null ? find(team, [at, at - 1]) : undefined;
    return g?.played ? gameFor(team, g) : null;
  };
  const next = (team: string) => {
    const g = at != null ? find(team, [at + 1, at + 2]) : undefined;
    return g && g.week > (at ?? 0) ? gameFor(team, g) : null;
  };

  const columns: Column<PollEntry>[] = [
    { key: "rank", label: m.rank, num: true, render: (r) => <b>{r.rank}</b>, sort: (r) => -r.rank },
    ...(first ? [] : [{ key: "move", label: m.move, tip: m.moveTip, render: (r: PollEntry) => <Move r={r} /> }]),
    {
      key: "team",
      label: m.team,
      render: (r) => (
        <span className="rankings__team">
          <Swatch team={teams.get(r.team)} size={16} />
          {onTeam ? (
            <button type="button" className="rankings__box" title={m.openResume(r.name)} onClick={() => onTeam(r.team)}>
              {r.name}
            </button>
          ) : (
            r.name
          )}
        </span>
      ),
      sort: (r) => r.name,
    },
    { key: "record", label: m.record, render: (r) => r.record },
    { key: "conf", label: m.conference, render: (r) => r.conference, sort: (r) => r.conference },
    {
      // before anyone has played there is no result to show: the column appears with the first games
      key: "last",
      label: m.last,
      render: (r) => {
        const g = last(r.team);
        if (g && g.box && onBox) {
          const id = g.box;
          return (
            <button type="button" className="rankings__game rankings__box" title={m.boxScore} onClick={() => onBox(id)}>
              <b>{g.won ? m.win : m.loss}</b> {g.score} <span className="rankings__soft">{g.foe}</span>
            </button>
          );
        }
        return g ? (
          <span className="rankings__game">
            <b>{g.won ? m.win : m.loss}</b> {g.score} <span className="rankings__soft">{g.foe}</span>
          </span>
        ) : (
          ""
        );
      },
    },
    {
      key: "next",
      label: m.next,
      render: (r) => {
        const g = next(r.team);
        if (!g) return "";
        // a later week you are looking back at: the game has been played since
        return (
          <span className="rankings__game">
            {g.foe}
            {g.won != null && (
              <span className="rankings__soft">
                {" "}
                · {g.won ? m.win : m.loss} {g.score}
              </span>
            )}
          </span>
        );
      },
    },
  ];
  if (!rows.some((r) => last(r.team)))
    columns.splice(
      columns.findIndex((c) => c.key === "last"),
      1,
    );
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
            <>
              <Panel title={m.tabs[tab]} aside={at != null ? weekName(at) : undefined} className="rankings__panel">
                <DataTable
                  label={m.tabs[tab]}
                  columns={columns}
                  rows={rows}
                  rowKey={(r) => r.team}
                  mine={(r) => r.team === season.team}
                />
              </Panel>
              {others.length > 0 && (
                <p className="rankings__line">
                  <b>{m.others}:</b>{" "}
                  {others.map((r, i) => (
                    <span key={r.team} className={r.team === season.team ? "is-mine" : undefined}>
                      {r.name} {r.points ?? 0}
                      {i < others.length - 1 ? ", " : "."}
                    </span>
                  ))}
                </p>
              )}
              {dropped.length > 0 && (
                <p className="rankings__line">
                  <b>{m.dropped}:</b> {dropped.map((r) => `${r.name} (${r.rank})`).join(", ")}.
                </p>
              )}
            </>
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
