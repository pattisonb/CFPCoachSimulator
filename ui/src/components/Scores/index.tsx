import { useEffect, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import Chip from "../Chip/index.tsx";
import Dropdown from "../Dropdown/index.tsx";
import SectionTabs, { SectionPane, SectionStatus } from "../SectionTabs/index.tsx";
import Swatch from "../Swatch/index.tsx";
import TeamPlate from "../TeamPlate/index.tsx";
import { api } from "../../api.ts";
import type { SeasonSummary, TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  season: SeasonSummary;
  teams: Map<string, TeamCard>;
  /** open a played game's box score */
  onBox: (eventId: string) => void;
}

/** A game on a week's slate (GET /week/{n} → games[]). */
interface Game {
  event_id: string;
  week: number;
  date: string | null;
  neutral: boolean;
  home: string;
  away: string;
  home_name: string;
  away_name: string;
  home_rank: number | null;
  away_rank: number | null;
  home_record: string;
  away_record: string;
  played: boolean;
  home_score: number | null;
  away_score: number | null;
  overtime: number;
  mine: boolean;
  has_box: boolean;
  conference_game: boolean;
  title?: string | null;
}

/** One of your rivalries (GET /rivalries → rivalries[]). */
interface Rivalry {
  name: string;
  trophy: string | null;
  opponent: string;
  opponent_name: string;
  series: string;
  holder: string | null;
  game: {
    week: number;
    played: boolean;
    event_id: string | null;
    venue: string | null;
    won: boolean | null;
    points_for: number | null;
    points_against: number | null;
    has_box: boolean;
  } | null;
}

type Tab = "scores" | "rivalries";
type Filter = "all" | "ranked" | "conference";
/** *tune* The season's last week (sim_js/season.js: the national championship). */
const LAST_WEEK = 20;
const DAY = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "America/New_York",
});

/**
 * Scores: every game in the league, a week at a time (the last week played to start), as cards: the two teams with
 * their ranks, records and the score, the winner in bold. All, the ranked games or your conference's; a played game
 * opens its box score. Rivalries: each of yours with its trophy, the series and this season's game.
 */
export default function Scores({ season, teams, onBox }: Props) {
  const [tab, setTab] = useState<Tab>("scores");
  const [week, setWeek] = useState(Math.min(LAST_WEEK, Math.max(1, season.current_week)));
  const [filter, setFilter] = useState<Filter>("all");
  const [slates, setSlates] = useState<Record<number, Game[] | string>>({});
  const [rivalries, setRivalries] = useState<Rivalry[] | null>(null);

  useEffect(() => {
    let live = true;
    api<{ games: Game[] }>(`/api/season/${season.id}/week/${week}`)
      .then((v) => live && setSlates((s) => ({ ...s, [week]: v.games })))
      .catch((e: Error) => live && setSlates((s) => ({ ...s, [week]: e.message })));
    return () => {
      live = false;
    };
  }, [season.id, week, season.current_week]);

  useEffect(() => {
    if (tab !== "rivalries" || rivalries) return;
    let live = true;
    api<{ rivalries: Rivalry[] }>(`/api/season/${season.id}/rivalries`)
      .then((v) => live && setRivalries(v.rivalries))
      .catch(() => live && setRivalries([]));
    return () => {
      live = false;
    };
  }, [tab, rivalries, season.id]);

  const weekName = (w: number) => season.week_labels[String(w)] ?? m.week(w);
  const slate = slates[week];
  const games = Array.isArray(slate) ? slate : [];
  const inConf = (g: Game) =>
    teams.get(g.home)?.conference === season.conference || teams.get(g.away)?.conference === season.conference;
  const shown = games
    .filter((g) => filter === "all" || (filter === "ranked" ? g.home_rank || g.away_rank : inConf(g)))
    // yours first, then the best-ranked games, then by kickoff
    .sort(
      (a, b) =>
        Number(b.mine) - Number(a.mine) ||
        Math.min(a.home_rank ?? 99, a.away_rank ?? 99) - Math.min(b.home_rank ?? 99, b.away_rank ?? 99) ||
        (a.date ?? "").localeCompare(b.date ?? ""),
    );
  const done = games.filter((g) => g.played).length;

  return (
    <div className="section-tabs__wrap">
      <SectionTabs
        title={m.title}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "scores", label: m.tabs.scores },
          { key: "rivalries", label: m.tabs.rivalries },
        ]}
        aside={
          tab === "scores" && (
            <>
              {games.length > 0 && <SectionStatus>{m.played(done, games.length)}</SectionStatus>}
              <Dropdown
                label={m.weekLabel}
                hideLabel
                size="md"
                align="right"
                value={String(week)}
                options={Array.from({ length: LAST_WEEK }, (_, i) => ({
                  value: String(i + 1),
                  label: weekName(i + 1),
                }))}
                onChange={(v) => setWeek(Number(v))}
              />
            </>
          )
        }
      />
      <SectionPane shown={tab === "scores"}>
        <div className="scores">
          <div className="scores__bar" role="group" aria-label={m.filterLabel}>
            <Chip on={filter === "all"} onClick={() => setFilter("all")}>
              {m.filters.all}
            </Chip>
            <Chip on={filter === "ranked"} onClick={() => setFilter("ranked")}>
              {m.filters.ranked}
            </Chip>
            <Chip on={filter === "conference"} onClick={() => setFilter("conference")}>
              {season.conference}
            </Chip>
          </div>
          {slate === undefined ? (
            <p className="scores__soft">{m.loading}</p>
          ) : typeof slate === "string" ? (
            <p className="scores__soft">{m.loadError(slate)}</p>
          ) : !shown.length ? (
            <p className="scores__soft">{games.length ? m.noneShown : m.noGames(weekName(week))}</p>
          ) : (
            <ul className="scores__grid">
              {shown.map((g) => {
                const homeWon = g.played && (g.home_score ?? 0) > (g.away_score ?? 0);
                const box = g.played && g.has_box ? g.event_id : null;
                const side = (s: "away" | "home") => {
                  const won = g.played && (s === "home" ? homeWon : !homeWon);
                  const rank = g[`${s}_rank`];
                  return (
                    <span className={`scores__side${won ? " is-won" : ""}${g.played && !won ? " is-lost" : ""}`}>
                      {rank && <span className="scores__rank">{rank}</span>}
                      <span className="scores__name plate-fit">
                        <TeamPlate team={teams.get(g[s])}>{g[`${s}_name`]}</TeamPlate>
                      </span>
                      <span className="scores__record">{g[`${s}_record`]}</span>
                      <b className="scores__pts">{g.played ? g[`${s}_score`] : ""}</b>
                    </span>
                  );
                };
                const status = g.played
                  ? g.overtime
                    ? m.finalOt(g.overtime)
                    : m.final
                  : g.date
                    ? DAY.format(new Date(g.date))
                    : m.toBePlayed;
                const body = (
                  <>
                    <span className="scores__top">
                      <span className="label">{status}</span>
                      {g.title && <span className="scores__title">{g.title}</span>}
                      {g.neutral && !g.title && <span className="scores__title">{m.neutral}</span>}
                    </span>
                    {side("away")}
                    {side("home")}
                  </>
                );
                return (
                  <li key={g.event_id} className={g.mine ? "is-mine" : undefined}>
                    {box ? (
                      <button
                        type="button"
                        className="scores__game is-link"
                        title={m.boxScore(g.away_name, g.home_name)}
                        onClick={() => onBox(box)}
                      >
                        {body}
                      </button>
                    ) : (
                      <div className="scores__game">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SectionPane>
      <SectionPane shown={tab === "rivalries"}>
        <div className="scores">
          {!rivalries ? (
            <p className="scores__soft">{m.loading}</p>
          ) : !rivalries.length ? (
            <p className="scores__soft">{m.noRivalries(season.team_name)}</p>
          ) : (
            <ul className="scores__rivals">
              {rivalries.map((r) => {
                const g = r.game;
                const holder = r.holder ? (r.holder === season.team ? season.team_name : r.opponent_name) : null;
                return (
                  <li key={r.name} className="scores__rival">
                    <header>
                      <Swatch team={teams.get(season.team)} size={28} />
                      <Swatch team={teams.get(r.opponent)} size={28} />
                      <span className="scores__rival-name">
                        <b>{r.name}</b>
                        <span className="scores__soft">{m.versus(r.opponent_name)}</span>
                      </span>
                    </header>
                    <dl>
                      <div>
                        <dt className="label">{m.series}</dt>
                        <dd>{r.series}</dd>
                      </div>
                      {r.trophy && (
                        <div>
                          <dt className="label">{m.trophy}</dt>
                          <dd>{holder ? m.heldBy(r.trophy, holder) : r.trophy}</dd>
                        </div>
                      )}
                      <div>
                        <dt className="label">{m.thisSeason}</dt>
                        <dd>
                          {!g
                            ? m.notScheduled
                            : g.played && g.won != null
                              ? m.result(g.won, g.points_for ?? 0, g.points_against ?? 0, weekName(g.week))
                              : m.upcoming(weekName(g.week), g.venue === "away")}
                        </dd>
                      </div>
                    </dl>
                    {g?.played && g.has_box && g.event_id && (
                      <button type="button" className="scores__link" onClick={() => onBox(g.event_id!)}>
                        {m.boxScoreShort}
                        <ArrowRight size={12} weight="bold" aria-hidden="true" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SectionPane>
    </div>
  );
}
