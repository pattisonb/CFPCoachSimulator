import type { CSSProperties, ReactNode } from "react";
import { ArrowDown, ArrowUp, Fire, Lightning, Star, Timer } from "@phosphor-icons/react";
import Panel from "../Panel/index.tsx";
import PlayerLink from "../PlayerLink/index.tsx";
import FitText from "../FitText/index.tsx";
import Stamp from "../Stamp/index.tsx";
import TeamPlate from "../TeamPlate/index.tsx";
import Face from "../Face/index.tsx";
import { lookOf } from "../../faces.ts";
import { teamCardVars } from "../../colors.ts";
import type { SeasonSummary, TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";

/** A finished game, the winner first. */
interface GameLine {
  event_id: string;
  has_box: boolean;
  title: string | null;
  winner: string;
  loser: string;
  winner_name: string;
  loser_name: string;
  winner_rank: number | null;
  loser_rank: number | null;
  winner_score: number;
  loser_score: number;
  overtime: number;
  winner_home: boolean;
  neutral: boolean;
}
interface Upset extends GameLine {
  /** the winner's chance before the game, out of 100 */
  chance: number;
  /** a real long shot, not just an unranked team over a ranked one */
  stunner: boolean;
}
/** One player's game. */
interface Boom {
  team: string;
  team_name: string;
  name: string;
  /** his roster slug, for his face (null when the season's rosters do not have him) */
  slug?: string | null;
  position: string;
  line: string;
  opponent: string;
  opponent_abbr: string | null;
  opponent_name: string;
  won: boolean;
  event_id: string;
  mine: boolean;
}
interface Mover {
  team: string;
  name: string;
  rank: number | null;
  previous: number | null;
  record: string | null;
  move: number | null;
}
interface Score {
  rank: number;
  team: string;
  name: string;
  won: boolean;
  points_for: number;
  points_against: number;
  opponent: string;
  opponent_name: string;
  opponent_rank: number | null;
  venue: string;
  overtime: number;
  event_id: string;
  has_box: boolean;
}

/** GET /api/season/{id}/week_recap (sim_js/news.js week_recap): one finished week. */
export interface WeekRecap {
  week: number | null;
  weeks: number[];
  latest: number | null;
  mine?: {
    game: {
      event_id: string;
      has_box: boolean;
      title: string | null;
      opponent: string;
      opponent_abbr: string | null;
      opponent_name: string;
      opponent_rank: number | null;
      venue: string;
      won: boolean;
      points_for: number;
      points_against: number;
      overtime: number;
    } | null;
    record: string | null;
    rank_before: number | null;
    rank: number | null;
    standouts: Boom[];
  };
  game_of_week?: (GameLine & { tag: "upset" | "overtime" | "ranked" | "close" | null }) | null;
  upsets?: Upset[];
  booms?: Boom[];
  risers?: Mover[];
  fallers?: Mover[];
  entered?: Mover[];
  dropped?: Mover[];
  has_poll?: boolean;
  scores?: Score[];
  news?: { kind: string; text: string }[];
}

interface Props {
  view: WeekRecap;
  weekName: string;
  season: SeasonSummary;
  teams: Map<string, TeamCard>;
  /** open a game's box score */
  onBox?: (eventId: string) => void;
}

const TAG_ICON = { upset: Lightning, overtime: Timer, ranked: Star, close: Fire } as const;

/**
 * This Week on the Recap page: the week just played, told the way a highlights show would. Three banners (your game,
 * the game of the week, the biggest performance in the country), your week in tiles (your record, your ranking and
 * your own best lines), then a row of cards: Boom Performances, Upsets, Risers and Fallers, the Top 25's scores and
 * the week's headlines.
 */
export default function Week({ view, weekName, season, teams, onBox }: Props) {
  const mine = view.mine;
  const mineCard = teams.get(season.team);
  const abbr = (slug: string, fallback?: string | null) => teams.get(slug)?.abbreviation ?? fallback ?? "";
  // a team's own colors on its banner, its row or its chip: its first, the ink on it, and its trim (Recap/index.css)
  const hue = (slug?: string | null) => teamCardVars(slug ? teams.get(slug) : undefined) as CSSProperties | undefined;
  /** a row of the little cards: its team's colors under it (the row takes a tint of them when pointed at), yours marked */
  const rowOf = (slug: string | null | undefined, mine: boolean, more = "") => {
    const style = hue(slug);
    return {
      className: [more, style && "is-team", mine && "is-mine"].filter(Boolean).join(" ") || undefined,
      style,
    };
  };
  /** a team as its slanted nameplate (TeamPlate): "is-small" inside a line of text, "is-lost" an upset's loser */
  const plate = (slug: string, label: ReactNode, more = "") => (
    <TeamPlate team={teams.get(slug)} size={more.includes("is-small") ? "sm" : "md"} lost={more.includes("is-lost")}>
      {label}
    </TeamPlate>
  );
  /** the top three places as medals: gold, silver, bronze */
  const medal = (n: number) => (n <= 3 ? ` is-top is-medal-${n}` : "");
  /** the school a headline is about: the longest team name that stands as words in it */
  const named = [...teams.values()].filter((t) => !t.fictional && t.name).sort((a, b) => b.name.length - a.name.length);
  const aboutOf = (text: string) =>
    named.find((t) =>
      new RegExp(`(^|[^\\p{L}])${t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "u").test(text),
    )?.slug;
  const ranked = (name: string, rank: number | null) => (rank ? m.week.ranked(rank, name) : name);
  /** a row that opens its game's box score, when there is one to open */
  const box = (id: string, has: boolean, children: ReactNode, className = "") =>
    onBox && has ? (
      <button type="button" className={`recap__rowlink ${className}`} title={m.week.seeBox} onClick={() => onBox(id)}>
        {children}
      </button>
    ) : (
      <div className={`recap__rowlink is-plain ${className}`}>{children}</div>
    );

  const g = mine?.game ?? null;
  const gotw = view.game_of_week ?? null;
  const top = view.booms?.[0] ?? null;
  const Tag = gotw?.tag ? TAG_ICON[gotw.tag] : null;
  const moved = mine && mine.rank != null && mine.rank_before != null ? mine.rank_before - mine.rank : 0;
  const booms = view.booms ?? [];
  const upsets = view.upsets ?? [];
  const risers = view.risers ?? [];
  const fallers = view.fallers ?? [];
  const entered = view.entered ?? [];
  const dropped = view.dropped ?? [];
  const scores = view.scores ?? [];
  const news = view.news ?? [];
  const mover = (r: Mover, up: boolean) => (
    <li key={r.team} {...rowOf(r.team, r.team === season.team)}>
      {up ? (
        <ArrowUp size={14} weight="bold" className="recap__up" aria-hidden="true" />
      ) : (
        <ArrowDown size={14} weight="bold" className="recap__down" aria-hidden="true" />
      )}
      <b className={`recap__move ${up ? "is-up" : "is-down"}`}>{r.move != null ? Math.abs(r.move) : ""}</b>
      <span className="recap__grow" title={r.name}>
        {plate(r.team, abbr(r.team, r.name))}
      </span>
      <span className="recap__soft">
        {r.rank != null && r.previous != null ? m.week.fromTo(r.previous, r.rank) : (r.record ?? "")}
      </span>
    </li>
  );

  return (
    <>
      <header className={`recap__heroes recap__heroes--week${gotw ? "" : " is-solo"}${top ? " has-heisman" : ""}`}>
        {/* your game: the score large, in your colors */}
        <div className="recap__hero recap__hero--you" style={hue(season.team)}>
          <span className="recap__hero-mark" aria-hidden="true">
            {mineCard?.abbreviation}
          </span>
          <span className="recap__hero-kicker">
            {g
              ? m.week.yourGame(weekName, g.venue === "away" ? m.at : m.vs, ranked(g.opponent_name, g.opponent_rank))
              : m.week.yourBye(weekName)}
          </span>
          <h2>{g ? m.week.score(g.won, g.points_for, g.points_against) : m.week.bye}</h2>
          <p>{g ? (g.overtime ? m.week.inOvertime(g.overtime) : (g.title ?? m.week.final)) : m.week.byeLine}</p>
          {g && g.has_box && onBox && (
            <button type="button" className="recap__bracket" title={m.week.seeBox} onClick={() => onBox(g.event_id)}>
              <b className="recap__wl">{g.won ? m.w : m.l}</b>
              {m.week.boxScore}
            </button>
          )}
        </div>

        {/* the game of the week, in the winner's colors: what kind of game it was stamped in its corner */}
        {gotw && (
          <div
            className={`recap__hero recap__hero--gotw${onBox && gotw.has_box ? " is-link" : ""}`}
            style={hue(gotw.winner)}
            role={onBox && gotw.has_box ? "link" : undefined}
            tabIndex={onBox && gotw.has_box ? 0 : undefined}
            title={onBox && gotw.has_box ? m.week.seeBox : undefined}
            onClick={onBox && gotw.has_box ? () => onBox(gotw.event_id) : undefined}
            onKeyDown={(e) => {
              if (e.key === "Enter" && onBox && gotw.has_box) onBox(gotw.event_id);
            }}
          >
            <span className="recap__hero-mark" aria-hidden="true">
              {abbr(gotw.winner)}
            </span>
            <span className="recap__hero-kicker">
              <Star size={16} weight="fill" aria-hidden="true" />
              {m.week.gameOfWeek}
            </span>
            <h2 className="recap__duel">
              <span>
                {ranked(abbr(gotw.winner, gotw.winner_name), gotw.winner_rank)} <b>{gotw.winner_score}</b>
              </span>
              <span className="recap__duel-lost">
                {ranked(abbr(gotw.loser, gotw.loser_name), gotw.loser_rank)} <b>{gotw.loser_score}</b>
              </span>
            </h2>
            <p>
              {m.week.beat(
                gotw.winner_name,
                gotw.loser_name,
                gotw.neutral ? "neutral" : gotw.winner_home ? "home" : "away",
                gotw.overtime,
              )}
            </p>
            {gotw.tag && Tag && (
              <span className="recap__hero-stamp">
                <Stamp label={m.week.tags[gotw.tag]} tip={m.week.tagTips[gotw.tag]} side={36}>
                  <Tag size={18} weight="fill" aria-hidden="true" />
                </Stamp>
              </span>
            )}
          </div>
        )}

        {/* the biggest game any player had, in his school's colors */}
        {top && (
          <div className="recap__hero recap__hero--heisman recap__hero--boom" style={hue(top.team)}>
            <span className="recap__hero-mark" aria-hidden="true">
              {abbr(top.team)}
            </span>
            <span className="recap__hero-kicker">
              <Fire size={16} weight="fill" aria-hidden="true" />
              {m.week.boomOfWeek}
            </span>
            {/* his face, like a trading card's photo, tilted on a tile framed in his school's trim */}
            <span className="face-tile recap__boom-face">
              <Face face={lookOf(null, top.slug ?? top.name, top.position)} scale={4} label="" />
            </span>
            <h2>
              <FitText>
                <PlayerLink team={top.team} name={top.name} position={top.position} />
              </FitText>
            </h2>
            <p className="recap__boom-team">
              <TeamPlate team={teams.get(top.team)} size="sm" />
              {m.week.who(top.position, top.team_name, abbr(top.opponent, top.opponent_abbr ?? top.opponent_name))}
            </p>
            {/* his line as big blocks in his school's trim: 11 Rec, 185 Yds, 6 TD */}
            <ul className="recap__boom-stats">
              {top.line.split(", ").map((part) => {
                const at = part.indexOf(" ");
                return (
                  <li key={part}>
                    <b>{at > 0 ? part.slice(0, at) : part}</b>
                    <span>{at > 0 ? part.slice(at + 1) : ""}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </header>

      {/* your week in tiles: where you stand now, and your own best lines */}
      {mine && (
        <dl className="recap__nums recap__nums--week">
          <div>
            <dt className="label">{m.rows.record}</dt>
            <dd>{mine.record ?? m.dash}</dd>
          </div>
          <div>
            <dt className="label">{m.rows.ranked}</dt>
            <dd>
              {mine.rank != null ? `#${mine.rank}` : m.dash}
              {moved !== 0 && (
                <span className={`recap__delta ${moved > 0 ? "recap__up" : "recap__down"}`}>
                  {moved > 0 ? (
                    <ArrowUp size={16} weight="bold" aria-hidden="true" />
                  ) : (
                    <ArrowDown size={16} weight="bold" aria-hidden="true" />
                  )}
                  {Math.abs(moved)}
                </span>
              )}
            </dd>
            {mine.rank == null && (
              <span className="recap__soft">
                {mine.rank_before != null ? m.week.fellOut(mine.rank_before) : m.unranked}
              </span>
            )}
            {mine.rank != null && mine.rank_before == null && view.has_poll && (
              <span className="recap__soft">{m.week.newToPoll}</span>
            )}
          </div>
          {mine.standouts.map((p) => (
            <div key={`${p.name}-${p.position}`} className="recap__standout">
              <dt className="label">{m.week.standout(p.position)}</dt>
              <dd>
                <FitText>
                  <PlayerLink team={p.team} name={p.name} position={p.position} />
                </FitText>
              </dd>
              <span className="recap__soft">{p.line}</span>
            </div>
          ))}
          {mine.standouts.length === 0 && (
            <div className="recap__standout recap__standout--none">
              <dt className="label">{m.week.standouts}</dt>
              <span className="recap__soft">{g ? m.week.noStandouts : m.week.byeLine}</span>
            </div>
          )}
        </dl>
      )}

      <div className="recap__cards">
        <Panel title={m.week.booms} aside={booms.length ? m.week.count(booms.length) : undefined}>
          {booms.length ? (
            <ol className="recap__list">
              {booms.map((p, i) => (
                <li key={`${p.team}-${p.name}`} {...rowOf(p.team, !!p.mine, "recap__boom")}>
                  <span className={`recap__place${medal(i + 1)}`}>{i + 1}</span>
                  <span className="recap__grow recap__boom-who">
                    {plate(p.team, abbr(p.team, p.team_name), "is-small")}
                    <b>
                      <PlayerLink team={p.team} name={p.name} position={p.position} />
                    </b>{" "}
                    <span className="recap__soft">{p.position}</span>
                  </span>
                  {box(
                    p.event_id,
                    true,
                    <>
                      <b>{p.won ? m.w : m.l}</b> {m.vs} {abbr(p.opponent, p.opponent_abbr ?? p.opponent_name)}
                    </>,
                    "recap__soft",
                  )}
                  <span className="recap__soft recap__boom-line">{p.line}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="recap__soft">{m.week.noBooms}</p>
          )}
        </Panel>

        <Panel title={m.week.upsets} aside={upsets.length ? m.week.count(upsets.length) : undefined}>
          {upsets.length ? (
            <ul className="recap__list">
              {upsets.map((u) => (
                <li key={u.event_id} {...rowOf(u.winner, [u.winner, u.loser].includes(season.team), "recap__tall")}>
                  {box(
                    u.event_id,
                    u.has_box,
                    <>
                      <span className="recap__grow recap__two">
                        <span className="recap__side is-won">
                          {plate(u.winner, ranked(u.winner_name, u.winner_rank))}
                          <b>{u.winner_score}</b>
                        </span>
                        <span className="recap__side">
                          {plate(u.loser, ranked(u.loser_name, u.loser_rank), "is-lost")}
                          <span>{u.loser_score}</span>
                        </span>
                      </span>
                      <span className={`recap__odds${u.stunner ? " is-stunner" : ""}`} title={m.week.oddsTip}>
                        {u.stunner && <Lightning size={12} weight="fill" aria-hidden="true" />}
                        {m.week.odds(u.chance)}
                      </span>
                    </>,
                    "recap__upset",
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="recap__soft">{m.week.noUpsets}</p>
          )}
        </Panel>

        <Panel title={m.week.movers}>
          {view.has_poll ? (
            <div className="recap__swings">
              <h3 className="label recap__kicker">{m.week.risers}</h3>
              {risers.length ? (
                <ul className="recap__list">{risers.map((r) => mover(r, true))}</ul>
              ) : (
                <p className="recap__soft">{m.week.noRisers}</p>
              )}
              <h3 className="label recap__kicker">{m.week.fallers}</h3>
              {fallers.length ? (
                <ul className="recap__list">{fallers.map((r) => mover(r, false))}</ul>
              ) : (
                <p className="recap__soft">{m.week.noFallers}</p>
              )}
              {entered.length > 0 && (
                <>
                  <h3 className="label recap__kicker">{m.week.entered}</h3>
                  <p className="recap__inout">
                    {entered.map((r) => (
                      <span key={r.team}>{plate(r.team, `#${r.rank} ${abbr(r.team, r.name)}`)}</span>
                    ))}
                  </p>
                </>
              )}
              {dropped.length > 0 && (
                <>
                  <h3 className="label recap__kicker">{m.week.dropped}</h3>
                  <p className="recap__inout">
                    {dropped.map((r) => (
                      <span key={r.team}>{plate(r.team, abbr(r.team, r.name))}</span>
                    ))}
                  </p>
                </>
              )}
            </div>
          ) : (
            <p className="recap__soft">{m.week.noPollYet}</p>
          )}
        </Panel>

        <Panel title={m.week.scores}>
          {scores.length ? (
            <ol className="recap__list">
              {scores.map((s) => (
                <li key={`${s.team}-${s.event_id}`} {...rowOf(s.team, [s.team, s.opponent].includes(season.team))}>
                  <span className={`recap__place${medal(s.rank)}`}>{s.rank}</span>
                  <span className="recap__grow">{plate(s.team, abbr(s.team, s.name))}</span>
                  {box(
                    s.event_id,
                    s.has_box,
                    <>
                      <b className={s.won ? undefined : "recap__down"}>{s.won ? m.w : m.l}</b> {s.points_for}-
                      {s.points_against} {s.venue === "away" ? m.at : m.vs}{" "}
                      {ranked(abbr(s.opponent, s.opponent_name), s.opponent_rank)}
                    </>,
                    "recap__soft",
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="recap__soft">{m.week.noScores}</p>
          )}
        </Panel>

        {news.length > 0 && (
          <Panel title={m.week.headlines}>
            <ul className="recap__list">
              {news.map((n) => (
                <li key={n.text} {...rowOf(aboutOf(n.text), false, "recap__news")}>
                  <span className="recap__newshead">
                    {aboutOf(n.text) && plate(aboutOf(n.text)!, abbr(aboutOf(n.text)!), "is-small")}
                    <span className="label recap__newskind">{m.week.kinds[n.kind] ?? n.kind}</span>
                  </span>
                  <span>{n.text}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </>
  );
}
