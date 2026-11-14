import { useEffect, useRef, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import type { ScheduleGame, TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  games: ScheduleGame[];
  /** the real teams by slug, for each opponent's colors and short name */
  teams: Map<string, TeamCard>;
  /** the game's names for its weeks ("Week 3", "Championship Week") */
  weekLabels: Record<string, string>;
}

/** *tune* How many tiles one press of an arrow scrolls. */
const PAGE_TILES = 3;

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

/** An opponent's short name: the team's abbreviation, else its first word (an FCS stand-in). */
const shortName = (g: ScheduleGame, team: TeamCard | undefined) =>
  team?.abbreviation ?? g.opponent_name.split(" ")[0].slice(0, 6).toUpperCase();

/**
 * The season across the top of the game: one tile per week, played games with their result, the rest with their
 * date. The next game is raised and scrolled into view; arrows page through the rest.
 */
export default function SeasonStrip({ games, teams, weekLabels }: Props) {
  const list = useRef<HTMLOListElement>(null);
  const [ends, setEnds] = useState({ start: true, end: true });
  const next = games.find((g) => g.kind !== "bye" && !g.played);

  const measure = () => {
    const el = list.current;
    if (!el) return;
    setEnds({ start: el.scrollLeft <= 1, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 });
  };

  // the next game near the left, with the last one played beside it
  useEffect(() => {
    const el = list.current;
    const tile = el?.querySelector<HTMLElement>(".season-strip__game.is-next");
    const before = tile?.previousElementSibling as HTMLElement | null;
    if (el && tile) el.scrollLeft = Math.max(0, (before ?? tile).offsetLeft);
    measure();
    const ro = new ResizeObserver(measure);
    if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [games]);

  const page = (dir: 1 | -1) => {
    const el = list.current;
    const tile = el?.firstElementChild as HTMLElement | null;
    if (el && tile) el.scrollBy({ left: dir * PAGE_TILES * (tile.offsetWidth + 4), behavior: "smooth" });
  };

  return (
    <div className="season-strip">
      <button
        type="button"
        className="season-strip__arrow"
        aria-label={m.earlier}
        title={m.earlier}
        disabled={ends.start}
        onClick={() => page(-1)}
      >
        <CaretLeft size={16} weight="bold" aria-hidden="true" />
      </button>
      <ol className="season-strip__list" ref={list} aria-label={m.label} onScroll={measure}>
        {games.map((g) => {
          const team = g.opponent ? teams.get(g.opponent) : undefined;
          const bye = g.kind === "bye";
          const isNext = g === next;
          const cls = [
            "season-strip__game",
            bye && "is-bye",
            g.played && (g.won ? "is-won" : "is-lost"),
            isNext && "is-next",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <li key={`${g.week}-${g.event_id ?? g.kind}`} className={cls} aria-current={isNext ? "true" : undefined}>
              <span className="season-strip__week label">
                <span className="season-strip__week-name">{g.title ?? weekLabels[g.week] ?? m.week(g.week)}</span>
                {isNext && <span className="season-strip__tag">{m.next}</span>}
              </span>
              {bye ? (
                <span className="season-strip__opp season-strip__opp--bye">{m.bye}</span>
              ) : (
                <span className="season-strip__opp" title={g.opponent_name}>
                  <span
                    className="season-strip__swatch"
                    style={
                      team
                        ? {
                            background: `linear-gradient(135deg, ${team.colors.primary} 50%, ${team.colors.secondary} 50%)`,
                          }
                        : undefined
                    }
                    aria-hidden="true"
                  />
                  <span className="season-strip__venue">{g.venue === "away" ? m.at : m.vs}</span>
                  {g.opponent_rank && <span className="season-strip__rank">{g.opponent_rank}</span>}
                  <span className="season-strip__abbr">{shortName(g, team)}</span>
                </span>
              )}
              <span className="season-strip__line">
                {bye
                  ? ""
                  : g.played && g.won !== null
                    ? m.result(g.won, g.points_for ?? 0, g.points_against ?? 0, g.overtime)
                    : g.date
                      ? DATE.format(new Date(g.date))
                      : m.tbd}
              </span>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="season-strip__arrow"
        aria-label={m.later}
        title={m.later}
        disabled={ends.end}
        onClick={() => page(1)}
      >
        <CaretRight size={16} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}
