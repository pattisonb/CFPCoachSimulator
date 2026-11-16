import { useEffect, useState } from "react";
import spriteUrl from "../../assets/helmet.png";
import { hexToRgb, shade, type RGB } from "../../colors.ts";
import "./index.css";

// The helmet sprite (assets/helmet.png): a 13 x 13 helmet facing right, drawn in a red shell with a darker red
// shade, a gray facemask, black outlines and two dark-gray pixels at the ear hole. The shell's reds take the team's
// primary color, scaled by how dark each red is in the art; the facemask can take a color of its own.

/** The art's shell red: every pixel of that hue (green = blue, red above them) is the shell, lit or shaded. */
const SHELL_RED = 172;
/** The art's shade red, and the deepest one at the facemask's corner. */
const SHADE_RED = 85;
const FACEMASK = 0x9badb7;

/** *tune* How much of the team color the helmet's shading keeps (and lifts, on a near-black color). */
const SHADE_KEEP = 0.55;
const SHADE_LIFT = 0.3;
const DEEP_KEEP = 0.25;

interface Sprite {
  data: ImageData;
  /** the opaque pixels' box, so the drawing is cropped tight */
  box: { x: number; y: number; w: number; h: number };
}

let sprite: Promise<Sprite> | null = null;
function loadSprite(): Promise<Sprite> {
  sprite ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      let x0 = c.width,
        y0 = c.height,
        x1 = 0,
        y1 = 0;
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++) {
          if (data.data[(y * c.width + x) * 4 + 3] < 128) continue;
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
      resolve({ data, box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } });
    };
    img.onerror = reject;
    img.src = spriteUrl;
  });
  return sprite;
}

/** The helmet in these colors, cropped, as an image address; each pair of colors is painted once. */
const painted = new Map<string, string>();
function paint({ data, box }: Sprite, shell: string, mask: string | undefined): string {
  const key = `${shell}|${mask ?? ""}`;
  const hit = painted.get(key);
  if (hit) return hit;
  const lit = hexToRgb(shell);
  const tones: Record<number, RGB> = {
    [SHELL_RED]: lit,
    [SHADE_RED]: shade(lit, SHADE_KEEP, SHADE_LIFT),
  };
  const deep = shade(lit, DEEP_KEEP, 0);
  const maskRgb = mask ? hexToRgb(mask) : null;
  const out = new ImageData(box.w, box.h);
  const src = data.data;
  for (let y = 0; y < box.h; y++)
    for (let x = 0; x < box.w; x++) {
      const i = ((box.y + y) * data.width + box.x + x) * 4;
      const o = (y * box.w + x) * 4;
      if (src[i + 3] < 128) continue;
      const [r, g, b] = [src[i], src[i + 1], src[i + 2]];
      let to: RGB | null = null;
      if (g === b && r > g) to = tones[r] ?? deep;
      else if (maskRgb && ((r << 16) | (g << 8) | b) === FACEMASK) to = maskRgb;
      out.data.set(to ?? [r, g, b], o);
      out.data[o + 3] = 255;
    }
  const c = document.createElement("canvas");
  c.width = box.w;
  c.height = box.h;
  c.getContext("2d")!.putImageData(out, 0, 0);
  const url = c.toDataURL();
  painted.set(key, url);
  return url;
}

let ready: Sprite | null = null;

interface Props {
  /** the shell's color */
  color: string;
  /** the facemask's color; leave it out for the art's gray */
  mask?: string;
  /** whole-number pixel scale; leave it out to size the drawing in CSS (set a width, height: auto) */
  scale?: number;
  /** face left instead of right */
  flip?: boolean;
  /** the team's name, for screen readers; leave it out when the helmet is decoration */
  label?: string;
  className?: string;
}

/** A team's helmet: the pixel-art helmet painted in its colors. */
export default function Helmet({ color, mask, scale, flip, label, className }: Props) {
  const [sheet, setSheet] = useState<Sprite | null>(ready);

  useEffect(() => {
    if (sheet) return;
    let live = true;
    loadSprite()
      .then((s) => {
        ready = s;
        if (live) setSheet(s);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sheet]);

  const w = sheet?.box.w ?? 13;
  const h = sheet?.box.h ?? 13;
  const cls = ["helmet", flip && "is-flipped", className].filter(Boolean).join(" ");
  const size = scale ? { width: w * scale, height: h * scale } : undefined;
  if (!sheet) return <span className={cls} style={{ ...size, aspectRatio: `${w} / ${h}` }} aria-hidden="true" />;
  return (
    <img
      className={cls}
      src={paint(sheet, color, mask)}
      width={w}
      height={h}
      style={size}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      draggable={false}
    />
  );
}
