import { useEffect, useRef } from "react";
import { ArrowRight, Crown, Diamond } from "@phosphor-icons/react";
import Face from "../Face/index.tsx";
import { playerFace } from "../../faces.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

/** A find worth stopping for: a gem or a generational talent your staff has just flagged. */
export interface Find {
  pid: string;
  name: string;
  position: string;
  stars: number;
  flag: "gem" | "generational";
}

interface Props {
  /** the find to show; null shows nothing */
  find: Find | null;
  /** how many more are waiting behind this one */
  more?: number;
  /** open his file */
  onOpen: (pid: string) => void;
  onClose: () => void;
}

/**
 * The moment your staff finds a gem or a generational talent: the whole screen dims, rays turn behind a stamped icon,
 * and his name lands under it. Two ways on: his file, or back to what you were doing (Escape and a click outside the
 * card do the same). It opens in the top layer, so it sits over any window that is open.
 */
export default function FindReveal({ find, more = 0, onOpen, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (find && !el.open) el.showModal();
    if (!find && el.open) el.close();
  }, [find]);
  const gen = find?.flag === "generational";
  const Icon = gen ? Crown : Diamond;
  return (
    <dialog
      ref={ref}
      className={`find-reveal${gen ? " is-generational" : ""}`}
      aria-label={find ? (gen ? m.generational : m.gem) : undefined}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {find && (
        <div className="find-reveal__card" key={find.pid}>
          <span className="find-reveal__rays" aria-hidden="true" />
          <span className="find-reveal__icon" aria-hidden="true">
            <Icon size={72} weight="fill" />
          </span>
          <span className="label find-reveal__kicker">{m.kicker}</span>
          <h2 className="find-reveal__title">{gen ? m.generational : m.gem}</h2>
          <div className="find-reveal__who">
            <span className="face-tile find-reveal__face">
              <Face face={playerFace(find.pid, find.position)} scale={3} label="" />
            </span>
            <span className="find-reveal__name">
              <b>{find.name}</b>
              <span>
                {find.position} · {m.stars(find.stars)}
              </span>
            </span>
          </div>
          <p className="find-reveal__line">{gen ? m.generationalLine : m.gemLine}</p>
          <div className="find-reveal__actions">
            <button type="button" className="find-reveal__go" onClick={() => onOpen(find.pid)}>
              {m.open}
              <ArrowRight size={16} weight="bold" aria-hidden="true" />
            </button>
            <button type="button" className="find-reveal__skip" onClick={onClose}>
              {more > 0 ? m.next(more) : m.close}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
