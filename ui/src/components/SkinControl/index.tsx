import { useEffect, useRef, useState } from "react";
import Button from "../Button/index.tsx";
import Tooltip from "../Tooltip/index.tsx";
import { gameSkin } from "../../gameClient.ts";
import { SkinError, available, current, failure, install, remove } from "../../skin.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

/**
 * Skins on the start screen: Load a Skin (a file picker), or the name of the skin that is on beside Remove Skin, and
 * under them a line when there is something to say (a file that was not taken, a skin older than the game). Loading
 * or removing one starts the page again. Shows nothing where the game takes no skin (`npm run dev`).
 */
export default function SkinControl() {
  const [skin] = useState(current);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(() => {
    const why = failure();
    return why ? m.failed(why) : null;
  });
  const picker = useRef<HTMLInputElement>(null);

  // once the game is up it says whether the skin fits this version
  useEffect(() => {
    if (!skin) return;
    let live = true;
    void gameSkin().then((r) => {
      if (!live || !r) return;
      if (r.missed || window.__skinApp?.missed) setNote(m.missed);
      else if (r.stale) setNote(m.stale);
    });
    return () => {
      live = false;
    };
  }, [skin]);

  if (!available()) return null;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setNote(null);
    try {
      await install(file);
      location.reload();
    } catch (e) {
      setBusy(false);
      setNote(e instanceof SkinError ? e.message : String((e as Error).message || e));
    }
  };

  const takeOff = async () => {
    setBusy(true);
    await remove();
    location.reload();
  };

  return (
    <>
      {skin ? (
        <span className="skin-control">
          <Tooltip title={m.tipTitle} text={m.onTip}>
            <span className="skin-control__on">{m.on(skin.name)}</span>
          </Tooltip>
          <Button variant="outline" disabled={busy} onClick={takeOff}>
            {busy ? m.removing : m.remove}
          </Button>
        </span>
      ) : (
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
      )}
      {note && (
        <p className="skin-control__note" role="alert">
          {note}
          <Button variant="outline" onClick={() => setNote(null)}>
            {m.dismiss}
          </Button>
        </p>
      )}
    </>
  );
}
