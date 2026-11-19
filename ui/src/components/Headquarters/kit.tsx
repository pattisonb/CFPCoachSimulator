import { useState, type ReactNode } from "react";
import { CaretDown, Star } from "@phosphor-icons/react";
import RangeBar from "../RangeBar/index.tsx";
import PlayerLink from "../PlayerLink/index.tsx";
import { messages as m } from "./messages.ts";
import type { Ctx, Size, Who } from "./types.ts";

// The kit: the pieces every Headquarters widget draws with (web/hq.js kit), so thirty cards read as one board.

/** A label in Title Case, small words lowercase inside it ("Behind, in the picture" → "Behind, In the Picture"). */
const SMALL = new Set(["a", "an", "the", "of", "to", "for", "and", "or", "in", "on", "at", "by"]);
export const title = (text: string | null | undefined) =>
  String(text ?? "")
    .split(" ")
    .map((w, i, all) => {
      const bare = w.replace(/^[^A-Za-z]+/, "").toLowerCase();
      if (!bare) return w;
      const small = SMALL.has(bare.replace(/[^a-z]/g, "")) && i > 0 && i < all.length - 1 && !/[,:]$/.test(all[i - 1]);
      return small ? w : w.replace(/[A-Za-z]/, (c) => c.toUpperCase());
    })
    .join(" ");

/** How many rows a list holds at a size (the card's body scrolls, so these are generous). */
export const rowsFor = (size: Size) => ({ S: 20, M: 30, L: 50 })[size];

export const posOf = (r: Who) => r.display_pos || r.position || "";

/** "3 Looks", "1 Flag" */
export const plural = (n: number, one: string, many?: string) => `${n} ${n === 1 ? one : (many ?? `${one}s`)}`;

/** A sentence in the soft color: an empty widget says why, and what fills it. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="hq-empty-line">{children}</p>;
}

/** Big numbers over their labels, as many across as fit. */
export function Stats({ pairs }: { pairs: [ReactNode, string][] }) {
  return (
    <dl className="hq-stats">
      {pairs.map(([v, k]) => (
        <div key={k} className="hq-stat">
          <dd>{v}</dd>
          <dt>{k}</dt>
        </div>
      ))}
    </dl>
  );
}

/** A list of one-line rows, a hairline between them. A row's children are its cells (`hq-grow` takes the room). */
export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={["hq-list", className].filter(Boolean).join(" ")}>{children}</ul>;
}

/** A table: heads, rows of cells, and which row is yours (it reads in bold on a tint). */
export function Table({ heads, rows, mine }: { heads: string[]; rows: ReactNode[][]; mine?: (i: number) => boolean }) {
  return (
    <table className="hq-table">
      <thead>
        <tr>
          {heads.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={mine?.(i) ? "is-mine" : undefined}>
            {r.map((c, j) => (
              <td key={j}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A labeled meter: the label, the value in words, a bar filled 0 to 1 (soft: a count you would rather was low). */
export function Meter({ label, words, frac, soft }: { label: string; words: string; frac: number; soft?: boolean }) {
  const pct = Math.round(100 * Math.max(0, Math.min(1, frac || 0)));
  return (
    <div className="hq-meter">
      <div className="hq-meter__top">
        <span>{label}</span>
        <b>{words}</b>
      </div>
      <RangeBar lo={0} hi={pct} soft={soft} />
    </div>
  );
}

/** A small line chart over points [x label, y], drawn in ink: the line, a tint under it, a square at each point. */
export function Chart({ points }: { points: [string, number][] }) {
  const W = 300;
  const H = 120;
  const pad = 18;
  const top = Math.max(1, ...points.map((p) => p[1]));
  const x = (i: number) => pad + (points.length < 2 ? (W - 2 * pad) / 2 : (i * (W - 2 * pad)) / (points.length - 1));
  const y = (v: number) => H - pad - (v / top) * (H - 2 * pad);
  const line = points.map((p, i) => `${x(i)},${y(p[1])}`).join(" ");
  const step = Math.max(1, Math.ceil(points.length / 6));
  return (
    <svg className="hq-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={m.chartLabel(points.length)}>
      {points.length > 0 && (
        <>
          <polygon
            className="hq-chart__area"
            points={`${x(0)},${H - pad} ${line} ${x(points.length - 1)},${H - pad}`}
          />
          <polyline className="hq-chart__line" points={line} />
          {points.map((p, i) => (
            <rect key={i} className="hq-chart__dot" x={x(i) - 3.5} y={y(p[1]) - 3.5} width={7} height={7} />
          ))}
          {points.map((p, i) =>
            i % step === 0 || i === points.length - 1 ? (
              <text key={`t${i}`} x={x(i)} y={H - 3} textAnchor="middle">
                {p[0]}
              </text>
            ) : null,
          )}
        </>
      )}
    </svg>
  );
}

/** A small boxed word: a standing, a status, a week. `solid` fills it with ink (a commit, a goal met). */
export function Tag({ children, solid, soft }: { children: ReactNode; solid?: boolean; soft?: boolean }) {
  return <span className={`hq-tag${solid ? " is-solid" : ""}${soft ? " is-soft" : ""}`}>{children}</span>;
}

/** A recruit's stars as a number and one star, "4★", where a name line must stay one line. */
export function StarsShort({ n }: { n: number | null | undefined }) {
  if (n == null) return null;
  return (
    <span className="hq-stars" aria-label={m.stars(n)}>
      {n}
      <Star size={11} weight="fill" aria-hidden="true" />
    </span>
  );
}

/** A recruit's name: it opens him on the Recruiting board. In a sample it is only his name. */
export function RName({
  ctx,
  pid,
  children,
  grow = true,
}: {
  ctx: Ctx;
  pid: string;
  children: ReactNode;
  grow?: boolean;
}) {
  const cls = `hq-link${grow ? " hq-grow" : ""}`;
  if (ctx.sample) return <span className={cls}>{children}</span>;
  return (
    <button type="button" className={cls} onClick={() => ctx.openRecruit(pid)}>
      {children}
    </button>
  );
}

/** One of your players' names: it opens his card in a window. */
export function PName({ ctx, name, pos }: { ctx: Ctx; name: string; pos?: string }) {
  if (ctx.sample) return <span className="hq-link hq-grow">{name}</span>;
  return <PlayerLink team={ctx.team} name={name} position={pos} className="hq-link hq-grow" />;
}

// the widgets' filter picks, by widget id: they last the visit, across redraws and section changes
const PICKS: Record<string, Record<string, string>> = {};

/**
 * Filter pills over a widget's rows: a pill a column worth filtering ([key, label, get]), then what `render` draws
 * from the rows left. A column with one value filters nothing and shows no pill. Each pill is the browser's own
 * select, dressed as a pill, so the keyboard works and its menu is never clipped by the card.
 */
export function Filtered<T>({
  id,
  rows,
  cols,
  render,
  none = m.noMatch,
}: {
  id: string;
  rows: T[];
  cols: [string, string, (r: T) => string | null | undefined][];
  render: (rows: T[]) => ReactNode;
  none?: string;
}) {
  const [picks, setPicks] = useState<Record<string, string>>(() => PICKS[id] ?? {});
  const val = (get: (r: T) => string | null | undefined, r: T) => get(r) ?? "";
  const pills = cols
    .map(([key, label, get]) => {
      const vals = [...new Set(rows.map((r) => val(get, r)))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      return { key, label, vals, on: vals.includes(picks[key]) ? picks[key] : "" };
    })
    .filter((p) => p.vals.length > 1);
  const live = Object.fromEntries(pills.map((p) => [p.key, p.on]));
  const shown = rows.filter((r) => cols.every(([key, , get]) => !live[key] || val(get, r) === live[key]));
  const pick = (key: string, v: string) => {
    const next = { ...picks, [key]: v };
    PICKS[id] = next;
    setPicks(next);
  };
  return (
    <div className="hq-filtered">
      {pills.length > 0 && (
        <div className="hq-filters">
          {pills.map((p) => (
            <label key={p.key} className={`hq-pill${p.on ? " is-on" : ""}`}>
              <span className="hq-pill__k">{p.label}</span>
              <select value={p.on} aria-label={p.label} onChange={(e) => pick(p.key, e.target.value)}>
                <option value="">{m.all}</option>
                {p.vals.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <CaretDown size={10} weight="bold" aria-hidden="true" />
            </label>
          ))}
        </div>
      )}
      {shown.length ? render(shown) : <Empty>{none}</Empty>}
    </div>
  );
}
