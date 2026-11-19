import { useCallback, useEffect, useState } from "react";
import { api } from "./api.ts";
import type { Find } from "./components/FindReveal/index.tsx";

/** The finds worth stopping the game for (FindReveal): the rest (a bust risk, a coordinator's liking) stay as tags. */
const BIG = new Set(["gem", "generational"]);

/**
 * The gems and generational talents your staff has flagged since this browser last looked, one at a time. `stamp`
 * changes whenever a find could have landed (a week passed, a look came back): the staff's flags are read again and
 * any not seen before join the queue. What has been seen is kept by this browser for the career and the class; the
 * first read of a class only takes note of what is already there, so opening an old save does not replay its finds.
 */
export function useFinds(seasonId: string | undefined, year: number | undefined, stamp: string) {
  const [queue, setQueue] = useState<Find[]>([]);
  useEffect(() => {
    if (!seasonId || year == null) return;
    let on = true;
    api<{ flags?: { pid: string; name: string; position: string; stars: number; flag: string }[] }>(
      `/api/season/${seasonId}/scouting?limit=1`,
    )
      .then((v) => {
        if (!on) return;
        const found = (v.flags ?? []).filter((f) => BIG.has(f.flag)) as Find[];
        const key = `cfp.finds.${seasonId}.${year}`;
        const id = (f: Find) => `${f.pid}:${f.flag}`;
        let seen: string[] | null = null;
        try {
          const raw = localStorage.getItem(key);
          seen = raw ? (JSON.parse(raw) as string[]) : null;
          localStorage.setItem(key, JSON.stringify([...new Set([...(seen ?? []), ...found.map(id)])]));
        } catch {
          return; // nowhere to remember what was shown: show nothing rather than the same find again and again
        }
        if (!seen) return;
        const fresh = found.filter((f) => !seen.includes(id(f)));
        // a generational talent first; nobody twice (he can be both)
        fresh.sort((a, b) => Number(b.flag === "generational") - Number(a.flag === "generational"));
        const one = fresh.filter((f, i) => fresh.findIndex((x) => x.pid === f.pid) === i);
        if (one.length) setQueue((q) => [...q, ...one.filter((f) => !q.some((x) => x.pid === f.pid))]);
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [seasonId, year, stamp]);
  const next = useCallback(() => setQueue((q) => q.slice(1)), []);
  return { find: queue[0] ?? null, more: Math.max(0, queue.length - 1), next };
}
