import { useEffect, useMemo, useState } from "react";
import { ArrowsClockwise, ArrowsLeftRight, Check, FloppyDisk, Sparkle } from "@phosphor-icons/react";
import Button from "../../components/Button/index.tsx";
import Face from "../../components/Face/index.tsx";
import Field from "../../components/Field/index.tsx";
import EditorPage from "../../components/EditorPage/index.tsx";
import FolderTabs from "../../components/FolderTabs/index.tsx";
import { api } from "../../api.ts";
import { cachedTeams, loadTeams } from "../../teams.ts";
import {
  CATALOG,
  faces,
  randomFace,
  titleCase,
  withFlip,
  type CatalogEntry,
  type Face as FaceSpec,
  type FaceField,
} from "../../faces.ts";
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

type Group = keyof typeof m.groups;

/** *tune* Which tab each face field is on, in the order shown; a field the data adds later goes last on the last tab. */
const GROUP_OF: Record<string, Group> = {
  faceShape: "head",
  skinTone: "head",
  ears: "head",
  chin: "head",
  hair: "hair",
  hairColor: "hair",
  beard: "hair",
  brows: "hair",
  eyeColor: "features",
  nose: "features",
  mouth: "features",
};
const FIELD_ORDER = Object.keys(GROUP_OF);
const rank = (field: string) => (FIELD_ORDER.includes(field) ? FIELD_ORDER.indexOf(field) : FIELD_ORDER.length);
const GROUP_KEYS = Object.keys(m.groups) as Group[];
const groupOf = (field: string): Group => GROUP_OF[field] ?? GROUP_KEYS[GROUP_KEYS.length - 1];

/** A field's name: ours where we have one (Title Case, American), else the data's. */
const fieldLabel = (e: CatalogEntry) => (m.fields as Record<string, string>)[e.field] ?? titleCase(e.label);

/** The fields a customizer shows: those with more than one choice. */
const ENTRIES = CATALOG.filter((e) => e.choices.length > 1).sort((a, b) => rank(a.field) - rank(b.field));
const rgb = (c: [number, number, number]) => `rgb(${c.join(" ")})`;

/** *tune* The age a new coach starts at, and the youngest and oldest allowed. */
const DEFAULT_AGE = 42;
const MIN_AGE = 28;
const MAX_AGE = 75;

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; name: string } | { kind: "error"; msg: string };

/** /coach/edit: build a coach's face from pocket-faces parts, name them, and save them to the game. */
export default function CoachEdit({ theme, onToggleTheme, teamSlug }: Props) {
  const [face, setFace] = useState<FaceSpec>(randomFace);
  const [group, setGroup] = useState<Group>("head");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [age, setAge] = useState(DEFAULT_AGE);
  const [hometown, setHometown] = useState("");
  const [coachId, setCoachId] = useState<string | null>(null);
  const [blank, setBlank] = useState<Record<string, unknown> | null>(null);
  const [team, setTeam] = useState<TeamCard | null>(() => cachedTeams()?.find((t) => t.slug === teamSlug) ?? null);
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
      setStatus({ kind: "saved", name: `${coach.first_name} ${coach.last_name}` });
    } catch (e) {
      setStatus({ kind: "error", msg: m.saveError((e as Error).message) });
    }
  };

  const entries = useMemo(() => ENTRIES.filter((e) => groupOf(e.field) === group), [group]);
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

      <div className="coach__actions">
        <Button variant="outline" onClick={() => change(randomFace())}>
          <ArrowsClockwise size={18} weight="bold" aria-hidden="true" />
          {m.randomize}
        </Button>
        <Button onClick={save} disabled={!named || !blank || status.kind === "saving"}>
          <FloppyDisk size={18} weight="bold" aria-hidden="true" />
          {status.kind === "saving" ? m.saving : m.save}
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
      {/* the parts: one tab per group, a row of choices per field */}
      <FolderTabs
        label={m.partsLabel}
        tabs={GROUP_KEYS.map((g) => ({ key: g, label: m.groups[g] }))}
        value={group}
        onChange={setGroup}
        panelClassName="coach__panel"
      >
        {entries.map((entry) => (
          <PartRow key={entry.field} entry={entry} face={face} onChange={change} />
        ))}
      </FolderTabs>
    </EditorPage>
  );
}

/**
 * One face field: its name and the chosen part's, its toggles (Fade, Flip: always there, greyed out when they'd
 * change nothing, so nothing moves), then every choice as a face thumbnail or a color swatch.
 */
function PartRow({ entry, face, onChange }: { entry: CatalogEntry; face: FaceSpec; onChange: (f: FaceSpec) => void }) {
  const field: FaceField = entry.field;
  const label = fieldLabel(entry);
  const current = entry.choices.find((c) => c.id === face[field]);
  const swatches = entry.choices.every((c) => c.rgb);
  const category = entry.category;
  const canFade = field === "hair" && faces.canFade(face);
  const canFlip = !!(entry.flip && category && faces.canFlip(face, category));
  const flipped = !!category && face.flip.includes(category);
  const id = `part-${field}`;

  return (
    <div className="part" role="group" aria-labelledby={id}>
      <div className="part__head">
        <span className="label" id={id}>
          {label}
        </span>
        {current && <span className="part__current">{titleCase(current.label)}</span>}
        <span className="part__toggles">
          {field === "hair" && (
            <button
              type="button"
              className="part__toggle"
              aria-pressed={face.hairFade}
              disabled={!canFade}
              title={canFade ? m.fadeHint : m.noFade}
              onClick={() => onChange(faces.resolve({ ...face, hairFade: !face.hairFade }))}
            >
              <Sparkle size={14} weight="bold" aria-hidden="true" />
              {m.fade}
            </button>
          )}
          {entry.flip && category && (
            <button
              type="button"
              className="part__toggle"
              aria-pressed={flipped}
              aria-label={m.flipLabel(label)}
              disabled={!canFlip}
              title={canFlip ? m.flipHint : m.noFlip}
              onClick={() => onChange(withFlip(face, category, !flipped))}
            >
              <ArrowsLeftRight size={14} weight="bold" aria-hidden="true" />
              {m.flip}
            </button>
          )}
        </span>
      </div>
      <div className={swatches ? "part__swatches" : "part__faces"}>
        {entry.choices.map((choice) => {
          const name = choice.id === null ? m.none : titleCase(choice.label);
          const on = face[field] === choice.id;
          return (
            <button
              key={choice.id ?? "none"}
              type="button"
              className={["part__option", swatches && "part__option--swatch", on && "is-on"].filter(Boolean).join(" ")}
              aria-pressed={on}
              title={name}
              onClick={() => onChange(faces.resolve({ ...face, [field]: choice.id }))}
            >
              {swatches && choice.rgb ? (
                <>
                  <span className="part__swatch" style={{ background: rgb(choice.rgb) }} aria-hidden="true" />
                  <span className="part__name">{name}</span>
                </>
              ) : (
                <Face face={faces.resolve({ ...face, [field]: choice.id })} scale={2} label={name} />
              )}
              {on && !swatches && (
                <span className="part__tick" aria-hidden="true">
                  <Check size={14} weight="bold" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
