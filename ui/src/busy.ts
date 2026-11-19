import { useSyncExternalStore } from "react";

// What the game is busy with, for the notice at the bottom of the screen (components/BusyNote). Anything slow says so:
// every request to the game that takes longer than a moment shows a plain "Working…" or "Loading…" by itself (api.ts),
// and the long ones (starting the next season, an offseason stage) name themselves with beginBusy.

interface Entry {
  id: number;
  text: string;
  /** a named job outranks the plain notice of the requests under it */
  named: boolean;
}

let entries: Entry[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Say the game is busy with something; call what it returns when it is done. */
export function beginBusy(text: string, named = true): () => void {
  const id = next++;
  entries = [...entries, { id, text, named }];
  emit();
  return () => {
    entries = entries.filter((e) => e.id !== id);
    emit();
  };
}

/** *tune* How long a request runs before the notice shows, in ms (a quick one never flashes it). */
const SLOW_MS = 500;

/** Wrap a request: if it is still running after a moment, the notice shows until it ends. */
export function trackSlow<T>(work: Promise<T>, text: string): Promise<T> {
  let done: (() => void) | null = null;
  const timer = window.setTimeout(() => {
    done = beginBusy(text, false);
  }, SLOW_MS);
  return work.finally(() => {
    window.clearTimeout(timer);
    done?.();
  });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
/** The notice to show now: the latest named job, else the latest plain one, else nothing. */
const current = () => (entries.filter((e) => e.named).pop() ?? entries[entries.length - 1])?.text ?? null;

export const useBusy = (): string | null => useSyncExternalStore(subscribe, current);
