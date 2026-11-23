import { useLayoutEffect, useRef, type ReactNode } from "react";
import "./index.css";

interface Props {
  children: ReactNode;
  className?: string;
  /** *tune* the least it is set to, as a share of its full size (then it is cut short) */
  min?: number;
  title?: string;
}

/** *tune* How much smaller each try is, as a share of the full size. */
const STEP = 0.04;

/**
 * A line of text that always shows whole: when it is too long for its place it is set smaller, a step at a time,
 * until it fits (down to `min` of its size; past that it is cut short with its whole text as a tooltip). For a
 * narrow card's lines, where "RS Sr. · 6'2\" · 195" or a long archetype ran one letter over and lost its end.
 */
export default function FitText({ children, className, min = 0.72, title }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = "";
      const full = parseFloat(getComputedStyle(el).fontSize);
      let k = 1;
      while (el.scrollWidth > el.clientWidth + 0.5 && k > min) {
        k -= STEP;
        el.style.fontSize = `${(full * k).toFixed(2)}px`;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
    // (text is measured again when it changes; anything else as a child is measured on every draw)
  }, [typeof children === "string" ? children : Math.random(), min]);
  return (
    <span className={["fit-text", className].filter(Boolean).join(" ")} ref={ref} title={title}>
      {children}
    </span>
  );
}
