import { useEffect, useState } from "react";
import BoxScore from "../BoxScore/index.tsx";
import GameDay from "../GameDay/index.tsx";
import Modal from "../Modal/index.tsx";
import PlayerWindow, { type PlayerRef } from "../PlayerWindow/index.tsx";
import { api } from "../../api.ts";
import { hasLog, type GameBox } from "../../gamelog.ts";
import type { TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  seasonId: string;
  /** the game to show; null closes the window */
  eventId: string | null;
  /** play it back live (Game Day) before the box score */
  live?: boolean;
  teams: Map<string, TeamCard>;
  /** your team's slug */
  mine: string;
  /** the season's week names, for a player's card */
  weekLabels?: Record<string, string>;
  /** a live game has reached its final (or was skipped or closed): its result may now show on the page behind */
  onFinal?: () => void;
  onClose: () => void;
}

type Load = { id: string; box: GameBox | null; error?: string };

/**
 * A game in a window: its box score, or, for Game Day, the game played back first and the box score after. Any screen
 * that lists a played game opens it here.
 */
export default function GameWindow({ seasonId, eventId, live, teams, mine, weekLabels, onFinal, onClose }: Props) {
  /** a player picked from the box score: his card opens over the game */
  const [who, setWho] = useState<PlayerRef | null>(null);
  const [load, setLoad] = useState<Load | null>(null);
  /** the live game has given way to the box score */
  const [boxed, setBoxed] = useState(false);

  useEffect(() => {
    setBoxed(false);
    if (!eventId) return;
    let on = true;
    api<GameBox>(`/api/season/${seasonId}/game/${eventId}`)
      .then((box) => on && setLoad({ id: eventId, box }))
      .catch((e: Error) => on && setLoad({ id: eventId, box: null, error: e.message }));
    return () => {
      on = false;
    };
  }, [seasonId, eventId]);

  const ready = load && load.id === eventId ? load : null;
  const box = ready?.box ?? null;
  // a game with no play log (an imported result) has nothing to play back
  const playing = !!live && !boxed && !!box && hasLog(box);
  useEffect(() => {
    if (live && ready && !playing) onFinal?.();
  }, [live, ready, playing]);

  const close = () => {
    if (live) onFinal?.();
    onClose();
  };

  return (
    <>
      <Modal
        open={!!eventId}
        onClose={close}
        title={box ? m.title(box.away.name, box.home.name) : m.loading}
        lede={playing ? m.gameDay : undefined}
        tall
      >
        {!ready ? (
          <p className="game-window__note">{m.loading}</p>
        ) : !box ? (
          <p className="game-window__note">{m.loadError(ready.error ?? "")}</p>
        ) : playing ? (
          <GameDay
            key={ready.id}
            box={box}
            teams={teams}
            mine={mine}
            onFinal={() => onFinal?.()}
            onBox={() => setBoxed(true)}
          />
        ) : (
          <BoxScore
            key={ready.id}
            box={box}
            teams={teams}
            mine={mine}
            onPlayer={(team, p) => setWho({ team, name: p.name, position: p.position })}
          />
        )}
      </Modal>
      {/* beside the game's window, not inside it, so closing his card leaves the game open */}
      <PlayerWindow seasonId={seasonId} who={who} weekLabels={weekLabels} onClose={() => setWho(null)} />
    </>
  );
}
