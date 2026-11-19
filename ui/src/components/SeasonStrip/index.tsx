import { useEffect, useMemo, useRef, useState } from "react";
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
  /** the last week played (the season's current week): the week after it is the one you are in */
  week: number;
  /** open a played game's box score */
  onBox?: (eventId: string) => void;
}

/** *tune* The season's last week (sim/season.py: the national championship). */
const LAST_WEEK = 20;
/** *tune* The first week after the regular season: the weeks from here get a placeholder until a game is set. */
const FIRST_POST_WEEK = 15;

/** *tune* How long a tile that has just got its result stays marked, in ms (index.css strip-flash). */
const POP_MS = 1800;
/** *tune* How long the strip takes to glide to the week you are in after a week is played, in ms. */
const GLIDE_MS = 1100;
/** *tune* How long one press of an arrow takes to scroll, in ms. */
const PAGE_MS = 500;
/** *tune* How many tiles one press of an arrow scrolls. */
const PAGE_TILES = 3;

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

/** An opponent's short name: the team's abbreviation, else its first word (an FCS stand-in). */
const shortName = (g: ScheduleGame, team: TeamCard | undefined) =>
  team?.abbreviation ?? g.opponent_name.split(" ")[0].slice(0, 6).toUpperCase();

/**
 * The season across the top of the game: one tile per week, played games with their result, the rest with their
 * date. The week you are in (a game or a bye) is raised and scrolled into view; arrows page through the rest.
 */
export default function SeasonStrip({ games: schedule, teams, weekLabels, week, onBox }: Props) {
  // the postseason weeks you have no game in yet (championship week, the bowls, the playoff) hold their place
  const games = useMemo(() => {
    const out = [...schedule];
    for (let w = FIRST_POST_WEEK; w <= LAST_WEEK; w++)
      if (!schedule.some((g) => g.week === w)) out.push({ week: w, kind: "open" } as ScheduleGame);
    return out.sort((a, b) => a.week - b.week);
  }, [schedule]);
  const list = useRef<HTMLOListElement>(null);
  const [ends, setEnds] = useState({ start: true, end: true });
  // the week you are in, an open date included; past the schedule's end, the next game still to play
  const next =
    games.find((g) => g.week === week + 1 && !g.played) ??
    games.find((g) => g.kind !== "bye" && g.kind !== "open" && !g.played);

  const measure = () => {
    const el = list.current;
    if (!el) return;
    setEnds({ start: el.scrollLeft <= 1, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 });
  };

  // the strip's own glide: the browser's smooth scroll is quick and starts over with a jerk each time it is asked
  // again, so the strip is moved a frame at a time, easing out; a new glide picks up from wherever the last one got to
  const frame = useRef(0);
  const glide = (left: number, ms: number) => {
    const el = list.current;
    if (!el) return;
    window.cancelAnimationFrame(frame.current);
    const from = el.scrollLeft;
    const to = Math.max(0, Math.min(left, el.scrollWidth - el.clientWidth));
    if (Math.abs(to - from) < 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.scrollLeft = to;
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      el.scrollLeft = from + (to - from) * (1 - (1 - p) ** 3);
      if (p < 1) frame.current = window.requestAnimationFrame(step);
    };
    frame.current = window.requestAnimationFrame(step);
  };
  useEffect(() => () => window.cancelAnimationFrame(frame.current), []);

  // the week you are in near the left, with the last one played beside it: set at once when the strip first shows,
  // glided to after that (a sim moving through the weeks carries the strip along with it)
  const shown = useRef(false);
  // by its week alone: the same week's game coming back from the server under another id is not a move
  const nextKey = next ? String(next.week) : "";
  useEffect(() => {
    const el = list.current;
    const tile = el?.querySelector<HTMLElement>(".season-strip__game.is-next");
    const before = tile?.previousElementSibling as HTMLElement | null;
    if (el && tile) {
      const left = Math.max(0, (before ?? tile).offsetLeft);
      if (shown.current) glide(left, GLIDE_MS);
      else el.scrollLeft = left;
      shown.current = true;
    }
  }, [nextKey]);

  // a result that has just come in pops once (the tiles already played when the strip showed do not)
  // (held for the length of the pop: the page redraws several times a second while a sim runs)
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const playedKeys = games.filter((g) => g.played && g.opponent).map((g) => `${g.week}-${g.opponent}`);
  const playedKey = playedKeys.join("|");
  useEffect(() => {
    const before = seen.current;
    // what has popped is never forgotten: when a sim ends, its live results give way to the saved season, and for a
    // moment the week reads as unplayed again (it popped a second time when the season then loaded)
    seen.current = new Set([...(before ?? []), ...playedKeys]);
    if (!before) return;
    const added = playedKeys.filter((k) => !before.has(k));
    if (!added.length) return;
    setFresh(new Set(added));
    const t = window.setTimeout(() => setFresh(new Set()), POP_MS);
    return () => window.clearTimeout(t);
  }, [playedKey]);

  useEffect(() => {
    const el = list.current;
    measure();
    const ro = new ResizeObserver(measure);
    if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [games]);

  const page = (dir: 1 | -1) => {
    const el = list.current;
    const tile = el?.firstElementChild as HTMLElement | null;
    if (el && tile) glide(el.scrollLeft + dir * PAGE_TILES * (tile.offsetWidth + 4), PAGE_MS);
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
          const open = g.kind === "open";
          const bye = g.kind === "bye" || open;
          const isNext = g === next;
          const box = onBox && g.played && g.event_id && g.has_box !== false ? g.event_id : null;
          const cls = [
            "season-strip__game",
            bye && "is-bye",
            g.played && (g.won ? "is-won" : "is-lost"),
            isNext && "is-next",
            box && "is-link",
            fresh.has(`${g.week}-${g.opponent ?? g.kind}`) && "is-fresh",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <li key={`${g.week}-${g.event_id ?? g.kind}`} className={cls} aria-current={isNext ? "true" : undefined}>
              <span className="season-strip__week label">
                <span className="season-strip__week-name" title={g.title ?? weekLabels[g.week] ?? undefined}>
                  {g.title ?? weekLabels[g.week] ?? m.week(g.week)}
                </span>
                {isNext && <span className="season-strip__tag">{m.next}</span>}
              </span>
              {bye ? (
                <span className="season-strip__opp season-strip__opp--bye">{open ? m.open(g.week) : m.bye}</span>
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
                {open
                  ? m.toBeSet
                  : bye
                    ? ""
                    : g.played && g.won !== null
                      ? m.result(g.won, g.points_for ?? 0, g.points_against ?? 0, g.overtime)
                      : g.date
                        ? DATE.format(new Date(g.date))
                        : m.tbd}
              </span>
              {box && (
                <button
                  type="button"
                  className="season-strip__box"
                  aria-label={m.boxScore(g.opponent_name)}
                  title={m.boxScore(g.opponent_name)}
                  onClick={() => onBox?.(box)}
                />
              )}
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
