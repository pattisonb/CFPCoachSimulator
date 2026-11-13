import { useEffect, useRef } from "react";
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

function draw(ctx: CanvasRenderingContext2D, rows: string[]) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const c = COLORS[row[x]];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }
  });
}

/** Drawn at its own 8×5 pixels and scaled up by CSS. Holds still when the viewer asks for less motion. */
export default function BallLogo() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      draw(ctx, FRAMES[0]);
      return;
    }
    let raf = 0;
    let shown = -1;
    const tick = (now: number) => {
      const frame = Math.floor((now / 1000) * FPS) % FRAMES.length;
      if (frame !== shown) {
        draw(ctx, FRAMES[frame]);
        shown = frame;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className="ball-logo" width={8} height={5} role="img" aria-label={m.label} />;
}
