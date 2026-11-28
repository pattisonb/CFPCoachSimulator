import { useCallback, useState } from "react";

/** Light, Dark, or School: light underneath, your school's colors all through a career (the player's ask). */
export type Theme = "light" | "dark" | "school";

export const THEMES: Theme[] = ["light", "dark", "school"];

/** The theme a page's own light-or-dark reads use: School is light underneath. */
export const baseTheme = (t: Theme): "light" | "dark" => (t === "dark" ? "dark" : "light");

/** The theme after this one, as the switch goes round: Light, Dark, School. */
export const nextTheme = (t: Theme): Theme => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];

const themeNow = (): Theme => {
  const t = document.documentElement.dataset.theme as Theme | undefined;
  return t && THEMES.includes(t) ? t : "light";
};

// The theme lives on <html data-theme> (set before the first paint by index.html) and in
// localStorage under the old UI's key, so both UIs agree.
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(themeNow);
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = nextTheme(t);
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem("cfp.theme", next);
      } catch {
        /* private window: the choice lasts this visit */
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}
