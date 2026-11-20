import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { tipLayer } from "./titleTips.ts";
import "./index.css";

interface Props {
  /** a short name in bold, before the text */
  title?: string;
  /** what it means, in a sentence */
  text: string;
  children: ReactNode;
  /** wrap a whole row (the wrapper is a block, so the row inside keeps its layout) */
  block?: boolean;
  className?: string;
}

/** *tune* The tip's widest, and how close its middle may come to the window's edge (half of it, plus a margin). */
const MAX_WIDTH = 260;
const EDGE = MAX_WIDTH / 2 + 8;
/** *tune* Nearer the window's top than this, the tip shows under its target instead of over it. */
const FLIP_UNDER = 90;

/**
 * The game's own tooltip on anything: point at (or tab to) the children and an ink label with a pixel notch shows over
 * them, at once. Its notch points at the middle of the children, or at the one part of them marked `data-tip-at`. It is drawn on the page itself, so a scrolling list never clips it; inside an open window it is drawn
 * in that window, which sits over the whole page.
 */
export default function Tooltip({ title, text, children, block, className }: Props) {
  const [place, setPlace] = useState<{ left: number; top: number; under: boolean; nudge: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // the notch points at the part the tip is about when the children mark one (`data-tip-at`: a range's best guess),
    // else at the middle of the whole target
    const at = ref.current?.querySelector("[data-tip-at]")?.getBoundingClientRect();
    const mid = at ? at.left + at.width / 2 : r.left + r.width / 2;
    const left = Math.min(Math.max(mid, EDGE), Math.max(EDGE, window.innerWidth - EDGE));
    const under = r.top < FLIP_UNDER;
    setPlace({ left, top: under ? r.bottom : r.top, under, nudge: mid - left });
  };
  const hide = () => setPlace(null);

  return (
    <span
      className={["tooltip", block && "tooltip--block", className].filter(Boolean).join(" ")}
      ref={ref}
      aria-describedby={place ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {place &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className={`tooltip__tip${place.under ? " tooltip__tip--under" : ""}`}
            style={{ left: place.left, top: place.top, maxWidth: MAX_WIDTH, ["--nudge" as string]: `${place.nudge}px` }}
          >
            {title && <b className="tooltip__title">{title}</b>}
            {text}
          </span>,
          tipLayer(ref.current),
        )}
    </span>
  );
}
