import { useEffect, useState } from "react";
import DataTable, { type Column } from "../DataTable/index.tsx";
import Modal from "../Modal/index.tsx";
import Panel, { PanelRow, PanelRows, Panels } from "../Panel/index.tsx";
import Swatch from "../Swatch/index.tsx";
import { api } from "../../api.ts";
import type { TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  seasonId: string;
  /** the team to show; null closes the window */
  team: string | null;
  teams: Map<string, TeamCard>;
  weekLabels: Record<string, string>;
  /** open one of its games' box scores */
  onBox?: (eventId: string) => void;
  onClose: () => void;
}

/** One of the team's games, as the committee reads it. */
interface Line {
  opp: string;
  opp_name: string;
  won: boolean;
  pf: number;
  pa: number;
  week: number;
  venue: string;
  /** the opponent's rank when they played, and now */
  rank_then: number | null;
  rank_now: number | null;
  opp_record: string;
  fcs: boolean;
  event_id: string | null;
  title: string | null;
}

/** GET /resume?team= → rows[0] (sim_js/season.js resume): the committee's sheet on one team. */
interface Resume {
  team: string;
  name: string;
  conference: string;
  rank: number | null;
  record: string;
  conf_record: string;
  sos_rank: number | null;
  top25: string;
  vs_winning: string;
  road_wins: number;
  fcs_wins: number;
  margin: number;
  best_win: Line | null;
  worst_loss: Line | null;
  games: Line[];
}

type Load = { team: string; data: Resume | null; error?: string };

/**
 * A team's resume in a window, the way the committee reads it: its record and schedule strength, how it did against
 * ranked and winning teams, its best win and worst loss, and every game with what the opponent was ranked then and is
 * now. A game opens its box score.
 */
export default function TeamResume({ seasonId, team, teams, weekLabels, onBox, onClose }: Props) {
  const [load, setLoad] = useState<Load | null>(null);
  useEffect(() => {
    if (!team) return;
    let live = true;
    api<{ rows: Resume[] }>(`/api/season/${seasonId}/resume?team=${encodeURIComponent(team)}`)
      .then((v) => live && setLoad({ team, data: v.rows[0] ?? null }))
      .catch((e: Error) => live && setLoad({ team, data: null, error: e.message }));
    return () => {
      live = false;
    };
  }, [seasonId, team]);

  const ready = team && load?.team === team ? load : null;
  const r = ready?.data ?? null;
  const weekName = (w: number) => weekLabels[String(w)] ?? m.week(w);
  const line = (g: Line | null) =>
    g
      ? `${g.won ? m.won : m.lost} ${g.pf}–${g.pa} ${g.venue === "away" ? m.at : m.vs} ${g.rank_now ? `#${g.rank_now} ` : ""}${g.opp_name}`
      : undefined;

  const columns: Column<Line>[] = [
    { key: "week", label: m.cols.week, render: (g) => g.title ?? weekName(g.week), sort: (g) => -g.week },
    {
      key: "opp",
      label: m.cols.opponent,
      render: (g) => (
        <span className="resume__team">
          <span className="resume__soft">{g.venue === "away" ? m.at : m.vs}</span>
          <Swatch team={teams.get(g.opp)} size={14} />
          <b>{g.opp_name}</b>
          <span className="resume__soft">{g.opp_record}</span>
        </span>
      ),
      sort: (g) => g.opp_name,
    },
    {
      key: "result",
      label: m.cols.result,
      render: (g) =>
        g.event_id && onBox ? (
          <button type="button" className="resume__box" title={m.boxScore} onClick={() => onBox(g.event_id!)}>
            <b>{g.won ? m.w : m.l}</b> {g.pf}–{g.pa}
          </button>
        ) : (
          <span>
            <b>{g.won ? m.w : m.l}</b> {g.pf}–{g.pa}
          </span>
        ),
      sort: (g) => g.pf - g.pa,
    },
    {
      key: "then",
      label: m.cols.then,
      num: true,
      tip: m.cols.thenTip,
      render: (g) => (g.rank_then ? `#${g.rank_then}` : ""),
      sort: (g) => -(g.rank_then ?? 99),
    },
    {
      key: "now",
      label: m.cols.now,
      num: true,
      tip: m.cols.nowTip,
      render: (g) => (g.rank_now ? `#${g.rank_now}` : ""),
      sort: (g) => -(g.rank_now ?? 99),
    },
  ];

  return (
    <Modal
      open={!!team}
      onClose={onClose}
      title={r ? m.title(r.name) : (teams.get(team ?? "")?.name ?? m.loading)}
      lede={r ? [r.rank ? `#${r.rank}` : m.unranked, r.record, r.conference].join(" · ") : undefined}
    >
      {!ready ? (
        <p className="resume__soft">{m.loading}</p>
      ) : !r ? (
        <p className="resume__soft">{m.loadError(ready.error ?? m.none)}</p>
      ) : (
        <div className="resume">
          <Panels>
            <Panel title={m.sheet}>
              <PanelRows>
                <PanelRow label={m.rows.record} value={r.record} />
                <PanelRow label={m.rows.conference} value={r.conf_record} />
                <PanelRow
                  label={m.rows.sos}
                  value={r.sos_rank ? m.sosRank(r.sos_rank) : undefined}
                  tip={m.rows.sosTip}
                />
                <PanelRow label={m.rows.top25} value={r.top25} />
                <PanelRow label={m.rows.winning} value={r.vs_winning} />
                <PanelRow label={m.rows.road} value={String(r.road_wins)} />
                <PanelRow label={m.rows.margin} value={`${r.margin > 0 ? "+" : ""}${r.margin}`} />
              </PanelRows>
            </Panel>
            <Panel title={m.marks}>
              <PanelRows>
                <PanelRow label={m.rows.bestWin} value={line(r.best_win)} unknown={m.noWins} />
                <PanelRow label={m.rows.worstLoss} value={line(r.worst_loss)} unknown={m.noLosses} />
                {r.fcs_wins > 0 && <PanelRow label={m.rows.fcs} value={String(r.fcs_wins)} tip={m.rows.fcsTip} />}
              </PanelRows>
            </Panel>
          </Panels>
          <Panel title={m.games} aside={m.gamesNote} className="resume__games">
            {r.games.length ? (
              <DataTable label={m.games} columns={columns} rows={r.games} rowKey={(g) => `${g.week}-${g.opp}`} />
            ) : (
              <p className="resume__soft">{m.noGames}</p>
            )}
          </Panel>
        </div>
      )}
    </Modal>
  );
}
