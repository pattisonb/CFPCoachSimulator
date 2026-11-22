import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import type { SimStatus } from "./types.ts";

// Running the season forward. POST /advance (a week, or through week `to`) or /gameday (your game alone) starts a job
// in the game, which its worker plays a week at a time between the page's calls (public/worker.js); the page
// polls /status until the job is idle again, then reloads what changed. Each poll carries your results so far
// (?since=0), your record and the week the sim has reached, so the page can show them as they happen.

/** *tune* How often a running sim is checked. */
const POLL_MS = 450;

/** the game's refusal when a sim is already under way (app_js/api.js) */
const BUSY = /already simulating/;

export type SimKind = "advance" | "gameday";

export interface Sim {
  /** the job while one runs (or the last error); null when idle */
  status: SimStatus | null;
  running: boolean;
  error: string | null;
  start: (kind: SimKind, to?: number) => Promise<void>;
  /** stop once the week in progress is over */
  stop: () => void;
}

/**
 * The season's sim for one page. `onDone` runs when a job finishes (or fails), so the page reloads the season. A job
 * already running when the page opens (a reload mid-sim) is picked up and followed.
 */
export function useSim(seasonId: string | null, onDone: (last?: SimStatus) => void): Sim {
  const [status, setStatus] = useState<SimStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const done = useRef(onDone);
  done.current = onDone;

  const poll = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!seasonId) return;
    api<SimStatus>(`/api/season/${seasonId}/status?since=0`)
      .then((s) => {
        if (s.status === "running") {
          setStatus(s);
          timer.current = window.setTimeout(poll, POLL_MS);
          return;
        }
        setStatus(null);
        if (s.status === "error") setError(s.error ?? "the sim stopped");
        done.current(s);
      })
      .catch((e: Error) => {
        setStatus(null);
        setError(e.message);
      });
  }, [seasonId]);

  // a job left running (the page reloaded mid-sim): follow it
  useEffect(() => {
    if (!seasonId) return;
    let live = true;
    api<SimStatus>(`/api/season/${seasonId}/status?since=0`)
      .then((s) => {
        if (!live || s.status !== "running") return;
        setStatus(s);
        timer.current = window.setTimeout(poll, POLL_MS);
      })
      .catch(() => {});
    return () => {
      live = false;
      window.clearTimeout(timer.current);
    };
  }, [seasonId, poll]);

  const start = async (kind: SimKind, to?: number) => {
    if (status || !seasonId) return;
    setError(null);
    try {
      const s = await api<SimStatus>(`/api/season/${seasonId}/${kind}`, {
        method: "POST",
        body: to !== undefined ? { to } : {},
      });
      if (s.status !== "running") return done.current();
      setStatus({ ...s, stage: null, week: null, games_done: null, games_total: null, progress: 0, error: null });
      timer.current = window.setTimeout(poll, POLL_MS);
    } catch (e) {
      // refused because a sim is already running (pressed in the moment the page had not heard of it: just after a
      // reload, or between two weeks): that is no failure. Follow the one running; only a real refusal is an error
      const message = (e as Error).message;
      const running = await api<SimStatus>(`/api/season/${seasonId}/status?since=0`).catch(() => null);
      if (running?.status === "running") {
        setStatus(running);
        timer.current = window.setTimeout(poll, POLL_MS);
      } else if (BUSY.test(message)) {
        // the sim that was in the way finished before it could be followed: the page reloads what it played
        done.current(running ?? undefined);
      } else setError(message);
    }
  };

  const stop = () => {
    api(`/api/season/${seasonId}/pause`, { method: "POST", body: {} }).catch(() => {});
  };

  return { status, running: status !== null, error, start, stop };
}
