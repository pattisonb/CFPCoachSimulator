import { useEffect, useState } from "react";
import DataTable, { type Column } from "../DataTable/index.tsx";
import Panel from "../Panel/index.tsx";
import { Stars } from "../ProspectCard/index.tsx";
import TeamPlate from "../TeamPlate/index.tsx";
import { api } from "../../api.ts";
import type { ProspectRow, TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  seasonId: string;
  /** your team's slug */
  team: string;
  teams: Map<string, TeamCard>;
  /** shown now (the tab is open): the rankings are read again each time, since a commitment moves them */
  active: boolean;
}

/** One school's class in the national rankings (GET /classes → schools[]). */
interface SchoolClass {
  school: string;
  name: string;
  conference: string;
  /** commitments and signees */
  count: number;
  signed: number;
  stars: Record<string, number>;
  rank: number;
  yours: boolean;
  points: number;
}
interface View {
  schools: SchoolClass[];
  phase: string;
  /** with ?school=: that class's recruits, best first */
  class?: ProspectRow[];
}

/**
 * Class Rankings: every FBS school's recruiting class, ranked. Pick a school (yours to start) and its class shows
 * beside the table: each commitment or signee with his stars, position, rank and hometown.
 */
export default function Classes({ seasonId, team, teams, active }: Props) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [school, setSchool] = useState(team);

  useEffect(() => {
    if (!active) return;
    let live = true;
    api<View>(`/api/season/${seasonId}/classes?school=${encodeURIComponent(school)}`)
      .then((v) => live && setView(v))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [seasonId, school, active]);

  if (!view) return <p className="classes__soft classes__note">{error ? m.loadError(error) : m.loading}</p>;
  const picked = view.schools.find((s) => s.school === school);
  const star = (k: string): Column<SchoolClass> => ({
    key: `s${k}`,
    label: m.stars(k),
    num: true,
    render: (s) => s.stars[k] ?? 0,
    sort: (s) => s.stars[k] ?? 0,
  });
  const columns: Column<SchoolClass>[] = [
    { key: "rank", label: m.cols.rank, num: true, render: (s) => <b>{s.rank}</b>, sort: (s) => -s.rank },
    {
      key: "school",
      label: m.cols.school,
      render: (s) => (
        <button
          type="button"
          className={`classes__school${s.school === school ? " is-on" : ""}`}
          aria-pressed={s.school === school}
          onClick={() => setSchool(s.school)}
        >
          <TeamPlate team={teams.get(s.school)} size="sm">
            {s.name}
          </TeamPlate>
        </button>
      ),
      sort: (s) => s.name,
    },
    { key: "conf", label: m.cols.conference, render: (s) => s.conference, sort: (s) => s.conference },
    { key: "count", label: m.cols.commits, num: true, render: (s) => s.count, sort: (s) => s.count },
    { key: "signed", label: m.cols.signed, num: true, render: (s) => s.signed ?? 0, sort: (s) => s.signed },
    star("5"),
    star("4"),
    star("3"),
    {
      key: "points",
      label: m.cols.points,
      num: true,
      tip: m.pointsTip,
      render: (s) => s.points.toFixed(2),
      sort: (s) => s.points,
    },
  ];

  return (
    <div className="classes">
      <Panel title={m.title} aside={m.phase(view.phase)} className="classes__table">
        <DataTable
          label={m.title}
          columns={columns}
          rows={view.schools}
          rowKey={(s) => s.school}
          mine={(s) => s.yours}
        />
      </Panel>
      <Panel
        title={picked ? m.classOf(picked.name) : m.aClass}
        aside={picked ? m.classLine(picked.rank, picked.count) : undefined}
        className="classes__class"
      >
        {view.class?.length ? (
          <ol className="classes__list">
            {view.class.map((r) => (
              <li key={r.id}>
                <span className="classes__who">
                  <b>{r.name}</b>
                  <span className="classes__soft">
                    {[
                      r.display_pos,
                      m.rank(r.national_rank),
                      [r.hometown.city, r.hometown.state].filter(Boolean).join(", "),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <Stars n={r.stars} size={10} />
                <span className={`classes__tag${r.signed ? " is-signed" : ""}`}>
                  {r.signed ? m.signed : m.committed}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="classes__soft">{m.empty}</p>
        )}
      </Panel>
    </div>
  );
}
