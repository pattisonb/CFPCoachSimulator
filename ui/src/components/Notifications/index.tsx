import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Bell, Crown, Diamond, FirstAid, HeartBreak, Signature, X, type Icon } from "@phosphor-icons/react";
import type { Notice, NoticeKind } from "../../notices.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

const ICONS: Record<NoticeKind, Icon> = {
  gem: Diamond,
  generational: Crown,
  commit: Signature,
  decommit: HeartBreak,
  injury: FirstAid,
};

/** *tune* The most cards dropped under your coach at once; the rest are counted on a last line. */
const SHOWN = 3;

interface RowProps {
  notice: Notice;
  weekLabels?: Record<string, string>;
  onOpen: (n: Notice) => void;
}

/** One notice: its icon, what it is, the sentence and the week. The whole line opens who it is about. */
function Row({ notice: n, weekLabels, onOpen }: RowProps) {
  const Mark = ICONS[n.kind];
  return (
    <button
      type="button"
      className={`notifications__row is-${n.kind}${n.read ? "" : " is-new"}`}
      onClick={() => onOpen(n)}
    >
      <span className="notifications__icon" aria-hidden="true">
        <Mark size={18} weight="fill" />
      </span>
      <span className="notifications__text">
        <span className="notifications__head">
          <b className="label">{m.heads[n.kind]}</b>
          <span className="notifications__when">{weekLabels?.[String(n.week)] ?? m.week(n.week)}</span>
        </span>
        <span className="notifications__line">{m.line(n)}</span>
      </span>
    </button>
  );
}

interface Props {
  /** every notice kept, newest first */
  items: Notice[];
  unread: number;
  weekLabels?: Record<string, string>;
  /** a notice was picked: open what it is about (a recruit's file, your injury report) */
  onOpen: (n: Notice) => void;
  /** the list has been looked at: nothing in it is new any more */
  onRead: () => void;
  /** the list was opened: the cards that had just dropped are in it, so they can go */
  onShow?: () => void;
}

/**
 * The bell: a small icon button with how many notices are new, and the list they are kept in, dropping from under it
 * (over it when it sits at the foot of the window). Closing the list marks them read.
 */
export default function Notifications({ items, unread, weekLabels, onOpen, onRead, onShow }: Props) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = () => {
    setOpen(false);
    onRead();
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  useLayoutEffect(() => {
    const r = root.current?.getBoundingClientRect();
    if (open && r) setUp(r.top > window.innerHeight - r.bottom);
  }, [open]);

  return (
    <div className="notifications" ref={root}>
      <button
        type="button"
        className="notifications__bell"
        aria-label={m.bell(unread)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          if (open) return close();
          onShow?.();
          setOpen(true);
        }}
      >
        <Bell size={16} weight={unread > 0 ? "fill" : "bold"} aria-hidden="true" />
        {unread > 0 && <span className="notifications__count">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className={`notifications__panel${up ? " is-up" : ""}`} id={id} role="dialog" aria-label={m.title}>
          <p className="notifications__title label">{m.title}</p>
          {items.length === 0 ? (
            <p className="notifications__empty">{m.empty}</p>
          ) : (
            <div className="notifications__list">
              {items.map((n) => (
                <Row
                  key={n.id}
                  notice={n}
                  weekLabels={weekLabels}
                  onOpen={(x) => {
                    close();
                    onOpen(x);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ToastsProps {
  /** the notices that have just landed, newest first */
  items: Notice[];
  weekLabels?: Record<string, string>;
  onOpen: (n: Notice) => void;
  onDismiss: (id: string) => void;
  /** put every one of them away at once */
  onClear?: () => void;
  /** rise from the anchor instead of dropping from it (your coach at the foot of the window) */
  rise?: boolean;
}

/**
 * The notices that have just landed, out of your coach's card to its left: the newest as a card, the rest stacked behind it as a deck
 * (its edges show, and a line says how many). A busy stretch (an offseason stage) is one card to read, not a column
 * of them: Show All fans the deck out, Dismiss All puts it away.
 */
export function NoticeToasts({ items, weekLabels, onOpen, onDismiss, onClear, rise }: ToastsProps) {
  const [open, setOpen] = useState(false);
  // a new stack starts shut
  const none = items.length === 0;
  useEffect(() => {
    if (none) setOpen(false);
  }, [none]);
  if (!items.length) return null;
  const rest = items.length - 1;
  const card = (n: Notice) => (
    <div className="notifications__toast" key={n.id}>
      <Row
        notice={n}
        weekLabels={weekLabels}
        onOpen={(x) => {
          onDismiss(x.id);
          onOpen(x);
        }}
      />
      <button
        type="button"
        className="notifications__x"
        aria-label={m.dismiss}
        title={m.dismiss}
        onClick={() => onDismiss(n.id)}
      >
        <X size={12} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
  return (
    <div className={`notifications__toasts${rise ? " is-rise" : ""}`} role="status">
      <div className={`notifications__deck${!open && rest > 0 ? ` is-stacked${rest > 1 ? " is-deep" : ""}` : ""}`}>
        {card(items[0])}
      </div>
      {open && items.slice(1, 1 + SHOWN).map(card)}
      {rest > 0 && (
        <span className="notifications__deck-foot">
          <button type="button" className="notifications__more label" onClick={() => setOpen(!open)}>
            {open ? m.fewer : m.more(rest)}
          </button>
          {onClear && (
            <button type="button" className="notifications__more label" onClick={onClear}>
              {m.dismissAll}
            </button>
          )}
        </span>
      )}
    </div>
  );
}
