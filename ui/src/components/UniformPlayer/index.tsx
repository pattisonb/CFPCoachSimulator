import { useEffect, useRef, useState } from "react";
import sheetUrl from "../../assets/qb-idle.png";
import { messages as m } from "./messages.ts";
import "./index.css";

// The quarterback's idle with the ball (sprite-test's pf art, `quarterback/idle-with-ball/idle-alt.png`): two 48 x 48
// frames in a black kit with white pants. The kit takes the program's primary color; the trim (helmet stripe, shoulders,
// sleeves) and the pants take its secondary.

const FRAME = 48;
/** *tune* How long each of the two idle frames shows. */
const FRAME_MS = 650;
/** Rows of the frame: the pants start at PANTS_TOP, the cleats (left white) at CLEATS_TOP. */
const PANTS_TOP = 27;
const CLEATS_TOP = 37;

const KIT = 0x212121;
const KIT_SHADE = 0x434343;
const WHITE = 0xffffff;
const PANTS_SHADE = new Set([0xadadad, 0xa5a5a5]);
const BALL = new Set([0x822a2a, 0x441914]);

export interface Uniform {
  primary: string;
  secondary: string;
}

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const n = parseInt(/^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? "777777", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A color's shade: darker, or lighter when it is already near black (so the shading still shows). */
function shade([r, g, b]: RGB): RGB {
  const dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 40;
  const mix = (c: number) => Math.round(dark ? c + (255 - c) * 0.22 : c * 0.68);
  return [mix(r), mix(g), mix(b)];
}

interface Sheet {
  data: ImageData;
  /** the opaque pixels' box over both frames, so the drawing is cropped tight */
  box: { x: number; y: number; w: number; h: number };
}

let sheet: Promise<Sheet> | null = null;
function loadSheet(): Promise<Sheet> {
  sheet ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      let x0 = FRAME,
        y0 = c.height,
        x1 = 0,
        y1 = 0;
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++) {
          if (data.data[(y * c.width + x) * 4 + 3] < 128) continue;
          const fx = x % FRAME;
          x0 = Math.min(x0, fx);
          x1 = Math.max(x1, fx);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
      resolve({ data, box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } });
    };
    img.onerror = reject;
    img.src = sheetUrl;
  });
  return sheet;
}

/** One frame, cropped and repainted in the uniform's colors. */
function paint({ data, box }: Sheet, frame: number, u: Uniform): ImageData {
  const primary = hexToRgb(u.primary);
  const secondary = hexToRgb(u.secondary);
  const parts = { primary, primaryShade: shade(primary), secondary, secondaryShade: shade(secondary) };
  const out = new ImageData(box.w, box.h);
  const src = data.data;
  const at = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= FRAME || y >= data.height) return -1;
    const i = (y * data.width + frame * FRAME + x) * 4;
    return src[i + 3] < 128 ? -1 : (src[i] << 16) | (src[i + 1] << 8) | src[i + 2];
  };
  for (let y = 0; y < box.h; y++)
    for (let x = 0; x < box.w; x++) {
      const fx = box.x + x;
      const fy = box.y + y;
      const i = (fy * data.width + frame * FRAME + fx) * 4;
      const o = (y * box.w + x) * 4;
      if (src[i + 3] < 128) continue;
      const c = at(fx, fy);
      let to: RGB | null = null;
      if (c === KIT || c === KIT_SHADE) {
        // the helmet, the jersey and the socks
        to = c === KIT ? parts.primary : parts.primaryShade;
      } else if (c === WHITE && fy < CLEATS_TOP) {
        const laces = [at(fx + 1, fy), at(fx - 1, fy), at(fx, fy + 1), at(fx, fy - 1)].some((n) => BALL.has(n));
        if (!laces) to = parts.secondary; // the helmet stripe, the shoulder and sleeve trim, the pants
      } else if (PANTS_SHADE.has(c) && fy >= PANTS_TOP && fy < CLEATS_TOP) {
        to = parts.secondaryShade;
      }
      out.data[o] = to ? to[0] : src[i];
      out.data[o + 1] = to ? to[1] : src[i + 1];
      out.data[o + 2] = to ? to[2] : src[i + 2];
      out.data[o + 3] = 255;
    }
  return out;
}

interface Props extends Uniform {
  /** whole-number pixel scale; leave it out to size the drawing in CSS (set a height, width: auto) */
  scale?: number;
  /** the team's name, for screen readers */
  team?: string;
  className?: string;
}

/** The quarterback standing with the ball, in a program's uniform, idling between two frames. */
export default function UniformPlayer({ primary, secondary, scale, team, className }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState<Sheet | null>(null);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    let live = true;
    loadSheet()
      .then((s) => live && setLoaded(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setFrame((f) => 1 - f), FRAME_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !loaded) return;
    c.getContext("2d")?.putImageData(paint(loaded, frame, { primary, secondary }), 0, 0);
  }, [loaded, frame, primary, secondary]);

  const w = loaded?.box.w ?? 21;
  const h = loaded?.box.h ?? 35;
  return (
    <canvas
      ref={canvas}
      className={["uniform-player", className].filter(Boolean).join(" ")}
      width={w}
      height={h}
      style={scale ? { width: w * scale, height: h * scale } : undefined}
      role="img"
      aria-label={team ? m.label(team) : m.fallback}
    />
  );
}
