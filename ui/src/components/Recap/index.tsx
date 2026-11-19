import { useEffect, useState } from "react";
import { Trophy } from "@phosphor-icons/react";
import Panel, { PanelRow, PanelRows, Panels } from "../Panel/index.tsx";
import SectionTabs, { SectionStatus } from "../SectionTabs/index.tsx";
import Swatch from "../Swatch/index.tsx";
import { api } from "../../api.ts";
import type { PollEntry, SeasonSummary, TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import PlayerLink from "../PlayerLink/index.tsx";
import "./index.css";

interface Props {
  season: SeasonSummary;
  teams: Map<string, TeamCard>;
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
export default function Recap({ season, teams }: Props) {
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
  const game = (g: GameLine | null) =>
    g
      ? `${g.won ? m.won : m.lost} ${g.points_for}–${g.points_against} ${g.venue === "away" ? m.at : m.vs} ${
          g.opponent_rank ? `#${g.opponent_rank} ` : ""
        }${g.opponent_name}`
      : undefined;
  const result = (g: Result) => (
    <li key={`${g.home}-${g.away}`}>
      <span className={`recap__side${g.winner === g.away ? " is-won" : ""}`}>
        {team(g.away, g.away_name)} <b>{g.away_score ?? ""}</b>
      </span>
      <span className={`recap__side${g.winner === g.home ? " is-won" : ""}`}>
        {team(g.home, g.home_name)} <b>{g.home_score ?? ""}</b>
      </span>
      {(g.bowl || g.title) && <span className="recap__soft">{g.bowl ?? g.title}</span>}
    </li>
  );

  const me = view?.mine;
  const played = !!me && me.wins + me.losses > 0;
  const poll = view?.final_cfp.length ? view.final_cfp : (view?.final_ap ?? []);

  return (
    <div className="section-tabs__wrap">
      <SectionTabs title={m.title} value="all" onChange={() => {}} tabs={[]} aside={status} />
      <div className="recap">
        {!view || !me ? (
          <p className="recap__soft">{error ? m.loadError(error) : m.loading}</p>
        ) : (
          <>
            {/* the headline: the champion once there is one, else where your season stands */}
            <header className="recap__lead">
              {view.champion_name ? (
                <>
                  <Trophy size={28} weight="fill" aria-hidden="true" />
                  <div>
                    <h2>{m.champion(view.champion_name)}</h2>
                    <p>{me.finish ? m.yourFinish(season.team_name, me.finish) : ""}</p>
                  </div>
                </>
              ) : (
                <div>
                  <h2>{m.record(season.team_name, me.wins, me.losses)}</h2>
                  <p>{played ? m.soFar(weekName) : m.notStarted}</p>
                </div>
              )}
              {view.grade && (
                <div className="recap__grade">
                  <span className="label">{m.grade}</span>
                  <b>{view.grade.grade}</b>
                </div>
              )}
            </header>
            {view.grade && <p className="recap__gradeline">{view.grade.line}</p>}

            <Panels>
              <Panel title={m.yourSeason} aside={season.team_name}>
                <PanelRows>
                  <PanelRow label={m.rows.record} value={`${me.wins}-${me.losses}`} />
                  <PanelRow
                    label={m.rows.conference}
                    value={m.confLine(me.conf_wins, me.conf_losses, me.conf_rank, season.conference, me.conf_champion)}
                  />
                  <PanelRow label={m.rows.nonConf} value={`${me.non_conf_wins}-${me.non_conf_losses}`} />
                  {played && (
                    <PanelRow label={m.rows.scoring} value={m.scoring(me.points_per_game, me.allowed_per_game)} />
                  )}
                  {(me.final_cfp ?? me.final_ap) != null && (
                    <PanelRow label={m.rows.ranked} value={`#${me.final_cfp ?? me.final_ap}`} />
                  )}
                  {me.finish && <PanelRow label={m.rows.finish} value={me.finish} />}
                  {played && <PanelRow label={m.rows.streak} value={m.streak(me.longest_streak)} />}
                </PanelRows>
              </Panel>

              <Panel title={m.yourGames}>
                {played ? (
                  <PanelRows>
                    <PanelRow label={m.rows.bestWin} value={game(me.best_win)} unknown={m.noWins} />
                    <PanelRow label={m.rows.biggestWin} value={game(me.biggest_win)} unknown={m.noWins} />
                    <PanelRow label={m.rows.worstLoss} value={game(me.worst_loss)} unknown={m.noLosses} />
                    <PanelRow label={m.rows.closestLoss} value={game(me.closest_loss)} unknown={m.noLosses} />
                    {me.postseason.map((g) => (
                      <PanelRow key={g.week} label={g.title ?? m.rows.postseason} value={game(g)} />
                    ))}
                  </PanelRows>
                ) : (
                  <p className="recap__soft">{m.noGames}</p>
                )}
              </Panel>

              <Panel title={m.yourLeaders}>
                {MY_LEADERS.some(([k]) => me.leaders[k]) ? (
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

              {(view.title_game || view.rounds.length > 0) && (
                <Panel title={m.playoff}>
                  {view.title_game && (
                    <>
                      <h3 className="label recap__kicker">{m.titleGame}</h3>
                      <ul className="recap__results">{result(view.title_game)}</ul>
                    </>
                  )}
                  {[...view.rounds]
                    .reverse()
                    .filter((r) => !view.title_game || !/championship/i.test(r.round))
                    .map((r) => (
                      <div key={r.round}>
                        <h3 className="label recap__kicker">{r.round}</h3>
                        <ul className="recap__results">{r.games.map(result)}</ul>
                      </div>
                    ))}
                </Panel>
              )}

              {view.champions.length > 0 && (
                <Panel title={m.confChampions}>
                  <ul className="recap__list">
                    {view.champions.map((c) => (
                      <li key={c.conference} className={c.team === season.team ? "is-mine" : undefined}>
                        <span className="recap__soft recap__grow">{c.conference}</span>
                        <b>{team(c.team, c.name)}</b>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              <Panel title={view.final_cfp.length ? m.topCfp : m.topAp} aside={view.done ? m.finalPoll : m.latestPoll}>
                {poll.length ? (
                  <ol className="recap__list">
                    {poll.slice(0, 10).map((e) => (
                      <li key={e.team} className={e.team === season.team ? "is-mine" : undefined}>
                        <span className="recap__place">{e.rank}</span>
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

              <Panel title={m.nationalLeaders}>
                {NATIONAL.some(([k]) => view.national_leaders[k]) ? (
                  <PanelRows>
                    {NATIONAL.map(([k, line]) => {
                      const p = view.national_leaders[k];
                      return p ? (
                        <PanelRow
                          key={k}
                          label={m.nationalNames[k]}
                          value={
                            <>
                              <PlayerLink team={p.team} name={p.name} />, {p.team_name ?? ""} · {line(p.stats)}
                            </>
                          }
                        />
                      ) : null;
                    })}
                  </PanelRows>
                ) : (
                  <p className="recap__soft">{m.noGames}</p>
                )}
              </Panel>

              {(view.surprises.length > 0 || view.disappointments.length > 0) && (
                <Panel title={m.swings}>
                  <h3 className="label recap__kicker">{m.surprises}</h3>
                  <ul className="recap__list">
                    {view.surprises.map((s) => (
                      <li key={s.team}>
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
                        <span className="recap__grow">
                          <b>{team(s.team, s.name)}</b>
                        </span>
                        <span className="recap__soft">
                          {s.final_rank ? `#${s.final_rank}` : (s.record ?? m.unranked)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
            </Panels>
          </>
        )}
      </div>
    </div>
  );
}
