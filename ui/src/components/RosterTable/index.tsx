import { useMemo, useState } from "react";
import Chip from "../Chip/index.tsx";
import { usePlayerHover } from "../PlayerCard/index.tsx";
import { formatClass } from "../../format.ts";
import { POSITION_GROUPS, byPosition } from "../../positions.ts";
import type { RosterPlayer } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  players: RosterPlayer[] | null;
}

/**
 * A team's players with position filters, offense then defense, by position, starters first. Scrolls inside
 * its own box. Rows are not text-selectable: hovering (or tabbing to) a row shows its player card instead.
 */
export default function RosterTable({ players }: Props) {
  const [group, setGroup] = useState("all");
  const { hovered, bind, card, clear } = usePlayerHover();
  const view = useMemo(() => {
    if (!players) return null;
    const groups = POSITION_GROUPS.map((g) => ({
      ...g,
      count: players.filter((p) => g.positions.includes(p.position)).length,
    })).filter((g) => g.count > 0);
    const picked = groups.find((g) => g.key === group);
    const shown = picked ? players.filter((p) => picked.positions.includes(p.position)) : players;
    const units = [
      { key: "offense", label: m.offense, rows: byPosition(shown.filter((p) => p.unit === "offense")) },
      { key: "defense", label: m.defense, rows: byPosition(shown.filter((p) => p.unit === "defense")) },
    ].filter((u) => u.rows.length > 0);
    return { groups, picked, shown, units };
  }, [players, group]);
  if (!players || !view) return <p className="roster__empty">{m.loading}</p>;
  const { groups, picked, shown, units } = view;

  return (
    <div className="roster">
      <div className="roster__filters" role="group" aria-label={m.filtersLabel}>
        <Chip on={!picked} count={players.length} onClick={() => setGroup("all")}>
          {m.all}
        </Chip>
        {groups.map((g) => (
          <Chip key={g.key} on={picked?.key === g.key} count={g.count} onClick={() => setGroup(g.key)}>
            {g.key}
          </Chip>
        ))}
      </div>
      <div className="roster__head">
        <span className="roster__summary">{m.summary(shown.length, shown.filter((p) => p.starter).length)}</span>
      </div>
      <div className="roster__scroll" onScroll={clear}>
        <table className="roster__table">
          <thead>
            <tr>
              <th className="roster__num">{m.cols.jersey}</th>
              <th>{m.cols.player}</th>
              <th>{m.cols.pos}</th>
              <th>{m.cols.cls}</th>
              <th className="roster__num">{m.cols.ht}</th>
              <th className="roster__num">{m.cols.wt}</th>
              <th className="roster__num">{m.cols.ovr}</th>
            </tr>
          </thead>
          {units.map((u) => (
            <tbody key={u.key}>
              <tr className="roster__group">
                <th colSpan={7}>
                  {u.label} · {u.rows.length}
                </th>
              </tr>
              {u.rows.map((p, i) => (
                <tr
                  key={`${p.slug ?? p.name}-${i}`}
                  className={["roster__row", p.starter && "is-starter", hovered === p && "is-hovered"]
                    .filter(Boolean)
                    .join(" ")}
                  {...bind(p)}
                >
                  <td className="roster__num">{p.jersey ?? "–"}</td>
                  <td className="roster__name">
                    {p.name}
                    {p.starter && <span className="roster__tag">{m.starter}</span>}
                  </td>
                  <td>{p.position}</td>
                  <td>{formatClass(p.class)}</td>
                  <td className="roster__num">{p.height ?? "–"}</td>
                  <td className="roster__num">{p.weight ?? "–"}</td>
                  <td className="roster__num roster__ovr">{p.overall}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      {card}
    </div>
  );
}
