import { useMemo } from "react";
import { usePlayerHover } from "../PlayerCard/index.tsx";
import { formatClass } from "../../format.ts";
import { byOverall } from "../../positions.ts";
import type { RosterPlayer, TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  team: TeamCard | null;
  players: RosterPlayer[] | null;
}

const TOP = 3;

/** The team at a glance: offense and defense, each with its rating and its best players. */
export default function TeamOverview({ team, players }: Props) {
  const { hovered, bind, card } = usePlayerHover();
  const units = useMemo(() => {
    if (!team || !players) return null;
    return [
      { key: "offense", label: m.offense, rating: team.ratings.offense },
      { key: "defense", label: m.defense, rating: team.ratings.defense },
    ].map((u) => {
      const rows = players.filter((p) => p.unit === u.key);
      return { ...u, rows, starters: rows.filter((p) => p.starter).length, top: byOverall(rows).slice(0, TOP) };
    });
  }, [team, players]);
  if (!units) return <p className="overview__empty">{m.loading}</p>;

  return (
    <div className="overview">
      <div className="overview__units">
        {units.map((u) => (
          <section key={u.key} className="unit" aria-label={u.label}>
            <div className="unit__head">
              <div className="unit__title">
                <h3 className="unit__name">{u.label}</h3>
                <span className="unit__depth">{m.depth(u.rows.length, u.starters)}</span>
              </div>
              <span className="unit__rating" aria-label={`${m.rating} ${Math.round(u.rating)}`}>
                {Math.round(u.rating)}
              </span>
            </div>
            <span className="unit__bar" aria-hidden="true">
              <span style={{ width: `${Math.min(100, u.rating)}%` }} />
            </span>
            <ol className="unit__top" aria-label={m.topPlayers}>
              {u.top.map((p, i) => (
                <li key={`${p.slug ?? p.name}-${i}`} className={hovered === p ? "is-hovered" : undefined} {...bind(p)}>
                  <span className="unit__rank">{i + 1}</span>
                  <b className="unit__player">{p.name}</b>
                  <small className="unit__pos">
                    {p.position} · {formatClass(p.class)}
                  </small>
                  <span className="unit__ovr">{p.overall}</span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
      {card}
    </div>
  );
}
