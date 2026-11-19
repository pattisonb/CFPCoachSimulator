import { useEffect, useState } from "react";
import Chip from "../Chip/index.tsx";
import DataTable, { type Column } from "../DataTable/index.tsx";
import Panel, { Panels } from "../Panel/index.tsx";
import SectionTabs, { SectionPane, SectionStatus } from "../SectionTabs/index.tsx";
import Swatch from "../Swatch/index.tsx";
import { api } from "../../api.ts";
import type { SeasonSummary, TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  season: SeasonSummary;
  teams: Map<string, TeamCard>;
}

/** One player in a leaders list (GET /stats/leaders → leaders[category][]) */
interface Leader {
  name: string;
  position: string;
  team: string;
  team_name: string;
  games: number;
  stats: Record<string, number>;
  /** the category's own number: yards, sacks, an average */
  value: number;
}

/** One team's season line (GET /stats/teams → teams[]) */
interface TeamLine {
  team: string;
  name: string;
  conference: string;
  fictional: boolean;
  games: number;
  wins: number;
  losses: number;
  ppg: number;
  opp_ppg: number;
  margin: number;
  ypg: number;
  pass_ypg: number;
  rush_ypg: number;
  opp_ypg: number;
  third_pct: number;
  turnovers: number;
  takeaways: number;
  sacks: number;
}

type Tab = "players" | "teams" | "injuries";

/** One player on the injury list (GET /injuries → injuries[]). */
interface Injury {
  name: string;
  position: string;
  type: string;
  weeks_left: number;
  team: string;
  team_name: string;
  conference: string;
  returns_week: number;
}
type Scope = "all" | "conference" | "team";

/** *tune* How many leaders each category lists. */
const LEADERS = 10;
/** The categories in the order the page shows them (the server's keys). */
const CATEGORIES = [
  "passing",
  "rushing",
  "receiving",
  "touchdowns",
  "tackles",
  "sacks",
  "tfl",
  "interceptions",
  "pbu",
  "explosives",
  "kicking",
  "punting",
] as const;

const one = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Stats: the season's leaders. Players: a panel a category (passing yards, sacks, punting average…), the top ten in
 * each, for all of FBS, your conference or your own team. Teams: every team's season line in one table you can sort
 * by any column, yours marked. Before anyone has played, the page says so.
 */
export default function Stats({ season, teams }: Props) {
  const [tab, setTab] = useState<Tab>("players");
  const [scope, setScope] = useState<Scope>("all");
  const [leaders, setLeaders] = useState<Record<string, Leader[]> | null>(null);
  const [lines, setLines] = useState<TeamLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const q = new URLSearchParams({ n: String(LEADERS) });
    if (scope === "team") q.set("team", season.team);
    if (scope === "conference") q.set("conference", season.conference);
    api<{ leaders: Record<string, Leader[]> }>(`/api/season/${season.id}/stats/leaders?${q}`)
      .then((v) => live && setLeaders(v.leaders))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [season.id, season.team, season.conference, scope]);

  useEffect(() => {
    if (tab !== "teams" || lines) return;
    let live = true;
    api<{ teams: TeamLine[] }>(`/api/season/${season.id}/stats/teams`)
      .then((v) => live && setLines(v.teams.filter((t) => !t.fictional)))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [tab, lines, season.id]);

  // the injury list: the whole league, read when the tab opens and again each week
  const [hurt, setHurt] = useState<Injury[] | null>(null);
  useEffect(() => {
    if (tab !== "injuries") return;
    let live = true;
    api<{ injuries: Injury[] }>(`/api/season/${season.id}/injuries`)
      .then((v) => live && setHurt(v.injuries))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [tab, season.id, season.current_week]);
  const hurtShown = (hurt ?? []).filter((i) =>
    scope === "all" ? true : scope === "team" ? i.team === season.team : i.conference === season.conference,
  );
  const lastWeek = Math.max(...Object.keys(season.week_labels).map(Number), 0);
  const hurtColumns: Column<Injury>[] = [
    {
      key: "player",
      label: m.injuryCols.player,
      render: (i) => (
        <span>
          <b>{i.name}</b> <span className="stats__soft">{i.position}</span>
        </span>
      ),
      sort: (i) => i.name,
    },
    { key: "team", label: m.injuryCols.team, render: (i) => team(i.team, i.team_name), sort: (i) => i.team_name },
    { key: "type", label: m.injuryCols.injury, render: (i) => m.injuryType(i.type), sort: (i) => i.type },
    {
      key: "out",
      label: m.injuryCols.out,
      num: true,
      render: (i) => m.weeksOut(i.weeks_left),
      sort: (i) => i.weeks_left,
    },
    {
      key: "back",
      label: m.injuryCols.back,
      render: (i) =>
        i.returns_week > lastWeek
          ? m.nextSeason
          : (season.week_labels[String(i.returns_week)] ?? m.week(i.returns_week)),
      sort: (i) => -i.returns_week,
    },
  ];

  const any = !!leaders && Object.values(leaders).some((l) => l.length > 0);
  const weekName = season.week_labels[String(season.current_week)] ?? m.week(season.current_week);
  const team = (slug: string, name: string) => (
    <span className="stats__team">
      <Swatch team={teams.get(slug)} size={14} />
      {name}
    </span>
  );

  const columns: Column<TeamLine>[] = [
    { key: "team", label: m.cols.team, render: (t) => <b>{team(t.team, t.name)}</b>, sort: (t) => t.name },
    {
      key: "record",
      label: m.cols.record,
      num: true,
      render: (t) => `${t.wins}-${t.losses}`,
      sort: (t) => t.wins - t.losses,
    },
    { key: "ppg", label: m.cols.ppg, num: true, tip: m.tips.ppg, render: (t) => one(t.ppg), sort: (t) => t.ppg },
    {
      key: "opp",
      label: m.cols.oppPpg,
      num: true,
      tip: m.tips.oppPpg,
      render: (t) => one(t.opp_ppg),
      sort: (t) => -t.opp_ppg,
    },
    {
      key: "margin",
      label: m.cols.margin,
      num: true,
      tip: m.tips.margin,
      render: (t) => (t.margin > 0 ? "+" : "") + one(t.margin),
      sort: (t) => t.margin,
    },
    { key: "ypg", label: m.cols.ypg, num: true, tip: m.tips.ypg, render: (t) => one(t.ypg), sort: (t) => t.ypg },
    {
      key: "pass",
      label: m.cols.pass,
      num: true,
      tip: m.tips.pass,
      render: (t) => one(t.pass_ypg),
      sort: (t) => t.pass_ypg,
    },
    {
      key: "rush",
      label: m.cols.rush,
      num: true,
      tip: m.tips.rush,
      render: (t) => one(t.rush_ypg),
      sort: (t) => t.rush_ypg,
    },
    {
      key: "oppYpg",
      label: m.cols.oppYpg,
      num: true,
      tip: m.tips.oppYpg,
      render: (t) => one(t.opp_ypg),
      sort: (t) => -t.opp_ypg,
    },
    {
      key: "third",
      label: m.cols.third,
      num: true,
      tip: m.tips.third,
      render: (t) => `${Math.round(t.third_pct)}%`,
      sort: (t) => t.third_pct,
    },
    {
      key: "to",
      label: m.cols.turnover,
      num: true,
      tip: m.tips.turnover,
      render: (t) => (t.takeaways - t.turnovers > 0 ? "+" : "") + (t.takeaways - t.turnovers),
      sort: (t) => t.takeaways - t.turnovers,
    },
    { key: "sacks", label: m.cols.sacks, num: true, render: (t) => one(t.sacks), sort: (t) => t.sacks },
  ];

  return (
    <div className="section-tabs__wrap">
      <SectionTabs
        title={m.title}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "players", label: m.tabs.players },
          { key: "teams", label: m.tabs.teams },
          { key: "injuries", label: m.tabs.injuries, count: hurt?.length || undefined },
        ]}
        aside={<SectionStatus>{any ? m.through(weekName) : m.preseason}</SectionStatus>}
      />
      <SectionPane shown={tab === "players"}>
        <div className="stats">
          <div className="stats__bar" role="group" aria-label={m.scopeLabel}>
            <Chip on={scope === "all"} onClick={() => setScope("all")}>
              {m.scopes.all}
            </Chip>
            <Chip on={scope === "conference"} onClick={() => setScope("conference")}>
              {season.conference}
            </Chip>
            <Chip on={scope === "team"} onClick={() => setScope("team")}>
              {season.team_name}
            </Chip>
          </div>
          {error ? (
            <p className="stats__soft">{m.loadError(error)}</p>
          ) : !leaders ? (
            <p className="stats__soft">{m.loading}</p>
          ) : !any ? (
            <div className="stats__empty">
              <h2>{m.noGames}</h2>
              <p>{m.noGamesText}</p>
            </div>
          ) : (
            <Panels>
              {CATEGORIES.filter((c) => leaders[c]?.length).map((c) => (
                <Panel key={c} title={m.cats[c].title} aside={m.cats[c].unit}>
                  <ol className="stats__list">
                    {leaders[c].map((p, i) => (
                      <li key={`${p.team}-${p.name}`} className={p.team === season.team ? "is-mine" : undefined}>
                        <span className="stats__place">{i + 1}</span>
                        <Swatch team={teams.get(p.team)} size={14} />
                        <span className="stats__who">
                          <b>{p.name}</b>
                          <span className="stats__soft">
                            {p.position} · {p.team_name}
                          </span>
                        </span>
                        <span className="stats__line">{m.cats[c].line(p.stats)}</span>
                        <b className="stats__value">{one(p.value)}</b>
                      </li>
                    ))}
                  </ol>
                </Panel>
              ))}
            </Panels>
          )}
        </div>
      </SectionPane>
      <SectionPane shown={tab === "teams"}>
        <div className="stats">
          {!lines ? (
            <p className="stats__soft">{error ? m.loadError(error) : m.loading}</p>
          ) : !lines.some((t) => t.games > 0) ? (
            <div className="stats__empty">
              <h2>{m.noGames}</h2>
              <p>{m.noGamesText}</p>
            </div>
          ) : (
            <Panel title={m.teamStats} aside={m.sortHint} className="stats__table">
              <DataTable
                label={m.teamStats}
                columns={columns}
                rows={lines.filter((t) => t.games > 0)}
                rowKey={(t) => t.team}
                mine={(t) => t.team === season.team}
                sortBy="margin"
              />
            </Panel>
          )}
        </div>
      </SectionPane>
      <SectionPane shown={tab === "injuries"}>
        <div className="stats">
          <div className="stats__bar" role="group" aria-label={m.scopeLabel}>
            <Chip on={scope === "all"} onClick={() => setScope("all")}>
              {m.scopes.all}
            </Chip>
            <Chip on={scope === "conference"} onClick={() => setScope("conference")}>
              {season.conference}
            </Chip>
            <Chip on={scope === "team"} onClick={() => setScope("team")}>
              {season.team_name}
            </Chip>
          </div>
          {!hurt ? (
            <p className="stats__soft">{error ? m.loadError(error) : m.loading}</p>
          ) : !hurtShown.length ? (
            <div className="stats__empty">
              <h2>{m.noInjuries}</h2>
              <p>{m.noInjuriesText}</p>
            </div>
          ) : (
            <Panel title={m.injuries} aside={m.injuryCount(hurtShown.length)} className="stats__table">
              <DataTable
                label={m.injuries}
                columns={hurtColumns}
                rows={hurtShown}
                rowKey={(r) => `${r.team}-${r.name}`}
                mine={(r) => r.team === season.team}
                sortBy="out"
              />
            </Panel>
          )}
        </div>
      </SectionPane>
    </div>
  );
}
