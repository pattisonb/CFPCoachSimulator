import { useEffect, useRef } from "react";
import { darken, hexToRgb, inkOn } from "../../colors.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

/**
 * A spinning pixel football: a 6×3 lens lit from above while the laces roll round it over four
 * frames (front, under, behind, over the top), with a 1 px outline.
 *   X outline · A lit leather · B shaded leather · W lace (white) · G lace (grey) · . transparent
 */
const FRAMES = [
  ["..XXXX..", ".XAAAAX.", "XAAWGAAX", ".XBBBBX.", "..XXXX.."],
  ["..XXXX..", ".XAAAAX.", "XAAAAAAX", ".XBGWBX.", "..XXXX.."],
  ["..XXXX..", ".XAAAAX.", "XAAAAAAX", ".XBBBBX.", "..XXXX.."],
  ["..XXXX..", ".XAAGWX.", "XAAAAAAX", ".XBBBBX.", "..XXXX.."],
];
const COLORS: Record<string, string> = { X: "#140c08", A: "#763e17", B: "#4a260e", W: "#ececec", G: "#969696" };
const FPS = 7;

/** *tune* How much of the lit color the shaded underside keeps. */
const SHADE = 0.62;

/** The ball's colors with a team's on the leather: its color lit, a darker one under it, laces that read against it. */
function paletteFor(color: string | undefined): Record<string, string> {
  if (!color || !/^#[0-9a-f]{3,8}$/i.test(color)) return COLORS;
  const [r, g, b] = darken(hexToRgb(color), SHADE);
  const light = inkOn(color) === "#fff";
  return {
    ...COLORS,
    A: color,
    B: `rgb(${r} ${g} ${b})`,
    W: light ? "#ececec" : "#1c1c1c",
    G: light ? "#969696" : "#4a4a4a",
  };
}

function draw(ctx: CanvasRenderingContext2D, rows: string[], colors: Record<string, string>) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const c = colors[row[x]];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }
  });
}

/**
 * Drawn at its own 8×5 pixels and scaled up by CSS. Holds still when the viewer asks for less motion. `color`: a
 * team's color (hex) for the leather, in place of the brown.
 */
export default function BallLogo({ color }: { color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const colors = paletteFor(color);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      draw(ctx, FRAMES[0], colors);
      return;
    }
    let raf = 0;
    let shown = -1;
    const tick = (now: number) => {
      const frame = Math.floor((now / 1000) * FPS) % FRAMES.length;
      if (frame !== shown) {
        draw(ctx, FRAMES[frame], colors);
        shown = frame;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [color]);

  return <canvas ref={ref} className="ball-logo" width={8} height={5} role="img" aria-label={m.label} />;
}
