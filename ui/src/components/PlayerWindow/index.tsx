import { useEffect, useState } from "react";
import Modal from "../Modal/index.tsx";
import PlayerView from "../PlayerView/index.tsx";
import { api } from "../../api.ts";
import type { DepthCard, PlayerProfile } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

/** A player named somewhere on the page (a box score's line): his team, and how the page knows him. */
export interface PlayerRef {
  team: string;
  name: string;
  position?: string;
}

interface Props {
  seasonId: string;
  /** the player to show; null closes the window */
  who: PlayerRef | null;
  weekLabels?: Record<string, string>;
  onClose: () => void;
}

type Load = { key: string; card: DepthCard | null; profile: PlayerProfile | null; error?: string };
const keyOf = (w: PlayerRef) => `${w.team}|${w.name}|${w.position ?? ""}`;

/**
 * Any player's card in a window, from his team and name: the same card the Depth Chart opens, for a player on any FBS
 * team. His card comes from his team's roster, then his profile fills in.
 */
export default function PlayerWindow({ seasonId, who, weekLabels, onClose }: Props) {
  const [load, setLoad] = useState<Load | null>(null);

  useEffect(() => {
    if (!who) return;
    const key = keyOf(who);
    let live = true;
    setLoad(null);
    api<{ players: DepthCard[] }>(`/api/season/${seasonId}/depth/${who.team}/roster`)
      .then((r) => {
        const named = r.players.filter((p) => p.name === who.name);
        const card = named.find((p) => p.position === who.position) ?? named[0] ?? null;
        if (!live) return;
        if (!card) return setLoad({ key, card: null, profile: null, error: m.notFound(who.name) });
        setLoad({ key, card, profile: null });
        return api<PlayerProfile>(
          `/api/season/${seasonId}/player?team=${encodeURIComponent(who.team)}&slug=${encodeURIComponent(card.slug)}`,
        ).then((profile) => live && setLoad({ key, card, profile }));
      })
      .catch(
        (e: Error) => live && setLoad((prev) => ({ key, card: prev?.card ?? null, profile: null, error: e.message })),
      );
    return () => {
      live = false;
    };
  }, [seasonId, who && keyOf(who)]);

  const ready = who && load?.key === keyOf(who) ? load : null;
  return (
    <Modal open={!!who} onClose={onClose} title={who?.name ?? ""} head={<span />} tall>
      {!ready ? (
        <p className="player-window__note">{m.loading}</p>
      ) : !ready.card ? (
        <p className="player-window__note">{m.loadError(ready.error ?? "")}</p>
      ) : (
        <PlayerView
          key={ready.card.slug}
          card={ready.card}
          profile={ready.profile}
          error={ready.profile ? null : (ready.error ?? null)}
          weekLabels={weekLabels}
        />
      )}
    </Modal>
  );
}
