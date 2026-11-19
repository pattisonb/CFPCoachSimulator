import { useEffect, useState } from "react";
import { ArrowDown, ArrowLineUp, ArrowUp } from "@phosphor-icons/react";
import Dropdown from "../Dropdown/index.tsx";
import Tooltip from "../Tooltip/index.tsx";
import { api } from "../../api.ts";
import type { DepthCard, DepthRow } from "../../types.ts";
import { messages as m } from "./messages.ts";

interface Props {
  seasonId: string;
  team: string;
  /** the role he is shown on, and where he sits in it */
  row: DepthRow;
  p: DepthCard;
  /** the other roles his position can play (a guard to tackle, a WILL to MIKE) */
  roles: { role: string; label: string }[];
  /** a change is being saved */
  busy: boolean;
  onMove: (move: "up" | "down" | "top") => void;
  onRole: (role: string) => void;
  onRedshirt: (on: boolean) => void;
  onPosition: (pos: string) => void;
}

/** What he would be at a position (GET /position_options/{team}/{player} → options[]). */
interface Option {
  pos: string;
  overall: number;
  current: boolean;
}

/**
 * What you can do with the picked player: move him up or down his role (or to the top), play him at another role of
 * his position, redshirt him or take the redshirt off, and move him to another position (with the overall he would be
 * there). Shown under his card.
 */
export default function Actions({
  seasonId,
  team,
  row,
  p,
  roles,
  busy,
  onMove,
  onRole,
  onRedshirt,
  onPosition,
}: Props) {
  const [options, setOptions] = useState<Option[] | null>(null);
  useEffect(() => {
    let live = true;
    setOptions(null);
    api<{ options: Option[] }>(`/api/season/${seasonId}/position_options/${team}/${p.slug}`)
      .then((v) => live && setOptions(v.options))
      .catch(() => live && setOptions([]));
    return () => {
      live = false;
    };
  }, [seasonId, team, p.slug, p.position]);

  const at = row.players.findIndex((x) => x.slug === p.slug);
  const returner = row.role === "KR" || row.role === "PR";
  const rs = p.redshirt;
  const here = options?.find((o) => o.current);

  return (
    <div className="depth-actions" role="group" aria-label={m.actions(p.name)}>
      {!returner && (
        <span className="depth-actions__set">
          <button type="button" className="depth-actions__btn" disabled={busy || at <= 0} onClick={() => onMove("top")}>
            <ArrowLineUp size={14} weight="bold" aria-hidden="true" />
            {row.starters > 1 ? m.toTop : m.start}
          </button>
          <button
            type="button"
            className="depth-actions__btn"
            disabled={busy || at <= 0}
            aria-label={m.moveUp}
            title={m.moveUp}
            onClick={() => onMove("up")}
          >
            <ArrowUp size={14} weight="bold" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="depth-actions__btn"
            disabled={busy || at < 0 || at >= row.players.length - 1}
            aria-label={m.moveDown}
            title={m.moveDown}
            onClick={() => onMove("down")}
          >
            <ArrowDown size={14} weight="bold" aria-hidden="true" />
          </button>
        </span>
      )}
      {roles.length > 0 && (
        <Dropdown
          label={m.playAt}
          value={row.role}
          size="md"
          disabled={busy}
          options={[
            { value: row.role, label: row.role, hint: m.hereNow },
            ...roles.map((r) => ({ value: r.role, label: r.role, hint: r.label })),
          ]}
          onChange={(v) => v !== row.role && onRole(v)}
        />
      )}
      {options && options.length > 1 && here && (
        <Dropdown
          label={m.position}
          value={here.pos}
          size="md"
          disabled={busy}
          options={options.map((o) => ({
            value: o.pos,
            label: o.pos,
            hint: o.current ? m.hereNowOvr(o.overall) : m.wouldBe(o.overall),
          }))}
          onChange={(v) => v !== here.pos && onPosition(v)}
        />
      )}
      {rs &&
        (rs.on || rs.can ? (
          <Tooltip title={m.redshirt} text={rs.on ? m.redshirtOnTip : m.redshirtTip(rs.games, rs.limit)}>
            <button
              type="button"
              className={`depth-actions__btn${rs.on ? " is-on" : ""}`}
              aria-pressed={rs.on}
              disabled={busy}
              onClick={() => onRedshirt(!rs.on)}
            >
              {rs.on ? m.pullRedshirt : m.redshirt}
            </button>
          </Tooltip>
        ) : (
          <Tooltip title={m.redshirt} text={m.redshirtNo(rs.why ?? "")}>
            <button type="button" className="depth-actions__btn" disabled>
              {m.redshirt}
            </button>
          </Tooltip>
        ))}
    </div>
  );
}
