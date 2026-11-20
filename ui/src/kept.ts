import { useCallback, useState } from "react";

const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback; // no storage (a private window): the choice lasts while the screen is open
  }
};

/**
 * A choice that is kept: a filter, a sort, a view. It works like useState, and this browser remembers the value under
 * `key`, so leaving the screen for another page (or reloading) and coming back finds it as it was left. Name the key
 * for the screen and the career ("prospects.<season>.view"), so one career's choices do not follow you into another.
 */
export function useKept<T>(key: string, initial: T): [T, (value: T) => void] {
  const full = `cfp.kept.${key}`;
  const [value, setValue] = useState<T>(() => read(full, initial));
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(full, JSON.stringify(next));
      } catch {
        // nowhere to keep it: it still holds for this visit
      }
    },
    [full],
  );
  return [value, set];
}
