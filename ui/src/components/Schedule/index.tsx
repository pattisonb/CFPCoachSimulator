import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react";
import Chip from "../Chip/index.tsx";
import Dropdown from "../Dropdown/index.tsx";
import Matchup, { type MatchupSide } from "../Matchup/index.tsx";
import Swatch from "../Swatch/index.tsx";
import { api } from "../../api.ts";
import { dateText, kickoffText, timeText } from "../../format.ts";
import type {
  BoxScore,
  BoxSide,
  GamePreview,
  ScheduleGame,
  SeasonSummary,
  TeamCard,
  TeamScheduleView,
} from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  season: SeasonSummary;
  teams: Map<string, TeamCard>;
  /** open a played game's full box score */
  onBox?: (eventId: string) => void;
}

type Phase = "all" | "regular" | "post";
const PHASES: Phase[] = ["all", "regular", "post"];

/** *tune* The last regular-season week (sim/season.py LAST_REGULAR_WEEK): later games are the postseason. */
const LAST_REGULAR_WEEK = 14;

const keyOf = (g: ScheduleGame) => `${g.week}-${g.event_id ?? g.kind}`;
const isGame = (g: ScheduleGame) => g.kind !== "bye";
const inPhase = (g: ScheduleGame, p: Phase) =>
  p === "all" || (p === "regular" ? g.week <= LAST_REGULAR_WEEK : g.week > LAST_REGULAR_WEEK);
const winPct = (p: number) => Math.min(99, Math.max(1, Math.round(100 * p)));

/** A side of the matchup (the banner's), with its slug for the line score. */
interface SideInfo extends MatchupSide {
  slug: string | null;
}

/**
 * Schedule: a team's season. Up top, the picked game as a matchup banner in both teams' colors, with what there is to
 * know about it: the final and its line score, this week's Win Chance, or the rivalry and how far off it is. Below,
 * every week as a list; pick a row (or move with the arrow keys) to put it up top. Any FBS opponent's own season is
 * one click away, and Back returns to yours.
 */
export default function Schedule({ season, teams, onBox }: Props) {
  const [view, setView] = useState(season.team);
  const [other, setOther] = useState<{ key: string; data: TeamScheduleView } | { key: string; error: string } | null>(
    null,
  );
  const [phase, setPhase] = useState<Phase>("all");
  // the row picked by hand; null follows the next game (or the last one played)
  const [picked, setPicked] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ key: string; data: GamePreview } | null>(null);
  const [box, setBox] = useState<{ id: string; data: BoxScore | null } | null>(null);
  const boxes = useRef(new Map<string, BoxScore | null>());
  const list = useRef<HTMLOListElement>(null);

  const mine = view === season.team;
  const week = season.current_week;
  const otherKey = `${view}-${week}`;

  // another team's season: fetched once per week it's viewed
  useEffect(() => {
    if (mine || other?.key === otherKey) return;
    let live = true;
    api<TeamScheduleView>(`/api/season/${season.id}/schedule/${view}`)
      .then((data) => live && setOther({ key: otherKey, data }))
      .catch((e: Error) => live && setOther({ key: otherKey, error: e.message }));
    return () => {
      live = false;
    };
  }, [mine, otherKey]);

  // a new week (or another team) starts from its next game again
  useEffect(() => setPicked(null), [week, view]);

  const shown = mine ? null : other?.key === otherKey ? other : null;
  const games = mine ? season.schedule : shown && "data" in shown ? shown.data.schedule : [];
  const viewName = mine
    ? season.team_name
    : shown && "data" in shown
      ? shown.data.team_name
      : (teams.get(view)?.name ?? "");
  const viewRecord = mine ? season.record : shown && "data" in shown ? shown.data.record : null;
  const viewRank = mine ? (season.my_rank?.rank ?? null) : shown && "data" in shown ? shown.data.rank : null;

  const next = games.find((g) => isGame(g) && !g.played) ?? null;
  const fallback = next ?? [...games].reverse().find((g) => isGame(g) && g.played) ?? null;
  const current = games.find((g) => keyOf(g) === picked) ?? fallback;
  const rows = useMemo(() => games.filter((g) => inPhase(g, phase)), [games, phase]);
  const counts = useMemo(
    () => Object.fromEntries(PHASES.map((p) => [p, games.filter((g) => isGame(g) && inPhase(g, p)).length])),
    [games],
  );

  // this week's game: its prediction; a played one: its box score
  const thisWeek = current && !current.played && current.week === week + 1 ? current : null;
  const previewKey = `${view}-${week}`;
  useEffect(() => {
    if (!thisWeek || preview?.key === previewKey) return;
    let live = true;
    api<GamePreview>(`/api/season/${season.id}/preview?team=${view}`)
      .then((data) => live && setPreview({ key: previewKey, data }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [thisWeek?.event_id, previewKey]);

  const boxId = current?.played && current.event_id && current.has_box !== false ? current.event_id : null;
  useEffect(() => {
    if (!boxId) return;
    if (boxes.current.has(boxId)) return setBox({ id: boxId, data: boxes.current.get(boxId) ?? null });
    let live = true;
    api<BoxScore>(`/api/season/${season.id}/game/${boxId}`)
      .then((data) => {
        boxes.current.set(boxId, data);
        if (live) setBox({ id: boxId, data });
      })
      .catch(() => {
        boxes.current.set(boxId, null);
        if (live) setBox({ id: boxId, data: null });
      });
    return () => {
      live = false;
    };
  }, [boxId]);

  // the picked row in view
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(".sched-row.is-picked");
    el?.scrollIntoView({ block: "nearest" });
  }, [current && keyOf(current), phase]);

  // up and down move the pick through the games (byes are skipped)
  const onKey = (e: KeyboardEvent<HTMLOListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const pickable = rows.filter(isGame);
    const at = current ? pickable.findIndex((g) => keyOf(g) === keyOf(current)) : -1;
    const to = pickable[Math.min(pickable.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))];
    if (!to) return;
    e.preventDefault();
    setPicked(keyOf(to));
    list.current?.querySelector<HTMLElement>(`[data-key="${keyOf(to)}"]`)?.focus();
  };

  // every FBS team, yours first, for the picker in the header
  const teamOptions = useMemo(
    () => [
      { value: season.team, label: season.team_name, hint: m.yourTeam },
      ...[...teams.values()]
        .filter((t) => !t.fictional && t.subdivision === "FBS" && t.slug !== season.team)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => ({ value: t.slug, label: t.name, hint: t.conference })),
    ],
    [teams, season.team, season.team_name],
  );

  const weekName = (g: ScheduleGame) => g.title ?? season.week_labels[g.week] ?? m.week(g.week);
  const loading = !mine && !shown;
  const error = shown && "error" in shown ? shown.error : null;

  const left: SideInfo | null = current && {
    slug: view,
    team: teams.get(view),
    name: viewName,
    rank: current.played ? (current.my_rank ?? null) : viewRank,
    record: viewRecord ? m.record(viewRecord.wins, viewRecord.losses) : "",
    mine,
  };
  const oppTeam = current?.opponent ? teams.get(current.opponent) : undefined;
  const right: SideInfo | null = current && {
    slug: current.opponent,
    team: oppTeam,
    name: current.opponent_name,
    rank: current.opponent_rank,
    record: current.opponent_record ?? "",
    mine: current.opponent === season.team,
  };
  const canView = !!oppTeam && !oppTeam.fictional && oppTeam.subdivision === "FBS";

  return (
    <div className="sched">
      <header className="sched-bar">
        <h1 className="sched-bar__title">{m.title}</h1>
        {!mine && (
          <button type="button" className="sched-bar__back" onClick={() => setView(season.team)}>
            <ArrowLeft size={16} weight="bold" aria-hidden="true" />
            {m.backTo(season.team_name)}
          </button>
        )}
        <span className="sched-bar__team">
          <Swatch team={teams.get(view)} size={18} />
          {/* whose schedule: yours, or any FBS team's */}
          <Dropdown label={m.teamLabel} hideLabel size="md" value={view} options={teamOptions} onChange={setView} />
          {viewRecord && (
            <span className="sched-bar__soft">
              {m.record(viewRecord.wins, viewRecord.losses)} ·{" "}
              {m.confRecord(viewRecord.conf_wins, viewRecord.conf_losses)}
            </span>
          )}
        </span>
        <div className="sched-bar__phases" role="group" aria-label={m.phaseLabel}>
          {PHASES.map((p) => (
            <Chip key={p} on={phase === p} count={counts[p]} onClick={() => setPhase(p)}>
              {m.phases[p]}
            </Chip>
          ))}
        </div>
      </header>

      <div className="sched__body">
        {current && left && right ? (
          <Banner
            key={keyOf(current)}
            g={current}
            left={left}
            right={right}
            when={[weekName(current), kickoffText(current.date)].filter(Boolean).join(" · ")}
            thisWeek={!!thisWeek}
            weeksAway={!current.played ? current.week - (week + 1) : 0}
            preview={thisWeek && preview?.key === previewKey ? preview.data : null}
            box={box?.id === boxId ? box.data : undefined}
            onBox={boxId && onBox ? () => onBox(boxId) : undefined}
            onView={canView ? () => setView(current.opponent!) : undefined}
          />
        ) : (
          <div className="sched-banner sched-banner--empty" aria-hidden="true" />
        )}

        <div className="sched-table">
          <div className="sched-head" aria-hidden="true">
            <span>{m.columns.week}</span>
            <span>{m.columns.date}</span>
            <span className="sched-col--kickoff">{m.columns.kickoff}</span>
            <span>{m.columns.opponent}</span>
            <span>{m.columns.result}</span>
            <span className="sched-col--notes">{m.columns.notes}</span>
          </div>
          {loading || error ? (
            <p className="sched__note" role="status">
              {error ? m.loadError(error) : m.loading}
            </p>
          ) : rows.length === 0 ? (
            <div className="sched__note">
              <b>{m.noGames}</b>
              <span>{m.noGamesText}</span>
            </div>
          ) : (
            <ol className="sched-list" ref={list} aria-label={m.listLabel(viewName)} onKeyDown={onKey}>
              {rows.map((g) => (
                <Row
                  key={keyOf(g)}
                  g={g}
                  name={weekName(g)}
                  team={g.opponent ? teams.get(g.opponent) : undefined}
                  isNext={g === next}
                  picked={!!current && keyOf(g) === keyOf(current)}
                  onPick={() => setPicked(keyOf(g))}
                />
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

/** One week in the list: a bye as a quiet line, a game as a row you can pick. */
function Row({
  g,
  name,
  team,
  isNext,
  picked,
  onPick,
}: {
  g: ScheduleGame;
  name: string;
  team: TeamCard | undefined;
  isNext: boolean;
  picked: boolean;
  onPick: () => void;
}) {
  if (!isGame(g))
    return (
      <li className="sched-row sched-row--bye">
        <span className="sched-row__week">{name}</span>
        <span />
        <span className="sched-col--kickoff" />
        <span className="sched-row__bye">{m.bye}</span>
      </li>
    );
  const note = [g.rivalry?.name, g.site].filter(Boolean).join(" · ");
  return (
    <li>
      <button
        type="button"
        className={["sched-row", picked && "is-picked", isNext && "is-next", g.played && "is-played"]
          .filter(Boolean)
          .join(" ")}
        data-key={keyOf(g)}
        aria-current={picked ? "true" : undefined}
        tabIndex={picked ? 0 : -1}
        onClick={onPick}
      >
        <span className="sched-row__week">
          {name}
          {isNext && <span className="sched-row__tag">{m.next}</span>}
        </span>
        <span>{dateText(g.date) || m.tba}</span>
        <span className="sched-col--kickoff">{timeText(g.date) || m.tba}</span>
        <span className="sched-row__opp">
          <span className="sched-row__venue">{g.venue === "away" ? m.at : m.vs}</span>
          <Swatch team={team} size={16} />
          {g.opponent_rank && <span className="sched-row__rank">{m.rank(g.opponent_rank)}</span>}
          <span className="sched-row__name">{g.opponent_name}</span>
          {g.opponent_record && <span className="sched-row__rec">{g.opponent_record}</span>}
        </span>
        <span>
          {g.played && g.won !== null ? (
            <span className={`sched-row__result ${g.won ? "is-won" : "is-lost"}`}>
              {m.result(g.won, g.points_for ?? 0, g.points_against ?? 0, g.overtime)}
            </span>
          ) : (
            ""
          )}
        </span>
        <span className="sched-col--notes sched-row__note">{note}</span>
      </button>
    </li>
  );
}

/** The picked game up top: both teams in their colors, the score or vs between them, and what to know below. */
function Banner({
  g,
  left,
  right,
  when,
  thisWeek,
  weeksAway,
  preview,
  box,
  onBox,
  onView,
}: {
  g: ScheduleGame;
  left: SideInfo;
  right: SideInfo;
  when: string;
  thisWeek: boolean;
  weeksAway: number;
  preview: GamePreview | null;
  /** undefined while it loads; null when there's none */
  box: BoxScore | null | undefined;
  onBox?: () => void;
  onView?: () => void;
}) {
  const played = g.played && g.won !== null;
  const venue = g.venue === "away" ? m.away : g.venue === "neutral" ? m.neutral : m.home;
  const kicker = played ? (g.overtime ? m.finalOt(g.overtime) : m.final) : thisWeek ? m.thisWeek : m.upcoming;
  // a titled game (a bowl, a championship) has its name in the line above already: only a rivalry's name is added
  const named = g.rivalry?.name && g.rivalry.name !== g.title ? g.rivalry.name : null;
  const where = g.site ? `${venue} · ${g.site}` : venue;
  return (
    <section className="sched-banner" aria-label={m.matchupLabel}>
      <Matchup
        left={left}
        right={{
          ...right,
          action: onView && (
            <button type="button" className="matchup__view" title={m.theirScheduleTip(right.name)} onClick={onView}>
              {m.theirSchedule}
              <ArrowRight size={14} weight="bold" aria-hidden="true" />
            </button>
          ),
        }}
        result={played ? (g.won ? "won" : "lost") : null}
        mid={
          played ? (
            <>
              <b className="matchup__score">
                {g.points_for}
                <i>–</i>
                {g.points_against}
              </b>
              <span className="label">{g.won ? m.won : m.lost}</span>
            </>
          ) : (
            <b className="matchup__vs">{g.venue === "away" ? m.at : m.vs}</b>
          )
        }
      />
      <div className="sched-banner__info">
        <div className="sched-banner__when">
          <span className="label sched-banner__kicker">{kicker}</span>
          <b title={when}>{when}</b>
          {named && <span className="sched-banner__named">{named}</span>}
          <span className="sched-banner__chip" title={where}>
            {where}
          </span>
        </div>
        <Detail
          g={g}
          left={left}
          right={right}
          thisWeek={thisWeek}
          weeksAway={weeksAway}
          preview={preview}
          box={box}
          onBox={onBox}
        />
      </div>
    </section>
  );
}

/** Under the banner: the line score of a final, this week's Win Chance, or the rivalry and the wait. */
function Detail({
  g,
  left,
  right,
  thisWeek,
  weeksAway,
  preview,
  box,
  onBox,
}: {
  g: ScheduleGame;
  left: SideInfo;
  right: SideInfo;
  thisWeek: boolean;
  weeksAway: number;
  preview: GamePreview | null;
  box: BoxScore | null | undefined;
  onBox?: () => void;
}) {
  const rivalry = g.rivalry && (g.rivalry.headline || g.rivalry.series) && (
    <div className="sched-detail__cell">
      <span className="label sched-banner__kicker">{m.series}</span>
      <span>{g.rivalry.headline ? `${g.rivalry.headline}.` : g.rivalry.series}</span>
    </div>
  );

  if (g.played) {
    if (box === undefined) return <div className="sched-detail" />;
    if (box === null)
      return (
        <div className="sched-detail">
          <p className="sched-banner__soft">{m.noBox}</p>
          {rivalry}
        </div>
      );
    // the viewed team first, as the banner has it
    const leftHome = box.home_slug === left.slug;
    const [a, b] = leftHome ? [box.home, box.away] : [box.away, box.home];
    return (
      <div className="sched-detail">
        <LineScore rows={[a, b]} teams={[left.team, right.team]} />
        <Stats a={a} b={b} />
        {onBox && (
          <button type="button" className="sched-detail__box" onClick={onBox}>
            {m.boxScore}
            <ArrowRight size={14} weight="bold" aria-hidden="true" />
          </button>
        )}
        {rivalry}
      </div>
    );
  }

  if (thisWeek) {
    const p = preview?.prediction;
    const mine = p ? winPct(p.win_prob) : null;
    return (
      <div className="sched-detail">
        <div className="sched-detail__cell sched-detail__odds">
          <span className="label sched-banner__kicker">{m.winChance}</span>
          {mine !== null && p ? (
            <div
              className="sched-detail__odds-row"
              role="img"
              aria-label={m.odds(left.name, mine, right.name, 100 - mine)}
            >
              <b className="sched-detail__big">{mine}%</b>
              <span className="sched-detail__bar" aria-hidden="true">
                <i style={{ width: `${mine}%` }} />
              </span>
              <span className="sched-banner__soft">
                {m.projected(Math.round(p.points_for), Math.round(p.points_against))}
              </span>
            </div>
          ) : (
            <span className="sched-banner__soft">{m.scouting}</span>
          )}
        </div>
        {rivalry}
      </div>
    );
  }

  return (
    <div className="sched-detail">
      <p className="sched-banner__soft">{m.weeksAway(Math.max(1, weeksAway))}</p>
      {rivalry}
    </div>
  );
}

function LineScore({ rows, teams }: { rows: [BoxSide, BoxSide]; teams: [TeamCard | undefined, TeamCard | undefined] }) {
  const ots = Math.max(rows[0].overtime.length, rows[1].overtime.length);
  return (
    <table className="sched-line">
      <caption className="label sched-banner__kicker">{m.lineScore}</caption>
      <thead>
        <tr>
          <th scope="col">
            <span className="sched-line__hidden">{m.team}</span>
          </th>
          {rows[0].quarters.map((_, i) => (
            <th key={i} scope="col">
              {m.quarter(i + 1)}
            </th>
          ))}
          {ots > 0 && <th scope="col">{m.ot}</th>}
          <th scope="col">{m.total}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={r.score > rows[1 - i].score ? "is-won" : undefined}>
            <th scope="row">
              <Swatch team={teams[i]} size={12} />
              {teams[i]?.abbreviation ?? r.name}
            </th>
            {r.quarters.map((q, j) => (
              <td key={j}>{q}</td>
            ))}
            {ots > 0 && <td>{r.overtime.reduce((x, y) => x + y, 0)}</td>}
            <td className="sched-line__total">{r.score}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A few team stats side by side: yours, the stat, theirs; the better number bold. */
function Stats({ a, b }: { a: BoxSide; b: BoxSide }) {
  const n = (s: BoxSide, k: string) => s.team_stats[k] ?? 0;
  const turnovers = (s: BoxSide, o: BoxSide) => n(s, "Interceptions Thrown") + n(o, "Fumble Recoveries");
  const lines: [string, number, number, boolean][] = [
    [m.totalYards, n(a, "Pass Yards") + n(a, "Rush Yards"), n(b, "Pass Yards") + n(b, "Rush Yards"), true],
    [m.passYards, n(a, "Pass Yards"), n(b, "Pass Yards"), true],
    [m.rushYards, n(a, "Rush Yards"), n(b, "Rush Yards"), true],
    [m.turnovers, turnovers(a, b), turnovers(b, a), false],
  ];
  return (
    <dl className="sched-stats" aria-label={m.stats}>
      {lines.map(([label, x, y, more]) => (
        <div key={label} className="sched-stats__row">
          <dd className={(more ? x > y : x < y) ? "is-best" : undefined}>{x}</dd>
          <dt className="label">{label}</dt>
          <dd className={(more ? y > x : y < x) ? "is-best" : undefined}>{y}</dd>
        </div>
      ))}
    </dl>
  );
}
