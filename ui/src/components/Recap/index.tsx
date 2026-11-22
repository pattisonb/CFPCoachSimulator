import { useEffect, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowUp, Trophy } from "@phosphor-icons/react";
import Chip from "../Chip/index.tsx";
import Panel, { PanelRow, PanelRows } from "../Panel/index.tsx";
import SectionTabs, { SectionStatus } from "../SectionTabs/index.tsx";
import Swatch from "../Swatch/index.tsx";
import { api } from "../../api.ts";
import { inkOn } from "../../colors.ts";
import type { PollEntry, SeasonSummary, TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import PlayerLink from "../PlayerLink/index.tsx";
import "./index.css";

interface Props {
  season: SeasonSummary;
  teams: Map<string, TeamCard>;
  /** open the Bracket (the champion's banner links to it: the playoff's rounds are told there) */
  onBracket?: () => void;
  /** a panel's name opens the page that tells it in full: your schedule, the stats (yours, or everyone's), the
   * rankings, the standings */
  onOpen?: (to: "schedule" | "stats-mine" | "stats" | "rankings" | "standings") => void;
}

/** One of your games, as the review tells it. */
interface GameLine {
  week: number;
  title: string | null;
  opponent: string;
  opponent_name: string;
  opponent_rank: number | null;
  venue: string;
  won: boolean;
  points_for: number;
  points_against: number;
  overtime: number;
}
interface Leader {
  name: string;
  position: string;
  team?: string;
  team_name?: string;
  games: number;
  stats: Record<string, number>;
}
interface Result {
  home: string;
  away: string;
  home_name: string;
  away_name: string;
  home_score: number | null;
  away_score: number | null;
  played: boolean;
  winner: string | null;
  bowl?: string | null;
  title?: string | null;
}
/** A team that beat, or fell short of, what was expected of it. */
interface Swing {
  team: string;
  name: string;
  final_rank: number | null;
  record?: string;
}

/** GET /api/season/{id}/review (sim/season.py season_review): the season so far, or the whole of it once it ends. */
interface Review {
  done: boolean;
  current_week: number;
  year: number;
  grade: { grade: string; line: string; goal?: string; met?: boolean } | null;
  national_leaders: Record<string, Leader | null>;
  surprises: Swing[];
  disappointments: Swing[];
  champion: string | null;
  champion_name: string | null;
  title_game: Result | null;
  rounds: { round: string; week: number; games: Result[] }[];
  champions: { conference: string; team: string; name: string }[];
  final_ap: PollEntry[];
  final_cfp: PollEntry[];
  mine: {
    wins: number;
    losses: number;
    conf_wins: number;
    conf_losses: number;
    conf_rank: number | null;
    conf_champion: boolean;
    final_ap: number | null;
    final_cfp: number | null;
    finish: string | null;
    points_per_game: number;
    allowed_per_game: number;
    best_win: GameLine | null;
    worst_loss: GameLine | null;
    biggest_win: GameLine | null;
    closest_loss: GameLine | null;
    longest_streak: number;
    postseason: GameLine[];
    leaders: Record<string, Leader | number | null>;
    non_conf_wins: number;
    non_conf_losses: number;
  };
}

/** Your leaders, in the order shown: the review's key and the stat that names him. */
const MY_LEADERS: [string, (s: Record<string, number>) => string][] = [
  ["passer", (s) => m.lines.passer(s.pass_yards ?? 0, s.passing_touchdowns ?? 0, s.interceptions_thrown ?? 0)],
  ["rusher", (s) => m.lines.rusher(s.rush_yards ?? 0, s.rushing_touchdowns ?? 0)],
  ["receiver", (s) => m.lines.receiver(s.receptions ?? 0, s.receiving_yards ?? 0, s.receiving_touchdowns ?? 0)],
  ["tackler", (s) => m.lines.tackler((s.solo_tackles ?? 0) + (s.assisted_tackles ?? 0), s.tackles_for_loss ?? 0)],
  ["sacks", (s) => m.lines.sacks(s.sacks ?? 0)],
  ["interceptions", (s) => m.lines.interceptions(s.interceptions ?? 0)],
  ["kicker", (s) => m.lines.kicker(s.fg_made ?? 0, s.fg_attempted ?? 0)],
];
const NATIONAL: [string, (s: Record<string, number>) => string][] = [
  ["passing", (s) => m.lines.yards(s.pass_yards ?? 0)],
  ["rushing", (s) => m.lines.yards(s.rush_yards ?? 0)],
  ["receiving", (s) => m.lines.yards(s.receiving_yards ?? 0)],
  ["tackles", (s) => m.lines.count((s.solo_tackles ?? 0) + (s.assisted_tackles ?? 0))],
  ["sacks", (s) => m.lines.count(s.sacks ?? 0)],
  ["interceptions", (s) => m.lines.count(s.interceptions ?? 0)],
  ["kicking", (s) => m.lines.kicker(s.fg_made ?? 0, s.fg_attempted ?? 0)],
];

/**
 * Season Recap: the season so far, and the whole of it once it ends. Your season (record, conference finish, points,
 * your best win and worst loss, your leaders, and the AD's grade at the end); then the country's: the champion and
 * the playoff's rounds, the conference champions, the top of the poll, the national leaders, and the teams that
 * surprised or disappointed.
 */
export default function Recap({ season, teams, onBracket, onOpen }: Props) {
  const go = (to: Parameters<NonNullable<Props["onOpen"]>>[0]) => (onOpen ? () => onOpen(to) : undefined);
  const [view, setView] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<Review>(`/api/season/${season.id}/review`)
      .then((v) => live && setView(v))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [season.id, season.current_week]);

  const weekName = season.week_labels[String(season.current_week)] ?? m.week(season.current_week);
  const status = view && <SectionStatus>{view.done ? m.final(view.year) : m.through(weekName)}</SectionStatus>;
  const team = (slug: string, name: string) => (
    <span className="recap__team">
      <Swatch team={teams.get(slug)} size={14} />
      {name}
    </span>
  );
  /** whose leaders the one Leaders card shows */
  const [whose, setWhose] = useState<"mine" | "all">("mine");
  const me = view?.mine;
  const played = !!me && me.wins + me.losses > 0;
  const poll = view?.final_cfp.length ? view.final_cfp : (view?.final_ap ?? []);
  const champ = view?.champion ? teams.get(view.champion) : undefined;
  const mineCard = teams.get(season.team);

  return (
    <div className="section-tabs__wrap">
      <SectionTabs title={m.title} value="all" onChange={() => {}} tabs={[]} aside={status} />
      <div className="recap">
        {!view || !me ? (
          <p className="recap__soft">{error ? m.loadError(error) : m.loading}</p>
        ) : (
          <>
            {/* the headline, two banners side by side and the same height: the champion in its colors (once there is
                one), and your season in yours with the AD's grade stamped on it */}
            <header className={`recap__heroes${champ ? "" : " is-solo"}`}>
              {champ && (
                <div
                  className="recap__hero recap__hero--champ"
                  style={{ "--c": champ.colors.primary, "--on": inkOn(champ.colors.primary) } as CSSProperties}
                >
                  <span className="recap__hero-mark" aria-hidden="true">
                    {champ.abbreviation}
                  </span>
                  <span className="recap__hero-kicker">
                    <Trophy size={16} weight="fill" aria-hidden="true" />
                    {m.champions(view.year)}
                  </span>
                  <h2>{view.champion_name}</h2>
                  {view.title_game && (
                    <p>
                      {m.titleLine(
                        Math.max(view.title_game.home_score ?? 0, view.title_game.away_score ?? 0),
                        Math.min(view.title_game.home_score ?? 0, view.title_game.away_score ?? 0),
                        view.title_game.winner === view.title_game.home
                          ? view.title_game.away_name
                          : view.title_game.home_name,
                      )}
                    </p>
                  )}
                  {/* the whole playoff is on the Bracket: a small bracket, drawn in the banner's own ink, opens it */}
                  {onBracket && (
                    <button type="button" className="recap__bracket" title={m.seeBracket} onClick={onBracket}>
                      <svg viewBox="0 0 44 32" width="44" height="32" aria-hidden="true">
                        {/* four teams, two games, one winner */}
                        <path d="M2 5h10M2 13h10M12 5v8M12 9h10M2 19h10M2 27h10M12 19v8M12 23h10M22 9v14M22 16h9" />
                        <rect x="31" y="11" width="11" height="10" />
                      </svg>
                      {m.bracket}
                    </button>
                  )}
                </div>
              )}
              <div
                className={`recap__hero recap__hero--you${go("schedule") ? " is-link" : ""}`}
                // your record opens your schedule (the player's ask), now that Your Games is not a card here
                role={go("schedule") ? "link" : undefined}
                tabIndex={go("schedule") ? 0 : undefined}
                title={go("schedule") ? m.seeSchedule : undefined}
                onClick={go("schedule")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") go("schedule")?.();
                }}
                style={
                  mineCard
                    ? ({ "--c": mineCard.colors.primary, "--on": inkOn(mineCard.colors.primary) } as CSSProperties)
                    : undefined
                }
              >
                <span className="recap__hero-mark" aria-hidden="true">
                  {mineCard?.abbreviation}
                </span>
                <span className="recap__hero-kicker">{season.team_name}</span>
                <h2>
                  {me.wins}-{me.losses}
                </h2>
                <p>{me.finish ?? (played ? m.soFar(weekName) : m.notStarted)}</p>
                {view.grade && (
                  <div className="recap__grade" title={view.grade.line}>
                    <span className="label">{m.grade}</span>
                    <b>{view.grade.grade}</b>
                  </div>
                )}
              </div>
            </header>
            {view.grade && <p className="recap__gradeline">{view.grade.line}</p>}

            {/* your season in numbers: a tile each, the number large */}
            {played && (
              <dl className="recap__nums">
                <div>
                  <dt className="label">{m.rows.conference}</dt>
                  <dd>
                    {me.conf_wins}-{me.conf_losses}
                  </dd>
                  <span className="recap__soft">
                    {me.conf_champion ? m.confChamp : me.conf_rank ? m.confPlace(me.conf_rank, season.conference) : ""}
                  </span>
                </div>
                <div>
                  <dt className="label">{m.rows.nonConf}</dt>
                  <dd>
                    {me.non_conf_wins}-{me.non_conf_losses}
                  </dd>
                </div>
                <div>
                  <dt className="label">{m.ppg}</dt>
                  <dd>{me.points_per_game}</dd>
                </div>
                <div>
                  <dt className="label">{m.allowed}</dt>
                  <dd>{me.allowed_per_game}</dd>
                </div>
                <div>
                  <dt className="label">{view.done ? m.finalRanking : m.rows.ranked}</dt>
                  <dd>{(me.final_cfp ?? me.final_ap) != null ? `#${me.final_cfp ?? me.final_ap}` : m.dash}</dd>
                  {(me.final_cfp ?? me.final_ap) == null && <span className="recap__soft">{m.unranked}</span>}
                </div>
                <div>
                  <dt className="label">{m.rows.streak}</dt>
                  <dd>{me.longest_streak}</dd>
                  <span className="recap__soft">{m.inARow}</span>
                </div>
              </dl>
            )}

            {/* one row of cards to the page's foot: the whole recap is one screen (the player's ask) */}
            <div className="recap__cards">
              <Panel
                title={m.leaders}
                onTitle={go(whose === "mine" ? "stats-mine" : "stats")}
                aside={
                  <span className="recap__pick" role="group" aria-label={m.leaders}>
                    {(["mine", "all"] as const).map((k) => (
                      <Chip key={k} on={whose === k} onClick={() => setWhose(k)}>
                        {m.whose[k]}
                      </Chip>
                    ))}
                  </span>
                }
              >
                {whose === "all" ? (
                  NATIONAL.some(([k]) => view.national_leaders[k]) ? (
                    <PanelRows>
                      {NATIONAL.map(([k, line]) => {
                        const p = view.national_leaders[k];
                        return p ? (
                          <PanelRow
                            key={k}
                            label={m.nationalNames[k]}
                            value={
                              <>
                                <PlayerLink team={p.team} name={p.name} />,{" "}
                                {(p.team ? teams.get(p.team)?.abbreviation : undefined) ?? p.team_name ?? ""} ·{" "}
                                {line(p.stats)}
                              </>
                            }
                          />
                        ) : null;
                      })}
                    </PanelRows>
                  ) : (
                    <p className="recap__soft">{m.noGames}</p>
                  )
                ) : MY_LEADERS.some(([k]) => me.leaders[k]) ? (
                  <PanelRows>
                    {MY_LEADERS.map(([k, line]) => {
                      const p = me.leaders[k];
                      if (!p || typeof p === "number") return null;
                      return (
                        <PanelRow
                          key={k}
                          label={m.leaderNames[k]}
                          value={
                            <>
                              <PlayerLink team={season.team} name={p.name} /> · {line(p.stats)}
                            </>
                          }
                        />
                      );
                    })}
                  </PanelRows>
                ) : (
                  <p className="recap__soft">{m.noGames}</p>
                )}
              </Panel>

              {view.champions.length > 0 && (
                <Panel title={m.confChampions} onTitle={go("standings")}>
                  <ul className="recap__list">
                    {view.champions.map((c) => (
                      <li key={c.conference} className={c.team === season.team ? "is-mine" : undefined}>
                        <span className="recap__soft recap__grow" title={c.conference}>
                          {m.confShort[c.conference] ?? c.conference}
                        </span>
                        <b>{team(c.team, c.name)}</b>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              <Panel
                title={view.final_cfp.length ? m.topCfp : m.topAp}
                aside={view.done ? m.finalPoll : m.latestPoll}
                onTitle={go("rankings")}
              >
                {poll.length ? (
                  <ol className="recap__list">
                    {poll.slice(0, 10).map((e) => (
                      <li key={e.team} className={e.team === season.team ? "is-mine" : undefined}>
                        <span className={`recap__place${e.rank <= 3 ? " is-top" : ""}`}>{e.rank}</span>
                        <span className="recap__grow">
                          <b>{team(e.team, e.name)}</b>
                        </span>
                        <span className="recap__soft">{e.record}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="recap__soft">{m.noPoll}</p>
                )}
              </Panel>

              {(view.surprises.length > 0 || view.disappointments.length > 0) && (
                <Panel title={m.swings}>
                  <div className="recap__swings">
                    <h3 className="label recap__kicker">{m.surprises}</h3>
                    <ul className="recap__list">
                      {view.surprises.map((s) => (
                        <li key={s.team}>
                          <ArrowUp size={14} weight="bold" className="recap__up" aria-hidden="true" />
                          <span className="recap__grow">
                            <b>{team(s.team, s.name)}</b>
                          </span>
                          <span className="recap__soft">{s.final_rank ? `#${s.final_rank}` : (s.record ?? "")}</span>
                        </li>
                      ))}
                    </ul>
                    <h3 className="label recap__kicker">{m.disappointments}</h3>
                    <ul className="recap__list">
                      {view.disappointments.map((s) => (
                        <li key={s.team}>
                          <ArrowDown size={14} weight="bold" className="recap__down" aria-hidden="true" />
                          <span className="recap__grow">
                            <b>{team(s.team, s.name)}</b>
                          </span>
                          <span className="recap__soft">
                            {s.final_rank ? `#${s.final_rank}` : (s.record ?? m.unranked)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Panel>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
