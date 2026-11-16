import { useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import { PIXEL_COLS, PIXEL_ROWS, PIXEL_ROWS_DATA } from "./usPixels.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

/** *tune* The shades a state can take, lightest to darkest (the share of ink mixed in). */
const SHADES = [10, 24, 40, 56, 72, 90];
/** *tune* From this shade on, a state's label is drawn light on it. */
const DARK_FROM = 56;
/** *tune* Callout labels (states too small to hold their own) stack at least this far apart, in cells. */
const CALLOUT_GAP = 1.5;
/** *tune* How far past the map's edge the callout column sits, in cells. */
const CALLOUT_OUT = 3;

type Cell = [number, number];

/** The state in a cell ("..": none, or off the grid). */
export const at = (c: number, r: number) =>
  r < 0 || r >= PIXEL_ROWS || c < 0 || c >= PIXEL_COLS ? ".." : PIXEL_ROWS_DATA[r].slice(c * 2, c * 2 + 2);

interface StateShape {
  /** its pixels as one path of unit squares */
  fill: string;
  /** its outline: every cell side that faces another state or the sea */
  outline: string;
  /** its middle (for the board pixel and a callout's leader) */
  mid: Cell;
  /** where its two letters go: inside it (two cells wide), or out in a callout column */
  label: { x: number; y: number; inside: boolean };
}

/**
 * The map's shapes, worked out once from the generated grid (tools/pixel_map.py): each state's pixels and outline,
 * the borders between states, and a place for each label. A label sits on the pair of side-by-side cells deepest
 * inside its state (a distance from the border, counted in cells); a state with no such pair (RI, DE, DC…) gets a
 * callout beside the map, on the side it's nearer, with a leader line.
 */
export const SHAPES = (() => {
  const cells = new Map<string, Cell[]>();
  for (let r = 0; r < PIXEL_ROWS; r++)
    for (let c = 0; c < PIXEL_COLS; c++) {
      const st = at(c, r);
      if (st === "..") continue;
      if (!cells.has(st)) cells.set(st, []);
      cells.get(st)!.push([c, r]);
    }

  // the borders between two states, each side drawn once
  let borders = "";
  for (let r = 0; r < PIXEL_ROWS; r++)
    for (let c = 0; c < PIXEL_COLS; c++) {
      const st = at(c, r);
      if (st === "..") continue;
      const right = at(c + 1, r);
      const below = at(c, r + 1);
      if (right !== ".." && right !== st) borders += `M${c + 1} ${r}v1`;
      if (below !== ".." && below !== st) borders += `M${c} ${r + 1}h1`;
    }

  const shapes = new Map<string, StateShape>();
  const callouts: { st: string; side: -1 | 1; y: number }[] = [];
  for (const [st, list] of cells) {
    let fill = "";
    let outline = "";
    // distance from the border: 1 on the edge, growing inward
    const depth = new Map<string, number>();
    const queue: Cell[] = [];
    for (const [c, r] of list) {
      fill += `M${c} ${r}h1v1h-1z`;
      if (at(c, r - 1) !== st) outline += `M${c} ${r}h1`;
      if (at(c + 1, r) !== st) outline += `M${c + 1} ${r}v1`;
      if (at(c, r + 1) !== st) outline += `M${c} ${r + 1}h1`;
      if (at(c - 1, r) !== st) outline += `M${c} ${r}v1`;
      const edge = [at(c - 1, r), at(c + 1, r), at(c, r - 1), at(c, r + 1)].some((n) => n !== st);
      if (edge) {
        depth.set(`${c},${r}`, 1);
        queue.push([c, r]);
      }
    }
    for (let i = 0; i < queue.length; i++) {
      const [c, r] = queue[i];
      const d = depth.get(`${c},${r}`)!;
      for (const [x, y] of [
        [c - 1, r],
        [c + 1, r],
        [c, r - 1],
        [c, r + 1],
      ] as Cell[]) {
        if (at(x, y) === st && !depth.has(`${x},${y}`)) {
          depth.set(`${x},${y}`, d + 1);
          queue.push([x, y]);
        }
      }
    }
    const cx = list.reduce((a, [c]) => a + c, 0) / list.length;
    const cy = list.reduce((a, [, r]) => a + r, 0) / list.length;
    const mid = list.reduce((best, cell) =>
      (cell[0] - cx) ** 2 + (cell[1] - cy) ** 2 < (best[0] - cx) ** 2 + (best[1] - cy) ** 2 ? cell : best,
    );
    // the deepest pair of side-by-side cells, nearest the middle among equals
    let best: { c: number; r: number; d: number; off: number } | null = null;
    for (const [c, r] of list) {
      if (at(c + 1, r) !== st) continue;
      const d = Math.min(depth.get(`${c},${r}`)!, depth.get(`${c + 1},${r}`)!);
      const off = (c + 1 - cx - 0.5) ** 2 + (r - cy) ** 2;
      if (!best || d > best.d || (d === best.d && off < best.off)) best = { c, r, d, off };
    }
    const inside = !!best && (best.d >= 2 || list.length >= 6);
    // an island state (no neighbors: Hawaii) labels itself just above, no leader needed
    const alone = list.every(([c, r]) =>
      [at(c - 1, r), at(c + 1, r), at(c, r - 1), at(c, r + 1)].every((n) => n === st || n === ".."),
    );
    const top = Math.min(...list.map(([, r]) => r));
    shapes.set(st, {
      fill,
      outline,
      mid,
      label:
        inside && best
          ? { x: best.c + 1, y: best.r + 0.5, inside: true }
          : alone
            ? { x: cx + 0.5, y: top - 0.9, inside: true }
            : { x: 0, y: 0, inside: false },
    });
    if (!inside && !alone) callouts.push({ st, side: cx < PIXEL_COLS / 2 ? -1 : 1, y: mid[1] + 0.5 });
  }

  // callouts: a column each side, stacked by height so none overlap
  for (const side of [-1, 1] as const) {
    const col = callouts.filter((k) => k.side === side).sort((a, b) => a.y - b.y);
    let last = -Infinity;
    for (const k of col) {
      const y = Math.max(k.y, last + CALLOUT_GAP);
      last = y;
      const s = shapes.get(k.st)!;
      s.label = { x: side < 0 ? -CALLOUT_OUT : PIXEL_COLS + CALLOUT_OUT, y, inside: false };
    }
  }
  const left = callouts.some((k) => k.side < 0);
  const right = callouts.some((k) => k.side > 0);
  return { shapes, borders, left, right };
})();

export interface StateCount {
  n: number;
  blue: number;
  board: number;
}

interface Props {
  counts: Record<string, StateCount>;
  /** the state picked (filters the list), if any */
  value: string | null;
  onPick: (state: string | null) => void;
  /** the big map: each state's two letters (small ones in callouts beside it) */
  labels?: boolean;
}

/**
 * A pixel map of the class, drawn from the real state outlines (Albers USA, Alaska and Hawaii inset): every state a
 * patch of pixels with its own outline, shaded by how many prospects live there, a lit pixel at its middle where
 * you have someone on your board. With `labels`, each state carries its two letters. Pointing at a state lights it
 * and names it under the map; picking one filters the list (picking it again clears it).
 */
export default function TileMap({ counts, value, onPick, labels = false }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const most = useMemo(() => Math.max(1, ...Object.values(counts).map((c) => c.n)), [counts]);
  const shade = (n: number) =>
    n ? SHADES[Math.min(SHADES.length - 1, 1 + Math.floor((n / most) * (SHADES.length - 1.01)))] : SHADES[0];
  const shown = hover ?? value;
  const c = shown ? (counts[shown] ?? { n: 0, blue: 0, board: 0 }) : null;

  const x0 = labels && SHAPES.left ? -CALLOUT_OUT - 2 : 0;
  const x1 = labels && SHAPES.right ? PIXEL_COLS + CALLOUT_OUT + 2 : PIXEL_COLS;
  const key = (st: string) => (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onPick(value === st ? null : st);
  };
  const states = [...SHAPES.shapes.entries()];

  return (
    <div className={["tile-map", labels && "tile-map--big", value && "has-pick"].filter(Boolean).join(" ")}>
      <svg
        className="tile-map__svg"
        viewBox={`${x0} -0.5 ${x1 - x0} ${PIXEL_ROWS + 1}`}
        role="group"
        aria-label={m.label}
        onMouseLeave={() => setHover(null)}
      >
        {/* the states: fills (and a small state's callout), each one a button */}
        {states.map(([st, s]) => {
          const n = counts[st] ?? { n: 0, blue: 0, board: 0 };
          const live = n.n > 0;
          return (
            <g
              key={st}
              className={["tile-map__state", live && "is-live", value === st && "is-on", hover === st && "is-hover"]
                .filter(Boolean)
                .join(" ")}
              style={{ "--tile-ink": `${shade(n.n)}%` } as CSSProperties}
              role={live ? "button" : undefined}
              tabIndex={live ? 0 : undefined}
              aria-pressed={live ? value === st : undefined}
              aria-label={m.tile(st, n.n, n.blue, n.board)}
              onMouseEnter={() => setHover(st)}
              onFocus={() => setHover(st)}
              onBlur={() => setHover(null)}
              onClick={live ? () => onPick(value === st ? null : st) : undefined}
              onKeyDown={live ? key(st) : undefined}
            >
              <path className="tile-map__fill" d={s.fill} />
              {labels && !s.label.inside && (
                <>
                  <path
                    className="tile-map__leader"
                    d={`M${s.mid[0] + 0.5} ${s.mid[1] + 0.5}L${s.label.x + (s.label.x < 0 ? 1.4 : -1.4)} ${s.label.y}`}
                  />
                  <text className="tile-map__label tile-map__label--out" x={s.label.x} y={s.label.y}>
                    {st}
                  </text>
                </>
              )}
            </g>
          );
        })}
        {/* the borders between states, over every fill */}
        <path className="tile-map__borders" d={SHAPES.borders} />
        {/* on top, never in the pointer's way: the lit state's outline, the board pixels, the labels inside */}
        <g className="tile-map__over" aria-hidden="true">
          {/* the picked state, raised off the map like a card: solid ink on a hard pixel shadow */}
          {value && SHAPES.shapes.get(value) && (
            <g className="tile-map__raised">
              <path
                className="tile-map__raised-shadow"
                d={SHAPES.shapes.get(value)!.fill}
                transform="translate(0.4 0.4)"
              />
              <path
                className="tile-map__raised-fill"
                d={SHAPES.shapes.get(value)!.fill}
                transform="translate(-0.15 -0.15)"
              />
              <path
                className="tile-map__raised-edge"
                d={SHAPES.shapes.get(value)!.outline}
                transform="translate(-0.15 -0.15)"
              />
            </g>
          )}
          {hover && hover !== value && SHAPES.shapes.get(hover) && (
            <path className="tile-map__outline" d={SHAPES.shapes.get(hover)!.outline} />
          )}
          {states.map(([st, s]) =>
            (counts[st]?.board ?? 0) > 0 ? (
              <rect key={st} className="tile-map__dot" x={s.mid[0] + 0.3} y={s.mid[1] + 0.3} width={0.4} height={0.4} />
            ) : null,
          )}
          {labels &&
            states.map(([st, s]) => {
              if (!s.label.inside) return null;
              const lit = st === value || st === hover;
              const dark = lit || shade(counts[st]?.n ?? 0) >= DARK_FROM;
              const up = st === value ? -0.15 : 0;
              return (
                <text
                  key={st}
                  className={`tile-map__label${dark ? " is-dark" : ""}`}
                  x={s.label.x + up}
                  y={s.label.y + up}
                >
                  {st}
                </text>
              );
            })}
        </g>
      </svg>
      {/* the line under the map: the state pointed at or picked, and a way to clear the pick (it stays one line, so
          nothing around the map moves) */}
      <div className="tile-map__readout">
        <span aria-live="polite">{shown && c ? m.readout(shown, c.n, c.blue, c.board) : m.hint}</span>
        {value && (
          <button type="button" className="tile-map__clear" onClick={() => onPick(null)}>
            {m.clear(value)}
          </button>
        )}
      </div>
      <div className="tile-map__legend" aria-hidden="true">
        <span>{m.fewer}</span>
        {SHADES.slice(1).map((s) => (
          <i key={s} style={{ "--tile-ink": `${s}%` } as CSSProperties} />
        ))}
        <span>{m.more}</span>
        <span className="tile-map__legend-board">
          <i className="tile-map__legend-dot" />
          {m.onBoard}
        </span>
      </div>
    </div>
  );
}
