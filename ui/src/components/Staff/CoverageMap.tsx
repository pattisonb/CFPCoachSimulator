import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Face from "../Face/index.tsx";
import { SHAPES, at } from "../TileMap/index.tsx";
import { PIXEL_COLS, PIXEL_ROWS } from "../TileMap/usPixels.ts";
import { staffFace } from "../../faces.ts";
import type { Scout } from "../../types.ts";
import { messages as m } from "./messages.ts";

interface Props {
  /** each area's states */
  areas: Record<string, string[]>;
  scouts: Scout[];
  /** the scout picked on the left: his area is raised, and picking an area sends him there */
  picked: Scout | null;
  onArea: (area: string) => void;
}

interface AreaShape {
  name: string;
  codes: string[];
  /** every state's pixels in it, as one path */
  fill: string;
  /** its edge: the cell sides facing another area or the sea */
  outline: string;
  /** its middle, in cells: where its scouts' faces sit */
  mid: [number, number];
}

/** The areas' shapes from the pixel map's states, worked out once per set of areas. */
function areaShapes(areas: Record<string, string[]>): AreaShape[] {
  const areaOf = new Map<string, string>();
  for (const [name, codes] of Object.entries(areas)) for (const c of codes) areaOf.set(c, name);
  const edges = new Map<string, string>();
  const sums = new Map<string, [number, number, number]>();
  for (let r = 0; r < PIXEL_ROWS; r++)
    for (let c = 0; c < PIXEL_COLS; c++) {
      const a = areaOf.get(at(c, r));
      if (!a) continue;
      const s = sums.get(a) ?? [0, 0, 0];
      sums.set(a, [s[0] + c, s[1] + r, s[2] + 1]);
      const out = (cc: number, rr: number) => areaOf.get(at(cc, rr)) !== a;
      let d = edges.get(a) ?? "";
      if (out(c, r - 1)) d += `M${c} ${r}h1`;
      if (out(c, r + 1)) d += `M${c} ${r + 1}h1`;
      if (out(c - 1, r)) d += `M${c} ${r}v1`;
      if (out(c + 1, r)) d += `M${c + 1} ${r}v1`;
      edges.set(a, d);
    }
  return Object.entries(areas).map(([name, codes]) => {
    const s = sums.get(name) ?? [0, 0, 1];
    return {
      name,
      codes,
      fill: codes.map((c) => SHAPES.shapes.get(c)?.fill ?? "").join(""),
      outline: edges.get(name) ?? "",
      mid: [s[0] / s[2], s[1] / s[2]],
    };
  });
}

/**
 * The country by scouting area: each area your staff covers shaded, with its scouts' faces on it; the uncovered
 * ones pale. The picked scout's area is raised; pick another area to send him there (with no scout picked, picking
 * an area picks its scout). Pointing at an area names it and who covers it under the map.
 */
export default function CoverageMap({ areas, scouts, picked, onArea }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  // the map keeps its shape inside whatever space the card gives it: a frame that size, centered, holds the map and
  // the faces placed on it by percent
  const box = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ratio = PIXEL_COLS / (PIXEL_ROWS + 1);
    const fit = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      const w = Math.min(width, height * ratio);
      setFrame({ w, h: w / ratio });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const shapes = useMemo(() => areaShapes(areas), [areas]);
  const byArea = useMemo(() => {
    const out = new Map<string, Scout[]>();
    for (const s of scouts) if (s.area) out.set(s.area, [...(out.get(s.area) ?? []), s]);
    return out;
  }, [scouts]);
  const mine = picked?.area ?? null;
  const raised = shapes.find((a) => a.name === mine);
  const shown = hover ?? mine;
  const key = (a: string) => (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onArea(a);
  };
  const who = (a: string) =>
    byArea
      .get(a)
      ?.map((s) => s.name)
      .join(", ") || m.uncovered;

  return (
    <div className="coverage">
      <div className="coverage__map" ref={box}>
        <div className="coverage__frame" style={frame ? { width: frame.w, height: frame.h } : { visibility: "hidden" }}>
          <svg
            className="coverage__svg"
            viewBox={`0 -0.5 ${PIXEL_COLS} ${PIXEL_ROWS + 1}`}
            role="group"
            aria-label={m.mapLabel}
            onMouseLeave={() => setHover(null)}
          >
            {/* every state, pale, under the areas (one outside every area stays pale) */}
            {[...SHAPES.shapes.values()].map((s, i) => (
              <path key={i} className="coverage__base" d={s.fill} />
            ))}
            {shapes.map((a) => (
              <g
                key={a.name}
                className={[
                  "coverage__area",
                  byArea.has(a.name) && "is-covered",
                  a.name === mine && "is-mine",
                  a.name === hover && "is-hover",
                ]
                  .filter(Boolean)
                  .join(" ")}
                role="button"
                tabIndex={0}
                aria-label={m.readout(a.name, who(a.name))}
                aria-pressed={a.name === mine}
                onMouseEnter={() => setHover(a.name)}
                onFocus={() => setHover(a.name)}
                onBlur={() => setHover(null)}
                onClick={() => onArea(a.name)}
                onKeyDown={key(a.name)}
              >
                <path className="coverage__fill" d={a.fill} />
              </g>
            ))}
            <path className="tile-map__borders" d={SHAPES.borders} />
            <g className="coverage__over" aria-hidden="true">
              {shapes.map((a) => (
                <path key={a.name} className="coverage__edge" d={a.outline} />
              ))}
              {raised && (
                <g>
                  <path className="coverage__raised-shadow" d={raised.fill} transform="translate(0.4 0.4)" />
                  <path className="coverage__raised-fill" d={raised.fill} transform="translate(-0.15 -0.15)" />
                  <path className="coverage__raised-edge" d={raised.outline} transform="translate(-0.15 -0.15)" />
                </g>
              )}
              {hover && hover !== mine && (
                <path className="coverage__hover" d={shapes.find((a) => a.name === hover)?.outline} />
              )}
            </g>
          </svg>
          {/* the scouts' faces on their areas (two on one area sit side by side) */}
          {shapes.map((a) => {
            const here = byArea.get(a.name);
            if (!here) return null;
            return (
              <span
                key={a.name}
                className={`coverage__pins${a.name === mine ? " is-mine" : ""}`}
                style={{
                  left: `${((a.mid[0] + 0.5) / PIXEL_COLS) * 100}%`,
                  top: `${((a.mid[1] + 1) / (PIXEL_ROWS + 1)) * 100}%`,
                }}
                aria-hidden="true"
              >
                {here.map((s) => (
                  <span key={s.id} className="face-tile coverage__pin" title={s.name}>
                    <Face face={staffFace(s.name)} scale={1} label="" />
                  </span>
                ))}
              </span>
            );
          })}
        </div>
      </div>
      {/* two fixed lines under the map, so nothing around it moves: the area pointed at (or his), then what to do */}
      <p className="coverage__readout" aria-live="polite">
        {shown ? (
          <>
            <b>{m.readout(shown, who(shown))}</b>
            <span className="coverage__states">{m.states(areas[shown] ?? [])}</span>
          </>
        ) : (
          " "
        )}
      </p>
      <p className="coverage__hint">{m.hint(picked?.name ?? null)}</p>
    </div>
  );
}
