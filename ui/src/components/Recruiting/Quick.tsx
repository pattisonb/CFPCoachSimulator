import { useState } from "react";
import { Binoculars, Chat, Check, Heart, Phone, VideoCamera, X } from "@phosphor-icons/react";
import { api } from "../../api.ts";
import { setFavorite, setOnBoard } from "../../board.ts";
import ScoutMark from "../ScoutMark/index.tsx";
import type { BoardRow } from "../../types.ts";
import { messages as m } from "./messages.ts";

/** *tune* How long the Scout box stays after the look that completes his report, in milliseconds. */
const SCOUT_LINGER = 2500;

/** *tune* Looks that make a full scouting report (recruiting.REPORT_LOOKS). */
const FULL_REPORT = 3;

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
  /** each box shows its mark and its energy (his row); marks alone without */
  labels?: boolean;
  /** a fourth box sends a scout to him now (his row on the board) */
  scout?: boolean;
  /** his row ends on two marks: your favorite's heart, and a cross that takes him off your board */
  marks?: boolean;
  /** a plan changed: read the board again */
  onChange: (stale: () => boolean) => Promise<void> | void;
  /** a box was clicked: show it (his row, your Energy) at once, ahead of the server */
  onPlan?: (action: string, on: boolean) => void;
  /** the Scout box was clicked: his file opens on its report, beside the board */
  onScout?: () => void;
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
  scout,
  marks,
  onChange,
  onPlan,
  onScout,
  onError,
}: Props) {
  // a tick shows at once (the player's ask: clicking through a board must not wait on the server): the page changes
  // his row and your Energy now, the save runs behind it, and the board's fresh read puts right a tick the server refused
  const planned = r.planned ?? [];
  // a scout goes now, not at the week's end (a look is not a contact): the board is read again when he is back
  const [sending, setSending] = useState(false);
  // his report is complete: the box has nothing left to do, so it goes (the player's ask). It stays a moment after the
  // look that finished it, so the ring is seen to close; his row then carries the full mark beside his stars
  const [justSent, setJustSent] = useState(false);
  const sendScout = async () => {
    setSending(true);
    setJustSent(true);
    window.setTimeout(() => setJustSent(false), SCOUT_LINGER);
    try {
      await api(`/api/season/${seasonId}/recruit`, {
        method: "POST",
        quiet: true,
        body: { pid: r.id, action: "scout" },
      });
    } catch (e) {
      onError?.((e as Error).message);
    } finally {
      setSending(false);
      void Promise.resolve(onChange(() => false)).catch(() => {});
    }
  };
  // his two marks: done at once, and the board is read again
  const mark = async (what: () => Promise<void>) => {
    try {
      await what();
    } catch (e) {
      onError?.((e as Error).message);
    } finally {
      void Promise.resolve(onChange(() => false)).catch(() => {});
    }
  };
  const scoutCost = r.scout_cost ?? 0;
  const scouted = (r.looks ?? 0) >= FULL_REPORT;
  const scoutTip = scouted
    ? m.scoutFull
    : off
      ? (offWhy ?? m.quickOff)
      : r.scene
        ? m.scoutAfterTalk
        : r.can_scout === false
          ? m.scoutCant
          : left < scoutCost
            ? m.notEnough
            : m.scoutTip(scoutCost);
  const scoutOff = scouted || sending || !!off || !!r.scene || r.can_scout === false || left < scoutCost;
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
      {/* the scout's box leads the strip: when his report is full it goes, and nothing after it moves or leaves a hole */}
      {scout && (!scouted || justSent) && (
        <button
          type="button"
          className={`quick__box quick__box--scout${scouted ? " is-done" : ""}`}
          aria-label={scoutTip}
          title={scoutTip}
          disabled={scoutOff}
          onClick={(e) => {
            e.stopPropagation();
            onScout?.();
            void sendScout();
          }}
        >
          {/* how far his report is, on the box that adds to it: a ring closing around the binoculars */}
          {labels ? (
            <ScoutMark looks={r.looks ?? 0} size={24} always bare />
          ) : scouted ? (
            <Check size={14} weight="bold" aria-hidden="true" />
          ) : (
            <Binoculars size={14} weight="bold" aria-hidden="true" />
          )}
          {labels && !scouted && <span>{scoutCost}</span>}
        </button>
      )}
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
            {/* his row: the mark and what it costs, nothing more (the tip names it) */}
            {labels && !done && <span>{cost}</span>}
          </button>
        );
      })}
      {marks && (
        <>
          <button
            type="button"
            className={`quick__mark quick__mark--fav${r.favorite ? " is-on" : ""}`}
            aria-pressed={!!r.favorite}
            aria-label={r.favorite ? m.removeFavorite(r.name) : m.addFavorite(r.name)}
            title={r.favorite ? m.removeFavorite(r.name) : m.addFavorite(r.name)}
            onClick={(e) => {
              e.stopPropagation();
              void mark(() => setFavorite(seasonId, r.id, !r.favorite));
            }}
          >
            <Heart size={16} weight={r.favorite ? "fill" : "bold"} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="quick__mark quick__mark--off"
            aria-label={m.offBoardRow(r.name)}
            title={m.offBoardRow(r.name)}
            onClick={(e) => {
              e.stopPropagation();
              if (r.offered && !window.confirm(m.offBoardConfirm(r.name))) return;
              void mark(() => setOnBoard(seasonId, [r.id], false));
            }}
          >
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </>
      )}
    </span>
  );
}
