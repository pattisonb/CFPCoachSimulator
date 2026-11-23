import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import type { BoardRow } from "./types.ts";

/** What a notice is about: a staff find, a recruit joining or leaving your class, or one of your players hurt. */
export type NoticeKind = "gem" | "generational" | "commit" | "decommit" | "injury";

/** One line in your notifications (the Notifications bell and the cards that drop from under your coach). */
export interface Notice {
  id: string;
  kind: NoticeKind;
  name: string;
  position: string;
  /** the week it reached you */
  week: number;
  read: boolean;
  /** a recruit: his id (opens his file) and his stars */
  pid?: string;
  stars?: number;
  /** a decommit: the school he picked instead, when he picked one */
  school?: string | null;
  /** an injury: what it is and how many weeks he misses */
  injury?: string;
  weeks?: number;
}

/** *tune* How long a new notice stays dropped under your coach before it tucks into the bell, in ms. */
const TOAST_MS = 7000;
/** *tune* The most notices the bell keeps for a season. */
const KEEP = 40;

const read = <T>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};
const write = (key: string, value: unknown): boolean => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

/** What a notice reads of a board row (the board's own rows, or a running sim's short ones). */
type ClassRow = Pick<BoardRow, "id" | "name" | "display_pos" | "stars" | "school_name"> & {
  committed?: string | null;
  signed?: string | null | false;
};

interface Injury {
  name: string;
  position: string;
  type: string;
  weeks_left: number;
  since_week: number;
}

/**
 * Your notifications for a season: what happened while time passed (a commit to you, a recruit leaving your class, one
 * of your players hurt; a staff find is handed in through `add`). Each source is compared with what this browser has
 * already seen for the career and the year, and its first read only takes note of what is there, so opening an old
 * save does not replay its history. `toasts` are the new ones, for TOAST_MS each.
 */
export function useNotices(
  seasonId: string | undefined,
  year: number | undefined,
  team: string | undefined,
  week: number | undefined,
  board: ClassRow[] | undefined,
  /** your injury report when the caller already has it (a running sim sends it): not read again */
  hurtNow?: Injury[],
) {
  const base = seasonId && year != null ? `cfp.notices.${seasonId}.${year}` : null;
  const [items, setItems] = useState<Notice[]>([]);
  const [toasts, setToasts] = useState<string[]>([]);
  const at = useRef({ week: 0 });
  at.current.week = week ?? 0;

  useEffect(() => {
    setItems(base ? (read<Notice[]>(base) ?? []) : []);
    setToasts([]);
  }, [base]);

  const add = useCallback(
    /** `drop`: notices taken back in the same move (one that turned out not to be so) */
    (list: Omit<Notice, "week" | "read">[], drop: string[] = []) => {
      if (!base || (!list.length && !drop.length)) return;
      setItems((before) => {
        const old = drop.length ? before.filter((o) => !drop.includes(o.id)) : before;
        const fresh = list
          .filter((n, i) => !old.some((o) => o.id === n.id) && list.findIndex((x) => x.id === n.id) === i)
          .map((n) => ({ ...n, week: at.current.week, read: false }));
        if (!fresh.length && old.length === before.length) return before;
        const next = [...fresh, ...old].slice(0, KEEP);
        write(base, next);
        const ids = fresh.map((n) => n.id);
        // outside this update: React may run it twice
        queueMicrotask(() => {
          setToasts((t) => [...ids.filter((id) => !t.includes(id)), ...t.filter((id) => !drop.includes(id))]);
          setTimeout(() => setToasts((t) => t.filter((id) => !ids.includes(id))), TOAST_MS);
        });
        return next;
      });
    },
    [base],
  );

  const readAll = useCallback(() => {
    if (!base) return;
    setItems((old) => {
      if (!old.some((n) => !n.read)) return old;
      const next = old.map((n) => ({ ...n, read: true }));
      write(base, next);
      return next;
    });
  }, [base]);

  const clearToasts = useCallback(() => setToasts([]), []);
  const dismiss = useCallback((id: string) => setToasts((t) => t.filter((x) => x !== id)), []);

  // your class: who is in it now against who was the last time this browser looked
  useEffect(() => {
    if (!base || !team || !board) return;
    const key = `${base}.class`;
    const mine = board.filter((r) => r.committed === team || r.signed === team);
    const seen = read<string[]>(key);
    if (
      !write(
        key,
        mine.map((r) => r.id),
      ) ||
      !seen
    )
      return;
    const joined = mine.filter((r) => !seen.includes(r.id));
    // gone from your class and still on your board (a recruit you took off it is your own doing)
    const left = board.filter((r) => seen.includes(r.id) && !mine.includes(r));
    // A recruit cannot both join and leave your class in one week: the later of the two takes the earlier back. (When
    // a sim ended the board on hand was, for a moment, the one from before it: a recruit who had just committed read
    // as gone, and the bell kept a New Commit and a Decommitment for him side by side: the player's "which is it?")
    const w = at.current.week;
    // (the newest notice about him, when it is this week's or later: a sim's notices run a week ahead of the board)
    const kept = read<Notice[]>(base) ?? [];
    const last = (r: ClassRow, kind: NoticeKind) => {
      const n = kept.find((x) => x.pid === r.id && (x.kind === "commit" || x.kind === "decommit"));
      return n && n.kind === kind && n.week >= w ? n.id : null;
    };
    const undone = left.filter((r) => last(r, "commit"));
    const back = joined.filter((r) => last(r, "decommit"));
    add(
      [
        ...joined.map((r) => ({
          id: `commit:${r.id}:${at.current.week}`,
          kind: "commit" as const,
          name: r.name,
          position: r.display_pos,
          pid: r.id,
          stars: r.stars,
        })),
        ...left
          .filter((r) => !undone.includes(r))
          .map((r) => ({
            id: `decommit:${r.id}:${at.current.week}`,
            kind: "decommit" as const,
            name: r.name,
            position: r.display_pos,
            pid: r.id,
            stars: r.stars,
            school: r.committed ? r.school_name : null,
          })),
      ],
      [...undone.map((r) => last(r, "commit")!), ...back.map((r) => last(r, "decommit")!)],
    );
  }, [base, team, board, add]);

  // your injury report, read again when a week passes
  useEffect(() => {
    if (!base || !seasonId || !team || week == null) return;
    let on = true;
    (hurtNow
      ? Promise.resolve({ injuries: hurtNow })
      : api<{ injuries?: Injury[] }>(`/api/season/${seasonId}/injuries?team=${team}`)
    )
      .then((v) => {
        if (!on) return;
        const key = `${base}.hurt`;
        const id = (i: Injury) => `injury:${i.name}|${i.position}|${i.since_week}`;
        const hurt = v.injuries ?? [];
        const seen = read<string[]>(key);
        if (!write(key, [...new Set([...(seen ?? []), ...hurt.map(id)])]) || !seen) return;
        add(
          hurt
            .filter((i) => !seen.includes(id(i)))
            .map((i) => ({
              id: id(i),
              kind: "injury" as const,
              name: i.name,
              position: i.position,
              injury: i.type,
              weeks: i.weeks_left,
            })),
        );
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [base, seasonId, team, week, add, hurtNow]);

  return {
    items,
    toasts: toasts.map((id) => items.find((n) => n.id === id)).filter((n): n is Notice => !!n),
    unread: items.filter((n) => !n.read).length,
    add,
    readAll,
    dismiss,
    clearToasts,
  };
}
