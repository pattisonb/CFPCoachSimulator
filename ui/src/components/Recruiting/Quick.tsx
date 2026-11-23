import { Chat, Check, Phone, VideoCamera } from "@phosphor-icons/react";
import { api } from "../../api.ts";
import type { BoardRow } from "../../types.ts";
import { messages as m } from "./messages.ts";

/** The quick actions, lightest first: a message, a call, a video call. */
const QUICK = [
  { key: "message", Icon: Chat },
  { key: "call", Icon: Phone },
  { key: "call_recruit", Icon: VideoCamera },
] as const;

interface Props {
  seasonId: string;
  r: BoardRow;
  /** the energy you have left this week, your plans counted */
  left: number;
  /** what each action costs (the board's hours_cost) */
  costs: Record<string, number>;
  /** the board is closed (the dead period), or he is past taking calls */
  off?: boolean;
  /** why they are off, when it is not the usual reason (the door is shut on you): the game's own sentence */
  offWhy?: string;
  /** nothing is drawn (the door is shut on you: his row shows that instead) */
  hidden?: boolean;
  /** each box says what it is and what it costs (his row); marks alone without */
  labels?: boolean;
  /** a plan changed: read the board again */
  onChange: (stale: () => boolean) => Promise<void> | void;
  /** a box was clicked: show it (his row, your Energy) at once, ahead of the server */
  onPlan?: (action: string, on: boolean) => void;
  onError?: (msg: string) => void;
}

/**
 * A recruit's quick actions as tick-boxes (the player's ask): ticking one plans it and holds its energy; it goes out when
 * the week is simmed, so until then it can be unticked and the energy spent on someone else. One already made this week
 * shows as done.
 */
/** The saves, one at a time in the order clicked (two at once could each write over the other's plan), and how many
 * are still to land: the board is read again only after the last one, and that read is dropped if a newer click came
 * in while it was out, so a quick run of clicks is never drawn over by an older answer. */
let line: Promise<unknown> = Promise.resolve();
let flying = 0;
let clicks = 0;

export default function QuickActions({
  seasonId,
  r,
  left,
  costs,
  off,
  offWhy,
  hidden,
  labels,
  onChange,
  onPlan,
  onError,
}: Props) {
  // a tick shows at once (the player's ask: clicking through a board must not wait on the server): the page changes
  // his row and your Energy now, the save runs behind it, and the board's fresh read puts right a tick the server refused
  const planned = r.planned ?? [];
  const toggle = async (action: string, on: boolean) => {
    onPlan?.(action, on);
    flying += 1;
    clicks += 1;
    const save = () =>
      api(`/api/season/${seasonId}/recruit/plan`, { method: "POST", quiet: true, body: { pid: r.id, action, on } });
    const sent = line.then(save, save);
    line = sent.catch(() => {});
    try {
      await sent;
    } catch (e) {
      onError?.((e as Error).message);
    } finally {
      flying -= 1;
      const at = clicks;
      if (!flying) void Promise.resolve(onChange(() => clicks !== at)).catch(() => {}); // (refused mid-sim: read again after)
    }
  };
  if (hidden) return null;
  return (
    <span className={`quick${labels ? " quick--labels" : ""}`} role="group" aria-label={m.quickLabel(r.name)}>
      {QUICK.map(({ key, Icon }) => {
        const cost = costs[key] ?? 0;
        const on = planned.includes(key);
        const done = r.done_this_week.includes(key);
        const short = !on && !done && left < cost;
        const tip = done
          ? m.quickDone(m.quick[key])
          : on
            ? m.quickPlanned(m.quick[key], cost)
            : off
              ? (offWhy ?? m.quickOff)
              : short
                ? m.notEnough
                : m.quickTip(m.quick[key], cost);
        return (
          <button
            key={key}
            type="button"
            className={`quick__box${on ? " is-on" : ""}${done ? " is-done" : ""}`}
            aria-pressed={on}
            aria-label={tip}
            title={tip}
            disabled={done || (!on && (off || short))}
            onClick={(e) => {
              e.stopPropagation();
              void toggle(key, !on);
            }}
          >
            {done ? (
              <Check size={14} weight="bold" aria-hidden="true" />
            ) : (
              <Icon size={labels ? 16 : 14} weight={on ? "fill" : "bold"} aria-hidden="true" />
            )}
            {labels && (
              <>
                <b>{m.quickShort[key]}</b>
                <span>{done ? m.done : m.energy(cost)}</span>
              </>
            )}
          </button>
        );
      })}
    </span>
  );
}
