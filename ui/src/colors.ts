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

/** The text color that reads on a team color: white, or near-black on a light one (gold, white, silver). */
export const inkOn = (hex: string): string => (luminance(hex) > 0.4 ? "#111" : "#fff");

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
