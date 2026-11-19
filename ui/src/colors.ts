// Team colors as the page draws them.

/** A "#rrggbb" color's relative luminance (WCAG), 0 (black) to 1 (white); mid-gray for anything else. */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.2;
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/**
 * *tune* How light a color must be before text on it turns dark. Near-black and white read equally well on a color of
 * about 0.18; a little over that, so the deep team colors (crimson, navy, forest) keep white text and the bright ones
 * (orange, gold, sky blue, silver) get dark text instead of white that washes out.
 */
const INK_FLIP = 0.22;

/** The text color that reads on a team color: white on a deep one, near-black on a bright one. */
export const inkOn = (hex: string): string => (luminance(hex) > INK_FLIP ? "#111" : "#fff");

/** The page behind a panel, in each theme (globals.css --paper-hi): what a team color has to show up against. */
const PAGE = { light: "#ffffff", dark: "#202020" } as const;
/** *tune* A team color closer to the page than this (contrast ratio) is taken to disappear on it. */
const ACCENT_MIN = 1.6;

/**
 * The team color to draw with on the page: the primary, unless it disappears against the page in this theme (white or
 * cream on the light page, black or deep navy on the dark one). Then the secondary, when it shows up better.
 */
export function teamAccent(colors: { primary: string; secondary: string }, theme: "light" | "dark"): string {
  const page = PAGE[theme];
  if (contrast(colors.primary, page) >= ACCENT_MIN) return colors.primary;
  return contrast(colors.secondary, page) > contrast(colors.primary, page) ? colors.secondary : colors.primary;
}

/** How far apart two colors' lightness is (WCAG contrast ratio), 1 (the same) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const [lo, hi] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (hi + 0.05) / (lo + 0.05);
}

export type RGB = [number, number, number];

/** A "#rrggbb" color as its three channels; mid-gray for anything else. */
export function hexToRgb(hex: string): RGB {
  const n = parseInt(/^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? "777777", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * A color's shade for pixel art: darker (keeping `keep` of each channel), or lighter by `lift` when it is already near
 * black, so the shading still shows.
 */
export function shade([r, g, b]: RGB, keep = 0.68, lift = 0.22): RGB {
  const dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 40;
  const mix = (c: number) => Math.round(dark ? c + (255 - c) * lift : c * keep);
  return [mix(r), mix(g), mix(b)];
}

/** A color made darker, keeping `keep` of each channel. */
export const darken = ([r, g, b]: RGB, keep: number): RGB => [r, g, b].map((c) => Math.round(c * keep)) as RGB;
