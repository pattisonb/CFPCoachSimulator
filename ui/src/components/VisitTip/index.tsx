import { useEffect, useState, type ReactNode } from "react";
import Tooltip from "../Tooltip/index.tsx";
import { api } from "../../api.ts";
import { cachedStandIns, cachedTeams } from "../../teams.ts";
import type { ScheduleGame, TeamScheduleView } from "../../types.ts";
import { messages as m } from "./messages.ts";

interface Props {
  seasonId: string;
  /** the school he visits (yours or any other) */
  school: string;
  /** the week of the schedule his visit is in */
  week: number;
  /** the visit has happened */
  done: boolean;
  /** that week's name ("Week 3") */
  weekName: string;
  /** a bold name over the line */
  title?: string;
  /** the tag the tip is on */
  children: ReactNode;
}

// a school's game in a week, kept once fetched; an unplayed game is asked for again once the visit is done
const games = new Map<string, ScheduleGame | null>();

/** The school's game that week (null: none, or not known yet). */
function useGame(seasonId: string, school: string, week: number, done: boolean): ScheduleGame | null {
  const key = `${seasonId}|${school}|${week}`;
  const [, redraw] = useState(0);
  const have = games.get(key);
  const stale = have === undefined || (done && have !== null && !have.played);
  useEffect(() => {
    if (!stale) return;
    let live = true;
    api<TeamScheduleView>(`/api/season/${seasonId}/schedule/${school}`)
      .then((d) => games.set(key, d.schedule.find((g) => g.week === week && g.kind !== "bye") ?? null))
      .catch(() => games.set(key, null))
      .finally(() => live && redraw((n) => n + 1));
    return () => {
      live = false;
    };
  }, [key, stale]);
  return have ?? null;
}

/**
 * A recruit's official visit, said on hover of its tag: "Visited Week 3. Result: W 42-17 vs ALA." once it has happened,
 * "Visiting Week 3 vs ALA." before. For a visit to any school: the game is that school's that week.
 */
export default function VisitTip({ seasonId, school, week, done, weekName, title, children }: Props) {
  const g = useGame(seasonId, school, week, done);
  const opponent = g
    ? ([...(cachedTeams() ?? []), ...cachedStandIns()].find((t) => t.slug === g.opponent)?.abbreviation ??
      g.opponent_name)
    : null;
  const venue = g?.venue === "away" ? m.at : m.vs;
  const text = done
    ? [
        m.visited(weekName),
        g && opponent && g.played && g.won !== null
          ? m.result(g.won, g.points_for ?? 0, g.points_against ?? 0, venue, opponent)
          : null,
      ]
        .filter(Boolean)
        .join(" ")
    : g && opponent
      ? m.visitingGame(weekName, venue, opponent)
      : m.visiting(weekName);
  return (
    <Tooltip title={title} text={text}>
      {children}
    </Tooltip>
  );
}
