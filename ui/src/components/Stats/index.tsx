import { useEffect, useMemo, useState } from "react";
import Chip from "../Chip/index.tsx";
import Dropdown from "../Dropdown/index.tsx";
import PlayerLink from "../PlayerLink/index.tsx";
import DataTable, { type Column } from "../DataTable/index.tsx";
import SectionTabs, { SectionPane, SectionStatus } from "../SectionTabs/index.tsx";
import Swatch from "../Swatch/index.tsx";
import { api } from "../../api.ts";
import type { SeasonSummary, TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  season: SeasonSummary;
  teams: Map<string, TeamCard>;
  /** asked for from elsewhere (an injury notice): open on this tab, narrowed to this team; `at` changes with each ask */
  show?: { tab: Tab; team: string; at: number } | null;
}

/** One player's line in a category (GET /stats/players?cat= → players[]) */
interface PlayerLine {
  name: string;
  position: string;
  team: string;
  team_name: string;
  games: number;
  stats: Record<string, number>;
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
/** The categories in the order their chips show (the game's keys). */
const CATEGORIES = ["passing", "rushing", "receiving", "defense", "kicking", "punting", "returns", "blocking"] as const;
type Category = (typeof CATEGORIES)[number];
/** *tune* How many rows the players table draws before Show All (a category can hold thousands). */
const ROWS = 250;

/** A number as the tables show it: whole when it is whole (100, not 100.0), else one decimal. */
const one = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Stats: the season in numbers. Players: one table for a category (passing, defense, returns…) with every number the
 * game keeps for it and every player who has one, sortable by any column, for the whole league or a conference or a
 * team. Teams: every team's season line in one table you can sort
 * by any column, yours marked. Before anyone has played, the page says so.
 */
export default function Stats({ season, teams, show }: Props) {
  const [tab, setTab] = useState<Tab>(show?.tab ?? "players");
  const [cat, setCat] = useState<Category>("passing");
  const [allRows, setAllRows] = useState(false);
  // whose numbers: every conference and team to start (the whole league), narrowed by either dropdown
  const [conf, setConf] = useState("");
  const [only, setOnly] = useState(show?.team ?? ""); // one team's slug, or all
  useEffect(() => {
    if (!show) return;
    setTab(show.tab);
    setConf("");
    setOnly(show.team);
  }, [show?.at]);
  const fbs = useMemo(
    () => [...teams.values()].filter((t) => !t.fictional).sort((a, b) => a.name.localeCompare(b.name)),
    [teams],
  );
  const conferences = useMemo(() => [...new Set(fbs.map((t) => t.conference))].sort(), [fbs]);
  const pickConf = (c: string) => {
    setConf(c);
    if (only && c && teams.get(only)?.conference !== c) setOnly("");
  };
  const scopeBar = (
    <div className="stats__filters" role="group" aria-label={m.scopeLabel}>
      <Dropdown
        label={m.conference}
        size="md"
        value={conf}
        options={[{ value: "", label: m.allConferences }, ...conferences.map((c) => ({ value: c, label: c }))]}
        onChange={pickConf}
      />
      <Dropdown
        label={m.teamLabel}
        size="md"
        value={only}
        options={[
          { value: "", label: m.allTeams },
          ...fbs
            .filter((t) => !conf || t.conference === conf)
            .map((t) => ({ value: t.slug, label: t.name, hint: t.slug === season.team ? m.yours : undefined })),
        ]}
        onChange={setOnly}
      />
    </div>
  );
  const [players, setPlayers] = useState<PlayerLine[] | null>(null);
  const [lines, setLines] = useState<TeamLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setPlayers(null);
    setAllRows(false);
    const q = new URLSearchParams({ cat, limit: "100000" });
    if (only) q.set("team", only);
    else if (conf) q.set("conference", conf);
    api<{ players: PlayerLine[] }>(`/api/season/${season.id}/stats/players?${q}`)
      .then((v) => live && setPlayers(v.players))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [season.id, season.current_week, cat, conf, only]);

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
  const hurtShown = (hurt ?? []).filter((i) => (only ? i.team === only : conf ? i.conference === conf : true));
  const lastWeek = Math.max(...Object.keys(season.week_labels).map(Number), 0);
  const hurtColumns: Column<Injury>[] = [
    {
      key: "player",
      label: m.injuryCols.player,
      render: (i) => (
        <span>
          <PlayerLink team={i.team} name={i.name} position={i.position} />{" "}
          <span className="stats__soft">{i.position}</span>
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
      width: 112, // "20 Weeks" in bold when it is the sorted column: wider than its heading
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

  const any = season.current_week > 0 || !!players?.length;
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
          <div className="stats__bar">
            <div className="stats__cats" role="group" aria-label={m.category}>
              {CATEGORIES.map((c) => (
                <Chip key={c} on={cat === c} onClick={() => setCat(c)}>
                  {m.cats[c].title}
                </Chip>
              ))}
            </div>
            {scopeBar}
          </div>
          {error ? (
            <p className="stats__soft">{m.loadError(error)}</p>
          ) : !players ? (
            <p className="stats__soft">{m.loading}</p>
          ) : !any ? (
            <div className="stats__empty">
              <h2>{m.noGames}</h2>
              <p>{m.noGamesText}</p>
            </div>
          ) : !players.length ? (
            <p className="stats__soft">{m.noPlayers}</p>
          ) : (
            <>
              {/* every player with a number here and every number the game keeps, the header frozen; any header sorts */}
              <div className="stats__teams" tabIndex={0}>
                <DataTable
                  key={cat}
                  label={m.cats[cat].title}
                  sticky
                  limit={allRows ? undefined : ROWS}
                  sortBy={m.cats[cat].cols[0].key}
                  rows={players}
                  rowKey={(p) => `${p.team}-${p.name}-${p.position}`}
                  mine={(p) => p.team === season.team}
                  columns={[
                    {
                      key: "place",
                      label: m.place,
                      width: 44,
                      render: (_p, i) => <span className="stats__place">{i + 1}</span>,
                    },
                    {
                      key: "player",
                      label: m.player,
                      sort: (p) => p.name,
                      render: (p) => (
                        <span className="stats__player">
                          <Swatch team={teams.get(p.team)} size={14} />
                          <PlayerLink team={p.team} name={p.name} position={p.position} />
                          <span className="stats__soft">
                            {p.position} · {teams.get(p.team)?.abbreviation ?? p.team_name}
                          </span>
                        </span>
                      ),
                    },
                    {
                      key: "g",
                      label: m.games,
                      tip: m.gamesTip,
                      num: true,
                      sort: (p) => p.games,
                      render: (p) => p.games,
                    },
                    ...m.cats[cat].cols.map((c) => ({
                      key: c.key,
                      label: c.label,
                      tip: c.tip,
                      num: true,
                      sort: (p: PlayerLine) => c.get(p.stats, p.games),
                      render: (p: PlayerLine) => one(Math.round(c.get(p.stats, p.games) * 10) / 10),
                    })),
                  ]}
                />
              </div>
              <p className="stats__count">
                {m.playersShown(allRows ? players.length : Math.min(ROWS, players.length), players.length)}
                {!allRows && players.length > ROWS && (
                  <button type="button" className="stats__more" onClick={() => setAllRows(true)}>
                    {m.showAll(players.length)}
                  </button>
                )}
              </p>
            </>
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
            <div className="stats__teams" tabIndex={0}>
              <DataTable
                label={m.teamStats}
                sticky
                columns={columns}
                rows={lines.filter((t) => t.games > 0)}
                rowKey={(t) => t.team}
                mine={(t) => t.team === season.team}
                sortBy="margin"
              />
            </div>
          )}
        </div>
      </SectionPane>
      <SectionPane shown={tab === "injuries"}>
        <div className="stats">
          <div className="stats__bar">
            <span className="label stats__soft">{hurt ? m.injuryCount(hurtShown.length) : ""}</span>
            {scopeBar}
          </div>
          {!hurt ? (
            <p className="stats__soft">{error ? m.loadError(error) : m.loading}</p>
          ) : !hurtShown.length ? (
            <div className="stats__empty">
              <h2>{m.noInjuries}</h2>
              <p>{m.noInjuriesText}</p>
            </div>
          ) : (
            <div className="stats__teams" tabIndex={0}>
              <DataTable
                label={m.injuries}
                sticky
                columns={hurtColumns}
                rows={hurtShown}
                rowKey={(r) => `${r.team}-${r.name}`}
                mine={(r) => r.team === season.team}
                sortBy="out"
              />
            </div>
          )}
        </div>
      </SectionPane>
    </div>
  );
}
