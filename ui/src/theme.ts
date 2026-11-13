import { useCallback, useState } from "react";

export type Theme = "light" | "dark";

// The theme lives on <html data-theme> (set before the first paint by index.html) and in
// localStorage under the old UI's key, so both UIs agree.
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === "dark" ? "light" : "dark";
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
