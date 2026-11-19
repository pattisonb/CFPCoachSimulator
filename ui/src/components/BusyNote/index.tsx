import { createPortal } from "react-dom";
import { useBusy } from "../../busy.ts";
import "./index.css";

/**
 * The game's "working on it" notice: a pill at the bottom of the screen with a spinner and what is happening, for as
 * long as something slow runs (busy.ts). One sits at the app's root; it draws inside an open window when there is
 * one, since a window covers the page.
 */
export default function BusyNote() {
  const text = useBusy();
  if (!text) return null;
  return createPortal(
    <div className="busy-note" role="status" aria-live="polite">
      <span className="busy-note__spin" aria-hidden="true" />
      {text}
    </div>,
    document.querySelector<HTMLElement>("dialog[open]") ?? document.body,
  );
}
