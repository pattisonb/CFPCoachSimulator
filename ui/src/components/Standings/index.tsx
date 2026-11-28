import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Crown, Medal } from "@phosphor-icons/react";
import Chip from "../Chip/index.tsx";
import SectionTabs, { SectionStatus } from "../SectionTabs/index.tsx";
import TeamPlate from "../TeamPlate/index.tsx";
import { api } from "../../api.ts";
import type { SeasonSummary, StandingRow, StandingsView, TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  season: SeasonSummary;
  teams: Map<string, TeamCard>;
}

/** Conferences whose short name reads better on a card. */
const SHORT: Record<string, string> = {
  "American Athletic Conference": "American",
  "Conference USA": "C-USA",
  "FBS Independent": "Independents",
  "FBS Independents": "Independents",
};
const short = (c: string) => SHORT[c] ?? c;

/** A conference's teams split by division (one group with no name when it has none). */
function byDivision(rows: StandingRow[]): [string | null, StandingRow[]][] {
  const names = [...new Set(rows.map((r) => r.division).filter((d): d is string => !!d))];
  return names.length ? names.map((d) => [d, rows.filter((r) => r.division === d)]) : [[null, rows]];
}

/**
 * Standings: every conference as a compact table in a grid, yours first. Pick a conference (its header, or a chip)
 * for its full table: home and away, points, differential, streak and the last game.
 */
export default function Standings({ season, teams }: Props) {
  const [data, setData] = useState<StandingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const page = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    api<StandingsView>(`/api/season/${season.id}/standings`)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [season.id, season.current_week]);

  const confs = useMemo(() => {
    const all = Object.keys(data?.standings ?? {});
    return all.sort((a, b) =>
      a === season.conference ? -1 : b === season.conference ? 1 : short(a).localeCompare(short(b)),
    );
  }, [data, season.conference]);

  const show = (conf: string | null) => {
    setOpen(conf);
    page.current?.scrollTo({ top: 0 });
  };

  const week = season.current_week;
  const status = week ? m.through(season.week_labels[week] ?? `Week ${week}`) : m.preseason;

  return (
    <div className="section-tabs__wrap">
      <SectionTabs
        title={m.title}
        value="all"
        onChange={() => {}}
        tabs={[]}
        aside={<SectionStatus>{status}</SectionStatus>}
      />
      {!data ? (
        <p className="standings__note" role="status">
          {error ? m.loadError(error) : m.loading}
        </p>
      ) : (
        <div className="standings" ref={page}>
          <div className="standings__bar" role="group" aria-label={m.confsLabel}>
            <Chip on={!open} onClick={() => show(null)}>
              {m.all}
            </Chip>
            {confs.map((c) => (
              <Chip key={c} on={open === c} onClick={() => show(c)}>
                {short(c)}
              </Chip>
            ))}
          </div>

          {open && data.standings[open] ? (
            <Full conf={open} rows={data.standings[open]} teams={teams} me={season.team} onBack={() => show(null)} />
          ) : (
            <div className="standings__grid">
              {confs.map((c) => (
                <Compact
                  key={c}
                  conf={c}
                  rows={data.standings[c]}
                  teams={teams}
                  me={season.team}
                  onOpen={() => show(c)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A rank badge: the CFP's when it has one, else the AP's. */
function Rank({ r }: { r: StandingRow }) {
  if (r.cfp_rank)
    return (
      <span className="standings__rank" title={m.cfpTip}>
        {m.cfp(r.cfp_rank)}
      </span>
    );
  if (r.ap_rank)
    return (
      <span className="standings__rank" title={m.apTip}>
        {m.ap(r.ap_rank)}
      </span>
    );
  return null;
}

function Marks({ r }: { r: StandingRow }) {
  return (
    <>
      {r.champion && <Crown size={14} weight="fill" aria-label={m.championTip} className="standings__mark" />}
      {r.runner_up && <Medal size={14} weight="fill" aria-label={m.runnerUpTip} className="standings__mark" />}
    </>
  );
}

/** One conference as a compact table: place, team, conference and overall records, points for and against. */
function Compact({
  conf,
  rows,
  teams,
  me,
  onOpen,
}: {
  conf: string;
  rows: StandingRow[];
  teams: Map<string, TeamCard>;
  me: string;
  onOpen: () => void;
}) {
  return (
    <section className="compact" aria-label={conf}>
      <button type="button" className="compact__head" onClick={onOpen} title={m.open(short(conf))}>
        <b>{short(conf)}</b>
        <ArrowRight size={14} weight="bold" aria-hidden="true" />
      </button>
      {byDivision(rows).map(([div, group]) => (
        <table key={div ?? "all"} className="compact__table">
          <thead>
            <tr>
              <th scope="col" className="compact__team">
                {div ?? m.cols.team}
              </th>
              <th scope="col" title={m.colTips.conf}>
                {m.cols.conf}
              </th>
              <th scope="col" title={m.colTips.overall}>
                {m.cols.overall}
              </th>
              <th scope="col" title={m.colTips.pf}>
                {m.cols.pf}
              </th>
              <th scope="col" title={m.colTips.pa}>
                {m.cols.pa}
              </th>
            </tr>
          </thead>
          <tbody>
            {group.map((r) => (
              <tr key={r.slug} className={r.slug === me ? "is-mine" : undefined}>
                <td className="compact__team">
                  <span className="compact__who">
                    <span className="compact__place">{r.conf_rank}</span>
                    <span className="plate-fit">
                      <TeamPlate team={teams.get(r.slug)} size="sm">
                        {r.name}
                      </TeamPlate>
                    </span>
                    <Marks r={r} />
                    <Rank r={r} />
                  </span>
                </td>
                <td>
                  <b>{m.record(r.conf_wins, r.conf_losses)}</b>
                </td>
                <td>{m.record(r.wins, r.losses)}</td>
                <td className="compact__soft">{r.points_for}</td>
                <td className="compact__soft">{r.points_against}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </section>
  );
}

/** One conference's full table. */
function Full({
  conf,
  rows,
  teams,
  me,
  onBack,
}: {
  conf: string;
  rows: StandingRow[];
  teams: Map<string, TeamCard>;
  me: string;
  onBack: () => void;
}) {
  const champ = rows.find((r) => r.champion);
  return (
    <section className="full" aria-label={conf}>
      <header className="full__head">
        <button type="button" className="standings__link" onClick={onBack}>
          <ArrowLeft size={14} weight="bold" aria-hidden="true" />
          {m.back}
        </button>
        <h2 className="standings__title">{conf}</h2>
        <span className="standings__soft">
          {m.teams(rows.length)}
          {champ ? ` · ${m.champion(champ.name)}` : ""}
        </span>
      </header>
      {byDivision(rows).map(([div, group]) => (
        <table key={div ?? "all"} className="full__table">
          <thead>
            <tr>
              <th scope="col">{m.cols.rank}</th>
              <th scope="col" className="full__left">
                {div ?? m.cols.team}
              </th>
              {(["conf", "overall", "home", "away", "pf", "pa", "diff", "streak"] as const).map((k) => (
                <th key={k} scope="col" title={m.colTips[k]}>
                  {m.cols[k]}
                </th>
              ))}
              <th scope="col" className="full__left full__last">
                {m.cols.last}
              </th>
            </tr>
          </thead>
          <tbody>
            {group.map((r) => {
              const diff = r.points_for - r.points_against;
              return (
                <tr key={r.slug} className={r.slug === me ? "is-mine" : undefined}>
                  <td title={r.tiebreak ? m.tiebreak(r.tiebreak) : undefined}>{r.conf_rank}</td>
                  <td className="full__left">
                    <span className="compact__who">
                      <TeamPlate team={teams.get(r.slug)} size="sm">
                        {r.name}
                      </TeamPlate>
                      <Marks r={r} />
                      <Rank r={r} />
                    </span>
                  </td>
                  <td>
                    <b>{m.record(r.conf_wins, r.conf_losses)}</b>
                  </td>
                  <td>{m.record(r.wins, r.losses)}</td>
                  <td>{m.record(r.home_wins, r.home_losses)}</td>
                  <td>{m.record(r.away_wins, r.away_losses)}</td>
                  <td>{r.points_for}</td>
                  <td>{r.points_against}</td>
                  <td className={diff > 0 ? "is-up" : diff < 0 ? "is-down" : undefined}>
                    {diff > 0 ? `+${diff}` : diff}
                  </td>
                  <td className={r.streak > 0 ? "is-up" : r.streak < 0 ? "is-down" : undefined}>
                    {m.streak(r.streak)}
                  </td>
                  <td className="full__left full__last">
                    {r.last ? m.last(r.last.won, r.last.score, r.last.venue, r.last.opponent_name) : m.none}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ))}
    </section>
  );
}
