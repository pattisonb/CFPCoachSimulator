import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { PIXEL_COLS, PIXEL_ROWS, PIXEL_ROWS_DATA } from "./usPixels.ts";
import Dropdown from "../Dropdown/index.tsx";
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
  /** the cells it spans: left, top, right, bottom (the one-state view frames it) */
  box: [number, number, number, number];
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
      box: [
        Math.min(...list.map(([c]) => c)),
        top,
        Math.max(...list.map(([c]) => c)) + 1,
        Math.max(...list.map(([, r]) => r)) + 1,
      ],
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
  board: number;
}

/** The grid's own projection (worked out against tools/pixel_map.py's source: Albers USA at 975 x 610, 68 cells
 * across, cropped one cell at the left and top). Alaska and Hawaii sit in insets and are not projected. */
const ALBERS = { k: 1300, tx: 487.5, ty: 305, cell: 975 / 68, c0: 1, r0: 1 };
const RAD = Math.PI / 180;

/** A place in the lower 48 as map cells (x across, y down). */
export function project(lat: number, lon: number): [number, number] {
  const n = (Math.sin(29.5 * RAD) + Math.sin(45.5 * RAD)) / 2;
  const c = Math.cos(29.5 * RAD) ** 2 + 2 * n * Math.sin(29.5 * RAD);
  const raw = (lam: number, phi: number): [number, number] => {
    const r = Math.sqrt(c - 2 * n * Math.sin(phi)) / n;
    return [r * Math.sin(lam * n), Math.sqrt(c) / n - r * Math.cos(lam * n)];
  };
  const [cx, cy] = raw(-0.6 * RAD, 38.7 * RAD);
  const [x, y] = raw((lon + 96) * RAD, lat * RAD);
  return [
    (ALBERS.tx + ALBERS.k * (x - cx)) / ALBERS.cell - ALBERS.c0,
    (ALBERS.ty - ALBERS.k * (y - cy)) / ALBERS.cell - ALBERS.r0,
  ];
}

/** Where a town of `st` goes on the map: its own spot when that lands in its state, else the state's nearest cell
 * (a coarse grid gives a border town to the neighbor); the state's middle with no place known. */
export function spot(st: string, lat: number | null, lon: number | null): [number, number] | null {
  const shape = SHAPES.shapes.get(st);
  if (!shape) return null;
  if (lat == null || lon == null || st === "AK" || st === "HI") return [shape.mid[0] + 0.5, shape.mid[1] + 0.5];
  const [x, y] = project(lat, lon);
  if (at(Math.floor(x), Math.floor(y)) === st) return [x, y];
  let best: [number, number] = [shape.mid[0] + 0.5, shape.mid[1] + 0.5];
  let far = Infinity;
  for (let r = 0; r < PIXEL_ROWS; r++)
    for (let c = 0; c < PIXEL_COLS; c++) {
      if (at(c, r) !== st) continue;
      const d = (c + 0.5 - x) ** 2 + (r + 0.5 - y) ** 2;
      if (d < far) [far, best] = [d, [c + 0.5, r + 0.5]];
    }
  return best;
}

/** *tune* How long the view takes to close in on a state, or to pull back, in ms. */
const ZOOM_MS = 480;

type Box = [number, number, number, number];

/** An svg whose view box glides to `to` when it changes (ease out; at once for a reader who asked for less motion).
 * The box is written straight to the element, frame by frame, so the map is not drawn again for each step. */
function useGlide(to: Box) {
  const svg = useRef<SVGSVGElement>(null);
  const at = useRef<Box | null>(null);
  const key = to.join(" ");
  useLayoutEffect(() => {
    const el = svg.current;
    if (!el) return;
    const put = (b: Box) => {
      at.current = b;
      el.setAttribute("viewBox", b.map((v) => v.toFixed(3)).join(" "));
    };
    const from = at.current;
    if (!from || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      put(to);
      return;
    }
    // while it moves the pixels are drawn smooth (is-gliding): crisp edges snap to the screen's grid at every step,
    // which shows as a shake; they come back crisp when it lands
    let start = 0;
    let frame = 0;
    el.classList.add("is-gliding");
    const step = (now: number) => {
      start ||= now;
      const t = Math.min(1, (now - start) / ZOOM_MS);
      const e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2; // ease in and out
      put(from.map((v, i) => v + (to[i] - v) * e) as Box);
      if (t < 1) frame = requestAnimationFrame(step);
      else el.classList.remove("is-gliding");
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      el.classList.remove("is-gliding");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return svg;
}

/** *tune* The one-state view: cells of room around the state, how many towns it names, and how near two named towns
 * are lettered (a share of the view's width; a name that would run into one already placed is left out). */
const ZOOM = { pad: 2.2, towns: 9, font: 0.02 };

/** *tune* A board dot's size in map cells: the small map, the big one. */
const DOT = { small: 1.1, big: 0.6 };

/** *tune* Your school's star: its outer radius in map pixels. */
const STAR_R = 0.62;
/** A five-point star's corners around (cx, cy), for an SVG polygon. */
const star = (cx: number, cy: number, r: number) =>
  Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const d = i % 2 ? r * 0.42 : r;
    return `${(cx + d * Math.cos(a)).toFixed(2)},${(cy + d * Math.sin(a)).toFixed(2)}`;
  }).join(" ");

interface Props {
  counts: Record<string, StateCount>;
  /** the state picked (filters the list), if any */
  value: string | null;
  onPick: (state: string | null) => void;
  /** the big map: each state's two letters (small ones in callouts beside it) */
  labels?: boolean;
  /** your school: a mark in its color on its state */
  school?: { state: string; color: string; name: string; second?: string } | null;
  /** recruits' hometowns and what each is to you ([state, lat, lon, "board offered scouted committed"]) */
  points?: [string, number | null, number | null, string?][];
  /** which of them get a dot ("none", "board", "offered", "scouted", "committed"), kept by the page so the small and
   * the big map agree */
  show?: string;
  onShow?: (show: string) => void;
  /** per state, its biggest towns of the class ([name, lat, lon, prospects]): with `labels`, picking a state fills
   * the map with it and names them */
  cities?: Record<string, [string, number, number, number][]>;
}

/**
 * A pixel map of the class, drawn from the real state outlines (Albers USA, Alaska and Hawaii inset): every state a
 * patch of pixels with its own outline, shaded by how many prospects live there, and a star in your school's color on
 * its state. With `labels`, each state carries its two letters. Pointing at a state lights it
 * and names it under the map; picking one filters the list (picking it again clears it).
 */
export default function TileMap({
  counts,
  value,
  onPick,
  labels = false,
  school,
  points,
  show = "none",
  onShow,
  cities,
}: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const dots = useMemo(
    () =>
      show !== "none" && points
        ? points
            .filter((p) => (p[3] ?? "board").split(" ").includes(show))
            .map(([st, lat, lon]) => spot(st, lat, lon))
            .filter((p) => p != null)
        : [],
    [show, points],
  );
  // the big map with a state picked: the view closes in on it, and its biggest towns are named (Alaska and Hawaii
  // sit in insets with no projection, so they only grow)
  const zoom = labels && cities && value ? (SHAPES.shapes.get(value)?.box ?? null) : null;
  const view = zoom
    ? {
        x: zoom[0] - ZOOM.pad,
        y: zoom[1] - ZOOM.pad,
        w: zoom[2] - zoom[0] + 2 * ZOOM.pad,
        h: zoom[3] - zoom[1] + 2 * ZOOM.pad,
      }
    : null;
  const span = view ? Math.max(view.w, view.h * 1.6) : 0;
  const towns = useMemo(() => {
    if (!zoom || !value || value === "AK" || value === "HI") return [];
    const out: { name: string; n: number; x: number; y: number; ty: number }[] = [];
    const font = span * ZOOM.font;
    // a name's box (about 0.62 of the font a letter): over his town, or under it when that runs into one placed
    const wide = (text: string) => (text.length + 3) * 0.62 * font;
    for (const [name, lat, lon, n] of cities?.[value] ?? []) {
      const at = spot(value, lat, lon);
      if (!at || out.length >= ZOOM.towns) continue;
      if (out.some((o) => Math.hypot(o.x - at[0], o.y - at[1]) < font * 1.2)) continue; // the same spot on the grid
      const w = wide(`${name} ${n}`);
      const ty = [at[1] - font, at[1] + font * 1.1].find(
        (y) =>
          !out.some(
            (o) => Math.abs(o.x - at[0]) < (w + wide(`${o.name} ${o.n}`)) / 2 && Math.abs(o.ty - y) < font * 1.3,
          ),
      );
      if (ty == null) continue;
      out.push({ name, n, x: at[0], y: at[1], ty });
    }
    return out;
  }, [zoom, value, cities, span]);
  const dot = view ? Math.max(0.14, span * 0.011) : labels ? DOT.big : DOT.small;
  const most = useMemo(() => Math.max(1, ...Object.values(counts).map((c) => c.n)), [counts]);
  const shade = (n: number) =>
    n ? SHADES[Math.min(SHADES.length - 1, 1 + Math.floor((n / most) * (SHADES.length - 1.01)))] : SHADES[0];
  const shown = hover ?? value;
  const c = shown ? (counts[shown] ?? { n: 0, board: 0 }) : null;

  const x0 = labels && SHAPES.left ? -CALLOUT_OUT - 2 : 0;
  const x1 = labels && SHAPES.right ? PIXEL_COLS + CALLOUT_OUT + 2 : PIXEL_COLS;
  const svgRef = useGlide(view ? [view.x, view.y, view.w, view.h] : [x0, -0.5, x1 - x0, PIXEL_ROWS + 1]);
  const key = (st: string) => (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onPick(value === st ? null : st);
  };
  const states = [...SHAPES.shapes.entries()];

  return (
    <div
      className={["tile-map", labels && "tile-map--big", value && "has-pick", view && "is-zoom"]
        .filter(Boolean)
        .join(" ")}
    >
      <svg className="tile-map__svg" ref={svgRef} role="group" aria-label={m.label} onMouseLeave={() => setHover(null)}>
        {/* the states: fills (and a small state's callout), each one a button */}
        {states.map(([st, s]) => {
          const n = counts[st] ?? { n: 0, board: 0 };
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
              aria-label={m.tile(st, n.n, n.board)}
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
          {/* your board, when asked for: a small pixel in your second color at each recruit's hometown */}
          {dots.map(([x, y], i) => (
            <rect
              key={i}
              className="tile-map__dot"
              x={x - dot / 2}
              y={y - dot / 2}
              width={dot}
              height={dot}
              style={school?.second ? { fill: school.second } : undefined}
            />
          ))}
          {/* your school: a small star in its color on its state (above the state's letters on the big map) */}
          {school && SHAPES.shapes.get(school.state) && (
            <polygon
              className="tile-map__school"
              points={star(
                SHAPES.shapes.get(school.state)!.mid[0] + 0.5,
                SHAPES.shapes.get(school.state)!.mid[1] + (labels && !view ? -0.9 : 0.5),
                view ? Math.max(0.22, span * 0.022) : STAR_R,
              )}
              style={{ fill: school.color }}
            >
              <title>{school.name}</title>
            </polygon>
          )}
          {/* the one-state view: its biggest towns of the class, each a pixel, its name and how many live there */}
          {towns.map((t) => (
            <g key={t.name} className="tile-map__town" style={{ fontSize: `${(span * ZOOM.font).toFixed(3)}px` }}>
              <rect x={t.x - span * 0.006} y={t.y - span * 0.006} width={span * 0.012} height={span * 0.012} />
              <text x={t.x} y={t.ty} style={{ strokeWidth: `${(span * ZOOM.font * 0.28).toFixed(3)}px` }}>
                {t.name} <tspan>{t.n}</tspan>
              </text>
            </g>
          ))}
          {labels &&
            states.map(([st, s]) => {
              if (!s.label.inside || (view && st === value)) return null;
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
        <span aria-live="polite" title={m.hint}>
          {shown && c ? m.readout(shown, c.n, c.board) : "\u00a0"}
        </span>
        {value && (
          <button type="button" className="tile-map__clear" onClick={() => onPick(null)}>
            {m.clear(value)}
          </button>
        )}
      </div>
      <div className="tile-map__legend">
        <span>{m.fewer}</span>
        {SHADES.slice(1).map((s) => (
          <i key={s} style={{ "--tile-ink": `${s}%` } as CSSProperties} />
        ))}
        <span>{m.more}</span>
        {onShow && (
          <Dropdown
            className="tile-map__legend-show"
            label={m.show}
            align="right"
            value={show}
            options={Object.entries(m.shows).map(([value, label]) => ({ value, label }))}
            onChange={onShow}
          />
        )}
      </div>
    </div>
  );
}
