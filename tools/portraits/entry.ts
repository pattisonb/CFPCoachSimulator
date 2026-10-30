/**
 * The depth chart's player portraits: sprite-test's locker room portrait (lib/game/portrait.ts, the
 * customize page) drawn for one of our players. His look (skin, face, hair, beard) is rolled from a seed
 * the way the locker room's roster cards roll theirs, bareheaded; his body follows his real height and
 * weight; the uniform is his team's colours with his number on the chest.
 * Bundled into web/depth/portraits.js by tools/build_portraits.mjs as window.CFPPortraits.
 */
import { DEFAULT_TEAM, PARTS_META } from "@/lib/game/customize";
import { randomLook, seeded, withLook } from "@/lib/game/look";
import { buildPortrait, PORTRAIT_W } from "@/lib/game/portrait";
import { deriveShade, teamPalette, type Build } from "@/lib/game/recolor";

export interface PortraitPlayer {
  /** the same seed always gives the same face (we use the player's slug) */
  seed: string;
  number?: number;
  /** inches and pounds; missing ones come from the rolled look */
  height?: number;
  weight?: number;
}

export interface TeamColors {
  primary?: string;
  secondary?: string;
  accent?: string;
}

/** the portrait's crops, as the locker room's thumbnails take them: card rows [top, bottom) and a centred width */
export const CROPS = {
  head: { top: 0, bottom: 18, width: 23 },
  hair: { top: -6, bottom: 20, width: 23 },
  bust: { top: 0, bottom: 31, width: 23 },
} as const;
export type Crop = keyof typeof CROPS;

const BASE_ROWS = 31;

function buildFor(weight: number): Build {
  if (weight >= 285) return "large";
  if (weight >= 240) return "large-muscular";
  if (weight >= 205) return "muscular";
  return "lean";
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const isHex = (s?: string): s is string => !!s && /^#[0-9a-f]{6}$/i.test(s);

/** The full portrait (27 wide; taller players are taller canvases, bottom-anchored). */
export function portrait(p: PortraitPlayer, team: TeamColors = {}): HTMLCanvasElement {
  const base = teamPalette(PARTS_META, DEFAULT_TEAM, true, true);
  const ref = base.colors;
  const colors: Record<string, string[]> = { ...ref };
  const tone = (key: string, hex: string) => {
    colors[key] = ref[key] && ref[key].length > 1 ? [hex, deriveShade(hex, ref[key][0], ref[key][1])] : [hex];
  };
  const jersey = isHex(team.primary) ? team.primary : ref.jersey[0];
  // the number in whichever team colour reads best on the jersey
  const number = [team.accent, team.secondary, "#ffffff", "#111111"].filter(isHex).sort((a, b) => contrast(b, jersey) - contrast(a, jersey))[0];
  tone("jersey", jersey);
  tone("sleeves", jersey);
  tone("number", number);
  tone("helmet", jersey);
  if (isHex(team.secondary)) tone("helmetDecal", team.secondary);
  const look = randomLook(seeded(p.seed), { helmet: false });
  const weight = p.weight ?? look.body.weight;
  const body = { build: buildFor(weight), height: p.height ?? look.body.height, weight };
  const palette = withLook({ colors, showNumber: p.number != null, showStripe: true }, { ...look, body });
  return buildPortrait(palette, { number: p.number });
}

/** A crop of the portrait drawn at `scale` (whole pixels): what a card or a profile shows. */
export function portraitCanvas(p: PortraitPlayer, team: TeamColors = {}, crop: Crop = "bust", scale = 1): HTMLCanvasElement {
  const img = portrait(p, team);
  const { top, bottom, width } = CROPS[crop];
  const h = bottom - top;
  const out = document.createElement("canvas");
  out.width = width * scale;
  out.height = h * scale;
  const ctx = out.getContext("2d");
  if (!ctx) return out;
  ctx.imageSmoothingEnabled = false;
  // bottom-anchored: a taller body pushes the head up, so the rows count from the bottom
  ctx.drawImage(img, (PORTRAIT_W - width) / 2, img.height - BASE_ROWS + top, width, h, 0, 0, width * scale, h * scale);
  return out;
}
