import { useEffect, useRef, useState, type ReactNode } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import "./index.css";
import { messages as m } from "./messages.ts";

/** *tune* How far a click on an arrow moves the row, as a share of what is showing. */
const PAGE = 0.8;
/** *tune* How fast the row glides while the pointer rests on an arrow, in px a second. */
const GLIDE = 520;
const TICK_MS = 16;

/**
 * A row that scrolls sideways, without a scrollbar: an arrow tab at each edge that has more behind it. Click one to
 * move a page; rest the pointer on one and the row glides that way. It wraps the row it is given (its one child, the
 * element that scrolls), so the row keeps its own class, ref and handlers. The wheel, a trackpad and the keyboard
 * still scroll it.
 */
export default function Slider({ children }: { children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const glide = useRef(0);

  const row = () => wrap.current?.firstElementChild as HTMLElement | null;
  useEffect(() => {
    const el = row();
    if (!el) return;
    const read = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setMore((was) => (was.left === left && was.right === right ? was : { left, right }));
    };
    read();
    el.addEventListener("scroll", read, { passive: true });
    const size = new ResizeObserver(read);
    size.observe(el);
    const kids = new MutationObserver(read);
    kids.observe(el, { childList: true });
    return () => {
      el.removeEventListener("scroll", read);
      size.disconnect();
      kids.disconnect();
      window.clearInterval(glide.current);
    };
  }, []);

  const stop = () => window.clearInterval(glide.current);
  const start = (dir: 1 | -1) => {
    stop();
    glide.current = window.setInterval(() => {
      const el = row();
      if (el) el.scrollLeft += (dir * GLIDE * TICK_MS) / 1000;
    }, TICK_MS);
  };
  const page = (dir: 1 | -1) => {
    stop();
    const el = row();
    el?.scrollBy({ left: dir * el.clientWidth * PAGE, behavior: "smooth" });
  };
  // an arrow that goes away under the pointer (the row reached its end) stops its glide
  useEffect(() => {
    if (!more.left || !more.right) stop();
  }, [more]);

  const tab = (dir: 1 | -1) => (
    <button
      type="button"
      className={`slider__tab slider__tab--${dir < 0 ? "left" : "right"}`}
      aria-label={dir < 0 ? m.back : m.on}
      onClick={() => page(dir)}
      onPointerEnter={(e) => e.pointerType === "mouse" && start(dir)}
      onPointerLeave={stop}
    >
      {dir < 0 ? (
        <CaretLeft size={18} weight="bold" aria-hidden="true" />
      ) : (
        <CaretRight size={18} weight="bold" aria-hidden="true" />
      )}
    </button>
  );

  return (
    <div className="slider" ref={wrap}>
      {children}
      {more.left && tab(-1)}
      {more.right && tab(1)}
    </div>
  );
}
