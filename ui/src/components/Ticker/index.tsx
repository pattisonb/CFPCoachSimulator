import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api.ts";
import { playerFace } from "../../faces.ts";
import type { TeamCard } from "../../types.ts";
import Face from "../Face/index.tsx";
import Swatch from "../Swatch/index.tsx";
import "./index.css";
import { messages as m } from "./messages.ts";

/** *tune* How fast the ticker crawls, in px a second. */
const SPEED = 70;
/** *tune* The most final scores it carries from the week just played (the biggest games first). */
const MAX_SCORES = 28;
/** *tune* How many finished weeks back its news goes. */
const NEWS_WEEKS = 2;
/** *tune* A win by this many points or more is a rout; by this few or fewer, a thriller. */
const ROUT = 28;
const THRILLER = 3;

/** An item of the league's news (sim/news.py league_news). */
interface NewsItem {
  week: number;
  kind: string;
  text: string;
  team?: string;
  link?: { type: "game"; event_id: string } | { type: "team"; slug: string } | { type: "recruit"; pid: string };
}
/** A game of the week (GET /api/season/{id}/week/{n}). */
interface WeekGame {
  event_id: string;
  home: string;
  away: string;
  played: boolean;
  home_score: number | null;
  away_score: number | null;
  overtime: number;
  home_rank: number | null;
  away_rank: number | null;
  has_box?: boolean;
}

interface Props {
  seasonId: string;
  /** the last week played: the ticker reads again when it moves */
  week: number;
  teams: Map<string, TeamCard>;
  /** a sim is running: the ticker says Live */
  live?: boolean;
  onBox: (eventId: string) => void;
  onTeam: (slug: string) => void;
  onRecruit: (pid: string) => void;
}

const POSITION = /\b(QB|RB|WR|TE|OT|OG|IOL|OL|EDGE|DT|DL|LB|CB|FS|SS|S|K|P)\b/;

/** How much a final matters to the crawl: ranked teams, then a close or lopsided score. */
const weight = (g: WeekGame) => {
  const margin = Math.abs((g.home_score ?? 0) - (g.away_score ?? 0));
  const rank = Math.min(g.home_rank ?? 99, g.away_rank ?? 99);
  return (
    (rank < 99 ? 100 - rank : 0) + (g.overtime ? 20 : 0) + (margin <= THRILLER ? 10 : 0) + (margin >= ROUT ? 5 : 0)
  );
};

/**
 * The crawl along the bottom of the game's window: the week's news from around the league (upsets, the polls, big
 * days, commitments) and its final scores, each in its teams' colors, sliding by without end. It stops under the
 * pointer, and an item opens what it is about (the box score, the team, the recruit).
 */
export default function Ticker({ seasonId, week, teams, live, onBox, onTeam, onRecruit }: Props) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [games, setGames] = useState<WeekGame[]>([]);
  // an answer is shown unless a later one already is (the weeks pass faster than the game answers during a sim)
  const asked = useRef({ season: "", n: 0, shown: 0 });
  useEffect(() => {
    if (asked.current.season !== seasonId) asked.current = { season: seasonId, n: 0, shown: 0 };
    if (week < 1) {
      setNews([]);
      setGames([]);
      return;
    }
    const mine = ++asked.current.n;
    Promise.all([
      api<{ items: NewsItem[] }>(`/api/season/${seasonId}/news?since_week=${Math.max(0, week - NEWS_WEEKS)}`, {
        quiet: true,
      }),
      api<{ games: WeekGame[] }>(`/api/season/${seasonId}/week/${week}`, { quiet: true }),
    ])
      .then(([n, w]) => {
        if (asked.current.season !== seasonId || mine < asked.current.shown) return;
        asked.current.shown = mine;
        setNews([...n.items].sort((a, b) => b.week - a.week));
        setGames(
          w.games
            .filter((g) => g.played && g.home_score !== null && g.away_score !== null)
            .sort((a, b) => weight(b) - weight(a))
            .slice(0, MAX_SCORES),
        );
      })
      .catch(() => {});
  }, [seasonId, week]);

  const items = useMemo(() => {
    const out: JSX.Element[] = [];
    news.forEach((n, i) => {
      const team = n.team ? teams.get(n.team) : undefined;
      const open =
        n.link?.type === "game"
          ? () => onBox((n.link as { event_id: string }).event_id)
          : n.link?.type === "team"
            ? () => onTeam((n.link as { slug: string }).slug)
            : n.link?.type === "recruit"
              ? () => onRecruit((n.link as { pid: string }).pid)
              : undefined;
      const body = (
        <>
          <span className={`ticker__tag ticker__tag--${n.kind}`}>{m.kinds[n.kind] ?? m.news}</span>
          {n.link?.type === "recruit" ? (
            <span className="ticker__face">
              <Face face={playerFace(n.link.pid, POSITION.exec(n.text)?.[1] ?? "")} scale={1} label={m.face} />
            </span>
          ) : (
            <Swatch team={team} size={18} />
          )}
          <span className="ticker__text">{n.text}</span>
        </>
      );
      out.push(
        open ? (
          <button type="button" key={`n${i}`} className="ticker__item ticker__item--link" onClick={open}>
            {body}
          </button>
        ) : (
          <span key={`n${i}`} className="ticker__item">
            {body}
          </span>
        ),
      );
    });
    games.forEach((g) => {
      const [home, away] = [teams.get(g.home), teams.get(g.away)];
      const [hs, as] = [g.home_score ?? 0, g.away_score ?? 0];
      const margin = Math.abs(hs - as);
      const loser = hs > as ? g.away_rank : g.home_rank;
      const winner = hs > as ? g.home_rank : g.away_rank;
      const tag =
        loser && (!winner || winner > loser)
          ? m.rankedLoss
          : margin >= ROUT
            ? m.rout
            : margin <= THRILLER
              ? m.thriller
              : null;
      const side = (t: TeamCard | undefined, slug: string, score: number, rank: number | null, won: boolean) => (
        <span className={won ? "ticker__side is-won" : "ticker__side"}>
          <Swatch team={t} size={18} />
          {rank && <span className="ticker__rank">#{rank}</span>}
          <span className="ticker__abbr">{t?.abbreviation ?? slug.slice(0, 4).toUpperCase()}</span>
          <span className="ticker__score">{score}</span>
        </span>
      );
      const body = (
        <>
          <span className="ticker__tag">{g.overtime ? m.finalOt(g.overtime) : m.final}</span>
          {side(away, g.away, as, g.away_rank, as > hs)}
          {side(home, g.home, hs, g.home_rank, hs > as)}
          {tag && <span className="ticker__tag ticker__tag--loud">{tag}</span>}
        </>
      );
      out.push(
        g.has_box !== false ? (
          <button
            type="button"
            key={`g${g.event_id}`}
            className="ticker__item ticker__item--link"
            aria-label={m.openGame(away?.name ?? g.away, home?.name ?? g.home)}
            onClick={() => onBox(g.event_id)}
          >
            {body}
          </button>
        ) : (
          <span key={`g${g.event_id}`} className="ticker__item">
            {body}
          </span>
        ),
      );
    });
    return out;
  }, [news, games, teams, onBox, onTeam, onRecruit]);

  // the crawl's pace is the same whatever it carries: its time is its width over SPEED
  const run = useRef<HTMLDivElement>(null);
  const [seconds, setSeconds] = useState(60);
  useEffect(() => {
    const el = run.current;
    if (el) setSeconds(Math.max(20, Math.round(el.scrollWidth / 2 / SPEED)));
  }, [items]);

  return (
    <aside className={live ? "ticker is-live" : "ticker"} aria-label={m.label}>
      <span className="ticker__label label">
        <i className="ticker__dot" aria-hidden="true" />
        {live ? m.live : m.label}
      </span>
      {items.length ? (
        <div className="ticker__window">
          {/* the list twice over, sliding left by one list's width, then again: it never ends */}
          <div className="ticker__run" ref={run} style={{ animationDuration: `${seconds}s` }}>
            <div className="ticker__list">{items}</div>
            <div className="ticker__list" aria-hidden="true">
              {items}
            </div>
          </div>
        </div>
      ) : (
        <p className="ticker__empty">{m.empty}</p>
      )}
    </aside>
  );
}
