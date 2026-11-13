import { useId, useMemo, useState } from "react";
import { CaretDown, Check, MagnifyingGlass, PencilSimple, Plus } from "@phosphor-icons/react";
import { useListPopover } from "../../listPopover.ts";
import { messages as m } from "./messages.ts";
import "./index.css";

/** One of the viewer's programs, as the list shows it. */
export interface PickerProgram {
  id: string;
  name: string;
  /** a short line under the name: "New Program", "Edits Texas" */
  meta: string;
  primary: string;
  secondary: string;
}

/** A real team that can be edited. */
export interface PickerTeam {
  slug: string;
  name: string;
  abbreviation: string;
  /** already has an edit among the viewer's programs */
  edited: boolean;
}

interface Props {
  label: string;
  programs: PickerProgram[];
  teams: PickerTeam[];
  /** the open program's id */
  value: string | null;
  onPick: (id: string) => void;
  onNew: () => void;
  onEditReal: (slug: string) => void;
}

type Item = { kind: "new" } | { kind: "mine"; p: PickerProgram } | { kind: "real"; t: PickerTeam };

function Swatch({ primary, secondary }: { primary: string; secondary: string }) {
  return <span className="program-picker__swatch" style={{ background: primary, borderColor: secondary }} />;
}

const keyOf = (it: Item) => (it.kind === "new" ? "new" : it.kind === "mine" ? it.p.id : it.t.slug);

/**
 * Pick which program to edit: one of yours, a new one, or a real team to change. Type to filter, arrows to move,
 * Enter to pick, Escape to close.
 */
export default function ProgramPicker({ label, programs, teams, value, onPick, onNew, onEditReal }: Props) {
  const id = useId();
  const [query, setQuery] = useState("");

  const selected = programs.find((p) => p.id === value) ?? null;
  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const has = (s: string) => s.toLowerCase().includes(q);
    return [
      { kind: "new" },
      ...programs.filter((p) => has(`${p.name} ${p.meta}`)).map((p) => ({ kind: "mine" as const, p })),
      ...teams.filter((t) => has(`${t.name} ${t.abbreviation}`)).map((t) => ({ kind: "real" as const, t })),
    ];
  }, [programs, teams, query]);

  const pop = useListPopover({ count: items.length, minWidth: 420, maxHeight: 480, align: "right" });
  const { open, active } = pop;

  const show = () => {
    setQuery("");
    pop.show(Math.max(0, programs.findIndex((p) => p.id === value) + 1));
  };
  const choose = (it: Item) => {
    if (it.kind === "new") onNew();
    else if (it.kind === "mine") onPick(it.p.id);
    else onEditReal(it.t.slug);
    pop.close();
  };

  return (
    <div className="program-picker" ref={pop.root}>
      <span className="label" id={`${id}-label`}>
        {label}
      </span>
      <button
        ref={pop.trigger}
        type="button"
        className="program-picker__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => (open ? pop.close() : show())}
      >
        <span id={`${id}-value`} className="program-picker__value">
          {selected ? (
            <>
              <Swatch primary={selected.primary} secondary={selected.secondary} />
              <span className="program-picker__text">
                <span className="program-picker__name">{selected.name}</span>
                <span className="program-picker__meta">{selected.meta}</span>
              </span>
            </>
          ) : (
            m.loading
          )}
        </span>
        <CaretDown size={18} weight="bold" aria-hidden="true" />
      </button>

      {open && (
        <div className="program-picker__pop" style={pop.place}>
          <label className="program-picker__search">
            <MagnifyingGlass size={18} weight="bold" aria-hidden="true" />
            <input
              ref={pop.input}
              role="combobox"
              aria-label={m.search}
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-autocomplete="list"
              aria-activedescendant={`${id}-opt-${active}`}
              placeholder={m.search}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                pop.setActive(e.target.value ? 1 : 0);
              }}
              onKeyDown={(e) => pop.onKey(e, (i) => choose(items[i]))}
            />
          </label>
          <ul
            ref={pop.list}
            id={`${id}-list`}
            role="listbox"
            aria-labelledby={`${id}-label`}
            className="program-picker__list"
          >
            {items.map((it, i) => {
              const prev = items[i - 1];
              const heading =
                it.kind !== "new" && prev?.kind !== it.kind ? (it.kind === "mine" ? m.mine : m.real) : null;
              return [
                heading && (
                  <li key={`h-${it.kind}`} role="presentation" className="program-picker__group label">
                    {heading}
                  </li>
                ),
                <li
                  key={keyOf(it)}
                  id={`${id}-opt-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={it.kind === "mine" && it.p.id === value}
                  className={[
                    "program-picker__option",
                    it.kind === "new" && "program-picker__option--new",
                    i === active && "is-active",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseEnter={() => pop.setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(it)}
                >
                  {it.kind === "new" && (
                    <>
                      <Plus size={18} weight="bold" aria-hidden="true" />
                      <span className="program-picker__name">{m.newProgram}</span>
                      <span className="program-picker__meta">{m.newProgramHint}</span>
                    </>
                  )}
                  {it.kind === "mine" && (
                    <>
                      <Swatch primary={it.p.primary} secondary={it.p.secondary} />
                      <span className="program-picker__text">
                        <span className="program-picker__name">{it.p.name}</span>
                        <span className="program-picker__meta">{it.p.meta}</span>
                      </span>
                      {it.p.id === value && (
                        <Check className="program-picker__check" size={18} weight="bold" aria-hidden="true" />
                      )}
                    </>
                  )}
                  {it.kind === "real" && (
                    <>
                      <PencilSimple size={16} weight="bold" aria-hidden="true" />
                      <span className="program-picker__name">{it.t.name}</span>
                      <span className="program-picker__meta">{it.t.edited ? m.edited : ""}</span>
                      <span className="program-picker__abbr">{it.t.abbreviation}</span>
                    </>
                  )}
                </li>,
              ];
            })}
            {items.length === 1 && query && <li className="program-picker__none">{m.noMatch(query)}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
