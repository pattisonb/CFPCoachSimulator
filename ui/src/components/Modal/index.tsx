import { useEffect, useRef, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** a line under the title */
  lede?: string;
  /** a head of its own in place of the title and lede (the title still names the window) */
  head?: ReactNode;
  /** the row under the content (its actions) */
  footer?: ReactNode;
  /** sm: a small window for a short choice; talk: a conversation's width (the default fits a map) */
  size?: "sm" | "md" | "talk";
  /** always as tall as the screen allows, so its size holds when what's inside changes (tabs) */
  tall?: boolean;
  children: ReactNode;
}

/**
 * A window over the page, on the browser's own dialog (so Escape closes it, focus stays inside and the page behind
 * dims and waits). A click on the dimmed page closes it too. Framed like every other card: ink edge, hard shadow.
 */
export default function Modal({ open, onClose, title, lede, head, footer, size = "md", tall, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`modal modal--${size}${tall ? " modal--tall" : ""}`}
      aria-label={title}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // the backdrop is the dialog itself, outside its card
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="modal__card">
          <header className="modal__head">
            {head ?? (
              <div>
                <h2 className="modal__title">{title}</h2>
                {lede && <p className="modal__lede">{lede}</p>}
              </div>
            )}
            <button type="button" className="modal__close" aria-label={m.close} title={m.close} onClick={onClose}>
              <X size={18} weight="bold" aria-hidden="true" />
            </button>
          </header>
          <div className="modal__body">{children}</div>
          {footer && <footer className="modal__foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
