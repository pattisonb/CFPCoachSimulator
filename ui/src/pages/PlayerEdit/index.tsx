import { useEffect, useState } from "react";
import { ArrowCounterClockwise, ArrowsClockwise, FloppyDisk } from "@phosphor-icons/react";
import Button from "../../components/Button/index.tsx";
import EditorPage from "../../components/EditorPage/index.tsx";
import Face from "../../components/Face/index.tsx";
import FaceEditor from "../../components/FaceEditor/index.tsx";
import { api } from "../../api.ts";
import { lookOf, playerFace, randomFace, type Face as FaceSpec } from "../../faces.ts";
import { formatClass } from "../../format.ts";
import type { Theme } from "../../theme.ts";
import type { PlayerProfile } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  theme: Theme;
  onToggleTheme: () => void;
  /** ?season=, ?team=, ?player= : whose look, in which season */
  seasonId: string | null;
  team: string | null;
  player: string | null;
}

type Load = { kind: "loading" } | { kind: "error"; msg: string } | { kind: "ready"; p: PlayerProfile };
type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "reset" }
  | { kind: "error"; msg: string };

/**
 * /player/edit: any player's look for the rest of a season, with Your Coach's face parts. Saving stores the face
 * with the season (POST /api/season/{id}/player/face), so the depth chart and his card draw it; His Own Face goes
 * back to the one drawn from his id. A look only: his ratings and every game stay as they are.
 */
export default function PlayerEdit({ theme, onToggleTheme, seasonId, team, player }: Props) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [face, setFace] = useState<FaceSpec | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    if (!seasonId || !team || !player) return;
    let live = true;
    api<PlayerProfile>(
      `/api/season/${seasonId}/player?team=${encodeURIComponent(team)}&slug=${encodeURIComponent(player)}`,
    )
      .then((p) => {
        if (!live) return;
        setLoad({ kind: "ready", p });
        setFace(lookOf(p.face, p.slug, p.position));
      })
      .catch((e: Error) => live && setLoad({ kind: "error", msg: e.message }));
    return () => {
      live = false;
    };
  }, [seasonId, team, player]);

  const back = {
    route: "game" as const,
    params: seasonId ? { id: seasonId, section: "depth" } : undefined,
    label: m.back,
  };
  const p = load.kind === "ready" ? load.p : null;

  const store = async (next: FaceSpec | null) => {
    if (!seasonId || !team || !p) return;
    setStatus({ kind: "saving" });
    try {
      await api(`/api/season/${seasonId}/player/face`, { method: "POST", body: { team, player: p.slug, face: next } });
      if (next === null) setFace(playerFace(p.slug, p.position));
      setStatus({ kind: next === null ? "reset" : "saved" });
    } catch (e) {
      setStatus({ kind: "error", msg: m.saveError((e as Error).message) });
    }
  };
  const change = (next: FaceSpec) => {
    setFace(next);
    setStatus({ kind: "idle" });
  };

  const missing = !seasonId || !team || !player;
  const side =
    p && face ? (
      <>
        <div className="player-edit__portrait">
          <Face face={face} scale={6} label={p.name} />
        </div>
        <div>
          <p className="player-edit__name">{p.name}</p>
          <p className="player-edit__line">
            {m.line([p.jersey ? m.jersey(p.jersey) : null, p.position, formatClass(p.class)])}
          </p>
        </div>
        <div className="player-edit__actions">
          <Button variant="outline" onClick={() => change(randomFace())}>
            <ArrowsClockwise size={18} weight="bold" aria-hidden="true" />
            {m.randomize}
          </Button>
          <Button variant="outline" title={m.resetHint} disabled={status.kind === "saving"} onClick={() => store(null)}>
            <ArrowCounterClockwise size={18} weight="bold" aria-hidden="true" />
            {m.reset}
          </Button>
          <Button disabled={status.kind === "saving"} onClick={() => store(face)}>
            <FloppyDisk size={18} weight="bold" aria-hidden="true" />
            {status.kind === "saving" ? m.saving : m.save}
          </Button>
        </div>
        <p className="player-edit__status" role="status">
          {status.kind === "saved" && m.saved}
          {status.kind === "reset" && m.resetDone}
          {status.kind === "error" && status.msg}
        </p>
      </>
    ) : (
      <p className="player-edit__status" role="status">
        {missing ? m.missing : load.kind === "error" ? m.loadError(load.msg) : m.loading}
      </p>
    );

  return (
    <EditorPage
      theme={theme}
      onToggleTheme={onToggleTheme}
      back={back}
      title={m.title}
      lede={p ? m.lede(p.team.name) : undefined}
      side={side}
    >
      {face && <FaceEditor face={face} onChange={change} />}
    </EditorPage>
  );
}
