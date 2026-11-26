import { useMemo, useState } from "react";
import { ArrowsLeftRight, Check, Sparkle } from "@phosphor-icons/react";
import Face from "../Face/index.tsx";
import FolderTabs from "../FolderTabs/index.tsx";
import {
  CATALOG,
  COACH_CATALOG,
  faces,
  titleCase,
  withFlip,
  type CatalogEntry,
  type Face as FaceSpec,
  type FaceField,
} from "../../faces.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

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
const shown = (catalog: CatalogEntry[]) =>
  catalog.filter((e) => e.choices.length > 1).sort((a, b) => rank(a.field) - rank(b.field));
const ENTRIES = shown(CATALOG);
/** A coach's fields: the same, with the hair colors kept for coaches (gray). */
const COACH_ENTRIES = shown(COACH_CATALOG);
const rgb = (c: [number, number, number]) => `rgb(${c.join(" ")})`;

interface Props {
  face: FaceSpec;
  onChange: (face: FaceSpec) => void;
  /** the face is a coach's: gray hair is one of his colors */
  coach?: boolean;
}

/**
 * The face parts, shared by Your Coach and Edit Player Look: one tab per group (Head, Hair, Features), a row of
 * choices per field, each shown as a thumbnail of the face with that part (or a color swatch).
 */
export default function FaceEditor({ face, onChange, coach }: Props) {
  const [group, setGroup] = useState<Group>("head");
  const entries = useMemo(
    () => (coach ? COACH_ENTRIES : ENTRIES).filter((e) => groupOf(e.field) === group),
    [group, coach],
  );
  return (
    <FolderTabs
      label={m.partsLabel}
      tabs={GROUP_KEYS.map((g) => ({ key: g, label: m.groups[g] }))}
      value={group}
      onChange={setGroup}
      panelClassName="face-editor__panel"
    >
      {entries.map((entry) => (
        <PartRow key={entry.field} entry={entry} face={face} onChange={onChange} />
      ))}
    </FolderTabs>
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
