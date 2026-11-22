import { StopCircle } from "@phosphor-icons/react";
import type { SimStatus } from "../../types.ts";
import "./index.css";
import { messages as m } from "./messages.ts";

interface Props {
  status: SimStatus;
  /** stop once the week in progress is over */
  onStop: () => void;
}

/**
 * The bar along the bottom of the game's window while a sim runs (it takes the ticker's place): a blinking Simming
 * plate in your color, what the sim is on, a striped bar that fills as the week's games are played, and Stop. With
 * the rest of the window gone gray (pages/Game), it is the one thing in color: nobody misses that a sim is running.
 */
export default function SimBar({ status: st, onStop }: Props) {
  const pct = Math.round(100 * (st.progress ?? 0));
  const more = st.total - st.done > 1;
  return (
    <aside className="sim-bar" role="status" aria-label={m.simming}>
      <span className="sim-bar__plate">
        <i className="sim-bar__dot" aria-hidden="true" />
        {m.simming}
      </span>
      <span className="sim-bar__what">
        <b>{st.stage ?? m.working}</b>
        {!!st.games_total && <span className="sim-bar__soft">{m.games(st.games_done ?? 0, st.games_total)}</span>}
      </span>
      <span className="sim-bar__track" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </span>
      <b className="sim-bar__pct">{m.pct(pct)}</b>
      {more && (
        <button type="button" className="sim-bar__stop" onClick={onStop} data-sim-allow>
          <StopCircle size={16} weight="bold" aria-hidden="true" />
          {m.stop}
        </button>
      )}
    </aside>
  );
}
