import { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import Button from "../Button/index.tsx";
import Tooltip from "../Tooltip/index.tsx";
import { gameSkin } from "../../gameClient.ts";
import { SkinError, available, current, failure, install, remove } from "../../skin.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  /** something to say about a skin (a file that was not taken, a skin older than the game), or null: nothing */
  onNote: (note: string | null) => void;
}

/**
 * Skins on the start screen: Load a Skin (a file picker), or the name of the skin that is on with Remove Skin at its
 * end. Loading or removing one starts the page again. What there is to say goes to `onNote` (the page shows it).
 * Shows nothing where the game takes no skin (`npm run dev`).
 */
export default function SkinControl({ onNote }: Props) {
  const [skin] = useState(current);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  // why the game took the last skin off, said once; and, once the game is up, whether this one fits this version
  useEffect(() => {
    const why = failure();
    if (why) onNote(m.failed(why));
    if (!skin) return;
    let live = true;
    void gameSkin().then((r) => {
      if (!live || !r) return;
      if (r.missed || window.__skinApp?.missed) onNote(m.missed);
      else if (r.stale) onNote(m.stale);
    });
    return () => {
      live = false;
    };
  }, [skin, onNote]);

  if (!available()) return null;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    onNote(null);
    try {
      await install(file);
      location.reload();
    } catch (e) {
      setBusy(false);
      onNote(e instanceof SkinError ? e.message : String((e as Error).message || e));
    }
  };

  const takeOff = async () => {
    setBusy(true);
    await remove();
    location.reload();
  };

  if (skin)
    return (
      <span className="skin-control">
        <Tooltip title={m.tipTitle} text={m.onTip}>
          <span className="skin-control__on">{m.on(skin.name)}</span>
        </Tooltip>
        <Tooltip title={m.remove} text={m.removeTip}>
          <button
            type="button"
            className="skin-control__remove"
            aria-label={m.remove}
            disabled={busy}
            onClick={takeOff}
          >
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </Tooltip>
      </span>
    );

  return (
    <Tooltip title={m.tipTitle} text={m.tip}>
      <Button variant="outline" disabled={busy} onClick={() => picker.current?.click()}>
        {busy ? m.reading : m.load}
      </Button>
      <input
        ref={picker}
        className="skin-control__file"
        type="file"
        accept=".json,.gz,application/json,application/gzip"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // the same file can be picked again
          void pick(file);
        }}
      />
    </Tooltip>
  );
}
