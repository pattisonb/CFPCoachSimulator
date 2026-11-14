import { useCallback, useState } from "react";

// The game sidebar's mode, remembered by this browser: open, minimized to a rail of icons, or hidden (it peeks out
// when the pointer reaches the window's left edge).

export type NavMode = "open" | "rail" | "hidden";

/** *tune* Where the mode is kept. */
const KEY = "cfp.gameNav.mode";
const MODES: readonly NavMode[] = ["open", "rail", "hidden"];

function read(): NavMode {
  try {
    const saved = localStorage.getItem(KEY);
    return MODES.find((m) => m === saved) ?? "open";
  } catch {
    return "open";
  }
}

export function useNavMode(): [NavMode, (mode: NavMode) => void] {
  const [mode, setMode] = useState<NavMode>(read);
  const set = useCallback((next: NavMode) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private window: it lasts this visit */
    }
    setMode(next);
  }, []);
  return [mode, set];
}

/** The keyboard shortcut that hides and shows the sidebar, as this computer writes it. */
export const NAV_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘\\" : "Ctrl+\\";
