import { useEffect, useRef, useState } from "react";
import { ArrowsClockwise, FloppyDisk, Play } from "@phosphor-icons/react";
import Button from "../../components/Button/index.tsx";
import Face from "../../components/Face/index.tsx";
import Field from "../../components/Field/index.tsx";
import EditorPage from "../../components/EditorPage/index.tsx";
import FaceEditor from "../../components/FaceEditor/index.tsx";
import { api } from "../../api.ts";
import { navigate, rememberDynasty } from "../../router.ts";
import { cachedTeams, loadTeams } from "../../teams.ts";
import { randomFace, type Face as FaceSpec } from "../../faces.ts";
import type { Theme } from "../../theme.ts";
import type { CoachOptions, SavedCoach, TeamCard } from "../../types.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

interface Props {
  theme: Theme;
  onToggleTheme: () => void;
  /** the team picked on Play (?team=), if any */
  teamSlug: string | null;
}

/** *tune* The age a new coach starts at, and the youngest and oldest allowed. */
const DEFAULT_AGE = 42;
const MIN_AGE = 28;
const MAX_AGE = 75;

/** A coach's full name as first and last: the last word is the last name ("P. J. Fleck" → "P. J.", "Fleck"). */
function splitName(full: string | undefined): [string, string] {
  const words = (full ?? "").trim().split(/\s+/).filter(Boolean);
  return words.length < 2 ? [words[0] ?? "", ""] : [words.slice(0, -1).join(" "), words[words.length - 1]];
}

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "starting" }
  | { kind: "saved"; name: string }
  | { kind: "error"; msg: string };

/** /coach/edit: build a coach's face from pocket-faces parts, name them, and save them to the game. */
export default function CoachEdit({ theme, onToggleTheme, teamSlug }: Props) {
  const [team, setTeam] = useState<TeamCard | null>(() => cachedTeams()?.find((t) => t.slug === teamSlug) ?? null);
  const [face, setFace] = useState<FaceSpec>(randomFace);
  // the picked team's head coach fills the name fields (the viewer can change them)
  const [first, setFirst] = useState(() => splitName(team?.head_coach)[0]);
  const [last, setLast] = useState(() => splitName(team?.head_coach)[1]);
  const prefilled = useRef(team?.slug ?? null);
  const [age, setAge] = useState(DEFAULT_AGE);
  const [hometown, setHometown] = useState("");
  const [coachId, setCoachId] = useState<string | null>(null);
  const [blank, setBlank] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    api<CoachOptions>("/api/coach-options")
      .then((o) => setBlank(o.blank))
      .catch((e: Error) => setStatus({ kind: "error", msg: m.loadError(e.message) }));
  }, []);

  useEffect(() => {
    if (!teamSlug) return;
    loadTeams()
      .then((all) => setTeam(all.find((t) => t.slug === teamSlug) ?? null))
      .catch(() => setTeam(null));
  }, [teamSlug]);

  // a team that arrives after the first draw (not yet cached) fills the names once, unless the viewer already typed
  useEffect(() => {
    if (!team || prefilled.current === team.slug) return;
    prefilled.current = team.slug;
    const [f, l] = splitName(team.head_coach);
    setFirst((cur) => cur || f);
    setLast((cur) => cur || l);
  }, [team]);

  const named = first.trim() !== "" && last.trim() !== "";
  const fullName = `${first.trim()} ${last.trim()}`.trim();
  const save = async () => {
    if (!named || !blank) return;
    setStatus({ kind: "saving" });
    try {
      const coach = await api<SavedCoach>("/api/coaches", {
        method: "POST",
        body: { coach: { ...blank, id: coachId, first_name: first, last_name: last, age, hometown, face } },
      });
      setCoachId(coach.id);
      if (!teamSlug) {
        setStatus({ kind: "saved", name: `${coach.first_name} ${coach.last_name}` });
        return;
      }
      // opened for a team: confirming the coach starts a Coach Career there and enters the game
      setStatus({ kind: "starting" });
      try {
        const season = await api<{ id: string }>("/api/season", {
          method: "POST",
          body: { team: teamSlug, coach: coach.id },
        });
        if (teamSlug) rememberDynasty(season.id, teamSlug);
        navigate("game", { id: season.id });
      } catch (e) {
        setStatus({ kind: "error", msg: m.startError((e as Error).message) });
      }
    } catch (e) {
      setStatus({ kind: "error", msg: m.saveError((e as Error).message) });
    }
  };

  const change = (next: FaceSpec) => {
    setFace(next);
    setStatus({ kind: "idle" });
  };

  const side = (
    <>
      <div className="coach__portrait">
        <Face face={face} scale={6} label={fullName || m.preview} />
      </div>
      <p className="coach__name">{fullName || m.preview}</p>

      <div className="coach__fields">
        <Field label={m.firstName}>
          <input value={first} maxLength={30} onChange={(e) => setFirst(e.target.value)} autoComplete="off" />
        </Field>
        <Field label={m.lastName}>
          <input value={last} maxLength={30} onChange={(e) => setLast(e.target.value)} autoComplete="off" />
        </Field>
        <Field label={m.age}>
          <input
            type="number"
            min={MIN_AGE}
            max={MAX_AGE}
            value={age}
            onChange={(e) => setAge(Math.max(MIN_AGE, Math.min(MAX_AGE, Number(e.target.value) || DEFAULT_AGE)))}
          />
        </Field>
        <Field label={m.hometown}>
          <input value={hometown} maxLength={60} onChange={(e) => setHometown(e.target.value)} autoComplete="off" />
        </Field>
      </div>

      <div className={teamSlug ? "coach__actions coach__actions--stacked" : "coach__actions"}>
        <Button variant="outline" onClick={() => change(randomFace())}>
          <ArrowsClockwise size={18} weight="bold" aria-hidden="true" />
          {m.randomize}
        </Button>
        <Button onClick={save} disabled={!named || !blank || status.kind === "saving" || status.kind === "starting"}>
          {teamSlug ? (
            <Play size={18} weight="fill" aria-hidden="true" />
          ) : (
            <FloppyDisk size={18} weight="bold" aria-hidden="true" />
          )}
          {status.kind === "saving"
            ? m.saving
            : status.kind === "starting"
              ? m.starting
              : teamSlug
                ? m.confirm
                : m.save}
        </Button>
      </div>
      <p className="coach__status" role="status">
        {status.kind === "saved" && m.saved(status.name)}
        {status.kind === "error" && status.msg}
        {status.kind === "idle" && !named && m.needName}
      </p>
    </>
  );

  return (
    <EditorPage
      theme={theme}
      onToggleTheme={onToggleTheme}
      back={{ route: "play", params: teamSlug ? { team: teamSlug } : undefined, label: m.back }}
      title={m.title}
      lede={team ? m.forTeam(team.name) : m.intro}
      side={side}
    >
      <FaceEditor face={face} onChange={change} />
    </EditorPage>
  );
}
