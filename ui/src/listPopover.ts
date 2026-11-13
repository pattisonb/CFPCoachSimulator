import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

// The searchable pickers' shared behavior (TeamPicker, ProgramPicker): a list fixed under its button, a search box
// that takes focus, arrows to move, Enter to choose, Escape to close; a click elsewhere, a resize or any scroll
// outside the list closes it (the list is placed once, so it would drift).

const EDGE = 16; // the list stays this far from the window's edges

interface Options {
  /** how many rows the list has now */
  count: number;
  /** the list opens at least this wide */
  minWidth: number;
  maxHeight: number;
  /** which of the button's edges the list lines up with */
  align: "left" | "right";
}

function placeList(button: HTMLElement, { minWidth, maxHeight, align }: Options): CSSProperties {
  const r = button.getBoundingClientRect();
  const width = Math.min(Math.max(r.width, minWidth), window.innerWidth - 2 * EDGE);
  const want = align === "right" ? r.right - width : r.left;
  const left = Math.max(EDGE, Math.min(want, window.innerWidth - EDGE - width));
  const top = r.bottom + 8;
  return { top, left, width, maxHeight: Math.min(maxHeight, window.innerHeight - top - EDGE) };
}

export function useListPopover(options: Options) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActive] = useState(0);
  const [place, setPlace] = useState<CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  // the highlighted row, kept inside the list as it shrinks with a search
  const active = Math.min(activeIndex, Math.max(0, options.count - 1));

  const show = (startIndex: number) => {
    if (trigger.current) setPlace(placeList(trigger.current, options));
    setActive(startIndex);
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // the highlighted row stays in view as the arrows move it
  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    const drop = (e: Event) => {
      if (!(e.target instanceof Node && root.current?.contains(e.target))) close(false);
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("resize", drop);
    window.addEventListener("scroll", drop, true);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("resize", drop);
      window.removeEventListener("scroll", drop, true);
    };
  }, [open]);

  /** The search box's keys; `choose` gets the highlighted row. */
  const onKey = (e: KeyboardEvent<HTMLInputElement>, choose: (index: number) => void) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(options.count - 1, active + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(0, active - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (options.count > 0) choose(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  return { open, show, close, active, setActive, place, onKey, root, trigger, input, list };
}
